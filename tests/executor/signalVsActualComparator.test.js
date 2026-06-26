import { describe, expect, it } from "vitest";
import { compareSignalVsActual } from "../../src/executor/services/signalVsActualComparator.js";

describe("SignalVsActualComparator", () => {
  it("信号预测价差与实际锁定价差的偏差计算正确", () => {
    const result = compareSignalVsActual({
      signal: {
        signalId: "sig-1",
        observedSpreadBps: 18,
        expectedSpreadUsdt: 2.0,
      },
      lockedSpread: {
        netSpreadUsdt: 1.8,
        netSpreadBps: 18,
        fxDetail: { fxUsdcUsdtMid: 1.0 },
        buyFeeCostUsdt: 0.05,
        sellFeeCostUsdt: 0.04,
      },
      expectedComponents: {
        // 信号预期价差中各成分
        fxBps: 0,
        feeBps: 9, // 0.09 / 100 * 10000 = 9 bps 对应的名义金额
        slippageBps: 0,
        makerBufferBps: 0,
      },
      actualComponents: {
        fxBps: 0.5,
        feeBps: 9,
        slippageBps: 2,
        makerBufferBps: 0,
      },
      warningThresholdBps: 5,
    });

    expect(result.signalSpreadBps).toBe(18);
    expect(result.actualSpreadBps).toBe(18);
    expect(result.deviationBps).toBeCloseTo(0, 6);
    expect(result.alarmLevel).toBe("normal");
  });

  it("偏差可拆分为 FX/滑点/费率/maker buffer 归因", () => {
    const result = compareSignalVsActual({
      signal: {
        observedSpreadBps: 20,
        expectedSpreadUsdt: 2.0,
      },
      lockedSpread: {
        netSpreadUsdt: 1.5,
        netSpreadBps: 15,
        fxDetail: { fxUsdcUsdtMid: 1.0 },
      },
      expectedComponents: {
        fxBps: 0,
        feeBps: 5,
        slippageBps: 0,
        makerBufferBps: 0,
      },
      actualComponents: {
        fxBps: 1,
        feeBps: 6,
        slippageBps: 3,
        makerBufferBps: 0,
      },
      warningThresholdBps: 3,
    });

    // 偏差 = 20 - 15 = 5 bps
    expect(result.deviationBps).toBeCloseTo(5, 6);
    expect(result.attribution.fxBps).toBeCloseTo(1, 6);
    expect(result.attribution.feeBps).toBeCloseTo(1, 6);
    expect(result.attribution.slippageBps).toBeCloseTo(3, 6);
    expect(result.alarmLevel).toBe("warning");
  });

  it("偏差超阈值时输出 critical 告警级别", () => {
    const result = compareSignalVsActual({
      signal: {
        observedSpreadBps: 20,
        expectedSpreadUsdt: 2.0,
      },
      lockedSpread: {
        netSpreadUsdt: 1.0,
        netSpreadBps: 10,
        fxDetail: { fxUsdcUsdtMid: 1.0 },
      },
      expectedComponents: {
        fxBps: 0,
        feeBps: 5,
        slippageBps: 0,
        makerBufferBps: 0,
      },
      actualComponents: {
        fxBps: 2,
        feeBps: 5,
        slippageBps: 8,
        makerBufferBps: 0,
      },
      warningThresholdBps: 5,
      criticalThresholdBps: 8,
    });

    expect(result.deviationBps).toBeCloseTo(10, 6);
    expect(result.alarmLevel).toBe("critical");
  });

  it("缺失实际成分时仍可计算总偏差", () => {
    const result = compareSignalVsActual({
      signal: {
        observedSpreadBps: 18,
        expectedSpreadUsdt: 1.8,
      },
      lockedSpread: {
        netSpreadUsdt: 1.6,
        netSpreadBps: 16,
        fxDetail: { fxUsdcUsdtMid: 1.0 },
      },
      warningThresholdBps: 3,
    });

    expect(result.deviationBps).toBeCloseTo(2, 6);
    expect(result.attribution).toEqual({});
  });
});
