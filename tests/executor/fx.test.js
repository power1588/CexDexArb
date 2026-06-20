import { describe, expect, it } from "vitest";
import {
  computeFxUsdcUsdtMid,
  convertHyperliquidPriceToUsdt,
  ensureFreshFxQuote,
} from "../../src/executor/core/fx.js";

describe("executor fx", () => {
  it("fx_usdcusdt_mid 使用 Binance 现货中间价计算正确", () => {
    expect(computeFxUsdcUsdtMid(0.999, 1.001)).toBeCloseTo(1, 8);
  });

  it("Hyperliquid 价格折算到 USDT 结果正确", () => {
    expect(convertHyperliquidPriceToUsdt(100, 0.9995)).toBeCloseTo(99.95, 8);
  });

  it("汇率缺失或过期时拒绝生成执行计划", () => {
    expect(
      ensureFreshFxQuote({
        fxUsdcUsdtMid: null,
        timestamp: 1_000,
        maxAgeMs: 100,
        now: 1_050,
      }),
    ).toMatchObject({
      executable: false,
      reason: "missing_fx_rate",
    });

    expect(
      ensureFreshFxQuote({
        fxUsdcUsdtMid: 1,
        timestamp: 1_000,
        maxAgeMs: 100,
        now: 1_200,
      }),
    ).toMatchObject({
      executable: false,
      reason: "stale_fx_rate",
    });
  });
});
