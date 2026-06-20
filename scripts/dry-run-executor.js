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
import { createCloseExecutor } from "../src/executor/services/closeExecutor.js";
import { createExitRuleEngine } from "../src/executor/services/exitRuleEngine.js";
import { createModeGuard } from "../src/executor/services/modeGuard.js";
import { createOrphanLegHandler } from "../src/executor/services/orphanLegHandler.js";
import { createPlanSelector } from "../src/executor/services/planSelector.js";
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

async function main() {
  const clock = new ManualClock(1_700_000_000_000);
  const eventBus = createInMemoryEventBus();
  const logger = createStructuredLogger();
  const runtime = createRuntime({
    clock,
    eventBus,
    logger,
  });
  const config = loadExecutionConfig({
    environment: "simulation",
  });

  printHeader("Dry Run 环境");
  printStep("运行模式", {
    environment: config.environment,
    liveTradingEnabled: config.liveTradingEnabled,
    description: "simulation 模式，不会触发真实下单。",
  });

  const guard = createModeGuard({ config });
  printStep("模式守卫检查", guard.validateModeSwitch({
    adapterMode: "simulation",
    riskMode: "simulation",
    notifierConfigured: true,
  }));

  const mainTraces = [];
  const orderRouter = createLoggingOrderRouter({
    traces: mainTraces,
    responsesByExchange: {
      binance: [
        {
          status: "filled",
          filled: 0.019999,
        },
        {
          status: "filled",
          filled: 0.019999,
        },
      ],
      hyperliquid: [
        {
          status: "partial",
          filled: 0.01,
        },
        {
          status: "filled",
          filled: 0.009999,
        },
        {
          status: "filled",
          filled: 0.019999,
        },
      ],
    },
  });

  const riskEventReporter = createRiskEventReporter({
    clock,
    eventBus,
    logger,
    notifier: {
      notify(payload) {
        mainTraces.push({
          action: "notify",
          payload,
        });
      },
    },
  });
  const riskManager = createRiskManager({
    config,
    orderRouter,
    riskEventReporter,
    clock,
  });
  const planSelector = createPlanSelector({
    config,
    clock,
  });

  await runMainScenario({
    config,
    runtime,
    planSelector,
    orderRouter,
    riskEventReporter,
  });

  printStep("主链路下单请求", mainTraces);

  await runRiskScenario({
    config,
    runtime,
    riskManager,
    riskEventReporter,
  });

  printStep("结构化日志", logger.getEntries());
  printStep("事件总线", eventBus.getPublishedEvents());
}

main().catch((error) => {
  console.error("\n[dry-run failed]");
  console.error(error);
  process.exitCode = 1;
});
