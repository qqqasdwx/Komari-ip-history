import {
  ArrowLeftIcon,
  ExitIcon,
  GearIcon,
  ReloadIcon,
  RowsIcon
} from "@radix-ui/react-icons";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { apiRequest, UnauthorizedError } from "./lib/api";
import { formatDateTime } from "./lib/format";
import {
  buildRecentChangeSummary,
  buildStructuredCompareGroups,
  groupHistoryPath,
  parseHistoryRecordResult,
  renderChangeValue
} from "./lib/changes";
import { renderCurrentReportMarkup } from "./lib/report";
import { getNodeListSummaryEntries } from "./lib/result";
import { mergeCompareStats } from "../compare";
import type {
  ChangePriorityConfig,
  DisplayFieldsConfig,
  MeResponse,
  NodeDetail,
  NodeListItem
} from "./lib/types";

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
};

const nodeNavItems: NavItem[] = [{ to: "/nodes", label: "节点结果", icon: <RowsIcon /> }];

const settingsNavItems: NavItem[] = [
  { to: "/settings/integration", label: "接入配置", icon: <GearIcon /> },
  { to: "/settings/fields", label: "展示字段", icon: <GearIcon /> },
  { to: "/settings/priority", label: "变化规则", icon: <GearIcon /> },
  { to: "/settings/admin", label: "管理员设置", icon: <GearIcon /> }
];

function legacyHref() {
  return `${window.location.pathname}${window.location.hash || "#/nodes"}`;
}

function routeLabel(pathname: string) {
  if (pathname === "/nodes") {
    return "节点结果";
  }
  if (/^\/nodes\/[^/]+\/history$/.test(pathname)) {
    return "历史变化";
  }
  if (/^\/nodes\/[^/]+\/changes$/.test(pathname)) {
    return "变化视图";
  }
  if (pathname.startsWith("/nodes/")) {
    return "节点详情";
  }
  if (pathname === "/settings/integration") {
    return "接入配置";
  }
  if (pathname === "/settings/fields") {
    return "展示字段";
  }
  if (pathname === "/settings/priority") {
    return "变化规则";
  }
  if (pathname === "/settings/admin") {
    return "管理员设置";
  }
  return "迁移预览";
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function compareStatusLabel(status: "changed" | "added" | "unchanged") {
  if (status === "added") {
    return "新增";
  }
  if (status === "changed") {
    return "变化";
  }
  return "未变化";
}

function useNodePageData(uuid: string, onUnauthorized: () => void) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [hiddenPaths, setHiddenPaths] = useState<string[]>([]);
  const [priority, setPriority] = useState<ChangePriorityConfig>({ secondary_paths: ["Meta"] });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uuid) {
        setError("节点不存在");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const [detailResponse, displayFields, priorityResponse] = await Promise.all([
          apiRequest<NodeDetail>(`/nodes/${uuid}`),
          apiRequest<DisplayFieldsConfig>("/admin/display-fields"),
          apiRequest<ChangePriorityConfig>("/admin/change-priority")
        ]);

        if (cancelled) {
          return;
        }

        setDetail(detailResponse);
        setHiddenPaths(displayFields.hidden_paths ?? []);
        setPriority(priorityResponse);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载节点详情失败");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [onUnauthorized, reloadToken, uuid]);

  return {
    loading,
    error,
    detail,
    hiddenPaths,
    priority,
    reload: () => setReloadToken((value) => value + 1)
  };
}

function AppLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="space-y-3">
          <p className="text-3xl font-medium tracking-tight text-slate-950">Komari IP Quality</p>
          <p className="text-sm text-slate-500">正在载入 React 迁移预览...</p>
        </div>
      </div>
    </div>
  );
}

function SidebarSection(props: { title: string; items: NavItem[] }) {
  return (
    <div className="space-y-2">
      <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{props.title}</p>
      <div className="space-y-1">
        {props.items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition",
                isActive ? "bg-indigo-50 text-indigo-600" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              ].join(" ")
            }
          >
            <span className="text-base">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

function LoginPage(props: { onAuthenticated: (me: MeResponse) => void }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password })
      });
      const me = await apiRequest<MeResponse>("/auth/me");
      props.onAuthenticated(me);
      navigate("/nodes", { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-3xl font-medium tracking-tight text-slate-950">Komari IP Quality</h1>
          <p className="text-sm text-slate-500">登录后直接进入后台工作区。</p>
        </div>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="grid gap-2 text-sm text-slate-700">
            <span>用户名</span>
            <input
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm text-slate-700">
            <span>密码</span>
            <input
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <button
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-indigo-300"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}

function PageHeader(props: {
  title: string;
  subtitle?: string;
  backTo?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        {props.backTo ? (
          <Link
            className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600"
            to={props.backTo}
          >
            <ArrowLeftIcon />
            <span>返回</span>
          </Link>
        ) : null}
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{props.title}</h1>
          {props.subtitle ? <p className="text-sm text-slate-500">{props.subtitle}</p> : null}
        </div>
      </div>
      {props.actions ? <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">{props.actions}</div> : null}
    </header>
  );
}

function SearchBox(props: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="w-full sm:w-auto"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <input
        className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 sm:min-w-[320px]"
        placeholder="搜索节点名称"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button className="sr-only" type="submit">
        搜索
      </button>
    </form>
  );
}

function StatusPill(props: { hasData: boolean }) {
  return (
    <span
      className={[
        "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium",
        props.hasData
          ? "border-indigo-100 bg-indigo-50 text-indigo-600"
          : "border-amber-200 bg-amber-50 text-amber-700"
      ].join(" ")}
    >
      {props.hasData ? "有数据" : "无数据"}
    </span>
  );
}

function NodeSummary(props: { item: NodeListItem; hiddenPaths: string[] }) {
  const entries = getNodeListSummaryEntries(props.item.current_result ?? {}, props.hiddenPaths);

  if (!props.item.has_data || entries.length === 0) {
    return <div className="flex flex-wrap gap-2 text-sm text-slate-400" data-node-summary="empty">当前还没有检测结果</div>;
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-2" data-node-summary="structured">
      {entries.map((entry) => (
        <span
          key={`${entry.label}:${entry.value}`}
          className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-xs text-slate-600"
        >
          <strong className="font-semibold text-slate-900">{entry.label}</strong>
          <span>{entry.value}</span>
        </span>
      ))}
    </div>
  );
}

function NodesPage(props: { onUnauthorized: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nodes, setNodes] = useState<NodeListItem[]>([]);
  const [hiddenPaths, setHiddenPaths] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [nodeResponse, displayFields] = await Promise.all([
          apiRequest<{ items: NodeListItem[] }>(`/nodes${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ""}`),
          apiRequest<DisplayFieldsConfig>("/admin/display-fields")
        ]);

        if (cancelled) {
          return;
        }

        setNodes(nodeResponse.items);
        setHiddenPaths(displayFields.hidden_paths ?? []);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          props.onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载节点列表失败");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [props.onUnauthorized, reloadToken, searchQuery]);

  const showSearch = nodes.length > 0 || searchInput.trim().length > 0 || searchQuery.trim().length > 0;

  return (
    <section className="space-y-6">
      <PageHeader
        title="节点列表"
        subtitle={`${nodes.length} 个已接入节点`}
        actions={
          showSearch ? (
            <SearchBox value={searchInput} onChange={setSearchInput} onSubmit={() => setSearchQuery(searchInput.trim())} />
          ) : undefined
        }
      />

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-2 pb-4">
          <h2 className="text-base font-semibold text-slate-900">IP 质量结果</h2>
          <span className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs text-slate-500">
            {nodes.length} 个节点
          </span>
        </div>

        {loading ? (
          <div className="grid gap-3 px-2 py-6">
            <div className="h-14 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-14 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-14 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        ) : error ? (
          <div className="grid gap-4 px-2 py-8">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">{error}</div>
            <div>
              <button
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
                onClick={() => setReloadToken((value) => value + 1)}
                type="button"
              >
                <ReloadIcon />
                <span>重试</span>
              </button>
            </div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="px-2 py-6">
            <div className="grid gap-4 rounded-[22px] border border-slate-200 bg-slate-50 p-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-slate-900">还没有节点</h3>
                <p className="text-sm leading-6 text-slate-500">
                  先复制 Header 到 Komari，然后在节点详情页点击“添加 IP 质量检测”。
                </p>
              </div>
              <div>
                <Link
                  className="inline-flex h-10 items-center rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600"
                  to="/settings/integration"
                >
                  去接入
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-[18px] border border-slate-200">
            <div className="react-node-list-head bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              <span>节点</span>
              <span>状态</span>
              <span>最近更新</span>
              <span>摘要</span>
              <span></span>
            </div>
            <div className="react-node-list-body">
              {nodes.map((item) => (
                <Link
                  key={item.komari_node_uuid}
                  className="react-node-list-row border-t border-slate-200 px-4 py-4 text-sm text-slate-700 transition hover:bg-slate-50 first:border-t-0"
                  data-node-row="true"
                  to={`/nodes/${item.komari_node_uuid}`}
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-sm font-semibold text-slate-900" data-node-name="true">
                      {item.name}
                    </strong>
                  </div>
                  <div className="min-w-0">
                    <StatusPill hasData={item.has_data} />
                  </div>
                  <div className="min-w-0 text-sm text-slate-500">{formatDateTime(item.updated_at ?? undefined)}</div>
                  <div className="min-w-0">
                    <NodeSummary item={item} hiddenPaths={hiddenPaths} />
                  </div>
                  <div className="text-sm font-semibold text-indigo-600">查看</div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </section>
  );
}

function NodeDetailLoading() {
  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <div className="h-9 w-28 animate-pulse rounded-full bg-slate-100" />
        <div className="h-9 w-64 animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-5 w-80 animate-pulse rounded-xl bg-slate-100" />
      </div>
      <div className="h-80 animate-pulse rounded-[24px] bg-slate-100" />
      <div className="h-40 animate-pulse rounded-[24px] bg-slate-100" />
    </section>
  );
}

function OverviewPill(props: { label: string; value: number; tone: "changed" | "added" | "unchanged" }) {
  return (
    <span className={`summary-pill summary-pill-compare ${props.tone}`}>
      <strong>{props.label}</strong>
      <span>{props.value}</span>
    </span>
  );
}

function RecentChangeSection(props: {
  detail: NodeDetail;
  hiddenPaths: string[];
  priority: ChangePriorityConfig;
}) {
  const summary = buildRecentChangeSummary(props.detail, props.hiddenPaths, props.priority);

  if (summary.state === "empty") {
    return (
      <div className="summary-section" data-detail-change="empty">
        <div className="summary-head">
          <strong>最近变化</strong>
          <span className="chip">N/A</span>
        </div>
        <div className="muted">当前还没有历史记录，暂时无法判断最近一次变化。</div>
      </div>
    );
  }

  if (summary.state === "single") {
    return (
      <div className="summary-section" data-detail-change="single">
        <div className="summary-head">
          <strong>最近变化</strong>
          <span className="chip">无对比基准</span>
        </div>
        <div className="muted">当前只有 1 条历史记录，需等待下一次结果落库后才能比较变化。</div>
        <div className="muted">最新记录时间: {formatDateTime(summary.latestRecordedAt)}</div>
      </div>
    );
  }

  return (
    <div className="summary-section" data-detail-change="overview">
      <div className="summary-head">
        <strong>最近变化</strong>
        <span className="chip">相对上一条历史</span>
      </div>
      <div className="compare-overview">
        <OverviewPill label="变化" value={summary.stats.changed} tone="changed" />
        <OverviewPill label="新增" value={summary.stats.added} tone="added" />
        <OverviewPill label="未变化" value={summary.stats.unchanged} tone="unchanged" />
      </div>
      <div className="change-summary-grid">
        {summary.groups.length > 0 ? (
          summary.groups.map((group) => (
            <div key={group.key} className="card change-card">
              <div className="summary-head">
                <strong>{group.title}</strong>
                <span className="chip">{group.chip}</span>
              </div>
              <div className="compare-overview">
                <OverviewPill label="变化" value={group.stats.changed} tone="changed" />
                <OverviewPill label="新增" value={group.stats.added} tone="added" />
              </div>
              <div className="change-section">
                <div className="summary-head">
                  <strong>重点变化</strong>
                  <span className="chip">{group.classifiedChanges.primary.length} 项</span>
                </div>
                <div className="change-list">
                  {group.classifiedChanges.primary.slice(0, 3).map((change) => (
                    <div key={`${group.key}:${change.fullPath}`} className="summary-section" data-detail-change-entry="true">
                      <div className="summary-head">
                        <strong>{groupHistoryPath(change.path || change.fullPath)}</strong>
                        <span className={`diff-badge ${change.status}`}>{change.status === "added" ? "新增" : "变化"}</span>
                      </div>
                      <div className="muted">{renderChangeValue(change)}</div>
                    </div>
                  ))}
                  {group.classifiedChanges.primary.length === 0 ? (
                    <div className="muted">当前没有重点变化。</div>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="card change-card change-card-empty">
            <div className="muted">最近一次没有字段变化。</div>
          </div>
        )}
      </div>
    </div>
  );
}

function resolveReportEndpointURL(me: MeResponse, path: string) {
  const publicBaseURL = (me.public_base_url ?? "").replace(/\/$/, "");
  const base = publicBaseURL || window.location.origin;
  return `${base}${path}`;
}

function resolveComposeReportEndpointURL(me: MeResponse, path: string) {
  const publicBaseURL = (me.public_base_url ?? "").replace(/\/$/, "");
  if (me.app_env !== "development" || publicBaseURL) {
    return "";
  }
  return `http://proxy:8080${path}`;
}

function ReportConfigSection(props: { me: MeResponse; detail: NodeDetail }) {
  const reportEndpointURL = resolveReportEndpointURL(props.me, props.detail.report_config.endpoint_path);
  const composeReportEndpointURL = resolveComposeReportEndpointURL(props.me, props.detail.report_config.endpoint_path);

  async function handleCopy(value: string, successText: string) {
    try {
      await copyText(value);
      window.alert(successText);
    } catch {
      window.alert("复制失败，请手动复制。");
    }
  }

  return (
    <details className="panel details-panel" data-node-report-config="true">
      <summary>节点上报设置</summary>
      <div className="section report-config">
        <div className="summary-section">
          <div className="summary-head">
            <strong>上报地址</strong>
            <button className="button ghost" onClick={() => void handleCopy(reportEndpointURL, "上报地址已复制。")} type="button">
              复制
            </button>
          </div>
          <div className="code-block">{reportEndpointURL}</div>
        </div>
        {composeReportEndpointURL ? (
          <div className="summary-section">
            <div className="summary-head">
              <strong>容器网络地址</strong>
              <button
                className="button ghost"
                onClick={() => void handleCopy(composeReportEndpointURL, "容器网络上报地址已复制。")}
                type="button"
              >
                复制
              </button>
            </div>
            <div className="code-block">{composeReportEndpointURL}</div>
          </div>
        ) : null}
        <div className="summary-section">
          <div className="summary-head">
            <strong>Reporter Token</strong>
            <button
              className="button ghost"
              onClick={() => void handleCopy(props.detail.report_config.reporter_token, "Reporter Token 已复制。")}
              type="button"
            >
              复制
            </button>
          </div>
          <div className="code-block">{props.detail.report_config.reporter_token}</div>
        </div>
      </div>
    </details>
  );
}

function NodePageError(props: {
  title: string;
  subtitle: string;
  backTo: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <section className="space-y-6">
      <PageHeader title={props.title} subtitle={props.subtitle} backTo={props.backTo} />
      <section className="rounded-[24px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">
        <div className="space-y-4">
          <p>{props.error}</p>
          <div>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
              onClick={props.onRetry}
              type="button"
            >
              <ReloadIcon />
              <span>重试</span>
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}

function ChangeGroupCards(props: {
  groups: ReturnType<typeof buildStructuredCompareGroups>;
  emptyText: string;
  dataAttr: "history" | "change";
  includeSecondary?: boolean;
}) {
  if (props.groups.length === 0) {
    return (
      <div className="card change-card change-card-empty">
        <div className="muted">{props.emptyText}</div>
      </div>
    );
  }

  return (
    <div className="change-summary-grid">
      {props.groups.map((group) => (
        <div key={group.key} className="card change-card">
          <div className="summary-head">
            <strong>{group.title}</strong>
            <span className="chip">{group.chip}</span>
          </div>
          <div className="compare-overview">
            <OverviewPill label="变化" value={group.stats.changed} tone="changed" />
            <OverviewPill label="新增" value={group.stats.added} tone="added" />
          </div>

          <div className="change-section">
            <div className="summary-head">
              <strong>重点变化</strong>
              <span className="chip">{group.classifiedChanges.primary.length} 项</span>
            </div>
            <div className="change-list">
              {group.classifiedChanges.primary.length > 0 ? (
                group.classifiedChanges.primary.map((change) => (
                  <div
                    key={`${group.key}:${change.fullPath}`}
                    className="summary-section"
                    {...(props.dataAttr === "history"
                      ? { "data-history-change-entry": "true" }
                      : { "data-change-view-entry": "true" })}
                  >
                    <div className="summary-head">
                      <strong>{groupHistoryPath(change.path || change.fullPath)}</strong>
                      <span className={`diff-badge ${change.status}`}>{compareStatusLabel(change.status)}</span>
                    </div>
                    <div className="muted">{renderChangeValue(change)}</div>
                  </div>
                ))
              ) : (
                <div className="muted">当前没有重点变化。</div>
              )}
            </div>
          </div>

          {props.includeSecondary && group.classifiedChanges.secondary.length > 0 ? (
            <div className="change-section change-section-secondary">
              <div className="summary-head">
                <strong>辅助变化</strong>
                <span className="chip">{group.classifiedChanges.secondary.length} 项</span>
              </div>
              <div className="change-list">
                {group.classifiedChanges.secondary.map((change) => (
                  <div
                    key={`${group.key}:${change.fullPath}:secondary`}
                    className="summary-section"
                    {...(props.dataAttr === "history"
                      ? { "data-history-change-entry": "true" }
                      : { "data-change-view-entry": "true" })}
                  >
                    <div className="summary-head">
                      <strong>{groupHistoryPath(change.path || change.fullPath)}</strong>
                      <span className={`diff-badge ${change.status}`}>{compareStatusLabel(change.status)}</span>
                    </div>
                    <div className="muted">{renderChangeValue(change)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function NodeDetailPage(props: { me: MeResponse; onUnauthorized: () => void }) {
  const { uuid = "" } = useParams();
  const { loading, error, detail, hiddenPaths, priority, reload } = useNodePageData(uuid, props.onUnauthorized);

  if (loading) {
    return <NodeDetailLoading />;
  }

  if (error || !detail) {
    return (
      <NodePageError
        title="节点详情"
        subtitle={error || "节点不存在"}
        backTo="/nodes"
        error={error || "节点不存在。"}
        onRetry={reload}
      />
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title={detail.name}
        subtitle={detail.has_data ? `最近更新: ${formatDateTime(detail.updated_at ?? undefined)}` : "当前还没有检测结果"}
        backTo="/nodes"
        actions={
          <>
            <Link
              className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
              to={`/nodes/${detail.komari_node_uuid}/history`}
            >
              历史变化
            </Link>
            <Link
              className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
              to={`/nodes/${detail.komari_node_uuid}/changes`}
            >
              变化视图
            </Link>
          </>
        }
      />

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="section">
          <h2 className="text-base font-semibold text-slate-900">当前 IP 质量</h2>
          <div
            data-detail-report="true"
            dangerouslySetInnerHTML={{
              __html: renderCurrentReportMarkup(detail.current_result, hiddenPaths)
            }}
          />
        </div>

        <div className="section">
          <div className="section-head">
            <h2>最近变化</h2>
            <Link
              className="button ghost"
              to={`/nodes/${detail.komari_node_uuid}/history`}
            >
              查看完整历史
            </Link>
          </div>
          <RecentChangeSection detail={detail} hiddenPaths={hiddenPaths} priority={priority} />
        </div>

        <ReportConfigSection me={props.me} detail={detail} />
      </section>
    </section>
  );
}

function HistoryPage(props: { onUnauthorized: () => void }) {
  const { uuid = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { loading, error, detail, hiddenPaths, priority, reload } = useNodePageData(uuid, props.onUnauthorized);

  if (loading) {
    return <NodeDetailLoading />;
  }

  if (error || !detail) {
    return (
      <NodePageError
        title="历史变化"
        subtitle={error || "节点不存在"}
        backTo="/nodes"
        error={error || "节点不存在。"}
        onRetry={reload}
      />
    );
  }

  const selectedID = Number(searchParams.get("record") ?? "");
  const selectedIndex = detail.history.findIndex((item) => item.id === selectedID);
  const resolvedIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedRecord = detail.history[resolvedIndex] ?? null;
  const previousRecord = resolvedIndex >= 0 ? detail.history[resolvedIndex + 1] ?? null : null;
  const selectedResult = parseHistoryRecordResult(selectedRecord);
  const previousResult = previousRecord ? parseHistoryRecordResult(previousRecord) : undefined;
  const historyCompareGroups = previousRecord
    ? buildStructuredCompareGroups(selectedResult, previousResult, hiddenPaths, priority.secondary_paths)
    : [];
  const historyStats = historyCompareGroups.reduce(
    (summary, group) => {
      mergeCompareStats(summary, group.stats);
      return summary;
    },
    { changed: 0, added: 0, unchanged: 0 }
  );

  return (
    <section className="space-y-6">
      <PageHeader
        title={`${detail.name} 的历史变化`}
        subtitle={detail.history.length > 0 ? `共 ${detail.history.length} 条记录` : "当前还没有历史记录"}
        backTo={`/nodes/${detail.komari_node_uuid}`}
        actions={
          <Link
            className="button ghost"
            to={`/nodes/${detail.komari_node_uuid}/changes${selectedRecord ? `?record=${selectedRecord.id}` : ""}`}
          >
            变化视图
          </Link>
        }
      />

      <section className="panel">
        <div className="section">
          <h2>历史记录</h2>
          <div className="list">
            {detail.history.length > 0 ? (
              detail.history.map((item, index) => {
                const active = selectedRecord?.id === item.id;
                const baseline = detail.history[index + 1] ?? null;
                const stats = baseline
                  ? buildStructuredCompareGroups(
                      parseHistoryRecordResult(item),
                      parseHistoryRecordResult(baseline),
                      hiddenPaths,
                      priority.secondary_paths
                    ).reduce(
                      (summary, group) => {
                        mergeCompareStats(summary, group.stats);
                        return summary;
                      },
                      { changed: 0, added: 0, unchanged: 0 }
                    )
                  : { changed: 0, added: 0, unchanged: 0 };
                const deltaText = baseline
                  ? `变化 ${stats.changed} 项 / 新增 ${stats.added} 项 / 未变化 ${stats.unchanged} 项`
                  : "首条记录，无上一条可比较";

                return (
                  <button
                    key={item.id}
                    className={`card history-card${active ? " active" : ""}`}
                    data-history-record={item.id}
                    onClick={() => setSearchParams({ record: String(item.id) })}
                    type="button"
                  >
                    <div className="section-head">
                      <strong>{item.summary || "无摘要"}</strong>
                      <span className="chip">{formatDateTime(item.recorded_at)}</span>
                    </div>
                    <div className="muted">记录 ID: {item.id}</div>
                    <div className="muted">{deltaText}</div>
                  </button>
                );
              })
            ) : (
              <div className="card empty-state-card">
                <strong>暂无历史记录</strong>
                <p className="muted">等待节点继续上报后，这里会出现历史变化。</p>
              </div>
            )}
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <h2>选中记录</h2>
            {selectedRecord ? <span className="chip">{formatDateTime(selectedRecord.recorded_at)}</span> : null}
          </div>
          <div className="history-compare-meta">
            <div className="summary-section">
              <div className="summary-head">
                <strong>当前记录</strong>
                <span className="chip">{selectedRecord ? formatDateTime(selectedRecord.recorded_at) : "N/A"}</span>
              </div>
              <div className="muted">{selectedRecord?.summary || "无摘要"}</div>
            </div>
            <div className="summary-section">
              <div className="summary-head">
                <strong>对比上一条</strong>
                <span className="chip">{previousRecord ? formatDateTime(previousRecord.recorded_at) : "N/A"}</span>
              </div>
              <div className="muted">{previousRecord?.summary || "没有更早记录"}</div>
            </div>
          </div>
          <div className="summary-section" data-history-change-list="true">
            <div className="summary-head">
              <strong>变化内容</strong>
              <span className="chip">{previousRecord ? "相对上一条" : "无对比"}</span>
            </div>
            {previousRecord ? (
              <>
                <div className="compare-overview">
                  <OverviewPill label="变化" value={historyStats.changed} tone="changed" />
                  <OverviewPill label="新增" value={historyStats.added} tone="added" />
                  <OverviewPill label="未变化" value={historyStats.unchanged} tone="unchanged" />
                </div>
                <ChangeGroupCards
                  groups={historyCompareGroups}
                  emptyText="当前记录相对上一条没有字段变化。"
                  dataAttr="history"
                  includeSecondary
                />
              </>
            ) : (
              <div className="muted">这是首条历史记录，没有更早的基准可比较。</div>
            )}
          </div>
        </div>
      </section>
    </section>
  );
}

type ChangeViewFilters = {
  primaryOnly: boolean;
  changedOnly: boolean;
  group: string;
};

function ChangeViewPage(props: { onUnauthorized: () => void }) {
  const { uuid = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { loading, error, detail, hiddenPaths, priority, reload } = useNodePageData(uuid, props.onUnauthorized);
  const [filters, setFilters] = useState<ChangeViewFilters>({
    primaryOnly: false,
    changedOnly: false,
    group: "all"
  });

  if (loading) {
    return <NodeDetailLoading />;
  }

  if (error || !detail) {
    return (
      <NodePageError
        title="变化视图"
        subtitle={error || "节点不存在"}
        backTo="/nodes"
        error={error || "节点不存在。"}
        onRetry={reload}
      />
    );
  }

  const filterGroups = (groups: ReturnType<typeof buildStructuredCompareGroups>) =>
    groups
      .map((group) => {
        const primaryChanges = group.classifiedChanges.primary;
        const secondaryChanges = filters.primaryOnly ? [] : group.classifiedChanges.secondary;
        const stats = {
          changed: primaryChanges.filter((item) => item.status === "changed").length + secondaryChanges.filter((item) => item.status === "changed").length,
          added: primaryChanges.filter((item) => item.status === "added").length + secondaryChanges.filter((item) => item.status === "added").length,
          unchanged: 0
        };

        return {
          ...group,
          stats,
          classifiedChanges: {
            primary: primaryChanges,
            secondary: secondaryChanges
          }
        };
      })
      .filter((group) => {
        if (filters.group !== "all" && group.key !== filters.group) {
          return false;
        }
        if (filters.changedOnly) {
          return group.stats.changed > 0 || group.stats.added > 0;
        }
        return true;
      });

  const recordSummaries = detail.history.map((item, index) => {
    const baseline = detail.history[index + 1] ?? null;
    const groups = baseline
      ? buildStructuredCompareGroups(
          parseHistoryRecordResult(item),
          parseHistoryRecordResult(baseline),
          hiddenPaths,
          priority.secondary_paths
        )
      : [];
    const filteredGroups = filterGroups(groups);
    const filteredStats = filteredGroups.reduce(
      (summary, group) => {
        mergeCompareStats(summary, group.stats);
        return summary;
      },
      { changed: 0, added: 0, unchanged: 0 }
    );
    const hasMeaningfulChange = filteredStats.changed > 0 || filteredStats.added > 0;

    return {
      item,
      baseline,
      groups,
      filteredGroups,
      filteredStats,
      hasMeaningfulChange
    };
  });

  const selectedID = Number(searchParams.get("record") ?? "");
  const selectedIndex = detail.history.findIndex((item) => item.id === selectedID);
  const resolvedIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedRecordSummary = recordSummaries[resolvedIndex] ?? null;
  const selectedRecord = selectedRecordSummary?.item ?? null;
  const previousRecord = selectedRecordSummary?.baseline ?? null;
  const visibleRecordSummaries = recordSummaries.filter((record) => (filters.changedOnly ? record.hasMeaningfulChange : true));
  const groupOptions = Array.from(
    new Map(
      recordSummaries.flatMap((record) => record.groups.map((group) => [group.key, group.title]))
    ).entries()
  );

  return (
    <section className="space-y-6">
      <PageHeader
        title={`${detail.name} 的变化`}
        subtitle="这里只看历史里发生了什么变化。"
        backTo={`/nodes/${detail.komari_node_uuid}`}
        actions={
          <Link
            className="button ghost"
            to={`/nodes/${detail.komari_node_uuid}/history${selectedRecord ? `?record=${selectedRecord.id}` : ""}`}
          >
            历史记录
          </Link>
        }
      />

      <section className="panel" data-change-view="true">
        <div className="section">
          <div className="section-head">
            <h2>变化记录</h2>
            <span className="chip">{visibleRecordSummaries.length} 条</span>
          </div>
          <div className="change-filter-bar" data-change-view-filters="true">
            <label className="card change-filter">
              <span>只看重点变化</span>
              <input
                checked={filters.primaryOnly}
                onChange={(event) => setFilters((value) => ({ ...value, primaryOnly: event.target.checked }))}
                type="checkbox"
              />
            </label>
            <label className="card change-filter">
              <span>只看有变化记录</span>
              <input
                checked={filters.changedOnly}
                onChange={(event) => setFilters((value) => ({ ...value, changedOnly: event.target.checked }))}
                type="checkbox"
              />
            </label>
            <label className="card change-filter change-filter-select">
              <span>分组筛选</span>
              <select
                className="input"
                onChange={(event) => setFilters((value) => ({ ...value, group: event.target.value }))}
                value={filters.group}
              >
                <option value="all">全部分组</option>
                {groupOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="list">
            {visibleRecordSummaries.length > 0 ? (
              visibleRecordSummaries.map((record) => {
                const active = selectedRecord?.id === record.item.id;
                const statusText = record.baseline
                  ? record.hasMeaningfulChange
                    ? `变化 ${record.filteredStats.changed} 项 / 新增 ${record.filteredStats.added} 项`
                    : "无重点变化"
                  : "首条记录，无上一条可比较";

                return (
                  <button
                    key={record.item.id}
                    className={`card history-card${active ? " active" : ""}`}
                    data-change-record={record.item.id}
                    onClick={() => setSearchParams({ record: String(record.item.id) })}
                    type="button"
                  >
                    <div className="section-head">
                      <strong>{record.item.summary || "无摘要"}</strong>
                      <span className="chip">{formatDateTime(record.item.recorded_at)}</span>
                    </div>
                    <div className="muted">{statusText}</div>
                    <div className="compare-overview">
                      <OverviewPill label="变化" value={record.filteredStats.changed} tone="changed" />
                      <OverviewPill label="新增" value={record.filteredStats.added} tone="added" />
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="card empty-state-card" data-change-view-empty="true">
                <strong>当前没有可看的变化记录</strong>
                <p className="muted">等下一次结果进入历史，或放宽筛选条件后再看。</p>
              </div>
            )}
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <h2>本次变化</h2>
            {selectedRecord ? <span className="chip">{formatDateTime(selectedRecord.recorded_at)}</span> : null}
          </div>
          <div className="history-compare-meta">
            <div className="summary-section">
              <div className="summary-head">
                <strong>当前记录</strong>
                <span className="chip">{selectedRecord ? formatDateTime(selectedRecord.recorded_at) : "N/A"}</span>
              </div>
              <div className="muted">{selectedRecord?.summary || "无摘要"}</div>
            </div>
            <div className="summary-section">
              <div className="summary-head">
                <strong>对比上一条</strong>
                <span className="chip">{previousRecord ? formatDateTime(previousRecord.recorded_at) : "N/A"}</span>
              </div>
              <div className="muted">{previousRecord?.summary || "没有更早记录"}</div>
            </div>
          </div>
          <div className="summary-section" data-change-view-overview="true">
            <div className="summary-head">
              <strong>变化摘要</strong>
              <span className="chip">{previousRecord ? "相对上一条" : "无对比"}</span>
            </div>
            {selectedRecordSummary ? (
              <div className="compare-overview">
                <OverviewPill label="变化" value={selectedRecordSummary.filteredStats.changed} tone="changed" />
                <OverviewPill label="新增" value={selectedRecordSummary.filteredStats.added} tone="added" />
                <OverviewPill label="未变化" value={selectedRecordSummary.filteredStats.unchanged} tone="unchanged" />
              </div>
            ) : (
              <div className="muted">当前还没有历史记录，暂时无法查看变化。</div>
            )}
          </div>
          <div className="summary-section" data-change-view-list="true">
            <div className="summary-head">
              <strong>变化明细</strong>
              <span className="chip">{previousRecord ? "字段级" : "无对比"}</span>
            </div>
            {selectedRecordSummary ? (
              <ChangeGroupCards
                groups={selectedRecordSummary.filteredGroups}
                emptyText="当前记录在筛选条件下没有可展示变化。"
                dataAttr="change"
                includeSecondary={!filters.primaryOnly}
              />
            ) : (
              <div className="muted">当前还没有历史记录，暂时无法查看变化。</div>
            )}
          </div>
        </div>
      </section>
    </section>
  );
}

function PlaceholderPage(props: { title: string; subtitle: string; bullets: string[]; backTo?: string }) {
  return (
    <section className="space-y-6">
      <PageHeader title={props.title} subtitle={props.subtitle} backTo={props.backTo} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-4">
            <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Stage C
            </div>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              这页还没有开始正式搬业务逻辑，当前先保留在 React 壳子里占位，等节点详情页稳定后继续逐页迁移。
            </p>
          </div>
        </div>
        <aside className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">本页下一步</h2>
            <ul className="space-y-3 text-sm text-slate-700">
              {props.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-3">
                  <span className="mt-1 inline-block h-2 w-2 rounded-full bg-indigo-500" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}

function AppShell(props: { me: MeResponse; onLogout: () => Promise<void>; onUnauthorized: () => void }) {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="react-preview-shell grid min-h-screen grid-cols-1">
        <aside className="border-b border-slate-200 bg-white px-4 py-5 lg:border-b-0 lg:border-r">
          <div className="space-y-1 px-3 pb-6">
            <p className="text-3xl font-medium tracking-tight text-slate-900">Komari</p>
            <p className="text-sm text-slate-400">IP Quality</p>
          </div>
          <nav className="space-y-6">
            <SidebarSection title="节点" items={nodeNavItems} />
            <SidebarSection title="设置" items={settingsNavItems} />
          </nav>
        </aside>
        <main className="min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 lg:px-8">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Migration Phase C</p>
              <p className="text-sm text-slate-500">{routeLabel(location.pathname)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
                href={legacyHref()}
              >
                返回旧前端
              </a>
              <span className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-xs font-medium text-slate-500">
                模式 {props.me.app_env ?? "unknown"}
              </span>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
                onClick={() => void props.onLogout()}
                type="button"
              >
                <ExitIcon />
                <span>退出登录</span>
              </button>
            </div>
          </header>
          <div className="space-y-6 px-6 pb-8 lg:px-8">
            <Routes>
              <Route path="/" element={<Navigate to="/nodes" replace />} />
              <Route path="/nodes" element={<NodesPage onUnauthorized={props.onUnauthorized} />} />
              <Route path="/nodes/:uuid" element={<NodeDetailPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
              <Route path="/nodes/:uuid/history" element={<HistoryPage onUnauthorized={props.onUnauthorized} />} />
              <Route path="/nodes/:uuid/changes" element={<ChangeViewPage onUnauthorized={props.onUnauthorized} />} />
              <Route
                path="/settings/integration"
                element={
                  <PlaceholderPage
                    title="接入配置"
                    subtitle="会优先把 loader / inline 代码复制体验和说明文案迁过来。"
                    bullets={["迁移 Header 预览接口", "迁移代码高亮与固定高度代码框", "迁移其他设置快捷入口"]}
                  />
                }
              />
              <Route
                path="/settings/fields"
                element={
                  <PlaceholderPage
                    title="展示字段"
                    subtitle="这页后续会承载全局字段显隐配置。"
                    bullets={["迁移字段分组展示", "迁移全选/全不选操作", "迁移保存接口和提示反馈"]}
                  />
                }
              />
              <Route
                path="/settings/priority"
                element={
                  <PlaceholderPage
                    title="变化规则"
                    subtitle="这页后续会承载重点变化和辅助变化的规则配置。"
                    bullets={["迁移规则分组展示", "迁移默认规则按钮", "迁移保存后立即刷新规则"]}
                  />
                }
              />
              <Route
                path="/settings/admin"
                element={
                  <PlaceholderPage
                    title="管理员设置"
                    subtitle="这页后续会承载单管理员账号和密码修改。"
                    bullets={["迁移当前管理员信息", "迁移改名改密表单", "迁移保存后重新登录流程"]}
                  />
                }
              />
              <Route path="*" element={<Navigate to="/nodes" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export function App() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await apiRequest<MeResponse>("/auth/me");
        if (cancelled) {
          return;
        }
        setMe(response.logged_in ? response : null);
      } catch {
        if (!cancelled) {
          setMe(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } finally {
      setMe(null);
      navigate("/login", { replace: true });
    }
  }

  if (loading) {
    return <AppLoading />;
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={me ? "/nodes" : "/login"} replace />} />
      <Route
        path="/login"
        element={me ? <Navigate to="/nodes" replace /> : <LoginPage onAuthenticated={(nextMe) => setMe(nextMe)} />}
      />
      <Route
        path="/*"
        element={
          me ? (
            <AppShell
              me={me}
              onLogout={handleLogout}
              onUnauthorized={() => {
                setMe(null);
                navigate("/login", { replace: true });
              }}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}
