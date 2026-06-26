import { describe, expect, it } from "vitest";
import { compareCloseResult } from "../../src/executor/services/closeResultComparator.js";

describe("CloseResultComparator", () => {
  it("实际平仓价差与预期价差的偏差计算正确", () => {
    const result = compareCloseResult({
      closeSignal: { expectedSpreadUsdt: 0.5, expectedSpreadBps: 5 },
      closeExecution: {
        makerFill: { price: 100, quantity: 1 },
        takerFill: { price: 100.4, quantity: 1 },
      },
      openLockedSpread: { netSpreadUsdt: 2.0 },
      feeCostUsdt: 0.1,
    });

    // actualSpread = taker - maker = 0.4
    expect(result.actualSpreadUsdt).toBeCloseTo(0.4, 6);
    expect(result.deviationUsdt).toBeCloseTo(0.1, 6); // 0.5 - 0.4
  });

  it("偏差可拆分为 maker 滑点与 taker 滑点", () => {
    const result = compareCloseResult({
      closeSignal: {
        expectedSpreadUsdt: 0.5,
        expectedSpreadBps: 5,
        legs: [
          { exchange: "binance", role: "maker", price: 100 },
          { exchange: "hyperliquid", role: "taker", price: 100.5 },
        ],
      },
      closeExecution: {
        makerFill: { price: 99.8, quantity: 1 }, // maker 滑点 0.2
        takerFill: { price: 100.6, quantity: 1 }, // taker 滑点 0.1
      },
      openLockedSpread: { netSpreadUsdt: 2.0 },
      feeCostUsdt: 0,
    });

    expect(result.makerSlippageUsdt).toBeCloseTo(-0.2, 6); // 实际成交价更低 -> 卖出更便宜
    expect(result.takerSlippageUsdt).toBeCloseTo(0.1, 6);
  });

  it("输出最终净收益（开仓锁定 - 平仓成本 - 双边费率）", () => {
    const result = compareCloseResult({
      closeSignal: { expectedSpreadUsdt: 0.5, expectedSpreadBps: 5 },
      closeExecution: {
        makerFill: { price: 100, quantity: 1 },
        takerFill: { price: 100.3, quantity: 1 },
      },
      openLockedSpread: { netSpreadUsdt: 2.0 },
      feeCostUsdt: 0.15,
    });

    // 开仓锁定 2.0，平仓实际价差 0.3（这是平仓时再获得的价差）
    // 净收益 = 开仓锁定 + 平仓价差 - 平仓费率 = 2.0 + 0.3 - 0.15
    // 但根据 spec 描述“净收益（开仓锁定 - 平仓成本 - 双边费率）”，
    // 平仓成本 = 预期平仓价差 - 实际平仓价差（滑点损失）
    expect(result.netProfitUsdt).toBeCloseTo(2.0 + 0.3 - 0.15, 6);
  });

  it("平仓价差为负时净收益仍可能为正（开仓锁定足够大）", () => {
    const result = compareCloseResult({
      closeSignal: { expectedSpreadUsdt: 0.5, expectedSpreadBps: 5 },
      closeExecution: {
        makerFill: { price: 101, quantity: 1 },
        takerFill: { price: 100.5, quantity: 1 },
      },
      openLockedSpread: { netSpreadUsdt: 5.0 },
      feeCostUsdt: 0.2,
    });

    // actualSpread = 100.5 - 101 = -0.5
    expect(result.actualSpreadUsdt).toBeCloseTo(-0.5, 6);
    expect(result.netProfitUsdt).toBeCloseTo(5.0 - 0.5 - 0.2, 6);
    expect(result.netProfitUsdt).toBeGreaterThan(0);
  });
});
