import { createRenderScheduler } from "../../src/utils/performance.js";

describe("performance", () => {
  it("合并同一帧内的重复渲染请求", () => {
    let renderCount = 0;
    let queuedCallback = null;
    const schedule = createRenderScheduler(
      () => {
        renderCount += 1;
      },
      (callback) => {
        queuedCallback = callback;
      },
    );

    schedule();
    schedule();
    schedule();
    expect(renderCount).toBe(0);

    queuedCallback();
    expect(renderCount).toBe(1);

    schedule();
    queuedCallback();
    expect(renderCount).toBe(2);
  });

  it("交互中延迟渲染，交互结束后再执行", () => {
    let renderCount = 0;
    const queuedCallbacks = [];
    let isInteracting = true;
    const schedule = createRenderScheduler(
      () => {
        renderCount += 1;
      },
      (callback) => {
        queuedCallbacks.push(callback);
      },
      () => isInteracting,
    );

    schedule();
    expect(renderCount).toBe(0);
    expect(queuedCallbacks).toHaveLength(1);

    queuedCallbacks.shift()();
    expect(renderCount).toBe(0);
    expect(queuedCallbacks).toHaveLength(1);

    isInteracting = false;
    queuedCallbacks.shift()();
    expect(renderCount).toBe(1);
  });
});
