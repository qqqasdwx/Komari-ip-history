import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const stage = (process.env.FRONTEND_REFACTOR_STAGE || "01-baseline").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
const outputDir = path.resolve("playwright-output", "frontend-refactor", stage);
mkdirSync(outputDir, { recursive: true });

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
    throw new Error(`${label} failed: ${result.status} ${result.text}`);
  }
  return result.text ? JSON.parse(result.text) : {};
}

async function login(page) {
  await page.goto(`${appBaseURL}/#/login`);
  await page.getByRole("textbox", { name: "用户名" }).waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: path.join(outputDir, "login-desktop.png"), fullPage: true });
  await page.getByRole("textbox", { name: "用户名" }).fill("admin");
  await page.getByLabel("密码").fill("admin");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/#/nodes", { timeout: 15000 });
  await page.waitForLoadState("networkidle");
}

async function fetchNodes(page) {
  const payload = parseJSON(await jsonFetch(page, `${appBaseURL}/api/v1/nodes`), "list nodes");
  return Array.isArray(payload.items) ? payload.items : [];
}

function findNode(nodes, name) {
  const node = nodes.find((item) => item.name === name);
  if (!node) {
    throw new Error(`missing seeded node: ${name}`);
  }
  return node;
}

async function fetchNodeDetail(page, uuid) {
  return parseJSON(await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${uuid}`), `load node ${uuid}`);
}

async function waitForNodesPage(page) {
  await page.getByRole("heading", { name: "节点列表" }).waitFor({ state: "visible", timeout: 10000 });
  const rows = page.locator('[data-node-row="true"]');
  const empty = page.getByRole("heading", { name: "还没有节点" });
  for (let index = 0; index < 40; index += 1) {
    if ((await rows.count()) > 0 || (await empty.count()) > 0) {
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("nodes page did not show rows or empty state");
}

async function capture(page, route, fileName, wait) {
  await page.goto(`${appBaseURL}/#${route}`);
  await page.waitForLoadState("networkidle");
  await wait();
  await page.screenshot({ path: path.join(outputDir, fileName), fullPage: true });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();
const screenshots = [];

try {
  await login(page);
  screenshots.push("login-desktop.png");

  const nodes = await fetchNodes(page);
  const multiIPNode = findNode(nodes, "开发种子-多IP历史");
  const compareNode = findNode(nodes, "开发种子-多快照对比");

  await page.setViewportSize({ width: 1440, height: 1200 });
  await capture(page, "/nodes", "nodes-desktop.png", async () => {
    await waitForNodesPage(page);
  });
  screenshots.push("nodes-desktop.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "/nodes", "nodes-mobile.png", async () => {
    await waitForNodesPage(page);
  });
  screenshots.push("nodes-mobile.png");

  await page.setViewportSize({ width: 1440, height: 1200 });
  await capture(page, `/nodes/${multiIPNode.komari_node_uuid}`, "node-detail-multi-ip-desktop.png", async () => {
    await page.locator('[data-detail-report="true"]').waitFor({ state: "visible", timeout: 10000 });
  });
  screenshots.push("node-detail-multi-ip-desktop.png");

  const multiIPDetail = await fetchNodeDetail(page, multiIPNode.komari_node_uuid);
  const multiIPTargetID = multiIPDetail.current_target?.id;
  const historyQuery = multiIPTargetID ? `?target_id=${multiIPTargetID}` : "";
  await capture(page, `/nodes/${multiIPNode.komari_node_uuid}/history${historyQuery}`, "history-multi-ip-desktop.png", async () => {
    await page.getByText("字段变化", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    await page.locator('[data-history-change-row="true"]').first().waitFor({ state: "visible", timeout: 10000 });
  });
  screenshots.push("history-multi-ip-desktop.png");

  const compareDetail = await fetchNodeDetail(page, compareNode.komari_node_uuid);
  const compareTargetID = compareDetail.current_target?.id;
  const compareQuery = compareTargetID ? `?target_id=${compareTargetID}` : "";
  await capture(page, `/nodes/${compareNode.komari_node_uuid}/compare${compareQuery}`, "compare-multi-snapshot-desktop.png", async () => {
    await page.getByText("时间范围", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(".compare-timeline-panel").waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: /收藏快照|取消收藏/ }).first().waitFor({ state: "visible", timeout: 10000 });
  });
  screenshots.push("compare-multi-snapshot-desktop.png");

  await capture(page, "/settings/integration", "settings-integration-desktop.png", async () => {
    await page.getByRole("heading", { name: "接入配置" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByText("Header", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
  });
  screenshots.push("settings-integration-desktop.png");

  writeFileSync(
    path.join(outputDir, "summary.json"),
    JSON.stringify(
      {
        stage,
        appBaseURL,
        nodes: {
          multiIP: {
            name: multiIPNode.name,
            uuid: multiIPNode.komari_node_uuid
          },
          compare: {
            name: compareNode.name,
            uuid: compareNode.komari_node_uuid
          }
        },
        screenshots
      },
      null,
      2
    )
  );

  console.log(`frontend baseline screenshots captured: ${outputDir}`);
} finally {
  await browser.close().catch(() => {});
}
