import { chromium } from 'playwright';
import path from 'node:path';

const komariBaseURL = 'http://127.0.0.1:8080';
const appBaseURL = 'http://127.0.0.1:8090';
const outDir = path.resolve('docs/assets/用户操作手册');
const themeZip = '/tmp/Komari-theme-purcarte.zip';
const tempNodeName = `手册临时节点-${Date.now()}`;
const standaloneName = `手册独立节点-${Date.now()}`;
const tempPassword = 'admin123456';

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
}

async function loginKomari(page, captureLogin = false) {
  await page.goto(`${komariBaseURL}/admin`, { waitUntil: 'domcontentloaded' });
  if (captureLogin) await shot(page, '02-komari-login.png');
  await page.getByPlaceholder('admin').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.locator('button').filter({ hasText: /^Login$/ }).last().click();
  await page.waitForTimeout(1500);
}

async function loginIPQ(page, password = 'admin', capture = false) {
  await page.goto(`${appBaseURL}/#/login`);
  if (capture) await shot(page, '06-ipq-login.png');
  await page.getByRole('textbox', { name: '用户名' }).fill('admin');
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForTimeout(1500);
}

async function getConnectedNode(page) {
  await page.goto(`${appBaseURL}/#/nodes`);
  await page.waitForLoadState('networkidle');
  const row = page.locator('[data-node-row="true"]').filter({ hasText: '有数据' }).first();
  const rowText = await row.innerText();
  const nodeUUID = await row.getAttribute('data-node-uuid');
  const komariUUIDMatch = rowText.match(/Komari 已绑定 ·\s*([0-9a-f-]+)/i);
  const name = rowText.split('\n')[0].trim();
  return { row, rowText, nodeUUID, komariUUID: komariUUIDMatch?.[1] || '', name };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Asia/Shanghai' });
const komariAdmin = await context.newPage();
const ipq = await context.newPage();

try {
  const komariHome = await context.newPage();
  await komariHome.goto(`${komariBaseURL}/`, { waitUntil: 'domcontentloaded' });
  await komariHome.waitForTimeout(1500);
  await shot(komariHome, '01-komari-empty.png');
  await komariHome.close();

  await loginKomari(komariAdmin, true);
  await komariAdmin.goto(`${komariBaseURL}/admin`, { waitUntil: 'domcontentloaded' });
  await komariAdmin.waitForTimeout(1500);
  await shot(komariAdmin, '03-komari-admin-home.png');

  await komariAdmin.getByRole('button', { name: 'Add' }).click();
  await komariAdmin.waitForTimeout(500);
  await shot(komariAdmin, '04-komari-add-node.png');
  await komariAdmin.getByPlaceholder('Name (optional)').fill(tempNodeName);
  await komariAdmin.locator('button').filter({ hasText: /^Add$/ }).last().click();
  await komariAdmin.waitForTimeout(1500);
  await komariAdmin.goto(`${komariBaseURL}/`, { waitUntil: 'domcontentloaded' });
  await komariAdmin.waitForTimeout(1500);
  await shot(komariAdmin, '05-komari-node-created.png');
  const tempHref = await komariAdmin.locator('a[href*="/instance/"]').filter({ hasText: tempNodeName }).first().getAttribute('href');

  await loginIPQ(ipq, 'admin', true);
  await ipq.goto(`${appBaseURL}/#/nodes`);
  await ipq.waitForLoadState('networkidle');
  await shot(ipq, '07-ipq-empty-nodes.png');

  await ipq.goto(`${appBaseURL}/#/settings/integration`);
  await ipq.waitForLoadState('networkidle');
  await shot(ipq, '08-integration-loader.png');
  await ipq.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await ipq.waitForTimeout(500);
  await shot(ipq, '09-integration-inline.png');
  const loaderCode = await ipq.locator('pre').filter({ hasText: '/embed/loader.js' }).first().innerText();

  await komariAdmin.goto(`${komariBaseURL}/admin/settings/site`, { waitUntil: 'domcontentloaded' });
  await komariAdmin.waitForTimeout(1500);
  await komariAdmin.locator('textarea').nth(1).fill(loaderCode);
  await shot(komariAdmin, '10-komari-custom-header-filled.png');
  await komariAdmin.locator('button').filter({ hasText: /^Save$/ }).nth(3).click();
  await komariAdmin.waitForTimeout(1500);
  await shot(komariAdmin, '11-komari-custom-header-saved.png');

  const connected = await getConnectedNode(ipq);
  const connectedInstance = await context.newPage();
  await connectedInstance.goto(`${komariBaseURL}/instance/${connected.komariUUID}`, { waitUntil: 'domcontentloaded' });
  await connectedInstance.waitForTimeout(4000);
  await shot(connectedInstance, '12-komari-detail-injected-button.png');

  const tempInstance = await context.newPage();
  await tempInstance.goto(`${komariBaseURL}${tempHref}`, { waitUntil: 'domcontentloaded' });
  await tempInstance.waitForTimeout(4000);
  const popupPromise = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await tempInstance.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  let popup = await popupPromise;
  await tempInstance.waitForTimeout(3000);
  if (!popup) popup = context.pages().find((p) => p.url().includes('/#/nodes?report_config=')) || null;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded');
    await popup.locator('[data-node-report-config="true"]').waitFor();
    await shot(popup, '13-komari-connect-result.png');
  }

  await ipq.goto(`${appBaseURL}/#/nodes`);
  await ipq.waitForLoadState('networkidle');
  await shot(ipq, '14-ipq-node-list-connected.png');

  const reportConfigButton = connected.row.getByRole('button', { name: '上报设置' }).first();
  await reportConfigButton.click();
  await ipq.locator('[data-node-report-config="true"]').waitFor();
  await shot(ipq, '15-report-config-empty.png');
  await shot(ipq, '16-report-config-multi-ip.png');
  await ipq.getByRole('button', { name: '复制' }).click();
  await ipq.waitForTimeout(500);
  await shot(ipq, '17-report-config-command-copied.png');
  await ipq.getByRole('button', { name: '关闭', exact: true }).click();

  await ipq.goto(`${appBaseURL}/#/nodes`);
  await ipq.waitForLoadState('networkidle');
  await shot(ipq, '18-node-list-after-report.png');
  const connectedAgain = await getConnectedNode(ipq);
  await connectedAgain.row.click({ position: { x: 20, y: 20 } });
  await ipq.waitForLoadState('networkidle');
  await shot(ipq, '19-node-detail-first-target.png');
  if (await ipq.getByRole('button', { name: '8.8.8.8', exact: true }).count()) {
    await ipq.getByRole('button', { name: '8.8.8.8', exact: true }).click();
    await ipq.waitForTimeout(1000);
  }
  await shot(ipq, '20-node-detail-second-target.png');

  if (await ipq.getByRole('link', { name: '查看历史记录' }).count()) {
    await ipq.getByRole('link', { name: '查看历史记录' }).click();
    await ipq.waitForLoadState('networkidle');
    await shot(ipq, '21-history-page.png');
    if (await ipq.getByRole('link', { name: '快照对比' }).count()) {
      await ipq.getByRole('link', { name: '快照对比' }).click();
      await ipq.waitForTimeout(1000);
      await shot(ipq, '22-compare-page.png');
      const fav = ipq.getByRole('button', { name: /收藏快照|取消收藏/ }).first();
      if (await fav.count()) {
        await fav.click();
        await ipq.waitForTimeout(1000);
      }
      await shot(ipq, '23-compare-favorite.png');
    }
  }

  await ipq.goto(`${appBaseURL}/#/settings/history-retention`);
  await ipq.waitForLoadState('networkidle');
  await shot(ipq, '24-history-retention-page.png');
  const retentionInput = ipq.locator('input').first();
  if ((await retentionInput.inputValue()) !== '30') {
    await retentionInput.fill('30');
    await ipq.getByRole('button', { name: '保存历史保留设置' }).click();
    await ipq.waitForTimeout(1000);
  }
  await shot(ipq, '25-history-retention-saved.png');

  await connectedInstance.bringToFront();
  await connectedInstance.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  await connectedInstance.locator('#ipq-loader-overlay iframe').first().waitFor({ state: 'visible', timeout: 15000 });
  await shot(connectedInstance, '26-default-admin-modal.png');

  await ipq.goto(`${appBaseURL}/#/settings/integration`);
  await ipq.waitForLoadState('networkidle');
  const guestCheckbox = ipq.locator('input[type="checkbox"]').first();
  if (await guestCheckbox.isChecked()) {
    await guestCheckbox.click();
    await ipq.getByRole('button', { name: '保存游客只读设置' }).click();
    await ipq.waitForTimeout(1500);
  }
  const guestBrowser1 = await chromium.launch({ headless: true });
  const guestCtx1 = await guestBrowser1.newContext({ viewport: { width: 1440, height: 1100 } });
  const guestPage1 = await guestCtx1.newPage();
  await guestPage1.goto(`${komariBaseURL}/instance/${connected.komariUUID}`, { waitUntil: 'domcontentloaded' });
  await guestPage1.waitForTimeout(4000);
  await guestPage1.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  await guestPage1.waitForTimeout(1000);
  await shot(guestPage1, '27-default-guest-blocked.png');
  await guestBrowser1.close();

  if (!(await guestCheckbox.isChecked())) {
    await guestCheckbox.click();
    await ipq.getByRole('button', { name: '保存游客只读设置' }).click();
    await ipq.waitForTimeout(1500);
  }
  await shot(ipq, '28-guest-read-enabled.png');
  const guestBrowser2 = await chromium.launch({ headless: true });
  const guestCtx2 = await guestBrowser2.newContext({ viewport: { width: 1440, height: 1100 } });
  const guestPage2 = await guestCtx2.newPage();
  await guestPage2.goto(`${komariBaseURL}/instance/${connected.komariUUID}`, { waitUntil: 'domcontentloaded' });
  await guestPage2.waitForTimeout(4000);
  await guestPage2.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  await guestPage2.locator('#ipq-loader-overlay iframe').first().waitFor({ state: 'visible', timeout: 15000 });
  await shot(guestPage2, '29-default-guest-allowed.png');
  await guestBrowser2.close();

  await komariAdmin.goto(`${komariBaseURL}/admin/settings/theme`, { waitUntil: 'domcontentloaded' });
  await komariAdmin.waitForTimeout(1500);
  await shot(komariAdmin, '30-theme-management-default.png');
  await komariAdmin.getByRole('button', { name: 'Upload Theme' }).click();
  await komariAdmin.locator('input[type="file"]').setInputFiles(themeZip);
  await komariAdmin.waitForTimeout(3000);
  await shot(komariAdmin, '31-theme-upload-purcarte.png');
  const cards = komariAdmin.locator('.rt-BaseCard');
  const purCard = cards.filter({ hasText: 'Komari Theme PurCart' }).first();
  if (await purCard.count()) {
    await purCard.locator('button').first().click();
    await komariAdmin.waitForTimeout(2000);
    await shot(komariAdmin, '32-theme-active-purcarte.png');
  }
  const purHome = await context.newPage();
  await purHome.goto(`${komariBaseURL}/`, { waitUntil: 'domcontentloaded' });
  await purHome.waitForTimeout(3000);
  await shot(purHome, '33-purcarte-home-button.png');
  const purInstance = await context.newPage();
  await purInstance.goto(`${komariBaseURL}/instance/${connected.komariUUID}`, { waitUntil: 'domcontentloaded' });
  await purInstance.waitForTimeout(4000);
  await purInstance.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  await purInstance.locator('#ipq-loader-overlay iframe').first().waitFor({ state: 'visible', timeout: 15000 });
  await shot(purInstance, '34-purcarte-admin-modal.png');

  await ipq.goto(`${appBaseURL}/#/settings/integration`);
  await ipq.waitForLoadState('networkidle');
  const guestCheckbox2 = ipq.locator('input[type="checkbox"]').first();
  if (await guestCheckbox2.isChecked()) await guestCheckbox2.click();
  await ipq.getByRole('button', { name: '保存游客只读设置' }).click();
  await ipq.waitForTimeout(1500);
  await shot(ipq, '35-guest-read-disabled.png');
  const guestBrowser3 = await chromium.launch({ headless: true });
  const guestCtx3 = await guestBrowser3.newContext({ viewport: { width: 1440, height: 1100 } });
  const guestPage3 = await guestCtx3.newPage();
  await guestPage3.goto(`${komariBaseURL}/instance/${connected.komariUUID}`, { waitUntil: 'domcontentloaded' });
  await guestPage3.waitForTimeout(4000);
  await guestPage3.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  await guestPage3.waitForTimeout(1000);
  await shot(guestPage3, '36-purcarte-guest-blocked.png');
  await guestBrowser3.close();
  if (!(await guestCheckbox2.isChecked())) await guestCheckbox2.click();
  await ipq.getByRole('button', { name: '保存游客只读设置' }).click();
  await ipq.waitForTimeout(1500);
  await shot(ipq, '37-guest-read-enabled.png');
  const guestBrowser4 = await chromium.launch({ headless: true });
  const guestCtx4 = await guestBrowser4.newContext({ viewport: { width: 1440, height: 1100 } });
  const guestPage4 = await guestCtx4.newPage();
  await guestPage4.goto(`${komariBaseURL}/instance/${connected.komariUUID}`, { waitUntil: 'domcontentloaded' });
  await guestPage4.waitForTimeout(4000);
  await guestPage4.getByRole('button', { name: /打开 IP 质量|查看 IP 质量/ }).click();
  await guestPage4.locator('#ipq-loader-overlay iframe').first().waitFor({ state: 'visible', timeout: 15000 });
  await shot(guestPage4, '38-purcarte-guest-allowed.png');
  await guestBrowser4.close();

  await ipq.goto(`${appBaseURL}/#/settings/user`);
  await ipq.waitForLoadState('networkidle');
  await shot(ipq, '39-user-settings-page.png');
  await ipq.locator('input').first().fill('admin');
  await ipq.locator('input[type="password"]').first().fill(tempPassword);
  await ipq.getByRole('button', { name: '保存并重新登录' }).click();
  await ipq.waitForURL('**/#/login', { timeout: 15000 });
  await shot(ipq, '40-user-settings-login-again.png');
  await ipq.getByRole('textbox', { name: '用户名' }).fill('admin');
  await ipq.getByLabel('密码').fill(tempPassword);
  await shot(ipq, '41-ipq-login-relogin.png');
  await ipq.getByRole('button', { name: '登录' }).click();
  await ipq.waitForTimeout(1500);

  const connectedForExtra = await getConnectedNode(ipq);
  await connectedForExtra.row.getByRole('button', { name: '上报设置' }).click();
  await ipq.locator('[data-node-report-config="true"]').waitFor();
  await shot(ipq, '42-report-config-target-toggle.png');
  await ipq.getByRole('button', { name: '关闭', exact: true }).click();

  await ipq.goto(`${appBaseURL}/#/settings/notification`);
  await ipq.waitForTimeout(5000);
  await shot(ipq, '43-notification-page.png');

  await ipq.goto(`${appBaseURL}/#/settings/api-keys`);
  await ipq.waitForLoadState('networkidle');
  await ipq.locator('input').first().fill(`手册演示 API Key ${Date.now()}`);
  await ipq.getByRole('button', { name: '创建 API Key' }).click();
  await ipq.waitForTimeout(1000);
  await shot(ipq, '44-api-key-created.png');

  await ipq.goto(`${appBaseURL}/#/nodes`);
  await ipq.waitForLoadState('networkidle');
  await ipq.getByRole('button', { name: '新建节点' }).click();
  await ipq.waitForTimeout(500);
  await shot(ipq, '45-standalone-create.png');
  await ipq.getByPlaceholder('例如 香港边缘节点').fill(standaloneName);
  await ipq.getByRole('button', { name: '创建并配置' }).click();
  await ipq.locator('[data-node-report-config="true"]').waitFor();
  await shot(ipq, '46-standalone-bind.png');
  const bindSelect = ipq.locator('select').first();
  const options = await bindSelect.locator('option').evaluateAll((els) =>
    els.map((e) => ({ value: e.getAttribute('value') || '', text: (e.textContent || '').trim() })).filter((item) => item.value && item.text && !item.text.includes('请选择'))
  );
  if (options.length) {
    await bindSelect.selectOption(options[0].value);
    await ipq.locator('input').nth(1).fill(options[0].text.split(' · ')[0]);
    await ipq.getByRole('button', { name: '绑定 Komari' }).click();
    await ipq.waitForTimeout(1500);
    await shot(ipq, '47-standalone-bound.png');
  }
} finally {
  await browser.close();
}
