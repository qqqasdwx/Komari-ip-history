import {
  useEffect,
  useRef,
  useState
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { renderDisplayValueBadge } from "../lib/display-fields";
import { formatDateTime } from "../lib/format";
import {
  describeHistoryDateRange,
  historyDateRangePresets,
  historyInputValueToQueryValue,
  historyQueryValueToInputValue
} from "../lib/history-date";
import {
  useNodeHistoryEvents,
  useNodeHistoryFieldOptions,
  useNodePageData
} from "../hooks/node-data";
import { HistoryPagination } from "../components/history/history-pagination";
import { PageHeader } from "../components/layout/page-header";
import { NodeDetailLoading } from "../components/node/node-detail-loading";
import { NodePageError } from "../components/node/node-page-error";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

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
          <Button
            data-history-range-trigger="true"
            className={[
              "flex h-11 w-full justify-between rounded-xl border bg-white px-3 text-left text-sm font-normal hover:bg-white focus:ring-2 focus:ring-indigo-100",
              rangeOpen || props.startDate || props.endDate
                ? "border-indigo-300 text-slate-900 focus:border-indigo-300"
                : "border-slate-200 text-slate-700 hover:border-indigo-300 focus:border-indigo-300"
            ].join(" ")}
            onClick={() => setRangeOpen((value) => !value)}
            type="button"
          >
            <span className="truncate">{describeHistoryDateRange(startDate, endDate)}</span>
            <span className="ml-3 shrink-0 text-slate-400">{rangeOpen ? "收起" : "展开"}</span>
          </Button>
          {rangeOpen ? (
            <div className="absolute left-0 top-full z-20 mt-2 w-[min(720px,calc(100vw-8rem))] rounded-[18px] border border-slate-200 bg-white p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">选择时间范围</p>
                  <p className="text-xs text-slate-500">支持快捷范围，也可以手动指定开始和结束日期。</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label className="font-normal text-slate-700" htmlFor="history-start-date">
                    开始日期
                  </Label>
                  <Input
                    className="h-10 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
                    id="history-start-date"
                    type="datetime-local"
                    step={1}
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="font-normal text-slate-700" htmlFor="history-end-date">
                    结束日期
                  </Label>
                  <Input
                    className="h-10 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
                    id="history-end-date"
                    type="datetime-local"
                    step={1}
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {historyDateRangePresets.map((preset) => (
                  <Button
                    key={preset.label}
                    className="h-9 rounded-full border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
                    onClick={() => {
                      const next = preset.resolve();
                      setStartDate(next.startDate);
                      setEndDate(next.endDate);
                    }}
                    type="button"
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  className="rounded-full border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
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
                </Button>
                <Button
                  className="rounded-full border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-700"
                  onClick={() => {
                    setStartDate("");
                    setEndDate("");
                    props.onApply({ startDate: "", endDate: "" });
                    setRangeOpen(false);
                  }}
                  type="button"
                >
                  清空
                </Button>
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

export function NodeHistoryPage(props: { onUnauthorized: () => void }) {
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
            <Button
              asChild
              className="rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
            >
              <Link to={historyPathForCompare}>快照对比</Link>
            </Button>
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
              <Button
                className="h-9 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
                onClick={() => {
                  reload();
                  reloadHistory();
                  reloadFieldOptions();
                }}
                type="button"
              >
                刷新
              </Button>
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
