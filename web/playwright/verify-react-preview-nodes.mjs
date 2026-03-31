import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const baseURL = 'http://proxy:8080';
const outputDir = '/workspace/web/playwright-output';
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();

await page.goto('/ipq/?ui=react#/login');
await page.getByRole('textbox', { name: '用户名' }).fill('admin');
await page.getByLabel('密码').fill('admin');
await page.getByRole('button', { name: '登录' }).click();
await page.waitForURL('**/ipq/?ui=react#/nodes');
await page.waitForLoadState('networkidle');

const headingCount = await page.getByRole('heading', { name: '节点列表' }).count();
if (headingCount === 0) {
  throw new Error('react preview nodes page heading not found');
}

const rowLocator = page.locator('[data-node-row="true"]');
const rowCount = await rowLocator.count();

if (rowCount > 0) {
  const firstName = ((await rowLocator.first().locator('[data-node-name="true"]').textContent()) || '').trim();
  if (!firstName) {
    throw new Error('react preview node row name is empty');
  }

  const searchTerm = firstName.slice(0, Math.min(firstName.length, 4));
  const searchResponse = page.waitForResponse(
    (response) => response.url().includes('/ipq/api/v1/nodes?q=') && response.status() === 200
  );
  await page.getByPlaceholder('搜索节点名称').fill(searchTerm);
  await page.getByPlaceholder('搜索节点名称').press('Enter');
  await searchResponse;

  const filteredCount = await rowLocator.count();
  if (filteredCount === 0) {
    throw new Error('react preview node search returned no rows');
  }

  await rowLocator.first().click();
  await page.locator('[data-detail-report="true"]').waitFor();

  const detailReportCount = await page.locator('[data-detail-report="true"]').count();
  if (detailReportCount === 0) {
    throw new Error('react preview node detail report section not found');
  }

  const recentChangeCount = await page.locator('[data-detail-change]').count();
  if (recentChangeCount === 0) {
    throw new Error('react preview recent change section not found');
  }

  const reportConfigCount = await page.locator('[data-node-report-config="true"]').count();
  if (reportConfigCount === 0) {
    throw new Error('react preview report config section not found');
  }

  await page.getByRole('link', { name: '历史变化' }).first().click();
  await page.locator('[data-history-change-list="true"]').waitFor();

  const historyChangeCount = await page.locator('[data-history-change-list="true"]').count();
  if (historyChangeCount === 0) {
    throw new Error('react preview history change list not found');
  }

  await page.getByRole('link', { name: '变化视图' }).first().click();
  await page.locator('[data-change-view="true"]').waitFor();

  const changeViewCount = await page.locator('[data-change-view="true"]').count();
  if (changeViewCount === 0) {
    throw new Error('react preview change view not found');
  }

  const changeFilterCount = await page.locator('[data-change-view-filters="true"]').count();
  if (changeFilterCount === 0) {
    throw new Error('react preview change view filters not found');
  }
} else {
  const emptyStateCount = await page.getByRole('heading', { name: '还没有节点' }).count();
  if (emptyStateCount === 0) {
    throw new Error('react preview nodes empty state not found');
  }
}

await page.screenshot({ path: `${outputDir}/react-preview-nodes.png`, fullPage: true });
writeFileSync(
  `${outputDir}/react-preview-nodes-summary.json`,
  JSON.stringify(
    {
      url: page.url(),
      rowCount
    },
    null,
    2
  )
);

await browser.close();
