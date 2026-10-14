import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  message: string;
  tone: "neutral" | "success" | "error";
  action?: { label: string; onClick: () => void };
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

export function toast(message: string, options: Partial<Omit<Toast, "id" | "message">> & { duration?: number } = {}) {
  const id = nextId++;
  toasts = [...toasts.slice(-2), { id, message, tone: options.tone ?? "neutral", action: options.action }];
  emit();
  window.setTimeout(() => dismissToast(id), options.duration ?? (options.action ? 6000 : 3200));
  return id;
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
    () => toasts
  );
}
