import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || "http://localhost:8090").replace(/\/$/, "");
const outputDir = "/workspace/web/playwright-output";
const runID = Date.now();
const nodeName = `Playwright Step5 独立节点 ${runID}`;
const renamedNodeName = `${nodeName} Renamed`;
const secondNodeName = `Playwright Step5 冲突节点 ${runID}`;
const pendingKomariUUID = `playwright-step5-komari-${runID}`;
const pendingKomariName = `Playwright Step5 Komari 候选 ${runID}`;

mkdirSync(outputDir, { recursive: true });

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

async function loginIPQ(page) {
  await page.goto(`${appBaseURL}/#/login`, { waitUntil: "domcontentloaded" });
  if ((await page.getByRole("heading", { name: "节点列表" }).count()) === 0) {
    await page.getByRole("textbox", { name: "用户名" }).fill("admin");
    await page.getByLabel("密码").fill("admin");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/#/nodes", { timeout: 15000 });
  }
  await page.getByRole("heading", { name: "节点列表" }).waitFor({ state: "visible", timeout: 10000 });
}

async function cleanupStep5Nodes(page) {
  const payload = await apiOK(page, `${appBaseURL}/api/v1/nodes`, undefined, "list nodes for cleanup");
  for (const node of payload.items || []) {
    const name = String(node.name || "");
    const komariName = String(node.komari_node_name || "");
    if (name.startsWith("Playwright Step5 ") || komariName.startsWith("Playwright Step5 ")) {
      await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${node.node_uuid || node.komari_node_uuid}`, { method: "DELETE" }).catch(() => {});
    }
  }
}

async function createIndependentNodeFromUI(page, name) {
  await page.goto(`${appBaseURL}/#/nodes`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "节点列表" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "新建节点" }).click();
  await page.getByLabel("节点名称").fill(name);
  await page.getByRole("button", { name: /^创建$/ }).click();
  await page.locator('[data-node-settings-page="true"]').waitFor({ state: "visible", timeout: 10000 });
  const settings = page.locator('[data-node-report-config="true"]');
  await settings.waitFor({ state: "visible", timeout: 10000 });
  const url = new URL(page.url());
  const nodeUUID = url.hash.match(/#\/nodes\/([^/]+)\/settings/)?.[1] || "";
  if (!nodeUUID) {
    throw new Error(`created node settings UUID missing from URL: ${page.url()}`);
  }
  return { nodeUUID, settings };
}

async function addTargetAndVerifyInstallCommand(page, nodeUUID, settings) {
  await page.getByPlaceholder("例如 1.1.1.1 或 2606:4700:4700::1111").fill("198.51.100.251");
  await page.getByRole("button", { name: "添加 IP" }).click();
  await settings.locator('[data-report-target-row="true"][data-target-ip="198.51.100.251"]').waitFor({ state: "visible", timeout: 10000 });
  const text = await settings.innerText();
  if (!text.includes("接入命令") || !text.includes("198.51.100.251") || !text.includes("raw.githubusercontent.com")) {
    throw new Error(`independent node report config is incomplete: ${text.slice(0, 800)}`);
  }
  const detail = await apiOK(page, `${appBaseURL}/api/v1/nodes/${nodeUUID}`, undefined, "load independent detail");
  if (detail.komari_node_uuid || detail.binding_state !== "independent") {
    throw new Error(`new node should be independent: ${JSON.stringify(detail)}`);
  }
  if (!Array.isArray(detail.targets) || detail.targets.length === 0) {
    throw new Error("new independent node target was not persisted");
  }
}

async function createPendingKomariCandidate(page) {
  const params = new URLSearchParams({ uuid: pendingKomariUUID, name: pendingKomariName });
  const state = await apiOK(page, `${appBaseURL}/api/v1/embed/nodes/connect?${params.toString()}`, undefined, "create pending komari candidate");
  if (!state.node_uuid || state.komari_node_uuid !== pendingKomariUUID || state.connected) {
    throw new Error(`unexpected pending candidate state: ${JSON.stringify(state)}`);
  }
}

async function renameNodeFromSettings(page, nodeUUID) {
  await page.goto(`${appBaseURL}/#/nodes/${nodeUUID}/settings`, { waitUntil: "domcontentloaded" });
  await page.getByText("当前是独立节点", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("节点名称").fill(renamedNodeName);
  await page.getByRole("button", { name: "保存名称" }).click();
  await page.getByRole("heading", { name: `${renamedNodeName} 设置` }).waitFor({ state: "visible", timeout: 10000 });
  const detail = await apiOK(page, `${appBaseURL}/api/v1/nodes/${nodeUUID}`, undefined, "load renamed node detail");
  if (detail.name !== renamedNodeName) {
    throw new Error(`rename did not persist: ${JSON.stringify(detail)}`);
  }
}

async function assertDetailIsReadOnly(page, nodeUUID) {
  await page.goto(`${appBaseURL}/#/nodes/${nodeUUID}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-node-readonly-state="true"]').waitFor({ state: "visible", timeout: 10000 });
  const forbidden = ["保存名称", "选择 Komari 节点", "解除绑定", "添加 IP", "接入命令"];
  for (const label of forbidden) {
    if ((await page.getByText(label, { exact: true }).count()) > 0) {
      throw new Error(`detail page should be read-only but still shows ${label}`);
    }
  }
}

async function bindPendingCandidateFromSettings(page, nodeUUID) {
  await page.goto(`${appBaseURL}/#/nodes/${nodeUUID}/settings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "选择 Komari 节点" }).click();
  const candidates = page.locator('[data-komari-binding-candidates="true"]');
  await candidates.waitFor({ state: "visible", timeout: 10000 });
  const candidate = candidates.locator(`[data-komari-binding-candidate="true"][data-komari-binding-candidate-available="true"]`).filter({
    hasText: pendingKomariName
  });
  await candidate.waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: path.join(outputDir, "step5-binding-candidates.png"), fullPage: true });
  await candidate.getByRole("button", { name: "绑定" }).click();
  await page.getByText(`已绑定：${pendingKomariName}`, { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const detail = await apiOK(page, `${appBaseURL}/api/v1/nodes/${nodeUUID}`, undefined, "load bound node detail");
  if (detail.komari_node_uuid !== pendingKomariUUID || detail.binding_state !== "komari_bound") {
    throw new Error(`binding did not persist: ${JSON.stringify(detail)}`);
  }
}

async function assertOccupiedCandidateConflict(page) {
  const { nodeUUID: secondNodeUUID } = await createIndependentNodeFromUI(page, secondNodeName);
  await page.goto(`${appBaseURL}/#/nodes/${secondNodeUUID}/settings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "选择 Komari 节点" }).click();
  const occupied = page.locator('[data-komari-binding-candidate="true"]').filter({ hasText: pendingKomariName });
  await occupied.waitFor({ state: "visible", timeout: 10000 });
  const occupiedText = await occupied.innerText();
  if (!occupiedText.includes("已被") || !occupiedText.includes(renamedNodeName)) {
    throw new Error(`occupied candidate state is unclear: ${occupiedText}`);
  }
  const conflict = await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${secondNodeUUID}/komari-binding`, {
    method: "POST",
    body: JSON.stringify({ komari_node_uuid: pendingKomariUUID })
  });
  if (conflict.status !== 409) {
    throw new Error(`duplicate Komari binding should return 409, got ${conflict.status} ${conflict.text}`);
  }
}

async function unbindAndVerifyNodeRemains(page, nodeUUID) {
  await page.goto(`${appBaseURL}/#/nodes/${nodeUUID}/settings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "解除绑定" }).click();
  await page.getByText("当前是独立节点", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const detail = await apiOK(page, `${appBaseURL}/api/v1/nodes/${nodeUUID}`, undefined, "load unbound node detail");
  if (detail.name !== renamedNodeName || detail.komari_node_uuid || detail.binding_state !== "independent") {
    throw new Error(`node was not preserved after unbind: ${JSON.stringify(detail)}`);
  }
  await page.screenshot({ path: path.join(outputDir, "step5-independent-after-unbind.png"), fullPage: true });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(25000);

try {
  await loginIPQ(page);
  await cleanupStep5Nodes(page);
  const { nodeUUID, settings } = await createIndependentNodeFromUI(page, nodeName);
  await addTargetAndVerifyInstallCommand(page, nodeUUID, settings);
  await createPendingKomariCandidate(page);
  await renameNodeFromSettings(page, nodeUUID);
  await assertDetailIsReadOnly(page, nodeUUID);
  await bindPendingCandidateFromSettings(page, nodeUUID);
  await assertOccupiedCandidateConflict(page);
  await unbindAndVerifyNodeRemains(page, nodeUUID);
  writeFileSync(
    path.join(outputDir, "step5-independent-binding-summary.json"),
    JSON.stringify({ nodeUUID, pendingKomariUUID, verifiedAt: new Date().toISOString() }, null, 2)
  );
  console.log("verify-independent-node-binding: ok");
} finally {
  await browser.close().catch(() => {});
}
