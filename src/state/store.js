import {
  buildPortfolioPreview,
  filterOpportunities,
  getOpportunityById,
  getOpportunityId,
} from "../core/metrics.js";
import { evaluateRiskSignals } from "../core/risk.js";
import {
  buildFundingOpportunities,
  sortFundingOpportunities,
} from "../core/funding.js";
import {
  computeAllSpreadOpportunities,
} from "../core/spread.js";

import {
  createStaticCommonPerpSnapshot,
  getCommonSymbolNames,
} from "../core/symbols.js";
import { serializeStrategyDraft } from "../core/strategy.js";

const defaultFilters = {
  exchange: "all",
  symbol: "all",
  minNetHourly: 0,
  minFundingSpreadHourly: 0,
  riskLevel: "all",
};

const defaultRiskConfig = {
  notionalUsd: 50000,
  leverage: 4,
  maxSlippageBps: 8,
  minFundingEdge: 0.00018,
  exitOnFundingFlip: true,
  marginBufferRatio: 0.2,
  minEdgeRetention: 0.00006,
};

const defaultSortState = {
  funding: {
    sortBy: "estimatedNetHourly",
    sortDirection: "desc",
  },
  spread: {
    sortBy: "netSpreadAbs",
    sortDirection: "desc",
  },
};

const defaultSpreadFilters = {
  status: "all",
  min24hVolumeUsd: 0,
};

function buildSymbolVolumeIndex(symbolSnapshots) {
  return symbolSnapshots.reduce((index, snapshot) => {
    if (!snapshot?.symbol || !snapshot?.exchange) {
      return index;
    }

    const current = index[snapshot.symbol] ?? {
      binance: null,
      hyperliquid: null,
    };

    if (snapshot.exchange === "binance" || snapshot.exchange === "hyperliquid") {
      current[snapshot.exchange] = snapshot.dayNotionalVolumeUsd ?? null;
    }

    index[snapshot.symbol] = current;
    return index;
  }, {});
}

function getStorageHealth(writeLatencyMs) {
  if (writeLatencyMs <= 200) {
    return "healthy";
  }

  if (writeLatencyMs <= 600) {
    return "degraded";
  }

  return "delayed";
}

function normalizeNumericValue(key, value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  const limits = {
    notionalUsd: { min: 1000, max: 500000 },
    leverage: { min: 1, max: 10 },
    maxSlippageBps: { min: 1, max: 20 },
    minFundingEdge: { min: 0.00001, max: 0.001 },
    marginBufferRatio: { min: 0.05, max: 0.8 },
    minEdgeRetention: { min: 0.00001, max: 0.001 },
  };

  const limit = limits[key];

  if (!limit) {
    return value;
  }

  return Math.min(limit.max, Math.max(limit.min, value));
}

export function createAppStore(seedData) {
  const listeners = new Set();
  const activeRiskCodes = new Set();
  const staticUniverse = createStaticCommonPerpSnapshot(
    seedData.monitorSnapshot.symbols,
  );
  const initialFundingOpportunities = sortFundingOpportunities(
    buildFundingOpportunities(
      seedData.monitorSnapshot.symbols,
      seedData.commonPerpSymbols ?? staticUniverse.commonPerpSymbols,
      {
        minimumNetHourly: defaultRiskConfig.minFundingEdge,
      },
    ),
    defaultSortState.funding.sortBy,
    defaultSortState.funding.sortDirection,
  );
  const initialOpportunityId = initialFundingOpportunities[0]
    ? getOpportunityId(initialFundingOpportunities[0])
    : null;
  let revision = 0;
  let cachedRevision = -1;
  let cachedState = null;

  const state = {
    monitorSnapshot: seedData.monitorSnapshot,
    strategyNodes: seedData.strategyNodes,
    logs: seedData.logs,
    charts: seedData.charts,
    strategyName: "BTC Funding Capture",
    filters: { ...defaultFilters },
    chartTimeframe: "24h",
    strategyStatus: "idle",
    portfolioStatus: "idle",
    selectedOpportunityId: initialOpportunityId,
    rejectionReason: "",
    riskConfig: { ...defaultRiskConfig },
    commonPerpSymbols: seedData.commonPerpSymbols ?? staticUniverse.commonPerpSymbols,
    symbolUniverseStatus:
      seedData.symbolUniverseStatus ?? staticUniverse.symbolUniverseStatus,
    marketDiscovery:
      seedData.marketDiscovery ??
      {
        binance: {
          exchange: "binance",
          status: "static",
          markets: [],
          fetchedAt: null,
          error: "",
        },
        hyperliquid: {
          exchange: "hyperliquid",
          status: "static",
          markets: [],
          fetchedAt: null,
          error: "",
        },
      },
    fundingMonitorStatus:
      seedData.fundingMonitorStatus ??
      {
        status: "static",
        error: "",
        warning: "",
        lastUpdatedAt: null,
        sources: {
          binance: seedData.monitorSnapshot.symbols.filter(
            (snapshot) => snapshot.exchange === "binance",
          ).length,
          hyperliquid: seedData.monitorSnapshot.symbols.filter(
            (snapshot) => snapshot.exchange === "hyperliquid",
          ).length,
        },
      },
    sorts: structuredClone(defaultSortState),
    spreadFilters: { ...defaultSpreadFilters },
    // 价差套利相关状态
    activeTab: "funding", // "funding" | "spread"
    realtimeQuotes: {}, // { BTC: { binance: Quote, hyperliquid: Quote }, ... }
    feedStatus: { binance: "closed", hyperliquid: "closed" }, // WebSocket 连接状态
  };

  syncStrategyFromOpportunity();

  function getFilteredOpportunities() {
    const opportunities = buildFundingOpportunities(
      state.monitorSnapshot.symbols,
      state.commonPerpSymbols,
      {
        minimumNetHourly: state.riskConfig.minFundingEdge,
      },
    );

    return sortFundingOpportunities(
      filterOpportunities(opportunities, state.filters),
      state.sorts.funding.sortBy,
      state.sorts.funding.sortDirection,
    );
  }

  function getSelectedOpportunity() {
    const opportunities = getFilteredOpportunities();
    return getOpportunityById(opportunities, state.selectedOpportunityId);
  }

  function getPortfolioPreview() {
    return buildPortfolioPreview(getSelectedOpportunity(), state.riskConfig);
  }

  function getRiskSignals() {
    const opportunity = getSelectedOpportunity();

    return evaluateRiskSignals({
      opportunity,
      storageLatencyMs: state.monitorSnapshot.storage.writeLatencyMs,
      maxSlippageBps: state.riskConfig.maxSlippageBps,
      minFundingEdge: state.riskConfig.minFundingEdge,
      exitOnFundingFlip: state.riskConfig.exitOnFundingFlip,
      longFundingRateHourly: opportunity?.longFundingRateHourly ?? 0,
      shortFundingRateHourly: opportunity?.shortFundingRateHourly ?? 0,
      minEdgeRetention: state.riskConfig.minEdgeRetention,
    });
  }

  function getStrategyDraft() {
    return serializeStrategyDraft({
      strategyName: state.strategyName,
      selectedSymbol: getSelectedOpportunity()?.symbol ?? "ALL",
      strategyNodes: state.strategyNodes,
      enabled: state.strategyStatus === "running",
    });
  }

  function emit() {
    syncRiskLogs();
    revision += 1;
    cachedState = null;
    listeners.forEach((listener) => listener(getState()));
  }

  function appendLog(entry) {
    state.logs = [
      {
        id: `log-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }),
        ...entry,
      },
      ...state.logs,
    ];
  }

  function getState() {
    if (cachedState && cachedRevision === revision) {
      return cachedState;
    }

    const filteredOpportunities = getFilteredOpportunities();
    const selectedOpportunity = getOpportunityById(
      filteredOpportunities,
      state.selectedOpportunityId,
    );
    const riskSignals = getRiskSignals();
    const symbolVolume24h = buildSymbolVolumeIndex(state.monitorSnapshot.symbols);
    const allSpreadOpportunities = computeAllSpreadOpportunities(
      state.realtimeQuotes,
      {
        allowedSymbols: getCommonSymbolNames(state.commonPerpSymbols),
        sortBy: state.sorts.spread.sortBy,
        sortDirection: state.sorts.spread.sortDirection,
      },
    ).map((item) => ({
      ...item,
      binance24hVolumeUsd: symbolVolume24h[item.symbol]?.binance ?? null,
      hyperliquid24hVolumeUsd: symbolVolume24h[item.symbol]?.hyperliquid ?? null,
    }));
    const spreadOpportunities = allSpreadOpportunities.filter(
      (item) =>
        (state.spreadFilters.status === "all" ||
          item.status === state.spreadFilters.status) &&
        (state.spreadFilters.min24hVolumeUsd <= 0 ||
          (item.binance24hVolumeUsd ?? 0) >= state.spreadFilters.min24hVolumeUsd &&
            (item.hyperliquid24hVolumeUsd ?? 0) >=
              state.spreadFilters.min24hVolumeUsd),
    );
    const readySpreadCount = allSpreadOpportunities.filter(
      (item) => item.status === "ready",
    ).length;
    const availableSymbols = getCommonSymbolNames(state.commonPerpSymbols);
    cachedState = {
      ...state,
      filteredOpportunities,
      selectedOpportunity,
      portfolioPreview: getPortfolioPreview(),
      riskSignals: riskSignals.map((signal) => signal.message),
      riskSignalEntries: riskSignals,
      strategyDraft: getStrategyDraft(),
      storageHealth: getStorageHealth(
        state.monitorSnapshot.storage.writeLatencyMs,
      ),
      spreadOpportunities,
      spreadOpportunityCount: allSpreadOpportunities.length,
      availableSymbols,
      readySpreadCount,
      commonPerpCount: state.commonPerpSymbols.length,
      missingSpreadCount: Math.max(
        state.commonPerpSymbols.length - allSpreadOpportunities.length,
        0,
      ),
      activeFundingSort: state.sorts.funding,
      activeSpreadSort: state.sorts.spread,
      activeSpreadStatusFilter: state.spreadFilters.status,
      activeSpreadMin24hVolumeUsd: state.spreadFilters.min24hVolumeUsd,
      fundingSnapshotCount: state.monitorSnapshot.symbols.length,
    };
    cachedRevision = revision;

    return cachedState;
  }

  function syncNodeConfig(nodeId, key, value) {
    state.strategyNodes = state.strategyNodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            config: {
              ...node.config,
              [key]: value,
            },
          }
        : node,
    );
  }

  function syncStrategyFromOpportunity() {
    const opportunity = getSelectedOpportunity();

    if (!opportunity) {
      return;
    }

    syncNodeConfig(
      "exchange-selector",
      "longExchange",
      opportunity.longExchange,
    );
    syncNodeConfig(
      "exchange-selector",
      "shortExchange",
      opportunity.shortExchange,
    );
    syncNodeConfig("symbol-filter", "symbol", opportunity.symbol);
    state.strategyName = `${opportunity.symbol} Funding Capture`;
  }

  function syncRiskConfigToNodes() {
    syncNodeConfig(
      "funding-threshold",
      "minNetHourly",
      state.riskConfig.minFundingEdge,
    );
    syncNodeConfig(
      "funding-threshold",
      "minFundingSpreadHourly",
      state.riskConfig.minFundingEdge,
    );
    syncNodeConfig(
      "hedge-executor",
      "notionalUsd",
      state.riskConfig.notionalUsd,
    );
    syncNodeConfig("hedge-executor", "leverage", state.riskConfig.leverage);
    syncNodeConfig(
      "hedge-executor",
      "slippageBps",
      state.riskConfig.maxSlippageBps,
    );
    syncNodeConfig(
      "risk-guard",
      "maxSlippageBps",
      state.riskConfig.maxSlippageBps,
    );
    syncNodeConfig("risk-guard", "leverageCap", state.riskConfig.leverage);
    syncNodeConfig(
      "risk-guard",
      "marginBufferRatio",
      state.riskConfig.marginBufferRatio,
    );
    syncNodeConfig(
      "exit-rule",
      "exitOnFundingFlip",
      state.riskConfig.exitOnFundingFlip,
    );
    syncNodeConfig(
      "exit-rule",
      "minEdgeRetention",
      state.riskConfig.minEdgeRetention,
    );
  }

  function syncRiskLogs() {
    const currentSignals = getRiskSignals();
    const currentCodes = new Set(currentSignals.map((signal) => signal.code));

    currentSignals.forEach((signal) => {
      if (!activeRiskCodes.has(signal.code)) {
        activeRiskCodes.add(signal.code);
        appendLog({
          severity: signal.severity,
          title: "触发风险告警",
          message: signal.message,
        });
      }
    });

    [...activeRiskCodes].forEach((code) => {
      if (!currentCodes.has(code)) {
        activeRiskCodes.delete(code);
      }
    });
  }

  syncRiskConfigToNodes();
  syncRiskLogs();

  return {
    getState,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setFilter(key, value) {
      state.filters = {
        ...state.filters,
        [key]: value,
      };
      const selectedOpportunity = getOpportunityById(
        filterOpportunities(
          buildFundingOpportunities(
            state.monitorSnapshot.symbols,
            state.commonPerpSymbols,
            {
              minimumNetHourly: state.riskConfig.minFundingEdge,
            },
          ),
          state.filters,
        ),
        state.selectedOpportunityId,
      );
      state.selectedOpportunityId = selectedOpportunity
        ? getOpportunityId(selectedOpportunity)
        : state.selectedOpportunityId;
      syncStrategyFromOpportunity();
      emit();
    },
    clearFilters() {
      state.filters = { ...defaultFilters };
      state.selectedOpportunityId = initialOpportunityId;
      syncStrategyFromOpportunity();
      emit();
    },
    selectOpportunity(opportunityId) {
      state.selectedOpportunityId = opportunityId;
      syncStrategyFromOpportunity();
      emit();
    },
    setChartTimeframe(value) {
      state.chartTimeframe = value;
      emit();
    },
    setSort(scope, sortBy, sortDirection) {
      if (!state.sorts[scope]) {
        return;
      }

      const nextDirection =
        sortDirection ??
        (state.sorts[scope].sortBy === sortBy &&
        state.sorts[scope].sortDirection === "desc"
          ? "asc"
          : "desc");

      state.sorts = {
        ...state.sorts,
        [scope]: {
          sortBy,
          sortDirection: nextDirection,
        },
      };
      emit();
    },
    setSpreadStatusFilter(status) {
      if (!["all", "ready", "watch", "blocked"].includes(status)) {
        return;
      }
      state.spreadFilters = {
        ...state.spreadFilters,
        status,
      };
      emit();
    },
    setSpreadMin24hVolumeUsd(min24hVolumeUsd) {
      const normalizedValue = Number(min24hVolumeUsd);

      if (![0, 1_000_000, 5_000_000, 10_000_000].includes(normalizedValue)) {
        return;
      }

      state.spreadFilters = {
        ...state.spreadFilters,
        min24hVolumeUsd: normalizedValue,
      };
      emit();
    },
    updateRiskConfig(key, value) {
      const normalizedValue =
        typeof value === "number" ? normalizeNumericValue(key, value) : value;

      if (normalizedValue === null) {
        appendLog({
          severity: "warning",
          title: "已拦截非法输入",
          message: `${key} 输入无效，已保留上一版风险参数。`,
        });
        emit();
        return;
      }

      state.riskConfig = {
        ...state.riskConfig,
        [key]: normalizedValue,
      };
      syncRiskConfigToNodes();
      emit();
    },
    updateStrategyNodeConfig(nodeId, key, value) {
      if (typeof value === "number") {
        const normalizedValue = normalizeNumericValue(key, value);

        if (normalizedValue === null) {
          appendLog({
            severity: "warning",
            title: "已拦截非法输入",
            message: `${nodeId}.${key} 输入无效，节点配置未更新。`,
          });
          emit();
          return;
        }

        value = normalizedValue;
      }

      syncNodeConfig(nodeId, key, value);

      if (nodeId === "symbol-filter" && key === "symbol") {
        state.filters = {
          ...state.filters,
          symbol: value,
        };
      }

      if (nodeId === "exchange-selector" && key === "longExchange") {
        state.riskConfig = {
          ...state.riskConfig,
        };
      }

      if (nodeId === "funding-threshold" && key === "minNetHourly") {
        state.riskConfig = {
          ...state.riskConfig,
          minFundingEdge: Number(value),
        };
      }

      if (nodeId === "funding-threshold" && key === "minFundingSpreadHourly") {
        state.riskConfig = {
          ...state.riskConfig,
          minFundingEdge: Number(value),
        };
      }

      if (nodeId === "hedge-executor" && key === "notionalUsd") {
        state.riskConfig = {
          ...state.riskConfig,
          notionalUsd: Number(value),
        };
      }

      if (nodeId === "hedge-executor" && key === "leverage") {
        state.riskConfig = {
          ...state.riskConfig,
          leverage: Number(value),
        };
      }

      if (nodeId === "risk-guard" && key === "maxSlippageBps") {
        state.riskConfig = {
          ...state.riskConfig,
          maxSlippageBps: Number(value),
        };
      }

      if (nodeId === "risk-guard" && key === "marginBufferRatio") {
        state.riskConfig = {
          ...state.riskConfig,
          marginBufferRatio: Number(value),
        };
      }

      if (nodeId === "exit-rule" && key === "exitOnFundingFlip") {
        state.riskConfig = {
          ...state.riskConfig,
          exitOnFundingFlip: Boolean(value),
        };
      }

      if (nodeId === "exit-rule" && key === "minEdgeRetention") {
        state.riskConfig = {
          ...state.riskConfig,
          minEdgeRetention: Number(value),
        };
      }

      emit();
    },
    runStrategy() {
      state.strategyStatus = "running";
      appendLog({
        severity: "info",
        title: "策略已启动",
        message: `前端演示状态已切换为运行中，策略草稿 ${state.strategyName} 已就绪。`,
      });
      emit();
    },
    stopStrategy() {
      state.strategyStatus = "idle";
      state.portfolioStatus = "idle";
      appendLog({
        severity: "warning",
        title: "策略已停止",
        message: "策略演示已回到待命状态。",
      });
      emit();
    },
    resetStrategy() {
      state.strategyStatus = "idle";
      state.portfolioStatus = "idle";
      state.rejectionReason = "";
      state.riskConfig = { ...defaultRiskConfig };
      state.strategyNodes = seedData.strategyNodes.map((node) => ({
        ...node,
        config: { ...node.config },
      }));
      syncStrategyFromOpportunity();
      syncRiskConfigToNodes();
      appendLog({
        severity: "info",
        title: "策略已重置",
        message: "风险参数与组合配置已恢复默认值。",
      });
      emit();
    },
    runPortfolio() {
      const selectedOpportunity = getSelectedOpportunity();
      const blockingSignal = getRiskSignals().find(
        (signal) => signal.severity === "error",
      );

      if (!selectedOpportunity) {
        state.portfolioStatus = "rejected";
        state.rejectionReason = "当前筛选条件下没有可运行的机会。";
        appendLog({
          severity: "error",
          title: "组合被拒绝",
          message: state.rejectionReason,
        });
        emit();
        return;
      }

      if (selectedOpportunity.estimatedNetHourly <= 0 || blockingSignal) {
        state.portfolioStatus = "rejected";
        state.rejectionReason =
          blockingSignal?.message ??
          "当前机会净收益不足，组合保持演示阻断状态。";
        appendLog({
          severity: "error",
          title: "组合被拒绝",
          message: state.rejectionReason,
        });
        emit();
        return;
      }

      state.rejectionReason = "";
      state.portfolioStatus = "queued";
      appendLog({
        severity: "info",
        title: "组合排队中",
        message: `${selectedOpportunity.symbol} 组合已进入模拟排队，准备校验风险与双腿方向。`,
      });
      state.portfolioStatus = "running";
      appendLog({
        severity: "info",
        title: "组合进入运行态",
        message: `${selectedOpportunity.symbol} 已进入模拟对冲运行，不会发起真实交易请求。`,
      });
      emit();
    },
    setActiveTab(tab) {
      if (tab !== "funding" && tab !== "spread") return;
      state.activeTab = tab;
      emit();
    },
    updateSymbolUniverse(snapshot) {
      state.commonPerpSymbols = snapshot.commonPerpSymbols ?? state.commonPerpSymbols;
      state.symbolUniverseStatus =
        snapshot.symbolUniverseStatus ?? state.symbolUniverseStatus;
      state.marketDiscovery = snapshot.marketDiscovery ?? state.marketDiscovery;

      const availableSymbols = getCommonSymbolNames(state.commonPerpSymbols);
      if (
        state.filters.symbol !== "all" &&
        !availableSymbols.includes(state.filters.symbol)
      ) {
        state.filters = {
          ...state.filters,
          symbol: "all",
        };
      }

      const selectedOpportunity = getSelectedOpportunity();
      state.selectedOpportunityId = selectedOpportunity
        ? getOpportunityId(selectedOpportunity)
        : null;

      appendLog({
        severity:
          state.symbolUniverseStatus.status === "ready" ? "info" : "warning",
        title: "共同交易对已刷新",
        message:
          state.symbolUniverseStatus.status === "ready"
            ? `当前已识别 ${state.commonPerpSymbols.length} 个共同永续交易对。`
            : `市场发现降级：${state.symbolUniverseStatus.error || "保留上一版共同交易对快照。"}`,
      });
      syncStrategyFromOpportunity();
      emit();
    },
    updateFundingSnapshots(snapshot) {
      if (snapshot.symbols) {
        state.monitorSnapshot = {
          ...state.monitorSnapshot,
          generatedAt:
            typeof snapshot.fundingMonitorStatus?.lastUpdatedAt === "number"
              ? new Date(snapshot.fundingMonitorStatus.lastUpdatedAt).toISOString()
              : state.monitorSnapshot.generatedAt,
          symbols: snapshot.symbols,
        };
      }

      if (snapshot.fundingMonitorStatus) {
        state.fundingMonitorStatus = snapshot.fundingMonitorStatus;
      }

      const selectedOpportunity = getSelectedOpportunity();
      state.selectedOpportunityId = selectedOpportunity
        ? getOpportunityId(selectedOpportunity)
        : null;

      appendLog({
        severity:
          state.fundingMonitorStatus.status === "ready" ? "info" : "warning",
        title: "Funding 数据已刷新",
        message:
          state.fundingMonitorStatus.status === "ready"
            ? `Funding 快照已更新，当前覆盖 ${state.monitorSnapshot.symbols.length} 条双边市场数据。`
            : `Funding 链路降级：${state.fundingMonitorStatus.error || "保留上一版有效 funding 快照。"}`,
      });
      syncStrategyFromOpportunity();
      emit();
    },
    updateRealtimeQuotes(quotes) {
      const allowedSymbols = new Set(getCommonSymbolNames(state.commonPerpSymbols));
      const filteredQuotes = Object.fromEntries(
        Object.entries(quotes).filter(([symbol]) => allowedSymbols.has(symbol)),
      );

      if (state.realtimeQuotes === filteredQuotes) {
        return;
      }

      state.realtimeQuotes = filteredQuotes;
      emit();
    },
    updateFeedStatus(exchange, feedStatus, detail = "") {
      const nextFeedStatus = { ...state.feedStatus, [exchange]: feedStatus };

      if (
        state.feedStatus[exchange] === feedStatus &&
        state.feedStatusDetail?.[exchange] === detail
      ) {
        return;
      }

      state.feedStatus = nextFeedStatus;
      state.feedStatusDetail = {
        ...(state.feedStatusDetail ?? {}),
        [exchange]: detail,
      };
      emit();
    },
  };
}
