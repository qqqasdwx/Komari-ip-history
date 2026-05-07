import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const appBaseURL = (process.env.IPQ_RELEASE_SIM_BASE_URL || process.env.IPQ_PUBLIC_BASE_URL || "http://127.0.0.1:8092").replace(/\/$/, "");
const expectedVersion = process.env.IPQ_RELEASE_SIM_VERSION || "v0.0.0-acceptance";
const outputDir = path.resolve("playwright-output", "release-installer-source");
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

async function login(page) {
  await page.goto(`${appBaseURL}/#/login`, { waitUntil: "domcontentloaded" });
  if ((await page.getByRole("heading", { name: "节点列表" }).count()) === 0) {
    await page.getByRole("textbox", { name: "用户名" }).fill("admin");
    await page.getByLabel("密码").fill("admin");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/#/nodes", { timeout: 15000 });
  }
  await page.getByRole("heading", { name: "节点列表" }).waitFor({ state: "visible", timeout: 10000 });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);

try {
  await login(page);

  const runtime = parseJSON(await jsonFetch(page, `${appBaseURL}/api/v1/admin/runtime`), "load runtime");
  if (runtime.version !== expectedVersion) {
    throw new Error(`release simulation runtime version mismatch: ${runtime.version} !== ${expectedVersion}`);
  }
  const expectedURL = `https://raw.githubusercontent.com/qqqasdwx/Komari-ip-history/${expectedVersion}/deploy/install.sh`;
  if (runtime.installer_script?.url !== expectedURL) {
    throw new Error(`runtime installer URL mismatch: ${runtime.installer_script?.url} !== ${expectedURL}`);
  }
  if (runtime.installer_script.url.includes("/master/")) {
    throw new Error(`release simulation must not use master installer URL: ${runtime.installer_script.url}`);
  }

  const nodeName = `Release installer ${Date.now()}`;
  const created = parseJSON(
    await jsonFetch(page, `${appBaseURL}/api/v1/nodes`, {
      method: "POST",
      body: JSON.stringify({ name: nodeName })
    }),
    "create release simulation node"
  );
  const nodeUUID = created.node_uuid;
  if (!nodeUUID) {
    throw new Error(`created node did not include node_uuid: ${JSON.stringify(created)}`);
  }

  await page.goto(`${appBaseURL}/#/nodes/${nodeUUID}/settings`, { waitUntil: "networkidle" });
  await page.getByText("接入命令", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const command = (await page.locator("pre.report-config-command").innerText()).trim();
  if (!command.includes(expectedURL) || command.includes("/master/deploy/install.sh")) {
    throw new Error(`page command did not use release installer URL: ${command}`);
  }
  await page.getByText(`脚本来源：当前版本 ${expectedVersion}`, { exact: true }).waitFor({ state: "visible", timeout: 10000 });

  const detail = parseJSON(await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${nodeUUID}`), "load release simulation node");
  if (detail.report_config?.installer_script?.url !== expectedURL) {
    throw new Error(`node detail installer source mismatch: ${detail.report_config?.installer_script?.url} !== ${expectedURL}`);
  }

  const installConfig = parseJSON(
    await jsonFetch(page, `${appBaseURL}/api/v1/report/install-config/${detail.report_config.install_token}`),
    "load install config by token"
  );
  if (installConfig.installer_script?.url !== expectedURL) {
    throw new Error(`install config installer source mismatch: ${installConfig.installer_script?.url} !== ${expectedURL}`);
  }

  await page.screenshot({ path: path.join(outputDir, "release-installer-command.png"), fullPage: true });
  console.log(`release installer source verified: ${expectedURL}`);
} finally {
  await browser.close();
}
