import { RotateCcw } from "lucide-react";
import { PageHeader } from "../layout/page-header";
import { Button } from "../ui/button";

export function NodePageError(props: {
  title: string;
  subtitle: string;
  backTo: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <section className="space-y-6">
      <PageHeader title={props.title} subtitle={props.subtitle} backTo={props.backTo} />
      <section className="rounded-[24px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">
        <div className="space-y-4">
          <p>{props.error}</p>
          <div>
            <Button
              className="rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
              onClick={props.onRetry}
              type="button"
            >
              <RotateCcw className="size-4" />
              <span>重试</span>
            </Button>
          </div>
        </div>
      </section>
    </section>
  );
}
