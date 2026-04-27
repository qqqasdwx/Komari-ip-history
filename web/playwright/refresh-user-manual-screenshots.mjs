import { chromium } from 'playwright';
import path from 'node:path';
import { execSync } from 'node:child_process';

const komariBaseURL = 'http://127.0.0.1:8080';
const appBaseURL = 'http://127.0.0.1:8090';
const outDir = path.resolve('docs/assets/用户操作手册');
const themeZip = '/tmp/Komari-theme-purcarte.zip';
const nodeName = 'IPQ 手册演示节点';
const standaloneName = 'IPQ 独立演示节点';
const targetA = '1.1.1.1';
const targetB = '8.8.8.8';
const tempPassword = 'admin123456';

function sh(cmd) {
  return execSync(cmd, { shell: '/bin/bash', stdio: 'pipe', encoding: 'utf8' });
}

function instanceUUID(instanceURL) {
  return instanceURL.split('/instance/')[1];
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
}

async function loginIPQ(page, password = 'admin', capture = false) {
  await page.goto(`${appBaseURL}/#/login`);
  if (capture) await shot(page, '06-ipq-login.png');
  await page.getByRole('textbox', { name: '用户名' }).fill('admin');
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForTimeout(1500);
  await page.getByText('节点列表', { exact: false }).waitFor({ state: 'visible', timeout: 15000 });
}

async function loginKomariAdmin(page) {
  await page.goto(`${komariBaseURL}/admin`, { waitUntil: 'domcontentloaded' });
  await shot(page, '02-komari-login.png');
  await page.getByPlaceholder('admin').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.locator('button').filter({ hasText: /^Login$/ }).last().click();
  await page.waitForTimeout(1500);
  await page.goto(`${komariBaseURL}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}

async function createKomariNode(adminPage) {
  await shot(adminPage, '03-komari-admin-home.png');
  await adminPage.getByRole('button', { name: 'Add' }).click();
  await adminPage.waitForTimeout(500);
  await shot(adminPage, '04-komari-add-node.png');
  await adminPage.getByPlaceholder('Name (optional)').fill(nodeName);
  await adminPage.locator('button').filter({ hasText: /^Add$/ }).last().click();
  await adminPage.waitForTimeout(1500);
  await adminPage.goto(`${komariBaseURL}/`, { waitUntil: 'domcontentloaded' });
  await adminPage.waitForTimeout(1500);
  await shot(adminPage, '05-komari-node-created.png');
  const href = await adminPage.locator('a[href*="/instance/"]').filter({ hasText: nodeName }).first().getAttribute('href');
  if (!href) throw new Error('failed to locate created Komari node');
  return `${komariBaseURL}${href}`;
}

async function openIntegration(page) {
  await page.goto(`${appBaseURL}/#/settings/integration`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('heading', { name: '接入配置' }).waitFor();
}

async function getLoaderCode(page) {
  const pre = page.locator('pre').filter({ hasText: '/embed/loader.js' }).first();
  await pre.waitFor();
  return pre.innerText();
}

async function setKomariCustomHeader(adminPage, loaderCode) {
  await adminPage.goto(`${komariBaseURL}/admin/settings/site`, { waitUntil: 'domcontentloaded' });
  await adminPage.waitForTimeout(1500);
  const headerField = adminPage.locator('textarea').nth(1);
  await headerField.fill(loaderCode);
  await shot(adminPage, '10-komari-custom-header-filled.png');
  await adminPage.locator('button').filter({ hasText: /^Save$/ }).nth(3).click();
  await adminPage.waitForTimeout(1500);
  await shot(adminPage, '11-komari-custom-header-saved.png');
}

async function connectThroughInjection(context, ipqPage, instanceURL) {
  const instancePage = await context.newPage();
  await instancePage.goto(instanceURL, { waitUntil: 'domcontentloaded' });
  await instancePage.waitForTimeout(4000);
  await shot(instancePage, '12-komari-detail-injected-button.png');
  const popupPromise = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await instancePage.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  let popup = await popupPromise;
  await instancePage.waitForTimeout(3000);
  if (!popup) {
    const candidate = context.pages().find((page) => page !== instancePage && page.url().includes('/#/nodes?report_config='));
    popup = candidate || null;
  }
  if (!popup && instancePage.url().includes('/#/nodes?report_config=')) {
    popup = instancePage;
  }
  if (!popup) {
    throw new Error('injection click did not open report config page');
  }
  await popup.waitForLoadState('domcontentloaded');
  await popup.locator('[data-node-report-config="true"]').waitFor();
  await popup.waitForTimeout(1000);
  await shot(popup, '13-komari-connect-result.png');
  await ipqPage.bringToFront();
  await ipqPage.goto(`${appBaseURL}/#/nodes`);
  await ipqPage.waitForLoadState('networkidle');
  await shot(ipqPage, '14-ipq-node-list-connected.png');
  return { popup, instancePage };
}

async function configureReport(popup) {
  await shot(popup, '15-report-config-empty.png');
  const nameInput = popup.locator('input').nth(0);
  await nameInput.fill(`${nodeName} 已接入`);
  await popup.getByRole('button', { name: '保存名称' }).click();
  await popup.waitForTimeout(500);
  const targetInput = popup.getByPlaceholder('例如 1.1.1.1 或 2606:4700:4700::1111');
  await targetInput.fill(targetA);
  await popup.getByRole('button', { name: '添加 IP' }).click();
  await popup.getByRole('button', { name: targetA, exact: true }).waitFor();
  await targetInput.fill(targetB);
  await popup.getByRole('button', { name: '添加 IP' }).click();
  await popup.getByRole('button', { name: targetB, exact: true }).waitFor();
  const cronInput = popup.getByPlaceholder('0 0 * * *');
  await cronInput.fill('*/30 * * * *');
  await popup.getByRole('button', { name: '使用浏览器时区' }).click();
  await popup.waitForTimeout(1500);
  await shot(popup, '16-report-config-multi-ip.png');
  await popup.getByRole('button', { name: '复制' }).click();
  await popup.waitForTimeout(500);
  await shot(popup, '17-report-config-command-copied.png');
  const command = await popup.locator('pre.report-config-command').innerText();
  return command;
}

async function waitForData(page) {
  await page.goto(`${appBaseURL}/#/nodes`);
  for (let i = 0; i < 20; i++) {
    await page.waitForLoadState('networkidle');
    const row = page.locator('[data-node-row="true"]').filter({ hasText: /已接入/ }).first();
    if (await row.count()) {
      const text = await row.innerText();
      if (text.includes('有数据')) return;
    }
    await page.reload();
    await page.waitForTimeout(1000);
  }
  throw new Error('node list did not reach has-data state');
}

async function openNodeDetail(page) {
  await page.goto(`${appBaseURL}/#/nodes`);
  await page.waitForLoadState('networkidle');
  await shot(page, '18-node-list-after-report.png');
  const row = page.locator('[data-node-row="true"]').filter({ hasText: /已接入/ }).first();
  const nodeUUID = await row.getAttribute('data-node-uuid');
  await row.click({ position: { x: 20, y: 20 } });
  await page.waitForURL(`**/#/nodes/${nodeUUID}`);
  await page.locator('[data-detail-report="true"]').waitFor();
  return nodeUUID;
}

async function captureDetailAndHistory(page) {
  await shot(page, '19-node-detail-first-target.png');
  await page.getByRole('button', { name: targetB, exact: true }).click();
  await page.waitForTimeout(1000);
  await shot(page, '20-node-detail-second-target.png');
  await page.getByRole('link', { name: '查看历史记录' }).click();
  await page.waitForURL('**/#/nodes/**/history**');
  await page.waitForLoadState('networkidle');
  await shot(page, '21-history-page.png');
  await page.getByRole('link', { name: '快照对比' }).click();
  await page.waitForURL('**/#/nodes/**/compare**');
  await page.waitForTimeout(1000);
  await shot(page, '22-compare-page.png');
  const favoriteButton = page.getByRole('button', { name: /收藏快照|取消收藏/ }).first();
  await favoriteButton.click();
  await page.waitForTimeout(1000);
  await shot(page, '23-compare-favorite.png');
}

async function captureHistoryRetention(page) {
  await page.goto(`${appBaseURL}/#/settings/history-retention`);
  await page.waitForLoadState('networkidle');
  await shot(page, '24-history-retention-page.png');
  const input = page.locator('input').first();
  await input.fill('30');
  await page.getByRole('button', { name: '保存历史保留设置' }).click();
  await page.waitForTimeout(1000);
  await shot(page, '25-history-retention-saved.png');
}

async function captureDefaultModal(context, instanceURL) {
  const page = await context.newPage();
  await page.goto(instanceURL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  await page.locator('#ipq-loader-overlay iframe').first().waitFor({ state: 'visible', timeout: 15000 });
  await shot(page, '26-default-admin-modal.png');
  await page.close();
}

async function setGuestRead(page, enabled, shotName) {
  await openIntegration(page);
  const checkbox = page.locator('input[type="checkbox"]').first();
  if ((await checkbox.isChecked()) !== enabled) {
    await checkbox.click();
    await page.getByRole('button', { name: '保存游客只读设置' }).click();
    await page.waitForTimeout(1500);
  }
  if (shotName) await shot(page, shotName);
}

async function captureGuestFlows(instanceURL) {
  const browser = await chromium.launch({ headless: true });
  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const guest = await guestContext.newPage();
  await guest.goto(instanceURL, { waitUntil: 'domcontentloaded' });
  await guest.waitForTimeout(4000);
  await guest.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  await guest.waitForTimeout(1500);
  await shot(guest, '27-default-guest-blocked.png');
  await guest.close();
  await browser.close();
}

async function captureGuestAllowed(instanceURL) {
  const browser = await chromium.launch({ headless: true });
  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const guest = await guestContext.newPage();
  await guest.goto(instanceURL, { waitUntil: 'domcontentloaded' });
  await guest.waitForTimeout(4000);
  await guest.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  await guest.locator('#ipq-loader-overlay iframe').first().waitFor({ state: 'visible', timeout: 15000 });
  await shot(guest, '29-default-guest-allowed.png');
  await guest.close();
  await browser.close();
}

async function uploadAndActivatePurCarte(adminPage) {
  await adminPage.goto(`${komariBaseURL}/admin/settings/theme`, { waitUntil: 'domcontentloaded' });
  await adminPage.waitForTimeout(2000);
  await shot(adminPage, '30-theme-management-default.png');
  await adminPage.getByRole('button', { name: 'Upload Theme' }).click();
  await adminPage.locator('input[type="file"]').setInputFiles(themeZip);
  await adminPage.waitForTimeout(3000);
  await shot(adminPage, '31-theme-upload-purcarte.png');
  const cards = adminPage.locator('.rt-BaseCard');
  const purCard = cards.filter({ hasText: 'Komari Theme PurCart' }).first();
  await purCard.locator('button').first().click();
  await adminPage.waitForTimeout(2000);
  await shot(adminPage, '32-theme-active-purcarte.png');
}

async function capturePurCarteFlows(context, instanceURL, integrationPage) {
  const home = await context.newPage();
  await home.goto(`${komariBaseURL}/`, { waitUntil: 'domcontentloaded' });
  await home.waitForTimeout(3000);
  await shot(home, '33-purcarte-home-button.png');

  const adminModal = await context.newPage();
  await adminModal.goto(instanceURL, { waitUntil: 'domcontentloaded' });
  await adminModal.waitForTimeout(4000);
  await adminModal.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  await adminModal.locator('#ipq-loader-overlay iframe').first().waitFor({ state: 'visible', timeout: 15000 });
  await shot(adminModal, '34-purcarte-admin-modal.png');
  await adminModal.close();

  await setGuestRead(integrationPage, false, '35-guest-read-disabled.png');
  const guest1 = await chromium.launch({ headless: true });
  const guestCtx1 = await guest1.newContext({ viewport: { width: 1440, height: 1100 } });
  const guestPage1 = await guestCtx1.newPage();
  await guestPage1.goto(instanceURL, { waitUntil: 'domcontentloaded' });
  await guestPage1.waitForTimeout(4000);
  await guestPage1.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  await guestPage1.waitForTimeout(1500);
  await shot(guestPage1, '36-purcarte-guest-blocked.png');
  await guest1.close();

  await setGuestRead(integrationPage, true, '37-guest-read-enabled.png');
  const guest2 = await chromium.launch({ headless: true });
  const guestCtx2 = await guest2.newContext({ viewport: { width: 1440, height: 1100 } });
  const guestPage2 = await guestCtx2.newPage();
  await guestPage2.goto(instanceURL, { waitUntil: 'domcontentloaded' });
  await guestPage2.waitForTimeout(4000);
  await guestPage2.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  await guestPage2.locator('#ipq-loader-overlay iframe').first().waitFor({ state: 'visible', timeout: 15000 });
  await shot(guestPage2, '38-purcarte-guest-allowed.png');
  await guest2.close();
}

async function captureUserSettings(page) {
  await page.goto(`${appBaseURL}/#/settings/user`);
  await page.waitForLoadState('networkidle');
  await shot(page, '39-user-settings-page.png');
  const username = page.locator('input').first();
  const password = page.locator('input[type="password"]').first();
  await username.fill('admin');
  await password.fill(tempPassword);
  await page.getByRole('button', { name: '保存并重新登录' }).click();
  await page.waitForURL('**/#/login', { timeout: 15000 });
  await shot(page, '40-user-settings-login-again.png');
  await page.getByRole('textbox', { name: '用户名' }).fill('admin');
  await page.getByLabel('密码').fill(tempPassword);
  await shot(page, '41-ipq-login-relogin.png');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/#/nodes');
}

async function captureExtraScreens(page) {
  const row = page.locator('[data-node-row="true"]').filter({ hasText: /已接入/ }).first();
  const nodeUUID = await row.getAttribute('data-node-uuid');
  await page.goto(`${appBaseURL}/#/nodes?report_config=${nodeUUID}`);
  await page.locator('[data-node-report-config="true"]').waitFor();
  await shot(page, '42-report-config-target-toggle.png');

  await page.goto(`${appBaseURL}/#/settings/notification`);
  await page.waitForTimeout(5000);
  await shot(page, '43-notification-page.png');

  await page.goto(`${appBaseURL}/#/settings/api-keys`);
  await page.waitForLoadState('networkidle');
  await page.locator('input').first().fill('手册演示 API Key');
  await page.getByRole('button', { name: '创建 API Key' }).click();
  await page.getByText('请立即保存明文 Key', { exact: false }).waitFor();
  await shot(page, '44-api-key-created.png');

  await page.goto(`${appBaseURL}/#/nodes`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '新建节点' }).click();
  await page.waitForTimeout(500);
  await shot(page, '45-standalone-create.png');
  await page.getByPlaceholder('例如 香港边缘节点').fill(standaloneName);
  await page.getByRole('button', { name: '创建并配置' }).click();
  await page.locator('[data-node-report-config="true"]').waitFor();
  await shot(page, '46-standalone-bind.png');
  const bindSelect = page.locator('select').first();
  const options = await bindSelect.locator('option').evaluateAll((els) =>
    els.map((e) => ({ value: e.getAttribute('value') || '', text: (e.textContent || '').trim() })).filter((item) => item.value && item.text && !item.text.includes('请选择'))
  );
  if (options.length) {
    await bindSelect.selectOption(options[0].value);
    await page.locator('input').nth(1).fill(options[0].text.split(' · ')[0]);
    await page.getByRole('button', { name: '绑定 Komari' }).click();
    await page.waitForTimeout(1500);
    await shot(page, '47-standalone-bound.png');
  }
}

async function restoreAdminPassword(page) {
  await page.goto(`${appBaseURL}/#/settings/user`);
  await page.waitForLoadState('networkidle');
  await page.locator('input').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('admin');
  await page.getByRole('button', { name: '保存并重新登录' }).click();
  await page.waitForURL('**/#/login', { timeout: 15000 });
  await page.getByRole('textbox', { name: '用户名' }).fill('admin');
  await page.getByLabel('密码').fill('admin');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/#/nodes');
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Asia/Shanghai' });
const komariAdmin = await context.newPage();
const ipq = await context.newPage();

try {
  const home = await context.newPage();
  await home.goto(`${komariBaseURL}/`, { waitUntil: 'domcontentloaded' });
  await home.waitForTimeout(1500);
  await shot(home, '01-komari-empty.png');
  await home.close();

  await loginKomariAdmin(komariAdmin);
  const instanceURL = await createKomariNode(komariAdmin);
  await loginIPQ(ipq, 'admin', true);
  await shot(ipq, '07-ipq-empty-nodes.png');
  await openIntegration(ipq);
  await shot(ipq, '08-integration-loader.png');
  await ipq.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await ipq.waitForTimeout(500);
  await shot(ipq, '09-integration-inline.png');
  const loaderCode = await getLoaderCode(ipq);
  await setKomariCustomHeader(komariAdmin, loaderCode);
  const { popup } = await connectThroughInjection(context, ipq, instanceURL);
  const installCommand = await configureReport(popup);
  sh(installCommand);
  sh(`bash /opt/ipq-reporter-${instanceUUID(instanceURL)}/run.sh`);
  await ipq.waitForTimeout(2000);
  await waitForData(ipq);
  await openNodeDetail(ipq);
  await captureDetailAndHistory(ipq);
  await captureHistoryRetention(ipq);
  await captureDefaultModal(context, instanceURL);
  await setGuestRead(ipq, false, null);
  await captureGuestFlows(instanceURL);
  await setGuestRead(ipq, true, '28-guest-read-enabled.png');
  await captureGuestAllowed(instanceURL);
  await uploadAndActivatePurCarte(komariAdmin);
  await capturePurCarteFlows(context, instanceURL, ipq);
  await captureUserSettings(ipq);
  await captureExtraScreens(ipq);
  await restoreAdminPassword(ipq);
} finally {
  await browser.close();
}
