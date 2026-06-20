import { createOpportunitySignal } from "../domain/models.js";

export function createRedisOpportunityConsumer({
  logger,
  clock = { now: () => Date.now() },
  dedupeWindowMs = 5_000,
} = {}) {
  const seenSignals = new Map();

  function pruneExpired(now) {
    for (const [key, timestamp] of seenSignals.entries()) {
      if (now - timestamp > dedupeWindowMs) {
        seenSignals.delete(key);
      }
    }
  }

  return {
    consume(rawMessage) {
      const now = clock.now();
      pruneExpired(now);

      let payload;
      try {
        payload = JSON.parse(rawMessage);
      } catch {
        logger?.warn("invalid_signal_payload", {
          rawMessage,
        });

        return {
          accepted: false,
          reason: "invalid_json",
        };
      }

      let signal;
      try {
        signal = createOpportunitySignal(payload);
      } catch (error) {
        logger?.warn("invalid_signal_schema", {
          error: error.message,
        });

        return {
          accepted: false,
          reason: "invalid_schema",
        };
      }

      const dedupeKey = payload.dedupeKey ?? signal.signalId;
      if (seenSignals.has(dedupeKey)) {
        logger?.info("duplicate_signal_skipped", {
          dedupeKey,
        });

        return {
          accepted: false,
          reason: "duplicate_signal",
        };
      }

      seenSignals.set(dedupeKey, now);
      logger?.info("signal_received", {
        signalId: signal.signalId,
        symbol: signal.symbol,
      });

      return {
        accepted: true,
        signal,
      };
    },
  };
}
