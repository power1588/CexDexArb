import { EXECUTION_MODES } from "../core/edge.js";

function getModeLegRoles(mode) {
  switch (mode) {
    case EXECUTION_MODES.MAKER_TAKER:
      return {
        buyRole: "maker",
        sellRole: "taker",
      };
    case EXECUTION_MODES.TAKER_MAKER:
      return {
        buyRole: "taker",
        sellRole: "maker",
      };
    case EXECUTION_MODES.MAKER_MAKER:
      return {
        buyRole: "maker",
        sellRole: "maker",
      };
    default:
      return {
        buyRole: "taker",
        sellRole: "taker",
      };
  }
}

function legRoleScore({
  exchange,
  role,
  depthScoreByExchange,
  queueScoreByExchange,
  hedgeReliabilityByExchange,
  adverseSelectionRiskByExchange,
} = {}) {
  const depthScore = depthScoreByExchange?.[exchange] ?? 0;
  const queueScore = queueScoreByExchange?.[exchange] ?? 0;
  const hedgeReliability = hedgeReliabilityByExchange?.[exchange] ?? 0;
  const adverseSelectionRisk = adverseSelectionRiskByExchange?.[exchange] ?? 0;

  if (role === "maker") {
    return queueScore * 4 - adverseSelectionRisk * 2 + depthScore;
  }

  return depthScore * 4 + hedgeReliability * 3 - adverseSelectionRisk;
}

export function scoreExecutionModes({
  buyExchange,
  sellExchange,
  expectedEdgeByMode = {},
  depthScoreByExchange = {},
  queueScoreByExchange = {},
  hedgeReliabilityByExchange = {},
  adverseSelectionRiskByExchange = {},
} = {}) {
  const depthScores = Object.values(depthScoreByExchange).filter(Number.isFinite);

  if (depthScores.length >= 2 && depthScores.every((score) => score < 0.3)) {
    return {
      recommendedMode: null,
      rejectionReason: "insufficient_depth",
      scores: [],
    };
  }

  const scores = Object.values(EXECUTION_MODES).map((mode) => {
    const { buyRole, sellRole } = getModeLegRoles(mode);
    const legScore =
      legRoleScore({
        exchange: buyExchange,
        role: buyRole,
        depthScoreByExchange,
        queueScoreByExchange,
        hedgeReliabilityByExchange,
        adverseSelectionRiskByExchange,
      }) +
      legRoleScore({
        exchange: sellExchange,
        role: sellRole,
        depthScoreByExchange,
        queueScoreByExchange,
        hedgeReliabilityByExchange,
        adverseSelectionRiskByExchange,
      });
    const modePenalty = mode === EXECUTION_MODES.MAKER_MAKER ? 1.5 : 0;
    const score = (expectedEdgeByMode[mode] ?? 0) + legScore - modePenalty;

    return {
      mode,
      score,
      edgeScore: expectedEdgeByMode[mode] ?? 0,
      legScore,
      modePenalty,
    };
  });

  const rankedScores = scores.sort((left, right) => right.score - left.score);
  return {
    recommendedMode: rankedScores[0]?.mode ?? null,
    rejectionReason: rankedScores.length === 0 ? "no_modes" : null,
    scores: rankedScores,
  };
}

export function createModeScorer() {
  return {
    score(input) {
      return scoreExecutionModes(input);
    },
  };
}
