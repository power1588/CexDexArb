import { describe, expect, it, vi } from "vitest";
import { createMakerTakerCloseExecutor } from "../../src/executor/services/makerTakerCloseExecutor.js";

describe("MakerTakerCloseExecutor", () => {
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

  it("maker 平仓腿先挂单，成交后触发 taker 平仓腿", async () => {
    const calls = [];
    const executor = createMakerTakerCloseExecutor({
      orderRouter: {
        async placeOrder(intent, template) {
          calls.push({ exchange: intent.exchange, template });
          return {
            status: "filled",
            filledQuantity: intent.quantity,
            price: intent.price,
            orderId: `o-${calls.length}`,
          };
        },
      },
    });

    const result = await executor.execute({
      planId: "plan-1",
      positionSnapshot,
      closeSignal: {
        legs: [
          { exchange: "binance", side: "sell", quantity: 0.1, price: 100_000, role: "maker", legType: "maker_close" },
          { exchange: "hyperliquid", side: "buy", quantity: 0.1, price: 100_010, role: "taker", legType: "taker_close" },
        ],
      },
    });

    expect(result.closed).toBe(true);
    expect(calls[0].template).toBe("maker");
    expect(calls[1].template).toBe("hedge_ioc");
    expect(calls.map((c) => c.exchange)).toEqual(["binance", "hyperliquid"]);
  });

  it("maker 平仓部分成交时只对已成交部分做反向腿", async () => {
    const calls = [];
    const executor = createMakerTakerCloseExecutor({
      orderRouter: {
        async placeOrder(intent, template) {
          calls.push({ exchange: intent.exchange, quantity: intent.quantity, template });
          if (template === "maker") {
            return { status: "partial", filledQuantity: 0.06, price: intent.price, orderId: "m1" };
          }
          return { status: "filled", filledQuantity: intent.quantity, price: intent.price, orderId: "t1" };
        },
      },
    });

    const result = await executor.execute({
      planId: "plan-2",
      positionSnapshot,
      closeSignal: {
        legs: [
          { exchange: "binance", side: "sell", quantity: 0.1, price: 100_000, role: "maker", legType: "maker_close" },
          { exchange: "hyperliquid", side: "buy", quantity: 0.1, price: 100_010, role: "taker", legType: "taker_close" },
        ],
      },
    });

    expect(result.closed).toBe(false); // maker 只成交 0.06，仍有 0.04 剩余裸仓
    // taker 腿只对 maker 已成交的 0.06 做反向
    const takerCall = calls.find((c) => c.template === "hedge_ioc");
    expect(takerCall.quantity).toBeCloseTo(0.06, 8);
    expect(result.remainingQuantity).toBeCloseTo(0.04, 8);
    expect(result.filledQuantity).toBeCloseTo(0.06, 8);
  });

  it("maker 平仓失败时进入紧急平仓", async () => {
    const record = vi.fn();
    const executor = createMakerTakerCloseExecutor({
      orderRouter: {
        async placeOrder(intent, template) {
          if (template === "maker") {
            return { status: "new", filledQuantity: 0, price: intent.price, orderId: "m1" };
          }
          return { status: "filled", filledQuantity: intent.quantity, price: intent.price, orderId: "t1" };
        },
      },
      riskEventReporter: { record },
    });

    const result = await executor.execute({
      planId: "plan-3",
      positionSnapshot,
      closeSignal: {
        legs: [
          { exchange: "binance", side: "sell", quantity: 0.1, price: 100_000, role: "maker", legType: "maker_close" },
          { exchange: "hyperliquid", side: "buy", quantity: 0.1, price: 100_010, role: "taker", legType: "taker_close" },
        ],
      },
    });

    expect(result.closed).toBe(true);
    expect(result.executionPath).toBe("emergency");
    expect(record).toHaveBeenCalled();
  });
});
