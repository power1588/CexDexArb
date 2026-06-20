import { describe, expect, it } from "vitest";
import {
  buildConfirmationPhrase,
  computeMinimumExecutableAmount,
  parseHyperliquidLiveOrderArgs,
} from "../../src/executor/live/hyperliquidLiveOrder.js";

describe("hyperliquid live order helpers", () => {
  it("支持解析 HL 实盘下单参数", () => {
    expect(
      parseHyperliquidLiveOrderArgs([
        "--price",
        "450",
        "--amount",
        "0.03",
        "--leverage",
        "2",
        "--execute",
      ]),
    ).toMatchObject({
      symbol: "ZEC/USDC:USDC",
      side: "buy",
      price: 450,
      amount: 0.03,
      leverage: 2,
      execute: true,
    });
  });

  it("会根据最小数量和最小名义金额计算最小可下单量", () => {
    expect(
      computeMinimumExecutableAmount({
        price: 450,
        minAmount: 0.01,
        minCost: 10,
        amountPrecision: 2,
      }),
    ).toBe(0.03);
    expect(
      computeMinimumExecutableAmount({
        price: 450,
        minAmount: null,
        minCost: 10,
        amountPrecision: 0.01,
      }),
    ).toBe(0.03);
  });

  it("会生成人工确认口令", () => {
    expect(
      buildConfirmationPhrase({
        side: "buy",
        symbol: "ZEC/USDC:USDC",
        price: 450,
        amount: 0.03,
      }),
    ).toBe("CONFIRM BUY ZECUSDCUSDC 450 0.03");
  });
});
