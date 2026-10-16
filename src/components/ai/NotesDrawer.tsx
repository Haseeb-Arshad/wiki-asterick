import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useSession } from "../../lib/auth";
import { closeNotesDrawer, noteKey, useAsk } from "../../lib/assistant";
import { notesFor, useLibrary } from "../../lib/library";
import { pluralize } from "../../lib/format";
import { Sheet } from "../Sheet";
import { NotesList } from "./NotesList";

/** AI notes for the current page in a left-hand panel (phones, and pages without the reader's rail). */
export function NotesDrawer() {
  const { drawerOpen, context } = useAsk();
  if (!drawerOpen) return null;
  return <Drawer title={context?.title ?? null} />;
}

function Drawer({ title }: { title: string | null }) {
  const { user } = useSession();
  const library = useLibrary(user);
  const { context } = useAsk();
  const key = noteKey(context);
  const notes = useMemo(() => notesFor(library.snapshot, key.wiki, key.title), [library.snapshot, key.wiki, key.title]);

  return (
    <Sheet
      side="left"
      className="notes-sheet"
      alsoFocusable=".askbar-wrap"
      title="AI notes"
      subtitle={title ? `${pluralize(notes.length, "question")} about ${title}` : `${pluralize(notes.length, "general question")}`}
      onClose={closeNotesDrawer}
    >
      <NotesList
        notes={notes}
        onRemove={(note) => library.removeNote(note.id)}
        onRestore={library.addNote}
        empty={
          <div className="notes-empty">
            <p>Questions you ask here are saved with their answers, so they're waiting for you next time.</p>
          </div>
        }
      />
      <p className="notes-sheet-foot">
        {user ? "Synced to your account." : "Saved in this browser. Sign in to keep them everywhere."}{" "}
        <Link to="/library" search={{ tab: "notes" }} onClick={closeNotesDrawer}>
          All AI notes
        </Link>
      </p>
    </Sheet>
  );
}
