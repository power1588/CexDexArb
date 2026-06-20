import { describe, expect, it } from "vitest";
import { ManualClock, createInMemoryEventBus, createStructuredLogger } from "../../src/executor/adapters/runtime.js";
import { loadExecutionConfig } from "../../src/executor/core/config.js";
import { createRiskEventReporter } from "../../src/executor/services/riskEventReporter.js";
import { createRiskManager } from "../../src/executor/services/riskManager.js";

describe("risk manager", () => {
  const config = loadExecutionConfig();

  it("滑点超限会阻止继续追价", () => {
    const riskManager = createRiskManager({
      config,
    });

    expect(riskManager.evaluateSlippage({ slippageBps: 20 })).toMatchObject({
      allowChase: false,
      reason: "slippage_exceeded",
    });
  });

  it("连接中断会撤销另一边未成交挂单", async () => {
    const cancelled = [];
    const riskManager = createRiskManager({
      config,
      orderRouter: {
        async cancelOrder(order) {
          cancelled.push(order.orderId);
        },
      },
      riskEventReporter: createRiskEventReporter({
        clock: new ManualClock(1_000),
        eventBus: createInMemoryEventBus(),
        logger: createStructuredLogger(),
      }),
      clock: new ManualClock(1_000),
    });

    await riskManager.handleConnectionLost({
      symbol: "BTC",
      planId: "plan-1",
      openOrders: [
        { exchange: "binance", orderId: "1" },
        { exchange: "hyperliquid", orderId: "2" },
      ],
    });

    expect(cancelled).toEqual(["1", "2"]);
  });

  it("保证金不足会阻止开仓或触发退出", () => {
    const riskManager = createRiskManager({
      config,
    });

    expect(
      riskManager.evaluateMargin({
        availableMarginUsdt: 10,
        hasOpenPosition: false,
      }),
    ).toMatchObject({
      allowOpen: false,
      shouldExit: false,
    });
    expect(
      riskManager.evaluateMargin({
        availableMarginUsdt: 10,
        hasOpenPosition: true,
      }),
    ).toMatchObject({
      allowOpen: false,
      shouldExit: true,
    });
  });

  it("单腿事件后会触发 symbol 冷却期", () => {
    const clock = new ManualClock(1_000);
    const riskManager = createRiskManager({
      config,
      clock,
    });

    riskManager.registerSymbolCooldown("BTC");
    expect(riskManager.isSymbolCoolingDown("BTC")).toBe(true);
    clock.advance(config.symbolCooldownAfterOrphanSec * 1000 + 1);
    expect(riskManager.isSymbolCoolingDown("BTC")).toBe(false);
  });
});
