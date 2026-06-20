import { describe, expect, it } from "vitest";
import {
  EXECUTION_STATES,
  createExecutionStateMachine,
} from "../../src/executor/core/stateMachine.js";
import { StateTransitionError } from "../../src/executor/core/errors.js";

describe("execution state machine", () => {
  it("IDLE -> SIGNAL_VALIDATED -> PRECHECK_PASSED 流转正确", () => {
    const machine = createExecutionStateMachine();

    machine.transition(EXECUTION_STATES.SIGNAL_VALIDATED, "signal");
    machine.transition(EXECUTION_STATES.PRECHECK_PASSED, "precheck");

    expect(machine.getState()).toBe(EXECUTION_STATES.PRECHECK_PASSED);
  });

  it("QUOTING_MAKER -> LEG1_PARTIAL_FILLED -> HEDGE_PENDING -> HEDGED 流转正确", () => {
    const machine = createExecutionStateMachine();

    machine.transition(EXECUTION_STATES.SIGNAL_VALIDATED, "signal");
    machine.transition(EXECUTION_STATES.PRECHECK_PASSED, "precheck");
    machine.transition(EXECUTION_STATES.QUOTING_MAKER, "quote");
    machine.transition(EXECUTION_STATES.LEG1_PARTIAL_FILLED, "partial");
    machine.transition(EXECUTION_STATES.HEDGE_PENDING, "hedge");
    machine.transition(EXECUTION_STATES.HEDGED, "done");

    expect(machine.getState()).toBe(EXECUTION_STATES.HEDGED);
  });

  it("HEDGE_FAILED -> EMERGENCY_REBALANCE -> FLAT 流转正确", () => {
    const machine = createExecutionStateMachine();

    machine.transition(EXECUTION_STATES.SIGNAL_VALIDATED, "signal");
    machine.transition(EXECUTION_STATES.PRECHECK_PASSED, "precheck");
    machine.transition(EXECUTION_STATES.HEDGE_PENDING, "hedge");
    machine.transition(EXECUTION_STATES.HEDGE_FAILED, "failed");
    machine.transition(EXECUTION_STATES.EMERGENCY_REBALANCE, "rebalance");
    machine.transition(EXECUTION_STATES.FLAT, "flat");

    expect(machine.getState()).toBe(EXECUTION_STATES.FLAT);
  });

  it("HEDGED -> POSITION_MONITORING -> EXIT_PENDING -> FLAT 流转正确", () => {
    const machine = createExecutionStateMachine();

    machine.transition(EXECUTION_STATES.SIGNAL_VALIDATED, "signal");
    machine.transition(EXECUTION_STATES.PRECHECK_PASSED, "precheck");
    machine.transition(EXECUTION_STATES.HEDGE_PENDING, "hedge");
    machine.transition(EXECUTION_STATES.HEDGED, "hedged");
    machine.transition(EXECUTION_STATES.POSITION_MONITORING, "monitoring");
    machine.transition(EXECUTION_STATES.EXIT_PENDING, "exit");
    machine.transition(EXECUTION_STATES.FLAT, "flat");

    expect(machine.getState()).toBe(EXECUTION_STATES.FLAT);
  });

  it("非法状态迁移会被拒绝", () => {
    const machine = createExecutionStateMachine();

    expect(() =>
      machine.transition(EXECUTION_STATES.HEDGED, "invalid"),
    ).toThrow(StateTransitionError);
  });
});
