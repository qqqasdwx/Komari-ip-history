import { chromium } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const komariBaseURL = (process.env.KOMARI_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const outputDir = path.resolve('playwright-output');
mkdirSync(outputDir, { recursive: true });
const runId = Date.now();
const hookPort = 18080;
const hookRequests = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uuidFromInstanceHref(href) {
  const match = href?.match(/\/instance\/([^/?#]+)/);
  return match?.[1] || '';
}

async function saveShot(page, name) {
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
}

async function waitToast(page, text) {
  await page.getByText(text, { exact: false }).waitFor({ state: 'visible', timeout: 10000 });
}

async function loginIPQ(page) {
  await page.goto(`${appBaseURL}/#/login`);
  await page.getByRole('textbox', { name: '用户名' }).fill('admin');
  await page.getByLabel('密码').fill('admin');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/#/nodes');
  await page.waitForLoadState('networkidle');
}

async function loginKomariAdmin(page) {
  await page.goto(`${komariBaseURL}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('admin').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.locator('button').filter({ hasText: /^Login$/ }).last().click();
  await page.getByText('Node list').waitFor({ state: 'visible', timeout: 15000 });
}

async function createKomariNode(adminPage, nodeName) {
  await adminPage.goto(`${komariBaseURL}/admin`, { waitUntil: 'domcontentloaded' });
  await adminPage.getByRole('button', { name: 'Add' }).click();
  await adminPage.getByPlaceholder('Name (optional)').fill(nodeName);
  await adminPage.locator('button').filter({ hasText: /^Add$/ }).last().click();
  await adminPage.waitForTimeout(1500);
  await adminPage.goto(`${komariBaseURL}/`, { waitUntil: 'domcontentloaded' });
  await adminPage.waitForTimeout(1500);
  const link = adminPage.locator(`a[href*="/instance/"]`).filter({ hasText: nodeName }).first();
  await link.waitFor({ state: 'visible', timeout: 15000 });
  const href = await link.getAttribute('href');
  const uuid = uuidFromInstanceHref(href);
  assert(uuid, `failed to extract Komari uuid for ${nodeName}`);
  return { uuid, href: `${komariBaseURL}${href}` };
}

async function openIntegrationPage(page) {
  await page.goto(`${appBaseURL}/#/settings/integration`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('heading', { name: '接入配置' }).waitFor({ state: 'visible', timeout: 15000 });
}

async function setGuestRead(page, enabled) {
  await openIntegrationPage(page);
  const checkbox = page.locator('input[type="checkbox"]').first();
  const changed = (await checkbox.isChecked()) !== enabled;
  if (changed) {
    await checkbox.click();
    await page.getByRole('button', { name: '保存游客只读设置' }).click();
    await page.getByText(enabled ? '当前状态：已开放' : '当前状态：未开放', { exact: false }).waitFor({ state: 'visible', timeout: 15000 });
  }
}

async function getLoaderCode(page) {
  await openIntegrationPage(page);
  await page.getByRole('button', { name: '复制 loader 版' }).click();
  const code = await page.locator('script').count().catch(() => 0);
  const pre = page.locator('pre').filter({ hasText: '/embed/loader.js' }).first();
  await pre.waitFor({ state: 'visible', timeout: 10000 });
  return pre.innerText();
}

async function setKomariCustomHeader(page, loaderCode) {
  await page.goto(`${komariBaseURL}/admin/settings/site`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const textareas = page.locator('textarea');
  await textareas.nth(1).fill(loaderCode);
  await page.locator('button').filter({ hasText: /^Save$/ }).nth(3).click();
  await page.waitForTimeout(2000);
}

async function gotoInstance(page, href) {
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
}

async function findInjectedButton(page) {
  const button = page.getByRole('button', { name: /查看 IP 质量|IPQ|IP 质量|添加 IP 质量检测/ }).first();
  await button.waitFor({ state: 'visible', timeout: 15000 });
  return button;
}

async function connectNodeViaInjection(page) {
  const popupPromise = page.context().waitForEvent('page');
  await (await findInjectedButton(page)).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForURL('**/#/nodes?report_config=*', { timeout: 20000 });
  await popup.locator('[data-node-report-config="true"]').waitFor({ state: 'visible', timeout: 15000 });
  return popup;
}

async function addTargetExpectError(popup, value, errorPart) {
  const input = popup.getByPlaceholder('例如 1.1.1.1 或 2606:4700:4700::1111');
  await input.fill(value);
  await popup.getByRole('button', { name: '添加 IP' }).click();
  await popup.getByText(errorPart, { exact: false }).waitFor({ state: 'visible', timeout: 10000 });
}

async function addTarget(popup, value) {
  const input = popup.getByPlaceholder('例如 1.1.1.1 或 2606:4700:4700::1111');
  await input.fill(value);
  await popup.getByRole('button', { name: '添加 IP' }).click();
  await popup.getByRole('button', { name: value, exact: true }).waitFor({ state: 'visible', timeout: 10000 });
}

async function setTimezoneAndCronEdges(popup) {
  const cronInput = popup.getByPlaceholder('0 0 * * *');
  await cronInput.fill('bad cron');
  await popup.getByText('invalid cron expression').waitFor({ state: 'visible', timeout: 10000 });
  await cronInput.fill('*/30 * * * *');
  const tzField = popup.locator('input').nth(5);
  await popup.getByRole('button', { name: '使用浏览器时区' }).click();
  await popup.waitForTimeout(1500);
  assert((await tzField.inputValue()) === 'Asia/Shanghai', 'timezone input did not keep Asia/Shanghai');
}

async function renameNodeInConfig(popup, newName) {
  const input = popup.locator('input').filter({ hasNot: popup.locator('[type="checkbox"]') }).first();
  await input.fill(newName);
  await popup.getByRole('button', { name: /保存名称/ }).click();
  await popup.waitForTimeout(1000);
  assert((await input.inputValue()) === newName, 'node name input did not keep the new value after save');
}

async function getInstallCommand(popup) {
  await popup.getByRole('button', { name: '复制' }).click();
  const code = popup.locator('pre.report-config-command').first();
  await code.waitFor({ state: 'visible', timeout: 10000 });
  return code.innerText();
}

async function openNotificationPage(page) {
  await page.goto(`${appBaseURL}/#/settings/notification`);
  await page.waitForTimeout(5000);
  await page.getByRole('heading', { name: '通知', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByText('通道名称', { exact: false }).waitFor({ state: 'visible', timeout: 15000 });
}

async function createWebhookChannelAndRule(page, nodeName, targetIP) {
  await openNotificationPage(page);
  const channelName = `pw-webhook-${runId}`;
  await page.locator('input').nth(1).fill(channelName);
  await page.locator('select').nth(0).selectOption('webhook');
  await page.locator('textarea').nth(2).fill(JSON.stringify({ url: `http://127.0.0.1:${hookPort}/notify`, method: 'POST', content_type: 'application/json', body: '{"message":"{{message}}","title":"{{title}}"}' }, null, 2));
  await page.getByRole('button', { name: '创建通道' }).click();
  await page.locator(`text=${channelName}`).first().waitFor({ state: 'visible', timeout: 15000 });

  const testButton = page.getByRole('button', { name: /测试|发送测试/ }).first();
  if (await testButton.count()) {
    await testButton.click();
    await sleep(1000);
  }

  const selects = page.locator('select');
  await selects.nth(2).selectOption({ label: nodeName });
  await sleep(1000);
  await selects.nth(3).selectOption({ label: channelName });
  await selects.nth(4).selectOption({ label: targetIP });
  await sleep(1500);
  const fieldSelect = selects.nth(5);
  const options = await fieldSelect.locator('option').evaluateAll((els) => els.map((e) => ({ value: e.value, text: e.textContent?.trim() || '' })));
  const preferred = options.find((item) => /IPQS|分数|score/i.test(item.text) && item.value) || options.find((item) => item.value);
  assert(preferred?.value, 'notification field options not loaded');
  await fieldSelect.selectOption(preferred.value);
  await page.getByRole('button', { name: '创建规则' }).click();
  await page.locator(`text=${channelName}`).first().waitFor({ state: 'visible', timeout: 15000 });
  return channelName;
}

function executeInstallCommand(command) {
  assert(command.includes('/api/v1/report/install-script/'), 'install command is not using local install script');
  const output = execSync(command, { shell: '/bin/bash', stdio: 'pipe', timeout: 180000, env: process.env, encoding: 'utf8' });
  return output;
}

function triggerInstalledRunner(nodeUUID) {
  const scriptPath = `/opt/ipq-reporter-${nodeUUID}/run.sh`;
  return execSync(scriptPath, { shell: '/bin/bash', stdio: 'pipe', timeout: 180000, env: process.env, encoding: 'utf8' });
}

async function openNodeDetail(page, nodeName) {
  await page.goto(`${appBaseURL}/#/nodes`);
  await page.waitForLoadState('networkidle');
  const row = page.locator('[data-node-row="true"]').filter({ hasText: nodeName }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  const nodeUUID = await row.getAttribute('data-node-uuid');
  await row.click({ position: { x: 20, y: 20 } });
  await page.waitForURL(`**/#/nodes/${nodeUUID}`);
  await page.locator('[data-detail-report="true"]').waitFor({ state: 'visible', timeout: 15000 });
  return nodeUUID;
}

async function verifyHistoryCompareFavorite(page) {
  await page.getByRole('link', { name: '查看历史记录' }).click();
  await page.waitForURL('**/#/nodes/**/history**');
  await page.getByText('字段变化', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('[data-history-change-row="true"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('link', { name: '快照对比' }).click();
  await page.waitForURL('**/#/nodes/**/compare**');
  await page.getByText('时间范围', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  const favoriteButton = page.getByRole('button', { name: /收藏快照|取消收藏/ }).first();
  await favoriteButton.click();
  await page.waitForTimeout(1500);
}

async function verifyTargetSwitchAndToggle(page, secondTargetText, nodeUUID) {
  await page.getByRole('button', { name: secondTargetText }).click().catch(() => {});
  await page.getByRole('button', { name: secondTargetText, exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: '上报设置' }).count().catch(() => 0);
  await page.goto(`${appBaseURL}/#/nodes?report_config=${nodeUUID}`);
  await page.locator('[data-node-report-config="true"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: '关闭上报' }).click();
  await page.getByRole('button', { name: '启用上报', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: '启用上报' }).click();
  await page.getByRole('button', { name: '关闭上报', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.goto(`${appBaseURL}/#/nodes/${nodeUUID}`);
  await page.locator('[data-detail-report="true"]').waitFor({ state: 'visible', timeout: 15000 });
}

async function verifyGuestFlows(instanceURL) {
  const browser = await chromium.launch({ headless: true });
  const guest = await browser.newPage();
  await guest.goto(instanceURL, { waitUntil: 'domcontentloaded' });
  await guest.waitForTimeout(3000);
  await (await findInjectedButton(guest)).click();
  await guest.getByText('管理员未开放', { exact: false }).waitFor({ state: 'visible', timeout: 10000 });
  await browser.close();
}

async function verifyGuestPopup(instanceURL) {
  const browser = await chromium.launch({ headless: true });
  const guest = await browser.newPage();
  await guest.goto(instanceURL, { waitUntil: 'domcontentloaded' });
  await guest.waitForTimeout(3000);
  await (await findInjectedButton(guest)).click();
  await guest.locator('#ipq-loader-overlay iframe').first().waitFor({ state: 'visible', timeout: 15000 });
  const src = await guest.locator('#ipq-loader-overlay iframe').first().getAttribute('src');
  assert(src?.includes('/public/nodes/'), 'guest popup did not open public node iframe');
  await browser.close();
}

async function createShellCandidate(adminPage, instanceURL) {
  const page = await adminPage.context().newPage();
  await gotoInstance(page, instanceURL);
  const popup = await connectNodeViaInjection(page);
  await popup.close();
  await page.close();
}

async function createStandaloneAndBind(ipqPage, komariNodeName) {
  const standaloneName = `PW Standalone ${runId}`;
  await ipqPage.goto(`${appBaseURL}/#/nodes`);
  await ipqPage.getByRole('button', { name: '新建节点' }).click();
  await ipqPage.getByPlaceholder('例如 香港边缘节点').fill(standaloneName);
  await ipqPage.getByRole('button', { name: '创建并配置' }).click();
  await ipqPage.locator('[data-node-report-config="true"]').waitFor({ state: 'visible', timeout: 15000 });
  const bindSelect = ipqPage.locator('select').first();
  const bindOptions = await bindSelect.locator('option').evaluateAll((els) =>
    els
      .map((e) => ({ value: e.getAttribute('value') || '', text: e.textContent?.trim() || '' }))
      .filter((item) => item.value && item.text && !item.text.includes('请选择'))
  );
  assert(bindOptions.length > 0, `no bind candidates available for ${komariNodeName}`);
  await bindSelect.selectOption(bindOptions[0].value);
  const bindNameInput = ipqPage.locator('input').filter({ hasNot: ipqPage.locator('[type="checkbox"]') }).nth(1);
  await bindNameInput.fill(bindOptions[0].text.split(' · ')[0]);
  await ipqPage.getByRole('button', { name: '绑定 Komari' }).click();
  await ipqPage.getByText('已绑定 Komari', { exact: false }).waitFor({ state: 'visible', timeout: 15000 });
  await ipqPage.getByRole('button', { name: '解除绑定' }).click();
  await ipqPage.getByText('独立节点（当前未绑定 Komari）', { exact: false }).waitFor({ state: 'visible', timeout: 15000 });
  await ipqPage.getByRole('button', { name: '关闭' }).click();
}

async function verifyApiKeys(page) {
  await page.goto(`${appBaseURL}/#/settings/api-keys`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('heading', { name: 'API Key', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('heading', { name: '创建 API Key', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  const keyName = `pw-key-${runId}`;
  await page.locator('input').first().fill(keyName);
  await page.getByRole('button', { name: '创建 API Key' }).click();
  await page.getByText('请立即保存明文 Key', { exact: false }).waitFor({ state: 'visible', timeout: 15000 });
  const keyText = await page.locator('pre').filter({ hasText: /[A-Za-z0-9]/ }).first().innerText();
  let output = execSync(`curl -s -o /tmp/pw_api_ok.json -w '%{http_code}' -H 'X-IPQ-API-Key: ${keyText.trim()}' '${appBaseURL}/api/public/v1/nodes'`, { shell: '/bin/bash' }).toString();
  assert(output.trim() === '200', `public api expected 200, got ${output}`);
  await page.getByRole('button', { name: '停用' }).first().click();
  await page.waitForTimeout(1000);
  output = execSync(`curl -s -o /tmp/pw_api_fail.json -w '%{http_code}' -H 'X-IPQ-API-Key: ${keyText.trim()}' '${appBaseURL}/api/public/v1/nodes'`, { shell: '/bin/bash' }).toString();
  assert(output.trim() === '401', `disabled public api expected 401, got ${output}`);
  await page.getByRole('button', { name: '启用' }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '删除' }).first().click();
}

async function verifyHistoryRetention(page) {
  await page.goto(`${appBaseURL}/#/settings/history-retention`);
  await page.locator('input[type="text"]').first().fill('30');
  await page.getByRole('button', { name: '保存历史保留设置' }).click();
  await page.waitForTimeout(1000);
  await page.locator('input[type="text"]').first().fill('-1');
  await page.getByRole('button', { name: '保存历史保留设置' }).click();
  await page.waitForTimeout(1000);
}

async function verifyUserSettings(page) {
  await page.goto(`${appBaseURL}/#/settings/user`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('heading', { name: '用户', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('input').first().fill('admin');
  await page.getByRole('button', { name: '保存并重新登录' }).click();
  await page.waitForURL('**/#/login', { timeout: 15000 }).catch(() => {});
  if (page.url().includes('#/login')) {
    await loginIPQ(page);
  }
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    hookRequests.push({ url: req.url, method: req.method, body });
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
});
await new Promise((resolve) => server.listen(hookPort, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Asia/Shanghai' });
const ipqPage = await context.newPage();
const komariAdminPage = await context.newPage();
const summary = { runId, steps: [] };

try {
  await loginIPQ(ipqPage);
  summary.steps.push('ipq-login');
  await loginKomariAdmin(komariAdminPage);
  summary.steps.push('komari-login');

  summary.initialNodeCount = await ipqPage.locator('[data-node-row="true"]').count();
  if (summary.initialNodeCount === 0) {
    assert((await ipqPage.getByText('还没有节点').count()) > 0, 'expected empty state when node count is zero');
    summary.steps.push('ipq-empty-state');
  }

  const loaderCode = await getLoaderCode(ipqPage);
  assert(loaderCode.includes('/embed/loader.js'), 'loader code missing embed loader');
  await ipqPage.getByRole('button', { name: '复制完整内联版' }).click();
  summary.steps.push('ipq-integration-copy');

  await setKomariCustomHeader(komariAdminPage, loaderCode);
  summary.steps.push('komari-custom-header');

  const connectedNodeName = `PW Connected ${runId}`;
  const connectedNode = await createKomariNode(komariAdminPage, connectedNodeName);
  summary.connectedNode = connectedNode;
  summary.steps.push('komari-create-node');

  const instanceAdminPage = await context.newPage();
  await gotoInstance(instanceAdminPage, connectedNode.href);
  await saveShot(instanceAdminPage, 'connected-node-instance-before-click');
  const popup = await connectNodeViaInjection(instanceAdminPage);
  summary.steps.push('injection-open-popup');

  const configuredNodeName = `${connectedNodeName} 已接入`;
  await renameNodeInConfig(popup, configuredNodeName);
  await addTargetExpectError(popup, 'bad-ip', 'invalid ip');
  await addTarget(popup, '1.1.1.1');
  await addTarget(popup, '8.8.8.8');
  await setTimezoneAndCronEdges(popup);
  await saveShot(popup, 'report-config-after-setup');
  summary.steps.push('report-config-edit-and-edge-check');

  await createWebhookChannelAndRule(ipqPage, configuredNodeName, '1.1.1.1');
  summary.steps.push('notification-channel-rule');

  const installCommand = await getInstallCommand(popup);
  assert(installCommand.includes('http://127.0.0.1:8090/api/v1/report/install-script/'), 'install command not pointing to local IPQ');
  summary.installCommand = installCommand;
  const installOutput = executeInstallCommand(installCommand);
  assert(installOutput.includes('Timezone: Asia/Shanghai'), 'install output did not reflect Asia/Shanghai timezone');
  summary.installOutput = installOutput.slice(0, 2000);
  summary.steps.push('execute-install-command');
  await sleep(3000);
  summary.runnerOutput = triggerInstalledRunner(connectedNode.uuid).slice(0, 2000);
  summary.steps.push('rerun-installed-runner');

  assert(hookRequests.length > 0, 'expected webhook test or rule delivery requests');
  summary.webhookCount = hookRequests.length;
  await openNotificationPage(ipqPage);
  await ipqPage.getByText('最近投递记录', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  summary.steps.push('notification-delivery-log');

  await popup.getByRole('button', { name: '关闭', exact: true }).click();
  const nodeUUID = await openNodeDetail(ipqPage, configuredNodeName);
  summary.nodeUUID = nodeUUID;
  summary.steps.push('open-node-detail');

  await verifyTargetSwitchAndToggle(ipqPage, '8.8.8.8', nodeUUID);
  summary.steps.push('target-switch-toggle');
  await verifyHistoryCompareFavorite(ipqPage);
  summary.steps.push('history-compare-favorite');

  await setGuestRead(ipqPage, false);
  await verifyGuestFlows(connectedNode.href);
  summary.steps.push('guest-read-off');
  await setGuestRead(ipqPage, true);
  await verifyGuestPopup(connectedNode.href);
  summary.steps.push('guest-read-on');

  const shellNodeName = `PW Shell ${runId}`;
  const shellNode = await createKomariNode(komariAdminPage, shellNodeName);
  await createShellCandidate(komariAdminPage, shellNode.href);
  await createStandaloneAndBind(ipqPage, shellNodeName);
  summary.steps.push('standalone-bind-unbind');

  await verifyApiKeys(ipqPage);
  summary.steps.push('api-keys');
  await verifyHistoryRetention(ipqPage);
  summary.steps.push('history-retention');
  await verifyUserSettings(ipqPage);
  summary.steps.push('user-settings');

  await saveShot(ipqPage, 'final-ipq-state');
  await saveShot(komariAdminPage, 'final-komari-admin-state');
  writeFileSync(path.join(outputDir, 'ralph-full-e2e-summary.json'), JSON.stringify(summary, null, 2));
} finally {
  server.close();
  await browser.close();
}
