import {
  computeEstimatedNetHourly,
  computePriceSpread,
  computeFundingSpread,
  getOpportunityStatus,
} from "./metrics.js";

function getFundingIntervalHours(snapshot) {
  if (Number.isFinite(snapshot?.fundingIntervalHours) && snapshot.fundingIntervalHours > 0) {
    return snapshot.fundingIntervalHours;
  }

  return 1;
}

export function toHourlyFundingRate(rate, fundingIntervalHours = 1) {
  if (!Number.isFinite(rate) || fundingIntervalHours <= 0) {
    return null;
  }

  return rate / fundingIntervalHours;
}

export function normalizeFundingSnapshot(snapshot) {
  if (!snapshot || !snapshot.symbol || !snapshot.exchange) {
    return null;
  }

  const fundingRateHourly = Number.isFinite(snapshot.fundingRateHourly)
    ? snapshot.fundingRateHourly
    : toHourlyFundingRate(snapshot.fundingRate, getFundingIntervalHours(snapshot));

  return {
    symbol: snapshot.symbol,
    exchange: snapshot.exchange,
    fundingRateHourly,
    markPrice: Number.isFinite(snapshot.markPrice) ? snapshot.markPrice : null,
    takerFee: Number.isFinite(snapshot.takerFee) ? snapshot.takerFee : null,
    nextFundingTime: snapshot.nextFundingTime ?? null,
    sourceLagMs: Number.isFinite(snapshot.sourceLagMs) ? snapshot.sourceLagMs : null,
  };
}

function getSuggestedLeverage(estimatedNetHourly) {
  if (estimatedNetHourly >= 0.0002) {
    return 4;
  }

  if (estimatedNetHourly > 0) {
    return 3;
  }

  return 2;
}

export function buildFundingOpportunity(
  symbol,
  firstMarket,
  secondMarket,
  { holdingHours = 12, minimumNetHourly = 0.0001 } = {},
) {
  const left = normalizeFundingSnapshot(firstMarket);
  const right = normalizeFundingSnapshot(secondMarket);

  if (!left || !right) {
    return null;
  }

  if (
    !Number.isFinite(left.fundingRateHourly) ||
    !Number.isFinite(right.fundingRateHourly) ||
    !Number.isFinite(left.takerFee) ||
    !Number.isFinite(right.takerFee)
  ) {
    return null;
  }

  const [longMarket, shortMarket] =
    left.fundingRateHourly <= right.fundingRateHourly
      ? [left, right]
      : [right, left];
  const fundingSpreadHourly = computeFundingSpread(
    longMarket.fundingRateHourly,
    shortMarket.fundingRateHourly,
  );
  const estimatedNetHourly = computeEstimatedNetHourly({
    longRate: longMarket.fundingRateHourly,
    shortRate: shortMarket.fundingRateHourly,
    longTakerFee: longMarket.takerFee,
    shortTakerFee: shortMarket.takerFee,
    holdingHours,
  });

  return {
    symbol,
    longExchange: longMarket.exchange,
    shortExchange: shortMarket.exchange,
    fundingSpreadHourly,
    estimatedNetHourly,
    suggestedLeverage: getSuggestedLeverage(estimatedNetHourly),
    status: getOpportunityStatus(estimatedNetHourly, minimumNetHourly),
    longFundingRateHourly: longMarket.fundingRateHourly,
    shortFundingRateHourly: shortMarket.fundingRateHourly,
    longMarkPrice: longMarket.markPrice ?? 0,
    shortMarkPrice: shortMarket.markPrice ?? 0,
    netPriceSpread: computePriceSpread(
      longMarket.markPrice ?? 0,
      shortMarket.markPrice ?? 0,
    ),
    longSnapshot: longMarket,
    shortSnapshot: shortMarket,
  };
}

function createSymbolSnapshotIndex(symbolSnapshots) {
  return symbolSnapshots.reduce((index, snapshot) => {
    index[`${snapshot.symbol}:${snapshot.exchange}`] = snapshot;
    return index;
  }, {});
}

export function sortFundingOpportunities(
  opportunities,
  sortBy = "estimatedNetHourly",
  sortDirection = "desc",
) {
  const direction = sortDirection === "asc" ? 1 : -1;
  const accessors = {
    estimatedNetHourly: (item) => item.estimatedNetHourly,
    fundingSpreadHourly: (item) => item.fundingSpreadHourly,
    compositeScore: (item) =>
      item.estimatedNetHourly * 1_000_000 + item.fundingSpreadHourly * 100_000,
  };
  const pick = accessors[sortBy] ?? accessors.estimatedNetHourly;

  return [...opportunities].sort((left, right) => {
    const delta = pick(left) - pick(right);

    if (delta !== 0) {
      return delta * direction;
    }

    return left.symbol.localeCompare(right.symbol, "en");
  });
}

export function buildFundingOpportunities(
  symbolSnapshots,
  commonPerpSymbols,
  options,
) {
  const symbolSnapshotIndex = createSymbolSnapshotIndex(symbolSnapshots);

  return commonPerpSymbols
    .map((item) =>
      buildFundingOpportunity(
        item.symbol,
        symbolSnapshotIndex[`${item.symbol}:binance`],
        symbolSnapshotIndex[`${item.symbol}:hyperliquid`],
        options,
      ),
    )
    .filter(Boolean);
}
