import { ConfigError } from "./errors.js";

const REQUIRED_EXCHANGES = ["binance", "hyperliquid"];
const POSITIVE_NUMBER_FIELDS = [
  "minOpenBps",
  "maxTakerSlippageBps",
  "makerBufferBps",
  "dualMakerBufferBps",
  "maxUnhedgedMs",
  "symbolCooldownAfterOrphanSec",
  "maxPositionImbalancePct",
  "maxSignalAgeMs",
  "maxSnapshotAgeMs",
  "minOrderNotionalUsdt",
  "defaultLeverage",
];

export const DEFAULT_EXECUTION_CONFIG = Object.freeze({
  environment: "simulation",
  liveTradingEnabled: false,
  minOpenBps: 8,
  maxTakerSlippageBps: 6,
  makerBufferBps: 1.5,
  dualMakerBufferBps: 3,
  maxUnhedgedMs: 2_500,
  symbolCooldownAfterOrphanSec: 30,
  maxPositionImbalancePct: 3,
  maxSignalAgeMs: 2_000,
  maxSnapshotAgeMs: 1_500,
  minOrderNotionalUsdt: 100,
  defaultLeverage: 2,
  redis: {
    url: "redis://127.0.0.1:6379",
    opportunityChannel: "spread:opportunities",
    riskChannel: "spread:risk-events",
  },
  exchanges: {
    binance: {
      enabled: true,
      feeBps: {
        maker: 1.5,
        taker: 5,
      },
    },
    hyperliquid: {
      enabled: true,
      feeBps: {
        maker: 1.5,
        taker: 4.5,
      },
    },
  },
});

const ENVIRONMENT_OVERRIDES = Object.freeze({
  replay: {
    environment: "replay",
    liveTradingEnabled: false,
    maxSignalAgeMs: 60_000,
    maxSnapshotAgeMs: 60_000,
  },
  simulation: {
    environment: "simulation",
    liveTradingEnabled: false,
  },
  live: {
    environment: "live",
    liveTradingEnabled: false,
    maxSignalAgeMs: 1_000,
    maxSnapshotAgeMs: 750,
  },
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = isPlainObject(value) ? mergeConfig(base[key] ?? {}, value) : value;
  }
  return merged;
}

function compactObject(value) {
  if (!isPlainObject(value)) {
    return value;
  }

  return Object.entries(value).reduce((result, [key, nestedValue]) => {
    if (nestedValue === undefined) {
      return result;
    }

    const compacted =
      isPlainObject(nestedValue) ? compactObject(nestedValue) : nestedValue;

    if (compacted !== undefined) {
      result[key] = compacted;
    }

    return result;
  }, {});
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function configFromEnvironment(environmentVariables = {}) {
  return compactObject({
    environment: environmentVariables.EXECUTOR_ENV,
    liveTradingEnabled: environmentVariables.EXECUTOR_LIVE_TRADING_ENABLED === "true",
    minOpenBps: parseNumber(environmentVariables.MIN_OPEN_BPS, undefined),
    maxTakerSlippageBps: parseNumber(environmentVariables.MAX_TAKER_SLIPPAGE_BPS, undefined),
    makerBufferBps: parseNumber(environmentVariables.MAKER_BUFFER_BPS, undefined),
    dualMakerBufferBps: parseNumber(environmentVariables.DUAL_MAKER_BUFFER_BPS, undefined),
    maxUnhedgedMs: parseNumber(environmentVariables.MAX_UNHEDGED_MS, undefined),
    symbolCooldownAfterOrphanSec: parseNumber(
      environmentVariables.SYMBOL_COOLDOWN_AFTER_ORPHAN_SEC,
      undefined,
    ),
    maxPositionImbalancePct: parseNumber(
      environmentVariables.MAX_POSITION_IMBALANCE_PCT,
      undefined,
    ),
    maxSignalAgeMs: parseNumber(environmentVariables.MAX_SIGNAL_AGE_MS, undefined),
    maxSnapshotAgeMs: parseNumber(environmentVariables.MAX_SNAPSHOT_AGE_MS, undefined),
    minOrderNotionalUsdt: parseNumber(
      environmentVariables.MIN_ORDER_NOTIONAL_USDT,
      undefined,
    ),
    defaultLeverage: parseNumber(environmentVariables.DEFAULT_LEVERAGE, undefined),
    redis: {
      url: environmentVariables.REDIS_URL,
      opportunityChannel: environmentVariables.REDIS_OPPORTUNITY_CHANNEL,
      riskChannel: environmentVariables.REDIS_RISK_CHANNEL,
    },
  });
}

export function validateExecutionConfig(config) {
  if (!isPlainObject(config)) {
    throw new ConfigError("执行配置必须是对象");
  }

  if (!["replay", "simulation", "live"].includes(config.environment)) {
    throw new ConfigError("environment 必须是 replay、simulation 或 live", {
      value: config.environment,
    });
  }

  for (const field of POSITIVE_NUMBER_FIELDS) {
    if (!Number.isFinite(config[field]) || config[field] <= 0) {
      throw new ConfigError(`${field} 必须是正数`, { field, value: config[field] });
    }
  }

  if (config.maxPositionImbalancePct > 100) {
    throw new ConfigError("maxPositionImbalancePct 不能大于 100", {
      value: config.maxPositionImbalancePct,
    });
  }

  if (!isPlainObject(config.redis) || !config.redis.url || !config.redis.opportunityChannel) {
    throw new ConfigError("redis 配置缺失必要字段", { redis: config.redis });
  }

  if (!isPlainObject(config.exchanges)) {
    throw new ConfigError("exchanges 配置缺失");
  }

  for (const exchange of REQUIRED_EXCHANGES) {
    const exchangeConfig = config.exchanges[exchange];

    if (!isPlainObject(exchangeConfig)) {
      throw new ConfigError(`缺少 ${exchange} 交易所配置`);
    }

    if (!isPlainObject(exchangeConfig.feeBps)) {
      throw new ConfigError(`${exchange}.feeBps 配置缺失`);
    }

    if (
      !Number.isFinite(exchangeConfig.feeBps.maker) ||
      exchangeConfig.feeBps.maker < 0 ||
      !Number.isFinite(exchangeConfig.feeBps.taker) ||
      exchangeConfig.feeBps.taker < 0
    ) {
      throw new ConfigError(`${exchange} feeBps 配置非法`, { exchangeConfig });
    }
  }

  if (config.environment === "live" && config.liveTradingEnabled !== true) {
    throw new ConfigError("live 模式必须显式开启 liveTradingEnabled", {
      environment: config.environment,
      liveTradingEnabled: config.liveTradingEnabled,
    });
  }

  return config;
}

export function loadExecutionConfig({
  environment = DEFAULT_EXECUTION_CONFIG.environment,
  overrides = {},
  environmentVariables = {},
} = {}) {
  const normalizedEnvironment = environmentVariables.EXECUTOR_ENV ?? environment;
  const environmentOverride = ENVIRONMENT_OVERRIDES[normalizedEnvironment];

  if (!environmentOverride) {
    throw new ConfigError(`不支持的运行环境: ${normalizedEnvironment}`);
  }

  const merged = mergeConfig(
    mergeConfig(DEFAULT_EXECUTION_CONFIG, environmentOverride),
    mergeConfig(configFromEnvironment(environmentVariables), overrides),
  );

  return Object.freeze(validateExecutionConfig(merged));
}
