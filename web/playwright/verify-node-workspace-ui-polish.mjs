import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const outputDir = path.resolve("playwright-output", "node-workspace-ui-polish");
mkdirSync(outputDir, { recursive: true });

function fail(message) {
  throw new Error(message);
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

function parseJSON(result, label) {
  if (result.status < 200 || result.status >= 300) {
    fail(`${label} failed: ${result.status} ${result.text}`);
  }
  return result.text ? JSON.parse(result.text) : {};
}

async function login(page) {
  await page.goto(`${appBaseURL}/#/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "用户名" }).fill("admin");
  await page.getByLabel("密码").fill("admin");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/#/nodes", { timeout: 15000 });
  await page.waitForLoadState("networkidle");
}

async function assertNoVisibleUUID(page, label) {
  const text = await page.locator("body").innerText();
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(text)) {
    fail(`${label} exposes a UUID in visible text`);
  }
  if (/\bUUID\b|IPQ ID/i.test(text)) {
    fail(`${label} exposes internal identifier wording`);
  }
}

async function assertNoHeaderBackButton(page, label) {
  const pageHeaderBackLinks = await page.locator("main section > header").locator("a", { hasText: "返回" }).count();
  if (pageHeaderBackLinks !== 0) {
    fail(`${label} still has a duplicate rounded back button`);
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();

try {
  await login(page);

  const nodesPayload = parseJSON(await jsonFetch(page, `${appBaseURL}/api/v1/nodes`), "list nodes");
  const nodes = Array.isArray(nodesPayload.items) ? nodesPayload.items : [];
  const historyNode = nodes.find((item) => item.name === "开发种子-多IP历史") || nodes.find((item) => item.has_data);
  if (!historyNode) {
    fail("missing a seeded node with history data");
  }
  const routeID = historyNode.node_uuid || historyNode.komari_node_uuid;
  const komariBoundNode = nodes.find((item) => item.binding_state === "komari_bound" && item.komari_node_name);

  await page.goto(`${appBaseURL}/#/nodes`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "节点列表" }).waitFor({ state: "visible", timeout: 10000 });
  await page.locator('[data-node-row="true"]').first().waitFor({ state: "visible", timeout: 10000 });

  if ((await page.getByText("操作", { exact: true }).count()) > 0) {
    fail("nodes page still shows the operation column");
  }
  if ((await page.locator('[data-node-report-settings="true"]').count()) > 0) {
    fail("nodes page still exposes a row settings action");
  }
  await assertNoVisibleUUID(page, "nodes page");

  if (komariBoundNode) {
    const boundRow = page.locator(`[data-node-uuid="${komariBoundNode.node_uuid || komariBoundNode.komari_node_uuid}"]`);
    const sourcePill = boundRow.locator('[data-node-binding-label="true"]');
    const sourceText = ((await sourcePill.locator("span").first().innerText()) || "").trim();
    if (sourceText !== "已绑定 Komari") {
      fail(`bound node source label should be concise, got: ${sourceText}`);
    }
    if (await sourcePill.getAttribute("title")) {
      fail("bound node source should not use the delayed native title tooltip");
    }
    await sourcePill.hover();
    const tooltip = sourcePill.locator('[data-node-binding-tooltip="true"]');
    await tooltip.waitFor({ state: "visible", timeout: 1000 });
    const tooltipText = ((await tooltip.innerText()) || "").trim();
    if (tooltipText !== komariBoundNode.komari_node_name) {
      fail("bound node source tooltip should contain the full Komari node name");
    }
    await page.mouse.move(12, 12);
  }
  await page.screenshot({ path: path.join(outputDir, "nodes-page.png"), fullPage: true });

  await page.goto(`${appBaseURL}/#/nodes/${routeID}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: historyNode.name }).waitFor({ state: "visible", timeout: 10000 });
  await assertNoHeaderBackButton(page, "node detail page");
  await assertNoVisibleUUID(page, "node detail page");
  await page.screenshot({ path: path.join(outputDir, "detail-page.png"), fullPage: true });
  await page.getByRole("link", { name: /设置/ }).click();
  await page.locator('[data-node-settings-page="true"]').waitFor({ state: "visible", timeout: 10000 });
  await assertNoVisibleUUID(page, "node settings page");

  const detail = parseJSON(await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${routeID}`), "load node detail");
  const targetID = detail.current_target?.id || detail.targets?.[0]?.id;
  if (!targetID) {
    fail("selected node has no target for history verification");
  }

  await page.goto(`${appBaseURL}/#/nodes/${routeID}/history?target_id=${targetID}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-history-change-row="true"]').first().waitFor({ state: "visible", timeout: 10000 });
  await assertNoHeaderBackButton(page, "history page");
  await assertNoVisibleUUID(page, "history page");
  const historyTopLevelColumnCount = await page.locator('[data-history-change-row="true"]').first().evaluate((row) =>
    window.getComputedStyle(row).gridTemplateColumns.split(" ").filter(Boolean).length
  );
  if (historyTopLevelColumnCount < 3) {
    fail(`history row should split time, IP, and values into separate columns, got ${historyTopLevelColumnCount}`);
  }
  const historyValueGridColumnCount = await page.locator('[data-history-change-row="true"]').first().evaluate((row) => {
    const valueGrid = row.children.item(2);
    if (!valueGrid) return 0;
    return window.getComputedStyle(valueGrid).gridTemplateColumns.split(" ").filter(Boolean).length;
  });
  if (historyValueGridColumnCount < 4) {
    fail(`history row should use a wide four-column value layout, got ${historyValueGridColumnCount}`);
  }
  await page.screenshot({ path: path.join(outputDir, "history-page.png"), fullPage: true });

  await page.goto(`${appBaseURL}/#/nodes/${routeID}/snapshots?target_id=${targetID}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: `${historyNode.name} 快照` }).waitFor({ state: "visible", timeout: 10000 });
  await assertNoHeaderBackButton(page, "snapshot page");
  await assertNoVisibleUUID(page, "snapshot page");

  writeFileSync(
    path.join(outputDir, "summary.json"),
    JSON.stringify({ appBaseURL, routeID, verifiedAt: new Date().toISOString() }, null, 2)
  );
} finally {
  await context.close();
  await browser.close();
}
