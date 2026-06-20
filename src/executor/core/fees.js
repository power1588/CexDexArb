function bpsToFraction(bps) {
  return bps / 10_000;
}

export function getFeeBps(config, exchange, role) {
  return config?.[exchange]?.[role] ?? null;
}

export function computeFeeAdjustedPrice({
  price,
  feeBps,
  side,
} = {}) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(feeBps) || feeBps < 0) {
    return null;
  }

  const feeFraction = bpsToFraction(feeBps);

  if (side === "buy") {
    return price * (1 + feeFraction);
  }

  if (side === "sell") {
    return price * (1 - feeFraction);
  }

  return null;
}

export function computeLegFeeCostUsdt({
  price,
  quantity,
  feeBps,
} = {}) {
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(feeBps) ||
    feeBps < 0
  ) {
    return null;
  }

  return price * quantity * bpsToFraction(feeBps);
}

export function computeModeFeeSummary({
  buyPrice,
  sellPrice,
  quantity,
  buyFeeBps,
  sellFeeBps,
} = {}) {
  const buyFeeCostUsdt = computeLegFeeCostUsdt({
    price: buyPrice,
    quantity,
    feeBps: buyFeeBps,
  });
  const sellFeeCostUsdt = computeLegFeeCostUsdt({
    price: sellPrice,
    quantity,
    feeBps: sellFeeBps,
  });

  if (!Number.isFinite(buyFeeCostUsdt) || !Number.isFinite(sellFeeCostUsdt)) {
    return null;
  }

  return {
    buyFeeCostUsdt,
    sellFeeCostUsdt,
    totalFeeCostUsdt: buyFeeCostUsdt + sellFeeCostUsdt,
  };
}
