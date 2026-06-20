import {
  formatExchange,
  formatPercent,
  formatPriceUsd,
  formatStatus,
  formatUsd,
} from "../core/formatters.js";
import { summarizeOpportunities } from "../core/metrics.js";

function getViewportMode() {
  return document.documentElement.dataset.viewportMode ?? "desktop";
}

function renderSortControls(scope, sortState, options) {
  return `
    <div class="sort-controls" data-testid="${scope}-sort-controls">
      <label>
        <span>排序依据</span>
        <select data-sort-scope="${scope}" data-sort-key="sortBy" aria-label="${scope} 排序依据">
          ${options
            .map(
              (option) => `
                <option value="${option.value}" ${sortState.sortBy === option.value ? "selected" : ""}>
                  ${option.label}
                </option>
              `,
            )
            .join("")}
        </select>
      </label>
      <button
        class="ghost-button"
        data-sort-scope="${scope}"
        data-sort-direction="${sortState.sortDirection === "desc" ? "asc" : "desc"}"
        aria-label="${scope} 排序方向"
      >
        ${sortState.sortDirection === "desc" ? "降序" : "升序"}
      </button>
    </div>
  `;
}

function renderCompactHeader(state) {
  return `
    <header class="compact-header panel" data-testid="hero" role="banner">
      <div class="compact-header-copy">
        <span class="eyebrow">CEX × DEX Opportunity Monitor</span>
        <h1>Binance × Hyperliquid 套利机会看板</h1>
        <p>分别聚焦费率交易机会与价差交易机会，只保留筛选、排序、状态与核心机会列表。</p>
      </div>
      <div class="compact-header-meta">
        <span class="meta-chip">共同标的 ${state.commonPerpCount}</span>
        <span class="meta-chip">市场发现 ${formatStatus(state.symbolUniverseStatus.status)}</span>
        <span class="meta-chip">Funding 监控 ${formatStatus(state.fundingMonitorStatus.status)}</span>
      </div>
    </header>
  `;
}

function renderFundingSummary(state) {
  const summary = summarizeOpportunities(
    state.filteredOpportunities,
    state.strategyStatus,
  );

  return `
    <section class="summary-grid" data-testid="funding-summary" aria-label="费率机会摘要">
      <article class="metric-card">
        <span class="metric-label">当前费率机会</span>
        <strong class="metric-value">${state.filteredOpportunities.length}</strong>
      </article>
      <article class="metric-card">
        <span class="metric-label">正收益组合</span>
        <strong class="metric-value">${summary.positiveCount}</strong>
      </article>
      <article class="metric-card">
        <span class="metric-label">高优先级</span>
        <strong class="metric-value">${summary.readyCount}</strong>
      </article>
      <article class="metric-card">
        <span class="metric-label">Funding 状态</span>
        <strong class="metric-value">${formatStatus(state.fundingMonitorStatus.status)}</strong>
      </article>
    </section>
  `;
}

function getFundingEmptyMessage(state) {
  if (state.commonPerpCount === 0) {
    return "当前未发现 Binance 与 Hyperliquid 的共同永续交易对。";
  }

  if (state.monitorSnapshot.opportunities.length === 0) {
    return "监控快照暂无机会数据，请检查模拟数据或采集链路。";
  }

  if (state.symbolUniverseStatus.status !== "ready") {
    return "市场发现当前处于降级状态，已保留上一版共同交易对快照。";
  }

  return "共同交易对已发现，但 Funding 数据暂未齐备或不满足当前筛选条件。";
}

function renderFundingRows(state) {
  if (state.filteredOpportunities.length === 0) {
    return `
      <tr>
        <td colspan="8" class="empty-cell">${getFundingEmptyMessage(state)}</td>
      </tr>
    `;
  }

  return state.filteredOpportunities
    .map((opportunity) => {
      const statusClass = `status-${opportunity.status}`;

      return `
        <tr>
          <td>
            <div class="symbol-stack">
              <strong>${opportunity.symbol}</strong>
              <span>${formatExchange(opportunity.longExchange)} 多 / ${formatExchange(opportunity.shortExchange)} 空</span>
            </div>
          </td>
          <td>${formatPercent(opportunity.longFundingRateHourly, 3)}</td>
          <td>${formatPercent(opportunity.shortFundingRateHourly, 3)}</td>
          <td>${formatPercent(opportunity.fundingSpreadHourly, 3)}</td>
          <td>${formatPercent(opportunity.estimatedNetHourly, 3)}</td>
          <td>${formatPriceUsd(opportunity.longMarkPrice)}</td>
          <td>${formatPriceUsd(opportunity.shortMarkPrice)}</td>
          <td><span class="status-pill ${statusClass}">${formatStatus(opportunity.status)}</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderFundingView(state) {
  return `
    ${renderFundingSummary(state)}

    <section class="filter-bar compact-filter-bar" data-testid="filters">
      <label>
        <span>标的</span>
        <select data-filter-key="symbol" id="filter-symbol" aria-label="按标的筛选">
          <option value="all">全部</option>
          ${state.availableSymbols
            .map(
              (symbol) => `
                <option value="${symbol}">${symbol}</option>
              `,
            )
            .join("")}
        </select>
      </label>
      <label>
        <span>最小净收益 / 小时</span>
        <input data-filter-key="minNetHourly" id="filter-net-hourly" aria-label="最小净收益小时阈值" type="number" step="0.00001" value="${state.filters.minNetHourly}" />
      </label>
      <label>
        <span>最小费率差</span>
        <input data-filter-key="minFundingSpreadHourly" id="filter-funding-spread" aria-label="Funding 差阈值" type="number" step="0.00001" value="${state.filters.minFundingSpreadHourly}" />
      </label>
      ${renderSortControls("funding", state.activeFundingSort, [
        { value: "estimatedNetHourly", label: "净收益" },
        { value: "fundingSpreadHourly", label: "费率差" },
        { value: "compositeScore", label: "综合评分" },
      ])}
      <button class="ghost-button" data-action="clear-filters" aria-label="清空当前筛选条件">清空筛选</button>
    </section>

    <section class="spread-status-bar" data-testid="funding-status">
      <span class="meta-chip">快照 ${state.fundingMonitorStatus.sources?.binance ?? 0}/${state.fundingMonitorStatus.sources?.hyperliquid ?? 0}</span>
      <span class="meta-chip">当前排序 ${state.activeFundingSort.sortBy} / ${state.activeFundingSort.sortDirection}</span>
      ${
        state.fundingMonitorStatus.error
          ? `<span class="meta-chip">${state.fundingMonitorStatus.error}</span>`
          : ""
      }
    </section>

    <article class="panel opportunity-panel" data-testid="matrix" aria-labelledby="matrix-title">
      <div class="panel-head">
        <div>
          <h2 id="matrix-title">费率交易机会</h2>
          <p class="panel-subtitle">按费率差与净收益展示可关注的双边机会。</p>
        </div>
      </div>
      <div class="table-scroll">
        <table class="opportunity-table">
          <caption class="sr-only">费率交易机会列表</caption>
          <thead>
            <tr>
              <th>标的 / 方向</th>
              <th>Long Funding</th>
              <th>Short Funding</th>
              <th>费率差</th>
              <th>净收益</th>
              <th>Long 价</th>
              <th>Short 价</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>${renderFundingRows(state)}</tbody>
        </table>
      </div>
    </article>
  `;
}

function renderSpreadStatusChip(exchange, status) {
  const labels = {
    connecting: "连接中",
    open: "已连接",
    closed: "已断开",
    error: "异常",
  };
  return `<span class="meta-chip">${formatExchange(exchange)} ${labels[status] || status}</span>`;
}

function renderSpreadSummary(state, opps) {
  return `
    <section class="summary-grid" data-testid="spread-summary" aria-label="价差机会摘要">
      <article class="metric-card">
        <span class="metric-label">当前价差机会</span>
        <strong class="metric-value">${state.spreadOpportunityCount ?? opps.length}</strong>
      </article>
      <article class="metric-card">
        <span class="metric-label">共同永续交易对</span>
        <strong class="metric-value">${state.commonPerpCount}</strong>
      </article>
      <article class="metric-card">
        <span class="metric-label">可计算价差</span>
        <strong class="metric-value">${state.readySpreadCount}</strong>
      </article>
      <article class="metric-card">
        <span class="metric-label">待补双边数据</span>
        <strong class="metric-value">${state.missingSpreadCount}</strong>
      </article>
    </section>
  `;
}

function renderSpreadStatusFilterButtons(activeStatus) {
  const options = [
    { value: "all", label: "全部" },
    { value: "ready", label: "可执行" },
    { value: "watch", label: "观察" },
    { value: "blocked", label: "阻断" },
  ];

  return `
    <div class="status-filter-group" data-testid="spread-status-filters" aria-label="按状态筛选价差机会">
      ${options
        .map(
          (option) => `
            <button
              class="${activeStatus === option.value ? "tab is-active" : "tab"}"
              data-spread-status="${option.value}"
              aria-pressed="${activeStatus === option.value}"
            >
              ${option.label}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderSpreadVolumeFilter(activeMin24hVolumeUsd) {
  const options = [
    { value: 0, label: "全部" },
    { value: 1_000_000, label: ">= 100万U" },
    { value: 5_000_000, label: ">= 500万U" },
    { value: 10_000_000, label: ">= 1000万U" },
  ];

  return `
    <label class="spread-volume-filter">
      <span>双边24h量</span>
      <select data-spread-filter-key="min24hVolumeUsd" aria-label="按双边24小时成交量筛选">
        ${options
          .map(
            (option) => `
              <option value="${option.value}" ${Number(activeMin24hVolumeUsd) === option.value ? "selected" : ""}>
                ${option.label}
              </option>
            `,
          )
          .join("")}
      </select>
    </label>
  `;
}

function renderSpreadView(state) {
  const opps = state.spreadOpportunities || [];
  const totalOppCount = state.spreadOpportunityCount ?? opps.length;
  const binanceStatus = state.feedStatus?.binance || "closed";
  const hlStatus = state.feedStatus?.hyperliquid || "closed";
  const connected = binanceStatus === "open" && hlStatus === "open";
  const hasRealtimeData = totalOppCount > 0;
  const hasFilteredData = opps.length > 0;
  const emptyTitle =
    state.commonPerpCount === 0
      ? "暂无共同交易对"
      : totalOppCount > 0 && state.activeSpreadStatusFilter !== "all"
        ? "当前状态下暂无结果"
      : totalOppCount > 0 && state.activeSpreadMin24hVolumeUsd > 0
        ? "当前交易量阈值下暂无结果"
      : connected
        ? "等待实时行情数据"
        : "等待连接";
  const emptyMessage =
    state.commonPerpCount === 0
      ? "市场发现尚未找到 Binance 与 Hyperliquid 的共同永续标的，当前不会建立实时订阅。"
      : totalOppCount > 0 && state.activeSpreadStatusFilter !== "all"
        ? "当前状态筛选下没有匹配的价差机会，请切换状态或恢复查看全部。"
      : totalOppCount > 0 && state.activeSpreadMin24hVolumeUsd > 0
        ? "当前双边 24h 成交量阈值下没有匹配的价差机会，请降低阈值或恢复查看全部。"
      : connected
        ? "盘口数据到达后将按所选排序自动展示；若长时间无数据，请检查网络或刷新页面。"
        : "正在连接 Binance 与 Hyperliquid WebSocket，双边就绪后会自动开始价差计算。";

  return `
    ${renderSpreadSummary(state, opps)}

    <section class="spread-status-bar" data-testid="spread-status">
      ${renderSpreadStatusChip("binance", binanceStatus)}
      ${renderSpreadStatusChip("hyperliquid", hlStatus)}
      <span class="meta-chip">${
        hasRealtimeData
          ? state.activeSpreadStatusFilter === "all"
            ? `实时 ${totalOppCount} 标的`
            : `显示 ${opps.length} / ${totalOppCount} 标的`
          : "等待行情推送"
      }</span>
      ${renderSortControls("spread", state.activeSpreadSort, [
        { value: "netSpreadAbs", label: "净价差绝对值" },
        { value: "netSpreadPct", label: "净价差" },
        { value: "grossSpreadPct", label: "毛价差" },
        { value: "maxNotionalUsd", label: "可成交量" },
      ])}
    </section>

    ${renderSpreadStatusFilterButtons(state.activeSpreadStatusFilter)}
    ${renderSpreadVolumeFilter(state.activeSpreadMin24hVolumeUsd)}

    <article class="panel opportunity-panel" data-testid="spread-matrix" aria-labelledby="spread-title">
      <div class="panel-head">
        <div>
          <h2 id="spread-title">价差交易机会</h2>
          <p class="panel-subtitle">聚焦实时可成交价差，展示买卖方向、净价差与可成交量。</p>
        </div>
      </div>
      ${
        !hasFilteredData
          ? `<div class="empty-state-card">
              <strong>${emptyTitle}</strong>
              <p>${emptyMessage}</p>
            </div>`
          : `<div class="table-scroll">
              <table class="opportunity-table spread-table">
                <caption class="sr-only">价差交易机会列表</caption>
                <thead>
                  <tr>
                    <th>标的</th>
                    <th>买入所</th>
                    <th>买入价</th>
                    <th>卖出所</th>
                    <th>卖出价</th>
                    <th>毛价差</th>
                    <th>手续费</th>
                    <th>净价差</th>
                    <th>24h量(B/H)</th>
                    <th>可成交量</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  ${opps
                    .map((opp) => {
                      const cls = `status-${opp.status}`;
                      const netClass =
                        opp.netSpreadPct > 0 ? "positive" : "negative";
                      return `
                        <tr>
                          <td>${opp.symbol}</td>
                          <td>${formatExchange(opp.buyExchange)}</td>
                          <td>${formatPriceUsd(opp.buyPrice)}</td>
                          <td>${formatExchange(opp.sellExchange)}</td>
                          <td>${formatPriceUsd(opp.sellPrice)}</td>
                          <td>${formatPercent(opp.grossSpreadPct, 3)}</td>
                          <td>${formatPercent(opp.feeCostPct, 3)}</td>
                          <td class="${netClass}">${formatPercent(opp.netSpreadPct, 3)}</td>
                          <td>${formatUsd(opp.binance24hVolumeUsd ?? 0)} / ${formatUsd(opp.hyperliquid24hVolumeUsd ?? 0)}</td>
                          <td>${formatUsd(opp.maxNotionalUsd)}</td>
                          <td><span class="status-pill ${cls}">${formatStatus(opp.status)}</span></td>
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>`
      }
    </article>
  `;
}

export function renderBootstrapError(root, message) {
  root.innerHTML = `
    <section class="bootstrap-error" data-testid="bootstrap-error" role="alert" aria-live="assertive">
      <span class="eyebrow">Initialization Fallback</span>
      <h1>初始化失败</h1>
      <p>${message}</p>
      <p>请检查静态数据结构、入口脚本或当前运行环境后重试。</p>
    </section>
  `;
}

export function renderApp(root, state) {
  const viewportMode = getViewportMode();

  root.innerHTML = `
    <div class="shell" data-layout-mode="${viewportMode}">
      ${renderCompactHeader(state)}

      <nav class="mode-tabs" data-testid="mode-tabs" aria-label="套利模式切换">
        <button
          class="${state.activeTab === "funding" ? "tab is-active" : "tab"}"
          data-tab="funding"
          aria-pressed="${state.activeTab === "funding"}"
          aria-label="切换到费率交易机会视图"
        >
          费率交易机会
        </button>
        <button
          class="${state.activeTab === "spread" ? "tab is-active" : "tab"}"
          data-tab="spread"
          aria-pressed="${state.activeTab === "spread"}"
          aria-label="切换到价差交易机会视图"
        >
          价差交易机会
        </button>
      </nav>

      <main class="view-stack" role="main">
        ${state.activeTab === "spread" ? renderSpreadView(state) : renderFundingView(state)}
      </main>
    </div>
  `;

  if (state.activeTab === "funding") {
    root.querySelector('[data-filter-key="symbol"]').value = state.filters.symbol;
  }
}

export function bindAppEvents(root, store) {
  root.addEventListener("click", (event) => {
    const target = event.target.closest("button");

    if (!target) {
      return;
    }

    const action = target.dataset.action;

    if (action === "start-strategy") {
      store.runStrategy();
    } else if (action === "stop-strategy") {
      store.stopStrategy();
    } else if (action === "reset-strategy") {
      store.resetStrategy();
    } else if (action === "clear-filters") {
      store.clearFilters();
    } else if (action === "run-portfolio") {
      store.runPortfolio();
    }

    if (target.dataset.selectId) {
      store.selectOpportunity(target.dataset.selectId);
    }

    if (target.dataset.tab) {
      store.setActiveTab(target.dataset.tab);
    }

    if (target.dataset.spreadStatus) {
      store.setSpreadStatusFilter(target.dataset.spreadStatus);
    }

    if (target.dataset.timeframe) {
      store.setChartTimeframe(target.dataset.timeframe);
    }

    if (target.dataset.sortScope && target.dataset.sortDirection) {
      const scope = target.dataset.sortScope;
      const state = store.getState();
      const sortBy =
        scope === "funding"
          ? state.activeFundingSort.sortBy
          : state.activeSpreadSort.sortBy;
      store.setSort(scope, sortBy, target.dataset.sortDirection);
    }
  });

  root.addEventListener("change", (event) => {
    const target = event.target;

    if (target.matches("[data-filter-key]")) {
      const key = target.dataset.filterKey;
      const value =
        target.type === "number" ? Number(target.value) : target.value;
      store.setFilter(key, value);
    }

    if (target.matches("[data-risk-key]")) {
      const key = target.dataset.riskKey;
      const value =
        target.type === "checkbox"
          ? target.checked
          : target.type === "number"
            ? Number(target.value)
            : target.value;
      store.updateRiskConfig(key, value);
    }

    if (target.matches("[data-node-id][data-node-key]")) {
      const nodeId = target.dataset.nodeId;
      const key = target.dataset.nodeKey;
      const value =
        target.type === "checkbox"
          ? target.checked
          : target.type === "number"
            ? Number(target.value)
            : target.value;

      store.updateStrategyNodeConfig(nodeId, key, value);
    }

    if (target.matches("[data-sort-scope][data-sort-key]")) {
      store.setSort(
        target.dataset.sortScope,
        target.value,
      );
    }

    if (target.matches("[data-spread-filter-key]")) {
      store.setSpreadMin24hVolumeUsd(Number(target.value));
    }

    if (typeof target.blur === "function" && target.matches("select")) {
      target.blur();
    }
  });

  root.addEventListener("input", (event) => {
    const target = event.target;

    if (target.matches('[data-filter-key][type="number"]')) {
      store.setFilter(target.dataset.filterKey, Number(target.value));
    }

    if (target.matches('[data-risk-key][type="number"]')) {
      store.updateRiskConfig(target.dataset.riskKey, Number(target.value));
    }

    if (target.matches('[data-node-id][data-node-key][type="number"]')) {
      store.updateStrategyNodeConfig(
        target.dataset.nodeId,
        target.dataset.nodeKey,
        Number(target.value),
      );
    }
  });
}
