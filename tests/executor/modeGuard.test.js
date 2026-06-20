import { describe, expect, it, vi } from "vitest";
import { loadExecutionConfig } from "../../src/executor/core/config.js";
import { createModeGuard } from "../../src/executor/services/modeGuard.js";

describe("mode guard", () => {
  it("模拟模式不会发送真实下单请求", async () => {
    const orderRouter = {
      placeOrder: vi.fn(),
    };
    const guard = createModeGuard({
      config: loadExecutionConfig({
        environment: "simulation",
      }),
    });

    const guardedRouter = guard.wrapOrderRouter(orderRouter);
    const result = await guardedRouter.placeOrder({
      exchange: "binance",
    });

    expect(result.status).toBe("simulated");
    expect(orderRouter.placeOrder).not.toHaveBeenCalled();
  });

  it("实盘模式必须显式开启", () => {
    const guard = createModeGuard({
      config: loadExecutionConfig({
        environment: "simulation",
      }),
    });

    expect(
      guard.validateModeSwitch({
        adapterMode: "live",
      }),
    ).toMatchObject({
      passed: false,
      reason: "adapter_mode_mismatch",
    });
  });

  it("模式切换会影响 adapter 与风险阈值", () => {
    const liveGuard = createModeGuard({
      config: loadExecutionConfig({
        environment: "live",
        overrides: {
          liveTradingEnabled: true,
        },
      }),
    });

    expect(
      liveGuard.validateModeSwitch({
        adapterMode: "live",
        riskMode: "live",
        notifierConfigured: true,
      }),
    ).toMatchObject({
      passed: true,
    });
  });
});
