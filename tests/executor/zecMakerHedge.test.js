import { describe, expect, it } from "vitest";
import {
  getHedgeSide,
  parseOpenZecArgs,
  resolveHyperliquidCredentials,
  resolveHyperliquidAccountAddress,
  selectBinanceMakerPrice,
  selectHyperliquidTakerPrice,
  summarizeOpenPlan,
} from "../../src/executor/live/zecMakerHedge.js";

describe("zec maker hedge helpers", () => {
  it("会根据 Binance 方向生成相反的 Hyperliquid 对冲方向", () => {
    expect(getHedgeSide("buy")).toBe("sell");
    expect(getHedgeSide("sell")).toBe("buy");
  });

  it("支持解析开仓脚本参数", () => {
    expect(
      parseOpenZecArgs([
        "--amount",
        "0.25",
        "--binance-side",
        "sell",
        "--binance-price",
        "470.12",
        "--slippage-bps",
        "12",
        "--execute",
      ]),
    ).toMatchObject({
      amount: 0.25,
      binanceSide: "sell",
      binancePrice: 470.12,
      slippageBps: 12,
      execute: true,
    });
  });

  it("会兼容解析 Hyperliquid 私钥和地址字段", () => {
    expect(
      resolveHyperliquidCredentials({
        HYPERLIQUID_API_KEY: "legacy-private-key",
        HYPERLIQUID_ACCOUNT_ADDRESS: "0xabc",
      }),
    ).toEqual({
      privateKey: "legacy-private-key",
      walletAddress: "0xabc",
    });
    expect(
      resolveHyperliquidCredentials({
        HYPERLIQUID_PRIVATE_KEY: "new-private-key",
        HYPERLIQUID_WALLET_ADDRESS: "0xdef",
      }),
    ).toEqual({
      privateKey: "new-private-key",
      walletAddress: "0xdef",
    });
    expect(
      resolveHyperliquidCredentials({
        HYPERLIQUID_API_SECRET: "secret-style-private-key",
        HYPERLIQUID_ACCOUNT_ADDRESS: "0x123",
      }),
    ).toEqual({
      privateKey: "secret-style-private-key",
      walletAddress: "0x123",
    });
  });

  it("会在地址为 agent 时解析出真实账户地址", () => {
    expect(
      resolveHyperliquidAccountAddress({
        configuredAddress: "0xagent",
        userRoleResponse: {
          role: "agent",
          data: {
            user: "0xowner",
          },
        },
      }),
    ).toBe("0xowner");
    expect(
      resolveHyperliquidAccountAddress({
        configuredAddress: "0xowner",
        userRoleResponse: {
          role: "user",
        },
      }),
    ).toBe("0xowner");
  });

  it("会选择 Binance maker 价格和 Hyperliquid taker 价格", () => {
    const makerBuyPrice = selectBinanceMakerPrice({
      side: "buy",
      orderBook: {
        bids: [[470.11, 1]],
        asks: [[470.15, 1]],
      },
    });
    const makerSellPrice = selectBinanceMakerPrice({
      side: "sell",
      orderBook: {
        bids: [[470.11, 1]],
        asks: [[470.15, 1]],
      },
    });
    const takerSellPrice = selectHyperliquidTakerPrice({
      side: "sell",
      orderBook: {
        bids: [[475.4, 10]],
        asks: [[475.45, 10]],
      },
      slippageBps: 10,
      roundPrice(value) {
        return Number(value.toFixed(4));
      },
    });

    expect(makerBuyPrice).toBe(470.11);
    expect(makerSellPrice).toBe(470.15);
    expect(takerSellPrice).toBeCloseTo(474.9246, 6);
  });

  it("会输出开仓计划摘要", () => {
    expect(
      summarizeOpenPlan({
        options: {
          binanceSymbol: "ZEC/USDC",
          hyperliquidSymbol: "ZEC/USDC:USDC",
          binanceSide: "buy",
          amount: 0.1,
          leverage: 2,
          slippageBps: 8,
          execute: false,
        },
        makerPrice: 470.1,
        hedgeSide: "sell",
        hedgePrice: 475.2,
        filledAmount: 0.1,
      }),
    ).toMatchObject({
      strategy: "binance_maker_then_hyperliquid_taker",
      hyperliquidSide: "sell",
      filledAmount: 0.1,
    });
  });
});
