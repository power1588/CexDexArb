import { describe, expect, it } from "vitest";
import { EXECUTION_MODES } from "../../src/executor/core/edge.js";
import { scoreExecutionModes } from "../../src/executor/services/modeScorer.js";

describe("mode scorer", () => {
  it("深度更强的一侧优先作为对冲腿", () => {
    const result = scoreExecutionModes({
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      expectedEdgeByMode: {
        [EXECUTION_MODES.MAKER_TAKER]: 9,
        [EXECUTION_MODES.TAKER_MAKER]: 9,
      },
      depthScoreByExchange: {
        binance: 0.4,
        hyperliquid: 0.9,
      },
      queueScoreByExchange: {
        binance: 0.8,
        hyperliquid: 0.3,
      },
      hedgeReliabilityByExchange: {
        binance: 0.3,
        hyperliquid: 0.9,
      },
      adverseSelectionRiskByExchange: {
        binance: 0.1,
        hyperliquid: 0.2,
      },
    });

    expect(result.recommendedMode).toBe(EXECUTION_MODES.MAKER_TAKER);
  });

  it("排队更优的一侧优先作为 maker 腿", () => {
    const result = scoreExecutionModes({
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      expectedEdgeByMode: {
        [EXECUTION_MODES.MAKER_TAKER]: 8,
        [EXECUTION_MODES.TAKER_MAKER]: 8,
      },
      depthScoreByExchange: {
        binance: 0.7,
        hyperliquid: 0.7,
      },
      queueScoreByExchange: {
        binance: 0.9,
        hyperliquid: 0.2,
      },
      hedgeReliabilityByExchange: {
        binance: 0.5,
        hyperliquid: 0.5,
      },
      adverseSelectionRiskByExchange: {
        binance: 0.1,
        hyperliquid: 0.1,
      },
    });

    expect(result.recommendedMode).toBe(EXECUTION_MODES.MAKER_TAKER);
  });

  it("两边深度不足时返回放弃", () => {
    expect(
      scoreExecutionModes({
        buyExchange: "binance",
        sellExchange: "hyperliquid",
        depthScoreByExchange: {
          binance: 0.2,
          hyperliquid: 0.1,
        },
      }),
    ).toMatchObject({
      recommendedMode: null,
      rejectionReason: "insufficient_depth",
    });
  });

  it("默认不将双 maker 作为主模式", () => {
    const result = scoreExecutionModes({
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      expectedEdgeByMode: {
        [EXECUTION_MODES.MAKER_TAKER]: 9,
        [EXECUTION_MODES.MAKER_MAKER]: 10,
      },
      depthScoreByExchange: {
        binance: 0.9,
        hyperliquid: 0.9,
      },
      queueScoreByExchange: {
        binance: 0.9,
        hyperliquid: 0.9,
      },
      hedgeReliabilityByExchange: {
        binance: 0.9,
        hyperliquid: 0.9,
      },
      adverseSelectionRiskByExchange: {
        binance: 0.1,
        hyperliquid: 0.1,
      },
    });

    expect(result.recommendedMode).not.toBe(EXECUTION_MODES.MAKER_MAKER);
  });
});
