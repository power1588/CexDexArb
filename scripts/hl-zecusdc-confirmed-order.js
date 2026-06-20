import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import ccxt from "ccxt";
import {
  resolveHyperliquidAccountAddress,
  resolveHyperliquidCredentials,
} from "../src/executor/live/zecMakerHedge.js";
import {
  buildConfirmationPhrase,
  computeMinimumExecutableAmount,
  parseHyperliquidLiveOrderArgs,
} from "../src/executor/live/hyperliquidLiveOrder.js";

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

function writeLine(message) {
  process.stdout.write(`${message}\n`);
}

function printStep(title, payload) {
  writeLine(`\n[${title}]`);
  writeLine(JSON.stringify(payload, null, 2));
}

function ensureHyperliquidCredentials(environmentVariables) {
  const { privateKey, walletAddress } = resolveHyperliquidCredentials(environmentVariables);

  if (!privateKey || !walletAddress) {
    throw new Error(
      "缺少 Hyperliquid 凭证，请在 .env 中设置 HYPERLIQUID_PRIVATE_KEY/HYPERLIQUID_API_SECRET 与 HYPERLIQUID_WALLET_ADDRESS/HYPERLIQUID_ACCOUNT_ADDRESS",
    );
  }

  return {
    privateKey,
    walletAddress,
  };
}

function buildHyperliquidExchange(environmentVariables) {
  const credentials = ensureHyperliquidCredentials(environmentVariables);

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

  return {
    configuredAddress,
    accountAddress,
    role: role?.role ?? "unknown",
  };
}

async function requestManualConfirmation(phrase) {
  const terminal = readline.createInterface({
    input,
    output,
  });

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
  const options = parseHyperliquidLiveOrderArgs(process.argv.slice(2));
  const envPath = path.resolve(process.cwd(), ".env");
  const environmentVariables = {
    ...readEnvFile(envPath),
    ...process.env,
  };

  const hyperliquid = buildHyperliquidExchange(environmentVariables);

  try {
    await hyperliquid.loadMarkets();

    const configuredAddress =
      environmentVariables.HYPERLIQUID_WALLET_ADDRESS ??
      environmentVariables.HYPERLIQUID_ACCOUNT_ADDRESS;
    const userContext = await resolveHyperliquidUserContext(hyperliquid, configuredAddress);
    const market = hyperliquid.market(options.symbol);
    const balance = await hyperliquid.fetchBalance({
      type: "swap",
      user: userContext.accountAddress,
    });

    const requestedAmount =
      options.amount ??
      computeMinimumExecutableAmount({
        price: options.price,
        minAmount: market.limits?.amount?.min,
        minCost: market.limits?.cost?.min,
        amountPrecision: market.precision?.amount,
      });
    const amount = Number(hyperliquid.amountToPrecision(options.symbol, requestedAmount));
    const price = Number(hyperliquid.priceToPrecision(options.symbol, options.price));
    const notional = Number((amount * price).toFixed(8));
    const confirmationPhrase = buildConfirmationPhrase({
      side: options.side,
      symbol: options.symbol,
      price,
      amount,
    });

    printStep("Hyperliquid 下单预检", {
      market: {
        symbol: market.symbol,
        amountPrecision: market.precision?.amount ?? null,
        pricePrecision: market.precision?.price ?? null,
        minAmount: market.limits?.amount?.min ?? null,
        minCost: market.limits?.cost?.min ?? null,
      },
      account: {
        role: userContext.role,
        signerAddress: `${userContext.configuredAddress.slice(0, 10)}...`,
        accountAddress: `${userContext.accountAddress.slice(0, 10)}...`,
        freeUSDC: balance.free?.USDC ?? null,
        usedUSDC: balance.used?.USDC ?? null,
        totalUSDC: balance.total?.USDC ?? null,
      },
      order: {
        side: options.side,
        price,
        amount,
        notional,
        leverage: options.leverage,
        timeInForce: "GTC",
      },
      confirmationPhrase,
    });

    if (!options.execute) {
      writeLine("\n未传入 --execute，本次仅预演，不会真实向 Hyperliquid 发送订单。");
      return;
    }

    if (Number(balance.free?.USDC ?? 0) < notional) {
      throw new Error(`可用 USDC 不足，当前 free=${balance.free?.USDC ?? 0}，订单名义=${notional}`);
    }

    const confirmed = await requestManualConfirmation(confirmationPhrase);
    if (!confirmed) {
      writeLine("\n未输入正确确认口令，已取消真实下单。");
      return;
    }

    if (options.leverage > 1) {
      printStep("设置杠杆", {
        symbol: options.symbol,
        leverage: options.leverage,
        accountAddress: `${userContext.accountAddress.slice(0, 10)}...`,
      });
      await hyperliquid.setLeverage(options.leverage, options.symbol);
    }

    printStep("发送 Hyperliquid 真实订单", {
      symbol: options.symbol,
      side: options.side,
      amount,
      price,
      params: {
        timeInForce: "GTC",
      },
    });

    const order = await hyperliquid.createOrder(
      options.symbol,
      "limit",
      options.side,
      amount,
      price,
      {
        timeInForce: "GTC",
      },
    );
    printStep("订单提交回报", order);
  } finally {
    await hyperliquid.close();
  }
}

main().catch((error) => {
  process.stderr.write("\n[hl-zecusdc-confirmed-order failed]\n");
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
