/**
 * 价差套利计算纯函数。
 *
 * 这里用买一/卖一盘口计算"可成交价差"，即真正能吃到的价差。
 * 思路：在便宜的所买（吃卖一 ask），在贵的所卖（吃买一 bid），
 * 毛价差按 sell / buy - 1 计算，净价差按双边 taker fee 后的真实到手比例计算。
 */

/** 两所交易费率默认值（taker 费率，小数） */
export const DEFAULT_TAKER_FEES = {
  binance: 0.0005, // 0.05%
  hyperliquid: 0.00045, // 0.045%
};

/**
 * @typedef {Object} Quote
 * @property {string} exchange         - "binance" | "hyperliquid"
 * @property {number} bidPrice         - 买一价
 * @property {number} askPrice         - 卖一价
 * @property {number} bidQty           - 买一量
 * @property {number} askQty           - 卖一量
 * @property {number} timestamp        - 行情时间戳(ms)
 */

/**
 * @typedef {Object} SpreadOpportunity
 * @property {string} symbol                 - 标的(如 BTC)
 * @property {string} buyExchange            - 买入(便宜的)交易所
 * @property {string} sellExchange           - 卖出(贵的)交易所
 * @property {number} buyPrice               - 买入价(吃 ask)
 * @property {number} sellPrice              - 卖出价(吃 bid)
 * @property {number} grossSpreadPct         - 毛价差百分比(小数)
 * @property {number} feeCostPct             - 手续费成本百分比(小数)
 * @property {number} netSpreadPct           - 净价差百分比(小数, 已扣费)
 * @property {number} maxNotionalUsd         - 可成交名义价值(取两所盘口最小量 * 价格)
 * @property {"ready"|"watch"|"blocked"} status - 可执行状态
 * @property {number} timestamp              - 计算时间戳(ms)
 */

/**
 * 计算单标的的可成交价差机会。
 *
 * @param {string} symbol
 * @param {Quote} binanceQuote  - Binance 盘口
 * @param {Quote} hlQuote       - Hyperliquid 盘口
 * @param {{binance?: number, hyperliquid?: number}} [feeOverrides]
 * @returns {SpreadOpportunity|null} 无法计算时返回 null
 */
export function computeSpreadOpportunity(symbol, binanceQuote, hlQuote, feeOverrides = {}) {
  if (!binanceQuote || !hlQuote) return null;

  const fees = { ...DEFAULT_TAKER_FEES, ...feeOverrides };

  // 取 Binance ask（买入价）与 HL bid（卖出价），以及反向
  const binanceAsk = binanceQuote.askPrice;
  const binanceBid = binanceQuote.bidPrice;
  const hlAsk = hlQuote.askPrice;
  const hlBid = hlQuote.bidPrice;

  if (![binanceAsk, binanceBid, hlAsk, hlBid].every(Number.isFinite)) {
    return null;
  }

  if ([binanceAsk, binanceBid, hlAsk, hlBid].some((price) => price <= 0)) {
    return null;
  }

  const dir1GrossSpreadPct = hlBid / binanceAsk - 1;
  const dir2GrossSpreadPct = binanceBid / hlAsk - 1;
  const dir1NetSpreadPct =
    (hlBid * (1 - fees.hyperliquid)) / (binanceAsk * (1 + fees.binance)) - 1;
  const dir2NetSpreadPct =
    (binanceBid * (1 - fees.binance)) / (hlAsk * (1 + fees.hyperliquid)) - 1;

  let buyExchange, sellExchange, buyPrice, sellPrice, grossSpreadPct, netSpreadPct;
  if (
    dir1NetSpreadPct > dir2NetSpreadPct ||
    (dir1NetSpreadPct === dir2NetSpreadPct &&
      dir1GrossSpreadPct >= dir2GrossSpreadPct)
  ) {
    buyExchange = "binance";
    sellExchange = "hyperliquid";
    buyPrice = binanceAsk;
    sellPrice = hlBid;
    grossSpreadPct = dir1GrossSpreadPct;
    netSpreadPct = dir1NetSpreadPct;
  } else {
    buyExchange = "hyperliquid";
    sellExchange = "binance";
    buyPrice = hlAsk;
    sellPrice = binanceBid;
    grossSpreadPct = dir2GrossSpreadPct;
    netSpreadPct = dir2NetSpreadPct;
  }
  const feeCostPct = grossSpreadPct - netSpreadPct;

  // 可成交名义价值：取两所盘口最小可成交量 * 较低价格
  const buyQty = buyExchange === "binance" ? binanceQuote.askQty : hlQuote.askQty;
  const sellQty = sellExchange === "binance" ? binanceQuote.bidQty : hlQuote.bidQty;
  const minQty = Math.min(buyQty || 0, sellQty || 0);
  const maxNotionalUsd = minQty * Math.min(buyPrice, sellPrice);

  const status = classifySpreadStatus(netSpreadPct, maxNotionalUsd);

  return {
    symbol,
    buyExchange,
    sellExchange,
    buyPrice,
    sellPrice,
    grossSpreadPct,
    feeCostPct,
    netSpreadPct,
    maxNotionalUsd,
    status,
    timestamp: Date.now(),
  };
}

/**
 * 根据净价差和可成交量判定状态。
 * - ready: 净价差 > 0.05%（扣费后仍有正向收益）
 * - watch: 净价差在 -0.02% ~ 0.05% 之间（接近但不够）
 * - blocked: 净价差 < -0.02% 或可成交量过小
 */
export function classifySpreadStatus(netSpreadPct, maxNotionalUsd) {
  if (!Number.isFinite(maxNotionalUsd) || maxNotionalUsd < 100) return "blocked";
  if (netSpreadPct > 0.0005) return "ready";
  if (netSpreadPct >= -0.0002) return "watch";
  return "blocked";
}

export function sortSpreadOpportunities(
  opportunities,
  sortBy = "netSpreadAbs",
  sortDirection = "desc",
) {
  const direction = sortDirection === "asc" ? 1 : -1;
  const accessors = {
    grossSpreadPct: (item) => item.grossSpreadPct,
    netSpreadPct: (item) => item.netSpreadPct,
    netSpreadAbs: (item) => Math.abs(item.netSpreadPct),
    maxNotionalUsd: (item) => item.maxNotionalUsd,
    compositeScore: (item) =>
      Math.abs(item.netSpreadPct) * 1_000_000 + item.maxNotionalUsd / 1000,
  };
  const pick = accessors[sortBy] ?? accessors.netSpreadAbs;

  return [...opportunities].sort((left, right) => {
    const delta = pick(left) - pick(right);

    if (delta !== 0) {
      return delta * direction;
    }

    return left.symbol.localeCompare(right.symbol, "en");
  });
}

/**
 * 批量计算价差机会并按净价差绝对值从大到小排序。
 *
 * @param {Record<string, {binance: Quote, hyperliquid: Quote}>} quotesBySymbol
 * @param {{
 *   feeOverrides?: {binances?: number, hyperliquid?: number},
 *   allowedSymbols?: string[],
 *   sortBy?: string,
 *   sortDirection?: "asc"|"desc"
 * }} [options]
 * @returns {SpreadOpportunity[]}
 */
export function computeAllSpreadOpportunities(quotesBySymbol, options = {}) {
  const {
    feeOverrides,
    allowedSymbols,
    sortBy = "netSpreadAbs",
    sortDirection = "desc",
  } = options;
  const results = [];
  for (const [symbol, quotes] of Object.entries(quotesBySymbol)) {
    if (allowedSymbols?.length && !allowedSymbols.includes(symbol)) {
      continue;
    }
    const opp = computeSpreadOpportunity(
      symbol,
      quotes.binance,
      quotes.hyperliquid,
      feeOverrides,
    );
    if (opp) results.push(opp);
  }

  return sortSpreadOpportunities(results, sortBy, sortDirection);
}
