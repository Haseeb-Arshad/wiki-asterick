import { useSyncExternalStore } from "react";

/**
 * A tiny localStorage-backed store. Survives reloads, syncs across tabs, and
 * degrades to in-memory state when storage is unavailable (private mode).
 */
export function createPersistedStore<T>(key: string, fallback: T, parse: (raw: unknown) => T = (raw) => raw as T) {
  let value = read();
  const listeners = new Set<() => void>();

  function read(): T {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : parse(JSON.parse(raw));
    } catch {
      return fallback;
    }
  }

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function set(next: T | ((previous: T) => T)) {
    value = typeof next === "function" ? (next as (previous: T) => T)(value) : next;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded or storage blocked: keep the in-memory value.
    }
    emit();
  }

  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key !== key) return;
      value = read();
      emit();
    });
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  const get = () => value;

  return {
    get,
    set,
    subscribe,
    use: () => useSyncExternalStore(subscribe, get, get),
  };
}
