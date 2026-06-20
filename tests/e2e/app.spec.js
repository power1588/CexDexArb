import { expect, test } from "@playwright/test";

test("首屏核心模块可见", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("hero")).toBeVisible();
  await expect(page.getByTestId("matrix")).toBeVisible();
  await expect(page.getByTestId("strategy-builder")).toBeVisible();
  await expect(page.getByTestId("portfolio-preview")).toBeVisible();
  await expect(page.getByTestId("storage-card")).toBeVisible();
});

test("筛选、策略启动与组合联动可用", async ({ page }) => {
  await page.goto("/");

  await page.locator('[data-filter-key="symbol"]').selectOption("ETH");
  await expect(page.getByTestId("portfolio-preview")).toContainText("ETH");

  await page.getByRole("button", { name: "启动当前策略演示" }).click();
  await expect(page.getByTestId("hero")).toContainText("运行中");

  await page.locator('[data-risk-key="maxSlippageBps"]').fill("12");
  await expect(page.getByTestId("risk-panel")).toContainText("滑点上限过高");
  await expect(page.getByTestId("logs")).toContainText("触发风险告警");
});

test("调整最小净收益与风险等级后矩阵和摘要条同步变化", async ({ page }) => {
  await page.goto("/");

  await page.locator('[data-filter-key="minNetHourly"]').fill("0.00017");
  await expect(page.getByTestId("matrix")).toContainText("ETH");
  await expect(page.getByTestId("matrix")).not.toContainText("SOL");
  await expect(page.getByRole("region", { name: "机会摘要条" })).toContainText(
    "高优先级机会",
  );

  await page.locator('[data-filter-key="minNetHourly"]').fill("0");
  await page.locator('[data-filter-key="riskLevel"]').selectOption("low");
  await expect(page.getByTestId("matrix")).toContainText("SOL");
});

test("修改策略节点参数后组合预览与风险配置同步变化", async ({ page }) => {
  await page.goto("/");

  await page
    .locator('[data-node-id="hedge-executor"][data-node-key="notionalUsd"]')
    .fill("80000");
  await expect(page.getByTestId("portfolio-preview")).toContainText(
    "US$80,000",
  );

  await page
    .locator('[data-node-id="risk-guard"][data-node-key="marginBufferRatio"]')
    .fill("0.30");
  await expect(page.getByTestId("portfolio-preview")).toContainText(
    "保证金缓冲",
  );
});

test("运行状态变化后事件日志新增记录", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "运行当前套利组合演示" }).click();
  await expect(page.getByTestId("portfolio-preview")).toContainText("运行中");
  await expect(page.getByTestId("logs")).toContainText("组合排队中");
  await expect(page.getByTestId("logs")).toContainText("组合进入运行态");
});

test("切换图表时间粒度后标题与说明同步变化", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /7D/ }).click();
  await expect(page.locator(".chart-card").first()).toContainText("7D");
  await expect(page.locator(".chart-card").first()).toContainText("最近 7 天");
});

test("移动视口下展示布局模式与基础浏览能力", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByTestId("hero")).toContainText("移动布局");
  await expect(page.getByTestId("matrix")).toBeVisible();
  await expect(page.getByTestId("logs")).toBeVisible();
});

test("平板视口下布局正常堆叠", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/");

  await expect(page.getByTestId("hero")).toContainText("平板布局");
  await expect(page.getByTestId("strategy-builder")).toBeVisible();
});

test("键盘可以触发主要操作项", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("hero")).toContainText("运行中");
});

test("可切换到价差套利视图并显示等待提示或实时矩阵", async ({ page }) => {
  await page.goto("/");

  // 默认在费率套利
  await expect(page.getByTestId("filters")).toBeVisible();

  // 切换到价差套利
  await page.getByRole("button", { name: "切换到价差套利视图" }).click();

  await expect(page.getByTestId("spread-matrix")).toBeVisible();
  await expect(page.getByTestId("spread-status")).toBeVisible();
  // 价差视图不应出现费率筛选栏
  await expect(page.getByTestId("filters")).toHaveCount(0);
});
