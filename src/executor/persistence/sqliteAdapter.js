import { ExecutorError } from "../core/errors.js";
import { loadBetterSqlite3 } from "./_betterSqliteLoader.js";

const DEFAULT_DB_PATH = "./data/executor.db";

export class SqliteAdapterError extends ExecutorError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "SqliteAdapterError";
  }
}

/**
 * SQLite 适配器，封装 better-sqlite3。
 *
 * - 启用 WAL 模式提升并发读写性能。
 * - 预处理语句按 SQL 文本缓存，避免重复编译。
 * - 通过统一异常 SqliteAdapterError 暴露错误。
 */
export class SqliteAdapter {
  #database = null;
  #statementCache = new Map();
  #dbPath;
  #walMode = "default";

  constructor({ dbPath = DEFAULT_DB_PATH, options = {}, enableWal = true } = {}) {
    this.#dbPath = dbPath;

    let Database;
    try {
      Database = loadBetterSqlite3();
    } catch (loadError) {
      throw new SqliteAdapterError("无法加载 better-sqlite3 依赖", {
        error: loadError.message,
      });
    }

    try {
      this.#database = new Database(dbPath, {
        readonly: false,
        fileMustExist: false,
        ...options,
      });
    } catch (openError) {
      throw new SqliteAdapterError("SQLite 数据库打开失败", {
        dbPath,
        error: openError.message,
      });
    }

    if (enableWal) {
      this.#walMode = this.#applyJournalMode();
    }
  }

  #applyJournalMode() {
    try {
      const result = this.#database.pragma("journal_mode = WAL");
      return String(result?.[0]?.journal_mode ?? "").toLowerCase();
    } catch {
      // 在部分文件系统（如 iCloud 同步盘）上 WAL 可能不可用，回退到 MEMORY
      try {
        this.#database.pragma("journal_mode = MEMORY");
        return "memory";
      } catch {
        return "default";
      }
    }
  }

  getWalMode() {
    return this.#walMode;
  }

  getDbPath() {
    return this.#dbPath;
  }

  isOpen() {
    return this.#database !== null;
  }

  exec({ sql } = {}) {
    if (!this.#database) {
      throw new SqliteAdapterError("数据库未打开");
    }
    this.#database.exec(sql);
  }

  prepare({ sql } = {}) {
    if (!this.#database) {
      throw new SqliteAdapterError("数据库未打开");
    }

    let stmt = this.#statementCache.get(sql);
    if (!stmt) {
      stmt = this.#database.prepare(sql);
      this.#statementCache.set(sql, stmt);
    }
    return stmt;
  }

  pragma(pragma) {
    if (!this.#database) {
      throw new SqliteAdapterError("数据库未打开");
    }
    return this.#database.pragma(pragma);
  }

  transaction(fn) {
    if (!this.#database) {
      throw new SqliteAdapterError("数据库未打开");
    }
    return this.#database.transaction(fn);
  }

  close() {
    if (!this.#database) {
      return;
    }

    try {
      this.#database.close();
    } finally {
      this.#database = null;
      this.#statementCache.clear();
    }
  }
}
