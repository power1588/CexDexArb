import { describe, expect, it } from "vitest";
import { createMockExchangeAdapter } from "../../src/executor/adapters/exchangeAdapter.js";
import { createOrderRouter } from "../../src/executor/services/orderRouter.js";

describe("order router", () => {
  it("maker 腿下单参数正确", async () => {
    const requests = [];
    const router = createOrderRouter({
      adapters: {
        binance: createMockExchangeAdapter({
          name: "binance",
          handlers: {
            async placeOrder(request) {
              requests.push(request);
              return {
                id: "1",
                symbol: request.symbol,
                side: request.side,
                status: "filled",
                price: request.price,
                quantity: request.quantity,
                filled: request.quantity,
              };
            },
          },
        }),
      },
    });

    await router.placeOrder(
      {
        exchange: "binance",
        symbol: "BTCUSDT",
        side: "buy",
        orderType: "limit",
        quantity: 0.1,
        price: 100_000,
        tif: "GTC",
        role: "maker",
      },
      "maker",
    );

    expect(requests[0]).toMatchObject({
      timeInForce: "GTC",
      postOnly: true,
      role: "maker",
    });
  });

  it("对冲腿 IOC/FOK 参数正确", async () => {
    const requests = [];
    const adapter = createMockExchangeAdapter({
      name: "hyperliquid",
      handlers: {
        async placeOrder(request) {
          requests.push(request);
          return {
            id: "1",
            symbol: request.symbol,
            side: request.side,
            status: "filled",
            price: request.price,
            quantity: request.quantity,
            filled: request.quantity,
          };
        },
      },
    });
    const router = createOrderRouter({
      adapters: {
        hyperliquid: adapter,
      },
    });

    await router.placeOrder(
      {
        exchange: "hyperliquid",
        symbol: "BTC",
        side: "sell",
        orderType: "limit",
        quantity: 0.1,
        price: 100_050,
        tif: "IOC",
        role: "taker",
      },
      "hedge_ioc",
    );
    await router.placeOrder(
      {
        exchange: "hyperliquid",
        symbol: "BTC",
        side: "sell",
        orderType: "limit",
        quantity: 0.1,
        price: 100_050,
        tif: "FOK",
        role: "taker",
      },
      "hedge_fok",
    );

    expect(requests[0].timeInForce).toBe("IOC");
    expect(requests[1].timeInForce).toBe("FOK");
  });

  it("撤单与查单请求会路由到正确交易所", async () => {
    const invoked = [];
    const router = createOrderRouter({
      adapters: {
        binance: createMockExchangeAdapter({
          name: "binance",
          handlers: {
            async cancelOrder(request) {
              invoked.push(`cancel:${request.orderId}`);
              return { cancelled: true };
            },
            async getOrder(request) {
              invoked.push(`get:${request.orderId}`);
              return {
                id: request.orderId,
                symbol: "BTCUSDT",
                status: "filled",
                price: 100_000,
                quantity: 0.1,
                filled: 0.1,
              };
            },
          },
        }),
      },
    });

    await router.cancelOrder({
      exchange: "binance",
      orderId: "1",
    });
    await router.getOrder({
      exchange: "binance",
      orderId: "1",
    });

    expect(invoked).toEqual(["cancel:1", "get:1"]);
  });
});
