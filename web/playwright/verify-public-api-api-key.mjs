import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const outputDir = path.resolve("playwright-output", "public-api-api-key");
const runID = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const keyName = `Playwright Public API ${runID}`;
const nodeName = `Playwright Public API Node ${runID}`;
const targetIP = "203.0.113.86";

mkdirSync(outputDir, { recursive: true });

function log(message) {
  console.log(`[public-api] ${message}`);
}

function parseJSON(result, label) {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${label} failed: ${result.status} ${result.text}`);
  }
  return result.text ? JSON.parse(result.text) : {};
}

async function requestJSON(context, path, options = {}) {
  const response = await context.request.fetch(`${appBaseURL}/api/v1${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const text = await response.text();
  return { status: response.status(), text };
}

async function apiOK(context, path, options, label) {
  return parseJSON(await requestJSON(context, path, options), label);
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

async function cleanup(context) {
  const keyResponse = await requestJSON(context, "/admin/api-keys").catch(() => null);
  const keyPayload = keyResponse?.status >= 200 && keyResponse.status < 300 && keyResponse.text
    ? JSON.parse(keyResponse.text)
    : {};
  for (const item of keyPayload.items || []) {
    if (String(item.name || "").startsWith("Playwright Public API ")) {
      await requestJSON(context, `/admin/api-keys/${item.id}`, { method: "DELETE" }).catch(() => {});
    }
  }

  const nodeResponse = await requestJSON(context, "/nodes").catch(() => null);
  const nodePayload = nodeResponse?.status >= 200 && nodeResponse.status < 300 && nodeResponse.text
    ? JSON.parse(nodeResponse.text)
    : {};
  for (const item of nodePayload.items || []) {
    if (String(item.name || "").startsWith("Playwright Public API Node ")) {
      await requestJSON(context, `/nodes/${item.node_uuid || item.komari_node_uuid}`, { method: "DELETE" }).catch(() => {});
    }
  }
}

async function seedNodeWithHistory(context) {
  log("seed node data through IPQ APIs");
  const detail = await apiOK(
    context,
    "/nodes",
    { method: "POST", data: { name: nodeName } },
    "create node"
  );
  await apiOK(
    context,
    `/nodes/${detail.node_uuid}/targets`,
    { method: "POST", data: { ip: targetIP } },
    "add target"
  );
  const current = await apiOK(context, `/nodes/${detail.node_uuid}`, undefined, "load node detail");
  const reporterToken = current.report_config?.reporter_token;
  const target = (current.targets || []).find((item) => item.ip === targetIP);
  if (!reporterToken || !target?.id) {
    throw new Error(`node report config incomplete: ${JSON.stringify(current.report_config || {})}`);
  }

  const reports = [
    {
      target_ip: targetIP,
      summary: "Org A",
      recorded_at: "2026-04-01T00:00:00Z",
      result: { Head: { IP: targetIP }, Info: { Organization: "Org A" } }
    },
    {
      target_ip: targetIP,
      summary: "Org B",
      recorded_at: "2026-04-02T00:00:00Z",
      result: { Head: { IP: targetIP }, Info: { Organization: "Org B" } }
    }
  ];
  for (const report of reports) {
    await apiOK(
      context,
      `/report/nodes/${detail.node_uuid}`,
      { method: "POST", headers: { Authorization: `Bearer ${reporterToken}` }, data: report },
      "report node data"
    );
  }

  return { nodeUUID: detail.node_uuid, targetID: target.id };
}

async function createKeyFromUI(page) {
  log("create API key from UI");
  await page.goto(`${appBaseURL}/#/settings/api-keys`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "开放 API" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("密钥名称").fill(keyName);
  await page.getByRole("button", { name: "创建访问密钥" }).click();
  const plaintext = page.locator('[data-api-key-plaintext="true"]');
  await plaintext.waitFor({ state: "visible", timeout: 10000 });
  const apiKey = (await plaintext.innerText()).trim();
  if (!apiKey.startsWith("ipq_")) {
    throw new Error(`unexpected API key format: ${apiKey}`);
  }
  await page.screenshot({ path: path.join(outputDir, "01-api-key-created-once.png"), fullPage: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "开放 API" }).waitFor({ state: "visible", timeout: 10000 });
  if ((await page.locator('[data-api-key-plaintext="true"]').count()) !== 0) {
    throw new Error("plaintext key should disappear after page reload");
  }
  return apiKey;
}

async function publicAPI(context, path, apiKey) {
  return requestJSON(context, `/public-api${path}`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  });
}

async function assertPublicAPIData(context, apiKey, nodeUUID, targetID) {
  log("verify public API read endpoints");
  const missing = await publicAPI(context, "/nodes", "");
  if (missing.status !== 401) {
    throw new Error(`missing API key should be rejected, got ${missing.status}`);
  }
  const invalid = await publicAPI(context, "/nodes", "bad-key");
  if (invalid.status !== 401) {
    throw new Error(`invalid API key should be rejected, got ${invalid.status}`);
  }

  const list = parseJSON(await publicAPI(context, `/nodes?page=1&page_size=1&q=${encodeURIComponent(nodeName)}`, apiKey), "public node list");
  if (list.page_size !== 1 || !Array.isArray(list.items) || !list.items.some((item) => item.node_uuid === nodeUUID)) {
    throw new Error(`public node list did not return seeded node: ${JSON.stringify(list)}`);
  }

  const detail = parseJSON(await publicAPI(context, `/nodes/${nodeUUID}`, apiKey), "public node detail");
  if (detail.name !== nodeName || !Array.isArray(detail.targets) || detail.targets.length === 0) {
    throw new Error(`public node detail incomplete: ${JSON.stringify(detail)}`);
  }
  const targets = parseJSON(await publicAPI(context, `/nodes/${nodeUUID}/targets`, apiKey), "public node targets");
  if (!targets.items?.some((item) => item.id === targetID && item.ip === targetIP)) {
    throw new Error(`public target list incomplete: ${JSON.stringify(targets)}`);
  }
  const current = parseJSON(await publicAPI(context, `/nodes/${nodeUUID}/targets/${targetID}/current`, apiKey), "public target current");
  if (current.ip !== targetIP || current.current_result?.Info?.Organization !== "Org B") {
    throw new Error(`public target current incomplete: ${JSON.stringify(current)}`);
  }
  const history = parseJSON(
    await publicAPI(context, `/nodes/${nodeUUID}/history?page=1&page_size=1&target_id=${targetID}&start_date=2026-04-01&end_date=2026-04-03`, apiKey),
    "public history"
  );
  if (history.page_size !== 1 || history.total < 2 || history.items?.[0]?.target_ip !== targetIP) {
    throw new Error(`public history pagination/date range failed: ${JSON.stringify(history)}`);
  }
  const events = parseJSON(
    await publicAPI(context, `/nodes/${nodeUUID}/history/events?page=1&page_size=1&field=info.organization&start_date=2026-04-01&end_date=2026-04-03`, apiKey),
    "public history events"
  );
  if (events.total < 1 || events.items?.[0]?.field_id !== "info.organization") {
    throw new Error(`public history field filter failed: ${JSON.stringify(events)}`);
  }
}

async function assertRateLimit(context, apiKey) {
  log("verify public API rate limit");
  let rateLimited = false;
  for (let index = 0; index < 80; index += 1) {
    const response = await publicAPI(context, "/nodes?page=1&page_size=1", apiKey);
    if (response.status === 429) {
      rateLimited = true;
      break;
    }
  }
  if (!rateLimited) {
    throw new Error("high-frequency public API requests did not trigger rate limit");
  }
}

async function assertLogs(context, apiKey) {
  log("verify API access logs");
  const prefix = apiKey.slice(0, 12);
  const logs = await apiOK(context, "/admin/api-access-logs?page_size=80", undefined, "list access logs");
  const okLog = (logs.items || []).find((item) => item.key_prefix === prefix && item.path.includes("/public-api/nodes") && item.status_code === 200);
  const rateLimitLog = (logs.items || []).find((item) => item.key_prefix === prefix && item.status_code === 429);
  const invalidLog = (logs.items || []).find((item) => item.path.includes("/public-api/nodes") && item.status_code === 401);
  if (!okLog || !rateLimitLog || !invalidLog) {
    throw new Error(`access logs missing expected records: ${JSON.stringify(logs.items || [])}`);
  }
}

async function toggleKeyFromUI(page, enabled) {
  await page.goto(`${appBaseURL}/#/settings/api-keys`, { waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: keyName }).first();
  await row.waitFor({ state: "visible", timeout: 10000 });
  await row.getByRole("button", { name: enabled ? "启用" : "停用" }).click();
  await page.waitForTimeout(500);
}

async function deleteKeyFromUI(page) {
  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  const row = page.locator("tbody tr").filter({ hasText: keyName }).first();
  await row.waitFor({ state: "visible", timeout: 10000 });
  await row.getByRole("button", { name: "删除" }).click();
  await page.waitForTimeout(500);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(30000);

try {
  await loginIPQ(page);
  await cleanup(context);
  const { nodeUUID, targetID } = await seedNodeWithHistory(context);
  const apiKey = await createKeyFromUI(page);
  await assertPublicAPIData(context, apiKey, nodeUUID, targetID);
  await assertRateLimit(context, apiKey);
  await assertLogs(context, apiKey);

  await toggleKeyFromUI(page, false);
  const disabled = await publicAPI(context, "/nodes", apiKey);
  if (disabled.status !== 403) {
    throw new Error(`disabled API key should be rejected, got ${disabled.status}`);
  }

  await toggleKeyFromUI(page, true);
  await deleteKeyFromUI(page);
  const deleted = await publicAPI(context, "/nodes", apiKey);
  if (deleted.status !== 401) {
    throw new Error(`deleted API key should be rejected, got ${deleted.status}`);
  }

  await page.goto(`${appBaseURL}/#/settings/api-keys`, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: path.join(outputDir, "02-api-logs.png"), fullPage: true });
  writeFileSync(
    path.join(outputDir, "verify-summary.json"),
    JSON.stringify({ appBaseURL, keyName, nodeName, nodeUUID, targetID, verifiedAt: new Date().toISOString() }, null, 2)
  );
  console.log("verify-public-api-api-key: ok");
} finally {
  await browser.close().catch(() => {});
}
