export function createExitRuleEngine() {
  return {
    evaluate({
      targetExitReached = false,
      holdingDurationMs = 0,
      maxHoldingDurationMs = Infinity,
      fundingDirection = "neutral",
      riskEvents = [],
    } = {}) {
      const hasRiskExitEvent = riskEvents.some((event) =>
        ["high", "critical"].includes(event.severity),
      );

      if (hasRiskExitEvent) {
        return {
          shouldExit: true,
          reason: "risk_exit",
          priority: 1,
          executionPath: "emergency",
        };
      }

      if (targetExitReached) {
        return {
          shouldExit: true,
          reason: "target_exit",
          priority: 2,
          executionPath: "normal",
        };
      }

      if (holdingDurationMs > maxHoldingDurationMs) {
        return {
          shouldExit: true,
          reason: "time_exit",
          priority: 3,
          executionPath: "normal",
        };
      }

      if (fundingDirection === "adverse") {
        return {
          shouldExit: true,
          reason: "funding_exit",
          priority: 4,
          executionPath: "normal",
        };
      }

      return {
        shouldExit: false,
        reason: null,
        priority: null,
        executionPath: null,
      };
    },
  };
}
