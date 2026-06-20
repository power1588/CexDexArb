import { ExchangeAdapterError } from "../core/errors.js";

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class ExchangeAdapter {
  constructor(name) {
    this.name = name;
  }

  toOrderRequest(intent, overrides = {}) {
    return {
      exchange: this.name,
      symbol: intent.symbol,
      side: intent.side,
      type: intent.orderType,
      quantity: intent.quantity,
      price: intent.price,
      timeInForce: intent.tif,
      role: intent.role,
      ...overrides,
    };
  }

  async placeOrder() {
    throw new ExchangeAdapterError(`${this.name} adapter 未实现 placeOrder`);
  }

  async cancelOrder() {
    throw new ExchangeAdapterError(`${this.name} adapter 未实现 cancelOrder`);
  }

  async amendOrder() {
    throw new ExchangeAdapterError(`${this.name} adapter 未实现 amendOrder`);
  }

  async getOrder() {
    throw new ExchangeAdapterError(`${this.name} adapter 未实现 getOrder`);
  }

  async getPosition() {
    throw new ExchangeAdapterError(`${this.name} adapter 未实现 getPosition`);
  }

  async getBalance() {
    throw new ExchangeAdapterError(`${this.name} adapter 未实现 getBalance`);
  }
}

export function normalizeOrderUpdate(exchange, rawOrder = {}) {
  const quantity = normalizeNumber(rawOrder.quantity, normalizeNumber(rawOrder.origQty));
  const filledQuantity = normalizeNumber(
    rawOrder.filledQuantity,
    normalizeNumber(rawOrder.executedQty, normalizeNumber(rawOrder.filled)),
  );

  return {
    exchange,
    orderId: String(rawOrder.orderId ?? rawOrder.id ?? ""),
    clientOrderId: rawOrder.clientOrderId ?? null,
    symbol: rawOrder.symbol ?? null,
    side: rawOrder.side ?? null,
    status: rawOrder.status ?? "unknown",
    price: normalizeNumber(rawOrder.price, normalizeNumber(rawOrder.avgPrice)),
    quantity,
    filledQuantity,
    remainingQuantity:
      quantity > 0 ? Math.max(quantity - filledQuantity, 0) : normalizeNumber(rawOrder.remaining),
    rawOrder,
  };
}

export function wrapExchangeError(exchange, action, error) {
  return new ExchangeAdapterError(`${exchange} ${action} 失败`, {
    exchange,
    action,
    cause: error,
  });
}

export function createMockExchangeAdapter({
  name,
  handlers = {},
} = {}) {
  return new (class extends ExchangeAdapter {
    constructor() {
      super(name);
    }

    async placeOrder(request) {
      try {
        return normalizeOrderUpdate(
          this.name,
          (await handlers.placeOrder?.(request)) ?? request,
        );
      } catch (error) {
        throw wrapExchangeError(this.name, "placeOrder", error);
      }
    }

    async cancelOrder(request) {
      try {
        return (await handlers.cancelOrder?.(request)) ?? { cancelled: true, ...request };
      } catch (error) {
        throw wrapExchangeError(this.name, "cancelOrder", error);
      }
    }

    async amendOrder(request) {
      try {
        return (await handlers.amendOrder?.(request)) ?? request;
      } catch (error) {
        throw wrapExchangeError(this.name, "amendOrder", error);
      }
    }

    async getOrder(request) {
      try {
        return normalizeOrderUpdate(
          this.name,
          (await handlers.getOrder?.(request)) ?? request,
        );
      } catch (error) {
        throw wrapExchangeError(this.name, "getOrder", error);
      }
    }

    async getPosition(request) {
      return handlers.getPosition?.(request) ?? null;
    }

    async getBalance(request) {
      return handlers.getBalance?.(request) ?? null;
    }
  })();
}
