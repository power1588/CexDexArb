export function createPartialFillHandler({
  orderRouter,
} = {}) {
  return {
    async handle({
      makerOrder,
      hedgeLeg,
      targetQuantity,
      filledQuantity,
    } = {}) {
      const normalizedFilledQuantity = Number(filledQuantity);
      const normalizedTargetQuantity = Number(targetQuantity);
      const remainingQuantity = Math.max(normalizedTargetQuantity - normalizedFilledQuantity, 0);
      const hedgeIntent = {
        ...hedgeLeg,
        quantity: normalizedFilledQuantity,
      };

      if (remainingQuantity > 0 && makerOrder?.orderId) {
        await orderRouter?.cancelOrder({
          exchange: makerOrder.exchange,
          orderId: makerOrder.orderId,
        });
      }

      return {
        hedgeIntent,
        hedgeQuantity: normalizedFilledQuantity,
        remainingQuantity,
        shouldCancelRemaining: remainingQuantity > 0,
      };
    },
  };
}
