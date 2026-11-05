import { useSyncExternalStore } from "react";

/** Notificações discretas (sucesso, aviso, erro). Somem sozinhas; erros ficam mais tempo. */
export type ToastLevel = "info" | "ok" | "warn" | "error";
interface Toast {
  id: number;
  text: string;
  level: ToastLevel;
}
let items: Toast[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function toast(text: string, level: ToastLevel = "info", ms?: number): void {
  const id = ++seq;
  items = [...items.slice(-3), { id, text, level }];
  emit();
  setTimeout(() => dismiss(id), ms ?? (level === "error" ? 7000 : level === "warn" ? 5000 : 3200));
}
export function dismiss(id: number): void {
  const n = items.filter((t) => t.id !== id);
  if (n.length !== items.length) {
    items = n;
    emit();
  }
}

export function Toasts() {
  const list = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => items,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.level}`}>
          <span>{t.text}</span>
          <button className="x" onClick={() => dismiss(t.id)} aria-label="Fechar">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
