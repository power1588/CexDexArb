import { describe, expect, it } from "vitest";
import { ManualClock } from "../../src/executor/adapters/runtime.js";
import { loadExecutionConfig } from "../../src/executor/core/config.js";
import { createMarketSnapshot, createOpportunitySignal } from "../../src/executor/domain/models.js";
import { createPlanSelector } from "../../src/executor/services/planSelector.js";
import { createReplayDriver } from "../../src/executor/services/replayDriver.js";

function buildInput(timestamp = 5_000) {
  return {
    signal: createOpportunitySignal({
      signalId: `sig-${timestamp}`,
      symbol: "BTC",
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      observedSpreadBps: 15,
      observedAt: timestamp,
      publishedAt: timestamp,
    }),
    marketSnapshot: createMarketSnapshot({
      snapshotId: `snap-${timestamp}`,
      symbol: "BTC",
      timestamp,
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
    }),
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
  };
}

describe("replay driver", () => {
  const clock = new ManualClock(0);
  const selector = createPlanSelector({
    config: loadExecutionConfig(),
    clock,
  });

  it("回放数据可驱动计划生成", async () => {
    const replayDriver = createReplayDriver({
      clock,
      planSelector: selector,
    });

    const result = await replayDriver.run([
      {
        frameId: "frame-1",
        timestamp: 5_000,
        input: buildInput(5_000),
      },
    ]);

    expect(result[0].accepted).toBe(true);
    expect(result[0].mode).toBe("maker_taker");
  });

  it("固定数据下输出结果稳定可重复", async () => {
    const replayDriver = createReplayDriver({
      clock,
      planSelector: selector,
    });
    const frames = [
      {
        frameId: "frame-1",
        timestamp: 5_000,
        input: buildInput(5_000),
      },
    ];

    const firstRun = await replayDriver.run(frames);
    const secondRun = await replayDriver.run(frames);

    expect(firstRun).toEqual(secondRun);
  });

  it("异常场景回放可重现单腿与滑点问题", async () => {
    const replayDriver = createReplayDriver({
      clock,
      planSelector: selector,
      executor: {
        async executePlan() {
          return {
            success: false,
            state: "FLAT",
            reason: "orphan_leg_incident",
          };
        },
      },
    });

    const result = await replayDriver.run([
      {
        frameId: "frame-1",
        timestamp: 5_000,
        input: buildInput(5_000),
      },
    ]);

    expect(result[0].executionResult.reason).toBe("orphan_leg_incident");
  });

  it("回放测试可重现正常盈利与多种异常场景", async () => {
    const outcomes = [
      { success: true, state: "HEDGED", reason: "profit_target_hit" },
      { success: false, state: "FLAT", reason: "slippage_exceeded" },
      { success: false, state: "FLAT", reason: "connection_lost" },
      { success: false, state: "FLAT", reason: "funding_exit" },
    ];
    let index = 0;
    const replayDriver = createReplayDriver({
      clock,
      planSelector: selector,
      executor: {
        async executePlan() {
          const outcome = outcomes[index];
          index += 1;
          return outcome;
        },
      },
    });

    const result = await replayDriver.run([
      { frameId: "normal", timestamp: 5_000, input: buildInput(5_000) },
      { frameId: "slippage", timestamp: 6_000, input: buildInput(6_000) },
      { frameId: "connection", timestamp: 7_000, input: buildInput(7_000) },
      { frameId: "funding", timestamp: 8_000, input: buildInput(8_000) },
    ]);

    expect(result.map((item) => item.executionResult.reason)).toEqual([
      "profit_target_hit",
      "slippage_exceeded",
      "connection_lost",
      "funding_exit",
    ]);
  });
});
