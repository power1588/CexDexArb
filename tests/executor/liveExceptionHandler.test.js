import { describe, expect, it } from "vitest";
import {
  createLiveExceptionHandler,
  handleMakerPartialFillTimeout,
  handleTakerHedgeFailure,
  isRateLimitError,
  retryWithBackoff,
} from "../../src/executor/services/liveExceptionHandler.js";

describe("liveExceptionHandler", () => {
  it("isRateLimitError 识别限频错误", () => {
    expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRateLimitError(new Error("Too Many Requests"))).toBe(true);
    expect(isRateLimitError({ message: "429 Too Many", code: -1003 })).toBe(true);
    expect(isRateLimitError(new Error("insufficient balance"))).toBe(false);
  });

  it("retryWithBackoff 在成功时立即返回", async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls += 1;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retryWithBackoff 重试后成功", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("transient");
        return "ok";
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("retryWithBackoff 超过最大重试次数后抛出", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new Error("permanent");
        },
        { maxRetries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("permanent");
    expect(calls).toBe(3);
  });

  it("handleMakerPartialFillTimeout 返回实际成交量", async () => {
    const fakeExchange = {
      async cancelOrder() {},
      async fetchOrder() {
        return { filled: 150, status: "canceled" };
      },
    };
    const result = await handleMakerPartialFillTimeout({
      exchange: fakeExchange,
      symbol: "BIO/USDC:USDC",
      orderId: "123",
    });
    expect(result.filledQuantity).toBe(150);
    expect(result.cancelled).toBe(true);
    expect(result.shouldHedge).toBe(true);
  });

  it("handleMakerPartialFillTimeout 无成交量时不需对冲", async () => {
    const fakeExchange = {
      async cancelOrder() {},
      async fetchOrder() {
        return { filled: 0, status: "canceled" };
      },
    };
    const result = await handleMakerPartialFillTimeout({
      exchange: fakeExchange,
      symbol: "BIO/USDC:USDC",
      orderId: "123",
    });
    expect(result.shouldHedge).toBe(false);
  });

  it("handleTakerHedgeFailure 市价止损", async () => {
    let createdOrder = null;
    const fakeExchange = {
      async createOrder(symbol, type, side, quantity, price, params) {
        createdOrder = { symbol, type, side, quantity, params };
        return {
          id: "stop-1",
          status: "closed",
          average: 0.0295,
          side,
        };
      },
    };
    const result = await handleTakerHedgeFailure({
      exchange: fakeExchange,
      symbol: "BIO/USDC:USDC",
      exposedQuantity: 100,
      makerSide: "buy",
    });
    expect(result.stopped).toBe(true);
    expect(result.side).toBe("sell");
    expect(createdOrder.params.reduceOnly).toBe(true);
  });

  it("handleTakerHedgeFailure 无裸露时不操作", async () => {
    const result = await handleTakerHedgeFailure({
      exchange: {},
      symbol: "BIO/USDC:USDC",
      exposedQuantity: 0,
      makerSide: "buy",
    });
    expect(result.stopped).toBe(false);
  });
});

describe("liveExceptionHandler coordinator", () => {
  it("pause/resume 控制暂停状态", () => {
    const handler = createLiveExceptionHandler({});
    expect(handler.isPaused()).toBe(false);
    handler.pause("websocket 断连");
    expect(handler.isPaused()).toBe(true);
    handler.resume();
    expect(handler.isPaused()).toBe(false);
  });

  it("连续 3 次 API 失败触发暂停", () => {
    const events = [];
    const handler = createLiveExceptionHandler({
      riskEventReporter: {
        record(e) {
          events.push(e);
        },
      },
    });

    let result;
    result = handler.recordApiFailure({ action: "fetchOrder", error: new Error("timeout") });
    expect(result.shouldAbort).toBe(false);
    expect(handler.isPaused()).toBe(false);

    result = handler.recordApiFailure({ action: "fetchOrder", error: new Error("timeout") });
    expect(result.shouldAbort).toBe(false);

    result = handler.recordApiFailure({ action: "fetchOrder", error: new Error("timeout") });
    expect(result.shouldAbort).toBe(true);
    expect(handler.isPaused()).toBe(true);
  });

  it("recordApiSuccess 重置计数", () => {
    const handler = createLiveExceptionHandler({});
    handler.recordApiFailure({ action: "test", error: new Error("err") });
    handler.recordApiFailure({ action: "test", error: new Error("err") });
    expect(handler.getConsecutiveApiFailures()).toBe(2);
    handler.recordApiSuccess();
    expect(handler.getConsecutiveApiFailures()).toBe(0);
  });

  it("handleExecutionError 执行回滚并记录", async () => {
    const events = [];
    const handler = createLiveExceptionHandler({
      riskEventReporter: {
        record(e) {
          events.push(e);
        },
      },
    });

    const result = await handler.handleExecutionError({
      error: new Error("taker failed"),
      phase: "open_taker",
      context: { symbol: "BIO" },
      rollbackAction: async () => ({ stopped: true }),
    });

    expect(result.handled).toBe(true);
    expect(result.rolled).toBe(true);
    expect(events.find((e) => e.type === "execution_error")).toBeTruthy();
    expect(events.find((e) => e.type === "rollback_completed")).toBeTruthy();
  });

  it("handleExecutionError 回滚失败时记录 rollback_failed", async () => {
    const events = [];
    const handler = createLiveExceptionHandler({
      riskEventReporter: {
        record(e) {
          events.push(e);
        },
      },
    });

    const result = await handler.handleExecutionError({
      error: new Error("taker failed"),
      phase: "open_taker",
      rollbackAction: async () => {
        throw new Error("market closed");
      },
    });

    expect(result.rolled).toBe(false);
    expect(events.find((e) => e.type === "rollback_failed")).toBeTruthy();
  });
});
