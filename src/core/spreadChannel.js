function toFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

export function formatSpreadOpportunityForChannel(opportunity) {
  if (!opportunity?.symbol) {
    return null;
  }

  return {
    symbol: opportunity.symbol,
    buyExchange: opportunity.buyExchange,
    buyPrice: toFiniteNumber(opportunity.buyPrice),
    sellExchange: opportunity.sellExchange,
    sellPrice: toFiniteNumber(opportunity.sellPrice),
    grossSpreadPct: toFiniteNumber(opportunity.grossSpreadPct),
    estimatedFeePct: toFiniteNumber(opportunity.feeCostPct),
    netSpreadPct: toFiniteNumber(opportunity.netSpreadPct),
    status: opportunity.status ?? "unknown",
    timestamp: toFiniteNumber(opportunity.timestamp),
  };
}

export function buildSpreadChannelPayload(opportunities = [], extra = {}) {
  return {
    type: "spread_opportunities",
    publishedAt: new Date().toISOString(),
    ...extra,
    opportunities: opportunities
      .map((item) => formatSpreadOpportunityForChannel(item))
      .filter(Boolean),
  };
}
