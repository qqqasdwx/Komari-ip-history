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
import { apiRequest, RequestError, UnauthorizedError } from "./lib/api";
import { formatDateTime } from "./lib/format";
import { CurrentReportView } from "./lib/report";
import { getNodeListSummaryEntries } from "./lib/result";
import type {
  IntegrationSettings,
  MeResponse,
  NodeDetail,
  NodeListItem,
  PublicNodeDetail,
  RuntimeResponse
} from "./lib/types";

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
};

const standaloneAppBase = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;

const nodeNavItems: NavItem[] = [{ to: "/nodes", label: "节点结果", icon: <RowsIcon /> }];

const settingsNavItems: NavItem[] = [
  { to: "/settings/integration", label: "接入配置", icon: <GearIcon /> },
  { to: "/settings/admin", label: "管理员设置", icon: <GearIcon /> }
];

function routeLabel(pathname: string) {
  if (pathname === "/nodes") {
    return "节点结果";
  }
  if (pathname.startsWith("/nodes/")) {
    return "节点详情";
  }
  if (pathname === "/settings/integration") {
    return "接入配置";
  }
  if (pathname === "/settings/admin") {
    return "管理员设置";
  }
  return "工作区";
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function useNodePageData(uuid: string, onUnauthorized: () => void) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
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
      setErrorStatus(null);

      try {
        const detailResponse = await apiRequest<NodeDetail>(`/nodes/${uuid}`);

        if (cancelled) {
          return;
        }

        setDetail(detailResponse);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        if (loadError instanceof RequestError) {
          setErrorStatus(loadError.status);
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
    errorStatus,
    detail,
    reload: () => setReloadToken((value) => value + 1)
  };
}

function usePublicNodePageData(uuid: string, displayIP: string) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [detail, setDetail] = useState<PublicNodeDetail | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uuid) {
        setError("节点不存在");
        setErrorStatus(404);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      setErrorStatus(null);

      try {
        const query = new URLSearchParams();
        if (displayIP.trim()) {
          query.set("display_ip", displayIP.trim());
        }
        const detailResponse = await apiRequest<PublicNodeDetail>(
          `/public/nodes/${uuid}/current${query.size > 0 ? `?${query.toString()}` : ""}`
        );

        if (cancelled) {
          return;
        }

        setDetail(detailResponse);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof RequestError) {
          setErrorStatus(loadError.status);
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
  }, [displayIP, reloadToken, uuid]);

  return {
    loading,
    error,
    errorStatus,
    detail,
    reload: () => setReloadToken((value) => value + 1)
  };
}

function buildConnectPath(uuid: string, name: string, options?: { returnTo?: string; resumePopup?: boolean }) {
  const params = new URLSearchParams({ uuid, name });
  if (options?.returnTo) {
    params.set("return_to", options.returnTo);
  }
  if (options?.resumePopup) {
    params.set("resume", "popup");
  }
  return `/connect?${params.toString()}`;
}

function buildKomariResumeURL(returnTo: string, uuid: string, name: string) {
  try {
    const target = new URL(returnTo);
    target.searchParams.set("ipq_resume", "1");
    target.searchParams.set("ipq_uuid", uuid);
    if (name.trim()) {
      target.searchParams.set("ipq_name", name.trim());
    }
    return target.toString();
  } catch {
    return `/nodes/${encodeURIComponent(uuid)}`;
  }
}

function toStandaloneAppURL(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${standaloneAppBase}/#${normalizedPath}`;
}

function postEmbedAction(type: string, payload: Record<string, string>) {
  if (window.parent === window) {
    return;
  }
  window.parent.postMessage({ source: "ipq-embed", type, ...payload }, "*");
}

function AppLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="space-y-3">
          <p className="text-3xl font-medium tracking-tight text-slate-950">Komari IP Quality</p>
          <p className="text-sm text-slate-500">正在载入后台工作区...</p>
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

function LoginPage(props: { me: MeResponse | null; onAuthenticated: (me: MeResponse) => void }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const redirectTarget = searchParams.get("redirect") || "/nodes";

  useEffect(() => {
    if (props.me) {
      navigate(redirectTarget, { replace: true });
    }
  }, [navigate, props.me, redirectTarget]);

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
      navigate(redirectTarget, { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (props.me) {
    return <AppLoading />;
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

function ConnectPage(props: { onUnauthorized: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const uuid = searchParams.get("uuid")?.trim() || "";
  const name = searchParams.get("name")?.trim() || "未命名节点";
  const isEmbed = searchParams.get("embed") === "1";
  const returnTo = searchParams.get("return_to")?.trim() || "";
  const resumePopup = searchParams.get("resume") === "popup";

  useEffect(() => {
    let cancelled = false;

    async function connectNode() {
      if (!uuid) {
        setError("缺少节点 UUID，无法继续接入。");
        setLoading(false);
        return;
      }

      try {
        await apiRequest("/embed/nodes/register", {
          method: "POST",
          body: JSON.stringify({ uuid, name })
        });

        if (cancelled) {
          return;
        }

        if (returnTo) {
          window.location.replace(buildKomariResumeURL(returnTo, uuid, name));
          return;
        }

        navigate(`/nodes/${uuid}${isEmbed ? "?embed=1" : ""}`, { replace: true });
      } catch (connectError) {
        if (cancelled) {
          return;
        }
        if (connectError instanceof UnauthorizedError) {
          props.onUnauthorized();
          navigate(`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`, { replace: true });
          return;
        }
        setError(connectError instanceof Error ? connectError.message : "节点接入失败");
        setLoading(false);
      }
    }

    void connectNode();

    return () => {
      cancelled = true;
    };
  }, [isEmbed, location.pathname, location.search, name, navigate, props.onUnauthorized, returnTo, resumePopup, uuid]);

  if (loading) {
    return (
      <section className="space-y-6">
        <PageHeader
          title="接入节点"
          subtitle={returnTo && resumePopup ? "正在完成登录并返回 Komari 弹窗。" : "正在为当前节点创建或恢复 IP 质量视图。"}
          backTo={isEmbed ? undefined : "/nodes"}
        />
        <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-3">
            <div className="h-6 w-40 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-4 w-64 animate-pulse rounded-xl bg-slate-100" />
          </div>
        </section>
      </section>
    );
  }

  return (
    <NodePageError
      title="接入节点"
      subtitle={name}
      backTo="/nodes"
      error={error || "节点接入失败。"}
      onRetry={() => window.location.reload()}
    />
  );
}

function EmbedBridgePage(props: { title: string; description: string; actionURL: string }) {
  useEffect(() => {
    postEmbedAction("open-standalone", { url: toStandaloneAppURL(props.actionURL) });
  }, [props.actionURL]);

  return (
    <section className="space-y-6">
      <PageHeader title={props.title} subtitle={props.description} />
      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm leading-6 text-slate-500">当前操作需要跳到独立页面完成，正在继续处理。</p>
      </section>
    </section>
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
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const nodeResponse = await apiRequest<{ items: NodeListItem[] }>(`/nodes${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ""}`);

        if (cancelled) {
          return;
        }

        setNodes(nodeResponse.items);
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
                    <NodeSummary item={item} hiddenPaths={[]} />
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


function NodeDetailPage(props: { me: MeResponse; onUnauthorized: () => void }) {
  const { uuid = "" } = useParams();
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const komariReturn = searchParams.get("komari_return")?.trim() || "";
  const nodeName = searchParams.get("node_name")?.trim() || "未命名节点";
  const { loading, error, errorStatus, detail, reload } = useNodePageData(uuid, props.onUnauthorized);

  if (loading) {
    return <NodeDetailLoading />;
  }

  if (isEmbed && errorStatus === 404 && komariReturn) {
    return (
      <EmbedBridgePage
        title="接入节点"
        description="当前节点还没有接入 IP 质量，正在跳到独立页面继续。"
        actionURL={buildConnectPath(uuid, nodeName, { returnTo: komariReturn, resumePopup: true })}
      />
    );
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
        backTo={isEmbed ? undefined : "/nodes"}
      />

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="section">
          <h2 className="text-base font-semibold text-slate-900">当前 IP 质量</h2>
          <div data-detail-report="true">
          <CurrentReportView
            result={detail.current_result}
            hiddenPaths={[]}
            compact={isEmbed}
          />
          </div>
        </div>

        {!isEmbed ? (
          <ReportConfigSection me={props.me} detail={detail} />
        ) : null}
      </section>
    </section>
  );
}

function PublicNodeDetailPage() {
  const { uuid = "" } = useParams();
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const displayIP = searchParams.get("display_ip")?.trim() || "";
  const { loading, error, detail, reload } = usePublicNodePageData(uuid, displayIP);

  if (loading) {
    return <NodeDetailLoading />;
  }

  if (error || !detail) {
    return (
      <NodePageError
        title="IP质量体检报告"
        subtitle={error || "当前结果不可用"}
        backTo="/"
        error={error || "当前结果不可用。"}
        onRetry={reload}
      />
    );
  }

  return (
    <section className="space-y-6">
      {!isEmbed ? <PageHeader title="IP质量体检报告" subtitle="游客只读视图" backTo="/" /> : null}
      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="section">
          <h2 className="text-base font-semibold text-slate-900">当前 IP 质量</h2>
          <div data-detail-report="true">
            <CurrentReportView result={detail.current_result} hiddenPaths={[]} compact={isEmbed} />
          </div>
        </div>
      </section>
    </section>
  );
}

function IntegrationPage(props: { me: MeResponse; onUnauthorized: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runtime, setRuntime] = useState<RuntimeResponse | null>(null);
  const [integration, setIntegration] = useState<IntegrationSettings | null>(null);
  const [publicBaseURLInput, setPublicBaseURLInput] = useState("");
  const [guestReadEnabledInput, setGuestReadEnabledInput] = useState(false);
  const [loaderCode, setLoaderCode] = useState("");
  const [inlineCode, setInlineCode] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);
  const publicBaseURL = (integration?.public_base_url ?? props.me.public_base_url ?? "").trim();
  const basePath = runtime?.base_path || props.me.base_path || "";
  const suggestedPublicBaseURL = `${window.location.origin}${basePath || ""}`.replace(/\/$/, "");
  const previewPublicBaseURL = publicBaseURL || suggestedPublicBaseURL;

  function buildPreviewPath(variant: "loader" | "inline", baseURL: string) {
    const query = new URLSearchParams({ variant });
    if (baseURL) {
      query.set("public_base_url", baseURL);
    }
    return `/admin/header-preview?${query.toString()}`;
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [runtimeResponse, integrationResponse, loaderPreview, inlinePreview] = await Promise.all([
          apiRequest<RuntimeResponse>("/admin/runtime"),
          apiRequest<IntegrationSettings>("/admin/integration"),
          apiRequest<{ code: string }>(buildPreviewPath("loader", previewPublicBaseURL)),
          apiRequest<{ code: string }>(buildPreviewPath("inline", previewPublicBaseURL))
        ]);

        if (cancelled) {
          return;
        }

        setRuntime(runtimeResponse);
        setIntegration(integrationResponse);
        setPublicBaseURLInput(integrationResponse.public_base_url ?? "");
        setGuestReadEnabledInput(Boolean(integrationResponse.guest_read_enabled));
        setLoaderCode(loaderPreview.code);
        setInlineCode(inlinePreview.code);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          props.onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载接入配置失败");
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
  }, [props.onUnauthorized, previewPublicBaseURL]);

  async function handleCopy(value: string, successText: string) {
    try {
      await copyText(value);
      window.alert(successText);
    } catch {
      window.alert("复制失败，请手动复制。");
    }
  }

  async function saveIntegrationSettings(nextValue: string, guestReadEnabled: boolean) {
    setSavingAddress(true);
    setError("");
    try {
      const saved = await apiRequest<IntegrationSettings>("/admin/integration", {
        method: "PUT",
        body: JSON.stringify({ public_base_url: nextValue, guest_read_enabled: guestReadEnabled })
      });
      setIntegration(saved);
      setPublicBaseURLInput(saved.public_base_url ?? "");
      setGuestReadEnabledInput(Boolean(saved.guest_read_enabled));
      const nextPreviewPublicBaseURL = saved.public_base_url || suggestedPublicBaseURL;

      const [runtimeResponse, loaderPreview, inlinePreview] = await Promise.all([
        apiRequest<RuntimeResponse>("/admin/runtime"),
        apiRequest<{ code: string }>(buildPreviewPath("loader", nextPreviewPublicBaseURL)),
        apiRequest<{ code: string }>(buildPreviewPath("inline", nextPreviewPublicBaseURL))
      ]);
      setRuntime(runtimeResponse);
      setLoaderCode(loaderPreview.code);
      setInlineCode(inlinePreview.code);
      window.alert(saved.public_base_url ? "接入地址已保存。" : "已恢复为自动推导地址。");
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存接入地址失败");
    } finally {
      setSavingAddress(false);
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader title="接入配置" subtitle="复制 Header 到 Komari。默认按独立部署接入，需要时再兼容子路径。" />

      {loading ? (
        <div className="grid gap-4">
          <div className="h-36 animate-pulse rounded-[24px] bg-slate-100" />
          <div className="h-44 animate-pulse rounded-[24px] bg-slate-100" />
          <div className="h-44 animate-pulse rounded-[24px] bg-slate-100" />
        </div>
      ) : error ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">{error}</div>
      ) : (
        <>
          <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-4">
              <div className="space-y-2">
                <h2 className="text-base font-semibold text-slate-900">接入地址</h2>
                <p className="text-sm leading-6 text-slate-500">
                  默认留空即可，系统会按你当前访问本服务时的地址生成 Header。只有在你需要固定域名、端口，或希望用户统一通过某个外部地址访问时，再手动填写。
                </p>
              </div>

              <label className="flex w-full flex-col gap-2 text-sm text-slate-700">
                <span className="font-medium text-slate-900">手动覆盖地址（可选）</span>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                  placeholder={suggestedPublicBaseURL || window.location.origin}
                  value={publicBaseURLInput}
                  onChange={(event) => setPublicBaseURLInput(event.target.value)}
                  type="text"
                />
              </label>

              <p className="text-sm leading-6 text-slate-500">
                {publicBaseURL
                  ? `当前已固定为：${publicBaseURL}`
                  : `留空时将使用：${suggestedPublicBaseURL || window.location.origin}`}
              </p>

              <div className="flex flex-wrap gap-3">
                <button
                  className="button"
                  disabled={savingAddress}
                  onClick={() => void saveIntegrationSettings(publicBaseURLInput, guestReadEnabledInput)}
                  type="button"
                >
                  {savingAddress ? "保存中…" : "保存"}
                </button>
                <button
                  className="button ghost"
                  disabled={savingAddress}
                  onClick={() => void saveIntegrationSettings("", false)}
                  type="button"
                >
                  恢复默认
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-4">
              <div className="space-y-2">
                <h2 className="text-base font-semibold text-slate-900">游客只读</h2>
                <p className="text-sm leading-6 text-slate-500">
                  只影响 Komari 注入弹窗。开启后，Komari 游客在节点本身公开时可查看当前结果；关闭后，游客点击按钮只会收到提示。
                </p>
              </div>

              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                <input
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={guestReadEnabledInput}
                  onChange={(event) => setGuestReadEnabledInput(event.target.checked)}
                  type="checkbox"
                />
                <span className="space-y-1">
                  <span className="block font-medium text-slate-900">允许游客查看已接入节点的当前结果</span>
                  <span className="block text-slate-500">默认关闭。管理员链路和后台页面不受影响。</span>
                </span>
              </label>
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="section-head">
              <div>
                <h2>推荐方案：loader 版</h2>
                <p className="muted">推荐优先使用 loader 版，后续更新通常不需要重新复制整段代码。</p>
              </div>
              <button className="button" onClick={() => void handleCopy(loaderCode, "短 loader 版代码已复制。")} type="button">
                复制 loader 版
              </button>
            </div>
            <pre className="code-block code-block-compact">{loaderCode}</pre>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="section-head">
              <div>
                <h2>完整内联版</h2>
                <p className="muted">只有在你明确不想依赖 loader 时再使用。逻辑更新后需要重新复制。</p>
              </div>
              <button className="button ghost" onClick={() => void handleCopy(inlineCode, "完整内联版代码已复制。")} type="button">
                复制完整内联版
              </button>
            </div>
            <pre className="code-block code-block-compact">{inlineCode}</pre>
          </section>
        </>
      )}
    </section>
  );
}

function AdminPage(props: { me: MeResponse; onUnauthorized: () => void }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState(props.me.username ?? "admin");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiRequest("/admin/profile", {
        method: "PUT",
        body: JSON.stringify({ username: username.trim(), password })
      });
      window.alert("管理员信息已保存，请重新登录。");
      navigate("/login", { replace: true });
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存管理员设置失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader title="管理员设置" subtitle="修改登录账号和密码。" />

      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="summary-section">
          <div className="summary-head">
            <strong>当前管理员</strong>
            <span className="chip">单管理员模式</span>
          </div>
          <div className="muted">当前登录账号：{props.me.username ?? "admin"}。修改后会要求重新登录。</div>
        </div>

        <form className="section space-y-4" onSubmit={handleSave}>
          <label className="grid gap-2 text-sm text-slate-700">
            <span>新用户名</span>
            <input
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm text-slate-700">
            <span>新密码</span>
            <input
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              type="password"
              placeholder="留空表示不修改密码"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div>
            <button className="button" type="submit" disabled={saving}>
              {saving ? "保存中..." : "保存并重新登录"}
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}

function EmbedAdminAccessBridge() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const match = location.pathname.match(/^\/nodes\/([^/]+)$/);
  const uuid = match?.[1] ?? "";
  const nodeName = searchParams.get("node_name")?.trim() || "未命名节点";
  const komariReturn = searchParams.get("komari_return")?.trim() || "";

  if (!uuid || !komariReturn) {
    return (
      <section className="space-y-6">
        <PageHeader title="需要登录" subtitle="当前嵌入视图无法直接继续。" />
        <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm leading-6 text-slate-500">请在独立页面登录后重试。</p>
        </section>
      </section>
    );
  }

  return (
    <EmbedBridgePage
      title="需要登录"
      description="当前管理员链路需要先在独立页面完成登录。"
      actionURL={buildConnectPath(uuid, nodeName, { returnTo: komariReturn, resumePopup: true })}
    />
  );
}

function AppShell(props: { me: MeResponse; onLogout: () => Promise<void>; onUnauthorized: () => void }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";

  const content = (
    <Routes>
      <Route path="/" element={<Navigate to="/nodes" replace />} />
      <Route path="/connect" element={<ConnectPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes" element={<NodesPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid" element={<NodeDetailPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/history" element={<Navigate to=".." relative="path" replace />} />
      <Route path="/nodes/:uuid/changes" element={<Navigate to=".." relative="path" replace />} />
      <Route path="/settings/integration" element={<IntegrationPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/settings/fields" element={<Navigate to="/nodes" replace />} />
      <Route
        path="/settings/admin"
        element={<AdminPage me={props.me} onUnauthorized={props.onUnauthorized} />}
      />
      <Route path="*" element={<Navigate to="/nodes" replace />} />
    </Routes>
  );

  if (isEmbed) {
    return (
      <div className="embed-shell bg-slate-50 text-slate-900">
        <div className="embed-panel mx-auto max-w-[1120px] space-y-6">{content}</div>
      </div>
    );
  }

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
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Komari IP Quality</p>
              <p className="text-sm text-slate-500">{routeLabel(location.pathname)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
          <div className="space-y-6 px-6 pb-8 lg:px-8">{content}</div>
        </main>
      </div>
    </div>
  );
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";

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
      <Route path="/public/nodes/:uuid" element={<PublicNodeDetailPage />} />
      <Route
        path="/login"
        element={<LoginPage me={me} onAuthenticated={(nextMe) => setMe(nextMe)} />}
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
              }}
            />
          ) : (
            isEmbed ? (
              <EmbedAdminAccessBridge />
            ) : (
              <Navigate to={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`} replace />
            )
          )
        }
      />
    </Routes>
  );
}
