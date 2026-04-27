import {
  ArrowLeftIcon,
  Cross2Icon,
  ExitIcon,
  GearIcon,
  PlusIcon,
  ReloadIcon,
  RowsIcon
} from "@radix-ui/react-icons";
import {
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
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
import { formatDateTime, formatDateTimeInTimeZone } from "./lib/format";
import { buildHistoryCompareRows, mapDisplayPathToReportPaths } from "./lib/history";
import { NotificationChannelSettingsPage, NotificationDeliveriesPage, NotificationHomePage } from "./lib/notification-pages";
import { CurrentReportView } from "./lib/report";
import { IANA_TIME_ZONES } from "./lib/timezones";
import type {
  APIAccessLog,
  APIKeyCreateResult,
  APIKeyDetail,
  HistoryRetentionSettings,
  IntegrationSettings,
  KomariBindingCandidate,
  MeResponse,
  NotificationChannelDetail,
  NotificationDelivery,
  NotificationSettings,
  NotificationProviderDefinition,
  NotificationRule,
  NodeDetail,
  NodeReportConfigPreview,
  NodeHistoryChangeEventPage,
  NodeHistoryEntry,
  NodeHistoryFieldOptionList,
  NodeHistoryListResponse,
  NodeListItem,
  NodeTargetListItem,
  PublicNodeDetail,
  RuntimeResponse
} from "./lib/types";

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
};

const standaloneAppBase = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;
const githubRawInstallScriptURL = "https://raw.githubusercontent.com/qqqasdwx/Komari-ip-history/main/deploy/install.sh";

type ToastTone = "success" | "error";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

let toastSeed = 0;
let toastState: ToastItem[] = [];
const toastListeners = new Set<(items: ToastItem[]) => void>();

function emitToasts() {
  const snapshot = [...toastState];
  for (const listener of toastListeners) {
    listener(snapshot);
  }
}

function dismissToast(id: number) {
  toastState = toastState.filter((item) => item.id !== id);
  emitToasts();
}

function pushToast(message: string, tone: ToastTone = "success") {
  const id = ++toastSeed;
  toastState = [...toastState, { id, message, tone }];
  emitToasts();
  window.setTimeout(() => dismissToast(id), 2600);
}

const nodeNavItems: NavItem[] = [{ to: "/nodes", label: "节点结果", icon: <RowsIcon /> }];

const settingsNavItems: NavItem[] = [
  { to: "/settings/integration", label: "接入配置", icon: <GearIcon /> },
  { to: "/settings/notification", label: "通知", icon: <GearIcon /> },
  { to: "/settings/api-keys", label: "API", icon: <GearIcon /> },
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

function historyQueryValueToInputValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return formatDateTimeInputValue(parsed);
}

function historyInputValueToQueryValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toISOString();
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
  if (pathname === "/settings/notification") {
    return "通知";
  }
  if (pathname === "/settings/notification/channel") {
    return "通道设置";
  }
  if (pathname === "/settings/notification/deliveries") {
    return "最近投递记录";
  }
  if (pathname === "/settings/api-keys") {
    return "API";
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

function useNodePageData(uuid: string, targetID: number | null, onUnauthorized: () => void) {
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
      const refreshInPlace =
        currentDetail !== null && (currentDetail.node_uuid === uuid || currentDetail.komari_node_uuid === uuid);
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
        if (!activeDetail || (activeDetail.node_uuid !== uuid && activeDetail.komari_node_uuid !== uuid)) {
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
  }, [onUnauthorized, reloadToken, targetID, uuid]);

  return {
    loading,
    refreshing,
    error,
    errorStatus,
    detail,
    reload: () => setReloadToken((value) => value + 1)
  };
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

function buildReportConfigListPath(uuid: string) {
  const params = new URLSearchParams();
  params.set("report_config", uuid);
  return `/nodes?${params.toString()}`;
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

function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || "UTC";
  } catch {
    return "UTC";
  }
}

function resolveNodeRouteUUID(node: { node_uuid?: string | null; komari_node_uuid: string }) {
  return node.node_uuid?.trim() || node.komari_node_uuid;
}

function resolveDefaultExecutionTimezone(configuredTimezone: string | undefined, browserTimeZone: string) {
  const normalized = (configuredTimezone || "").trim();
  if (!normalized || normalized === "UTC") {
    return browserTimeZone;
  }
  return normalized;
}

function getEmbedTheme(searchParams: URLSearchParams) {
  const theme = (searchParams.get("komari_theme") || "").trim().toLowerCase();
  if (theme.includes("purcarte")) {
    return "purcarte";
  }
  return "default";
}

function getEmbedAppearance(searchParams: URLSearchParams) {
  const appearance = (searchParams.get("komari_appearance") || "").trim().toLowerCase();
  return appearance === "dark" ? "dark" : "light";
}

function sanitizeEmbedCSSValue(value: string | null) {
  const text = (value || "").trim();
  if (!text || /[;{}]/.test(text) || /url\s*\(/i.test(text)) {
    return "";
  }
  return text;
}

function getEmbedGlassStyle(searchParams: URLSearchParams): CSSProperties | undefined {
  if (getEmbedTheme(searchParams) !== "purcarte") {
    return undefined;
  }

  const style = {} as CSSProperties & Record<string, string>;
  const blurParam = (searchParams.get("komari_blur") || "").trim();
  const blurValue = Number(blurParam.replace(/px$/i, ""));
  if (Number.isFinite(blurValue)) {
    style["--ipq-purcarte-blur"] = `${Math.max(0, Math.min(40, blurValue))}px`;
  }

  const card = sanitizeEmbedCSSValue(searchParams.get("komari_card"));
  if (card) {
    style["--ipq-purcarte-card"] = card;
  }

  return style;
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

function EmbedFrameShell(props: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const embedTheme = getEmbedTheme(searchParams);
  const embedAppearance = getEmbedAppearance(searchParams);
  const embedGlassStyle = getEmbedGlassStyle(searchParams);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (!isEmbed) {
      delete root.dataset.ipqEmbedTheme;
      delete body.dataset.ipqEmbedTheme;
      delete root.dataset.ipqEmbedAppearance;
      delete body.dataset.ipqEmbedAppearance;
      return;
    }

    root.dataset.ipqEmbedTheme = embedTheme;
    body.dataset.ipqEmbedTheme = embedTheme;
    root.dataset.ipqEmbedAppearance = embedAppearance;
    body.dataset.ipqEmbedAppearance = embedAppearance;

    return () => {
      delete root.dataset.ipqEmbedTheme;
      delete body.dataset.ipqEmbedTheme;
      delete root.dataset.ipqEmbedAppearance;
      delete body.dataset.ipqEmbedAppearance;
    };
  }, [embedAppearance, embedTheme, isEmbed]);

  if (!isEmbed) {
    return <>{props.children}</>;
  }

  return (
    <div
      className={`embed-shell embed-theme-${embedTheme} embed-appearance-${embedAppearance} bg-slate-50 text-slate-900`}
      style={embedGlassStyle}
    >
      <div className="embed-panel mx-auto max-w-[1120px] space-y-6">{props.children}</div>
    </div>
  );
}

function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>(toastState);

  useEffect(() => {
    toastListeners.add(setItems);
    return () => {
      toastListeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {items.map((item) => (
        <div key={item.id} className={`toast-item toast-item-${item.tone}`}>
          {item.message}
        </div>
      ))}
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
  const reportConfigPath = buildReportConfigListPath(uuid);

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

        let hasTargets = false;
        try {
          const detail = await apiRequest<NodeDetail>(`/nodes/${uuid}`);
          hasTargets = (detail.targets ?? []).length > 0;
        } catch (detailError) {
          if (detailError instanceof UnauthorizedError) {
            throw detailError;
          }
        }

        if (cancelled) {
          return;
        }

        if (returnTo) {
          navigate(hasTargets ? `/nodes/${uuid}` : reportConfigPath, { replace: true });
          return;
        }

        navigate(hasTargets ? `/nodes/${uuid}` : `/nodes/${uuid}${isEmbed ? "?embed=1" : ""}`, { replace: true });
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
  }, [isEmbed, location.pathname, location.search, name, navigate, props.onUnauthorized, reportConfigPath, returnTo, resumePopup, uuid]);

  if (loading) {
    return (
      <section className="space-y-6">
        <PageHeader
          title="接入节点"
          subtitle={returnTo && resumePopup ? "正在为当前节点创建自动绑定节点，并打开独立配置页面。" : "正在为当前节点创建自动绑定节点。"}
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

function EmbedStandaloneNoticePage(props: { title: string; description: string; actionURL: string; actionLabel?: string }) {
  const standaloneURL = toStandaloneAppURL(props.actionURL);
  return (
    <section className="space-y-6">
      <PageHeader title={props.title} subtitle={props.description} />
      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <p className="text-sm leading-6 text-slate-500">
            当前内容会保留在 Komari 页内弹窗中；如果需要继续配置，请手动打开独立页面。
          </p>
          <div className="flex flex-wrap gap-3">
            <a className="button" href={standaloneURL} target="_blank" rel="noreferrer">
              {props.actionLabel ?? "在独立页面继续"}
            </a>
          </div>
        </div>
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

function CreateNodeDialog(props: {
  open: boolean;
  name: string;
  saving: boolean;
  error: string;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
}) {
  if (!props.open) {
    return null;
  }

  return (
    <div className="field-modal-backdrop" onClick={props.onClose}>
      <section className="field-modal report-config-modal" onClick={(event) => event.stopPropagation()}>
        <div className="field-modal-head">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">新建独立节点</h2>
            <p className="text-sm text-slate-500">创建一个不依赖 Komari 的独立节点，创建后会直接打开它的上报设置。</p>
          </div>
          <button className="button ghost" onClick={props.onClose} type="button">
            关闭
          </button>
        </div>
        <div className="field-modal-body space-y-4">
          <label className="grid gap-2 text-sm text-slate-700">
            <span>节点名称</span>
            <input
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              value={props.name}
              onChange={(event) => props.onNameChange(event.target.value)}
              placeholder="例如 香港边缘节点"
            />
          </label>
          {props.error ? <p className="text-sm text-rose-600">{props.error}</p> : null}
          <div>
            <button className="button" disabled={props.saving || !props.name.trim()} onClick={props.onSubmit} type="button">
              {props.saving ? "创建中..." : "创建并配置"}
            </button>
          </div>
        </div>
      </section>
    </div>
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
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nodes, setNodes] = useState<NodeListItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [reportConfigNodeUUID, setReportConfigNodeUUID] = useState("");
  const [creatingNode, setCreatingNode] = useState(false);
  const [createNodeOpen, setCreateNodeOpen] = useState(false);
  const [createNodeName, setCreateNodeName] = useState("");
  const [createNodeError, setCreateNodeError] = useState("");

  useEffect(() => {
    const requestedUUID = searchParams.get("report_config")?.trim() || "";
    setReportConfigNodeUUID(requestedUUID);
  }, [searchParams]);

  function openReportConfig(uuid: string) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("report_config", uuid);
    navigate(`/nodes?${nextParams.toString()}`, { replace: true });
    setReportConfigNodeUUID(uuid);
  }

  function closeReportConfig() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("report_config");
    const query = nextParams.toString();
    navigate(`/nodes${query ? `?${query}` : ""}`, { replace: true });
    setReportConfigNodeUUID("");
  }

  async function handleCreateStandaloneNode() {
    setCreatingNode(true);
    setCreateNodeError("");
    try {
      const created = await apiRequest<NodeListItem>("/nodes", {
        method: "POST",
        body: JSON.stringify({ name: createNodeName.trim() })
      });
      setNodes((current) => [created, ...current]);
      setCreateNodeOpen(false);
      setCreateNodeName("");
      openReportConfig(resolveNodeRouteUUID(created));
      pushToast("独立节点已创建。");
    } catch (createError) {
      if (createError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setCreateNodeError(createError instanceof Error ? createError.message : "创建独立节点失败");
    } finally {
      setCreatingNode(false);
    }
  }

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
      <CreateNodeDialog
        open={createNodeOpen}
        name={createNodeName}
        saving={creatingNode}
        error={createNodeError}
        onClose={() => {
          setCreateNodeOpen(false);
          setCreateNodeError("");
        }}
        onNameChange={setCreateNodeName}
        onSubmit={() => void handleCreateStandaloneNode()}
      />
      {reportConfigNodeUUID ? (
        <NodeReportConfigDialog
          me={props.me}
          nodeUUID={reportConfigNodeUUID}
          onClose={closeReportConfig}
          onUnauthorized={props.onUnauthorized}
        />
      ) : null}
      <PageHeader
        title="节点列表"
        subtitle={`${nodes.length} 个已接入节点`}
        actions={
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
            {showSearch ? (
              <SearchBox value={searchInput} onChange={setSearchInput} onSubmit={() => setSearchQuery(searchInput.trim())} />
            ) : null}
            <button className="button" disabled={creatingNode} onClick={() => setCreateNodeOpen(true)} type="button">
              新建节点
            </button>
          </div>
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
                  key={item.node_uuid || item.komari_node_uuid}
                  className="react-node-list-row cursor-pointer border-t border-slate-200 px-4 py-4 text-sm text-slate-700 transition hover:bg-slate-50 first:border-t-0"
                  data-node-row="true"
                  data-node-uuid={resolveNodeRouteUUID(item)}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(`/nodes/${resolveNodeRouteUUID(item)}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/nodes/${resolveNodeRouteUUID(item)}`);
                    }
                  }}
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-sm font-semibold text-slate-900" data-node-name="true">
                      {item.name}
                    </strong>
                    <span className="mt-1 block truncate text-xs text-slate-400">
                      {item.has_komari_binding ? `Komari 已绑定 · ${item.komari_node_uuid}` : `独立节点 · ${item.komari_node_uuid}`}
                    </span>
                    {item.komari_node_name && item.has_komari_binding ? (
                      <span className="mt-1 block truncate text-xs text-slate-400">Komari 名称 · {item.komari_node_name}</span>
                    ) : null}
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
                        openReportConfig(resolveNodeRouteUUID(item));
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
  const publicBaseURL = (me.effective_public_base_url ?? me.public_base_url ?? "").replace(/\/$/, "");
  return publicBaseURL || window.location.origin;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildInstallCommand(
  publicBaseURL: string,
  installToken: string
) {
  const args = [
    "--server",
    publicBaseURL.replace(/\/+$/, ""),
    "--install-token",
    installToken
  ];
  return `curl -fsSL ${shellQuote(githubRawInstallScriptURL)} | { SUDO=$(command -v sudo || true); [ "$(id -u)" -eq 0 ] && SUDO=; \${SUDO:-} bash -s -- ${args.map(shellQuote).join(" ")}; }`;
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
  nodeName: string;
  nodeNameSaving: boolean;
  nodeNameError: string;
  onNodeNameChange: (value: string) => void;
  onSaveNodeName: () => void;
  onDeleteCurrentTarget: (targetID: number) => void;
  onSelectTarget: (targetID: number) => void;
  onReorderTargets: (sourceID: number, destinationID: number) => void;
  onToggleTargetEnabled: (targetID: number, enabled: boolean) => void;
  bindKomariUUID: string;
  bindKomariName: string;
  bindCandidates: KomariBindingCandidate[];
  bindSaving: boolean;
  bindingEnabled: boolean;
  onBindingEnabledChange: (enabled: boolean) => void;
  onBindKomariUUIDChange: (value: string) => void;
}) {
  const publicBaseURL = resolvePublicBaseURL(props.me);
  const browserTimeZone = getBrowserTimeZone();
  const routeNodeUUID = props.detail.node_uuid || props.detail.komari_node_uuid;
  const detailTimezone = resolveDefaultExecutionTimezone(props.detail.report_config.timezone, browserTimeZone);
  const [scheduleCron, setScheduleCron] = useState(props.detail.report_config.schedule_cron);
  const [timezone, setTimezone] = useState(detailTimezone);
  const [runImmediately, setRunImmediately] = useState(props.detail.report_config.run_immediately);
  const [preview, setPreview] = useState<NodeReportConfigPreview>({
    schedule_cron: props.detail.report_config.schedule_cron,
    timezone: detailTimezone,
    run_immediately: props.detail.report_config.run_immediately,
    next_runs: props.detail.report_config.next_runs
  });
  const [previewError, setPreviewError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [persistedConfig, setPersistedConfig] = useState({
    scheduleCron: props.detail.report_config.schedule_cron,
    timezone: detailTimezone,
    runImmediately: props.detail.report_config.run_immediately
  });
  const installCommand = buildInstallCommand(
    publicBaseURL,
    props.detail.report_config.install_token
  );
  const timezoneOptions = useMemo(() => {
    if (!browserTimeZone || IANA_TIME_ZONES.includes(browserTimeZone)) {
      return IANA_TIME_ZONES;
    }
    return [browserTimeZone, ...IANA_TIME_ZONES];
  }, [browserTimeZone]);
  const currentBindingOption =
    props.bindKomariUUID.trim() && !props.bindCandidates.some((candidate) => candidate.komari_node_uuid === props.bindKomariUUID)
      ? {
          node_id: props.detail.id,
          node_name: props.detail.name,
          komari_node_uuid: props.bindKomariUUID,
          komari_node_name: props.bindKomariName || props.detail.komari_node_name || "当前绑定节点",
          has_existing_binding: true
        }
      : null;
  const bindOptions = currentBindingOption ? [currentBindingOption, ...props.bindCandidates] : props.bindCandidates;
  const selectedBinding = bindOptions.find((candidate) => candidate.komari_node_uuid === props.bindKomariUUID);
  const bindingDisplayName = selectedBinding?.komari_node_name || props.bindKomariName || props.detail.komari_node_name || "未绑定";
  const [bindSearch, setBindSearch] = useState("");
  const [bindMenuOpen, setBindMenuOpen] = useState(false);
  const [bindTooltipUUID, setBindTooltipUUID] = useState<string | null>(null);
  const bindPickerRef = useRef<HTMLDivElement | null>(null);
  const filteredBindOptions = useMemo(() => {
    const keyword = bindSearch.trim().toLowerCase();
    if (!keyword) {
      return bindOptions;
    }
    return bindOptions.filter((candidate) => candidate.komari_node_name.trim().toLowerCase().includes(keyword));
  }, [bindOptions, bindSearch]);
  const [timezoneSearch, setTimezoneSearch] = useState("");
  const [timezoneMenuOpen, setTimezoneMenuOpen] = useState(false);
  const timezonePickerRef = useRef<HTMLDivElement | null>(null);
  const filteredTimezoneOptions = useMemo(() => {
    const keyword = timezoneSearch.trim().toLowerCase();
    if (!keyword) {
      return timezoneOptions;
    }
    return timezoneOptions.filter((item) => item.toLowerCase().includes(keyword));
  }, [timezoneOptions, timezoneSearch]);

  useEffect(() => {
    if (!bindMenuOpen) {
      return undefined;
    }
    function handlePointerDown(event: MouseEvent) {
      if (bindPickerRef.current && !bindPickerRef.current.contains(event.target as Node)) {
        setBindMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [bindMenuOpen]);

  useEffect(() => {
    if (!timezoneMenuOpen) {
      return undefined;
    }
    function handlePointerDown(event: MouseEvent) {
      if (timezonePickerRef.current && !timezonePickerRef.current.contains(event.target as Node)) {
        setTimezoneMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [timezoneMenuOpen]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setScheduleCron(props.detail.report_config.schedule_cron);
    setTimezone(detailTimezone);
    setRunImmediately(props.detail.report_config.run_immediately);
    setPreview({
      schedule_cron: props.detail.report_config.schedule_cron,
      timezone: detailTimezone,
      run_immediately: props.detail.report_config.run_immediately,
      next_runs: props.detail.report_config.next_runs
    });
    setPersistedConfig({
      scheduleCron: props.detail.report_config.schedule_cron,
      timezone: detailTimezone,
      runImmediately: props.detail.report_config.run_immediately
    });
    setBindSearch("");
    setBindMenuOpen(false);
    setBindTooltipUUID(null);
    setTimezoneSearch("");
    setTimezoneMenuOpen(false);
    setPreviewError("");
    setSaveError("");
    setSaveState("idle");
  }, [
    props.open,
    props.detail.report_config.next_runs,
    props.detail.report_config.run_immediately,
    props.detail.report_config.schedule_cron,
    props.detail.report_config.timezone,
    detailTimezone,
    browserTimeZone
  ]);

  useEffect(() => {
    if (!props.open) {
      return undefined;
    }
    const controller = new AbortController();
    const timeoutID = window.setTimeout(async () => {
      try {
        const nextTimezone = timezone.trim() || browserTimeZone;
        const search = new URLSearchParams();
        search.set("cron", scheduleCron);
        search.set("timezone", nextTimezone);
        search.set("run_immediately", runImmediately ? "1" : "0");
        const data = await apiRequest<NodeReportConfigPreview>(`/nodes/${routeNodeUUID}/report-config/preview?${search.toString()}`, {
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
  }, [browserTimeZone, props.open, routeNodeUUID, runImmediately, scheduleCron, timezone]);

  useEffect(() => {
    if (!props.open || previewError) {
      return undefined;
    }
    const normalizedCron = preview.schedule_cron.trim();
    const normalizedTimezone = preview.timezone.trim() || browserTimeZone;
    if (
      normalizedCron === persistedConfig.scheduleCron &&
      normalizedTimezone === persistedConfig.timezone &&
      runImmediately === persistedConfig.runImmediately
    ) {
      return undefined;
    }

    let cancelled = false;
    const timeoutID = window.setTimeout(async () => {
      setSaveState("saving");
      setSaveError("");
      try {
        const config = await apiRequest<NodeDetail["report_config"]>(`/nodes/${routeNodeUUID}/report-config`, {
          method: "PUT",
          body: JSON.stringify({
            schedule_cron: normalizedCron,
            timezone: normalizedTimezone,
            run_immediately: runImmediately
          })
        });
        if (cancelled) {
          return;
        }
        setPersistedConfig({
          scheduleCron: config.schedule_cron,
          timezone: config.timezone,
          runImmediately: config.run_immediately
        });
        setScheduleCron(config.schedule_cron);
        setTimezone(config.timezone);
        setRunImmediately(config.run_immediately);
        setPreview({
          schedule_cron: config.schedule_cron,
          timezone: config.timezone,
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
    browserTimeZone,
    persistedConfig.runImmediately,
    persistedConfig.scheduleCron,
    persistedConfig.timezone,
    preview.schedule_cron,
    preview.timezone,
    previewError,
    props.onSaved,
    props.open,
    routeNodeUUID,
    runImmediately,
    timezone
  ]);

  async function handleCopy(value: string, successText: string) {
    try {
      await copyText(value);
      pushToast(successText);
    } catch {
      pushToast("复制失败，请手动复制。", "error");
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
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
          <div className="space-y-3 border-b border-slate-200 pb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-slate-900">节点名称</div>
              <span className="text-xs text-slate-500">{props.nodeNameSaving ? "保存中…" : "失焦或回车后自动保存"}</span>
            </div>
            <div className="grid gap-3">
              <input
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                value={props.nodeName}
                onChange={(event) => props.onNodeNameChange(event.target.value)}
                onBlur={props.onSaveNodeName}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }
                  event.preventDefault();
                  props.onSaveNodeName();
                }}
                placeholder="节点名称"
              />
            </div>
            {props.nodeNameError ? <p className="text-sm text-rose-600">{props.nodeNameError}</p> : null}
          </div>
          <div className="pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-slate-900">Komari 节点绑定</div>
            <span
              className={[
                "inline-flex rounded-full px-3 py-1 text-xs font-medium",
                props.detail.has_komari_binding ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
              ].join(" ")}
            >
              {props.detail.has_komari_binding ? "已绑定" : "未绑定"}
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {props.detail.has_komari_binding ? `当前绑定：${bindingDisplayName}` : "当前节点还没有绑定 Komari 节点。"}
          </div>
          <label className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            <input
              checked={props.bindingEnabled}
              disabled={props.bindSaving}
              onChange={(event) => props.onBindingEnabledChange(event.target.checked)}
              type="checkbox"
            />
            <span>启用 Komari 节点绑定</span>
          </label>
          <div className="mt-3 grid gap-3">
            <div className="relative" ref={bindPickerRef}>
              <button
                className="flex h-11 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-left text-sm outline-none transition hover:border-indigo-300 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                disabled={props.bindSaving || !props.bindingEnabled}
                onClick={() => setBindMenuOpen((value) => !value)}
                type="button"
              >
                <span className="truncate">
                  {!props.bindingEnabled ? "请先打开 Komari 绑定开关" : props.bindKomariUUID ? bindingDisplayName : "请选择 Komari 节点"}
                </span>
                <span className="ml-3 shrink-0 text-slate-400">{bindMenuOpen ? "收起" : "展开"}</span>
              </button>
              {bindMenuOpen && props.bindingEnabled ? (
                <div className="absolute left-0 top-full z-30 mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                  <div className="space-y-3">
                    <input
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      onChange={(event) => setBindSearch(event.target.value)}
                      placeholder="搜索 Komari 节点"
                      value={bindSearch}
                    />
                    <div className="max-h-64 space-y-2 overflow-y-auto">
                      {filteredBindOptions.map((candidate) => {
                        const isCurrent = candidate.komari_node_uuid === props.bindKomariUUID;
                        const isBoundElsewhere = candidate.has_existing_binding && candidate.node_id !== props.detail.id;
                        const statusLabel = isCurrent
                          ? "当前绑定"
                          : isBoundElsewhere
                            ? "已绑定"
                            : "未绑定";
                        const statusClass =
                          statusLabel === "当前绑定"
                            ? "bg-indigo-100 text-indigo-700"
                            : isBoundElsewhere
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700";
                        return (
                          <div key={candidate.komari_node_uuid} className="relative">
                            <button
                              aria-disabled={isBoundElsewhere}
                              className={[
                                "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition",
                                isCurrent
                                  ? "border-indigo-300 bg-indigo-50"
                                  : isBoundElsewhere
                                    ? "border-slate-200 bg-slate-50 text-slate-400"
                                    : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50"
                              ].join(" ")}
                              onBlur={() => {
                                if (bindTooltipUUID === candidate.komari_node_uuid) {
                                  setBindTooltipUUID(null);
                                }
                              }}
                              onClick={() => {
                                if (isBoundElsewhere) {
                                  return;
                                }
                                setBindMenuOpen(false);
                                setBindSearch("");
                                setBindTooltipUUID(null);
                                void props.onBindKomariUUIDChange(candidate.komari_node_uuid);
                              }}
                              onFocus={() => {
                                if (isBoundElsewhere) {
                                  setBindTooltipUUID(candidate.komari_node_uuid);
                                }
                              }}
                              onMouseEnter={() => {
                                if (isBoundElsewhere) {
                                  setBindTooltipUUID(candidate.komari_node_uuid);
                                }
                              }}
                              onMouseLeave={() => {
                                if (bindTooltipUUID === candidate.komari_node_uuid) {
                                  setBindTooltipUUID(null);
                                }
                              }}
                              type="button"
                            >
                              <span className="truncate">{candidate.komari_node_name}</span>
                              <span className={`inline-flex shrink-0 rounded-full px-2 py-1 text-xs font-medium ${statusClass}`}>
                                {statusLabel}
                              </span>
                            </button>
                            {isBoundElsewhere && bindTooltipUUID === candidate.komari_node_uuid ? (
                              <div className="pointer-events-none absolute left-0 top-full z-40 mt-2 max-w-full rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-xs text-white shadow-xl">
                                已绑定到：{candidate.node_name}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      {filteredBindOptions.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
                          没有匹配的 Komari 节点
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          </div>
        </div>
        <div className="space-y-1">
          {props.detail.report_config.target_ips.length > 0 ? (
            <p className="text-sm text-slate-500">当前命令会优先探查服务端已记录且启用的目标 IP，并结合节点自动发现结果逐个上报。</p>
          ) : (
            <p className="text-sm text-slate-500">当前还没有手动配置目标 IP。接入命令仍可使用，节点会先自动发现候选 IP，再向服务端获取本次探查计划。</p>
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
          {props.detail.current_target ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-4 text-sm text-slate-700">
              <div className="space-y-1">
                <div className="font-medium text-slate-900">{props.detail.current_target.ip}</div>
                <div className="text-xs text-slate-500">
                  来源 {props.detail.current_target.source === "discovered" ? "自动发现" : "手动添加"} · 当前{props.detail.current_target.enabled ? "启用" : "停用"}上报
                </div>
                {props.detail.current_target.last_seen_at ? (
                  <div className="text-xs text-slate-500">
                    最近发现：{formatDateTime(props.detail.current_target.last_seen_at)}
                  </div>
                ) : null}
              </div>
              <button
                className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
                onClick={() => props.onToggleTargetEnabled(props.detail.current_target!.id, !props.detail.current_target!.enabled)}
                type="button"
              >
                {props.detail.current_target.enabled ? "关闭上报" : "启用上报"}
              </button>
            </div>
          ) : null}
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
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
          <div className="font-medium text-slate-900">执行时区</div>
          <div className="relative mt-3" ref={timezonePickerRef}>
            <button
              className="flex h-11 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-left text-sm outline-none transition hover:border-indigo-300 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              onClick={() => setTimezoneMenuOpen((value) => !value)}
              type="button"
            >
              <span className="truncate">{timezone}</span>
              <span className="ml-3 shrink-0 text-slate-400">{timezoneMenuOpen ? "收起" : "展开"}</span>
            </button>
            {timezoneMenuOpen ? (
              <div className="absolute left-0 top-full z-30 mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                <div className="space-y-3">
                  <input
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    onChange={(event) => setTimezoneSearch(event.target.value)}
                    placeholder="搜索时区"
                    value={timezoneSearch}
                  />
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {filteredTimezoneOptions.map((item) => (
                      <button
                        key={item}
                        className={[
                          "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition",
                          item === timezone
                            ? "border-indigo-300 bg-indigo-50"
                            : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50"
                        ].join(" ")}
                        onClick={() => {
                          setTimezone(item);
                          setTimezoneSearch("");
                          setTimezoneMenuOpen(false);
                        }}
                        type="button"
                      >
                        <span className="truncate">{item}</span>
                        {item === browserTimeZone ? (
                          <span className="inline-flex shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                            浏览器默认
                          </span>
                        ) : null}
                      </button>
                    ))}
                    {filteredTimezoneOptions.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
                        没有匹配的时区
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            默认使用当前浏览器时区。你看到的执行时间会按这里的时区计算，节点本地时区不会影响执行时间。
          </div>
        </div>
        {previewError ? <p className="text-sm font-medium text-rose-600">{previewError}</p> : null}
        {!previewError && saveError ? <p className="text-sm font-medium text-rose-600">{saveError}</p> : null}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm text-slate-900">最近 10 次执行时间</strong>
            <span className="text-xs text-slate-500">
              {previewError
                ? "请先修正 Cron"
                : saveState === "saving"
                  ? "正在保存…"
                  : saveState === "saved"
                    ? props.detail.has_komari_binding
                      ? "配置完成，请返回 Komari 重新查看"
                      : "已自动保存"
                    : "自动保存"}
            </span>
          </div>
          <p className="text-xs text-slate-500">当前规则按 {preview.timezone || browserTimeZone} 执行，以下时间也按这个时区显示。</p>
          <div className="report-config-next-runs">
            {preview.next_runs.map((value) => (
              <div key={value} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {formatDateTimeInTimeZone(value, preview.timezone || browserTimeZone)}
              </div>
            ))}
          </div>
          {saveState === "saved" && props.detail.has_komari_binding ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-700">
              配置完成，请返回 Komari 重新查看。
            </div>
          ) : null}
        </div>
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
  const [nodeName, setNodeName] = useState("");
  const [nodeNameError, setNodeNameError] = useState("");
  const [nodeNameSaving, setNodeNameSaving] = useState(false);
  const [bindKomariUUID, setBindKomariUUID] = useState("");
  const [bindKomariName, setBindKomariName] = useState("");
  const [bindingEnabled, setBindingEnabled] = useState(false);
  const [bindSaving, setBindSaving] = useState(false);
  const [bindCandidates, setBindCandidates] = useState<KomariBindingCandidate[]>([]);
  const { loading, error, detail, reload } = useNodePageData(props.nodeUUID, selectedTargetID, props.onUnauthorized);
  const [localDetail, setLocalDetail] = useState<NodeDetail | null>(null);

  useEffect(() => {
    setSelectedTargetID(null);
    setTargetInput("");
    setTargetError("");
  }, [props.nodeUUID]);

  useEffect(() => {
    setLocalDetail(detail);
    setNodeName(detail?.name ?? "");
    setNodeNameError("");
    setBindKomariUUID(detail?.komari_node_uuid ?? "");
    setBindKomariName(detail?.komari_node_name ?? "");
    setBindingEnabled(!!detail?.has_komari_binding);
  }, [detail]);

  useEffect(() => {
    if (!bindKomariUUID.trim()) {
      return;
    }
    const matchedByUUID = bindCandidates.find((candidate) => candidate.komari_node_uuid === bindKomariUUID);
    if (!matchedByUUID || matchedByUUID.komari_node_name === bindKomariName) {
      return;
    }
    setBindKomariName(matchedByUUID.komari_node_name);
    setLocalDetail((current) =>
      current
        ? {
            ...current,
            komari_node_name: matchedByUUID.komari_node_name
          }
        : current
    );
  }, [bindCandidates, bindKomariName, bindKomariUUID]);

  useEffect(() => {
    let cancelled = false;

    async function loadCandidates() {
      try {
        const response = await apiRequest<{ items: KomariBindingCandidate[] }>("/nodes/komari-binding/candidates");
        if (cancelled) {
          return;
        }
        setBindCandidates(response.items ?? []);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          props.onUnauthorized();
          return;
        }
        setBindCandidates([]);
      }
    }

    void loadCandidates();
    return () => {
      cancelled = true;
    };
  }, [props.onUnauthorized]);

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

  async function handleToggleTargetEnabled(targetID: number, enabled: boolean) {
    const previousDetail = localDetail;
    setTargetSaving(true);
    setTargetError("");
    try {
      setLocalDetail((current) => {
        if (!current) {
          return current;
        }
        const nextTargets = current.targets.map((item) =>
          item.id === targetID
            ? {
                ...item,
                enabled
              }
            : item
        );
        const nextCurrentTarget =
          current.current_target?.id === targetID
            ? {
                ...current.current_target,
                enabled
              }
            : current.current_target;
        return {
          ...current,
          targets: nextTargets,
          current_target: nextCurrentTarget
        };
      });
      await apiRequest<NodeTargetListItem>(`/nodes/${props.nodeUUID}/targets/${targetID}/${enabled ? "enable" : "disable"}`, {
        method: "POST"
      });
      reload();
    } catch (toggleError) {
      setLocalDetail(previousDetail);
      if (toggleError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setTargetError(toggleError instanceof Error ? toggleError.message : "更新目标 IP 上报状态失败");
    } finally {
      setTargetSaving(false);
    }
  }

  async function handleBindKomari(nextUUID: string, nextName: string) {
    if (!localDetail) {
      return;
    }
    setBindSaving(true);
    setTargetError("");
    try {
      await apiRequest("/nodes/komari-binding", {
        method: "POST",
        body: JSON.stringify({
          node_id: localDetail.id,
          komari_node_uuid: nextUUID.trim(),
          komari_node_name: nextName.trim()
        })
      });
      setLocalDetail((current) =>
        current
          ? {
              ...current,
              komari_node_uuid: nextUUID.trim(),
              komari_node_name: nextName.trim(),
              has_komari_binding: true
            }
          : current
      );
      reload();
      pushToast("Komari 绑定已保存。");
    } catch (bindError) {
      if (bindError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setTargetError(bindError instanceof Error ? bindError.message : "绑定 Komari 失败");
    } finally {
      setBindSaving(false);
    }
  }

  async function handleUnbindKomari() {
    if (!localDetail) {
      return;
    }
    setBindSaving(true);
    setTargetError("");
    try {
      await apiRequest("/nodes/komari-binding", {
        method: "DELETE",
        body: JSON.stringify({
          node_id: localDetail.id
        })
      });
      setLocalDetail((current) =>
        current
          ? {
              ...current,
              has_komari_binding: false,
              komari_node_name: "",
              komari_node_uuid: current.node_uuid || current.komari_node_uuid
            }
          : current
      );
      reload();
      pushToast("Komari 绑定已解除。");
    } catch (bindError) {
      if (bindError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setTargetError(bindError instanceof Error ? bindError.message : "解除 Komari 绑定失败");
    } finally {
      setBindSaving(false);
    }
  }

  async function handleSaveNodeName() {
    if (!nodeName.trim()) {
      setNodeNameError("节点名称不能为空");
      return;
    }
    if (nodeNameSaving || !localDetail || nodeName.trim() === localDetail.name.trim()) {
      return;
    }
    setNodeNameSaving(true);
    setNodeNameError("");
    try {
      await apiRequest(`/nodes/${props.nodeUUID}`, {
        method: "PUT",
        body: JSON.stringify({ name: nodeName.trim() })
      });
      setLocalDetail((current) => (current ? { ...current, name: nodeName.trim() } : current));
      reload();
      pushToast("节点名称已保存。");
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setNodeNameError(saveError instanceof Error ? saveError.message : "保存节点名称失败");
    } finally {
      setNodeNameSaving(false);
    }
  }

  async function handleSelectKomariBinding(nextUUID: string) {
    if (!localDetail || bindSaving) {
      return;
    }

    const trimmedUUID = nextUUID.trim();
    const currentUUID = localDetail.has_komari_binding ? (bindKomariUUID || localDetail.komari_node_uuid || "").trim() : "";
    if (trimmedUUID === currentUUID) {
      return;
    }

    setBindKomariUUID(trimmedUUID);
    if (!trimmedUUID) {
      setBindKomariName("");
      await handleUnbindKomari();
      return;
    }

    const matched = bindCandidates.find((candidate) => candidate.komari_node_uuid === trimmedUUID);
    if (!matched) {
      setTargetError("无法获取当前 Komari 节点名称，请刷新后重试。");
      return;
    }
    setBindKomariName(matched.komari_node_name);
    await handleBindKomari(trimmedUUID, matched.komari_node_name);
  }

  async function handleBindingEnabledChange(enabled: boolean) {
    if (!localDetail || bindSaving) {
      return;
    }
    setBindingEnabled(enabled);
    if (!enabled) {
      setBindKomariUUID("");
      setBindKomariName("");
      if (localDetail.has_komari_binding) {
        await handleUnbindKomari();
      }
      return;
    }
    if (localDetail.has_komari_binding && bindKomariUUID.trim()) {
      return;
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
      onToggleTargetEnabled={(targetID, enabled) => void handleToggleTargetEnabled(targetID, enabled)}
      bindKomariUUID={bindKomariUUID}
      bindKomariName={bindKomariName}
      bindCandidates={bindCandidates}
      bindSaving={bindSaving}
      bindingEnabled={bindingEnabled}
      onBindingEnabledChange={(enabled) => void handleBindingEnabledChange(enabled)}
      onBindKomariUUIDChange={(value) => void handleSelectKomariBinding(value)}
      onTargetInputChange={setTargetInput}
      nodeName={nodeName}
      nodeNameError={nodeNameError}
      nodeNameSaving={nodeNameSaving}
      onNodeNameChange={setNodeName}
      onSaveNodeName={() => void handleSaveNodeName()}
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
    setStartDate(historyQueryValueToInputValue(props.startDate));
  }, [props.startDate]);

  useEffect(() => {
    setEndDate(historyQueryValueToInputValue(props.endDate));
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
                    props.onApply({
                      startDate: historyInputValueToQueryValue(startDate),
                      endDate: historyInputValueToQueryValue(endDate)
                    });
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
        <span>时间 {describeHistoryDateRange(startDate, endDate)}</span>
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
              step={1}
              value={props.leftTimestamp}
              onInput={(event) => props.onLeftChange(clampCompareTimestamp(Number((event.target as HTMLInputElement).value), min, props.rightTimestamp))}
            />
            <input
              className="compare-timeline-input compare-timeline-input-right"
              type="range"
              min={min}
              max={max}
              step={1}
              value={props.rightTimestamp}
              onInput={(event) => props.onRightChange(clampCompareTimestamp(Number((event.target as HTMLInputElement).value), props.leftTimestamp, max))}
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
  const { loading, refreshing, error, errorStatus, detail, reload } = useNodePageData(uuid, selectedTargetID, props.onUnauthorized);
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

  const currentTargetID = detail?.selected_target_id ?? detail?.current_target?.id ?? selectedTargetID ?? null;
  const targetQuery = currentTargetID ? `?target_id=${currentTargetID}` : "";
  const historyPath = `/nodes/${uuid}/history${targetQuery}`;
  const comparePath = `/nodes/${uuid}/compare${targetQuery}`;

  function goToReportConfig() {
    const path = buildReportConfigListPath(uuid);
    if (isEmbed) {
      window.open(toStandaloneAppURL(path), "_blank", "noopener,noreferrer");
      return;
    }
    navigate(path);
  }

  if (loading && !detail) {
    return <NodeDetailLoading />;
  }

  if (isEmbed && errorStatus === 404 && komariReturn) {
    return (
      <EmbedStandaloneNoticePage
        title="IP 质量"
        description="当前节点尚未接入 IPQ，请先完成接入。"
        actionURL={buildConnectPath(uuid, nodeName, { returnTo: komariReturn, resumePopup: true })}
        actionLabel="去接入"
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

  if (isEmbed && detail.needs_connect) {
    return (
      <EmbedStandaloneNoticePage
        title="IP 质量"
        description="当前节点尚未接入 IPQ，请先完成接入。"
        actionURL={buildConnectPath(uuid, nodeName, { returnTo: komariReturn, resumePopup: true })}
        actionLabel="去接入"
      />
    );
  }

  if (isEmbed && !detail.has_data) {
    return (
      <EmbedStandaloneNoticePage
        title="IP 质量"
        description={
          detail.targets.length === 0
            ? "当前节点还没有配置目标 IP，请在独立页面继续配置。"
            : "当前节点还没有 IP 质量数据，请在独立页面继续查看或调整配置。"
        }
        actionURL={buildReportConfigListPath(uuid)}
        actionLabel="在独立页面继续"
      />
    );
  }

  return (
    <section className={isEmbed ? "embed-detail-page space-y-4" : "space-y-6"}>
      <PageHeader
        title={detail.name}
        subtitle={detail.has_data ? `最近更新: ${formatDateTime(detail.updated_at ?? undefined)}` : "当前还没有任何 IP 结果"}
        backTo={isEmbed ? undefined : "/nodes"}
        actions={
          detail.current_target ? (
            isEmbed ? (
              <>
                <a
                  className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600"
                  href={toStandaloneAppURL(historyPath)}
                  rel="noreferrer"
                  target="_blank"
                >
                  历史记录
                </a>
                <a
                  className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600"
                  href={toStandaloneAppURL(comparePath)}
                  rel="noreferrer"
                  target="_blank"
                >
                  快照对比
                </a>
              </>
            ) : (
              <Link
                className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600"
                to={historyPath}
              >
                查看历史记录
              </Link>
            )
          ) : undefined
        }
      />

      <section className={isEmbed ? "embed-detail-card rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm" : "rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm"}>
        <div className="section space-y-4">
          {detail.targets.length > 0 ? (
            <TargetTabs
              items={detail.targets.map((item) => ({ id: item.id, label: item.ip, has_data: item.has_data }))}
              selectedId={detail.selected_target_id ?? detail.current_target?.id ?? null}
              onSelect={(targetID) => replaceTargetSelection(targetID)}
              variant="attached"
            />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              <span>当前节点还没有目标 IP。</span>
              <button className="button" onClick={goToReportConfig} type="button">
                去接入
              </button>
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
  const selectedFieldID = searchParams.get("field")?.trim() || "";
  const requestedPageSize = Number(searchParams.get("page_size") || "");
  const historyPageSize = [10, 20, 50, 100].includes(requestedPageSize) ? requestedPageSize : 10;
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

  function replaceSelection(
    nextTargetID: number | null,
    nextPage?: number | null,
    nextFilters?: { startDate?: string; endDate?: string },
    nextFieldID?: string,
    nextPageSize?: number
  ) {
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
    const resolvedFieldID = nextFieldID ?? selectedFieldID;
    if (resolvedFieldID.trim()) {
      params.set("field", resolvedFieldID.trim());
    } else {
      params.delete("field");
    }
    const resolvedPageSize = nextPageSize ?? historyPageSize;
    if (resolvedPageSize !== 10) {
      params.set("page_size", String(resolvedPageSize));
    } else {
      params.delete("page_size");
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
                }, "")
              }
              onTargetChange={(targetID) => replaceSelection(targetID, 1, undefined, "")}
              onFieldChange={(fieldID) => {
                replaceSelection(selectedTargetID, 1, undefined, fieldID);
              }}
            />

            <HistoryPagination
              page={currentHistoryPage}
              totalPages={historyTotalPages}
              total={historyTotal}
              pageSize={historyPageSize}
              onPageChange={(page) => replaceSelection(selectedTargetID, page)}
              onPageSizeChange={(pageSize) => {
                replaceSelection(selectedTargetID, 1, undefined, selectedFieldID, pageSize);
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
  const firstRecordedAt = orderedHistory[0]?.recorded_at ?? "";
  const lastRecordedAt = orderedHistory[orderedHistory.length - 1]?.recorded_at ?? "";

  useEffect(() => {
    if (orderedHistory.length === 0) {
      setLeftTimestamp(0);
      setRightTimestamp(0);
      return;
    }
    setLeftTimestamp(parseRecordedAtTimestamp(orderedHistory[0].recorded_at));
    setRightTimestamp(parseRecordedAtTimestamp(orderedHistory[orderedHistory.length - 1].recorded_at));
  }, [detail?.current_target?.id, firstRecordedAt, lastRecordedAt]);

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
      pushToast(toggleError instanceof Error ? toggleError.message : "更新快照收藏状态失败", "error");
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
  const nodeName = searchParams.get("node_name")?.trim() || "IP质量体检报告";
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

  function goToReportConfig() {
    if (isEmbed) {
      return;
    }
    const path = buildReportConfigListPath(uuid);
    navigate(path);
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
  const currentTargetUpdatedAt = detail.current_target?.updated_at ?? undefined;

  return (
    <section className={isEmbed ? "embed-detail-page space-y-4" : "space-y-6"}>
      <PageHeader
        title={isEmbed ? nodeName : "IP质量体检报告"}
        subtitle={currentTargetUpdatedAt ? `最近更新: ${formatDateTime(currentTargetUpdatedAt)}` : "当前公开结果"}
        backTo={isEmbed ? undefined : "/"}
      />
      <section className={isEmbed ? "embed-detail-card rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm" : "rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm"}>
        <div className="section space-y-4">
          {targets.length > 0 ? (
            <TargetTabs
              items={targets.map((item) => ({ id: item.id, label: item.label, has_data: item.has_data }))}
              selectedId={detail.selected_target_id ?? detail.current_target?.id ?? null}
              onSelect={(targetID) => replaceTargetSelection(targetID)}
              variant={isEmbed ? "attached" : "default"}
            />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              <span>管理员还没有配置可查看的目标 IP。</span>
              {!isEmbed ? (
                <button className="button" onClick={goToReportConfig} type="button">
                  去接入
                </button>
              ) : null}
            </div>
          )}
        </div>
        {detail.current_target ? (
          <div className="section">
            <div className="detail-target-panel" data-detail-report="true">
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
  const publicBaseURL = (integration?.public_base_url ?? "").trim();
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
      pushToast(successText);
    } catch {
      pushToast("复制失败，请手动复制。", "error");
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
      pushToast(options.successText);
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

function NotificationPage(_props: { onUnauthorized: () => void }) {
  return null;
}

function APIKeysPage(props: { onUnauthorized: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<APIKeyDetail[]>([]);
  const [logs, setLogs] = useState<APIAccessLog[]>([]);
  const [selectedLogKeyID, setSelectedLogKeyID] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadKeys() {
    setLoading(true);
    setError("");
    try {
      const [keysResponse, logsResponse] = await Promise.all([
        apiRequest<{ items: APIKeyDetail[] }>("/admin/api-keys"),
        apiRequest<{ items: APIAccessLog[] }>("/admin/api-access-logs")
      ]);
      setItems(keysResponse.items ?? []);
      setLogs(logsResponse.items ?? []);
    } catch (loadError) {
      if (loadError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "加载 API Key 失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs(apiKeyID?: number | null) {
    const query = apiKeyID && apiKeyID > 0 ? `?api_key_id=${apiKeyID}` : "";
    const logsResponse = await apiRequest<{ items: APIAccessLog[] }>(`/admin/api-access-logs${query}`);
    setLogs(logsResponse.items ?? []);
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }
    void loadLogs(selectedLogKeyID);
  }, [selectedLogKeyID]);

  async function handleCreate() {
    setSaving(true);
    setError("");
    try {
      const response = await apiRequest<APIKeyCreateResult>("/admin/api-keys", {
        method: "POST",
        body: JSON.stringify({ name })
      });
      setCreatedKey(response.key);
      setName("");
      await loadKeys();
      pushToast("API Key 已创建。");
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "创建 API Key 失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAPIKey(id: number, enabled: boolean) {
    try {
      await apiRequest(`/admin/api-keys/${id}/${enabled ? "enable" : "disable"}`, { method: "POST" });
      await loadKeys();
    } catch (toggleError) {
      if (toggleError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(toggleError instanceof Error ? toggleError.message : "更新 API Key 状态失败");
    }
  }

  async function deleteAPIKey(id: number) {
    try {
      await apiRequest(`/admin/api-keys/${id}`, { method: "DELETE" });
      await loadKeys();
    } catch (deleteError) {
      if (deleteError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(deleteError instanceof Error ? deleteError.message : "删除 API Key 失败");
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader title="API Key" subtitle="用于未来只读 API 的访问认证。创建后明文只显示一次。" />
      {error ? <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">{error}</div> : null}

      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">创建 API Key</h2>
            <p className="text-sm text-slate-500">建议为不同调用方分别创建独立的只读 Key。</p>
          </div>
          <label className="grid gap-2 text-sm text-slate-700">
            <span>名称</span>
            <input className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div>
            <button className="button" disabled={saving || !name.trim()} onClick={() => void handleCreate()} type="button">
              {saving ? "创建中..." : "创建 API Key"}
            </button>
          </div>
          {createdKey ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
              <div className="font-medium text-amber-900">请立即保存明文 Key</div>
              <pre className="mt-2 overflow-x-auto rounded-xl bg-white px-3 py-3 text-xs text-slate-700">{createdKey}</pre>
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">现有 Key</h2>
            <p className="text-sm text-slate-500">当前只支持只读场景，明文不会再次显示。</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            使用方式：
            <pre className="mt-2 overflow-x-auto rounded-xl bg-white px-3 py-3 text-xs text-slate-700">curl -H "X-IPQ-API-Key: &lt;your-key&gt;" {`${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/public/v1/nodes`}</pre>
          </div>
          {loading ? (
            <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">还没有 API Key。</div>
          ) : (
            <div className="grid gap-3">
              {items.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium text-slate-900">{item.name}</div>
                      <div className="text-xs text-slate-500">状态：{item.enabled ? "启用" : "停用"} · 最近使用：{item.last_used_at ? formatDateTime(item.last_used_at) : "从未使用"}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="button ghost" onClick={() => void toggleAPIKey(item.id, !item.enabled)} type="button">
                        {item.enabled ? "停用" : "启用"}
                      </button>
                      <button className="button ghost" onClick={() => void deleteAPIKey(item.id)} type="button">
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">最近 API 访问记录</h2>
            <p className="text-sm text-slate-500">帮助你查看 public API 最近被哪个 Key 调用、命中了什么路径、返回了什么状态。</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              value={selectedLogKeyID ?? ""}
              onChange={(event) => setSelectedLogKeyID(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">全部 Key</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <button className="button ghost" onClick={() => void loadLogs(selectedLogKeyID)} type="button">
              刷新
            </button>
          </div>
          {logs.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">还没有 API 访问记录。</div>
          ) : (
            <div className="grid gap-3">
              {logs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900">
                        Key #{log.api_key_id} · {log.method} {log.path}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatDateTime(log.created_at)} · 状态 {log.status_code}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">
                      {log.remote_addr || "unknown"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
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
      pushToast("历史保留设置已保存。");
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
      pushToast("用户信息已保存，请重新登录。");
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

        <form className="section mt-6 space-y-4" onSubmit={handleSave}>
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
    <EmbedStandaloneNoticePage
      title="需要登录"
      description="当前管理员链路需要先登录，再继续后续配置。"
      actionURL={buildConnectPath(uuid, nodeName, { returnTo: komariReturn, resumePopup: true })}
    />
  );
}

function AppShell(props: { me: MeResponse; onLogout: () => Promise<void>; onUnauthorized: () => void }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const embedTheme = getEmbedTheme(searchParams);
  const embedAppearance = getEmbedAppearance(searchParams);
  const embedGlassStyle = getEmbedGlassStyle(searchParams);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (!isEmbed) {
      delete root.dataset.ipqEmbedTheme;
      delete body.dataset.ipqEmbedTheme;
      delete root.dataset.ipqEmbedAppearance;
      delete body.dataset.ipqEmbedAppearance;
      return;
    }

    root.dataset.ipqEmbedTheme = embedTheme;
    body.dataset.ipqEmbedTheme = embedTheme;
    root.dataset.ipqEmbedAppearance = embedAppearance;
    body.dataset.ipqEmbedAppearance = embedAppearance;

    return () => {
      delete root.dataset.ipqEmbedTheme;
      delete body.dataset.ipqEmbedTheme;
      delete root.dataset.ipqEmbedAppearance;
      delete body.dataset.ipqEmbedAppearance;
    };
  }, [embedAppearance, embedTheme, isEmbed]);

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
      <Route path="/settings/notification" element={<NotificationHomePage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/settings/notification/channel" element={<NotificationChannelSettingsPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/settings/notification/deliveries" element={<NotificationDeliveriesPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/settings/api-keys" element={<APIKeysPage onUnauthorized={props.onUnauthorized} />} />
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
      <div
        className={`embed-shell embed-theme-${embedTheme} embed-appearance-${embedAppearance} bg-slate-50 text-slate-900`}
        style={embedGlassStyle}
      >
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
    <>
      <Routes>
        <Route path="/" element={<Navigate to={me ? "/nodes" : "/login"} replace />} />
        <Route
          path="/public/nodes/:uuid"
          element={
            <EmbedFrameShell>
              <PublicNodeDetailPage />
            </EmbedFrameShell>
          }
        />
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
      <ToastViewport />
    </>
  );
}
