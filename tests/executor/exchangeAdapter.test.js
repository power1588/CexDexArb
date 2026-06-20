import { describe, expect, it } from "vitest";
import {
  createMockExchangeAdapter,
  normalizeOrderUpdate,
} from "../../src/executor/adapters/exchangeAdapter.js";
import { ExchangeAdapterError } from "../../src/executor/core/errors.js";

describe("exchange adapter", () => {
  it("适配器能输出统一订单请求", () => {
    const adapter = createMockExchangeAdapter({
      name: "binance",
    });

    expect(
      adapter.toOrderRequest({
        exchange: "binance",
        symbol: "BTCUSDT",
        side: "buy",
        orderType: "limit",
        quantity: 0.1,
        price: 100_000,
        tif: "GTC",
        role: "maker",
      }),
    ).toMatchObject({
      exchange: "binance",
      symbol: "BTCUSDT",
      type: "limit",
    });
  });

  it("交易所返回结构可转换为统一订单回报", () => {
    expect(
      normalizeOrderUpdate("binance", {
        id: "1",
        symbol: "BTCUSDT",
        side: "buy",
        status: "filled",
        price: "100000",
        quantity: "0.1",
        filled: "0.1",
      }),
    ).toMatchObject({
      exchange: "binance",
      orderId: "1",
      filledQuantity: 0.1,
    });
  });

  it("适配器异常会抛出统一领域异常", async () => {
    const adapter = createMockExchangeAdapter({
      name: "binance",
      handlers: {
        async placeOrder() {
          throw new Error("boom");
        },
      },
    });

    await expect(
      adapter.placeOrder({
        symbol: "BTCUSDT",
      }),
    ).rejects.toBeInstanceOf(ExchangeAdapterError);
  });
});
