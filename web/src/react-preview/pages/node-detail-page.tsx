import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import {
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
import { Button } from "../components/ui/button";
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
        description="当前节点尚未配置，正在打开独立页面继续。"
        actionURL={buildReportConfigListPath(uuid, { fromKomari: true, nodeName })}
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

  return (
    <section className={isEmbed ? "embed-detail-page space-y-4" : "space-y-6"}>
      <PageHeader
        title={detail.name}
        subtitle={detail.has_data ? `最近更新: ${formatDateTime(detail.updated_at ?? undefined)}` : "当前还没有任何 IP 结果"}
        backTo={isEmbed ? undefined : "/nodes"}
        actions={
          detail.current_target && !isEmbed ? (
            <Button
              asChild
              className="rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
            >
              <Link to={historyPath}>查看历史记录</Link>
            </Button>
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
              {!isEmbed ? (
                <Button className="rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]" onClick={goToReportConfig} type="button">
                  去接入
                </Button>
              ) : null}
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
