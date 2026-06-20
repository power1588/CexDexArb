import { describe, expect, it } from "vitest";
import {
  ManualClock,
  createInMemoryEventBus,
  createStructuredLogger,
} from "../../src/executor/adapters/runtime.js";

describe("executor runtime adapters", () => {
  it("模拟时钟可控制超时逻辑", () => {
    const clock = new ManualClock(1_000);

    expect(clock.now()).toBe(1_000);
    clock.advance(250);
    expect(clock.now()).toBe(1_250);
    clock.set(5_000);
    expect(clock.now()).toBe(5_000);
  });

  it("日志事件结构统一", () => {
    const entries = [];
    const logger = createStructuredLogger({
      sink(entry) {
        entries.push(entry);
      },
    });

    logger.info("signal_received", {
      symbol: "BTC",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "info",
      message: "signal_received",
      context: {
        symbol: "BTC",
      },
    });
  });

  it("风险事件可被发布和订阅", () => {
    const bus = createInMemoryEventBus();
    const received = [];

    const unsubscribe = bus.subscribe("risk_event", (event) => {
      received.push(event);
    });

    const published = bus.publish("risk_event", {
      type: "hedge_failed",
    });

    unsubscribe();
    expect(published.type).toBe("risk_event");
    expect(received).toHaveLength(1);
    expect(received[0].payload.type).toBe("hedge_failed");
  });
});
