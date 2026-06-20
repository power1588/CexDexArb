import { describe, expect, it, vi } from "vitest";
import { ManualClock, createInMemoryEventBus, createStructuredLogger } from "../../src/executor/adapters/runtime.js";
import { createRiskEventReporter } from "../../src/executor/services/riskEventReporter.js";

describe("risk event reporter", () => {
  it("orphan_leg_incident 会被记录", () => {
    const eventBus = createInMemoryEventBus();
    const reporter = createRiskEventReporter({
      clock: new ManualClock(1_000),
      eventBus,
      logger: createStructuredLogger(),
    });

    const event = reporter.record({
      type: "orphan_leg_incident",
      severity: "high",
      symbol: "BTC",
      planId: "plan-1",
      message: "orphan detected",
    });

    expect(event.type).toBe("orphan_leg_incident");
    expect(eventBus.getPublishedEvents()).toHaveLength(1);
  });

  it("connection_lost 会触发高优先级告警", () => {
    const notifier = {
      notify: vi.fn(),
    };
    const reporter = createRiskEventReporter({
      clock: new ManualClock(1_000),
      eventBus: createInMemoryEventBus(),
      logger: createStructuredLogger(),
      notifier,
    });

    reporter.record({
      type: "connection_lost",
      severity: "high",
      symbol: "BTC",
      planId: "plan-1",
      message: "lost",
    });

    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: "high",
      }),
    );
  });

  it("max_unhedged_ms 超时会记录严重事件", () => {
    const reporter = createRiskEventReporter({
      clock: new ManualClock(1_000),
      eventBus: createInMemoryEventBus(),
      logger: createStructuredLogger(),
    });

    const event = reporter.record({
      type: "max_unhedged_ms",
      severity: "critical",
      symbol: "BTC",
      planId: "plan-1",
      message: "timeout",
      context: {
        maxUnhedgedMs: 1_500,
      },
    });

    expect(event.severity).toBe("critical");
    expect(event.context.maxUnhedgedMs).toBe(1_500);
  });
});
