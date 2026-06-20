import {
  computeUsdcUsdtMidRate as computeMidRateFromQuotes,
  convertPriceToUsdt,
} from "../../core/fx.js";

export function computeFxUsdcUsdtMid(bidPrice, askPrice) {
  return computeMidRateFromQuotes(bidPrice, askPrice);
}

export function convertHyperliquidPriceToUsdt(price, fxUsdcUsdtMid) {
  return convertPriceToUsdt(price, fxUsdcUsdtMid);
}

export function isSnapshotFresh(timestamp, maxAgeMs, now) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(maxAgeMs) || !Number.isFinite(now)) {
    return false;
  }

  return now - timestamp <= maxAgeMs;
}

export function ensureFreshFxQuote({
  fxUsdcUsdtMid,
  timestamp,
  maxAgeMs,
  now,
} = {}) {
  if (!Number.isFinite(fxUsdcUsdtMid) || fxUsdcUsdtMid <= 0) {
    return {
      executable: false,
      reason: "missing_fx_rate",
    };
  }

  if (!isSnapshotFresh(timestamp, maxAgeMs, now)) {
    return {
      executable: false,
      reason: "stale_fx_rate",
    };
  }

  return {
    executable: true,
    value: fxUsdcUsdtMid,
  };
}
