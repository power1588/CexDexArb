import { describe, expect, it } from "vitest";
import { checkPositionAlignment } from "../../src/executor/services/positionAlignmentChecker.js";

describe("PositionAlignmentChecker", () => {
  it("双腿数量完全一致时返回 aligned: true", () => {
    const report = checkPositionAlignment({
      buyLeg: { exchange: "binance", quantity: 1, notionalUsdt: 100 },
      sellLeg: { exchange: "hyperliquid", quantity: 1, notionalUsdt: 100 },
      maxImbalancePct: 3,
    });

    expect(report.aligned).toBe(true);
    expect(report.imbalancePct).toBeCloseTo(0, 6);
    expect(report.directionOk).toBe(true);
    expect(report.needsRebalance).toBe(false);
  });

  it("数量差超过阈值时返回 imbalance_pct", () => {
    const report = checkPositionAlignment({
      buyLeg: { exchange: "binance", quantity: 1.0, notionalUsdt: 100 },
      sellLeg: { exchange: "hyperliquid", quantity: 0.95, notionalUsdt: 95 },
      maxImbalancePct: 3,
    });

    expect(report.aligned).toBe(false);
    expect(report.imbalancePct).toBeCloseTo(5, 6);
    expect(report.needsRebalance).toBe(true);
  });

  it("方向相反时返回 direction_ok: true", () => {
    const report = checkPositionAlignment({
      buyLeg: { exchange: "binance", quantity: 1, notionalUsdt: 100, side: "long" },
      sellLeg: { exchange: "hyperliquid", quantity: 1, notionalUsdt: 100, side: "short" },
      maxImbalancePct: 3,
    });

    expect(report.directionOk).toBe(true);
  });

  it("方向相同时 direction_ok: false", () => {
    const report = checkPositionAlignment({
      buyLeg: { exchange: "binance", quantity: 1, notionalUsdt: 100, side: "long" },
      sellLeg: { exchange: "hyperliquid", quantity: 1, notionalUsdt: 100, side: "long" },
      maxImbalancePct: 3,
    });

    expect(report.directionOk).toBe(false);
  });

  it("名义金额差超过阈值时触发告警", () => {
    const report = checkPositionAlignment({
      buyLeg: { exchange: "binance", quantity: 1, notionalUsdt: 110 },
      sellLeg: { exchange: "hyperliquid", quantity: 1, notionalUsdt: 100 },
      maxImbalancePct: 5,
    });

    expect(report.notionalImbalancePct).toBeCloseTo((110 - 100) / 110 * 100, 4);
    expect(report.aligned).toBe(true); // 数量一致仍视为对齐
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it("缺失腿时返回降级报告", () => {
    const report = checkPositionAlignment({
      buyLeg: null,
      sellLeg: { exchange: "hyperliquid", quantity: 1, notionalUsdt: 100 },
      maxImbalancePct: 3,
    });

    expect(report.aligned).toBe(false);
    expect(report.reason).toBe("missing_leg");
  });
});
