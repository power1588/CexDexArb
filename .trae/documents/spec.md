# 套利监控 MVP 规格说明

## 1. 文档目的

本文档用于统一套利监控 MVP 的产品目标、技术边界、交互范围、数据契约、实现约束、测试策略与交付标准，为后续开发、验收与移交提供单一参考。

本文档基于以下材料整理：

- `套利监控MVP-产品需求文档.md`
- `套利监控MVP-技术架构文档.md`
- `套利监控MVP-TDD开发待办清单.md`
- `tasks.md`
- `checklist.md`

## 2. 项目概述

### 2.1 项目定位

本项目面向加密套利研究员与半自动交易操盘手，构建一个围绕跨所永续套利监控、策略编排与组合执行预览的工作台。

当前阶段交付目标不是完整交易系统，而是一个可独立打开、可演示、可移交的 HTML MVP，用于验证以下内容：

- 信息架构是否合理
- 主操作路径是否清晰
- 核心监控指标是否易于理解
- 图形化策略编排交互是否成立
- 组合预览与风险展示是否具备演示价值
- 页面结构是否能平滑扩展到后续真实系统

### 2.2 MVP 范围

当前范围限定如下：

- 仅交付单文件 HTML 页面
- 使用静态示例数据与演示状态
- 不调用真实 API
- 不接入真实交易所
- 不执行真实下单
- 仅模拟策略启动、组合运行、风险提示和日志变化
- 预留未来接入 `Python + ccxt + Grafana + VictoriaMetrics + SQLite` 的结构与区域

### 2.3 非目标

以下内容不属于当前 MVP 交付范围：

- 真实行情抓取
- 实时 funding 费率采集
- 真实策略计算服务
- 真实组合下单执行
- 用户登录与权限体系
- 后端 API 服务实现
- 数据库存储实现
- Grafana 真正嵌入与联调

## 3. 用户与使用场景

### 3.1 目标用户

- 策略交易员：查看机会、配置策略、生成组合、启动演示、查看风险与日志
- 研究分析员：浏览跨所价格与 funding 数据、比较套利机会、验证策略编排逻辑

### 3.2 核心使用场景

- 用户打开页面后快速理解当前监控范围与机会概况
- 用户通过筛选条件快速定位可交易标的
- 用户查看 Binance 与 Hyperliquid 之间的净收益与机会状态
- 用户在图形化策略构建器中编辑策略节点参数
- 用户查看自动生成的双腿组合结构、收益拆解与风险限制
- 用户启动策略或运行组合的演示流程，观察状态和日志变化

## 4. 交付物定义

本阶段交付物包括：

- 单文件 HTML MVP 页面
- 静态示例数据
- 测试代码
- 项目说明文档

建议开发期采用模块化结构，交付期收敛为单文件：

- 开发态建议模块：
  - `core`
  - `state`
  - `render`
  - `fixtures`
  - `styles`
- 交付态目标：
  - 一个可直接打开的 `index.html`

## 5. 功能规格

### 5.1 Hero 概览区

#### 目标

帮助用户在首屏快速理解产品定位、当前监控模式、在线交易所与策略运行概况。

#### 必要内容

- 页面主标题
- 产品定位说明
- 当前监控模式
- 在线交易所数量
- 当前策略状态
- 快捷操作按钮

#### 交互要求

- 数据来自状态层，不使用纯硬编码展示关键统计值
- 状态变化后，概览区可以同步刷新

### 5.2 机会摘要条

#### 目标

以紧凑统计方式展示当前筛选结果的核心价值指标。

#### 必要内容

- 高优先级机会数
- 正收益组合数
- 预计资金费净收益
- 运行中策略数

#### 交互要求

- 统计值随筛选条件实时联动
- 正负收益表现有清晰视觉差异

### 5.3 标的筛选栏

#### 目标

帮助用户缩小机会范围，快速定位目标标的与组合。

#### 支持筛选项

- 交易所
- 标的
- 最小净收益
- funding 差阈值
- 风险等级

#### 交互要求

- 每个筛选项可以独立生效
- 多个筛选项可以组合生效
- 支持一键清空筛选
- 筛选结果要同步影响摘要条、监控矩阵和组合预览

### 5.4 永续价差监控矩阵

#### 目标

展示同标的在 Binance 与 Hyperliquid 之间的核心监控指标，支持比较与机会判断。

#### 必要字段

- 标的
- 交易所
- 标记价格
- 指数价格
- funding 费率
- 下一次 funding 时间
- 手续费
- 数据延迟
- funding spread
- 预计净收益
- 建议杠杆
- 机会状态

#### 状态要求

- 支持 `watch`
- 支持 `ready`
- 支持 `blocked`

#### 交互要求

- 支持排序
- 支持选中某一机会行
- hover 和 active 状态清晰
- 选中后联动策略区和组合预览区

### 5.5 Grafana 图表占位区

#### 目标

为未来真实图表嵌入提供稳定的页面结构占位。

#### 必须预留的图卡

- funding spread
- price spread
- 累计 funding 收益
- 告警时间线

#### 交互要求

- 支持时间粒度切换
- 支持占位说明文本
- 支持骨架或占位状态

### 5.6 时序数据状态卡

#### 目标

展示未来时序系统接入方向及当前模拟状态。

#### 必要信息

- 存储后端
- 写入延迟
- 保留周期
- 最近同步时间
- 健康状态

### 5.7 图形化策略构建器

#### 目标

通过流程化节点展示套利策略的编排过程，并支持参数编辑。

#### 节点顺序

- 交易所选择
- 标的过滤
- 阈值判断
- 双腿下单
- 风险限制
- 平仓条件

#### 交互要求

- 每个节点都可展示标题、说明和关键参数
- 支持参数编辑
- 支持默认值回填
- 支持非法值拦截或修正

### 5.8 套利组合预览卡

#### 目标

根据当前选中的机会和策略配置，生成演示级组合预览。

#### 必要内容

- 双腿方向
- 长腿交易所
- 短腿交易所
- 名义价值
- 杠杆
- 保证金占用
- 收益拆解
- 运行状态

#### 交互要求

- 支持“Binance 多 / Hyperliquid 空”
- 支持反向组合
- 组合预览随策略和选中标的同步更新

### 5.9 风险控制面板

#### 目标

帮助用户理解并配置组合运行前的关键风险限制。

#### 必要配置项

- 最大单腿滑点
- 最小资金费优势
- 费率反转退出
- 杠杆上限
- 保证金缓冲

#### 交互要求

- 支持编辑
- 支持超限提示
- 影响组合运行演示状态与告警结果

### 5.10 事件日志区

#### 目标

集中展示机会触发、策略变化、风险告警和人工操作记录。

#### 必要事件类型

- 机会触发
- 策略启动
- 组合运行
- 腿部失衡
- 滑点风险
- 连接异常
- 人工干预

#### 交互要求

- 按时间倒序展示
- 区分不同严重级别
- 支持新增日志即时渲染

## 6. 数据契约规格

### 6.1 监控快照

前端静态数据结构需兼容以下逻辑模型：

```ts
type ExchangeName = "binance" | "hyperliquid";

type SymbolSnapshot = {
  symbol: string;
  exchange: ExchangeName;
  markPrice: number;
  indexPrice: number;
  fundingRateHourly: number;
  nextFundingTime: string;
  takerFee: number;
  makerFee: number;
  sourceLagMs: number;
};

type OpportunitySnapshot = {
  symbol: string;
  longExchange: ExchangeName;
  shortExchange: ExchangeName;
  fundingSpreadHourly: number;
  estimatedNetHourly: number;
  suggestedLeverage: number;
  status: "watch" | "ready" | "blocked";
};

type MonitorSnapshotResponse = {
  generatedAt: string;
  symbols: SymbolSnapshot[];
  opportunities: OpportunitySnapshot[];
  storage: {
    backend: "victoriametrics";
    writeLatencyMs: number;
    retentionDays: number;
  };
};
```

### 6.2 策略草稿

策略配置结构需兼容以下逻辑模型：

```ts
type StrategyNodeType =
  | "exchange_selector"
  | "symbol_filter"
  | "funding_threshold"
  | "spread_guard"
  | "position_sizer"
  | "hedge_executor"
  | "risk_guard"
  | "exit_rule";

type StrategyNode = {
  id: string;
  type: StrategyNodeType;
  label: string;
  config: Record<string, string | number | boolean>;
};

type CreateStrategyRequest = {
  name: string;
  symbol: string;
  nodes: StrategyNode[];
  enabled: boolean;
};
```

### 6.3 组合运行演示结构

组合演示状态需兼容以下逻辑模型：

```ts
type RunPortfolioRequest = {
  strategyId: string;
  symbol: string;
  longExchange: ExchangeName;
  shortExchange: ExchangeName;
  notionalUsd: number;
  leverage: number;
  maxSlippageBps: number;
};

type RunPortfolioResponse = {
  portfolioId: string;
  runStatus: "queued" | "running" | "rejected";
  reason?: string;
};
```

### 6.4 时序查询占位结构

```ts
type TimeseriesMetric =
  | "mark_price"
  | "funding_rate"
  | "funding_spread"
  | "net_hourly_yield"
  | "portfolio_equity"
  | "execution_fill";

type TimeseriesQueryResponse = {
  metric: TimeseriesMetric;
  symbol: string;
  points: Array<{
    ts: string;
    value: number;
    exchange?: ExchangeName;
  }>;
};
```

## 7. 页面状态规格

页面至少应维护以下状态：

- 当前筛选条件
- 当前选中标的或机会
- 当前策略节点配置
- 当前组合预览
- 当前图表时间粒度
- 当前日志列表
- 当前策略运行状态
- 当前组合运行状态
- 当前存储状态

状态管理要求如下：

- 状态更新逻辑可独立测试
- 状态层不依赖 DOM 结构
- 渲染层只消费状态，不承载复杂业务计算
- 事件处理层只做编排，不做重计算堆叠

## 8. 核心业务规则

### 8.1 指标计算

必须可测试的核心纯函数包括：

- funding spread 计算
- estimated net hourly 计算
- 手续费扣减计算
- 净收益格式化
- 状态标签映射
- 建议杠杆展示

### 8.2 风险规则

至少需要具备以下演示级风险判定：

- funding 反转
- 滑点超限
- 数据延迟过高
- 净收益跌破阈值

### 8.3 日志生成规则

以下场景应能生成日志：

- 页面初始化完成
- 策略启动
- 策略停止
- 策略重置
- 组合进入 `queued`
- 组合进入 `running`
- 组合进入 `rejected`
- 风险告警触发

## 9. 技术规格

### 9.1 技术选型

当前 MVP 技术边界：

- `HTML5`
- `CSS3`
- `Vanilla JavaScript`

开发辅助建议：

- `Vitest`
- `jsdom`
- `Playwright`
- `ESLint`
- `Prettier`

### 9.2 架构原则

- 数据与视图分离
- 纯函数优先
- 先模块化开发，再收敛为单文件交付
- 用占位区预留未来系统接入点

### 9.3 文件组织建议

开发态建议结构：

```text
src/
  core/
  state/
  render/
  fixtures/
  utils/
styles/
tests/
index.html
```

交付态目标：

```text
index.html
```

## 10. 视觉规格

### 10.1 视觉风格

- 深海军蓝与石墨黑作为背景基底
- 使用 Binance 金与 Hyperliquid 青绿作为交易所主题色
- 使用策略紫和风险橙表达状态层次
- 强调高密度信息布局与交易终端氛围

### 10.2 样式要求

- 颜色、间距、圆角、阴影统一由 CSS 变量驱动
- 表格、卡片、按钮、标签共享统一设计令牌
- 重要数字信息使用高可读风格
- 状态标签颜色语义必须一致

### 10.3 响应式要求

- 桌面端优先，适配 1280px 以上宽屏
- 平板端改为上下堆叠布局
- 移动端保留浏览与轻量筛选能力
- 移动端不强调复杂图形化编辑

## 11. 测试规格

### 11.1 TDD 要求

开发流程必须遵循：

1. 先编写失败测试
2. 再实现最小可行代码
3. 再做必要重构
4. 保持测试持续通过

### 11.2 单元测试范围

- 指标计算
- 风险判定
- 状态映射
- 策略草稿序列化
- 收益拆解
- 格式化函数

### 11.3 DOM 测试范围

- Hero 渲染
- 摘要条渲染
- 筛选栏交互
- 监控矩阵渲染
- 策略构建器渲染
- 组合预览渲染
- 风险面板交互
- 日志区渲染

### 11.4 E2E 冒烟范围

- 页面加载
- 筛选主流程
- 策略编辑主流程
- 组合生成主流程
- 启动演示主流程
- 日志联动主流程
- 响应式视口切换

## 12. 异常与边界规格

页面至少需要覆盖以下边界情况：

- 无机会数据
- 筛选无结果
- 图表未接入
- 数据结构异常
- 初始化失败
- 组合被拒绝执行

异常处理要求如下：

- 提示信息清晰
- 不出现页面结构崩溃
- 不因局部异常影响全局可演示性

## 13. 非功能性要求

- 页面可直接本地打开
- 页面可通过静态服务器打开
- 页面无关键控制台错误
- 交互反馈清晰
- 核心逻辑结构具备可扩展性
- 代码风格统一
- lint 可通过
- 主要操作项具备基础键盘可访问能力

## 14. 完成定义

满足以下条件时，可视为 MVP 达到可交付标准：

- 已完成总览、摘要、筛选、矩阵、图表占位、策略构建器、组合预览、风险面板、日志区、时序状态卡
- 所有执行类按钮仅执行演示级状态切换
- 静态数据契约与技术文档保持一致
- 核心纯函数具备单元测试
- 核心交互具备 DOM 测试
- 主流程具备 E2E 冒烟覆盖
- 页面在桌面端表现完整
- 页面在平板与移动端具备基础可用性
- 通过 lint 与基础质量检查

## 15. 实施顺序建议

建议执行顺序如下：

1. 搭建基础工程、设计系统、静态数据契约与状态模型
2. 打通总览区、筛选栏、监控矩阵与联动主链路
3. 实现策略构建器、组合预览与风险控制面板
4. 实现策略演示、组合状态切换与事件日志
5. 补齐图表占位区与时序状态卡
6. 完成响应式、空态异常态、可访问性与性能优化
7. 完成单元测试、DOM 测试、E2E 冒烟测试与发布前检查

## 16. 文档关系

各文档职责建议如下：

- `套利监控MVP-产品需求文档.md`：记录产品目标与页面需求
- `套利监控MVP-技术架构文档.md`：记录数据契约与未来扩展技术边界
- `套利监控MVP-TDD开发待办清单.md`：记录面向开发的详细说明型拆解
- `tasks.md`：记录可执行任务清单
- `checklist.md`：记录阶段验收与交付检查项
- `spec.md`：记录统一规格说明，作为实施基准
