const EXACT_SYMBOL_ALIASES = {
  BTCUSDT: "BTC",
  ETHUSDT: "ETH",
  SOLUSDT: "SOL",
  XBT: "BTC",
  XBTUSDT: "BTC",
};

const TRADEFI_MARKET_CATEGORIES = new Set(["tradefi", "pre-ipo"]);

function safeUppercase(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function stripKnownSuffixes(value) {
  let normalized = value;
  const suffixes = [
    /^[A-Z0-9_-]+:/i,
    /[-_/]?USDT$/i,
    /[-_/]?USDC$/i,
    /[-_/]?USD$/i,
    /[-_/]?PERP$/i,
  ];

  suffixes.forEach((pattern) => {
    normalized = normalized.replace(pattern, "");
  });

  return normalized.replace(/[^A-Z0-9]/g, "");
}

export function normalizePerpSymbol(symbol, { aliasMap = EXACT_SYMBOL_ALIASES } = {}) {
  const raw = safeUppercase(symbol);

  if (!raw) {
    return null;
  }

  if (aliasMap[raw]) {
    return aliasMap[raw];
  }

  const stripped = stripKnownSuffixes(raw);

  if (!stripped) {
    return null;
  }

  return aliasMap[stripped] ?? stripped;
}

export function parseBinancePerpMarket(market) {
  if (
    !market ||
    (market.contractType !== "PERPETUAL" &&
      market.contractType !== "TRADIFI_PERPETUAL")
  ) {
    return null;
  }

  const normalizedSymbol = normalizePerpSymbol(market.symbol ?? market.pair);

  if (!normalizedSymbol) {
    return null;
  }

  return {
    exchange: "binance",
    symbol: normalizedSymbol,
    rawSymbol: market.symbol,
    baseAsset: market.baseAsset ?? normalizedSymbol,
    quoteAsset: market.quoteAsset ?? "USDT",
    contractType: "perpetual",
    status: market.status ?? "UNKNOWN",
    marketCategory:
      market.contractType === "TRADIFI_PERPETUAL" ||
      market.underlyingType === "EQUITY" ||
      market.underlyingSubType?.includes("TradFi")
        ? "tradefi"
        : "crypto",
    underlyingType: market.underlyingType ?? null,
    underlyingSubType: market.underlyingSubType ?? [],
  };
}

export function parseHyperliquidPerpMarket(market) {
  const rawSymbol =
    typeof market === "string"
      ? market
      : market?.name ?? market?.coin ?? market?.symbol ?? "";
  const normalizedSymbol = normalizePerpSymbol(rawSymbol);
  const builder =
    typeof market === "object" && typeof market?.builder === "string"
      ? market.builder
      : typeof rawSymbol === "string" && rawSymbol.includes(":")
        ? rawSymbol.split(":")[0].toLowerCase()
        : null;

  if (!normalizedSymbol) {
    return null;
  }

  return {
    exchange: "hyperliquid",
    symbol: normalizedSymbol,
    rawSymbol,
    baseAsset: normalizedSymbol,
    quoteAsset: "USD",
    contractType: "perpetual",
    status: "TRADING",
    marketCategory:
      market?.marketCategory ??
      (builder === "vntl"
        ? "pre-ipo"
        : builder
          ? "tradefi"
          : "crypto"),
    builder,
    marketSource: market?.marketSource ?? (builder ? "hl-ecosystem" : "hyperliquid"),
  };
}

function buildMarketIndex(markets) {
  const index = new Map();

  markets.forEach((market) => {
    if (!market?.symbol) {
      return;
    }

    const existingMarkets = index.get(market.symbol) ?? [];
    existingMarkets.push(market);
    index.set(market.symbol, existingMarkets);
  });

  return index;
}

export function areCommonPerpMarketsCompatible(leftMarket, rightMarket) {
  if (!leftMarket || !rightMarket || leftMarket.symbol !== rightMarket.symbol) {
    return false;
  }

  if (leftMarket.marketCategory === rightMarket.marketCategory) {
    return true;
  }

  return (
    TRADEFI_MARKET_CATEGORIES.has(leftMarket.marketCategory) &&
    TRADEFI_MARKET_CATEGORIES.has(rightMarket.marketCategory)
  );
}

export function buildCommonPerpSymbols(binanceMarkets, hyperliquidMarkets) {
  const binanceIndex = buildMarketIndex(binanceMarkets);
  const hyperliquidIndex = buildMarketIndex(hyperliquidMarkets);

  return [...binanceIndex.keys()]
    .filter((symbol) => hyperliquidIndex.has(symbol))
    .sort((left, right) => left.localeCompare(right, "en"))
    .flatMap((symbol) => {
      const binanceMatches = binanceIndex.get(symbol);
      const hyperliquidMatches = hyperliquidIndex.get(symbol);
      const compatiblePair = binanceMatches
        .flatMap((binanceMarket) =>
          hyperliquidMatches.map((hyperliquidMarket) => ({
            binanceMarket,
            hyperliquidMarket,
          })),
        )
        .find(({ binanceMarket, hyperliquidMarket }) =>
          areCommonPerpMarketsCompatible(binanceMarket, hyperliquidMarket),
        );

      if (!compatiblePair) {
        return [];
      }

      return [
        {
          symbol,
          binanceSymbol: compatiblePair.binanceMarket.rawSymbol,
          hyperliquidSymbol: compatiblePair.hyperliquidMarket.rawSymbol,
          marketCategory:
            compatiblePair.hyperliquidMarket.marketCategory ??
            compatiblePair.binanceMarket.marketCategory,
          hyperliquidBuilder: compatiblePair.hyperliquidMarket.builder ?? null,
        },
      ];
    });
}

export function getCommonSymbolNames(commonPerpSymbols) {
  return commonPerpSymbols.map((item) => item.symbol);
}

export function createStaticCommonPerpSnapshot(symbolSnapshots) {
  const byExchange = {
    binance: [],
    hyperliquid: [],
  };

  symbolSnapshots.forEach((snapshot) => {
    const market =
      snapshot.exchange === "binance"
        ? parseBinancePerpMarket({
            symbol: `${snapshot.symbol}USDT`,
            baseAsset: snapshot.symbol,
            quoteAsset: "USDT",
            contractType: "PERPETUAL",
            status: "TRADING",
          })
        : parseHyperliquidPerpMarket(snapshot.symbol);

    if (market) {
      byExchange[snapshot.exchange]?.push(market);
    }
  });

  const commonPerpSymbols = buildCommonPerpSymbols(
    byExchange.binance,
    byExchange.hyperliquid,
  );

  return {
    commonPerpSymbols,
    symbolUniverseStatus: {
      status: "ready",
      binance: "static",
      hyperliquid: "static",
      error: "",
      lastUpdatedAt: null,
      version: 1,
    },
  };
}
