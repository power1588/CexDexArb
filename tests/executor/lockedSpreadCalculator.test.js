import { describe, expect, it } from "vitest";
import { computeLockedSpread } from "../../src/executor/services/lockedSpreadCalculator.js";

describe("LockedSpreadCalculator", () => {
  it("卖出腿成交价减去买入腿成交价，折算到 USDT 口径", () => {
    const result = computeLockedSpread({
      buyExchange: "binance",
      buyPrice: 100, // USDT 计价
      sellExchange: "hyperliquid",
      sellPrice: 101.5, // USDC 计价
      quantity: 2,
      fxUsdcUsdtMid: 1.0,
      buyFeeBps: 1,
      sellFeeBps: 1,
    });

    // sellPrice 折算后 101.5，gross spread per unit = 1.5
    expect(result.grossSpreadUsdt).toBeCloseTo(3.0, 6); // 1.5 * 2
    expect(result.netSpreadUsdt).toBeLessThan(result.grossSpreadUsdt);
  });

  it("扣除实际双边费率后的净锁定价差正确", () => {
    const result = computeLockedSpread({
      buyExchange: "binance",
      buyPrice: 100,
      sellExchange: "hyperliquid",
      sellPrice: 102,
      quantity: 1,
      fxUsdcUsdtMid: 1.0,
      buyFeeBps: 10, // 10 bps = 0.1%
      sellFeeBps: 10,
    });

    // buyFeeCost = 100 * 1 * 0.001 = 0.1
    // sellFeeCost = 102 * 1 * 0.001 = 0.102
    // grossSpread = 102 - 100 = 2
    // netSpread = 2 - 0.1 - 0.102 = 1.798
    expect(result.buyFeeCostUsdt).toBeCloseTo(0.1, 6);
    expect(result.sellFeeCostUsdt).toBeCloseTo(0.102, 6);
    expect(result.feeCostUsdt).toBeCloseTo(0.202, 6);
    expect(result.netSpreadUsdt).toBeCloseTo(1.798, 6);
  });

  it("输出 bps 单位与绝对值", () => {
    const result = computeLockedSpread({
      buyExchange: "binance",
      buyPrice: 100,
      sellExchange: "hyperliquid",
      sellPrice: 101,
      quantity: 1,
      fxUsdcUsdtMid: 1.0,
      buyFeeBps: 0,
      sellFeeBps: 0,
    });

    // netSpread = 1，referenceNotional = max(100,101) = 101，bps = 1/101 * 10000
    expect(result.netSpreadBps).toBeCloseTo(1 / 101 * 10_000, 6);
    expect(result.grossSpreadBps).toBeCloseTo(1 / 101 * 10_000, 6);
  });

  it("USDC -> USDT 折算明细被记录", () => {
    const result = computeLockedSpread({
      buyExchange: "binance",
      buyPrice: 100,
      sellExchange: "hyperliquid",
      sellPrice: 102, // 假设是 USDC 计价
      quantity: 1,
      fxUsdcUsdtMid: 0.999,
      buyFeeBps: 0,
      sellFeeBps: 0,
    });

    expect(result.fxDetail.sellPriceUsdc).toBe(102);
    expect(result.fxDetail.fxUsdcUsdtMid).toBe(0.999);
    expect(result.fxDetail.sellPriceUsdt).toBeCloseTo(102 * 0.999, 6);
  });

  it("价差为负时 netSpreadBps 为负", () => {
    const result = computeLockedSpread({
      buyExchange: "binance",
      buyPrice: 105,
      sellExchange: "hyperliquid",
      sellPrice: 104,
      quantity: 1,
      fxUsdcUsdtMid: 1.0,
      buyFeeBps: 0,
      sellFeeBps: 0,
    });

    expect(result.netSpreadUsdt).toBeLessThan(0);
    expect(result.netSpreadBps).toBeLessThan(0);
  });
});
