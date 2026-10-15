import { useEffect, useRef, useState } from "react";
import type { AiNote } from "../../../shared/types";
import { followUpOn, modelLabel, useAsk } from "../../lib/assistant";
import { formatRelative } from "../../lib/format";
import { toast } from "../../lib/toast";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

export interface NoteActions {
  onRemove: (note: AiNote) => void;
  onRestore: (note: AiNote) => void;
  /** Scrolls the article to the passage a note was asked about. */
  onJump?: (note: AiNote) => void;
  /** Hide "follow up" where the bar can't ask about that page (e.g. the library). */
  canFollowUp?: boolean;
}

/** Notes newest first. The active one (just answered, or picked) opens and scrolls into view. */
export function NotesList({ notes, empty, ...actions }: { notes: AiNote[]; empty?: React.ReactNode } & NoteActions) {
  const { activeNoteId, revealTick } = useAsk();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeNoteId) return;
    const element = listRef.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(activeNoteId)}"]`);
    element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeNoteId, revealTick]);

  if (notes.length === 0) return <>{empty}</>;
  return (
    <div className="ai-notes" ref={listRef}>
      {notes.map((note, index) => (
        <NoteCard key={note.id} note={note} defaultOpen={note.id === activeNoteId || (activeNoteId === null && index === 0)} {...actions} />
      ))}
    </div>
  );
}

export function NoteCard({ note, defaultOpen, onRemove, onRestore, onJump, canFollowUp = true }: { note: AiNote; defaultOpen: boolean } & NoteActions) {
  const { activeNoteId, revealTick } = useAsk();
  const [open, setOpen] = useState(defaultOpen);
  const [showSources, setShowSources] = useState(false);
  const active = note.id === activeNoteId;

  // Revealing a note (from the bar, a margin mark or a fresh answer) opens it.
  // Adjusting state during render: https://react.dev/learn/you-might-not-need-an-effect
  const [seenTick, setSeenTick] = useState(revealTick);
  if (seenTick !== revealTick) {
    setSeenTick(revealTick);
    if (active) setOpen(true);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Q: ${note.question}\n\n${note.answer}`);
      toast("Answer copied", { tone: "success" });
    } catch {
      toast("Couldn't copy to the clipboard.", { tone: "error" });
    }
  }

  function remove() {
    onRemove(note);
    toast("Note deleted", { action: { label: "Undo", onClick: () => onRestore(note) } });
  }

  const webSources = note.sources.filter((source) => source.kind === "web");

  return (
    <article className={`ai-note ${open ? "is-open" : ""} ${active ? "is-active" : ""}`} data-note-id={note.id}>
      <button type="button" className="ai-note-q" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <Icon name="sparkle" size={14} className="ai-note-q-mark" />
        <span>{note.question}</span>
      </button>

      {note.quote && (
        <button type="button" className="ai-note-quote" onClick={onJump ? () => onJump(note) : undefined} disabled={!onJump} title={onJump ? "Show in the article" : undefined}>
          “{note.quote}”
        </button>
      )}

      <div className="ai-note-answer markdown">
        <Markdown text={note.answer} sources={note.sources} />
      </div>
      {!open && (
        <button type="button" className="ai-note-more" onClick={() => setOpen(true)}>
          Show the full answer
        </button>
      )}

      {open && (
        <>
          {note.sources.length > 0 && (
            <div className="ai-note-sources">
              <button type="button" className="ai-note-sources-toggle" onClick={() => setShowSources((value) => !value)} aria-expanded={showSources}>
                <span className="ai-note-favicons" aria-hidden="true">
                  {webSources.slice(0, 4).map((source) =>
                    source.favicon ? <img key={source.url} src={source.favicon} alt="" width={14} height={14} loading="lazy" /> : <i key={source.url}>{source.site.slice(0, 1)}</i>
                  )}
                </span>
                {note.sources.length} {note.sources.length === 1 ? "source" : "sources"}
                <Icon name="chevronDown" size={13} />
              </button>
              {showSources && (
                <ol className="ai-note-source-list">
                  {note.sources.map((source) => (
                    <li key={source.n}>
                      <span className="ai-note-source-n">{source.n}</span>
                      <a href={source.url} target="_blank" rel="noopener noreferrer nofollow">
                        <strong>{source.title}</strong>
                        <span>{source.site}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          <footer className="ai-note-foot">
            <span className="ai-note-meta">
              {formatRelative(note.createdAt)}
              {note.model && ` · ${modelLabel(note.model)}`}
            </span>
            <span className="ai-note-actions">
              {canFollowUp && (
                <button type="button" className="ai-note-action" onClick={() => followUpOn(note)} title="Ask a follow-up">
                  <Icon name="reply" size={15} />
                  <span>Follow up</span>
                </button>
              )}
              <button type="button" className="ai-note-action icon-only" onClick={copy} aria-label="Copy answer" title="Copy">
                <Icon name="copy" size={15} />
              </button>
              <button type="button" className="ai-note-action icon-only" onClick={remove} aria-label="Delete note" title="Delete">
                <Icon name="trash" size={15} />
              </button>
            </span>
          </footer>
        </>
      )}
    </article>
  );
}
