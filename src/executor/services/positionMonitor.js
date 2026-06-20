export function createPositionMonitor({
  config,
} = {}) {
  return {
    evaluate(positionSnapshot) {
      if (!positionSnapshot || !Array.isArray(positionSnapshot.legs) || positionSnapshot.legs.length < 2) {
        return {
          monitoringMode: "degraded",
          shouldRebalance: false,
          reason: "missing_position_snapshot",
        };
      }

      const notionals = positionSnapshot.legs.map((leg) => Math.abs(Number(leg.notionalUsdt) || 0));
      const maxNotional = Math.max(...notionals);
      const minNotional = Math.min(...notionals);
      const imbalancePct = maxNotional === 0 ? 0 : ((maxNotional - minNotional) / maxNotional) * 100;

      return {
        monitoringMode: "normal",
        imbalancePct,
        shouldRebalance: imbalancePct > config.maxPositionImbalancePct,
        reason: imbalancePct > config.maxPositionImbalancePct ? "position_imbalance" : null,
      };
    },
  };
}
