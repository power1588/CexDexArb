import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXECUTION_CONFIG,
  loadExecutionConfig,
  validateExecutionConfig,
} from "../../src/executor/core/config.js";
import { ConfigError } from "../../src/executor/core/errors.js";

describe("execution config", () => {
  it("默认配置落在策略建议区间内", () => {
    expect(DEFAULT_EXECUTION_CONFIG.minOpenBps).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_EXECUTION_CONFIG.minOpenBps).toBeLessThanOrEqual(20);
    expect(DEFAULT_EXECUTION_CONFIG.maxTakerSlippageBps).toBeGreaterThan(0);
    expect(DEFAULT_EXECUTION_CONFIG.makerBufferBps).toBeGreaterThan(0);
    expect(DEFAULT_EXECUTION_CONFIG.maxUnhedgedMs).toBeLessThanOrEqual(5_000);
    expect(DEFAULT_EXECUTION_CONFIG.symbolCooldownAfterOrphanSec).toBeGreaterThan(0);
  });

  it("缺失关键配置时初始化失败", () => {
    expect(() =>
      validateExecutionConfig({
        ...DEFAULT_EXECUTION_CONFIG,
        redis: {
          url: "",
          opportunityChannel: "",
        },
      }),
    ).toThrow(ConfigError);
  });

  it("非法配置值会被拦截", () => {
    expect(() =>
      validateExecutionConfig({
        ...DEFAULT_EXECUTION_CONFIG,
        minOpenBps: -1,
      }),
    ).toThrow("minOpenBps");
  });

  it("支持按环境加载配置", () => {
    const replayConfig = loadExecutionConfig({ environment: "replay" });
    const simulationConfig = loadExecutionConfig({ environment: "simulation" });

    expect(replayConfig.environment).toBe("replay");
    expect(simulationConfig.environment).toBe("simulation");
    expect(replayConfig.maxSignalAgeMs).toBeGreaterThan(simulationConfig.maxSignalAgeMs);
  });

  it("live 模式必须显式开启实盘守卫", () => {
    expect(() =>
      loadExecutionConfig({
        environment: "live",
      }),
    ).toThrow("liveTradingEnabled");

    const liveConfig = loadExecutionConfig({
      environment: "live",
      overrides: {
        liveTradingEnabled: true,
      },
    });

    expect(liveConfig.environment).toBe("live");
    expect(liveConfig.liveTradingEnabled).toBe(true);
  });

  it("L5-01: live 模式校验 liveTestRisk 红线参数", () => {
    const liveConfig = loadExecutionConfig({
      environment: "live",
      overrides: { liveTradingEnabled: true },
    });
    expect(liveConfig.liveTestRisk).toMatchObject({
      maxNotionalUsdc: 10,
      maxSlippageBps: 10,
      makerTimeoutMs: 120_000,
      maxUnhedgedMs: 5_000,
      maxCyclesPerDay: 5,
      totalBudgetUsdc: 50,
    });
  });

  it("L5-01: live 模式 liveTestRisk.maxNotionalUsdc 超过 10 被拦截", () => {
    expect(() =>
      loadExecutionConfig({
        environment: "live",
        overrides: {
          liveTradingEnabled: true,
          liveTestRisk: { maxNotionalUsdc: 100 },
        },
      }),
    ).toThrow("maxNotionalUsdc");
  });

  it("L5-01: 支持通过环境变量覆盖 liveTestRisk", () => {
    const liveConfig = loadExecutionConfig({
      environment: "live",
      overrides: { liveTradingEnabled: true },
      environmentVariables: {
        LIVE_MAX_NOTIONAL_USDC: "5",
        LIVE_MAX_SLIPPAGE_BPS: "8",
      },
    });
    expect(liveConfig.liveTestRisk.maxNotionalUsdc).toBe(5);
    expect(liveConfig.liveTestRisk.maxSlippageBps).toBe(8);
  });
});
