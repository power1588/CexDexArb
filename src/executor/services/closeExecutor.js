function closeSide(side) {
  return side === "long" ? "sell" : "buy";
}

function toCloseIntent(leg) {
  return {
    exchange: leg.exchange,
    symbol: leg.symbol ?? leg.exchangeSymbol ?? leg.symbol,
    side: closeSide(leg.side),
    orderType: "limit",
    quantity: leg.quantity,
    price: leg.markPrice,
    tif: "IOC",
    role: "taker",
  };
}

export function createCloseExecutor({
  orderRouter,
  riskEventReporter,
} = {}) {
  return {
    async execute({
      planId,
      positionSnapshot,
      executionPath = "normal",
    } = {}) {
      const legs =
        executionPath === "emergency"
          ? [...positionSnapshot.legs].sort(
              (left, right) => Math.abs(right.notionalUsdt) - Math.abs(left.notionalUsdt),
            )
          : [...positionSnapshot.legs];
      const orders = [];

      for (const leg of legs) {
        const intent = toCloseIntent(leg);

        try {
          const result = await orderRouter.placeOrder(intent, "hedge_ioc");
          orders.push(result);
        } catch {
          try {
            const retryResult = await orderRouter.placeOrder(intent, "hedge_ioc");
            orders.push(retryResult);
          } catch (retryError) {
            riskEventReporter?.record({
              type: "close_execution_failed",
              severity: "high",
              symbol: positionSnapshot.symbol,
              planId,
              message: retryError.message,
              context: {
                exchange: leg.exchange,
              },
            });

            return {
              closed: false,
              orders,
              error: retryError,
            };
          }
        }
      }

      return {
        closed: true,
        orders,
      };
    },
  };
}
