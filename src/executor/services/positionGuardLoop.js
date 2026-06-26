/**
 * 持仓监控守护循环。
 *
 * 建仓后启动常驻监控，按固定间隔轮询双腿行情，
 * 每轮输出价差快照与退出建议，直到触发退出。
 *
 * 退出原因优先级：risk_exit > target_exit > time_exit。
 */

import { computeLiveSpread } from "./liveSpreadCalculator.js";

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_MAX_HOLDING_MS = 5 * 60 * 1000;
const MAX_ITERATIONS = 10_000;

function sleep(ms, clock) {
  // 在测试中使用 ManualClock 直接推进；这里仅在生产环境等待
  if (clock && typeof clock.advance === "function") {
    clock.advance(ms);
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPositionGuardLoop({
  clock = { now: () => Date.now() },
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxHoldingDurationMs = DEFAULT_MAX_HOLDING_MS,
  closeThresholdBps = 5,
  closeThresholdAbsUsdt,
  getMarketSnapshot,
  onSnapshot,
  onExit,
} = {}) {
  if (typeof getMarketSnapshot !== "function") {
    throw new Error("PositionGuardLoop 需要 getMarketSnapshot 回调");
  }

  async function run({ cycleId, openDirection, fxUsdcUsdtMid = 1.0 } = {}) {
    const snapshots = [];
    const startedAt = clock.now();

    for (let i = 0; i < MAX_ITERATIONS; i += 1) {
      const now = clock.now();
      const holdingDurationMs = now - startedAt;

      if (holdingDurationMs > maxHoldingDurationMs) {
        const result = {
          cycleId,
          exitReason: "time_exit",
          executionPath: "normal",
          snapshots,
          holdingDurationMs,
        };
        onExit?.(result);
        return result;
      }

      let snapshot;
      try {
        const raw = await getMarketSnapshot({ cycleId, now });
        if (!raw) {
          const result = {
            cycleId,
            exitReason: "risk_exit",
            executionPath: "emergency",
            reason: "missing_snapshot",
            snapshots,
            holdingDurationMs,
          };
          onExit?.(result);
          return result;
        }

        snapshot = computeLiveSpread({
          openDirection,
          buyBook: raw.buyBook,
          sellBook: raw.sellBook,
          fxUsdcUsdtMid: raw.fxUsdcUsdtMid ?? fxUsdcUsdtMid,
          closeThresholdBps,
          closeThresholdAbsUsdt,
        });
        snapshot.cycleId = cycleId;
        snapshot.iteration = i;
        snapshot.clockNow = now;
      } catch (error) {
        const result = {
          cycleId,
          exitReason: "risk_exit",
          executionPath: "emergency",
          reason: "snapshot_error",
          error,
          snapshots,
          holdingDurationMs,
        };
        onExit?.(result);
        return result;
      }

      snapshots.push(snapshot);
      onSnapshot?.(snapshot);

      if (snapshot.readyToClose) {
        const result = {
          cycleId,
          exitReason: "target_exit",
          executionPath: "normal",
          finalSnapshot: snapshot,
          snapshots,
          holdingDurationMs,
        };
        onExit?.(result);
        return result;
      }

      await sleep(pollIntervalMs, clock);
    }

    const result = {
      cycleId,
      exitReason: "time_exit",
      executionPath: "normal",
      reason: "max_iterations_exceeded",
      snapshots,
      holdingDurationMs: clock.now() - startedAt,
    };
    onExit?.(result);
    return result;
  }

  return { run };
}
