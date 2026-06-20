const DEFAULT_SYMBOL = "ZEC/USDC:USDC";
const DEFAULT_SIDE = "buy";
const DEFAULT_PRICE = 450;

function parseNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundUpToDecimals(value, decimals) {
  const factor = 10 ** decimals;
  return Math.ceil((value - Number.EPSILON) * factor) / factor;
}

function inferDecimalsFromStep(step) {
  const normalized = String(step);
  const decimalIndex = normalized.indexOf(".");
  if (decimalIndex === -1) {
    return 0;
  }

  return normalized.slice(decimalIndex + 1).replace(/0+$/, "").length;
}

function roundUpToStep(value, step) {
  const units = Math.ceil((value - Number.EPSILON) / step);
  const rounded = units * step;
  return Number(rounded.toFixed(inferDecimalsFromStep(step)));
}

export function parseHyperliquidLiveOrderArgs(argv = []) {
  const options = {
    symbol: DEFAULT_SYMBOL,
    side: DEFAULT_SIDE,
    price: DEFAULT_PRICE,
    amount: null,
    leverage: 1,
    execute: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = argv[index + 1];

    switch (argument) {
      case "--price":
        options.price = parseNumber(nextValue, options.price);
        index += 1;
        break;
      case "--amount":
        options.amount = parseNumber(nextValue);
        index += 1;
        break;
      case "--side":
        options.side = nextValue;
        index += 1;
        break;
      case "--symbol":
        options.symbol = nextValue;
        index += 1;
        break;
      case "--leverage":
        options.leverage = parseNumber(nextValue, options.leverage);
        index += 1;
        break;
      case "--execute":
        options.execute = true;
        break;
      default:
        break;
    }
  }

  if (!["buy", "sell"].includes(options.side)) {
    throw new Error("--side 只能是 buy 或 sell");
  }

  if (!Number.isFinite(options.price) || options.price <= 0) {
    throw new Error("--price 必须是大于 0 的数字");
  }

  if (options.amount !== null && (!Number.isFinite(options.amount) || options.amount <= 0)) {
    throw new Error("--amount 必须是大于 0 的数字");
  }

  return options;
}

export function computeMinimumExecutableAmount({
  price,
  minAmount,
  minCost,
  amountPrecision,
} = {}) {
  const amountFloor = Number.isFinite(minAmount) ? minAmount : 0;
  const costFloor =
    Number.isFinite(minCost) && Number.isFinite(price) && price > 0 ? minCost / price : 0;
  const rawAmount = Math.max(amountFloor, costFloor);

  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error("无法根据市场限制计算最小下单量");
  }

  if (!Number.isFinite(amountPrecision) || amountPrecision < 0) {
    return rawAmount;
  }

  if (amountPrecision > 0 && amountPrecision < 1) {
    return roundUpToStep(rawAmount, amountPrecision);
  }

  return roundUpToDecimals(rawAmount, amountPrecision);
}

export function buildConfirmationPhrase({ side, symbol, price, amount } = {}) {
  const compactSymbol = String(symbol ?? "").replace(/[^A-Za-z0-9]/g, "");
  return `CONFIRM ${String(side ?? "").toUpperCase()} ${compactSymbol} ${price} ${amount}`;
}
