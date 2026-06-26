/**
 * Redis 开仓信号对比器。
 *
 * 将实际锁定价差与 Redis 推送的开仓信号做对比，
 * 输出偏差归因（FX 偏差、滑点偏差、费率偏差、maker 缓冲偏差）。
 */

function computeAttribution(expectedComponents = {}, actualComponents = {}) {
  const keys = new Set([
    ...Object.keys(expectedComponents),
    ...Object.keys(actualComponents),
  ]);

  const attribution = {};
  for (const key of keys) {
    const expected = Number(expectedComponents[key] ?? 0);
    const actual = Number(actualComponents[key] ?? 0);
    attribution[key] = actual - expected;
  }
  return attribution;
}

function determineAlarmLevel(deviationBpsAbs, { warningThresholdBps, criticalThresholdBps }) {
  if (criticalThresholdBps !== undefined && deviationBpsAbs >= criticalThresholdBps) {
    return "critical";
  }
  if (warningThresholdBps !== undefined && deviationBpsAbs >= warningThresholdBps) {
    return "warning";
  }
  return "normal";
}

export function compareSignalVsActual({
  signal,
  lockedSpread,
  expectedComponents = {},
  actualComponents = {},
  warningThresholdBps = 5,
  criticalThresholdBps,
} = {}) {
  const signalSpreadBps = Number(signal?.observedSpreadBps ?? 0);
  const actualSpreadBps = Number(lockedSpread?.netSpreadBps ?? 0);
  const deviationBps = signalSpreadBps - actualSpreadBps;
  const deviationBpsAbs = Math.abs(deviationBps);

  const signalSpreadUsdt = Number(signal?.expectedSpreadUsdt ?? 0);
  const actualSpreadUsdt = Number(lockedSpread?.netSpreadUsdt ?? 0);
  const deviationUsdt = signalSpreadUsdt - actualSpreadUsdt;

  const attribution = computeAttribution(expectedComponents, actualComponents);
  const alarmLevel = determineAlarmLevel(deviationBpsAbs, {
    warningThresholdBps,
    criticalThresholdBps,
  });

  return {
    signalId: signal?.signalId ?? null,
    signalSpreadBps,
    signalSpreadUsdt,
    actualSpreadBps,
    actualSpreadUsdt,
    deviationBps,
    deviationBpsAbs,
    deviationUsdt,
    deviationPct:
      signalSpreadBps !== 0 ? (deviationBps / signalSpreadBps) * 100 : 0,
    attribution,
    alarmLevel,
    fxDetail: lockedSpread?.fxDetail ?? null,
  };
}
