import { ArrowLeft } from "lucide-react";
import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui/button";

export function PageHeader(props: {
  title: string;
  subtitle?: string;
  backTo?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        {props.backTo ? (
          <Button
            asChild
            className="h-9 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
          >
            <Link to={props.backTo}>
              <ArrowLeft className="size-4" />
              <span>返回</span>
            </Link>
          </Button>
        ) : null}
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{props.title}</h1>
          {props.subtitle ? <p className="text-sm text-slate-500">{props.subtitle}</p> : null}
        </div>
      </div>
      {props.actions ? <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">{props.actions}</div> : null}
    </header>
  );
}
