import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Footnote, Highlight, HighlightColor } from "../../../shared/types";
import { useOutsidePress } from "../../lib/hooks";
import { summaryQuery } from "../../lib/queries";
import { Icon } from "../Icon";
import { Thumb } from "../Thumb";
import { Floating } from "./Floating";

const HIGHLIGHT_COLORS: { value: HighlightColor; label: string }[] = [
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "pink", label: "Pink" },
];

function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void, extra: React.RefObject<HTMLElement | null>[] = []) {
  useOutsidePress([ref, ...extra], onClose);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

// ---- footnotes ------------------------------------------------------------------

export function FootnotePopover({
  footnote,
  anchor,
  onShowAll,
  onClose,
}: {
  footnote: Footnote;
  anchor: HTMLElement;
  onShowAll: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement>(anchor);
  useDismiss(ref, onClose, [anchorRef]);

  return (
    <Floating anchor={anchor} className="popover footnote-pop" role="dialog" label={`Reference ${footnote.label}`}>
      <div ref={ref}>
        <header>
          <span>Reference {footnote.label}</span>
          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose} aria-label="Close reference">
            <Icon name="x" size={16} />
          </button>
        </header>
        <p>{footnote.text}</p>
        <footer>
          {footnote.url && (
            <a href={footnote.url} target="_blank" rel="noopener noreferrer nofollow" className="text-link">
              Open source <Icon name="external" size={13} />
            </a>
          )}
          <button type="button" className="text-link" style={{ border: 0, background: "none", padding: 0 }} onClick={onShowAll}>
            All references
          </button>
        </footer>
      </div>
    </Floating>
  );
}

// ---- link previews ----------------------------------------------------------------

export function LinkPreview({
  wiki,
  title,
  anchor,
  onPointerEnter,
  onPointerLeave,
}: {
  wiki: string;
  title: string;
  anchor: HTMLElement;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const summary = useQuery(summaryQuery(wiki, title));
  const data = summary.data;

  return (
    <Floating anchor={anchor} className="popover preview-card" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} role="tooltip">
      {summary.isError ? (
        <div className="preview-body">
          <strong>{title}</strong>
          <small>Preview unavailable</small>
        </div>
      ) : !data ? (
        <div className="preview-skeleton" aria-busy="true">
          <div className="skeleton" style={{ height: 22, width: "60%" }} />
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text" style={{ width: "85%" }} />
        </div>
      ) : (
        <>
          {data.thumbnail && <Thumb src={data.thumbnail} width={500} eager />}
          <div className="preview-body" dir={data.dir} lang={data.lang}>
            <strong>{data.title}</strong>
            {data.description && <small>{data.description}</small>}
            {data.extract && <p>{data.extract}</p>}
          </div>
        </>
      )}
    </Floating>
  );
}

// ---- text selection ------------------------------------------------------------------

export function SelectionToolbar({
  getRect,
  onHighlight,
  onNote,
  onCopy,
  onShare,
}: {
  getRect: () => DOMRect;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onCopy: () => void;
  onShare: () => void;
}) {
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  return (
    // On touch screens the OS shows its own menu above the selection, so go below.
    <Floating anchor={getRect} prefer={coarse ? "below" : "above"} className="selection-bar" role="toolbar" label="Highlight selection" gap={12}>
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color.value}
          type="button"
          className="swatch-btn"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onHighlight(color.value)}
          aria-label={`Highlight ${color.label.toLowerCase()}`}
          title={`Highlight ${color.label.toLowerCase()}`}
        >
          <span className={`swatch ${color.value}`} />
        </button>
      ))}
      <span className="divider" />
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onNote}>
        <Icon name="note" size={16} /> Note
      </button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onCopy} aria-label="Copy quote" title="Copy quote">
        <Icon name="copy" size={16} />
      </button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onShare} aria-label="Share quote" title="Share quote">
        <Icon name="share" size={16} />
      </button>
    </Floating>
  );
}

// ---- an existing highlight ----------------------------------------------------------------

export function HighlightPopover({
  highlight,
  getRect,
  startEditing,
  onChange,
  onDelete,
  onCopy,
  onClose,
}: {
  highlight: Highlight;
  getRect: () => DOMRect;
  startEditing: boolean;
  onChange: (patch: { note?: string; color?: HighlightColor }) => void;
  onDelete: () => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState(highlight.note);
  const [editing, setEditing] = useState(startEditing || Boolean(highlight.note));
  const latest = useRef({ note: highlight.note, saved: highlight.note });
  useEffect(() => {
    latest.current.note = note;
  }, [note]);

  const save = () => {
    const trimmed = latest.current.note.trim();
    if (trimmed !== latest.current.saved) {
      latest.current.saved = trimmed;
      onChange({ note: trimmed });
    }
  };

  const close = () => {
    save();
    onClose();
  };

  useDismiss(ref, close);

  return (
    <Floating anchor={getRect} className="popover note-pop" role="dialog" label="Edit highlight">
      <div ref={ref}>
        <div className="swatches" role="group" aria-label="Highlight color">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              aria-pressed={highlight.color === color.value}
              aria-label={color.label}
              onClick={() => onChange({ color: color.value })}
            >
              <span className={`swatch ${color.value}`} />
            </button>
          ))}
        </div>
        {editing ? (
          <textarea
            className="input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={save}
            placeholder="Add a note…"
            aria-label="Note"
            autoFocus={startEditing}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) close();
            }}
          />
        ) : (
          <button type="button" className="btn btn-secondary btn-sm btn-block" onClick={() => setEditing(true)}>
            <Icon name="note" size={15} /> Add a note
          </button>
        )}
        <footer>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCopy}>
            <Icon name="copy" size={15} /> Copy
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
            <Icon name="trash" size={15} /> Remove
          </button>
        </footer>
      </div>
    </Floating>
  );
}
