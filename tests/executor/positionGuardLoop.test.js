import { describe, expect, it, vi } from "vitest";
import { ManualClock } from "../../src/executor/adapters/runtime.js";
import { createPositionGuardLoop } from "../../src/executor/services/positionGuardLoop.js";

function makeBooks(buyAsk, sellBid) {
  return {
    buyBook: { exchange: "binance", bestAsk: { price: buyAsk }, quoteCurrency: "USDT" },
    sellBook: { exchange: "hyperliquid", bestBid: { price: sellBid }, quoteCurrency: "USDC" },
  };
}

describe("PositionGuardLoop", () => {
  it("可按固定间隔轮询双腿行情并输出价差快照与退出建议", async () => {
    const clock = new ManualClock(1000);
    const snapshots = [
      makeBooks(100, 101), // ~99 bps
      makeBooks(100, 100.03), // ~3 bps < 5 -> ready
    ];

    const loop = createPositionGuardLoop({
      clock,
      pollIntervalMs: 100,
      maxHoldingDurationMs: 60_000,
      closeThresholdBps: 5,
      getMarketSnapshot: async () => snapshots.shift(),
      onSnapshot: vi.fn(),
    });

    const result = await loop.run({
      cycleId: "c-1",
      openDirection: "buy_binance_sell_hyperliquid",
      fxUsdcUsdtMid: 1.0,
    });

    expect(result.exitReason).toBe("target_exit");
    expect(result.snapshots.length).toBe(2);
    expect(result.snapshots[1].readyToClose).toBe(true);
  });

  it("超时后自动触发时间退出", async () => {
    const clock = new ManualClock(0);
    const loop = createPositionGuardLoop({
      clock,
      pollIntervalMs: 100,
      maxHoldingDurationMs: 250,
      closeThresholdBps: 5,
      getMarketSnapshot: async () => {
        clock.advance(100);
        return makeBooks(100, 101); // 永远不收敛
      },
    });

    const result = await loop.run({
      cycleId: "c-2",
      openDirection: "buy_binance_sell_hyperliquid",
      fxUsdcUsdtMid: 1.0,
    });

    expect(result.exitReason).toBe("time_exit");
    expect(result.snapshots.length).toBeGreaterThan(0);
  });

  it("模拟连接中断时触发风险退出", async () => {
    const clock = new ManualClock(0);
    const loop = createPositionGuardLoop({
      clock,
      pollIntervalMs: 100,
      maxHoldingDurationMs: 60_000,
      closeThresholdBps: 5,
      getMarketSnapshot: async () => {
        throw new Error("connection lost");
      },
    });

    const result = await loop.run({
      cycleId: "c-3",
      openDirection: "buy_binance_sell_hyperliquid",
      fxUsdcUsdtMid: 1.0,
    });

    expect(result.exitReason).toBe("risk_exit");
    expect(result.error?.message).toBe("connection lost");
  });

  it("快照为空时视为数据缺失并触发风险退出", async () => {
    const clock = new ManualClock(0);
    const loop = createPositionGuardLoop({
      clock,
      pollIntervalMs: 100,
      maxHoldingDurationMs: 60_000,
      closeThresholdBps: 5,
      getMarketSnapshot: async () => null,
    });

    const result = await loop.run({
      cycleId: "c-4",
      openDirection: "buy_binance_sell_hyperliquid",
      fxUsdcUsdtMid: 1.0,
    });

    expect(result.exitReason).toBe("risk_exit");
  });
});
