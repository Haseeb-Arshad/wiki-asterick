import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

/** A side panel (bottom sheet on phones) with a scrim, Escape to close and focus return. */
export function Sheet({
  title,
  subtitle,
  side = "right",
  className = "",
  tools,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  side?: "left" | "right";
  className?: string;
  tools?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = panelRef.current?.querySelector<HTMLElement>("input, [data-autofocus], button");
    focusable?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <aside ref={panelRef} className={`sheet ${side === "left" ? "left" : ""} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close panel">
            <Icon name="x" size={20} />
          </button>
        </div>
        {tools && <div className="sheet-tools">{tools}</div>}
        <div className="sheet-body">{children}</div>
      </aside>
    </>
  );
}
