import { describe, expect, it } from "vitest";
import { generateReplayReport } from "../../src/executor/services/replayReportGenerator.js";

describe("ReplayReportGenerator", () => {
  it("可生成 JSON 格式的 cycle 明细", () => {
    const report = generateReplayReport({
      window: { from: 0, to: 10_000 },
      cycles: [
        {
          cycle: { cycle_id: "c-1", symbol: "BTC", status: "CLOSED", started_at: 1000, ended_at: 2000 },
          closeResult: { net_profit_usdt: 1.5, actual_spread_usdt: 1.0 },
        },
      ],
      statistics: {
        cycleCount: 1,
        closedCycleCount: 1,
        totalProfitUsdt: 1.5,
        winRate: 1,
      },
    });

    expect(report.window).toEqual({ from: 0, to: 10_000 });
    expect(report.cycles.length).toBe(1);
    expect(report.cycles[0].cycle.cycle_id).toBe("c-1");

    const json = report.toJson();
    const parsed = JSON.parse(json);
    expect(parsed.summary.totalProfitUsdt).toBe(1.5);
    expect(parsed.cycles[0].cycle.cycle_id).toBe("c-1");
  });

  it("可生成汇总统计（总收益、胜率、平均滑点）", () => {
    const report = generateReplayReport({
      window: { from: 0, to: 10_000 },
      cycles: [],
      statistics: {
        cycleCount: 4,
        closedCycleCount: 4,
        totalProfitUsdt: 10,
        averageProfitUsdt: 2.5,
        winCount: 3,
        winRate: 0.75,
        averageDeviationUsdt: 0.3,
        averageLockedSpreadBps: 18,
      },
    });

    expect(report.summary.cycleCount).toBe(4);
    expect(report.summary.totalProfitUsdt).toBe(10);
    expect(report.summary.winRate).toBe(0.75);
    expect(report.summary.averageDeviationUsdt).toBe(0.3);
  });

  it("预留 HTML 扩展（默认返回占位）", () => {
    const report = generateReplayReport({
      window: { from: 0, to: 10_000 },
      cycles: [],
      statistics: { cycleCount: 0, closedCycleCount: 0, totalProfitUsdt: 0, winRate: 0 },
    });

    expect(report.toHtml()).toContain("<html");
  });
});
