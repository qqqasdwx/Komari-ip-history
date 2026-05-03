import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const integrationPublicBaseURL = (
  process.env.IPQ_INTEGRATION_PUBLIC_BASE_URL ||
  appBaseURL
).replace(/\/$/, "");
const komariBaseURL = (
  process.env.KOMARI_DEFAULT_BASE_URL ||
  process.env.KOMARI_BASE_URL ||
  "http://127.0.0.1:8080"
).replace(/\/$/, "");
const nodeName = process.env.IPQ_FIXED_REPORTER_NAME || "真实上报-Debian页面接入";
const legacyNodeNames = new Set([
  nodeName,
  "真实上报-Debian自动发现"
]);
const scheduleCron = process.env.IPQ_FIXED_REPORTER_CRON || "0 * * * *";
const scheduleTimezone = process.env.IPQ_FIXED_REPORTER_TIMEZONE || "UTC";
const outputDir = path.resolve("playwright-output", "fixed-debian-reporter");
const outputPath = process.env.IPQ_FIXED_REPORTER_COMMAND_PATH
  ? path.resolve(process.env.IPQ_FIXED_REPORTER_COMMAND_PATH)
  : path.join(outputDir, "command.json");

mkdirSync(path.dirname(outputPath), { recursive: true });
mkdirSync(outputDir, { recursive: true });

function log(message) {
  console.log(`[fixed-reporter-ui] ${message}`);
}

function parseJSON(result, label) {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${label} failed: ${result.status} ${result.text}`);
  }
  return result.text ? JSON.parse(result.text) : {};
}

async function jsonFetch(page, url, options) {
  return page.evaluate(
    async ({ url, options }) => {
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
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

async function apiOK(page, url, options, label) {
  return parseJSON(await jsonFetch(page, url, options), label);
}

async function requestJSON(context, url, options = {}) {
  const response = await context.request.fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const text = await response.text();
  return { status: response.status(), text };
}

async function loginIPQ(page) {
  log(`login IPQ at ${appBaseURL}`);
  await page.goto(`${appBaseURL}/#/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  if ((await page.getByRole("heading", { name: "节点列表" }).count()) === 0) {
    await page.getByRole("textbox", { name: "用户名" }).fill("admin");
    await page.getByLabel("密码").fill("admin");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/#/nodes", { timeout: 15000 });
  }
  await page.getByRole("heading", { name: "节点列表" }).waitFor({ state: "visible", timeout: 10000 });
}

async function loginKomari(page, baseURL) {
  log(`login Komari at ${baseURL}`);
  await page.context().request.post(`${baseURL}/api/login`, {
    data: { username: "admin", password: "admin" }
  }).catch(() => {});
  const authCheck = await page.context().request.get(`${baseURL}/api/admin/client/list`).catch(() => null);
  if (!authCheck || authCheck.status() < 200 || authCheck.status() >= 300) {
    throw new Error(`Komari login failed at ${baseURL}`);
  }
  await page.goto(`${baseURL}/admin`, { waitUntil: "domcontentloaded", timeout: 20000 });
  if ((await page.locator('input[placeholder="admin"]').count()) > 0) {
    await page.locator('input[placeholder="admin"]').fill("admin");
    await page.locator('input[type="password"]').fill("admin");
    await page.getByRole("button", { name: "Login" }).last().click();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }
  await page.waitForTimeout(250);
}

async function cleanupFixedNodes(appPage, komariPage) {
  log("cleanup old fixed reporter nodes");
  const context = appPage.context();
  const ipqResult = await requestJSON(context, `${appBaseURL}/api/v1/nodes`).catch(() => null);
  const ipqPayload = ipqResult && ipqResult.status >= 200 && ipqResult.status < 300 && ipqResult.text
    ? JSON.parse(ipqResult.text)
    : {};
  const ipqNodes = Array.isArray(ipqPayload.items) ? ipqPayload.items : [];
  for (const node of ipqNodes.filter((item) => legacyNodeNames.has(String(item.name || "")))) {
    await requestJSON(context, `${appBaseURL}/api/v1/nodes/${node.node_uuid || node.komari_node_uuid}`, { method: "DELETE" }).catch(() => {});
  }

  await requestJSON(context, `${komariBaseURL}/api/login`, {
    method: "POST",
    data: { username: "admin", password: "admin" }
  }).catch(() => {});
  const komariResult = await requestJSON(context, `${komariBaseURL}/api/admin/client/list`).catch(() => null);
  const komariNodes = komariResult && komariResult.status >= 200 && komariResult.status < 300 && komariResult.text
    ? JSON.parse(komariResult.text)
    : [];
  for (const node of komariNodes.filter((item) => legacyNodeNames.has(String(item.name || "")))) {
    await requestJSON(context, `${komariBaseURL}/api/admin/client/${node.uuid}/remove`, {
      method: "POST",
      data: {}
    }).catch(() => {});
  }
  await komariPage.waitForTimeout(500);
}

async function configureIntegrationFromUI(appPage) {
  log("configure IPQ integration from UI");
  await appPage.goto(`${appBaseURL}/#/settings/integration`, { waitUntil: "domcontentloaded" });
  await appPage.getByRole("heading", { name: "接入配置" }).waitFor({ state: "visible", timeout: 10000 });

  const addressInput = appPage.getByLabel("手动覆盖地址（可选）");
  await addressInput.fill(integrationPublicBaseURL);
  const saveAddressButton = appPage.getByRole("button", { name: "保存" }).first();
  if (await saveAddressButton.isEnabled()) {
    await saveAddressButton.click();
    await appPage.getByText(`当前已固定为：${integrationPublicBaseURL}`, { exact: true }).waitFor({
      state: "visible",
      timeout: 10000
    });
  }

  const loaderCode = (await appPage.locator("pre.code-block").first().innerText()).trim();
  if (!loaderCode.includes("/embed/loader.js")) {
    throw new Error("loader header code was not rendered");
  }
  return loaderCode;
}

async function setKomariHeaderFromUI(page, baseURL, loaderCode) {
  log("paste Komari Custom Header from UI");
  await loginKomari(page, baseURL);
  await page.goto(`${baseURL}/admin/settings/site`, { waitUntil: "domcontentloaded" });
  await page.getByText("Custom Header", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.locator("textarea").nth(1).fill(loaderCode);
  await page.screenshot({ path: path.join(outputDir, "01-komari-custom-header.png"), fullPage: true });
  await page.locator("button").filter({ hasText: "Save" }).nth(3).click();
  await page.waitForTimeout(1000);

  const settings = await apiOK(page, `${baseURL}/api/admin/settings/`, undefined, "load Komari settings after header save");
  if ((settings.data?.custom_head || "").trim() !== loaderCode.trim()) {
    throw new Error("Komari Custom Header was not saved from the UI");
  }
}

async function listKomariNodes(page, baseURL) {
  const result = await jsonFetch(page, `${baseURL}/api/admin/client/list`);
  const payload = parseJSON(result, "list Komari nodes");
  return Array.isArray(payload) ? payload : [];
}

async function createKomariNodeFromUI(page, baseURL) {
  log(`create Komari node from UI: ${nodeName}`);
  await loginKomari(page, baseURL);
  await page.getByRole("button", { name: "Add" }).first().click();
  await page.getByPlaceholder("Name (optional)").fill(nodeName);
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/admin/client/add"), {
    timeout: 10000
  });
  await page.getByRole("button", { name: "Add" }).last().click();
  const response = await responsePromise;
  if (response.status() < 200 || response.status() >= 300) {
    throw new Error(`Komari node create failed with ${response.status()}`);
  }
  await page.waitForTimeout(500);
  const nodes = await listKomariNodes(page, baseURL);
  const node = nodes.find((item) => item.name === nodeName);
  if (!node?.uuid) {
    throw new Error(`created Komari node UUID not found: ${nodeName}`);
  }
  await page.goto(`${baseURL}/instance/${node.uuid}`, { waitUntil: "domcontentloaded" });
  await page.getByText(nodeName, { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  await page.screenshot({ path: path.join(outputDir, "02-komari-node-created.png"), fullPage: true });
  return node;
}

async function clickIpqAction(page) {
  const accessibleButton = page.getByRole("button", { name: /IP 质量|开启 IP 质量检测/ }).first();
  if ((await accessibleButton.count()) > 0) {
    await accessibleButton.waitFor({ state: "visible", timeout: 15000 });
    await accessibleButton.click();
    return;
  }
  const textButton = page.locator("button").filter({ hasText: /IP 质量|开启 IP 质量检测/ }).first();
  if ((await textButton.count()) > 0) {
    await textButton.waitFor({ state: "visible", timeout: 15000 });
    await textButton.click();
    return;
  }
  const defaultHomeButton = page.locator('[data-ipq-default-home-button="true"]').first();
  if ((await defaultHomeButton.count()) > 0) {
    await defaultHomeButton.waitFor({ state: "visible", timeout: 15000 });
    await defaultHomeButton.click();
    return;
  }
  await page.locator('[data-ipq-purcarte-button="true"]').first().click();
}

async function connectNodeFromKomariUI(page, baseURL, node) {
  log("connect node from Komari injected button");
  await page.goto(`${baseURL}/instance/${node.uuid}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText(node.name, { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  await clickIpqAction(page);
  const connectButton = page.getByRole("button", { name: "去接入" }).first();
  await connectButton.waitFor({ state: "visible", timeout: 15000 });
  await page.screenshot({ path: path.join(outputDir, "03-komari-connect-prompt.png"), fullPage: true });
  const [standalonePage] = await Promise.all([
    page.context().waitForEvent("page"),
    connectButton.click()
  ]);
  await standalonePage.waitForLoadState("domcontentloaded");
  const loginVisible = await standalonePage.getByRole("textbox", { name: "用户名" }).waitFor({
    state: "visible",
    timeout: 3000
  }).then(
    () => true,
    () => false
  );
  if (standalonePage.url().includes("#/login") || loginVisible) {
    await standalonePage.getByRole("textbox", { name: "用户名" }).fill("admin");
    await standalonePage.getByLabel("密码").fill("admin");
    await standalonePage.getByRole("button", { name: "登录" }).click();
  }
  await standalonePage.locator('[data-node-report-config="true"]').waitFor({ state: "visible", timeout: 15000 });
  await standalonePage.locator('[data-komari-return-hint="true"]').waitFor({ state: "visible", timeout: 10000 });
  return standalonePage;
}

async function waitForNodeReportConfig(page, uuid, predicate, label) {
  let lastDetail = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await requestJSON(page.context(), `${appBaseURL}/api/v1/nodes/${uuid}?_=${Date.now()}`);
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

async function configureScheduleAndReadInstallCommand(page, uuid) {
  log("configure schedule and read install command from UI");
  await page.getByLabel("Cron").fill(scheduleCron);
  await page.getByLabel("解析时区").selectOption(scheduleTimezone);
  const runImmediatelyCheckbox = page.locator('[data-node-report-config="true"] input[type="checkbox"]').first();
  if (!(await runImmediatelyCheckbox.isChecked())) {
    await runImmediatelyCheckbox.check();
  }
  await waitForNodeReportConfig(
    page,
    uuid,
    (config) =>
      config.schedule_cron === scheduleCron &&
      config.schedule_timezone === scheduleTimezone &&
      config.run_immediately === true,
    "fixed reporter schedule did not persist from UI"
  );
  await page.getByText("接入命令", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const installCommand = (await page.locator("pre.report-config-command").innerText()).trim();
  if (!installCommand.includes("raw.githubusercontent.com") || !/(^|\s)'?-t'?(?=\s)/.test(installCommand)) {
    throw new Error(`install command should come from the UI and use install token: ${installCommand}`);
  }
  await page.screenshot({ path: path.join(outputDir, "04-ipq-report-config-command.png"), fullPage: true });
  return installCommand;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  permissions: ["clipboard-read", "clipboard-write"],
  viewport: { width: 1440, height: 1100 }
});
const appPage = await context.newPage();
const komariPage = await context.newPage();
for (const page of [appPage, komariPage]) {
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(25000);
}

try {
  await loginIPQ(appPage);
  await cleanupFixedNodes(appPage, komariPage);
  const loaderCode = await configureIntegrationFromUI(appPage);
  await setKomariHeaderFromUI(komariPage, komariBaseURL, loaderCode);
  const node = await createKomariNodeFromUI(komariPage, komariBaseURL);
  const reportConfigPage = await connectNodeFromKomariUI(komariPage, komariBaseURL, node);
  const installCommand = await configureScheduleAndReadInstallCommand(reportConfigPage, node.uuid);
  const detail = await apiOK(appPage, `${appBaseURL}/api/v1/nodes/${node.uuid}`, undefined, "load fixed node detail");

  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        appBaseURL,
        integrationPublicBaseURL,
        komariBaseURL,
        nodeName,
        komariNodeUUID: node.uuid,
        ipqNodeUUID: detail.node_uuid,
        scheduleCron,
        scheduleTimezone,
        installCommand,
        generatedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
  console.log(`prepare-fixed-debian-reporter-node: ${outputPath}`);
} finally {
  await browser.close().catch(() => {});
}
