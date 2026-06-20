import { describe, expect, it } from "vitest";
import {
  areCommonPerpMarketsCompatible,
  buildCommonPerpSymbols,
  createStaticCommonPerpSnapshot,
  normalizePerpSymbol,
  parseBinancePerpMarket,
  parseHyperliquidPerpMarket,
} from "../../src/core/symbols.js";

describe("symbols", () => {
  it("标准化 Binance 与 Hyperliquid symbol", () => {
    expect(normalizePerpSymbol("BTCUSDT")).toBe("BTC");
    expect(normalizePerpSymbol("ETHUSDT")).toBe("ETH");
    expect(normalizePerpSymbol("BTC")).toBe("BTC");
    expect(normalizePerpSymbol("xbtusdt")).toBe("BTC");
    expect(normalizePerpSymbol("xyz:NVDA")).toBe("NVDA");
    expect(normalizePerpSymbol("vntl:OPENAI")).toBe("OPENAI");
    expect(normalizePerpSymbol("SPCX-USDC")).toBe("SPCX");
  });

  it("解析 Binance 永续市场结构", () => {
    const market = parseBinancePerpMarket({
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      contractType: "PERPETUAL",
      status: "TRADING",
    });

    expect(market).toMatchObject({
      exchange: "binance",
      symbol: "BTC",
      rawSymbol: "BTCUSDT",
      contractType: "perpetual",
    });
  });

  it("解析 Hyperliquid 永续市场结构", () => {
    const market = parseHyperliquidPerpMarket({ name: "ETH" });

    expect(market).toMatchObject({
      exchange: "hyperliquid",
      symbol: "ETH",
      rawSymbol: "ETH",
      contractType: "perpetual",
    });
  });

  it("解析 HL builder 前缀与 Pre-IPO 市场结构", () => {
    const market = parseHyperliquidPerpMarket({
      name: "vntl:OPENAI",
      builder: "vntl",
      marketCategory: "pre-ipo",
    });

    expect(market).toMatchObject({
      exchange: "hyperliquid",
      symbol: "OPENAI",
      rawSymbol: "vntl:OPENAI",
      builder: "vntl",
      marketCategory: "pre-ipo",
    });
  });

  it("求出两所共同交易对并稳定排序去重", () => {
    const common = buildCommonPerpSymbols(
      [
        parseBinancePerpMarket({
          symbol: "ETHUSDT",
          baseAsset: "ETH",
          quoteAsset: "USDT",
          contractType: "PERPETUAL",
          status: "TRADING",
        }),
        parseBinancePerpMarket({
          symbol: "BTCUSDT",
          baseAsset: "BTC",
          quoteAsset: "USDT",
          contractType: "PERPETUAL",
          status: "TRADING",
        }),
      ],
      [
        parseHyperliquidPerpMarket({ name: "BTC" }),
        parseHyperliquidPerpMarket({ name: "ETH" }),
        parseHyperliquidPerpMarket({ name: "ETH" }),
      ],
    );

    expect(common).toEqual([
      {
        symbol: "BTC",
        binanceSymbol: "BTCUSDT",
        hyperliquidSymbol: "BTC",
        marketCategory: "crypto",
        hyperliquidBuilder: null,
      },
      {
        symbol: "ETH",
        binanceSymbol: "ETHUSDT",
        hyperliquidSymbol: "ETH",
        marketCategory: "crypto",
        hyperliquidBuilder: null,
      },
    ]);
  });

  it("只匹配资产类别兼容的共同标的", () => {
    const common = buildCommonPerpSymbols(
      [
        parseBinancePerpMarket({
          symbol: "QNTUSDT",
          baseAsset: "QNT",
          quoteAsset: "USDT",
          contractType: "PERPETUAL",
          underlyingType: "COIN",
          underlyingSubType: ["Infrastructure"],
          status: "TRADING",
        }),
        parseBinancePerpMarket({
          symbol: "SPCXUSDT",
          baseAsset: "SPCX",
          quoteAsset: "USDT",
          contractType: "TRADIFI_PERPETUAL",
          underlyingType: "EQUITY",
          underlyingSubType: ["TradFi"],
          status: "TRADING",
        }),
      ],
      [
        parseHyperliquidPerpMarket({
          name: "xyz:QNT",
          builder: "xyz",
          marketCategory: "pre-ipo",
        }),
        parseHyperliquidPerpMarket({
          name: "xyz:SPCX",
          builder: "xyz",
          marketCategory: "pre-ipo",
        }),
      ],
    );

    expect(common.map((item) => item.symbol)).toEqual(["SPCX"]);
  });

  it("TradeFi 与 Pre-IPO 市场被视为兼容", () => {
    expect(
      areCommonPerpMarketsCompatible(
        {
          symbol: "OPENAI",
          marketCategory: "tradefi",
        },
        {
          symbol: "OPENAI",
          marketCategory: "pre-ipo",
        },
      ),
    ).toBe(true);
  });

  it("从静态 symbol 快照生成共同交易对状态", () => {
    const snapshot = createStaticCommonPerpSnapshot([
      { symbol: "BTC", exchange: "binance" },
      { symbol: "BTC", exchange: "hyperliquid" },
      { symbol: "ETH", exchange: "binance" },
    ]);

    expect(snapshot.commonPerpSymbols).toEqual([
      {
        symbol: "BTC",
        binanceSymbol: "BTCUSDT",
        hyperliquidSymbol: "BTC",
        marketCategory: "crypto",
        hyperliquidBuilder: null,
      },
    ]);
    expect(snapshot.symbolUniverseStatus.status).toBe("ready");
  });
});
