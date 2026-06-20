import { convertHyperliquidFundingSnapshotToUsdt, computeUsdcUsdtMidRate } from "../core/fx.js";
import { normalizePerpSymbol } from "../core/symbols.js";

const BINANCE_PREMIUM_INDEX_URL =
  "https://fapi.binance.com/fapi/v1/premiumIndex";
const BINANCE_24H_TICKER_URL =
  "https://fapi.binance.com/fapi/v1/ticker/24hr";
const BINANCE_SPOT_BOOK_TICKER_URL =
  "https://api.binance.com/api/v3/ticker/bookTicker?symbol=USDCUSDT";
const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";

const DEFAULT_TAKER_FEES = {
  binance: 0.0005,
  hyperliquid: 0.00045,
  xyz: 0.00009,
  vntl: 0.00009,
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTimestamp(value) {
  return Number.isFinite(value) ? value : null;
}

function createFundingStatus(status, extra = {}) {
  return {
    status,
    error: "",
    warning: "",
    lastUpdatedAt: null,
    ...extra,
  };
}

function getHyperliquidTakerFee(dex) {
  return DEFAULT_TAKER_FEES[dex] ?? DEFAULT_TAKER_FEES.hyperliquid;
}

function getRequestedDexes(commonPerpSymbols) {
  const dexes = new Set();

  commonPerpSymbols.forEach((market) => {
    if (market.hyperliquidBuilder) {
      dexes.add(market.hyperliquidBuilder);
    } else {
      dexes.add("");
    }
  });

  return dexes.size ? [...dexes] : [""];
}

function createWantedSymbolMaps(commonPerpSymbols) {
  const binanceSymbols = new Set();
  const hyperliquidSymbols = new Set();

  commonPerpSymbols.forEach((market) => {
    if (market.binanceSymbol) {
      binanceSymbols.add(market.binanceSymbol);
    }

    if (market.hyperliquidSymbol) {
      hyperliquidSymbols.add(market.hyperliquidSymbol);
    }
  });

  return { binanceSymbols, hyperliquidSymbols };
}

function createBinance24hVolumeIndex(entries = []) {
  return new Map(
    (Array.isArray(entries) ? entries : [])
      .filter((entry) => typeof entry?.symbol === "string")
      .map((entry) => [entry.symbol, toNumber(entry.quoteVolume)]),
  );
}

export function normalizeBinanceFundingSnapshot(
  entry,
  { volume24hByRawSymbol } = {},
) {
  const symbol = normalizePerpSymbol(entry?.symbol);

  if (!symbol) {
    return null;
  }

  return {
    symbol,
    exchange: "binance",
    rawSymbol: entry.symbol,
    fundingRate: toNumber(entry.lastFundingRate),
    fundingIntervalHours: 8,
    nextFundingTime: toTimestamp(entry.nextFundingTime),
    markPrice: toNumber(entry.markPrice),
    indexPrice: toNumber(entry.indexPrice),
    estimatedSettlePrice: toNumber(entry.estimatedSettlePrice),
    dayNotionalVolumeUsd:
      volume24hByRawSymbol instanceof Map
        ? volume24hByRawSymbol.get(entry.symbol) ?? null
        : null,
    takerFee: DEFAULT_TAKER_FEES.binance,
    sourceLagMs: 0,
  };
}

export function normalizeHyperliquidFundingSnapshot(
  market,
  assetContext,
  dex = "",
  now = () => Date.now(),
  usdcUsdtRate = 1,
) {
  const symbol = normalizePerpSymbol(market?.name);

  if (!symbol) {
    return null;
  }

  const fundingIntervalHours = 1;
  const currentTime = now();
  const nextFundingTime =
    Math.ceil(currentTime / 3_600_000) * 3_600_000 || currentTime;

  return convertHyperliquidFundingSnapshotToUsdt({
    symbol,
    exchange: "hyperliquid",
    rawSymbol: market.name,
    fundingRate: toNumber(assetContext?.funding),
    fundingIntervalHours,
    nextFundingTime,
    markPrice: toNumber(assetContext?.markPx),
    oraclePrice: toNumber(assetContext?.oraclePx),
    midPrice: toNumber(assetContext?.midPx),
    openInterest: toNumber(assetContext?.openInterest),
    dayNotionalVolumeUsd: toNumber(assetContext?.dayNtlVlm),
    premium: toNumber(assetContext?.premium),
    takerFee: getHyperliquidTakerFee(dex),
    sourceLagMs: 0,
    builderDex: dex || null,
  }, usdcUsdtRate);
}

async function fetchBinanceUsdcUsdtRate(fetchImpl) {
  try {
    const payload = await fetchImpl(BINANCE_SPOT_BOOK_TICKER_URL).then((response) =>
      response.json(),
    );
    const rate = computeUsdcUsdtMidRate(payload?.bidPrice, payload?.askPrice);

    if (!rate) {
      return {
        rate: 1,
        warning: "USDC/USDT 汇率无效，HL 价格暂按 1:1 折算。",
      };
    }

    return {
      rate,
      warning: "",
    };
  } catch (error) {
    return {
      rate: 1,
      warning:
        error instanceof Error
          ? `USDC/USDT 汇率拉取失败，HL 价格暂按 1:1 折算：${error.message}`
          : "USDC/USDT 汇率拉取失败，HL 价格暂按 1:1 折算。",
    };
  }
}

export async function discoverBinanceFundingSnapshots({
  commonPerpSymbols,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return {
      snapshots: [],
      status: createFundingStatus("error", { error: "fetch 不可用" }),
    };
  }

  const { binanceSymbols } = createWantedSymbolMaps(commonPerpSymbols);

  try {
    const [premiumIndexPayload, ticker24hPayload] = await Promise.all([
      fetchImpl(BINANCE_PREMIUM_INDEX_URL).then((response) => response.json()),
      fetchImpl(BINANCE_24H_TICKER_URL).then((response) => response.json()),
    ]);
    const volume24hByRawSymbol = createBinance24hVolumeIndex(ticker24hPayload);
    const snapshots = (
      Array.isArray(premiumIndexPayload) ? premiumIndexPayload : [premiumIndexPayload]
    )
      .filter((entry) => binanceSymbols.has(entry.symbol))
      .map((entry) =>
        normalizeBinanceFundingSnapshot(entry, { volume24hByRawSymbol }),
      )
      .filter(Boolean);

    return {
      snapshots,
      status: createFundingStatus("ready"),
    };
  } catch (error) {
    return {
      snapshots: [],
      status: createFundingStatus("error", {
        error:
          error instanceof Error ? error.message : "Binance funding 拉取失败",
      }),
    };
  }
}

export async function discoverHyperliquidFundingSnapshots({
  commonPerpSymbols,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  usdcUsdtRate = 1,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return {
      snapshots: [],
      status: createFundingStatus("error", { error: "fetch 不可用" }),
    };
  }

  const { hyperliquidSymbols } = createWantedSymbolMaps(commonPerpSymbols);
  const dexes = getRequestedDexes(commonPerpSymbols);

  try {
    const responses = await Promise.all(
      dexes.map(async (dex) => {
        const payload = await fetchImpl(HYPERLIQUID_INFO_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(
            dex ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" },
          ),
        }).then((response) => response.json());

        return { dex, payload };
      }),
    );

    const snapshots = responses.flatMap(({ dex, payload }) => {
      const [meta, assetContexts] = payload;
      if (!meta?.universe || !Array.isArray(assetContexts)) {
        return [];
      }

      return meta.universe
        .map((market, index) => ({ market, assetContext: assetContexts[index] }))
        .filter(({ market }) => hyperliquidSymbols.has(market.name))
        .map(({ market, assetContext }) =>
          normalizeHyperliquidFundingSnapshot(
            market,
            assetContext,
            dex,
            now,
            usdcUsdtRate,
          ),
        )
        .filter(Boolean);
    });

    return {
      snapshots,
      status: createFundingStatus("ready"),
    };
  } catch (error) {
    return {
      snapshots: [],
      status: createFundingStatus("error", {
        error:
          error instanceof Error
            ? error.message
            : "Hyperliquid funding 拉取失败",
      }),
    };
  }
}

function mergeSymbolSnapshots(previousSnapshots, nextSnapshots, commonPerpSymbols) {
  const allowedSymbols = new Set(commonPerpSymbols.map((item) => item.symbol));
  const merged = new Map();

  previousSnapshots
    .filter((snapshot) => allowedSymbols.has(snapshot.symbol))
    .forEach((snapshot) => {
      merged.set(`${snapshot.symbol}:${snapshot.exchange}`, snapshot);
    });

  nextSnapshots.forEach((snapshot) => {
    merged.set(`${snapshot.symbol}:${snapshot.exchange}`, snapshot);
  });

  return [...merged.values()];
}

export async function loadFundingMonitorSnapshot({
  commonPerpSymbols,
  previousSymbols = [],
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const currentTime = now();
  const [fxRateSnapshot, binance] = await Promise.all([
    fetchBinanceUsdcUsdtRate(fetchImpl),
    discoverBinanceFundingSnapshots({ commonPerpSymbols, fetchImpl }),
  ]);
  const hyperliquid = await discoverHyperliquidFundingSnapshots({
    commonPerpSymbols,
    fetchImpl,
    now,
    usdcUsdtRate: fxRateSnapshot.rate,
  });

  const mergedSymbols = mergeSymbolSnapshots(
    previousSymbols,
    [...binance.snapshots, ...hyperliquid.snapshots],
    commonPerpSymbols,
  );
  const bothReady =
    binance.status.status === "ready" && hyperliquid.status.status === "ready";

  return {
    symbols: mergedSymbols,
    fundingMonitorStatus: createFundingStatus(
      bothReady ? "ready" : mergedSymbols.length > 0 ? "degraded" : "error",
      {
        error: [binance.status.error, hyperliquid.status.error]
          .filter(Boolean)
          .join("；"),
        warning: [binance.status.warning, hyperliquid.status.warning, fxRateSnapshot.warning]
          .filter(Boolean)
          .join("；"),
        lastUpdatedAt: currentTime,
        sources: {
          binance: binance.snapshots.length,
          hyperliquid: hyperliquid.snapshots.length,
        },
      },
    ),
  };
}
