/**
 * L3-01 Binance USDC-M 合约真实 ccxt 适配器。
 *
 * 继承 ExchangeAdapter 基类，对接真实 ccxt.binance 实例。
 * 适用于 USDC-M 永续合约（defaultType: "swap"），maker fee 0.0000%。
 *
 * 参考 Python 脚本已验证的签名参数和下单参数。
 */
import ccxt from "ccxt";
import {
  ExchangeAdapter,
  normalizeOrderUpdate,
  wrapExchangeError,
} from "./exchangeAdapter.js";

export class BinanceUsdcAdapter extends ExchangeAdapter {
  constructor({
    apiKey,
    secret,
    options = {},
    exchange = null,
  } = {}) {
    super("binance");

    if (exchange) {
      // 测试注入：允许外部传入 mock/fake ccxt 实例
      this.exchange = exchange;
    } else {
      if (!apiKey || !secret) {
        throw new Error("BinanceUsdcAdapter 需要 apiKey 和 secret");
      }
      this.exchange = new ccxt.binance({
        apiKey,
        secret,
        enableRateLimit: true,
        options: {
          defaultType: "swap",
          fetchMarkets: ["linear"],
          fetchCurrencies: false,
          ...options,
        },
      });
    }
  }

  async loadMarkets() {
    return this.exchange.loadMarkets();
  }

  async placeOrder(request) {
    try {
      const { symbol, side, type = "limit", quantity, price, timeInForce, postOnly, reduceOnly } = request;
      const params = {};
      if (timeInForce) params.timeInForce = timeInForce;
      if (postOnly) params.postOnly = true;
      if (reduceOnly) params.reduceOnly = true;

      const order =
        postOnly && this.exchange.has?.createPostOnlyOrder
          ? await this.exchange.createPostOnlyOrder(symbol, type, side, quantity, price, params)
          : await this.exchange.createOrder(symbol, type, side, quantity, price, params);

      return normalizeOrderUpdate(this.name, order);
    } catch (error) {
      throw wrapExchangeError(this.name, "placeOrder", error);
    }
  }

  async cancelOrder(request) {
    try {
      const { orderId, symbol } = request;
      const result = await this.exchange.cancelOrder(orderId, symbol);
      return { cancelled: true, ...result, ...request };
    } catch (error) {
      throw wrapExchangeError(this.name, "cancelOrder", error);
    }
  }

  async amendOrder(request) {
    // Binance 不直接支持 amend，采用撤单+重挂
    try {
      const { orderId, symbol, quantity, price, side, type = "limit" } = request;
      await this.exchange.cancelOrder(orderId, symbol);
      const newOrder = await this.exchange.createOrder(symbol, type, side, quantity, price, {
        timeInForce: "GTC",
        postOnly: true,
      });
      return normalizeOrderUpdate(this.name, newOrder);
    } catch (error) {
      throw wrapExchangeError(this.name, "amendOrder", error);
    }
  }

  async getOrder(request) {
    try {
      const { orderId, symbol } = request;
      const order = await this.exchange.fetchOrder(orderId, symbol);
      return normalizeOrderUpdate(this.name, order);
    } catch (error) {
      throw wrapExchangeError(this.name, "getOrder", error);
    }
  }

  async getPosition(request) {
    try {
      const { symbol } = request;
      const positions = await this.exchange.fetchPositions(symbol ? [symbol] : undefined);
      return positions?.[0] ?? null;
    } catch (error) {
      throw wrapExchangeError(this.name, "getPosition", error);
    }
  }

  async getBalance() {
    try {
      const balance = await this.exchange.fetchBalance({ type: "swap" });
      return {
        exchange: this.name,
        freeUSDC: balance.free?.USDC ?? 0,
        usedUSDC: balance.used?.USDC ?? 0,
        totalUSDC: balance.total?.USDC ?? 0,
        raw: balance,
      };
    } catch (error) {
      throw wrapExchangeError(this.name, "getBalance", error);
    }
  }

  async close() {
    if (this.exchange && typeof this.exchange.close === "function") {
      await this.exchange.close();
    }
  }
}

/**
 * 从环境变量构造 BinanceUsdcAdapter。
 */
export function createBinanceUsdcAdapterFromEnv(environmentVariables = {}, options = {}) {
  return new BinanceUsdcAdapter({
    apiKey: environmentVariables.BINANCE_API_KEY,
    secret: environmentVariables.BINANCE_API_SECRET,
    options,
  });
}
