import { describe, expect, it } from "vitest";
import { createExitRuleEngine } from "../../src/executor/services/exitRuleEngine.js";

describe("exit rule engine", () => {
  const engine = createExitRuleEngine();

  it("价差回归满足条件时触发目标退出", () => {
    expect(
      engine.evaluate({
        targetExitReached: true,
      }),
    ).toMatchObject({
      shouldExit: true,
      reason: "target_exit",
    });
  });

  it("超过最大持有时长时触发时间退出", () => {
    expect(
      engine.evaluate({
        holdingDurationMs: 10_000,
        maxHoldingDurationMs: 5_000,
      }),
    ).toMatchObject({
      shouldExit: true,
      reason: "time_exit",
    });
  });

  it("funding 方向不利时触发降权或退出", () => {
    expect(
      engine.evaluate({
        fundingDirection: "adverse",
      }),
    ).toMatchObject({
      shouldExit: true,
      reason: "funding_exit",
    });
  });

  it("风险事件发生时优先风险退出", () => {
    expect(
      engine.evaluate({
        targetExitReached: true,
        riskEvents: [
          {
            severity: "critical",
          },
        ],
      }),
    ).toMatchObject({
      shouldExit: true,
      reason: "risk_exit",
      executionPath: "emergency",
    });
  });
});
