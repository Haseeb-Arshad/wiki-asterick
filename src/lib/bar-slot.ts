import { useSyncExternalStore } from "react";

/** The spot in the ask bar where the reader puts its own buttons (contents, save). */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setBarSlot(element: HTMLElement | null) {
  if (slot === element) return;
  slot = element;
  listeners.forEach((listener) => listener());
}

export function useBarSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => slot,
    () => null
  );
}
