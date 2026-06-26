import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteAdapter } from "../../src/executor/persistence/sqliteAdapter.js";
import { runMigrations } from "../../src/executor/persistence/schema.js";
import { createRepositories } from "../../src/executor/persistence/repositories.js";
import { createReplayQueryService } from "../../src/executor/services/replayQueryService.js";

function uniqueDbPath() {
  return join(tmpdir(), `executor-replay-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("ReplayQueryService", () => {
  let adapter;
  let service;

  beforeEach(() => {
    adapter = new SqliteAdapter({ dbPath: uniqueDbPath() });
    runMigrations(adapter);
    const repos = createRepositories(adapter);
    service = createReplayQueryService(repos);

    // 预置数据：2 个 cycle，1 个盈利、1 个亏损
    repos.cycles.insert({
      cycleId: "c-win",
      signalId: "s-1",
      symbol: "BTC",
      mode: "maker_taker",
      direction: "x",
      status: "CLOSED",
      startedAt: 1000,
      endedAt: 2000,
    });
    repos.cycles.insert({
      cycleId: "c-loss",
      signalId: "s-2",
      symbol: "ETH",
      mode: "maker_taker",
      direction: "x",
      status: "CLOSED",
      startedAt: 3000,
      endedAt: 4000,
    });
    repos.closeResults.insert({
      closeId: "cr-win",
      cycleId: "c-win",
      symbol: "BTC",
      expectedSpreadUsdt: 2,
      actualSpreadUsdt: 1.5,
      netProfitUsdt: 1.5,
      closedAt: 2000,
    });
    repos.closeResults.insert({
      closeId: "cr-loss",
      cycleId: "c-loss",
      symbol: "ETH",
      expectedSpreadUsdt: 2,
      actualSpreadUsdt: -1,
      netProfitUsdt: -0.5,
      closedAt: 4000,
    });
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

  it("可按时间范围查询 cycle 列表", () => {
    const cycles = service.findCyclesByTimeRange(0, 2500);
    expect(cycles.map((c) => c.cycle_id)).toEqual(["c-win"]);
  });

  it("可按 cycle_id 查询完整链路", () => {
    const full = service.getCycleDetail("c-win");
    expect(full.cycle.cycle_id).toBe("c-win");
    expect(full.closeResult.net_profit_usdt).toBe(1.5);
  });

  it("可统计指定周期的总收益、胜率、平均偏差", () => {
    const stats = service.getStatistics(0, 10_000);
    expect(stats.cycleCount).toBe(2);
    expect(stats.totalProfitUsdt).toBeCloseTo(1.0, 6); // 1.5 + (-0.5)
    expect(stats.winCount).toBe(1);
    expect(stats.winRate).toBeCloseTo(0.5, 6);
    expect(stats.averageProfitUsdt).toBeCloseTo(0.5, 6);
  });

  it("空数据集时统计返回零值", () => {
    const stats = service.getStatistics(100_000, 200_000);
    expect(stats.cycleCount).toBe(0);
    expect(stats.totalProfitUsdt).toBe(0);
    expect(stats.winRate).toBe(0);
  });
});
