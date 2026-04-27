import http from 'node:http';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const komariBaseURL = 'http://127.0.0.1:8080';
const appBaseURL = 'http://127.0.0.1:8090';
const outputDir = path.resolve('playwright-output');
mkdirSync(outputDir, { recursive: true });
const hookPort = 18081;
const hookRequests = [];
const timezone = 'Asia/Shanghai';
const runId = `ralph-${Date.now()}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function label(page, text) {
  return page.locator('label').filter({ hasText: new RegExp(`^${escapeRegex(text)}`) }).first();
}

async function saveShot(page, name) {
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
}

async function waitToast(page, text, timeout = 15000) {
  await page.getByText(text, { exact: false }).last().waitFor({ state: 'visible', timeout });
}

function nextCronInTimeZone(tz, plusMinutes = 2) {
  const target = new Date(Date.now() + plusMinutes * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(target);
  const get = (type) => parts.find((item) => item.type === type)?.value;
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  return { cron: `${minute} ${hour} * * *`, hour, minute, iso: target.toISOString() };
}

function parseInstallArgs(command) {
  const serverMatch = command.match(/'?--server'?\s+'([^']+)'/);
  const tokenMatch = command.match(/'?--install-token'?\s+'([^']+)'/);
  assert(serverMatch && tokenMatch, `failed to parse install command: ${command}`);
  return { server: serverMatch[1], installToken: tokenMatch[1] };
}

async function jsonFetch(page, url, options = {}) {
  const result = await page.evaluate(async ({ url, options }) => {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });
    const text = await response.text();
    return { status: response.status, text };
  }, { url, options });
  return result;
}

function uuidFromInstanceHref(href) {
  const match = href?.match(/\/instance\/([^/?#]+)/);
  return match?.[1] || '';
}

async function loginIPQ(page) {
  await page.goto(`${appBaseURL}/#/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: '用户名' }).fill('admin');
  await page.getByLabel('密码').fill('admin');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/#/nodes', { timeout: 15000 });
}

async function loginKomariAdmin(page) {
  await page.goto(`${komariBaseURL}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('admin').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.locator('button').filter({ hasText: /^Login$/ }).last().click();
  await page.getByText('Node list').waitFor({ state: 'visible', timeout: 15000 });
}

async function openIntegrationPage(page) {
  await page.goto(`${appBaseURL}/#/settings/integration`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '接入配置', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
}

async function getLoaderCode(page) {
  await openIntegrationPage(page);
  const pre = page.locator('pre').filter({ hasText: '/embed/loader.js' }).first();
  await pre.waitFor({ state: 'visible', timeout: 10000 });
  return pre.innerText();
}

async function setKomariCustomHeader(page, loaderCode) {
  await page.goto(`${komariBaseURL}/admin/settings/site`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const textareas = page.locator('textarea');
  await textareas.nth(1).fill(loaderCode);
  await page.locator('button').filter({ hasText: /^Save$/ }).nth(3).click();
  await page.waitForTimeout(1500);
}

async function createKomariNode(adminPage, nodeName) {
  await adminPage.goto(`${komariBaseURL}/admin`, { waitUntil: 'domcontentloaded' });
  await adminPage.getByRole('button', { name: 'Add' }).click();
  await adminPage.getByPlaceholder('Name (optional)').fill(nodeName);
  await adminPage.locator('button').filter({ hasText: /^Add$/ }).last().click();
  await adminPage.waitForTimeout(1200);
  await adminPage.goto(`${komariBaseURL}/`, { waitUntil: 'domcontentloaded' });
  await adminPage.waitForTimeout(1500);
  const link = adminPage.locator(`a[href*="/instance/"]`).filter({ hasText: nodeName }).first();
  await link.waitFor({ state: 'visible', timeout: 15000 });
  const href = await link.getAttribute('href');
  const uuid = uuidFromInstanceHref(href);
  assert(uuid, `failed to extract komari uuid for ${nodeName}`);
  return { uuid, href: `${komariBaseURL}${href}` };
}

async function gotoInstance(page, href) {
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
}

async function findInjectedButton(page) {
  const button = page.getByRole('button', { name: /查看 IP 质量|IPQ|IP 质量|添加 IP 质量检测/ }).first();
  await button.waitFor({ state: 'visible', timeout: 20000 });
  return button;
}

async function connectNodeViaInjection(page) {
  await (await findInjectedButton(page)).click();
  const iframe = page.locator('#ipq-loader-overlay iframe').first();
  await iframe.waitFor({ state: 'visible', timeout: 20000 });
  const handle = await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  assert(frame, 'failed to resolve injected iframe frame');
  await frame.locator('[data-node-report-config="true"]').waitFor({ state: 'visible', timeout: 15000 });
  return frame;
}

async function addTarget(popup, value) {
  const input = popup.getByPlaceholder('例如 1.1.1.1 或 2606:4700:4700::1111');
  await input.fill(value);
  await popup.getByRole('button', { name: '添加 IP' }).click();
  await popup.getByRole('button', { name: value, exact: true }).waitFor({ state: 'visible', timeout: 10000 });
}

async function renameNodeInConfig(popup, newName) {
  const input = popup.getByRole('textbox', { name: '节点名称', exact: true });
  await input.fill(newName);
  await input.press('Enter');
  await waitToast(popup, '节点名称已保存。');
  assert((await input.inputValue()) === newName, 'node name did not persist');
}

async function configureSchedule(popup, tz) {
  const next = nextCronInTimeZone(tz, 2);
  const cronInput = popup.getByPlaceholder('0 0 * * *');
  await cronInput.fill(next.cron);

  const runImmediateCheckbox = popup.locator('input[type="checkbox"]').filter({ has: popup.locator('..') }).nth(1);
  // safer: checkbox near "安装后立即执行一次"
  const immediateSection = popup.getByText('安装后立即执行一次', { exact: true }).locator('..').locator('input[type="checkbox"]');
  if (await immediateSection.isChecked()) {
    await immediateSection.click();
  }

  const tzButton = popup.locator('button').filter({ hasText: '展开' }).nth(1);
  await tzButton.click();
  const search = popup.getByPlaceholder('搜索时区');
  await search.fill(tz);
  await popup.locator('button').filter({ hasText: new RegExp(`^${escapeRegex(tz)}`) }).last().click();
  await popup.waitForTimeout(1200);
  await popup.getByText('已自动保存', { exact: false }).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const nextRuns = popup.locator('.report-config-next-runs > div');
  await nextRuns.first().waitFor({ state: 'visible', timeout: 15000 });
  return next;
}

async function copyInstallCommand(popup) {
  const code = popup.locator('pre.report-config-command').first();
  await code.waitFor({ state: 'visible', timeout: 10000 });
  return code.innerText();
}

async function createStandaloneNode(page, nodeName) {
  await page.goto(`${appBaseURL}/#/nodes`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '新建节点' }).click();
  await page.getByPlaceholder('例如 香港边缘节点').fill(nodeName);
  await page.getByRole('button', { name: '创建并配置' }).click();
  await page.locator('[data-node-report-config="true"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('[data-node-row="true"]').filter({ hasText: nodeName }).first().waitFor({ state: 'visible', timeout: 15000 });
}

async function openNotificationChannelSettings(page) {
  await page.goto(`${appBaseURL}/#/settings/notification/channel`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '通道设置', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
}

async function configureMessageTemplate(page, template) {
  await label(page, '消息模板').locator('textarea').fill(template);
  await page.getByRole('button', { name: '保存模板' }).click();
  await page.waitForTimeout(1200);
}

async function configureWebhookChannel(page, urlPath) {
  await label(page, '发送器类型').locator('select').selectOption('webhook');
  await page.waitForTimeout(400);
  await label(page, 'Webhook 地址').locator('input').fill(`http://127.0.0.1:${hookPort}${urlPath}`);
  await label(page, '请求方法').locator('select').selectOption('POST');
  await label(page, 'Content-Type').locator('input').fill('application/json');
  await label(page, '请求头').locator('textarea').fill('{"X-Test-Channel":"webhook"}');
  await label(page, '请求体').locator('textarea').fill('{"message":"{{message}}"}');
  await page.getByRole('button', { name: '保存并设为当前通道' }).click();
  await page.waitForTimeout(1500);
}

async function testWebhookChannel(page, pathName) {
  const before = hookRequests.filter((item) => item.path === pathName).length;
  await page.getByRole('button', { name: '测试已保存配置' }).click();
  return waitForHook(pathName, before, 15000);
}

async function configureJavascriptChannel(page, urlPath) {
  await label(page, '发送器类型').locator('select').selectOption('javascript');
  await page.waitForTimeout(400);
  const jsScript = [
    'async function sendMessage(message, title) {',
    `  const response = await fetch("http://127.0.0.1:${hookPort}${urlPath}", {`,
    '    method: "POST",',
    '    headers: { "Content-Type": "application/json", "X-Test-Channel": "javascript" },',
    '    body: JSON.stringify({ message, title })',
    '  });',
    '  return response.ok;',
    '}'
  ].join('\n');
  await label(page, '脚本内容').locator('textarea').fill(jsScript);
  await page.getByRole('button', { name: '保存并设为当前通道' }).click();
  await page.waitForTimeout(1500);
}

async function testJavascriptChannel(page, pathName) {
  const before = hookRequests.filter((item) => item.path === pathName).length;
  await page.getByRole('button', { name: '测试已保存配置' }).click();
  return waitForHook(pathName, before, 15000);
}

async function openNotificationHome(page) {
  await page.goto(`${appBaseURL}/#/settings/notification`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '通知', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
}

async function createNotificationRule(page, nodeName, targetIP) {
  await openNotificationHome(page);
  await page.getByRole('button', { name: '添加规则' }).click();
  const dialog = page.locator('.field-modal.report-config-modal').last();
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  const fieldSelect = dialog.locator('select').first();
  await fieldSelect.waitFor({ state: 'visible', timeout: 15000 });
  let options = [];
  const started = Date.now();
  while (Date.now() - started < 15000) {
    options = await fieldSelect.locator('option').evaluateAll((els) => els.map((e) => ({ value: e.value, text: (e.textContent || '').trim() })));
    if (options.some((item) => item.value)) {
      break;
    }
    await sleep(250);
  }
  const preferred =
    options.find((item) => /info\.organization/i.test(item.value) && item.value) ||
    options.find((item) => /组织|Organization/i.test(item.text) && item.value) ||
    options.find((item) => item.value);
  assert(preferred?.value, 'no notification field option available');
  await fieldSelect.selectOption(preferred.value);
  await dialog.getByPlaceholder('搜索节点').fill(nodeName);
  await dialog.locator('label').filter({ hasText: nodeName }).locator('input[type="checkbox"]').check();
  await dialog.locator('label').filter({ hasText: targetIP }).locator('input[type="checkbox"]').check();
  await dialog.getByRole('button', { name: '创建规则' }).click();
  await page.getByText(preferred.value, { exact: false }).waitFor({ state: 'visible', timeout: 15000 });
  return preferred;
}

async function waitForData(page, nodeUUID, timeoutMs = 190000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${nodeUUID}`);
    if (response.status === 200) {
      const payload = JSON.parse(response.text);
      if (payload?.has_data && payload?.current_target?.current_result) {
        return payload;
      }
    }
    await sleep(3000);
  }
  throw new Error(`timed out waiting for node data: ${nodeUUID}`);
}

async function postSimulatedHistory(page, nodeUUID, targetIP, reporterToken, currentResult, organizationValue) {
  const nextResult = structuredClone(currentResult || {});
  if (!nextResult.Info || typeof nextResult.Info !== 'object') nextResult.Info = {};
  nextResult.Info.Organization = organizationValue;
  if (!nextResult.Head || typeof nextResult.Head !== 'object') nextResult.Head = {};
  nextResult.Head.Time = `${organizationValue}-${Date.now()}`;
  const response = await jsonFetch(page, `${appBaseURL}/api/v1/report/nodes/${nodeUUID}`, {
    method: 'POST',
    headers: { 'X-IPQ-Reporter-Token': reporterToken },
    body: JSON.stringify({ target_ip: targetIP, summary: organizationValue, result: nextResult })
  });
  assert(response.status >= 200 && response.status < 300, `failed to post simulated history: ${response.status} ${response.text}`);
  return nextResult;
}

async function openNodeDetail(page, nodeName) {
  await page.goto(`${appBaseURL}/#/nodes`, { waitUntil: 'domcontentloaded' });
  const row = page.locator('[data-node-row="true"]').filter({ hasText: nodeName }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  const nodeUUID = await row.getAttribute('data-node-uuid');
  await row.click({ position: { x: 20, y: 20 } });
  await page.waitForURL(`**/#/nodes/${nodeUUID}`, { timeout: 15000 });
  return nodeUUID;
}

async function verifyHistoryAndCompare(page) {
  await page.getByRole('link', { name: '查看历史记录' }).click();
  await page.waitForURL('**/#/nodes/**/history**', { timeout: 15000 });
  await page.locator('[data-history-change-row="true"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('link', { name: '快照对比' }).click();
  await page.waitForURL('**/#/nodes/**/compare**', { timeout: 15000 });
  const leftInput = page.locator('.compare-timeline-input-left');
  const rightInput = page.locator('.compare-timeline-input-right');
  const leftStep = await leftInput.getAttribute('step');
  const rightStep = await rightInput.getAttribute('step');
  assert(leftStep === '1' && rightStep === '1', `unexpected compare slider step left=${leftStep} right=${rightStep}`);
  const minValue = Number(await leftInput.getAttribute('min'));
  const maxValue = Number(await rightInput.inputValue());
  const midpoint = Math.floor((minValue + maxValue) / 2);
  await page.evaluate((value) => {
    const input = document.querySelector('.compare-timeline-input-left');
    if (!(input instanceof HTMLInputElement)) throw new Error('left compare input missing');
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, midpoint);
  const applied = Number(await leftInput.inputValue());
  assert(applied === midpoint, `compare slider snapped unexpectedly expected=${midpoint} actual=${applied}`);
}

async function waitForHook(pathName, previousCount, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const matches = hookRequests.filter((item) => item.path === pathName);
    if (matches.length > previousCount) {
      return matches[matches.length - 1];
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for hook ${pathName}`);
}

function receiverServer() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      hookRequests.push({
        path: req.url || '/',
        method: req.method || 'GET',
        headers: req.headers,
        body,
        at: new Date().toISOString()
      });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  });
}

async function main() {
  const server = receiverServer();
  await new Promise((resolve) => server.listen(hookPort, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, timezoneId: timezone });
  const ipqPage = await context.newPage();
  const komariPage = await context.newPage();
  const summary = { runId, steps: [] };

  try {
    await loginIPQ(ipqPage);
    await loginKomariAdmin(komariPage);
    summary.steps.push('login');

    await saveShot(ipqPage, 'reset-empty-nodes');
    const loaderCode = await getLoaderCode(ipqPage);
    assert(loaderCode.includes('/embed/loader.js'), 'loader code missing embed loader');
    await setKomariCustomHeader(komariPage, loaderCode);
    summary.steps.push('inject-loader');

    const komariNodeName = `komari-e2e-${runId}`;
    const connectedNodeName = `ipq-connected-${runId}`;
    const standaloneNodeName = `ipq-standalone-${runId}`;

    const komariNode = await createKomariNode(komariPage, komariNodeName);
    summary.komariNode = komariNode;
    summary.steps.push('create-komari-node');

    const instancePage = await context.newPage();
    await gotoInstance(instancePage, komariNode.href);
    const popup = await connectNodeViaInjection(instancePage);
    await renameNodeInConfig(popup, connectedNodeName);
    await addTarget(popup, '1.1.1.1');
    await addTarget(popup, '8.8.8.8');
    const nextSchedule = await configureSchedule(popup, timezone);
    const installCommand = await copyInstallCommand(popup);
    await saveShot(instancePage, 'report-config-before-install');
    summary.schedule = nextSchedule;
    summary.installCommand = installCommand;
    summary.steps.push('configure-connected-node');

    await popup.getByRole('button', { name: '关闭', exact: true }).click();
    await createStandaloneNode(ipqPage, standaloneNodeName);
    summary.steps.push('create-standalone-node');

    await openNotificationChannelSettings(ipqPage);
    const template = [
      '测试通知',
      '节点: {{node_name}}',
      'IP: {{target_ip}}',
      '字段: {{field_label}}',
      '旧值: {{previous_value}}',
      '新值: {{current_value}}'
    ].join('\n');
    await label(ipqPage, '发送器类型').locator('select').selectOption('webhook');
    await ipqPage.waitForTimeout(400);
    await configureMessageTemplate(ipqPage, template);

    await configureWebhookChannel(ipqPage, '/webhook-test');
    const webhookTest = await testWebhookChannel(ipqPage, '/webhook-test');
    const webhookTestPayload = JSON.parse(webhookTest.body);
    assert(webhookTestPayload.message.includes('Test Node'), 'webhook test message missing node');
    summary.steps.push('test-webhook-channel');

    await configureJavascriptChannel(ipqPage, '/javascript-test');
    const jsTest = await testJavascriptChannel(ipqPage, '/javascript-test');
    const jsTestPayload = JSON.parse(jsTest.body);
    assert(jsTestPayload.message.includes('Test Node'), 'javascript test message missing node');
    assert(jsTestPayload.title === '', `javascript title expected empty, got ${JSON.stringify(jsTestPayload.title)}`);
    summary.steps.push('test-javascript-channel');

    await configureWebhookChannel(ipqPage, '/notify');
    summary.steps.push('prepare-webhook-subscription');

    const { server, installToken } = parseInstallArgs(installCommand);
    const installOutput = execFileSync('bash', ['deploy/install.sh', '--server', server, '--install-token', installToken], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 240000,
      env: { ...process.env }
    });
    summary.installOutput = installOutput.slice(0, 2000);
    summary.steps.push('install-runner');

    const connectedNodeUUID = await openNodeDetail(ipqPage, connectedNodeName);
    summary.connectedNodeUUID = connectedNodeUUID;
    const firstData = await waitForData(ipqPage, connectedNodeUUID, 190000);
    assert(firstData.current_target?.current_result, 'connected node missing first real data');
    await saveShot(ipqPage, 'connected-node-after-scheduled-run');
    summary.steps.push('wait-for-scheduled-real-data');

    const fieldChoice = await createNotificationRule(ipqPage, connectedNodeName, '1.1.1.1');
    summary.notificationField = fieldChoice;
    summary.steps.push('create-notification-rule');

    const notifyBefore = hookRequests.filter((item) => item.path === '/notify').length;
    let currentResult = firstData.current_target.current_result;
    currentResult = await postSimulatedHistory(ipqPage, connectedNodeUUID, '1.1.1.1', firstData.report_config.reporter_token, currentResult, 'QA Org A');
    const notifyReq = await waitForHook('/notify', notifyBefore, 15000);
    const notifyPayload = JSON.parse(notifyReq.body);
    assert(notifyPayload.message.includes(connectedNodeName), 'notification payload missing connected node name');
    assert(notifyPayload.message.includes('旧值'), 'notification payload missing previous value');
    assert(notifyPayload.message.includes('新值'), 'notification payload missing current value');
    summary.notifyPayload = notifyPayload;
    summary.steps.push('verify-field-change-notification');

    currentResult = await postSimulatedHistory(ipqPage, connectedNodeUUID, '1.1.1.1', firstData.report_config.reporter_token, currentResult, 'QA Org B');
    currentResult = await postSimulatedHistory(ipqPage, connectedNodeUUID, '1.1.1.1', firstData.report_config.reporter_token, currentResult, 'QA Org C');
    summary.steps.push('seed-multiple-history');

    await ipqPage.goto(`${appBaseURL}/#/nodes/${connectedNodeUUID}`, { waitUntil: 'domcontentloaded' });
    await verifyHistoryAndCompare(ipqPage);
    await saveShot(ipqPage, 'history-compare-after-seeding');
    summary.steps.push('verify-history-and-compare');

    await ipqPage.goto(`${appBaseURL}/#/settings/notification/deliveries`, { waitUntil: 'domcontentloaded' });
    await ipqPage.getByRole('heading', { name: '最近投递记录', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
    await ipqPage.getByText('发送成功', { exact: false }).first().waitFor({ state: 'visible', timeout: 15000 });
    await saveShot(ipqPage, 'notification-deliveries-final');
    summary.steps.push('verify-deliveries');

    writeFileSync(path.join(outputDir, 'ralph-reset-full-real-e2e-summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
