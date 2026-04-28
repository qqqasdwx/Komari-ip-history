import { useEffect, useState } from "react";

export function HistoryPagination(props: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const [jumpValue, setJumpValue] = useState(String(props.page));

  useEffect(() => {
    setJumpValue(String(props.page));
  }, [props.page]);

  if (props.totalPages <= 1) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">共 {props.total} 条变化记录。</p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">每页</span>
          <select
            className="h-9 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            value={props.pageSize}
            onChange={(event) => props.onPageSizeChange(Number(event.target.value))}
          >
            {[10, 20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">
        第 {props.page} / {props.totalPages} 页，共 {props.total} 条变化记录，每页 {props.pageSize} 条。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">每页</span>
        <select
          className="h-9 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          value={props.pageSize}
          onChange={(event) => props.onPageSizeChange(Number(event.target.value))}
        >
          {[10, 20, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <button
          className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => props.onPageChange(props.page - 1)}
          type="button"
          disabled={props.page <= 1}
        >
          上一页
        </button>
        <button
          className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => props.onPageChange(props.page + 1)}
          type="button"
          disabled={props.page >= props.totalPages}
        >
          下一页
        </button>
        <input
          className="h-9 w-20 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          value={jumpValue}
          onChange={(event) => setJumpValue(event.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
        />
        <button
          className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
          onClick={() => {
            const nextPage = Number.parseInt(jumpValue, 10);
            if (!Number.isNaN(nextPage) && nextPage >= 1 && nextPage <= props.totalPages) {
              props.onPageChange(nextPage);
            }
          }}
          type="button"
        >
          跳转
        </button>
      </div>
    </div>
  );
}
