import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const outputDir = '/workspace/web/playwright-output';
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();

await page.goto(`${appBaseURL}/#/login`);
await page.getByRole('textbox', { name: '用户名' }).fill('admin');
await page.getByLabel('密码').fill('admin');
await page.getByRole('button', { name: '登录' }).click();
await page.waitForURL('**/#/nodes');
await page.waitForLoadState('networkidle');

const headingCount = await page.getByRole('heading', { name: '节点列表' }).count();
if (headingCount === 0) {
  throw new Error('react nodes page heading not found');
}

const rowLocator = page.locator('[data-node-row="true"]');
const rowCount = await rowLocator.count();

if (rowCount > 0) {
  const firstUUID = await rowLocator.first().getAttribute('href');
  const firstName = ((await rowLocator.first().locator('[data-node-name="true"]').textContent()) || '').trim();
  if (!firstName || !firstUUID) {
    throw new Error('react node row data is empty');
  }

  const searchTerm = firstName.slice(0, Math.min(firstName.length, 4));
  const searchResponse = page.waitForResponse(
    (response) => response.url().includes('/api/v1/nodes?q=') && response.status() === 200
  );
  await page.getByPlaceholder('搜索节点名称').fill(searchTerm);
  await page.getByPlaceholder('搜索节点名称').press('Enter');
  await searchResponse;

  const filteredCount = await rowLocator.count();
  if (filteredCount === 0) {
    await page.getByPlaceholder('搜索节点名称').fill('');
    await page.getByPlaceholder('搜索节点名称').press('Enter');
    await page.waitForLoadState('networkidle');
  }

  await rowLocator.first().click();
  await page.waitForURL('**/#/nodes/**');
  await page.waitForLoadState('networkidle');
  const detailReport = page.locator('[data-detail-report="true"]');
  if ((await detailReport.count()) === 0) {
    await page.getByPlaceholder('例如 1.1.1.1 或 2606:4700:4700::1111').fill('203.0.113.10');
    await page.getByRole('button', { name: '添加 IP' }).click();
  }

  await detailReport.waitFor();

  const detailReportCount = await detailReport.count();
  const reportConfigCount = await page.locator('[data-node-report-config="true"]').count();
  if (detailReportCount === 0 || reportConfigCount === 0) {
    throw new Error('react detail page missing current report or report config');
  }
  const installCommandCount = await page.getByText('接入命令', { exact: true }).count();
  if (installCommandCount === 0) {
    throw new Error('react detail page missing install command');
  }

  const detailHash = new URL(page.url()).hash.replace(/^#/, '');
  await page.goto(`${appBaseURL}/#${detailHash}${detailHash.includes('?') ? '&' : '?'}embed=1`);
  await page.locator('[data-detail-report="true"]').waitFor({ state: 'visible', timeout: 10000 });

  const embedReportCount = await page.locator('[data-detail-report="true"]').count();
  const embedReportConfigCount = await page.locator('[data-node-report-config="true"]').count();
  if (embedReportCount === 0) {
    throw new Error('react embed detail report section not found');
  }
  if (embedReportConfigCount !== 0) {
    throw new Error('react embed page should not show report config');
  }
} else {
  const emptyStateCount = await page.getByRole('heading', { name: '还没有节点' }).count();
  if (emptyStateCount === 0) {
    throw new Error('react nodes empty state not found');
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
