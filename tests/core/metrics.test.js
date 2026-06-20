import {
  buildPortfolioPreview,
  computeEstimatedNetHourly,
  computeFundingSpread,
  computePriceSpread,
  enrichOpportunity,
  filterOpportunities,
  getOpportunityStatus,
  getSymbolSnapshotIndex,
  sortOpportunities,
  summarizeOpportunities,
} from "../../src/core/metrics.js";
import { monitorSnapshot } from "../../src/fixtures/mockData.js";

describe("metrics", () => {
  it("计算 funding spread", () => {
    expect(computeFundingSpread(0.00008, 0.00031)).toBeCloseTo(0.00023);
  });

  it("计算手续费后的净收益", () => {
    const net = computeEstimatedNetHourly({
      longRate: 0.00008,
      shortRate: 0.00031,
      longTakerFee: 0.0005,
      shortTakerFee: 0.00045,
      holdingHours: 12,
    });

    expect(net).toBeCloseTo(0.0001508333);
  });

  it("计算净价差", () => {
    expect(computePriceSpread(103245.2, 103311.7)).toBeCloseTo(0.0006441, 4);
  });

  it("根据净收益映射机会状态", () => {
    expect(getOpportunityStatus(-0.00001)).toBe("blocked");
    expect(getOpportunityStatus(0.00005)).toBe("watch");
    expect(getOpportunityStatus(0.00018)).toBe("ready");
  });

  it("根据筛选条件过滤机会", () => {
    const filtered = filterOpportunities(monitorSnapshot.opportunities, {
      exchange: "binance",
      symbol: "BTC",
      minNetHourly: 0.0001,
      minFundingSpreadHourly: 0.0002,
      riskLevel: "medium",
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].symbol).toBe("BTC");
  });

  it("汇总机会摘要", () => {
    const summary = summarizeOpportunities(
      monitorSnapshot.opportunities,
      "running",
    );

    expect(summary.readyCount).toBe(1);
    expect(summary.positiveCount).toBe(2);
    expect(summary.runningStrategies).toBe(1);
  });

  it("生成组合预览", () => {
    const preview = buildPortfolioPreview(monitorSnapshot.opportunities[0], {
      notionalUsd: 50000,
      leverage: 4,
      maxSlippageBps: 8,
    });

    expect(preview.symbol).toBe("BTC");
    expect(preview.capitalRequired).toBe(12500);
    expect(preview.longExchange).toBe("binance");
    expect(preview.marginBuffer).toBe(2500);
  });

  it("按净收益排序并补齐机会明细字段", () => {
    const snapshotIndex = getSymbolSnapshotIndex(monitorSnapshot.symbols);
    const enriched = monitorSnapshot.opportunities.map((item) =>
      enrichOpportunity(item, snapshotIndex),
    );
    const sorted = sortOpportunities(enriched);

    expect(sorted[0].symbol).toBe("BTC");
    expect(sorted[0].longMarkPrice).toBeGreaterThan(0);
    expect(sorted[0].netPriceSpread).toBeGreaterThan(0);
  });
});
