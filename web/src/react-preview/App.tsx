import {
  ExitIcon,
  GearIcon,
  RowsIcon
} from "@radix-ui/react-icons";
import {
  useEffect,
  useRef,
  useState
} from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { apiRequest, UnauthorizedError } from "./lib/api";
import { renderDisplayValueBadge } from "./lib/display-fields";
import { formatDateTime } from "./lib/format";
import {
  describeHistoryDateRange,
  historyDateRangePresets,
  historyInputValueToQueryValue,
  historyQueryValueToInputValue
} from "./lib/history-date";
import { buildHistoryCompareRows, mapDisplayPathToReportPaths } from "./lib/history";
import { CurrentReportView } from "./lib/report";
import { routeLabel } from "./lib/route-label";
import {
  useAllNodeHistoryData,
  useNodeHistoryEvents,
  useNodeHistoryFieldOptions,
  useNodePageData
} from "./hooks/node-data";
import type {
  MeResponse,
  NodeHistoryEntry
} from "./lib/types";
import { AppLoading } from "./components/layout/app-loading";
import { HistoryPagination } from "./components/history/history-pagination";
import {
  EmbedFrameShell,
  getEmbedAppearance,
  getEmbedGlassStyle,
  getEmbedTheme
} from "./components/layout/embed-frame-shell";
import { PageHeader } from "./components/layout/page-header";
import { SidebarSection, type NavItem } from "./components/layout/sidebar-section";
import { NodeDetailLoading } from "./components/node/node-detail-loading";
import { NodePageError } from "./components/node/node-page-error";
import { TargetTabs } from "./components/node/target-tabs";
import { ConnectPage } from "./pages/connect-page";
import { EmbedAdminAccessBridge } from "./pages/embed-admin-access-bridge";
import { AdminPage } from "./pages/admin-page";
import { HistoryRetentionPage } from "./pages/history-retention-page";
import { IntegrationPage } from "./pages/integration-page";
import { LoginPage } from "./pages/login-page";
import { NodeDetailPage } from "./pages/node-detail-page";
import { NodesPage } from "./pages/nodes-page";
import { PublicNodeDetailPage } from "./pages/public-node-detail-page";
import { pushToast, ToastViewport } from "./components/toast";

const nodeNavItems: NavItem[] = [{ to: "/nodes", label: "节点结果", icon: <RowsIcon /> }];

const settingsNavItems: NavItem[] = [
  { to: "/settings/integration", label: "接入配置", icon: <GearIcon /> },
  { to: "/settings/history-retention", label: "历史保留", icon: <GearIcon /> },
  { to: "/settings/user", label: "用户", icon: <GearIcon /> }
];

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
