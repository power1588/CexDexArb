import { describe, expect, it } from "vitest";
import { aggregateOpenFills } from "../../src/executor/services/openFillAggregator.js";

describe("OpenFillAggregator", () => {
  it("可从双腿成交回报计算总买入量与总卖出量", () => {
    const result = aggregateOpenFills({
      buyLeg: {
        exchange: "binance",
        side: "buy",
        fills: [
          { price: 100, quantity: 0.5, feeUsdt: 0.05 },
          { price: 101, quantity: 0.3, feeUsdt: 0.04 },
        ],
      },
      sellLeg: {
        exchange: "hyperliquid",
        side: "sell",
        fills: [
          { price: 102, quantity: 0.7, feeUsdt: 0.06 },
        ],
      },
    });

    expect(result.totalBuyQuantity).toBeCloseTo(0.8, 8);
    expect(result.totalSellQuantity).toBeCloseTo(0.7, 8);
    expect(result.totalFeeUsdt).toBeCloseTo(0.15, 8);
  });

  it("可识别未对齐的剩余裸仓（买入 > 卖出）", () => {
    const result = aggregateOpenFills({
      buyLeg: {
        exchange: "binance",
        side: "buy",
        fills: [{ price: 100, quantity: 1.0, feeUsdt: 0 }],
      },
      sellLeg: {
        exchange: "hyperliquid",
        side: "sell",
        fills: [{ price: 102, quantity: 0.8, feeUsdt: 0 }],
      },
    });

    expect(result.hasNakedExposure).toBe(true);
    expect(result.nakedExposureQuantity).toBeCloseTo(0.2, 8);
    expect(result.nakedExposureSide).toBe("buy");
  });

  it("可识别未对齐的剩余裸仓（卖出 > 买入）", () => {
    const result = aggregateOpenFills({
      buyLeg: {
        exchange: "binance",
        side: "buy",
        fills: [{ price: 100, quantity: 0.5, feeUsdt: 0 }],
      },
      sellLeg: {
        exchange: "hyperliquid",
        side: "sell",
        fills: [{ price: 102, quantity: 0.7, feeUsdt: 0 }],
      },
    });

    expect(result.hasNakedExposure).toBe(true);
    expect(result.nakedExposureQuantity).toBeCloseTo(0.2, 8);
    expect(result.nakedExposureSide).toBe("sell");
  });

  it("可输出双腿加权平均成交价", () => {
    const result = aggregateOpenFills({
      buyLeg: {
        exchange: "binance",
        side: "buy",
        fills: [
          { price: 100, quantity: 1, feeUsdt: 0 },
          { price: 110, quantity: 1, feeUsdt: 0 },
        ],
      },
      sellLeg: {
        exchange: "hyperliquid",
        side: "sell",
        fills: [
          { price: 120, quantity: 2, feeUsdt: 0 },
          { price: 130, quantity: 2, feeUsdt: 0 },
        ],
      },
    });

    expect(result.buyWeightedAvgPrice).toBeCloseTo(105, 6);
    expect(result.sellWeightedAvgPrice).toBeCloseTo(125, 6);
  });

  it("双腿完全对齐时无裸仓", () => {
    const result = aggregateOpenFills({
      buyLeg: {
        exchange: "binance",
        side: "buy",
        fills: [{ price: 100, quantity: 1, feeUsdt: 0 }],
      },
      sellLeg: {
        exchange: "hyperliquid",
        side: "sell",
        fills: [{ price: 102, quantity: 1, feeUsdt: 0 }],
      },
    });

    expect(result.hasNakedExposure).toBe(false);
    expect(result.nakedExposureQuantity).toBe(0);
  });

  it("空成交列表时返回零值结果", () => {
    const result = aggregateOpenFills({
      buyLeg: { exchange: "binance", side: "buy", fills: [] },
      sellLeg: { exchange: "hyperliquid", side: "sell", fills: [] },
    });

    expect(result.totalBuyQuantity).toBe(0);
    expect(result.totalSellQuantity).toBe(0);
    expect(result.hasNakedExposure).toBe(false);
  });
});
