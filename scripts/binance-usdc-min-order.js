/**
 * L1-01 Binance USDC-M 合约最小额下单验证（Node.js）。
 *
 * 目标：在 Node.js 环境用 Binance 真实 API 下 1 笔 BIOUSDC maker 限价单并验证成交，
 *       成交后立即市价平仓。参考 Python 脚本已验证的签名参数和下单参数。
 *
 * 用法：
 *   node scripts/binance-usdc-min-order.js --symbol BIO              # 预演
 *   node scripts/binance-usdc-min-order.js --symbol BIO --execute    # 真实下单
 *   node scripts/binance-usdc-min-order.js --symbol BIO --execute --side sell
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import ccxt from "ccxt";
import { parseArgs } from "node:util";
import { USDC_PERP_SYMBOLS } from "../src/fixtures/mockData.js";

const { values } = parseArgs({
  options: {
    symbol: { type: "string", default: "BIO" },
    side: { type: "string", default: "buy" },
    notional: { type: "string", default: "10" },
    "maker-timeout-ms": { type: "string", default: "60000" },
    "poll-interval-ms": { type: "string", default: "2000" },
    execute: { type: "boolean", default: false },
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

/**
 * 根据名义金额和市场精度计算最小下单量。
 */
function computeAmountForNotional({ notional, bestPrice, amountPrecision, minAmount, minCost }) {
  // 按 best bid/ask 估算需要的数量
  const rawAmount = notional / bestPrice;
  const amountFloor = Number.isFinite(minAmount) ? minAmount : 0;
  const costFloor =
    Number.isFinite(minCost) && Number.isFinite(bestPrice) && bestPrice > 0
      ? minCost / bestPrice
      : 0;
  const targetAmount = Math.max(rawAmount, amountFloor, costFloor);

  if (!Number.isFinite(amountPrecision) || amountPrecision <= 0) {
    return Math.ceil(targetAmount);
  }
  if (amountPrecision < 1) {
    const factor = 1 / amountPrecision;
    return Math.ceil(targetAmount * factor) / factor;
  }
  return Math.ceil(targetAmount);
}

function buildConfirmationPhrase({ side, symbol, price, amount }) {
  return `CONFIRM ${side.toUpperCase()} ${symbol} ${price} ${amount}`;
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

/**
 * 等待 maker 订单成交，超时则撤单。
 */
async function waitForFill({ exchange, symbol, orderId, timeoutMs, pollIntervalMs }) {
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
      fee: order.fees?.[0]?.cost ?? order.fee?.cost,
      feeCurrency: order.fees?.[0]?.currency ?? order.fee?.currency,
    });

    if (order.status === "closed" || (order.filled ?? 0) >= (order.amount ?? 0)) {
      return order;
    }
    if (["canceled", "cancelled", "expired", "rejected"].includes(order.status)) {
      throw new Error(`Binance maker 订单未成交，状态为 ${order.status}`);
    }
    await sleep(pollIntervalMs);
  }
  // 超时撤单
  try {
    await exchange.cancelOrder(orderId, symbol);
  } catch (error) {
    writeLine(`[超时撤单失败] ${error.message}`);
  }
  throw new Error(`Binance maker 订单在 ${timeoutMs}ms 内未成交，已撤单`);
}

async function main() {
  const symbolConfig = findUsdcSymbolConfig(values.symbol);
  if (!symbolConfig) {
    writeLine(`未找到 ${values.symbol} 的 USDC 交集配置`);
    process.exit(1);
  }

  const ccxtSymbol = `${symbolConfig.symbol}/USDC:USDC`;
  const side = values.side;
  const notional = Number(values.notional);
  const makerTimeoutMs = Number(values["maker-timeout-ms"]);
  const pollIntervalMs = Number(values["poll-interval-ms"]);

  if (!["buy", "sell"].includes(side)) {
    throw new Error("--side 只能是 buy 或 sell");
  }
  if (!Number.isFinite(notional) || notional <= 0) {
    throw new Error("--notional 必须是大于 0 的数字");
  }

  writeLine("==== L1-01 Binance USDC-M 最小下单验证 ====");
  printStep("参数", {
    symbol: symbolConfig.symbol,
    ccxtSymbol,
    side,
    notional,
    execute: values.execute,
  });

  const environmentVariables = {
    ...readEnvFile(path.resolve(process.cwd(), ".env")),
    ...process.env,
  };
  const exchange = buildBinanceUsdcExchange(environmentVariables);

  try {
    await exchange.loadMarkets();
    const market = exchange.market(ccxtSymbol);
    printStep("市场信息", {
      symbol: market.symbol,
      active: market.active,
      precision: market.precision,
      limits: market.limits,
    });

    // 拉取订单簿
    const orderBook = await exchange.fetchOrderBook(ccxtSymbol);
    const bestBid = orderBook.bids?.[0]?.[0];
    const bestAsk = orderBook.asks?.[0]?.[0];
    printStep("订单簿", { bestBid, bestAsk });

    // maker 限价：买取 best bid，卖取 best ask
    const makerPrice = Number(
      exchange.priceToPrecision(
        ccxtSymbol,
        side === "buy" ? bestBid : bestAsk,
      ),
    );

    const amountPrecision = market.precision?.amount;
    const amount = computeAmountForNotional({
      notional,
      bestPrice: side === "buy" ? bestBid : bestAsk,
      amountPrecision,
      minAmount: market.limits?.amount?.min,
      minCost: market.limits?.cost?.min,
    });
    const roundedAmount = Number(exchange.amountToPrecision(ccxtSymbol, amount));
    const actualNotional = roundedAmount * makerPrice;

    const confirmationPhrase = buildConfirmationPhrase({
      side,
      symbol: ccxtSymbol,
      price: makerPrice,
      amount: roundedAmount,
    });

    printStep("下单计划", {
      side,
      price: makerPrice,
      amount: roundedAmount,
      actualNotional,
      orderType: "limit (PostOnly/GTC)",
      makerFeeExpected: "0 (USDC-M maker 0.0000%)",
      confirmationPhrase,
    });

    if (!values.execute) {
      writeLine("\n未传入 --execute，本次仅预演，不会真实下单。");
      return;
    }

    // 余额预检
    const balance = await exchange.fetchBalance({ type: "swap" });
    const freeUSDC = balance.free?.USDC ?? 0;
    printStep("余额预检", { freeUSDC });
    if (freeUSDC < actualNotional) {
      throw new Error(`可用 USDC 不足，free=${freeUSDC}，订单名义=${actualNotional}`);
    }

    const confirmed = await requestManualConfirmation(confirmationPhrase);
    if (!confirmed) {
      writeLine("\n未输入正确确认口令，已取消下单。");
      return;
    }

    // 下 PostOnly maker 限价单
    printStep("发送 Binance maker 订单", {
      symbol: ccxtSymbol,
      side,
      amount: roundedAmount,
      price: makerPrice,
    });
    const order = await exchange.createOrder(
      ccxtSymbol,
      "limit",
      side,
      roundedAmount,
      makerPrice,
      { timeInForce: "GTC", postOnly: true },
    );
    printStep("订单回报", order);

    // 等待成交
    const filledOrder = await waitForFill({
      exchange,
      symbol: ccxtSymbol,
      orderId: order.id,
      timeoutMs: makerTimeoutMs,
      pollIntervalMs,
    });

    const filledQty = filledOrder.filled ?? 0;
    const avgPrice = filledOrder.average ?? makerPrice;
    const feeCost = filledOrder.fees?.reduce((sum, f) => sum + (f.cost ?? 0), 0) ??
      filledOrder.fee?.cost ?? 0;

    printStep("建仓成交确认", {
      filledQty,
      avgPrice,
      feeCost,
      makerFeeExpectedZero: feeCost === 0,
      status: filledOrder.status,
    });

    // 立即市价平仓
    const closeSide = side === "buy" ? "sell" : "buy";
    printStep("发送平仓订单", {
      symbol: ccxtSymbol,
      side: closeSide,
      amount: filledQty,
      type: "market",
      reduceOnly: true,
    });
    const closeOrder = await exchange.createOrder(
      ccxtSymbol,
      "market",
      closeSide,
      filledQty,
      undefined,
      { reduceOnly: true },
    );
    printStep("平仓回报", closeOrder);

    // 验证仓位归零
    const positions = await exchange.fetchPositions(ccxtSymbol);
    const position = positions?.[0];
    printStep("仓位确认", {
      contracts: position?.contracts ?? 0,
      side: position?.side,
      entryPrice: position?.entryPrice,
      unrealizedPnl: position?.unrealizedPnl,
    });

    const finalBalance = await exchange.fetchBalance({ type: "swap" });
    printStep("最终余额", {
      freeUSDC: finalBalance.free?.USDC ?? 0,
      totalUSDC: finalBalance.total?.USDC ?? 0,
    });

    writeLine("\n==== L1-01 验证完成 ====");
    writeLine(`建仓 maker fee = ${feeCost} USDC（预期 0，USDC-M maker 0.0000%）`);
    writeLine(`平仓后仓位 contracts = ${position?.contracts ?? 0}（预期 0）`);
  } finally {
    await exchange.close();
  }
}

main().catch((error) => {
  console.error("\n[binance-usdc-min-order] 失败:", error);
  process.exit(1);
});
