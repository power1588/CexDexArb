/**
 * 复盘查询命令行脚本。
 *
 * 用法：
 *   npm run executor:replay -- --from 2026-01-01 --to 2026-01-31
 *   npm run executor:replay -- --cycle-id cycle-xxx
 *   npm run executor:replay -- --format json
 *   npm run executor:replay -- --db ./data/executor.db
 */

import { parseArgs } from "node:util";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SqliteAdapter } from "../src/executor/persistence/sqliteAdapter.js";
import { runMigrations } from "../src/executor/persistence/schema.js";
import { createRepositories } from "../src/executor/persistence/repositories.js";
import { createReplayQueryService } from "../src/executor/services/replayQueryService.js";
import { generateReplayReport } from "../src/executor/services/replayReportGenerator.js";

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    to: { type: "string" },
    "cycle-id": { type: "string" },
    format: { type: "string", default: "json" },
    db: { type: "string", default: "./data/executor.db" },
  },
});

function dateArgToTimestamp(value, endOfDay = false) {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`无法解析日期参数: ${value}`);
  }
  if (endOfDay) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date.getTime();
}

function main() {
  const dbPath = values.db;
  const format = values.format ?? "json";

  // 确保数据库所在目录存在
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {
    /* 忽略目录创建失败（如内存库路径） */
  }

  const adapter = new SqliteAdapter({ dbPath });
  runMigrations(adapter);
  const repos = createRepositories(adapter);
  const service = createReplayQueryService(repos);

  try {
    if (values["cycle-id"]) {
      const detail = service.getCycleDetail(values["cycle-id"]);
      if (!detail) {
        console.error(`未找到 cycle: ${values["cycle-id"]}`);
        process.exitCode = 2;
        return;
      }
      process.stdout.write(`${JSON.stringify(detail, null, 2)}\n`);
      return;
    }

    const fromTs = dateArgToTimestamp(values.from, false) ?? 0;
    const toTs = dateArgToTimestamp(values.to, true) ?? Date.now();

    const cycles = service.findCyclesByTimeRange(fromTs, toTs);
    const statistics = service.getStatistics(fromTs, toTs);

    const report = generateReplayReport({
      window: { from: fromTs, to: toTs },
      cycles: cycles.map((c) => service.getCycleDetail(c.cycle_id)).filter(Boolean),
      statistics,
    });

    if (format === "html") {
      process.stdout.write(`${report.toHtml()}\n`);
    } else {
      process.stdout.write(`${report.toJson()}\n`);
    }
  } finally {
    adapter.close();
  }
}

main();
