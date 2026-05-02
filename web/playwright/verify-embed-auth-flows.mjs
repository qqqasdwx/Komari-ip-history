import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const komariBaseURL = (process.env.KOMARI_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const integrationPublicBaseURL = (process.env.IPQ_INTEGRATION_PUBLIC_BASE_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const restoreIntegrationPublicBaseURL = (
  process.env.IPQ_INTEGRATION_PUBLIC_BASE_URL_RESTORE || "http://127.0.0.1:8090"
).replace(/\/$/, "");
const themeScenario = (process.env.KOMARI_THEME_SCENARIO || "default").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
const expectedKomariTheme = (process.env.EXPECTED_KOMARI_THEME || "").trim().toLowerCase();
const themeDisplayName = expectedKomariTheme === "purcarte" ? "PurCarte" : "Default";
const nodeNamePrefix = `Playwright ${themeDisplayName}`;
const outputDir = path.resolve("playwright-output");
const scenarioOutputDir = path.join(outputDir, `embed-${themeScenario}`);
mkdirSync(outputDir, { recursive: true });
mkdirSync(scenarioOutputDir, { recursive: true });

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

function parseJSON(result) {
  return result.text ? JSON.parse(result.text) : {};
}

function expectOK(result, label) {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${label} failed: ${result.status} ${result.text}`);
  }
  return result;
}

async function clickIpqAction(page) {
  const accessibleButton = page.getByRole("button", { name: /IP 质量|开启 IP 质量检测/ }).first();
  if ((await accessibleButton.count()) > 0) {
    await accessibleButton.waitFor({ state: "visible", timeout: 15000 });
    await accessibleButton.click();
    return;
  }
  const textButton = page.locator("button").filter({ hasText: /IP 质量|开启 IP 质量检测/ }).first();
  await textButton.waitFor({ state: "visible", timeout: 15000 });
  await textButton.click();
}

function assertThemeParam(iframeSrc, label) {
  const url = new URL(iframeSrc);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query);

  if (params.get("komari_theme_protocol") !== "1") {
    throw new Error(`${label} missing Komari theme protocol marker`);
  }
  for (const key of ["komari_theme", "komari_appearance", "komari_bg", "komari_card", "komari_border", "komari_text", "komari_muted", "komari_accent_color"]) {
    if (!params.get(key)) {
      throw new Error(`${label} missing Komari theme token ${key}`);
    }
  }

  if (!expectedKomariTheme) {
    return;
  }
  const actual = (params.get("komari_theme") || "").toLowerCase();
  if (!actual.includes(expectedKomariTheme)) {
    throw new Error(`${label} expected komari_theme=${expectedKomariTheme}, got ${params.get("komari_theme") || "<empty>"}`);
  }
  if (expectedKomariTheme === "purcarte") {
    for (const key of ["komari_glass", "komari_blur", "komari_canvas", "komari_purcarte_card"]) {
      if (!params.get(key)) {
        throw new Error(`${label} missing PurCarte theme token ${key}`);
      }
    }
    if (params.get("komari_bg") !== params.get("komari_purcarte_card")) {
      throw new Error(`${label} should use PurCarte card as embedded background`);
    }
  }
}

async function waitForEmbedReport(page) {
  const frame = page.frameLocator('#ipq-loader-overlay[data-open="true"] iframe').first();
  await frame.locator('[data-detail-report="true"]').waitFor({ state: "visible", timeout: 15000 });
}

async function waitForEmbedBridge(page) {
  const frame = page.frameLocator('#ipq-loader-overlay[data-open="true"] iframe').first();
  await frame.getByRole("heading", { name: "需要登录" }).waitFor({ state: "visible", timeout: 15000 });
  await frame.getByRole("link", { name: "登录 IPQ 后查看" }).waitFor({ state: "visible", timeout: 15000 });
}

async function assertPurCarteBridgeStyle(page) {
  if (expectedKomariTheme !== "purcarte") {
    return;
  }
  const overlayClass = (await page.locator("#ipq-loader-overlay").first().getAttribute("class")) || "";
  if (!overlayClass.includes("ipq-loader-theme-purcarte")) {
    throw new Error("purcarte login bridge overlay is missing the PurCarte theme class");
  }
  const styles = await page.frameLocator('#ipq-loader-overlay[data-open="true"] iframe').first().locator("body").evaluate(() => {
    const card = document.querySelector(".embed-bridge-card");
    const action = document.querySelector(".embed-bridge-action");
    const read = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage
      };
    };
    return {
      card: read(card),
      action: read(action)
    };
  });
  if (styles.card?.backgroundColor === "rgb(255, 255, 255)" && styles.card?.backgroundImage === "none") {
    throw new Error("PurCarte login bridge card should not use a pure-white background");
  }
  if (styles.action?.backgroundColor === "rgb(255, 255, 255)") {
    throw new Error("PurCarte login bridge action should not use a pure-white background");
  }
}

async function waitForOpenIframeSrc(page, expectedPath, label) {
  const deadline = Date.now() + 45000;
  let lastSrc = "";
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const iframe = page.locator('#ipq-loader-overlay[data-open="true"] iframe').first();
      await iframe.waitFor({ state: "visible", timeout: 1000 });
      const src = await iframe.evaluate((frame) => frame.getAttribute("src") || frame.src || "");
      lastSrc = src || lastSrc;
      if (src.includes(expectedPath)) {
        return src;
      }
    } catch (error) {
      lastError = error && error.message ? error.message : String(error || "");
    }
    await page.waitForTimeout(250);
  }

  throw new Error(
    `${label} iframe did not point to ${expectedPath}: ${lastSrc || "<empty>"}${lastError ? ` (${lastError})` : ""}`
  );
}

async function loginApp(page) {
  await page.goto(`${appBaseURL}/#/login`);
  expectOK(await jsonFetch(page, `${appBaseURL}/api/v1/auth/login`, {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  }), "ipq login");
}

async function loginKomari(page) {
  await page.goto(`${komariBaseURL}/`);
  expectOK(await jsonFetch(page, `${komariBaseURL}/api/login`, {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  }), "komari login");
}

async function waitForStandaloneNodeSettings(page, label) {
  const deadline = Date.now() + 30000;
  let loginSubmitted = false;
  let lastURL = page.url();
  let lastText = "";

  while (Date.now() < deadline) {
    lastURL = page.url();
    const settings = page.locator('[data-node-settings-page="true"]').first();
    if ((await settings.count()) > 0 && await settings.isVisible().catch(() => false)) {
      return;
    }

    const loginBox = page.getByRole("textbox", { name: "用户名" });
    if (!loginSubmitted && (lastURL.includes("#/login") || (await loginBox.count()) > 0)) {
      await loginBox.fill("admin");
      await page.getByLabel("密码").fill("admin");
      await page.getByRole("button", { name: "登录" }).click();
      loginSubmitted = true;
    }

    lastText = await page.locator("body").innerText().catch(() => lastText);
    await page.waitForTimeout(250);
  }

  throw new Error(`${label} node settings did not open: url=${lastURL} text=${lastText.slice(0, 500)}`);
}

async function configureLoader(appPage, komariPage, guestReadEnabled) {
  await appPage.goto(`${appBaseURL}/#/nodes`);
  expectOK(await jsonFetch(appPage, `${appBaseURL}/api/v1/admin/integration`, {
    method: "PUT",
    body: JSON.stringify({ public_base_url: integrationPublicBaseURL, guest_read_enabled: guestReadEnabled })
  }), "update integration settings");
  const preview = expectOK(
    await jsonFetch(appPage, `${appBaseURL}/api/v1/admin/header-preview?variant=loader`),
    "load header preview"
  );
  const loaderCode = JSON.parse(preview.text).code;

  await komariPage.goto(`${komariBaseURL}/`);
  expectOK(await jsonFetch(komariPage, `${komariBaseURL}/api/admin/settings/`, {
    method: "POST",
    body: JSON.stringify({ custom_head: loaderCode })
  }), "update komari custom head");
}

async function addKomariNode(page, name) {
  const response = expectOK(await jsonFetch(page, `${komariBaseURL}/api/admin/client/add`, {
    method: "POST",
    body: JSON.stringify({ name })
  }), "add komari node");
  const payload = parseJSON(response);
  return payload.data || payload;
}

async function registerIpqNode(page, uuid, name) {
  return expectOK(await jsonFetch(page, `${appBaseURL}/api/v1/embed/nodes/register`, {
    method: "POST",
    body: JSON.stringify({ uuid, name })
  }), "register ipq node");
}

async function addIpqTarget(page, uuid, ip) {
  return expectOK(await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${uuid}/targets`, {
    method: "POST",
    body: JSON.stringify({ ip })
  }), "add ipq target");
}

async function removeKomariNode(page, uuid) {
  const response = await jsonFetch(page, `${komariBaseURL}/api/admin/client/${uuid}/remove`, { method: "POST" });
  return response.status;
}

async function removeIpqNode(page, uuid) {
  const response = await jsonFetch(page, `${appBaseURL}/api/v1/nodes/${uuid}`, { method: "DELETE" });
  return response.status;
}

const browser = await chromium.launch({ headless: true });
const createdNodeUUIDs = [];
let setupContext;
let guestOffContext;
let adminNoIpqContext;
let guestOnContext;
let loggedInContext;

try {
  setupContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const appPage = await setupContext.newPage();
  const komariPage = await setupContext.newPage();
  await loginApp(appPage);
  await loginKomari(komariPage);

  const registeredNodeName = `${nodeNamePrefix} Guest Read Node`;
  const registeredNode = await addKomariNode(komariPage, registeredNodeName);
  createdNodeUUIDs.push(registeredNode.uuid);
  await registerIpqNode(appPage, registeredNode.uuid, registeredNodeName);
  await addIpqTarget(appPage, registeredNode.uuid, "198.51.100.10");

  await configureLoader(appPage, komariPage, false);

  guestOffContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guestOffPage = await guestOffContext.newPage();
  await guestOffPage.goto(`${komariBaseURL}/instance/${registeredNode.uuid}`);
  await guestOffPage.waitForLoadState("networkidle");
  await guestOffPage.waitForTimeout(3000);
  await clickIpqAction(guestOffPage);
  await guestOffPage.waitForTimeout(1500);
  const guestOffOverlay = await guestOffPage.locator('#ipq-loader-overlay[data-open="true"]').count();
  const guestOffToastText =
    (await guestOffPage.locator('#ipq-loader-toast[data-open="true"]').count()) > 0
      ? await guestOffPage.locator("#ipq-loader-toast").innerText()
      : "";
  if (guestOffOverlay !== 0 || !guestOffToastText.includes("管理员未开放")) {
    throw new Error("guest-disabled scenario did not show the expected toast");
  }
  if (expectedKomariTheme === "purcarte") {
    const purcarteButtons = await guestOffPage.locator('[data-ipq-purcarte-button="true"]').count();
    if (purcarteButtons === 0) {
      throw new Error("purcarte scenario did not render the PurCarte icon button");
    }
  }
  await guestOffPage.screenshot({ path: path.join(scenarioOutputDir, "guest-blocked.png"), fullPage: true });
  await guestOffContext.close();
  guestOffContext = null;

  adminNoIpqContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminNoIpqPage = await adminNoIpqContext.newPage();
  const adminNoIpqNewPages = [];
  adminNoIpqContext.on("page", (newPage) => adminNoIpqNewPages.push(newPage));
  await loginKomari(adminNoIpqPage);
  await adminNoIpqPage.goto(`${komariBaseURL}/instance/${registeredNode.uuid}`);
  await adminNoIpqPage.waitForLoadState("networkidle");
  await adminNoIpqPage.waitForTimeout(3000);
  await clickIpqAction(adminNoIpqPage);
  await adminNoIpqPage.waitForTimeout(1500);
  const adminNoIpqIframeSrc = await waitForOpenIframeSrc(adminNoIpqPage, `/nodes/${registeredNode.uuid}`, "admin-no-ipq-login");
  if (!adminNoIpqPage.url().startsWith(`${komariBaseURL}/instance/${registeredNode.uuid}`)) {
    throw new Error(`admin-no-ipq-login should stay on the Komari page, got ${adminNoIpqPage.url()}`);
  }
  if (adminNoIpqNewPages.length !== 0) {
    throw new Error(`admin-no-ipq-login should not auto-open a standalone page, got ${adminNoIpqNewPages.map((item) => item.url()).join(", ")}`);
  }
  assertThemeParam(adminNoIpqIframeSrc, "admin-no-ipq-login iframe");
  await waitForEmbedBridge(adminNoIpqPage);
  await assertPurCarteBridgeStyle(adminNoIpqPage);
  await adminNoIpqPage.screenshot({ path: path.join(scenarioOutputDir, "admin-no-ipq-login.png"), fullPage: true });
  await adminNoIpqContext.close();
  adminNoIpqContext = null;

  await configureLoader(appPage, komariPage, true);

  guestOnContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guestOnPage = await guestOnContext.newPage();
  await guestOnPage.goto(`${komariBaseURL}/instance/${registeredNode.uuid}`);
  await guestOnPage.waitForLoadState("networkidle");
  await guestOnPage.waitForTimeout(3000);
  await clickIpqAction(guestOnPage);
  await guestOnPage.waitForTimeout(1500);
  const guestOnIframeSrc = await waitForOpenIframeSrc(guestOnPage, "/public/nodes/", "guest-enabled");
  const guestOnOverlay = await guestOnPage.locator('#ipq-loader-overlay[data-open="true"]').count();
  if (guestOnOverlay !== 1) {
    throw new Error("guest-enabled scenario did not open the anonymous public popup");
  }
  assertThemeParam(guestOnIframeSrc, "guest-enabled iframe");
  if (expectedKomariTheme === "purcarte") {
    const overlayClass = (await guestOnPage.locator("#ipq-loader-overlay").first().getAttribute("class")) || "";
    if (!overlayClass.includes("ipq-loader-theme-purcarte")) {
      throw new Error("purcarte guest overlay is missing the PurCarte theme class");
    }
  }
  await waitForEmbedReport(guestOnPage);
  await guestOnPage.screenshot({ path: path.join(scenarioOutputDir, "guest-allowed.png"), fullPage: true });
  await guestOnContext.close();
  guestOnContext = null;

  const loggedInConnectedNodeName = `${nodeNamePrefix} Logged In Connected Node`;
  const loggedInConnectedNode = await addKomariNode(komariPage, loggedInConnectedNodeName);
  createdNodeUUIDs.push(loggedInConnectedNode.uuid);
  await registerIpqNode(appPage, loggedInConnectedNode.uuid, loggedInConnectedNodeName);
  await addIpqTarget(appPage, loggedInConnectedNode.uuid, "198.51.100.20");
  const loggedInPendingNode = await addKomariNode(komariPage, `${nodeNamePrefix} Logged In Pending Node`);
  createdNodeUUIDs.push(loggedInPendingNode.uuid);

  loggedInContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const loggedInPage = await loggedInContext.newPage();
  await loginKomari(loggedInPage);
  await loggedInPage.goto(`${komariBaseURL}/instance/${loggedInConnectedNode.uuid}`);
  await loggedInPage.waitForLoadState("networkidle");
  await loggedInPage.waitForTimeout(3000);
  await clickIpqAction(loggedInPage);
  await loggedInPage.waitForTimeout(1500);
  const loggedInIframeSrc = await waitForOpenIframeSrc(loggedInPage, "/public/nodes/", "logged-in-connected");
  const loggedInOverlay = await loggedInPage.locator('#ipq-loader-overlay[data-open="true"]').count();
  if (loggedInOverlay !== 1) {
    throw new Error(`logged-in connected scenario did not open the view popup: overlay=${loggedInOverlay} iframe=${loggedInIframeSrc || "<empty>"}`);
  }
  assertThemeParam(loggedInIframeSrc, "logged-in connected iframe");
  if (expectedKomariTheme === "purcarte") {
    const overlayClass = (await loggedInPage.locator("#ipq-loader-overlay").first().getAttribute("class")) || "";
    if (!overlayClass.includes("ipq-loader-theme-purcarte")) {
      throw new Error("purcarte logged-in overlay is missing the PurCarte theme class");
    }
  }

  await loggedInPage.goto(`${komariBaseURL}/instance/${loggedInPendingNode.uuid}`);
  await loggedInPage.waitForLoadState("networkidle");
  await loggedInPage.waitForTimeout(3000);
  const beforeConnect = await jsonFetch(appPage, `${appBaseURL}/api/v1/nodes/${loggedInPendingNode.uuid}`);
  if (beforeConnect.status !== 404) {
    throw new Error(`pending node was created before clicking 去接入: ${beforeConnect.status} ${beforeConnect.text}`);
  }
  await clickIpqAction(loggedInPage);
  const connectButton = loggedInPage.getByRole("button", { name: "去接入" }).first();
  await connectButton.waitFor({ state: "visible", timeout: 15000 });
  const [standalonePage] = await Promise.all([
    loggedInContext.waitForEvent("page"),
    connectButton.click()
  ]);
  await standalonePage.waitForLoadState("domcontentloaded");
  await waitForStandaloneNodeSettings(standalonePage, "logged-in pending");
  const standaloneURL = standalonePage.url();
  if (!standaloneURL.includes("#/nodes/") || !standaloneURL.includes("/settings") || !standaloneURL.includes("from_komari=1")) {
    throw new Error(`logged-in pending scenario did not open node settings URL: ${standaloneURL}`);
  }
  await standalonePage.locator('[data-komari-return-hint="true"]').waitFor({ state: "visible", timeout: 10000 });
  await standalonePage.close();
  await loggedInContext.close();
  loggedInContext = null;

  writeFileSync(
    path.join(outputDir, `verify-embed-auth-flows-${themeScenario}.json`),
    JSON.stringify(
      {
        scenario: themeScenario,
        expectedTheme: expectedKomariTheme || null,
        guestOff: {
          nodeUUID: registeredNode.uuid,
          toastText: guestOffToastText
        },
        adminNoIpqLogin: {
          nodeUUID: registeredNode.uuid,
          iframeSrc: adminNoIpqIframeSrc
        },
        guestOn: {
          nodeUUID: registeredNode.uuid,
          iframeSrc: guestOnIframeSrc
        },
        loggedInConnected: {
          nodeUUID: loggedInConnectedNode.uuid,
          iframeSrc: loggedInIframeSrc
        },
        loggedInPending: {
          nodeUUID: loggedInPendingNode.uuid,
          standaloneURL
        }
      },
      null,
      2
    )
  );

  console.log(`verify-embed-auth-flows (${themeScenario}): ok`);
} finally {
  if (guestOffContext) await guestOffContext.close().catch(() => {});
  if (adminNoIpqContext) await adminNoIpqContext.close().catch(() => {});
  if (guestOnContext) await guestOnContext.close().catch(() => {});
  if (loggedInContext) await loggedInContext.close().catch(() => {});

  if (setupContext) {
    try {
      const appCleanupPage = await setupContext.newPage();
      const komariCleanupPage = await setupContext.newPage();
      await loginApp(appCleanupPage);
      await loginKomari(komariCleanupPage);
      await jsonFetch(appCleanupPage, `${appBaseURL}/api/v1/admin/integration`, {
        method: "PUT",
        body: JSON.stringify({ public_base_url: restoreIntegrationPublicBaseURL, guest_read_enabled: false })
      }).catch(() => {});
      const preview = await jsonFetch(
        appCleanupPage,
        `${appBaseURL}/api/v1/admin/header-preview?variant=loader&public_base_url=${encodeURIComponent(restoreIntegrationPublicBaseURL)}`
      ).catch(() => null);
      if (preview && preview.status >= 200 && preview.status < 300) {
        const payload = parseJSON(preview);
        await jsonFetch(komariCleanupPage, `${komariBaseURL}/api/admin/settings/`, {
          method: "POST",
          body: JSON.stringify({ custom_head: payload.code || "" })
        }).catch(() => {});
      }
      for (const uuid of createdNodeUUIDs) {
        await removeIpqNode(appCleanupPage, uuid).catch(() => {});
        await removeKomariNode(komariCleanupPage, uuid).catch(() => {});
      }
      await appCleanupPage.close().catch(() => {});
      await komariCleanupPage.close().catch(() => {});
    } catch (_) {
      // Preserve the original verification failure if the browser context closed first.
    }
    await setupContext.close().catch(() => {});
  }

  await browser.close().catch(() => {});
}
