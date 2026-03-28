import "./style.css";
import {
  classifyCompareLeafChanges,
  collectCompareLeafChanges,
  compareValueStats,
  compareValueStatus,
  emptyCompareStats,
  mergeCompareStats,
  type ClassifiedCompareChanges,
  type CompareLeafChange,
  type CompareStats,
  type CompareStatus
} from "./compare";

type MeResponse = {
  logged_in: boolean;
  username?: string;
  app_env?: string;
  base_path?: string;
  public_base_url?: string;
};

type NodeListItem = {
  komari_node_uuid: string;
  name: string;
  has_data: boolean;
  current_summary: string;
  current_result: Record<string, unknown>;
  updated_at?: string;
};

type NodeHistoryItem = {
  id: number;
  summary: string;
  recorded_at: string;
  result_json: string;
};

type NodeDetail = {
  komari_node_uuid: string;
  name: string;
  has_data: boolean;
  current_summary: string;
  updated_at?: string;
  current_result: Record<string, unknown>;
  history: NodeHistoryItem[];
  report_config: {
    endpoint_path: string;
    reporter_token: string;
  };
};

type DisplayFieldsConfig = {
  hidden_paths: string[];
};

type ChangePriorityConfig = {
  secondary_paths: string[];
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("missing app container");
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const apiBase = `${basePath}/api/v1`;

const state = {
  me: null as MeResponse | null,
  nodes: [] as NodeListItem[],
  nodeDetail: null as NodeDetail | null,
  displayFields: { hidden_paths: [] } as DisplayFieldsConfig,
  changePriority: { secondary_paths: ["Meta"] } as ChangePriorityConfig,
  changeViewFilters: {
    primaryOnly: false,
    changedOnly: false,
    group: "all"
  },
  displayFieldPaths: [] as string[],
  route: window.location.hash || "#/login",
  search: ""
};

window.addEventListener("hashchange", () => {
  state.route = window.location.hash || "#/login";
  void boot();
});

function currentRoute() {
  const raw = state.route.replace(/^#/, "") || "/login";
  const [path, query = ""] = raw.split("?");
  return {
    path: path || "/login",
    query: new URLSearchParams(query)
  };
}

function navigate(path: string) {
  window.location.hash = path;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function loadMe() {
  try {
    state.me = await api<MeResponse>("/auth/me");
  } catch {
    state.me = { logged_in: false };
  }
}

async function loadNodes() {
  const query = state.search ? `?q=${encodeURIComponent(state.search)}` : "";
  const response = await api<{ items: NodeListItem[] }>(`/nodes${query}`);
  state.nodes = response.items;
}

async function loadNode(uuid: string) {
  state.nodeDetail = await api<NodeDetail>(`/nodes/${uuid}`);
}

async function loadDisplayFields() {
  state.displayFields = await api<DisplayFieldsConfig>("/admin/display-fields");
}

async function loadDisplayFieldPaths() {
  const response = await api<{ items: string[] }>("/admin/display-fields/paths");
  state.displayFieldPaths = response.items;
}

async function loadChangePriority() {
  state.changePriority = await api<ChangePriorityConfig>("/admin/change-priority");
}

async function saveDisplayFields(hiddenPaths: string[]) {
  state.displayFields = await api<DisplayFieldsConfig>("/admin/display-fields", {
    method: "PUT",
    body: JSON.stringify({ hidden_paths: hiddenPaths })
  });
}

async function saveChangePriority(secondaryPaths: string[]) {
  state.changePriority = await api<ChangePriorityConfig>("/admin/change-priority", {
    method: "PUT",
    body: JSON.stringify({ secondary_paths: secondaryPaths })
  });
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function renderLogin() {
  app.innerHTML = `
    <div class="auth-shell">
      <div class="auth-card">
        <div class="auth-brand">
          <h1>Komari IP Quality</h1>
          <p>登录后直接进入后台工作区。</p>
        </div>
        <div class="section">
          <label>用户名<input class="input" id="username" value="admin" /></label>
          <label>密码<input class="input" id="password" type="password" value="admin" /></label>
          <button class="button" id="login-button">登录</button>
        </div>
      </div>
    </div>
  `;

  document.querySelector<HTMLButtonElement>("#login-button")?.addEventListener("click", async () => {
    const username = (document.querySelector<HTMLInputElement>("#username")?.value ?? "").trim();
    const password = document.querySelector<HTMLInputElement>("#password")?.value ?? "";
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      navigate("/nodes");
    } catch (error) {
      alert(error instanceof Error ? error.message : "登录失败");
    }
  });
}

function sidebar(active: "nodes" | "settings") {
  return `
    <aside class="admin-sidebar">
      <div class="sidebar-brand">
        <strong>Komari</strong>
        <span class="muted">IP Quality</span>
      </div>
      <nav class="sidebar-nav">
        <button class="sidebar-item ${active === "nodes" ? "active" : ""}" data-nav="/nodes">节点结果</button>
        <button class="sidebar-item ${active === "settings" ? "active" : ""}" data-nav="/settings">接入配置</button>
      </nav>
    </aside>
  `;
}

function appLayout(active: "nodes" | "settings", content: string) {
  return `
    <div class="admin-shell">
      ${sidebar(active)}
      <div class="admin-main">
        <header class="admin-toolbar">
          <div class="admin-toolbar-spacer"></div>
          <div class="topbar-actions">
            <span class="chip">模式 ${escapeHtml(state.me?.app_env ?? "unknown")}</span>
            <button class="button ghost" id="logout-button">退出登录</button>
          </div>
        </header>
        <div class="shell app-shell">
          ${content}
        </div>
      </div>
    </div>
  `;
}

function pageHeader(options: {
  title: string;
  subtitle?: string;
  backPath?: string;
  backLabel?: string;
  actions?: string;
}) {
  return `
    <div class="page-head">
      <div class="page-head-main">
        ${
          options.backPath
            ? `<button class="inline-button back-link" data-back="${escapeHtml(options.backPath)}">${escapeHtml(
                options.backLabel ?? "返回"
              )}</button>`
            : ""
        }
        <h1>${escapeHtml(options.title)}</h1>
        ${options.subtitle ? `<p class="muted">${escapeHtml(options.subtitle)}</p>` : ""}
      </div>
      ${options.actions ? `<div class="toolbar">${options.actions}</div>` : ""}
    </div>
  `;
}

function bindShellEvents() {
  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.nav ?? "/nodes"));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-back]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.back ?? "/nodes"));
  });

  document.querySelector<HTMLButtonElement>("#logout-button")?.addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST" });
    navigate("/login");
  });
}

function renderNodes() {
  const rows = state.nodes
    .map(
      (item) => `
        <a class="card row-link node-list-row" href="#/nodes/${item.komari_node_uuid}">
          <div class="node-list-main">
            <div class="section-head">
              <h3>${escapeHtml(item.name)}</h3>
              <span class="status ${item.has_data ? "ok" : "empty"}">${item.has_data ? "有数据" : "无数据"}</span>
            </div>
            <div class="muted">最近更新: ${formatDateTime(item.updated_at)}</div>
            ${renderNodeListSummary(item)}
          </div>
          <span class="inline-button">查看</span>
        </a>`
    )
    .join("");

  app.innerHTML = appLayout(
    "nodes",
    `
      ${pageHeader({
        title: "节点列表",
        subtitle: `${state.nodes.length} 个已接入节点`,
        actions:
          state.nodes.length > 0
            ? `<input class="input search-input" id="node-search" placeholder="搜索节点名称" value="${escapeHtml(state.search)}" />`
            : ""
      })}
      <section class="panel">
        <div class="section">
          <div class="section-head">
            <h2>IP 质量结果</h2>
            <span class="chip">${state.nodes.length} 个节点</span>
          </div>
          <div class="list">${rows || `
            <div class="card empty-state-card">
              <h3>还没有节点</h3>
              <p class="muted">先复制 Header 到 Komari，然后在节点详情页点击“添加 IP 质量检测”。</p>
              <div class="toolbar">
                <button class="button" data-nav="/settings">去接入</button>
              </div>
            </div>`}</div>
        </div>
      </section>
    `
  );

  bindShellEvents();
  document.querySelector<HTMLInputElement>("#node-search")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    state.search = (event.target as HTMLInputElement).value.trim();
    await loadNodes();
    renderNodes();
  });
}

function truncate(value: string) {
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatDateTime(value?: string) {
  if (!value) {
    return "N/A";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function currentOrigin() {
  return window.location.origin;
}

function normalizedPublicBaseURL() {
  return (state.me?.public_base_url ?? "").replace(/\/$/, "");
}

function resolveReportEndpointURL(path: string) {
  const base = normalizedPublicBaseURL() || currentOrigin();
  return `${base}${path}`;
}

function resolveComposeReportEndpointURL(path: string) {
  if (state.me?.app_env !== "development" || normalizedPublicBaseURL()) {
    return "";
  }
  return `http://proxy:8080${path}`;
}

function buildReportExample(detail: NodeDetail) {
  const endpoint = resolveReportEndpointURL(detail.report_config.endpoint_path);
  const payload = {
    summary: "Node reporter update",
    result: {
      Meta: {
        node_uuid: detail.komari_node_uuid,
        node_name: detail.name,
        source: "reporter"
      },
      Score: {
        Scamalytics: 12,
        AbuseIPDB: 0,
        IPQS: 18
      }
    }
  };

  return `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-IPQ-Reporter-Token: ${detail.report_config.reporter_token}" \\
  -d '${JSON.stringify(payload, null, 2)}'`;
}

function filterHiddenFields(value: unknown, prefix: string, hiddenPaths: Set<string>): unknown {
  if (prefix && hiddenPaths.has(prefix)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      const filtered = filterHiddenFields(child, childPath, hiddenPaths);
      if (filtered !== undefined) {
        next[key] = filtered;
      }
    }
    if (prefix && Object.keys(next).length === 0) {
      return undefined;
    }
    return next;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEmptyRecord(value?: Record<string, unknown>) {
  return !value || Object.keys(value).length === 0;
}

function titleize(key: string) {
  return key
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function compactLabel(key: string) {
  return titleize(key).replaceAll(" ", "");
}

function fieldGroupLabel(key: string) {
  if (key === "Head") {
    return "Head";
  }
  if (key === "Info") {
    return "Info";
  }
  if (key === "Type") {
    return "Type";
  }
  if (key === "Factor") {
    return "Factor";
  }
  if (key === "Meta") {
    return "Meta";
  }
  if (key === "Score") {
    return "Score";
  }
  if (key === "Media") {
    return "Media";
  }
  if (key === "Mail") {
    return "Mail";
  }
  return "其他字段";
}

function groupDisplayFieldPaths(paths: string[]) {
  const grouped = new Map<string, string[]>();
  for (const path of paths) {
    const root = path.split(".")[0] || "其他字段";
    const group = fieldGroupLabel(root);
    if (!grouped.has(group)) {
      grouped.set(group, []);
    }
    grouped.get(group)?.push(path);
  }

  return ["Head", "Info", "Type", "Factor", "Meta", "Score", "Media", "Mail", "其他字段"]
    .map((group) => ({
      group,
      paths: (grouped.get(group) ?? []).sort((left, right) => left.localeCompare(right))
    }))
    .filter((item) => item.paths.length > 0);
}

type ChangePriorityGroup = {
  group: string;
  rootPath: string;
  paths: string[];
};

function changePriorityTargets(paths: string[], secondaryPaths: string[]): ChangePriorityGroup[] {
  const preferred = ["Head", "Info", "Type", "Factor", "Meta", "Score", "Media", "Mail"];
  const grouped = new Map<string, Set<string>>();

  for (const path of paths) {
    const root = path.split(".")[0]?.trim();
    if (root) {
      if (!grouped.has(root)) {
        grouped.set(root, new Set<string>());
      }
      if (path !== root) {
        grouped.get(root)?.add(path);
      }
    }
  }

  for (const path of secondaryPaths) {
    const root = path.split(".")[0]?.trim();
    if (root) {
      if (!grouped.has(root)) {
        grouped.set(root, new Set<string>());
      }
      if (path !== root) {
        grouped.get(root)?.add(path);
      }
    }
  }

  const roots = Array.from(new Set([...preferred, ...grouped.keys()])).filter((root) => grouped.has(root));

  return roots
    .sort((left, right) => {
      const leftIndex = preferred.indexOf(left);
      const rightIndex = preferred.indexOf(right);
      if (leftIndex >= 0 || rightIndex >= 0) {
        if (leftIndex < 0) {
          return 1;
        }
        if (rightIndex < 0) {
          return -1;
        }
        return leftIndex - rightIndex;
      }
      return left.localeCompare(right);
    })
    .map((root) => ({
      group: fieldGroupLabel(root),
      rootPath: root,
      paths: Array.from(grouped.get(root) ?? []).sort((left, right) => left.localeCompare(right))
    }));
}

function changePrioritySummary() {
  const secondaryPaths = state.changePriority.secondary_paths;
  if (secondaryPaths.length === 0) {
    return "当前未设置辅助变化路径，所有分组默认作为重点变化。";
  }
  return `当前辅助变化: ${secondaryPaths.join("、")}；其余分组默认作为重点变化。`;
}

function formatDisplayValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "N/A";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    return value
      .map((item) => {
        if (isRecord(item) || Array.isArray(item)) {
          return JSON.stringify(item);
        }
        return String(item);
      })
      .join(", ");
  }

  if (isRecord(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

function renderRecordRows(record: Record<string, unknown>) {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return `<div class="muted">N/A</div>`;
  }

  return `
    <div class="kv">
      ${entries
        .map(([key, value]) => {
          if (isRecord(value)) {
            return `
              <div class="stack-block">
                <strong>${escapeHtml(titleize(key))}</strong>
                ${renderRecordRows(value)}
              </div>
            `;
          }

          return `
            <div class="kv-row">
              <strong>${escapeHtml(titleize(key))}</strong>
              <span>${escapeHtml(formatDisplayValue(value))}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function cloneRecord(record: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

function takeStructuredGroup(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!isRecord(value)) {
    return undefined;
  }
  delete record[key];
  return value;
}

function getFilteredCurrentResult(result: Record<string, unknown>) {
  const hidden = new Set(state.displayFields.hidden_paths);
  const filtered = filterHiddenFields(result, "", hidden);
  if (!isRecord(filtered) || Object.keys(filtered).length === 0) {
    return null;
  }

  const remainder = cloneRecord(filtered);
  return {
    head: takeStructuredGroup(remainder, "Head"),
    info: takeStructuredGroup(remainder, "Info"),
    type: takeStructuredGroup(remainder, "Type"),
    factor: takeStructuredGroup(remainder, "Factor"),
    meta: takeStructuredGroup(remainder, "Meta"),
    score: takeStructuredGroup(remainder, "Score"),
    media: takeStructuredGroup(remainder, "Media"),
    mail: takeStructuredGroup(remainder, "Mail"),
    remainder
  };
}

function parseResultJSON(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function compareLabel(status: CompareStatus) {
  if (status === "changed") {
    return "变化";
  }
  if (status === "added") {
    return "新增";
  }
  return "未变化";
}

function renderCompareBadge(status: CompareStatus) {
  return `<span class="diff-badge ${status}">${compareLabel(status)}</span>`;
}

function renderCompareOverview(stats: CompareStats, emptyText: string) {
  const total = stats.changed + stats.added + stats.unchanged;
  if (total === 0) {
    return `<div class="muted">${escapeHtml(emptyText)}</div>`;
  }

  return `
    <div class="compare-overview">
      <span class="summary-pill summary-pill-compare changed"><strong>变化</strong><span>${stats.changed}</span></span>
      <span class="summary-pill summary-pill-compare added"><strong>新增</strong><span>${stats.added}</span></span>
      <span class="summary-pill summary-pill-compare unchanged"><strong>未变化</strong><span>${stats.unchanged}</span></span>
    </div>
  `;
}

type StructuredCompareGroup = {
  key: string;
  title: string;
  chip: string;
  current?: Record<string, unknown>;
  previous?: Record<string, unknown>;
  stats: CompareStats;
  changes: CompareLeafChange[];
  classifiedChanges: ClassifiedCompareChanges;
};

type ChangeViewRecordSummary = {
  item: NodeHistoryItem;
  baseline: NodeHistoryItem | null;
  summary: {
    stats: CompareStats;
    groups: StructuredCompareGroup[];
    overviewMarkup: string;
    changeMarkup: string;
  };
  filteredGroups: StructuredCompareGroup[];
  filteredStats: CompareStats;
  hasMeaningfulChange: boolean;
};

function comparePathLabel(path: string) {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) {
    return "值";
  }
  return segments.map((segment) => titleize(segment)).join(" / ");
}

function renderCompareValueChip(label: string, value: unknown) {
  return `
    <span class="change-value-chip">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(formatDisplayValue(value))}</span>
    </span>
  `;
}

function renderCompareLeafChanges(
  changes: CompareLeafChange[],
  options: {
    dataAttr: string;
    emptyText: string;
    limit?: number;
  }
) {
  const visibleChanges = changes.filter((change) => change.status !== "unchanged");
  if (visibleChanges.length === 0) {
    return `<div class="muted">${escapeHtml(options.emptyText)}</div>`;
  }

  const limit = options.limit ?? visibleChanges.length;
  const items = visibleChanges.slice(0, limit);
  const hiddenCount = visibleChanges.length - items.length;

  return `
    <div class="change-list">
      ${items
        .map(
          (change) => `
            <div class="change-entry" ${options.dataAttr}="true">
              <div class="change-entry-head">
                <strong>${escapeHtml(comparePathLabel(change.path))}</strong>
                ${renderCompareBadge(change.status)}
              </div>
              <div class="change-entry-values">
                ${renderCompareValueChip("旧值", change.status === "added" ? "N/A" : change.previous)}
                <span class="change-entry-arrow">→</span>
                ${renderCompareValueChip("新值", change.current)}
              </div>
            </div>
          `
        )
        .join("")}
      ${
        hiddenCount > 0
          ? `<div class="muted">还有 ${hiddenCount} 项变化未在此处展开，请进入历史页查看完整对比。</div>`
          : ""
      }
    </div>
  `;
}

function renderChangeGroupCards(
  groups: StructuredCompareGroup[],
  options: {
    dataAttr: string;
    emptyText: string;
    limitPerGroup?: number;
  }
) {
  const changedGroups = groups.filter((group) => group.stats.changed > 0 || group.stats.added > 0);
  if (changedGroups.length === 0) {
    return `
      <div class="card change-card change-card-empty">
        <strong>${escapeHtml(options.emptyText)}</strong>
        <div class="muted">当前记录与上一条在可见字段范围内一致。</div>
      </div>
    `;
  }

  return changedGroups
    .map(
      (group) => `
        <div class="card change-card">
          <div class="summary-head">
            <strong>${escapeHtml(group.title)}</strong>
            <span class="chip">${escapeHtml(group.chip)}</span>
          </div>
          <div class="compare-overview">
            <span class="summary-pill summary-pill-compare changed"><strong>变化</strong><span>${group.stats.changed}</span></span>
            <span class="summary-pill summary-pill-compare added"><strong>新增</strong><span>${group.stats.added}</span></span>
          </div>
          ${
            group.classifiedChanges.primary.length > 0
              ? `
                <div class="change-section">
                  <div class="summary-head">
                    <strong>重点变化</strong>
                    <span class="chip">${group.classifiedChanges.primary.length} 项</span>
                  </div>
                  ${renderCompareLeafChanges(group.classifiedChanges.primary, {
                    dataAttr: options.dataAttr,
                    emptyText: "当前没有重点变化。",
                    limit: options.limitPerGroup
                  })}
                </div>
              `
              : ""
          }
          ${
            group.classifiedChanges.secondary.length > 0
              ? `
                <div class="change-section change-section-secondary">
                  <div class="summary-head">
                    <strong>辅助变化</strong>
                    <span class="chip">${group.classifiedChanges.secondary.length} 项</span>
                  </div>
                  ${renderCompareLeafChanges(group.classifiedChanges.secondary, {
                    dataAttr: `${options.dataAttr}-secondary`,
                    emptyText: "当前没有辅助变化。",
                    limit: options.limitPerGroup
                  })}
                </div>
              `
              : ""
          }
        </div>
      `
    )
    .join("");
}

function renderComparedRecordRows(current: Record<string, unknown>, previous?: Record<string, unknown>) {
  const entries = Object.entries(current);
  if (entries.length === 0) {
    return { markup: `<div class="muted">N/A</div>`, stats: emptyCompareStats() };
  }

  const stats = emptyCompareStats();
  const markup = `
    <div class="kv">
      ${entries
        .map(([key, value]) => {
          const previousValue = previous?.[key];
          if (isRecord(value)) {
            const child = renderComparedRecordRows(value, isRecord(previousValue) ? previousValue : undefined);
            mergeCompareStats(stats, child.stats);
            const status = compareValueStatus(value, previousValue);
            return `
              <div class="stack-block">
                <div class="compare-head">
                  <strong>${escapeHtml(titleize(key))}</strong>
                  ${renderCompareBadge(status)}
                </div>
                ${child.markup}
              </div>
            `;
          }

          const status = compareValueStatus(value, previousValue);
          mergeCompareStats(stats, compareValueStats(value, previousValue));
          return `
            <div class="kv-row">
              <strong>${escapeHtml(titleize(key))}</strong>
              <div class="compare-value">
                <span>${escapeHtml(formatDisplayValue(value))}</span>
                ${renderCompareBadge(status)}
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;

  return { markup, stats };
}

function reportFieldLabel(key: string) {
  const labels: Record<string, string> = {
    IP: "IP",
    Time: "报告时间",
    Version: "脚本版本",
    Type: "类型",
    ASN: "自治系统",
    Organization: "组织",
    Latitude: "纬度",
    Longitude: "经度",
    DMS: "坐标",
    Map: "地图",
    TimeZone: "时区",
    RegisteredRegion: "注册地区",
    Usage: "使用类型",
    Company: "公司类型",
    CountryCode: "地区",
    Proxy: "代理",
    Tor: "Tor",
    VPN: "VPN",
    Server: "服务器",
    Abuser: "滥用者",
    Robot: "机器人",
    IPinfo: "IPinfo",
    ipregistry: "ipregistry",
    ipapi: "ipapi",
    IP2LOCATION: "IP2Location",
    IPWHOIS: "IPWHOIS",
    SCAMALYTICS: "Scamalytics",
    AbuseIPDB: "AbuseIPDB",
    DBIP: "DB-IP",
    DisneyPlus: "Disney+",
    AmazonPrimeVideo: "AmazonPV",
    TikTok: "TikTok",
    Youtube: "Youtube",
    Netflix: "Netflix",
    Spotify: "Spotify",
    ChatGPT: "ChatGPT",
    Port25: "25端口",
    MailRU: "MailRU",
    MailCOM: "MailCOM",
    DNSBlacklist: "DNSBL"
  };
  return labels[key] ?? titleize(key);
}

function reportValueText(value: unknown) {
  if (value === undefined || value === null || value === "" || value === "null") {
    return "N/A";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  return String(value);
}

function reportValueClass(value: unknown) {
  const text = reportValueText(value);
  const normalized = text.trim().toLowerCase();

  if (normalized === "n/a" || normalized === "null" || normalized === "-") {
    return "report-pill-muted";
  }
  if (normalized === "yes" || normalized === "native" || normalized === "originals" || normalized === "解锁" || normalized === "是") {
    return "report-pill-good";
  }
  if (normalized === "no" || normalized === "block" || normalized === "blocked" || normalized === "fail" || normalized === "否") {
    return "report-pill-bad";
  }

  const number = Number.parseFloat(normalized.replace("%", ""));
  if (!Number.isNaN(number)) {
    if (number <= 33) {
      return "report-pill-good";
    }
    if (number <= 66) {
      return "report-pill-warn";
    }
    return "report-pill-bad";
  }

  return "report-pill-neutral";
}

function renderReportPill(value: unknown) {
  return `<span class="report-pill ${reportValueClass(value)}">${escapeHtml(reportValueText(value))}</span>`;
}

function renderReportLine(label: string, value: unknown) {
  return `
    <div class="report-line">
      <span class="report-label">${escapeHtml(label)}</span>
      <div class="report-values">${renderReportPill(value)}</div>
    </div>
  `;
}

function renderReportCell(provider: string, value: unknown) {
  return `
    <span class="report-cell">
      <strong>${escapeHtml(provider)}</strong>
      ${renderReportPill(value)}
    </span>
  `;
}

function renderReportObjectRow(label: string, value: unknown) {
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return renderReportLine(label, "N/A");
    }
    return `
      <div class="report-line">
        <span class="report-label">${escapeHtml(label)}</span>
        <div class="report-values">
          ${entries.map(([key, child]) => renderReportCell(reportFieldLabel(key), child)).join("")}
        </div>
      </div>
    `;
  }
  return renderReportLine(label, value);
}

function orderedReportEntries(record: Record<string, unknown>, order: string[] = []) {
  const seen = new Set<string>();
  const entries: Array<[string, unknown]> = [];
  for (const key of order) {
    if (record[key] !== undefined) {
      seen.add(key);
      entries.push([key, record[key]]);
    }
  }
  for (const entry of Object.entries(record)) {
    if (!seen.has(entry[0])) {
      entries.push(entry);
    }
  }
  return entries;
}

function renderReportRows(record: Record<string, unknown>, order: string[] = []) {
  return orderedReportEntries(record, order)
    .map(([key, value]) => renderReportObjectRow(reportFieldLabel(key), value))
    .join("");
}

function renderMediaReportRows(media: Record<string, unknown>) {
  const mediaOrder = ["TikTok", "DisneyPlus", "Netflix", "Youtube", "AmazonPrimeVideo", "Spotify", "Reddit", "ChatGPT"];
  return orderedReportEntries(media, mediaOrder)
    .map(([service, value]) => {
      if (!isRecord(value)) {
        return renderReportLine(reportFieldLabel(service), value);
      }

      const cells = [];
      if ("Status" in value) {
        cells.push(renderReportCell("状态", value.Status));
      }
      if ("Region" in value) {
        cells.push(renderReportCell("地区", value.Region));
      }
      if ("Type" in value) {
        cells.push(renderReportCell("类型", value.Type));
      }

      const extras = Object.entries(value).filter(([key]) => !["Status", "Region", "Type"].includes(key));
      for (const [key, child] of extras) {
        cells.push(renderReportCell(reportFieldLabel(key), child));
      }

      return `
        <div class="report-line">
          <span class="report-label">${escapeHtml(reportFieldLabel(service))}</span>
          <div class="report-values">${cells.join("") || renderReportPill("N/A")}</div>
        </div>
      `;
    })
    .join("");
}

function renderMailReportRows(mail: Record<string, unknown>) {
  const mailOrder = ["Gmail", "Outlook", "Yahoo", "Apple", "QQ", "MailRU", "AOL", "GMX", "MailCOM", "163", "Sohu", "Sina", "Port25", "DNSBlacklist"];
  return orderedReportEntries(mail, mailOrder)
    .map(([key, value]) => {
      if (key === "DNSBlacklist" && isRecord(value)) {
        return `
          <div class="report-line">
            <span class="report-label">${escapeHtml(reportFieldLabel(key))}</span>
            <div class="report-values">
              ${Object.entries(value).map(([childKey, childValue]) => renderReportCell(reportFieldLabel(childKey), childValue)).join("")}
            </div>
          </div>
        `;
      }
      return renderReportLine(reportFieldLabel(key), value);
    })
    .join("");
}

function renderReportSection(title: string, rows: string) {
  if (!rows) {
    return "";
  }
  return `
    <div class="result-group report-group">
      <div class="report-group-title">${escapeHtml(title)}</div>
      <div class="report-group-body">${rows}</div>
    </div>
  `;
}

function renderHeadInfoRows(head?: Record<string, unknown>, info?: Record<string, unknown>) {
  const rows: string[] = [];
  if (head) {
    if (head.IP !== undefined) {
      rows.push(renderReportLine("IP", head.IP));
    }
    if (head.Time !== undefined) {
      rows.push(renderReportLine("报告时间", head.Time));
    }
    if (head.Version !== undefined) {
      rows.push(renderReportLine("脚本版本", head.Version));
    }
  }
  if (info) {
    const infoOrder = ["ASN", "Organization", "Latitude", "Longitude", "DMS", "Map", "TimeZone", "Type"];
    for (const key of infoOrder) {
      if (info[key] !== undefined) {
        rows.push(renderReportObjectRow(reportFieldLabel(key), info[key]));
      }
    }
    for (const [key, value] of Object.entries(info)) {
      if (infoOrder.includes(key)) {
        continue;
      }
      rows.push(renderReportObjectRow(reportFieldLabel(key), value));
    }
  }
  return rows.join("");
}

function renderCurrentResult(result: Record<string, unknown>) {
  const structured = getFilteredCurrentResult(result);
  if (!structured) {
    return `
      <div class="empty-state">
        <strong>N/A</strong>
        <p class="muted">当前没有可展示的检测结果。</p>
      </div>
    `;
  }

  const sections = [
    renderReportSection("基础信息", renderHeadInfoRows(structured.head, structured.info)),
    renderReportSection(
      "IP 类型与风险评分",
      `${structured.type ? renderReportRows(structured.type, ["Usage", "Company"]) : ""}${
        structured.score ? renderReportRows(structured.score, ["SCAMALYTICS", "IPQS", "AbuseIPDB", "IP2LOCATION", "ipapi", "DBIP"]) : ""
      }`
    ),
    renderReportSection("风险因子", structured.factor ? renderReportRows(structured.factor, ["CountryCode", "Proxy", "Tor", "VPN", "Server", "Abuser", "Robot"]) : ""),
    renderReportSection("流媒体与服务", structured.media ? renderMediaReportRows(structured.media) : ""),
    renderReportSection("邮局检测", structured.mail ? renderMailReportRows(structured.mail) : ""),
    renderReportSection("其他结果", structured.remainder ? renderReportRows(structured.remainder) : "")
  ].filter(Boolean);

  if (sections.length === 0) {
    return `
      <div class="empty-state">
        <strong>N/A</strong>
        <p class="muted">当前还没有可展示的 IP 质量结果。</p>
      </div>
    `;
  }

  return `<div class="result-layout report-layout"><div class="report-shell">${sections.join("")}</div></div>`;
}

function renderHistoricalResult(currentResult: Record<string, unknown>, previousResult?: Record<string, unknown>) {
  const structured = getFilteredCurrentResult(currentResult);
  const previousStructured = previousResult ? getFilteredCurrentResult(previousResult) : null;
  if (!structured) {
    return {
      markup: `
        <div class="empty-state">
          <strong>N/A</strong>
          <p class="muted">当前没有可展示的历史结果。</p>
        </div>
      `,
      stats: emptyCompareStats()
    };
  }

  const sections: string[] = [];
  const allStats = emptyCompareStats();

  const pushRecordSection = (
    title: string,
    chip: string,
    currentRecord?: Record<string, unknown>,
    previousRecord?: Record<string, unknown>
  ) => {
    if (isEmptyRecord(currentRecord)) {
      return;
    }

    const rendered = renderComparedRecordRows(currentRecord!, previousRecord);
    mergeCompareStats(allStats, rendered.stats);
    sections.push(`
      <div class="result-group">
        <div class="section-head">
          <h3>${title}</h3>
          <span class="chip">${chip}</span>
        </div>
        ${rendered.markup}
      </div>
    `);
  };

  if (!isEmptyRecord(structured.score)) {
    const rendered = renderComparedRecordRows(structured.score!, previousStructured?.score);
    mergeCompareStats(allStats, rendered.stats);
    sections.push(`
      <div class="result-group">
        <div class="section-head">
          <h3>Score</h3>
          <span class="chip">风险分项</span>
        </div>
        ${rendered.markup}
      </div>
    `);
  }

  if (!isEmptyRecord(structured.media)) {
    const entries = Object.entries(structured.media!);
    const mediaStats = emptyCompareStats();
    sections.push(`
      <div class="result-group">
        <div class="section-head">
          <h3>Media</h3>
          <span class="chip">流媒体与服务</span>
        </div>
        <div class="detail-grid">
          ${entries
            .map(([key, value]) => {
              const previousValue = previousStructured?.media?.[key];
              if (isRecord(value)) {
                const rendered = renderComparedRecordRows(value, isRecord(previousValue) ? previousValue : undefined);
                mergeCompareStats(mediaStats, rendered.stats);
                const status = compareValueStatus(value, previousValue);
                return `
                  <div class="card detail-card">
                    <div class="compare-head">
                      <h3>${escapeHtml(titleize(key))}</h3>
                      ${renderCompareBadge(status)}
                    </div>
                    ${rendered.markup}
                  </div>
                `;
              }

              const status = compareValueStatus(value, previousValue);
              mergeCompareStats(mediaStats, compareValueStats(value, previousValue));
              return `
                <div class="card detail-card">
                  <div class="compare-head">
                    <h3>${escapeHtml(titleize(key))}</h3>
                    ${renderCompareBadge(status)}
                  </div>
                  <div>${escapeHtml(formatDisplayValue(value))}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `);
    mergeCompareStats(allStats, mediaStats);
  }

  pushRecordSection("Mail", "邮件能力", structured.mail, previousStructured?.mail);

  if (!isEmptyRecord(structured.remainder)) {
    const rendered = renderComparedRecordRows(structured.remainder, previousStructured?.remainder);
    mergeCompareStats(allStats, rendered.stats);
    sections.push(`
      <div class="result-group">
        <div class="section-head">
          <h3>其他检测结果</h3>
          <span class="chip">动态字段</span>
        </div>
        ${rendered.markup}
      </div>
    `);
  }

  return {
    markup: `<div class="result-layout">${sections.join("")}</div>`,
    stats: allStats
  };
}

function renderSummaryPills(entries: Array<{ label: string; value: string }>, fallback: string) {
  if (entries.length === 0) {
    return `<div class="muted">${escapeHtml(fallback)}</div>`;
  }

  return `
    <div class="summary-pills">
      ${entries
        .map(
          (entry) => `
            <span class="summary-pill">
              <strong>${escapeHtml(entry.label)}</strong>
              <span>${escapeHtml(entry.value)}</span>
            </span>
          `
        )
        .join("")}
    </div>
  `;
}

function renderNodeListSummary(item: NodeListItem) {
  const structured = getFilteredCurrentResult(item.current_result ?? {});
  if (!item.has_data || !structured) {
    return `
      <div class="list-summary" data-node-summary="empty">
        <div class="muted">当前还没有检测结果</div>
      </div>
    `;
  }

  const scoreEntries = Object.entries(structured.score ?? {}).map(([key, value]) => ({
    label: compactLabel(key),
    value: formatDisplayValue(value)
  }));

  return `
    <div class="list-summary" data-node-summary="structured">
      ${renderSummaryPills(scoreEntries, "当前没有可展示的风险分项")}
    </div>
  `;
}

function focusPrimaryChangeGroups(groups: StructuredCompareGroup[]) {
  const primaryGroups = groups
    .map((group) => ({
      ...group,
      stats: {
        changed: group.classifiedChanges.primary.filter((item) => item.status === "changed").length,
        added: group.classifiedChanges.primary.filter((item) => item.status === "added").length,
        unchanged: 0
      },
      changes: group.classifiedChanges.primary,
      classifiedChanges: {
        primary: group.classifiedChanges.primary,
        secondary: []
      }
    }))
    .filter((group) => group.classifiedChanges.primary.length > 0);

  if (primaryGroups.length > 0) {
    return primaryGroups;
  }
  return groups.filter((group) => group.stats.changed > 0 || group.stats.added > 0);
}

function buildStructuredCompareGroups(currentResult: Record<string, unknown>, previousResult?: Record<string, unknown>) {
  const structured = getFilteredCurrentResult(currentResult);
  const previousStructured = previousResult ? getFilteredCurrentResult(previousResult) : null;
  if (!structured) {
    return [] as StructuredCompareGroup[];
  }

  return [
    { key: "Head", title: "Head", chip: "报告头", current: structured.head, previous: previousStructured?.head },
    { key: "Info", title: "Info", chip: "基础信息", current: structured.info, previous: previousStructured?.info },
    { key: "Type", title: "Type", chip: "类型信息", current: structured.type, previous: previousStructured?.type },
    { key: "Factor", title: "Factor", chip: "风险因子", current: structured.factor, previous: previousStructured?.factor },
    { key: "Score", title: "Score", chip: "风险分项", current: structured.score, previous: previousStructured?.score },
    { key: "Media", title: "Media", chip: "流媒体与服务", current: structured.media, previous: previousStructured?.media },
    { key: "Mail", title: "Mail", chip: "邮件能力", current: structured.mail, previous: previousStructured?.mail },
    { key: "Other", title: "其他字段", chip: "动态字段", current: structured.remainder, previous: previousStructured?.remainder }
  ]
    .filter((group) => !isEmptyRecord(group.current))
    .map((group) => {
      const changes = collectCompareLeafChanges(group.current, group.previous, "", group.key);
      return {
        ...group,
        stats: compareValueStats(group.current, group.previous),
        changes,
        classifiedChanges: classifyCompareLeafChanges(changes, state.changePriority.secondary_paths)
      };
    });
}

function renderRecentChangeSummary(detail: NodeDetail) {
  const latestRecord = detail.history[0] ?? null;
  const previousRecord = detail.history[1] ?? null;

  if (!latestRecord) {
    return `
      <div class="summary-section" data-detail-change="empty">
        <div class="summary-head">
          <strong>最近变化</strong>
          <span class="chip">N/A</span>
        </div>
        <div class="muted">当前还没有历史记录，暂时无法判断最近一次变化。</div>
      </div>
    `;
  }

  if (!previousRecord) {
    return `
      <div class="summary-section" data-detail-change="single">
        <div class="summary-head">
          <strong>最近变化</strong>
          <span class="chip">无对比基准</span>
        </div>
        <div class="muted">当前只有 1 条历史记录，需等待下一次结果落库后才能比较变化。</div>
        <div class="muted">最新记录时间: ${formatDateTime(latestRecord.recorded_at)}</div>
      </div>
    `;
  }

  const latestResult = parseResultJSON(latestRecord.result_json);
  const previousResult = parseResultJSON(previousRecord.result_json);
  const groups = focusPrimaryChangeGroups(buildStructuredCompareGroups(latestResult, previousResult));
  const totalStats = groups.reduce((stats, group) => mergeCompareStats(stats, group.stats), emptyCompareStats());

  return `
    <div class="summary-section" data-detail-change="overview">
      <div class="summary-head">
        <strong>最近变化</strong>
        <span class="chip">相对上一条历史</span>
      </div>
      ${renderCompareOverview(totalStats, "最近一次与上一条之间没有可比较字段。")}
      <div class="change-summary-grid">
        ${renderChangeGroupCards(groups, {
          dataAttr: "data-detail-change-entry",
          emptyText: "最近一次没有字段变化",
          limitPerGroup: 3
        })}
      </div>
    </div>
  `;
}

function buildCompareRecordSummary(currentRecord: NodeHistoryItem, previousRecord?: NodeHistoryItem | null) {
  if (!previousRecord) {
    return {
      stats: emptyCompareStats(),
      groups: [] as StructuredCompareGroup[],
      overviewMarkup: `<div class="muted">这是首条历史记录，没有更早的基准可比较。</div>`,
      changeMarkup: `<div class="muted">这是首条历史记录，没有更早的基准可比较。</div>`
    };
  }

  const currentResult = parseResultJSON(currentRecord.result_json);
  const previousResult = parseResultJSON(previousRecord.result_json);
  const groups = buildStructuredCompareGroups(currentResult, previousResult);
  const stats = groups.reduce((summary, group) => mergeCompareStats(summary, group.stats), emptyCompareStats());

  return {
    stats,
    groups,
    overviewMarkup: renderCompareOverview(stats, "当前记录与上一条之间没有可对比字段。"),
    changeMarkup: renderChangeGroupCards(groups, {
      dataAttr: "data-change-view-entry",
      emptyText: "当前记录相对上一条没有字段变化"
    })
  };
}

function changeViewGroupOptions(groups: StructuredCompareGroup[]) {
  const options = [{ value: "all", label: "全部分组" }];
  const seen = new Set<string>();
  for (const group of groups) {
    if (seen.has(group.key)) {
      continue;
    }
    seen.add(group.key);
    options.push({ value: group.key, label: group.title });
  }
  return options;
}

function filterChangeGroups(groups: StructuredCompareGroup[]) {
  return groups
    .map((group) => {
      const primaryChanges = state.changeViewFilters.primaryOnly ? group.classifiedChanges.primary : group.classifiedChanges.primary;
      const secondaryChanges = state.changeViewFilters.primaryOnly ? [] : group.classifiedChanges.secondary;
      const stats = {
        changed: primaryChanges.filter((item) => item.status === "changed").length + secondaryChanges.filter((item) => item.status === "changed").length,
        added: primaryChanges.filter((item) => item.status === "added").length + secondaryChanges.filter((item) => item.status === "added").length,
        unchanged: 0
      };

      return {
        ...group,
        stats,
        changes: [...primaryChanges, ...secondaryChanges],
        classifiedChanges: {
          primary: primaryChanges,
          secondary: secondaryChanges
        }
      };
    })
    .filter((group) => {
      if (state.changeViewFilters.group !== "all" && group.key !== state.changeViewFilters.group) {
        return false;
      }
      if (state.changeViewFilters.changedOnly) {
        return group.stats.changed > 0 || group.stats.added > 0;
      }
      return true;
    });
}


function renderNodeDetail(embed = false) {
  const detail = state.nodeDetail;
  if (!detail) {
    app.innerHTML = "<div class='shell'><div class='panel'>节点不存在。</div></div>";
    return;
  }

  const currentResultMarkup = renderCurrentResult(detail.current_result);
  const recentChangeMarkup = renderRecentChangeSummary(detail);
  const reportEndpointURL = resolveReportEndpointURL(detail.report_config.endpoint_path);
  const composeReportEndpointURL = resolveComposeReportEndpointURL(detail.report_config.endpoint_path);
  const reportExample = buildReportExample(detail);
  if (embed) {
    app.innerHTML = `
      <div class="embed-shell">
        <section class="panel embed-panel">
          <div class="section page-head embed-head">
            <div class="page-head-main">
              <h2>${escapeHtml(detail.name)}</h2>
              <p class="muted">最近更新: ${formatDateTime(detail.updated_at)}${detail.has_data ? "" : "，当前还没有检测结果"}</p>
            </div>
            <div class="toolbar">
              <a class="button ghost" href="${basePath}/#/nodes/${encodeURIComponent(detail.komari_node_uuid)}/history" target="_blank" rel="noopener noreferrer">查看历史变化</a>
              <a class="button ghost" href="${basePath}/#/nodes/${encodeURIComponent(detail.komari_node_uuid)}" target="_blank" rel="noopener noreferrer">打开完整页面</a>
            </div>
          </div>
          <div class="section">
            <h2>当前 IP 质量</h2>
            ${currentResultMarkup}
          </div>
          <div class="section">
            <h2>最近变化</h2>
            ${recentChangeMarkup}
          </div>
        </section>
      </div>
    `;
    return;
  }

  app.innerHTML = appLayout(
    "nodes",
    `
      ${pageHeader({
        title: detail.name,
        subtitle: detail.has_data ? `最近更新: ${formatDateTime(detail.updated_at)}` : "当前还没有检测结果",
        backPath: "/nodes",
        backLabel: "返回节点列表",
        actions: `
          <button class="button ghost" id="history-button">历史变化</button>
          <button class="button ghost" id="detail-change-view-link">变化视图</button>
        `
      })}
      <section class="panel">
        <div class="section">
          <h2>当前 IP 质量</h2>
          ${currentResultMarkup}
        </div>

        <div class="section">
          <div class="section-head">
            <h2>最近变化</h2>
            <button class="button ghost" id="detail-history-link">查看完整历史</button>
          </div>
          ${recentChangeMarkup}
        </div>

        <details class="panel details-panel" data-node-report-config="true">
          <summary>节点上报设置</summary>
          <div class="section report-config">
            <div class="summary-section">
              <div class="summary-head">
                <strong>上报地址</strong>
                <button class="button ghost" id="copy-report-endpoint-button">复制</button>
              </div>
              <div class="code-block">${escapeHtml(reportEndpointURL)}</div>
            </div>
            ${
              composeReportEndpointURL
                ? `
                  <div class="summary-section">
                    <div class="summary-head">
                      <strong>容器网络地址</strong>
                      <button class="button ghost" id="copy-report-compose-endpoint-button">复制</button>
                    </div>
                    <div class="code-block">${escapeHtml(composeReportEndpointURL)}</div>
                  </div>
                `
                : ""
            }
            <div class="summary-section">
              <div class="summary-head">
                <strong>Reporter Token</strong>
                <div class="toolbar">
                  <button class="button ghost" id="copy-report-token-button">复制</button>
                  <button class="button ghost" id="rotate-report-token-button">重置 Token</button>
                </div>
              </div>
              <div class="code-block">${escapeHtml(detail.report_config.reporter_token)}</div>
            </div>
            <div class="summary-section">
              <div class="summary-head">
                <strong>请求示例</strong>
                <button class="button ghost" id="copy-report-example-button">复制</button>
              </div>
              <pre class="code-block">${escapeHtml(reportExample)}</pre>
            </div>
            <div class="toolbar">
              <button class="button danger" id="delete-button">移除接入</button>
            </div>
          </div>
        </details>
      </section>
    `
  );

  bindShellEvents();
  document.querySelector<HTMLButtonElement>("#history-button")?.addEventListener("click", () => {
    navigate(`/nodes/${encodeURIComponent(detail.komari_node_uuid)}/history`);
  });
  document.querySelector<HTMLButtonElement>("#detail-history-link")?.addEventListener("click", () => {
    navigate(`/nodes/${encodeURIComponent(detail.komari_node_uuid)}/history`);
  });
  document.querySelector<HTMLButtonElement>("#detail-change-view-link")?.addEventListener("click", () => {
    navigate(`/nodes/${encodeURIComponent(detail.komari_node_uuid)}/changes`);
  });
  document.querySelector<HTMLButtonElement>("#copy-report-endpoint-button")?.addEventListener("click", async () => {
    await copyText(reportEndpointURL);
    alert("上报地址已复制。");
  });
  document.querySelector<HTMLButtonElement>("#copy-report-compose-endpoint-button")?.addEventListener("click", async () => {
    if (!composeReportEndpointURL) {
      return;
    }
    await copyText(composeReportEndpointURL);
    alert("容器网络上报地址已复制。");
  });
  document.querySelector<HTMLButtonElement>("#copy-report-token-button")?.addEventListener("click", async () => {
    await copyText(detail.report_config.reporter_token);
    alert("Reporter Token 已复制。");
  });
  document.querySelector<HTMLButtonElement>("#copy-report-example-button")?.addEventListener("click", async () => {
    await copyText(reportExample);
    alert("上报示例已复制。");
  });
  document.querySelector<HTMLButtonElement>("#rotate-report-token-button")?.addEventListener("click", async () => {
    if (!confirm("重置后旧 Token 会立即失效。是否继续？")) {
      return;
    }
    await api(`/nodes/${detail.komari_node_uuid}/reporter-token/rotate`, { method: "POST" });
    await loadNode(detail.komari_node_uuid);
    renderNodeDetail(false);
    alert("Reporter Token 已重置。");
  });
  document.querySelector<HTMLButtonElement>("#delete-button")?.addEventListener("click", async () => {
    if (!confirm("只会从本服务移除该节点，不影响 Komari。是否继续？")) {
      return;
    }
    await api(`/nodes/${detail.komari_node_uuid}`, { method: "DELETE" });
    navigate("/nodes");
  });
}

function renderHistoryPage() {
  const detail = state.nodeDetail;
  if (!detail) {
    app.innerHTML = "<div class='shell'><div class='panel'>节点不存在。</div></div>";
    return;
  }

  const route = currentRoute();
  const selectedID = Number(route.query.get("record") ?? "");
  const selectedIndex = detail.history.findIndex((item) => item.id === selectedID);
  const resolvedIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedRecord = detail.history[resolvedIndex] ?? null;
  const previousRecord = resolvedIndex >= 0 ? detail.history[resolvedIndex + 1] ?? null : null;
  const selectedResult = selectedRecord ? parseResultJSON(selectedRecord.result_json) : {};
  const previousResult = previousRecord ? parseResultJSON(previousRecord.result_json) : undefined;
  const historyCompareGroups = previousRecord ? buildStructuredCompareGroups(selectedResult, previousResult) : [];
  const historyResult = renderHistoricalResult(selectedResult, previousResult);
  const compareSummary = previousRecord ? renderCompareOverview(historyResult.stats, "当前记录与上一条之间没有可对比字段。") : "";
  const historyChangeMarkup = previousRecord
    ? renderChangeGroupCards(historyCompareGroups, {
        dataAttr: "data-history-change-entry",
        emptyText: "当前记录相对上一条没有字段变化"
      })
    : `<div class="muted">这是首条历史记录，没有更早的基准可比较。</div>`;
  const historyCards = detail.history
    .map((item, index) => {
      const active = selectedRecord?.id === item.id;
      const baseline = detail.history[index + 1] ?? null;
      const stats = baseline
        ? buildStructuredCompareGroups(parseResultJSON(item.result_json), parseResultJSON(baseline.result_json)).reduce(
            (summary, group) => mergeCompareStats(summary, group.stats),
            emptyCompareStats()
          )
        : emptyCompareStats();
      const deltaText = baseline
        ? `变化 ${stats.changed} 项 / 新增 ${stats.added} 项 / 未变化 ${stats.unchanged} 项`
        : "首条记录，无上一条可比较";
      return `
        <button class="card history-card ${active ? "active" : ""}" data-history-record="${item.id}">
          <div class="section-head">
            <strong>${escapeHtml(item.summary || "无摘要")}</strong>
            <span class="chip">${formatDateTime(item.recorded_at)}</span>
          </div>
          <div class="muted">记录 ID: ${item.id}</div>
          <div class="muted">${escapeHtml(deltaText)}</div>
        </button>
      `;
    })
    .join("");

  app.innerHTML = appLayout(
    "nodes",
    `
      ${pageHeader({
        title: `${detail.name} 的历史变化`,
        subtitle: detail.history.length > 0 ? `共 ${detail.history.length} 条记录` : "当前还没有历史记录",
        backPath: `/nodes/${encodeURIComponent(detail.komari_node_uuid)}`,
        backLabel: "返回当前结果",
        actions: `<button class="button ghost" id="open-change-view-button">变化视图</button>`
      })}
      <section class="panel">
        <div class="section">
          <h2>历史记录</h2>
          <div class="list">
            ${historyCards || `<div class="card empty-state-card"><strong>暂无历史记录</strong><p class="muted">等待节点继续上报后，这里会出现历史变化。</p></div>`}
          </div>
        </div>

        <div class="section">
          <div class="section-head">
            <h2>选中记录</h2>
            ${selectedRecord ? `<span class="chip">${formatDateTime(selectedRecord.recorded_at)}</span>` : ""}
          </div>
          <div class="history-compare-meta">
            <div class="summary-section">
              <div class="summary-head">
                <strong>当前记录</strong>
                <span class="chip">${selectedRecord ? formatDateTime(selectedRecord.recorded_at) : "N/A"}</span>
              </div>
              <div class="muted">${escapeHtml(selectedRecord?.summary || "无摘要")}</div>
            </div>
            <div class="summary-section">
              <div class="summary-head">
                <strong>对比上一条</strong>
                <span class="chip">${previousRecord ? formatDateTime(previousRecord.recorded_at) : "N/A"}</span>
              </div>
              <div class="muted">${escapeHtml(previousRecord?.summary || "没有更早记录")}</div>
            </div>
          </div>
          <div class="summary-section" data-history-change-list="true">
            <div class="summary-head">
              <strong>变化内容</strong>
              <span class="chip">${previousRecord ? "相对上一条" : "无对比"}</span>
            </div>
            ${compareSummary}
            ${historyChangeMarkup}
          </div>
        </div>
      </section>
    `
  );

  bindShellEvents();
  document.querySelector<HTMLButtonElement>("#open-change-view-button")?.addEventListener("click", () => {
    const recordQuery = selectedRecord ? `?record=${encodeURIComponent(String(selectedRecord.id))}` : "";
    navigate(`/nodes/${encodeURIComponent(detail.komari_node_uuid)}/changes${recordQuery}`);
  });
  document.querySelector<HTMLButtonElement>("#back-to-node-button")?.addEventListener("click", () => {
    navigate(`/nodes/${encodeURIComponent(detail.komari_node_uuid)}`);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-history-record]").forEach((button) => {
    button.addEventListener("click", () => {
      const recordID = button.dataset.historyRecord;
      if (!recordID) {
        return;
      }
      navigate(`/nodes/${encodeURIComponent(detail.komari_node_uuid)}/history?record=${encodeURIComponent(recordID)}`);
    });
  });
}

function renderChangeViewPage() {
  const detail = state.nodeDetail;
  if (!detail) {
    app.innerHTML = "<div class='shell'><div class='panel'>节点不存在。</div></div>";
    return;
  }

  const route = currentRoute();
  const selectedID = Number(route.query.get("record") ?? "");
  const selectedIndex = detail.history.findIndex((item) => item.id === selectedID);
  const resolvedIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const baseSelectedRecord = detail.history[resolvedIndex] ?? null;
  const basePreviousRecord = resolvedIndex >= 0 ? detail.history[resolvedIndex + 1] ?? null : null;

  const recordSummaries: ChangeViewRecordSummary[] = detail.history.map((item, index) => {
    const baseline = detail.history[index + 1] ?? null;
    const summary = buildCompareRecordSummary(item, baseline);
    const filteredGroups = filterChangeGroups(summary.groups);
    const filteredStats = filteredGroups.reduce((stats, group) => mergeCompareStats(stats, group.stats), emptyCompareStats());
    const hasMeaningfulChange = filteredStats.changed > 0 || filteredStats.added > 0;
    return {
      item,
      baseline,
      summary,
      filteredGroups,
      filteredStats,
      hasMeaningfulChange
    };
  });

  const visibleRecordSummaries = recordSummaries.filter((record) => {
    if (state.changeViewFilters.changedOnly) {
      return record.hasMeaningfulChange;
    }
    return true;
  });
  const selectedRecordSummary = baseSelectedRecord
    ? recordSummaries.find((record) => record.item.id === baseSelectedRecord.id) ?? null
    : null;
  const selectedRecord = selectedRecordSummary?.item ?? baseSelectedRecord;
  const previousRecord = selectedRecordSummary?.baseline ?? basePreviousRecord;

  const compareSummary = selectedRecordSummary
    ? {
        stats: selectedRecordSummary.filteredStats,
        groups: selectedRecordSummary.filteredGroups,
        overviewMarkup: renderCompareOverview(
          selectedRecordSummary.filteredStats,
          "当前记录在筛选条件下没有可对比字段。"
        ),
        changeMarkup:
          selectedRecordSummary.filteredGroups.length > 0
            ? renderChangeGroupCards(selectedRecordSummary.filteredGroups, {
                dataAttr: "data-change-view-entry",
                emptyText: "当前记录在筛选条件下没有字段变化"
              })
            : `<div class="muted">当前记录在筛选条件下没有可展示变化。</div>`
      }
    : {
        stats: emptyCompareStats(),
        groups: [] as StructuredCompareGroup[],
        overviewMarkup: `<div class="muted">当前还没有历史记录，暂时无法查看变化。</div>`,
        changeMarkup: `<div class="muted">当前还没有历史记录，暂时无法查看变化。</div>`
      };

  const groupOptions = changeViewGroupOptions(
    recordSummaries.flatMap((record) => record.summary.groups)
  );

  const changeRecords = visibleRecordSummaries
    .map((record) => {
      const item = record.item;
      const baseline = record.baseline;
      const active = selectedRecord?.id === item.id;
      const statusText = baseline
        ? record.hasMeaningfulChange
          ? `变化 ${record.filteredStats.changed} 项 / 新增 ${record.filteredStats.added} 项`
          : "无重点变化"
        : "首条记录，无上一条可比较";

      return `
        <button class="card history-card ${active ? "active" : ""}" data-change-record="${item.id}">
          <div class="section-head">
            <strong>${escapeHtml(item.summary || "无摘要")}</strong>
            <span class="chip">${formatDateTime(item.recorded_at)}</span>
          </div>
          <div class="muted">${escapeHtml(statusText)}</div>
          <div class="compare-overview">
            <span class="summary-pill summary-pill-compare changed"><strong>变化</strong><span>${record.filteredStats.changed}</span></span>
            <span class="summary-pill summary-pill-compare added"><strong>新增</strong><span>${record.filteredStats.added}</span></span>
          </div>
        </button>
      `;
    })
    .join("");

  app.innerHTML = appLayout(
    "nodes",
    `
      ${pageHeader({
        title: `${detail.name} 的变化`,
        subtitle: "这里只看历史里发生了什么变化。",
        backPath: `/nodes/${encodeURIComponent(detail.komari_node_uuid)}`,
        backLabel: "返回当前结果",
        actions: `<button class="button ghost" id="change-view-history-button">历史记录</button>`
      })}
      <section class="panel" data-change-view="true">
        <div class="section">
          <div class="section-head">
            <h2>变化记录</h2>
            <span class="chip">${visibleRecordSummaries.length} 条</span>
          </div>
          <div class="change-filter-bar" data-change-view-filters="true">
            <label class="card change-filter">
              <span>只看重点变化</span>
              <input type="checkbox" id="change-filter-primary-only" ${state.changeViewFilters.primaryOnly ? "checked" : ""} />
            </label>
            <label class="card change-filter">
              <span>只看有变化记录</span>
              <input type="checkbox" id="change-filter-changed-only" ${state.changeViewFilters.changedOnly ? "checked" : ""} />
            </label>
            <label class="card change-filter change-filter-select">
              <span>分组筛选</span>
              <select class="input" id="change-filter-group">
                ${groupOptions
                  .map(
                    (option) =>
                      `<option value="${escapeHtml(option.value)}" ${option.value === state.changeViewFilters.group ? "selected" : ""}>${escapeHtml(option.label)}</option>`
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <div class="list">
            ${
              changeRecords ||
              `<div class="card empty-state-card" data-change-view-empty="true"><strong>当前没有可看的变化记录</strong><p class="muted">等下一次结果进入历史，或放宽筛选条件后再看。</p></div>`
            }
          </div>
        </div>

        <div class="section">
          <div class="section-head">
            <h2>本次变化</h2>
            ${selectedRecord ? `<span class="chip">${formatDateTime(selectedRecord.recorded_at)}</span>` : ""}
          </div>
          <div class="history-compare-meta">
            <div class="summary-section">
              <div class="summary-head">
                <strong>当前记录</strong>
                <span class="chip">${selectedRecord ? formatDateTime(selectedRecord.recorded_at) : "N/A"}</span>
              </div>
              <div class="muted">${escapeHtml(selectedRecord?.summary || "无摘要")}</div>
            </div>
            <div class="summary-section">
              <div class="summary-head">
                <strong>对比上一条</strong>
                <span class="chip">${previousRecord ? formatDateTime(previousRecord.recorded_at) : "N/A"}</span>
              </div>
              <div class="muted">${escapeHtml(previousRecord?.summary || "没有更早记录")}</div>
            </div>
          </div>
          <div class="summary-section" data-change-view-overview="true">
            <div class="summary-head">
              <strong>变化摘要</strong>
              <span class="chip">${previousRecord ? "相对上一条" : "无对比"}</span>
            </div>
            ${compareSummary.overviewMarkup}
          </div>
          <div class="summary-section" data-change-view-list="true">
            <div class="summary-head">
              <strong>变化明细</strong>
              <span class="chip">${previousRecord ? "字段级" : "无对比"}</span>
            </div>
            ${compareSummary.changeMarkup}
          </div>
        </div>
      </section>
    `
  );

  bindShellEvents();
  document.querySelector<HTMLButtonElement>("#change-view-history-button")?.addEventListener("click", () => {
    const recordQuery = selectedRecord ? `?record=${encodeURIComponent(String(selectedRecord.id))}` : "";
    navigate(`/nodes/${encodeURIComponent(detail.komari_node_uuid)}/history${recordQuery}`);
  });
  document.querySelector<HTMLButtonElement>("#change-view-node-button")?.addEventListener("click", () => {
    navigate(`/nodes/${encodeURIComponent(detail.komari_node_uuid)}`);
  });
  document.querySelector<HTMLInputElement>("#change-filter-primary-only")?.addEventListener("change", (event) => {
    state.changeViewFilters.primaryOnly = (event.target as HTMLInputElement).checked;
    renderChangeViewPage();
  });
  document.querySelector<HTMLInputElement>("#change-filter-changed-only")?.addEventListener("change", (event) => {
    state.changeViewFilters.changedOnly = (event.target as HTMLInputElement).checked;
    renderChangeViewPage();
  });
  document.querySelector<HTMLSelectElement>("#change-filter-group")?.addEventListener("change", (event) => {
    state.changeViewFilters.group = (event.target as HTMLSelectElement).value;
    renderChangeViewPage();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-change-record]").forEach((button) => {
    button.addEventListener("click", () => {
      const recordID = button.dataset.changeRecord;
      if (!recordID) {
        return;
      }
      navigate(`/nodes/${encodeURIComponent(detail.komari_node_uuid)}/changes?record=${encodeURIComponent(recordID)}`);
    });
  });
}

async function renderSettings() {
  const [runtime, loaderPreview, inlinePreview] = await Promise.all([
    api<{ app_name: string; app_env: string; base_path: string }>("/admin/runtime"),
    api<{ code: string }>("/admin/header-preview?variant=loader"),
    api<{ code: string }>("/admin/header-preview?variant=inline")
  ]);

  const hidden = new Set(state.displayFields.hidden_paths);
  const fieldGroups = groupDisplayFieldPaths(state.displayFieldPaths);
  const secondaryPaths = new Set(state.changePriority.secondary_paths);
  const priorityTargets = changePriorityTargets(state.displayFieldPaths, state.changePriority.secondary_paths);
  const fieldCards = fieldGroups
    .map((group) => {
      const checkedCount = group.paths.filter((path) => !hidden.has(path)).length;
      return `
        <div class="card field-group">
          <div class="section-head">
            <div>
              <h3>${escapeHtml(group.group)}</h3>
              <p class="muted">已开启 ${checkedCount} / ${group.paths.length}</p>
            </div>
            <div class="toolbar">
              <button class="button ghost" type="button" data-field-group-toggle="${escapeHtml(group.group)}" data-field-group-mode="check">全选</button>
              <button class="button ghost" type="button" data-field-group-toggle="${escapeHtml(group.group)}" data-field-group-mode="uncheck">全不选</button>
            </div>
          </div>
          <div class="list">
            ${group.paths
              .map(
                (path) => `
                  <label class="card field-toggle">
                    <span>${escapeHtml(path)}</span>
                    <input
                      type="checkbox"
                      data-field="${escapeHtml(path)}"
                      data-field-group="${escapeHtml(group.group)}"
                      ${hidden.has(path) ? "" : "checked"}
                    />
                  </label>`
              )
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");
  const priorityCards = priorityTargets
    .map((target) => {
      const entries = [target.rootPath, ...target.paths];
      const checkedCount = entries.filter((path) => secondaryPaths.has(path)).length;

      return `
        <div class="card field-group">
          <div class="section-head">
            <div>
              <h3>${escapeHtml(target.group)}</h3>
              <p class="muted">已设为辅助变化 ${checkedCount} / ${entries.length}</p>
            </div>
            <div class="toolbar">
              <button class="button ghost" type="button" data-change-priority-group-toggle="${escapeHtml(target.rootPath)}" data-change-priority-group-mode="check">本组全选</button>
              <button class="button ghost" type="button" data-change-priority-group-toggle="${escapeHtml(target.rootPath)}" data-change-priority-group-mode="uncheck">本组清空</button>
            </div>
          </div>
          <div class="list">
            <label class="card field-toggle">
              <span>整个 ${escapeHtml(target.group)} 分组</span>
              <input
                type="checkbox"
                data-change-priority-path="${escapeHtml(target.rootPath)}"
                data-change-priority-group="${escapeHtml(target.rootPath)}"
                ${secondaryPaths.has(target.rootPath) ? "checked" : ""}
              />
            </label>
            ${
              target.paths.length > 0
                ? `
                  <div class="list priority-sublist">
                    ${target.paths
                      .map(
                        (path) => `
                          <label class="card field-toggle">
                            <span>${escapeHtml(path)}</span>
                            <input
                              type="checkbox"
                              data-change-priority-path="${escapeHtml(path)}"
                              data-change-priority-group="${escapeHtml(target.rootPath)}"
                              ${secondaryPaths.has(path) ? "checked" : ""}
                            />
                          </label>
                        `
                      )
                      .join("")}
                  </div>
                `
                : `<div class="muted">当前分组下还没有更细的字段路径可单独配置。</div>`
            }
          </div>
        </div>
      `;
    })
    .join("");

  app.innerHTML = appLayout(
    "settings",
    `
      ${pageHeader({
        title: "接入配置",
        subtitle: "复制 Header 到 Komari"
      })}
      <section class="panel">
        <div class="section">
          <div class="section-head">
            <h2>接入 Komari</h2>
            <span class="chip">推荐 loader 版</span>
          </div>
          <div class="grid">
            <div class="card">
              <h3>1. 复制 Header</h3>
              <p class="muted">推荐使用 loader 版，后续更新通常不用重新复制。</p>
              <div class="toolbar">
                <button class="button" id="copy-loader-button">复制 loader 版</button>
                <button class="button ghost" id="copy-inline-button">复制完整内联版</button>
              </div>
            </div>
            <div class="card">
              <h3>2. 填到 Komari</h3>
              <p class="muted">填入自定义 Header 后，进入节点详情页即可看到 IP 质量入口。</p>
              <div class="chip-row">
                <span class="chip">${escapeHtml(runtime.app_env)}</span>
                <span class="chip">${escapeHtml(runtime.base_path)}</span>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="section-head">
              <h3>loader 版代码</h3>
              <button class="button ghost" id="copy-loader-inline-button">再次复制</button>
            </div>
            <pre class="code-block">${escapeHtml(loaderPreview.code)}</pre>
          </div>
        </div>

        <details class="panel details-panel">
          <summary>更多设置</summary>
          <div class="section">
            <h2>完整内联版</h2>
            <p class="muted">只有在你明确不想依赖 loader 时再用它。后续逻辑更新后需要重新复制。</p>
            <pre class="code-block">${escapeHtml(inlinePreview.code)}</pre>
          </div>

          <div class="section">
            <h2>展示字段</h2>
            <div class="list">${fieldCards || `<div class="card"><strong>还没有可配置字段</strong><p class="muted">先让节点产生一份检测结果，这里才会出现字段路径。</p></div>`}</div>
            <button class="button" id="save-fields-button">保存字段配置</button>
          </div>

          <div class="section">
            <h2>变化优先级规则</h2>
            <div class="summary-section">
              <div class="summary-head">
                <strong>当前规则</strong>
                <span class="chip">全局生效</span>
              </div>
              <div class="muted">${escapeHtml(changePrioritySummary())}</div>
            </div>
            <div class="list">${priorityCards || `<div class="card"><strong>还没有可配置路径</strong><p class="muted">先让节点产生一份检测结果，这里才会出现分组和字段路径。</p></div>`}</div>
            <div class="toolbar">
              <button class="button ghost" type="button" id="change-priority-default-button">恢复默认规则</button>
              <button class="button" id="save-change-priority-button">保存变化规则</button>
            </div>
          </div>

          <div class="section">
            <h2>管理员设置</h2>
            <label>新用户名<input class="input" id="profile-username" value="${escapeHtml(state.me?.username ?? "admin")}" /></label>
            <label>新密码<input class="input" id="profile-password" type="password" placeholder="留空表示不修改密码" /></label>
            <button class="button" id="profile-save-button">保存并重新登录</button>
          </div>
        </details>
      </section>
    `
  );

  bindShellEvents();
  document.querySelectorAll<HTMLButtonElement>("[data-field-group-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.dataset.fieldGroupToggle ?? "";
      const mode = button.dataset.fieldGroupMode ?? "check";
      document
        .querySelectorAll<HTMLInputElement>(`[data-field-group="${group}"]`)
        .forEach((input) => {
          input.checked = mode === "check";
        });
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-change-priority-group-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.dataset.changePriorityGroupToggle ?? "";
      const mode = button.dataset.changePriorityGroupMode ?? "check";
      document
        .querySelectorAll<HTMLInputElement>(`[data-change-priority-group="${group}"]`)
        .forEach((input) => {
          input.checked = mode === "check";
        });
    });
  });

  document.querySelector<HTMLButtonElement>("#save-fields-button")?.addEventListener("click", async () => {
    const hiddenPaths = Array.from(document.querySelectorAll<HTMLInputElement>("[data-field]"))
      .filter((input) => !input.checked)
      .map((input) => input.dataset.field ?? "")
      .filter(Boolean);
    await saveDisplayFields(hiddenPaths);
    alert("字段配置已保存。");
  });

  document.querySelector<HTMLButtonElement>("#change-priority-default-button")?.addEventListener("click", () => {
    document.querySelectorAll<HTMLInputElement>("[data-change-priority-path]").forEach((input) => {
      input.checked = input.dataset.changePriorityPath === "Meta";
    });
  });

  document.querySelector<HTMLButtonElement>("#save-change-priority-button")?.addEventListener("click", async () => {
    const secondaryPaths = Array.from(document.querySelectorAll<HTMLInputElement>("[data-change-priority-path]"))
      .filter((input) => input.checked)
      .map((input) => input.dataset.changePriorityPath ?? "")
      .filter(Boolean);
    await saveChangePriority(secondaryPaths);
    await renderSettings();
    alert("变化规则已保存。");
  });

  document.querySelector<HTMLButtonElement>("#copy-loader-button")?.addEventListener("click", async () => {
    await copyText(loaderPreview.code);
    alert("短 loader 版代码已复制。");
  });
  document.querySelector<HTMLButtonElement>("#copy-loader-inline-button")?.addEventListener("click", async () => {
    await copyText(loaderPreview.code);
    alert("短 loader 版代码已复制。");
  });

  document.querySelector<HTMLButtonElement>("#copy-inline-button")?.addEventListener("click", async () => {
    await copyText(inlinePreview.code);
    alert("完整内联版代码已复制。");
  });

  document.querySelector<HTMLButtonElement>("#profile-save-button")?.addEventListener("click", async () => {
    const username = document.querySelector<HTMLInputElement>("#profile-username")?.value.trim() ?? "";
    const password = document.querySelector<HTMLInputElement>("#profile-password")?.value ?? "";
    await api("/admin/profile", {
      method: "PUT",
      body: JSON.stringify({ username, password })
    });
    navigate("/login");
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function boot() {
  await loadMe();
  if (!state.me?.logged_in) {
    renderLogin();
    return;
  }

  const route = currentRoute();
  const path = route.path;
  if (path === "/settings") {
    await Promise.all([loadDisplayFields(), loadDisplayFieldPaths(), loadChangePriority()]);
    await renderSettings();
    return;
  }

  if (/^\/nodes\/[^/]+\/history$/.test(path)) {
    const uuid = path.replace(/^\/nodes\/([^/]+)\/history$/, "$1");
    await Promise.all([loadNode(decodeURIComponent(uuid)), loadDisplayFields(), loadChangePriority()]);
    renderHistoryPage();
    return;
  }

  if (/^\/nodes\/[^/]+\/changes$/.test(path)) {
    const uuid = path.replace(/^\/nodes\/([^/]+)\/changes$/, "$1");
    await Promise.all([loadNode(decodeURIComponent(uuid)), loadDisplayFields(), loadChangePriority()]);
    renderChangeViewPage();
    return;
  }

  if (path.startsWith("/nodes/")) {
    const uuid = path.replace("/nodes/", "");
    await Promise.all([loadNode(decodeURIComponent(uuid)), loadDisplayFields(), loadChangePriority()]);
    renderNodeDetail(route.query.get("embed") === "1");
    return;
  }

  await Promise.all([loadNodes(), loadDisplayFields()]);
  renderNodes();
}

void boot();
