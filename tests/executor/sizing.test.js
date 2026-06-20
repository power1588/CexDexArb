import { describe, expect, it } from "vitest";
import {
  computeEffectiveOpenThresholdBps,
  computeTargetNotionalUsdt,
} from "../../src/executor/core/sizing.js";

describe("executor sizing", () => {
  it("目标名义量取多项约束最小值", () => {
    const result = computeTargetNotionalUsdt({
      desiredNotionalUsdt: 10_000,
      orderBookCapacityUsdt: 8_000,
      maxMarginLimitedNotionalUsdt: 6_000,
      maxExposureUsdt: 7_500,
      minOrderNotionalUsdt: 100,
    });

    expect(result).toMatchObject({
      executable: true,
      targetNotionalUsdt: 6_000,
    });
  });

  it("开仓阈值包含 FX、延迟、单腿风险和 maker 缓冲", () => {
    const result = computeEffectiveOpenThresholdBps({
      minOpenBps: 8,
      fxPenaltyBps: 0.5,
      latencyPenaltyBps: 1,
      orphanRiskBps: 1.5,
      makerBufferBps: 1,
    });

    expect(result).toMatchObject({
      executable: true,
      effectiveOpenThresholdBps: 12,
    });
  });

  it("任一关键约束不足时返回不可开仓", () => {
    expect(
      computeTargetNotionalUsdt({
        desiredNotionalUsdt: 50,
        orderBookCapacityUsdt: 80,
        maxMarginLimitedNotionalUsdt: 60,
        maxExposureUsdt: 70,
        minOrderNotionalUsdt: 100,
      }),
    ).toMatchObject({
      executable: false,
      reason: "below_min_order_notional",
    });
  });
});
