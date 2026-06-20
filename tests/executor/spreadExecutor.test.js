import { describe, expect, it } from "vitest";
import { createRuntime } from "../../src/executor/adapters/runtime.js";
import { loadExecutionConfig } from "../../src/executor/core/config.js";
import { createSpreadExecutor } from "../../src/executor/orchestrators/spreadExecutor.js";

function createOrderRouter(results) {
  let index = 0;
  return {
    async placeOrder(intent) {
      const next = results[index];
      index += 1;

      if (next instanceof Error) {
        throw next;
      }

      return {
        exchange: intent.exchange,
        status: next.status,
        filledQuantity: next.filledQuantity,
      };
    },
  };
}

describe("spread executor", () => {
  const config = loadExecutionConfig();

  it("maker/taker 路径可成功完成双腿建仓", async () => {
    const executor = createSpreadExecutor({
      config,
      runtime: createRuntime(),
      orderRouter: createOrderRouter([
        { status: "filled", filledQuantity: 0.1 },
        { status: "filled", filledQuantity: 0.1 },
      ]),
    });

    const result = await executor.executePlan({
      mode: "maker_taker",
      legs: [
        {
          exchange: "binance",
          side: "buy",
          orderType: "limit",
        },
        {
          exchange: "hyperliquid",
          side: "sell",
          orderType: "ioc",
        },
      ],
    });

    expect(result).toMatchObject({
      success: true,
      state: "HEDGED",
    });
  });

  it("taker/taker 路径可成功完成双腿建仓", async () => {
    const executor = createSpreadExecutor({
      config,
      runtime: createRuntime(),
      orderRouter: createOrderRouter([
        { status: "filled", filledQuantity: 0.1 },
        { status: "filled", filledQuantity: 0.1 },
      ]),
    });

    const result = await executor.executePlan({
      mode: "taker_taker",
      legs: [
        {
          exchange: "binance",
          side: "buy",
          orderType: "ioc",
        },
        {
          exchange: "hyperliquid",
          side: "sell",
          orderType: "ioc",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.state).toBe("HEDGED");
  });

  it("任一关键步骤失败时会进入正确异常分支", async () => {
    const executor = createSpreadExecutor({
      config,
      runtime: createRuntime(),
      orderRouter: createOrderRouter([
        { status: "filled", filledQuantity: 0.1 },
        new Error("hedge failure"),
      ]),
    });

    const result = await executor.executePlan({
      mode: "maker_taker",
      legs: [
        {
          exchange: "binance",
          side: "buy",
          orderType: "limit",
        },
        {
          exchange: "hyperliquid",
          side: "sell",
          orderType: "ioc",
        },
      ],
    });

    expect(result).toMatchObject({
      success: false,
      state: "FLAT",
    });
  });

  it("对冲腿第一次 IOC 未完全成交时会补单并进入 HEDGED", async () => {
    const executor = createSpreadExecutor({
      config,
      runtime: createRuntime(),
      orderRouter: createOrderRouter([
        { status: "filled", filledQuantity: 0.1 },
        { status: "partial", filledQuantity: 0.05 },
        { status: "filled", filledQuantity: 0.05 },
      ]),
    });

    const result = await executor.executePlan({
      mode: "maker_taker",
      legs: [
        {
          exchange: "binance",
          side: "buy",
          orderType: "limit",
        },
        {
          exchange: "hyperliquid",
          side: "sell",
          orderType: "ioc",
          quantity: 0.1,
        },
      ],
    });

    expect(result).toMatchObject({
      success: true,
      state: "HEDGED",
    });
    expect(result.executionEvents.some((event) => event.type === "leg2_retry_submitted")).toBe(true);
  });

  it("对冲补单达到目标量时会容忍浮点精度误差", async () => {
    const executor = createSpreadExecutor({
      config,
      runtime: createRuntime(),
      orderRouter: createOrderRouter([
        { status: "filled", filledQuantity: 0.019999 },
        { status: "partial", filledQuantity: 0.01 },
        { status: "filled", filledQuantity: 0.009999 },
      ]),
    });

    const result = await executor.executePlan({
      mode: "maker_taker",
      legs: [
        {
          exchange: "binance",
          side: "buy",
          orderType: "limit",
          quantity: 0.0199990000499975,
        },
        {
          exchange: "hyperliquid",
          side: "sell",
          orderType: "ioc",
          quantity: 0.0199990000499975,
        },
      ],
    });

    expect(result).toMatchObject({
      success: true,
      state: "HEDGED",
    });
  });
});
