import { Cross2Icon } from "@radix-ui/react-icons";
import { type DragEvent, useState } from "react";

export function TargetTabs(props: {
  items: Array<{ id: number; label: string; has_data: boolean }>;
  selectedId: number | null;
  onSelect: (targetID: number) => void;
  onReorder?: (sourceID: number, destinationID: number) => void;
  onDelete?: (targetID: number) => void;
  variant?: "default" | "attached";
}) {
  const [draggingTargetID, setDraggingTargetID] = useState<number | null>(null);
  const isAttached = props.variant === "attached";

  function handleDrop(destinationID: number) {
    if (!props.onReorder || draggingTargetID === null || draggingTargetID === destinationID) {
      setDraggingTargetID(null);
      return;
    }
    props.onReorder(draggingTargetID, destinationID);
    setDraggingTargetID(null);
  }

  return (
    <div className={isAttached ? "target-tabs target-tabs-attached" : "flex flex-wrap items-center gap-2"}>
      {props.items.map((item) => (
        <div key={item.id} className={isAttached ? "group relative target-tab-shell" : "group relative"}>
          <button
            className={[
              isAttached
                ? "target-tab-button target-tab-button-attached"
                : "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition",
              props.onDelete ? "pr-10" : "",
              props.selectedId === item.id
                ? isAttached
                  ? "is-active"
                  : "border-indigo-200 bg-indigo-50 text-indigo-600"
                : isAttached
                  ? ""
                  : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:text-indigo-600"
            ].join(" ")}
            draggable={Boolean(props.onReorder)}
            onClick={() => props.onSelect(item.id)}
            onDragOver={(event: DragEvent<HTMLButtonElement>) => {
              if (props.onReorder) {
                event.preventDefault();
              }
            }}
            onDragStart={() => setDraggingTargetID(item.id)}
            onDrop={() => handleDrop(item.id)}
            onDragEnd={() => setDraggingTargetID(null)}
            type="button"
          >
            <span
              className={[
                "inline-block h-2.5 w-2.5 rounded-full",
                item.has_data ? "bg-emerald-500" : "bg-slate-300"
              ].join(" ")}
            />
            <span>{item.label}</span>
          </button>
          {props.onDelete ? (
            <button
              aria-label={`删除 ${item.label}`}
              className={[
                "absolute inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600",
                isAttached ? "right-2 top-[18px]" : "right-2 top-1/2 -translate-y-1/2"
              ].join(" ")}
              onClick={(event) => {
                event.stopPropagation();
                void props.onDelete?.(item.id);
              }}
              type="button"
            >
              <Cross2Icon />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
