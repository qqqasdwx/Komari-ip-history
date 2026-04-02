import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const komariBaseURL = (process.env.KOMARI_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const integrationPublicBaseURL = (process.env.IPQ_INTEGRATION_PUBLIC_BASE_URL || "").replace(/\/$/, "");
const outputDir = path.resolve("playwright-output");
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
  const button = page.locator("button").filter({ hasText: /IP 质量/ }).first();
  await button.waitFor({ state: "visible", timeout: 15000 });
  await button.click();
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
  const guestOnOverlay = await guestOnPage.locator('#ipq-loader-overlay[data-open="true"]').count();
  const guestOnIframeSrc = await guestOnPage.locator("#ipq-loader-overlay iframe").first().getAttribute("src");
  if (guestOnOverlay !== 1 || !guestOnIframeSrc?.includes("/public/nodes/")) {
    throw new Error("guest-enabled scenario did not open the anonymous public popup");
  }
  await guestOnContext.close();
  guestOnContext = null;

  const adminReturnNode = await addKomariNode(komariPage, "Playwright Admin Return Node");
  createdNodeUUIDs.push(adminReturnNode.uuid);
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
  await adminReturnPage.locator('#ipq-loader-overlay[data-open="true"] iframe').first().waitFor({ state: "visible", timeout: 15000 });
  const adminReturnOverlay = await adminReturnPage.locator('#ipq-loader-overlay[data-open="true"]').count();
  const adminReturnIframeSrc =
    (await adminReturnPage.locator("#ipq-loader-overlay iframe").count()) > 0
      ? await adminReturnPage.locator("#ipq-loader-overlay iframe").first().getAttribute("src")
      : "";
  if (adminReturnOverlay !== 1 || !adminReturnIframeSrc?.includes(`/nodes/${adminReturnNode.uuid}`)) {
    throw new Error("admin return scenario did not reopen the Komari popup detail");
  }
  await adminReturnContext.close();
  adminReturnContext = null;

  writeFileSync(
    path.join(outputDir, "verify-embed-auth-flows.json"),
    JSON.stringify(
      {
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

  console.log("verify-embed-auth-flows: ok");
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
      body: JSON.stringify({ public_base_url: "", guest_read_enabled: false })
    }).catch(() => {});
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
