import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/layout/page-header";
import { NodePageError } from "../components/node/node-page-error";
import { apiRequest, UnauthorizedError } from "../lib/api";
import { buildReportConfigListPath } from "../lib/embed-navigation";

export function ConnectPage(props: { onUnauthorized: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const uuid = searchParams.get("uuid")?.trim() || "";
  const name = searchParams.get("name")?.trim() || "未命名节点";
  const isEmbed = searchParams.get("embed") === "1";
  const returnTo = searchParams.get("return_to")?.trim() || "";

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
          navigate(buildReportConfigListPath(uuid, { fromKomari: true, nodeName: name }), { replace: true });
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
  }, [isEmbed, location.pathname, location.search, name, navigate, props.onUnauthorized, returnTo, uuid]);

  if (loading) {
    return (
      <section className="space-y-6">
        <PageHeader
          title="接入节点"
          subtitle={returnTo ? "正在打开独立配置页。" : "正在为当前节点创建或恢复 IP 质量视图。"}
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
