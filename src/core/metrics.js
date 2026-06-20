export function getOpportunityId(opportunity) {
  return `${opportunity.symbol}:${opportunity.longExchange}:${opportunity.shortExchange}`;
}

export function getSymbolSnapshotIndex(symbolSnapshots) {
  return symbolSnapshots.reduce((index, snapshot) => {
    index[`${snapshot.symbol}:${snapshot.exchange}`] = snapshot;
    return index;
  }, {});
}

export function computeFundingSpread(longRate, shortRate) {
  return Math.abs(shortRate - longRate);
}

export function computePriceSpread(longMarkPrice, shortMarkPrice) {
  if (!longMarkPrice) {
    return 0;
  }

  return (shortMarkPrice - longMarkPrice) / longMarkPrice;
}

export function computeEstimatedNetHourly({
  longRate,
  shortRate,
  longTakerFee,
  shortTakerFee,
  holdingHours = 12,
}) {
  const gross = computeFundingSpread(longRate, shortRate);
  const feeDrag = (longTakerFee + shortTakerFee) / holdingHours;
  return gross - feeDrag;
}

export function getOpportunityStatus(
  estimatedNetHourly,
  minimumNetHourly = 0.0001,
) {
  if (estimatedNetHourly <= 0) {
    return "blocked";
  }

  if (estimatedNetHourly < minimumNetHourly) {
    return "watch";
  }

  return "ready";
}

export function enrichOpportunity(opportunity, symbolSnapshotIndex) {
  const longSnapshot =
    symbolSnapshotIndex[`${opportunity.symbol}:${opportunity.longExchange}`] ??
    null;
  const shortSnapshot =
    symbolSnapshotIndex[`${opportunity.symbol}:${opportunity.shortExchange}`] ??
    null;

  return {
    ...opportunity,
    longSnapshot,
    shortSnapshot,
    longMarkPrice: longSnapshot?.markPrice ?? 0,
    shortMarkPrice: shortSnapshot?.markPrice ?? 0,
    longFundingRateHourly: longSnapshot?.fundingRateHourly ?? 0,
    shortFundingRateHourly: shortSnapshot?.fundingRateHourly ?? 0,
    netPriceSpread: computePriceSpread(
      longSnapshot?.markPrice ?? 0,
      shortSnapshot?.markPrice ?? 0,
    ),
  };
}

export function sortOpportunities(opportunities) {
  return [...opportunities].sort((left, right) => {
    if (right.estimatedNetHourly !== left.estimatedNetHourly) {
      return right.estimatedNetHourly - left.estimatedNetHourly;
    }

    if (right.fundingSpreadHourly !== left.fundingSpreadHourly) {
      return right.fundingSpreadHourly - left.fundingSpreadHourly;
    }

    return left.symbol.localeCompare(right.symbol, "zh-CN");
  });
}

export function summarizeOpportunities(opportunities, activeStrategyStatus) {
  const readyCount = opportunities.filter(
    (item) => item.status === "ready",
  ).length;
  const positiveCount = opportunities.filter(
    (item) => item.estimatedNetHourly > 0,
  ).length;
  const estimatedNetHourly = opportunities.reduce(
    (sum, item) => sum + item.estimatedNetHourly,
    0,
  );

  return {
    readyCount,
    positiveCount,
    estimatedNetHourly,
    runningStrategies: activeStrategyStatus === "running" ? 1 : 0,
  };
}

export function filterOpportunities(opportunities, filters) {
  return opportunities.filter((item) => {
    if (filters.symbol !== "all" && item.symbol !== filters.symbol) {
      return false;
    }

    if (
      filters.exchange !== "all" &&
      item.longExchange !== filters.exchange &&
      item.shortExchange !== filters.exchange
    ) {
      return false;
    }

    if (
      filters.minNetHourly > 0 &&
      item.estimatedNetHourly < filters.minNetHourly
    ) {
      return false;
    }

    if (
      filters.minFundingSpreadHourly > 0 &&
      item.fundingSpreadHourly < filters.minFundingSpreadHourly
    ) {
      return false;
    }

    if (filters.riskLevel === "low" && item.suggestedLeverage > 2) {
      return false;
    }

    if (filters.riskLevel === "medium" && item.suggestedLeverage > 4) {
      return false;
    }

    return true;
  });
}

export function getOpportunityById(opportunities, selectedId) {
  return (
    opportunities.find((item) => getOpportunityId(item) === selectedId) ??
    opportunities[0] ??
    null
  );
}

export function buildPortfolioPreview(opportunity, riskConfig) {
  if (!opportunity) {
    return null;
  }

  const notionalUsd = riskConfig.notionalUsd;
  const leverage = riskConfig.leverage;
  const capitalRequired = notionalUsd / leverage;
  const fundingIncome = notionalUsd * opportunity.fundingSpreadHourly;
  const feeCost = notionalUsd * 0.000095;
  const slippageBuffer = (notionalUsd * riskConfig.maxSlippageBps) / 10000;
  const marginBuffer = capitalRequired * (riskConfig.marginBufferRatio ?? 0.2);

  return {
    symbol: opportunity.symbol,
    longExchange: opportunity.longExchange,
    shortExchange: opportunity.shortExchange,
    notionalUsd,
    leverage,
    capitalRequired,
    marginBuffer,
    fundingIncome,
    feeCost,
    slippageBuffer,
    netHourly: opportunity.estimatedNetHourly,
  };
}
