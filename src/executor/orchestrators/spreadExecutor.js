import { EXECUTION_STATES, createExecutionStateMachine } from "../core/stateMachine.js";

const QUANTITY_EPSILON = 1e-8;

function sortLegsForExecution(plan) {
  const makerLeg = plan.legs.find((leg) => leg.orderType === "limit");

  if (makerLeg) {
    const hedgeLeg = plan.legs.find((leg) => leg !== makerLeg);
    return [makerLeg, hedgeLeg];
  }

  return [...plan.legs];
}

function isSuccessfulFill(orderUpdate) {
  return ["filled", "closed"].includes(orderUpdate.status) || orderUpdate.filledQuantity > 0;
}

function hasRemainingQuantity(orderUpdate, targetQuantity) {
  return Number(orderUpdate.filledQuantity ?? 0) + QUANTITY_EPSILON < Number(targetQuantity ?? 0);
}

export function createSpreadExecutor({
  config,
  runtime,
  adapters = {},
  planSelector,
  orderRouter,
} = {}) {
  let started = false;

  async function executePlan(plan) {
    const machine = createExecutionStateMachine();
    const [firstLeg, secondLeg] = sortLegsForExecution(plan);
    const executionEvents = [];

    machine.transition(EXECUTION_STATES.SIGNAL_VALIDATED, "signal_validated");
    machine.transition(EXECUTION_STATES.PRECHECK_PASSED, "plan_selected");

    if (firstLeg.orderType === "limit") {
      machine.transition(EXECUTION_STATES.QUOTING_MAKER, "quote_maker_leg");
    }

    const firstTemplate = firstLeg.orderType === "limit" ? "maker" : "hedge_ioc";
    const firstResult = await orderRouter.placeOrder(firstLeg, firstTemplate);
    executionEvents.push({
      type: "leg1_submitted",
      order: firstResult,
    });

    if (firstResult.status === "partial") {
      machine.transition(EXECUTION_STATES.LEG1_PARTIAL_FILLED, "leg1_partial_fill");
    }

    if (!isSuccessfulFill(firstResult)) {
      machine.transition(EXECUTION_STATES.FLAT, "leg1_not_filled");
      return {
        success: false,
        state: machine.getState(),
        executionEvents,
      };
    }

    machine.transition(EXECUTION_STATES.HEDGE_PENDING, "hedge_requested");

    try {
      const secondResult = await orderRouter.placeOrder(secondLeg, "hedge_ioc");
      executionEvents.push({
        type: "leg2_submitted",
        order: secondResult,
      });

      if (
        isSuccessfulFill(secondResult) &&
        hasRemainingQuantity(secondResult, secondLeg.quantity) &&
        config.maxTakerSlippageBps > 0
      ) {
        const remainingQuantity = Math.max(
          Number(secondLeg.quantity) - Number(secondResult.filledQuantity ?? 0),
          0,
        );
        const retryResult = await orderRouter.placeOrder(
          {
            ...secondLeg,
            quantity: remainingQuantity,
          },
          "hedge_ioc",
        );
        executionEvents.push({
          type: "leg2_retry_submitted",
          order: retryResult,
        });

        if (
          Number(secondResult.filledQuantity ?? 0) +
            Number(retryResult.filledQuantity ?? 0) +
            QUANTITY_EPSILON >=
          Number(secondLeg.quantity)
        ) {
          machine.transition(EXECUTION_STATES.HEDGED, "hedge_retry_filled");
          return {
            success: true,
            state: machine.getState(),
            executionEvents,
          };
        }
      }

      if (!isSuccessfulFill(secondResult) || hasRemainingQuantity(secondResult, secondLeg.quantity)) {
        machine.transition(EXECUTION_STATES.HEDGE_FAILED, "hedge_not_filled");
        machine.transition(EXECUTION_STATES.EMERGENCY_REBALANCE, "start_rebalance");
        machine.transition(EXECUTION_STATES.FLAT, "rebalance_complete");
        return {
          success: false,
          state: machine.getState(),
          executionEvents,
        };
      }

      machine.transition(EXECUTION_STATES.HEDGED, "hedge_filled");
      return {
        success: true,
        state: machine.getState(),
        executionEvents,
      };
    } catch (error) {
      runtime.logger.error("hedge_failed", {
        error: error.message,
      });
      machine.transition(EXECUTION_STATES.HEDGE_FAILED, "hedge_error");
      machine.transition(EXECUTION_STATES.EMERGENCY_REBALANCE, "start_rebalance");
      machine.transition(EXECUTION_STATES.FLAT, "rebalance_complete");

      return {
        success: false,
        state: machine.getState(),
        executionEvents,
        error,
      };
    }
  }

  return {
    getConfig() {
      return config;
    },
    getRuntime() {
      return runtime;
    },
    getAdapters() {
      return adapters;
    },
    isStarted() {
      return started;
    },
    async processSignal(input) {
      const selection = planSelector.selectPlan(input);

      if (!selection.accepted) {
        return selection;
      }

      return executePlan(selection.plan);
    },
    async executePlan(plan) {
      return executePlan(plan);
    },
    async start() {
      started = true;
      runtime.logger.info("spread_executor_started", {
        environment: config.environment,
      });

      return true;
    },
    async stop() {
      started = false;
      runtime.logger.info("spread_executor_stopped", {
        environment: config.environment,
      });

      return true;
    },
  };
}
