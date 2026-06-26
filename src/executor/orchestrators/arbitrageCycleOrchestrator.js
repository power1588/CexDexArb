/**
 * 套利周期编排器。
 *
 * 把建仓、监控、平仓串成一个完整的套利周期。
 * 管理 cycle_id 生命周期：OPENING -> HEDGED -> MONITORING -> CLOSING -> CLOSED。
 * 异常中断时归档为 FAILED。
 */

import { createOpenCycleOrchestrator } from "./openCycleOrchestrator.js";
import { createCloseCycleOrchestrator } from "./closeCycleOrchestrator.js";
import { createPositionGuardLoop } from "../services/positionGuardLoop.js";
import { generateCloseSignal } from "../services/closeSignalGenerator.js";

export function createArbitrageCycleOrchestrator({
  config,
  runtime,
  orderRouter,
  repositories,
  pollIntervalMs = 500,
  maxHoldingDurationMs = 5 * 60 * 1000,
  getMarketSnapshot,
} = {}) {
  const clock = runtime?.clock ?? { now: () => Date.now() };
  const openOrchestrator = createOpenCycleOrchestrator({
    config,
    runtime,
    orderRouter,
    repositories,
  });
  const closeOrchestrator = createCloseCycleOrchestrator({
    config,
    runtime,
    orderRouter,
    repositories,
  });

  async function runMonitoring({ cycleId, plan }) {
    const guardLoop = createPositionGuardLoop({
      clock,
      pollIntervalMs,
      maxHoldingDurationMs,
      closeThresholdBps: config.minOpenBps,
      getMarketSnapshot,
    });

    const buyLeg = plan.legs.find((l) => l.side === "buy");
    const sellLeg = plan.legs.find((l) => l.side === "sell");
    const openDirection = `buy_${buyLeg.exchange}_sell_${sellLeg.exchange}`;

    repositories.cycles.updateStatus(cycleId, "MONITORING");

    const monitorResult = await guardLoop.run({
      cycleId,
      openDirection,
      fxUsdcUsdtMid: plan.parameterSnapshot?.fxUsdcUsdtMid ?? 1.0,
    });

    return { monitorResult, openDirection, buyLeg, sellLeg };
  }

  function buildCloseSignal({ openResult, plan, monitorResult }) {
    const buyLeg = plan.legs.find((l) => l.side === "buy");
    const sellLeg = plan.legs.find((l) => l.side === "sell");
    const finalSnapshot = monitorResult.finalSnapshot;

    const buyClosePrice = finalSnapshot?.buyPrice ?? buyLeg.price;
    const sellClosePrice = finalSnapshot?.sellPriceRaw ?? sellLeg.price;

    return generateCloseSignal({
      openDirection: `buy_${buyLeg.exchange}_sell_${sellLeg.exchange}`,
      buyLeg: {
        exchange: buyLeg.exchange,
        symbol: buyLeg.symbol,
        side: "long",
        quantity: openResult.aggregated.totalBuyQuantity,
        entryPrice: openResult.aggregated.buyWeightedAvgPrice,
      },
      sellLeg: {
        exchange: sellLeg.exchange,
        symbol: sellLeg.symbol,
        side: "short",
        quantity: openResult.aggregated.totalSellQuantity,
        entryPrice: openResult.aggregated.sellWeightedAvgPrice,
      },
      currentSpreadBps: finalSnapshot?.netSpreadBps ?? 0,
      fxUsdcUsdtMid: plan.parameterSnapshot?.fxUsdcUsdtMid ?? 1.0,
      buyClosePrice,
      sellClosePrice,
      buyQuoteCurrency: buyLeg.quoteCurrency,
      sellQuoteCurrency: sellLeg.quoteCurrency,
      openMode: plan.mode,
    });
  }

  return {
    async runFullCycle({ cycleId, signal, plan } = {}) {
      const stages = [];

      // 1. 建仓
      repositories.cycles.updateStatus; // noop placeholder to keep stages explicit
      const openResult = await openOrchestrator.runOpenCycle({ cycleId, signal, plan });
      stages.push("OPENING");

      if (!openResult.success) {
        return {
          success: false,
          cycleId,
          stages,
          reason: openResult.reason ?? "open_failed",
        };
      }

      stages.push("HEDGED");

      // 2. 监控
      const { monitorResult, buyLeg, sellLeg } = await runMonitoring({
        cycleId,
        plan,
      });
      stages.push("MONITORING");

      // 监控异常 -> 归档失败
      if (monitorResult.exitReason === "risk_exit") {
        repositories.cycles.updateStatus(cycleId, "FAILED", clock.now());
        repositories.riskEvents.insert({
          riskEventId: `re-${cycleId}-monitor-risk`,
          cycleId,
          type: "monitoring_risk_exit",
          severity: "high",
          symbol: signal.symbol,
          planId: plan.planId,
          message: `监控风险退出: ${monitorResult.reason ?? "unknown"}`,
          context: { monitorResult },
          timestamp: clock.now(),
        });
        return {
          success: false,
          cycleId,
          stages,
          reason: "monitoring_risk_exit",
          monitorResult,
        };
      }

      // 3. 平仓
      stages.push("CLOSING");
      repositories.cycles.updateStatus(cycleId, "CLOSING");

      const closeSignal = buildCloseSignal({ openResult, plan, monitorResult });
      const positionSnapshot = {
        symbol: signal.symbol,
        legs: [
          {
            exchange: buyLeg.exchange,
            symbol: buyLeg.symbol,
            side: "long",
            quantity: openResult.aggregated.totalBuyQuantity,
            markPrice: closeSignal.legs.find((l) => l.exchange === buyLeg.exchange)?.price ?? buyLeg.price,
            notionalUsdt:
              openResult.aggregated.totalBuyQuantity *
              openResult.aggregated.buyWeightedAvgPrice,
          },
          {
            exchange: sellLeg.exchange,
            symbol: sellLeg.symbol,
            side: "short",
            quantity: openResult.aggregated.totalSellQuantity,
            markPrice: closeSignal.legs.find((l) => l.exchange === sellLeg.exchange)?.price ?? sellLeg.price,
            notionalUsdt:
              openResult.aggregated.totalSellQuantity *
              openResult.aggregated.sellWeightedAvgPrice,
          },
        ],
      };

      const closeResult = await closeOrchestrator.runCloseCycle({
        cycleId,
        closeSignal,
        positionSnapshot,
      });

      stages.push("CLOSED");

      return {
        success: closeResult.success,
        cycleId,
        stages,
        openResult,
        monitorResult,
        closeResult,
      };
    },
  };
}
