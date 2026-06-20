import {
  computeFeeAdjustedPrice,
  computeModeFeeSummary,
  getFeeBps,
} from "./fees.js";

export const EXECUTION_MODES = Object.freeze({
  TAKER_TAKER: "taker_taker",
  MAKER_TAKER: "maker_taker",
  TAKER_MAKER: "taker_maker",
  MAKER_MAKER: "maker_maker",
});

const MODE_TO_ROLES = Object.freeze({
  [EXECUTION_MODES.TAKER_TAKER]: {
    buyRole: "taker",
    sellRole: "taker",
  },
  [EXECUTION_MODES.MAKER_TAKER]: {
    buyRole: "maker",
    sellRole: "taker",
  },
  [EXECUTION_MODES.TAKER_MAKER]: {
    buyRole: "taker",
    sellRole: "maker",
  },
  [EXECUTION_MODES.MAKER_MAKER]: {
    buyRole: "maker",
    sellRole: "maker",
  },
});

function toBps(value) {
  return value * 10_000;
}

function executableFailure(reason) {
  return {
    executable: false,
    reason,
    expectedNetEdgeBps: null,
    notes: [reason],
  };
}

export function evaluateExecutionMode({
  mode,
  buyExchange,
  sellExchange,
  buyPrice,
  sellPrice,
  quantity = 1,
  feeBpsByExchange,
  makerBufferBps = 0,
  dualMakerBufferBps = 0,
} = {}) {
  const roles = MODE_TO_ROLES[mode];

  if (!roles) {
    return executableFailure("unsupported_mode");
  }

  if (
    !buyExchange ||
    !sellExchange ||
    !Number.isFinite(buyPrice) ||
    buyPrice <= 0 ||
    !Number.isFinite(sellPrice) ||
    sellPrice <= 0
  ) {
    return executableFailure("missing_prices");
  }

  const buyFeeBps = getFeeBps(feeBpsByExchange, buyExchange, roles.buyRole);
  const sellFeeBps = getFeeBps(feeBpsByExchange, sellExchange, roles.sellRole);

  if (!Number.isFinite(buyFeeBps) || !Number.isFinite(sellFeeBps)) {
    return executableFailure("missing_fee_config");
  }

  const feeAdjustedBuyPrice = computeFeeAdjustedPrice({
    price: buyPrice,
    feeBps: buyFeeBps,
    side: "buy",
  });
  const feeAdjustedSellPrice = computeFeeAdjustedPrice({
    price: sellPrice,
    feeBps: sellFeeBps,
    side: "sell",
  });

  if (!Number.isFinite(feeAdjustedBuyPrice) || !Number.isFinite(feeAdjustedSellPrice)) {
    return executableFailure("invalid_fee_adjusted_price");
  }

  const grossEdgeBps = toBps(sellPrice / buyPrice - 1);
  const feeAdjustedEdgeBps = toBps(feeAdjustedSellPrice / feeAdjustedBuyPrice - 1);
  const bufferBps =
    mode === EXECUTION_MODES.MAKER_MAKER ? dualMakerBufferBps : roles.buyRole === "maker" || roles.sellRole === "maker" ? makerBufferBps : 0;
  const expectedNetEdgeBps = feeAdjustedEdgeBps - bufferBps;
  const feeSummary = computeModeFeeSummary({
    buyPrice,
    sellPrice,
    quantity,
    buyFeeBps,
    sellFeeBps,
  });

  return {
    executable: true,
    mode,
    buyRole: roles.buyRole,
    sellRole: roles.sellRole,
    expectedNetEdgeBps,
    grossEdgeBps,
    feeAdjustedEdgeBps,
    feeCostUsdt: feeSummary?.totalFeeCostUsdt ?? null,
    buyFeeBps,
    sellFeeBps,
    notes: bufferBps > 0 ? [`buffer_applied:${bufferBps}`] : [],
  };
}

export function evaluateAllExecutionModes(input) {
  return Object.values(EXECUTION_MODES).map((mode) =>
    evaluateExecutionMode({
      ...input,
      mode,
    }),
  );
}
