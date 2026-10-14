import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Footnote, Highlight, LanguageLink, MediaItem } from "../../../shared/types";
import { wikiProject } from "../../../shared/wiki";
import { formatDuration, formatRelative, pluralize } from "../../lib/format";
import { articleLink } from "../../lib/links";
import { Icon } from "../Icon";
import { Sheet } from "../Sheet";
import type { OutlineEntry } from "./outline";

// ---- contents ----------------------------------------------------------------

export function ContentsSheet({
  outline,
  activeId,
  highlightCounts,
  onSelect,
  onClose,
}: {
  outline: OutlineEntry[];
  activeId: string;
  highlightCounts: Map<string, Highlight["color"][]>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Contents" subtitle={pluralize(outline.length - 1, "section")} side="left" className="mobile-toc" onClose={onClose}>
      <TocList outline={outline} activeId={activeId} highlightCounts={highlightCounts} onSelect={onSelect} />
    </Sheet>
  );
}

export function TocList({
  outline,
  activeId,
  highlightCounts,
  onSelect,
}: {
  outline: OutlineEntry[];
  activeId: string;
  highlightCounts: Map<string, Highlight["color"][]>;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="toc-list">
      {outline.map((entry) => {
        const colors = highlightCounts.get(entry.id) ?? [];
        return (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className={`toc-link level-${Math.min(entry.level, 5)} ${entry.id === activeId ? "active" : ""}`}
              aria-current={entry.id === activeId ? "location" : undefined}
              onClick={(event) => {
                event.preventDefault();
                onSelect(entry.id);
              }}
            >
              {entry.title || "Introduction"}
              {colors.length > 0 && (
                <span className="marks" aria-label={pluralize(colors.length, "highlight")}>
                  {colors.slice(0, 3).map((color, index) => (
                    <i key={index} className={`swatch ${color}`} />
                  ))}
                </span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

// ---- notes (highlights) ----------------------------------------------------------

export function NotesSheet({
  highlights,
  isGuest,
  onJump,
  onUpdate,
  onRemove,
  onExport,
  onClose,
}: {
  highlights: Highlight[];
  isGuest: boolean;
  onJump: (highlight: Highlight) => void;
  onUpdate: (id: string, patch: { note?: string; color?: Highlight["color"] }) => void;
  onRemove: (highlight: Highlight) => void;
  onExport: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title="Your highlights"
      subtitle={isGuest ? "Saved in this browser" : "Synced to your account"}
      onClose={onClose}
      tools={
        highlights.length > 0 ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onExport}>
            <Icon name="download" size={15} /> Export as Markdown
          </button>
        ) : undefined
      }
    >
      {highlights.length === 0 ? (
        <div className="sheet-empty">
          <Icon name="pen" size={30} />
          <strong>No highlights yet</strong>
          <span>Select any passage in the article to highlight it or add a note.</span>
        </div>
      ) : (
        highlights.map((highlight) => (
          <NoteCard key={highlight.id} highlight={highlight} onJump={onJump} onUpdate={onUpdate} onRemove={onRemove} />
        ))
      )}
      {isGuest && highlights.length > 0 && (
        <div className="banner" style={{ marginTop: 20 }}>
          <span>
            <strong>Keep these everywhere</strong>
            Create a free account and your highlights follow you to any device.
          </span>
          <Link to="/signup" search={{ redirect: window.location.pathname }} className="btn btn-primary btn-sm">
            Create account
          </Link>
        </div>
      )}
    </Sheet>
  );
}

function NoteCard({
  highlight,
  onJump,
  onUpdate,
  onRemove,
}: {
  highlight: Highlight;
  onJump: (highlight: Highlight) => void;
  onUpdate: (id: string, patch: { note?: string }) => void;
  onRemove: (highlight: Highlight) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(highlight.note);

  return (
    <article className={`note-card ${highlight.color}`}>
      <blockquote>{highlight.text}</blockquote>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onUpdate(highlight.id, { note: draft.trim() });
            setEditing(false);
          }}
          style={{ marginTop: 10 }}
        >
          <textarea className="input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a note…" autoFocus />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm">
              Save note
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        highlight.note && <p className="note-text">{highlight.note}</p>
      )}
      <footer>
        <span>
          {highlight.sectionTitle || "Introduction"} · {formatRelative(highlight.createdAt)}
        </span>
        <span className="actions">
          <button type="button" className="icon-btn" onClick={() => onJump(highlight)} aria-label="Show in article" title="Show in article">
            <Icon name="arrowRight" size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setEditing(true)} aria-label="Edit note" title="Edit note">
            <Icon name="note" size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={() => onRemove(highlight)} aria-label="Delete highlight" title="Delete">
            <Icon name="trash" size={16} />
          </button>
        </span>
      </footer>
    </article>
  );
}

// ---- references --------------------------------------------------------------

export function ReferencesSheet({ footnotes, targetId, onClose }: { footnotes: Footnote[]; targetId: string | null; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? footnotes.filter((note) => note.text.toLowerCase().includes(needle)) : footnotes;
  }, [footnotes, query]);

  useEffect(() => {
    if (!targetId) return;
    bodyRef.current?.querySelector(`[data-ref="${CSS.escape(targetId)}"]`)?.scrollIntoView({ block: "center" });
  }, [targetId]);

  return (
    <Sheet
      title="References"
      subtitle={pluralize(footnotes.length, "source")}
      onClose={onClose}
      tools={<input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter references" aria-label="Filter references" />}
    >
      <div ref={bodyRef}>
        {filtered.length === 0 && <div className="sheet-empty">No references match “{query}”.</div>}
        {filtered.map((note) => (
          <div key={note.id} className={`ref-item ${note.id === targetId ? "is-target" : ""}`} data-ref={note.id}>
            <span className="ref-label">{note.label}</span>
            <div>
              <p>{note.text}</p>
              {note.url && (
                <a href={note.url} target="_blank" rel="noopener noreferrer nofollow" className="text-link">
                  Open source <Icon name="external" size={13} />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

// ---- media ---------------------------------------------------------------------

type MediaFilter = "all" | MediaItem["type"];

export function MediaSheet({ media, onOpen, onClose }: { media: MediaItem[]; onOpen: (index: number) => void; onClose: () => void }) {
  const [filter, setFilter] = useState<MediaFilter>("all");
  const counts = useMemo(() => {
    const result = { image: 0, video: 0, audio: 0 };
    for (const item of media) result[item.type] += 1;
    return result;
  }, [media]);

  const filters: { value: MediaFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: media.length },
    { value: "video", label: "Videos", count: counts.video },
    { value: "image", label: "Images", count: counts.image },
    { value: "audio", label: "Audio", count: counts.audio },
  ];

  return (
    <Sheet
      title="Media"
      subtitle={[counts.video && pluralize(counts.video, "video"), counts.image && pluralize(counts.image, "image"), counts.audio && pluralize(counts.audio, "audio clip")]
        .filter(Boolean)
        .join(" · ")}
      className="gallery-sheet"
      onClose={onClose}
      tools={
        <div className="media-filters" style={{ padding: 0 }}>
          {filters
            .filter((option) => option.value === "all" || option.count > 0)
            .map((option) => (
              <button key={option.value} type="button" className="chip" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
                {option.label} <span style={{ opacity: 0.6 }}>{option.count}</span>
              </button>
            ))}
        </div>
      }
    >
      <div className="media-grid">
        {media.map((item, index) =>
          filter !== "all" && item.type !== filter ? null : (
            <button key={item.id} type="button" className="media-tile" onClick={() => onOpen(index)} aria-label={item.caption || item.file}>
              {item.thumb ? (
                <img src={item.thumb} alt="" loading="lazy" />
              ) : (
                <span className="audio-art">
                  <Icon name={item.type === "audio" ? "headphones" : "video"} size={32} />
                </span>
              )}
              {item.type !== "image" && (
                <span className="media-badge">
                  <Icon name={item.type === "audio" ? "headphones" : "play"} size={12} />
                  {item.durationSeconds ? formatDuration(item.durationSeconds) : item.type === "audio" ? "Audio" : "Video"}
                </span>
              )}
            </button>
          )
        )}
      </div>
    </Sheet>
  );
}

// ---- languages -------------------------------------------------------------------

export function LanguagesSheet({ wiki, languages, onClose }: { wiki: string; languages: LanguageLink[]; onClose: () => void }) {
  const project = wikiProject(wiki);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return languages;
    return languages.filter(
      (language) =>
        language.autonym.toLowerCase().includes(needle) || language.lang.includes(needle) || language.title.toLowerCase().includes(needle)
    );
  }, [languages, query]);

  return (
    <Sheet
      title="Read in another language"
      subtitle={pluralize(languages.length, "language")}
      onClose={onClose}
      tools={<input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a language" aria-label="Find a language" />}
    >
      <ul className="lang-list">
        {filtered.map((language) => (
          <li key={language.lang}>
            <Link {...articleLink(`${language.lang}.${project}.org`, language.title)} onClick={onClose}>
              <span>{language.autonym}</span>
              <small lang={language.lang}>{language.title}</small>
            </Link>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ---- keyboard shortcuts -------------------------------------------------------------

const SHORTCUTS: [string, string[]][] = [
  ["Search", ["/"]],
  ["Next / previous section", ["j", "k"]],
  ["Save article", ["s"]],
  ["Contents", ["t"]],
  ["Highlights and notes", ["n"]],
  ["Media gallery", ["m"]],
  ["References", ["r"]],
  ["Listen", ["p"]],
  ["Ask AI", ["a"]],
  ["This help", ["?"]],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcut-list">
          {SHORTCUTS.map(([label, keys]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 18 }} onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}
