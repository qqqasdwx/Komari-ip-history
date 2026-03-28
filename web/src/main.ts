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
    <div class="shell">
      <div class="hero">
        <div class="chip-row">
          <span class="chip">Komari IP Quality</span>
          <span class="chip">Admin Only</span>
        </div>
        <h1>登录你的管理面板</h1>
        <p>系统配置、字段开关、节点列表和 header 生成都只在这里管理，不嵌入 Komari 后台。</p>
      </div>
      <div class="panel">
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
    <aside class="sidebar">
      <h2>Komari IP Quality</h2>
      <p class="muted">轻量后台用于配置展示字段、生成 header 并查看已接入节点。</p>
      <div class="nav">
        <button class="${active === "nodes" ? "active" : ""}" data-nav="/nodes">节点列表</button>
        <button class="${active === "settings" ? "active" : ""}" data-nav="/settings">系统配置</button>
      </div>
      <div class="chip-row" style="margin-top:16px;">
        <span class="chip">模式: ${state.me?.app_env ?? "unknown"}</span>
        <span class="chip">路径: ${state.me?.base_path ?? basePath}</span>
      </div>
      <button class="button ghost" id="logout-button" style="margin-top:18px;">退出登录</button>
    </aside>
  `;
}

function bindShellEvents() {
  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.nav ?? "/nodes"));
  });

  document.querySelector<HTMLButtonElement>("#logout-button")?.addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST" });
    navigate("/login");
  });
}

function renderNodes() {
  const cards = state.nodes
    .map(
      (item) => `
        <a class="card row-link" href="#/nodes/${item.komari_node_uuid}">
          <div class="section-head">
            <h3>${escapeHtml(item.name)}</h3>
            <span class="status ${item.has_data ? "ok" : "empty"}">${item.has_data ? "有数据" : "无数据"}</span>
          </div>
          <div class="muted">${escapeHtml(item.komari_node_uuid)}</div>
          <div>${escapeHtml(item.current_summary || "N/A")}</div>
          ${renderNodeListSummary(item)}
          <div class="muted">最近更新时间: ${formatDateTime(item.updated_at)}</div>
        </a>`
    )
    .join("");

  app.innerHTML = `
    <div class="shell">
      <div class="hero">
        <div class="chip-row">
          <span class="chip">已接入节点</span>
          <span class="chip">只显示从 Komari 主动添加过的节点</span>
        </div>
        <h1>节点列表</h1>
        <p>节点列表按最近更新时间倒序排列，无数据节点会排在有结果节点之后。</p>
      </div>
      <div class="layout">
        ${sidebar("nodes")}
        <section class="panel">
          <div class="section-head">
            <h2>已接入节点</h2>
            <div class="toolbar">
              <input class="input" style="min-width:260px;" id="node-search" placeholder="搜索节点名称或 UUID" value="${escapeHtml(state.search)}" />
              <button class="button ghost" id="node-search-button">搜索</button>
            </div>
          </div>
          <div class="grid">${cards || `<div class="card"><h3>暂无节点</h3><p class="muted">请先从 Komari 节点详情页点击“添加 IP 质量检测”。</p></div>`}</div>
        </section>
      </div>
    </div>
  `;

  bindShellEvents();
  document.querySelector<HTMLButtonElement>("#node-search-button")?.addEventListener("click", async () => {
    state.search = document.querySelector<HTMLInputElement>("#node-search")?.value.trim() ?? "";
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

  return ["Meta", "Score", "Media", "Mail", "其他字段"]
    .map((group) => ({
      group,
      paths: (grouped.get(group) ?? []).sort((left, right) => left.localeCompare(right))
    }))
    .filter((item) => item.paths.length > 0);
}

function changePriorityTargets(paths: string[], secondaryPaths: string[]) {
  const preferred = ["Meta", "Score", "Media", "Mail"];
  const roots = new Set<string>(preferred);

  for (const path of paths) {
    const root = path.split(".")[0]?.trim();
    if (root) {
      roots.add(root);
    }
  }

  for (const path of secondaryPaths) {
    const root = path.split(".")[0]?.trim();
    if (root) {
      roots.add(root);
    }
  }

  return Array.from(roots).sort((left, right) => {
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
  });
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

function renderScoreGrid(score: Record<string, unknown>) {
  const entries = Object.entries(score);
  if (entries.length === 0) {
    return `<div class="muted">N/A</div>`;
  }

  return `
    <div class="metric-grid">
      ${entries
        .map(([key, value]) => {
          if (isRecord(value)) {
            return `
              <div class="card metric-card metric-card-rich">
                <div class="metric-label">${escapeHtml(titleize(key))}</div>
                ${renderRecordRows(value)}
              </div>
            `;
          }

          return `
            <div class="card metric-card">
              <div class="metric-label">${escapeHtml(titleize(key))}</div>
              <div class="metric-value">${escapeHtml(formatDisplayValue(value))}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderMediaGrid(media: Record<string, unknown>) {
  const entries = Object.entries(media);
  if (entries.length === 0) {
    return `<div class="muted">N/A</div>`;
  }

  return `
    <div class="detail-grid">
      ${entries
        .map(([key, value]) => {
          if (isRecord(value)) {
            return `
              <div class="card detail-card">
                <div class="section-head">
                  <h3>${escapeHtml(titleize(key))}</h3>
                </div>
                ${renderRecordRows(value)}
              </div>
            `;
          }

          return `
            <div class="card detail-card">
              <div class="section-head">
                <h3>${escapeHtml(titleize(key))}</h3>
              </div>
              <div>${escapeHtml(formatDisplayValue(value))}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
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

  const sections: string[] = [];
  if (!isEmptyRecord(structured.meta)) {
    sections.push(`
      <div class="result-group">
        <div class="section-head">
          <h3>Meta</h3>
          <span class="chip">基础信息</span>
        </div>
        ${renderRecordRows(structured.meta)}
      </div>
    `);
  }

  if (!isEmptyRecord(structured.score)) {
    sections.push(`
      <div class="result-group">
        <div class="section-head">
          <h3>Score</h3>
          <span class="chip">风险分项</span>
        </div>
        ${renderScoreGrid(structured.score)}
      </div>
    `);
  }

  if (!isEmptyRecord(structured.media)) {
    sections.push(`
      <div class="result-group">
        <div class="section-head">
          <h3>Media</h3>
          <span class="chip">流媒体与服务</span>
        </div>
        ${renderMediaGrid(structured.media)}
      </div>
    `);
  }

  if (!isEmptyRecord(structured.mail)) {
    sections.push(`
      <div class="result-group">
        <div class="section-head">
          <h3>Mail</h3>
          <span class="chip">邮件能力</span>
        </div>
        ${renderRecordRows(structured.mail)}
      </div>
    `);
  }

  if (!isEmptyRecord(structured.remainder)) {
    sections.push(`
      <div class="result-group">
        <div class="section-head">
          <h3>其他字段</h3>
          <span class="chip">JSON 兜底</span>
        </div>
        <pre class="code-block">${escapeHtml(JSON.stringify(structured.remainder, null, 2))}</pre>
      </div>
    `);
  }

  return `<div class="result-layout">${sections.join("")}</div>`;
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

  pushRecordSection("Meta", "基础信息", structured.meta, previousStructured?.meta);

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
          <h3>其他字段</h3>
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
        <div class="summary-section">
          <div class="summary-head">
            <strong>风险概览</strong>
            <span class="chip">N/A</span>
          </div>
          <div class="muted">等待首份检测结果</div>
        </div>
        <div class="summary-section">
          <div class="summary-head">
            <strong>媒体能力</strong>
            <span class="chip">N/A</span>
          </div>
          <div class="muted">尚未获取服务可用性</div>
        </div>
        <div class="summary-section">
          <div class="summary-head">
            <strong>邮件能力</strong>
            <span class="chip">N/A</span>
          </div>
          <div class="muted">尚未获取邮件相关结果</div>
        </div>
      </div>
    `;
  }

  const scoreEntries = Object.entries(structured.score ?? {}).map(([key, value]) => ({
    label: compactLabel(key),
    value: formatDisplayValue(value)
  }));

  const mediaEntries = Object.entries(structured.media ?? {})
    .map(([key, value]) => {
      if (!isRecord(value)) {
        return {
          label: compactLabel(key),
          value: formatDisplayValue(value)
        };
      }

      const parts = [value.Status, value.Region, value.Type]
        .filter((part) => part !== undefined && part !== null && part !== "")
        .map((part) => formatDisplayValue(part));

      return {
        label: compactLabel(key),
        value: parts.join(" / ") || "N/A"
      };
    })
    .filter((entry) => entry.value !== "N/A");

  const mailEntries = Object.entries(structured.mail ?? {}).map(([key, value]) => ({
    label: compactLabel(key),
    value: formatDisplayValue(value)
  }));

  return `
    <div class="list-summary" data-node-summary="structured">
      <div class="summary-section">
        <div class="summary-head">
          <strong>风险概览</strong>
          <span class="chip">${scoreEntries.length > 0 ? `${scoreEntries.length} 项` : "N/A"}</span>
        </div>
        ${renderSummaryPills(scoreEntries, "没有可展示的风险分项")}
      </div>
      <div class="summary-section">
        <div class="summary-head">
          <strong>媒体能力</strong>
          <span class="chip">${mediaEntries.length > 0 ? `${mediaEntries.length} 项` : "N/A"}</span>
        </div>
        ${renderSummaryPills(mediaEntries, "没有可展示的媒体能力")}
      </div>
      <div class="summary-section">
        <div class="summary-head">
          <strong>邮件能力</strong>
          <span class="chip">${mailEntries.length > 0 ? `${mailEntries.length} 项` : "N/A"}</span>
        </div>
        ${renderSummaryPills(mailEntries, "没有可展示的邮件能力")}
      </div>
    </div>
  `;
}

function buildStructuredCompareGroups(currentResult: Record<string, unknown>, previousResult?: Record<string, unknown>) {
  const structured = getFilteredCurrentResult(currentResult);
  const previousStructured = previousResult ? getFilteredCurrentResult(previousResult) : null;
  if (!structured) {
    return [] as StructuredCompareGroup[];
  }

  return [
    { key: "Meta", title: "Meta", chip: "基础信息", current: structured.meta, previous: previousStructured?.meta },
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
  const groups = buildStructuredCompareGroups(latestResult, previousResult);
  const totalStats = groups.reduce((stats, group) => mergeCompareStats(stats, group.stats), emptyCompareStats());

  return `
    <div class="summary-section" data-detail-change="overview">
      <div class="summary-head">
        <strong>最近变化</strong>
        <span class="chip">相对上一条历史</span>
      </div>
      <div class="muted">当前记录: ${formatDateTime(latestRecord.recorded_at)}，对比基准: ${formatDateTime(previousRecord.recorded_at)}</div>
      ${renderCompareOverview(totalStats, "最近一次与上一条之间没有可比较字段。")}
      <div class="muted">${escapeHtml(changePrioritySummary())}</div>
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
          <div class="section">
            <div class="chip-row">
              <span class="chip">Komari 内弹窗视图</span>
              <span class="chip">当前状态总览</span>
            </div>
            <h2>${escapeHtml(detail.name)}</h2>
            <p class="muted">注入端只负责弹层承载，详细展示仍由本服务页面输出。</p>
            <div class="kv">
              <div class="kv-row"><strong>UUID</strong><span title="${escapeHtml(detail.komari_node_uuid)}">${escapeHtml(truncate(detail.komari_node_uuid))}</span></div>
              <div class="kv-row"><strong>状态</strong><span class="status ${detail.has_data ? "ok" : "empty"}">${detail.has_data ? "有数据" : "无数据"}</span></div>
              <div class="kv-row"><strong>状态摘要</strong><span>${escapeHtml(detail.current_summary || "N/A")}</span></div>
              <div class="kv-row"><strong>最近更新时间</strong><span>${formatDateTime(detail.updated_at)}</span></div>
            </div>
          </div>
          <div class="section">
            <div class="section-head">
              <h2>当前状态</h2>
              <div class="toolbar">
                <a class="button ghost" href="${basePath}/#/nodes/${encodeURIComponent(detail.komari_node_uuid)}/history" target="_blank" rel="noopener noreferrer">查看历史</a>
                <a class="button ghost" href="${basePath}/#/nodes/${encodeURIComponent(detail.komari_node_uuid)}" target="_blank" rel="noopener noreferrer">打开完整页面</a>
              </div>
            </div>
            ${currentResultMarkup}
          </div>
        </section>
      </div>
    `;
    return;
  }

  app.innerHTML = `
    <div class="shell">
      <div class="hero">
        <div class="chip-row">
          <span class="chip">当前状态总览</span>
          <span class="chip">历史页已接入</span>
          <span class="chip">节点接入区域已预留</span>
        </div>
        <h1>${escapeHtml(detail.name)}</h1>
        <p>阶段 1 共用的当前状态核心视图会同时服务于独立前端节点详情页和 Komari 内弹窗。</p>
      </div>
      <div class="layout">
        ${sidebar("nodes")}
        <section class="panel">
          <div class="section">
            <div class="section-head">
              <h2>节点总览</h2>
              <div class="toolbar">
                <button class="button ghost" id="history-button">查看历史</button>
                <button class="button danger" id="delete-button">移除接入</button>
              </div>
            </div>
            <div class="kv">
              <div class="kv-row"><strong>节点名称</strong><span>${escapeHtml(detail.name)}</span></div>
              <div class="kv-row"><strong>UUID</strong><span title="${escapeHtml(detail.komari_node_uuid)}">${escapeHtml(truncate(detail.komari_node_uuid))}</span></div>
              <div class="kv-row"><strong>状态</strong><span class="status ${detail.has_data ? "ok" : "empty"}">${detail.has_data ? "有数据" : "无数据"}</span></div>
              <div class="kv-row"><strong>状态摘要</strong><span>${escapeHtml(detail.current_summary || "N/A")}</span></div>
              <div class="kv-row"><strong>最近更新时间</strong><span>${formatDateTime(detail.updated_at)}</span></div>
            </div>
          </div>

          <div class="section">
            <h2>当前状态</h2>
            <p class="muted">此区域为只读视图，展示内容由系统配置页中的全局字段开关控制。</p>
            ${currentResultMarkup}
          </div>

          <div class="section">
            <div class="section-head">
              <h2>最近变化</h2>
              <div class="toolbar">
                <button class="button ghost" id="detail-change-view-link">查看变化视图</button>
                <button class="button ghost" id="detail-history-link">查看完整对比</button>
              </div>
            </div>
            <p class="muted">这里展示最近一次历史记录相对上一条的变化摘要，完整差异请进入历史页查看。</p>
            ${recentChangeMarkup}
          </div>

          <div class="section">
            <h2>历史入口</h2>
            <p class="muted">历史页已接入，阶段 1 采用时间倒序轻量列表和 JSON 兜底详情。</p>
          </div>

          <div class="section">
            <h2>节点接入配置</h2>
            <p class="muted">使用每节点独立 token 调用上报接口。本页提供地址、token 和基础请求示例。</p>
            <div class="report-config" data-node-report-config="true">
              <div class="summary-section">
                <div class="summary-head">
                  <strong>浏览器当前地址</strong>
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
                      <div class="muted">开发环境下，如果上报脚本运行在 compose 网络内，优先使用这个地址。</div>
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
                <div class="muted">认证头使用 <code>X-IPQ-Reporter-Token</code>，也兼容 <code>Authorization: Bearer ...</code>。</div>
              </div>
              <div class="summary-section">
                <div class="summary-head">
                  <strong>请求示例</strong>
                  <button class="button ghost" id="copy-report-example-button">复制</button>
                </div>
                <pre class="code-block">${escapeHtml(reportExample)}</pre>
                <div class="muted">请求体至少需要 <code>result</code>，<code>summary</code> 和 <code>recorded_at</code> 为可选字段。</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

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
  const compareSummary = previousRecord
    ? renderCompareOverview(historyResult.stats, "当前记录与上一条之间没有可对比字段。")
    : `<div class="muted">这是首条历史记录，没有更早的基准可比较。</div>`;
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

  app.innerHTML = `
    <div class="shell">
      <div class="hero">
        <div class="chip-row">
          <span class="chip">历史记录</span>
          <span class="chip">结构化对比</span>
          <span class="chip">上一条比较</span>
        </div>
        <h1>${escapeHtml(detail.name)} 的历史</h1>
        <p>历史页当前按时间倒序查看单条记录，并与上一条历史结果做字段级比较，先不引入复杂图表。</p>
      </div>
      <div class="layout">
        ${sidebar("nodes")}
        <section class="panel">
          <div class="section">
            <div class="section-head">
              <h2>节点信息</h2>
              <div class="toolbar">
                <button class="button ghost" id="open-change-view-button">查看变化视图</button>
                <button class="button ghost" id="back-to-node-button">返回节点详情</button>
              </div>
            </div>
            <div class="kv">
              <div class="kv-row"><strong>节点名称</strong><span>${escapeHtml(detail.name)}</span></div>
              <div class="kv-row"><strong>UUID</strong><span title="${escapeHtml(detail.komari_node_uuid)}">${escapeHtml(truncate(detail.komari_node_uuid))}</span></div>
              <div class="kv-row"><strong>当前状态摘要</strong><span>${escapeHtml(detail.current_summary || "N/A")}</span></div>
              <div class="kv-row"><strong>历史条数</strong><span>${detail.history.length}</span></div>
            </div>
          </div>

          <div class="section">
            <h2>历史列表</h2>
            <div class="list">
              ${historyCards || `<div class="card"><strong>暂无历史</strong><p class="muted">阶段 1 历史结构已就位，但当前节点还没有沉淀历史记录。</p></div>`}
            </div>
          </div>

          <div class="section">
            <div class="section-head">
              <h2>历史详情</h2>
              ${selectedRecord ? `<span class="chip">记录时间: ${formatDateTime(selectedRecord.recorded_at)}</span>` : ""}
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
                  <strong>对比基准</strong>
                  <span class="chip">${previousRecord ? formatDateTime(previousRecord.recorded_at) : "N/A"}</span>
                </div>
                <div class="muted">${escapeHtml(previousRecord?.summary || "没有更早记录")}</div>
              </div>
            </div>
            <div class="summary-section" data-history-compare="overview">
              <div class="summary-head">
                <strong>变化摘要</strong>
                <span class="chip">${previousRecord ? "相对上一条" : "无对比"}</span>
              </div>
              ${compareSummary}
            </div>
            <div class="summary-section" data-history-change-list="true">
              <div class="summary-head">
                <strong>变化明细</strong>
                <span class="chip">${previousRecord ? "字段级" : "无对比"}</span>
              </div>
              <div class="muted">${escapeHtml(changePrioritySummary())}</div>
              ${historyChangeMarkup}
            </div>
            <div data-history-structured="true">${historyResult.markup}</div>
            <details class="raw-json">
              <summary>查看原始 JSON</summary>
              <pre class="code-block">${escapeHtml(selectedRecord?.result_json || "N/A")}</pre>
            </details>
          </div>
        </section>
      </div>
    </div>
  `;

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
  const selectedRecord = detail.history[resolvedIndex] ?? null;
  const previousRecord = resolvedIndex >= 0 ? detail.history[resolvedIndex + 1] ?? null : null;

  const compareSummary = selectedRecord
    ? buildCompareRecordSummary(selectedRecord, previousRecord)
    : {
        stats: emptyCompareStats(),
        groups: [] as StructuredCompareGroup[],
        overviewMarkup: `<div class="muted">当前还没有历史记录，暂时无法查看变化。</div>`,
        changeMarkup: `<div class="muted">当前还没有历史记录，暂时无法查看变化。</div>`
      };

  const changeRecords = detail.history
    .map((item, index) => {
      const baseline = detail.history[index + 1] ?? null;
      const summary = buildCompareRecordSummary(item, baseline);
      const active = selectedRecord?.id === item.id;
      const hasMeaningfulChange = summary.stats.changed > 0 || summary.stats.added > 0;
      const statusText = baseline
        ? hasMeaningfulChange
          ? `变化 ${summary.stats.changed} 项 / 新增 ${summary.stats.added} 项`
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
            <span class="summary-pill summary-pill-compare changed"><strong>变化</strong><span>${summary.stats.changed}</span></span>
            <span class="summary-pill summary-pill-compare added"><strong>新增</strong><span>${summary.stats.added}</span></span>
          </div>
        </button>
      `;
    })
    .join("");

  app.innerHTML = `
    <div class="shell">
      <div class="hero">
        <div class="chip-row">
          <span class="chip">变化视图</span>
          <span class="chip">只看变化</span>
          <span class="chip">字段级明细</span>
        </div>
        <h1>${escapeHtml(detail.name)} 的变化</h1>
        <p>此视图只聚焦“发生了什么变化”，默认弱化完整结果展示，便于快速判断最近一次或某次上报是否值得关注。</p>
      </div>
      <div class="layout">
        ${sidebar("nodes")}
        <section class="panel" data-change-view="true">
          <div class="section">
            <div class="section-head">
              <h2>节点信息</h2>
              <div class="toolbar">
                <button class="button ghost" id="change-view-history-button">查看历史页</button>
                <button class="button ghost" id="change-view-node-button">返回节点详情</button>
              </div>
            </div>
            <div class="kv">
              <div class="kv-row"><strong>节点名称</strong><span>${escapeHtml(detail.name)}</span></div>
              <div class="kv-row"><strong>UUID</strong><span title="${escapeHtml(detail.komari_node_uuid)}">${escapeHtml(truncate(detail.komari_node_uuid))}</span></div>
              <div class="kv-row"><strong>当前摘要</strong><span>${escapeHtml(detail.current_summary || "N/A")}</span></div>
              <div class="kv-row"><strong>历史条数</strong><span>${detail.history.length}</span></div>
            </div>
          </div>

          <div class="section">
            <div class="section-head">
              <h2>变化记录</h2>
              <span class="chip">时间倒序</span>
            </div>
            <div class="list">
              ${changeRecords || `<div class="card"><strong>暂无变化记录</strong><p class="muted">节点还没有历史记录，暂时无法进入变化视图。</p></div>`}
            </div>
          </div>

          <div class="section">
            <div class="section-head">
              <h2>本次变化</h2>
              ${selectedRecord ? `<span class="chip">记录时间: ${formatDateTime(selectedRecord.recorded_at)}</span>` : ""}
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
                  <strong>对比基准</strong>
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
              <div class="muted">${escapeHtml(changePrioritySummary())}</div>
              ${compareSummary.changeMarkup}
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

  bindShellEvents();
  document.querySelector<HTMLButtonElement>("#change-view-history-button")?.addEventListener("click", () => {
    const recordQuery = selectedRecord ? `?record=${encodeURIComponent(String(selectedRecord.id))}` : "";
    navigate(`/nodes/${encodeURIComponent(detail.komari_node_uuid)}/history${recordQuery}`);
  });
  document.querySelector<HTMLButtonElement>("#change-view-node-button")?.addEventListener("click", () => {
    navigate(`/nodes/${encodeURIComponent(detail.komari_node_uuid)}`);
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
    .map(
      (path) => `
        <label class="card field-toggle">
          <span>${escapeHtml(path)}</span>
          <input
            type="checkbox"
            data-change-priority-path="${escapeHtml(path)}"
            ${secondaryPaths.has(path) ? "checked" : ""}
          />
        </label>
      `
    )
    .join("");

  app.innerHTML = `
    <div class="shell">
      <div class="hero">
        <div class="chip-row">
          <span class="chip">系统配置</span>
          <span class="chip">模式只读</span>
          <span class="chip">字段开关全局生效</span>
        </div>
        <h1>系统配置</h1>
        <p>此处管理 header 生成、模式信息、全局展示字段开关以及管理员账号信息。</p>
      </div>
      <div class="layout">
        ${sidebar("settings")}
        <section class="panel">
          <div class="section">
            <h2>运行模式</h2>
            <div class="kv">
              <div class="kv-row"><strong>应用名</strong><span>${escapeHtml(runtime.app_name)}</span></div>
              <div class="kv-row"><strong>模式</strong><span>${escapeHtml(runtime.app_env)}</span></div>
              <div class="kv-row"><strong>路径前缀</strong><span>${escapeHtml(runtime.base_path)}</span></div>
            </div>
          </div>

          <div class="section">
            <div class="section-head">
              <h2>Header 生成</h2>
              <span class="chip">短 loader 版推荐</span>
            </div>
            <div class="card">
              <div class="section-head">
                <h3>短 loader 版</h3>
                <button class="button ghost" id="copy-loader-button">复制代码</button>
              </div>
              <p class="muted">推荐方案。后续更新不需要重新复制。</p>
              <pre class="code-block">${escapeHtml(loaderPreview.code)}</pre>
            </div>
            <div class="card">
              <div class="section-head">
                <h3>完整内联版</h3>
                <button class="button ghost" id="copy-inline-button">复制代码</button>
              </div>
              <p class="muted">静态快照导出。后续逻辑更新后需要重新复制。</p>
              <pre class="code-block">${escapeHtml(inlinePreview.code)}</pre>
            </div>
          </div>

          <div class="section">
            <h2>全局展示字段开关</h2>
            <p class="muted">阶段 1 按字段路径保存显示/隐藏。新字段默认显示，之后可手动关闭。</p>
            <div class="list">${fieldCards || `<div class="card"><strong>还没有可配置字段</strong><p class="muted">先从 Komari 接入一个节点，并让它拥有一份当前结果后，这里会自动出现字段路径。</p></div>`}</div>
            <button class="button" id="save-fields-button">保存字段配置</button>
          </div>

          <div class="section">
            <h2>变化优先级规则</h2>
            <p class="muted">勾选后，该路径会被归类为“辅助变化”；未勾选的路径默认按“重点变化”处理。</p>
            <div class="summary-section">
              <div class="summary-head">
                <strong>当前规则</strong>
                <span class="chip">全局生效</span>
              </div>
              <div class="muted">${escapeHtml(changePrioritySummary())}</div>
            </div>
            <div class="list">${priorityCards || `<div class="card"><strong>还没有可配置分组</strong><p class="muted">先让节点产生一份检测结果，这里会自动出现可配置路径。</p></div>`}</div>
            <div class="toolbar">
              <button class="button ghost" type="button" id="change-priority-default-button">恢复默认规则</button>
              <button class="button" id="save-change-priority-button">保存变化规则</button>
            </div>
          </div>

          <div class="section">
            <h2>管理员账号</h2>
            <p class="muted">修改用户名或密码后，当前会话会立刻失效，需要重新登录。</p>
            <label>新用户名<input class="input" id="profile-username" value="${escapeHtml(state.me?.username ?? "admin")}" /></label>
            <label>新密码<input class="input" id="profile-password" type="password" placeholder="留空表示不修改密码" /></label>
            <button class="button" id="profile-save-button">保存并重新登录</button>
          </div>
        </section>
      </div>
    </div>
  `;

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
