const exchangeNames = {
  binance: "Binance",
  hyperliquid: "Hyperliquid",
};

export function formatPercent(value, digits = 2) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

export function formatUsd(value) {
  const formatted = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(Math.abs(value));

  return value < 0 ? `-${formatted}` : formatted;
}

export function formatPriceUsd(value) {
  const absoluteValue = Math.abs(value);
  let fractionDigits = 4;

  if (absoluteValue < 1) {
    fractionDigits = 6;
  } else if (absoluteValue > 100) {
    fractionDigits = 2;
  }

  const formatted = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(absoluteValue);

  return value < 0 ? `-${formatted}` : formatted;
}

export function formatBps(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} bps`;
}

export function formatLag(value) {
  return `${value} ms`;
}

export function formatExchange(exchange) {
  return exchangeNames[exchange] ?? exchange;
}

export function formatTimeframe(value) {
  return value.toUpperCase();
}

export function formatStatus(status) {
  const statusMap = {
    ready: "可执行",
    watch: "观察中",
    blocked: "已阻断",
    queued: "排队中",
    running: "运行中",
    rejected: "已拒绝",
    idle: "待命",
    healthy: "健康",
    degraded: "降级",
    delayed: "延迟",
    error: "异常",
    static: "静态快照",
    open: "已连接",
    closed: "已断开",
    connecting: "连接中",
  };

  return statusMap[status] ?? status;
}

export function formatRelativeTime(secondsAgo) {
  if (secondsAgo < 60) {
    return `${secondsAgo} 秒前`;
  }

  if (secondsAgo < 3600) {
    return `${Math.floor(secondsAgo / 60)} 分钟前`;
  }

  return (
    new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: 0,
    }).format(secondsAgo / 3600) + " 小时前"
  );
}
