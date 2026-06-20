import { describe, expect, it } from "vitest";
import {
  EXECUTION_MODES,
  evaluateAllExecutionModes,
  evaluateExecutionMode,
} from "../../src/executor/core/edge.js";

const feeBpsByExchange = {
  binance: {
    maker: 1.5,
    taker: 5,
  },
  hyperliquid: {
    maker: 1.5,
    taker: 4.5,
  },
};

describe("executor edge", () => {
  it("四种模式在固定输入下输出符合文档公式", () => {
    const results = evaluateAllExecutionModes({
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      buyPrice: 100,
      sellPrice: 101,
      quantity: 1,
      feeBpsByExchange,
      makerBufferBps: 1,
      dualMakerBufferBps: 2,
    });

    expect(results).toHaveLength(4);
    expect(results.find((item) => item.mode === EXECUTION_MODES.TAKER_TAKER).expectedNetEdgeBps).toBeCloseTo(
      ((101 * (1 - 0.00045)) / (100 * (1 + 0.0005)) - 1) * 10_000,
      8,
    );
    expect(results.find((item) => item.mode === EXECUTION_MODES.MAKER_TAKER).expectedNetEdgeBps).toBeCloseTo(
      ((101 * (1 - 0.00045)) / (100 * (1 + 0.00015)) - 1) * 10_000 - 1,
      8,
    );
  });

  it("maker 模式会扣除 maker_buffer 或 dual_maker_buffer", () => {
    const makerTaker = evaluateExecutionMode({
      mode: EXECUTION_MODES.MAKER_TAKER,
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      buyPrice: 100,
      sellPrice: 101,
      feeBpsByExchange,
      makerBufferBps: 1.2,
      dualMakerBufferBps: 2.4,
    });
    const makerMaker = evaluateExecutionMode({
      mode: EXECUTION_MODES.MAKER_MAKER,
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      buyPrice: 100,
      sellPrice: 101,
      feeBpsByExchange,
      makerBufferBps: 1.2,
      dualMakerBufferBps: 2.4,
    });

    expect(makerTaker.notes).toContain("buffer_applied:1.2");
    expect(makerMaker.notes).toContain("buffer_applied:2.4");
  });

  it("输入缺失时返回不可执行结果而不是默认 0", () => {
    expect(
      evaluateExecutionMode({
        mode: EXECUTION_MODES.TAKER_TAKER,
        buyExchange: "binance",
        sellExchange: "hyperliquid",
        buyPrice: null,
        sellPrice: 101,
        feeBpsByExchange,
      }),
    ).toMatchObject({
      executable: false,
      reason: "missing_prices",
    });
  });
});
