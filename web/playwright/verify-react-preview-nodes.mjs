import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const outputDir = '/workspace/web/playwright-output';
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();

async function jsonFetch(page, url, options) {
  return page.evaluate(
    async ({ url, options }) => {
      const response = await fetch(url, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {})
        },
        ...options
      });
      const text = await response.text();
      return { status: response.status, text };
    },
    { url, options }
  );
}

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
  const preferredNodeNames = ['开发种子-多IP历史', '开发种子-单IP历史', '通信样式测试'];
  let chosenRow = rowLocator.first();
  for (const name of preferredNodeNames) {
    const candidate = rowLocator.filter({ hasText: name }).first();
    if ((await candidate.count()) > 0) {
      chosenRow = candidate;
      break;
    }
  }

  const firstUUID = await chosenRow.getAttribute('data-node-uuid');
  const firstName = ((await chosenRow.locator('[data-node-name="true"]').textContent()) || '').trim();
  if (!firstName || !firstUUID) {
    throw new Error('react node row data is empty');
  }

  const searchTerm = firstName.slice(0, Math.min(firstName.length, 4));
  await page.getByPlaceholder('搜索节点名称').fill(searchTerm);
  await page.getByPlaceholder('搜索节点名称').press('Enter');
  await page.waitForLoadState('networkidle');

  const filteredCount = await rowLocator.count();
  if (filteredCount === 0) {
    await page.getByPlaceholder('搜索节点名称').fill('');
    await page.getByPlaceholder('搜索节点名称').press('Enter');
    await page.waitForLoadState('networkidle');
  }

  await chosenRow.getByRole('button', { name: '上报设置' }).click();
  await page.locator('[data-node-report-config="true"]').waitFor({ state: 'visible', timeout: 10000 });
  if ((await page.getByText('接入命令', { exact: true }).count()) === 0) {
    await page.getByPlaceholder('例如 1.1.1.1 或 2606:4700:4700::1111').fill('203.0.113.10');
    await page.getByRole('button', { name: '添加 IP' }).click();
  }

  const reportConfigCount = await page.locator('[data-node-report-config="true"]').count();
  if (reportConfigCount === 0) {
    throw new Error('react node list modal missing report config');
  }
  const configText = await page.locator('[data-node-report-config="true"]').innerText();
  const installCommandCount = await page.getByText('接入命令', { exact: true }).count();
  if (installCommandCount === 0) {
    throw new Error('react node list modal missing install command');
  }
  if (!configText.includes('当前命令会顺序探查以下 IP') && !configText.includes('请先添加目标 IP，添加后才会生成接入命令。')) {
    throw new Error('react detail page missing monitored IP hint');
  }
  if (configText.includes('上报地址') || configText.includes('Reporter Token')) {
    throw new Error('react detail page still exposes report endpoint or token');
  }
  if (!configText.includes('Cron') || !configText.includes('最近 10 次执行时间')) {
    throw new Error('react detail page missing schedule controls');
  }
  if (!configText.includes('raw.githubusercontent.com/qqqasdwx/Komari-ip-history/main/deploy/install.sh')) {
    throw new Error('react node list modal install command is not using GitHub raw install script');
  }
  await page.getByRole('button', { name: '关闭' }).click();

  await page.locator(`[data-node-row="true"][data-node-uuid="${firstUUID}"]`).click({ position: { x: 24, y: 24 } });
  await page.waitForURL(`**/#/nodes/${firstUUID}`);
  await page.waitForLoadState('networkidle');
  const detailReport = page.locator('[data-detail-report="true"]');
  await detailReport.waitFor();

  const detailData = JSON.parse(
    (await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${firstUUID}`)).text
  );
  const currentTarget = detailData.current_target;
  const reporterToken = detailData.report_config.reporter_token;
  if (currentTarget?.ip && reporterToken) {
    const historyResponse = JSON.parse(
      (
        await jsonFetch(
          page,
          `${appBaseURL}/api/v1/nodes/${firstUUID}/history?target_id=${currentTarget.id}&limit=3`
        )
      ).text
    );
    const existingCount = Array.isArray(historyResponse.items) ? historyResponse.items.length : 0;
    if (existingCount < 2) {
      for (let index = 0; index < 2; index += 1) {
        const nextResult = structuredClone(currentTarget.current_result ?? {});
        if (!nextResult.Score || typeof nextResult.Score !== 'object') {
          nextResult.Score = {};
        }
        nextResult.Score.IPQS = 30 + index;
        nextResult.Head = {
          ...(typeof nextResult.Head === 'object' && nextResult.Head ? nextResult.Head : {}),
          ReportTime: `history-seed-${index}`
        };
        const reportResponse = await jsonFetch(page, `${appBaseURL}/api/v1/report/nodes/${firstUUID}`, {
          method: 'POST',
          headers: {
            'X-IPQ-Reporter-Token': reporterToken
          },
          body: JSON.stringify({
            target_ip: currentTarget.ip,
            summary: `Playwright history seed ${index + 1}`,
            result: nextResult
          })
        });
        if (reportResponse.status < 200 || reportResponse.status >= 300) {
          throw new Error(`failed to seed history: ${reportResponse.status} ${reportResponse.text}`);
        }
      }
      await page.reload({ waitUntil: 'networkidle' });
    }
  }

  const detailURL = page.url();
  const detailReportConfigButtonCount = await page.getByRole('button', { name: '上报设置' }).count();
  if (detailReportConfigButtonCount !== 0) {
    throw new Error('react detail page should not expose report config entry');
  }
  const historyLinkCount = await page.getByRole('link', { name: '查看历史记录' }).count();
  if (historyLinkCount > 0) {
    await page.getByRole('link', { name: '查看历史记录' }).click();
    await page.waitForURL('**/#/nodes/**/history**');
    await page.getByText('字段变化', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('link', { name: '快照对比' }).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('button', { name: /全部时间|今天|近 7 天|本周|近 30 天|本月/ }).click();
    const dateInputs = page.locator('input[type="datetime-local"]');
    await dateInputs.nth(0).fill('2026-04-02T00:00');
    await dateInputs.nth(1).fill('2026-04-02T23:59');
    await page.getByRole('button', { name: '应用筛选' }).click();
    await page.locator('[data-history-change-row="true"]').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('link', { name: '快照对比' }).click();
    await page.waitForURL('**/#/nodes/**/compare**');
    await page.getByText('时间范围', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    await page.goto(detailURL);
    await page.waitForLoadState('networkidle');
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
