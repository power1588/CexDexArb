/**
 * maker-taker 平仓执行器。
 *
 * 按 maker -> taker 顺序执行双腿平仓：
 * - maker 平仓腿先挂单，成交后触发 taker 平仓腿。
 * - maker 部分成交时只对已成交部分做反向 taker 腿。
 * - maker 完全未成交时进入紧急平仓（直接对双腿用 taker 平仓）。
 *
 * 复用现有 OrderRouter。
 */

const EPSILON = 1e-9;

function isFilled(orderUpdate) {
  return (
    ["filled", "closed"].includes(orderUpdate.status) ||
    Number(orderUpdate.filledQuantity ?? 0) > EPSILON
  );
}

export function createMakerTakerCloseExecutor({
  orderRouter,
  riskEventReporter,
} = {}) {
  async function placeLeg(leg, template) {
    return orderRouter.placeOrder(
      {
        exchange: leg.exchange,
        symbol: leg.symbol,
        side: leg.side,
        orderType: template === "maker" ? "limit" : "ioc",
        price: leg.price,
        quantity: leg.quantity,
      },
      template,
    );
  }

  return {
    async execute({
      planId,
      positionSnapshot,
      closeSignal,
      executionPath: forcedPath,
    } = {}) {
      const legs = closeSignal?.legs ?? [];
      const makerLeg = legs.find((l) => l.role === "maker");
      const takerLeg = legs.find((l) => l.role === "taker");

      if (!makerLeg || !takerLeg) {
        // 没有明确 maker/taker 划分，退化为双腿 taker 平仓
        const orders = [];
        for (const leg of legs) {
          const result = await placeLeg(leg, "hedge_ioc");
          orders.push(result);
        }
        return {
          closed: orders.every(isFilled),
          orders,
          executionPath: forcedPath ?? "normal",
        };
      }

      const makerResult = await placeLeg(makerLeg, "maker");
      const makerFilled = Number(makerResult.filledQuantity ?? 0);

      if (makerFilled <= EPSILON) {
        // maker 未成交，进入紧急平仓
        riskEventReporter?.record({
          type: "close_maker_not_filled",
          severity: "high",
          symbol: positionSnapshot?.symbol,
          planId,
          message: "maker 平仓腿未成交，进入紧急 taker 平仓",
          context: { makerResult },
        });

        const emergencyMaker = await placeLeg(makerLeg, "hedge_ioc");
        const emergencyTaker = await placeLeg(takerLeg, "hedge_ioc");
        return {
          closed: isFilled(emergencyMaker) && isFilled(emergencyTaker),
          orders: [makerResult, emergencyMaker, emergencyTaker],
          executionPath: "emergency",
        };
      }

      // maker 部分或全部成交，taker 只对已成交部分做反向
      const takerQuantity = Math.min(makerFilled, Number(takerLeg.quantity ?? 0));
      const takerResult = await placeLeg(
        { ...takerLeg, quantity: takerQuantity },
        "hedge_ioc",
      );

      const targetQuantity = Number(makerLeg.quantity ?? 0);
      const filledTotal = Math.min(
        Number(takerResult.filledQuantity ?? 0),
        makerFilled,
      );
      const remainingQuantity = Math.max(targetQuantity - makerFilled, 0);

      return {
        closed: filledTotal > EPSILON && remainingQuantity <= EPSILON,
        orders: [makerResult, takerResult],
        executionPath: forcedPath ?? "normal",
        filledQuantity: filledTotal,
        remainingQuantity,
      };
    },
  };
}
