/**
 * USDC 永续合约价差套利 dry-run 模拟脚本。
 *
 * 专为 Binance USDC-M 合约（maker 0 fee）× Hyperliquid USDC 永续（taker 4.5bps）设计。
 *
 * 与 live-dry-run-executor.js 的核心差异：
 *   1. 使用 createUsdcRealtimeFeeds 订阅 Binance USDC-M stream（如 biousdc@bookTicker）
 *   2. Binance maker 费率覆盖为 0（USDC 合约永久费率结构）
 *   3. 两腿均以 USDC 计价，无需 USDC/USDT 汇率折算
 *
 * 用法：
 *   node scripts/usdc-dry-run-executor.js --symbol BIO                    # 监控 BIOUSDC
 *   node scripts/usdc-dry-run-executor.js --symbol BIO --execute          # 监控并自动触发 dry-run
 *   node scripts/usdc-dry-run-executor.js --symbol BIO --execute --max-cycles 3
 */

import process from "node:process";
import { parseArgs } from "node:util";
import WebSocket from "ws";

import { createUsdcRealtimeFeeds } from "../src/realtime/feeds.js";
import { computeAllSpreadOpportunities } from "../src/core/spread.js";
import { USDC_PERP_SYMBOLS } from "../src/fixtures/mockData.js";

import { ManualClock, createRuntime } from "../src/executor/adapters/runtime.js";
import { loadExecutionConfig } from "../src/executor/core/config.js";
import {
  createMarketSnapshot,
  createOpportunitySignal,
} from "../src/executor/domain/models.js";
import { createMockExchangeAdapter } from "../src/executor/adapters/exchangeAdapter.js";
import { createBinanceUsdcAdapterFromEnv } from "../src/executor/adapters/binanceUsdcAdapter.js";
import { createHyperliquidAdapterFromEnv } from "../src/executor/adapters/hyperliquidAdapter.js";
import { createOrderRouter } from "../src/executor/services/orderRouter.js";
import { createArbitrageCycleOrchestrator } from "../src/executor/orchestrators/arbitrageCycleOrchestrator.js";
import { SqliteAdapter } from "../src/executor/persistence/sqliteAdapter.js";
import { runMigrations } from "../src/executor/persistence/schema.js";
import { createRepositories } from "../src/executor/persistence/repositories.js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const { values } = parseArgs({
  options: {
    execute: { type: "boolean", default: false },
    live: { type: "boolean", default: false },
    symbol: { type: "string", default: "BIO" },
    "max-cycles": { type: "string", default: "1" },
    "scan-interval-ms": { type: "string", default: "5000" },
    "min-spread-bps": { type: "string", default: "5" },
    notional: { type: "string", default: "10" },
    "db-path": { type: "string", default: "./data/usdc-live.db" },
  },
  strict: false,
});

const MAX_CYCLES = Math.max(1, Number.parseInt(values["max-cycles"] ?? "1", 10));
const SCAN_INTERVAL_MS = Math.max(2000, Number.parseInt(values["scan-interval-ms"] ?? "5000", 10));
const MIN_SPREAD_BPS = Number.parseInt(values["min-spread-bps"] ?? "5", 10);
const LIVE_NOTIONAL = Number(values.notional);
const LIVE_MAX_NOTIONAL = 10; // 实盘 10U 测试硬上限

/**
 * USDC 永续合约费率覆盖：
 * - Binance USDC-M maker 0.0000%（永久费率结构，非促销）
 * - Hyperliquid taker 4.5 bps
 */
const USDC_FEE_OVERRIDES = {
  binance: 0,
  hyperliquid: 0.00045,
};

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

/**
 * 查找指定 base symbol 对应的 USDC 交集配置。
 */
function findUsdcSymbolConfig(baseSymbol) {
  return USDC_PERP_SYMBOLS.find(
    (item) => item.symbol === baseSymbol || item.binanceSymbol === baseSymbol,
  );
}

/**
 * 把实盘 Quote 转成执行器侧的 MarketSnapshot。
 * USDC feeds 两腿均以 USDC 计价，fxUsdcUsdtMid 设为 1（同币种）。
 */
function buildMarketSnapshotFromQuotes(symbol, quotes) {
  const now = Date.now();
  const binance = quotes?.binance;
  const hyperliquid = quotes?.hyperliquid;

  if (!binance || !hyperliquid) {
    return null;
  }

  return createMarketSnapshot({
    snapshotId: `snap-usdc-${symbol}-${now}`,
    symbol,
    timestamp: now,
    fxUsdcUsdtMid: 1,
    fundingRateBps: { binance: 0, hyperliquid: 0 },
    marginAvailableUsdt: { binance: 10_000, hyperliquid: 8_000 },
    books: {
      binance: {
        bestBid: { price: binance.bidPrice, quantity: binance.bidQty },
        bestAsk: { price: binance.askPrice, quantity: binance.askQty },
      },
      hyperliquid: {
        bestBid: { price: hyperliquid.bidPrice, quantity: hyperliquid.bidQty },
        bestAsk: { price: hyperliquid.askPrice, quantity: hyperliquid.askQty },
      },
    },
    metadata: { source: "realtime-usdc", quoteCurrency: "USDC" },
  });
}

/**
 * 把 SpreadOpportunity 映射为执行器的 OpportunitySignal。
 */
function buildSignalFromOpportunity(opp) {
  const now = Date.now();
  return createOpportunitySignal({
    signalId: `sig-usdc-${opp.symbol}-${now}`,
    symbol: opp.symbol,
    buyExchange: opp.buyExchange,
    sellExchange: opp.sellExchange,
    observedSpreadBps: Math.round(opp.netSpreadPct * 10_000),
    observedAt: now,
    publishedAt: now,
    strategyVersion: "usdc-dry-run-v1",
    payload: {
      source: "realtime-usdc",
      netSpreadPct: opp.netSpreadPct,
      maxNotionalUsd: opp.maxNotionalUsd,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      quoteCurrency: "USDC",
    },
  });
}

/**
 * 构造 USDC dry-run OrderRouter。
 * Binance maker 0 fee，Hyperliquid taker 4.5bps，按实盘盘口模拟全成交。
 */
function createUsdcDryRunOrderRouter(latestQuotesRef) {
  function quotesFor(symbol) {
    return latestQuotesRef.current?.[symbol];
  }

  const binance = createMockExchangeAdapter({
    name: "binance",
    handlers: {
      async placeOrder(request) {
        const q = quotesFor(request.symbol);
        const price = request.price ?? q?.binance?.askPrice ?? request.price;
        return {
          orderId: `bin-usdc-dry-${Date.now()}`,
          status: "filled",
          price,
          quantity: request.quantity,
          filledQuantity: request.quantity,
        };
      },
    },
  });
  const hyperliquid = createMockExchangeAdapter({
    name: "hyperliquid",
    handlers: {
      async placeOrder(request) {
        const q = quotesFor(request.symbol);
        const price = request.price ?? q?.hyperliquid?.bidPrice ?? request.price;
        return {
          orderId: `hl-usdc-dry-${Date.now()}`,
          status: "filled",
          price,
          quantity: request.quantity,
          filledQuantity: request.quantity,
        };
      },
    },
  });
  return createOrderRouter({ adapters: { binance, hyperliquid } });
}

/**
 * L3-02 读取 .env 文件为环境变量对象。
 */
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

/**
 * L3-02 人工确认口令。
 */
async function requestLiveConfirmation(phrase) {
  const terminal = readline.createInterface({ input, output });
  try {
    const answer = await terminal.question(
      `\n[LIVE] 输入以下确认口令后才会真实下单:\n${phrase}\n> `,
    );
    return answer.trim() === phrase;
  } finally {
    terminal.close();
  }
}

/**
 * L3-02 构造 USDC 实盘 OrderRouter（真实 ccxt adapter）。
 * - 强制 liveTradingEnabled = true
 * - 强制 --notional ≤ 10 限制
 * - 强制人工确认口令
 * - 强制余额预检（两所 USDC ≥ notional * 1.5）
 */
async function createUsdcLiveOrderRouter({ symbolConfig, notional }) {
  if (notional > LIVE_MAX_NOTIONAL) {
    throw new Error(`实盘 10U 测试限制：--notional 不能超过 ${LIVE_MAX_NOTIONAL}，当前 ${notional}`);
  }

  const envPath = path.resolve(process.cwd(), ".env");
  const environmentVariables = {
    ...readEnvFile(envPath),
    ...process.env,
  };

  if (!environmentVariables.BINANCE_API_KEY || !environmentVariables.BINANCE_API_SECRET) {
    throw new Error("缺少 Binance 凭证，请在 .env 中设置 BINANCE_API_KEY 和 BINANCE_API_SECRET");
  }

  const binanceAdapter = createBinanceUsdcAdapterFromEnv(environmentVariables);
  const hyperliquidAdapter = createHyperliquidAdapterFromEnv(environmentVariables);

  await Promise.all([binanceAdapter.loadMarkets(), hyperliquidAdapter.loadMarkets()]);
  await hyperliquidAdapter.resolveAccountAddress();

  // 余额预检
  const [binanceBalance, hlBalance] = await Promise.all([
    binanceAdapter.getBalance(),
    hyperliquidAdapter.getBalance(),
  ]);
  const required = notional * 1.5;
  log("live-precheck", "余额预检", {
    binanceFreeUSDC: binanceBalance.freeUSDC,
    hlFreeUSDC: hlBalance.freeUSDC,
    required,
  });
  if (binanceBalance.freeUSDC < required) {
    throw new Error(`Binance USDC 不足: free=${binanceBalance.freeUSDC}, 需要=${required}`);
  }
  if (hlBalance.freeUSDC < required) {
    throw new Error(`Hyperliquid USDC 不足: free=${hlBalance.freeUSDC}, 需要=${required}`);
  }

  // 人工确认
  const phrase = `CONFIRM LIVE ${symbolConfig.symbol} NOTIONAL ${notional}`;
  const confirmed = await requestLiveConfirmation(phrase);
  if (!confirmed) {
    throw new Error("未输入正确确认口令，已中止实盘模式");
  }

  return {
    router: createOrderRouter({ adapters: { binance: binanceAdapter, hyperliquid: hyperliquidAdapter } }),
    binanceAdapter,
    hyperliquidAdapter,
  };
}

async function main() {
  const symbolConfig = findUsdcSymbolConfig(values.symbol);

  if (!symbolConfig) {
    log("error", `未找到 ${values.symbol} 的 USDC 交集配置`);
    log("error", `可用标的: ${USDC_PERP_SYMBOLS.map((s) => s.symbol).join(", ")}`);
    process.exit(1);
  }

  log("startup", "USDC 永续合约 dry-run 模拟启动", {
    execute: values.execute,
    live: values.live,
    symbol: symbolConfig.symbol,
    binanceSymbol: symbolConfig.binanceSymbol,
    hyperliquidSymbol: symbolConfig.hyperliquidSymbol,
    maxCycles: MAX_CYCLES,
    minSpreadBps: MIN_SPREAD_BPS,
    notional: LIVE_NOTIONAL,
    feeModel: "Binance maker 0 fee / Hyperliquid taker 4.5bps",
  });

  // L3-02: --live 模式下的额外护栏检查
  if (values.live && !values.execute) {
    log("error", "--live 必须配合 --execute 使用（实盘必须显式执行）");
    process.exit(1);
  }

  // 1. 启动 USDC 实时行情（Binance USDC-M + Hyperliquid）
  const latestQuotesRef = { current: {} };

  const feeds = createUsdcRealtimeFeeds({
    symbols: [symbolConfig],
    onQuotes: (quotes) => {
      latestQuotesRef.current = quotes;
    },
    onStatus: (exchange, status, detail) => {
      log("feed", `USDC 行情连接 ${exchange} -> ${status}${detail ? ` (${detail})` : ""}`);
    },
    WebSocketImpl: WebSocket,
  });

  feeds.start();
  log("feed", `已启动 Binance ${symbolConfig.binanceSymbol} + Hyperliquid ${symbolConfig.hyperliquidSymbol} USDC 行情订阅`);

  // 2. 准备 dry-run 执行器（仅在 --execute 时使用）
  let orchestrator = null;
  let adapter = null;
  let repos = null;
  let cyclesTriggered = 0;
  let liveAdapters = null;

  if (values.execute) {
    // L3-02: live 模式强制 liveTradingEnabled，否则 simulation
    const environment = values.live ? "live" : "simulation";
    const config = loadExecutionConfig({
      environment,
      overrides: {
        // live 模式必须显式开启
        liveTradingEnabled: values.live === true,
        // Binance USDC 合约 maker 0 fee
        exchanges: {
          binance: { feeBps: { maker: 0, taker: 4 } },
          hyperliquid: { feeBps: { maker: 1.5, taker: 4.5 } },
        },
      },
    });
    const clock = new ManualClock(Date.now());
    const runtime = createRuntime({ clock });
    // L3-02: live 模式用文件持久化，simulation 用内存
    const dbPath = values.live ? values["db-path"] : ":memory:";
    if (values.live) {
      const dbDir = path.dirname(dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
    }
    adapter = new SqliteAdapter({ dbPath });
    runMigrations(adapter);
    repos = createRepositories(adapter);

    // L3-02: 根据模式选择 OrderRouter
    let orderRouter;
    if (values.live) {
      log("live", `实盘模式启动，notional=${LIVE_NOTIONAL}（上限 ${LIVE_MAX_NOTIONAL}）`);
      const liveResult = await createUsdcLiveOrderRouter({
        symbolConfig,
        notional: LIVE_NOTIONAL,
      });
      orderRouter = liveResult.router;
      liveAdapters = liveResult;
      log("live", "实盘 ccxt adapter 已注入 OrderRouter");
    } else {
      orderRouter = createUsdcDryRunOrderRouter(latestQuotesRef);
    }

    orchestrator = createArbitrageCycleOrchestrator({
      config,
      runtime,
      orderRouter,
      repositories: repos,
      pollIntervalMs: 1000,
      maxHoldingDurationMs: 60_000,
      getMarketSnapshot: ({ cycleId }) => {
        clock.advance(1000);
        const match = String(cycleId ?? "").match(/cycle-usdc-([A-Z0-9]+)-\d+/);
        const symbol = match?.[1];
        const q = symbol ? latestQuotesRef.current?.[symbol] : null;
        if (!q) return null;
        return {
          buyBook: {
            exchange: "binance",
            bestAsk: { price: q.binance?.askPrice },
            quoteCurrency: "USDC",
          },
          sellBook: {
            exchange: "hyperliquid",
            bestBid: { price: q.hyperliquid?.bidPrice },
            quoteCurrency: "USDC",
          },
          fxUsdcUsdtMid: 1,
        };
      },
    });
    log(
      "executor",
      values.live
        ? `USDC 实盘执行器已就绪（live 模式，notional=${LIVE_NOTIONAL}，Binance maker 0 fee）`
        : "USDC dry-run 执行器已就绪（simulation 模式，Binance maker 0 fee）",
    );
  }

  // 3. 监控循环：周期性扫描价差机会
  async function scanOnce() {
    const quotes = latestQuotesRef.current;
    const symbol = symbolConfig.symbol;
    const q = quotes[symbol];

    if (!q?.binance || !q?.hyperliquid) {
      log("scan", `等待 ${symbol} USDC 行情就绪...`);
      return;
    }

    // 使用 USDC 专属费率计算价差
    const opportunities = computeAllSpreadOpportunities(
      { [symbol]: q },
      {
        feeOverrides: USDC_FEE_OVERRIDES,
        sortBy: "netSpreadAbs",
        sortDirection: "desc",
      },
    );

    if (opportunities.length === 0) {
      log("scan", `${symbol} USDC 价差计算无结果（盘口数据异常）`);
      return;
    }

    const opp = opportunities[0];
    const netBps = Math.round(opp.netSpreadPct * 10_000);
    const grossBps = Math.round(opp.grossSpreadPct * 10_000);
    const feeBps = Math.round(opp.feeCostPct * 10_000);

    log("scan", `${symbol} USDC 价差扫描`, {
      binanceBid: q.binance.bidPrice,
      binanceAsk: q.binance.askPrice,
      hlBid: q.hyperliquid.bidPrice,
      hlAsk: q.hyperliquid.askPrice,
      buyExchange: opp.buyExchange,
      sellExchange: opp.sellExchange,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      grossSpreadBps: grossBps,
      feeCostBps: feeBps,
      netSpreadBps: netBps,
      maxNotionalUsd: opp.maxNotionalUsd,
      status: opp.status,
      feeModel: "Binance maker 0 / HL taker 4.5bps",
    });

    // 自动触发 dry-run 执行
    const shouldTrigger =
      values.execute &&
      orchestrator &&
      cyclesTriggered < MAX_CYCLES &&
      netBps >= MIN_SPREAD_BPS;

    if (!shouldTrigger) {
      if (values.execute && netBps < MIN_SPREAD_BPS) {
        log("scan", `${symbol} 净价差 ${netBps}bps < 阈值 ${MIN_SPREAD_BPS}bps，暂不触发`);
      }
      return;
    }

    cyclesTriggered += 1;
    log("execute", `触发 USDC dry-run 套利 #${cyclesTriggered}`, {
      symbol: opp.symbol,
      netBps,
      buy: opp.buyExchange,
      sell: opp.sellExchange,
    });

    try {
      const signal = buildSignalFromOpportunity(opp);
      const snapshot = buildMarketSnapshotFromQuotes(opp.symbol, q);

      const buyBook = snapshot.books[opp.buyExchange];
      const sellBook = snapshot.books[opp.sellExchange];
      const maxQty = Math.min(buyBook.bestAsk.quantity, sellBook.bestBid.quantity);
      const quantity = Math.max(0.001, Number((maxQty * 0.25).toFixed(3)));
      const buyPrice = buyBook.bestAsk.price;
      const sellPrice = sellBook.bestBid.price;

      const plan = {
        planId: `plan-usdc-${opp.symbol}-${Date.now()}`,
        signalId: signal.signalId,
        symbol: opp.symbol,
        mode: "maker_taker",
        targetNotionalUsdt: buyPrice * quantity,
        expectedNetEdgeBps: netBps,
        riskBudget: { maxUnhedgedMs: 2500, maxSlippageBps: 6 },
        legs: [
          {
            exchange: opp.buyExchange,
            side: "buy",
            symbol: opp.symbol,
            quoteCurrency: "USDC",
            orderType: "limit",
            price: buyPrice,
            quantity,
          },
          {
            exchange: opp.sellExchange,
            side: "sell",
            symbol: opp.symbol,
            quoteCurrency: "USDC",
            orderType: "ioc",
            price: sellPrice,
            quantity,
          },
        ],
        parameterSnapshot: { fxUsdcUsdtMid: 1, quoteCurrency: "USDC" },
      };

      const cycleId = `cycle-usdc-${opp.symbol}-${Date.now()}`;
      const result = await orchestrator.runFullCycle({ cycleId, signal, plan });

      log("execute", `USDC 套利周期完成 #${cyclesTriggered}`, {
        success: result.success,
        cycleId,
        stages: result.stages,
      });

      if (repos) {
        const stored = repos.aggregateByCycleId(cycleId);
        if (stored) {
          log("execute", "落库摘要", {
            status: stored.cycle.status,
            orderCount: stored.orders.length,
            lockedNetSpreadBps: stored.spreadLock?.net_spread_bps,
            netProfitUsdt: stored.closeResult?.net_profit_usdt,
          });
        }
      }
    } catch (error) {
      log("execute", "USDC 套利周期失败", { error: error.message });
    }

    if (cyclesTriggered >= MAX_CYCLES && values.execute) {
      log("shutdown", `已达到最大触发次数 ${MAX_CYCLES}，准备退出`);
      cleanup();
    }
  }

  const scanTimer = setInterval(() => {
    scanOnce().catch((error) => log("scan", "扫描异常", { error: error.message }));
  }, SCAN_INTERVAL_MS);

  // 立即跑一次
  setTimeout(() => {
    scanOnce().catch((error) => log("scan", "首次扫描异常", { error: error.message }));
  }, 3000);

  // 4. 优雅退出
  let shuttingDown = false;
  function cleanup() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(scanTimer);
    try {
      feeds.stop();
    } catch {
      /* ignore */
    }
    if (adapter) {
      adapter.close();
    }
    // L3-02: 关闭实盘 ccxt 连接
    if (liveAdapters) {
      Promise.allSettled([
        liveAdapters.binanceAdapter?.close?.(),
        liveAdapters.hyperliquidAdapter?.close?.(),
      ]).catch(() => {});
    }
    log("shutdown", "已正常退出");
    process.exit(0);
  }

  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
}

main().catch((error) => {
  console.error("[usdc-dry-run] 启动失败:", error);
  process.exit(1);
});
