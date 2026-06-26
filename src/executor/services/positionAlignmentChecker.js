/**
 * 仓位对齐校验器。
 *
 * 建仓后校验双腿仓位是否对齐，输出 AlignmentReport。
 * 对齐维度：数量、方向、名义金额。
 */

const EPSILON = 1e-9;

function pctDifference(min, max) {
  if (max <= EPSILON) {
    return 0;
  }
  return ((max - min) / max) * 100;
}

export function checkPositionAlignment({
  buyLeg,
  sellLeg,
  maxImbalancePct = 3,
  notionalWarningThresholdPct = 2,
} = {}) {
  if (!buyLeg || !sellLeg) {
    return {
      aligned: false,
      reason: "missing_leg",
      directionOk: false,
      imbalancePct: null,
      notionalImbalancePct: null,
      needsRebalance: false,
      warnings: ["missing_leg"],
    };
  }

  const buyQty = Number(buyLeg.quantity ?? 0);
  const sellQty = Number(sellLeg.quantity ?? 0);
  const maxQty = Math.max(buyQty, sellQty);
  const imbalancePct = pctDifference(Math.min(buyQty, sellQty), maxQty);

  const buyNotional = Math.abs(Number(buyLeg.notionalUsdt ?? 0));
  const sellNotional = Math.abs(Number(sellLeg.notionalUsdt ?? 0));
  const maxNotional = Math.max(buyNotional, sellNotional);
  const notionalImbalancePct = pctDifference(Math.min(buyNotional, sellNotional), maxNotional);

  const buySide = buyLeg.side;
  const sellSide = sellLeg.side;
  const directionOk =
    buySide && sellSide
      ? (buySide === "long" && sellSide === "short") ||
        (buySide === "short" && sellSide === "long") ||
        (buySide === "buy" && sellSide === "sell") ||
        (buySide === "sell" && sellSide === "buy")
      : true;

  const warnings = [];
  if (imbalancePct > maxImbalancePct) {
    warnings.push(`quantity_imbalance:${imbalancePct.toFixed(4)}%`);
  }
  if (notionalImbalancePct > notionalWarningThresholdPct) {
    warnings.push(`notional_imbalance:${notionalImbalancePct.toFixed(4)}%`);
  }
  if (!directionOk) {
    warnings.push("direction_mismatch");
  }

  const aligned = imbalancePct <= maxImbalancePct && directionOk;

  return {
    aligned,
    directionOk,
    imbalancePct,
    notionalImbalancePct,
    needsRebalance: imbalancePct > maxImbalancePct,
    buyLeg,
    sellLeg,
    warnings,
  };
}
