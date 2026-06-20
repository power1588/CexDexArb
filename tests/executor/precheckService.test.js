import { describe, expect, it } from "vitest";
import { ManualClock } from "../../src/executor/adapters/runtime.js";
import { loadExecutionConfig } from "../../src/executor/core/config.js";
import { createMarketSnapshot, createOpportunitySignal } from "../../src/executor/domain/models.js";
import { createPrecheckService } from "../../src/executor/services/precheckService.js";

function createSnapshot(overrides = {}) {
  return createMarketSnapshot({
    snapshotId: "snap-1",
    symbol: "BTC",
    timestamp: 5_000,
    fxUsdcUsdtMid: 1,
    fundingRateBps: {
      binance: 1,
      hyperliquid: -1,
    },
    marginAvailableUsdt: {
      binance: 5_000,
      hyperliquid: 5_000,
    },
    books: {
      binance: {
        bestBid: { price: 100_000, quantity: 1 },
        bestAsk: { price: 100_005, quantity: 1 },
      },
      hyperliquid: {
        bestBid: { price: 100_020, quantity: 1 },
        bestAsk: { price: 100_025, quantity: 1 },
      },
    },
    ...overrides,
  });
}

function createSignal(overrides = {}) {
  return createOpportunitySignal({
    signalId: "sig-1",
    symbol: "BTC",
    buyExchange: "binance",
    sellExchange: "hyperliquid",
    observedSpreadBps: 12,
    observedAt: 5_000,
    publishedAt: 5_000,
    ...overrides,
  });
}

describe("precheck service", () => {
  const config = loadExecutionConfig();

  it("信号过期会被拒绝", () => {
    const service = createPrecheckService({
      config,
      clock: new ManualClock(8_000),
    });

    expect(
      service.evaluate({
        signal: createSignal(),
        marketSnapshot: createSnapshot({
          timestamp: 6_800,
        }),
        candidateEdgeBps: 20,
        exchangeLatenciesMs: {
          binance: 100,
          hyperliquid: 100,
        },
      }),
    ).toMatchObject({
      passed: false,
      reasons: ["signal_stale"],
    });
  });

  it("双所盘口延迟超过阈值会被拒绝", () => {
    const service = createPrecheckService({
      config,
      clock: new ManualClock(5_500),
    });

    expect(
      service.evaluate({
        signal: createSignal(),
        marketSnapshot: createSnapshot(),
        candidateEdgeBps: 20,
        exchangeLatenciesMs: {
          binance: 1_600,
          hyperliquid: 1_700,
        },
      }).reasons,
    ).toContain("snapshot_stale");
  });

  it("保证金不足、FX 过期、方向反转、净价差不足会被拒绝", () => {
    const service = createPrecheckService({
      config,
      clock: new ManualClock(6_000),
    });

    const result = service.evaluate({
      signal: createSignal(),
      marketSnapshot: createSnapshot({
        timestamp: 1_000,
        marginAvailableUsdt: {
          binance: 10,
          hyperliquid: 10,
        },
        books: {
          binance: {
            bestBid: { price: 100_030, quantity: 1 },
            bestAsk: { price: 100_040, quantity: 1 },
          },
          hyperliquid: {
            bestBid: { price: 100_020, quantity: 1 },
            bestAsk: { price: 100_025, quantity: 1 },
          },
        },
      }),
      candidateEdgeBps: 1,
      exchangeLatenciesMs: {
        binance: 50,
        hyperliquid: 50,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("fx_stale");
    expect(result.reasons).toContain("insufficient_margin");
    expect(result.reasons).toContain("direction_reversed");
    expect(result.reasons).toContain("edge_below_threshold");
  });
});
