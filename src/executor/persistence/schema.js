/**
 * SQLite Schema 与 Migration 定义。
 *
 * 设计原则：
 * - 每条 migration 有唯一 version 与幂等 SQL（CREATE TABLE IF NOT EXISTS 等）。
 * - 使用 schema_migrations 表记录已执行的版本，支持多次执行 runMigrations 而不重复。
 * - cycle_id 是所有业务表的主线外键，orders.leg 标识建仓/平仓腿。
 */

export const CYCLE_STATUSES = Object.freeze({
  OPENING: "OPENING",
  HEDGED: "HEDGED",
  MONITORING: "MONITORING",
  CLOSING: "CLOSING",
  CLOSED: "CLOSED",
  FAILED: "FAILED",
});

export const ORDER_LEGS = Object.freeze({
  MAKER_OPEN: "maker_open",
  TAKER_OPEN: "taker_open",
  MAKER_CLOSE: "maker_close",
  TAKER_CLOSE: "taker_close",
});

export const SCHEMA_MIGRATIONS = Object.freeze([
  {
    version: 1,
    description: "initial schema: cycles, orders, fills, positions, spread_locks, close_results, risk_events",
    up: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT,
        applied_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS cycles (
        cycle_id TEXT PRIMARY KEY,
        signal_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        mode TEXT NOT NULL,
        direction TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        metadata_json TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_cycles_symbol ON cycles(symbol)`,
      `CREATE INDEX IF NOT EXISTS idx_cycles_status ON cycles(status)`,
      `CREATE INDEX IF NOT EXISTS idx_cycles_started_at ON cycles(started_at)`,
    ],
  },
  {
    version: 2,
    description: "orders table",
    up: [
      `CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL,
        exchange TEXT NOT NULL,
        leg TEXT NOT NULL,
        side TEXT NOT NULL,
        symbol TEXT NOT NULL,
        price REAL NOT NULL,
        quantity REAL NOT NULL,
        filled_quantity REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        raw_payload_json TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (cycle_id) REFERENCES cycles(cycle_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_orders_cycle_id ON orders(cycle_id)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
    ],
  },
  {
    version: 3,
    description: "fills table",
    up: [
      `CREATE TABLE IF NOT EXISTS fills (
        fill_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        cycle_id TEXT NOT NULL,
        exchange TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        price REAL NOT NULL,
        quantity REAL NOT NULL,
        fee_usdt REAL NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(order_id),
        FOREIGN KEY (cycle_id) REFERENCES cycles(cycle_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_fills_order_id ON fills(order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_fills_cycle_id ON fills(cycle_id)`,
    ],
  },
  {
    version: 4,
    description: "positions table",
    up: [
      `CREATE TABLE IF NOT EXISTS positions (
        position_id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        legs_json TEXT NOT NULL,
        entry_notional_usdt REAL NOT NULL,
        mark_notional_usdt REAL NOT NULL,
        unrealized_pnl_usdt REAL NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (cycle_id) REFERENCES cycles(cycle_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_positions_cycle_id ON positions(cycle_id)`,
    ],
  },
  {
    version: 5,
    description: "spread_locks table",
    up: [
      `CREATE TABLE IF NOT EXISTS spread_locks (
        lock_id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL UNIQUE,
        symbol TEXT NOT NULL,
        gross_spread_usdt REAL NOT NULL,
        fee_cost_usdt REAL NOT NULL DEFAULT 0,
        net_spread_usdt REAL NOT NULL,
        net_spread_bps REAL NOT NULL,
        fx_detail_json TEXT,
        locked_at INTEGER NOT NULL,
        FOREIGN KEY (cycle_id) REFERENCES cycles(cycle_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_spread_locks_cycle_id ON spread_locks(cycle_id)`,
    ],
  },
  {
    version: 6,
    description: "close_results table",
    up: [
      `CREATE TABLE IF NOT EXISTS close_results (
        close_id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL UNIQUE,
        symbol TEXT NOT NULL,
        expected_spread_usdt REAL NOT NULL,
        actual_spread_usdt REAL NOT NULL,
        maker_slippage_usdt REAL NOT NULL DEFAULT 0,
        taker_slippage_usdt REAL NOT NULL DEFAULT 0,
        net_profit_usdt REAL NOT NULL,
        closed_at INTEGER NOT NULL,
        metadata_json TEXT,
        FOREIGN KEY (cycle_id) REFERENCES cycles(cycle_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_close_results_cycle_id ON close_results(cycle_id)`,
    ],
  },
  {
    version: 7,
    description: "risk_events table",
    up: [
      `CREATE TABLE IF NOT EXISTS risk_events (
        risk_event_id TEXT PRIMARY KEY,
        cycle_id TEXT,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        symbol TEXT,
        plan_id TEXT,
        message TEXT NOT NULL,
        context_json TEXT,
        timestamp INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_risk_events_cycle_id ON risk_events(cycle_id)`,
      `CREATE INDEX IF NOT EXISTS idx_risk_events_severity ON risk_events(severity)`,
    ],
  },
]);

export function runMigrations(adapter) {
  if (!adapter || typeof adapter.exec !== "function" || typeof adapter.prepare !== "function") {
    throw new Error("runMigrations 需要合法的 SqliteAdapter");
  }

  // 确保 schema_migrations 表存在
  adapter.exec({
    sql: `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT,
      applied_at INTEGER NOT NULL
    )`,
  });

  const appliedVersions = new Set(
    adapter
      .prepare({ sql: "SELECT version FROM schema_migrations" })
      .all()
      .map((row) => Number(row.version)),
  );

  const insertMigration = adapter.prepare({
    sql: "INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)",
  });

  const now = Date.now();

  for (const migration of SCHEMA_MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    adapter.transaction(() => {
      for (const statement of migration.up) {
        adapter.exec({ sql: statement });
      }
      insertMigration.run(migration.version, migration.description, now);
    })();
  }
}
