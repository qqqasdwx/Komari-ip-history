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
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1024 } });
const page = await context.newPage();

await page.goto('/');

const komariLogin = await jsonFetch(page, '/api/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'admin', password: 'admin' })
});

const appLogin = await jsonFetch(page, '/ipq/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'admin', password: 'admin' })
});

const addClient = await jsonFetch(page, '/api/admin/client/add', {
  method: 'POST',
  body: JSON.stringify({ name: 'Playwright Node' })
});

let clientData = null;
try {
  clientData = JSON.parse(addClient.text);
} catch {
  clientData = { raw: addClient.text };
}

await page.goto('/');
await page.waitForLoadState('networkidle');
await page.screenshot({ path: `${outputDir}/komari-home.png`, fullPage: true });

const links = await page.locator('a[href]').evaluateAll((elements) =>
  elements.map((element) => ({
    href: element.getAttribute('href'),
    text: (element.textContent || '').trim()
  }))
);

const buttons = await page.locator('button').evaluateAll((elements) =>
  elements.map((element) => (element.textContent || '').trim()).filter(Boolean)
);

const text = await page.locator('body').innerText();
const html = await page.content();

writeFileSync(`${outputDir}/komari-home.html`, html);
writeFileSync(`${outputDir}/komari-home.txt`, text);
writeFileSync(
  `${outputDir}/summary.json`,
  JSON.stringify(
    {
      komariLogin,
      appLogin,
      addClientStatus: addClient.status,
      clientData,
      finalUrl: page.url(),
      title: await page.title(),
      links,
      buttons,
      textPreview: text.slice(0, 4000)
    },
    null,
    2
  )
);

await browser.close();
