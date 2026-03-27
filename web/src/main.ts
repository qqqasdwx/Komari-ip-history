import "./style.css";

type MeResponse = {
  logged_in: boolean;
  username?: string;
  app_env?: string;
  base_path?: string;
};

type NodeListItem = {
  komari_node_uuid: string;
  name: string;
  has_data: boolean;
  current_summary: string;
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
};

type DisplayFieldsConfig = {
  hidden_paths: string[];
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

async function saveDisplayFields(hiddenPaths: string[]) {
  state.displayFields = await api<DisplayFieldsConfig>("/admin/display-fields", {
    method: "PUT",
    body: JSON.stringify({ hidden_paths: hiddenPaths })
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

function renderCurrentResult(result: Record<string, unknown>) {
  const hidden = new Set(state.displayFields.hidden_paths);
  const filtered = filterHiddenFields(result, "", hidden);
  if (!filtered || (typeof filtered === "object" && Object.keys(filtered as Record<string, unknown>).length === 0)) {
    return "N/A";
  }
  return JSON.stringify(filtered, null, 2);
}

function renderNodeDetail(embed = false) {
  const detail = state.nodeDetail;
  if (!detail) {
    app.innerHTML = "<div class='shell'><div class='panel'>节点不存在。</div></div>";
    return;
  }

  const currentResultText = escapeHtml(renderCurrentResult(detail.current_result));
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
            <div class="code-block">${currentResultText}</div>
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
            <div class="code-block">${currentResultText}</div>
          </div>

          <div class="section">
            <h2>历史入口</h2>
            <p class="muted">历史页已接入，阶段 1 采用时间倒序轻量列表和 JSON 兜底详情。</p>
          </div>

          <div class="section">
            <h2>节点接入配置</h2>
            <p class="muted">此区域为后续真实节点上报预留。阶段 1 不实现真实上报能力，只预留结构与说明位置。</p>
          </div>
        </section>
      </div>
    </div>
  `;

  bindShellEvents();
  document.querySelector<HTMLButtonElement>("#history-button")?.addEventListener("click", () => {
    navigate(`/nodes/${encodeURIComponent(detail.komari_node_uuid)}/history`);
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
  const selectedRecord = detail.history.find((item) => item.id === selectedID) ?? detail.history[0] ?? null;
  const historyCards = detail.history
    .map((item) => {
      const active = selectedRecord?.id === item.id;
      return `
        <button class="card history-card ${active ? "active" : ""}" data-history-record="${item.id}">
          <div class="section-head">
            <strong>${escapeHtml(item.summary || "无摘要")}</strong>
            <span class="chip">${formatDateTime(item.recorded_at)}</span>
          </div>
          <div class="muted">记录 ID: ${item.id}</div>
          <div class="muted">${escapeHtml((item.result_json || "").slice(0, 120) || "暂无详情")}</div>
        </button>
      `;
    })
    .join("");

  app.innerHTML = `
    <div class="shell">
      <div class="hero">
        <div class="chip-row">
          <span class="chip">历史记录</span>
          <span class="chip">轻量列表</span>
          <span class="chip">JSON 兜底详情</span>
        </div>
        <h1>${escapeHtml(detail.name)} 的历史</h1>
        <p>阶段 1 先采用轻量历史页：左侧看时间倒序列表，右侧查看单条详情，复杂图表后续再补。</p>
      </div>
      <div class="layout">
        ${sidebar("nodes")}
        <section class="panel">
          <div class="section">
            <div class="section-head">
              <h2>节点信息</h2>
              <div class="toolbar">
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
            <p class="muted">阶段 1 先用格式化 JSON 作为兜底详情承载。</p>
            <div class="code-block">${escapeHtml(selectedRecord?.result_json || "N/A")}</div>
          </div>
        </section>
      </div>
    </div>
  `;

  bindShellEvents();
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

async function renderSettings() {
  const [runtime, loaderPreview, inlinePreview] = await Promise.all([
    api<{ app_name: string; app_env: string; base_path: string }>("/admin/runtime"),
    api<{ code: string }>("/admin/header-preview?variant=loader"),
    api<{ code: string }>("/admin/header-preview?variant=inline")
  ]);

  const hidden = new Set(state.displayFields.hidden_paths);
  const fieldCards = state.displayFieldPaths
    .map(
      (path) => `
        <label class="card field-toggle">
          <span>${escapeHtml(path)}</span>
          <input type="checkbox" data-field="${escapeHtml(path)}" ${hidden.has(path) ? "" : "checked"} />
        </label>`
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
  document.querySelector<HTMLButtonElement>("#save-fields-button")?.addEventListener("click", async () => {
    const hiddenPaths = Array.from(document.querySelectorAll<HTMLInputElement>("[data-field]"))
      .filter((input) => !input.checked)
      .map((input) => input.dataset.field ?? "")
      .filter(Boolean);
    await saveDisplayFields(hiddenPaths);
    alert("字段配置已保存。");
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
    await Promise.all([loadDisplayFields(), loadDisplayFieldPaths()]);
    await renderSettings();
    return;
  }

  if (/^\/nodes\/[^/]+\/history$/.test(path)) {
    const uuid = path.replace(/^\/nodes\/([^/]+)\/history$/, "$1");
    await loadNode(decodeURIComponent(uuid));
    renderHistoryPage();
    return;
  }

  if (path.startsWith("/nodes/")) {
    const uuid = path.replace("/nodes/", "");
    await Promise.all([loadNode(decodeURIComponent(uuid)), loadDisplayFields()]);
    renderNodeDetail(route.query.get("embed") === "1");
    return;
  }

  await loadNodes();
  renderNodes();
}

void boot();
