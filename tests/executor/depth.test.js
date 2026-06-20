import { describe, expect, it } from "vitest";
import {
  computeBookImbalance,
  computeDepthWithinBps,
  computeRefillRate,
  computeVwap,
  getBestAsk,
  getBestBid,
} from "../../src/executor/core/depth.js";

describe("executor depth", () => {
  const orderBook = {
    bids: [
      { price: 100, quantity: 2 },
      { price: 99.5, quantity: 3 },
    ],
    asks: [
      { price: 100.5, quantity: 1 },
      { price: 101, quantity: 4 },
    ],
  };

  it("best_bid / best_ask 读取正确", () => {
    expect(getBestBid(orderBook)).toEqual({ price: 100, quantity: 2 });
    expect(getBestAsk(orderBook)).toEqual({ price: 100.5, quantity: 1 });
  });

  it("vwap(q, side) 计算正确", () => {
    const result = computeVwap(orderBook.asks, 3);

    expect(result.executable).toBe(true);
    expect(result.averagePrice).toBeCloseTo((100.5 * 1 + 101 * 2) / 3, 8);
  });

  it("depth_within_bps 计算正确", () => {
    const result = computeDepthWithinBps({
      levels: orderBook.asks,
      referencePrice: 100.5,
      bps: 50,
      side: "buy",
    });

    expect(result.totalQuantity).toBeCloseTo(5, 8);
  });

  it("book_imbalance 与 refill_rate 计算正确或返回可解释缺省值", () => {
    expect(computeBookImbalance(orderBook)).toBeCloseTo(0, 8);
    expect(
      computeRefillRate([
        { timestamp: 0, availableQuantity: 2 },
        { timestamp: 2_000, availableQuantity: 5 },
      ]),
    ).toBeCloseTo(1.5, 8);
    expect(computeRefillRate([{ timestamp: 0, availableQuantity: 2 }])).toBeNull();
  });
});
