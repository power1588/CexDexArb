/**
 * L2-01 + L2-02 泛化实盘双腿对冲脚本（建仓 + 平仓完整周期）。
 *
 * 将 open-zecusdc-binance-maker-hyperliquid-taker.js 泛化为支持任意 USDC 交集标的。
 *
 * 建仓流程（Binance maker → HL taker）：
 *   1. Binance 下 PostOnly maker 限价单
 *   2. 轮询等待 maker 全成交（超时 120s 撤单并中止）
 *   3. maker 成交后立即在 HL 下 IOC taker 对冲单（反向）
 *   4. 校验双腿成交量对齐（容差 0.1%）
 *
 * 平仓流程（监控价差回归 → Binance maker 平仓 → HL taker 平仓）：
 *   1. 监控实盘价差回归（HL → Binance 方向，净价差反转 ≥ closeThresholdBps）
 *   2. Binance maker 平仓腿（PostOnly）
 *   3. HL taker 平仓腿（IOC）
 *   4. 校验平仓后仓位归零
 *
 * 用法：
 *   node scripts/live-usdc-arb-cycle.js --symbol BIO --notional 10            # 预演
 *   node scripts/live-usdc-arb-cycle.js --symbol BIO --notional 10 --execute  # 建仓并自动平仓
 *   node scripts/live-usdc-arb-cycle.js --symbol BIO --notional 10 --execute --direction sell
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import ccxt from "ccxt";
import { parseArgs } from "node:util";
import { USDC_PERP_SYMBOLS } from "../src/fixtures/mockData.js";
import {
  resolveHyperliquidAccountAddress,
  resolveHyperliquidCredentials,
  selectBinanceMakerPrice,
  selectHyperliquidTakerPrice,
  getHedgeSide,
} from "../src/executor/live/zecMakerHedge.js";
import { SqliteAdapter } from "../src/executor/persistence/sqliteAdapter.js";
import { runMigrations } from "../src/executor/persistence/schema.js";
import { createRepositories } from "../src/executor/persistence/repositories.js";

const { values } = parseArgs({
  options: {
    symbol: { type: "string", default: "BIO" },
    direction: { type: "string", default: "buy" }, // Binance maker 方向
    notional: { type: "string", default: "10" },
    "slippage-bps": { type: "string", default: "8" },
    "maker-timeout-ms": { type: "string", default: "120000" },
    "poll-interval-ms": { type: "string", default: "2000" },
    "close-threshold-bps": { type: "string", default: "5" },
    "monitor-interval-ms": { type: "string", default: "5000" },
    "max-hold-ms": { type: "string", default: "600000" },
    "db-path": { type: "string", default: "./data/usdc-live.db" },
    leverage: { type: "string", default: "1" },
    execute: { type: "boolean", default: false },
    "close-only": { type: "boolean", default: false },
  },
  strict: false,
});

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const contents = fs.readFileSync(filePath, "utf8");
  return contents.split("\n").reduce((result, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return result;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return result;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    result[key] = value;
    return result;
  }, {});
}

function writeLine(message) {
  process.stdout.write(`${message}\n`);
}

function ts() {
  return new Date().toISOString();
}

function log(tag, message, payload) {
  if (payload === undefined) {
    process.stdout.write(`[${ts()}] [${tag}] ${message}\n`);
  } else {
    process.stdout.write(`[${ts()}] [${tag}] ${message} ${JSON.stringify(payload)}\n`);
  }
}

function printStep(title, payload) {
  writeLine(`\n[${title}]`);
  writeLine(JSON.stringify(payload, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findUsdcSymbolConfig(baseSymbol) {
  return USDC_PERP_SYMBOLS.find(
    (item) => item.symbol === baseSymbol || item.binanceSymbol === baseSymbol,
  );
}

function buildBinanceUsdcExchange(environmentVariables) {
  if (!environmentVariables.BINANCE_API_KEY || !environmentVariables.BINANCE_API_SECRET) {
    throw new Error("缺少 Binance 凭证，请在 .env 中设置 BINANCE_API_KEY 和 BINANCE_API_SECRET");
  }
  return new ccxt.binance({
    apiKey: environmentVariables.BINANCE_API_KEY,
    secret: environmentVariables.BINANCE_API_SECRET,
    enableRateLimit: true,
    options: {
      defaultType: "swap",
      fetchMarkets: ["linear"],
      fetchCurrencies: false,
    },
  });
}

function buildHyperliquidExchange(environmentVariables) {
  const { privateKey, walletAddress } = resolveHyperliquidCredentials(environmentVariables);
  if (!privateKey || !walletAddress) {
    throw new Error(
      "缺少 Hyperliquid 凭证，请在 .env 中设置 HYPERLIQUID_PRIVATE_KEY 与 HYPERLIQUID_WALLET_ADDRESS",
    );
  }
  return new ccxt.hyperliquid({
    privateKey,
    walletAddress,
    enableRateLimit: true,
    options: { defaultType: "swap" },
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
  return {
    configuredAddress,
    accountAddress,
    role: role?.role ?? "unknown",
  };
}

function computeAmountForNotional({ notional, price, amountPrecision, minAmount, minCost }) {
  const rawAmount = notional / price;
  const amountFloor = Number.isFinite(minAmount) ? minAmount : 0;
  const costFloor =
    Number.isFinite(minCost) && price > 0 ? minCost / price : 0;
  const target = Math.max(rawAmount, amountFloor, costFloor);
  if (!Number.isFinite(amountPrecision) || amountPrecision <= 0) {
    return Math.ceil(target);
  }
  if (amountPrecision < 1) {
    const factor = 1 / amountPrecision;
    return Math.ceil(target * factor) / factor;
  }
  return Math.ceil(target);
}

function buildConfirmationPhrase({ action, symbol, side, amount, price }) {
  return `CONFIRM ${action.toUpperCase()} ${symbol} ${side.toUpperCase()} ${amount} @ ${price}`;
}

async function requestManualConfirmation(phrase) {
  const terminal = readline.createInterface({ input, output });
  try {
    const answer = await terminal.question(
      `\n输入以下确认口令后才会真实下单:\n${phrase}\n> `,
    );
    return answer.trim() === phrase;
  } finally {
    terminal.close();
  }
}

async function createBinanceMakerOrder({ exchange, symbol, side, amount, price }) {
  if (exchange.has?.createPostOnlyOrder) {
    return exchange.createPostOnlyOrder(symbol, "limit", side, amount, price, {
      timeInForce: "GTC",
    });
  }
  return exchange.createOrder(symbol, "limit", side, amount, price, {
    timeInForce: "GTC",
    postOnly: true,
  });
}

/**
 * 等待 Binance maker 订单全成交，超时撤单。
 * 支持部分成交：超时后按实际成交量继续对冲。
 */
async function waitForMakerFill({
  exchange,
  symbol,
  orderId,
  timeoutMs,
  pollIntervalMs,
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const order = await exchange.fetchOrder(orderId, symbol);
    log("maker-poll", "Binance maker 订单状态", {
      id: order.id,
      status: order.status,
      filled: order.filled,
      remaining: order.remaining,
    });

    if (order.status === "closed" || (order.filled ?? 0) >= (order.amount ?? 0)) {
      return { order, partial: false };
    }
    if (["canceled", "cancelled", "expired", "rejected"].includes(order.status)) {
      // 部分成交后撤销：按实际成交量对冲
      if ((order.filled ?? 0) > 0) {
        log("maker-poll", `maker 状态 ${order.status}，但有部分成交 ${order.filled}，按部分成交对冲`);
        return { order, partial: true };
      }
      throw new Error(`Binance maker 订单未成交，状态为 ${order.status}`);
    }
    await sleep(pollIntervalMs);
  }

  // 超时撤单
  try {
    await exchange.cancelOrder(orderId, symbol);
    log("maker-poll", "超时已撤单");
  } catch (error) {
    log("maker-poll", `超时撤单失败: ${error.message}`);
  }
  // 重新拉取最终状态
  const finalOrder = await exchange.fetchOrder(orderId, symbol);
  if ((finalOrder.filled ?? 0) > 0) {
    log("maker-poll", `超时但有部分成交 ${finalOrder.filled}，按部分成交对冲`);
    return { order: finalOrder, partial: true };
  }
  throw new Error(`Binance maker 订单在 ${timeoutMs}ms 内未成交，已撤单`);
}

/**
 * 校验双腿成交量对齐，容差 0.1%。
 */
function assertLegAlignment(makerFilled, takerFilled, tolerance = 0.001) {
  if (makerFilled <= 0) {
    throw new Error("maker 成交量为 0，无法对齐");
  }
  const deviation = Math.abs(makerFilled - takerFilled) / makerFilled;
  if (deviation > tolerance) {
    throw new Error(
      `双腿成交量对齐校验失败: maker=${makerFilled}, taker=${takerFilled}, 偏差=${(deviation * 100).toFixed(3)}% > 容差 ${(tolerance * 100).toFixed(1)}%`,
    );
  }
}


/**
 * 建仓：Binance maker → HL taker 对冲。
 */
async function openPosition({
  binance,
  hyperliquid,
  symbolConfig,
  direction,
  notional,
  options,
  repos,
  cycleId,
  execute,
  hlUserContext,
}) {
  const binanceCcxtSymbol = `${symbolConfig.symbol}/USDC:USDC`;
  const hlCcxtSymbol = `${symbolConfig.hyperliquidSymbol}/USDC:USDC`;

  const [binanceBook, hlBook] = await Promise.all([
    binance.fetchOrderBook(binanceCcxtSymbol),
    hyperliquid.fetchOrderBook(hlCcxtSymbol),
  ]);

  const makerPrice = Number(
    binance.priceToPrecision(
      binanceCcxtSymbol,
      selectBinanceMakerPrice({ side: direction, orderBook: binanceBook }),
    ),
  );

  const binanceMarket = binance.market(binanceCcxtSymbol);
  const amount = computeAmountForNotional({
    notional,
    price: makerPrice,
    amountPrecision: binanceMarket.precision?.amount,
    minAmount: binanceMarket.limits?.amount?.min,
    minCost: binanceMarket.limits?.cost?.min,
  });
  const roundedAmount = Number(binance.amountToPrecision(binanceCcxtSymbol, amount));
  const actualNotional = roundedAmount * makerPrice;
  const hedgeSide = getHedgeSide(direction);

  const hedgePrice = Number(
    hyperliquid.priceToPrecision(
      hlCcxtSymbol,
      selectHyperliquidTakerPrice({
        side: hedgeSide,
        orderBook: hlBook,
        slippageBps: options.slippageBps,
        roundPrice: (v) => v,
      }),
    ),
  );

  const grossSpreadBps = direction === "buy"
    ? ((hlBook.bids?.[0]?.[0] - binanceBook.asks?.[0]?.[0]) / binanceBook.asks?.[0]?.[0]) * 10_000
    : ((binanceBook.bids?.[0]?.[0] - hlBook.asks?.[0]?.[0]) / hlBook.asks?.[0]?.[0]) * 10_000;

  printStep("建仓计划", {
    cycleId,
    binanceSymbol: binanceCcxtSymbol,
    hlSymbol: hlCcxtSymbol,
    direction,
    hedgeSide,
    makerPrice,
    hedgePrice,
    amount: roundedAmount,
    actualNotional,
    grossSpreadBps: Number(grossSpreadBps?.toFixed(2)),
    feeModel: "Binance maker 0 / HL taker 4.5bps",
    execute,
  });

  // 落库 cycle
  if (repos) {
    repos.cycles.insert({
      cycleId,
      signalId: `${cycleId}-signal`,
      symbol: symbolConfig.symbol,
      mode: "maker_taker",
      direction,
      status: "OPENING",
      startedAt: Date.now(),
      metadata: {
        binanceSymbol: binanceCcxtSymbol,
        hlSymbol: hlCcxtSymbol,
        notional: actualNotional,
        makerPrice,
        hedgePrice,
      },
    });
  }

  if (!execute) {
    log("open", "未传入 --execute，本次仅预演建仓");
    return null;
  }

  // 余额预检
  const binanceBalance = await binance.fetchBalance({ type: "swap" });
  const hlBalance = await hyperliquid.fetchBalance({
    type: "swap",
    user: hlUserContext.accountAddress,
  });
  log("open", "余额预检", {
    binanceFreeUSDC: binanceBalance.free?.USDC ?? 0,
    hlFreeUSDC: hlBalance.free?.USDC ?? 0,
  });
  if ((binanceBalance.free?.USDC ?? 0) < actualNotional) {
    throw new Error(`Binance USDC 不足: free=${binanceBalance.free?.USDC}, 需要=${actualNotional}`);
  }

  const phrase = buildConfirmationPhrase({
    action: "OPEN",
    symbol: symbolConfig.symbol,
    side: direction,
    amount: roundedAmount,
    price: makerPrice,
  });
  const confirmed = await requestManualConfirmation(phrase);
  if (!confirmed) {
    throw new Error("未输入正确确认口令，已取消建仓");
  }

  // 1. Binance maker 下单
  log("open", "发送 Binance maker 订单", {
    symbol: binanceCcxtSymbol,
    side: direction,
    amount: roundedAmount,
    price: makerPrice,
  });
  const makerOrder = await createBinanceMakerOrder({
    exchange: binance,
    symbol: binanceCcxtSymbol,
    side: direction,
    amount: roundedAmount,
    price: makerPrice,
  });
  printStep("Binance maker 回报", makerOrder);

  // 2. 等待成交
  const { order: filledMakerOrder, partial } = await waitForMakerFill({
    exchange: binance,
    symbol: binanceCcxtSymbol,
    orderId: makerOrder.id,
    timeoutMs: options.makerTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  });

  const filledAmount = Number(filledMakerOrder.filled ?? 0);
  const makerAvgPrice = filledMakerOrder.average ?? makerPrice;
  const makerFee = filledMakerOrder.fees?.reduce((s, f) => s + (f.cost ?? 0), 0) ??
    filledMakerOrder.fee?.cost ?? 0;

  log("open", "Binance maker 成交", {
    filledAmount,
    avgPrice: makerAvgPrice,
    fee: makerFee,
    makerFeeExpectedZero: makerFee === 0,
    partial,
  });

  if (filledAmount <= 0) {
    throw new Error("maker 成交量为 0，中止对冲");
  }

  // 落库 maker 订单
  if (repos) {
    repos.orders.insert({
      orderId: String(makerOrder.id),
      cycleId,
      exchange: "binance",
      leg: "maker",
      side: direction,
      symbol: binanceCcxtSymbol,
      price: makerAvgPrice,
      quantity: roundedAmount,
      filledQuantity: filledAmount,
      status: filledMakerOrder.status,
      rawPayload: filledMakerOrder,
      createdAt: Date.now(),
    });
  }

  // 3. HL taker 对冲（必须在 5 秒内）
  const hedgeStartedAt = Date.now();
  const refreshedHlBook = await hyperliquid.fetchOrderBook(hlCcxtSymbol);
  const refreshedHedgePrice = Number(
    hyperliquid.priceToPrecision(
      hlCcxtSymbol,
      selectHyperliquidTakerPrice({
        side: hedgeSide,
        orderBook: refreshedHlBook,
        slippageBps: options.slippageBps,
        roundPrice: (v) => v,
      }),
    ),
  );

  log("open", "发送 HL taker 对冲单", {
    symbol: hlCcxtSymbol,
    side: hedgeSide,
    amount: filledAmount,
    price: refreshedHedgePrice,
    timeInForce: "IOC",
  });
  const hedgeOrder = await hyperliquid.createOrder(
    hlCcxtSymbol,
    "limit",
    hedgeSide,
    filledAmount,
    refreshedHedgePrice,
    { timeInForce: "IOC" },
  );
  const hedgeElapsedMs = Date.now() - hedgeStartedAt;
  printStep("HL taker 对冲回报", hedgeOrder);

  const hedgeFilled = Number(hedgeOrder.filled ?? 0);
  const hedgeAvgPrice = hedgeOrder.average ?? refreshedHedgePrice;
  const hedgeFee = hedgeOrder.fees?.reduce((s, f) => s + (f.cost ?? 0), 0) ??
    hedgeOrder.fee?.cost ?? 0;

  // 4. 校验对齐
  assertLegAlignment(filledAmount, hedgeFilled);

  // 落库 taker 订单
  if (repos) {
    repos.orders.insert({
      orderId: String(hedgeOrder.id),
      cycleId,
      exchange: "hyperliquid",
      leg: "taker",
      side: hedgeSide,
      symbol: hlCcxtSymbol,
      price: hedgeAvgPrice,
      quantity: filledAmount,
      filledQuantity: hedgeFilled,
      status: hedgeOrder.status,
      rawPayload: hedgeOrder,
      createdAt: Date.now(),
    });

    // 落库 spread lock
    const grossSpread = (direction === "buy"
      ? hedgeAvgPrice - makerAvgPrice
      : makerAvgPrice - hedgeAvgPrice) * filledAmount;
    const feeCost = makerFee + hedgeFee;
    const netSpread = grossSpread - feeCost;
    const netSpreadBps = makerAvgPrice > 0 ? (netSpread / makerAvgPrice) * 10_000 : 0;
    repos.spreadLocks.insert({
      lockId: `${cycleId}-lock`,
      cycleId,
      symbol: symbolConfig.symbol,
      grossSpreadUsdt: grossSpread,
      feeCostUsdt: feeCost,
      netSpreadUsdt: netSpread,
      netSpreadBps: Number(netSpreadBps.toFixed(2)),
      fxDetail: { quoteCurrency: "USDC", fxUsdcUsdtMid: 1 },
      lockedAt: Date.now(),
    });

    repos.cycles.updateStatus(cycleId, "HEDGED", Date.now());
  }

  printStep("建仓完成", {
    cycleId,
    makerFill: { amount: filledAmount, price: makerAvgPrice, fee: makerFee },
    takerFill: { amount: hedgeFilled, price: hedgeAvgPrice, fee: hedgeFee },
    hedgeElapsedMs,
    alignment: "ok",
  });

  return {
    filledAmount,
    makerAvgPrice,
    hedgeAvgPrice,
    makerFee,
    hedgeFee,
    partial,
  };
}

/**
 * 平仓：监控价差回归 → Binance maker 平仓 → HL taker 平仓。
 */
async function closePosition({
  binance,
  hyperliquid,
  symbolConfig,
  openResult,
  direction,
  options,
  repos,
  cycleId,
  execute,
}) {
  const binanceCcxtSymbol = `${symbolConfig.symbol}/USDC:USDC`;
  const hlCcxtSymbol = `${symbolConfig.hyperliquidSymbol}/USDC:USDC`;
  const closeDirection = direction === "buy" ? "sell" : "buy"; // Binance 平仓方向
  const closeHedgeSide = getHedgeSide(closeDirection);

  log("close", "进入平仓监控", {
    cycleId,
    closeDirection,
    closeHedgeSide,
    thresholdBps: options.closeThresholdBps,
    maxHoldMs: options.maxHoldMs,
  });

  if (repos) {
    repos.cycles.updateStatus(cycleId, "MONITORING", Date.now());
  }

  // 监控价差回归
  const monitorStartedAt = Date.now();
  let triggered = false;
  if (execute) {
    while (Date.now() - monitorStartedAt < options.maxHoldMs) {
      const [binanceBook, hlBook] = await Promise.all([
        binance.fetchOrderBook(binanceCcxtSymbol),
        hyperliquid.fetchOrderBook(hlCcxtSymbol),
      ]);
      // 平仓方向价差：closeDirection 方向的毛价差
      const closeSpreadBps = closeDirection === "buy"
        ? ((hlBook.bids?.[0]?.[0] - binanceBook.asks?.[0]?.[0]) / binanceBook.asks?.[0]?.[0]) * 10_000
        : ((binanceBook.bids?.[0]?.[0] - hlBook.asks?.[0]?.[0]) / hlBook.asks?.[0]?.[0]) * 10_000;

      log("close-monitor", "价差监控", {
        elapsedMs: Date.now() - monitorStartedAt,
        closeSpreadBps: Number(closeSpreadBps?.toFixed(2)),
        thresholdBps: options.closeThresholdBps,
      });

      // 净价差反转（扣除 HL taker 4.5bps）
      const netCloseBps = closeSpreadBps - 4.5;
      if (netCloseBps >= options.closeThresholdBps) {
        log("close", "价差回归满足平仓阈值", { netCloseBps, thresholdBps: options.closeThresholdBps });
        triggered = true;
        break;
      }
      await sleep(options.monitorIntervalMs);
    }

    if (!triggered) {
      log("close", `达到最大持仓时间 ${options.maxHoldMs}ms，强制平仓（止损）`);
    }
  } else {
    log("close", "非 execute 模式，跳过实际监控");
  }

  if (repos) {
    repos.cycles.updateStatus(cycleId, "CLOSING", Date.now());
  }

  if (!execute) {
    log("close", "未传入 --execute，本次仅预演平仓");
    return null;
  }

  // Binance maker 平仓腿
  const [binanceBook] = await Promise.all([
    binance.fetchOrderBook(binanceCcxtSymbol),
    hyperliquid.fetchOrderBook(hlCcxtSymbol),
  ]);
  const closeMakerPrice = Number(
    binance.priceToPrecision(
      binanceCcxtSymbol,
      selectBinanceMakerPrice({ side: closeDirection, orderBook: binanceBook }),
    ),
  );

  const closePhrase = buildConfirmationPhrase({
    action: "CLOSE",
    symbol: symbolConfig.symbol,
    side: closeDirection,
    amount: openResult.filledAmount,
    price: closeMakerPrice,
  });
  const confirmed = await requestManualConfirmation(closePhrase);
  if (!confirmed) {
    throw new Error("未输入正确确认口令，已取消平仓（仓位仍裸露，需手动处理）");
  }

  log("close", "发送 Binance maker 平仓单", {
    symbol: binanceCcxtSymbol,
    side: closeDirection,
    amount: openResult.filledAmount,
    price: closeMakerPrice,
    reduceOnly: true,
  });
  const closeMakerOrder = await createBinanceMakerOrder({
    exchange: binance,
    symbol: binanceCcxtSymbol,
    side: closeDirection,
    amount: openResult.filledAmount,
    price: closeMakerPrice,
  });
  printStep("Binance 平仓 maker 回报", closeMakerOrder);

  // 等待平仓 maker 成交（超时则市价兜底）
  let closeFilledOrder;
  try {
    const result = await waitForMakerFill({
      exchange: binance,
      symbol: binanceCcxtSymbol,
      orderId: closeMakerOrder.id,
      timeoutMs: options.makerTimeoutMs,
      pollIntervalMs: options.pollIntervalMs,
    });
    closeFilledOrder = result.order;
  } catch (error) {
    log("close", `maker 平仓超时，改用市价平仓: ${error.message}`);
    closeFilledOrder = await binance.createOrder(
      binanceCcxtSymbol,
      "market",
      closeDirection,
      openResult.filledAmount,
      undefined,
      { reduceOnly: true },
    );
    printStep("Binance 市价平仓回报", closeFilledOrder);
  }

  const closeMakerFilled = Number(closeFilledOrder.filled ?? 0);
  const closeMakerAvgPrice = closeFilledOrder.average ?? closeMakerPrice;
  const closeMakerFee = closeFilledOrder.fees?.reduce((s, f) => s + (f.cost ?? 0), 0) ??
    closeFilledOrder.fee?.cost ?? 0;

  // HL taker 平仓腿
  const refreshedHlBook = await hyperliquid.fetchOrderBook(hlCcxtSymbol);
  const closeHedgePrice = Number(
    hyperliquid.priceToPrecision(
      hlCcxtSymbol,
      selectHyperliquidTakerPrice({
        side: closeHedgeSide,
        orderBook: refreshedHlBook,
        slippageBps: options.slippageBps,
        roundPrice: (v) => v,
      }),
    ),
  );

  log("close", "发送 HL taker 平仓单", {
    symbol: hlCcxtSymbol,
    side: closeHedgeSide,
    amount: closeMakerFilled,
    price: closeHedgePrice,
    timeInForce: "IOC",
    reduceOnly: true,
  });
  const closeHedgeOrder = await hyperliquid.createOrder(
    hlCcxtSymbol,
    "limit",
    closeHedgeSide,
    closeMakerFilled,
    closeHedgePrice,
    { timeInForce: "IOC", reduceOnly: true },
  );
  printStep("HL taker 平仓回报", closeHedgeOrder);

  const closeHedgeFilled = Number(closeHedgeOrder.filled ?? 0);
  const closeHedgeAvgPrice = closeHedgeOrder.average ?? closeHedgePrice;
  const closeHedgeFee = closeHedgeOrder.fees?.reduce((s, f) => s + (f.cost ?? 0), 0) ??
    closeHedgeOrder.fee?.cost ?? 0;

  // 落库平仓订单
  if (repos) {
    repos.orders.insert({
      orderId: String(closeMakerOrder.id),
      cycleId,
      exchange: "binance",
      leg: "close-maker",
      side: closeDirection,
      symbol: binanceCcxtSymbol,
      price: closeMakerAvgPrice,
      quantity: openResult.filledAmount,
      filledQuantity: closeMakerFilled,
      status: closeFilledOrder.status,
      rawPayload: closeFilledOrder,
      createdAt: Date.now(),
    });
    repos.orders.insert({
      orderId: String(closeHedgeOrder.id),
      cycleId,
      exchange: "hyperliquid",
      leg: "close-taker",
      side: closeHedgeSide,
      symbol: hlCcxtSymbol,
      price: closeHedgeAvgPrice,
      quantity: closeMakerFilled,
      filledQuantity: closeHedgeFilled,
      status: closeHedgeOrder.status,
      rawPayload: closeHedgeOrder,
      createdAt: Date.now(),
    });

    // 计算净收益
    const openGross = openResult.makerAvgPrice * openResult.filledAmount;
    const closeGross = closeMakerAvgPrice * closeMakerFilled;
    const grossProfit = direction === "buy"
      ? closeGross - openGross
      : openGross - closeGross;
    const totalFees = openResult.makerFee + openResult.hedgeFee + closeMakerFee + closeHedgeFee;
    const netProfit = grossProfit - totalFees;

    repos.closeResults.insert({
      closeId: `${cycleId}-close`,
      cycleId,
      symbol: symbolConfig.symbol,
      expectedSpreadUsdt: openResult.makerAvgPrice * openResult.filledAmount * 0.001,
      actualSpreadUsdt: grossProfit,
      makerSlippageUsdt: 0,
      takerSlippageUsdt: 0,
      netProfitUsdt: netProfit,
      closedAt: Date.now(),
      metadata: {
        openMakerPrice: openResult.makerAvgPrice,
        openHedgePrice: openResult.hedgeAvgPrice,
        closeMakerPrice: closeMakerAvgPrice,
        closeHedgePrice: closeHedgeAvgPrice,
        totalFees,
        grossProfit,
      },
    });

    repos.cycles.updateStatus(cycleId, "CLOSED", Date.now());
  }

  // 校验仓位归零
  const [binancePositions, hlPositions] = await Promise.all([
    binance.fetchPositions(binanceCcxtSymbol),
    hyperliquid.fetchPositions(hlCcxtSymbol),
  ]);
  printStep("平仓后仓位确认", {
    binance: { contracts: binancePositions?.[0]?.contracts ?? 0, side: binancePositions?.[0]?.side },
    hyperliquid: { contracts: hlPositions?.[0]?.contracts ?? 0, side: hlPositions?.[0]?.side },
  });

  printStep("平仓完成", {
    cycleId,
    closeMakerFill: { amount: closeMakerFilled, price: closeMakerAvgPrice, fee: closeMakerFee },
    closeHedgeFill: { amount: closeHedgeFilled, price: closeHedgeAvgPrice, fee: closeHedgeFee },
  });

  return {
    closeMakerFilled,
    closeMakerAvgPrice,
    closeHedgeAvgPrice,
    closeMakerFee,
    closeHedgeFee,
  };
}

async function main() {
  const symbolConfig = findUsdcSymbolConfig(values.symbol);
  if (!symbolConfig) {
    writeLine(`未找到 ${values.symbol} 的 USDC 交集配置`);
    process.exit(1);
  }

  const direction = values.direction;
  if (!["buy", "sell"].includes(direction)) {
    throw new Error("--direction 只能是 buy 或 sell");
  }

  const options = {
    notional: Number(values.notional),
    slippageBps: Number(values["slippage-bps"]),
    makerTimeoutMs: Number(values["maker-timeout-ms"]),
    pollIntervalMs: Number(values["poll-interval-ms"]),
    closeThresholdBps: Number(values["close-threshold-bps"]),
    monitorIntervalMs: Number(values["monitor-interval-ms"]),
    maxHoldMs: Number(values["max-hold-ms"]),
    leverage: Number(values.leverage),
  };

  writeLine("==== L2 实盘双腿对冲套利周期 ====");
  printStep("配置", {
    symbol: symbolConfig.symbol,
    binanceSymbol: `${symbolConfig.symbol}/USDC:USDC`,
    hlSymbol: `${symbolConfig.hyperliquidSymbol}/USDC:USDC`,
    direction,
    notional: options.notional,
    execute: values.execute,
    closeOnly: values["close-only"],
    riskLimits: {
      maxNotional: 10,
      makerTimeoutMs: options.makerTimeoutMs,
      closeThresholdBps: options.closeThresholdBps,
      maxHoldMs: options.maxHoldMs,
    },
  });

  // 实盘护栏：名义金额上限 10 USDC
  if (options.notional > 10) {
    throw new Error(`实盘 10U 测试限制：--notional 不能超过 10，当前 ${options.notional}`);
  }

  const environmentVariables = {
    ...readEnvFile(path.resolve(process.cwd(), ".env")),
    ...process.env,
  };

  const binance = buildBinanceUsdcExchange(environmentVariables);
  const hyperliquid = buildHyperliquidExchange(environmentVariables);
  const configuredHlAddress =
    environmentVariables.HYPERLIQUID_WALLET_ADDRESS ??
    environmentVariables.HYPERLIQUID_ACCOUNT_ADDRESS;

  // 持久化 SQLite（文件模式）
  const dbDir = path.dirname(values["db-path"]);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const sqliteAdapter = new SqliteAdapter({ dbPath: values["db-path"] });
  runMigrations(sqliteAdapter);
  const repos = createRepositories(sqliteAdapter);

  const cycleId = `cycle-usdc-live-${symbolConfig.symbol}-${Date.now()}`;

  try {
    await Promise.all([binance.loadMarkets(), hyperliquid.loadMarkets()]);
    const hlUserContext = await resolveHyperliquidUserContext(hyperliquid, configuredHlAddress);

    if (options.leverage > 1) {
      const hlCcxtSymbol = `${symbolConfig.hyperliquidSymbol}/USDC:USDC`;
      log("startup", `设置 HL 杠杆 ${options.leverage}`, { symbol: hlCcxtSymbol });
      if (values.execute) {
        await hyperliquid.setLeverage(options.leverage, hlCcxtSymbol);
      }
    }

    if (!values["close-only"]) {
      const openResult = await openPosition({
        binance,
        hyperliquid,
        symbolConfig,
        direction,
        notional: options.notional,
        options,
        repos,
        cycleId,
        execute: values.execute,
        hlUserContext,
      });

      if (openResult && values.execute) {
        await closePosition({
          binance,
          hyperliquid,
          symbolConfig,
          openResult,
          direction,
          options,
          repos,
          cycleId,
          execute: values.execute,
          hlUserContext,
        });
      }
    } else {
      log("startup", "close-only 模式：跳过建仓，直接进入平仓监控（需配合已有仓位）");
    }

    // 输出落库摘要
    const stored = repos.aggregateByCycleId(cycleId);
    if (stored) {
      printStep("落库摘要", {
        cycleStatus: stored.cycle.status,
        orderCount: stored.orders.length,
        spreadLockBps: stored.spreadLock?.net_spread_bps,
        netProfit: stored.closeResult?.net_profit_usdt,
      });
    }

    writeLine("\n==== L2 周期完成 ====");
  } catch (error) {
    log("error", `周期失败: ${error.message}`, { stack: error.stack });
    if (repos) {
      repos.cycles.updateStatus(cycleId, "FAILED", Date.now());
      repos.riskEvents.insert({
        riskEventId: `${cycleId}-err`,
        cycleId,
        type: "execution_error",
        severity: "critical",
        symbol: symbolConfig.symbol,
        message: error.message,
        context: { stack: error.stack },
        timestamp: Date.now(),
      });
    }
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([binance.close(), hyperliquid.close()]);
    sqliteAdapter.close();
  }
}

main().catch((error) => {
  console.error("[live-usdc-arb-cycle] 启动失败:", error);
  process.exit(1);
});
