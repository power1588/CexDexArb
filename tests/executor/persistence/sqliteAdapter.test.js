import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteAdapter, SqliteAdapterError } from "../../../src/executor/persistence/sqliteAdapter.js";

function uniqueDbPath() {
  return join(tmpdir(), `executor-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("SqliteAdapter", () => {
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

  it("可以正常打开和关闭数据库", () => {
    expect(adapter.isOpen()).toBe(true);
    adapter.close();
    expect(adapter.isOpen()).toBe(false);
  });

  it("启用 WAL 模式", () => {
    const result = adapter.pragma("journal_mode");
    expect(result[0]?.journal_mode?.toLowerCase()).toBe("wal");
  });

  it("预处理语句会被缓存并可重复执行", () => {
    adapter.exec({
      sql: "CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT)",
    });

    const stmt = adapter.prepare({
      sql: "INSERT INTO demo (value) VALUES (?)",
    });
    stmt.run("hello");
    stmt.run("world");

    const rows = adapter.prepare({
      sql: "SELECT value FROM demo ORDER BY id",
    }).all();

    expect(rows).toEqual([{ value: "hello" }, { value: "world" }]);
  });

  it("连接失败时抛出统一异常 SqliteAdapterError", () => {
    expect(() => new SqliteAdapter({ dbPath: "/nonexistent-dir/forbidden/path/db.sqlite" })).toThrow(
      SqliteAdapterError,
    );
  });

  it("支持事务包裹批量写入", () => {
    adapter.exec({
      sql: "CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT)",
    });

    const insert = adapter.prepare({
      sql: "INSERT INTO demo (value) VALUES (?)",
    });

    adapter.transaction(() => {
      insert.run("a");
      insert.run("b");
    })();

    const rows = adapter.prepare({ sql: "SELECT value FROM demo ORDER BY id" }).all();
    expect(rows).toEqual([{ value: "a" }, { value: "b" }]);
  });

  it("使用内存模式时无需文件路径", () => {
    const memAdapter = new SqliteAdapter({ dbPath: ":memory:" });
    expect(memAdapter.isOpen()).toBe(true);
    memAdapter.exec({ sql: "CREATE TABLE m (x INTEGER)" });
    memAdapter.close();
  });
});
