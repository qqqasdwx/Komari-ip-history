import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const outputDir = '/workspace/web/playwright-output';
const expectedBrowserTimeZone = 'Asia/Shanghai';
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  timezoneId: expectedBrowserTimeZone,
  viewport: { width: 1440, height: 1200 }
});
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

async function waitForNodeReportConfig(page, uuid, predicate, label) {
  let lastDetail = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${uuid}?_=${Date.now()}`);
    if (result.status >= 200 && result.status < 300) {
      lastDetail = JSON.parse(result.text);
      if (predicate(lastDetail.report_config || {})) {
        return lastDetail;
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`${label}: ${JSON.stringify(lastDetail?.report_config || null)}`);
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
  const preferredNodeNames = ['开发种子-多IP历史', '开发种子-多快照对比', '真实上报-Debian页面接入'];
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
  await page.waitForURL(`**/#/nodes/${firstUUID}/settings**`, { timeout: 10000 });
  await page.locator('[data-node-settings-page="true"]').waitFor({ state: 'visible', timeout: 10000 });
  const reportConfigPanel = page.locator('[data-node-report-config="true"]');
  await reportConfigPanel.waitFor({ state: 'visible', timeout: 10000 });
  let modalDetail = JSON.parse((await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${firstUUID}?_=${Date.now()}`)).text);
  if (!Array.isArray(modalDetail.targets) || modalDetail.targets.length === 0) {
    await page.getByPlaceholder('例如 1.1.1.1 或 2606:4700:4700::1111').fill('203.0.113.10');
    await page.getByRole('button', { name: '添加 IP' }).click();
    await reportConfigPanel
      .locator('[data-report-target-row="true"][data-target-ip="203.0.113.10"]')
      .waitFor({ state: 'visible', timeout: 10000 });
    modalDetail = JSON.parse((await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${firstUUID}?_=${Date.now()}`)).text);
  }

  const reportConfigCount = await page.locator('[data-node-report-config="true"]').count();
  if (reportConfigCount === 0) {
    throw new Error('react node settings page missing report config');
  }
  const timezoneSelect = page.locator('#report-config-timezone');
  await timezoneSelect.waitFor({ state: 'visible', timeout: 10000 });
  await timezoneSelect.selectOption(expectedBrowserTimeZone);
  const runImmediatelyCheckbox = reportConfigPanel.locator('input[type="checkbox"]').first();
  if (!(await runImmediatelyCheckbox.isChecked())) {
    await runImmediatelyCheckbox.check();
  }
  await page.getByText(`当前 Cron 按 ${expectedBrowserTimeZone} 解析。`, { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByText(`时区：${expectedBrowserTimeZone}`, { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  const detailAfterConfig = await waitForNodeReportConfig(
    page,
    firstUUID,
    (config) => config.schedule_timezone === expectedBrowserTimeZone && config.run_immediately === true,
    'report config timezone and immediate-run were not persisted'
  );

  const configText = await reportConfigPanel.innerText();
  const installCommandCount = await page.getByText('接入命令', { exact: true }).count();
  if (installCommandCount === 0) {
    throw new Error('react node settings page missing install command');
  }
  if (!configText.includes('节点执行时会先请求上报计划') && !configText.includes('可以先安装脚本')) {
    throw new Error('react detail page missing reporter plan hint');
  }
  if (!configText.includes('手动添加') && !configText.includes('自动发现')) {
    throw new Error('react detail page missing target source labels');
  }
  if (!configText.includes('已启用') && !configText.includes('已停用')) {
    throw new Error('react detail page missing target enabled state labels');
  }
  if (configText.includes('上报地址') || configText.includes('Reporter Token')) {
    throw new Error('react detail page still exposes report endpoint or token');
  }
  if (!configText.includes('Cron') || !configText.includes('最近 10 次执行时间')) {
    throw new Error('react detail page missing schedule controls');
  }
  if (!configText.includes('解析时区') || !configText.includes(`当前 Cron 按 ${expectedBrowserTimeZone} 解析。`)) {
    throw new Error('react detail page missing schedule timezone controls');
  }
  if (!configText.includes('(GMT+8)')) {
    throw new Error('react detail page schedule preview should render timezone at the end, for example 2026/5/3 0:00:00 (GMT+8)');
  }
  if (!configText.includes('raw.githubusercontent.com/qqqasdwx/Komari-ip-history/master/deploy/install.sh')) {
    throw new Error('react node settings page install command is not using GitHub raw install script');
  }

  if (detailAfterConfig.report_config?.schedule_timezone !== expectedBrowserTimeZone) {
    throw new Error(`report config timezone was not persisted: ${detailAfterConfig.report_config?.schedule_timezone}`);
  }
  const configReporterToken = detailAfterConfig.report_config?.reporter_token;
  if (!configReporterToken) {
    throw new Error('reporter token missing after report config save');
  }

  let toggleTarget = (detailAfterConfig.targets || []).find((target) => target.report_enabled) || (detailAfterConfig.targets || [])[0];
  if (!toggleTarget) {
    throw new Error('report config should have at least one target after setup');
  }
  const toggleTargetRow = reportConfigPanel.locator(`[data-report-target-row="true"][data-target-id="${toggleTarget.id}"]`);
  await toggleTargetRow.waitFor({ state: 'visible', timeout: 10000 });
  const toggleTargetRowText = await toggleTargetRow.innerText();
  if (!toggleTargetRowText.includes(toggleTarget.source === 'auto' ? '自动发现' : '手动添加')) {
    throw new Error('target row did not render the expected source label');
  }
  if (!toggleTarget.report_enabled) {
    await toggleTargetRow.getByRole('button', { name: '启用' }).click();
    await toggleTargetRow.getByText('已启用', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    toggleTarget = { ...toggleTarget, report_enabled: true };
  }
  await toggleTargetRow.getByRole('button', { name: '停用' }).click();
  await toggleTargetRow.getByText('已停用', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  const disabledDetail = JSON.parse((await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${firstUUID}?_=${Date.now()}`)).text);
  const disabledTarget = disabledDetail.targets.find((target) => target.id === toggleTarget.id);
  if (!disabledTarget || disabledTarget.report_enabled !== false) {
    throw new Error('target disable action was not persisted');
  }
  const disabledPlanResponse = await jsonFetch(page, `${appBaseURL}/api/v1/report/nodes/${firstUUID}/plan`, {
    method: 'POST',
    headers: { 'X-IPQ-Reporter-Token': configReporterToken },
    body: JSON.stringify({ candidate_ips: [toggleTarget.ip] })
  });
  if (disabledPlanResponse.status < 200 || disabledPlanResponse.status >= 300) {
    throw new Error(`disabled target plan request failed: ${disabledPlanResponse.status} ${disabledPlanResponse.text}`);
  }
  const disabledPlan = JSON.parse(disabledPlanResponse.text);
  if ((disabledPlan.target_ips || []).includes(toggleTarget.ip)) {
    throw new Error('disabled target should not be returned by reporter plan');
  }
  await toggleTargetRow.getByRole('button', { name: '启用' }).click();
  await toggleTargetRow.getByText('已启用', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  const enabledPlanResponse = await jsonFetch(page, `${appBaseURL}/api/v1/report/nodes/${firstUUID}/plan`, {
    method: 'POST',
    headers: { 'X-IPQ-Reporter-Token': configReporterToken },
    body: JSON.stringify({ candidate_ips: [toggleTarget.ip] })
  });
  if (enabledPlanResponse.status < 200 || enabledPlanResponse.status >= 300) {
    throw new Error(`enabled target plan request failed: ${enabledPlanResponse.status} ${enabledPlanResponse.text}`);
  }
  const enabledPlan = JSON.parse(enabledPlanResponse.text);
  if (!(enabledPlan.target_ips || []).includes(toggleTarget.ip)) {
    throw new Error('reenabled target should be returned by reporter plan');
  }

  const installConfigResponse = await jsonFetch(page, `${appBaseURL}/api/v1/report/nodes/${firstUUID}/install-config`, {
    headers: { 'X-IPQ-Reporter-Token': configReporterToken }
  });
  if (installConfigResponse.status < 200 || installConfigResponse.status >= 300) {
    throw new Error(`install config request failed: ${installConfigResponse.status} ${installConfigResponse.text}`);
  }
  const installConfig = JSON.parse(installConfigResponse.text);
  if (installConfig.schedule_timezone !== expectedBrowserTimeZone || installConfig.run_immediately !== true) {
    throw new Error('install config did not include the saved timezone and immediate-run setting');
  }

  const installScriptResponse = await jsonFetch(page, `${appBaseURL}/api/v1/report/nodes/${firstUUID}/install.sh?timezone=${encodeURIComponent(expectedBrowserTimeZone)}`, {
    headers: { 'X-IPQ-Reporter-Token': configReporterToken }
  });
  if (installScriptResponse.status < 200 || installScriptResponse.status >= 300) {
    throw new Error(`install script request failed: ${installScriptResponse.status} ${installScriptResponse.text}`);
  }
  if (!installScriptResponse.text.includes(`CRON_TZ=${expectedBrowserTimeZone}`) || !installScriptResponse.text.includes(`TZ=${expectedBrowserTimeZone}`)) {
    throw new Error('install script did not include explicit cron timezone settings');
  }
  if (!installScriptResponse.text.includes('PLAN_ENDPOINT="${REPORT_ENDPOINT%/}/plan"') || !installScriptResponse.text.includes('request_report_plan >"$PLAN_TARGET_FILE"')) {
    throw new Error('install script should request reporter plan before probing target IPs');
  }

  const invalidTimezoneURL = new URL(`${appBaseURL}/api/v1/nodes/${firstUUID}/report-config/preview`);
  invalidTimezoneURL.searchParams.set('cron', '0 0 * * *');
  invalidTimezoneURL.searchParams.set('timezone', 'Mars/Base');
  const invalidTimezoneResponse = await jsonFetch(page, invalidTimezoneURL.toString());
  if (invalidTimezoneResponse.status !== 400 || !invalidTimezoneResponse.text.includes('invalid timezone')) {
    throw new Error(`invalid timezone preview did not return a clear 400 error: ${invalidTimezoneResponse.status} ${invalidTimezoneResponse.text}`);
  }
  await page.goto(`${appBaseURL}/#/nodes/${firstUUID}`);
  await page.waitForLoadState('networkidle');
  const detailReport = page.locator('[data-detail-report="true"]');
  await detailReport.waitFor();
  await page.locator('[data-node-readonly-state="true"]').waitFor({ state: 'visible', timeout: 10000 });

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
          Time: `history-seed-${index}`
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
  for (const label of ['返回', '设置', '详情', '历史', '快照']) {
    await page.getByRole('link', { name: label }).first().waitFor({ state: 'visible', timeout: 10000 });
  }
  for (const forbiddenText of ['保存名称', '选择 Komari 节点', '解除绑定', '接入命令']) {
    if ((await page.getByText(forbiddenText, { exact: true }).count()) > 0) {
      throw new Error(`react detail page should be read-only but shows ${forbiddenText}`);
    }
  }
  await page.getByRole('link', { name: '历史' }).first().click();
  await page.waitForURL('**/#/nodes/**/history**');
  await page.getByText('字段变化', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('link', { name: '快照' }).first().waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: /全部时间|今天|近 7 天|本周|近 30 天|本月/ }).click();
  const dateInputs = page.locator('input[type="datetime-local"]');
  await dateInputs.nth(0).fill('2026-04-02T00:00');
  await dateInputs.nth(1).fill('2026-04-02T23:59');
  await page.getByRole('button', { name: '应用筛选' }).click();
  await page.locator('[data-history-change-row="true"]').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('link', { name: '快照' }).first().click();
  await page.waitForURL('**/#/nodes/**/snapshots**');
  await page.getByText('时间范围', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await page.goto(`${appBaseURL}/#/nodes/${firstUUID}/compare${currentTarget?.id ? `?target_id=${currentTarget.id}` : ''}`);
  await page.waitForURL('**/#/nodes/**/snapshots**');
  await page.getByText('时间范围', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await page.goto(detailURL);
  await page.waitForLoadState('networkidle');

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
