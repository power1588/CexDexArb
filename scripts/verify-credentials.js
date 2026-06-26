/**
 * L0-01 连通性验证脚本（Node.js）。
 *
 * 参考 Python ccxt 已验证的签名/下单参数，确认 Node.js 环境下两所 API 可连通。
 *
 * 验证内容：
 *   - Binance USDC-M 合约：fetchBalance() / fetchMarket(BIOUSDC)
 *   - Hyperliquid：fetchBalance() / fetchMarket(BIO/USDC:USDC)
 *
 * 用法：
 *   node scripts/verify-credentials.js
 *   node scripts/verify-credentials.js --symbol BIO
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ccxt from "ccxt";
import { parseArgs } from "node:util";
import { USDC_PERP_SYMBOLS } from "../src/fixtures/mockData.js";
import {
  resolveHyperliquidAccountAddress,
  resolveHyperliquidCredentials,
} from "../src/executor/live/zecMakerHedge.js";

const { values } = parseArgs({
  options: {
    symbol: { type: "string", default: "BIO" },
  },
  strict: false,
});

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
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

function buildBinanceUsdcExchange(environmentVariables) {
  return new ccxt.binance({
    apiKey: environmentVariables.BINANCE_API_KEY,
    secret: environmentVariables.BINANCE_API_SECRET,
    enableRateLimit: true,
    options: {
      // USDC-M 永续合约
      defaultType: "swap",
      fetchMarkets: ["linear"],
      // 关闭 fetchCurrencies 以避免无凭证时 loadMarkets 直接抛错
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
    options: {
      defaultType: "swap",
    },
  });
}

async function verifyBinance(symbolConfig) {
  const binanceSymbol = `${symbolConfig.binanceSymbol}`;
  // ccxt 统一符号格式：BIOUSDC -> BIO/USDC
  const ccxtSymbol = `${symbolConfig.symbol}/USDC`;

  printStep("Binance 验证开始", {
    rawSymbol: binanceSymbol,
    ccxtSymbol,
    marketType: "swap (USDC-M)",
  });

  const exchange = buildBinanceUsdcExchange({
    ...readEnvFile(path.resolve(process.cwd(), ".env")),
    ...process.env,
  });

  const results = { exchange: "binance", checks: {} };
  try {
    await exchange.loadMarkets();

    // 1. 验证合约交易对可访问
    try {
      const market = exchange.market(ccxtSymbol);
      printStep("Binance market 可访问", {
        symbol: market.symbol,
        type: market.type,
        linear: market.linear,
        active: market.active,
        precision: market.precision,
        limits: market.limits,
      });
      results.checks.fetchMarket = { ok: true, symbol: market.symbol, active: market.active };
    } catch (error) {
      results.checks.fetchMarket = { ok: false, error: error.message };
      writeLine(`[Binance fetchMarket 失败] ${error.message}`);
    }

    // 2. 验证 USDC 余额可读
    try {
      const balance = await exchange.fetchBalance({ type: "swap" });
      const usdcFree = balance.free?.USDC ?? balance.USDC?.free ?? 0;
      const usdcTotal = balance.total?.USDC ?? balance.USDC?.total ?? 0;
      printStep("Binance USDC 余额", {
        free: usdcFree,
        used: balance.used?.USDC ?? 0,
        total: usdcTotal,
      });
      results.checks.fetchBalance = { ok: true, freeUSDC: usdcFree, totalUSDC: usdcTotal };
    } catch (error) {
      results.checks.fetchBalance = { ok: false, error: error.message };
      writeLine(`[Binance fetchBalance 失败] ${error.message}`);
    }
  } finally {
    await exchange.close();
  }

  return results;
}

async function verifyHyperliquid(symbolConfig) {
  const ccxtSymbol = `${symbolConfig.hyperliquidSymbol}/USDC:USDC`;
  const environmentVariables = {
    ...readEnvFile(path.resolve(process.cwd(), ".env")),
    ...process.env,
  };

  printStep("Hyperliquid 验证开始", {
    ccxtSymbol,
    marketType: "swap",
  });

  const exchange = buildHyperliquidExchange(environmentVariables);
  const configuredAddress =
    environmentVariables.HYPERLIQUID_WALLET_ADDRESS ??
    environmentVariables.HYPERLIQUID_ACCOUNT_ADDRESS;

  const results = { exchange: "hyperliquid", checks: {} };
  try {
    await exchange.loadMarkets();

    // 1. 验证合约可访问
    try {
      const market = exchange.market(ccxtSymbol);
      printStep("Hyperliquid market 可访问", {
        symbol: market.symbol,
        type: market.type,
        active: market.active,
        precision: market.precision,
        limits: market.limits,
      });
      results.checks.fetchMarket = { ok: true, symbol: market.symbol, active: market.active };
    } catch (error) {
      results.checks.fetchMarket = { ok: false, error: error.message };
      writeLine(`[Hyperliquid fetchMarket 失败] ${error.message}`);
    }

    // 2. 解析真实账户地址
    let accountAddress = configuredAddress;
    try {
      const role = await exchange.publicPostInfo({
        type: "userRole",
        user: configuredAddress,
      });
      accountAddress = resolveHyperliquidAccountAddress({
        configuredAddress,
        userRoleResponse: role,
      });
      printStep("Hyperliquid 账户上下文", {
        role: role?.role ?? "unknown",
        signerAddress: configuredAddress?.slice(0, 10) + "...",
        accountAddress: accountAddress?.slice(0, 10) + "...",
      });
      results.checks.userRole = { ok: true, role: role?.role, accountAddress };
    } catch (error) {
      results.checks.userRole = { ok: false, error: error.message };
      writeLine(`[Hyperliquid userRole 失败] ${error.message}`);
    }

    // 3. 验证 USDC 余额可读
    try {
      const balance = await exchange.fetchBalance({
        type: "swap",
        user: accountAddress,
      });
      const usdcFree = balance.free?.USDC ?? 0;
      const usdcTotal = balance.total?.USDC ?? 0;
      printStep("Hyperliquid USDC 余额", {
        free: usdcFree,
        used: balance.used?.USDC ?? 0,
        total: usdcTotal,
      });
      results.checks.fetchBalance = { ok: true, freeUSDC: usdcFree, totalUSDC: usdcTotal };
    } catch (error) {
      results.checks.fetchBalance = { ok: false, error: error.message };
      writeLine(`[Hyperliquid fetchBalance 失败] ${error.message}`);
    }
  } finally {
    await exchange.close();
  }

  return results;
}

async function main() {
  const symbolConfig = findUsdcSymbolConfig(values.symbol);
  if (!symbolConfig) {
    writeLine(`未找到 ${values.symbol} 的 USDC 交集配置`);
    writeLine(`可用标的: ${USDC_PERP_SYMBOLS.map((s) => s.symbol).join(", ")}`);
    process.exit(1);
  }

  writeLine("==== L0-01 Node.js 凭证连通性验证 ====");
  printStep("验证配置", {
    symbol: symbolConfig.symbol,
    binanceSymbol: symbolConfig.binanceSymbol,
    hyperliquidSymbol: symbolConfig.hyperliquidSymbol,
  });

  const binanceResults = await verifyBinance(symbolConfig);
  const hyperliquidResults = await verifyHyperliquid(symbolConfig);

  const summary = {
    symbol: symbolConfig.symbol,
    binance: {
      fetchMarket: binanceResults.checks.fetchMarket?.ok ?? false,
      fetchBalance: binanceResults.checks.fetchBalance?.ok ?? false,
      freeUSDC: binanceResults.checks.fetchBalance?.freeUSDC ?? 0,
    },
    hyperliquid: {
      fetchMarket: hyperliquidResults.checks.fetchMarket?.ok ?? false,
      fetchBalance: hyperliquidResults.checks.fetchBalance?.ok ?? false,
      freeUSDC: hyperliquidResults.checks.fetchBalance?.freeUSDC ?? 0,
    },
  };

  const allOk =
    summary.binance.fetchMarket &&
    summary.binance.fetchBalance &&
    summary.hyperliquid.fetchMarket &&
    summary.hyperliquid.fetchBalance;

  printStep("验证汇总", { ...summary, allOk });

  if (!allOk) {
    writeLine("\n[警告] 部分检查未通过，请根据上方日志排查（凭证/权限/网络）");
    process.exitCode = 2;
  } else {
    writeLine("\n[完成] 全部连通性检查通过");
  }
}

main().catch((error) => {
  console.error("[verify-credentials] 失败:", error);
  process.exit(1);
});
