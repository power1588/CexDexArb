/**
 * L1-02 Hyperliquid USDC 永续合约最小下单验证（Node.js）。
 *
 * 复用 hl-zecusdc-confirmed-order.js 逻辑（已有 Node.js ccxt 签名实现），
 * 泛化为支持任意 USDC 交集标的。参数化 --symbol BIO，自动解析 HL 合约名 BIO/USDC:USDC。
 *
 * 用法：
 *   node scripts/hl-usdc-confirmed-order.js --symbol BIO              # 预演
 *   node scripts/hl-usdc-confirmed-order.js --symbol BIO --execute    # 真实下单
 *   node scripts/hl-usdc-confirmed-order.js --symbol BIO --execute --side sell --price 0.03
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
} from "../src/executor/live/zecMakerHedge.js";
import {
  buildConfirmationPhrase,
  computeMinimumExecutableAmount,
} from "../src/executor/live/hyperliquidLiveOrder.js";

const { values } = parseArgs({
  options: {
    symbol: { type: "string", default: "BIO" },
    side: { type: "string", default: "buy" },
    price: { type: "string" }, // 可选，缺省取盘口
    amount: { type: "string" },
    notional: { type: "string", default: "10" },
    leverage: { type: "string", default: "1" },
    "slippage-bps": { type: "string", default: "45" }, // HL taker 4.5bps
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

function findUsdcSymbolConfig(baseSymbol) {
  return USDC_PERP_SYMBOLS.find(
    (item) => item.symbol === baseSymbol || item.binanceSymbol === baseSymbol,
  );
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

async function main() {
  const symbolConfig = findUsdcSymbolConfig(values.symbol);
  if (!symbolConfig) {
    writeLine(`未找到 ${values.symbol} 的 USDC 交集配置`);
    process.exit(1);
  }

  // HL 统一符号：{HLSYMBOL}/USDC:USDC
  const ccxtSymbol = `${symbolConfig.hyperliquidSymbol}/USDC:USDC`;
  const side = values.side;
  const leverage = Number(values.leverage);
  const slippageBps = Number(values["slippage-bps"]);
  const notional = Number(values.notional);

  if (!["buy", "sell"].includes(side)) {
    throw new Error("--side 只能是 buy 或 sell");
  }

  writeLine("==== L1-02 Hyperliquid USDC 最小下单验证 ====");
  printStep("参数", {
    baseSymbol: symbolConfig.symbol,
    hlSymbol: symbolConfig.hyperliquidSymbol,
    ccxtSymbol,
    side,
    notional,
    leverage,
    execute: values.execute,
  });

  const environmentVariables = {
    ...readEnvFile(path.resolve(process.cwd(), ".env")),
    ...process.env,
  };
  const exchange = buildHyperliquidExchange(environmentVariables);
  const configuredAddress =
    environmentVariables.HYPERLIQUID_WALLET_ADDRESS ??
    environmentVariables.HYPERLIQUID_ACCOUNT_ADDRESS;

  try {
    await exchange.loadMarkets();
    const market = exchange.market(ccxtSymbol);

    // 解析真实账户地址
    const role = await exchange.publicPostInfo({
      type: "userRole",
      user: configuredAddress,
    });
    const accountAddress = resolveHyperliquidAccountAddress({
      configuredAddress,
      userRoleResponse: role,
    });

    printStep("市场信息", {
      symbol: market.symbol,
      active: market.active,
      precision: market.precision,
      limits: market.limits,
      account: {
        role: role?.role ?? "unknown",
        signerAddress: configuredAddress?.slice(0, 10) + "...",
        accountAddress: accountAddress?.slice(0, 10) + "...",
      },
    });

    // 拉取订单簿自动定价（若未显式传 price）
    const orderBook = await exchange.fetchOrderBook(ccxtSymbol);
    const bestBid = orderBook.bids?.[0]?.[0];
    const bestAsk = orderBook.asks?.[0]?.[0];
    printStep("订单簿", { bestBid, bestAsk });

    // taker 价格：买入取 ask*(1+slippage)，卖出取 bid*(1-slippage)
    let rawPrice;
    if (values.price) {
      rawPrice = Number(values.price);
    } else if (side === "buy") {
      rawPrice = bestAsk * (1 + slippageBps / 10_000);
    } else {
      rawPrice = bestBid * (1 - slippageBps / 10_000);
    }
    const price = Number(exchange.priceToPrecision(ccxtSymbol, rawPrice));

    // 计算下单数量
    const requestedAmount =
      values.amount != null
        ? Number(values.amount)
        : computeMinimumExecutableAmount({
            price,
            minAmount: market.limits?.amount?.min,
            minCost: market.limits?.cost?.min,
            amountPrecision: market.precision?.amount,
          });
    // 若计算出的名义 < notional，按 notional 反推
    let amount = Number(exchange.amountToPrecision(ccxtSymbol, requestedAmount));
    if (amount * price < notional) {
      amount = Number(exchange.amountToPrecision(ccxtSymbol, Math.ceil(notional / price)));
    }
    const actualNotional = Number((amount * price).toFixed(8));

    const confirmationPhrase = buildConfirmationPhrase({
      side,
      symbol: symbolConfig.hyperliquidSymbol,
      price,
      amount,
    });

    printStep("下单计划", {
      side,
      price,
      amount,
      actualNotional,
      orderType: "limit (GTC)",
      takerFeeExpectedBps: 4.5,
      confirmationPhrase,
    });

    if (!values.execute) {
      writeLine("\n未传入 --execute，本次仅预演，不会真实下单。");
      return;
    }

    // 余额预检
    const balance = await exchange.fetchBalance({
      type: "swap",
      user: accountAddress,
    });
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

    if (leverage > 1) {
      printStep("设置杠杆", { symbol: ccxtSymbol, leverage });
      await exchange.setLeverage(leverage, ccxtSymbol);
    }

    // 下限价单（IOC，模拟 taker 吃单）
    printStep("发送 Hyperliquid 订单", {
      symbol: ccxtSymbol,
      side,
      amount,
      price,
      params: { timeInForce: "IOC" },
    });
    const order = await exchange.createOrder(ccxtSymbol, "limit", side, amount, price, {
      timeInForce: "IOC",
    });
    printStep("订单回报", order);

    const filledQty = order.filled ?? 0;
    const avgPrice = order.average ?? price;
    const feeCost = order.fees?.reduce((sum, f) => sum + (f.cost ?? 0), 0) ?? order.fee?.cost ?? 0;

    printStep("成交确认", {
      filledQty,
      avgPrice,
      feeCost,
      feeBps: avgPrice > 0 ? (feeCost / (filledQty * avgPrice)) * 10_000 : null,
      status: order.status,
    });

    // 立即反向平仓
    if (filledQty > 0) {
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

      const positions = await exchange.fetchPositions(ccxtSymbol);
      printStep("仓位确认", {
        contracts: positions?.[0]?.contracts ?? 0,
        side: positions?.[0]?.side,
        entryPrice: positions?.[0]?.entryPrice,
      });
    }

    writeLine("\n==== L1-02 验证完成 ====");
  } finally {
    await exchange.close();
  }
}

main().catch((error) => {
  console.error("\n[hl-usdc-confirmed-order] 失败:", error);
  process.exit(1);
});
