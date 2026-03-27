import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const baseURL = 'http://proxy:8080';
const outputDir = '/workspace/web/playwright-output';
mkdirSync(outputDir, { recursive: true });

function seedNoDataNode() {
  const scriptPath = '/workspace/web/playwright-output/ipq-seed-no-data-node.go';
  const nodeUUID = randomUUID();
  const nodeName = 'Playwright Empty Node';

  writeFileSync(
    scriptPath,
    `package main

import (
  "os"
  "time"

  "komari-ip-history/internal/database"
  "komari-ip-history/internal/models"
  "komari-ip-history/internal/config"
)

func main() {
  cfg := config.Load()
  db, err := database.Open(cfg)
  if err != nil {
    panic(err)
  }

  node := models.Node{
    KomariNodeUUID: os.Getenv("IPQ_NODE_UUID"),
    Name: os.Getenv("IPQ_NODE_NAME"),
    HasData: false,
    CurrentSummary: "",
    CreatedAt: time.Now().UTC(),
    UpdatedAt: time.Now().UTC(),
  }

  if err := db.Create(&node).Error; err != nil {
    panic(err)
  }
}`
  );

  execFileSync('sh', ['-lc', `cd /workspace && go run ${scriptPath}`], {
    stdio: 'inherit',
    env: {
      ...process.env,
      IPQ_APP_ENV: process.env.IPQ_APP_ENV || 'development',
      IPQ_DB_PATH: process.env.IPQ_DB_PATH || '/workspace/data/ipq/ipq.db',
      IPQ_NODE_UUID: nodeUUID,
      IPQ_NODE_NAME: nodeName
    }
  });

  return { nodeUUID, nodeName };
}

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
const emptyNode = seedNoDataNode();

await page.goto(`/instance/${uuid}`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(3000);
await page.locator('button', { hasText: /IP 质量|登录 IP 质量服务/ }).first().click();
await page.waitForTimeout(1500);

await page.goto('/ipq/#/nodes');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

const structuredListSummaryCount = await page.locator('[data-node-summary="structured"]').count();
const emptyListSummaryCount = await page.locator('[data-node-summary="empty"]').count();
const emptyCardVisible = await page.locator(`a[href="#/nodes/${emptyNode.nodeUUID}"]`).count();
if (structuredListSummaryCount === 0) {
  throw new Error('structured summary cards not found on node list page');
}
if (emptyListSummaryCount === 0 || emptyCardVisible === 0) {
  throw new Error('empty summary card not found on node list page');
}

await page.locator(`a[href="#/nodes/${uuid}"]`).first().click();
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
      emptyNodeUUID: emptyNode.nodeUUID,
      structuredListSummaryCount,
      emptyListSummaryCount,
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
