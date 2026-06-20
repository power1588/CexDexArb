export function createStartupChecklist({
  config,
} = {}) {
  return {
    run({
      notifierConfigured = false,
      riskParametersPresent = true,
      replayValidated = false,
      simulationValidated = false,
    } = {}) {
      const blockers = [];
      const warnings = [];

      if (!riskParametersPresent) {
        blockers.push("missing_risk_parameters");
      }

      if (config.environment === "live") {
        if (config.liveTradingEnabled !== true) {
          blockers.push("live_guard_not_enabled");
        }
        if (!replayValidated || !simulationValidated) {
          blockers.push("validation_incomplete");
        }
        if (!notifierConfigured) {
          blockers.push("missing_notifier");
        }
      } else if (!notifierConfigured) {
        warnings.push("notifier_not_configured");
      }

      return {
        passed: blockers.length === 0,
        blockers,
        warnings,
      };
    },
  };
}
