# CexDexArb

Binance / Hyperliquid 价差监控与执行器实验项目。

当前仓库包含两部分能力：

- 前端监控页面：展示跨交易所永续合约的价差、资金费与候选机会。
- 执行器原型：基于统一领域模型、风险控制与脚本入口，验证从 dry-run 到真实下单的关键链路。

## 项目结构

```text
src/
  executor/     实盘执行器、风控、状态机、交易所脚本辅助模块
  core/         前端监控共用计算与频道负载
  fixtures/     前端与脚本使用的模拟数据
  realtime/     实时行情订阅
  render/       前端渲染逻辑
  services/     市场与资金费服务
  state/        前端状态管理
scripts/
  build-single-file.js                    构建单文件交付版 HTML
  publish-spread-opportunities.js         将前端筛选后的价差机会推送到 Redis
  dry-run-executor.js                     执行器 dry-run 演示
  hl-zecusdc-confirmed-order.js           Hyperliquid 单腿真实下单确认脚本
  open-zecusdc-binance-maker-hyperliquid-taker.js
                                          Binance maker -> Hyperliquid taker 开仓脚本
tests/
  executor/      执行器单元测试
  core/          前端核心计算测试
  e2e/           页面冒烟测试
```

## 环境要求

- Node.js 20+
- npm 10+
- 可选：本地 Redis，用于 Redis 发布脚本

## 安装

```bash
npm install
```

## 环境变量

复制模板并填写：

```bash
cp .env.example .env
```

常用字段：

```bash
# Binance
BINANCE_API_KEY=
BINANCE_API_SECRET=

# Hyperliquid
HYPERLIQUID_PRIVATE_KEY=
HYPERLIQUID_WALLET_ADDRESS=

# 兼容旧字段
HYPERLIQUID_API_KEY=
HYPERLIQUID_API_SECRET=
HYPERLIQUID_ACCOUNT_ADDRESS=

# Redis
REDIS_URL=redis://127.0.0.1:6379
REDIS_SPREAD_CHANNEL=arbitrage:spread:opportunities
```

说明：

- `.env` 已被 `.gitignore` 忽略，不会被提交。
- Hyperliquid 脚本支持 `agent -> 主账户` 自动识别。

## 常用命令

### 前端监控

```bash
npm run dev
npm run build
npm run preview
npm run build:single
```

### 测试与检查

```bash
npm run test
npm run test:watch
npm run test:executor
npm run lint
npm run check
npm run check:executor
```

### 执行器与脚本

```bash
npm run executor:dry-run
npm run executor:hl:buy:confirm
npm run executor:open:zec-maker-hl-taker -- --amount 0.03
npm run spread:publish
```

## Hyperliquid 实盘确认脚本

本仓库已验证 Hyperliquid 真实下单链路可用，建议使用带人工确认的脚本：

```bash
npm run executor:hl:buy:confirm
```

仅预演，不真实下单。

如果要真实发送：

```bash
npm run executor:hl:buy:confirm -- --execute
```

脚本会先打印：

- 市场精度与最小名义金额
- signer 地址与真实账户地址
- 可用 USDC
- 下单价格、数量、名义金额
- 需要人工输入的确认口令

只有在本地终端输入完全匹配的确认口令后，才会真实调用下单接口。

## Binance Maker -> Hyperliquid Taker

开仓验证脚本：

```bash
npm run executor:open:zec-maker-hl-taker -- --amount 0.03
```

说明：

- 默认只做预演，不会真实下单。
- 增加 `--execute` 才会进入真实交易流程。
- 当前该脚本用于验证开仓主链路，适合作为后续套利编排器的真实交易入口。

## Redis 价差机会发布

如果你想把前端筛选出的机会推送到 Redis：

```bash
npm run spread:publish
```

默认使用：

- `REDIS_URL=redis://127.0.0.1:6379`
- `REDIS_SPREAD_CHANNEL=arbitrage:spread:opportunities`

## 当前整理原则

本次仓库整理重点如下：

- 保留实际接入工作流的 Node.js 脚本
- 统一 `package.json` 脚本命名，按 `executor:*` 与 `spread:*` 归类
- 移除未接入主流程的冗余脚本
- 补齐 README，降低后续接手成本

## 后续建议

- 为 Hyperliquid 脚本补充查单、撤单、持仓回查
- 打通 Binance 实盘 maker 下单与回报确认
- 把单腿脚本逐步收敛到统一的执行器编排入口
