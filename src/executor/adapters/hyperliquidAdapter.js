/**
 * L3-01 Hyperliquid USDC 永续合约真实 ccxt 适配器。
 *
 * 继承 ExchangeAdapter 基类，对接真实 ccxt.hyperliquid 实例。
 * 适用于 USDC 计价永续合约，taker fee 4.5bps。
 */
import ccxt from "ccxt";
import {
  ExchangeAdapter,
  normalizeOrderUpdate,
  wrapExchangeError,
} from "./exchangeAdapter.js";
import {
  resolveHyperliquidAccountAddress,
  resolveHyperliquidCredentials,
} from "../live/zecMakerHedge.js";

export class HyperliquidAdapter extends ExchangeAdapter {
  constructor({
    privateKey,
    walletAddress,
    options = {},
    exchange = null,
  } = {}) {
    super("hyperliquid");

    if (exchange) {
      this.exchange = exchange;
      this.walletAddress = walletAddress;
      this.accountAddress = walletAddress;
    } else {
      if (!privateKey || !walletAddress) {
        throw new Error("HyperliquidAdapter 需要 privateKey 和 walletAddress");
      }
      this.exchange = new ccxt.hyperliquid({
        privateKey,
        walletAddress,
        enableRateLimit: true,
        options: {
          defaultType: "swap",
          ...options,
        },
      });
      this.walletAddress = walletAddress;
      this.accountAddress = walletAddress;
    }
  }

  async loadMarkets() {
    return this.exchange.loadMarkets();
  }

  /**
   * 解析真实账户地址（agent -> 主账户）。
   * 必须在 loadMarkets 之后调用。
   */
  async resolveAccountAddress() {
    try {
      const role = await this.exchange.publicPostInfo({
        type: "userRole",
        user: this.walletAddress,
      });
      this.accountAddress = resolveHyperliquidAccountAddress({
        configuredAddress: this.walletAddress,
        userRoleResponse: role,
      });
      this.role = role?.role ?? "unknown";
      return this.accountAddress;
    } catch (error) {
      throw wrapExchangeError(this.name, "resolveAccountAddress", error instanceof Error ? error : new Error(String(error)));
    }
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
    // Hyperliquid 支持直接 amend（ccxt 内部转换）
    try {
      const { orderId, symbol, quantity, price } = request;
      const result = await this.exchange.editOrder(orderId, symbol, "limit", undefined, quantity, price);
      return normalizeOrderUpdate(this.name, result);
    } catch {
      // 回退：撤单 + 重挂
      try {
        const { orderId, symbol, side, type = "limit", quantity, price } = request;
        await this.exchange.cancelOrder(orderId, symbol);
        const newOrder = await this.exchange.createOrder(symbol, type, side, quantity, price);
        return normalizeOrderUpdate(this.name, newOrder);
      } catch (fallbackError) {
        throw wrapExchangeError(this.name, "amendOrder", fallbackError);
      }
    }
  }

  async getOrder(request) {
    try {
      const { orderId, symbol } = request;
      const order = await this.exchange.fetchOrder(orderId, symbol, undefined, {
        user: this.accountAddress,
      });
      return normalizeOrderUpdate(this.name, order);
    } catch (error) {
      throw wrapExchangeError(this.name, "getOrder", error);
    }
  }

  async getPosition(request) {
    try {
      const { symbol } = request;
      const positions = await this.exchange.fetchPositions(symbol ? [symbol] : undefined, {
        user: this.accountAddress,
      });
      return positions?.[0] ?? null;
    } catch (error) {
      throw wrapExchangeError(this.name, "getPosition", error);
    }
  }

  async getBalance() {
    try {
      const balance = await this.exchange.fetchBalance({
        type: "swap",
        user: this.accountAddress,
      });
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

  async setLeverage(leverage, symbol) {
    return this.exchange.setLeverage(leverage, symbol);
  }

  async close() {
    if (this.exchange && typeof this.exchange.close === "function") {
      await this.exchange.close();
    }
  }
}

/**
 * 从环境变量构造 HyperliquidAdapter。
 */
export function createHyperliquidAdapterFromEnv(environmentVariables = {}, options = {}) {
  const { privateKey, walletAddress } = resolveHyperliquidCredentials(environmentVariables);
  return new HyperliquidAdapter({ privateKey, walletAddress, options });
}
