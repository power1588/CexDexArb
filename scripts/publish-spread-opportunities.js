import process from "node:process";
import { createClient } from "redis";
import WebSocket from "ws";
import { buildSpreadChannelPayload } from "../src/core/spreadChannel.js";
import { createInitialData } from "../src/fixtures/mockData.js";
import { createRealtimeFeeds } from "../src/realtime/feeds.js";
import { loadFundingMonitorSnapshot } from "../src/services/funding.js";
import { createMarketUniverseService } from "../src/services/markets.js";
import { createAppStore } from "../src/state/store.js";

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseSpreadStatusFilter(value, fallback = "ready") {
  return ["all", "ready", "watch", "blocked"].includes(value) ? value : fallback;
}

function buildPublisherConfig() {
  return {
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    redisChannel:
      process.env.REDIS_SPREAD_CHANNEL ?? "arbitrage:spread:opportunities",
    spreadStatusFilter: parseSpreadStatusFilter(
      process.env.SPREAD_STATUS_FILTER,
      "ready",
    ),
    spreadMin24hVolumeUsd: parseNonNegativeInteger(
      process.env.SPREAD_MIN_24H_VOLUME_USD,
      1_000_000,
    ),
    fundingRefreshIntervalMs: parseNonNegativeInteger(
      process.env.FUNDING_REFRESH_INTERVAL_MS,
      60_000,
    ),
    marketRefreshIntervalMs: parseNonNegativeInteger(
      process.env.MARKET_REFRESH_INTERVAL_MS,
      300_000,
    ),
  };
}

async function main() {
  const config = buildPublisherConfig();
  const redis = createClient({ url: config.redisUrl });
  const store = createAppStore(createInitialData());
  const marketUniverseService = createMarketUniverseService({
    initialSnapshot: {
      commonPerpSymbols: store.getState().commonPerpSymbols,
      symbolUniverseStatus: store.getState().symbolUniverseStatus,
      marketDiscovery: store.getState().marketDiscovery,
    },
  });

  let publishQueue = Promise.resolve();
  let lastPublishedPayload = "";
  let fundingTimer = null;
  let marketTimer = null;
  let isShuttingDown = false;

  store.setSpreadStatusFilter(config.spreadStatusFilter);
  store.setSpreadMin24hVolumeUsd(config.spreadMin24hVolumeUsd);

  redis.on("error", (error) => {
    console.error("[redis] 连接异常:", error);
  });
  await redis.connect();
  console.warn(
    `[redis] 已连接 ${config.redisUrl}，推送 channel=${config.redisChannel}，按 Ctrl+C 可正常退出`,
  );

  function publishSpreadSnapshot() {
    const state = store.getState();
    const payloadOptions = {
      channel: config.redisChannel,
      filters: {
        status: state.activeSpreadStatusFilter,
        min24hVolumeUsd: state.activeSpreadMin24hVolumeUsd,
      },
      feedStatus: state.feedStatus,
      commonPerpCount: state.commonPerpCount,
      spreadOpportunityCount: state.spreadOpportunityCount,
    };
    const comparisonPayload = JSON.stringify({
      ...payloadOptions,
      opportunities: state.spreadOpportunities,
    });

    if (comparisonPayload === lastPublishedPayload) {
      return;
    }

    lastPublishedPayload = comparisonPayload;
    const payload = buildSpreadChannelPayload(
      state.spreadOpportunities,
      payloadOptions,
    );
    const serializedPayload = JSON.stringify(payload);
    publishQueue = publishQueue
      .then(async () => {
        await redis.publish(config.redisChannel, serializedPayload);
        console.warn(
          `[redis] 已推送 ${payload.opportunities.length} 条价差信息到 ${config.redisChannel}`,
        );
      })
      .catch((error) => {
        console.error("[redis] 推送失败:", error);
      });
  }

  async function refreshFunding() {
    const snapshot = await loadFundingMonitorSnapshot({
      commonPerpSymbols: store.getState().commonPerpSymbols,
      previousSymbols: store.getState().monitorSnapshot.symbols,
    });
    store.updateFundingSnapshots(snapshot);
  }

  async function refreshUniverse() {
    const snapshot = await marketUniverseService.refresh();
    store.updateSymbolUniverse(snapshot);
    feeds.updateSymbols(snapshot.commonPerpSymbols);
    await refreshFunding();
  }

  const feeds = createRealtimeFeeds({
    symbols: store.getState().commonPerpSymbols,
    onQuotes: (quotes) => store.updateRealtimeQuotes(quotes),
    onStatus: (exchange, status, detail) =>
      store.updateFeedStatus(exchange, status, detail),
    WebSocketImpl: WebSocket,
  });

  const unsubscribe = store.subscribe(publishSpreadSnapshot);
  publishSpreadSnapshot();
  feeds.start();

  await refreshUniverse();

  fundingTimer = setInterval(() => {
    refreshFunding().catch((error) => {
      console.error("[funding] 刷新失败:", error);
    });
  }, config.fundingRefreshIntervalMs);

  marketTimer = setInterval(() => {
    refreshUniverse().catch((error) => {
      console.error("[market] 刷新失败:", error);
    });
  }, config.marketRefreshIntervalMs);

  async function shutdown(signal) {
    if (isShuttingDown) {
      console.warn(`[shutdown] 已收到 ${signal}，正在退出中...`);
      return;
    }

    isShuttingDown = true;

    if (fundingTimer) {
      clearInterval(fundingTimer);
      fundingTimer = null;
    }
    if (marketTimer) {
      clearInterval(marketTimer);
      marketTimer = null;
    }

    console.warn(`[shutdown] 收到 ${signal}，准备退出...`);
    unsubscribe();

    try {
      feeds.stop();
    } catch (error) {
      console.error("[shutdown] 停止实时行情失败:", error);
    }

    try {
      await publishQueue;
    } catch (error) {
      console.error("[shutdown] 等待发布队列失败:", error);
    }

    try {
      if (redis.isOpen) {
        await redis.quit();
      }
    } catch (error) {
      console.error("[shutdown] 关闭 Redis 连接失败:", error);
      try {
        await redis.disconnect();
      } catch {
        // 忽略强制断开时的异常
      }
    }

    console.warn("[shutdown] 已正常退出");
    process.exitCode = 0;
  }

  process.once("SIGINT", () => {
    shutdown("SIGINT").catch((error) => {
      console.error("[shutdown] 退出失败:", error);
      process.exit(1);
    });
  });

  process.once("SIGTERM", () => {
    shutdown("SIGTERM").catch((error) => {
      console.error("[shutdown] 退出失败:", error);
      process.exit(1);
    });
  });
}

main().catch((error) => {
  console.error("[spread-publisher] 启动失败:", error);
  process.exit(1);
});
