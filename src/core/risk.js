export function evaluateRiskSignals({
  opportunity,
  storageLatencyMs,
  maxSlippageBps,
  minFundingEdge = 0.00018,
  exitOnFundingFlip = true,
  longFundingRateHourly = 0,
  shortFundingRateHourly = 0,
  minEdgeRetention = 0.00006,
}) {
  const signals = [];

  if (!opportunity) {
    return signals;
  }

  if (opportunity.estimatedNetHourly <= 0) {
    signals.push({
      code: "net-negative",
      severity: "error",
      message: "净收益跌破阈值",
    });
  }

  if (opportunity.fundingSpreadHourly < minFundingEdge) {
    signals.push({
      code: "funding-edge-low",
      severity: "warning",
      message: "Funding 优势不足",
    });
  }

  if (
    exitOnFundingFlip &&
    (longFundingRateHourly >= shortFundingRateHourly ||
      opportunity.fundingSpreadHourly < minEdgeRetention)
  ) {
    signals.push({
      code: "funding-flip",
      severity: "error",
      message: "Funding 方向反转",
    });
  }

  if (storageLatencyMs > 400) {
    signals.push({
      code: "latency-high",
      severity: "warning",
      message: "数据延迟偏高",
    });
  }

  if (maxSlippageBps > 8) {
    signals.push({
      code: "slippage-high",
      severity: "warning",
      message: "滑点上限过高",
    });
  }

  return signals;
}
