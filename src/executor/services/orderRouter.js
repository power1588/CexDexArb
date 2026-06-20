import { ExchangeAdapterError } from "../core/errors.js";

function applyTemplate(intent, template) {
  if (template === "maker") {
    return {
      ...intent,
      orderType: "limit",
      tif: "GTC",
      postOnly: true,
      role: "maker",
    };
  }

  if (template === "hedge_fok") {
    return {
      ...intent,
      orderType: "limit",
      tif: "FOK",
      role: "taker",
    };
  }

  if (template === "hedge_ioc") {
    return {
      ...intent,
      orderType: "limit",
      tif: "IOC",
      role: "taker",
    };
  }

  return intent;
}

export function createOrderRouter({
  adapters = {},
} = {}) {
  function getAdapter(exchange) {
    const adapter = adapters[exchange];

    if (!adapter) {
      throw new ExchangeAdapterError(`缺少 ${exchange} 交易所适配器`);
    }

    return adapter;
  }

  return {
    async placeOrder(intent, template = "default") {
      const normalizedIntent = applyTemplate(intent, template);
      const adapter = getAdapter(normalizedIntent.exchange);
      const request = adapter.toOrderRequest(normalizedIntent, {
        postOnly: normalizedIntent.postOnly ?? false,
      });

      return adapter.placeOrder(request);
    },
    async cancelOrder({ exchange, ...request }) {
      return getAdapter(exchange).cancelOrder(request);
    },
    async amendOrder({ exchange, ...request }) {
      return getAdapter(exchange).amendOrder(request);
    },
    async getOrder({ exchange, ...request }) {
      return getAdapter(exchange).getOrder(request);
    },
  };
}
