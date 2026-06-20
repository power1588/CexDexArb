import { createRiskEvent } from "../domain/models.js";

export function createRiskEventReporter({
  clock = { now: () => Date.now() },
  eventBus,
  logger,
  notifier,
} = {}) {
  return {
    record({
      riskEventId,
      type,
      severity,
      symbol,
      planId,
      message,
      context,
    } = {}) {
      const event = createRiskEvent({
        riskEventId: riskEventId ?? `${type}-${clock.now()}`,
        type,
        severity,
        symbol,
        planId,
        timestamp: clock.now(),
        message,
        context,
      });

      eventBus?.publish("risk_event", event);
      if (severity === "critical" || severity === "high") {
        logger?.error(type, event);
      } else {
        logger?.warn(type, event);
      }

      notifier?.notify?.({
        priority: severity === "critical" || severity === "high" ? "high" : "normal",
        event,
      });

      return event;
    },
  };
}
