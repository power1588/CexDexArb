import { evaluateRiskSignals } from "../../src/core/risk.js";

describe("risk", () => {
  it("识别净收益为负、延迟过高和滑点超限", () => {
    const signals = evaluateRiskSignals({
      opportunity: {
        estimatedNetHourly: -0.00002,
        fundingSpreadHourly: 0.00012,
      },
      storageLatencyMs: 620,
      maxSlippageBps: 12,
      minFundingEdge: 0.00018,
    });

    expect(signals.map((signal) => signal.code)).toEqual(
      expect.arrayContaining([
        "net-negative",
        "latency-high",
        "slippage-high",
        "funding-edge-low",
      ]),
    );
  });

  it("在 funding 方向反转时输出错误级别告警", () => {
    const signals = evaluateRiskSignals({
      opportunity: {
        estimatedNetHourly: 0.00014,
        fundingSpreadHourly: 0.00004,
      },
      storageLatencyMs: 120,
      maxSlippageBps: 6,
      minFundingEdge: 0.00002,
      exitOnFundingFlip: true,
      longFundingRateHourly: 0.00012,
      shortFundingRateHourly: -0.00003,
      minEdgeRetention: 0.00006,
    });

    expect(
      signals.find((signal) => signal.code === "funding-flip")?.severity,
    ).toBe("error");
  });
});
