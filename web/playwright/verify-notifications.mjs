import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const appBaseURL = (process.env.IPQ_PUBLIC_BASE_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const outputDir = path.resolve("playwright-output", "notifications");
const runID = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const nodeName = `Playwright Notification Node ${runID}`;
const targetIP = "203.0.113.93";
const names = {
  matchingRule: `Playwright Org Change ${runID}`,
  nonMatchingRule: `Playwright ASN Only ${runID}`,
  disabledRule: `Playwright Disabled Rule ${runID}`,
  globalDisabledRule: `Playwright Global Disabled Rule ${runID}`,
  failingWebhook: `Playwright Failing Webhook ${runID}`,
  timeoutJS: `Playwright Timeout JS ${runID}`
};

mkdirSync(outputDir, { recursive: true });

function log(message) {
  console.log(`[notifications] ${message}`);
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

function createNotificationReceiver() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url || "",
        headers: req.headers,
        body
      });
      if ((req.url || "").startsWith("/fail")) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("forced failure");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        baseURL: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
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
  log("cleanup stale notification data");
  const channelResponse = await requestJSON(context, "/admin/notifications/channels").catch(() => null);
  const channelPayload = channelResponse?.status >= 200 && channelResponse.status < 300 && channelResponse.text
    ? JSON.parse(channelResponse.text)
    : {};
  for (const item of channelPayload.items || []) {
    if (String(item.name || "").startsWith("Playwright ")) {
      await requestJSON(context, `/admin/notifications/channels/${item.id}`, { method: "DELETE" }).catch(() => {});
    }
  }
  await requestJSON(context, "/admin/notifications/logs", { method: "DELETE" }).catch(() => {});

  const nodeResponse = await requestJSON(context, "/nodes").catch(() => null);
  const nodePayload = nodeResponse?.status >= 200 && nodeResponse.status < 300 && nodeResponse.text
    ? JSON.parse(nodeResponse.text)
    : {};
  for (const item of nodePayload.items || []) {
    if (String(item.name || "").startsWith("Playwright Notification Node ")) {
      await requestJSON(context, `/nodes/${item.node_uuid || item.komari_node_uuid}`, { method: "DELETE" }).catch(() => {});
    }
  }
}

function reportPayload(organization, recordedAt) {
  return {
    target_ip: targetIP,
    summary: organization,
    recorded_at: recordedAt,
    result: {
      Head: { IP: targetIP, Time: recordedAt, Version: "playwright" },
      Info: { Organization: organization }
    }
  };
}

async function createNodeWithInitialHistory(context) {
  log("seed node and initial report through IPQ APIs");
  const detail = await apiOK(context, "/nodes", { method: "POST", data: { name: nodeName } }, "create notification node");
  await apiOK(context, `/nodes/${detail.node_uuid}/targets`, { method: "POST", data: { ip: targetIP } }, "add notification target");
  const current = await apiOK(context, `/nodes/${detail.node_uuid}`, undefined, "load notification node");
  const reporterToken = current.report_config?.reporter_token;
  const target = (current.targets || []).find((item) => item.ip === targetIP);
  if (!reporterToken || !target?.id) {
    throw new Error(`notification node report config incomplete: ${JSON.stringify(current.report_config || {})}`);
  }
  await apiOK(
    context,
    `/report/nodes/${detail.node_uuid}`,
    { method: "POST", headers: { Authorization: `Bearer ${reporterToken}` }, data: reportPayload("Org A", "2026-05-03T00:00:00Z") },
    "initial report"
  );
  return { nodeUUID: detail.node_uuid, reporterToken, targetID: target.id };
}

async function configureSettingsFromUI(page) {
  log("configure notification settings from UI");
  await page.goto(`${appBaseURL}/#/settings/notifications`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "通知", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  if ((await page.getByRole("button", { name: "启用通知" }).count()) > 0) {
    await page.getByRole("button", { name: "启用通知" }).click();
  }

  await page.goto(`${appBaseURL}/#/settings/notifications/channel`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "发送器设置", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.locator("#notification-channel-type").selectOption("telegram");
  await page.getByLabel("正文模板").fill("旧值 {{old_value}}\n新值 {{new_value}}\n详情 {{detail_url}}\n对比 {{compare_url}}");
  await page.getByRole("button", { name: "保存模板" }).click();
  await page.waitForTimeout(300);
}

async function selectChannelType(page, type) {
  await page.goto(`${appBaseURL}/#/settings/notifications/channel`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "发送器设置", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.locator("#notification-channel-type").selectOption(type);
}

async function saveSelectedChannel(page) {
  await page.getByRole("button", { name: "保存并设为当前发送器" }).click();
  await page.waitForTimeout(500);
}

async function activateWebhookFromUI(page) {
  await selectChannelType(page, "webhook");
  await saveSelectedChannel(page);
  await page.getByText("Webhook").first().waitFor({ state: "visible", timeout: 10000 });
}

async function createWebhookChannelFromUI(page, receiverURL) {
  log("create webhook channel from UI");
  await selectChannelType(page, "webhook");
  await page.getByLabel("Webhook URL").fill(`${receiverURL}/webhook`);
  await page.locator("#notification-webhook-method").selectOption("POST");
  await page.getByLabel("Content-Type").fill("application/json");
  await page.getByLabel("请求头 JSON").fill('{"X-Playwright":"notification"}');
  await page.getByLabel("请求体").fill('{"node":"{{node_name}}","new":"{{new_value}}","detail":"{{detail_url}}"}');
  await saveSelectedChannel(page);
  await page.getByText("Webhook").first().waitFor({ state: "visible", timeout: 10000 });
}

async function createTelegramChannelFromUI(page, receiverURL) {
  log("create telegram channel from UI");
  await selectChannelType(page, "telegram");
  await page.getByLabel("Bot Token").fill("playwright-token");
  await page.getByLabel("Chat ID").fill("12345");
  await page.getByLabel("Thread ID").fill("67890");
  await page.getByLabel("接口前缀").fill(`${receiverURL}/telegram/bot`);
  await saveSelectedChannel(page);
  await page.getByText("Telegram").first().waitFor({ state: "visible", timeout: 10000 });
}

async function createJSChannelFromUI(page) {
  log("create javascript channel from UI");
  await selectChannelType(page, "javascript");
  await page.getByLabel("Sender 脚本").fill("function sendEvent(event) { return { ok: event.field_id !== '' }; }");
  await saveSelectedChannel(page);
  await page.getByText("JavaScript").first().waitFor({ state: "visible", timeout: 10000 });
}

async function testChannelFromUI(page, type) {
  await selectChannelType(page, type);
  await page.getByRole("button", { name: "测试已保存配置" }).click();
  await page.waitForTimeout(500);
}

async function createMatchingRuleFromUI(page, nodeUUID) {
  log("create matching notification rule from UI");
  await page.goto(`${appBaseURL}/#/settings/notifications`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "通知", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "添加规则" }).click();
  await page.getByLabel("规则名称").fill(names.matchingRule);
  await page.waitForFunction(() => {
    const select = document.querySelector("#notification-rule-field");
    return Array.from(select?.options || []).some((option) => option.value === "info.organization");
  });
  await page.locator("#notification-rule-field").selectOption("info.organization");
  await page.getByLabel("指定节点").check();
  await page.getByPlaceholder("搜索节点").fill(nodeName);
  await page.getByLabel(nodeName).check();
  await page.getByLabel("监控该节点的所有 IP").uncheck();
  await page.getByLabel(targetIP).check();
  await page.getByRole("button", { name: "创建规则" }).click();
  await page.locator("tbody tr").filter({ hasText: names.matchingRule }).waitFor({ state: "visible", timeout: 10000 });

  const rules = await apiOK(page.context(), "/admin/notifications/rules", undefined, "list rules after UI create");
  const rule = (rules.items || []).find((item) => item.name === names.matchingRule);
  if (!rule || rule.node_uuid !== nodeUUID || rule.target_ip !== targetIP || rule.field_id !== "info.organization") {
    throw new Error(`matching rule saved incorrectly: ${JSON.stringify(rule)}`);
  }
  return rule;
}

async function findChannelByType(context, type) {
  const channels = await apiOK(context, "/admin/notifications/channels", undefined, "list notification channels");
  const channel = (channels.items || []).find((item) => item.type === type);
  if (!channel) {
    throw new Error(`channel not found: ${type}`);
  }
  return channel;
}

async function createRuleAPI(context, payload) {
  return apiOK(context, "/admin/notifications/rules", { method: "POST", data: payload }, `create rule ${payload.name}`);
}

async function createChannelAPI(context, payload) {
  return apiOK(context, "/admin/notifications/channels", { method: "POST", data: payload }, `create channel ${payload.name}`);
}

async function updateNotificationSettingsAPI(context, payload) {
  return apiOK(context, "/admin/notifications/settings", { method: "PUT", data: payload }, "update notification settings");
}

async function reportNode(context, nodeUUID, reporterToken, organization, recordedAt) {
  await apiOK(
    context,
    `/report/nodes/${nodeUUID}`,
    { method: "POST", headers: { Authorization: `Bearer ${reporterToken}` }, data: reportPayload(organization, recordedAt) },
    `report ${organization}`
  );
}

async function assertLogExists(context, predicate, label) {
  const logs = await apiOK(context, "/admin/notifications/logs?page_size=80", undefined, "list notification logs");
  const found = (logs.items || []).find(predicate);
  if (!found) {
    throw new Error(`${label}: ${JSON.stringify(logs.items || [])}`);
  }
  return found;
}

const receiver = await createNotificationReceiver();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(30000);

try {
  await loginIPQ(page);
  await cleanup(context);
  await apiOK(
    context,
    "/admin/integration",
    { method: "PUT", data: { public_base_url: appBaseURL, guest_read_enabled: false } },
    "configure public base url"
  );
  const { nodeUUID, reporterToken } = await createNodeWithInitialHistory(context);
  await configureSettingsFromUI(page);
  await createWebhookChannelFromUI(page, receiver.baseURL);
  await createTelegramChannelFromUI(page, receiver.baseURL);
  await createJSChannelFromUI(page);
  await activateWebhookFromUI(page);
  await page.screenshot({ path: path.join(outputDir, "01-notification-channels.png"), fullPage: true });

  const beforeTests = receiver.requests.length;
  await testChannelFromUI(page, "webhook");
  await testChannelFromUI(page, "telegram");
  await testChannelFromUI(page, "javascript");
  if (receiver.requests.length - beforeTests !== 2) {
    throw new Error(`expected webhook and telegram test sends to hit receiver twice, got ${receiver.requests.length - beforeTests}`);
  }
  await assertLogExists(context, (item) => item.channel_type === "webhook" && item.status === "success" && !item.rule_name, "webhook test log missing");
  await assertLogExists(context, (item) => item.channel_type === "telegram" && item.status === "success" && !item.rule_name, "telegram test log missing");
  await assertLogExists(context, (item) => item.channel_type === "javascript" && item.status === "success" && !item.rule_name, "javascript test log missing");

  const matchingRule = await createMatchingRuleFromUI(page, nodeUUID);
  const webhook = await findChannelByType(context, "webhook");
  const beforeMatchingReport = receiver.requests.length;
  await reportNode(context, nodeUUID, reporterToken, "Org B", "2026-05-03T01:00:00Z");
  if (receiver.requests.length !== beforeMatchingReport + 1) {
    throw new Error("matching rule did not deliver webhook notification");
  }
  const matchingLog = await assertLogExists(
    context,
    (item) =>
      item.rule_name === names.matchingRule &&
      item.status === "success" &&
      item.field_id === "info.organization" &&
      item.previous_value === "Org A" &&
      item.current_value === "Org B",
    "matching rule delivery log missing"
  );
  if (!matchingLog.detail_url || !matchingLog.compare_url) {
    throw new Error(`matching log is missing public links: ${JSON.stringify(matchingLog)}`);
  }
  const matchingRequest = receiver.requests[receiver.requests.length - 1];
  if (!matchingRequest.body.includes('"new":"Org B"')) {
    throw new Error(`webhook body did not render event variable: ${matchingRequest.body}`);
  }
  if (matchingRequest.body.includes("旧值") || matchingRequest.body.includes("新值")) {
    throw new Error(`webhook body unexpectedly used telegram notification template: ${matchingRequest.body}`);
  }

  await requestJSON(context, `/admin/notifications/rules/${matchingRule.id}`, {
    method: "PATCH",
    data: { enabled: false }
  });
  await createRuleAPI(context, {
    name: names.nonMatchingRule,
    enabled: true,
    channel_id: webhook.id,
    node_uuid: nodeUUID,
    target_ip: targetIP,
    field_id: "info.asn"
  });
  const beforeNonMatching = receiver.requests.length;
  await reportNode(context, nodeUUID, reporterToken, "Org C", "2026-05-03T02:00:00Z");
  if (receiver.requests.length !== beforeNonMatching) {
    throw new Error("non-matching rule unexpectedly delivered a notification");
  }

  await createRuleAPI(context, {
    name: names.disabledRule,
    enabled: false,
    channel_id: webhook.id,
    node_uuid: nodeUUID,
    target_ip: targetIP,
    field_id: "info.organization"
  });
  const beforeDisabledRule = receiver.requests.length;
  await reportNode(context, nodeUUID, reporterToken, "Org D", "2026-05-03T03:00:00Z");
  if (receiver.requests.length !== beforeDisabledRule) {
    throw new Error("disabled rule unexpectedly delivered a notification");
  }

  await updateNotificationSettingsAPI(context, {
    enabled: false,
    active_channel_id: webhook.id,
    title_template: "",
    body_template: "旧值 {{old_value}}\n新值 {{new_value}}\n详情 {{detail_url}}\n对比 {{compare_url}}"
  });
  await createRuleAPI(context, {
    name: names.globalDisabledRule,
    enabled: true,
    channel_id: webhook.id,
    node_uuid: nodeUUID,
    target_ip: targetIP,
    field_id: "info.organization"
  });
  const beforeGlobalDisabled = receiver.requests.length;
  await reportNode(context, nodeUUID, reporterToken, "Org E", "2026-05-03T04:00:00Z");
  if (receiver.requests.length !== beforeGlobalDisabled) {
    throw new Error("globally disabled notifications unexpectedly delivered");
  }
  await updateNotificationSettingsAPI(context, {
    enabled: true,
    active_channel_id: webhook.id,
    title_template: "",
    body_template: "旧值 {{old_value}}\n新值 {{new_value}}\n详情 {{detail_url}}\n对比 {{compare_url}}"
  });

  const failingWebhook = await createChannelAPI(context, {
    name: names.failingWebhook,
    type: "webhook",
    enabled: true,
    config: { url: `${receiver.baseURL}/fail` }
  });
  await apiOK(context, `/admin/notifications/channels/${failingWebhook.id}/test`, { method: "POST" }, "test failing webhook");
  await assertLogExists(
    context,
    (item) => item.channel_name === names.failingWebhook && item.status === "failed" && String(item.error || "").includes("http 500"),
    "failing webhook log missing"
  );

  const timeoutJS = await createChannelAPI(context, {
    name: names.timeoutJS,
    type: "javascript",
    enabled: true,
    config: { script: "function send(input) { while (true) {} }" }
  });
  const startedAt = Date.now();
  await apiOK(context, `/admin/notifications/channels/${timeoutJS.id}/test`, { method: "POST" }, "test timeout js");
  const elapsed = Date.now() - startedAt;
  if (elapsed > 5500) {
    throw new Error(`javascript sender timeout blocked too long: ${elapsed}ms`);
  }
  await assertLogExists(
    context,
    (item) => item.channel_name === names.timeoutJS && item.status === "failed" && String(item.error || "").toLowerCase().includes("timeout"),
    "timeout javascript log missing"
  );

  await requestJSON(context, `/nodes/${nodeUUID}`, { method: "DELETE" });
  await page.goto(`${appBaseURL}/#/nodes`, { waitUntil: "domcontentloaded" });
  await page.goto(`${appBaseURL}/#/settings/notifications`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "通知", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("已删除节点").first().waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: path.join(outputDir, "02-notification-rules.png"), fullPage: true });
  await page.goto(`${appBaseURL}/#/settings/notifications/logs`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "投递记录", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.locator("#notification-log-status").selectOption("failed");
  await page.locator("[data-notification-log-status='failed']").first().waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: path.join(outputDir, "03-notification-deliveries.png"), fullPage: true });

  const logs = await apiOK(context, "/admin/notifications/logs?page_size=80", undefined, "final notification logs");
  writeFileSync(
    path.join(outputDir, "verify-summary.json"),
    JSON.stringify(
      {
        appBaseURL,
        nodeName,
        targetIP,
        receiverURL: receiver.baseURL,
        requestCount: receiver.requests.length,
        logCount: logs.items?.length || 0,
        verifiedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
  console.log("verify-notifications: ok");
} finally {
  await browser.close().catch(() => {});
  await receiver.close().catch(() => {});
}
