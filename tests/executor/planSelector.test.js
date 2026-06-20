import { describe, expect, it } from "vitest";
import { ManualClock } from "../../src/executor/adapters/runtime.js";
import { loadExecutionConfig } from "../../src/executor/core/config.js";
import { EXECUTION_MODES } from "../../src/executor/core/edge.js";
import { createMarketSnapshot, createOpportunitySignal } from "../../src/executor/domain/models.js";
import { createPlanSelector } from "../../src/executor/services/planSelector.js";

function buildSignal() {
  return createOpportunitySignal({
    signalId: "sig-1",
    symbol: "BTC",
    buyExchange: "binance",
    sellExchange: "hyperliquid",
    observedSpreadBps: 15,
    observedAt: 5_000,
    publishedAt: 5_000,
  });
}

function buildSnapshot() {
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
        bestBid: { price: 100_220, quantity: 1 },
        bestAsk: { price: 100_230, quantity: 1 },
      },
    },
  });
}

describe("plan selector", () => {
  const config = loadExecutionConfig();
  const selector = createPlanSelector({
    config,
    clock: new ManualClock(5_100),
  });

  it("会从四种模式中选择最优可执行方案", () => {
    const result = selector.selectPlan({
      signal: buildSignal(),
      marketSnapshot: buildSnapshot(),
      desiredNotionalUsdt: 2_000,
      orderBookCapacityUsdt: 2_500,
      maxExposureUsdt: 3_000,
      depthScoreByExchange: {
        binance: 0.7,
        hyperliquid: 0.9,
      },
      queueScoreByExchange: {
        binance: 0.8,
        hyperliquid: 0.3,
      },
      hedgeReliabilityByExchange: {
        binance: 0.5,
        hyperliquid: 0.9,
      },
      adverseSelectionRiskByExchange: {
        binance: 0.1,
        hyperliquid: 0.1,
      },
    });

    expect(result.accepted).toBe(true);
    expect(result.plan.mode).toBe(EXECUTION_MODES.MAKER_TAKER);
  });

  it("所有模式都不满足时返回拒绝执行", () => {
    const result = selector.selectPlan({
      signal: buildSignal(),
      marketSnapshot: buildSnapshot(),
      desiredNotionalUsdt: 50,
      orderBookCapacityUsdt: 50,
      maxExposureUsdt: 50,
      depthScoreByExchange: {
        binance: 0.2,
        hyperliquid: 0.2,
      },
      queueScoreByExchange: {
        binance: 0.2,
        hyperliquid: 0.2,
      },
      hedgeReliabilityByExchange: {
        binance: 0.2,
        hyperliquid: 0.2,
      },
      adverseSelectionRiskByExchange: {
        binance: 0.5,
        hyperliquid: 0.5,
      },
    });

    expect(result.accepted).toBe(false);
  });

  it("选择结果会附带参数快照和风险预算", () => {
    const result = selector.selectPlan({
      signal: buildSignal(),
      marketSnapshot: buildSnapshot(),
      desiredNotionalUsdt: 2_000,
      orderBookCapacityUsdt: 2_500,
      maxExposureUsdt: 3_000,
      depthScoreByExchange: {
        binance: 0.7,
        hyperliquid: 0.9,
      },
      queueScoreByExchange: {
        binance: 0.8,
        hyperliquid: 0.3,
      },
      hedgeReliabilityByExchange: {
        binance: 0.5,
        hyperliquid: 0.9,
      },
      adverseSelectionRiskByExchange: {
        binance: 0.1,
        hyperliquid: 0.1,
      },
    });

    expect(result.plan.parameterSnapshot.fxUsdcUsdtMid).toBe(1);
    expect(result.plan.riskBudget.maxUnhedgedMs).toBe(config.maxUnhedgedMs);
  });
});
