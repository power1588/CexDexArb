import { createInitialData } from "./fixtures/mockData.js";
import {
  createRealtimeFeeds,
  createUsdcRealtimeFeeds,
} from "./realtime/feeds.js";
import {
  bindAppEvents,
  renderApp,
  renderBootstrapError,
} from "./render/app.js";
import { loadFundingMonitorSnapshot } from "./services/funding.js";
import { createMarketUniverseService } from "./services/markets.js";
import { createAppStore } from "./state/store.js";
import { createRenderScheduler } from "./utils/performance.js";
import { applyViewportMode } from "./utils/responsive.js";

export function bootstrap({
  dataFactory = createInitialData,
  widthProvider = () => window.innerWidth,
  enableRealtime = true,
  enableMarketDiscovery = true,
  fundingRefreshIntervalMs = 60_000,
} = {}) {
  const root = document.querySelector("#app");

  if (!root) {
    throw new Error("应用挂载节点不存在");
  }

  try {
    const store = createAppStore(dataFactory());
    const shouldDeferRender = () => {
      const activeElement = document.activeElement;

      return Boolean(
        activeElement &&
          root.contains(activeElement) &&
          activeElement.matches("select, input, textarea"),
      );
    };

    const render = () => {
      applyViewportMode(document.documentElement, widthProvider());
      renderApp(root, store.getState());
    };
    const scheduleRender = createRenderScheduler(
      render,
      requestAnimationFrame,
      shouldDeferRender,
    );

    render();
    bindAppEvents(root, store);
    store.subscribe(scheduleRender);
    window.addEventListener("resize", scheduleRender);

    // 启动实时行情接入（价差套利视图）
    let feeds = null;
    if (enableRealtime && typeof WebSocket !== "undefined") {
      feeds = createRealtimeFeeds({
        symbols: store.getState().commonPerpSymbols,
        onQuotes: (quotes) => store.updateRealtimeQuotes(quotes),
        onStatus: (exchange, status, detail) =>
          store.updateFeedStatus(exchange, status, detail),
      });
      feeds.start();
    }

    // 启动 USDC 永续合约专属行情接入（Binance USDC-M + Hyperliquid，maker 0 fee）
    let usdcFeeds = null;
    if (enableRealtime && typeof WebSocket !== "undefined") {
      usdcFeeds = createUsdcRealtimeFeeds({
        symbols: store.getState().usdcPerpSymbols,
        onQuotes: (quotes) => store.updateUsdcRealtimeQuotes(quotes),
        onStatus: (exchange, status, detail) =>
          store.updateUsdcFeedStatus(exchange, status, detail),
      });
      usdcFeeds.start();
    }

    if (enableMarketDiscovery && typeof fetch === "function") {
      const marketUniverseService = createMarketUniverseService({
        initialSnapshot: {
          commonPerpSymbols: store.getState().commonPerpSymbols,
          symbolUniverseStatus: store.getState().symbolUniverseStatus,
          marketDiscovery: store.getState().marketDiscovery,
        },
      });

      const refreshFunding = () =>
        loadFundingMonitorSnapshot({
          commonPerpSymbols: store.getState().commonPerpSymbols,
          previousSymbols: store.getState().monitorSnapshot.symbols,
        }).then((snapshot) => {
          store.updateFundingSnapshots(snapshot);
        });

      marketUniverseService.refresh().then((snapshot) => {
        store.updateSymbolUniverse(snapshot);
        feeds?.updateSymbols(snapshot.commonPerpSymbols);
        refreshFunding();
      });

      refreshFunding();

      if (fundingRefreshIntervalMs > 0) {
        const fundingTimer = window.setInterval(
          refreshFunding,
          fundingRefreshIntervalMs,
        );
        window.addEventListener(
          "beforeunload",
          () => window.clearInterval(fundingTimer),
          { once: true },
        );
      }
    }
  } catch (error) {
    renderBootstrapError(
      root,
      error instanceof Error ? error.message : "未知初始化错误",
    );
  }
}

bootstrap();
