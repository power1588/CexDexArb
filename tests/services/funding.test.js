import { describe, expect, it } from "vitest";
import {
  discoverBinanceFundingSnapshots,
  discoverHyperliquidFundingSnapshots,
  loadFundingMonitorSnapshot,
  normalizeBinanceFundingSnapshot,
  normalizeHyperliquidFundingSnapshot,
} from "../../src/services/funding.js";

function createJsonResponse(payload) {
  return {
    async json() {
      return payload;
    },
  };
}

describe("funding service", () => {
  it("标准化 Binance funding 快照", () => {
    const snapshot = normalizeBinanceFundingSnapshot({
      symbol: "SPCXUSDT",
      markPrice: "181.07832183",
      indexPrice: "180.94392042",
      estimatedSettlePrice: "180.87105477",
      lastFundingRate: "0.00015263",
      nextFundingTime: 1781971200000,
    });

    expect(snapshot).toMatchObject({
      symbol: "SPCX",
      exchange: "binance",
      fundingRate: 0.00015263,
      fundingIntervalHours: 8,
      dayNotionalVolumeUsd: null,
      takerFee: 0.0005,
    });
  });

  it("标准化 HL builder funding 快照", () => {
    const snapshot = normalizeHyperliquidFundingSnapshot(
      {
        name: "xyz:SPCX",
      },
      {
        funding: "0.0000348053",
        dayNtlVlm: "8250000.12",
        markPx: "180.89",
        oraclePx: "180.86",
        openInterest: "1554017.1599999999",
      },
      "xyz",
      () => 3_600_000,
      1.001,
    );

    expect(snapshot).toMatchObject({
      symbol: "SPCX",
      exchange: "hyperliquid",
      rawSymbol: "xyz:SPCX",
      fundingRate: 0.0000348053,
      fundingIntervalHours: 1,
      takerFee: 0.00009,
      builderDex: "xyz",
      quoteToUsdtRate: 1.001,
    });
    expect(snapshot.dayNotionalVolumeUsd).toBeCloseTo(8250000.12 * 1.001, 8);
    expect(snapshot.markPrice).toBeCloseTo(180.89 * 1.001, 8);
  });

  it("发现 Binance funding 快照并过滤到共同标的", async () => {
    const result = await discoverBinanceFundingSnapshots({
      commonPerpSymbols: [
        { symbol: "SPCX", binanceSymbol: "SPCXUSDT" },
        { symbol: "NVDA", binanceSymbol: "NVDAUSDT" },
      ],
      fetchImpl: async (url) =>
        url.includes("ticker/24hr")
          ? createJsonResponse([
              {
                symbol: "SPCXUSDT",
                quoteVolume: "12800000.55",
              },
              {
                symbol: "ETHUSDT",
                quoteVolume: "880000000.11",
              },
            ])
          : createJsonResponse([
              {
                symbol: "SPCXUSDT",
                markPrice: "181.07832183",
                lastFundingRate: "0.00015263",
                nextFundingTime: 1781971200000,
              },
              {
                symbol: "ETHUSDT",
                markPrice: "2500",
                lastFundingRate: "0.0001",
                nextFundingTime: 1781971200000,
              },
            ]),
    });

    expect(result.status.status).toBe("ready");
    expect(result.snapshots.map((item) => item.symbol)).toEqual(["SPCX"]);
    expect(result.snapshots[0].dayNotionalVolumeUsd).toBe(12800000.55);
  });

  it("发现 HL builder funding 快照并支持 xyz/vntl", async () => {
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);

      if (body.dex === "xyz") {
        return createJsonResponse([
          {
            universe: [
              { name: "xyz:SPCX" },
              { name: "xyz:NVDA" },
            ],
          },
          [
            { funding: "0.0000348053", dayNtlVlm: "8250000.12", markPx: "180.89", oraclePx: "180.86" },
            { funding: "0.00000625", dayNtlVlm: "6200000", markPx: "209.75", oraclePx: "209.58" },
          ],
        ]);
      }

      if (body.dex === "vntl") {
        return createJsonResponse([
          {
            universe: [
              { name: "vntl:OPENAI" },
              { name: "vntl:ANTHROPIC" },
            ],
          },
          [
            { funding: "0.0", dayNtlVlm: "15000000", markPx: "1336.2", oraclePx: "1341.8" },
            { funding: "0.0", dayNtlVlm: "7000000", markPx: "1619.3", oraclePx: "1618.9" },
          ],
        ]);
      }

      return createJsonResponse([
        {
          universe: [{ name: "BTC" }],
        },
        [{ funding: "0.0000125", markPx: "100000", oraclePx: "99900" }],
      ]);
    };

    const result = await discoverHyperliquidFundingSnapshots({
      commonPerpSymbols: [
        {
          symbol: "SPCX",
          hyperliquidSymbol: "xyz:SPCX",
          hyperliquidBuilder: "xyz",
        },
        {
          symbol: "OPENAI",
          hyperliquidSymbol: "vntl:OPENAI",
          hyperliquidBuilder: "vntl",
        },
      ],
      fetchImpl,
      now: () => 1_800_000,
      usdcUsdtRate: 1.002,
    });

    expect(result.status.status).toBe("ready");
    expect(result.snapshots.map((item) => item.symbol)).toEqual([
      "SPCX",
      "OPENAI",
    ]);
    expect(result.snapshots[0].dayNotionalVolumeUsd).toBeCloseTo(
      8250000.12 * 1.002,
      8,
    );
    expect(result.snapshots[0].markPrice).toBeCloseTo(180.89 * 1.002, 8);
  });

  it("整合 funding 快照并保留上一版有效数据", async () => {
    let callIndex = 0;
    const result = await loadFundingMonitorSnapshot({
      commonPerpSymbols: [
        {
          symbol: "SPCX",
          binanceSymbol: "SPCXUSDT",
          hyperliquidSymbol: "xyz:SPCX",
          hyperliquidBuilder: "xyz",
        },
      ],
      previousSymbols: [
        {
          symbol: "SPCX",
          exchange: "hyperliquid",
          fundingRate: 0.00001,
          fundingIntervalHours: 1,
          takerFee: 0.00009,
          markPrice: 180,
        },
      ],
      fetchImpl: async (url, options) => {
        callIndex += 1;

        if (url.includes("ticker/24hr")) {
          return createJsonResponse([
            {
              symbol: "SPCXUSDT",
              quoteVolume: "12800000.55",
            },
          ]);
        }

        if (url.includes("bookTicker?symbol=USDCUSDT")) {
          return createJsonResponse({
            symbol: "USDCUSDT",
            bidPrice: "1.002",
            askPrice: "1.0024",
          });
        }

        if (!options) {
          return createJsonResponse([
            {
              symbol: "SPCXUSDT",
              markPrice: "181.07832183",
              lastFundingRate: "0.00015263",
              nextFundingTime: 1781971200000,
            },
          ]);
        }

        return createJsonResponse([
          {
            universe: [{ name: "xyz:SPCX" }],
          },
          [
            {
              funding: "0.0000348053",
              dayNtlVlm: "8250000.12",
              markPx: "180.89",
              oraclePx: "180.86",
            },
          ],
        ]);
      },
      now: () => 1000,
    });

    expect(callIndex).toBe(4);
    expect(result.symbols).toHaveLength(2);
    expect(result.fundingMonitorStatus.status).toBe("ready");
    expect(result.fundingMonitorStatus.sources).toEqual({
      binance: 1,
      hyperliquid: 1,
    });
    expect(
      result.symbols.find((item) => item.exchange === "binance")
        .dayNotionalVolumeUsd,
    ).toBe(12800000.55);
    expect(
      result.symbols.find((item) => item.exchange === "hyperliquid")
        .markPrice,
    ).toBeCloseTo(180.89 * 1.0022, 8);
  });
});
