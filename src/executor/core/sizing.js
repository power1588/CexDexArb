function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function collectConstraints(values) {
  return Object.entries(values)
    .map(([name, value]) => ({
      name,
      value: finitePositive(value),
    }))
    .filter((constraint) => constraint.value !== null);
}

export function computeTargetNotionalUsdt({
  desiredNotionalUsdt,
  orderBookCapacityUsdt,
  maxMarginLimitedNotionalUsdt,
  maxExposureUsdt,
  minOrderNotionalUsdt,
} = {}) {
  const constraints = collectConstraints({
    desiredNotionalUsdt,
    orderBookCapacityUsdt,
    maxMarginLimitedNotionalUsdt,
    maxExposureUsdt,
  });

  if (constraints.length === 0) {
    return {
      executable: false,
      reason: "missing_constraints",
      targetNotionalUsdt: null,
    };
  }

  const targetNotionalUsdt = Math.min(...constraints.map((constraint) => constraint.value));

  if (!Number.isFinite(minOrderNotionalUsdt) || minOrderNotionalUsdt <= 0) {
    return {
      executable: false,
      reason: "invalid_min_order_notional",
      targetNotionalUsdt: null,
    };
  }

  if (targetNotionalUsdt < minOrderNotionalUsdt) {
    return {
      executable: false,
      reason: "below_min_order_notional",
      targetNotionalUsdt,
      constraints,
    };
  }

  return {
    executable: true,
    targetNotionalUsdt,
    constraints,
  };
}

export function computeEffectiveOpenThresholdBps({
  minOpenBps,
  fxPenaltyBps = 0,
  latencyPenaltyBps = 0,
  orphanRiskBps = 0,
  makerBufferBps = 0,
} = {}) {
  const components = {
    minOpenBps: finitePositive(minOpenBps),
    fxPenaltyBps: Number.isFinite(fxPenaltyBps) ? fxPenaltyBps : null,
    latencyPenaltyBps: Number.isFinite(latencyPenaltyBps) ? latencyPenaltyBps : null,
    orphanRiskBps: Number.isFinite(orphanRiskBps) ? orphanRiskBps : null,
    makerBufferBps: Number.isFinite(makerBufferBps) ? makerBufferBps : null,
  };

  if (components.minOpenBps === null) {
    return {
      executable: false,
      reason: "invalid_min_open_bps",
      effectiveOpenThresholdBps: null,
      components,
    };
  }

  if (
    Object.entries(components)
      .filter(([key]) => key !== "minOpenBps")
      .some(([, value]) => value === null)
  ) {
    return {
      executable: false,
      reason: "invalid_threshold_component",
      effectiveOpenThresholdBps: null,
      components,
    };
  }

  const effectiveOpenThresholdBps =
    components.minOpenBps +
    components.fxPenaltyBps +
    components.latencyPenaltyBps +
    components.orphanRiskBps +
    components.makerBufferBps;

  return {
    executable: true,
    effectiveOpenThresholdBps,
    components,
  };
}
