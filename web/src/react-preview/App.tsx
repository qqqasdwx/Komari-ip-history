import {
  ArrowLeftIcon,
  Cross2Icon,
  ExitIcon,
  GearIcon,
  PlusIcon,
  ReloadIcon,
  RowsIcon
} from "@radix-ui/react-icons";
import { Fragment, type DragEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
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
import { renderDisplayValueBadge } from "./lib/display-fields";
import { formatDateTime } from "./lib/format";
import { buildHistoryCompareRows, mapDisplayPathToReportPaths } from "./lib/history";
import { CurrentReportView } from "./lib/report";
import type {
  DisplayFieldValue,
  HistoryRetentionSettings,
  IntegrationSettings,
  MeResponse,
  NodeDetail,
  NodeReportConfigPreview,
  NodeHistoryChangeEventPage,
  NodeHistoryDetailResponse,
  NodeHistoryEntry,
  NodeHistoryFieldOptionList,
  NodeHistoryListResponse,
  NodeListItem,
  NodeTargetListItem,
  PublicNodeDetail,
  PublicTargetListItem,
  RuntimeResponse
} from "./lib/types";

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
};

const standaloneAppBase = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;
const githubRawInstallScriptURL = "https://raw.githubusercontent.com/qqqasdwx/Komari-ip-history/master/deploy/install.sh";

const nodeNavItems: NavItem[] = [{ to: "/nodes", label: "节点结果", icon: <RowsIcon /> }];

const settingsNavItems: NavItem[] = [
  { to: "/settings/integration", label: "接入配置", icon: <GearIcon /> },
  { to: "/settings/history-retention", label: "历史保留", icon: <GearIcon /> },
  { to: "/settings/user", label: "用户", icon: <GearIcon /> }
];

const historyDateRangePresets = [
  {
    label: "今天",
    resolve() {
      const now = new Date();
      return {
        startDate: formatDateTimeInputValue(startOfDay(now)),
        endDate: formatDateTimeInputValue(endOfDay(now))
      };
    }
  },
  {
    label: "近 7 天",
    resolve() {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 6);
      return {
        startDate: formatDateTimeInputValue(startOfDay(start)),
        endDate: formatDateTimeInputValue(endOfDay(end))
      };
    }
  },
  {
    label: "本周",
    resolve() {
      const start = new Date();
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return {
        startDate: formatDateTimeInputValue(startOfDay(start)),
        endDate: formatDateTimeInputValue(endOfDay(end))
      };
    }
  },
  {
    label: "近 30 天",
    resolve() {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 29);
      return {
        startDate: formatDateTimeInputValue(startOfDay(start)),
        endDate: formatDateTimeInputValue(endOfDay(end))
      };
    }
  },
  {
    label: "本月",
    resolve() {
      const end = new Date();
      const start = new Date(end.getFullYear(), end.getMonth(), 1);
      const monthEnd = new Date(end.getFullYear(), end.getMonth() + 1, 0);
      return {
        startDate: formatDateTimeInputValue(startOfDay(start)),
        endDate: formatDateTimeInputValue(endOfDay(monthEnd))
      };
    }
  }
];

function formatByteSize(bytes: number) {
  const value = Number.isFinite(bytes) ? Math.max(bytes, 0) : 0;
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let current = value / 1024;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(current >= 100 ? 0 : current >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatRetentionDays(days: number) {
  if (days === -1) {
    return "永久保留";
  }
  return `保留最近 ${days} 天`;
}

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(23, 59, 59, 0);
  return next;
}

function padDateTimePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateTimeInputValue(value: Date) {
  const year = value.getFullYear();
  const month = padDateTimePart(value.getMonth() + 1);
  const day = padDateTimePart(value.getDate());
  const hours = padDateTimePart(value.getHours());
  const minutes = padDateTimePart(value.getMinutes());
  const seconds = padDateTimePart(value.getSeconds());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function formatDateTimeDisplayValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace("T", " ");
}

function describeHistoryDateRange(startDate: string, endDate: string) {
  if (!startDate && !endDate) {
    return "全部时间";
  }
  if (startDate && endDate) {
    return `${formatDateTimeDisplayValue(startDate)} ~ ${formatDateTimeDisplayValue(endDate)}`;
  }
  if (startDate) {
    return `${formatDateTimeDisplayValue(startDate)} 起`;
  }
  return `${formatDateTimeDisplayValue(endDate)} 止`;
}

function routeLabel(pathname: string) {
  if (pathname === "/nodes") {
    return "节点结果";
  }
  if (pathname.startsWith("/nodes/")) {
    if (pathname.endsWith("/compare")) {
      return "快照对比";
    }
    if (pathname.endsWith("/history")) {
      return "历史记录";
    }
    return "节点详情";
  }
  if (pathname === "/settings/integration") {
    return "接入配置";
  }
  if (pathname === "/settings/history-retention") {
    return "历史保留";
  }
  if (pathname === "/settings/user" || pathname === "/settings/admin") {
    return "用户";
  }
  return "工作区";
}

async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("copy command failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

function useNodePageData(uuid: string, targetID: number | null, onUnauthorized: () => void, debugDelayMS?: number | null) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const detailRef = useRef<NodeDetail | null>(null);

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uuid) {
        setError("节点不存在");
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const currentDetail = detailRef.current;
      const refreshInPlace = currentDetail !== null && currentDetail.komari_node_uuid === uuid;
      if (refreshInPlace) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError("");
      setErrorStatus(null);

      try {
        const query = new URLSearchParams();
        if (targetID) {
          query.set("target_id", String(targetID));
        }
        if (debugDelayMS && debugDelayMS > 0) {
          query.set("debug_delay_ms", String(debugDelayMS));
        }
        const detailPath = `/nodes/${uuid}${query.size > 0 ? `?${query.toString()}` : ""}`;
        const detailResponse = await apiRequest<NodeDetail>(detailPath);

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
        const activeDetail = detailRef.current;
        if (!activeDetail || activeDetail.komari_node_uuid !== uuid) {
          setError(loadError instanceof Error ? loadError.message : "加载节点详情失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [debugDelayMS, onUnauthorized, reloadToken, targetID, uuid]);

  return {
    loading,
    refreshing,
    error,
    errorStatus,
    detail,
    reload: () => setReloadToken((value) => value + 1)
  };
}

function useNodeHistoryData(
  uuid: string,
  targetID: number | null,
  onUnauthorized: () => void,
  options?: { limit?: number; page?: number; pageSize?: number; startDate?: string; endDate?: string }
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [items, setItems] = useState<NodeHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(options?.pageSize ?? 20);
  const [totalPages, setTotalPages] = useState(0);
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
        if (targetID) {
          query.set("target_id", String(targetID));
        }
        if (options?.limit && options.limit > 0) {
          query.set("limit", String(options.limit));
        } else {
          query.set("page", String(options?.page && options.page > 0 ? options.page : 1));
          query.set("page_size", String(options?.pageSize && options.pageSize > 0 ? options.pageSize : 20));
        }
        if (options?.startDate?.trim()) {
          query.set("start_date", options.startDate.trim());
        }
        if (options?.endDate?.trim()) {
          query.set("end_date", options.endDate.trim());
        }
        const response = await apiRequest<NodeHistoryListResponse>(
          `/nodes/${uuid}/history${query.size > 0 ? `?${query.toString()}` : ""}`
        );

        if (cancelled) {
          return;
        }

        setItems(response.items ?? []);
        setTotal(response.total ?? 0);
        setPage(response.page ?? 1);
        setPageSize(response.page_size ?? (options?.pageSize ?? 20));
        setTotalPages(response.total_pages ?? 0);
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
        setError(loadError instanceof Error ? loadError.message : "加载历史记录失败");
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
  }, [onUnauthorized, options?.endDate, options?.limit, options?.page, options?.pageSize, options?.startDate, reloadToken, targetID, uuid]);

  return {
    loading,
    error,
    errorStatus,
    items,
    total,
    page,
    pageSize,
    totalPages,
    reload: () => setReloadToken((value) => value + 1)
  };
}

function useNodeHistoryDetailData(
  uuid: string,
  targetID: number | null,
  historyID: number | null,
  onUnauthorized: () => void,
  options?: { startDate?: string; endDate?: string }
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<NodeHistoryDetailResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uuid || !historyID) {
        setDetail(null);
        setError("");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const query = new URLSearchParams();
        if (targetID) {
          query.set("target_id", String(targetID));
        }
        if (options?.startDate?.trim()) {
          query.set("start_date", options.startDate.trim());
        }
        if (options?.endDate?.trim()) {
          query.set("end_date", options.endDate.trim());
        }
        const response = await apiRequest<NodeHistoryDetailResponse>(
          `/nodes/${uuid}/history/${historyID}${query.size > 0 ? `?${query.toString()}` : ""}`
        );
        if (cancelled) {
          return;
        }
        setDetail(response);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载历史快照失败");
        setDetail(null);
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
  }, [historyID, onUnauthorized, options?.endDate, options?.startDate, targetID, uuid]);

  return { loading, error, detail };
}

function useAllNodeHistoryData(
  uuid: string,
  targetID: number | null,
  onUnauthorized: () => void,
  options?: { startDate?: string; endDate?: string }
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<NodeHistoryEntry[]>([]);
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
        const pageSize = 100;
        let page = 1;
        let totalPages = 1;
        const collected: NodeHistoryEntry[] = [];

        while (page <= totalPages) {
          const query = new URLSearchParams();
          if (targetID) {
            query.set("target_id", String(targetID));
          }
          query.set("page", String(page));
          query.set("page_size", String(pageSize));
          if (options?.startDate?.trim()) {
            query.set("start_date", options.startDate.trim());
          }
          if (options?.endDate?.trim()) {
            query.set("end_date", options.endDate.trim());
          }
          const response = await apiRequest<NodeHistoryListResponse>(
            `/nodes/${uuid}/history${query.size > 0 ? `?${query.toString()}` : ""}`
          );
          if (cancelled) {
            return;
          }
          collected.push(...(response.items ?? []));
          totalPages = response.total_pages ?? 0;
          if (totalPages <= 0) {
            break;
          }
          page += 1;
        }

        if (cancelled) {
          return;
        }

        setItems(collected);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载历史记录失败");
        setItems([]);
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
  }, [onUnauthorized, options?.endDate, options?.startDate, reloadToken, targetID, uuid]);

  return {
    loading,
    error,
    items,
    reload: () => setReloadToken((value) => value + 1)
  };
}

function useNodeHistoryEvents(
  uuid: string,
  targetID: number | null,
  fieldID: string,
  onUnauthorized: () => void,
  options?: { page?: number; pageSize?: number; startDate?: string; endDate?: string }
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<NodeHistoryChangeEventPage["items"]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(options?.pageSize ?? 10);
  const [totalPages, setTotalPages] = useState(0);
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
        const query = new URLSearchParams();
        if (targetID) {
          query.set("target_id", String(targetID));
        }
        if (fieldID.trim()) {
          query.set("field", fieldID.trim());
        }
        query.set("page", String(options?.page && options.page > 0 ? options.page : 1));
        query.set("page_size", String(options?.pageSize && options.pageSize > 0 ? options.pageSize : 10));
        if (options?.startDate?.trim()) {
          query.set("start_date", options.startDate.trim());
        }
        if (options?.endDate?.trim()) {
          query.set("end_date", options.endDate.trim());
        }
        const response = await apiRequest<NodeHistoryChangeEventPage>(`/nodes/${uuid}/history/events?${query.toString()}`);
        if (cancelled) {
          return;
        }
        setItems(response.items ?? []);
        setTotal(response.total ?? 0);
        setPage(response.page ?? 1);
        setPageSize(response.page_size ?? (options?.pageSize ?? 10));
        setTotalPages(response.total_pages ?? 0);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载历史变化失败");
        setItems([]);
        setTotal(0);
        setPage(1);
        setTotalPages(0);
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
  }, [fieldID, onUnauthorized, options?.endDate, options?.page, options?.pageSize, options?.startDate, reloadToken, targetID, uuid]);

  return {
    loading,
    error,
    items,
    total,
    page,
    pageSize,
    totalPages,
    reload: () => setReloadToken((value) => value + 1)
  };
}

function useNodeHistoryFieldOptions(
  uuid: string,
  targetID: number | null,
  onUnauthorized: () => void,
  options?: { startDate?: string; endDate?: string }
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Array<{ id: string; label: string }>>([]);
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
        const query = new URLSearchParams();
        if (targetID) {
          query.set("target_id", String(targetID));
        }
        if (options?.startDate?.trim()) {
          query.set("start_date", options.startDate.trim());
        }
        if (options?.endDate?.trim()) {
          query.set("end_date", options.endDate.trim());
        }
        const response = await apiRequest<NodeHistoryFieldOptionList>(`/nodes/${uuid}/history/fields?${query.toString()}`);
        if (cancelled) {
          return;
        }
        setItems(response.items ?? []);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载字段筛选失败");
        setItems([]);
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
  }, [onUnauthorized, options?.endDate, options?.startDate, reloadToken, targetID, uuid]);

  return {
    loading,
    error,
    items,
    reload: () => setReloadToken((value) => value + 1)
  };
}

function usePublicNodePageData(uuid: string, targetID: number | null, displayIP: string) {
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
        if (targetID) {
          query.set("target_id", String(targetID));
        }
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
  }, [displayIP, reloadToken, targetID, uuid]);

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
        <p className="text-sm leading-6 text-slate-500">正在打开独立页面继续处理。</p>
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

function NodesPage(props: { me: MeResponse; onUnauthorized: () => void }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nodes, setNodes] = useState<NodeListItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [reportConfigNodeUUID, setReportConfigNodeUUID] = useState("");

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
      {reportConfigNodeUUID ? (
        <NodeReportConfigDialog
          me={props.me}
          nodeUUID={reportConfigNodeUUID}
          onClose={() => setReportConfigNodeUUID("")}
          onUnauthorized={props.onUnauthorized}
        />
      ) : null}
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
              <span className="text-center">状态</span>
              <span className="text-center">最近更新</span>
              <span className="text-center">操作</span>
            </div>
            <div className="react-node-list-body">
              {nodes.map((item) => (
                <div
                  key={item.komari_node_uuid}
                  className="react-node-list-row cursor-pointer border-t border-slate-200 px-4 py-4 text-sm text-slate-700 transition hover:bg-slate-50 first:border-t-0"
                  data-node-row="true"
                  data-node-uuid={item.komari_node_uuid}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(`/nodes/${item.komari_node_uuid}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/nodes/${item.komari_node_uuid}`);
                    }
                  }}
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-sm font-semibold text-slate-900" data-node-name="true">
                      {item.name}
                    </strong>
                  </div>
                  <div className="flex min-w-0 justify-center">
                    <StatusPill hasData={item.has_data} />
                  </div>
                  <div className="min-w-0 text-center text-sm text-slate-500">{formatDateTime(item.updated_at ?? undefined)}</div>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      aria-label="上报设置"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
                      data-node-report-settings="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        setReportConfigNodeUUID(item.komari_node_uuid);
                      }}
                      type="button"
                    >
                      <GearIcon />
                    </button>
                    <span className="text-sm font-semibold text-indigo-600">查看</span>
                  </div>
                </div>
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

function resolvePublicBaseURL(me: MeResponse) {
  const publicBaseURL = (me.public_base_url ?? "").replace(/\/$/, "");
  return publicBaseURL || window.location.origin;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildInstallCommand(
  publicBaseURL: string,
  reporterToken: string,
  nodeUUID: string
) {
  const args = [
    "--node-uuid",
    nodeUUID,
    "--server",
    publicBaseURL,
    "--token",
    reporterToken
  ];
  const argString = args.map(shellQuote).join(" ");
  return `curl -fsSL ${shellQuote(githubRawInstallScriptURL)} | ( if [ "$(id -u)" -eq 0 ]; then bash -s -- ${argString}; elif command -v sudo >/dev/null 2>&1; then sudo bash -s -- ${argString}; else echo "Please run as root or install sudo." >&2; exit 1; fi )`;
}

function ReportConfigSection(props: {
  me: MeResponse;
  detail: NodeDetail;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  targetInput: string;
  targetError: string;
  targetSaving: boolean;
  onTargetInputChange: (value: string) => void;
  onAddTarget: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteCurrentTarget: (targetID: number) => void;
  onSelectTarget: (targetID: number) => void;
  onReorderTargets: (sourceID: number, destinationID: number) => void;
}) {
  const publicBaseURL = resolvePublicBaseURL(props.me);
  const [scheduleCron, setScheduleCron] = useState(props.detail.report_config.schedule_cron);
  const [runImmediately, setRunImmediately] = useState(props.detail.report_config.run_immediately);
  const [preview, setPreview] = useState<NodeReportConfigPreview>({
    schedule_cron: props.detail.report_config.schedule_cron,
    run_immediately: props.detail.report_config.run_immediately,
    next_runs: props.detail.report_config.next_runs
  });
  const [previewError, setPreviewError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [persistedConfig, setPersistedConfig] = useState({
    scheduleCron: props.detail.report_config.schedule_cron,
    runImmediately: props.detail.report_config.run_immediately
  });
  const installCommand = buildInstallCommand(
    publicBaseURL,
    props.detail.report_config.reporter_token,
    props.detail.komari_node_uuid
  );

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setScheduleCron(props.detail.report_config.schedule_cron);
    setRunImmediately(props.detail.report_config.run_immediately);
    setPreview({
      schedule_cron: props.detail.report_config.schedule_cron,
      run_immediately: props.detail.report_config.run_immediately,
      next_runs: props.detail.report_config.next_runs
    });
    setPersistedConfig({
      scheduleCron: props.detail.report_config.schedule_cron,
      runImmediately: props.detail.report_config.run_immediately
    });
    setPreviewError("");
    setSaveError("");
    setSaveState("idle");
  }, [
    props.open,
    props.detail.report_config.next_runs,
    props.detail.report_config.run_immediately,
    props.detail.report_config.schedule_cron
  ]);

  useEffect(() => {
    if (!props.open) {
      return undefined;
    }
    const controller = new AbortController();
    const timeoutID = window.setTimeout(async () => {
      try {
        const search = new URLSearchParams();
        search.set("cron", scheduleCron);
        search.set("run_immediately", runImmediately ? "1" : "0");
        const data = await apiRequest<NodeReportConfigPreview>(`/nodes/${props.detail.komari_node_uuid}/report-config/preview?${search.toString()}`, {
          signal: controller.signal
        });
        setPreview(data);
        setPreviewError("");
      } catch (error) {
        if (error instanceof RequestError) {
          setPreviewError(error.message || "Cron 表达式无效。");
          return;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPreviewError("无法预览当前计划。");
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeoutID);
    };
  }, [props.detail.komari_node_uuid, props.open, runImmediately, scheduleCron]);

  useEffect(() => {
    if (!props.open || previewError) {
      return undefined;
    }
    const normalizedCron = preview.schedule_cron.trim();
    if (
      normalizedCron === persistedConfig.scheduleCron &&
      runImmediately === persistedConfig.runImmediately
    ) {
      return undefined;
    }

    let cancelled = false;
    const timeoutID = window.setTimeout(async () => {
      setSaveState("saving");
      setSaveError("");
      try {
        const config = await apiRequest<NodeDetail["report_config"]>(`/nodes/${props.detail.komari_node_uuid}/report-config`, {
          method: "PUT",
          body: JSON.stringify({
            schedule_cron: normalizedCron,
            run_immediately: runImmediately
          })
        });
        if (cancelled) {
          return;
        }
        setPersistedConfig({
          scheduleCron: config.schedule_cron,
          runImmediately: config.run_immediately
        });
        setScheduleCron(config.schedule_cron);
        setRunImmediately(config.run_immediately);
        setPreview({
          schedule_cron: config.schedule_cron,
          run_immediately: config.run_immediately,
          next_runs: config.next_runs
        });
        setSaveState("saved");
        props.onSaved();
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof RequestError) {
          setSaveError(error.message || "保存失败。");
        } else {
          setSaveError("保存失败。");
        }
        setSaveState("idle");
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutID);
    };
  }, [
    persistedConfig.runImmediately,
    persistedConfig.scheduleCron,
    preview.schedule_cron,
    previewError,
    props.detail.komari_node_uuid,
    props.onSaved,
    props.open,
    runImmediately
  ]);

  async function handleCopy(value: string, successText: string) {
    try {
      await copyText(value);
      window.alert(successText);
    } catch {
      window.alert("复制失败，请手动复制。");
    }
  }

  if (!props.open) {
    return null;
  }

  return (
    <div className="field-modal-backdrop" onClick={props.onClose}>
      <section
        className="field-modal report-config-modal"
        data-node-report-config="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="field-modal-head">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">节点上报设置</h2>
            <p className="text-sm text-slate-500">统一管理目标 IP、执行计划和接入命令。</p>
          </div>
          <button className="button ghost" onClick={props.onClose} type="button">
            关闭
          </button>
        </div>
        <div className="field-modal-body">
        <div className="space-y-1">
          {props.detail.report_config.target_ips.length > 0 ? (
            <p className="text-sm text-slate-500">当前命令会顺序探查以下 IP，并逐个上报结果。</p>
          ) : (
            <p className="text-sm text-slate-500">请先添加目标 IP，添加后才会生成接入命令。</p>
          )}
        </div>
        <div className="space-y-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">目标 IP</h3>
              <p className="text-sm text-slate-500">拖拽可调整顺序，接入命令会按当前顺序依次探查。</p>
            </div>
          </div>
          {props.detail.targets.length > 0 ? (
            <TargetTabs
              items={props.detail.targets.map((item) => ({ id: item.id, label: item.ip, has_data: item.has_data }))}
              onDelete={(targetID) => void props.onDeleteCurrentTarget(targetID)}
              onReorder={(sourceID, destinationID) => void props.onReorderTargets(sourceID, destinationID)}
              onSelect={(targetID) => props.onSelectTarget(targetID)}
              selectedId={props.detail.selected_target_id ?? props.detail.current_target?.id ?? null}
            />
          ) : (
            <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
              当前节点还没有目标 IP，请先添加。
            </div>
          )}
          <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_48px]" onSubmit={props.onAddTarget}>
            <label className="grid min-w-0 gap-2 text-sm text-slate-700">
              <input
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                onChange={(event) => props.onTargetInputChange(event.target.value)}
                placeholder="例如 1.1.1.1 或 2606:4700:4700::1111"
                value={props.targetInput}
              />
            </label>
            <button
              aria-label="添加 IP"
              className="inline-flex h-11 w-12 items-center justify-center rounded-xl bg-indigo-500 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-indigo-300"
              disabled={props.targetSaving || !props.targetInput.trim()}
              type="submit"
            >
              <PlusIcon />
            </button>
          </form>
          {props.targetError ? <p className="text-sm text-rose-600">{props.targetError}</p> : null}
        </div>
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium text-slate-900">Cron</span>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              onChange={(event) => setScheduleCron(event.target.value)}
              placeholder="0 0 * * *"
              spellCheck={false}
              value={scheduleCron}
            />
            <p className="text-xs text-slate-500">默认每天 0 点执行，使用标准 5 段 cron 表达式。</p>
          </label>
          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium text-slate-900">安装后立即执行一次</span>
            <span className="flex h-11 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input checked={runImmediately} onChange={(event) => setRunImmediately(event.target.checked)} type="checkbox" />
              <span>启用</span>
            </span>
          </label>
        </div>
        {previewError ? <p className="text-sm font-medium text-rose-600">{previewError}</p> : null}
        {!previewError && saveError ? <p className="text-sm font-medium text-rose-600">{saveError}</p> : null}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm text-slate-900">最近 10 次执行时间</strong>
            <span className="text-xs text-slate-500">
              {previewError ? "请先修正 Cron" : saveState === "saving" ? "正在保存…" : saveState === "saved" ? "已自动保存" : "自动保存"}
            </span>
          </div>
          <div className="report-config-next-runs">
            {preview.next_runs.map((value) => (
              <div key={value} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {formatDateTime(value)}
              </div>
            ))}
          </div>
        </div>
        {props.detail.report_config.target_ips.length > 0 ? (
          <>
            <div className="summary-section">
              <div className="summary-head">
                <strong>接入命令</strong>
                <button
                  className="button ghost"
                  disabled={previewError !== ""}
                  onClick={() => void handleCopy(installCommand, "接入命令已复制。")}
                  type="button"
                >
                  复制
                </button>
              </div>
              <pre className="code-block report-config-command">{installCommand}</pre>
            </div>
          </>
        ) : null}
        </div>
      </section>
    </div>
  );
}

function NodeReportConfigDialog(props: {
  me: MeResponse;
  nodeUUID: string;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [selectedTargetID, setSelectedTargetID] = useState<number | null>(null);
  const [targetInput, setTargetInput] = useState("");
  const [targetError, setTargetError] = useState("");
  const [targetSaving, setTargetSaving] = useState(false);
  const { loading, error, detail, reload } = useNodePageData(props.nodeUUID, selectedTargetID, props.onUnauthorized);
  const [localDetail, setLocalDetail] = useState<NodeDetail | null>(null);

  useEffect(() => {
    setSelectedTargetID(null);
    setTargetInput("");
    setTargetError("");
  }, [props.nodeUUID]);

  useEffect(() => {
    setLocalDetail(detail);
  }, [detail]);

  async function handleAddTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTargetSaving(true);
    setTargetError("");
    try {
      const created = await apiRequest<NodeTargetListItem>(`/nodes/${props.nodeUUID}/targets`, {
        method: "POST",
        body: JSON.stringify({ ip: targetInput.trim() })
      });
      setTargetInput("");
      setSelectedTargetID(created.id);
      setLocalDetail((current) =>
        current
          ? {
              ...current,
              targets: [...current.targets, created].sort((a, b) => a.sort_order - b.sort_order),
              selected_target_id: created.id
            }
          : current
      );
      reload();
    } catch (targetCreateError) {
      if (targetCreateError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setTargetError(targetCreateError instanceof Error ? targetCreateError.message : "添加目标 IP 失败");
    } finally {
      setTargetSaving(false);
    }
  }

  async function handleDeleteTarget(targetID: number) {
    const previousDetail = localDetail;
    setTargetSaving(true);
    setTargetError("");
    try {
      setLocalDetail((current) => {
        if (!current) {
          return current;
        }
        const nextTargets = current.targets.filter((item) => item.id !== targetID);
        const nextSelectedTargetID =
          current.selected_target_id === targetID
            ? nextTargets[0]?.id ?? null
            : current.selected_target_id ?? nextTargets[0]?.id ?? null;
        const nextCurrentTarget =
          current.current_target?.id === targetID
            ? null
            : current.current_target && nextTargets.some((item) => item.id === current.current_target?.id)
              ? current.current_target
              : null;
        return {
          ...current,
          targets: nextTargets,
          selected_target_id: nextSelectedTargetID,
          current_target: nextCurrentTarget,
          report_config: {
            ...current.report_config,
            target_ips: nextTargets.map((item) => item.ip)
          }
        };
      });
      setSelectedTargetID((current) => (current === targetID ? null : current));
      await apiRequest(`/nodes/${props.nodeUUID}/targets/${targetID}`, { method: "DELETE" });
    } catch (targetDeleteError) {
      setLocalDetail(previousDetail);
      if (targetDeleteError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setTargetError(targetDeleteError instanceof Error ? targetDeleteError.message : "删除目标 IP 失败");
    } finally {
      setTargetSaving(false);
    }
  }

  async function handleReorderTargets(sourceID: number, destinationID: number) {
    if (!localDetail) {
      return;
    }

    const orderedIDs = localDetail.targets.map((item) => item.id);
    const sourceIndex = orderedIDs.indexOf(sourceID);
    const destinationIndex = orderedIDs.indexOf(destinationID);
    if (sourceIndex === -1 || destinationIndex === -1 || sourceIndex === destinationIndex) {
      return;
    }

    const next = [...orderedIDs];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(destinationIndex, 0, moved);

    setTargetSaving(true);
    setTargetError("");
    try {
      setLocalDetail((current) => {
        if (!current) {
          return current;
        }
        const targetMap = new Map(current.targets.map((item) => [item.id, item]));
        const reorderedTargets = next
          .map((id, index) => {
            const item = targetMap.get(id);
            if (!item) {
              return null;
            }
            return { ...item, sort_order: index };
          })
          .filter((item): item is NodeTargetListItem => item !== null);
        return {
          ...current,
          targets: reorderedTargets,
          report_config: {
            ...current.report_config,
            target_ips: reorderedTargets.map((item) => item.ip)
          }
        };
      });
      await apiRequest(`/nodes/${props.nodeUUID}/targets/reorder`, {
        method: "POST",
        body: JSON.stringify({ target_ids: next })
      });
    } catch (reorderError) {
      setLocalDetail(detail);
      if (reorderError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setTargetError(reorderError instanceof Error ? reorderError.message : "调整目标 IP 顺序失败");
    } finally {
      setTargetSaving(false);
    }
  }

  if (loading && !localDetail) {
    return (
      <div className="field-modal-backdrop" onClick={props.onClose}>
        <section className="field-modal report-config-modal" onClick={(event) => event.stopPropagation()}>
          <div className="field-modal-head">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900">节点上报设置</h2>
              <p className="text-sm text-slate-500">正在加载当前节点配置。</p>
            </div>
            <button className="button ghost" onClick={props.onClose} type="button">
              关闭
            </button>
          </div>
          <div className="field-modal-body">
            <div className="grid gap-3">
              <div className="h-12 animate-pulse rounded-2xl bg-slate-100" />
              <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
              <div className="h-28 animate-pulse rounded-2xl bg-slate-100" />
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (error || !localDetail) {
    return (
      <div className="field-modal-backdrop" onClick={props.onClose}>
        <section className="field-modal report-config-modal" onClick={(event) => event.stopPropagation()}>
          <div className="field-modal-head">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900">节点上报设置</h2>
              <p className="text-sm text-slate-500">加载失败，请重试。</p>
            </div>
            <button className="button ghost" onClick={props.onClose} type="button">
              关闭
            </button>
          </div>
          <div className="field-modal-body space-y-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
              {error || "加载节点上报设置失败。"}
            </div>
            <div>
              <button className="button" onClick={reload} type="button">
                重试
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <ReportConfigSection
      detail={localDetail}
      me={props.me}
      onAddTarget={handleAddTarget}
      onClose={props.onClose}
      onSaved={reload}
      onDeleteCurrentTarget={(targetID) => void handleDeleteTarget(targetID)}
      onReorderTargets={(sourceID, destinationID) => void handleReorderTargets(sourceID, destinationID)}
      onSelectTarget={(targetID) => setSelectedTargetID(targetID)}
      onTargetInputChange={setTargetInput}
      open={true}
      targetError={targetError}
      targetInput={targetInput}
      targetSaving={targetSaving}
    />
  );
}

function HistoryChangeFiltersBar(props: {
  startDate: string;
  endDate: string;
  targetOptions: Array<{ id: number; label: string }>;
  selectedTargetID: number | null;
  fieldOptions: Array<{ id: string; label: string }>;
  selectedFieldID: string;
  onApply: (next: { startDate: string; endDate: string }) => void;
  onTargetChange: (targetID: number | null) => void;
  onFieldChange: (fieldID: string) => void;
}) {
  const [startDate, setStartDate] = useState(props.startDate);
  const [endDate, setEndDate] = useState(props.endDate);
  const [rangeOpen, setRangeOpen] = useState(false);
  const rangePanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setStartDate(props.startDate);
  }, [props.startDate]);

  useEffect(() => {
    setEndDate(props.endDate);
  }, [props.endDate]);

  useEffect(() => {
    if (!rangeOpen) {
      return undefined;
    }
    function handlePointerDown(event: MouseEvent) {
      if (rangePanelRef.current && !rangePanelRef.current.contains(event.target as Node)) {
        setRangeOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [rangeOpen]);

  const selectedTargetLabel =
    props.selectedTargetID === null
      ? "所有 IP"
      : props.targetOptions.find((option) => option.id === props.selectedTargetID)?.label ?? "所有 IP";

  const selectedFieldLabel =
    props.selectedFieldID === ""
      ? "全部字段"
      : props.fieldOptions.find((option) => option.id === props.selectedFieldID)?.label ?? "全部字段";

  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 xl:grid-cols-[minmax(360px,1.8fr)_minmax(180px,220px)_minmax(220px,1fr)]">
        <div className="relative" ref={rangePanelRef}>
          <button
            data-history-range-trigger="true"
            className={[
              "flex h-11 w-full items-center justify-between rounded-xl border bg-white px-3 text-left text-sm outline-none transition focus:ring-2 focus:ring-indigo-100",
              rangeOpen || props.startDate || props.endDate
                ? "border-indigo-300 text-slate-900 focus:border-indigo-300"
                : "border-slate-200 text-slate-700 hover:border-indigo-300 focus:border-indigo-300"
            ].join(" ")}
            onClick={() => setRangeOpen((value) => !value)}
            type="button"
          >
            <span className="truncate">{describeHistoryDateRange(startDate, endDate)}</span>
            <span className="ml-3 shrink-0 text-slate-400">{rangeOpen ? "收起" : "展开"}</span>
          </button>
          {rangeOpen ? (
            <div className="absolute left-0 top-full z-20 mt-2 w-[min(720px,calc(100vw-8rem))] rounded-[18px] border border-slate-200 bg-white p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">选择时间范围</p>
                  <p className="text-xs text-slate-500">支持快捷范围，也可以手动指定开始和结束日期。</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-slate-700">
                  <span>开始日期</span>
                  <input
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    type="datetime-local"
                    step={1}
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm text-slate-700">
                  <span>结束日期</span>
                  <input
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    type="datetime-local"
                    step={1}
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {historyDateRangePresets.map((preset) => (
                  <button
                    key={preset.label}
                    className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
                    onClick={() => {
                      const next = preset.resolve();
                      setStartDate(next.startDate);
                      setEndDate(next.endDate);
                    }}
                    type="button"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
                  onClick={() => {
                    props.onApply({ startDate, endDate });
                    setRangeOpen(false);
                  }}
                  type="button"
                >
                  应用筛选
                </button>
                <button
                  className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                  onClick={() => {
                    setStartDate("");
                    setEndDate("");
                    props.onApply({ startDate: "", endDate: "" });
                    setRangeOpen(false);
                  }}
                  type="button"
                >
                  清空
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <label className="grid gap-2 text-sm text-slate-700">
          <select
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            value={props.selectedTargetID ?? ""}
            onChange={(event) => {
              const value = event.target.value.trim();
              props.onTargetChange(value ? Number(value) : null);
            }}
          >
            <option value="">所有 IP</option>
            {props.targetOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm text-slate-700">
          <select
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            value={props.selectedFieldID}
            onChange={(event) => props.onFieldChange(event.target.value)}
          >
            <option value="">全部字段</option>
            {props.fieldOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>当前筛选：</span>
        <span>时间 {describeHistoryDateRange(props.startDate, props.endDate)}</span>
        <span>IP {selectedTargetLabel}</span>
        <span>字段 {selectedFieldLabel}</span>
      </div>
    </div>
  );
}

function HistoryChangeList(props: {
  items: Array<{
    id: string;
    targetIP: string;
    groupPath: string[];
    fieldLabel: string;
    previous: { text: string; tone: string; missingKind?: "missing" };
    current: { text: string; tone: string; missingKind?: "missing" };
    recordedAt: string;
    previousRecordedAt: string;
  }>;
}) {
  if (props.items.length === 0) {
    return (
      <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
        当前筛选条件下没有历史变化。
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-200">
        {props.items.map((item) => (
          <div
            key={item.id}
            className="grid grid-cols-[160px_minmax(0,1fr)] gap-4 px-4 py-4"
            data-history-change-row="true"
          >
            <div className="pt-1 text-sm text-slate-500">{formatDateTime(item.recordedAt)}</div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm leading-6 text-slate-700">
                <span className="inline-flex min-h-7 items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-600">
                  {item.targetIP}
                </span>
                <span className="font-medium text-slate-900">
                  {[...item.groupPath, item.fieldLabel].filter(Boolean).join(" / ")}：
                </span>
                {renderDisplayValueBadge({
                  id: "",
                  path: "",
                  groupPath: [],
                  label: item.fieldLabel,
                  text: item.previous.text,
                  tone: item.previous.tone as "good" | "bad" | "warn" | "muted" | "neutral",
                  missingKind: item.previous.missingKind
                })}
                <span className="font-medium text-slate-300">-&gt;</span>
                {renderDisplayValueBadge({
                  id: "",
                  path: "",
                  groupPath: [],
                  label: item.fieldLabel,
                  text: item.current.text,
                  tone: item.current.tone as "good" | "bad" | "warn" | "muted" | "neutral",
                  missingKind: item.current.missingKind
                })}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                <span>旧值时间 {formatDateTime(item.previousRecordedAt)}</span>
                <span>新值时间 {formatDateTime(item.recordedAt)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryPagination(props: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const [jumpValue, setJumpValue] = useState(String(props.page));

  useEffect(() => {
    setJumpValue(String(props.page));
  }, [props.page]);

  if (props.totalPages <= 1) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">共 {props.total} 条变化记录。</p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">每页</span>
          <select
            className="h-9 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            value={props.pageSize}
            onChange={(event) => props.onPageSizeChange(Number(event.target.value))}
          >
            {[10, 20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">
        第 {props.page} / {props.totalPages} 页，共 {props.total} 条变化记录，每页 {props.pageSize} 条。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">每页</span>
        <select
          className="h-9 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          value={props.pageSize}
          onChange={(event) => props.onPageSizeChange(Number(event.target.value))}
        >
          {[10, 20, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <button
          className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => props.onPageChange(props.page - 1)}
          type="button"
          disabled={props.page <= 1}
        >
          上一页
        </button>
        <button
          className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => props.onPageChange(props.page + 1)}
          type="button"
          disabled={props.page >= props.totalPages}
        >
          下一页
        </button>
        <input
          className="h-9 w-20 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          value={jumpValue}
          onChange={(event) => setJumpValue(event.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
        />
        <button
          className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
          onClick={() => {
            const nextPage = Number.parseInt(jumpValue, 10);
            if (!Number.isNaN(nextPage) && nextPage >= 1 && nextPage <= props.totalPages) {
              props.onPageChange(nextPage);
            }
          }}
          type="button"
        >
          跳转
        </button>
      </div>
    </div>
  );
}

function HistoryDateFilterBar(props: {
  startDate: string;
  endDate: string;
  onApply: (startDate: string, endDate: string) => void;
}) {
  const [startDate, setStartDate] = useState(props.startDate);
  const [endDate, setEndDate] = useState(props.endDate);

  useEffect(() => {
    setStartDate(props.startDate);
  }, [props.startDate]);

  useEffect(() => {
    setEndDate(props.endDate);
  }, [props.endDate]);

  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-2 text-sm text-slate-700">
          <span>开始日期</span>
          <input
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm text-slate-700">
          <span>结束日期</span>
          <input
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
        <button
          className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
          onClick={() => props.onApply(startDate, endDate)}
          type="button"
        >
          应用筛选
        </button>
        <button
          className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
          onClick={() => props.onApply("", "")}
          type="button"
        >
          清空
        </button>
      </div>
    </div>
  );
}

function reportPathMatchesHighlight(nodePath: string, highlightPath: string) {
  return nodePath === highlightPath;
}

function CompareReportPane(props: {
  entry: NodeHistoryEntry;
  changedPaths: string[];
  favoriteSaving: boolean;
  onToggleFavorite: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const nodes = Array.from(containerRef.current.querySelectorAll<HTMLElement>("[data-field-path]"));
    for (const node of nodes) {
      const nodePath = node.dataset.fieldPath?.trim() || "";
      const highlighted = nodePath
        ? props.changedPaths.some((path) => reportPathMatchesHighlight(nodePath, path))
        : false;
      node.classList.toggle("report-compare-highlight", highlighted);
    }
  }, [props.changedPaths, props.entry.result]);

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">{formatDateTime(props.entry.recorded_at)}</h2>
          {props.entry.is_favorite ? (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              已收藏
            </span>
          ) : null}
        </div>
        <button
          className={[
            "inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition",
            props.entry.is_favorite
              ? "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300"
              : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-600"
          ].join(" ")}
          disabled={props.favoriteSaving}
          onClick={props.onToggleFavorite}
          type="button"
        >
          {props.favoriteSaving ? "处理中..." : props.entry.is_favorite ? "取消收藏" : "收藏快照"}
        </button>
      </div>
      <div ref={containerRef}>
        <CurrentReportView result={props.entry.result} hiddenPaths={[]} compact />
      </div>
    </section>
  );
}

function HistoryCompareEmptyState(props: { rows: ReturnType<typeof buildHistoryCompareRows> }) {
  if (props.rows.length === 0) {
    return (
      <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
        当前没有可对比的字段。
      </div>
    );
  }
  return null;
}

function parseRecordedAtTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatCompareSliderValue(value: number) {
  return formatDateTime(new Date(value).toISOString());
}

function clampCompareTimestamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function pickHistoryEntryAtOrBefore(items: NodeHistoryEntry[], timestamp: number) {
  let candidate = items[0] ?? null;
  for (const item of items) {
    const itemTimestamp = parseRecordedAtTimestamp(item.recorded_at);
    if (itemTimestamp <= timestamp) {
      candidate = item;
      continue;
    }
    break;
  }
  return candidate;
}

function CompareTimeline(props: {
  items: NodeHistoryEntry[];
  leftTimestamp: number;
  rightTimestamp: number;
  onLeftChange: (timestamp: number) => void;
  onRightChange: (timestamp: number) => void;
}) {
  const min = parseRecordedAtTimestamp(props.items[0]?.recorded_at ?? "");
  const max = parseRecordedAtTimestamp(props.items[props.items.length - 1]?.recorded_at ?? "");
  const span = Math.max(max - min, 1);
  const leftPercent = ((props.leftTimestamp - min) / span) * 100;
  const rightPercent = ((props.rightTimestamp - min) / span) * 100;
  const points = props.items.map((item) => {
    const timestamp = parseRecordedAtTimestamp(item.recorded_at);
    return {
      id: item.id,
      recordedAt: item.recorded_at,
      left: `${((timestamp - min) / span) * 100}%`,
      isFavorite: item.is_favorite
    };
  });

  return (
    <section className="compare-timeline-panel rounded-[18px] border border-slate-200 bg-slate-50 p-4">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">时间范围</h2>
            <p className="text-sm text-slate-500">
              首次上报：{formatDateTime(props.items[0]?.recorded_at)} · 最近上报：{formatDateTime(props.items[props.items.length - 1]?.recorded_at)}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="compare-timeline-point compare-timeline-point-legend" aria-hidden="true" />
            <span>普通快照</span>
            <span className="compare-timeline-point compare-timeline-point-favorite compare-timeline-point-legend" aria-hidden="true" />
            <span>已收藏</span>
          </div>
        </div>
        <div className="compare-timeline">
          <div className="compare-timeline-labels">
            <div className="compare-timeline-value" style={{ left: `${leftPercent}%` }}>
              {formatCompareSliderValue(props.leftTimestamp)}
            </div>
            <div className="compare-timeline-value compare-timeline-value-right" style={{ left: `${rightPercent}%` }}>
              {formatCompareSliderValue(props.rightTimestamp)}
            </div>
          </div>
          <div className="compare-timeline-track-wrap">
            <div className="compare-timeline-track" />
            <div className="compare-timeline-points" aria-hidden="true">
              {points.map((point) => (
                <span
                  key={point.id}
                  className={["compare-timeline-point", point.isFavorite ? "compare-timeline-point-favorite" : ""].filter(Boolean).join(" ")}
                  style={{ left: point.left }}
                  title={`${formatDateTime(point.recordedAt)}${point.isFavorite ? " · 已收藏" : ""}`}
                />
              ))}
            </div>
            <div
              className="compare-timeline-range"
              style={{
                left: `${Math.min(leftPercent, rightPercent)}%`,
                width: `${Math.max(rightPercent - leftPercent, 0)}%`
              }}
            />
            <input
              className="compare-timeline-input compare-timeline-input-left"
              type="range"
              min={min}
              max={max}
              step={1000}
              value={props.leftTimestamp}
              onChange={(event) => props.onLeftChange(clampCompareTimestamp(Number(event.target.value), min, props.rightTimestamp))}
            />
            <input
              className="compare-timeline-input compare-timeline-input-right"
              type="range"
              min={min}
              max={max}
              step={1000}
              value={props.rightTimestamp}
              onChange={(event) => props.onRightChange(clampCompareTimestamp(Number(event.target.value), props.leftTimestamp, max))}
            />
          </div>
          <div className="compare-timeline-ends">
            <span>{formatDateTime(props.items[0]?.recorded_at)}</span>
            <span>{formatDateTime(props.items[props.items.length - 1]?.recorded_at)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function TargetTabs(props: {
  items: Array<{ id: number; label: string; has_data: boolean }>;
  selectedId: number | null;
  onSelect: (targetID: number) => void;
  onReorder?: (sourceID: number, destinationID: number) => void;
  onDelete?: (targetID: number) => void;
  variant?: "default" | "attached";
}) {
  const [draggingTargetID, setDraggingTargetID] = useState<number | null>(null);
  const isAttached = props.variant === "attached";

  function handleDrop(destinationID: number) {
    if (!props.onReorder || draggingTargetID === null || draggingTargetID === destinationID) {
      setDraggingTargetID(null);
      return;
    }
    props.onReorder(draggingTargetID, destinationID);
    setDraggingTargetID(null);
  }

  return (
    <div className={isAttached ? "target-tabs target-tabs-attached" : "flex flex-wrap items-center gap-2"}>
      {props.items.map((item) => (
        <div key={item.id} className={isAttached ? "group relative target-tab-shell" : "group relative"}>
          <button
            className={[
              isAttached
                ? "target-tab-button target-tab-button-attached"
                : "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition",
              props.onDelete ? "pr-10" : "",
              props.selectedId === item.id
                ? isAttached
                  ? "is-active"
                  : "border-indigo-200 bg-indigo-50 text-indigo-600"
                : isAttached
                  ? ""
                  : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:text-indigo-600"
            ].join(" ")}
            draggable={Boolean(props.onReorder)}
            onClick={() => props.onSelect(item.id)}
            onDragOver={(event: DragEvent<HTMLButtonElement>) => {
              if (props.onReorder) {
                event.preventDefault();
              }
            }}
            onDragStart={() => setDraggingTargetID(item.id)}
            onDrop={() => handleDrop(item.id)}
            onDragEnd={() => setDraggingTargetID(null)}
            type="button"
          >
            <span
              className={[
                "inline-block h-2.5 w-2.5 rounded-full",
                item.has_data ? "bg-emerald-500" : "bg-slate-300"
              ].join(" ")}
            />
            <span>{item.label}</span>
          </button>
          {props.onDelete ? (
            <button
              aria-label={`删除 ${item.label}`}
              className={[
                "absolute inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600",
                isAttached ? "right-2 top-[18px]" : "right-2 top-1/2 -translate-y-1/2"
              ].join(" ")}
              onClick={(event) => {
                event.stopPropagation();
                void props.onDelete?.(item.id);
              }}
              type="button"
            >
              <Cross2Icon />
            </button>
          ) : null}
        </div>
      ))}
    </div>
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
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const komariReturn = searchParams.get("komari_return")?.trim() || "";
  const nodeName = searchParams.get("node_name")?.trim() || "未命名节点";
  const selectedTargetID = Number(searchParams.get("target_id") || "") || null;
  const debugDelayMS = Number(searchParams.get("debug_delay_ms") || "") || null;
  const { loading, refreshing, error, errorStatus, detail, reload } = useNodePageData(
    uuid,
    selectedTargetID,
    props.onUnauthorized,
    debugDelayMS
  );
  const [showDelayedRefreshing, setShowDelayedRefreshing] = useState(false);

  useEffect(() => {
    if (!refreshing) {
      setShowDelayedRefreshing(false);
      return undefined;
    }
    const timeoutID = window.setTimeout(() => setShowDelayedRefreshing(true), 180);
    return () => window.clearTimeout(timeoutID);
  }, [refreshing]);

  function replaceTargetSelection(targetID: number | null) {
    const params = new URLSearchParams(searchParams);
    if (targetID) {
      params.set("target_id", String(targetID));
    } else {
      params.delete("target_id");
    }
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }

  const historyPath = `/nodes/${uuid}/history`;

  if (loading && !detail) {
    return <NodeDetailLoading />;
  }

  if (isEmbed && errorStatus === 404 && komariReturn) {
    return (
      <EmbedBridgePage
        title="接入节点"
        description="当前节点尚未接入，正在打开独立页面继续。"
        actionURL={buildConnectPath(uuid, nodeName, { returnTo: komariReturn, resumePopup: true })}
      />
    );
  }

  if ((error && !detail) || !detail) {
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
        subtitle={detail.has_data ? `最近更新: ${formatDateTime(detail.updated_at ?? undefined)}` : "当前还没有任何 IP 结果"}
        backTo={isEmbed ? undefined : "/nodes"}
        actions={
          !isEmbed ? (
            <Link
              className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600"
              to={historyPath}
            >
              查看历史记录
            </Link>
          ) : undefined
        }
      />

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="section space-y-4">
          {detail.targets.length > 0 ? (
            <TargetTabs
              items={detail.targets.map((item) => ({ id: item.id, label: item.ip, has_data: item.has_data }))}
              selectedId={detail.selected_target_id ?? detail.current_target?.id ?? null}
              onSelect={(targetID) => replaceTargetSelection(targetID)}
              variant="attached"
            />
          ) : (
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              当前节点还没有目标 IP，请返回节点列表打开上报设置添加。
            </div>
          )}
        </div>

        {detail.current_target ? (
          <>
            <div className="section">
              <div className="detail-target-panel" data-detail-report="true">
                {showDelayedRefreshing ? (
                  <div className="flex min-h-[240px] items-center justify-center rounded-[20px] border border-slate-200 bg-slate-50 text-sm text-slate-500">
                    加载中…
                  </div>
                ) : (
                  <CurrentReportView
                    result={detail.current_target.current_result}
                    hiddenPaths={[]}
                    compact={isEmbed}
                  />
                )}
              </div>
            </div>
          </>
        ) : null}
      </section>
    </section>
  );
}

function NodeHistoryPage(props: { onUnauthorized: () => void }) {
  const { uuid = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const selectedTargetID = Number(searchParams.get("target_id") || "") || null;
  const historyPage = Number(searchParams.get("page") || "") || 1;
  const startDate = searchParams.get("start_date")?.trim() || "";
  const endDate = searchParams.get("end_date")?.trim() || "";
  const [selectedFieldID, setSelectedFieldID] = useState("");
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const { loading, error, detail, reload } = useNodePageData(uuid, selectedTargetID, props.onUnauthorized);
  const {
    loading: historyLoading,
    error: historyError,
    items: changeEvents,
    total: historyTotal,
    totalPages: historyTotalPages,
    reload: reloadHistory
  } = useNodeHistoryEvents(uuid, selectedTargetID, selectedFieldID, props.onUnauthorized, {
    page: historyPage,
    pageSize: historyPageSize,
    startDate,
    endDate
  });
  const {
    loading: fieldOptionsLoading,
    error: fieldOptionsError,
    items: fieldOptions,
    reload: reloadFieldOptions
  } = useNodeHistoryFieldOptions(uuid, selectedTargetID, props.onUnauthorized, {
    startDate,
    endDate
  });

  useEffect(() => {
    setSelectedFieldID("");
  }, [uuid, selectedTargetID, startDate, endDate]);

  function replaceSelection(nextTargetID: number | null, nextPage?: number | null, nextFilters?: { startDate?: string; endDate?: string }) {
    const params = new URLSearchParams(searchParams);
    if (nextTargetID) {
      params.set("target_id", String(nextTargetID));
    } else {
      params.delete("target_id");
    }
    if (nextPage && nextPage > 1) {
      params.set("page", String(nextPage));
    } else {
      params.delete("page");
    }
    const resolvedStartDate = nextFilters?.startDate ?? startDate;
    const resolvedEndDate = nextFilters?.endDate ?? endDate;
    if (resolvedStartDate.trim()) {
      params.set("start_date", resolvedStartDate.trim());
    } else {
      params.delete("start_date");
    }
    if (resolvedEndDate.trim()) {
      params.set("end_date", resolvedEndDate.trim());
    } else {
      params.delete("end_date");
    }
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }

  if (loading) {
    return <NodeDetailLoading />;
  }

  if (error || !detail) {
    return (
      <NodePageError
        title="历史记录"
        subtitle={error || "节点不存在"}
        backTo="/nodes"
        error={error || "节点不存在。"}
        onRetry={reload}
      />
    );
  }

  const detailBackTo = `/nodes/${uuid}${detail.current_target?.id ? `?target_id=${detail.current_target.id}` : ""}`;
  const compareTargetID = selectedTargetID ?? detail.current_target?.id ?? null;
  const historyPathForCompare = `/nodes/${uuid}/compare${compareTargetID ? `?target_id=${compareTargetID}` : ""}`;
  const currentHistoryPage = historyTotalPages > 0 ? Math.min(Math.max(historyPage, 1), historyTotalPages) : 1;
  const currentPageItems = changeEvents.map((item) => ({
    id: item.id,
    targetIP: item.target_ip,
    groupPath: item.group_path,
    fieldLabel: item.field_label,
    previous: item.previous,
    current: item.current,
    recordedAt: item.recorded_at,
    previousRecordedAt: item.previous_recorded_at
  }));
  const historyLoadError = historyError || fieldOptionsError;

  return (
    <section className="space-y-6">
      <PageHeader
        title={`${detail.name} 历史记录`}
        subtitle={selectedTargetID ? `当前查看 ${detail.current_target?.ip ?? "目标 IP"}` : "当前查看所有目标 IP 的变化"}
        backTo={detailBackTo}
        actions={
          compareTargetID ? (
            <Link
              className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600"
              to={historyPathForCompare}
            >
              快照对比
            </Link>
          ) : undefined
        }
      />

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        {historyLoadError ? (
          <div className="section">
            <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
              {historyLoadError}
            </div>
          </div>
        ) : null}

        {detail.targets.length === 0 ? (
          <div className="section">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              当前节点还没有目标 IP，请先回到详情页添加。
            </div>
          </div>
        ) : historyLoading || fieldOptionsLoading ? (
          <div className="section">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">正在加载历史记录...</div>
          </div>
        ) : historyTotal === 0 ? (
          <div className="section">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              {selectedFieldID || startDate || endDate
                ? "当前筛选条件下没有历史变化。"
                : "当前目标 IP 还没有历史变化。"}
            </div>
          </div>
        ) : (
          <div className="section space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">字段变化</h2>
                <p className="text-sm text-slate-500">按字段独立记录变化，默认按时间倒序展示。</p>
              </div>
              <button
                className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
                onClick={() => {
                  reload();
                  reloadHistory();
                  reloadFieldOptions();
                }}
                type="button"
              >
                刷新
              </button>
            </div>

            <HistoryChangeFiltersBar
              startDate={startDate}
              endDate={endDate}
              targetOptions={detail.targets.map((item) => ({ id: item.id, label: item.ip }))}
              selectedTargetID={selectedTargetID}
              fieldOptions={fieldOptions}
              selectedFieldID={selectedFieldID}
              onApply={({ startDate: nextStartDate, endDate: nextEndDate }) =>
                replaceSelection(selectedTargetID, 1, {
                  startDate: nextStartDate,
                  endDate: nextEndDate
                })
              }
              onTargetChange={(targetID) => replaceSelection(targetID, 1)}
              onFieldChange={(fieldID) => {
                setSelectedFieldID(fieldID);
                replaceSelection(selectedTargetID, 1);
              }}
            />

            <HistoryPagination
              page={currentHistoryPage}
              totalPages={historyTotalPages}
              total={historyTotal}
              pageSize={historyPageSize}
              onPageChange={(page) => replaceSelection(selectedTargetID, page)}
              onPageSizeChange={(pageSize) => {
                setHistoryPageSize(pageSize);
                replaceSelection(selectedTargetID, 1);
              }}
            />

            <HistoryChangeList items={currentPageItems} />
          </div>
        )}
      </section>
    </section>
  );
}

function NodeHistoryComparePage(props: { onUnauthorized: () => void }) {
  const { uuid = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const selectedTargetID = Number(searchParams.get("target_id") || "") || null;
  const { loading, error, detail, reload } = useNodePageData(uuid, selectedTargetID, props.onUnauthorized);
  const compareTargetID = detail?.current_target?.id ?? selectedTargetID ?? null;
  const { loading: historyLoading, error: historyError, items: historyItems, reload: reloadHistory } = useAllNodeHistoryData(
    uuid,
    compareTargetID,
    props.onUnauthorized
  );
  const [historyItemsOverride, setHistoryItemsOverride] = useState<NodeHistoryEntry[] | null>(null);
  const [leftTimestamp, setLeftTimestamp] = useState(0);
  const [rightTimestamp, setRightTimestamp] = useState(0);
  const [favoriteSavingIDs, setFavoriteSavingIDs] = useState<number[]>([]);

  useEffect(() => {
    setHistoryItemsOverride(historyItems);
  }, [historyItems]);

  function replaceSelection(targetID: number | null) {
    const params = new URLSearchParams(searchParams);
    if (targetID) {
      params.set("target_id", String(targetID));
    } else {
      params.delete("target_id");
    }
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }

  const effectiveHistoryItems = historyItemsOverride ?? historyItems;
  const orderedHistory = [...effectiveHistoryItems].sort(
    (left, right) => new Date(left.recorded_at).getTime() - new Date(right.recorded_at).getTime()
  );

  useEffect(() => {
    if (orderedHistory.length === 0) {
      setLeftTimestamp(0);
      setRightTimestamp(0);
      return;
    }
    setLeftTimestamp(parseRecordedAtTimestamp(orderedHistory[0].recorded_at));
    setRightTimestamp(parseRecordedAtTimestamp(orderedHistory[orderedHistory.length - 1].recorded_at));
  }, [detail?.current_target?.id, orderedHistory.length]);

  if (loading) {
    return <NodeDetailLoading />;
  }

  if (error || !detail) {
    return (
      <NodePageError
        title="快照对比"
        subtitle={error || "节点不存在"}
        backTo="/nodes"
        error={error || "节点不存在。"}
        onRetry={reload}
      />
    );
  }

  const leftEntry = pickHistoryEntryAtOrBefore(orderedHistory, leftTimestamp);
  const rightEntry = pickHistoryEntryAtOrBefore(orderedHistory, rightTimestamp);
  const compareRows =
    leftEntry && rightEntry ? buildHistoryCompareRows(leftEntry.result, rightEntry.result) : [];
  const changedPaths = Array.from(
    new Set(
      compareRows
        .filter((row) => row.changed)
        .flatMap((row) => mapDisplayPathToReportPaths(row.path))
    )
  );
  const detailBackTo = `/nodes/${uuid}/history${detail.current_target?.id ? `?target_id=${detail.current_target.id}` : ""}`;

  async function toggleSnapshotFavorite(entry: NodeHistoryEntry) {
    setFavoriteSavingIDs((current) => (current.includes(entry.id) ? current : [...current, entry.id]));
    const nextFavorite = !entry.is_favorite;
    setHistoryItemsOverride((current) =>
      (current ?? historyItems).map((item) =>
        item.id === entry.id
          ? {
              ...item,
              is_favorite: nextFavorite
            }
          : item
      )
    );
    try {
      const suffix = compareTargetID ? `?target_id=${compareTargetID}` : "";
      if (entry.is_favorite) {
        await apiRequest<NodeHistoryEntry>(`/nodes/${uuid}/history/${entry.id}/favorite${suffix}`, { method: "DELETE" });
      } else {
        await apiRequest<NodeHistoryEntry>(`/nodes/${uuid}/history/${entry.id}/favorite${suffix}`, { method: "POST" });
      }
    } catch (toggleError) {
      setHistoryItemsOverride((current) =>
        (current ?? historyItems).map((item) =>
          item.id === entry.id
            ? {
                ...item,
                is_favorite: entry.is_favorite
              }
            : item
        )
      );
      if (toggleError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      window.alert(toggleError instanceof Error ? toggleError.message : "更新快照收藏状态失败");
    } finally {
      setFavoriteSavingIDs((current) => current.filter((id) => id !== entry.id));
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title={`${detail.name} 快照对比`}
        subtitle={detail.current_target ? `当前查看 ${detail.current_target.ip}` : "请选择一个目标 IP"}
        backTo={detailBackTo}
      />

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="section space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900">目标 IP</h2>
              <p className="text-sm text-slate-500">切换标签可查看不同目标 IP 的独立快照对比。</p>
            </div>
            <button
              className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
              onClick={() => {
                reload();
                reloadHistory();
              }}
              type="button"
            >
              刷新
            </button>
          </div>
          {detail.targets.length > 0 ? (
            <TargetTabs
              items={detail.targets.map((item) => ({ id: item.id, label: item.ip, has_data: item.has_data }))}
              selectedId={detail.selected_target_id ?? detail.current_target?.id ?? null}
              onSelect={(targetID) => replaceSelection(targetID)}
            />
          ) : (
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              当前节点还没有目标 IP，请先回到详情页添加。
            </div>
          )}
        </div>

        {historyError ? (
          <div className="section">
            <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
              {historyError}
            </div>
          </div>
        ) : null}

        {!detail.current_target ? null : historyLoading ? (
          <div className="section">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">正在加载历史记录...</div>
          </div>
        ) : orderedHistory.length < 2 ? (
          <div className="section">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              当前目标 IP 至少需要两条历史记录，才能进行快照对比。
            </div>
          </div>
        ) : (
          <div className="section space-y-6">
            <CompareTimeline
              items={orderedHistory}
              leftTimestamp={leftTimestamp}
              rightTimestamp={rightTimestamp}
              onLeftChange={(timestamp) => setLeftTimestamp(timestamp)}
              onRightChange={(timestamp) => setRightTimestamp(timestamp)}
            />

            {leftEntry && rightEntry ? (
              compareRows.length === 0 ? (
                <HistoryCompareEmptyState rows={compareRows} />
              ) : (
                <div className="grid gap-6 xl:grid-cols-2">
                  <CompareReportPane
                    entry={leftEntry}
                    changedPaths={changedPaths}
                    favoriteSaving={favoriteSavingIDs.includes(leftEntry.id)}
                    onToggleFavorite={() => toggleSnapshotFavorite(leftEntry)}
                  />
                  <CompareReportPane
                    entry={rightEntry}
                    changedPaths={changedPaths}
                    favoriteSaving={favoriteSavingIDs.includes(rightEntry.id)}
                    onToggleFavorite={() => toggleSnapshotFavorite(rightEntry)}
                  />
                </div>
              )
            ) : null}
          </div>
        )}
      </section>
    </section>
  );
}

function PublicNodeDetailPage() {
  const { uuid = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const displayIP = searchParams.get("display_ip")?.trim() || "";
  const selectedTargetID = Number(searchParams.get("target_id") || "") || null;
  const { loading, error, detail, reload } = usePublicNodePageData(uuid, selectedTargetID, displayIP);

  function replaceTargetSelection(targetID: number | null) {
    const params = new URLSearchParams(searchParams);
    if (targetID) {
      params.set("target_id", String(targetID));
    } else {
      params.delete("target_id");
    }
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }

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

  const targets = detail.targets ?? [];

  return (
    <section className="space-y-6">
      {!isEmbed ? <PageHeader title="IP质量体检报告" subtitle="当前公开结果" backTo="/" /> : null}
      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="section space-y-4">
          <h2 className="text-base font-semibold text-slate-900">目标 IP</h2>
          {targets.length > 0 ? (
            <TargetTabs
              items={targets.map((item) => ({ id: item.id, label: item.label, has_data: item.has_data }))}
              selectedId={detail.selected_target_id ?? detail.current_target?.id ?? null}
              onSelect={(targetID) => replaceTargetSelection(targetID)}
            />
          ) : (
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              管理员还没有配置可查看的目标 IP。
            </div>
          )}
        </div>
        {detail.current_target ? (
          <div className="section">
            <h2 className="mb-4 text-base font-semibold text-slate-900">当前 IP 质量</h2>
            <div data-detail-report="true">
              <CurrentReportView result={detail.current_target.current_result} hiddenPaths={[]} compact={isEmbed} />
            </div>
          </div>
        ) : null}
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
  const [savingGuestRead, setSavingGuestRead] = useState(false);
  const publicBaseURL = (integration?.public_base_url ?? props.me.public_base_url ?? "").trim();
  const savedPublicBaseURL = (integration?.public_base_url ?? "").trim();
  const savedGuestReadEnabled = Boolean(integration?.guest_read_enabled);
  const basePath = runtime?.base_path || props.me.base_path || "";
  const suggestedPublicBaseURL = `${window.location.origin}${basePath || ""}`.replace(/\/$/, "");
  const previewPublicBaseURL = publicBaseURL || suggestedPublicBaseURL;
  const publicBaseURLDirty = publicBaseURLInput.trim() !== savedPublicBaseURL;
  const guestReadDirty = guestReadEnabledInput !== savedGuestReadEnabled;

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

  async function saveIntegrationSettings(
    nextValue: string,
    guestReadEnabled: boolean,
    options: { saving: "address" | "guest"; successText: string; errorText: string }
  ) {
    if (options.saving === "address") {
      setSavingAddress(true);
    } else {
      setSavingGuestRead(true);
    }
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
      window.alert(options.successText);
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : options.errorText);
    } finally {
      if (options.saving === "address") {
        setSavingAddress(false);
      } else {
        setSavingGuestRead(false);
      }
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
                  disabled={savingAddress || !publicBaseURLDirty}
                  onClick={() =>
                    void saveIntegrationSettings(publicBaseURLInput, savedGuestReadEnabled, {
                      saving: "address",
                      successText: publicBaseURLInput.trim() ? "接入地址已保存。" : "已恢复为自动推导地址。",
                      errorText: "保存接入地址失败"
                    })
                  }
                  type="button"
                >
                  {savingAddress ? "保存中…" : "保存"}
                </button>
                <button
                  className="button ghost"
                  disabled={savingAddress || savedPublicBaseURL === ""}
                  onClick={() =>
                    void saveIntegrationSettings("", savedGuestReadEnabled, {
                      saving: "address",
                      successText: "已恢复为自动推导地址。",
                      errorText: "恢复默认地址失败"
                    })
                  }
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

              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="button"
                  disabled={savingGuestRead || !guestReadDirty}
                  onClick={() =>
                    void saveIntegrationSettings(savedPublicBaseURL, guestReadEnabledInput, {
                      saving: "guest",
                      successText: guestReadEnabledInput ? "已开放游客只读。" : "已关闭游客只读。",
                      errorText: "保存游客只读设置失败"
                    })
                  }
                  type="button"
                >
                  {savingGuestRead ? "保存中…" : "保存游客只读设置"}
                </button>
                <span className="text-sm text-slate-500">
                  {savedGuestReadEnabled ? "当前状态：已开放" : "当前状态：未开放"}
                </span>
              </div>
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

function HistoryRetentionPage(props: { onUnauthorized: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retention, setRetention] = useState<HistoryRetentionSettings | null>(null);
  const [retentionDaysInput, setRetentionDaysInput] = useState("-1");
  const [saving, setSaving] = useState(false);
  const savedRetentionDays = retention?.retention_days ?? -1;
  const retentionDaysDirty = retentionDaysInput.trim() !== String(savedRetentionDays);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await apiRequest<HistoryRetentionSettings>("/admin/history-retention");
        if (cancelled) {
          return;
        }
        setRetention(response);
        setRetentionDaysInput(String(response.retention_days));
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          props.onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载历史保留设置失败");
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
  }, [props.onUnauthorized]);

  async function saveHistoryRetentionSettings() {
    const parsed = Number(retentionDaysInput.trim());
    if (!Number.isInteger(parsed) || (parsed !== -1 && parsed < 1)) {
      setError("历史保留天数只能是 -1 或正整数。");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const saved = await apiRequest<HistoryRetentionSettings>("/admin/history-retention", {
        method: "PUT",
        body: JSON.stringify({ retention_days: parsed })
      });
      setRetention(saved);
      setRetentionDaysInput(String(saved.retention_days));
      window.alert("历史保留设置已保存。");
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存历史保留设置失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader title="历史保留" subtitle="控制历史快照的自动清理窗口和占用规模。" />

      {loading ? (
        <div className="grid gap-4">
          <div className="h-52 animate-pulse rounded-[24px] bg-slate-100" />
        </div>
      ) : error ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">{error}</div>
      ) : (
        <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-4">
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900">历史保留</h2>
              <p className="text-sm leading-6 text-slate-500">
                控制历史快照的自动清理窗口。当前结果不会被删除，收藏快照也不会被自动清理。
              </p>
            </div>

            <label className="flex w-full flex-col gap-2 text-sm text-slate-700">
              <span className="font-medium text-slate-900">历史保留天数</span>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                placeholder="-1 或正整数"
                value={retentionDaysInput}
                onChange={(event) => setRetentionDaysInput(event.target.value)}
                type="text"
                inputMode="numeric"
              />
            </label>

            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 md:grid-cols-2">
              <div>
                <p className="font-medium text-slate-900">当前策略</p>
                <p>{formatRetentionDays(savedRetentionDays)}</p>
              </div>
              <div>
                <p className="font-medium text-slate-900">当前历史占用</p>
                <p>{formatByteSize(retention?.history_bytes ?? 0)}</p>
              </div>
              <div>
                <p className="font-medium text-slate-900">近 7 天平均增长</p>
                <p>{formatByteSize(retention?.recent_growth_bytes_per_day ?? 0)} / 天</p>
              </div>
              <div>
                <p className="font-medium text-slate-900">预计保留体积</p>
                <p>
                  {retention?.estimated_is_unbounded
                    ? "长期增长，无法给出上限"
                    : formatByteSize(retention?.estimated_retained_bytes ?? 0)}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-800">
              <p>`-1` 表示永久保留。历史越多，历史查询和快照对比会越慢。</p>
              <p>收藏快照不会被自动清理；取消收藏后会重新受全局保留策略影响。</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button className="button" disabled={saving || !retentionDaysDirty} onClick={() => void saveHistoryRetentionSettings()} type="button">
                {saving ? "保存中…" : "保存历史保留设置"}
              </button>
            </div>
          </div>
        </section>
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
      window.alert("用户信息已保存，请重新登录。");
      navigate("/login", { replace: true });
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存用户设置失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader title="用户" subtitle="修改登录账号和密码。" />

      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="summary-section">
          <div className="summary-head">
            <strong>当前用户</strong>
            <span className="chip">单用户模式</span>
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
        <PageHeader title="需要登录" subtitle="请在独立页面继续。" />
        <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm leading-6 text-slate-500">当前页面无法直接完成管理员登录。</p>
        </section>
      </section>
    );
  }

  return (
    <EmbedBridgePage
      title="需要登录"
      description="当前管理员链路需要先在独立页面登录。"
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
      <Route path="/nodes" element={<NodesPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid" element={<NodeDetailPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/history" element={<NodeHistoryPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/compare" element={<NodeHistoryComparePage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/changes" element={<Navigate to="../history" relative="path" replace />} />
      <Route path="/settings/integration" element={<IntegrationPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/settings/history-retention" element={<HistoryRetentionPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/settings/fields" element={<Navigate to="/nodes" replace />} />
      <Route path="/settings/admin" element={<Navigate to="/settings/user" replace />} />
      <Route
        path="/settings/user"
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
