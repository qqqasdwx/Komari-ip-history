import type * as React from "react";

import { cn } from "../../lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "flex h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50 focus:border-slate-950 focus:ring-2 focus:ring-slate-200",
        className
      )}
      {...props}
    />
  );
}

export { Input };
