import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteAdapter } from "../../../src/executor/persistence/sqliteAdapter.js";
import { SCHEMA_MIGRATIONS, runMigrations } from "../../../src/executor/persistence/schema.js";

function uniqueDbPath() {
  return join(tmpdir(), `executor-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("schema migration", () => {
  let adapter;

  beforeEach(() => {
    adapter = new SqliteAdapter({ dbPath: uniqueDbPath() });
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

  it("migration 可幂等执行多次且不报错", () => {
    runMigrations(adapter);
    runMigrations(adapter);
    runMigrations(adapter);

    const tables = adapter
      .prepare({
        sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      })
      .all()
      .map((row) => row.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "cycles",
        "orders",
        "fills",
        "positions",
        "spread_locks",
        "close_results",
        "risk_events",
        "schema_migrations",
      ]),
    );
  });

  it("cycles 表包含所有必要字段", () => {
    runMigrations(adapter);

    const cols = adapter
      .prepare({ sql: "PRAGMA table_info(cycles)" })
      .all()
      .map((row) => row.name);

    expect(cols).toEqual(
      expect.arrayContaining([
        "cycle_id",
        "signal_id",
        "symbol",
        "mode",
        "direction",
        "status",
        "started_at",
        "ended_at",
        "metadata_json",
      ]),
    );
  });

  it("orders 表包含 leg 与 status 字段", () => {
    runMigrations(adapter);

    const cols = adapter
      .prepare({ sql: "PRAGMA table_info(orders)" })
      .all()
      .map((row) => row.name);

    expect(cols).toEqual(
      expect.arrayContaining([
        "order_id",
        "cycle_id",
        "exchange",
        "leg",
        "side",
        "price",
        "quantity",
        "status",
        "raw_payload_json",
        "created_at",
      ]),
    );
  });

  it("索引被正确创建", () => {
    runMigrations(adapter);

    const indexes = adapter
      .prepare({
        sql: "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'",
      })
      .all()
      .map((row) => row.name);

    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_orders_cycle_id",
        "idx_fills_order_id",
        "idx_positions_cycle_id",
        "idx_risk_events_cycle_id",
      ]),
    );
  });

  it("SCHEMA_MIGRATIONS 记录每步迁移", () => {
    runMigrations(adapter);
    const rows = adapter
      .prepare({ sql: "SELECT version FROM schema_migrations ORDER BY version" })
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(SCHEMA_MIGRATIONS.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBe(SCHEMA_MIGRATIONS.length);
  });
});
