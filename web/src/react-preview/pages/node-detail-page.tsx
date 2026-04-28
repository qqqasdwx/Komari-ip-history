import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import {
  buildConnectPath,
  buildReportConfigListPath,
  toStandaloneAppURL
} from "../lib/embed-navigation";
import { formatDateTime } from "../lib/format";
import { CurrentReportView } from "../lib/report";
import { useNodePageData } from "../hooks/node-data";
import type { MeResponse } from "../lib/types";
import { PageHeader } from "../components/layout/page-header";
import { NodeDetailLoading } from "../components/node/node-detail-loading";
import { NodePageError } from "../components/node/node-page-error";
import { TargetTabs } from "../components/node/target-tabs";
import { EmbedBridgePage } from "./embed-bridge-page";

export function NodeDetailPage(props: { me: MeResponse; onUnauthorized: () => void }) {
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
      window.location.assign(toStandaloneAppURL(path));
      return;
    }
    navigate(path);
  }

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
