import { describe, expect, it, vi } from "vitest";
import { createCloseExecutor } from "../../src/executor/services/closeExecutor.js";

describe("close executor", () => {
  const positionSnapshot = {
    symbol: "BTC",
    legs: [
      {
        exchange: "binance",
        symbol: "BTCUSDT",
        side: "long",
        quantity: 0.1,
        markPrice: 100_000,
        notionalUsdt: 10_000,
      },
      {
        exchange: "hyperliquid",
        symbol: "BTC",
        side: "short",
        quantity: 0.1,
        markPrice: 100_010,
        notionalUsdt: 10_000,
      },
    ],
  };

  it("正常退出时双腿按计划平仓", async () => {
    const orders = [];
    const executor = createCloseExecutor({
      orderRouter: {
        async placeOrder(intent) {
          orders.push(intent.exchange);
          return {
            status: "filled",
            filledQuantity: intent.quantity,
          };
        },
      },
    });

    const result = await executor.execute({
      planId: "plan-1",
      positionSnapshot,
      executionPath: "normal",
    });

    expect(result.closed).toBe(true);
    expect(orders).toEqual(["binance", "hyperliquid"]);
  });

  it("紧急退出时优先降低方向暴露", async () => {
    const orders = [];
    const executor = createCloseExecutor({
      orderRouter: {
        async placeOrder(intent) {
          orders.push(intent.exchange);
          return {
            status: "filled",
            filledQuantity: intent.quantity,
          };
        },
      },
    });

    await executor.execute({
      planId: "plan-1",
      positionSnapshot: {
        ...positionSnapshot,
        legs: [
          { ...positionSnapshot.legs[0], notionalUsdt: 12_000 },
          { ...positionSnapshot.legs[1], notionalUsdt: 10_000 },
        ],
      },
      executionPath: "emergency",
    });

    expect(orders[0]).toBe("binance");
  });

  it("平仓失败时会重试或升级风险事件", async () => {
    const notifier = {
      notify: vi.fn(),
    };
    let attempts = 0;
    const record = vi.fn();
    const executor = createCloseExecutor({
      orderRouter: {
        async placeOrder() {
          attempts += 1;
          throw new Error("close failed");
        },
      },
      riskEventReporter: {
        record,
        notifier,
      },
    });

    const result = await executor.execute({
      planId: "plan-1",
      positionSnapshot,
      executionPath: "normal",
    });

    expect(result.closed).toBe(false);
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(record).toHaveBeenCalled();
  });
});
