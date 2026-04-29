import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const appBaseURL = (
  process.env.IPQ_USER_BASE_URL ||
  process.env.IPQ_INTEGRATION_PUBLIC_BASE_URL ||
  process.env.IPQ_PUBLIC_BASE_URL ||
  "http://127.0.0.1:8090"
).replace(/\/$/, "");
const integrationPublicBaseURL = (
  process.env.IPQ_INTEGRATION_PUBLIC_BASE_URL ||
  appBaseURL
).replace(/\/$/, "");
const defaultKomariBaseURL = (
  process.env.KOMARI_DEFAULT_BASE_URL ||
  process.env.KOMARI_BASE_URL ||
  "http://127.0.0.1:8080"
).replace(/\/$/, "");
const purcarteKomariBaseURL = (
  process.env.KOMARI_PURCARTE_BASE_URL ||
  "http://127.0.0.1:8081"
).replace(/\/$/, "");
const outputDir = path.resolve("playwright-output", "real-user-onboarding");
const sampleResult = JSON.parse(
  readFileSync(path.resolve("..", "internal", "sampledata", "ipquality_template.json"), "utf8")
);
const runID = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const nodeNamePrefix = `Playwright Real User ${runID}`;

mkdirSync(outputDir, { recursive: true });

function log(message) {
  console.log(`[real-user] ${message}`);
}

function scenarioName(input) {
  return input.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
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

async function loginIPQ(page) {
  log(`login IPQ at ${appBaseURL}`);
  await page.goto(`${appBaseURL}/#/login`);
  await page.waitForLoadState("domcontentloaded");
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
  await page.goto(`${baseURL}/admin`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  if ((await page.locator('input[placeholder="admin"]').count()) > 0) {
    await page.locator('input[placeholder="admin"]').fill("admin");
    await page.locator('input[type="password"]').fill("admin");
    await page.getByRole("button", { name: "Login" }).last().click();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }
  await page.getByText("Node list", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(250);
}

async function listKomariNodes(page, baseURL) {
  const result = await jsonFetch(page, `${baseURL}/api/admin/client/list`);
  const payload = parseJSON(result, "list Komari nodes");
  return Array.isArray(payload) ? payload : [];
}

async function listIPQNodes(page) {
  const payload = await apiOK(page, `${appBaseURL}/api/v1/nodes`, undefined, "list IPQ nodes");
  return Array.isArray(payload.items) ? payload.items : [];
}

async function cleanupNodes(appPage, scenarioPages) {
  log("cleanup stale real-user nodes");
  await appPage.goto(`${appBaseURL}/#/nodes`).catch(() => {});
  const ipqNodes = await listIPQNodes(appPage).catch(() => []);
  for (const node of ipqNodes.filter((item) => String(item.name || "").startsWith("Playwright Real User "))) {
    await jsonFetch(appPage, `${appBaseURL}/api/v1/nodes/${node.komari_node_uuid}`, { method: "DELETE" }).catch(() => {});
  }

  for (const { page, baseURL } of scenarioPages) {
    await loginKomari(page, baseURL).catch(() => {});
    const nodes = await listKomariNodes(page, baseURL).catch(() => []);
    for (const node of nodes.filter((item) => String(item.name || "").startsWith("Playwright Real User "))) {
      await jsonFetch(page, `${baseURL}/api/admin/client/${node.uuid}/remove`, { method: "POST", body: "{}" }).catch(() => {});
    }
  }
}

async function createKomariNodeFromUI(page, baseURL, nodeName, scenarioDir, screenshotName = "01-komari-node-created.png") {
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
  await page.screenshot({ path: path.join(scenarioDir, screenshotName), fullPage: true });
  return node;
}

async function configureIntegrationFromUI(appPage) {
  log("configure IPQ integration from UI");
  await appPage.goto(`${appBaseURL}/#/settings/integration`);
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
  if (!loaderCode.includes(integrationPublicBaseURL)) {
    throw new Error(`loader header code does not use ${integrationPublicBaseURL}`);
  }
  return loaderCode;
}

async function setKomariHeaderFromUI(page, baseURL, loaderCode, scenarioDir) {
  log(`paste Komari Custom Header from UI: ${baseURL}`);
  mkdirSync(scenarioDir, { recursive: true });
  await loginKomari(page, baseURL);
  await page.goto(`${baseURL}/admin/settings/site`, { waitUntil: "domcontentloaded" });
  await page.getByText("Custom Header", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.locator("textarea").nth(1).fill(loaderCode);
  await page.screenshot({ path: path.join(scenarioDir, "02-komari-custom-header-filled.png"), fullPage: true });
  await page.locator("button").filter({ hasText: "Save" }).nth(3).click();
  await page.waitForTimeout(1000);

  const settings = await apiOK(page, `${baseURL}/api/admin/settings/`, undefined, "load Komari settings after header save");
  if ((settings.data?.custom_head || "").trim() !== loaderCode.trim()) {
    throw new Error("Komari Custom Header was not saved from the UI");
  }
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
  const purcarteButton = page.locator('[data-ipq-purcarte-button="true"]').first();
  await purcarteButton.waitFor({ state: "visible", timeout: 15000 });
  await purcarteButton.click();
}

async function waitForOpenIframeSrc(page, predicate, label) {
  const deadline = Date.now() + 45000;
  let lastSrc = "";

  while (Date.now() < deadline) {
    const iframe = page.locator('#ipq-loader-overlay[data-open="true"] iframe').first();
    if ((await iframe.count()) > 0) {
      const src = await iframe.evaluate((frame) => frame.getAttribute("src") || frame.src || "").catch(() => "");
      lastSrc = src || lastSrc;
      if (src && predicate(src)) {
        return src;
      }
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`${label} iframe did not reach expected state: ${lastSrc || "<empty>"}`);
}

async function loginInOpenIframeIfNeeded(page) {
  const iframe = page.locator('#ipq-loader-overlay[data-open="true"] iframe').first();
  const src = await iframe.evaluate((frame) => frame.getAttribute("src") || frame.src || "");
  if (!src.includes("#/login")) {
    return;
  }
  const frame = page.frameLocator('#ipq-loader-overlay[data-open="true"] iframe').first();
  await frame.getByRole("textbox", { name: "用户名" }).fill("admin");
  await frame.getByLabel("密码").fill("admin");
  await frame.getByRole("button", { name: "登录" }).click();
}

async function waitForConnectedEmptyDetail(page, label) {
  const frame = page.frameLocator('#ipq-loader-overlay[data-open="true"] iframe').first();
  const deadline = Date.now() + 30000;
  let lastText = "";

  while (Date.now() < deadline) {
    lastText = await frame.locator("body").innerText().catch(() => lastText);
    if (
      lastText.includes("当前节点还没有目标 IP") ||
      lastText.includes("当前还没有任何 IP 结果") ||
      lastText.includes("去接入")
    ) {
      return;
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`${label} did not show connected empty detail. Last iframe text: ${lastText.slice(0, 500)}`);
}

async function openIframeText(page) {
  const frame = page.frameLocator('#ipq-loader-overlay[data-open="true"] iframe').first();
  return frame.locator("body").innerText().catch(() => "");
}

async function completeStandaloneLoginIfNeeded(page, baseURL, node) {
  let text = "";
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    text = await openIframeText(page);
    if (text.includes("需要登录")) {
      break;
    }
    if (
      text.includes("当前节点还没有目标 IP") ||
      text.includes("当前还没有任何 IP 结果") ||
      text.includes("去接入")
    ) {
      return false;
    }
    await page.waitForTimeout(250);
  }

  if (!text.includes("需要登录")) {
    return false;
  }

  const navigatedToLogin = await page.waitForURL("**/#/login**", { timeout: 3000 }).then(
    () => true,
    () => false
  );
  if (!navigatedToLogin) {
    const params = new URLSearchParams({
      uuid: node.uuid,
      name: node.name,
      return_to: page.url(),
      resume: "popup"
    });
    await page.goto(`${appBaseURL}/#/connect?${params.toString()}`, { waitUntil: "domcontentloaded" });
  }

  if (page.url().includes("#/login")) {
    await page.getByRole("textbox", { name: "用户名" }).fill("admin");
    await page.getByLabel("密码").fill("admin");
    await page.getByRole("button", { name: "登录" }).click();
  }
  await page.waitForURL(`${baseURL}/instance/**`, { timeout: 25000 });
  await page.waitForLoadState("domcontentloaded");
  await waitForOpenIframeSrc(
    page,
    (src) => src.includes(`/nodes/${node.uuid}`) && !src.includes("#/login"),
    `${node.uuid} returned connected detail`
  );
  return true;
}

async function assertPurCarteConnectedPopupTheme(page, connectedButton, scenarioDir) {
  await connectedButton.click();
  const iframe = page.locator('#ipq-loader-overlay[data-open="true"] iframe').first();
  await iframe.waitFor({ state: "visible", timeout: 15000 });
  const iframeSrc = await iframe.evaluate((frame) => frame.getAttribute("src") || frame.src || "");
  if (!iframeSrc.includes("embed=1")) {
    throw new Error(`PurCarte connected popup should open the embedded detail URL: ${iframeSrc}`);
  }
  if (!iframeSrc.includes("komari_theme=PurCarte")) {
    throw new Error(`PurCarte connected popup should pass the Komari theme to IPQ: ${iframeSrc}`);
  }

  const frame = page.frameLocator('#ipq-loader-overlay[data-open="true"] iframe').first();
  await frame.locator('[data-detail-report="true"]').waitFor({ state: "visible", timeout: 20000 });
  const styles = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        backdropFilter: style.backdropFilter
      };
    };
    return {
      overlay: read("#ipq-loader-overlay"),
      dialog: read(".ipq-loader-dialog"),
      frame: read(".ipq-loader-frame")
    };
  });
  if (styles.overlay?.backgroundColor === "rgba(0, 0, 0, 0)") {
    throw new Error("PurCarte connected popup should tint the overlay so white Komari cards do not show through as a pure-white background");
  }
  if (styles.dialog?.backgroundColor === "rgb(255, 255, 255)" && styles.dialog?.backgroundImage === "none") {
    throw new Error("PurCarte connected popup dialog should not use a pure-white background");
  }
  if (styles.frame?.backgroundColor === "rgb(255, 255, 255)") {
    throw new Error("PurCarte connected popup iframe should not use a pure-white background");
  }

  const innerStyles = await frame.locator("body").evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage
      };
    };
    return {
      shell: read(".embed-shell"),
      header: read(".embed-detail-page > header"),
      card: read(".embed-detail-card"),
      report: read(".report-shell")
    };
  });
  if (innerStyles.shell?.backgroundColor !== "rgba(0, 0, 0, 0)") {
    throw new Error(`PurCarte embedded shell should remain transparent, got ${innerStyles.shell?.backgroundColor}`);
  }
  if (innerStyles.header?.backgroundColor === "rgb(255, 255, 255)" && innerStyles.header?.backgroundImage === "none") {
    throw new Error("PurCarte embedded detail header should not use a pure-white background");
  }
  if (innerStyles.card?.backgroundColor === "rgb(255, 255, 255)") {
    throw new Error("PurCarte embedded detail card should not use a pure-white background");
  }
  if (innerStyles.report?.backgroundColor === "rgb(255, 255, 255)") {
    throw new Error("PurCarte report body should not use a pure-white background");
  }

  await page.screenshot({ path: path.join(scenarioDir, "10-komari-connected-popup.png"), fullPage: true });
  await page.locator(".ipq-loader-close").click();
  await page.locator("#ipq-loader-overlay").waitFor({ state: "attached", timeout: 5000 });
}

async function connectNodeFromKomari(page, baseURL, node, scenarioDir) {
  log(`connect node from Komari injected button: ${node.name}`);
  await page.goto(`${baseURL}/instance/${node.uuid}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText(node.name, { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  await clickIpqAction(page);
  const connectButton = page.getByRole("button", { name: "去接入" }).first();
  await connectButton.waitFor({ state: "visible", timeout: 15000 });
  const connectPromptStyle = await page.evaluate(() => {
    const overlay = document.querySelector("#ipq-loader-overlay");
    const panel = document.querySelector(".ipq-loader-connect-panel");
    const card = document.querySelector(".ipq-loader-connect-card");
    const read = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backdropFilter: style.backdropFilter
      };
    };
    return {
      isPurCarte: overlay?.classList.contains("ipq-loader-theme-purcarte") || false,
      panel: read(panel),
      card: read(card)
    };
  });
  if (connectPromptStyle.isPurCarte) {
    if (connectPromptStyle.panel?.backgroundColor !== "rgba(0, 0, 0, 0)") {
      throw new Error(`PurCarte connect panel should be transparent, got ${connectPromptStyle.panel?.backgroundColor}`);
    }
    if (connectPromptStyle.card?.backgroundColor === "rgb(255, 255, 255)") {
      throw new Error("PurCarte connect card should not use the default pure-white background");
    }
    if (!connectPromptStyle.card?.backdropFilter || connectPromptStyle.card.backdropFilter === "none") {
      throw new Error("PurCarte connect card should use the glass backdrop filter");
    }
  }
  await page.screenshot({ path: path.join(scenarioDir, "03-komari-connect-prompt.png"), fullPage: true });
  const [standalonePage] = await Promise.all([
    page.context().waitForEvent("page"),
    connectButton.click()
  ]);
  await standalonePage.waitForLoadState("domcontentloaded");
  if (standalonePage.url().includes("#/login")) {
    await standalonePage.getByRole("textbox", { name: "用户名" }).fill("admin");
    await standalonePage.getByLabel("密码").fill("admin");
    await standalonePage.getByRole("button", { name: "登录" }).click();
  }
  await standalonePage.locator('[data-node-report-config="true"]').waitFor({ state: "visible", timeout: 15000 });
  await standalonePage.locator('[data-komari-return-hint="true"]').waitFor({ state: "visible", timeout: 10000 });
  await standalonePage.screenshot({ path: path.join(scenarioDir, "03-ipq-standalone-report-config.png"), fullPage: true });
  const standaloneURL = standalonePage.url();
  await standalonePage.close().catch(() => {});
  return standaloneURL;
}

async function waitForButtonEntryState(page, selector, uuid, expectedState, label) {
  const locator = page.locator(`${selector}[data-ipq-uuid="${uuid}"]`).first();
  await locator.waitFor({ state: "visible", timeout: 15000 });
  const deadline = Date.now() + 20000;
  let lastState = "";
  while (Date.now() < deadline) {
    lastState = (await locator.getAttribute("data-ipq-entry-state").catch(() => "")) || "";
    if (lastState === expectedState) {
      return locator;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`${label} expected ${expectedState} IPQ button state, got ${lastState || "<empty>"}`);
}

async function verifyHomeEntryButtons(page, baseURL, theme, connectedNode, pendingNode, scenarioDir) {
  log(`verify ${theme} homepage IPQ entry buttons`);
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText(connectedNode.name, { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByText(pendingNode.name, { exact: false }).waitFor({ state: "visible", timeout: 15000 });

  const selector = theme === "purcarte"
    ? '[data-ipq-purcarte-button="true"]'
    : '[data-ipq-default-home-button="true"]';
  const connectedButton = await waitForButtonEntryState(
    page,
    selector,
    connectedNode.uuid,
    "connected",
    `${theme} connected homepage`
  );
  const pendingButton = await waitForButtonEntryState(
    page,
    selector,
    pendingNode.uuid,
    "pending",
    `${theme} pending homepage`
  );

  const connectedTitle = (await connectedButton.getAttribute("title")) || "";
  const pendingTitle = (await pendingButton.getAttribute("title")) || "";
  if (!connectedTitle.includes("查看 IP 质量")) {
    throw new Error(`${theme} connected homepage button title mismatch: ${connectedTitle}`);
  }
  if (!pendingTitle.includes("开启 IP 质量检测")) {
    throw new Error(`${theme} pending homepage button title mismatch: ${pendingTitle}`);
  }

  const colors = await Promise.all([
    connectedButton.evaluate((element) => getComputedStyle(element).color),
    pendingButton.evaluate((element) => getComputedStyle(element).color)
  ]);
  if (colors[0] === colors[1]) {
    throw new Error(`${theme} homepage connected and pending icons should use different colors`);
  }

  if (theme !== "purcarte") {
    const placement = await connectedButton.evaluate((button) => {
      const slot = button.parentElement;
      const actionGroup = slot?.parentElement;
      const card = button.closest(".node-card");
      const anchor = card?.querySelector('a[href*="/instance/"]');
      const badge = actionGroup?.querySelector(".rt-Badge");
      const rect = (element) => {
        const box = element?.getBoundingClientRect();
        return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
      };
      return {
        buttonClass: String(button.className || ""),
        actionGroupClass: String(actionGroup?.className || ""),
        buttonRect: rect(button),
        anchorRect: rect(anchor),
        badgeRect: rect(badge)
      };
    });

    if (!placement.buttonClass.includes("rt-IconButton")) {
      throw new Error(`default homepage button should reuse Komari IconButton style: ${placement.buttonClass}`);
    }
    if (!placement.actionGroupClass.includes("rt-r-gap-2")) {
      throw new Error(`default homepage button should be mounted in the right action group: ${placement.actionGroupClass}`);
    }
    if (placement.anchorRect && placement.buttonRect && placement.buttonRect.x <= placement.anchorRect.x) {
      throw new Error("default homepage button was mounted before the node name");
    }
    if (placement.badgeRect && placement.buttonRect && placement.buttonRect.x >= placement.badgeRect.x) {
      throw new Error("default homepage button should stay before the status badge in the right action group");
    }
  }

  await page.screenshot({ path: path.join(scenarioDir, "09-komari-home-entry-buttons.png"), fullPage: true });
  if (theme === "purcarte") {
    await assertPurCarteConnectedPopupTheme(page, connectedButton, scenarioDir);
  }
}

async function openReportConfigFromUI(appPage, uuid, nodeName, scenarioDir) {
  log(`open IPQ report config from UI: ${nodeName}`);
  await appPage.goto(`${appBaseURL}/#/nodes`);
  await appPage.getByPlaceholder("搜索节点名称").fill(nodeName);
  await appPage.getByPlaceholder("搜索节点名称").press("Enter");
  const row = appPage.locator(`[data-node-row="true"][data-node-uuid="${uuid}"]`);
  await row.waitFor({ state: "visible", timeout: 15000 });
  await row.getByRole("button", { name: "上报设置" }).click();
  await appPage.locator('[data-node-report-config="true"]').waitFor({ state: "visible", timeout: 10000 });
  await appPage.screenshot({ path: path.join(scenarioDir, "04-ipq-report-config-empty.png"), fullPage: true });
}

async function configureTargetsFromUI(appPage, scenarioDir, targets) {
  log(`configure targets from UI: ${targets.join(", ")}`);
  const targetInput = appPage.getByPlaceholder("例如 1.1.1.1 或 2606:4700:4700::1111");
  for (const ip of targets) {
    await targetInput.fill(ip);
    await appPage.getByRole("button", { name: "添加 IP" }).click();
    await appPage.locator("button").filter({ hasText: ip }).first().waitFor({ state: "visible", timeout: 10000 });
  }
  await appPage.getByLabel("Cron").fill("*/30 * * * *");
  await appPage.getByText("接入命令", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await appPage.screenshot({ path: path.join(scenarioDir, "05-ipq-report-config-multi-ip.png"), fullPage: true });
}

function buildResult(ip, variant) {
  const result = structuredClone(sampleResult);
  result.Head = { ...(result.Head || {}), IP: ip, Version: "playwright-real-user", Time: `real-user-${variant}` };
  result.Info = { ...(result.Info || {}), ASN: String(64500 + variant), Organization: `Playwright Org ${variant}` };
  result.Score = {
    ...(result.Score || {}),
    Scamalytics: 10 + variant * 5,
    SCAMALYTICS: 10 + variant * 5,
    AbuseIPDB: variant,
    IPQS: 20 + variant * 7
  };
  result.Factor = { ...(result.Factor || {}), IsVPN: variant % 2 === 0 ? "No" : "Yes", IsProxy: "No" };
  return result;
}

async function seedTargetReports(appPage, uuid, targets) {
  log(`seed report payloads for ${uuid}`);
  const detail = await apiOK(appPage, `${appBaseURL}/api/v1/nodes/${uuid}`, undefined, "load node detail");
  const reporterToken = detail.report_config?.reporter_token;
  if (!reporterToken) {
    throw new Error("reporter token missing after target configuration");
  }

  for (const [targetIndex, target] of targets.entries()) {
    for (let index = 0; index < 3; index += 1) {
      const variant = targetIndex * 10 + index + 1;
      await apiOK(
        appPage,
        `${appBaseURL}/api/v1/report/nodes/${uuid}`,
        {
          method: "POST",
          headers: { "X-IPQ-Reporter-Token": reporterToken },
          body: JSON.stringify({
            target_ip: target,
            summary: `Playwright real-user report ${variant}`,
            recorded_at: `2026-04-03T0${index + 1}:00:00Z`,
            result: buildResult(target, variant)
          })
        },
        `seed report ${target}`
      );
    }
  }
}

async function verifyConfiguredNode(appPage, uuid, targets, scenarioDir) {
  log(`verify detail/history/compare pages for ${uuid}`);
  const detail = await apiOK(appPage, `${appBaseURL}/api/v1/nodes/${uuid}`, undefined, "load configured node");
  const firstTarget = detail.targets?.find((target) => target.ip === targets[0]);
  const secondTarget = detail.targets?.find((target) => target.ip === targets[1]);
  if (!firstTarget || !secondTarget) {
    throw new Error("configured targets missing from node detail");
  }

  await appPage.goto(`${appBaseURL}/#/nodes/${uuid}?target_id=${firstTarget.id}`);
  await appPage.locator('[data-detail-report="true"]').waitFor({ state: "visible", timeout: 15000 });
  await appPage.getByRole("button", { name: targets[1] }).click();
  await appPage.locator('[data-detail-report="true"]').waitFor({ state: "visible", timeout: 15000 });
  await appPage.screenshot({ path: path.join(scenarioDir, "06-ipq-detail-second-target.png"), fullPage: true });

  await appPage.goto(`${appBaseURL}/#/nodes/${uuid}/history?target_id=${firstTarget.id}`);
  await appPage.getByText("字段变化", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await appPage.locator('[data-history-change-row="true"]').first().waitFor({ state: "visible", timeout: 15000 });
  await appPage.screenshot({ path: path.join(scenarioDir, "07-ipq-history.png"), fullPage: true });

  await appPage.goto(`${appBaseURL}/#/nodes/${uuid}/compare?target_id=${firstTarget.id}`);
  await appPage.getByText("时间范围", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await appPage.locator(".compare-timeline-panel").waitFor({ state: "visible", timeout: 15000 });
  await appPage.getByRole("button", { name: /收藏快照|取消收藏/ }).first().waitFor({
    state: "visible",
    timeout: 10000
  });
  await appPage.screenshot({ path: path.join(scenarioDir, "08-ipq-compare.png"), fullPage: true });
}

async function runScenario({ appPage, komariPage, baseURL, theme, targets, fullVerification }) {
  log(`start scenario: ${theme}`);
  const scenarioDir = path.join(outputDir, scenarioName(theme));
  mkdirSync(scenarioDir, { recursive: true });

  const themeLabel = theme === "purcarte" ? "PurCarte" : "Default";
  const nodeName = `${nodeNamePrefix} ${themeLabel} 已接入节点`;
  const pendingNodeName = `${nodeNamePrefix} ${themeLabel} 未接入节点`;
  const pendingNode = await createKomariNodeFromUI(
    komariPage,
    baseURL,
    pendingNodeName,
    scenarioDir,
    "01-komari-pending-node-created.png"
  );
  const node = await createKomariNodeFromUI(
    komariPage,
    baseURL,
    nodeName,
    scenarioDir,
    "01-komari-connected-node-created.png"
  );
  const standaloneURL = await connectNodeFromKomari(komariPage, baseURL, node, scenarioDir);

  await openReportConfigFromUI(appPage, node.uuid, nodeName, scenarioDir);
  await configureTargetsFromUI(appPage, scenarioDir, targets);
  await seedTargetReports(appPage, node.uuid, targets);
  await verifyHomeEntryButtons(komariPage, baseURL, theme, node, pendingNode, scenarioDir);

  if (fullVerification) {
    await verifyConfiguredNode(appPage, node.uuid, targets, scenarioDir);
  } else {
    const detail = await apiOK(appPage, `${appBaseURL}/api/v1/nodes/${node.uuid}`, undefined, "load PurCarte node");
    if (!detail.has_data) {
      throw new Error("PurCarte real-user node did not receive report data");
    }
  }

  return {
    theme,
    nodeName,
    uuid: node.uuid,
    pendingNodeName,
    pendingUUID: pendingNode.uuid,
    standaloneURL,
    targets
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  permissions: ["clipboard-read", "clipboard-write"],
  viewport: { width: 1440, height: 1100 }
});
const appPage = await context.newPage();
const defaultKomariPage = await context.newPage();
const purcarteKomariPage = await context.newPage();
for (const page of [appPage, defaultKomariPage, purcarteKomariPage]) {
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
}
let initialIntegration = null;
const summary = [];

try {
  await loginIPQ(appPage);
  initialIntegration = await apiOK(appPage, `${appBaseURL}/api/v1/admin/integration`, undefined, "load integration settings");
  await cleanupNodes(appPage, [
    { page: defaultKomariPage, baseURL: defaultKomariBaseURL },
    { page: purcarteKomariPage, baseURL: purcarteKomariBaseURL }
  ]);

  await loginIPQ(appPage);
  const loaderCode = await configureIntegrationFromUI(appPage);
  await setKomariHeaderFromUI(defaultKomariPage, defaultKomariBaseURL, loaderCode, path.join(outputDir, "default"));
  await setKomariHeaderFromUI(purcarteKomariPage, purcarteKomariBaseURL, loaderCode, path.join(outputDir, "purcarte"));

  summary.push(
    await runScenario({
      appPage,
      komariPage: defaultKomariPage,
      baseURL: defaultKomariBaseURL,
      theme: "default",
      targets: ["1.1.1.1", "8.8.8.8"],
      fullVerification: true
    })
  );
  summary.push(
    await runScenario({
      appPage,
      komariPage: purcarteKomariPage,
      baseURL: purcarteKomariBaseURL,
      theme: "purcarte",
      targets: ["9.9.9.9", "2606:4700:4700::1111"],
      fullVerification: false
    })
  );

  writeFileSync(
    path.join(outputDir, "summary.json"),
    JSON.stringify(
      {
        appBaseURL,
        integrationPublicBaseURL,
        scenarios: summary
      },
      null,
      2
    )
  );

  console.log("verify-real-user-onboarding: ok");
} finally {
  if (initialIntegration) {
    await loginIPQ(appPage).catch(() => {});
    await jsonFetch(appPage, `${appBaseURL}/api/v1/admin/integration`, {
      method: "PUT",
      body: JSON.stringify({
        public_base_url: initialIntegration.public_base_url || "",
        guest_read_enabled: Boolean(initialIntegration.guest_read_enabled)
      })
    }).catch(() => {});
  }
  await cleanupNodes(appPage, [
    { page: defaultKomariPage, baseURL: defaultKomariBaseURL },
    { page: purcarteKomariPage, baseURL: purcarteKomariBaseURL }
  ]).catch(() => {});
  await browser.close().catch(() => {});
}
