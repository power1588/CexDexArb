import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ccxt from "ccxt";
import {
  getHedgeSide,
  parseOpenZecArgs,
  resolveHyperliquidAccountAddress,
  resolveHyperliquidCredentials,
  selectBinanceMakerPrice,
  selectHyperliquidTakerPrice,
  summarizeOpenPlan,
} from "../src/executor/live/zecMakerHedge.js";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const contents = fs.readFileSync(filePath, "utf8");
  return contents.split("\n").reduce((result, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return result;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return result;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    result[key] = value;
    return result;
  }, {});
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function writeLine(message) {
  process.stdout.write(`${message}\n`);
}

function printStep(title, payload) {
  writeLine(`\n[${title}]`);
  writeLine(JSON.stringify(payload, null, 2));
}

function buildBinanceExchange(environmentVariables) {
  return new ccxt.binance({
    apiKey: environmentVariables.BINANCE_API_KEY,
    secret: environmentVariables.BINANCE_API_SECRET,
    enableRateLimit: true,
    options: {
      defaultType: "spot",
    },
  });
}

function buildHyperliquidExchange(environmentVariables) {
  const credentials = resolveHyperliquidCredentials(environmentVariables);

  return new ccxt.hyperliquid({
    privateKey: credentials.privateKey,
    walletAddress: credentials.walletAddress,
    enableRateLimit: true,
    options: {
      defaultType: "swap",
    },
  });
}

async function resolveHyperliquidUserContext(exchange, configuredAddress) {
  const role = await exchange.publicPostInfo({
    type: "userRole",
    user: configuredAddress,
  });
  const accountAddress = resolveHyperliquidAccountAddress({
    configuredAddress,
    userRoleResponse: role,
  });

  exchange.walletAddress = accountAddress;

  return {
    configuredAddress,
    accountAddress,
    role: role?.role ?? "unknown",
  };
}

function ensureCredentials(environmentVariables) {
  if (!environmentVariables.BINANCE_API_KEY || !environmentVariables.BINANCE_API_SECRET) {
    throw new Error("缺少 Binance 凭证，请在 .env 中设置 BINANCE_API_KEY 和 BINANCE_API_SECRET");
  }

  const { privateKey, walletAddress } = resolveHyperliquidCredentials(environmentVariables);
  if (!privateKey || !walletAddress) {
    throw new Error(
      "缺少 Hyperliquid 凭证，请在 .env 中设置 HYPERLIQUID_PRIVATE_KEY/HYPERLIQUID_API_KEY 与 HYPERLIQUID_WALLET_ADDRESS/HYPERLIQUID_ACCOUNT_ADDRESS",
    );
  }
}

async function createBinanceMakerOrder({
  exchange,
  symbol,
  side,
  amount,
  price,
}) {
  if (exchange.has.createPostOnlyOrder) {
    return exchange.createPostOnlyOrder(symbol, "limit", side, amount, price, {
      timeInForce: "GTC",
    });
  }

  return exchange.createOrder(symbol, "limit", side, amount, price, {
    timeInForce: "GTC",
    postOnly: true,
  });
}

async function waitForFullFill({
  exchange,
  symbol,
  orderId,
  timeoutMs,
  pollIntervalMs,
  cancelOnTimeout,
}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const order = await exchange.fetchOrder(orderId, symbol);
    printStep("Binance maker 订单状态", {
      id: order.id,
      status: order.status,
      filled: order.filled,
      remaining: order.remaining,
      average: order.average,
      price: order.price,
    });

    if (order.status === "closed" || order.remaining <= 0) {
      return order;
    }

    if (["canceled", "expired", "rejected"].includes(order.status)) {
      throw new Error(`Binance maker 订单未完全成交，状态为 ${order.status}`);
    }

    await sleep(pollIntervalMs);
  }

  if (cancelOnTimeout) {
    await exchange.cancelOrder(orderId, symbol);
  }

  throw new Error("Binance maker 订单在超时时间内未全部成交，已停止后续 Hyperliquid 对冲");
}

async function main() {
  const options = parseOpenZecArgs(process.argv.slice(2));
  const envPath = path.resolve(process.cwd(), ".env");
  const environmentVariables = {
    ...readEnvFile(envPath),
    ...process.env,
  };

  const binance = buildBinanceExchange(environmentVariables);
  const hyperliquid = buildHyperliquidExchange(environmentVariables);

  try {
    await Promise.all([binance.loadMarkets(), hyperliquid.loadMarkets()]);
    const configuredHyperliquidAddress =
      environmentVariables.HYPERLIQUID_WALLET_ADDRESS ??
      environmentVariables.HYPERLIQUID_ACCOUNT_ADDRESS;
    const hyperliquidUserContext = await resolveHyperliquidUserContext(
      hyperliquid,
      configuredHyperliquidAddress,
    );

    const binanceMarket = binance.market(options.binanceSymbol);
    const hyperliquidMarket = hyperliquid.market(options.hyperliquidSymbol);
    const roundedAmount = binance.amountToPrecision(options.binanceSymbol, options.amount);
    const numericAmount = Number(roundedAmount);
    const hedgeSide = getHedgeSide(options.binanceSide);

    const [binanceOrderBook, hyperliquidOrderBook] = await Promise.all([
      binance.fetchOrderBook(options.binanceSymbol),
      hyperliquid.fetchOrderBook(options.hyperliquidSymbol),
    ]);

    const makerPrice = Number(
      binance.priceToPrecision(
        options.binanceSymbol,
        selectBinanceMakerPrice({
          side: options.binanceSide,
          manualPrice: options.binancePrice,
          orderBook: binanceOrderBook,
        }),
      ),
    );
    const hedgePrice = Number(
      hyperliquid.priceToPrecision(
        options.hyperliquidSymbol,
        selectHyperliquidTakerPrice({
          side: hedgeSide,
          orderBook: hyperliquidOrderBook,
          slippageBps: options.slippageBps,
          roundPrice(value) {
            return value;
          },
        }),
      ),
    );

    printStep("市场信息", {
      binance: {
        symbol: binanceMarket.symbol,
        precision: binanceMarket.precision,
        limits: binanceMarket.limits,
      },
      hyperliquid: {
        symbol: hyperliquidMarket.symbol,
        precision: hyperliquidMarket.precision,
        limits: hyperliquidMarket.limits,
        userContext: {
          role: hyperliquidUserContext.role,
          configuredAddress:
            hyperliquidUserContext.configuredAddress?.slice(0, 10) + "...",
          accountAddress: hyperliquidUserContext.accountAddress?.slice(0, 10) + "...",
        },
      },
    });
    printStep(
      options.execute ? "下单计划（真实执行）" : "下单计划（仅预演，未真实下单）",
      summarizeOpenPlan({
        options,
        makerPrice,
        hedgeSide,
        hedgePrice,
      }),
    );

    if (!options.execute) {
      writeLine(
        "\n未传入 --execute，本次仅验证脚本逻辑与下单参数，不会向 Binance 或 Hyperliquid 发出真实订单。",
      );
      return;
    }

    ensureCredentials(environmentVariables);

    if (options.leverage > 1) {
      printStep("设置 Hyperliquid 杠杆", {
        symbol: options.hyperliquidSymbol,
        leverage: options.leverage,
      });
      await hyperliquid.setLeverage(options.leverage, options.hyperliquidSymbol);
    }

    printStep("Binance maker 下单请求", {
      symbol: options.binanceSymbol,
      side: options.binanceSide,
      amount: numericAmount,
      price: makerPrice,
    });
    const makerOrder = await createBinanceMakerOrder({
      exchange: binance,
      symbol: options.binanceSymbol,
      side: options.binanceSide,
      amount: numericAmount,
      price: makerPrice,
    });
    printStep("Binance maker 下单回报", makerOrder);

    const filledMakerOrder = await waitForFullFill({
      exchange: binance,
      symbol: options.binanceSymbol,
      orderId: makerOrder.id,
      timeoutMs: options.makerTimeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      cancelOnTimeout: options.cancelOnTimeout,
    });

    const filledAmount = Number(
      hyperliquid.amountToPrecision(options.hyperliquidSymbol, filledMakerOrder.filled),
    );
    const refreshedHyperliquidOrderBook = await hyperliquid.fetchOrderBook(options.hyperliquidSymbol);
    const refreshedHedgePrice = Number(
      hyperliquid.priceToPrecision(
        options.hyperliquidSymbol,
        selectHyperliquidTakerPrice({
          side: hedgeSide,
          orderBook: refreshedHyperliquidOrderBook,
          slippageBps: options.slippageBps,
          roundPrice(value) {
            return value;
          },
        }),
      ),
    );

    printStep("Hyperliquid taker 下单请求", {
      symbol: options.hyperliquidSymbol,
      side: hedgeSide,
      amount: filledAmount,
      price: refreshedHedgePrice,
      params: {
        timeInForce: "IOC",
      },
    });
    const hedgeOrder = await hyperliquid.createOrder(
      options.hyperliquidSymbol,
      "limit",
      hedgeSide,
      filledAmount,
      refreshedHedgePrice,
      {
        timeInForce: "IOC",
      },
    );
    printStep(
      "开仓完成",
      summarizeOpenPlan({
        options,
        makerPrice,
        hedgeSide,
        hedgePrice: refreshedHedgePrice,
        filledAmount,
      }),
    );
    printStep("Hyperliquid taker 下单回报", hedgeOrder);
  } finally {
    await Promise.allSettled([binance.close(), hyperliquid.close()]);
  }
}

main().catch((error) => {
  console.error("\n[open-zecusdc failed]");
  console.error(error);
  process.exitCode = 1;
});
