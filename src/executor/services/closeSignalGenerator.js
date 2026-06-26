/**
 * 平仓信号生成器。
 *
 * 在价差回归满足条件时，生成标准化的 CloseSignal。
 * 平仓方向与开仓方向相反，腿顺序对称于开仓模式（maker 优先）。
 */

const BPS_PER_UNIT = 10_000;

function closeSideFor(openSide) {
  // 开仓是 long/buy -> 平仓 sell；开仓是 short/sell -> 平仓 buy
  if (openSide === "long" || openSide === "buy") {
    return "sell";
  }
  if (openSide === "short" || openSide === "sell") {
    return "buy";
  }
  return null;
}

export function generateCloseSignal({
  openDirection,
  buyLeg,
  sellLeg,
  currentSpreadBps,
  fxUsdcUsdtMid = 1.0,
  buyClosePrice,
  sellClosePrice,
  openMode = "maker_taker",
  buyQuoteCurrency = "USDT",
  sellQuoteCurrency = "USDC",
} = {}) {
  // 平仓：binance 多仓 -> 卖出；hyperliquid 空仓 -> 买入
  const buyCloseLeg = {
    exchange: buyLeg.exchange,
    side: closeSideFor(buyLeg.side),
    symbol: buyLeg.symbol ?? null,
    quantity: buyLeg.quantity,
    price: buyClosePrice,
    quoteCurrency: buyQuoteCurrency,
    role: openMode === "maker_taker" || openMode === "maker_maker" ? "maker" : "taker",
    legType: openMode === "maker_taker" || openMode === "maker_maker" ? "maker_close" : "taker_close",
  };

  const sellCloseLeg = {
    exchange: sellLeg.exchange,
    side: closeSideFor(sellLeg.side),
    symbol: sellLeg.symbol ?? null,
    quantity: sellLeg.quantity,
    price: sellClosePrice,
    quoteCurrency: sellQuoteCurrency,
    role: openMode === "taker_maker" || openMode === "maker_maker" ? "maker" : "taker",
    legType: openMode === "taker_maker" || openMode === "maker_maker" ? "maker_close" : "taker_close",
  };

  // 平仓时 maker 优先
  const legs = [buyCloseLeg, sellCloseLeg].sort((a, b) => {
    const aMaker = a.role === "maker" ? 0 : 1;
    const bMaker = b.role === "maker" ? 0 : 1;
    return aMaker - bMaker;
  });

  // 把卖出价折算到 USDT
  const sellCloseUsdt = sellQuoteCurrency === "USDC" ? sellClosePrice * fxUsdcUsdtMid : sellClosePrice;
  const buyCloseUsdt = buyQuoteCurrency === "USDC" ? buyClosePrice * fxUsdcUsdtMid : buyClosePrice;

  const expectedSpreadUsdt = sellCloseUsdt - buyCloseUsdt;
  const referencePrice = Math.max(buyCloseUsdt, sellCloseUsdt);
  const expectedSpreadBps =
    referencePrice > 0 ? (expectedSpreadUsdt / referencePrice) * BPS_PER_UNIT : 0;

  return {
    openDirection,
    legs,
    expectedSpreadUsdt,
    expectedSpreadBps,
    currentSpreadBps,
    fxUsdcUsdtMid,
    generatedAt: Date.now(),
  };
}
