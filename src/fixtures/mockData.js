export const monitorSnapshot = {
  generatedAt: "2026-06-19T10:32:00Z",
  symbols: [
    {
      symbol: "BTC",
      exchange: "binance",
      markPrice: 103245.2,
      indexPrice: 103201.8,
      fundingRateHourly: 0.00008,
      nextFundingTime: "2026-06-19T12:00:00Z",
      fundingIntervalHours: 1,
      takerFee: 0.0005,
      makerFee: 0.0002,
      sourceLagMs: 420,
    },
    {
      symbol: "BTC",
      exchange: "hyperliquid",
      markPrice: 103311.7,
      indexPrice: 103226.3,
      fundingRateHourly: 0.00031,
      nextFundingTime: "2026-06-19T11:00:00Z",
      fundingIntervalHours: 1,
      takerFee: 0.00045,
      makerFee: 0.00015,
      sourceLagMs: 690,
    },
    {
      symbol: "ETH",
      exchange: "binance",
      markPrice: 5798.4,
      indexPrice: 5794.1,
      fundingRateHourly: -0.00005,
      nextFundingTime: "2026-06-19T12:00:00Z",
      fundingIntervalHours: 1,
      takerFee: 0.0005,
      makerFee: 0.0002,
      sourceLagMs: 500,
    },
    {
      symbol: "ETH",
      exchange: "hyperliquid",
      markPrice: 5810.9,
      indexPrice: 5801.2,
      fundingRateHourly: 0.00021,
      nextFundingTime: "2026-06-19T11:00:00Z",
      fundingIntervalHours: 1,
      takerFee: 0.00045,
      makerFee: 0.00015,
      sourceLagMs: 760,
    },
    {
      symbol: "SOL",
      exchange: "binance",
      markPrice: 228.84,
      indexPrice: 228.72,
      fundingRateHourly: 0.00011,
      nextFundingTime: "2026-06-19T12:00:00Z",
      fundingIntervalHours: 1,
      takerFee: 0.0005,
      makerFee: 0.0002,
      sourceLagMs: 450,
    },
    {
      symbol: "SOL",
      exchange: "hyperliquid",
      markPrice: 229.62,
      indexPrice: 229.18,
      fundingRateHourly: -0.00004,
      nextFundingTime: "2026-06-19T11:00:00Z",
      fundingIntervalHours: 1,
      takerFee: 0.00045,
      makerFee: 0.00015,
      sourceLagMs: 980,
    },
  ],
  opportunities: [
    {
      symbol: "BTC",
      longExchange: "binance",
      shortExchange: "hyperliquid",
      fundingSpreadHourly: 0.00023,
      estimatedNetHourly: 0.00018,
      suggestedLeverage: 4,
      status: "ready",
    },
    {
      symbol: "ETH",
      longExchange: "binance",
      shortExchange: "hyperliquid",
      fundingSpreadHourly: 0.00026,
      estimatedNetHourly: 0.00016,
      suggestedLeverage: 3,
      status: "watch",
    },
    {
      symbol: "SOL",
      longExchange: "hyperliquid",
      shortExchange: "binance",
      fundingSpreadHourly: 0.00015,
      estimatedNetHourly: -0.00002,
      suggestedLeverage: 2,
      status: "blocked",
    },
  ],
  storage: {
    backend: "victoriametrics",
    writeLatencyMs: 148,
    retentionDays: 30,
  },
};

export const defaultStrategyNodes = [
  {
    id: "exchange-selector",
    type: "exchange_selector",
    label: "交易所选择",
    config: {
      longExchange: "binance",
      shortExchange: "hyperliquid",
    },
  },
  {
    id: "symbol-filter",
    type: "symbol_filter",
    label: "标的过滤",
    config: {
      symbol: "BTC",
      includeMajorOnly: true,
    },
  },
  {
    id: "funding-threshold",
    type: "funding_threshold",
    label: "阈值判断",
    config: {
      minNetHourly: 0.0001,
      minFundingSpreadHourly: 0.00018,
    },
  },
  {
    id: "hedge-executor",
    type: "hedge_executor",
    label: "双腿下单",
    config: {
      notionalUsd: 50000,
      leverage: 4,
      slippageBps: 6,
    },
  },
  {
    id: "risk-guard",
    type: "risk_guard",
    label: "风险限制",
    config: {
      maxSlippageBps: 8,
      leverageCap: 5,
      marginBufferRatio: 0.2,
    },
  },
  {
    id: "exit-rule",
    type: "exit_rule",
    label: "平仓条件",
    config: {
      exitOnFundingFlip: true,
      minEdgeRetention: 0.00006,
    },
  },
];

export const defaultLogs = [
  {
    id: "log-1",
    severity: "info",
    timestamp: "10:31:52",
    title: "快照同步完成",
    message: "Binance / Hyperliquid 最新 funding 与标记价格已载入本地模拟层。",
  },
  {
    id: "log-2",
    severity: "warning",
    timestamp: "10:32:11",
    title: "ETH 进入观察态",
    message: "ETH 跨所净收益高于阈值，但当前滑点缓冲不足，建议继续观察。",
  },
  {
    id: "log-3",
    severity: "error",
    timestamp: "10:32:26",
    title: "SOL 组合被阻断",
    message: "SOL 当前预估净收益为负，风控面板禁止进入运行态。",
  },
  {
    id: "log-4",
    severity: "warning",
    timestamp: "10:32:45",
    title: "双腿暂时失衡",
    message: "BTC 组合两腿成交回报存在 180 ms 偏移，正在等待下一次状态对齐。",
  },
  {
    id: "log-5",
    severity: "warning",
    timestamp: "10:33:04",
    title: "交易所连接波动",
    message: "Hyperliquid 行情源短暂抖动，页面已切换为静态快照演示。",
  },
  {
    id: "log-6",
    severity: "info",
    timestamp: "10:33:26",
    title: "人工干预记录",
    message: "操盘手手动调整了 ETH 组合名义价值，用于验证收益拆解与风控提示。",
  },
];

export const chartSeries = [
  {
    metric: "funding_spread",
    title: "Funding Spread",
    value: "+0.023% / h",
    descriptions: {
      "1h": "展示最近 1 小时 funding spread 的瞬时变化。",
      "8h": "展示最近 8 小时 funding spread 的平滑轨迹。",
      "24h": "展示最近 24 小时 funding spread 的主趋势。",
      "7d": "展示最近 7 天 funding spread 的历史对比。",
    },
  },
  {
    metric: "price_spread",
    title: "Price Spread",
    value: "+0.064%",
    descriptions: {
      "1h": "对比短周期价格偏离与盘口扰动。",
      "8h": "观察日内价差收敛与扩张过程。",
      "24h": "复盘全天净价差区间。",
      "7d": "评估周级价差稳定性与回归速度。",
    },
  },
  {
    metric: "portfolio_equity",
    title: "组合净值",
    value: "+1.82%",
    descriptions: {
      "1h": "近 1 小时组合权益变化。",
      "8h": "近 8 小时组合净值曲线。",
      "24h": "近 24 小时收益拆解总览。",
      "7d": "近 7 天组合权益回放。",
    },
  },
  {
    metric: "execution_fill",
    title: "告警时间线",
    value: "6 条事件",
    descriptions: {
      "1h": "最近 1 小时的风险和执行告警。",
      "8h": "最近 8 小时事件时间线。",
      "24h": "最近 24 小时系统、策略与风控事件。",
      "7d": "最近 7 天事件回放入口。",
    },
  },
];

export function createInitialData() {
  return {
    monitorSnapshot,
    strategyNodes: structuredClone(defaultStrategyNodes),
    logs: structuredClone(defaultLogs),
    charts: structuredClone(chartSeries),
    commonPerpSymbols: [
      {
        symbol: "BTC",
        binanceSymbol: "BTCUSDT",
        hyperliquidSymbol: "BTC",
      },
      {
        symbol: "ETH",
        binanceSymbol: "ETHUSDT",
        hyperliquidSymbol: "ETH",
      },
      {
        symbol: "SOL",
        binanceSymbol: "SOLUSDT",
        hyperliquidSymbol: "SOL",
      },
    ],
    symbolUniverseStatus: {
      status: "ready",
      binance: "static",
      hyperliquid: "static",
      error: "",
      lastUpdatedAt: "2026-06-19T10:32:00Z",
      version: 1,
    },
  };
}
