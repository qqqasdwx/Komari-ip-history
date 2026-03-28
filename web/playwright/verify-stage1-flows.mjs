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
await jsonFetch(page, '/ipq/api/v1/admin/display-fields', {
  method: 'PUT',
  body: JSON.stringify({ hidden_paths: [] })
});
await jsonFetch(page, '/ipq/api/v1/admin/change-priority', {
  method: 'PUT',
  body: JSON.stringify({ secondary_paths: ['Meta'] })
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
seedHistoryBaseline(uuid);

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
const detailRecentChangeCount = await page.locator('[data-detail-change="overview"]').count();
const detailRecentChangeCards = await page.locator('.change-card').count();
const detailChangeEntryCount = await page.locator('[data-detail-change-entry="true"]').count();
const detailPrimaryChangeLabelCount = await page.locator('.change-card strong', { hasText: '重点变化' }).count();
const detailReportConfigCount = await page.locator('[data-node-report-config="true"]').count();
const detailBackButtonCount = await page.locator('button[data-back="/nodes"]').count();
const detailBodyBeforeReport = await page.locator('body').innerText();
if (detailResultGroupCount === 0) {
  throw new Error('structured result groups not found on node detail page');
}
if (detailRecentChangeCount === 0 || detailRecentChangeCards === 0) {
  throw new Error('recent change summary not found on node detail page');
}
if (detailChangeEntryCount === 0) {
  throw new Error('recent change entries not found on node detail page');
}
if (detailPrimaryChangeLabelCount === 0) {
  throw new Error('primary change sections not found on node detail page');
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

const detailResponse = await jsonFetch(page, `/ipq/api/v1/nodes/${uuid}`);
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
await jsonFetch(page, `/ipq/api/v1/report/nodes/${uuid}`, {
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
const detailRecentChangeCountAfterReport = await page.locator('[data-detail-change]').count();
if (detailRecentChangeCountAfterReport === 0) {
  throw new Error('recent change section missing after reporter update');
}

const detailAfterReportResponse = await jsonFetch(page, `/ipq/api/v1/nodes/${uuid}`);
const detailAfterReportPayload = JSON.parse(detailAfterReportResponse.text);
if ((detailAfterReportPayload.history?.length || 0) <= historyCountBeforeReport) {
  throw new Error('history count did not increase after reporter update');
}

await page.goto(`/ipq/#/nodes/${uuid}?embed=1`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

const embedResultGroupCount = await page.locator('.result-group').count();
const embedGroupTitles = await page.locator('.result-group h3').allInnerTexts();
if (embedResultGroupCount === 0) {
  throw new Error('structured result groups not found on embed page');
}
if (embedGroupTitles.includes('Meta')) {
  throw new Error('Meta group should not be visible on embed page');
}

await page.goto(`/ipq/#/nodes/${uuid}/history`);
await page.waitForLoadState('networkidle');
await page.locator('[data-history-change-list="true"]').waitFor({ state: 'visible', timeout: 10000 });
await page.waitForTimeout(300);

const historyBody = await page.locator('body').innerText();
const historyUrl = page.url();
const historyCards = await page.locator('[data-history-record]').count();
const historyChangeEntryCount = await page.locator('[data-history-change-entry="true"]').count();
const historyPrimaryChangeLabelCount = await page.locator('[data-history-change-list="true"] strong', { hasText: '重点变化' }).count();
const changedBadgeCount = await page.locator('.diff-badge.changed').count();
const addedBadgeCount = await page.locator('.diff-badge.added').count();
const unchangedBadgeCount = await page.locator('.diff-badge.unchanged').count();
const codeBlocks = await page.locator('.code-block').count();
const historyBackButtonCount = await page.locator(`button[data-back="/nodes/${uuid}"]`).count();
if (historyChangeEntryCount === 0) {
  throw new Error('history change entries not found');
}
if (historyPrimaryChangeLabelCount === 0) {
  throw new Error('primary change sections not found on history page');
}
if (historyBackButtonCount === 0) {
  throw new Error('back button not found on history page');
}
if (historyBody.includes('Meta') || historyBody.includes('UUID')) {
  throw new Error('history page still shows hidden metadata');
}

await page.goto(`/ipq/#/nodes/${uuid}/changes`);
await page.waitForLoadState('networkidle');
await page.locator('[data-change-view="true"]').waitFor({ state: 'visible', timeout: 10000 });
await page.waitForTimeout(300);

const changeViewCount = await page.locator('[data-change-view="true"]').count();
const changeViewOverviewCount = await page.locator('[data-change-view-overview="true"]').count();
const changeViewListCount = await page.locator('[data-change-view-list="true"]').count();
const changeViewEntryCount = await page.locator('[data-change-view-entry="true"]').count();
const changeViewBackButtonCount = await page.locator(`button[data-back="/nodes/${uuid}"]`).count();
const changeViewBodyBeforeRules = await page.locator('body').innerText();
const changeViewRecordCountBeforeFilter = await page.locator('[data-change-record]').count();
if (changeViewCount === 0 || changeViewOverviewCount === 0 || changeViewListCount === 0) {
  throw new Error('change view page not rendered');
}
if (changeViewEntryCount === 0) {
  throw new Error('change view entries not found');
}
if (changeViewBackButtonCount === 0) {
  throw new Error('back button not found on change view page');
}
if (changeViewBodyBeforeRules.includes('UUID') || changeViewBodyBeforeRules.includes('变化趋势')) {
  throw new Error('change view still shows metadata or trend clutter');
}
await page.locator('#change-filter-changed-only').check();
await page.waitForTimeout(300);
const changeViewRecordCountAfterChangedOnly = await page.locator('[data-change-record]').count();
if (changeViewRecordCountAfterChangedOnly >= changeViewRecordCountBeforeFilter) {
  throw new Error('changed-only filter did not reduce visible change records');
}
await page.locator('#change-filter-group').selectOption('Score');
await page.waitForTimeout(300);
const changeViewEntryCountAfterScoreFilter = await page.locator('[data-change-view-entry="true"]').count();
if (changeViewEntryCountAfterScoreFilter === 0) {
  throw new Error('score filter did not keep visible change entries');
}
await page.locator('#change-filter-group').selectOption('all');
await page.locator('#change-filter-changed-only').uncheck();
await page.waitForTimeout(300);

const dialogMessages = [];
page.on('dialog', async (dialog) => {
  dialogMessages.push(dialog.message());
  await dialog.accept();
});
await page.goto('/ipq/#/settings');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(500);
const settingsBody = await page.locator('body').innerText();
const advancedDisplaySummary = page.locator('summary', { hasText: '高级展示配置' }).first();
if ((await advancedDisplaySummary.count()) > 0) {
  await advancedDisplaySummary.click();
  await page.waitForTimeout(200);
}
const fieldGroupCount = await page.locator('.field-group').count();
const changePriorityGroupToggleCount = await page.locator('[data-change-priority-group-toggle]').count();
const mediaUncheckButton = page.locator('[data-field-group-toggle="Media"][data-field-group-mode="uncheck"]').first();
if ((await mediaUncheckButton.count()) > 0) {
  await mediaUncheckButton.click();
  await page.waitForTimeout(200);
}
await page.locator('#save-fields-button').click();
await page.waitForTimeout(500);
const scorePriorityToggle = page.locator('[data-change-priority-path="Score.Scamalytics"]').first();
if ((await scorePriorityToggle.count()) > 0) {
  await scorePriorityToggle.check();
  await page.waitForTimeout(200);
}
await page.locator('#save-change-priority-button').click();
await page.waitForTimeout(500);
const copyButtonCount = await page.locator('#copy-loader-button').count();
if (copyButtonCount > 0) {
  await page.locator('#copy-loader-button').click();
  await page.waitForTimeout(500);
}

await page.goto('/ipq/#/nodes');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);
const listMediaVisibleAfterHide = await page.locator('.summary-section strong', { hasText: '媒体能力' }).count();

await page.goto(`/ipq/#/nodes/${uuid}`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);
const detailMediaVisibleAfterHide = await page.locator('.result-group h3', { hasText: 'Media' }).count();
const detailBodyAfterRules = await page.locator('body').innerText();
const detailScoreChangeCard = page.locator('[data-detail-change="overview"] .change-card').filter({ hasText: 'Score' }).first();
const detailScorePrimarySectionCount = await detailScoreChangeCard.locator('.change-section .summary-head strong', { hasText: '重点变化' }).count();
const detailScoreSecondarySectionCount = await detailScoreChangeCard.locator('.change-section .summary-head strong', { hasText: '辅助变化' }).count();
const detailScorePrimaryAbuseCount = await detailScoreChangeCard
  .locator('.change-section')
  .filter({ hasText: '重点变化' })
  .locator('.change-entry strong', { hasText: 'Abuse IPDB' })
  .count();
const detailScoreSecondaryScamalyticsCount = await detailScoreChangeCard
  .locator('.change-section')
  .filter({ hasText: '辅助变化' })
  .locator('.change-entry strong', { hasText: 'Scamalytics' })
  .count();

await page.goto(`/ipq/#/nodes/${uuid}/history`);
await page.waitForLoadState('networkidle');
await page.locator('[data-history-change-list="true"]').waitFor({ state: 'visible', timeout: 10000 });
await page.waitForTimeout(300);
const historyMediaVisibleAfterHide = await page.locator('[data-history-structured="true"] h3', { hasText: 'Media' }).count();
const historyBodyAfterRules = await page.locator('body').innerText();
const historyScoreChangeCard = page.locator('[data-history-change-list="true"] .change-card').filter({ hasText: 'Score' }).first();
const historyScorePrimarySectionCount = await historyScoreChangeCard.locator('.change-section .summary-head strong', { hasText: '重点变化' }).count();
const historyScoreSecondarySectionCount = await historyScoreChangeCard.locator('.change-section .summary-head strong', { hasText: '辅助变化' }).count();
const historyScorePrimaryAbuseCount = await historyScoreChangeCard
  .locator('.change-section')
  .filter({ hasText: '重点变化' })
  .locator('.change-entry strong', { hasText: 'Abuse IPDB' })
  .count();
const historyScoreSecondaryScamalyticsCount = await historyScoreChangeCard
  .locator('.change-section')
  .filter({ hasText: '辅助变化' })
  .locator('.change-entry strong', { hasText: 'Scamalytics' })
  .count();

await page.goto(`/ipq/#/nodes/${uuid}/changes`);
await page.waitForLoadState('networkidle');
await page.locator('[data-change-view="true"]').waitFor({ state: 'visible', timeout: 10000 });
await page.waitForTimeout(300);
const changeViewBodyAfterRules = await page.locator('body').innerText();
const changeViewScoreChangeCard = page.locator('[data-change-view-list="true"] .change-card').filter({ hasText: 'Score' }).first();
const changeViewScorePrimarySectionCount = await changeViewScoreChangeCard.locator('.change-section .summary-head strong', { hasText: '重点变化' }).count();
const changeViewScoreSecondarySectionCount = await changeViewScoreChangeCard.locator('.change-section .summary-head strong', { hasText: '辅助变化' }).count();
const changeViewScorePrimaryAbuseCount = await changeViewScoreChangeCard
  .locator('.change-section')
  .filter({ hasText: '重点变化' })
  .locator('.change-entry strong', { hasText: 'Abuse IPDB' })
  .count();
const changeViewScoreSecondaryScamalyticsCount = await changeViewScoreChangeCard
  .locator('.change-section')
  .filter({ hasText: '辅助变化' })
  .locator('.change-entry strong', { hasText: 'Scamalytics' })
  .count();
if (fieldGroupCount === 0) {
  throw new Error('grouped field toggles not found on settings page');
}
if (changePriorityGroupToggleCount === 0) {
  throw new Error('grouped change priority toggles not found on settings page');
}
if (!settingsBody.includes('接入 Komari') || !settingsBody.includes('高级展示配置')) {
  throw new Error('settings page does not emphasize Komari setup flow');
}
if (detailMediaVisibleAfterHide > 0 || historyMediaVisibleAfterHide > 0) {
  throw new Error('hidden Media group still visible after saving field settings');
}
if (
  detailBodyAfterRules.includes('UUID') ||
  historyBodyAfterRules.includes('UUID') ||
  changeViewBodyAfterRules.includes('UUID')
) {
  throw new Error('user-facing pages still expose internal metadata after redesign');
}
if (
  detailScorePrimarySectionCount === 0 ||
  detailScorePrimaryAbuseCount === 0 ||
  detailScoreSecondarySectionCount !== 0 ||
  detailScoreSecondaryScamalyticsCount !== 0
) {
  throw new Error('detail page did not stay focused on primary Score changes');
}
if (
  historyScorePrimarySectionCount === 0 ||
  historyScoreSecondarySectionCount === 0 ||
  historyScorePrimaryAbuseCount === 0 ||
  historyScoreSecondaryScamalyticsCount === 0
) {
  throw new Error('history page did not apply field-level change priority split inside Score group');
}
if (
  changeViewScorePrimarySectionCount === 0 ||
  changeViewScoreSecondarySectionCount === 0 ||
  changeViewScorePrimaryAbuseCount === 0 ||
  changeViewScoreSecondaryScamalyticsCount === 0
) {
  throw new Error('change view did not apply field-level change priority split inside Score group');
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
      detailRecentChangeCount,
      detailRecentChangeCards,
      detailChangeEntryCount,
      detailPrimaryChangeLabelCount,
      detailReportConfigCount,
      embedResultGroupCount,
      embedGroupTitles,
      historyUrl,
      historyCards,
      historyChangeEntryCount,
      historyPrimaryChangeLabelCount,
      historyBackButtonCount,
      changeViewCount,
      changeViewOverviewCount,
      changeViewListCount,
      changeViewEntryCount,
      changeViewBackButtonCount,
      changeViewRecordCountBeforeFilter,
      changeViewRecordCountAfterChangedOnly,
      changeViewEntryCountAfterScoreFilter,
      changedBadgeCount,
      addedBadgeCount,
      unchangedBadgeCount,
      fieldGroupCount,
      detailBackButtonCount,
      listMediaVisibleAfterHide,
      detailMediaVisibleAfterHide,
      historyMediaVisibleAfterHide,
      codeBlocks,
      changePriorityGroupToggleCount,
      detailScorePrimarySectionCount,
      detailScoreSecondarySectionCount,
      detailScorePrimaryAbuseCount,
      detailScoreSecondaryScamalyticsCount,
      historyScorePrimarySectionCount,
      historyScoreSecondarySectionCount,
      historyScorePrimaryAbuseCount,
      historyScoreSecondaryScamalyticsCount,
      changeViewScorePrimarySectionCount,
      changeViewScoreSecondarySectionCount,
      changeViewScorePrimaryAbuseCount,
      changeViewScoreSecondaryScamalyticsCount,
      historyBodyPreview: historyBody.slice(0, 5000),
      copyButtonCount,
      dialogMessages
    },
    null,
    2
  )
);

await browser.close();
