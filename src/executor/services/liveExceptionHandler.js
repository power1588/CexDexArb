/**
 * L5-02 实盘异常处理与回滚。
 *
 * 定义实盘异常场景的统一处理流程：
 *   1. maker 部分成交后超时：按实际成交量对冲，剩余撤销。
 *   2. taker 对冲失败：立即市价平掉已成交的 maker 腿（止损）。
 *   3. WebSocket 断连：暂停触发新周期，已有仓位进入手动管理模式。
 *   4. API 限频：指数退避，连续 3 次失败则中止。
 */

/**
 * 处理 maker 部分成交后超时的场景。
 *
 * 策略：撤单剩余 -> 按实际成交量继续对冲（如果 > 0）。
 *
 * @param {object} params
 * @param {object} params.exchange Binance exchange 实例
 * @param {string} params.symbol 交易对
 * @param {string} params.orderId maker 订单 ID
 * @returns {Promise<{filledQuantity: number, cancelled: boolean}>}
 */
export async function handleMakerPartialFillTimeout({ exchange, symbol, orderId }) {
  // 尝试撤单
  let cancelled = false;
  try {
    await exchange.cancelOrder(orderId, symbol);
    cancelled = true;
  } catch {
    // 可能已被交易所自动撤销
  }

  // 拉取最终状态
  const finalOrder = await exchange.fetchOrder(orderId, symbol);
  const filledQuantity = Number(finalOrder.filled ?? 0);

  return {
    filledQuantity,
    cancelled,
    finalStatus: finalOrder.status,
    shouldHedge: filledQuantity > 0,
  };
}

/**
 * 处理 taker 对冲失败的场景：立即市价平掉已成交的 maker 腿（止损）。
 *
 * @param {object} params
 * @param {object} params.exchange Binance exchange 实例
 * @param {string} params.symbol 交易对
 * @param {number} params.exposedQuantity 已裸露的仓位数量
 * @param {string} params.makerSide maker 方向（buy/sell）
 * @returns {Promise<object>} 止损结果
 */
export async function handleTakerHedgeFailure({
  exchange,
  symbol,
  exposedQuantity,
  makerSide,
}) {
  if (exposedQuantity <= 0) {
    return { stopped: false, reason: "no_exposure" };
  }

  const closeSide = makerSide === "buy" ? "sell" : "buy";

  const stopLossOrder = await exchange.createOrder(
    symbol,
    "market",
    closeSide,
    exposedQuantity,
    undefined,
    { reduceOnly: true },
  );

  return {
    stopped: true,
    stopLossOrderId: stopLossOrder.id,
    side: closeSide,
    quantity: exposedQuantity,
    avgPrice: stopLossOrder.average,
    status: stopLossOrder.status,
  };
}

/**
 * 带指数退避的 API 调用重试。
 *
 * @param {Function} fn 要重试的异步函数
 * @param {object} options
 * @param {number} options.maxRetries 最大重试次数（默认 3）
 * @param {number} options.baseDelayMs 基础退避延迟（默认 500ms）
 * @returns {Promise<any>}
 */
export async function retryWithBackoff(fn, { maxRetries = 3, baseDelayMs = 500 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * 检查是否为 API 限频错误。
 */
export function isRateLimitError(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("429") ||
    error?.code === -1003 // Binance 限频错误码
  );
}

/**
 * 实盘异常处理协调器。
 * 提供统一的异常处理入口，记录风险事件并执行回滚。
 */
export function createLiveExceptionHandler({
  riskEventReporter,
  clock = { now: () => Date.now() },
} = {}) {
  let paused = false;
  let consecutiveApiFailures = 0;

  return {
    /**
     * 暂停触发新周期（WebSocket 断连等场景）。
     */
    pause(reason) {
      paused = true;
      riskEventReporter?.record({
        type: "circuit_breaker_paused",
        severity: "high",
        message: `已暂停触发新周期: ${reason}`,
        timestamp: clock.now(),
      });
      return { paused, reason };
    },

    /**
     * 恢复触发新周期。
     */
    resume() {
      paused = false;
      consecutiveApiFailures = 0;
      riskEventReporter?.record({
        type: "circuit_breaker_resumed",
        severity: "info",
        message: "已恢复触发新周期",
        timestamp: clock.now(),
      });
      return { paused };
    },

    isPaused() {
      return paused;
    },

    /**
     * 记录 API 调用失败，连续 3 次则中止。
     */
    recordApiFailure({ action, error }) {
      consecutiveApiFailures += 1;
      const isRateLimit = isRateLimitError(error);

      riskEventReporter?.record({
        type: "api_failure",
        severity: consecutiveApiFailures >= 3 ? "critical" : "medium",
        message: `API 调用失败 (${action}): ${error?.message}`,
        context: {
          action,
          consecutiveFailures: consecutiveApiFailures,
          isRateLimit,
          code: error?.code,
        },
        timestamp: clock.now(),
      });

      if (consecutiveApiFailures >= 3) {
        this.pause(`连续 ${consecutiveApiFailures} 次 API 失败`);
        return { shouldAbort: true, consecutiveApiFailures };
      }

      return { shouldAbort: false, consecutiveApiFailures };
    },

    recordApiSuccess() {
      consecutiveApiFailures = 0;
    },

    /**
     * 统一处理执行异常。
     */
    async handleExecutionError({
      error,
      phase, // "open_maker" | "open_taker" | "close_maker" | "close_taker"
      context = {},
      rollbackAction = null,
    }) {
      riskEventReporter?.record({
        type: "execution_error",
        severity: "critical",
        message: `执行异常 (${phase}): ${error?.message}`,
        context: { phase, error: error?.message, ...context },
        timestamp: clock.now(),
      });

      if (rollbackAction) {
        try {
          const result = await rollbackAction();
          riskEventReporter?.record({
            type: "rollback_completed",
            severity: "high",
            message: `回滚完成 (${phase})`,
            context: { phase, rollbackResult: result },
            timestamp: clock.now(),
          });
          return { handled: true, rolled: true, result };
        } catch (rollbackError) {
          riskEventReporter?.record({
            type: "rollback_failed",
            severity: "critical",
            message: `回滚失败 (${phase}): ${rollbackError?.message}`,
            context: { phase, originalError: error?.message, rollbackError: rollbackError?.message },
            timestamp: clock.now(),
          });
          return { handled: true, rolled: false, rollbackError };
        }
      }

      return { handled: true, rolled: false };
    },

    getConsecutiveApiFailures() {
      return consecutiveApiFailures;
    },
  };
}
