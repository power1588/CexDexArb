/**
 * 建仓成交归集器。
 *
 * 把 maker 腿和 taker 腿的成交回报归集为统一的 OpenResult，
 * 便于后续做仓位对齐校验、锁定价差计算与信号对比。
 */

const EPSILON = 1e-9;

function computeLegSummary(leg) {
  const fills = leg?.fills ?? [];
  let totalQuantity = 0;
  let totalNotional = 0;
  let totalFee = 0;

  for (const fill of fills) {
    const qty = Number(fill.quantity ?? 0);
    const price = Number(fill.price ?? 0);
    totalQuantity += qty;
    totalNotional += qty * price;
    totalFee += Number(fill.feeUsdt ?? 0);
  }

  const weightedAvgPrice = totalQuantity > EPSILON ? totalNotional / totalQuantity : 0;

  return {
    exchange: leg?.exchange,
    side: leg?.side,
    totalQuantity,
    totalNotional,
    weightedAvgPrice,
    totalFee,
    fillCount: fills.length,
  };
}

export function aggregateOpenFills({ buyLeg, sellLeg } = {}) {
  const buySummary = computeLegSummary(buyLeg);
  const sellSummary = computeLegSummary(sellLeg);

  const totalBuyQuantity = buySummary.totalQuantity;
  const totalSellQuantity = sellSummary.totalQuantity;
  const diff = totalBuyQuantity - totalSellQuantity;

  const hasNakedExposure = Math.abs(diff) > EPSILON;
  const nakedExposureQuantity = hasNakedExposure ? Math.abs(diff) : 0;
  const nakedExposureSide = diff > 0 ? "buy" : diff < 0 ? "sell" : null;

  return {
    buyLeg: buySummary,
    sellLeg: sellSummary,
    totalBuyQuantity,
    totalSellQuantity,
    buyWeightedAvgPrice: buySummary.weightedAvgPrice,
    sellWeightedAvgPrice: sellSummary.weightedAvgPrice,
    totalFeeUsdt: buySummary.totalFee + sellSummary.totalFee,
    hasNakedExposure,
    nakedExposureQuantity,
    nakedExposureSide,
  };
}
