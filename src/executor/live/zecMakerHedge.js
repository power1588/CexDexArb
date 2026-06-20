const BINANCE_SYMBOL = "ZEC/USDC";
const HYPERLIQUID_SYMBOL = "ZEC/USDC:USDC";

function parseNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getHedgeSide(binanceSide) {
  if (binanceSide === "buy") {
    return "sell";
  }

  if (binanceSide === "sell") {
    return "buy";
  }

  throw new Error(`不支持的 Binance 下单方向: ${binanceSide}`);
}

export function resolveHyperliquidCredentials(environmentVariables = {}) {
  return {
    privateKey:
      environmentVariables.HYPERLIQUID_PRIVATE_KEY ??
      environmentVariables.HYPERLIQUID_API_SECRET ??
      environmentVariables.HYPERLIQUID_API_KEY ??
      null,
    walletAddress:
      environmentVariables.HYPERLIQUID_WALLET_ADDRESS ??
      environmentVariables.HYPERLIQUID_ACCOUNT_ADDRESS ??
      null,
  };
}

export function resolveHyperliquidAccountAddress({
  configuredAddress,
  userRoleResponse,
} = {}) {
  if (!configuredAddress) {
    return null;
  }

  if (userRoleResponse?.role === "agent" && userRoleResponse?.data?.user) {
    return userRoleResponse.data.user;
  }

  return configuredAddress;
}

export function parseOpenZecArgs(argv = []) {
  const options = {
    binanceSymbol: BINANCE_SYMBOL,
    hyperliquidSymbol: HYPERLIQUID_SYMBOL,
    binanceSide: "buy",
    amount: null,
    binancePrice: null,
    leverage: 1,
    slippageBps: 8,
    pollIntervalMs: 1_000,
    makerTimeoutMs: 120_000,
    cancelOnTimeout: true,
    execute: false,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = argv[index + 1];

    switch (argument) {
      case "--amount":
        options.amount = parseNumber(nextValue);
        index += 1;
        break;
      case "--binance-price":
        options.binancePrice = parseNumber(nextValue);
        index += 1;
        break;
      case "--binance-side":
        options.binanceSide = nextValue;
        index += 1;
        break;
      case "--slippage-bps":
        options.slippageBps = parseNumber(nextValue, options.slippageBps);
        index += 1;
        break;
      case "--maker-timeout-ms":
        options.makerTimeoutMs = parseNumber(nextValue, options.makerTimeoutMs);
        index += 1;
        break;
      case "--poll-interval-ms":
        options.pollIntervalMs = parseNumber(nextValue, options.pollIntervalMs);
        index += 1;
        break;
      case "--hyperliquid-leverage":
        options.leverage = parseNumber(nextValue, options.leverage);
        index += 1;
        break;
      case "--no-cancel-on-timeout":
        options.cancelOnTimeout = false;
        break;
      case "--execute":
        options.execute = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      default:
        break;
    }
  }

  if (!["buy", "sell"].includes(options.binanceSide)) {
    throw new Error("--binance-side 只能是 buy 或 sell");
  }

  if (!Number.isFinite(options.amount) || options.amount <= 0) {
    throw new Error("--amount 必须是大于 0 的数字");
  }

  return options;
}

export function selectBinanceMakerPrice({
  side,
  manualPrice,
  orderBook,
} = {}) {
  if (Number.isFinite(manualPrice) && manualPrice > 0) {
    return manualPrice;
  }

  const bestBid = orderBook?.bids?.[0]?.[0];
  const bestAsk = orderBook?.asks?.[0]?.[0];

  if (side === "buy") {
    if (!Number.isFinite(bestBid)) {
      throw new Error("无法从 Binance 订单簿获取 best bid");
    }

    return bestBid;
  }

  if (!Number.isFinite(bestAsk)) {
    throw new Error("无法从 Binance 订单簿获取 best ask");
  }

  return bestAsk;
}

export function selectHyperliquidTakerPrice({
  side,
  orderBook,
  slippageBps,
  roundPrice,
} = {}) {
  const bestBid = orderBook?.bids?.[0]?.[0];
  const bestAsk = orderBook?.asks?.[0]?.[0];

  if (side === "buy") {
    if (!Number.isFinite(bestAsk)) {
      throw new Error("无法从 Hyperliquid 订单簿获取 best ask");
    }

    return roundPrice(bestAsk * (1 + slippageBps / 10_000));
  }

  if (!Number.isFinite(bestBid)) {
    throw new Error("无法从 Hyperliquid 订单簿获取 best bid");
  }

  return roundPrice(bestBid * (1 - slippageBps / 10_000));
}

export function summarizeOpenPlan({
  options,
  makerPrice,
  hedgeSide,
  hedgePrice,
  filledAmount,
} = {}) {
  return {
    strategy: "binance_maker_then_hyperliquid_taker",
    binanceSymbol: options.binanceSymbol,
    hyperliquidSymbol: options.hyperliquidSymbol,
    binanceSide: options.binanceSide,
    hyperliquidSide: hedgeSide,
    requestedAmount: options.amount,
    makerPrice,
    hedgePrice,
    filledAmount,
    leverage: options.leverage,
    slippageBps: options.slippageBps,
    execute: options.execute,
  };
}
