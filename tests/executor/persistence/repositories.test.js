import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteAdapter } from "../../../src/executor/persistence/sqliteAdapter.js";
import { runMigrations } from "../../../src/executor/persistence/schema.js";
import { createRepositories } from "../../../src/executor/persistence/repositories.js";

function uniqueDbPath() {
  return join(tmpdir(), `executor-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("repositories", () => {
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

  it("CycleRepository 可写入并读取一条 cycle", () => {
    const cycle = {
      cycleId: "cycle-1",
      signalId: "sig-1",
      symbol: "BTC",
      mode: "maker_taker",
      direction: "buy_binance_sell_hyperliquid",
      status: "OPENING",
      startedAt: 1_700_000_000_000,
      endedAt: null,
      metadata: { foo: "bar" },
    };

    repos.cycles.insert(cycle);
    const fetched = repos.cycles.findById("cycle-1");

    expect(fetched).toMatchObject({
      cycle_id: "cycle-1",
      signal_id: "sig-1",
      symbol: "BTC",
      status: "OPENING",
    });
    expect(JSON.parse(fetched.metadata_json)).toEqual({ foo: "bar" });
    expect(fetched.ended_at).toBeNull();
  });

  it("CycleRepository 可更新状态与结束时间", () => {
    repos.cycles.insert({
      cycleId: "cycle-2",
      signalId: "sig-2",
      symbol: "BTC",
      mode: "maker_taker",
      direction: "x",
      status: "OPENING",
      startedAt: 1,
    });
    repos.cycles.updateStatus("cycle-2", "CLOSED", 12345);
    const fetched = repos.cycles.findById("cycle-2");
    expect(fetched.status).toBe("CLOSED");
    expect(fetched.ended_at).toBe(12345);
  });

  it("OrderRepository 可批量写入并按 cycle_id 查询", () => {
    repos.cycles.insert({
      cycleId: "c-3",
      signalId: "s-3",
      symbol: "ETH",
      mode: "maker_taker",
      direction: "x",
      status: "OPENING",
      startedAt: 1,
    });

    repos.orders.insertMany([
      {
        orderId: "o-1",
        cycleId: "c-3",
        exchange: "binance",
        leg: "maker_open",
        side: "buy",
        symbol: "ETH",
        price: 3000,
        quantity: 1,
        filledQuantity: 1,
        status: "filled",
        rawPayload: { a: 1 },
        createdAt: 10,
      },
      {
        orderId: "o-2",
        cycleId: "c-3",
        exchange: "hyperliquid",
        leg: "taker_open",
        side: "sell",
        symbol: "ETH",
        price: 3005,
        quantity: 1,
        filledQuantity: 1,
        status: "filled",
        rawPayload: null,
        createdAt: 11,
      },
    ]);

    const orders = repos.orders.findByCycleId("c-3");
    expect(orders.length).toBe(2);
    expect(orders.map((o) => o.order_id)).toEqual(["o-1", "o-2"]);
    expect(JSON.parse(orders[0].raw_payload_json)).toEqual({ a: 1 });
  });

  it("FillRepository 可写入并按 order_id 查询", () => {
    repos.cycles.insert({
      cycleId: "c-9",
      signalId: "s-9",
      symbol: "BTC",
      mode: "m",
      direction: "x",
      status: "OPENING",
      startedAt: 1,
    });
    repos.orders.insert({
      orderId: "o-9",
      cycleId: "c-9",
      exchange: "binance",
      leg: "maker_open",
      side: "buy",
      symbol: "BTC",
      price: 100,
      quantity: 1,
      filledQuantity: 1,
      status: "filled",
      rawPayload: null,
      createdAt: 1,
    });

    repos.fills.insert({
      fillId: "f-1",
      orderId: "o-9",
      cycleId: "c-9",
      exchange: "binance",
      symbol: "BTC",
      side: "buy",
      price: 100,
      quantity: 0.5,
      feeUsdt: 0.05,
      timestamp: 100,
    });

    const fills = repos.fills.findByOrderId("o-9");
    expect(fills.length).toBe(1);
    expect(fills[0].fee_usdt).toBe(0.05);
  });

  it("按 cycle_id 聚合查询可串联所有链路", () => {
    repos.cycles.insert({
      cycleId: "c-100",
      signalId: "s-100",
      symbol: "BTC",
      mode: "maker_taker",
      direction: "x",
      status: "OPENING",
      startedAt: 1,
    });
    repos.orders.insertMany([
      {
        orderId: "o-a",
        cycleId: "c-100",
        exchange: "binance",
        leg: "maker_open",
        side: "buy",
        symbol: "BTC",
        price: 100,
        quantity: 1,
        filledQuantity: 1,
        status: "filled",
        rawPayload: null,
        createdAt: 10,
      },
    ]);
    repos.fills.insert({
      fillId: "f-a",
      orderId: "o-a",
      cycleId: "c-100",
      exchange: "binance",
      symbol: "BTC",
      side: "buy",
      price: 100,
      quantity: 1,
      feeUsdt: 0.1,
      timestamp: 100,
    });
    repos.positions.insert({
      positionId: "p-1",
      cycleId: "c-100",
      symbol: "BTC",
      legs: [{ exchange: "binance" }],
      entryNotionalUsdt: 100,
      markNotionalUsdt: 101,
      unrealizedPnlUsdt: 1,
      timestamp: 200,
    });
    repos.spreadLocks.insert({
      lockId: "sl-1",
      cycleId: "c-100",
      symbol: "BTC",
      grossSpreadUsdt: 5,
      feeCostUsdt: 1,
      netSpreadUsdt: 4,
      netSpreadBps: 40,
      fxDetail: { fx: 1 },
      lockedAt: 150,
    });
    repos.closeResults.insert({
      closeId: "cr-1",
      cycleId: "c-100",
      symbol: "BTC",
      expectedSpreadUsdt: 4,
      actualSpreadUsdt: 3.5,
      makerSlippageUsdt: 0.2,
      takerSlippageUsdt: 0.3,
      netProfitUsdt: 3,
      closedAt: 500,
      metadata: { ok: true },
    });
    repos.riskEvents.insert({
      riskEventId: "re-1",
      cycleId: "c-100",
      type: "test",
      severity: "low",
      symbol: "BTC",
      planId: "p-1",
      message: "hi",
      context: { k: "v" },
      timestamp: 250,
    });

    const full = repos.aggregateByCycleId("c-100");
    expect(full.cycle.cycle_id).toBe("c-100");
    expect(full.orders.length).toBe(1);
    expect(full.fills.length).toBe(1);
    expect(full.positions.length).toBe(1);
    expect(full.spreadLock.cycle_id).toBe("c-100");
    expect(full.closeResult.net_profit_usdt).toBe(3);
    expect(full.riskEvents.length).toBe(1);
  });
});
