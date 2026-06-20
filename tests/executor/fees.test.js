import { describe, expect, it } from "vitest";
import {
  computeFeeAdjustedPrice,
  computeModeFeeSummary,
} from "../../src/executor/core/fees.js";

describe("executor fees", () => {
  it("Binance maker/taker 费率计算正确", () => {
    expect(
      computeFeeAdjustedPrice({
        price: 100,
        feeBps: 1.5,
        side: "buy",
      }),
    ).toBeCloseTo(100.015, 8);

    expect(
      computeFeeAdjustedPrice({
        price: 100,
        feeBps: 5,
        side: "buy",
      }),
    ).toBeCloseTo(100.05, 8);
  });

  it("Hyperliquid maker/taker 费率计算正确", () => {
    expect(
      computeFeeAdjustedPrice({
        price: 100,
        feeBps: 1.5,
        side: "sell",
      }),
    ).toBeCloseTo(99.985, 8);

    expect(
      computeFeeAdjustedPrice({
        price: 100,
        feeBps: 4.5,
        side: "sell",
      }),
    ).toBeCloseTo(99.955, 8);
  });

  it("买入腿和卖出腿的扣费方向正确", () => {
    const summary = computeModeFeeSummary({
      buyPrice: 100,
      sellPrice: 101,
      quantity: 10,
      buyFeeBps: 5,
      sellFeeBps: 4.5,
    });

    expect(summary.buyFeeCostUsdt).toBeCloseTo(0.5, 8);
    expect(summary.sellFeeCostUsdt).toBeCloseTo(0.4545, 8);
  });
});
