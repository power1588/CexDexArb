import { describe, expect, it } from "vitest";
import {
  buildFundingOpportunities,
  buildFundingOpportunity,
  normalizeFundingSnapshot,
  sortFundingOpportunities,
  toHourlyFundingRate,
} from "../../src/core/funding.js";

describe("funding", () => {
  it("将不同结算周期转换为统一小时口径", () => {
    expect(toHourlyFundingRate(0.0016, 8)).toBeCloseTo(0.0002);
  });

  it("标准化 funding 快照字段", () => {
    const snapshot = normalizeFundingSnapshot({
      symbol: "BTC",
      exchange: "binance",
      fundingRate: 0.0016,
      fundingIntervalHours: 8,
      takerFee: 0.0005,
      markPrice: 100000,
    });

    expect(snapshot.fundingRateHourly).toBeCloseTo(0.0002);
    expect(snapshot.markPrice).toBe(100000);
  });

  it("动态生成 funding 机会并计入 taker fee", () => {
    const opportunity = buildFundingOpportunity(
      "BTC",
      {
        symbol: "BTC",
        exchange: "binance",
        fundingRateHourly: 0.00008,
        takerFee: 0.0005,
        markPrice: 103245.2,
      },
      {
        symbol: "BTC",
        exchange: "hyperliquid",
        fundingRateHourly: 0.00031,
        takerFee: 0.00045,
        markPrice: 103311.7,
      },
    );

    expect(opportunity.longExchange).toBe("binance");
    expect(opportunity.shortExchange).toBe("hyperliquid");
    expect(opportunity.fundingSpreadHourly).toBeCloseTo(0.00023);
    expect(opportunity.estimatedNetHourly).toBeCloseTo(0.0001508333);
  });

  it("单边缺失 funding 数据时不生成错误机会", () => {
    const opportunity = buildFundingOpportunity(
      "ETH",
      {
        symbol: "ETH",
        exchange: "binance",
        takerFee: 0.0005,
        markPrice: 5000,
      },
      {
        symbol: "ETH",
        exchange: "hyperliquid",
        fundingRateHourly: 0.0002,
        takerFee: 0.00045,
        markPrice: 5002,
      },
    );

    expect(opportunity).toBeNull();
  });

  it("支持按净收益、费率差和综合评分排序", () => {
    const opportunities = [
      {
        symbol: "ETH",
        estimatedNetHourly: 0.00012,
        fundingSpreadHourly: 0.0002,
      },
      {
        symbol: "BTC",
        estimatedNetHourly: 0.00018,
        fundingSpreadHourly: 0.00023,
      },
    ];

    expect(sortFundingOpportunities(opportunities)[0].symbol).toBe("BTC");
    expect(
      sortFundingOpportunities(opportunities, "fundingSpreadHourly")[0].symbol,
    ).toBe("BTC");
    expect(
      sortFundingOpportunities(opportunities, "compositeScore")[0].symbol,
    ).toBe("BTC");
  });

  it("根据共同交易对批量生成 funding 机会", () => {
    const opportunities = buildFundingOpportunities(
      [
        {
          symbol: "BTC",
          exchange: "binance",
          fundingRateHourly: 0.00008,
          takerFee: 0.0005,
          markPrice: 100000,
        },
        {
          symbol: "BTC",
          exchange: "hyperliquid",
          fundingRateHourly: 0.00031,
          takerFee: 0.00045,
          markPrice: 100030,
        },
        {
          symbol: "ETH",
          exchange: "binance",
          fundingRateHourly: 0.00002,
          takerFee: 0.0005,
          markPrice: 5000,
        },
      ],
      [
        { symbol: "BTC" },
        { symbol: "ETH" },
      ],
    );

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].symbol).toBe("BTC");
  });

  it("支持 xyz / vntl builder 标的生成 funding 机会", () => {
    const opportunities = buildFundingOpportunities(
      [
        {
          symbol: "SPCX",
          exchange: "binance",
          fundingRate: 0.00015263,
          fundingIntervalHours: 8,
          takerFee: 0.0005,
          markPrice: 181.07832183,
        },
        {
          symbol: "SPCX",
          exchange: "hyperliquid",
          fundingRate: 0.0000348053,
          fundingIntervalHours: 1,
          takerFee: 0.00009,
          markPrice: 180.89,
        },
        {
          symbol: "OPENAI",
          exchange: "binance",
          fundingRate: 0.00005,
          fundingIntervalHours: 8,
          takerFee: 0.0005,
          markPrice: 1383.23,
        },
        {
          symbol: "OPENAI",
          exchange: "hyperliquid",
          fundingRate: 0,
          fundingIntervalHours: 1,
          takerFee: 0.00009,
          markPrice: 1336.2,
        },
      ],
      [
        { symbol: "SPCX" },
        { symbol: "OPENAI" },
      ],
    );

    expect(opportunities.map((item) => item.symbol)).toEqual([
      "SPCX",
      "OPENAI",
    ]);
    expect(opportunities[0].fundingSpreadHourly).toBeGreaterThan(0);
  });
});
