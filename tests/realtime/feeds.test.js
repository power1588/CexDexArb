import { describe, expect, it } from "vitest";
import {
  createRealtimeFeeds,
  createUsdcRealtimeFeeds,
} from "../../src/realtime/feeds.js";

/** 模拟 WebSocket，便于测试订阅/推送/重连逻辑 */
function createMockWS() {
  const instances = [];
  const MockWS = class {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this.sent = [];
      this.closed = false;
      instances.push(this);
    }
    send(data) {
      this.sent.push(data);
    }
    close() {
      this.closed = true;
      this.readyState = 3;
    }
    // 测试辅助：模拟服务端打开
    mockOpen() {
      this.readyState = 1;
      this.onopen?.();
    }
    // 测试辅助：模拟服务端推送
    mockMessage(data) {
      this.onmessage?.({ data: JSON.stringify(data) });
    }
    // 测试辅助：模拟关闭
    mockClose() {
      this.readyState = 3;
      this.onclose?.();
    }
  };
  return { MockWS, instances };
}

function findBinanceFuturesWs(instances) {
  return instances.find((item) => item.url.includes("fstream.binance.com"));
}

function findBinanceFxWs(instances) {
  return instances.find((item) => item.url.includes("stream.binance.com:9443"));
}

function findHyperliquidWs(instances) {
  return instances.find((item) => item.url.includes("hyperliquid"));
}

describe("createRealtimeFeeds", () => {
  it("连接后推送行情触发 onQuotes 和 onStatus", () => {
    const { MockWS, instances } = createMockWS();
    let lastQuotes = null;
    const statuses = [];

    const feeds = createRealtimeFeeds({
      symbols: ["BTC"],
      onQuotes: (q) => {
        lastQuotes = q;
      },
      onStatus: (exchange, st) => statuses.push(`${exchange}:${st}`),
      WebSocketImpl: MockWS,
    });

    feeds.start();

    // 三个连接（binance futures + hyperliquid + binance fx）
    expect(instances).toHaveLength(3);

    // 模拟三路连接打开
    instances[0].mockOpen();
    instances[1].mockOpen();
    instances[2].mockOpen();
    expect(statuses).toContain("binance:open");
    expect(statuses).toContain("hyperliquid:open");
    expect(statuses).toContain("binanceFx:open");

    // Hyperliquid 应该发送了订阅消息
    const hlWs = findHyperliquidWs(instances);
    expect(hlWs.sent.length).toBeGreaterThan(0);
    const subMsg = JSON.parse(hlWs.sent[0]);
    expect(subMsg.method).toBe("subscribe");
    expect(subMsg.subscription.coin).toBe("BTC");

    const fxWs = findBinanceFxWs(instances);
    fxWs.mockMessage({
      s: "USDCUSDT",
      b: "0.9998",
      a: "1.0002",
    });

    // 模拟 Binance bookTicker 推送
    const binanceWs = findBinanceFuturesWs(instances);
    binanceWs.mockMessage({
      stream: "btcusdt@bookTicker",
      data: { s: "BTCUSDT", b: "50000", a: "50010", B: "1.5", A: "2", E: 1000 },
    });

    // 模拟 Hyperliquid bbo 推送
    hlWs.mockMessage({
      channel: "bbo",
      data: { coin: "BTC", time: 2000, bbo: [{ px: "50001", sz: "1", n: 1 }, { px: "50009", sz: "1", n: 1 }] },
    });

    // 两所都有数据后应触发 onQuotes
    expect(lastQuotes).not.toBeNull();
    expect(lastQuotes.BTC.binance.bidPrice).toBe(50000);
    expect(lastQuotes.BTC.hyperliquid.askPrice).toBe(50009);

    feeds.stop();
  });

  it("断线后自动调度重连", () => {
    const { MockWS, instances } = createMockWS();
    const feeds = createRealtimeFeeds({
      symbols: ["BTC"],
      WebSocketImpl: MockWS,
    });

    feeds.start();
    instances[0].mockOpen();
    expect(instances.length).toBe(3);

    // 模拟断线
    instances[0].mockClose();
    expect(feeds.getStatus().binance).toBe("closed");

    feeds.stop();
  });

  it("stop 后不再重连", () => {
    const { MockWS } = createMockWS();
    const feeds = createRealtimeFeeds({
      symbols: ["BTC"],
      WebSocketImpl: MockWS,
    });

    feeds.start();
    feeds.stop();

    // stop 后所有连接应被关闭
    expect(feeds.getStatus().binance).toBe("closed");
    expect(feeds.getStatus().hyperliquid).toBe("closed");
  });

  it("支持共同交易对变化后重建订阅", () => {
    const { MockWS, instances } = createMockWS();
    const feeds = createRealtimeFeeds({
      symbols: ["BTC"],
      WebSocketImpl: MockWS,
    });

    feeds.start();
    expect(feeds.getSubscribedSymbols()).toEqual(["BTC"]);

    const updated = feeds.updateSymbols(["ETH"]);

    expect(updated).toBe(true);
    expect(feeds.getSubscribedSymbols()).toEqual(["ETH"]);
    expect(instances.length).toBeGreaterThanOrEqual(6);
  });

  it("空共同交易对列表时不误订阅", () => {
    const { MockWS, instances } = createMockWS();
    const feeds = createRealtimeFeeds({
      symbols: [],
      WebSocketImpl: MockWS,
    });

    feeds.start();

    expect(instances).toHaveLength(0);
    expect(feeds.getStatus().binance).toBe("closed");
  });

  it("支持 builder 前缀的 HL 标的映射订阅", () => {
    const { MockWS, instances } = createMockWS();
    let lastQuotes = null;
    const feeds = createRealtimeFeeds({
      symbols: [
        {
          symbol: "SPCX",
          binanceSymbol: "SPCXUSDT",
          hyperliquidSymbol: "xyz:SPCX",
        },
      ],
      onQuotes: (quotes) => {
        lastQuotes = quotes;
      },
      WebSocketImpl: MockWS,
    });

    feeds.start();

    const binanceWs = instances.find((i) => i.url.includes("binance"));
    const hlWs = instances.find((i) => i.url.includes("hyperliquid"));
    const fxWs = findBinanceFxWs(instances);

    expect(binanceWs.url).toContain("spcxusdt@bookTicker");
    hlWs.mockOpen();
    expect(JSON.parse(hlWs.sent[0]).subscription.coin).toBe("xyz:SPCX");
    fxWs.mockMessage({
      s: "USDCUSDT",
      b: "0.9998",
      a: "1.0002",
    });

    binanceWs.mockMessage({
      data: {
        s: "SPCXUSDT",
        b: "180",
        a: "181",
        B: "10",
        A: "10",
        E: 1000,
      },
    });
    hlWs.mockMessage({
      channel: "bbo",
      data: {
        coin: "xyz:SPCX",
        time: 2000,
        bbo: [
          { px: "180.2", sz: "20", n: 1 },
          { px: "180.8", sz: "20", n: 1 },
        ],
      },
    });

    expect(lastQuotes).not.toBeNull();
    expect(lastQuotes.SPCX.hyperliquid.bidPrice).toBe(180.2);
  });

  it("使用 Binance USDC/USDT 实时汇率将 HL 价格折算为 USDT", () => {
    const { MockWS, instances } = createMockWS();
    let lastQuotes = null;
    const feeds = createRealtimeFeeds({
      symbols: ["BTC"],
      onQuotes: (quotes) => {
        lastQuotes = quotes;
      },
      WebSocketImpl: MockWS,
    });

    feeds.start();
    instances.forEach((instance) => instance.mockOpen());

    const binanceWs = findBinanceFuturesWs(instances);
    const hlWs = findHyperliquidWs(instances);
    const fxWs = findBinanceFxWs(instances);

    binanceWs.mockMessage({
      data: { s: "BTCUSDT", b: "100", a: "101", B: "1", A: "1", E: 1000 },
    });
    hlWs.mockMessage({
      channel: "bbo",
      data: {
        coin: "BTC",
        time: 2000,
        bbo: [
          { px: "100", sz: "1", n: 1 },
          { px: "101", sz: "1", n: 1 },
        ],
      },
    });

    expect(lastQuotes).toBeNull();

    fxWs.mockMessage({
      s: "USDCUSDT",
      b: "1.002",
      a: "1.002",
    });

    expect(lastQuotes).not.toBeNull();
    expect(lastQuotes.BTC.hyperliquid.bidPrice).toBeCloseTo(100.2, 8);
    expect(lastQuotes.BTC.hyperliquid.askPrice).toBeCloseTo(101.202, 8);
    expect(lastQuotes.BTC.hyperliquid.rawBidPrice).toBe(100);
    expect(lastQuotes.BTC.hyperliquid.quoteToUsdtRate).toBe(1.002);
  });
});

describe("createUsdcRealtimeFeeds", () => {
  it("订阅 Binance USDC-M stream 并推送 USDC 计价行情", () => {
    const { MockWS, instances } = createMockWS();
    let lastQuotes = null;
    const feeds = createUsdcRealtimeFeeds({
      symbols: [{ symbol: "BTC", binanceSymbol: "BTCUSDC", hyperliquidSymbol: "BTC" }],
      onQuotes: (q) => {
        lastQuotes = q;
      },
      WebSocketImpl: MockWS,
    });

    feeds.start();

    // USDC feeds 只有 binance + hyperliquid 两路连接（无 FX）
    expect(instances).toHaveLength(2);

    const binanceWs = findBinanceFuturesWs(instances);
    const hlWs = findHyperliquidWs(instances);

    // Binance URL 应包含 btcusdc（而非 btcusdt）
    expect(binanceWs.url).toContain("btcusdc@bookTicker");
    expect(binanceWs.url).not.toContain("btcusdt");

    binanceWs.mockOpen();
    hlWs.mockOpen();

    // HL 订阅 BTC coin
    expect(JSON.parse(hlWs.sent[0]).subscription.coin).toBe("BTC");

    binanceWs.mockMessage({
      stream: "btcusdc@bookTicker",
      data: { s: "BTCUSDC", b: "50000", a: "50010", B: "1.5", A: "2", E: 1000 },
    });

    hlWs.mockMessage({
      channel: "bbo",
      data: {
        coin: "BTC",
        time: 2000,
        bbo: [
          { px: "50001", sz: "1", n: 1 },
          { px: "50009", sz: "1", n: 1 },
        ],
      },
    });

    // 两所都有数据后应触发 onQuotes（无需 FX 折算）
    expect(lastQuotes).not.toBeNull();
    expect(lastQuotes.BTC.binance.bidPrice).toBe(50000);
    expect(lastQuotes.BTC.binance.quoteCurrency).toBe("USDC");
    expect(lastQuotes.BTC.hyperliquid.bidPrice).toBe(50001);
    expect(lastQuotes.BTC.hyperliquid.quoteCurrency).toBe("USDC");

    feeds.stop();
  });

  it("正确处理 1000 前缀资产与 HL k 前缀的映射", () => {
    const { MockWS, instances } = createMockWS();
    let lastQuotes = null;
    const feeds = createUsdcRealtimeFeeds({
      symbols: [
        {
          symbol: "1000PEPE",
          binanceSymbol: "1000PEPEUSDC",
          hyperliquidSymbol: "kPEPE",
        },
      ],
      onQuotes: (q) => {
        lastQuotes = q;
      },
      WebSocketImpl: MockWS,
    });

    feeds.start();

    const binanceWs = findBinanceFuturesWs(instances);
    const hlWs = findHyperliquidWs(instances);

    // Binance 订阅 1000pepeusdc stream
    expect(binanceWs.url).toContain("1000pepeusdc@bookTicker");

    binanceWs.mockOpen();
    hlWs.mockOpen();

    // HL 订阅 kPEPE coin
    expect(JSON.parse(hlWs.sent[0]).subscription.coin).toBe("kPEPE");

    binanceWs.mockMessage({
      data: {
        s: "1000PEPEUSDC",
        b: "0.012",
        a: "0.0121",
        B: "10000",
        A: "8000",
        E: 1000,
      },
    });

    hlWs.mockMessage({
      channel: "bbo",
      data: {
        coin: "kPEPE",
        time: 2000,
        bbo: [
          { px: "0.0121", sz: "5000", n: 1 },
          { px: "0.0122", sz: "5000", n: 1 },
        ],
      },
    });

    expect(lastQuotes).not.toBeNull();
    expect(lastQuotes["1000PEPE"].binance.bidPrice).toBe(0.012);
    expect(lastQuotes["1000PEPE"].hyperliquid.askPrice).toBe(0.0122);

    feeds.stop();
  });

  it("不建立 FX 连接（两腿均为 USDC）", () => {
    const { MockWS, instances } = createMockWS();
    const feeds = createUsdcRealtimeFeeds({
      symbols: ["BTC"],
      WebSocketImpl: MockWS,
    });

    feeds.start();

    // 不应存在 Binance Spot FX 连接
    const fxWs = instances.find((i) => i.url.includes("stream.binance.com:9443"));
    expect(fxWs).toBeUndefined();

    feeds.stop();
  });
});
