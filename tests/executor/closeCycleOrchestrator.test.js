import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManualClock, createRuntime } from "../../src/executor/adapters/runtime.js";
import { loadExecutionConfig } from "../../src/executor/core/config.js";
import { SqliteAdapter } from "../../src/executor/persistence/sqliteAdapter.js";
import { runMigrations } from "../../src/executor/persistence/schema.js";
import { createRepositories } from "../../src/executor/persistence/repositories.js";
import { createCloseCycleOrchestrator } from "../../src/executor/orchestrators/closeCycleOrchestrator.js";
import { createOrderRouter } from "../../src/executor/services/orderRouter.js";
import { createMockExchangeAdapter } from "../../src/executor/adapters/exchangeAdapter.js";

function uniqueDbPath() {
  return join(tmpdir(), `executor-close-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("CloseCycleOrchestrator (C3-04)", () => {
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

  it("可完成 平仓信号 -> maker-taker 平仓 -> 成交对比 -> 落库", async () => {
    const clock = new ManualClock(1_700_000_001_000);
    const runtime = createRuntime({ clock });
    const config = loadExecutionConfig({ environment: "simulation" });

    const binance = createMockExchangeAdapter({
      name: "binance",
      handlers: {
        async placeOrder(request) {
          return {
            orderId: `bin-close-${Date.now()}`,
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
            orderId: `hl-close-${Date.now()}`,
            status: "filled",
            price: request.price,
            quantity: request.quantity,
            filledQuantity: request.quantity,
          };
        },
      },
    });
    const orderRouter = createOrderRouter({ adapters: { binance, hyperliquid } });

    const orchestrator = createCloseCycleOrchestrator({
      config,
      runtime,
      orderRouter,
      repositories: repos,
    });

    // 预置一个已建仓的 cycle
    repos.cycles.insert({
      cycleId: "cycle-close-1",
      signalId: "sig-close-1",
      symbol: "BTC",
      mode: "maker_taker",
      direction: "buy_binance_sell_hyperliquid",
      status: "MONITORING",
      startedAt: clock.now() - 60_000,
    });
    repos.spreadLocks.insert({
      lockId: "sl-close-1",
      cycleId: "cycle-close-1",
      symbol: "BTC",
      grossSpreadUsdt: 20,
      feeCostUsdt: 1,
      netSpreadUsdt: 19,
      netSpreadBps: 190,
      fxDetail: { fxUsdcUsdtMid: 1.0 },
      lockedAt: clock.now() - 60_000,
    });

    const result = await orchestrator.runCloseCycle({
      cycleId: "cycle-close-1",
      closeSignal: {
        openDirection: "buy_binance_sell_hyperliquid",
        legs: [
          { exchange: "binance", side: "sell", symbol: "BTC", quantity: 10, price: 101, role: "maker", legType: "maker_close", quoteCurrency: "USDT" },
          { exchange: "hyperliquid", side: "buy", symbol: "BTC", quantity: 10, price: 100, role: "taker", legType: "taker_close", quoteCurrency: "USDC" },
        ],
        expectedSpreadUsdt: 1.0,
        expectedSpreadBps: 10,
        fxUsdcUsdtMid: 1.0,
      },
      positionSnapshot: {
        symbol: "BTC",
        legs: [
          { exchange: "binance", side: "long", quantity: 10, markPrice: 101, notionalUsdt: 1010 },
          { exchange: "hyperliquid", side: "short", quantity: 10, markPrice: 100, notionalUsdt: 1000 },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.comparison.actualSpreadUsdt).toBeCloseTo(-1 * 10, 6); // taker100 - maker101 = -1, * 10
    expect(result.comparison.netProfitUsdt).toBeGreaterThan(0);

    const stored = repos.aggregateByCycleId("cycle-close-1");
    expect(stored.cycle.status).toBe("CLOSED");
    expect(stored.closeResult).not.toBeNull();
    expect(stored.closeResult.net_profit_usdt).toBeCloseTo(result.comparison.netProfitUsdt, 6);
    expect(stored.orders.filter((o) => o.leg.includes("close")).length).toBe(2);
  });
});
