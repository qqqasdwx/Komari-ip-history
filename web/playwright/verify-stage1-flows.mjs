import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const komariBaseURL = (process.env.KOMARI_BASE_URL || 'http://proxy:8080').replace(/\/$/, '');
const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
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

  "komari-ip-history/internal/config"
  "komari-ip-history/internal/database"
  "komari-ip-history/internal/models"
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

function seedHistoryBaseline(nodeUUID) {
  const scriptPath = '/workspace/web/playwright-output/ipq-seed-history-baseline.go';

  writeFileSync(
    scriptPath,
    `package main

import (
  "encoding/json"
  "os"
  "time"

  "komari-ip-history/internal/config"
  "komari-ip-history/internal/database"
  "komari-ip-history/internal/models"
)

func main() {
  cfg := config.Load()
  db, err := database.Open(cfg)
  if err != nil {
    panic(err)
  }

  var node models.Node
  if err := db.First(&node, "komari_node_uuid = ?", os.Getenv("IPQ_NODE_UUID")).Error; err != nil {
    panic(err)
  }

  recordedAt := time.Now().UTC().Add(-1 * time.Hour)
  payload := map[string]any{
    "Meta": map[string]any{
      "node_uuid": os.Getenv("IPQ_NODE_UUID"),
      "node_name": node.Name,
      "source": "mock",
      "updated_at": recordedAt.Format(time.RFC3339),
      "environment": "development",
    },
    "Score": map[string]any{
      "Scamalytics": 12,
      "AbuseIPDB": 0,
      "IPQS": 22,
    },
    "Media": map[string]any{
      "Netflix": map[string]any{
        "Status": "Yes",
        "Region": "US",
        "Type": "Originals",
      },
      "ChatGPT": map[string]any{
        "Status": "No",
        "Region": "HK",
        "Type": "Web",
      },
    },
    "Mail": map[string]any{
      "Blacklisted": 1,
    },
  }

  raw, err := json.MarshalIndent(payload, "", "  ")
  if err != nil {
    panic(err)
  }

  history := models.NodeHistory{
    NodeID: node.ID,
    ResultJSON: string(raw),
    Summary: "Playwright historical baseline",
    RecordedAt: recordedAt,
  }

  if err := db.Create(&history).Error; err != nil {
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
      IPQ_NODE_UUID: nodeUUID
    }
  });
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
  body: JSON.stringify({ name: 'Playwright Current Result Node' })
});
const client = JSON.parse(addClient.text);
const uuid = client.uuid;
const emptyNode = seedNoDataNode();

await page.goto(`${komariBaseURL}/instance/${uuid}`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(3000);
await page.locator('button', { hasText: /IP 质量|登录 IP 质量服务/ }).first().click();
await page.waitForTimeout(1500);
seedHistoryBaseline(uuid);

await page.goto(`${appBaseURL}/#/nodes`);
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
const detailReportConfigCount = await page.locator('[data-node-report-config="true"]').count();
const detailBackButtonCount = await page.locator('button[data-back="/nodes"]').count();
const detailBodyBeforeReport = await page.locator('body').innerText();
if (detailResultGroupCount === 0) {
  throw new Error('structured result groups not found on node detail page');
}
if (detailReportConfigCount === 0) {
  throw new Error('node report config section not found on detail page');
}
if (detailBackButtonCount === 0) {
  throw new Error('back button not found on node detail page');
}
if (detailGroupTitles.includes('Meta')) {
  throw new Error('Meta group should not be visible on node detail page');
}
if (detailBodyBeforeReport.includes('UUID') || detailBodyBeforeReport.includes('状态摘要')) {
  throw new Error('node detail page still shows internal metadata labels');
}

const detailResponse = await jsonFetch(page, `/api/v1/nodes/${uuid}`);
const detailPayload = JSON.parse(detailResponse.text);
const historyCountBeforeReport = detailPayload.history.length;
const reporterToken = detailPayload.report_config.reporter_token;
const reportedResult = JSON.parse(JSON.stringify(detailPayload.current_result));
reportedResult.Meta.updated_at = new Date().toISOString();
reportedResult.Meta.source = 'playwright-reporter';
reportedResult.Meta.reporter_run_id = randomUUID();
reportedResult.Score.Scamalytics = 9;
reportedResult.Score.AbuseIPDB = 1;
reportedResult.Mail.Blacklisted = 0;
await jsonFetch(page, `/api/v1/report/nodes/${uuid}`, {
  method: 'POST',
  headers: {
    'X-IPQ-Reporter-Token': reporterToken
  },
  body: JSON.stringify({
    summary: 'Playwright reporter update',
    result: reportedResult
  })
});

await page.reload();
await page.waitForTimeout(1000);
const detailAfterReportResponse = await jsonFetch(page, `/api/v1/nodes/${uuid}`);
const detailAfterReportPayload = JSON.parse(detailAfterReportResponse.text);
if ((detailAfterReportPayload.history?.length || 0) <= historyCountBeforeReport) {
  throw new Error('history count did not increase after reporter update');
}

await page.goto(`${appBaseURL}/#/nodes/${uuid}?embed=1`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

const embedResultGroupCount = await page.locator('.result-group').count();
const embedGroupTitles = await page.locator('.result-group h3').allInnerTexts();
const embedReportConfigCount = await page.locator('[data-node-report-config="true"]').count();
if (embedResultGroupCount === 0) {
  throw new Error('structured result groups not found on embed page');
}
if (embedGroupTitles.includes('Meta')) {
  throw new Error('Meta group should not be visible on embed page');
}
if (embedReportConfigCount !== 0) {
  throw new Error('embed page should not show report config section');
}

await page.goto(`${appBaseURL}/#/nodes/${uuid}/history`);
await page.waitForURL(`**/#/nodes/${uuid}`);
const historyUrl = page.url();
if (!historyUrl.endsWith(`/#/nodes/${uuid}`)) {
  throw new Error('history route should redirect back to node detail page');
}

await page.goto(`${appBaseURL}/#/nodes/${uuid}/changes`);
await page.waitForURL(`**/#/nodes/${uuid}`);
const changesUrl = page.url();
if (!changesUrl.endsWith(`/#/nodes/${uuid}`)) {
  throw new Error('changes route should redirect back to node detail page');
}

const dialogMessages = [];
page.on('dialog', async (dialog) => {
  dialogMessages.push(dialog.message());
  await dialog.accept();
});

await page.goto(`${appBaseURL}/#/settings/integration`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(500);
const integrationBody = await page.locator('body').innerText();
if (!integrationBody.includes('接入配置') || !integrationBody.includes('完整内联版')) {
  throw new Error('integration settings page does not emphasize current setup flow');
}
const copyButton = page.getByRole('button', { name: '复制 loader 版' });
const copyButtonCount = await copyButton.count();
if (copyButtonCount > 0) {
  await copyButton.click();
  await page.waitForTimeout(500);
}

await page.goto(`${appBaseURL}/#/settings/fields`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(300);
const fieldGroupCount = await page.locator('.field-group').count();
const mediaGroup = page.locator('.field-group').filter({ hasText: 'Media' }).first();
const mediaUncheckButton = mediaGroup.getByRole('button', { name: '全不选' });
if ((await mediaUncheckButton.count()) > 0) {
  await mediaUncheckButton.click();
  await page.waitForTimeout(200);
}
await page.getByRole('button', { name: '保存字段配置' }).click();
await page.waitForTimeout(500);

await page.goto(`${appBaseURL}/#/nodes`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);

await page.goto(`${appBaseURL}/#/nodes/${uuid}`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);
const detailMediaVisibleAfterHide = await page.locator('.report-group-title', { hasText: '流媒体与服务' }).count();
const detailBodyAfterRules = await page.locator('body').innerText();

await page.goto(`${appBaseURL}/#/nodes/${uuid}?embed=1`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(300);
const embedMediaVisibleAfterHide = await page.locator('.report-group-title', { hasText: '流媒体与服务' }).count();

if (fieldGroupCount === 0) {
  throw new Error('grouped field toggles not found on settings page');
}
if (detailMediaVisibleAfterHide > 0 || embedMediaVisibleAfterHide > 0) {
  throw new Error('hidden Media group still visible after saving field settings');
}
if (detailBodyAfterRules.includes('UUID')) {
  throw new Error('user-facing pages still expose internal metadata after redesign');
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
      detailReportConfigCount,
      detailBackButtonCount,
      embedResultGroupCount,
      embedGroupTitles,
      embedReportConfigCount,
      historyUrl,
      changesUrl,
      fieldGroupCount,
      detailMediaVisibleAfterHide,
      embedMediaVisibleAfterHide,
      copyButtonCount,
      dialogMessages
    },
    null,
    2
  )
);

await browser.close();
