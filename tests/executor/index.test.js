import { describe, expect, it, vi } from "vitest";
import { initializeExecutor } from "../../src/executor/index.js";
import { createRuntime } from "../../src/executor/adapters/runtime.js";
import { loadExecutionConfig } from "../../src/executor/core/config.js";

describe("initializeExecutor", () => {
  it("测试入口可正常加载策略主模块", () => {
    expect(initializeExecutor).toBeTypeOf("function");
  });

  it("初始化阶段不会直接触发真实下单", () => {
    const placeOrder = vi.fn();
    const runtime = createRuntime();
    const executor = initializeExecutor({
      config: loadExecutionConfig(),
      runtime,
      adapters: {
        orderRouter: {
          placeOrder,
        },
      },
    });

    expect(executor.isStarted()).toBe(false);
    expect(placeOrder).not.toHaveBeenCalled();
  });
});
