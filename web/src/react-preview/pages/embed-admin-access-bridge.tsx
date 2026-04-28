import { useLocation, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/layout/page-header";
import { buildConnectPath } from "../lib/embed-navigation";
import { EmbedBridgePage } from "./embed-bridge-page";

export function EmbedAdminAccessBridge() {
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
