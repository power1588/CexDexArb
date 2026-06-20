export function serializeStrategyDraft({
  strategyName,
  selectedSymbol,
  strategyNodes,
  enabled,
}) {
  return {
    name: strategyName,
    symbol: selectedSymbol,
    enabled,
    nodes: strategyNodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      config: { ...node.config },
    })),
  };
}
