import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const komariBaseURL = (process.env.KOMARI_BASE_URL || 'http://proxy:8080').replace(/\/$/, '');
const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
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

async function loginApp(page) {
  await page.goto(`${appBaseURL}/#/login`);
  await page.getByRole('textbox', { name: '用户名' }).fill('admin');
  await page.getByLabel('密码').fill('admin');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/#/nodes');
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();

await loginApp(page);

const headerPreview = await jsonFetch(page, '/api/v1/admin/header-preview?variant=loader');
const loaderCode = JSON.parse(headerPreview.text).code;

await page.goto(`${komariBaseURL}/`);
await jsonFetch(page, '/api/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'admin', password: 'admin' })
});
await jsonFetch(page, '/api/admin/settings/', {
  method: 'POST',
  body: JSON.stringify({ custom_head: loaderCode })
});

const addClient = await jsonFetch(page, '/api/admin/client/add', {
  method: 'POST',
  body: JSON.stringify({ name: 'Playwright Inject Node' })
});
const client = JSON.parse(addClient.text);
const uuid = client.uuid;

await page.goto(`${komariBaseURL}/instance/${uuid}`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(4000);

const buttonTexts = await page.locator('button').evaluateAll((elements) =>
  elements
    .map((element) => ({
      text: (element.textContent || '').trim(),
      className: element.className,
      visible: !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
    }))
    .filter((item) => item.text)
);

const target = page.locator('button', { hasText: /IP 质量|登录 IP 质量服务/ }).first();
const targetCount = await target.count();
let clicked = false;
let overlayFound = false;
let iframeSrc = '';
let targetMeta = null;
if (targetCount > 0) {
  targetMeta = await target.evaluate((element) => ({
    text: (element.textContent || '').trim(),
    className: element.className,
    parentClassName: element.parentElement ? element.parentElement.className : '',
    insideInlineSlot: !!element.closest('.ipq-loader-inline-slot'),
    floating: element.classList.contains('ipq-floating')
  }));
  await target.click();
  clicked = true;
  await page.waitForTimeout(1500);
  const overlay = page.locator('#ipq-loader-overlay[data-open="true"]');
  overlayFound = (await overlay.count()) > 0;
  const frame = page.locator('#ipq-loader-overlay iframe');
  if ((await frame.count()) > 0) {
    iframeSrc = (await frame.first().getAttribute('src')) || '';
  }
}

await page.screenshot({ path: `${outputDir}/instance-injection.png`, fullPage: true });
const bodyText = await page.locator('body').innerText();
const html = await page.content();
writeFileSync(`${outputDir}/instance-injection.html`, html);
writeFileSync(`${outputDir}/instance-injection.txt`, bodyText);
writeFileSync(
  `${outputDir}/instance-injection-summary.json`,
  JSON.stringify(
    {
      uuid,
      url: page.url(),
      title: await page.title(),
      buttonTexts,
      targetMeta,
      clicked,
      overlayFound,
      iframeSrc,
      bodyPreview: bodyText.slice(0, 5000)
    },
    null,
    2
  )
);

await browser.close();
