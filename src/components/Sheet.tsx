import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), audio[controls], video[controls]';

// Open sheets, newest last. Only the newest one keeps Tab inside itself.
const openSheets: HTMLElement[] = [];

/**
 * A side panel (bottom sheet on phones) with a scrim, Escape to close and focus return.
 * Tab stays inside the panel, plus anything matching `alsoFocusable` (the notes panel
 * keeps the Ask bar reachable, since follow-ups are asked from there).
 */
export function Sheet({
  title,
  subtitle,
  side = "right",
  className = "",
  tools,
  alsoFocusable,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  side?: "left" | "right";
  className?: string;
  tools?: ReactNode;
  alsoFocusable?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = panel?.querySelector<HTMLElement>("input, [data-autofocus], button");
    focusable?.focus({ preventScroll: true });
    if (panel) openSheets.push(panel);

    const cycleFocus = (event: KeyboardEvent) => {
      if (!panel || openSheets[openSheets.length - 1] !== panel) return;
      const scopes = [panel, ...(alsoFocusable ? document.querySelectorAll<HTMLElement>(alsoFocusable) : [])];
      const items = scopes
        .flatMap((scope) => [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)])
        .filter((item) => item.getClientRects().length > 0 && !item.closest("[inert]"));
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = index === -1 ? (event.shiftKey ? items.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      } else if (event.key === "Tab") {
        cycleFocus(event);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (panel && openSheets.includes(panel)) openSheets.splice(openSheets.indexOf(panel), 1);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [onClose, alsoFocusable]);

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
