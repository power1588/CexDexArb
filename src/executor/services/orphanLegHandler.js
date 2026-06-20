export function createOrphanLegHandler({
  orderRouter,
  riskManager,
  riskEventReporter,
  clock = { now: () => Date.now() },
  config,
} = {}) {
  return {
    async handle({
      symbol,
      planId,
      orphanOrder,
      hedgeLeg,
      netExposureQuantity,
    } = {}) {
      const netExposure = Number(netExposureQuantity);

      if (orphanOrder?.orderId) {
        await orderRouter.cancelOrder({
          exchange: orphanOrder.exchange,
          orderId: orphanOrder.orderId,
        });
      }

      try {
        const hedgeResult = await orderRouter.placeOrder(
          {
            ...hedgeLeg,
            quantity: netExposure,
          },
          "hedge_ioc",
        );

        if (hedgeResult.filledQuantity >= netExposure) {
          return {
            hedged: true,
            netExposure,
            hedgeResult,
          };
        }
      } catch {
        // 延续到下面统一事件与冷却处理
      }

      riskManager?.registerSymbolCooldown(symbol);
      const cooldownUntil = clock.now() + config.symbolCooldownAfterOrphanSec * 1000;
      const riskEvent = riskEventReporter?.record({
        type: "orphan_leg_incident",
        severity: "high",
        symbol,
        planId,
        message: "orphan leg hedge failed",
        context: {
          netExposure,
          cooldownUntil,
        },
      });

      return {
        hedged: false,
        netExposure,
        cooldownUntil,
        riskEvent,
      };
    },
  };
}
