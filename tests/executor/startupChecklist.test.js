import { describe, expect, it } from "vitest";
import { loadExecutionConfig } from "../../src/executor/core/config.js";
import { createStartupChecklist } from "../../src/executor/services/startupChecklist.js";

describe("startup checklist", () => {
  it("未满足关键检查项时不能切换到实盘执行", () => {
    const checklist = createStartupChecklist({
      config: loadExecutionConfig({
        environment: "live",
        overrides: {
          liveTradingEnabled: true,
        },
      }),
    });

    expect(
      checklist.run({
        notifierConfigured: true,
        riskParametersPresent: true,
        replayValidated: false,
        simulationValidated: true,
      }),
    ).toMatchObject({
      passed: false,
      blockers: ["validation_incomplete"],
    });
  });

  it("风险参数缺失时阻止启动", () => {
    const checklist = createStartupChecklist({
      config: loadExecutionConfig(),
    });

    expect(
      checklist.run({
        riskParametersPresent: false,
      }).blockers,
    ).toContain("missing_risk_parameters");
  });

  it("未配置告警渠道时给出阻断或高风险提示", () => {
    const liveChecklist = createStartupChecklist({
      config: loadExecutionConfig({
        environment: "live",
        overrides: {
          liveTradingEnabled: true,
        },
      }),
    });
    const simulationChecklist = createStartupChecklist({
      config: loadExecutionConfig(),
    });

    expect(
      liveChecklist.run({
        notifierConfigured: false,
        riskParametersPresent: true,
        replayValidated: true,
        simulationValidated: true,
      }).blockers,
    ).toContain("missing_notifier");
    expect(
      simulationChecklist.run({
        notifierConfigured: false,
        riskParametersPresent: true,
      }).warnings,
    ).toContain("notifier_not_configured");
  });
});
