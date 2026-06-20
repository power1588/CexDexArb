import { describe, expect, it } from "vitest";
import {
  classifySpreadStatus,
  computeAllSpreadOpportunities,
  computeSpreadOpportunity,
  sortSpreadOpportunities,
} from "../../src/core/spread.js";

describe("computeSpreadOpportunity", () => {
  it("计算正向净价差并选出更优方向", () => {
    const binanceQuote = {
      exchange: "binance",
      bidPrice: 50100,
      askPrice: 50000,
      bidQty: 2,
      askQty: 1.5,
      timestamp: 0,
    };
    const hlQuote = {
      exchange: "hyperliquid",
      bidPrice: 50300,
      askPrice: 50400,
      bidQty: 1.2,
      askQty: 0.8,
      timestamp: 0,
    };

    const opp = computeSpreadOpportunity("BTC", binanceQuote, hlQuote);

    expect(opp).not.toBeNull();
    // 方向：Binance 买 50000 → HL 卖 50300，价差 200
    expect(opp.buyExchange).toBe("binance");
    expect(opp.sellExchange).toBe("hyperliquid");
    expect(opp.buyPrice).toBe(50000);
    expect(opp.sellPrice).toBe(50300);
    const expectedGrossSpreadPct = 50300 / 50000 - 1;
    const expectedNetSpreadPct =
      (50300 * (1 - 0.00045)) / (50000 * (1 + 0.0005)) - 1;
    expect(opp.grossSpreadPct).toBeCloseTo(expectedGrossSpreadPct, 8);
    expect(opp.netSpreadPct).toBeCloseTo(expectedNetSpreadPct, 8);
    expect(opp.feeCostPct).toBeCloseTo(
      expectedGrossSpreadPct - expectedNetSpreadPct,
      8,
    );
    // 可成交量：min(1.5, 1.2) = 1.2 * 50000
    expect(opp.maxNotionalUsd).toBeCloseTo(1.2 * 50000, 0);
    expect(opp.status).toBe("ready");
  });

  it("选择反向更优的方向", () => {
    const binanceQuote = {
      exchange: "binance",
      bidPrice: 51000,
      askPrice: 51100,
      bidQty: 1,
      askQty: 1,
      timestamp: 0,
    };
    const hlQuote = {
      exchange: "hyperliquid",
      bidPrice: 50800,
      askPrice: 50900,
      bidQty: 1,
      askQty: 1,
      timestamp: 0,
    };

    const opp = computeSpreadOpportunity("BTC", binanceQuote, hlQuote);

    // 方向：HL 买 50900 → Binance 卖 51000，价差 100
    expect(opp.buyExchange).toBe("hyperliquid");
    expect(opp.sellExchange).toBe("binance");
    expect(opp.grossSpreadPct).toBeGreaterThanOrEqual(0);
  });

  it("按真实净价差比例选择方向并计算费后净值", () => {
    const binanceQuote = {
      exchange: "binance",
      bidPrice: 103,
      askPrice: 100,
      bidQty: 2,
      askQty: 2,
      timestamp: 0,
    };
    const hlQuote = {
      exchange: "hyperliquid",
      bidPrice: 12,
      askPrice: 10,
      bidQty: 2,
      askQty: 2,
      timestamp: 0,
    };

    const opp = computeSpreadOpportunity("TEST", binanceQuote, hlQuote);

    expect(opp.buyExchange).toBe("hyperliquid");
    expect(opp.sellExchange).toBe("binance");
    expect(opp.grossSpreadPct).toBeCloseTo(103 / 10 - 1, 8);
    expect(opp.netSpreadPct).toBeCloseTo(
      (103 * (1 - 0.0005)) / (10 * (1 + 0.00045)) - 1,
      8,
    );
  });

  it("缺失盘口时返回 null", () => {
    expect(computeSpreadOpportunity("BTC", null, {})).toBeNull();
    expect(
      computeSpreadOpportunity("BTC", { bidPrice: NaN, askPrice: 1 }, { bidPrice: 1, askPrice: 2 }),
    ).toBeNull();
  });
});

describe("classifySpreadStatus", () => {
  it("ready: 净价差 > 0.05%", () => {
    expect(classifySpreadStatus(0.0006, 1000)).toBe("ready");
  });

  it("watch: 净价差在阈值之间", () => {
    expect(classifySpreadStatus(0.0001, 1000)).toBe("watch");
    expect(classifySpreadStatus(-0.0001, 1000)).toBe("watch");
  });

  it("blocked: 净价差过低或量不足", () => {
    expect(classifySpreadStatus(-0.0005, 1000)).toBe("blocked");
    expect(classifySpreadStatus(0.001, 50)).toBe("blocked");
  });
});

describe("computeAllSpreadOpportunities", () => {
  it("按净价差绝对值从大到小排序", () => {
    const quotes = {
      BTC: {
        binance: { exchange: "binance", bidPrice: 50100, askPrice: 50000, bidQty: 2, askQty: 1, timestamp: 0 },
        hyperliquid: { exchange: "hyperliquid", bidPrice: 50300, askPrice: 50400, bidQty: 1, askQty: 1, timestamp: 0 },
      },
      ETH: {
        binance: { exchange: "binance", bidPrice: 3001, askPrice: 3000, bidQty: 10, askQty: 10, timestamp: 0 },
        hyperliquid: { exchange: "hyperliquid", bidPrice: 3002, askPrice: 3003, bidQty: 10, askQty: 10, timestamp: 0 },
      },
    };

    const opps = computeAllSpreadOpportunities(quotes);
    expect(opps).toHaveLength(2);
    // BTC 价差应该排前面（绝对值更大）
    expect(opps[0].symbol).toBe("BTC");
    expect(Math.abs(opps[0].netSpreadPct)).toBeGreaterThanOrEqual(
      Math.abs(opps[1].netSpreadPct),
    );
  });

  it("只计算共同交易对并支持按毛价差排序", () => {
    const quotes = {
      BTC: {
        binance: { exchange: "binance", bidPrice: 50100, askPrice: 50000, bidQty: 2, askQty: 1, timestamp: 0 },
        hyperliquid: { exchange: "hyperliquid", bidPrice: 50300, askPrice: 50400, bidQty: 1, askQty: 1, timestamp: 0 },
      },
      ETH: {
        binance: { exchange: "binance", bidPrice: 3001, askPrice: 3000, bidQty: 10, askQty: 10, timestamp: 0 },
        hyperliquid: { exchange: "hyperliquid", bidPrice: 3020, askPrice: 3021, bidQty: 10, askQty: 10, timestamp: 0 },
      },
    };

    const opps = computeAllSpreadOpportunities(quotes, {
      allowedSymbols: ["ETH"],
      sortBy: "grossSpreadPct",
    });

    expect(opps).toHaveLength(1);
    expect(opps[0].symbol).toBe("ETH");
  });
});

describe("sortSpreadOpportunities", () => {
  it("支持按可成交量排序", () => {
    const sorted = sortSpreadOpportunities(
      [
        { symbol: "BTC", netSpreadPct: 0.001, grossSpreadPct: 0.002, maxNotionalUsd: 2000 },
        { symbol: "ETH", netSpreadPct: 0.0005, grossSpreadPct: 0.003, maxNotionalUsd: 5000 },
      ],
      "maxNotionalUsd",
    );

    expect(sorted[0].symbol).toBe("ETH");
  });
});
