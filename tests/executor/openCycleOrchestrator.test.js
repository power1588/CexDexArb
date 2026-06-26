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
import { createOpenCycleOrchestrator } from "../../src/executor/orchestrators/openCycleOrchestrator.js";
import { createOrderRouter } from "../../src/executor/services/orderRouter.js";
import { createMockExchangeAdapter } from "../../src/executor/adapters/exchangeAdapter.js";

function uniqueDbPath() {
  return join(tmpdir(), `executor-open-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function buildFilledMockAdapters() {
  const binance = createMockExchangeAdapter({
    name: "binance",
    handlers: {
      async placeOrder(request) {
        return {
          orderId: `bin-${Date.now()}`,
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
          orderId: `hl-${Date.now()}`,
          status: "filled",
          price: request.price,
          quantity: request.quantity,
          filledQuantity: request.quantity,
        };
      },
    },
  });
  return { binance, hyperliquid };
}

describe("OpenCycleOrchestrator (C1-05)", () => {
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

  it("可完成 maker-taker 建仓 -> 对齐 -> 锁定 -> 对比 -> 落库", async () => {
    const clock = new ManualClock(1_700_000_000_000);
    const runtime = createRuntime({ clock });
    const config = loadExecutionConfig({ environment: "simulation" });
    const { binance, hyperliquid } = buildFilledMockAdapters();
    const orderRouter = createOrderRouter({ adapters: { binance, hyperliquid } });

    const orchestrator = createOpenCycleOrchestrator({
      config,
      runtime,
      orderRouter,
      repositories: repos,
    });

    const signal = createOpportunitySignal({
      signalId: "sig-open-1",
      symbol: "BTC",
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      observedSpreadBps: 20,
      observedAt: clock.now(),
      publishedAt: clock.now(),
      strategyVersion: "test-v1",
    });

    const plan = {
      planId: "plan-open-1",
      signalId: signal.signalId,
      symbol: "BTC",
      mode: "maker_taker",
      targetNotionalUsdt: 1000,
      expectedNetEdgeBps: 12,
      riskBudget: { maxUnhedgedMs: 2500, maxSlippageBps: 6 },
      legs: [
        {
          exchange: "binance",
          side: "buy",
          symbol: "BTC",
          quoteCurrency: "USDT",
          orderType: "limit",
          price: 100,
          quantity: 10,
        },
        {
          exchange: "hyperliquid",
          side: "sell",
          symbol: "BTC",
          quoteCurrency: "USDC",
          orderType: "ioc",
          price: 102,
          quantity: 10,
        },
      ],
      parameterSnapshot: { fxUsdcUsdtMid: 1.0 },
    };

    const result = await orchestrator.runOpenCycle({ cycleId: "cycle-open-1", signal, plan });

    expect(result.success).toBe(true);
    expect(result.alignment.aligned).toBe(true);
    expect(result.lockedSpread.netSpreadUsdt).toBeGreaterThan(0);
    expect(result.comparison.signalSpreadBps).toBe(20);
    expect(result.cycleId).toBe("cycle-open-1");

    // SQLite 中应能查到完整链路
    const stored = repos.aggregateByCycleId("cycle-open-1");
    expect(stored).not.toBeNull();
    expect(stored.cycle.status).toBe("HEDGED");
    expect(stored.orders.length).toBe(2);
    expect(stored.fills.length).toBe(2);
    expect(stored.spreadLock).not.toBeNull();
    expect(stored.spreadLock.net_spread_bps).toBeCloseTo(result.lockedSpread.netSpreadBps, 6);
  });

  it("仓位未对齐时仍落库但状态为 FAILED", async () => {
    const clock = new ManualClock(1_700_000_000_000);
    const runtime = createRuntime({ clock });
    const config = loadExecutionConfig({ environment: "simulation" });

    const binance = createMockExchangeAdapter({
      name: "binance",
      handlers: {
        async placeOrder(request) {
          return {
            orderId: "b1",
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
          // 只成交一半，造成对齐失败
          return {
            orderId: "h1",
            status: "partial",
            price: request.price,
            quantity: request.quantity,
            filledQuantity: request.quantity * 0.5,
          };
        },
      },
    });
    const orderRouter = createOrderRouter({ adapters: { binance, hyperliquid } });

    const orchestrator = createOpenCycleOrchestrator({
      config,
      runtime,
      orderRouter,
      repositories: repos,
    });

    const signal = createOpportunitySignal({
      signalId: "sig-open-2",
      symbol: "BTC",
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      observedSpreadBps: 20,
      observedAt: clock.now(),
      publishedAt: clock.now(),
    });

    const plan = {
      planId: "plan-open-2",
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

    const result = await orchestrator.runOpenCycle({ cycleId: "cycle-open-2", signal, plan });

    expect(result.success).toBe(false);
    expect(result.alignment.aligned).toBe(false);
    const stored = repos.aggregateByCycleId("cycle-open-2");
    expect(stored.cycle.status).toBe("FAILED");
  });
});
