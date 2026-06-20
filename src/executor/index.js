import { createRuntime } from "./adapters/runtime.js";
import { loadExecutionConfig } from "./core/config.js";
import { createSpreadExecutor } from "./orchestrators/spreadExecutor.js";

export function initializeExecutor({
  config,
  configOverrides,
  environmentVariables,
  runtime,
  adapters = {},
} = {}) {
  const resolvedConfig =
    config ??
    loadExecutionConfig({
      overrides: configOverrides,
      environmentVariables,
    });
  const resolvedRuntime = runtime ?? createRuntime();

  resolvedRuntime.logger.info("executor_initialized", {
    environment: resolvedConfig.environment,
    liveTradingEnabled: resolvedConfig.liveTradingEnabled,
  });

  return createSpreadExecutor({
    config: resolvedConfig,
    runtime: resolvedRuntime,
    adapters,
  });
}
