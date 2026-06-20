function normalizeLevels(levels = []) {
  return levels
    .map((level) => ({
      price: Number(level.price),
      quantity: Number(level.quantity),
    }))
    .filter((level) => Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.quantity))
    .filter((level) => level.quantity > 0);
}

export function getBestBid(orderBook) {
  return normalizeLevels(orderBook?.bids)[0] ?? null;
}

export function getBestAsk(orderBook) {
  return normalizeLevels(orderBook?.asks)[0] ?? null;
}

export function computeVwap(levels, targetQuantity) {
  const normalizedLevels = normalizeLevels(levels);

  if (!Number.isFinite(targetQuantity) || targetQuantity <= 0 || normalizedLevels.length === 0) {
    return {
      executable: false,
      filledQuantity: 0,
      averagePrice: null,
      totalNotional: 0,
      shortfallQuantity: Number.isFinite(targetQuantity) ? targetQuantity : 0,
    };
  }

  let remainingQuantity = targetQuantity;
  let filledQuantity = 0;
  let totalNotional = 0;

  for (const level of normalizedLevels) {
    const takeQuantity = Math.min(level.quantity, remainingQuantity);

    totalNotional += takeQuantity * level.price;
    filledQuantity += takeQuantity;
    remainingQuantity -= takeQuantity;

    if (remainingQuantity <= 0) {
      break;
    }
  }

  return {
    executable: remainingQuantity <= 0,
    filledQuantity,
    averagePrice: filledQuantity > 0 ? totalNotional / filledQuantity : null,
    totalNotional,
    shortfallQuantity: Math.max(remainingQuantity, 0),
  };
}

export function computeDepthWithinBps({
  levels,
  referencePrice,
  bps,
  side,
} = {}) {
  const normalizedLevels = normalizeLevels(levels);

  if (
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0 ||
    !Number.isFinite(bps) ||
    bps < 0 ||
    !["buy", "sell"].includes(side)
  ) {
    return {
      totalQuantity: 0,
      totalNotional: 0,
    };
  }

  const thresholdPrice =
    side === "buy"
      ? referencePrice * (1 + bps / 10_000)
      : referencePrice * (1 - bps / 10_000);

  return normalizedLevels.reduce(
    (result, level) => {
      const withinThreshold =
        side === "buy" ? level.price <= thresholdPrice : level.price >= thresholdPrice;

      if (!withinThreshold) {
        return result;
      }

      return {
        totalQuantity: result.totalQuantity + level.quantity,
        totalNotional: result.totalNotional + level.quantity * level.price,
      };
    },
    {
      totalQuantity: 0,
      totalNotional: 0,
    },
  );
}

export function computeBookImbalance(orderBook) {
  const totalBidQuantity = normalizeLevels(orderBook?.bids).reduce(
    (sum, level) => sum + level.quantity,
    0,
  );
  const totalAskQuantity = normalizeLevels(orderBook?.asks).reduce(
    (sum, level) => sum + level.quantity,
    0,
  );
  const denominator = totalBidQuantity + totalAskQuantity;

  if (denominator === 0) {
    return null;
  }

  return (totalBidQuantity - totalAskQuantity) / denominator;
}

export function computeRefillRate(samples = []) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return null;
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const firstQuantity = Number(first.availableQuantity);
  const lastQuantity = Number(last.availableQuantity);
  const firstTimestamp = Number(first.timestamp);
  const lastTimestamp = Number(last.timestamp);
  const elapsedMs = lastTimestamp - firstTimestamp;

  if (
    !Number.isFinite(firstQuantity) ||
    !Number.isFinite(lastQuantity) ||
    !Number.isFinite(firstTimestamp) ||
    !Number.isFinite(lastTimestamp) ||
    elapsedMs <= 0
  ) {
    return null;
  }

  return (lastQuantity - firstQuantity) / (elapsedMs / 1000);
}
