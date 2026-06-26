/**
 * 实时价差计算器。
 *
 * 在持仓期间持续计算双腿实时价差，输出 LiveSpread，
 * 监控循环据此判断是否触发平仓。
 */

const BPS_PER_UNIT = 10_000;

function convertToUsdt(price, quoteCurrency, fxUsdcUsdtMid) {
  if (quoteCurrency === "USDC") {
    return price * fxUsdcUsdtMid;
  }
  return price;
}

export function computeLiveSpread({
  openDirection,
  buyBook,
  sellBook,
  fxUsdcUsdtMid = 1.0,
  closeThresholdBps = 5,
  closeThresholdAbsUsdt,
} = {}) {
  const buyExchange = buyBook?.exchange;
  const sellExchange = sellBook?.exchange;
  const buyPrice = Number(buyBook?.bestAsk?.price ?? 0);
  const sellPriceRaw = Number(sellBook?.bestBid?.price ?? 0);

  const buyQuoteCurrency = buyBook?.quoteCurrency ?? "USDT";
  const sellQuoteCurrency = sellBook?.quoteCurrency ?? "USDC";

  const buyPriceUsdt = convertToUsdt(buyPrice, buyQuoteCurrency, fxUsdcUsdtMid);
  const sellPriceUsdt = convertToUsdt(sellPriceRaw, sellQuoteCurrency, fxUsdcUsdtMid);

  const netSpreadPerUnit = sellPriceUsdt - buyPriceUsdt;
  const referencePrice = Math.max(buyPriceUsdt, sellPriceUsdt);
  const netSpreadBps =
    referencePrice > 0 ? (netSpreadPerUnit / referencePrice) * BPS_PER_UNIT : 0;

  const reversionDirection =
    netSpreadPerUnit > 0 ? "positive" : netSpreadPerUnit < 0 ? "negative" : "neutral";

  const withinBpsThreshold = netSpreadBps <= closeThresholdBps;
  const withinAbsThreshold =
    closeThresholdAbsUsdt === undefined
      ? true
      : netSpreadPerUnit <= closeThresholdAbsUsdt;

  // 价差收窄到阈值内，或已经反转（netSpread <= 阈值），都视为可平仓
  const readyToClose = withinBpsThreshold && withinAbsThreshold;

  return {
    openDirection,
    buyExchange,
    sellExchange,
    buyPrice,
    sellPriceRaw,
    buyPriceUsdt,
    sellPriceUsdt,
    netSpreadUsdt: netSpreadPerUnit,
    netSpreadBps,
    reversionDirection,
    readyToClose,
    fxDetail: {
      fxUsdcUsdtMid,
      buyQuoteCurrency,
      sellQuoteCurrency,
      sellPriceUsdc: sellQuoteCurrency === "USDC" ? sellPriceRaw : null,
      sellPriceUsdt: sellQuoteCurrency === "USDC" ? sellPriceUsdt : null,
    },
    timestamp: Date.now(),
  };
}
