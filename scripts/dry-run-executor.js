import { createMockExchangeAdapter } from "../src/executor/adapters/exchangeAdapter.js";
import {
  ManualClock,
  createInMemoryEventBus,
  createRuntime,
  createStructuredLogger,
} from "../src/executor/adapters/runtime.js";
import { loadExecutionConfig } from "../src/executor/core/config.js";
import { createMarketSnapshot, createOpportunitySignal } from "../src/executor/domain/models.js";
import { createSpreadExecutor } from "../src/executor/orchestrators/spreadExecutor.js";
import { createOpenCycleOrchestrator } from "../src/executor/orchestrators/openCycleOrchestrator.js";
import { createCloseCycleOrchestrator } from "../src/executor/orchestrators/closeCycleOrchestrator.js";
import { createArbitrageCycleOrchestrator } from "../src/executor/orchestrators/arbitrageCycleOrchestrator.js";
import { SqliteAdapter } from "../src/executor/persistence/sqliteAdapter.js";
import { runMigrations } from "../src/executor/persistence/schema.js";
import { createRepositories } from "../src/executor/persistence/repositories.js";
import { createCloseExecutor } from "../src/executor/services/closeExecutor.js";
import { createExitRuleEngine } from "../src/executor/services/exitRuleEngine.js";
import { createModeGuard } from "../src/executor/services/modeGuard.js";
import { createOrphanLegHandler } from "../src/executor/services/orphanLegHandler.js";
import { createPlanSelector } from "../src/executor/services/planSelector.js";
import { createPositionGuardLoop } from "../src/executor/services/positionGuardLoop.js";
import { createPositionMonitor } from "../src/executor/services/positionMonitor.js";
import { createRiskEventReporter } from "../src/executor/services/riskEventReporter.js";
import { createRiskManager } from "../src/executor/services/riskManager.js";
import { createOrderRouter } from "../src/executor/services/orderRouter.js";

function printHeader(title) {
  process.stdout.write(`\n=== ${title} ===\n`);
}

function printStep(title, payload) {
  process.stdout.write(`\n[${title}]\n`);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function createScenarioInput(timestamp) {
  return {
    signal: createOpportunitySignal({
      signalId: `sig-${timestamp}`,
      symbol: "BTC",
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      observedSpreadBps: 18,
      observedAt: timestamp,
      publishedAt: timestamp,
      strategyVersion: "dry-run-v1",
      payload: {
        source: "manual-dry-run",
      },
    }),
    marketSnapshot: createMarketSnapshot({
      snapshotId: `snap-${timestamp}`,
      symbol: "BTC",
      timestamp,
      fxUsdcUsdtMid: 1,
      fundingRateBps: {
        binance: 1.2,
        hyperliquid: -0.4,
      },
      marginAvailableUsdt: {
        binance: 10_000,
        hyperliquid: 8_000,
      },
      books: {
        binance: {
          bestBid: { price: 100_000, quantity: 1.2 },
          bestAsk: { price: 100_005, quantity: 1.1 },
        },
        hyperliquid: {
          bestBid: { price: 100_220, quantity: 1.3 },
          bestAsk: { price: 100_230, quantity: 1.1 },
        },
      },
      metadata: {
        scenario: "dry-run",
      },
    }),
    desiredNotionalUsdt: 2_000,
    orderBookCapacityUsdt: 2_500,
    maxExposureUsdt: 3_000,
    depthScoreByExchange: {
      binance: 0.72,
      hyperliquid: 0.91,
    },
    queueScoreByExchange: {
      binance: 0.83,
      hyperliquid: 0.28,
    },
    hedgeReliabilityByExchange: {
      binance: 0.58,
      hyperliquid: 0.95,
    },
    adverseSelectionRiskByExchange: {
      binance: 0.12,
      hyperliquid: 0.15,
    },
  };
}

function createLoggingOrderRouter({ traces, responsesByExchange }) {
  function nextResponse(exchange, request) {
    const queue = responsesByExchange[exchange] ?? [];

    if (queue.length === 0) {
      return {
        id: `${exchange}-${Date.now()}`,
        symbol: request.symbol,
        side: request.side,
        status: "filled",
        price: request.price,
        quantity: request.quantity,
        filled: request.quantity,
      };
    }

    const next = queue.shift();
    if (next instanceof Error) {
      throw next;
    }

    return {
      id: `${exchange}-${queue.length}`,
      symbol: request.symbol,
      side: request.side,
      price: request.price,
      quantity: request.quantity,
      ...next,
    };
  }

  const adapters = {
    binance: createMockExchangeAdapter({
      name: "binance",
      handlers: {
        async placeOrder(request) {
          traces.push({
            exchange: "binance",
            action: "placeOrder",
            request,
          });
          return nextResponse("binance", request);
        },
        async cancelOrder(request) {
          traces.push({
            exchange: "binance",
            action: "cancelOrder",
            request,
          });
          return {
            cancelled: true,
            ...request,
          };
        },
      },
    }),
    hyperliquid: createMockExchangeAdapter({
      name: "hyperliquid",
      handlers: {
        async placeOrder(request) {
          traces.push({
            exchange: "hyperliquid",
            action: "placeOrder",
            request,
          });
          return nextResponse("hyperliquid", request);
        },
        async cancelOrder(request) {
          traces.push({
            exchange: "hyperliquid",
            action: "cancelOrder",
            request,
          });
          return {
            cancelled: true,
            ...request,
          };
        },
      },
    }),
  };

  return createOrderRouter({ adapters });
}

async function runMainScenario({
  config,
  runtime,
  planSelector,
  orderRouter,
  riskEventReporter,
}) {
  printHeader("Dry Run 主链路");

  const input = createScenarioInput(runtime.clock.now());
  const selection = planSelector.selectPlan(input);
  printStep("候选信号", input.signal);
  printStep("前置检查 + 模式选择", {
    accepted: selection.accepted,
    selectedMode: selection.plan?.mode,
    expectedNetEdgeBps: selection.plan?.expectedNetEdgeBps,
    targetNotionalUsdt: selection.plan?.targetNotionalUsdt,
    legs: selection.plan?.legs,
    modeScores: selection.scoredModes?.scores,
  });

  const executor = createSpreadExecutor({
    config,
    runtime,
    planSelector,
    orderRouter,
  });
  const execution = await executor.executePlan(selection.plan);
  printStep("开仓执行结果", execution);

  const positionSnapshot = {
    positionId: "pos-dry-run-1",
    symbol: "BTC",
    timestamp: runtime.clock.now(),
    legs: [
      {
        exchange: "binance",
        symbol: "BTC",
        side: "long",
        quantity: selection.plan.legs[0].quantity,
        entryPrice: selection.plan.legs[0].price,
        markPrice: 100_120,
        notionalUsdt: 2_000,
      },
      {
        exchange: "hyperliquid",
        symbol: "BTC",
        side: "short",
        quantity: selection.plan.legs[1].quantity,
        entryPrice: selection.plan.legs[1].price,
        markPrice: 100_090,
        notionalUsdt: 1_980,
      },
    ],
    unrealizedPnlUsdt: 22,
  };

  const positionMonitor = createPositionMonitor({ config });
  const monitorResult = positionMonitor.evaluate(positionSnapshot);
  printStep("持仓监控", monitorResult);

  const exitEngine = createExitRuleEngine();
  const exitDecision = exitEngine.evaluate({
    targetExitReached: false,
    holdingDurationMs: 90_000,
    maxHoldingDurationMs: 60_000,
    fundingDirection: "adverse",
    riskEvents: [],
  });
  printStep("退出规则判断", exitDecision);

  const closeExecutor = createCloseExecutor({
    orderRouter,
    riskEventReporter,
  });
  const closeResult = await closeExecutor.execute({
    planId: selection.plan.planId,
    positionSnapshot,
    executionPath: exitDecision.executionPath,
  });
  printStep("平仓执行结果", closeResult);
}

async function runRiskScenario({
  config,
  runtime,
  riskManager,
  riskEventReporter,
}) {
  printHeader("Dry Run 风险路径");

  const traces = [];
  const orderRouter = createLoggingOrderRouter({
    traces,
    responsesByExchange: {
      binance: [],
      hyperliquid: [new Error("hedge ioc rejected")],
    },
  });

  const orphanHandler = createOrphanLegHandler({
    orderRouter,
    riskManager,
    riskEventReporter,
    clock: runtime.clock,
    config,
  });

  const orphanResult = await orphanHandler.handle({
    symbol: "BTC",
    planId: "plan-orphan-1",
    orphanOrder: {
      exchange: "binance",
      orderId: "maker-open-1",
    },
    hedgeLeg: {
      exchange: "hyperliquid",
      symbol: "BTC",
      side: "sell",
      orderType: "ioc",
      price: 100_180,
    },
    netExposureQuantity: 0.02,
  });
  printStep("单腿暴露处置", orphanResult);

  const connectionEvent = await riskManager.handleConnectionLost({
    symbol: "BTC",
    planId: "plan-orphan-1",
    openOrders: [
      {
        exchange: "binance",
        orderId: "maker-open-2",
      },
      {
        exchange: "hyperliquid",
        orderId: "hedge-open-2",
      },
    ],
  });
  printStep("连接中断处置", connectionEvent);
  printStep("风险路径下的路由请求", traces);
}

function parseScenarioArg(argv) {
  const idx = argv.indexOf("--scenario");
  if (idx === -1) {
    return null;
  }
  return argv[idx + 1] ?? null;
}

async function runOpenCycleScenario({ config, runtime }) {
  printHeader("Dry Run 场景: open-cycle（建仓闭环）");

  const dbPath = `:memory:`;
  const adapter = new SqliteAdapter({ dbPath });
  runMigrations(adapter);
  const repos = createRepositories(adapter);

  const binance = createMockExchangeAdapter({
    name: "binance",
    handlers: {
      async placeOrder(request) {
        return {
          orderId: `bin-${Date.now()}`,
          status: "filled",
          price: request.price,
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
        return {
          orderId: `hl-${Date.now()}`,
          status: "filled",
          price: request.price,
          quantity: request.quantity,
          filledQuantity: request.quantity,
        };
      },
    },
  });
  const orderRouter = createOrderRouter({ adapters: { binance, hyperliquid } });

  const orchestrator = createOpenCycleOrchestrator({
    config,
    runtime,
    orderRouter,
    repositories: repos,
  });

  const signal = createOpportunitySignal({
    signalId: "sig-dry-open",
    symbol: "BTC",
    buyExchange: "binance",
    sellExchange: "hyperliquid",
    observedSpreadBps: 20,
    observedAt: runtime.clock.now(),
    publishedAt: runtime.clock.now(),
    strategyVersion: "dry-run-open-v1",
  });

  const plan = {
    planId: "plan-dry-open",
    signalId: signal.signalId,
    symbol: "BTC",
    mode: "maker_taker",
    targetNotionalUsdt: 1000,
    expectedNetEdgeBps: 12,
    riskBudget: { maxUnhedgedMs: 2500, maxSlippageBps: 6 },
    legs: [
      { exchange: "binance", side: "buy", symbol: "BTC", quoteCurrency: "USDT", orderType: "limit", price: 100, quantity: 10 },
      { exchange: "hyperliquid", side: "sell", symbol: "BTC", quoteCurrency: "USDC", orderType: "ioc", price: 102, quantity: 10 },
    ],
    parameterSnapshot: { fxUsdcUsdtMid: 1.0 },
  };

  const result = await orchestrator.runOpenCycle({
    cycleId: "cycle-dry-open",
    signal,
    plan,
  });

  printStep("建仓闭环结果", {
    success: result.success,
    cycleId: result.cycleId,
    aligned: result.alignment?.aligned,
    lockedNetSpreadUsdt: result.lockedSpread?.netSpreadUsdt,
    lockedNetSpreadBps: result.lockedSpread?.netSpreadBps,
    deviationBps: result.comparison?.deviationBps,
    alarmLevel: result.comparison?.alarmLevel,
  });

  const stored = repos.aggregateByCycleId("cycle-dry-open");
  printStep("SQLite 落库（聚合查询）", {
    cycleStatus: stored.cycle.status,
    orderCount: stored.orders.length,
    fillCount: stored.fills.length,
    spreadLockBps: stored.spreadLock?.net_spread_bps,
  });

  adapter.close();
}

async function runCloseCycleScenario({ config, runtime }) {
  printHeader("Dry Run 场景: close-cycle（平仓闭环）");

  const adapter = new SqliteAdapter({ dbPath: ":memory:" });
  runMigrations(adapter);
  const repos = createRepositories(adapter);

  const binance = createMockExchangeAdapter({
    name: "binance",
    handlers: {
      async placeOrder(request) {
        return {
          orderId: `bin-close-${Date.now()}`,
          status: "filled",
          price: request.price,
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
        return {
          orderId: `hl-close-${Date.now()}`,
          status: "filled",
          price: request.price,
          quantity: request.quantity,
          filledQuantity: request.quantity,
        };
      },
    },
  });
  const orderRouter = createOrderRouter({ adapters: { binance, hyperliquid } });

  // 预置已建仓的 cycle（含 spread_lock）
  repos.cycles.insert({
    cycleId: "cycle-close-dry",
    signalId: "sig-close-dry",
    symbol: "BTC",
    mode: "maker_taker",
    direction: "buy_binance_sell_hyperliquid",
    status: "MONITORING",
    startedAt: runtime.clock.now() - 60_000,
  });
  repos.spreadLocks.insert({
    lockId: "sl-close-dry",
    cycleId: "cycle-close-dry",
    symbol: "BTC",
    grossSpreadUsdt: 20,
    feeCostUsdt: 1,
    netSpreadUsdt: 19,
    netSpreadBps: 190,
    fxDetail: { fxUsdcUsdtMid: 1.0 },
    lockedAt: runtime.clock.now() - 60_000,
  });

  const orchestrator = createCloseCycleOrchestrator({
    config,
    runtime,
    orderRouter,
    repositories: repos,
  });

  const result = await orchestrator.runCloseCycle({
    cycleId: "cycle-close-dry",
    closeSignal: {
      openDirection: "buy_binance_sell_hyperliquid",
      legs: [
        { exchange: "binance", side: "sell", symbol: "BTC", quantity: 10, price: 101, role: "maker", legType: "maker_close", quoteCurrency: "USDT" },
        { exchange: "hyperliquid", side: "buy", symbol: "BTC", quantity: 10, price: 100, role: "taker", legType: "taker_close", quoteCurrency: "USDC" },
      ],
      expectedSpreadUsdt: 1.0,
      expectedSpreadBps: 10,
      fxUsdcUsdtMid: 1.0,
    },
    positionSnapshot: {
      symbol: "BTC",
      legs: [
        { exchange: "binance", side: "long", quantity: 10, markPrice: 101, notionalUsdt: 1010 },
        { exchange: "hyperliquid", side: "short", quantity: 10, markPrice: 100, notionalUsdt: 1000 },
      ],
    },
  });

  printStep("平仓闭环结果", {
    success: result.success,
    cycleId: result.cycleId,
    actualSpreadUsdt: result.comparison.actualSpreadUsdt,
    netProfitUsdt: result.comparison.netProfitUsdt,
    makerSlippage: result.comparison.makerSlippageUsdt,
    takerSlippage: result.comparison.takerSlippageUsdt,
  });

  const stored = repos.aggregateByCycleId("cycle-close-dry");
  printStep("平仓落库", {
    cycleStatus: stored.cycle.status,
    closeResultNetProfit: stored.closeResult?.net_profit_usdt,
    closeOrderCount: stored.orders.filter((o) => o.leg.includes("close")).length,
  });

  adapter.close();
}

async function runFullCycleScenario({ config, runtime }) {
  printHeader("Dry Run 场景: full-cycle（完整生命周期闭环）");

  const adapter = new SqliteAdapter({ dbPath: ":memory:" });
  runMigrations(adapter);
  const repos = createRepositories(adapter);

  const binance = createMockExchangeAdapter({
    name: "binance",
    handlers: {
      async placeOrder(request) {
        return {
          orderId: `bin-${runtime.clock.now()}`,
          status: "filled",
          price: request.price,
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
        return {
          orderId: `hl-${runtime.clock.now()}`,
          status: "filled",
          price: request.price,
          quantity: request.quantity,
          filledQuantity: request.quantity,
        };
      },
    },
  });
  const orderRouter = createOrderRouter({ adapters: { binance, hyperliquid } });

  const sequence = [
    { buyAsk: 100, sellBid: 101 },
    { buyAsk: 100, sellBid: 100.02 },
  ];

  const orchestrator = createArbitrageCycleOrchestrator({
    config,
    runtime,
    orderRouter,
    repositories: repos,
    pollIntervalMs: 100,
    maxHoldingDurationMs: 60_000,
    getMarketSnapshot: async () => {
      runtime.clock.advance(100);
      const next = sequence.shift();
      if (!next) return null;
      return {
        buyBook: { exchange: "binance", bestAsk: { price: next.buyAsk }, quoteCurrency: "USDT" },
        sellBook: { exchange: "hyperliquid", bestBid: { price: next.sellBid }, quoteCurrency: "USDC" },
        fxUsdcUsdtMid: 1.0,
      };
    },
  });

  const signal = createOpportunitySignal({
    signalId: "sig-full-dry",
    symbol: "BTC",
    buyExchange: "binance",
    sellExchange: "hyperliquid",
    observedSpreadBps: 20,
    observedAt: runtime.clock.now(),
    publishedAt: runtime.clock.now(),
  });

  const plan = {
    planId: "plan-full-dry",
    signalId: signal.signalId,
    symbol: "BTC",
    mode: "maker_taker",
    targetNotionalUsdt: 1000,
    expectedNetEdgeBps: 12,
    riskBudget: { maxUnhedgedMs: 2500, maxSlippageBps: 6 },
    legs: [
      { exchange: "binance", side: "buy", symbol: "BTC", quoteCurrency: "USDT", orderType: "limit", price: 100, quantity: 10 },
      { exchange: "hyperliquid", side: "sell", symbol: "BTC", quoteCurrency: "USDC", orderType: "ioc", price: 102, quantity: 10 },
    ],
    parameterSnapshot: { fxUsdcUsdtMid: 1.0 },
  };

  const result = await orchestrator.runFullCycle({ cycleId: "cycle-full-dry", signal, plan });

  printStep("完整闭环结果", {
    success: result.success,
    stages: result.stages,
    cycleId: result.cycleId,
  });

  const stored = repos.aggregateByCycleId("cycle-full-dry");
  printStep("完整链路落库", {
    cycleStatus: stored.cycle.status,
    orderCount: stored.orders.length,
    fillCount: stored.fills.length,
    lockedNetSpreadBps: stored.spreadLock?.net_spread_bps,
    netProfitUsdt: stored.closeResult?.net_profit_usdt,
  });

  adapter.close();
}

async function runSpreadReversionScenario({ config, runtime }) {
  printHeader("Dry Run 场景: spread-reversion（价差回归监控）");

  const adapter = new SqliteAdapter({ dbPath: ":memory:" });
  runMigrations(adapter);
  const repos = createRepositories(adapter);

  // 模拟逐步收窄的双腿盘口序列
  const sequence = [
    { buyAsk: 100, sellBid: 101 }, // ~99 bps
    { buyAsk: 100, sellBid: 100.5 }, // ~50 bps
    { buyAsk: 100, sellBid: 100.1 }, // ~10 bps
    { buyAsk: 100, sellBid: 100.02 }, // ~2 bps -> ready
  ];

  const loop = createPositionGuardLoop({
    clock: runtime.clock,
    pollIntervalMs: 100,
    maxHoldingDurationMs: 60_000,
    closeThresholdBps: config.minOpenBps,
    getMarketSnapshot: async () => {
      const next = sequence.shift();
      if (!next) {
        return null;
      }
      runtime.clock.advance(100);
      return {
        buyBook: { exchange: "binance", bestAsk: { price: next.buyAsk }, quoteCurrency: "USDT" },
        sellBook: { exchange: "hyperliquid", bestBid: { price: next.sellBid }, quoteCurrency: "USDC" },
        fxUsdcUsdtMid: 1.0,
      };
    },
  });

  // 先落一个 cycle，模拟已建仓状态
  repos.cycles.insert({
    cycleId: "cycle-reversion",
    signalId: "sig-reversion",
    symbol: "BTC",
    mode: "maker_taker",
    direction: "buy_binance_sell_hyperliquid",
    status: "MONITORING",
    startedAt: runtime.clock.now(),
  });

  const result = await loop.run({
    cycleId: "cycle-reversion",
    openDirection: "buy_binance_sell_hyperliquid",
    fxUsdcUsdtMid: 1.0,
  });

  // 每轮快照落库到 risk_events 作为监控轨迹
  for (const snap of result.snapshots) {
    repos.riskEvents.insert({
      riskEventId: `snap-${snap.cycleId}-${snap.iteration}`,
      cycleId: snap.cycleId,
      type: "spread_snapshot",
      severity: "info",
      symbol: "BTC",
      planId: null,
      message: `spread_bps=${snap.netSpreadBps.toFixed(4)} ready=${snap.readyToClose}`,
      context: {
        netSpreadBps: snap.netSpreadBps,
        reversionDirection: snap.reversionDirection,
        readyToClose: snap.readyToClose,
      },
      timestamp: snap.clockNow,
    });
  }

  printStep("监控结果", {
    exitReason: result.exitReason,
    iterations: result.snapshots.length,
    finalSpreadBps: result.finalSnapshot?.netSpreadBps,
  });

  const stored = repos.aggregateByCycleId("cycle-reversion");
  printStep("监控轨迹落库", {
    snapshotCount: stored.riskEvents.filter((e) => e.type === "spread_snapshot").length,
  });

  adapter.close();
}

async function runLegacyScenario({ config, runtime }) {
  const mainTraces = [];
  const orderRouter = createLoggingOrderRouter({
    traces: mainTraces,
    responsesByExchange: {
      binance: [
        { status: "filled", filled: 0.019999 },
        { status: "filled", filled: 0.019999 },
      ],
      hyperliquid: [
        { status: "partial", filled: 0.01 },
        { status: "filled", filled: 0.009999 },
        { status: "filled", filled: 0.019999 },
      ],
    },
  });

  const riskEventReporter = createRiskEventReporter({
    clock: runtime.clock,
    eventBus: runtime.eventBus,
    logger: runtime.logger,
    notifier: {
      notify(payload) {
        mainTraces.push({ action: "notify", payload });
      },
    },
  });
  const riskManager = createRiskManager({
    config,
    orderRouter,
    riskEventReporter,
    clock: runtime.clock,
  });
  const planSelector = createPlanSelector({ config, clock: runtime.clock });

  await runMainScenario({ config, runtime, planSelector, orderRouter, riskEventReporter });
  printStep("主链路下单请求", mainTraces);
  await runRiskScenario({ config, runtime, riskManager, riskEventReporter });
  printStep("结构化日志", runtime.logger.getEntries());
  printStep("事件总线", runtime.eventBus.getPublishedEvents());
}

async function main() {
  const scenario = parseScenarioArg(process.argv);
  const clock = new ManualClock(1_700_000_000_000);
  const eventBus = createInMemoryEventBus();
  const logger = createStructuredLogger();
  const runtime = createRuntime({ clock, eventBus, logger });
  const config = loadExecutionConfig({ environment: "simulation" });

  printHeader("Dry Run 环境");
  printStep("运行模式", {
    environment: config.environment,
    liveTradingEnabled: config.liveTradingEnabled,
    description: "simulation 模式，不会触发真实下单。",
    scenario: scenario ?? "legacy",
  });

  const guard = createModeGuard({ config });
  printStep("模式守卫检查", guard.validateModeSwitch({
    adapterMode: "simulation",
    riskMode: "simulation",
    notifierConfigured: true,
  }));

  if (scenario === "open-cycle") {
    await runOpenCycleScenario({ config, runtime });
    return;
  }

  if (scenario === "spread-reversion") {
    await runSpreadReversionScenario({ config, runtime });
    return;
  }

  if (scenario === "close-cycle") {
    await runCloseCycleScenario({ config, runtime });
    return;
  }

  if (scenario === "full-cycle") {
    await runFullCycleScenario({ config, runtime });
    return;
  }

  await runLegacyScenario({ config, runtime });
}

main().catch((error) => {
  console.error("\n[dry-run failed]");
  console.error(error);
  process.exitCode = 1;
});
