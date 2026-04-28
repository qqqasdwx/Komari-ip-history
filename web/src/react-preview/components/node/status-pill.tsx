export function StatusPill(props: { hasData: boolean }) {
  return (
    <span
      className={[
        "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium",
        props.hasData
          ? "border-indigo-100 bg-indigo-50 text-indigo-600"
          : "border-amber-200 bg-amber-50 text-amber-700"
      ].join(" ")}
    >
      {props.hasData ? "有数据" : "无数据"}
    </span>
  );
}
