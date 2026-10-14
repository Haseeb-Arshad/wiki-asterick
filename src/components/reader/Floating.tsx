import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { placeFloating } from "../../lib/hooks";

type Anchor = HTMLElement | (() => DOMRect);

function rectOf(anchor: Anchor): DOMRect {
  return typeof anchor === "function" ? anchor() : anchor.getBoundingClientRect();
}

/**
 * A fixed-position panel placed next to an anchor (an element or a rect
 * getter, e.g. a text selection). It flips above/below to stay on screen and
 * follows the anchor while the page scrolls.
 */
export function Floating({
  anchor,
  className = "",
  prefer = "below",
  gap = 10,
  children,
  onPointerEnter,
  onPointerLeave,
  role,
  label,
}: {
  anchor: Anchor;
  className?: string;
  prefer?: "below" | "above";
  gap?: number;
  children: ReactNode;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  role?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; placement: "above" | "below" } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    let frame = 0;
    const update = () => {
      const rect = rectOf(anchor);
      const size = { width: element.offsetWidth, height: element.offsetHeight };
      if (prefer === "above") {
        const above = rect.top - gap - size.height;
        if (above > 12) {
          const left = Math.min(Math.max(12, rect.left + rect.width / 2 - size.width / 2), window.innerWidth - size.width - 12);
          setPosition({ top: above, left, placement: "above" });
          return;
        }
      }
      setPosition(placeFloating(rect, size, gap));
    };

    update();
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
  }, [anchor, gap, prefer]);

  return (
    <div
      ref={ref}
      className={className}
      role={role}
      aria-label={label}
      data-placement={position?.placement ?? prefer}
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        visibility: position ? "visible" : "hidden",
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>
  );
}
