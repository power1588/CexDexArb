import { createInitialData } from "../../src/fixtures/mockData.js";
import { getOpportunityId } from "../../src/core/metrics.js";
import { createAppStore } from "../../src/state/store.js";

describe("store", () => {
  it("提供默认状态与选中机会", () => {
    const store = createAppStore(createInitialData());
    const state = store.getState();

    expect(state.filteredOpportunities).toHaveLength(3);
    expect(state.selectedOpportunity.symbol).toBe("ETH");
    expect(state.portfolioPreview.notionalUsd).toBe(50000);
    expect(state.commonPerpSymbols).toHaveLength(3);
    expect(state.symbolUniverseStatus.status).toBe("ready");
  });

  it("支持筛选与重置筛选", () => {
    const store = createAppStore(createInitialData());

    store.setFilter("symbol", "ETH");
    expect(store.getState().filteredOpportunities).toHaveLength(1);

    store.clearFilters();
    expect(store.getState().filteredOpportunities).toHaveLength(3);
  });

  it("支持启动和停止策略并写入日志", () => {
    const store = createAppStore(createInitialData());

    store.runStrategy();
    expect(store.getState().strategyStatus).toBe("running");

    store.stopStrategy();
    const state = store.getState();
    expect(state.strategyStatus).toBe("idle");
    expect(state.logs[0].title).toBe("策略已停止");
  });

  it("支持运行组合并切换状态", () => {
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

    store.runPortfolio();
    expect(store.getState().portfolioStatus).toBe("running");

    store.setFilter("symbol", "SOL");
    store.selectOpportunity(
      getOpportunityId(
        store
          .getState()
          .filteredOpportunities.find((item) => item.symbol === "SOL"),
      ),
    );
    store.runPortfolio();
    expect(store.getState().portfolioStatus).toBe("rejected");
    expect(store.getState().rejectionReason).toBeTruthy();
  });

  it("支持编辑策略节点并同步生成序列化草稿", () => {
    const store = createAppStore(createInitialData());

    store.updateStrategyNodeConfig(
      "funding-threshold",
      "minNetHourly",
      0.00022,
    );
    const state = store.getState();

    expect(
      state.strategyNodes.find((node) => node.id === "funding-threshold").config
        .minNetHourly,
    ).toBe(0.00022);
    expect(
      state.strategyDraft.nodes.find((node) => node.id === "funding-threshold")
        .config.minNetHourly,
    ).toBe(0.00022);
  });

  it("切换机会时同步更新策略节点与组合预览", () => {
    const store = createAppStore(createInitialData());

    store.selectOpportunity("ETH:binance:hyperliquid");
    const state = store.getState();

    expect(state.selectedOpportunity.symbol).toBe("ETH");
    expect(state.portfolioPreview.symbol).toBe("ETH");
    expect(
      state.strategyNodes.find((node) => node.id === "symbol-filter").config
        .symbol,
    ).toBe("ETH");
    expect(
      state.strategyNodes.find((node) => node.id === "exchange-selector").config
        .longExchange,
    ).toBe("binance");
  });

  it("风险配置超限时写入告警日志并暴露风险信号", () => {
    const store = createAppStore(createInitialData());

    store.updateRiskConfig("maxSlippageBps", 12);
    const state = store.getState();

    expect(state.riskSignals).toContain("滑点上限过高");
    expect(state.logs[0].title).toBe("触发风险告警");
  });

  it("图表时间粒度切换时更新状态", () => {
    const store = createAppStore(createInitialData());

    store.setChartTimeframe("7d");
    expect(store.getState().chartTimeframe).toBe("7d");
  });

  it("支持切换 funding 与 spread 排序状态", () => {
    const store = createAppStore(createInitialData());

    store.setSort("funding", "fundingSpreadHourly");
    store.setSort("spread", "grossSpreadPct");

    const state = store.getState();
    expect(state.activeFundingSort.sortBy).toBe("fundingSpreadHourly");
    expect(state.activeSpreadSort.sortBy).toBe("grossSpreadPct");
  });

  it("支持按价差状态过滤交易对", () => {
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

    store.setSpreadStatusFilter("ready");
    let state = store.getState();
    expect(state.activeSpreadStatusFilter).toBe("ready");
    expect(state.spreadOpportunities).toHaveLength(1);
    expect(state.spreadOpportunities[0].symbol).toBe("BTC");

    store.setSpreadStatusFilter("watch");
    state = store.getState();
    expect(state.spreadOpportunities).toHaveLength(1);
    expect(state.spreadOpportunities[0].symbol).toBe("ETH");
  });

  it("支持按双边 24h 交易量过滤价差交易对", () => {
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

    store.setSpreadMin24hVolumeUsd(1_000_000);
    const state = store.getState();

    expect(state.activeSpreadMin24hVolumeUsd).toBe(1_000_000);
    expect(state.spreadOpportunities).toHaveLength(1);
    expect(state.spreadOpportunities[0].symbol).toBe("BTC");
    expect(state.spreadOpportunities[0].binance24hVolumeUsd).toBe(12_000_000);
  });

  it("对非法风险输入执行拦截和归一化", () => {
    const store = createAppStore(createInitialData());

    store.updateRiskConfig("leverage", Number.NaN);
    expect(store.getState().riskConfig.leverage).toBe(4);

    store.updateRiskConfig("maxSlippageBps", 99);
    expect(store.getState().riskConfig.maxSlippageBps).toBe(20);
  });

  it("在 funding 方向反转时生成错误级告警并拒绝组合", () => {
    const seed = createInitialData();
    seed.monitorSnapshot.symbols = seed.monitorSnapshot.symbols.map((snapshot) =>
      snapshot.symbol === "ETH"
        ? {
            ...snapshot,
            fundingRateHourly:
              snapshot.exchange === "binance" ? 0.00021 : 0.0002,
          }
        : snapshot,
    );
    const store = createAppStore(seed);

    store.selectOpportunity(
      getOpportunityId(
        store
          .getState()
          .filteredOpportunities.find((item) => item.symbol === "ETH"),
      ),
    );
    store.runPortfolio();

    expect(
      store.getState().riskSignalEntries.map((signal) => signal.code),
    ).toContain("funding-flip");
    expect(store.getState().portfolioStatus).toBe("rejected");
  });

  it("缓存未变更时复用派生状态对象", () => {
    const store = createAppStore(createInitialData());

    const first = store.getState();
    const second = store.getState();

    expect(first).toBe(second);
  });

  it("共同交易对刷新后同步状态与已选标的", () => {
    const store = createAppStore(createInitialData());

    store.updateSymbolUniverse({
      commonPerpSymbols: [
        {
          symbol: "ETH",
          binanceSymbol: "ETHUSDT",
          hyperliquidSymbol: "ETH",
        },
      ],
      symbolUniverseStatus: {
        status: "ready",
        binance: "ready",
        hyperliquid: "ready",
        error: "",
        lastUpdatedAt: 123,
        version: 2,
      },
    });

    const state = store.getState();
    expect(state.commonPerpCount).toBe(1);
    expect(state.availableSymbols).toEqual(["ETH"]);
    expect(state.selectedOpportunity.symbol).toBe("ETH");
  });

  it("Funding 快照刷新后纳入 builder 标的动态机会", () => {
    const store = createAppStore({
      ...createInitialData(),
      commonPerpSymbols: [
        {
          symbol: "SPCX",
          binanceSymbol: "SPCXUSDT",
          hyperliquidSymbol: "xyz:SPCX",
          hyperliquidBuilder: "xyz",
        },
        {
          symbol: "OPENAI",
          binanceSymbol: "OPENAIUSDT",
          hyperliquidSymbol: "vntl:OPENAI",
          hyperliquidBuilder: "vntl",
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
        {
          symbol: "OPENAI",
          exchange: "binance",
          fundingRate: 0.00005,
          fundingIntervalHours: 8,
          takerFee: 0.0005,
          markPrice: 1383.23,
        },
        {
          symbol: "OPENAI",
          exchange: "hyperliquid",
          fundingRate: 0,
          fundingIntervalHours: 1,
          takerFee: 0.00009,
          markPrice: 1336.2,
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

    const state = store.getState();
    expect(state.filteredOpportunities.map((item) => item.symbol)).toEqual([
      "SPCX",
      "OPENAI",
    ]);
    expect(state.fundingMonitorStatus.status).toBe("ready");
  });
});
