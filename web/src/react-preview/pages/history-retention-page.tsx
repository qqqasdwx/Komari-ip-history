import { useEffect, useState } from "react";
import { apiRequest, UnauthorizedError } from "../lib/api";
import { formatByteSize, formatRetentionDays } from "../lib/display-format";
import type { HistoryRetentionSettings } from "../lib/types";
import { PageHeader } from "../components/layout/page-header";
import { pushToast } from "../components/toast";

export function HistoryRetentionPage(props: { onUnauthorized: () => void }) {
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
