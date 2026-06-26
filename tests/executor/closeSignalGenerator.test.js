import { describe, expect, it } from "vitest";
import { generateCloseSignal } from "../../src/executor/services/closeSignalGenerator.js";

describe("CloseSignalGenerator", () => {
  it("平仓方向与开仓方向相反", () => {
    const signal = generateCloseSignal({
      openDirection: "buy_binance_sell_hyperliquid",
      buyLeg: { exchange: "binance", quantity: 1, side: "long", entryPrice: 100 },
      sellLeg: { exchange: "hyperliquid", quantity: 1, side: "short", entryPrice: 101 },
      currentSpreadBps: 2,
      fxUsdcUsdtMid: 1.0,
      buyClosePrice: 100.5,
      sellClosePrice: 100.6,
    });

    // 平仓要卖出 binance（多仓）、买入 hyperliquid（空仓）
    expect(signal.legs).toHaveLength(2);
    const binanceLeg = signal.legs.find((l) => l.exchange === "binance");
    const hlLeg = signal.legs.find((l) => l.exchange === "hyperliquid");
    expect(binanceLeg.side).toBe("sell");
    expect(hlLeg.side).toBe("buy");
  });

  it("平仓信号包含预期平仓价差", () => {
    const signal = generateCloseSignal({
      openDirection: "buy_binance_sell_hyperliquid",
      buyLeg: { exchange: "binance", quantity: 1, side: "long", entryPrice: 100 },
      sellLeg: { exchange: "hyperliquid", quantity: 1, side: "short", entryPrice: 101 },
      currentSpreadBps: 2,
      fxUsdcUsdtMid: 1.0,
      buyClosePrice: 100.5,
      sellClosePrice: 100.6,
    });

    // 预期平仓价差 = sellClose - buyClose = 0.1
    expect(signal.expectedSpreadUsdt).toBeCloseTo(0.1, 6);
    expect(signal.expectedSpreadBps).toBeCloseTo(0.1 / 100.6 * 10_000, 6);
  });

  it("平仓腿顺序：先 maker 后 taker（对称于开仓 maker_taker）", () => {
    const signal = generateCloseSignal({
      openDirection: "buy_binance_sell_hyperliquid",
      buyLeg: { exchange: "binance", quantity: 1, side: "long", entryPrice: 100 },
      sellLeg: { exchange: "hyperliquid", quantity: 1, side: "short", entryPrice: 101 },
      currentSpreadBps: 2,
      fxUsdcUsdtMid: 1.0,
      buyClosePrice: 100.5,
      sellClosePrice: 100.6,
      openMode: "maker_taker",
    });

    // 开仓 maker_taker（binance 是 maker），平仓也应 maker 优先
    expect(signal.legs[0].exchange).toBe("binance");
    expect(signal.legs[0].role).toBe("maker");
    expect(signal.legs[1].role).toBe("taker");
  });

  it("平仓建议价格来自当前盘口", () => {
    const signal = generateCloseSignal({
      openDirection: "buy_binance_sell_hyperliquid",
      buyLeg: { exchange: "binance", quantity: 0.5, side: "long", entryPrice: 100 },
      sellLeg: { exchange: "hyperliquid", quantity: 0.5, side: "short", entryPrice: 101 },
      currentSpreadBps: 1,
      fxUsdcUsdtMid: 1.0,
      buyClosePrice: 99.9,
      sellClosePrice: 100.0,
    });

    const binanceLeg = signal.legs.find((l) => l.exchange === "binance");
    const hlLeg = signal.legs.find((l) => l.exchange === "hyperliquid");
    expect(binanceLeg.price).toBe(99.9);
    expect(hlLeg.price).toBe(100.0);
    expect(binanceLeg.quantity).toBe(0.5);
  });
});
