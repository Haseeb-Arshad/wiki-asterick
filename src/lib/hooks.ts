import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export const DEFAULT_TITLE = "WikiAsterisk — Wikipedia, without the clutter";

/** Names the browser tab while a page is open ("Your library — WikiAsterisk"); restores the default after. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} — WikiAsterisk`;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** True while the page is scrolled down past `threshold` pixels and the reader is moving down. */
export function useHideOnScroll(threshold = 120): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - last;
        if (Math.abs(delta) > 6) {
          setHidden(delta > 0 && y > threshold);
          last = y;
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [threshold]);
  return hidden;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
}

/**
 * Single-key shortcuts ("j", "?", "mod+k"). Ignored while typing in a field,
 * except for "mod+" combinations and Escape.
 */
export function useHotkeys(bindings: Record<string, (event: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = `${mod ? "mod+" : ""}${event.key.toLowerCase()}`;
      const handler = ref.current[key] ?? (event.key === "?" ? ref.current["?"] : undefined);
      if (!handler) return;
      if (!mod && key !== "escape" && isTypingTarget(event.target)) return;
      if (!mod && (event.altKey || event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** Calls `onOutside` for pointer presses outside every given element. */
export function useOutsidePress(refs: React.RefObject<HTMLElement | null>[], onOutside: () => void, enabled = true) {
  const callback = useRef(onOutside);
  useEffect(() => {
    callback.current = onOutside;
  });

  useEffect(() => {
    if (!enabled) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      callback.current();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

/** Positions a floating element next to an anchor rectangle, flipping to stay on screen. */
export function placeFloating(anchor: DOMRect, size: { width: number; height: number }, gap = 10) {
  const margin = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top = anchor.bottom + gap;
  let placement: "below" | "above" = "below";
  if (top + size.height > viewportHeight - margin && anchor.top - gap - size.height > margin) {
    top = anchor.top - gap - size.height;
    placement = "above";
  }

  const centered = anchor.left + anchor.width / 2 - size.width / 2;
  const left = Math.min(Math.max(margin, centered), viewportWidth - size.width - margin);
  return { top, left, placement };
}
