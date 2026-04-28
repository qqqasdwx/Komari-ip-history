export function SearchBox(props: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="w-full sm:w-auto"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <input
        className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 sm:min-w-[320px]"
        placeholder="搜索节点名称"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button className="sr-only" type="submit">
        搜索
      </button>
    </form>
  );
}
