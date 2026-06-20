import { describe, expect, it } from "vitest";
import { createRedisOpportunityConsumer } from "../../src/executor/adapters/redisOpportunityConsumer.js";
import { ManualClock, createStructuredLogger } from "../../src/executor/adapters/runtime.js";

describe("redis opportunity consumer", () => {
  it("能正确消费有效信号", () => {
    const logger = createStructuredLogger();
    const consumer = createRedisOpportunityConsumer({
      logger,
      clock: new ManualClock(1_000),
    });

    const result = consumer.consume(
      JSON.stringify({
        signalId: "sig-1",
        symbol: "BTC",
        buyExchange: "binance",
        sellExchange: "hyperliquid",
        observedSpreadBps: 12,
        observedAt: 1_000,
      }),
    );

    expect(result.accepted).toBe(true);
    expect(result.signal.signalId).toBe("sig-1");
  });

  it("无效 JSON、缺字段消息会被丢弃并记录日志", () => {
    const logger = createStructuredLogger();
    const consumer = createRedisOpportunityConsumer({
      logger,
      clock: new ManualClock(1_000),
    });

    expect(consumer.consume("{bad-json")).toMatchObject({
      accepted: false,
      reason: "invalid_json",
    });
    expect(
      consumer.consume(
        JSON.stringify({
          symbol: "BTC",
        }),
      ),
    ).toMatchObject({
      accepted: false,
      reason: "invalid_schema",
    });
  });

  it("重复信号不会导致重复执行", () => {
    const clock = new ManualClock(1_000);
    const consumer = createRedisOpportunityConsumer({
      logger: createStructuredLogger(),
      clock,
    });
    const rawSignal = JSON.stringify({
      signalId: "sig-1",
      symbol: "BTC",
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      observedSpreadBps: 12,
      observedAt: 1_000,
    });

    expect(consumer.consume(rawSignal).accepted).toBe(true);
    expect(consumer.consume(rawSignal)).toMatchObject({
      accepted: false,
      reason: "duplicate_signal",
    });
  });
});
