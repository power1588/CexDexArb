import { evaluateAllExecutionModes, EXECUTION_MODES } from "../core/edge.js";
import { computeTargetNotionalUsdt } from "../core/sizing.js";
import { createExecutionPlan } from "../domain/models.js";
import { createModeScorer } from "./modeScorer.js";
import { createPrecheckService } from "./precheckService.js";

function getTopOfBookPrices(signal, marketSnapshot) {
  return {
    buyPrice: marketSnapshot.books?.[signal.buyExchange]?.bestAsk?.price ?? null,
    sellPrice: marketSnapshot.books?.[signal.sellExchange]?.bestBid?.price ?? null,
  };
}

function toModeLegs(signal, mode, quantity, prices) {
  const buyRole =
    mode === EXECUTION_MODES.MAKER_TAKER || mode === EXECUTION_MODES.MAKER_MAKER
      ? "maker"
      : "taker";
  const sellRole =
    mode === EXECUTION_MODES.TAKER_MAKER || mode === EXECUTION_MODES.MAKER_MAKER
      ? "maker"
      : "taker";

  return [
    {
      exchange: signal.buyExchange,
      side: "buy",
      symbol: signal.symbol,
      quoteCurrency: "USDT",
      orderType: buyRole === "maker" ? "limit" : "ioc",
      price: prices.buyPrice,
      quantity,
    },
    {
      exchange: signal.sellExchange,
      side: "sell",
      symbol: signal.symbol,
      quoteCurrency: "USDT",
      orderType: sellRole === "maker" ? "limit" : "ioc",
      price: prices.sellPrice,
      quantity,
    },
  ];
}

export function createPlanSelector({
  config,
  clock = { now: () => Date.now() },
  precheckService = createPrecheckService({ config, clock }),
  modeScorer = createModeScorer(),
} = {}) {
  return {
    selectPlan({
      signal,
      marketSnapshot,
      desiredNotionalUsdt,
      orderBookCapacityUsdt,
      maxExposureUsdt,
      depthScoreByExchange,
      queueScoreByExchange,
      hedgeReliabilityByExchange,
      adverseSelectionRiskByExchange,
    } = {}) {
      const prices = getTopOfBookPrices(signal, marketSnapshot);
      const sizing = computeTargetNotionalUsdt({
        desiredNotionalUsdt,
        orderBookCapacityUsdt,
        maxMarginLimitedNotionalUsdt:
          Math.min(
            marketSnapshot.marginAvailableUsdt?.binance ?? 0,
            marketSnapshot.marginAvailableUsdt?.hyperliquid ?? 0,
          ) * config.defaultLeverage,
        maxExposureUsdt,
        minOrderNotionalUsdt: config.minOrderNotionalUsdt,
      });

      if (!sizing.executable) {
        return {
          accepted: false,
          reason: sizing.reason,
        };
      }

      const quantity = sizing.targetNotionalUsdt / prices.buyPrice;
      const modeEvaluations = evaluateAllExecutionModes({
        buyExchange: signal.buyExchange,
        sellExchange: signal.sellExchange,
        buyPrice: prices.buyPrice,
        sellPrice: prices.sellPrice,
        quantity,
        feeBpsByExchange: {
          binance: {
            maker: config.exchanges.binance.feeBps.maker,
            taker: config.exchanges.binance.feeBps.taker,
          },
          hyperliquid: {
            maker: config.exchanges.hyperliquid.feeBps.maker,
            taker: config.exchanges.hyperliquid.feeBps.taker,
          },
        },
        makerBufferBps: config.makerBufferBps,
        dualMakerBufferBps: config.dualMakerBufferBps,
      });
      const expectedEdgeByMode = Object.fromEntries(
        modeEvaluations.map((evaluation) => [evaluation.mode, evaluation.expectedNetEdgeBps]),
      );
      const strongestModeEdge = Math.max(
        ...modeEvaluations
          .map((evaluation) => evaluation.expectedNetEdgeBps)
          .filter(Number.isFinite),
      );
      const precheck = precheckService.evaluate({
        signal,
        marketSnapshot,
        candidateEdgeBps: strongestModeEdge,
        exchangeLatenciesMs: {
          [signal.buyExchange]: clock.now() - marketSnapshot.timestamp,
          [signal.sellExchange]: clock.now() - marketSnapshot.timestamp,
        },
        makerBufferBps: config.makerBufferBps,
      });

      if (!precheck.passed) {
        return {
          accepted: false,
          reason: precheck.reasons[0],
          precheck,
        };
      }

      const scoredModes = modeScorer.score({
        buyExchange: signal.buyExchange,
        sellExchange: signal.sellExchange,
        expectedEdgeByMode,
        depthScoreByExchange,
        queueScoreByExchange,
        hedgeReliabilityByExchange,
        adverseSelectionRiskByExchange,
      });

      const selectedEvaluation = modeEvaluations
        .filter(
          (evaluation) =>
            evaluation.executable &&
            evaluation.expectedNetEdgeBps >= precheck.effectiveOpenThresholdBps,
        )
        .sort((left, right) => {
          const rightScore =
            scoredModes.scores.find((item) => item.mode === right.mode)?.score ?? -Infinity;
          const leftScore =
            scoredModes.scores.find((item) => item.mode === left.mode)?.score ?? -Infinity;
          return rightScore - leftScore;
        })[0];

      if (!selectedEvaluation) {
        return {
          accepted: false,
          reason: "no_executable_mode",
          precheck,
          modeEvaluations,
          scoredModes,
        };
      }

      return {
        accepted: true,
        plan: createExecutionPlan({
          planId: `plan-${signal.signalId}`,
          signalId: signal.signalId,
          symbol: signal.symbol,
          mode: selectedEvaluation.mode,
          targetNotionalUsdt: sizing.targetNotionalUsdt,
          expectedNetEdgeBps: selectedEvaluation.expectedNetEdgeBps,
          riskBudget: {
            maxUnhedgedMs: config.maxUnhedgedMs,
            maxSlippageBps: config.maxTakerSlippageBps,
          },
          legs: toModeLegs(signal, selectedEvaluation.mode, quantity, prices),
          parameterSnapshot: {
            effectiveOpenThresholdBps: precheck.effectiveOpenThresholdBps,
            fxUsdcUsdtMid: marketSnapshot.fxUsdcUsdtMid,
          },
        }),
        modeEvaluations,
        scoredModes,
      };
    },
  };
}
