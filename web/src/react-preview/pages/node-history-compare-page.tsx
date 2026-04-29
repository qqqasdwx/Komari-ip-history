import {
  useEffect,
  useRef,
  useState
} from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { apiRequest, UnauthorizedError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { buildHistoryCompareRows, mapDisplayPathToReportPaths } from "../lib/history";
import { CurrentReportView } from "../lib/report";
import {
  useAllNodeHistoryData,
  useNodePageData
} from "../hooks/node-data";
import type { NodeHistoryEntry } from "../lib/types";
import { PageHeader } from "../components/layout/page-header";
import { NodeDetailLoading } from "../components/node/node-detail-loading";
import { NodePageError } from "../components/node/node-page-error";
import { TargetTabs } from "../components/node/target-tabs";
import { pushToast } from "../components/toast";
import { Button } from "../components/ui/button";

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
        <Button
          className={[
            "h-9 rounded-full border px-4 text-sm font-medium",
            props.entry.is_favorite
              ? "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-50"
              : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
          ].join(" ")}
          disabled={props.favoriteSaving}
          onClick={props.onToggleFavorite}
          type="button"
        >
          {props.favoriteSaving ? "处理中..." : props.entry.is_favorite ? "取消收藏" : "收藏快照"}
        </Button>
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

export function NodeHistoryComparePage(props: { onUnauthorized: () => void }) {
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
            <Button
              className="h-9 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
              onClick={() => {
                reload();
                reloadHistory();
              }}
              type="button"
            >
              刷新
            </Button>
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
