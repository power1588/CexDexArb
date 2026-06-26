import { describe, expect, it } from "vitest";
import { HyperliquidAdapter } from "../../src/executor/adapters/hyperliquidAdapter.js";
import { ExchangeAdapterError } from "../../src/executor/core/errors.js";

function createFakeHyperliquidExchange(overrides = {}) {
  const calls = [];
  const fake = {
    has: { createPostOnlyOrder: true },
    async loadMarkets() {
      return { "BIO/USDC:USDC": { symbol: "BIO/USDC:USDC", active: true } };
    },
    async publicPostInfo(params) {
      calls.push({ method: "publicPostInfo", args: { params } });
      return { role: "agent", data: { user: "0xowner" } };
    },
    async createPostOnlyOrder(symbol, type, side, quantity, price, params) {
      calls.push({ method: "createPostOnlyOrder", args: { symbol, type, side, quantity, price, params } });
      return {
        id: "hl-order-1",
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
        fees: [{ cost: 0.0134, currency: "USDC" }],
        ...overrides.order,
      };
    },
    async createOrder(symbol, type, side, quantity, price, params) {
      calls.push({ method: "createOrder", args: { symbol, type, side, quantity, price, params } });
      return {
        id: "hl-order-2",
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
        fee: { cost: 0.0134, currency: "USDC" },
        fees: [{ cost: 0.0134, currency: "USDC" }],
        ...overrides.order,
      };
    },
    async cancelOrder(orderId, symbol) {
      calls.push({ method: "cancelOrder", args: { orderId, symbol } });
      return { id: orderId, status: "canceled" };
    },
    async editOrder(orderId, symbol, type, side, quantity, price) {
      calls.push({ method: "editOrder", args: { orderId, symbol, type, side, quantity, price } });
      return {
        id: orderId,
        symbol,
        status: "open",
        price,
        quantity,
        filled: 0,
        amount: quantity,
        remaining: quantity,
      };
    },
    async fetchOrder(orderId, symbol, _, params) {
      calls.push({ method: "fetchOrder", args: { orderId, symbol, params } });
      return {
        id: orderId,
        symbol,
        status: "closed",
        price: 0.0296,
        quantity: 338,
        filled: 338,
        amount: 338,
        remaining: 0,
        average: 0.0296,
      };
    },
    async fetchPositions(symbols, params) {
      calls.push({ method: "fetchPositions", args: { symbols, params } });
      return [{ symbol: symbols?.[0], contracts: 0, side: null }];
    },
    async fetchBalance(params) {
      calls.push({ method: "fetchBalance", args: { params } });
      return {
        free: { USDC: 50 },
        used: { USDC: 0 },
        total: { USDC: 50 },
      };
    },
    async setLeverage(leverage, symbol) {
      calls.push({ method: "setLeverage", args: { leverage, symbol } });
      return { leverage, symbol };
    },
    async close() {
      calls.push({ method: "close" });
    },
    calls,
    ...overrides.exchange,
  };
  return fake;
}

describe("HyperliquidAdapter", () => {
  it("resolveAccountAddress 把 agent 地址解析为主账户", async () => {
    const fake = createFakeHyperliquidExchange();
    const adapter = new HyperliquidAdapter({
      exchange: fake,
      walletAddress: "0xagent",
    });

    const accountAddress = await adapter.resolveAccountAddress();
    expect(accountAddress).toBe("0xowner");
    expect(adapter.accountAddress).toBe("0xowner");
    expect(adapter.role).toBe("agent");
  });

  it("placeOrder 用 PostOnly 下单并归一化回报", async () => {
    const fake = createFakeHyperliquidExchange();
    const adapter = new HyperliquidAdapter({
      exchange: fake,
      walletAddress: "0xagent",
    });
    adapter.accountAddress = "0xowner";

    const result = await adapter.placeOrder({
      symbol: "BIO/USDC:USDC",
      side: "sell",
      type: "limit",
      quantity: 338,
      price: 0.0296,
      timeInForce: "IOC",
      postOnly: true,
    });

    expect(result.exchange).toBe("hyperliquid");
    expect(result.orderId).toBe("hl-order-1");
    expect(result.filledQuantity).toBe(338);
    expect(fake.calls[0].method).toBe("createPostOnlyOrder");
  });

  it("placeOrder 无 postOnly 时走 createOrder", async () => {
    const fake = createFakeHyperliquidExchange();
    const adapter = new HyperliquidAdapter({
      exchange: fake,
      walletAddress: "0xagent",
    });

    await adapter.placeOrder({
      symbol: "BIO/USDC:USDC",
      side: "sell",
      type: "limit",
      quantity: 338,
      price: 0.0296,
      timeInForce: "IOC",
    });

    expect(fake.calls[0].method).toBe("createOrder");
    expect(fake.calls[0].args.params.timeInForce).toBe("IOC");
  });

  it("placeOrder 异常包装为 ExchangeAdapterError", async () => {
    const fake = createFakeHyperliquidExchange({
      exchange: {
        async createOrder() {
          throw new Error("boom");
        },
        async createPostOnlyOrder() {
          throw new Error("boom");
        },
      },
    });
    const adapter = new HyperliquidAdapter({
      exchange: fake,
      walletAddress: "0xagent",
    });

    await expect(
      adapter.placeOrder({
        symbol: "BIO/USDC:USDC",
        side: "buy",
        quantity: 1,
        type: "limit",
        price: 1,
      }),
    ).rejects.toBeInstanceOf(ExchangeAdapterError);
  });

  it("getBalance 传入 accountAddress 作为 user", async () => {
    const fake = createFakeHyperliquidExchange();
    const adapter = new HyperliquidAdapter({
      exchange: fake,
      walletAddress: "0xagent",
    });
    adapter.accountAddress = "0xowner";

    const balance = await adapter.getBalance();
    expect(balance).toMatchObject({
      exchange: "hyperliquid",
      freeUSDC: 50,
    });
    // 确认 fetchBalance 调用时传入了 user
    const fetchBalanceCall = fake.calls.find((c) => c.method === "fetchBalance");
    expect(fetchBalanceCall.args.params.user).toBe("0xowner");
  });

  it("cancelOrder 返回 cancelled 状态", async () => {
    const fake = createFakeHyperliquidExchange();
    const adapter = new HyperliquidAdapter({
      exchange: fake,
      walletAddress: "0xagent",
    });

    const result = await adapter.cancelOrder({ orderId: "hl-1", symbol: "BIO/USDC:USDC" });
    expect(result.cancelled).toBe(true);
  });

  it("getOrder 传入 user 参数", async () => {
    const fake = createFakeHyperliquidExchange();
    const adapter = new HyperliquidAdapter({
      exchange: fake,
      walletAddress: "0xagent",
    });
    adapter.accountAddress = "0xowner";

    const order = await adapter.getOrder({ orderId: "hl-order-1", symbol: "BIO/USDC:USDC" });
    expect(order.orderId).toBe("hl-order-1");
    const fetchOrderCall = fake.calls.find((c) => c.method === "fetchOrder");
    expect(fetchOrderCall.args.params.user).toBe("0xowner");
  });

  it("amendOrder 优先尝试 editOrder", async () => {
    const fake = createFakeHyperliquidExchange();
    const adapter = new HyperliquidAdapter({
      exchange: fake,
      walletAddress: "0xagent",
    });

    const result = await adapter.amendOrder({
      orderId: "hl-1",
      symbol: "BIO/USDC:USDC",
      side: "buy",
      quantity: 200,
      price: 0.03,
    });

    expect(fake.calls[0].method).toBe("editOrder");
    expect(result.orderId).toBe("hl-1");
  });
});
