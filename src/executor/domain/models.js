import { DomainValidationError } from "../core/errors.js";

function asFiniteNumber(value, field) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new DomainValidationError(`${field} 必须是有限数字`, { field, value });
  }

  return parsed;
}

function asPositiveNumber(value, field) {
  const parsed = asFiniteNumber(value, field);

  if (parsed <= 0) {
    throw new DomainValidationError(`${field} 必须大于 0`, { field, value });
  }

  return parsed;
}

function asNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainValidationError(`${field} 必须是非空字符串`, { field, value });
  }

  return value.trim();
}

function asTimestamp(value, field) {
  return asPositiveNumber(value, field);
}

function freezeRecord(record) {
  return Object.freeze(record);
}

function validateBookLevel(level, field) {
  if (!level || typeof level !== "object") {
    throw new DomainValidationError(`${field} 必须存在`, { field, value: level });
  }

  return freezeRecord({
    price: asPositiveNumber(level.price, `${field}.price`),
    quantity: asPositiveNumber(level.quantity, `${field}.quantity`),
  });
}

function validateLeg(leg, field = "leg") {
  if (!leg || typeof leg !== "object") {
    throw new DomainValidationError(`${field} 必须存在`, { field, value: leg });
  }

  return freezeRecord({
    exchange: asNonEmptyString(leg.exchange, `${field}.exchange`),
    side: asNonEmptyString(leg.side, `${field}.side`),
    symbol: asNonEmptyString(leg.symbol, `${field}.symbol`),
    quoteCurrency: asNonEmptyString(leg.quoteCurrency ?? "USDT", `${field}.quoteCurrency`),
    orderType: asNonEmptyString(leg.orderType ?? "limit", `${field}.orderType`),
    price: asPositiveNumber(leg.price, `${field}.price`),
    quantity: asPositiveNumber(leg.quantity, `${field}.quantity`),
  });
}

export function createOpportunitySignal(input) {
  if (!input || typeof input !== "object") {
    throw new DomainValidationError("OpportunitySignal 必须是对象", { value: input });
  }

  return freezeRecord({
    signalId: asNonEmptyString(input.signalId, "signalId"),
    symbol: asNonEmptyString(input.symbol, "symbol"),
    buyExchange: asNonEmptyString(input.buyExchange, "buyExchange"),
    sellExchange: asNonEmptyString(input.sellExchange, "sellExchange"),
    observedSpreadBps: asFiniteNumber(input.observedSpreadBps, "observedSpreadBps"),
    observedAt: asTimestamp(input.observedAt, "observedAt"),
    publishedAt: asTimestamp(input.publishedAt ?? input.observedAt, "publishedAt"),
    strategyVersion: asNonEmptyString(input.strategyVersion ?? "unknown", "strategyVersion"),
    payload: freezeRecord({ ...(input.payload ?? {}) }),
  });
}

export function createMarketSnapshot(input) {
  if (!input || typeof input !== "object") {
    throw new DomainValidationError("MarketSnapshot 必须是对象", { value: input });
  }

  return freezeRecord({
    snapshotId: asNonEmptyString(input.snapshotId, "snapshotId"),
    symbol: asNonEmptyString(input.symbol, "symbol"),
    timestamp: asTimestamp(input.timestamp, "timestamp"),
    fxUsdcUsdtMid: asPositiveNumber(input.fxUsdcUsdtMid, "fxUsdcUsdtMid"),
    fundingRateBps: {
      binance: asFiniteNumber(input.fundingRateBps?.binance ?? 0, "fundingRateBps.binance"),
      hyperliquid: asFiniteNumber(
        input.fundingRateBps?.hyperliquid ?? 0,
        "fundingRateBps.hyperliquid",
      ),
    },
    marginAvailableUsdt: {
      binance: asPositiveNumber(
        input.marginAvailableUsdt?.binance,
        "marginAvailableUsdt.binance",
      ),
      hyperliquid: asPositiveNumber(
        input.marginAvailableUsdt?.hyperliquid,
        "marginAvailableUsdt.hyperliquid",
      ),
    },
    books: freezeRecord({
      binance: freezeRecord({
        bestBid: validateBookLevel(input.books?.binance?.bestBid, "books.binance.bestBid"),
        bestAsk: validateBookLevel(input.books?.binance?.bestAsk, "books.binance.bestAsk"),
      }),
      hyperliquid: freezeRecord({
        bestBid: validateBookLevel(
          input.books?.hyperliquid?.bestBid,
          "books.hyperliquid.bestBid",
        ),
        bestAsk: validateBookLevel(
          input.books?.hyperliquid?.bestAsk,
          "books.hyperliquid.bestAsk",
        ),
      }),
    }),
    metadata: freezeRecord({ ...(input.metadata ?? {}) }),
  });
}

export function createExecutionPlan(input) {
  if (!input || typeof input !== "object") {
    throw new DomainValidationError("ExecutionPlan 必须是对象", { value: input });
  }

  return freezeRecord({
    planId: asNonEmptyString(input.planId, "planId"),
    signalId: asNonEmptyString(input.signalId, "signalId"),
    symbol: asNonEmptyString(input.symbol, "symbol"),
    mode: asNonEmptyString(input.mode, "mode"),
    targetNotionalUsdt: asPositiveNumber(input.targetNotionalUsdt, "targetNotionalUsdt"),
    expectedNetEdgeBps: asFiniteNumber(input.expectedNetEdgeBps, "expectedNetEdgeBps"),
    riskBudget: freezeRecord({
      maxUnhedgedMs: asPositiveNumber(input.riskBudget?.maxUnhedgedMs, "riskBudget.maxUnhedgedMs"),
      maxSlippageBps: asPositiveNumber(
        input.riskBudget?.maxSlippageBps,
        "riskBudget.maxSlippageBps",
      ),
    }),
    legs: Object.freeze((input.legs ?? []).map((leg, index) => validateLeg(leg, `legs[${index}]`))),
    parameterSnapshot: freezeRecord({ ...(input.parameterSnapshot ?? {}) }),
  });
}

export function createOrderIntent(input) {
  if (!input || typeof input !== "object") {
    throw new DomainValidationError("OrderIntent 必须是对象", { value: input });
  }

  return freezeRecord({
    orderId: asNonEmptyString(input.orderId, "orderId"),
    planId: asNonEmptyString(input.planId, "planId"),
    exchange: asNonEmptyString(input.exchange, "exchange"),
    symbol: asNonEmptyString(input.symbol, "symbol"),
    side: asNonEmptyString(input.side, "side"),
    orderType: asNonEmptyString(input.orderType, "orderType"),
    quantity: asPositiveNumber(input.quantity, "quantity"),
    price: asPositiveNumber(input.price, "price"),
    tif: asNonEmptyString(input.tif ?? "GTC", "tif"),
    role: asNonEmptyString(input.role ?? "maker", "role"),
  });
}

export function createFillEvent(input) {
  if (!input || typeof input !== "object") {
    throw new DomainValidationError("FillEvent 必须是对象", { value: input });
  }

  return freezeRecord({
    fillId: asNonEmptyString(input.fillId, "fillId"),
    orderId: asNonEmptyString(input.orderId, "orderId"),
    exchange: asNonEmptyString(input.exchange, "exchange"),
    symbol: asNonEmptyString(input.symbol, "symbol"),
    side: asNonEmptyString(input.side, "side"),
    quantity: asPositiveNumber(input.quantity, "quantity"),
    price: asPositiveNumber(input.price, "price"),
    feeUsdt: asFiniteNumber(input.feeUsdt ?? 0, "feeUsdt"),
    timestamp: asTimestamp(input.timestamp, "timestamp"),
  });
}

export function createPositionSnapshot(input) {
  if (!input || typeof input !== "object") {
    throw new DomainValidationError("PositionSnapshot 必须是对象", { value: input });
  }

  return freezeRecord({
    positionId: asNonEmptyString(input.positionId, "positionId"),
    symbol: asNonEmptyString(input.symbol, "symbol"),
    timestamp: asTimestamp(input.timestamp, "timestamp"),
    legs: Object.freeze((input.legs ?? []).map((leg, index) => ({
      exchange: asNonEmptyString(leg.exchange, `legs[${index}].exchange`),
      side: asNonEmptyString(leg.side, `legs[${index}].side`),
      quantity: asPositiveNumber(leg.quantity, `legs[${index}].quantity`),
      entryPrice: asPositiveNumber(leg.entryPrice, `legs[${index}].entryPrice`),
      markPrice: asPositiveNumber(leg.markPrice, `legs[${index}].markPrice`),
      notionalUsdt: asPositiveNumber(leg.notionalUsdt, `legs[${index}].notionalUsdt`),
    }))),
    unrealizedPnlUsdt: asFiniteNumber(input.unrealizedPnlUsdt ?? 0, "unrealizedPnlUsdt"),
  });
}

export function createRiskEvent(input) {
  if (!input || typeof input !== "object") {
    throw new DomainValidationError("RiskEvent 必须是对象", { value: input });
  }

  return freezeRecord({
    riskEventId: asNonEmptyString(input.riskEventId, "riskEventId"),
    type: asNonEmptyString(input.type, "type"),
    severity: asNonEmptyString(input.severity, "severity"),
    symbol: asNonEmptyString(input.symbol, "symbol"),
    planId: asNonEmptyString(input.planId ?? "unassigned", "planId"),
    timestamp: asTimestamp(input.timestamp, "timestamp"),
    message: asNonEmptyString(input.message, "message"),
    context: freezeRecord({ ...(input.context ?? {}) }),
  });
}
