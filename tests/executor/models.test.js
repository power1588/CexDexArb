import { describe, expect, it } from "vitest";
import {
  createExecutionPlan,
  createFillEvent,
  createMarketSnapshot,
  createOpportunitySignal,
  createPositionSnapshot,
  createRiskEvent,
} from "../../src/executor/domain/models.js";
import { DomainValidationError } from "../../src/executor/core/errors.js";

describe("executor domain models", () => {
  it("Redis 信号对象字段完整且可解析", () => {
    const signal = createOpportunitySignal({
      signalId: "sig-1",
      symbol: "BTC",
      buyExchange: "binance",
      sellExchange: "hyperliquid",
      observedSpreadBps: 12.5,
      observedAt: 1_700_000_000_000,
      strategyVersion: "v1",
      payload: {
        source: "redis",
      },
    });

    expect(signal.signalId).toBe("sig-1");
    expect(signal.payload.source).toBe("redis");
  });

  it("市场快照对象包含盘口、时间戳、汇率、资金费和保证金信息", () => {
    const snapshot = createMarketSnapshot({
      snapshotId: "snap-1",
      symbol: "BTC",
      timestamp: 1_700_000_000_100,
      fxUsdcUsdtMid: 0.9995,
      fundingRateBps: {
        binance: 1.2,
        hyperliquid: -0.3,
      },
      marginAvailableUsdt: {
        binance: 20_000,
        hyperliquid: 15_000,
      },
      books: {
        binance: {
          bestBid: { price: 100_000, quantity: 2 },
          bestAsk: { price: 100_010, quantity: 1.5 },
        },
        hyperliquid: {
          bestBid: { price: 100_020, quantity: 1 },
          bestAsk: { price: 100_030, quantity: 2.1 },
        },
      },
    });

    expect(snapshot.fxUsdcUsdtMid).toBeCloseTo(0.9995);
    expect(snapshot.books.hyperliquid.bestBid.price).toBe(100_020);
  });

  it("执行计划对象包含腿信息、模式、阈值与风险预算", () => {
    const plan = createExecutionPlan({
      planId: "plan-1",
      signalId: "sig-1",
      symbol: "BTC",
      mode: "maker_taker",
      targetNotionalUsdt: 5_000,
      expectedNetEdgeBps: 9.5,
      riskBudget: {
        maxUnhedgedMs: 1_500,
        maxSlippageBps: 5,
      },
      legs: [
        {
          exchange: "binance",
          side: "buy",
          symbol: "BTCUSDT",
          quoteCurrency: "USDT",
          orderType: "limit",
          price: 100_000,
          quantity: 0.05,
        },
        {
          exchange: "hyperliquid",
          side: "sell",
          symbol: "BTC",
          quoteCurrency: "USDT",
          orderType: "ioc",
          price: 100_030,
          quantity: 0.05,
        },
      ],
      parameterSnapshot: {
        minOpenBps: 8,
      },
    });

    expect(plan.legs).toHaveLength(2);
    expect(plan.riskBudget.maxUnhedgedMs).toBe(1_500);
  });

  it("订单回报、持仓快照和风险事件对象可统一转换", () => {
    const fill = createFillEvent({
      fillId: "fill-1",
      orderId: "order-1",
      exchange: "binance",
      symbol: "BTCUSDT",
      side: "buy",
      quantity: 0.02,
      price: 100_000,
      feeUsdt: 1,
      timestamp: 1_700_000_000_200,
    });
    const position = createPositionSnapshot({
      positionId: "pos-1",
      symbol: "BTC",
      timestamp: 1_700_000_000_300,
      legs: [
        {
          exchange: "binance",
          side: "long",
          quantity: 0.02,
          entryPrice: 100_000,
          markPrice: 100_010,
          notionalUsdt: 2_000,
        },
        {
          exchange: "hyperliquid",
          side: "short",
          quantity: 0.02,
          entryPrice: 100_025,
          markPrice: 100_020,
          notionalUsdt: 2_000,
        },
      ],
      unrealizedPnlUsdt: 2.5,
    });
    const riskEvent = createRiskEvent({
      riskEventId: "risk-1",
      type: "orphan_leg_incident",
      severity: "high",
      symbol: "BTC",
      planId: "plan-1",
      timestamp: 1_700_000_000_400,
      message: "hedge timeout",
      context: {
        maxUnhedgedMs: 1_500,
      },
    });

    expect(fill.orderId).toBe("order-1");
    expect(position.legs[0].exchange).toBe("binance");
    expect(riskEvent.type).toBe("orphan_leg_incident");
  });

  it("字段缺失时抛出明确错误", () => {
    expect(() =>
      createOpportunitySignal({
        symbol: "BTC",
      }),
    ).toThrow(DomainValidationError);
  });
});
