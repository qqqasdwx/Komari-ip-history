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
  const accessibleButton = page.getByRole("button", { name: /IP 质量/ }).first();
  if ((await accessibleButton.count()) > 0) {
    await accessibleButton.waitFor({ state: "visible", timeout: 15000 });
    await accessibleButton.click();
    return;
  }
  const textButton = page.locator("button").filter({ hasText: /IP 质量/ }).first();
  await textButton.waitFor({ state: "visible", timeout: 15000 });
  await textButton.click();
}

function assertThemeParam(iframeSrc, label) {
  if (!expectedKomariTheme) {
    return;
  }
  const url = new URL(iframeSrc);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query);
  const actual = (params.get("komari_theme") || "").toLowerCase();
  if (!actual.includes(expectedKomariTheme)) {
    throw new Error(`${label} expected komari_theme=${expectedKomariTheme}, got ${params.get("komari_theme") || "<empty>"}`);
  }
}

async function waitForEmbedReport(page) {
  const frame = page.frameLocator('#ipq-loader-overlay[data-open="true"] iframe').first();
  await frame.locator('[data-detail-report="true"]').waitFor({ state: "visible", timeout: 15000 });
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
let guestOnContext;
let adminReturnContext;

try {
  setupContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const appPage = await setupContext.newPage();
  const komariPage = await setupContext.newPage();
  await loginApp(appPage);
  await loginKomari(komariPage);

  const registeredNodeName = "Playwright Guest Read Node";
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

  const adminReturnNode = await addKomariNode(komariPage, "Playwright Admin Return Node");
  createdNodeUUIDs.push(adminReturnNode.uuid);
  await registerIpqNode(appPage, adminReturnNode.uuid, "Playwright Admin Return Node");
  await addIpqTarget(appPage, adminReturnNode.uuid, "198.51.100.20");
  adminReturnContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminReturnPage = await adminReturnContext.newPage();
  await loginKomari(adminReturnPage);
  await adminReturnPage.goto(`${komariBaseURL}/instance/${adminReturnNode.uuid}`);
  await adminReturnPage.waitForLoadState("networkidle");
  await adminReturnPage.waitForTimeout(3000);
  await clickIpqAction(adminReturnPage);
  await adminReturnPage.waitForURL("**/#/login**", { timeout: 15000 });
  await adminReturnPage.getByRole("textbox", { name: "用户名" }).fill("admin");
  await adminReturnPage.getByLabel("密码").fill("admin");
  await adminReturnPage.getByRole("button", { name: "登录" }).click();
  await adminReturnPage.waitForURL(`${komariBaseURL}/instance/**`, { timeout: 25000 });
  await adminReturnPage.waitForLoadState("domcontentloaded");
  const adminReturnIframeSrc = await waitForOpenIframeSrc(
    adminReturnPage,
    `/nodes/${adminReturnNode.uuid}`,
    "admin-return"
  );
  const adminReturnOverlay = await adminReturnPage.locator('#ipq-loader-overlay[data-open="true"]').count();
  if (adminReturnOverlay !== 1) {
    throw new Error(`admin return scenario did not reopen the Komari popup detail: overlay=${adminReturnOverlay} iframe=${adminReturnIframeSrc || "<empty>"}`);
  }
  assertThemeParam(adminReturnIframeSrc, "admin-return iframe");
  if (expectedKomariTheme === "purcarte") {
    const overlayClass = (await adminReturnPage.locator("#ipq-loader-overlay").first().getAttribute("class")) || "";
    if (!overlayClass.includes("ipq-loader-theme-purcarte")) {
      throw new Error("purcarte admin overlay is missing the PurCarte theme class");
    }
  }
  await adminReturnContext.close();
  adminReturnContext = null;

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
        guestOn: {
          nodeUUID: registeredNode.uuid,
          iframeSrc: guestOnIframeSrc
        },
        adminReturn: {
          nodeUUID: adminReturnNode.uuid,
          iframeSrc: adminReturnIframeSrc
        }
      },
      null,
      2
    )
  );

  console.log(`verify-embed-auth-flows (${themeScenario}): ok`);
} finally {
  if (guestOffContext) await guestOffContext.close().catch(() => {});
  if (guestOnContext) await guestOnContext.close().catch(() => {});
  if (adminReturnContext) await adminReturnContext.close().catch(() => {});

  if (setupContext) {
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
    await setupContext.close().catch(() => {});
  }

  await browser.close().catch(() => {});
}
