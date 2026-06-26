/**
 * 建仓闭环编排器。
 *
 * 串联：maker-taker 建仓 -> 成交归集 -> 仓位对齐校验 -> 实际锁定价差 -> 信号对比 -> SQLite 落库。
 *
 * 这是 C1 阶段的胶水层，所有核心计算都委托给纯函数模块。
 */

import { aggregateOpenFills } from "../services/openFillAggregator.js";
import { checkPositionAlignment } from "../services/positionAlignmentChecker.js";
import { computeLockedSpread } from "../services/lockedSpreadCalculator.js";
import { compareSignalVsActual } from "../services/signalVsActualComparator.js";
import { ORDER_LEGS } from "../persistence/schema.js";

function getFeeBpsForRole(config, exchange, role) {
  const exchangeConfig = config?.exchanges?.[exchange];
  if (!exchangeConfig) {
    return 0;
  }
  return exchangeConfig.feeBps?.[role] ?? 0;
}

function inferLegRole(plan, leg) {
  const isBuy = leg.side === "buy";
  if (plan.mode === "maker_taker") {
    return isBuy ? { legType: ORDER_LEGS.MAKER_OPEN, role: "maker" } : { legType: ORDER_LEGS.TAKER_OPEN, role: "taker" };
  }
  if (plan.mode === "taker_maker") {
    return isBuy ? { legType: ORDER_LEGS.TAKER_OPEN, role: "taker" } : { legType: ORDER_LEGS.MAKER_OPEN, role: "maker" };
  }
  if (plan.mode === "maker_maker") {
    return { legType: ORDER_LEGS.MAKER_OPEN, role: "maker" };
  }
  return { legType: ORDER_LEGS.TAKER_OPEN, role: "taker" };
}

function getQuoteCurrency(leg) {
  return leg.quoteCurrency ?? (leg.exchange === "hyperliquid" ? "USDC" : "USDT");
}

export function createOpenCycleOrchestrator({
  config,
  runtime,
  orderRouter,
  repositories,
} = {}) {
  const clock = runtime?.clock ?? { now: () => Date.now() };

  async function executeLeg(leg, plan, cycleId) {
    const { legType, role } = inferLegRole(plan, leg);
    const template = role === "maker" ? "maker" : "hedge_ioc";
    const orderUpdate = await orderRouter.placeOrder(
      {
        exchange: leg.exchange,
        symbol: leg.symbol,
        side: leg.side,
        orderType: leg.orderType,
        price: leg.price,
        quantity: leg.quantity,
        quoteCurrency: getQuoteCurrency(leg),
      },
      template,
    );

    const orderId = String(orderUpdate.orderId ?? orderUpdate.id ?? `ord-${cycleId}-${leg.exchange}-${clock.now()}`);
    const filledQuantity = Number(orderUpdate.filledQuantity ?? orderUpdate.filled ?? 0);
    const fillPrice = Number(orderUpdate.price ?? orderUpdate.avgPrice ?? leg.price);

    repositories.orders.insert({
      orderId,
      cycleId,
      exchange: leg.exchange,
      leg: legType,
      side: leg.side,
      symbol: leg.symbol,
      price: leg.price,
      quantity: leg.quantity,
      filledQuantity,
      status: orderUpdate.status ?? "unknown",
      rawPayload: orderUpdate,
      createdAt: clock.now(),
    });

    if (filledQuantity > 0) {
      const feeBps = getFeeBpsForRole(config, leg.exchange, role);
      const feeUsdt = (fillPrice * filledQuantity * feeBps) / 10_000;
      repositories.fills.insert({
        fillId: `fill-${orderId}-${clock.now()}`,
        orderId,
        cycleId,
        exchange: leg.exchange,
        symbol: leg.symbol,
        side: leg.side,
        price: fillPrice,
        quantity: filledQuantity,
        feeUsdt,
        timestamp: clock.now(),
      });
    }

    return {
      orderId,
      exchange: leg.exchange,
      side: leg.side,
      filledQuantity,
      fillPrice,
      legType,
      role,
      raw: orderUpdate,
    };
  }

  return {
    async runOpenCycle({ cycleId, signal, plan } = {}) {
      if (!cycleId || !signal || !plan) {
        throw new Error("runOpenCycle 缺少必要参数 cycleId/signal/plan");
      }

      const startedAt = clock.now();
      repositories.cycles.insert({
        cycleId,
        signalId: signal.signalId,
        symbol: signal.symbol,
        mode: plan.mode,
        direction: `${signal.buyExchange}->${signal.sellExchange}`,
        status: "OPENING",
        startedAt,
        metadata: {
          observedSpreadBps: signal.observedSpreadBps,
          expectedNetEdgeBps: plan.expectedNetEdgeBps,
        },
      });

      const sortedLegs = [...plan.legs].sort((a, b) => {
        const aMaker = a.orderType === "limit" ? 0 : 1;
        const bMaker = b.orderType === "limit" ? 0 : 1;
        return aMaker - bMaker;
      });

      const legResults = [];
      for (const leg of sortedLegs) {
        const result = await executeLeg(leg, plan, cycleId);
        legResults.push(result);
      }

      // 把 leg 结果按 buy/sell 归集为 OpenFillAggregator 的输入
      const buyLegResult = legResults.find((r) => r.side === "buy");
      const sellLegResult = legResults.find((r) => r.side === "sell");

      const aggregated = aggregateOpenFills({
        buyLeg: {
          exchange: buyLegResult.exchange,
          side: "buy",
          fills: [{ price: buyLegResult.fillPrice, quantity: buyLegResult.filledQuantity, feeUsdt: 0 }],
        },
        sellLeg: {
          exchange: sellLegResult.exchange,
          side: "sell",
          fills: [{ price: sellLegResult.fillPrice, quantity: sellLegResult.filledQuantity, feeUsdt: 0 }],
        },
      });

      // 仓位对齐校验
      const alignment = checkPositionAlignment({
        buyLeg: {
          exchange: buyLegResult.exchange,
          side: "buy",
          quantity: aggregated.totalBuyQuantity,
          notionalUsdt: aggregated.totalBuyQuantity * buyLegResult.fillPrice,
        },
        sellLeg: {
          exchange: sellLegResult.exchange,
          side: "sell",
          quantity: aggregated.totalSellQuantity,
          notionalUsdt: aggregated.totalSellQuantity * sellLegResult.fillPrice,
        },
        maxImbalancePct: config.maxPositionImbalancePct,
      });

      // 落库仓位快照
      repositories.positions.insert({
        positionId: `pos-${cycleId}`,
        cycleId,
        symbol: signal.symbol,
        legs: [
          {
            exchange: buyLegResult.exchange,
            side: "long",
            quantity: aggregated.totalBuyQuantity,
            entryPrice: buyLegResult.fillPrice,
            notionalUsdt: aggregated.totalBuyQuantity * buyLegResult.fillPrice,
          },
          {
            exchange: sellLegResult.exchange,
            side: "short",
            quantity: aggregated.totalSellQuantity,
            entryPrice: sellLegResult.fillPrice,
            notionalUsdt: aggregated.totalSellQuantity * sellLegResult.fillPrice,
          },
        ],
        entryNotionalUsdt:
          aggregated.totalBuyQuantity * buyLegResult.fillPrice +
          aggregated.totalSellQuantity * sellLegResult.fillPrice,
        markNotionalUsdt:
          aggregated.totalBuyQuantity * buyLegResult.fillPrice +
          aggregated.totalSellQuantity * sellLegResult.fillPrice,
        unrealizedPnlUsdt: 0,
        timestamp: clock.now(),
      });

      if (!alignment.aligned) {
        repositories.cycles.updateStatus(cycleId, "FAILED", clock.now());
        repositories.riskEvents.insert({
          riskEventId: `re-${cycleId}-alignment`,
          cycleId,
          type: "position_imbalance",
          severity: "high",
          symbol: signal.symbol,
          planId: plan.planId,
          message: `仓位未对齐: imbalance=${alignment.imbalancePct?.toFixed?.(4) ?? "unknown"}%`,
          context: { alignment },
          timestamp: clock.now(),
        });
        return {
          success: false,
          cycleId,
          reason: "position_not_aligned",
          alignment,
          aggregated,
        };
      }

      // 实际锁定价差
      const lockedSpread = computeLockedSpread({
        buyExchange: buyLegResult.exchange,
        buyPrice: buyLegResult.fillPrice,
        buyQuoteCurrency: getQuoteCurrency(buyLegResult),
        sellExchange: sellLegResult.exchange,
        sellPrice: sellLegResult.fillPrice,
        sellQuoteCurrency: getQuoteCurrency(sellLegResult),
        quantity: Math.min(aggregated.totalBuyQuantity, aggregated.totalSellQuantity),
        fxUsdcUsdtMid: plan.parameterSnapshot?.fxUsdcUsdtMid ?? 1.0,
        buyFeeBps: getFeeBpsForRole(config, buyLegResult.exchange, buyLegResult.role),
        sellFeeBps: getFeeBpsForRole(config, sellLegResult.exchange, sellLegResult.role),
      });

      repositories.spreadLocks.insert({
        lockId: `sl-${cycleId}`,
        cycleId,
        symbol: signal.symbol,
        grossSpreadUsdt: lockedSpread.grossSpreadUsdt,
        feeCostUsdt: lockedSpread.feeCostUsdt,
        netSpreadUsdt: lockedSpread.netSpreadUsdt,
        netSpreadBps: lockedSpread.netSpreadBps,
        fxDetail: lockedSpread.fxDetail,
        lockedAt: clock.now(),
      });

      // 与 Redis 信号对比
      const comparison = compareSignalVsActual({
        signal: {
          signalId: signal.signalId,
          observedSpreadBps: signal.observedSpreadBps,
          expectedSpreadUsdt: signal.observedSpreadBps * 0.01 * plan.targetNotionalUsdt,
        },
        lockedSpread,
        warningThresholdBps: config.minOpenBps,
      });

      repositories.cycles.updateStatus(cycleId, "HEDGED");

      return {
        success: true,
        cycleId,
        aggregated,
        alignment,
        lockedSpread,
        comparison,
        legResults,
      };
    },
  };
}
