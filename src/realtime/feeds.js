/**
 * 实时行情接入层。
 *
 * 负责连接 Binance 与 Hyperliquid 的公开 WebSocket，
 * 订阅 Binance USDT 永续盘口、Hyperliquid USDC 永续盘口，以及
 * Binance 现货 USDC/USDT 汇率，并统一折算成 USDT 价格后回调。
 *
 * 设计要点：
 * - 两所都支持浏览器直连，无需 API Key
 * - 自动断线重连，带指数退避
 * - 连接状态变化通过 onStatus 回调通知
 * - 不依赖任何全局，方便测试和复用
 */

import {
  computeUsdcUsdtMidRate,
  convertHyperliquidQuoteToUsdt,
} from "../core/fx.js";

/** Binance USDT-M Futures 公开 WebSocket（Public 路由，2026 新版） */
const BINANCE_WS = "wss://fstream.binance.com/public";
/** Binance Spot USDC/USDT bookTicker */
const BINANCE_SPOT_WS = "wss://stream.binance.com:9443/ws/usdcusdt@bookTicker";
/** Hyperliquid Mainnet WebSocket */
const HYPERLIQUID_WS = "wss://api.hyperliquid.xyz/ws";

/** 默认订阅标的列表（Binance 格式，去掉 USDT 即 HL coin 名） */
export const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "AVAX", "LINK", "ARB", "OP", "SUI"];

/** 重连退避配置 */
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;

/**
 * @typedef {import("../core/spread.js").Quote} Quote
 */

/** 将多种形态的标的输入归一化为 {symbol, binanceSymbol, hyperliquidSymbol} 列表 */
function normalizeSymbolConfigs(symbolList) {
  const seen = new Set();

  return symbolList
    .map((item) => {
      if (typeof item === "string") {
        return {
          symbol: item,
          binanceSymbol: `${item}USDT`,
          hyperliquidSymbol: item,
        };
      }

      if (!item?.symbol) {
        return null;
      }

      return {
        symbol: item.symbol,
        binanceSymbol: item.binanceSymbol ?? `${item.symbol}USDT`,
        hyperliquidSymbol: item.hyperliquidSymbol ?? item.symbol,
      };
    })
    .filter(Boolean)
    .filter((item) => {
      const identity = `${item.symbol}:${item.binanceSymbol}:${item.hyperliquidSymbol}`;

      if (seen.has(identity)) {
        return false;
      }

      seen.add(identity);
      return true;
    });
}

/** 根据归一化标的列表构建双向映射索引 */
function createExchangeMappings(symbolList) {
  return symbolList.reduce(
    (result, item) => {
      result.bySymbol[item.symbol] = item;
      result.byBinanceSymbol[item.binanceSymbol] = item.symbol;
      result.byHyperliquidSymbol[item.hyperliquidSymbol] = item.symbol;
      return result;
    },
    {
      bySymbol: {},
      byBinanceSymbol: {},
      byHyperliquidSymbol: {},
    },
  );
}

/** 重置 quotes 对象为指定标的列表的空结构 */
function resetQuotes(quotes, symbolList) {
  Object.keys(quotes).forEach((symbol) => {
    delete quotes[symbol];
  });

  for (const item of symbolList) {
    quotes[item.symbol] = { binance: null, hyperliquid: null };
  }
}

/**
 * 创建实时行情接入管理器。
 *
 * @param {Object} options
 * @param {(string | {symbol: string, binanceSymbol?: string, hyperliquidSymbol?: string})[]} [options.symbols] - 订阅标的列表
 * @param {(quotes: Record<string, {binance: Quote, hyperliquid: Quote}>) => void} [options.onQuotes]
 * @param {(exchange: string, status: "connecting"|"open"|"closed"|"error", detail?: string) => void} [options.onStatus]
 * @param {typeof globalThis.WebSocket} [options.WebSocketImpl] - 注入便于测试
 * @returns {{start: () => void, stop: () => void, getQuotes: () => Record<string, {binance: Quote, hyperliquid: Quote}>, getStatus: () => Record<string, string>}}
 */
export function createRealtimeFeeds({
  symbols = DEFAULT_SYMBOLS,
  onQuotes,
  onStatus,
  WebSocketImpl = typeof WebSocket !== "undefined" ? WebSocket : undefined,
} = {}) {
  const quotes = {};
  const status = { binance: "closed", hyperliquid: "closed", binanceFx: "closed" };
  let sockets = {};
  let reconnectTimers = {};
  let reconnectAttempts = { binance: 0, hyperliquid: 0, binanceFx: 0 };
  let stopped = false;
  let currentSymbols = normalizeSymbolConfigs(symbols);
  let started = false;
  let reconnectSuppressed = false;
  let exchangeMappings = createExchangeMappings(currentSymbols);
  let latestUsdcUsdtRate = null;

  resetQuotes(quotes, currentSymbols);

  function hasReadyQuote(sym) {
    return Boolean(
      quotes[sym]?.binance &&
        quotes[sym]?.hyperliquid &&
        Number.isFinite(latestUsdcUsdtRate) &&
        latestUsdcUsdtRate > 0,
    );
  }

  function emit(sym) {
    if (onQuotes && hasReadyQuote(sym)) {
      onQuotes({ ...quotes });
    }
  }

  function emitAllReady() {
    if (!onQuotes) {
      return;
    }

    const hasAnyReadyQuote = Object.keys(quotes).some((sym) => hasReadyQuote(sym));

    if (hasAnyReadyQuote) {
      onQuotes({ ...quotes });
    }
  }

  function setStatus(exchange, st, detail) {
    status[exchange] = st;
    onStatus?.(exchange, st, detail);
  }

  function scheduleReconnect(exchange) {
    if (stopped || reconnectSuppressed || currentSymbols.length === 0) return;
    const attempts = ++reconnectAttempts[exchange];
    const delay = Math.min(
      RECONNECT_BASE_DELAY * 2 ** (attempts - 1),
      RECONNECT_MAX_DELAY,
    );
    reconnectTimers[exchange] = setTimeout(() => {
      if (!stopped) connect(exchange);
    }, delay);
  }

  function connect(exchange) {
    if (stopped || !WebSocketImpl || currentSymbols.length === 0) return;
    if (sockets[exchange]) {
      try {
        sockets[exchange].close();
      } catch {
        // 忽略关闭错误
      }
    }

    setStatus(exchange, "connecting");
    const ws =
      exchange === "binance"
        ? connectBinance()
        : exchange === "hyperliquid"
          ? connectHyperliquid()
          : connectBinanceFx();
    sockets[exchange] = ws;
  }

  /** 连接 Binance，订阅所有 symbol 的 bookTicker */
  function connectBinance() {
    const streams = currentSymbols
      .map((item) => `${item.binanceSymbol.toLowerCase()}@bookTicker`)
      .join("/");
    const url = `${BINANCE_WS}/stream?streams=${streams}`;

    let ws;
    try {
      ws = new WebSocketImpl(url);
    } catch (err) {
      setStatus("binance", "error", String(err?.message || err));
      scheduleReconnect("binance");
      return null;
    }

    ws.onopen = () => {
      reconnectAttempts.binance = 0;
      reconnectSuppressed = false;
      setStatus("binance", "open");
    };

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data);
        const payload = envelope.data || envelope;
        // bookTicker 格式: { s: "BTCUSDT", b: bidPrice, a: askPrice, B: bidQty, A: askQty, E: time }
        if (!payload.s) return;
        const base = exchangeMappings.byBinanceSymbol[payload.s];
        if (!base || !quotes[base]) return;

        quotes[base].binance = {
          exchange: "binance",
          bidPrice: Number(payload.b),
          askPrice: Number(payload.a),
          bidQty: Number(payload.B),
          askQty: Number(payload.A),
          timestamp: Number(payload.E || Date.now()),
        };
        emit(base);
      } catch {
        // 忽略解析错误
      }
    };

    ws.onerror = () => {
      setStatus("binance", "error");
    };

    ws.onclose = () => {
      setStatus("binance", "closed");
      scheduleReconnect("binance");
    };

    return ws;
  }

  function repriceHyperliquidQuotes() {
    if (!Number.isFinite(latestUsdcUsdtRate) || latestUsdcUsdtRate <= 0) {
      return;
    }

    for (const quoteSet of Object.values(quotes)) {
      if (!quoteSet?.hyperliquid) {
        continue;
      }

      const converted = convertHyperliquidQuoteToUsdt(
        quoteSet.hyperliquid,
        latestUsdcUsdtRate,
      );

      if (converted) {
        quoteSet.hyperliquid = converted;
      }
    }
  }

  function connectBinanceFx() {
    const url = BINANCE_SPOT_WS;
    let ws;
    try {
      ws = new WebSocketImpl(url);
    } catch (err) {
      setStatus("binanceFx", "error", String(err?.message || err));
      scheduleReconnect("binanceFx");
      return null;
    }

    ws.onopen = () => {
      reconnectAttempts.binanceFx = 0;
      reconnectSuppressed = false;
      setStatus("binanceFx", "open");
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const rate = computeUsdcUsdtMidRate(payload?.b, payload?.a);

        if (!rate) {
          return;
        }

        latestUsdcUsdtRate = rate;
        repriceHyperliquidQuotes();
        emitAllReady();
      } catch {
        // 忽略解析错误
      }
    };

    ws.onerror = () => {
      setStatus("binanceFx", "error");
    };

    ws.onclose = () => {
      setStatus("binanceFx", "closed");
      scheduleReconnect("binanceFx");
    };

    return ws;
  }

  /** 连接 Hyperliquid，订阅所有 coin 的 bbo */
  function connectHyperliquid() {
    const url = HYPERLIQUID_WS;
    let ws;
    try {
      ws = new WebSocketImpl(url);
    } catch (err) {
      setStatus("hyperliquid", "error", String(err?.message || err));
      scheduleReconnect("hyperliquid");
      return null;
    }

    ws.onopen = () => {
      reconnectAttempts.hyperliquid = 0;
      reconnectSuppressed = false;
      setStatus("hyperliquid", "open");
      // 逐个订阅 bbo（HL 需逐条发）
      for (const item of currentSymbols) {
        try {
          ws.send(
            JSON.stringify({
              method: "subscribe",
              subscription: { type: "bbo", coin: item.hyperliquidSymbol },
            }),
          );
        } catch {
          // 忽略发送错误
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // bbo 格式: { channel: "bbo", data: { coin, bbo: [{px,sz,n}, {px,sz,n}], time } }
        if (msg.channel !== "bbo" || !msg.data) return;
        const { coin, bbo, time } = msg.data;
        const symbol = exchangeMappings.byHyperliquidSymbol[coin];
        if (!symbol || !quotes[symbol]) return;

        const bid = bbo?.[0];
        const ask = bbo?.[1];

        const nextQuote = convertHyperliquidQuoteToUsdt({
          exchange: "hyperliquid",
          bidPrice: bid ? Number(bid.px) : NaN,
          askPrice: ask ? Number(ask.px) : NaN,
          bidQty: bid ? Number(bid.sz) : 0,
          askQty: ask ? Number(ask.sz) : 0,
          timestamp: Number(time || Date.now()),
          quoteCurrency: "USDC",
        }, latestUsdcUsdtRate);

        if (!nextQuote) {
          quotes[symbol].hyperliquid = {
            exchange: "hyperliquid",
            bidPrice: NaN,
            askPrice: NaN,
            bidQty: bid ? Number(bid.sz) : 0,
            askQty: ask ? Number(ask.sz) : 0,
            timestamp: Number(time || Date.now()),
            rawBidPrice: bid ? Number(bid.px) : NaN,
            rawAskPrice: ask ? Number(ask.px) : NaN,
            quoteCurrency: "USDC",
          };
          return;
        }

        quotes[symbol].hyperliquid = nextQuote;
        emit(symbol);
      } catch {
        // 忽略解析错误
      }
    };

    ws.onerror = () => {
      setStatus("hyperliquid", "error");
    };

    ws.onclose = () => {
      setStatus("hyperliquid", "closed");
      scheduleReconnect("hyperliquid");
    };

    return ws;
  }

  return {
    start() {
      stopped = false;
      started = true;
      if (currentSymbols.length === 0) {
        setStatus("binance", "closed", "no-symbols");
        setStatus("hyperliquid", "closed", "no-symbols");
        setStatus("binanceFx", "closed", "no-symbols");
        return;
      }
      connect("binance");
      connect("hyperliquid");
      connect("binanceFx");
    },
    stop() {
      stopped = true;
      started = false;
      reconnectSuppressed = true;
      for (const timer of Object.values(reconnectTimers)) {
        clearTimeout(timer);
      }
      reconnectTimers = {};
      for (const ws of Object.values(sockets)) {
        try {
          ws?.close();
        } catch {
          // 忽略
        }
      }
      sockets = {};
      status.binance = "closed";
      status.hyperliquid = "closed";
      status.binanceFx = "closed";
    },
    getQuotes() {
      return quotes;
    },
    getStatus() {
      return { ...status };
    },
    updateSymbols(nextSymbols = []) {
      const normalized = normalizeSymbolConfigs(nextSymbols);
      const changed =
        normalized.length !== currentSymbols.length ||
        normalized.some((symbol, index) => {
          const current = currentSymbols[index];
          return (
            symbol.symbol !== current?.symbol ||
            symbol.binanceSymbol !== current?.binanceSymbol ||
            symbol.hyperliquidSymbol !== current?.hyperliquidSymbol
          );
        });

      if (!changed) {
        return false;
      }

      currentSymbols = normalized;
      exchangeMappings = createExchangeMappings(currentSymbols);
      reconnectSuppressed = true;
      resetQuotes(quotes, currentSymbols);

      Object.values(sockets).forEach((ws) => {
        try {
          ws?.close();
        } catch {
          // 忽略
        }
      });
      sockets = {};
      reconnectSuppressed = false;

      if (started && currentSymbols.length > 0) {
        connect("binance");
        connect("hyperliquid");
        connect("binanceFx");
      } else {
        setStatus("binance", "closed", "no-symbols");
        setStatus("hyperliquid", "closed", "no-symbols");
        setStatus("binanceFx", "closed", "no-symbols");
      }

      return true;
    },
    getSubscribedSymbols() {
      return currentSymbols.map((item) => item.symbol);
    },
  };
}

/**
 * 创建 USDC 永续合约专属实时行情接入管理器。
 *
 * 与 {@link createRealtimeFeeds} 的核心差异：
 * - Binance 订阅 USDC-M 合约 stream（如 `btcusdc@bookTicker`），而非 USDT-M
 * - 两腿均以 USDC 计价，无需 USDC/USDT 汇率折算
 * - Binance maker 挂单 0 fee，价差计算由调用方通过 feeOverrides 体现
 *
 * @param {Object} options
 * @param {(string | {symbol: string, binanceSymbol?: string, hyperliquidSymbol?: string})[]} [options.symbols] - 订阅标的列表（binanceSymbol 应为 XXXUSDC 形态）
 * @param {(quotes: Record<string, {binance: Quote, hyperliquid: Quote}>) => void} [options.onQuotes]
 * @param {(exchange: string, status: "connecting"|"open"|"closed"|"error", detail?: string) => void} [options.onStatus]
 * @param {typeof globalThis.WebSocket} [options.WebSocketImpl] - 注入便于测试
 * @returns {{start: () => void, stop: () => void, getQuotes: () => Record<string, {binance: Quote, hyperliquid: Quote}>, getStatus: () => Record<string, string>}}
 */
export function createUsdcRealtimeFeeds({
  symbols = [],
  onQuotes,
  onStatus,
  WebSocketImpl = typeof WebSocket !== "undefined" ? WebSocket : undefined,
} = {}) {
  const quotes = {};
  const status = { binance: "closed", hyperliquid: "closed" };
  let sockets = {};
  let reconnectTimers = {};
  let reconnectAttempts = { binance: 0, hyperliquid: 0 };
  let stopped = false;
  let currentSymbols = normalizeSymbolConfigs(symbols);
  let started = false;
  let reconnectSuppressed = false;
  let exchangeMappings = createExchangeMappings(currentSymbols);

  resetQuotes(quotes, currentSymbols);

  function hasReadyQuote(sym) {
    return Boolean(quotes[sym]?.binance && quotes[sym]?.hyperliquid);
  }

  function emit(sym) {
    if (onQuotes && hasReadyQuote(sym)) {
      onQuotes({ ...quotes });
    }
  }

  function setStatus(exchange, st, detail) {
    status[exchange] = st;
    onStatus?.(exchange, st, detail);
  }

  function scheduleReconnect(exchange) {
    if (stopped || reconnectSuppressed || currentSymbols.length === 0) return;
    const attempts = ++reconnectAttempts[exchange];
    const delay = Math.min(
      RECONNECT_BASE_DELAY * 2 ** (attempts - 1),
      RECONNECT_MAX_DELAY,
    );
    reconnectTimers[exchange] = setTimeout(() => {
      if (!stopped) connect(exchange);
    }, delay);
  }

  function connect(exchange) {
    if (stopped || !WebSocketImpl || currentSymbols.length === 0) return;
    if (sockets[exchange]) {
      try {
        sockets[exchange].close();
      } catch {
        // 忽略关闭错误
      }
    }

    setStatus(exchange, "connecting");
    const ws =
      exchange === "binance" ? connectBinanceUsdc() : connectHyperliquid();
    sockets[exchange] = ws;
  }

  /** 连接 Binance USDC-M Futures，订阅所有 symbol 的 bookTicker */
  function connectBinanceUsdc() {
    const streams = currentSymbols
      .map((item) => `${item.binanceSymbol.toLowerCase()}@bookTicker`)
      .join("/");
    const url = `${BINANCE_WS}/stream?streams=${streams}`;

    let ws;
    try {
      ws = new WebSocketImpl(url);
    } catch (err) {
      setStatus("binance", "error", String(err?.message || err));
      scheduleReconnect("binance");
      return null;
    }

    ws.onopen = () => {
      reconnectAttempts.binance = 0;
      reconnectSuppressed = false;
      setStatus("binance", "open");
    };

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data);
        const payload = envelope.data || envelope;
        if (!payload.s) return;
        const base = exchangeMappings.byBinanceSymbol[payload.s];
        if (!base || !quotes[base]) return;

        quotes[base].binance = {
          exchange: "binance",
          bidPrice: Number(payload.b),
          askPrice: Number(payload.a),
          bidQty: Number(payload.B),
          askQty: Number(payload.A),
          timestamp: Number(payload.E || Date.now()),
          quoteCurrency: "USDC",
        };
        emit(base);
      } catch {
        // 忽略解析错误
      }
    };

    ws.onerror = () => {
      setStatus("binance", "error");
    };

    ws.onclose = () => {
      setStatus("binance", "closed");
      scheduleReconnect("binance");
    };

    return ws;
  }

  /** 连接 Hyperliquid，订阅所有 coin 的 bbo（USDC 计价，无需折算） */
  function connectHyperliquid() {
    const url = HYPERLIQUID_WS;
    let ws;
    try {
      ws = new WebSocketImpl(url);
    } catch (err) {
      setStatus("hyperliquid", "error", String(err?.message || err));
      scheduleReconnect("hyperliquid");
      return null;
    }

    ws.onopen = () => {
      reconnectAttempts.hyperliquid = 0;
      reconnectSuppressed = false;
      setStatus("hyperliquid", "open");
      for (const item of currentSymbols) {
        try {
          ws.send(
            JSON.stringify({
              method: "subscribe",
              subscription: { type: "bbo", coin: item.hyperliquidSymbol },
            }),
          );
        } catch {
          // 忽略发送错误
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.channel !== "bbo" || !msg.data) return;
        const { coin, bbo, time } = msg.data;
        const symbol = exchangeMappings.byHyperliquidSymbol[coin];
        if (!symbol || !quotes[symbol]) return;

        const bid = bbo?.[0];
        const ask = bbo?.[1];

        quotes[symbol].hyperliquid = {
          exchange: "hyperliquid",
          bidPrice: bid ? Number(bid.px) : NaN,
          askPrice: ask ? Number(ask.px) : NaN,
          bidQty: bid ? Number(bid.sz) : 0,
          askQty: ask ? Number(ask.sz) : 0,
          timestamp: Number(time || Date.now()),
          quoteCurrency: "USDC",
        };
        emit(symbol);
      } catch {
        // 忽略解析错误
      }
    };

    ws.onerror = () => {
      setStatus("hyperliquid", "error");
    };

    ws.onclose = () => {
      setStatus("hyperliquid", "closed");
      scheduleReconnect("hyperliquid");
    };

    return ws;
  }

  return {
    start() {
      stopped = false;
      started = true;
      if (currentSymbols.length === 0) {
        setStatus("binance", "closed", "no-symbols");
        setStatus("hyperliquid", "closed", "no-symbols");
        return;
      }
      connect("binance");
      connect("hyperliquid");
    },
    stop() {
      stopped = true;
      started = false;
      reconnectSuppressed = true;
      for (const timer of Object.values(reconnectTimers)) {
        clearTimeout(timer);
      }
      reconnectTimers = {};
      for (const ws of Object.values(sockets)) {
        try {
          ws?.close();
        } catch {
          // 忽略
        }
      }
      sockets = {};
      status.binance = "closed";
      status.hyperliquid = "closed";
    },
    getQuotes() {
      return quotes;
    },
    getStatus() {
      return { ...status };
    },
    updateSymbols(nextSymbols = []) {
      const normalized = normalizeSymbolConfigs(nextSymbols);
      const changed =
        normalized.length !== currentSymbols.length ||
        normalized.some((symbol, index) => {
          const current = currentSymbols[index];
          return (
            symbol.symbol !== current?.symbol ||
            symbol.binanceSymbol !== current?.binanceSymbol ||
            symbol.hyperliquidSymbol !== current?.hyperliquidSymbol
          );
        });

      if (!changed) {
        return false;
      }

      currentSymbols = normalized;
      exchangeMappings = createExchangeMappings(currentSymbols);
      reconnectSuppressed = true;
      resetQuotes(quotes, currentSymbols);

      Object.values(sockets).forEach((ws) => {
        try {
          ws?.close();
        } catch {
          // 忽略
        }
      });
      sockets = {};
      reconnectSuppressed = false;

      if (started && currentSymbols.length > 0) {
        connect("binance");
        connect("hyperliquid");
      } else {
        setStatus("binance", "closed", "no-symbols");
        setStatus("hyperliquid", "closed", "no-symbols");
      }

      return true;
    },
    getSubscribedSymbols() {
      return currentSymbols.map((item) => item.symbol);
    },
  };
}
