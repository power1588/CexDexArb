import { describe, expect, it, vi } from "vitest";
import { createPartialFillHandler } from "../../src/executor/services/partialFillHandler.js";

describe("partial fill handler", () => {
  it("已成交部分会被立即对冲", async () => {
    const handler = createPartialFillHandler();

    const result = await handler.handle({
      targetQuantity: 1,
      filledQuantity: 0.4,
      hedgeLeg: {
        exchange: "hyperliquid",
        side: "sell",
      },
    });

    expect(result.hedgeQuantity).toBe(0.4);
    expect(result.hedgeIntent.quantity).toBe(0.4);
  });

  it("未成交剩余挂单会缩量或撤单", async () => {
    const cancelOrder = vi.fn();
    const handler = createPartialFillHandler({
      orderRouter: {
        cancelOrder,
      },
    });

    const result = await handler.handle({
      makerOrder: {
        exchange: "binance",
        orderId: "maker-1",
      },
      targetQuantity: 1,
      filledQuantity: 0.4,
      hedgeLeg: {
        exchange: "hyperliquid",
        side: "sell",
      },
    });

    expect(cancelOrder).toHaveBeenCalledWith({
      exchange: "binance",
      orderId: "maker-1",
    });
    expect(result.remainingQuantity).toBe(0.6);
  });

  it("不会按原目标量整笔对冲", async () => {
    const handler = createPartialFillHandler();

    const result = await handler.handle({
      targetQuantity: 1,
      filledQuantity: 0.2,
      hedgeLeg: {
        exchange: "hyperliquid",
        side: "sell",
      },
    });

    expect(result.hedgeIntent.quantity).not.toBe(1);
    expect(result.hedgeIntent.quantity).toBe(0.2);
  });
});
