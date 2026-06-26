/**
 * 实际锁定价差计算器。
 *
 * 基于实际成交价计算真正锁定的价差，折算到统一 USDT 口径，
 * 扣除实际双边费率后得到净锁定价差。
 */

const BPS_PER_UNIT = 10_000;

function bpsToFraction(bps) {
  return bps / BPS_PER_UNIT;
}

export function computeLockedSpread({
  buyExchange,
  buyPrice,
  sellExchange,
  sellPrice,
  quantity,
  fxUsdcUsdtMid = 1.0,
  buyFeeBps = 0,
  sellFeeBps = 0,
  // sellExchange 若是 hyperliquid，默认成交价以 USDC 计价，需要折算
  sellQuoteCurrency = "USDC",
  buyQuoteCurrency = "USDT",
} = {}) {
  // 把卖出价折算到 USDT
  const sellPriceUsdt =
    sellQuoteCurrency === "USDC" ? sellPrice * fxUsdcUsdtMid : sellPrice;
  const buyPriceUsdt =
    buyQuoteCurrency === "USDC" ? buyPrice * fxUsdcUsdtMid : buyPrice;

  const grossSpreadPerUnit = sellPriceUsdt - buyPriceUsdt;
  const grossSpreadUsdt = grossSpreadPerUnit * quantity;

  const buyFeeCostUsdt = buyPriceUsdt * quantity * bpsToFraction(buyFeeBps);
  const sellFeeCostUsdt = sellPriceUsdt * quantity * bpsToFraction(sellFeeBps);
  const feeCostUsdt = buyFeeCostUsdt + sellFeeCostUsdt;

  const netSpreadUsdt = grossSpreadUsdt - feeCostUsdt;

  const referenceNotionalUsdt = Math.max(
    buyPriceUsdt * quantity,
    sellPriceUsdt * quantity,
  );
  const grossSpreadBps =
    referenceNotionalUsdt > 0
      ? (grossSpreadUsdt / referenceNotionalUsdt) * BPS_PER_UNIT
      : 0;
  const netSpreadBps =
    referenceNotionalUsdt > 0
      ? (netSpreadUsdt / referenceNotionalUsdt) * BPS_PER_UNIT
      : 0;

  return {
    buyExchange,
    sellExchange,
    buyPriceUsdt,
    sellPriceUsdt,
    quantity,
    grossSpreadUsdt,
    feeCostUsdt,
    buyFeeCostUsdt,
    sellFeeCostUsdt,
    netSpreadUsdt,
    grossSpreadBps,
    netSpreadBps,
    fxDetail: {
      fxUsdcUsdtMid,
      sellQuoteCurrency,
      buyQuoteCurrency,
      sellPriceUsdc: sellQuoteCurrency === "USDC" ? sellPrice : null,
      sellPriceUsdt: sellQuoteCurrency === "USDC" ? sellPriceUsdt : null,
    },
  };
}
