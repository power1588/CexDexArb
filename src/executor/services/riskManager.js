export function createRiskManager({
  config,
  orderRouter,
  riskEventReporter,
  clock = { now: () => Date.now() },
} = {}) {
  const cooldowns = new Map();

  return {
    evaluateSlippage({ slippageBps } = {}) {
      return {
        allowChase: Number(slippageBps) <= config.maxTakerSlippageBps,
        reason:
          Number(slippageBps) <= config.maxTakerSlippageBps
            ? null
            : "slippage_exceeded",
      };
    },
    async handleConnectionLost({ symbol, planId, openOrders = [] } = {}) {
      for (const order of openOrders) {
        await orderRouter.cancelOrder({
          exchange: order.exchange,
          orderId: order.orderId,
        });
      }

      return riskEventReporter.record({
        type: "connection_lost",
        severity: "high",
        symbol,
        planId,
        message: "exchange connection lost",
        context: {
          openOrderCount: openOrders.length,
        },
      });
    },
    evaluateMargin({ availableMarginUsdt, hasOpenPosition = false } = {}) {
      const minimumRequiredMargin = config.minOrderNotionalUsdt / config.defaultLeverage;
      const sufficient = Number(availableMarginUsdt) >= minimumRequiredMargin;

      return {
        allowOpen: sufficient,
        shouldExit: hasOpenPosition && !sufficient,
        reason: sufficient ? null : "insufficient_margin",
      };
    },
    registerSymbolCooldown(symbol) {
      cooldowns.set(symbol, clock.now() + config.symbolCooldownAfterOrphanSec * 1000);
      return cooldowns.get(symbol);
    },
    isSymbolCoolingDown(symbol) {
      const cooldownUntil = cooldowns.get(symbol);
      return Number.isFinite(cooldownUntil) && cooldownUntil > clock.now();
    },
  };
}
