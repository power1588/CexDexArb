import { serializeStrategyDraft } from "../../src/core/strategy.js";
import { createInitialData } from "../../src/fixtures/mockData.js";

describe("strategy", () => {
  it("将当前策略节点序列化为兼容接口的草稿结构", () => {
    const seed = createInitialData();

    const draft = serializeStrategyDraft({
      strategyName: "BTC Funding Capture",
      selectedSymbol: "BTC",
      strategyNodes: seed.strategyNodes,
      enabled: true,
    });

    expect(draft.name).toBe("BTC Funding Capture");
    expect(draft.symbol).toBe("BTC");
    expect(draft.enabled).toBe(true);
    expect(draft.nodes).toHaveLength(seed.strategyNodes.length);
    expect(draft.nodes[0].config.longExchange).toBe("binance");
  });
});
