import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function loadBetterSqlite3() {
  try {
    return require("better-sqlite3");
  } catch (error) {
    throw new Error(`无法加载 better-sqlite3 依赖: ${error.message}`);
  }
}
