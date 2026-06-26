import { describe, expect, it } from "vitest";
import { BinanceUsdcAdapter } from "../../src/executor/adapters/binanceUsdcAdapter.js";
import { ExchangeAdapterError } from "../../src/executor/core/errors.js";

function createFakeBinanceExchange(overrides = {}) {
  const calls = [];
  const fake = {
    has: { createPostOnlyOrder: true },
    async loadMarkets() {
      return { "BIO/USDC:USDC": { symbol: "BIO/USDC:USDC", linear: true, active: true } };
    },
    async createPostOnlyOrder(symbol, type, side, quantity, price, params) {
      calls.push({ method: "createPostOnlyOrder", args: { symbol, type, side, quantity, price, params } });
      return {
        id: "bin-order-1",
        symbol,
        side,
        type,
        price,
        quantity,
        filled: quantity,
        amount: quantity,
        remaining: 0,
        status: "closed",
        average: price,
        fee: { cost: 0, currency: "USDC" },
        fees: [{ cost: 0, currency: "USDC" }],
        ...overrides.order,
      };
    },
    async createOrder(symbol, type, side, quantity, price, params) {
      calls.push({ method: "createOrder", args: { symbol, type, side, quantity, price, params } });
      return {
        id: "bin-order-2",
        symbol,
        side,
        type,
        price,
        quantity,
        filled: quantity,
        amount: quantity,
        remaining: 0,
        status: "closed",
        average: price,
        fee: { cost: 0, currency: "USDC" },
        fees: [],
        ...overrides.order,
      };
    },
    async cancelOrder(orderId, symbol) {
      calls.push({ method: "cancelOrder", args: { orderId, symbol } });
      return { id: orderId, status: "canceled" };
    },
    async fetchOrder(orderId, symbol) {
      calls.push({ method: "fetchOrder", args: { orderId, symbol } });
      return {
        id: orderId,
        symbol,
        status: "closed",
        price: 0.0295,
        quantity: 338,
        filled: 338,
        amount: 338,
        remaining: 0,
        average: 0.0295,
      };
    },
    async fetchPositions(symbols) {
      calls.push({ method: "fetchPositions", args: { symbols } });
      return [{ symbol: symbols?.[0], contracts: 0, side: null }];
    },
    async fetchBalance(params) {
      calls.push({ method: "fetchBalance", args: { params } });
      return {
        free: { USDC: 100 },
        used: { USDC: 0 },
        total: { USDC: 100 },
      };
    },
    async close() {
      calls.push({ method: "close" });
    },
    calls,
    ...overrides.exchange,
  };
  return fake;
}

describe("BinanceUsdcAdapter", () => {
  it("placeOrder 用 PostOnly 下单并归一化回报", async () => {
    const fake = createFakeBinanceExchange();
    const adapter = new BinanceUsdcAdapter({ exchange: fake });

    const result = await adapter.placeOrder({
      symbol: "BIO/USDC:USDC",
      side: "buy",
      type: "limit",
      quantity: 338,
      price: 0.0295,
      timeInForce: "GTC",
      postOnly: true,
    });

    expect(result.exchange).toBe("binance");
    expect(result.orderId).toBe("bin-order-1");
    expect(result.filledQuantity).toBe(338);
    expect(result.status).toBe("closed");
    expect(fake.calls[0].method).toBe("createPostOnlyOrder");
    expect(fake.calls[0].args.params.postOnly).toBe(true);
  });

  it("placeOrder 无 postOnly 时走 createOrder", async () => {
    const fake = createFakeBinanceExchange();
    const adapter = new BinanceUsdcAdapter({ exchange: fake });

    await adapter.placeOrder({
      symbol: "BIO/USDC:USDC",
      side: "sell",
      type: "market",
      quantity: 338,
      reduceOnly: true,
    });

    expect(fake.calls[0].method).toBe("createOrder");
    expect(fake.calls[0].args.params.reduceOnly).toBe(true);
  });

  it("placeOrder 异常包装为 ExchangeAdapterError", async () => {
    const fake = createFakeBinanceExchange({
      exchange: {
        async createOrder() {
          throw new Error("boom");
        },
        async createPostOnlyOrder() {
          throw new Error("boom");
        },
      },
    });
    const adapter = new BinanceUsdcAdapter({ exchange: fake });

    await expect(
      adapter.placeOrder({ symbol: "BIO/USDC:USDC", side: "buy", quantity: 1, type: "limit", price: 1 }),
    ).rejects.toBeInstanceOf(ExchangeAdapterError);
  });

  it("getBalance 返回 USDC 余额归一化结构", async () => {
    const fake = createFakeBinanceExchange();
    const adapter = new BinanceUsdcAdapter({ exchange: fake });

    const balance = await adapter.getBalance();
    expect(balance).toMatchObject({
      exchange: "binance",
      freeUSDC: 100,
      totalUSDC: 100,
    });
  });

  it("cancelOrder 返回 cancelled 状态", async () => {
    const fake = createFakeBinanceExchange();
    const adapter = new BinanceUsdcAdapter({ exchange: fake });

    const result = await adapter.cancelOrder({ orderId: "123", symbol: "BIO/USDC:USDC" });
    expect(result.cancelled).toBe(true);
  });

  it("getOrder 返回归一化订单", async () => {
    const fake = createFakeBinanceExchange();
    const adapter = new BinanceUsdcAdapter({ exchange: fake });

    const order = await adapter.getOrder({ orderId: "bin-order-1", symbol: "BIO/USDC:USDC" });
    expect(order.orderId).toBe("bin-order-1");
    expect(order.filledQuantity).toBe(338);
  });

  it("getPosition 返回仓位", async () => {
    const fake = createFakeBinanceExchange();
    const adapter = new BinanceUsdcAdapter({ exchange: fake });

    const pos = await adapter.getPosition({ symbol: "BIO/USDC:USDC" });
    expect(pos).toMatchObject({ contracts: 0 });
  });
});
