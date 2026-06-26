/**
 * 复盘查询服务。
 *
 * 从 SQLite 中查询历史套利周期用于复盘。
 * 不依赖执行器运行时，可独立使用。
 */

export function createReplayQueryService(repositories) {
  return {
    findCyclesByTimeRange(from, to) {
      return repositories.cycles.findByTimeRange(from, to);
    },
    getCycleDetail(cycleId) {
      return repositories.aggregateByCycleId(cycleId);
    },
    getStatistics(from, to) {
      const cycles = repositories.cycles.findByTimeRange(from, to);

      let totalProfitUsdt = 0;
      let winCount = 0;
      let countedCycles = 0;
      let deviationSumUsdt = 0;
      let deviationCount = 0;
      let lockedSpreadSumBps = 0;
      let lockedSpreadCount = 0;

      for (const cycle of cycles) {
        const detail = repositories.aggregateByCycleId(cycle.cycle_id);
        if (!detail) {
          continue;
        }

        if (detail.closeResult) {
          countedCycles += 1;
          totalProfitUsdt += Number(detail.closeResult.net_profit_usdt ?? 0);
          if (Number(detail.closeResult.net_profit_usdt ?? 0) > 0) {
            winCount += 1;
          }
          deviationSumUsdt += Math.abs(
            Number(detail.closeResult.expected_spread_usdt ?? 0) -
              Number(detail.closeResult.actual_spread_usdt ?? 0),
          );
          deviationCount += 1;
        }

        if (detail.spreadLock) {
          lockedSpreadSumBps += Number(detail.spreadLock.net_spread_bps ?? 0);
          lockedSpreadCount += 1;
        }
      }

      return {
        cycleCount: cycles.length,
        closedCycleCount: countedCycles,
        totalProfitUsdt,
        averageProfitUsdt: countedCycles > 0 ? totalProfitUsdt / countedCycles : 0,
        winCount,
        winRate: countedCycles > 0 ? winCount / countedCycles : 0,
        averageDeviationUsdt: deviationCount > 0 ? deviationSumUsdt / deviationCount : 0,
        averageLockedSpreadBps:
          lockedSpreadCount > 0 ? lockedSpreadSumBps / lockedSpreadCount : 0,
      };
    },
  };
}
