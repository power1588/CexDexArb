import { ensureFreshFxQuote } from "../core/fx.js";
import { computeEffectiveOpenThresholdBps } from "../core/sizing.js";

function getLegPrices(signal, marketSnapshot) {
  const buyVenueBook = marketSnapshot?.books?.[signal.buyExchange];
  const sellVenueBook = marketSnapshot?.books?.[signal.sellExchange];

  return {
    currentBuyPrice: buyVenueBook?.bestAsk?.price ?? null,
    currentSellPrice: sellVenueBook?.bestBid?.price ?? null,
  };
}

function minAvailableMargin(marketSnapshot) {
  const margins = Object.values(marketSnapshot?.marginAvailableUsdt ?? {}).filter(Number.isFinite);
  return margins.length > 0 ? Math.min(...margins) : null;
}

export function createPrecheckService({
  config,
  clock = { now: () => Date.now() },
} = {}) {
  return {
    evaluate({
      signal,
      marketSnapshot,
      candidateEdgeBps,
      exchangeLatenciesMs = {},
      makerBufferBps = 0,
    } = {}) {
      const now = clock.now();
      const reasons = [];
      const effectiveThreshold = computeEffectiveOpenThresholdBps({
        minOpenBps: config.minOpenBps,
        fxPenaltyBps: 0,
        latencyPenaltyBps: Math.max(...Object.values(exchangeLatenciesMs), 0) / 1000,
        orphanRiskBps: 1,
        makerBufferBps,
      });

      if (now - signal.publishedAt > config.maxSignalAgeMs) {
        reasons.push("signal_stale");
      }

      if (
        Object.values(exchangeLatenciesMs).some(
          (latencyMs) => Number.isFinite(latencyMs) && latencyMs > config.maxSnapshotAgeMs,
        )
      ) {
        reasons.push("snapshot_stale");
      }

      if (
        ensureFreshFxQuote({
          fxUsdcUsdtMid: marketSnapshot.fxUsdcUsdtMid,
          timestamp: marketSnapshot.timestamp,
          maxAgeMs: config.maxSnapshotAgeMs,
          now,
        }).executable !== true
      ) {
        reasons.push("fx_stale");
      }

      const margin = minAvailableMargin(marketSnapshot);
      if (!Number.isFinite(margin) || margin < config.minOrderNotionalUsdt / config.defaultLeverage) {
        reasons.push("insufficient_margin");
      }

      const { currentBuyPrice, currentSellPrice } = getLegPrices(signal, marketSnapshot);
      if (
        !Number.isFinite(currentBuyPrice) ||
        !Number.isFinite(currentSellPrice) ||
        currentSellPrice <= currentBuyPrice
      ) {
        reasons.push("direction_reversed");
      }

      if (
        !effectiveThreshold.executable ||
        !Number.isFinite(candidateEdgeBps) ||
        candidateEdgeBps < effectiveThreshold.effectiveOpenThresholdBps
      ) {
        reasons.push("edge_below_threshold");
      }

      return {
        passed: reasons.length === 0,
        reasons,
        effectiveOpenThresholdBps: effectiveThreshold.effectiveOpenThresholdBps,
        suggestedAction:
          reasons.length === 0
            ? "proceed"
            : reasons.includes("edge_below_threshold") && !reasons.includes("insufficient_margin")
              ? "shrink"
              : "reject",
      };
    },
  };
}
