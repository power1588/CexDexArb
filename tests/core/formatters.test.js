import {
  formatBps,
  formatLag,
  formatPercent,
  formatPriceUsd,
  formatRelativeTime,
  formatStatus,
  formatTimeframe,
  formatUsd,
} from "../../src/core/formatters.js";

describe("formatters", () => {
  it("格式化百分比并保留正负号", () => {
    expect(formatPercent(0.00023, 3)).toBe("+0.023%");
    expect(formatPercent(-0.0002, 2)).toBe("-0.02%");
  });

  it("格式化美元数值", () => {
    expect(formatUsd(12500)).toContain("US$12,500");
    expect(formatUsd(-18.6)).toContain("-US$18.6");
  });

  it("按价格区间格式化价格精度", () => {
    expect(formatPriceUsd(0.1234567)).toContain("US$0.123457");
    expect(formatPriceUsd(12.345678)).toContain("US$12.3457");
    expect(formatPriceUsd(123.4567)).toContain("US$123.46");
  });

  it("格式化 bps 与延迟", () => {
    expect(formatBps(8)).toBe("+8.0 bps");
    expect(formatLag(148)).toBe("148 ms");
  });

  it("格式化时间粒度、相对时间与状态", () => {
    expect(formatTimeframe("24h")).toBe("24H");
    expect(formatRelativeTime(2)).toBe("2 秒前");
    expect(formatRelativeTime(4200)).toContain("小时前");
    expect(formatStatus("healthy")).toBe("健康");
  });
});
