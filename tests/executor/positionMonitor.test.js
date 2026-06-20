import { describe, expect, it } from "vitest";
import { loadExecutionConfig } from "../../src/executor/core/config.js";
import { createPositionMonitor } from "../../src/executor/services/positionMonitor.js";

describe("position monitor", () => {
  const monitor = createPositionMonitor({
    config: loadExecutionConfig(),
  });

  it("仓位差超过阈值时触发再平衡建议", () => {
    expect(
      monitor.evaluate({
        legs: [
          { notionalUsdt: 1_000 },
          { notionalUsdt: 900 },
        ],
      }),
    ).toMatchObject({
      shouldRebalance: true,
      reason: "position_imbalance",
    });
  });

  it("轻微偏差时不会误触发紧急退出", () => {
    expect(
      monitor.evaluate({
        legs: [
          { notionalUsdt: 1_000 },
          { notionalUsdt: 980 },
        ],
      }),
    ).toMatchObject({
      shouldRebalance: false,
    });
  });

  it("仓位快照缺失时进入降级监控状态", () => {
    expect(monitor.evaluate(null)).toMatchObject({
      monitoringMode: "degraded",
      reason: "missing_position_snapshot",
    });
  });
});
