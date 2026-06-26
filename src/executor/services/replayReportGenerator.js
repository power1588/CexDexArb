/**
 * 复盘报表生成器。
 *
 * 把复盘查询结果导出为可读报表：JSON 明细 + 汇总统计。
 * 预留 HTML 扩展（当前输出基础占位结构）。
 */

export function generateReplayReport({ window, cycles = [], statistics = {} } = {}) {
  const summary = {
    window,
    cycleCount: statistics.cycleCount ?? 0,
    closedCycleCount: statistics.closedCycleCount ?? 0,
    totalProfitUsdt: statistics.totalProfitUsdt ?? 0,
    averageProfitUsdt: statistics.averageProfitUsdt ?? 0,
    winCount: statistics.winCount ?? 0,
    winRate: statistics.winRate ?? 0,
    averageDeviationUsdt: statistics.averageDeviationUsdt ?? 0,
    averageLockedSpreadBps: statistics.averageLockedSpreadBps ?? 0,
    generatedAt: new Date().toISOString(),
  };

  return {
    summary,
    cycles,
    window,
    toJson() {
      return JSON.stringify(
        {
          summary,
          cycles,
        },
        null,
        2,
      );
    },
    toHtml() {
      const rows = cycles
        .map((entry) => {
          const c = entry.cycle ?? {};
          const cr = entry.closeResult ?? {};
          return `<tr>
            <td>${c.cycle_id ?? ""}</td>
            <td>${c.symbol ?? ""}</td>
            <td>${c.status ?? ""}</td>
            <td>${cr.net_profit_usdt ?? "N/A"}</td>
          </tr>`;
        })
        .join("\n");

      return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>套利复盘报表</title>
</head>
<body>
  <h1>套利复盘报表</h1>
  <p>窗口: ${window?.from ?? ""} ~ ${window?.to ?? ""}</p>
  <p>总收益: ${summary.totalProfitUsdt} USDT | 胜率: ${(summary.winRate * 100).toFixed(2)}% | 周期数: ${summary.cycleCount}</p>
  <table border="1">
    <thead>
      <tr><th>Cycle</th><th>Symbol</th><th>Status</th><th>Net Profit (USDT)</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
    },
  };
}
