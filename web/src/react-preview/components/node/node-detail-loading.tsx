export function NodeDetailLoading() {
  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <div className="h-9 w-28 animate-pulse rounded-full bg-slate-100" />
        <div className="h-9 w-64 animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-5 w-80 animate-pulse rounded-xl bg-slate-100" />
      </div>
      <div className="h-80 animate-pulse rounded-[24px] bg-slate-100" />
      <div className="h-40 animate-pulse rounded-[24px] bg-slate-100" />
    </section>
  );
}
