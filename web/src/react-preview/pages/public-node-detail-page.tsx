import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { buildReportConfigListPath } from "../lib/embed-navigation";
import { formatDateTime } from "../lib/format";
import { CurrentReportView } from "../lib/report";
import { usePublicNodePageData } from "../hooks/node-data";
import { PageHeader } from "../components/layout/page-header";
import { NodeDetailLoading } from "../components/node/node-detail-loading";
import { NodePageError } from "../components/node/node-page-error";
import { TargetTabs } from "../components/node/target-tabs";
import { Button } from "../components/ui/button";

export function PublicNodeDetailPage() {
  const { uuid = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const nodeName = searchParams.get("node_name")?.trim() || "IP质量体检报告";
  const displayIP = searchParams.get("display_ip")?.trim() || "";
  const selectedTargetID = Number(searchParams.get("target_id") || "") || null;
  const { loading, error, errorStatus, detail, reload } = usePublicNodePageData(uuid, selectedTargetID, displayIP);

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
    const blocked = errorStatus === 403;
    return (
      <NodePageError
        title="IP质量体检报告"
        subtitle={blocked ? "管理员未开放游客查看" : error || "当前结果不可用"}
        backTo="/"
        error={blocked ? "管理员未开放该功能，请联系管理员或登录后查看。" : error || "当前结果不可用。"}
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
                <Button className="rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]" onClick={goToReportConfig} type="button">
                  去接入
                </Button>
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
