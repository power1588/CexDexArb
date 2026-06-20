export function createModeGuard({
  config,
} = {}) {
  return {
    wrapOrderRouter(orderRouter) {
      return {
        async placeOrder(intent, template) {
          if (config.environment !== "live") {
            return {
              simulated: true,
              status: "simulated",
              exchange: intent.exchange,
              template,
            };
          }

          if (config.liveTradingEnabled !== true) {
            throw new Error("live_trading_not_enabled");
          }

          return orderRouter.placeOrder(intent, template);
        },
      };
    },
    validateModeSwitch({
      adapterMode,
      riskMode,
      notifierConfigured,
    } = {}) {
      if (config.environment === "live" && config.liveTradingEnabled !== true) {
        return {
          passed: false,
          reason: "live_guard_not_enabled",
        };
      }

      if (adapterMode && adapterMode !== config.environment) {
        return {
          passed: false,
          reason: "adapter_mode_mismatch",
        };
      }

      if (riskMode && riskMode !== config.environment) {
        return {
          passed: false,
          reason: "risk_mode_mismatch",
        };
      }

      if (!notifierConfigured && config.environment === "live") {
        return {
          passed: false,
          reason: "missing_notifier",
        };
      }

      return {
        passed: true,
      };
    },
  };
}
