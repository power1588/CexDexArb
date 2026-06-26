/**
 * 实盘行情 dry-run 模拟脚本。
 *
 * 串联三件事：
 *   1. 后台启动 Binance + Hyperliquid 实时行情订阅（公开 WS，无需 API Key）
 *   2. 计算跨所价差机会并推送到 Redis（channel: arbitrage:spread:opportunities）
 *   3. 当出现 ready 级别机会时，用实盘盘口驱动 dry-run 执行器跑一次完整套利周期
 *
 * 用法：
 *   npm run executor:live-dry-run                       # 监控 + Redis 推送，不自动触发执行
 *   npm run executor:live-dry-run -- --execute          # 出现 ready 机会时自动跑 dry-run 套利
 *   npm run executor:live-dry-run -- --no-redis         # 不推送 Redis（本机无 Redis 时）
 *   npm run executor:live-dry-run -- --symbol BTC       # 只监控指定标的
 *   npm run executor:live-dry-run -- --max-cycles 3     # 最多触发 N 次 dry-run 后退出
 */

import process from "node:process";
import { parseArgs } from "node:util";
import WebSocket from "ws";
import { createClient } from "redis";

import { createRealtimeFeeds } from "../src/realtime/feeds.js";
import {
  computeAllSpreadOpportunities,
} from "../src/core/spread.js";
import { buildSpreadChannelPayload } from "../src/core/spreadChannel.js";

import { ManualClock, createRuntime } from "../src/executor/adapters/runtime.js";
import { loadExecutionConfig } from "../src/executor/core/config.js";
import {
  createMarketSnapshot,
  createOpportunitySignal,
} from "../src/executor/domain/models.js";
import { createMockExchangeAdapter } from "../src/executor/adapters/exchangeAdapter.js";
import { createOrderRouter } from "../src/executor/services/orderRouter.js";
import { createArbitrageCycleOrchestrator } from "../src/executor/orchestrators/arbitrageCycleOrchestrator.js";
import { SqliteAdapter } from "../src/executor/persistence/sqliteAdapter.js";
import { runMigrations } from "../src/executor/persistence/schema.js";
import { createRepositories } from "../src/executor/persistence/repositories.js";

const { values } = parseArgs({
  options: {
    execute: { type: "boolean", default: false },
    redis: { type: "boolean", default: true },
    symbol: { type: "string" },
    "max-cycles": { type: "string", default: "1" },
    "redis-url": { type: "string", default: "redis://127.0.0.1:6379" },
    "redis-channel": {
      type: "string",
      default: "arbitrage:spread:opportunities",
    },
    "scan-interval-ms": { type: "string", default: "5000" },
    "min-spread-bps": { type: "string", default: "5" },
  },
  strict: false,
});

// 支持 --no-redis 这种否定形式（strict:false 时会作为未知选项保留在 values 中）
if (values["no-redis"] === true || values["no-redis"] === "") {
  values.redis = false;
}

const MAX_CYCLES = Math.max(1, Number.parseInt(values["max-cycles"] ?? "1", 10));
const SCAN_INTERVAL_MS = Math.max(2000, Number.parseInt(values["scan-interval-ms"] ?? "5000", 10));
const MIN_SPREAD_BPS = Number.parseInt(values["min-spread-bps"] ?? "5", 10);

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
 * 把实盘 Quote 转成执行器侧的 MarketSnapshot。
 * feeds.js 已把 Hyperliquid 折算成 USDT 计价，这里直接用。
 */
function buildMarketSnapshotFromQuotes(symbol, quotes, fxUsdcUsdtMid) {
  const now = Date.now();
  const binance = quotes?.binance;
  const hyperliquid = quotes?.hyperliquid;

  if (!binance || !hyperliquid) {
    return null;
  }

  return createMarketSnapshot({
    snapshotId: `snap-${symbol}-${now}`,
    symbol,
    timestamp: now,
    fxUsdcUsdtMid: fxUsdcUsdtMid || 1,
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
    metadata: { source: "realtime" },
  });
}

/**
 * 把 SpreadOpportunity 映射为执行器的 OpportunitySignal。
 * 关键：netSpreadPct(小数) → observedSpreadBps(整数 bps) 需 *10000。
 */
function buildSignalFromOpportunity(opp) {
  const now = Date.now();
  return createOpportunitySignal({
    signalId: `sig-${opp.symbol}-${now}`,
    symbol: opp.symbol,
    buyExchange: opp.buyExchange,
    sellExchange: opp.sellExchange,
    observedSpreadBps: Math.round(opp.netSpreadPct * 10_000),
    observedAt: now,
    publishedAt: now,
    strategyVersion: "live-dry-run-v1",
    payload: {
      source: "realtime",
      netSpreadPct: opp.netSpreadPct,
      maxNotionalUsd: opp.maxNotionalUsd,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
    },
  });
}

/**
 * 构造一个用实盘成交价模拟"立即成交"的 OrderRouter。
 * dry-run 下不真实下单，按盘口 ask/bid 模拟 maker/taker 全成交。
 */
function createLiveDryRunOrderRouter(latestQuotesRef) {
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
          orderId: `bin-dry-${Date.now()}`,
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
          orderId: `hl-dry-${Date.now()}`,
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

async function main() {
  log("startup", "实盘行情 dry-run 模拟启动", {
    execute: values.execute,
    redis: values.redis,
    symbol: values.symbol ?? "ALL",
    maxCycles: MAX_CYCLES,
    minSpreadBps: MIN_SPREAD_BPS,
  });

  // 1. 启动实时行情
  const symbols = values.symbol ? [values.symbol] : undefined;
  const latestQuotesRef = { current: {} };
  let latestFxRate = 1;

  const feeds = createRealtimeFeeds({
    symbols,
    onQuotes: (quotes) => {
      latestQuotesRef.current = quotes;
    },
    onStatus: (exchange, status, detail) => {
      log("feed", `行情连接 ${exchange} -> ${status}${detail ? ` (${detail})` : ""}`);
    },
    WebSocketImpl: WebSocket,
  });

  feeds.start();
  log("feed", "已启动 Binance + Hyperliquid 实时行情订阅");

  // 2. 连接 Redis（可选）
  let redis = null;
  if (values.redis) {
    try {
      redis = createClient({ url: values["redis-url"] });
      redis.on("error", (error) => log("redis", "连接异常", { error: error.message }));
      await redis.connect();
      log("redis", `已连接，推送 channel=${values["redis-channel"]}`);
    } catch (error) {
      log("redis", "连接失败，将跳过 Redis 推送", { error: error.message });
      redis = null;
    }
  }

  // 3. 准备 dry-run 执行器（仅在 --execute 时使用）
  let orchestrator = null;
  let adapter = null;
  let repos = null;
  let cyclesTriggered = 0;

  if (values.execute) {
    const config = loadExecutionConfig({ environment: "simulation" });
    const clock = new ManualClock(Date.now());
    const runtime = createRuntime({ clock });
    adapter = new SqliteAdapter({ dbPath: ":memory:" });
    runMigrations(adapter);
    repos = createRepositories(adapter);
    const orderRouter = createLiveDryRunOrderRouter(latestQuotesRef);

    orchestrator = createArbitrageCycleOrchestrator({
      config,
      runtime,
      orderRouter,
      repositories: repos,
      pollIntervalMs: 1000,
      maxHoldingDurationMs: 60_000,
      getMarketSnapshot: ({ cycleId }) => {
        clock.advance(1000);
        // cycleId 格式: cycle-live-{SYMBOL}-{ts}，从中解析 symbol
        const match = String(cycleId ?? "").match(/cycle-live-([A-Z0-9]+)-\d+/);
        const symbol = match?.[1];
        const q = symbol ? latestQuotesRef.current?.[symbol] : null;
        if (!q) return null;
        return {
          buyBook: {
            exchange: "binance",
            bestAsk: { price: q.binance?.askPrice },
            quoteCurrency: "USDT",
          },
          sellBook: {
            exchange: "hyperliquid",
            bestBid: { price: q.hyperliquid?.bidPrice },
            quoteCurrency: "USDC",
          },
          fxUsdcUsdtMid: latestFxRate,
        };
      },
    });
    log("executor", "dry-run 执行器已就绪（simulation 模式，不会真实下单）");
  }

  // 4. 监控循环：周期性扫描价差机会
  let lastPublishedKey = "";

  async function scanOnce() {
    const quotes = latestQuotesRef.current;
    const symbolCount = Object.keys(quotes).filter(
      (s) => quotes[s]?.binance && quotes[s]?.hyperliquid,
    ).length;

    if (symbolCount === 0) {
      log("scan", "等待行情就绪...");
      return;
    }

    const opportunities = computeAllSpreadOpportunities(quotes, {
      sortBy: "netSpreadAbs",
      sortDirection: "desc",
    });

    const ready = opportunities.filter((o) => o.status === "ready");
    // 演示用：若实盘无 ready 机会，放宽到 min-spread-bps 阈值的正价差机会
    const positiveOpps = opportunities.filter(
      (o) => Math.round(o.netSpreadPct * 10_000) >= MIN_SPREAD_BPS,
    );
    const top = opportunities.slice(0, 5);

    log(
      "scan",
      `价差扫描: ${opportunities.length} 个标的, ${ready.length} 个 ready 机会`,
      {
        top: top.map((o) => ({
          symbol: o.symbol,
          netBps: Math.round(o.netSpreadPct * 10_000),
          status: o.status,
          buy: o.buyExchange,
          sell: o.sellExchange,
        })),
      },
    );

    // 推送 Redis（去重：仅在机会集合变化时推送）
    if (redis) {
      const key = top
        .map((o) => `${o.symbol}:${o.status}:${Math.round(o.netSpreadPct * 10_000)}`)
        .join("|");
      if (key !== lastPublishedKey) {
        lastPublishedKey = key;
        const payload = buildSpreadChannelPayload(top, {
          channel: values["redis-channel"],
        });
        try {
          await redis.publish(values["redis-channel"], JSON.stringify(payload));
          log("redis", `推送 ${top.length} 条机会到 ${values["redis-channel"]}`);
        } catch (error) {
          log("redis", "推送失败", { error: error.message });
        }
      }
    }

    // 自动触发 dry-run 执行（优先 ready，其次取 min-spread-bps 阈值内的正价差机会）
    const triggerPool = ready.length > 0 ? ready : positiveOpps;
    if (values.execute && orchestrator && triggerPool.length > 0 && cyclesTriggered < MAX_CYCLES) {
      const best = triggerPool[0];
      cyclesTriggered += 1;
      log("execute", `触发 dry-run 套利 #${cyclesTriggered}`, {
        symbol: best.symbol,
        netBps: Math.round(best.netSpreadPct * 10_000),
        buy: best.buyExchange,
        sell: best.sellExchange,
      });

      try {
        const signal = buildSignalFromOpportunity(best);
        const snapshot = buildMarketSnapshotFromQuotes(
          best.symbol,
          quotes[best.symbol],
          latestFxRate,
        );

        // 基于实盘盘口构造 plan（简化版：maker_taker，名义金额取盘口可成交量的 1/4）
        const buyBook = snapshot.books[best.buyExchange];
        const sellBook = snapshot.books[best.sellExchange];
        const maxQty = Math.min(buyBook.bestAsk.quantity, sellBook.bestBid.quantity);
        const quantity = Math.max(0.001, Number((maxQty * 0.25).toFixed(3)));
        const buyPrice = buyBook.bestAsk.price;
        const sellPrice = sellBook.bestBid.price;

        const plan = {
          planId: `plan-live-${best.symbol}-${Date.now()}`,
          signalId: signal.signalId,
          symbol: best.symbol,
          mode: "maker_taker",
          targetNotionalUsdt: buyPrice * quantity,
          expectedNetEdgeBps: Math.round(best.netSpreadPct * 10_000),
          riskBudget: { maxUnhedgedMs: 2500, maxSlippageBps: 6 },
          legs: [
            {
              exchange: best.buyExchange,
              side: "buy",
              symbol: best.symbol,
              quoteCurrency: best.buyExchange === "hyperliquid" ? "USDC" : "USDT",
              orderType: "limit",
              price: buyPrice,
              quantity,
            },
            {
              exchange: best.sellExchange,
              side: "sell",
              symbol: best.symbol,
              quoteCurrency: best.sellExchange === "hyperliquid" ? "USDC" : "USDT",
              orderType: "ioc",
              price: sellPrice,
              quantity,
            },
          ],
          parameterSnapshot: { fxUsdcUsdtMid: latestFxRate },
        };

        const cycleId = `cycle-live-${best.symbol}-${Date.now()}`;
        const result = await orchestrator.runFullCycle({ cycleId, signal, plan });

        log("execute", `套利周期完成 #${cyclesTriggered}`, {
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
        log("execute", "套利周期失败", { error: error.message });
      }
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

  // 5. 优雅退出
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
    if (redis?.isOpen) {
      redis.quit().catch(() => {});
    }
    if (adapter) {
      adapter.close();
    }
    log("shutdown", "已正常退出");
    process.exit(0);
  }

  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
}

main().catch((error) => {
  console.error("[live-dry-run] 启动失败:", error);
  process.exit(1);
});
