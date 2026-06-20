import { createInitialData } from "../../src/fixtures/mockData.js";
import { getOpportunityId } from "../../src/core/metrics.js";
import { renderApp, renderBootstrapError } from "../../src/render/app.js";
import { createAppStore } from "../../src/state/store.js";

describe("renderApp", () => {
  it("渲染首屏核心区域", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore(createInitialData());

    renderApp(root, store.getState());

    expect(root.querySelector('[data-testid="hero"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="filters"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="matrix"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="funding-summary"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="funding-sort-controls"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="strategy-builder"]')).toBeNull();
    expect(root.querySelector('[data-testid="portfolio-preview"]')).toBeNull();
    expect(root.querySelector('[data-testid="logs"]')).toBeNull();
  });

  it("在无结果时显示空态", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore(createInitialData());

    store.setFilter("symbol", "XRP");
    renderApp(root, store.getState());

    expect(root.textContent).toContain("共同交易对已发现，但 Funding 数据暂未齐备或不满足当前筛选条件");
  });

  it("渲染风险信号与联动后的组合信息", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore(createInitialData());

    store.selectOpportunity("ETH:binance:hyperliquid");
    store.updateRiskConfig("maxSlippageBps", 12);
    renderApp(root, store.getState());

    expect(root.textContent).toContain("ETH");
    expect(root.textContent).toContain("Binance 多 / Hyperliquid 空");
  });

  it("渲染矩阵细项、拒绝原因和存储健康状态", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const seed = createInitialData();
    seed.monitorSnapshot.symbols = seed.monitorSnapshot.symbols.map((snapshot) =>
      snapshot.symbol === "SOL" && snapshot.exchange === "hyperliquid"
        ? {
            ...snapshot,
            fundingRateHourly: 0.00011,
          }
        : snapshot,
    );
    const store = createAppStore(seed);

    store.setFilter("symbol", "SOL");
    store.selectOpportunity(
      getOpportunityId(
        store
          .getState()
          .filteredOpportunities.find((item) => item.symbol === "SOL"),
      ),
    );
    store.runPortfolio();
    renderApp(root, store.getState());

    expect(root.textContent).toContain("Long Funding");
    expect(root.textContent).toContain("费率差");
    expect(root.textContent).toContain("净收益");
    expect(root.textContent).not.toContain("数据库健康");
    expect(root.textContent).not.toContain("拒绝原因");
  });

  it("移动端仍渲染简洁机会看板", () => {
    document.documentElement.dataset.viewportMode = "mobile";
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore(createInitialData());
    renderApp(root, store.getState());

    expect(root.textContent).toContain("Binance × Hyperliquid 套利机会看板");
    expect(root.textContent).toContain("费率交易机会");
    expect(root.querySelector(".opportunity-table caption")).not.toBeNull();
  });

  it("在无机会数据时显示统一空态文案", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore({
      ...createInitialData(),
      monitorSnapshot: {
        ...createInitialData().monitorSnapshot,
        symbols: [],
        opportunities: [],
      },
      commonPerpSymbols: [],
    });

    renderApp(root, store.getState());

    expect(root.textContent).toContain("当前未发现 Binance 与 Hyperliquid 的共同永续交易对");
    expect(root.textContent).not.toContain("暂无组合预览");
  });

  it("在初始化失败时渲染错误降级界面", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");

    renderBootstrapError(root, "模拟数据装载失败");

    expect(root.textContent).toContain("初始化失败");
    expect(root.textContent).toContain("模拟数据装载失败");
    expect(
      root.querySelector('[data-testid="bootstrap-error"]'),
    ).not.toBeNull();
  });

  it("默认显示费率套利视图，可切换到价差套利视图", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore(createInitialData());

    renderApp(root, store.getState());

    // 默认费率套利
    expect(root.querySelector('[data-testid="mode-tabs"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="filters"]')).not.toBeNull();
    expect(root.textContent).toContain("费率交易机会");

    // 切换到价差套利
    store.setActiveTab("spread");
    renderApp(root, store.getState());

    expect(root.querySelector('[data-testid="spread-status"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="spread-matrix"]')).not.toBeNull();
    // 价差视图不应出现费率套利的筛选栏
    expect(root.querySelector('[data-testid="filters"]')).toBeNull();
    expect(root.textContent).toContain("价差交易机会");
  });

  it("价差视图在无实时数据时显示等待提示", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore(createInitialData());

    store.setActiveTab("spread");
    renderApp(root, store.getState());

    expect(root.textContent).toContain("等待连接");
  });

  it("无共同交易对时显示专属空态", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore({
      ...createInitialData(),
      commonPerpSymbols: [],
      symbolUniverseStatus: {
        status: "error",
        binance: "error",
        hyperliquid: "error",
        error: "market fail",
        lastUpdatedAt: null,
        version: 1,
      },
    });

    renderApp(root, store.getState());

    expect(root.textContent).toContain("当前未发现 Binance 与 Hyperliquid 的共同永续交易对");
    expect(root.textContent).toContain("市场发现 异常");
  });

  it("价差视图在有数据时按净价差绝对值排序展示", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore(createInitialData());

    store.updateRealtimeQuotes({
      BTC: {
        binance: { exchange: "binance", bidPrice: 50100, askPrice: 50000, bidQty: 2, askQty: 1, timestamp: 0 },
        hyperliquid: { exchange: "hyperliquid", bidPrice: 50300, askPrice: 50400, bidQty: 1, askQty: 1, timestamp: 0 },
      },
      ETH: {
        binance: { exchange: "binance", bidPrice: 3001, askPrice: 3000, bidQty: 10, askQty: 10, timestamp: 0 },
        hyperliquid: { exchange: "hyperliquid", bidPrice: 3002, askPrice: 3003, bidQty: 10, askQty: 10, timestamp: 0 },
      },
    });
    store.setActiveTab("spread");
    renderApp(root, store.getState());

    const table = root.querySelector('[data-testid="spread-matrix"] table');
    expect(table).not.toBeNull();
    const firstRowSymbol = table.querySelector("tbody tr td").textContent;
    expect(firstRowSymbol).toBe("BTC"); // BTC 价差更大
    expect(root.querySelector('[data-testid="spread-status-filters"]')).not.toBeNull();
    expect(root.textContent).toContain("手续费");
    expect(root.textContent).toContain("24h量(B/H)");
  });

  it("价差视图支持按状态过滤机会", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore(createInitialData());

    store.updateRealtimeQuotes({
      BTC: {
        binance: { exchange: "binance", bidPrice: 50100, askPrice: 50000, bidQty: 2, askQty: 1, timestamp: 0 },
        hyperliquid: { exchange: "hyperliquid", bidPrice: 50300, askPrice: 50400, bidQty: 1, askQty: 1, timestamp: 0 },
      },
      ETH: {
        binance: { exchange: "binance", bidPrice: 3000.4, askPrice: 3000, bidQty: 10, askQty: 10, timestamp: 0 },
        hyperliquid: { exchange: "hyperliquid", bidPrice: 3002.3, askPrice: 3003, bidQty: 10, askQty: 10, timestamp: 0 },
      },
    });
    store.setActiveTab("spread");
    store.setSpreadStatusFilter("ready");
    renderApp(root, store.getState());

    const rows = [...root.querySelectorAll('[data-testid="spread-matrix"] tbody tr')];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("BTC");

    store.setSpreadStatusFilter("blocked");
    renderApp(root, store.getState());
    expect(root.textContent).toContain("当前状态筛选下没有匹配的价差机会");
  });

  it("价差视图支持按双边 24h 交易量过滤机会", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore(createInitialData());

    store.updateFundingSnapshots({
      symbols: [
        {
          symbol: "BTC",
          exchange: "binance",
          fundingRate: 0.0001,
          fundingIntervalHours: 8,
          takerFee: 0.0005,
          markPrice: 50000,
          dayNotionalVolumeUsd: 12_000_000,
        },
        {
          symbol: "BTC",
          exchange: "hyperliquid",
          fundingRate: 0.00002,
          fundingIntervalHours: 1,
          takerFee: 0.00045,
          markPrice: 50300,
          dayNotionalVolumeUsd: 8_000_000,
        },
        {
          symbol: "ETH",
          exchange: "binance",
          fundingRate: 0.0001,
          fundingIntervalHours: 8,
          takerFee: 0.0005,
          markPrice: 3000,
          dayNotionalVolumeUsd: 600_000,
        },
        {
          symbol: "ETH",
          exchange: "hyperliquid",
          fundingRate: 0.00002,
          fundingIntervalHours: 1,
          takerFee: 0.00045,
          markPrice: 3002.3,
          dayNotionalVolumeUsd: 700_000,
        },
      ],
      fundingMonitorStatus: {
        status: "ready",
        error: "",
        warning: "",
        lastUpdatedAt: 1000,
        sources: {
          binance: 2,
          hyperliquid: 2,
        },
      },
    });

    store.updateRealtimeQuotes({
      BTC: {
        binance: { exchange: "binance", bidPrice: 50100, askPrice: 50000, bidQty: 2, askQty: 1, timestamp: 0 },
        hyperliquid: { exchange: "hyperliquid", bidPrice: 50300, askPrice: 50400, bidQty: 1, askQty: 1, timestamp: 0 },
      },
      ETH: {
        binance: { exchange: "binance", bidPrice: 3000.4, askPrice: 3000, bidQty: 10, askQty: 10, timestamp: 0 },
        hyperliquid: { exchange: "hyperliquid", bidPrice: 3002.3, askPrice: 3003, bidQty: 10, askQty: 10, timestamp: 0 },
      },
    });
    store.setActiveTab("spread");
    store.setSpreadMin24hVolumeUsd(1_000_000);
    renderApp(root, store.getState());

    expect(root.textContent).toContain("双边24h量");
    expect(root.textContent).toContain(">= 100万U");
    const rows = [...root.querySelectorAll('[data-testid="spread-matrix"] tbody tr')];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("BTC");
  });

  it("展示当前排序依据与共同交易对数量", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore(createInitialData());

    store.setSort("funding", "fundingSpreadHourly");
    renderApp(root, store.getState());

    expect(root.textContent).toContain("共同标的");
    expect(root.textContent).toContain("快照");
  });

  it("展示 builder funding 监控状态与机会", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector("#app");
    const store = createAppStore({
      ...createInitialData(),
      commonPerpSymbols: [
        {
          symbol: "SPCX",
          binanceSymbol: "SPCXUSDT",
          hyperliquidSymbol: "xyz:SPCX",
          hyperliquidBuilder: "xyz",
        },
      ],
    });

    store.updateFundingSnapshots({
      symbols: [
        {
          symbol: "SPCX",
          exchange: "binance",
          fundingRate: 0.00015263,
          fundingIntervalHours: 8,
          takerFee: 0.0005,
          markPrice: 181.07832183,
        },
        {
          symbol: "SPCX",
          exchange: "hyperliquid",
          fundingRate: 0.0000348053,
          fundingIntervalHours: 1,
          takerFee: 0.00009,
          markPrice: 180.89,
        },
      ],
      fundingMonitorStatus: {
        status: "ready",
        error: "",
        warning: "",
        lastUpdatedAt: 1000,
        sources: {
          binance: 1,
          hyperliquid: 1,
        },
      },
    });
    renderApp(root, store.getState());

    expect(root.textContent).toContain("Funding 监控");
    expect(root.textContent).toContain("SPCX");
    expect(root.textContent).toContain("快照 1/1");
  });
});
