import { describe, expect, it, vi } from "vitest";
import { ManualClock, createInMemoryEventBus, createStructuredLogger } from "../../src/executor/adapters/runtime.js";
import { loadExecutionConfig } from "../../src/executor/core/config.js";
import { createOrphanLegHandler } from "../../src/executor/services/orphanLegHandler.js";
import { createRiskEventReporter } from "../../src/executor/services/riskEventReporter.js";
import { createRiskManager } from "../../src/executor/services/riskManager.js";

describe("orphan leg handler", () => {
  const config = loadExecutionConfig();

  it("识别净暴露数量正确", async () => {
    const handler = createOrphanLegHandler({
      orderRouter: {
        async cancelOrder() {},
        async placeOrder() {
          return { filledQuantity: 0.5 };
        },
      },
      riskManager: {
        registerSymbolCooldown() {},
      },
      riskEventReporter: {
        record() {},
      },
      clock: new ManualClock(1_000),
      config,
    });

    const result = await handler.handle({
      symbol: "BTC",
      planId: "plan-1",
      orphanOrder: {
        exchange: "binance",
        orderId: "1",
      },
      hedgeLeg: {
        exchange: "hyperliquid",
        side: "sell",
      },
      netExposureQuantity: 0.5,
    });

    expect(result.netExposure).toBe(0.5);
    expect(result.hedged).toBe(true);
  });

  it("先撤余单，再发 IOC 对冲", async () => {
    const events = [];
    const handler = createOrphanLegHandler({
      orderRouter: {
        async cancelOrder() {
          events.push("cancel");
        },
        async placeOrder() {
          events.push("hedge");
          return { filledQuantity: 0.5 };
        },
      },
      riskManager: {
        registerSymbolCooldown() {},
      },
      riskEventReporter: {
        record() {},
      },
      clock: new ManualClock(1_000),
      config,
    });

    await handler.handle({
      symbol: "BTC",
      planId: "plan-1",
      orphanOrder: {
        exchange: "binance",
        orderId: "1",
      },
      hedgeLeg: {
        exchange: "hyperliquid",
        side: "sell",
      },
      netExposureQuantity: 0.5,
    });

    expect(events).toEqual(["cancel", "hedge"]);
  });

  it("二次补单仍失败时会进入报警与冷却", async () => {
    const clock = new ManualClock(1_000);
    const eventBus = createInMemoryEventBus();
    const notifier = {
      notify: vi.fn(),
    };
    const reporter = createRiskEventReporter({
      clock,
      eventBus,
      logger: createStructuredLogger(),
      notifier,
    });
    const riskManager = createRiskManager({
      config,
      orderRouter: {
        async cancelOrder() {},
      },
      riskEventReporter: reporter,
      clock,
    });
    const handler = createOrphanLegHandler({
      orderRouter: {
        async cancelOrder() {},
        async placeOrder() {
          throw new Error("fail");
        },
      },
      riskManager,
      riskEventReporter: reporter,
      clock,
      config,
    });

    const result = await handler.handle({
      symbol: "BTC",
      planId: "plan-1",
      orphanOrder: {
        exchange: "binance",
        orderId: "1",
      },
      hedgeLeg: {
        exchange: "hyperliquid",
        side: "sell",
      },
      netExposureQuantity: 0.5,
    });

    expect(result.hedged).toBe(false);
    expect(riskManager.isSymbolCoolingDown("BTC")).toBe(true);
    expect(notifier.notify).toHaveBeenCalled();
  });
});
