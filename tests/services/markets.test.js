import { describe, expect, it } from "vitest";
import {
  createMarketUniverseService,
  discoverBinancePerpMarkets,
  discoverHyperliquidEcosystemMarkets,
  discoverHyperliquidPerpMarkets,
  loadCommonPerpUniverse,
} from "../../src/services/markets.js";

function createJsonResponse(payload) {
  return {
    async json() {
      return payload;
    },
  };
}

describe("markets service", () => {
  it("发现 Binance 永续市场并标准化", async () => {
    const fetchImpl = async () =>
      createJsonResponse({
        symbols: [
          {
            symbol: "BTCUSDT",
            baseAsset: "BTC",
            quoteAsset: "USDT",
            contractType: "PERPETUAL",
            status: "TRADING",
          },
          {
            symbol: "BTCUSD_250627",
            contractType: "CURRENT_QUARTER",
          },
        ],
      });

    const result = await discoverBinancePerpMarkets({
      fetchImpl,
      now: () => 100,
    });

    expect(result.status).toBe("ready");
    expect(result.markets).toHaveLength(1);
    expect(result.markets[0].symbol).toBe("BTC");
  });

  it("发现 Hyperliquid 永续市场并标准化", async () => {
    const fetchImpl = async () =>
      createJsonResponse({
        universe: [{ name: "BTC" }, { name: "ETH" }],
      });

    const result = await discoverHyperliquidPerpMarkets({
      fetchImpl,
      now: () => 200,
    });

    expect(result.status).toBe("ready");
    expect(result.markets.map((item) => item.symbol)).toEqual(
      expect.arrayContaining(["BTC", "ETH", "NVDA", "SPCX", "OPENAI", "ANTHROPIC"]),
    );
    expect(result.sources).toMatchObject({
      native: 2,
    });
  });

  it("发现 Hyperliquid 生态 builder 市场目录", () => {
    const result = discoverHyperliquidEcosystemMarkets({
      now: () => 150,
    });

    expect(result.status).toBe("ready");
    expect(result.markets.map((item) => item.symbol)).toEqual(
      expect.arrayContaining(["SPCX", "NVDA", "OPENAI", "ANTHROPIC"]),
    );
  });

  it("共同交易对刷新成功时更新交集和版本号", async () => {
    let requestCount = 0;
    const fetchImpl = async (url) => {
      requestCount += 1;

      if (url.includes("binance")) {
        return createJsonResponse({
          symbols: [
            {
              symbol: "BTCUSDT",
              baseAsset: "BTC",
              quoteAsset: "USDT",
              contractType: "PERPETUAL",
              status: "TRADING",
            },
            {
              symbol: "ETHUSDT",
              baseAsset: "ETH",
              quoteAsset: "USDT",
              contractType: "PERPETUAL",
              status: "TRADING",
            },
            {
              symbol: "NVDAUSDT",
              baseAsset: "NVDA",
              quoteAsset: "USDT",
              contractType: "TRADIFI_PERPETUAL",
              underlyingType: "EQUITY",
              underlyingSubType: ["TradFi"],
              status: "TRADING",
            },
            {
              symbol: "SPCXUSDT",
              baseAsset: "SPCX",
              quoteAsset: "USDT",
              contractType: "TRADIFI_PERPETUAL",
              underlyingType: "EQUITY",
              underlyingSubType: ["TradFi"],
              status: "TRADING",
            },
            {
              symbol: "OPENAIUSDT",
              baseAsset: "OPENAI",
              quoteAsset: "USDT",
              contractType: "TRADIFI_PERPETUAL",
              underlyingType: "EQUITY",
              underlyingSubType: ["TradFi"],
              status: "TRADING",
            },
            {
              symbol: "ANTHROPICUSDT",
              baseAsset: "ANTHROPIC",
              quoteAsset: "USDT",
              contractType: "TRADIFI_PERPETUAL",
              underlyingType: "EQUITY",
              underlyingSubType: ["TradFi"],
              status: "TRADING",
            },
            {
              symbol: "QNTUSDT",
              baseAsset: "QNT",
              quoteAsset: "USDT",
              contractType: "PERPETUAL",
              underlyingType: "COIN",
              underlyingSubType: ["Infrastructure"],
              status: "TRADING",
            },
          ],
        });
      }

      return createJsonResponse({
        universe: [{ name: "ETH" }, { name: "BTC" }, { name: "SOL" }],
      });
    };

    const snapshot = await loadCommonPerpUniverse({
      fetchImpl,
      now: () => 300,
    });

    expect(requestCount).toBe(2);
    expect(snapshot.commonPerpSymbols.map((item) => item.symbol)).toEqual([
      "ANTHROPIC",
      "BTC",
      "ETH",
      "NVDA",
      "OPENAI",
      "SPCX",
    ]);
    expect(snapshot.symbolUniverseStatus.version).toBe(1);
  });

  it("刷新失败时保留上一版交集", async () => {
    const snapshot = await loadCommonPerpUniverse({
      fetchImpl: async () => {
        throw new Error("network down");
      },
      previousSnapshot: {
        commonPerpSymbols: [{ symbol: "BTC" }],
        symbolUniverseStatus: {
          version: 4,
          lastUpdatedAt: 99,
        },
      },
    });

    expect(snapshot.commonPerpSymbols).toEqual([{ symbol: "BTC" }]);
    expect(snapshot.symbolUniverseStatus.status).toBe("degraded");
    expect(snapshot.symbolUniverseStatus.version).toBe(4);
  });

  it("市场服务可缓存并刷新最新快照", async () => {
    const service = createMarketUniverseService({
      fetchImpl: async (url) =>
        url.includes("binance")
          ? createJsonResponse({
              symbols: [
                {
                  symbol: "BTCUSDT",
                  baseAsset: "BTC",
                  quoteAsset: "USDT",
                  contractType: "PERPETUAL",
                  status: "TRADING",
                },
              ],
            })
          : createJsonResponse({
              universe: [{ name: "BTC" }],
            }),
      now: () => 500,
    });

    const snapshot = await service.refresh();

    expect(service.getSnapshot()).toBe(snapshot);
    expect(snapshot.commonPerpSymbols).toEqual([
      {
        symbol: "BTC",
        binanceSymbol: "BTCUSDT",
        hyperliquidSymbol: "BTC",
        marketCategory: "crypto",
        hyperliquidBuilder: null,
      },
    ]);
  });
});
