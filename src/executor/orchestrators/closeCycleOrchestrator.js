/**
 * 平仓闭环编排器。
 *
 * 串联：平仓信号 -> maker-taker 平仓执行 -> 成交对比 -> 落库。
 */

import { compareCloseResult } from "../services/closeResultComparator.js";
import { createMakerTakerCloseExecutor } from "../services/makerTakerCloseExecutor.js";
import { ORDER_LEGS } from "../persistence/schema.js";

function getFeeBpsForRole(config, exchange, role) {
  const exchangeConfig = config?.exchanges?.[exchange];
  return exchangeConfig?.feeBps?.[role] ?? 0;
}

export function createCloseCycleOrchestrator({
  config,
  runtime,
  orderRouter,
  repositories,
} = {}) {
  const clock = runtime?.clock ?? { now: () => Date.now() };
  const closeExecutor = createMakerTakerCloseExecutor({ orderRouter });

  return {
    async runCloseCycle({ cycleId, closeSignal, positionSnapshot } = {}) {
      if (!cycleId || !closeSignal) {
        throw new Error("runCloseCycle 缺少必要参数 cycleId/closeSignal");
      }

      repositories.cycles.updateStatus(cycleId, "CLOSING");

      const closeResult = await closeExecutor.execute({
        planId: cycleId,
        positionSnapshot,
        closeSignal,
      });

      // 从 closeResult.orders 提取 maker/taker 成交
      const orders = closeResult.orders ?? [];
      const makerOrder = orders[0];
      const takerOrder = orders[1] ?? orders[0];

      // 落库平仓订单
      const closeLegs = closeSignal.legs ?? [];
      const makerLegSignal = closeLegs.find((l) => l.role === "maker") ?? closeLegs[0];
      const takerLegSignal = closeLegs.find((l) => l.role === "taker") ?? closeLegs[1];

      if (makerLegSignal && makerOrder) {
        repositories.orders.insert({
          orderId: String(makerOrder.orderId ?? makerOrder.id ?? `close-maker-${cycleId}`),
          cycleId,
          exchange: makerLegSignal.exchange,
          leg: ORDER_LEGS.MAKER_CLOSE,
          side: makerLegSignal.side,
          symbol: makerLegSignal.symbol ?? positionSnapshot?.symbol,
          price: Number(makerOrder.price ?? makerLegSignal.price),
          quantity: Number(makerOrder.quantity ?? makerLegSignal.quantity),
          filledQuantity: Number(makerOrder.filledQuantity ?? 0),
          status: makerOrder.status ?? "unknown",
          rawPayload: makerOrder,
          createdAt: clock.now(),
        });
      }
      if (takerLegSignal && takerOrder) {
        repositories.orders.insert({
          orderId: String(takerOrder.orderId ?? takerOrder.id ?? `close-taker-${cycleId}`),
          cycleId,
          exchange: takerLegSignal.exchange,
          leg: ORDER_LEGS.TAKER_CLOSE,
          side: takerLegSignal.side,
          symbol: takerLegSignal.symbol ?? positionSnapshot?.symbol,
          price: Number(takerOrder.price ?? takerLegSignal.price),
          quantity: Number(takerOrder.quantity ?? takerLegSignal.quantity),
          filledQuantity: Number(takerOrder.filledQuantity ?? 0),
          status: takerOrder.status ?? "unknown",
          rawPayload: takerOrder,
          createdAt: clock.now(),
        });

        if (Number(takerOrder.filledQuantity ?? 0) > 0) {
          const feeBps = getFeeBpsForRole(config, takerLegSignal.exchange, "taker");
          repositories.fills.insert({
            fillId: `close-fill-taker-${cycleId}-${clock.now()}`,
            orderId: String(takerOrder.orderId ?? takerOrder.id ?? `close-taker-${cycleId}`),
            cycleId,
            exchange: takerLegSignal.exchange,
            symbol: takerLegSignal.symbol ?? positionSnapshot?.symbol,
            side: takerLegSignal.side,
            price: Number(takerOrder.price ?? takerLegSignal.price),
            quantity: Number(takerOrder.filledQuantity ?? 0),
            feeUsdt:
              Number(takerOrder.price ?? takerLegSignal.price) *
              Number(takerOrder.filledQuantity ?? 0) *
              (feeBps / 10_000),
            timestamp: clock.now(),
          });
        }
      }

      if (makerOrder && Number(makerOrder.filledQuantity ?? 0) > 0 && makerLegSignal) {
        const feeBps = getFeeBpsForRole(config, makerLegSignal.exchange, "maker");
        repositories.fills.insert({
          fillId: `close-fill-maker-${cycleId}-${clock.now()}`,
          orderId: String(makerOrder.orderId ?? makerOrder.id ?? `close-maker-${cycleId}`),
          cycleId,
          exchange: makerLegSignal.exchange,
          symbol: makerLegSignal.symbol ?? positionSnapshot?.symbol,
          side: makerLegSignal.side,
          price: Number(makerOrder.price ?? makerLegSignal.price),
          quantity: Number(makerOrder.filledQuantity ?? 0),
          feeUsdt:
            Number(makerOrder.price ?? makerLegSignal.price) *
            Number(makerOrder.filledQuantity ?? 0) *
            (feeBps / 10_000),
          timestamp: clock.now(),
        });
      }

      // 成交对比
      const lockedSpreadRow = repositories.spreadLocks.findByCycleId(cycleId);
      const openLockedSpread = lockedSpreadRow
        ? { netSpreadUsdt: Number(lockedSpreadRow.net_spread_usdt) }
        : { netSpreadUsdt: 0 };

      const feeCostUsdt =
        Number(makerOrder?.price ?? 0) * Number(makerOrder?.filledQuantity ?? 0) *
          (getFeeBpsForRole(config, makerLegSignal?.exchange, "maker") / 10_000) +
        Number(takerOrder?.price ?? 0) * Number(takerOrder?.filledQuantity ?? 0) *
          (getFeeBpsForRole(config, takerLegSignal?.exchange, "taker") / 10_000);

      const comparison = compareCloseResult({
        closeSignal,
        closeExecution: {
          makerFill: {
            price: Number(makerOrder?.price ?? 0),
            quantity: Number(makerOrder?.filledQuantity ?? 0),
          },
          takerFill: {
            price: Number(takerOrder?.price ?? 0),
            quantity: Number(takerOrder?.filledQuantity ?? 0),
          },
        },
        openLockedSpread,
        feeCostUsdt,
      });

      // 落库 close_result
      repositories.closeResults.insert({
        closeId: `cr-${cycleId}`,
        cycleId,
        symbol: positionSnapshot?.symbol ?? makerLegSignal?.symbol ?? null,
        expectedSpreadUsdt: comparison.expectedSpreadUsdt,
        actualSpreadUsdt: comparison.actualSpreadUsdt,
        makerSlippageUsdt: comparison.makerSlippageUsdt,
        takerSlippageUsdt: comparison.takerSlippageUsdt,
        netProfitUsdt: comparison.netProfitUsdt,
        closedAt: clock.now(),
        metadata: {
          closed: closeResult.closed,
          executionPath: closeResult.executionPath,
          actualSpreadBps: comparison.actualSpreadBps,
        },
      });

      repositories.cycles.updateStatus(cycleId, "CLOSED", clock.now());

      return {
        success: closeResult.closed,
        cycleId,
        closeResult,
        comparison,
      };
    },
  };
}
