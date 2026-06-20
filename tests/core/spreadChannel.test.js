import { describe, expect, it } from "vitest";
import {
  buildSpreadChannelPayload,
  formatSpreadOpportunityForChannel,
} from "../../src/core/spreadChannel.js";

describe("spread channel payload", () => {
  it("格式化单条价差机会为 channel 消息结构", () => {
    const result = formatSpreadOpportunityForChannel({
      symbol: "BTC",
      buyExchange: "binance",
      buyPrice: 100,
      sellExchange: "hyperliquid",
      sellPrice: 101,
      grossSpreadPct: 0.01,
      feeCostPct: 0.001,
      netSpreadPct: 0.009,
      status: "ready",
      timestamp: 1234,
    });

    expect(result).toEqual({
      symbol: "BTC",
      buyExchange: "binance",
      buyPrice: 100,
      sellExchange: "hyperliquid",
      sellPrice: 101,
      grossSpreadPct: 0.01,
      estimatedFeePct: 0.001,
      netSpreadPct: 0.009,
      status: "ready",
      timestamp: 1234,
    });
  });

  it("构造完整 channel payload 并过滤非法机会", () => {
    const payload = buildSpreadChannelPayload(
      [
        {
          symbol: "ETH",
          buyExchange: "hyperliquid",
          buyPrice: 2500,
          sellExchange: "binance",
          sellPrice: 2510,
          grossSpreadPct: 0.004,
          feeCostPct: 0.001,
          netSpreadPct: 0.003,
          status: "ready",
          timestamp: 5678,
        },
        {},
      ],
      {
        channel: "arbitrage:spread:opportunities",
        filters: {
          status: "ready",
          min24hVolumeUsd: 1_000_000,
        },
      },
    );

    expect(payload.type).toBe("spread_opportunities");
    expect(payload.channel).toBe("arbitrage:spread:opportunities");
    expect(payload.filters).toEqual({
      status: "ready",
      min24hVolumeUsd: 1_000_000,
    });
    expect(payload.opportunities).toHaveLength(1);
    expect(payload.opportunities[0].symbol).toBe("ETH");
  });
});
