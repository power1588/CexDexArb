import { describe, expect, it } from "vitest";
import { computeLiveSpread } from "../../src/executor/services/liveSpreadCalculator.js";

describe("LiveSpreadCalculator", () => {
  it("输入双腿最新盘口，输出当前价差 bps", () => {
    const result = computeLiveSpread({
      openDirection: "buy_binance_sell_hyperliquid",
      buyBook: { exchange: "binance", bestAsk: { price: 100 } },
      sellBook: { exchange: "hyperliquid", bestBid: { price: 101 } },
      fxUsdcUsdtMid: 1.0,
      closeThresholdBps: 5,
    });

    // sellUsdt = 101, buyUsdt = 100, spread = 1, ref = 101, bps = 1/101*10000
    expect(result.netSpreadBps).toBeCloseTo(1 / 101 * 10_000, 4);
    expect(result.buyPrice).toBe(100);
    expect(result.sellPriceUsdt).toBeCloseTo(101, 6);
  });

  it("价差方向与开仓方向一致时返回正回归", () => {
    // 开仓是 buy_binance_sell_hyperliquid，当前价差仍为正（sell > buy）
    const result = computeLiveSpread({
      openDirection: "buy_binance_sell_hyperliquid",
      buyBook: { exchange: "binance", bestAsk: { price: 100 } },
      sellBook: { exchange: "hyperliquid", bestBid: { price: 102 } },
      fxUsdcUsdtMid: 1.0,
      closeThresholdBps: 5,
    });

    expect(result.reversionDirection).toBe("positive");
    expect(result.netSpreadUsdt).toBeGreaterThan(0);
  });

  it("价差收窄到平仓阈值时返回 ready_to_close: true", () => {
    const result = computeLiveSpread({
      openDirection: "buy_binance_sell_hyperliquid",
      buyBook: { exchange: "binance", bestAsk: { price: 100 } },
      sellBook: { exchange: "hyperliquid", bestBid: { price: 100.02 } },
      fxUsdcUsdtMid: 1.0,
      closeThresholdBps: 5, // 0.02/100*10000 = 2 bps < 5
    });

    expect(result.readyToClose).toBe(true);
  });

  it("价差仍大于阈值时返回 ready_to_close: false", () => {
    const result = computeLiveSpread({
      openDirection: "buy_binance_sell_hyperliquid",
      buyBook: { exchange: "binance", bestAsk: { price: 100 } },
      sellBook: { exchange: "hyperliquid", bestBid: { price: 101 } },
      fxUsdcUsdtMid: 1.0,
      closeThresholdBps: 5, // 1/101*10000 ≈ 99 bps > 5
    });

    expect(result.readyToClose).toBe(false);
  });

  it("价差反转（负回归）时返回 reversionDirection: negative", () => {
    const result = computeLiveSpread({
      openDirection: "buy_binance_sell_hyperliquid",
      buyBook: { exchange: "binance", bestAsk: { price: 105 } },
      sellBook: { exchange: "hyperliquid", bestBid: { price: 104 } },
      fxUsdcUsdtMid: 1.0,
      closeThresholdBps: 5,
    });

    expect(result.reversionDirection).toBe("negative");
    expect(result.netSpreadUsdt).toBeLessThan(0);
    expect(result.readyToClose).toBe(true); // 反转时也应平仓
  });

  it("USDC 卖出价按 FX 折算到 USDT", () => {
    const result = computeLiveSpread({
      openDirection: "buy_binance_sell_hyperliquid",
      buyBook: { exchange: "binance", bestAsk: { price: 100 } },
      sellBook: { exchange: "hyperliquid", bestBid: { price: 102 }, quoteCurrency: "USDC" },
      fxUsdcUsdtMid: 0.99,
      closeThresholdBps: 5,
    });

    expect(result.fxDetail.sellPriceUsdc).toBe(102);
    expect(result.fxDetail.sellPriceUsdt).toBeCloseTo(102 * 0.99, 6);
    expect(result.sellPriceUsdt).toBeCloseTo(102 * 0.99, 6);
  });
});
