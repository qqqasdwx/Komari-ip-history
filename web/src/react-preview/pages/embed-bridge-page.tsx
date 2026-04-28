import { useEffect } from "react";
import { PageHeader } from "../components/layout/page-header";
import { postEmbedAction, toStandaloneAppURL } from "../lib/embed-navigation";

export function EmbedBridgePage(props: { title: string; description: string; actionURL: string }) {
  useEffect(() => {
    postEmbedAction("open-standalone", { url: toStandaloneAppURL(props.actionURL) });
  }, [props.actionURL]);

  return (
    <section className="space-y-6">
      <PageHeader title={props.title} subtitle={props.description} />
      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm leading-6 text-slate-500">正在打开独立页面继续处理。</p>
      </section>
    </section>
  );
}
