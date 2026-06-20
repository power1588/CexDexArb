export function createReplayDriver({
  clock = { now: () => Date.now(), set: () => undefined },
  planSelector,
  executor,
} = {}) {
  return {
    async run(frames = []) {
      const orderedFrames = [...frames].sort((left, right) => left.timestamp - right.timestamp);

      const results = [];
      for (const frame of orderedFrames) {
        clock.set?.(frame.timestamp);

        const selection = planSelector.selectPlan(frame.input);
        if (!selection.accepted) {
          results.push({
            frameId: frame.frameId,
            timestamp: frame.timestamp,
            accepted: false,
            reason: selection.reason,
          });
          continue;
        }

        const executionResult = executor
          ? await executor.executePlan(frame.plan ?? selection.plan)
          : {
              success: true,
              state: "PLANNED",
            };

        results.push({
          frameId: frame.frameId,
          timestamp: frame.timestamp,
          accepted: true,
          mode: selection.plan.mode,
          expectedNetEdgeBps: selection.plan.expectedNetEdgeBps,
          executionResult,
        });
      }

      return results;
    },
  };
}
