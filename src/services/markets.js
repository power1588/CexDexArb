import {
  buildCommonPerpSymbols,
  parseBinancePerpMarket,
  parseHyperliquidPerpMarket,
} from "../core/symbols.js";
import { HL_ECOSYSTEM_MARKET_CATALOG } from "../fixtures/hlEcosystemCatalog.js";

const BINANCE_MARKETS_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo";
const HYPERLIQUID_MARKETS_URL = "https://api.hyperliquid.xyz/info";

function createFailure(exchange, message) {
  return {
    exchange,
    status: "error",
    markets: [],
    fetchedAt: null,
    error: message,
  };
}

function normalizeSuccess(exchange, markets, fetchedAt) {
  return {
    exchange,
    status: "ready",
    markets,
    fetchedAt,
    error: "",
  };
}

function mergeMarketsBySymbol(markets) {
  const seen = new Set();

  return markets.filter((market) => {
    const identity = [
      market.exchange,
      market.symbol,
      market.marketCategory ?? "",
      market.builder ?? "",
    ].join(":");

    if (seen.has(identity)) {
      return false;
    }

    seen.add(identity);
    return true;
  });
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export async function discoverBinancePerpMarkets({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  if (typeof fetchImpl !== "function") {
    return createFailure("binance", "fetch 不可用");
  }

  try {
    const response = await fetchImpl(BINANCE_MARKETS_URL);
    const payload = await response.json();
    const markets = ensureArray(payload?.symbols)
      .map((market) => parseBinancePerpMarket(market))
      .filter(Boolean);

    if (markets.length === 0) {
      return createFailure("binance", "Binance 永续市场列表为空");
    }

    return normalizeSuccess("binance", markets, now());
  } catch (error) {
    return createFailure(
      "binance",
      error instanceof Error ? error.message : "Binance 市场发现失败",
    );
  }
}

function extractHyperliquidUniverse(payload) {
  if (Array.isArray(payload) && payload[0]?.universe) {
    return payload[0].universe;
  }

  if (payload?.universe) {
    return payload.universe;
  }

  if (payload?.meta?.universe) {
    return payload.meta.universe;
  }

  return [];
}

export function discoverHyperliquidEcosystemMarkets({
  ecosystemCatalog = HL_ECOSYSTEM_MARKET_CATALOG,
  now = () => Date.now(),
} = {}) {
  const markets = ecosystemCatalog
    .map((market) => parseHyperliquidPerpMarket(market))
    .filter(Boolean);

  if (markets.length === 0) {
    return createFailure("hyperliquid-ecosystem", "HL 生态市场目录为空");
  }

  return normalizeSuccess("hyperliquid-ecosystem", markets, now());
}

export async function discoverHyperliquidPerpMarkets({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  ecosystemCatalog = HL_ECOSYSTEM_MARKET_CATALOG,
} = {}) {
  const ecosystem = discoverHyperliquidEcosystemMarkets({
    ecosystemCatalog,
    now,
  });

  if (typeof fetchImpl !== "function") {
    return {
      ...normalizeSuccess("hyperliquid", ecosystem.markets, now()),
      sources: {
        native: 0,
        ecosystem: ecosystem.markets.length,
      },
      warning: "HL 原生接口不可用，已退化为生态目录快照。",
    };
  }

  try {
    const response = await fetchImpl(HYPERLIQUID_MARKETS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "meta" }),
    });
    const payload = await response.json();
    const nativeMarkets = extractHyperliquidUniverse(payload)
      .map((market) => parseHyperliquidPerpMarket(market))
      .filter(Boolean);
    const markets = mergeMarketsBySymbol([
      ...nativeMarkets,
      ...ecosystem.markets,
    ]);

    if (markets.length === 0) {
      return createFailure("hyperliquid", "Hyperliquid 永续市场列表为空");
    }

    return {
      ...normalizeSuccess("hyperliquid", markets, now()),
      sources: {
        native: nativeMarkets.length,
        ecosystem: ecosystem.markets.length,
      },
    };
  } catch (error) {
    if (ecosystem.markets.length > 0) {
      return {
        ...normalizeSuccess("hyperliquid", ecosystem.markets, now()),
        sources: {
          native: 0,
          ecosystem: ecosystem.markets.length,
        },
        warning:
          error instanceof Error
            ? `HL 原生接口失败，已退化为生态目录快照：${error.message}`
            : "HL 原生接口失败，已退化为生态目录快照。",
      };
    }

    return createFailure(
      "hyperliquid",
      error instanceof Error ? error.message : "Hyperliquid 市场发现失败",
    );
  }
}

export async function loadCommonPerpUniverse({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  previousSnapshot,
} = {}) {
  const [binance, hyperliquid] = await Promise.all([
    discoverBinancePerpMarkets({ fetchImpl, now }),
    discoverHyperliquidPerpMarkets({ fetchImpl, now }),
  ]);

  const bothReady = binance.status === "ready" && hyperliquid.status === "ready";

  if (bothReady) {
    return {
      commonPerpSymbols: buildCommonPerpSymbols(
        binance.markets,
        hyperliquid.markets,
      ),
      symbolUniverseStatus: {
        status: "ready",
        binance: "ready",
        hyperliquid: "ready",
        error: "",
        lastUpdatedAt: now(),
        version: (previousSnapshot?.symbolUniverseStatus?.version ?? 0) + 1,
      },
      marketDiscovery: { binance, hyperliquid },
    };
  }

  return {
    commonPerpSymbols: previousSnapshot?.commonPerpSymbols ?? [],
    symbolUniverseStatus: {
      status: previousSnapshot?.commonPerpSymbols?.length ? "degraded" : "error",
      binance: binance.status,
      hyperliquid: hyperliquid.status,
      error: [binance.error, hyperliquid.error].filter(Boolean).join("；"),
      lastUpdatedAt:
        previousSnapshot?.symbolUniverseStatus?.lastUpdatedAt ?? null,
      version: previousSnapshot?.symbolUniverseStatus?.version ?? 1,
    },
    marketDiscovery: { binance, hyperliquid },
  };
}

export function createMarketUniverseService(options = {}) {
  let snapshot = options.initialSnapshot ?? {
    commonPerpSymbols: [],
    symbolUniverseStatus: {
      status: "idle",
      binance: "idle",
      hyperliquid: "idle",
      error: "",
      lastUpdatedAt: null,
      version: 0,
    },
  };

  return {
    getSnapshot() {
      return snapshot;
    },
    async refresh() {
      snapshot = await loadCommonPerpUniverse({
        ...options,
        previousSnapshot: snapshot,
      });
      return snapshot;
    },
  };
}
