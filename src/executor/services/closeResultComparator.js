/**
 * 平仓成交对比器。
 *
 * 将平仓实际成交价与平仓信号预期做对比，输出偏差与净收益。
 *
 * 净收益 = 开仓锁定价差 + 实际平仓价差 - 平仓双边费率
 *   （实际平仓价差为正表示平仓时仍获得价差，为负表示平仓时付出成本）
 */

export function compareCloseResult({
  closeSignal,
  closeExecution,
  openLockedSpread,
  feeCostUsdt = 0,
} = {}) {
  const makerFill = closeExecution?.makerFill ?? {};
  const takerFill = closeExecution?.takerFill ?? {};

  const makerPrice = Number(makerFill.price ?? 0);
  const takerPrice = Number(takerFill.price ?? 0);
  const quantity = Math.min(
    Number(makerFill.quantity ?? 0),
    Number(takerFill.quantity ?? 0),
  );

  // 实际平仓价差 = taker 成交价 - maker 成交价
  const actualSpreadPerUnit = takerPrice - makerPrice;
  const actualSpreadUsdt = actualSpreadPerUnit * quantity;

  const expectedSpreadUsdt = Number(closeSignal?.expectedSpreadUsdt ?? 0);
  const expectedSpreadBps = Number(closeSignal?.expectedSpreadBps ?? 0);
  const deviationUsdt = expectedSpreadUsdt - actualSpreadUsdt;

  // 滑点拆分：相对预期价格
  const expectedMakerPrice = Number(
    closeSignal?.legs?.find((l) => l.role === "maker")?.price ?? makerPrice,
  );
  const expectedTakerPrice = Number(
    closeSignal?.legs?.find((l) => l.role === "taker")?.price ?? takerPrice,
  );
  const makerSlippageUsdt = (makerPrice - expectedMakerPrice) * quantity;
  const takerSlippageUsdt = (takerPrice - expectedTakerPrice) * quantity;

  // 净收益 = 开仓锁定 + 实际平仓价差 - 平仓费率
  const openLockedUsdt = Number(openLockedSpread?.netSpreadUsdt ?? 0);
  const netProfitUsdt = openLockedUsdt + actualSpreadUsdt - feeCostUsdt;

  const referencePrice = Math.max(makerPrice, takerPrice);
  const actualSpreadBps =
    referencePrice > 0 ? (actualSpreadPerUnit / referencePrice) * 10_000 : 0;

  return {
    expectedSpreadUsdt,
    expectedSpreadBps,
    actualSpreadUsdt,
    actualSpreadBps,
    actualSpreadPerUnit,
    deviationUsdt,
    makerSlippageUsdt,
    takerSlippageUsdt,
    feeCostUsdt,
    openLockedSpreadUsdt: openLockedUsdt,
    netProfitUsdt,
    quantity,
  };
}
