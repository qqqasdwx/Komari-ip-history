import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const baseURL = 'http://proxy:8080';
const outputDir = '/workspace/web/playwright-output';
mkdirSync(outputDir, { recursive: true });

async function jsonFetch(page, url, options) {
  return page.evaluate(async ({ url, options }) => {
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
  }, { url, options });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();

await page.goto('/');
await jsonFetch(page, '/api/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'admin', password: 'admin' })
});
await jsonFetch(page, '/ipq/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'admin', password: 'admin' })
});

const headerPreview = await jsonFetch(page, '/ipq/api/v1/admin/header-preview?variant=loader');
const loaderCode = JSON.parse(headerPreview.text).code;
await jsonFetch(page, '/api/admin/settings/', {
  method: 'POST',
  body: JSON.stringify({ custom_head: loaderCode })
});

const addClient = await jsonFetch(page, '/api/admin/client/add', {
  method: 'POST',
  body: JSON.stringify({ name: 'Playwright History Node' })
});
const client = JSON.parse(addClient.text);
const uuid = client.uuid;

await page.goto(`/instance/${uuid}`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(3000);
await page.locator('button', { hasText: /IP 质量|登录 IP 质量服务/ }).first().click();
await page.waitForTimeout(1500);

await page.goto(`/ipq/#/nodes/${uuid}`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

const detailResultGroupCount = await page.locator('.result-group').count();
const detailGroupTitles = await page.locator('.result-group h3').allInnerTexts();
if (detailResultGroupCount === 0) {
  throw new Error('structured result groups not found on node detail page');
}

await page.goto(`/ipq/#/nodes/${uuid}?embed=1`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

const embedResultGroupCount = await page.locator('.result-group').count();
const embedGroupTitles = await page.locator('.result-group h3').allInnerTexts();
if (embedResultGroupCount === 0) {
  throw new Error('structured result groups not found on embed page');
}

await page.goto(`/ipq/#/nodes/${uuid}/history`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);

const historyBody = await page.locator('body').innerText();
const historyUrl = page.url();
const historyCards = await page.locator('[data-history-record]').count();
const codeBlocks = await page.locator('.code-block').count();

let copyDialogMessage = '';
page.once('dialog', async (dialog) => {
  copyDialogMessage = dialog.message();
  await dialog.accept();
});
await page.goto('/ipq/#/settings');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(500);
const copyButtonCount = await page.locator('#copy-loader-button').count();
if (copyButtonCount > 0) {
  await page.locator('#copy-loader-button').click();
  await page.waitForTimeout(500);
}

writeFileSync(
  `${outputDir}/stage1-flows-summary.json`,
  JSON.stringify(
    {
      uuid,
      detailResultGroupCount,
      detailGroupTitles,
      embedResultGroupCount,
      embedGroupTitles,
      historyUrl,
      historyCards,
      codeBlocks,
      historyBodyPreview: historyBody.slice(0, 5000),
      copyButtonCount,
      copyDialogMessage
    },
    null,
    2
  )
);

await browser.close();
