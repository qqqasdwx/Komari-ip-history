import { PageHeader } from "../components/layout/page-header";
import { toStandaloneAppURL } from "../lib/embed-navigation";

export function EmbedBridgePage(props: { title: string; description: string; actionURL: string; actionLabel?: string }) {
  const actionLabel = props.actionLabel || "打开独立页面";

  return (
    <section className="embed-detail-page space-y-6">
      <PageHeader title={props.title} subtitle={props.description} />
      <section className="embed-bridge-card rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm leading-6 text-slate-500">请在独立页面继续处理。</p>
          <a
            className="embed-bridge-action inline-flex h-10 items-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[#6868e8]"
            href={toStandaloneAppURL(props.actionURL)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {actionLabel}
          </a>
        </div>
      </section>
    </section>
  );
}
