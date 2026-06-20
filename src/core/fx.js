function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeUsdcUsdtRate(rate) {
  const normalized = toFiniteNumber(rate);
  return normalized && normalized > 0 ? normalized : null;
}

export function computeUsdcUsdtMidRate(bidPrice, askPrice) {
  const bid = normalizeUsdcUsdtRate(bidPrice);
  const ask = normalizeUsdcUsdtRate(askPrice);

  if (bid && ask) {
    return (bid + ask) / 2;
  }

  return bid ?? ask ?? null;
}

export function convertPriceToUsdt(price, usdcUsdtRate) {
  const normalizedPrice = toFiniteNumber(price);
  const normalizedRate = normalizeUsdcUsdtRate(usdcUsdtRate);

  if (normalizedPrice === null || normalizedRate === null) {
    return null;
  }

  return normalizedPrice * normalizedRate;
}

export function convertHyperliquidQuoteToUsdt(quote, usdcUsdtRate) {
  if (!quote) {
    return null;
  }

  const bidPrice = convertPriceToUsdt(
    quote.rawBidPrice ?? quote.bidPrice,
    usdcUsdtRate,
  );
  const askPrice = convertPriceToUsdt(
    quote.rawAskPrice ?? quote.askPrice,
    usdcUsdtRate,
  );
  const normalizedRate = normalizeUsdcUsdtRate(usdcUsdtRate);

  if (!Number.isFinite(bidPrice) || !Number.isFinite(askPrice) || !normalizedRate) {
    return null;
  }

  return {
    ...quote,
    bidPrice,
    askPrice,
    rawBidPrice: toFiniteNumber(quote.rawBidPrice ?? quote.bidPrice),
    rawAskPrice: toFiniteNumber(quote.rawAskPrice ?? quote.askPrice),
    quoteCurrency: "USDT",
    quoteToUsdtRate: normalizedRate,
  };
}

export function convertHyperliquidFundingSnapshotToUsdt(snapshot, usdcUsdtRate) {
  if (!snapshot) {
    return null;
  }

  const normalizedRate = normalizeUsdcUsdtRate(usdcUsdtRate);

  if (!normalizedRate) {
    return snapshot;
  }

  return {
    ...snapshot,
    markPrice: convertPriceToUsdt(snapshot.markPrice, normalizedRate),
    oraclePrice: convertPriceToUsdt(snapshot.oraclePrice, normalizedRate),
    midPrice: convertPriceToUsdt(snapshot.midPrice, normalizedRate),
    dayNotionalVolumeUsd: convertPriceToUsdt(
      snapshot.dayNotionalVolumeUsd,
      normalizedRate,
    ),
    quoteCurrency: "USDT",
    quoteToUsdtRate: normalizedRate,
  };
}
