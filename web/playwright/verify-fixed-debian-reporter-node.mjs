import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const commandPath = process.env.IPQ_FIXED_REPORTER_COMMAND_PATH
  ? path.resolve(process.env.IPQ_FIXED_REPORTER_COMMAND_PATH)
  : path.resolve("playwright-output", "fixed-debian-reporter", "command.json");
const commandInfo = existsSync(commandPath)
  ? JSON.parse(readFileSync(commandPath, "utf8"))
  : {};
const appBaseURL = (
  process.env.IPQ_PUBLIC_BASE_URL ||
  commandInfo.appBaseURL ||
  "http://127.0.0.1:8090"
).replace(/\/$/, "");
const nodeName = process.env.IPQ_FIXED_REPORTER_NAME || commandInfo.nodeName || "真实上报-Debian页面接入";
const outputDir = path.resolve("playwright-output", "fixed-debian-reporter");

mkdirSync(outputDir, { recursive: true });

function log(message) {
  console.log(`[fixed-reporter-ui] ${message}`);
}

async function loginIPQ(page) {
  await page.goto(`${appBaseURL}/#/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  if ((await page.getByRole("heading", { name: "节点列表" }).count()) === 0) {
    await page.getByRole("textbox", { name: "用户名" }).fill("admin");
    await page.getByLabel("密码").fill("admin");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/#/nodes", { timeout: 15000 });
  }
  await page.getByRole("heading", { name: "节点列表" }).waitFor({ state: "visible", timeout: 10000 });
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

async function loadNodeDetail(context, uuid) {
  const result = await requestJSON(context, `${appBaseURL}/api/v1/nodes/${uuid}?_=${Date.now()}`);
  if (result.status < 200 || result.status >= 300) {
    return null;
  }
  return JSON.parse(result.text);
}

async function openFixedNodeRow(page) {
  await page.goto(`${appBaseURL}/#/nodes`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "节点列表" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByPlaceholder("搜索节点名称").fill(nodeName);
  await page.getByPlaceholder("搜索节点名称").press("Enter");
  const row = page.locator('[data-node-row="true"]').filter({ hasText: nodeName }).first();
  await row.waitFor({ state: "visible", timeout: 15000 });
  return row;
}

async function tryOpenDetailWithData(page) {
  const row = await openFixedNodeRow(page);
  const uuid = await row.getAttribute("data-node-uuid");
  if (!uuid) {
    throw new Error("fixed reporter row is missing data-node-uuid");
  }
  const detail = await loadNodeDetail(page.context(), uuid);
  const dataTargets = (detail?.targets || []).filter((target) => target.has_data && target.updated_at);
  if (!detail?.has_data || dataTargets.length === 0) {
    return false;
  }
  await row.click({ position: { x: 24, y: 24 } });
  await page.waitForURL("**/#/nodes/**", { timeout: 5000 }).catch(() => {});
  const report = page.locator('[data-detail-report="true"]').first();
  const visible = await report.waitFor({ state: "visible", timeout: 2500 }).then(
    () => true,
    () => false
  );
  if (!visible) {
    return false;
  }
  const bodyText = await page.locator("body").innerText();
  if (!bodyText.includes(nodeName)) {
    throw new Error("fixed reporter detail page did not render the expected node name");
  }
  if (!dataTargets.some((target) => bodyText.includes(target.ip))) {
    throw new Error(`fixed reporter detail page did not render a reported target IP: ${dataTargets.map((target) => target.ip).join(", ")}`);
  }
  await page.screenshot({ path: path.join(outputDir, "05-ipq-fixed-node-data.png"), fullPage: true });
  return true;
}

async function assertNodeSettingsShowsAutoTarget(page) {
  const row = await openFixedNodeRow(page);
  await row.click();
  await page.getByRole("link", { name: "设置" }).first().click();
  await page.waitForURL("**/#/nodes/**/settings**", { timeout: 10000 });
  const panel = page.locator('[data-node-report-config="true"]');
  await panel.waitFor({ state: "visible", timeout: 10000 });
  const text = await panel.innerText();
  if (!text.includes("接入命令") || !text.includes("自动发现") || !text.includes("已启用")) {
    throw new Error(`fixed reporter settings does not show command and enabled auto target: ${text.slice(0, 800)}`);
  }
  const autoRow = panel.locator('[data-report-target-row="true"][data-target-source="auto"]').first();
  await autoRow.waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: path.join(outputDir, "06-ipq-fixed-node-report-config.png"), fullPage: true });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(25000);

try {
  await loginIPQ(page);
  log(`wait for real Debian report data on page: ${nodeName}`);
  const deadline = Date.now() + Number(process.env.IPQ_FIXED_REPORTER_VERIFY_TIMEOUT_MS || 420000);
  let ok = false;
  while (Date.now() < deadline) {
    ok = await tryOpenDetailWithData(page).catch(async () => {
      await page.waitForTimeout(1000);
      return false;
    });
    if (ok) {
      break;
    }
    await page.waitForTimeout(5000);
  }
  if (!ok) {
    throw new Error(`fixed reporter node did not show real data in the UI before timeout: ${nodeName}`);
  }
  await assertNodeSettingsShowsAutoTarget(page);
  writeFileSync(
    path.join(outputDir, "verify-summary.json"),
    JSON.stringify({ appBaseURL, nodeName, verifiedAt: new Date().toISOString() }, null, 2)
  );
  console.log("verify-fixed-debian-reporter-node: ok");
} finally {
  await browser.close().catch(() => {});
}
