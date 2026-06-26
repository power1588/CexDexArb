import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManualClock, createRuntime } from "../../src/executor/adapters/runtime.js";
import { loadExecutionConfig } from "../../src/executor/core/config.js";
import { createOpportunitySignal } from "../../src/executor/domain/models.js";
import { SqliteAdapter } from "../../src/executor/persistence/sqliteAdapter.js";
import { runMigrations } from "../../src/executor/persistence/schema.js";
import { createRepositories } from "../../src/executor/persistence/repositories.js";
import { createArbitrageCycleOrchestrator } from "../../src/executor/orchestrators/arbitrageCycleOrchestrator.js";
import { createOrderRouter } from "../../src/executor/services/orderRouter.js";
import { createMockExchangeAdapter } from "../../src/executor/adapters/exchangeAdapter.js";

function uniqueDbPath() {
  return join(tmpdir(), `executor-full-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("ArbitrageCycleOrchestrator (C4-01)", () => {
  let adapter;
  let repos;

  beforeEach(() => {
    adapter = new SqliteAdapter({ dbPath: uniqueDbPath() });
    runMigrations(adapter);
    repos = createRepositories(adapter);
  });

  afterEach(() => {
    const path = adapter?.getDbPath?.();
    adapter?.close?.();
    if (path) {
      try {
        rmSync(path, { force: true });
        rmSync(`${path}-wal`, { force: true });
        rmSync(`${path}-shm`, { force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("从信号接收到平仓归档可全自动闭环", async () => {
    const clock = new ManualClock(1_700_000_000_000);
    const runtime = createRuntime({ clock });
    const config = loadExecutionConfig({ environment: "simulation" });

    // 建仓与平仓都成交
    const binance = createMockExchangeAdapter({
      name: "binance",
      handlers: {
        async placeOrder(request) {
          return {
            orderId: `bin-${clock.now()}`,
            status: "filled",
            price: request.price,
            quantity: request.quantity,
            filledQuantity: request.quantity,
          };
        },
      },
    });
    const hyperliquid = createMockExchangeAdapter({
      name: "hyperliquid",
      handlers: {
        async placeOrder(request) {
          return {
            orderId: `hl-${clock.now()}`,
            status: "filled",
            price: request.price,
            quantity: request.quantity,
            filledQuantity: request.quantity,
          };
        },
      },
    });
    const orderRouter = createOrderRouter({ adapters: { binance, hyperliquid } });

    // 模拟价差序列：建仓后逐步收窄到平仓阈值
    const sequence = [
      { buyAsk: 100, sellBid: 101 },
      { buyAsk: 100, sellBid: 100.02 }, // 收窄到 ~2 bps
    ];

    const orchestrator = createArbitrageCycleOrchestrator({
      config,
      runtime,
      orderRouter,
      repositories: repos,
      pollIntervalMs: 100,
      maxHoldingDurationMs: 60_000,
      getMarketSnapshot: async () => {
        clock.advance(100);
        const next = sequence.shift();
        if (!next) return null;
        return {
          buyBook: { exchange: "binance", bestAsk: { price: next.buyAsk }, quoteCurrency: "USDT" },
          sellBook: { exchange: "hyperliquid", bestBid: { price: next.sellBid }, quoteCurrency: "USDC" },
          fxUsdcUsdtMid: 1.0,
        };
      },
    });

    const signal = createOpportunitySignal({
      signalId: "sig-full-1",
      symbol: "BTC",
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      observedSpreadBps: 20,
      observedAt: clock.now(),
      publishedAt: clock.now(),
    });

    const plan = {
      planId: "plan-full-1",
      signalId: signal.signalId,
      symbol: "BTC",
      mode: "maker_taker",
      targetNotionalUsdt: 1000,
      expectedNetEdgeBps: 12,
      riskBudget: { maxUnhedgedMs: 2500, maxSlippageBps: 6 },
      legs: [
        { exchange: "binance", side: "buy", symbol: "BTC", quoteCurrency: "USDT", orderType: "limit", price: 100, quantity: 10 },
        { exchange: "hyperliquid", side: "sell", symbol: "BTC", quoteCurrency: "USDC", orderType: "ioc", price: 102, quantity: 10 },
      ],
      parameterSnapshot: { fxUsdcUsdtMid: 1.0 },
    };

    const result = await orchestrator.runFullCycle({ cycleId: "cycle-full-1", signal, plan });

    expect(result.success).toBe(true);
    expect(result.stages).toEqual(["OPENING", "HEDGED", "MONITORING", "CLOSING", "CLOSED"]);

    const stored = repos.aggregateByCycleId("cycle-full-1");
    expect(stored.cycle.status).toBe("CLOSED");
    expect(stored.cycle.ended_at).not.toBeNull();
    expect(stored.orders.length).toBe(4); // 2 open + 2 close
    expect(stored.spreadLock).not.toBeNull();
    expect(stored.closeResult).not.toBeNull();
    expect(stored.closeResult.net_profit_usdt).toBeGreaterThan(0);
  });

  it("异常中断时正确归档为失败周期", async () => {
    const clock = new ManualClock(1_700_000_000_000);
    const runtime = createRuntime({ clock });
    const config = loadExecutionConfig({ environment: "simulation" });

    // hyperliquid 永远不成交 -> 对齐失败
    const binance = createMockExchangeAdapter({
      name: "binance",
      handlers: {
        async placeOrder(request) {
          return {
            orderId: `bin-${clock.now()}`,
            status: "filled",
            price: request.price,
            quantity: request.quantity,
            filledQuantity: request.quantity,
          };
        },
      },
    });
    const hyperliquid = createMockExchangeAdapter({
      name: "hyperliquid",
      handlers: {
        async placeOrder(request) {
          return {
            orderId: `hl-${clock.now()}`,
            status: "new",
            price: request.price,
            quantity: request.quantity,
            filledQuantity: 0,
          };
        },
      },
    });
    const orderRouter = createOrderRouter({ adapters: { binance, hyperliquid } });

    const orchestrator = createArbitrageCycleOrchestrator({
      config,
      runtime,
      orderRouter,
      repositories: repos,
      getMarketSnapshot: async () => null,
    });

    const signal = createOpportunitySignal({
      signalId: "sig-full-fail",
      symbol: "BTC",
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      observedSpreadBps: 20,
      observedAt: clock.now(),
      publishedAt: clock.now(),
    });

    const plan = {
      planId: "plan-full-fail",
      signalId: signal.signalId,
      symbol: "BTC",
      mode: "maker_taker",
      targetNotionalUsdt: 1000,
      expectedNetEdgeBps: 12,
      riskBudget: { maxUnhedgedMs: 2500, maxSlippageBps: 6 },
      legs: [
        { exchange: "binance", side: "buy", symbol: "BTC", orderType: "limit", price: 100, quantity: 10 },
        { exchange: "hyperliquid", side: "sell", symbol: "BTC", orderType: "ioc", price: 102, quantity: 10 },
      ],
      parameterSnapshot: { fxUsdcUsdtMid: 1.0 },
    };

    const result = await orchestrator.runFullCycle({ cycleId: "cycle-full-fail", signal, plan });

    expect(result.success).toBe(false);
    const stored = repos.aggregateByCycleId("cycle-full-fail");
    expect(stored.cycle.status).toBe("FAILED");
    expect(stored.riskEvents.length).toBeGreaterThan(0);
  });
});
