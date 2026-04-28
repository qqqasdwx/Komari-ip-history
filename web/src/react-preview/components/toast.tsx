import { useEffect, useState } from "react";

type ToastTone = "success" | "error";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

let toastSeed = 0;
let toastState: ToastItem[] = [];
const toastListeners = new Set<(items: ToastItem[]) => void>();

function emitToasts() {
  const snapshot = [...toastState];
  for (const listener of toastListeners) {
    listener(snapshot);
  }
}

function dismissToast(id: number) {
  toastState = toastState.filter((item) => item.id !== id);
  emitToasts();
}

export function pushToast(message: string, tone: ToastTone = "success") {
  const id = ++toastSeed;
  toastState = [...toastState, { id, message, tone }];
  emitToasts();
  window.setTimeout(() => dismissToast(id), 2600);
}

export function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>(toastState);

  useEffect(() => {
    toastListeners.add(setItems);
    return () => {
      toastListeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {items.map((item) => (
        <div key={item.id} className={`toast-item toast-item-${item.tone}`}>
          {item.message}
        </div>
      ))}
    </div>
  );
}
