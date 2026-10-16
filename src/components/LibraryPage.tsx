import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import type { AiNote, Bookmark, Highlight, HistoryEntry, LibrarySnapshot } from "../../shared/types";
import { useSession } from "../lib/auth";
import { formatDate, formatRelative, pluralize } from "../lib/format";
import { useLibrary } from "../lib/library";
import { filterSnapshot, libraryToJson, libraryToMarkdown, sortBookmarks, sortHistory, type HistorySort, type SavedSort } from "../../shared/library-tools";
import { refLink } from "../lib/links";
import { setPaletteOpen } from "../lib/search";
import { toast } from "../lib/toast";
import { NotesList } from "./ai/NotesList";
import { Icon } from "./Icon";
import { downloadText } from "./reader/exporters";

export type LibraryTab = "saved" | "highlights" | "notes" | "history";

export function LibraryPage({ tab }: { tab?: LibraryTab }) {
  const { user } = useSession();
  const library = useLibrary(user);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [savedSort, setSavedSort] = useState<SavedSort>("newest");
  const [historySort, setHistorySort] = useState<HistorySort>("recent");
  const { snapshot } = library;
  const searching = query.trim().length > 0;
  const view = useMemo(() => filterSnapshot(snapshot, query), [snapshot, query]);
  const isEmpty = !snapshot.bookmarks.length && !snapshot.highlights.length && !snapshot.notes.length && !snapshot.history.length;

  // With no tab chosen, open the first one that has something in it.
  const active: LibraryTab =
    tab ?? (snapshot.bookmarks.length ? "saved" : snapshot.highlights.length ? "highlights" : snapshot.notes.length ? "notes" : snapshot.history.length ? "history" : "saved");

  // While searching, the counts show how many items match in each section.
  const tabs: { id: LibraryTab; label: string; count: number; total: number }[] = [
    { id: "saved", label: "Saved", count: view.bookmarks.length, total: snapshot.bookmarks.length },
    { id: "highlights", label: "Highlights", count: view.highlights.length, total: snapshot.highlights.length },
    { id: "notes", label: "AI notes", count: view.notes.length, total: snapshot.notes.length },
    { id: "history", label: "History", count: view.history.length, total: snapshot.history.length },
  ];
  const current = tabs.find((item) => item.id === active)!;
  const noMatches = searching && current.total > 0 && current.count === 0;

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <header className="page-head">
        <h1 className="page-title">Your library</h1>
        <p className="page-sub">
          {user
            ? `Everything you save and highlight, synced to ${user.email}.`
            : "Everything you save and highlight while reading. Right now it lives in this browser."}
        </p>
      </header>

      {!user && (
        <div className="banner">
          <span>
            <strong>Reading as a guest</strong>
            Create a free account to keep your library across devices. What you've saved here comes with you.
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <Link to="/signin" search={{ redirect: "/library" }} className="btn btn-secondary btn-sm">
              Sign in
            </Link>
            <Link to="/signup" search={{ redirect: "/library" }} className="btn btn-primary btn-sm">
              Create account
            </Link>
          </span>
        </div>
      )}

      {!library.isLoading && !isEmpty && (
        <div className="library-tools">
          <label className="library-search">
            <Icon name="search" size={17} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your library"
              aria-label="Search your library"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <ExportMenu snapshot={snapshot} />
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Library sections">
        {tabs.map((item) => (
          <Link
            key={item.id}
            to="/library"
            search={{ tab: item.id }}
            role="tab"
            aria-selected={active === item.id}
            className="tab"
            replace
          >
            {item.label}
            <span className="count">{item.count}</span>
          </Link>
        ))}
      </div>

      {library.isLoading ? (
        <div aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton" style={{ height: 72, margin: "16px 0", borderRadius: 14 }} />
          ))}
        </div>
      ) : noMatches ? (
        <NoMatches query={query.trim()} others={tabs.filter((item) => item.id !== active && item.count > 0)} onClear={() => setQuery("")} />
      ) : active === "saved" ? (
        <SavedList library={library} items={sortBookmarks(view.bookmarks, savedSort)} sort={savedSort} onSort={setSavedSort} />
      ) : active === "highlights" ? (
        <HighlightList highlights={view.highlights} onRemove={library.removeHighlight} />
      ) : active === "notes" ? (
        <AiNoteGroups notes={view.notes} onRemove={(note) => library.removeNote(note.id)} onRestore={library.addNote} />
      ) : (
        <HistoryList
          library={library}
          items={sortHistory(view.history, historySort)}
          sort={historySort}
          onSort={setHistorySort}
          onClear={() => {
            library.clearHistory();
            toast("Reading history cleared");
            navigate({ to: "/library", search: { tab: "history" }, replace: true });
          }}
        />
      )}
    </div>
  );
}

type LibraryApi = ReturnType<typeof useLibrary>;

function Empty({ icon, title, body }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; body: string }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={30} />
      <h3>{title}</h3>
      <p>{body}</p>
      <button type="button" className="btn btn-primary" onClick={() => setPaletteOpen(true)}>
        <Icon name="search" size={16} /> Find something to read
      </button>
    </div>
  );
}

/** "Wikipedia · English" style label for a wiki host. */
function sourceLabel(wiki: string): string {
  if (wiki.startsWith("web:")) return wiki.slice(4);
  const [lang, project] = wiki.split(".");
  const projectName = project.charAt(0).toUpperCase() + project.slice(1);
  let language = lang;
  try {
    language = new Intl.DisplayNames(["en"], { type: "language" }).of(lang) ?? lang;
  } catch {
    // unknown codes stay as-is
  }
  return `${projectName} · ${language}`;
}

const shortDate = (time: number) => formatDate(time, { month: "short", day: "numeric", year: "numeric" });

function NoMatches({ query, others, onClear }: { query: string; others: { id: LibraryTab; label: string; count: number }[]; onClear: () => void }) {
  return (
    <div className="empty-state">
      <Icon name="search" size={30} />
      <h3>No matches for “{query}”</h3>
      <p>
        {others.length
          ? `Nothing here, but it appears in ${others.map((item) => `${item.label} (${item.count})`).join(", ")}.`
          : "Try fewer words, or check the spelling."}
      </p>
      <div className="message-actions">
        {others.map((item) => (
          <Link key={item.id} to="/library" search={{ tab: item.id }} className="btn btn-secondary" replace>
            Show {item.label}
          </Link>
        ))}
        <button type="button" className="btn btn-ghost" onClick={onClear}>
          Clear search
        </button>
      </div>
    </div>
  );
}

/** Download the whole library as Markdown to read or keep, or as JSON for a backup. */
function ExportMenu({ snapshot }: { snapshot: LibrarySnapshot }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const today = new Date().toISOString().slice(0, 10);
  const save = (kind: "md" | "json") => {
    if (ref.current) ref.current.open = false;
    if (kind === "md") downloadText(`wikiasterisk-library-${today}.md`, libraryToMarkdown(snapshot));
    else downloadText(`wikiasterisk-library-${today}.json`, libraryToJson(snapshot), "application/json;charset=utf-8");
    toast("Library exported", { tone: "success" });
  };
  return (
    <details className="export-menu" ref={ref}>
      <summary className="btn btn-secondary btn-sm">
        <Icon name="download" size={16} /> Export
      </summary>
      <div className="menu" role="menu">
        <button type="button" className="menu-item" role="menuitem" onClick={() => save("md")}>
          <Icon name="book" size={17} /> Markdown, to read
        </button>
        <button type="button" className="menu-item" role="menuitem" onClick={() => save("json")}>
          <Icon name="download" size={17} /> JSON, a full backup
        </button>
      </div>
    </details>
  );
}

function SortSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <label className="sort-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function SavedList({ library, items, sort, onSort }: { library: LibraryApi; items: Bookmark[]; sort: SavedSort; onSort: (sort: SavedSort) => void }) {
  if (!library.snapshot.bookmarks.length) {
    return <Empty icon="bookmark" title="Nothing saved yet" body="Tap Save on any article to keep it here for later." />;
  }
  return (
    <>
      <div className="index-tools">
        <SortSelect<SavedSort>
          label="Sort by"
          value={sort}
          options={[
            ["newest", "Newest saved"],
            ["oldest", "Oldest saved"],
            ["title", "Title A–Z"],
          ]}
          onChange={onSort}
        />
      </div>
      <SavedTable library={library} items={items} />
    </>
  );
}

function SavedTable({ library, items }: { library: LibraryApi; items: Bookmark[] }) {
  return (
    <table className="index-table">
      <thead>
        <tr>
          <th scope="col">Title</th>
          <th scope="col" className="hide-sm">
            Source
          </th>
          <th scope="col">Saved</th>
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={`${item.wiki}:${item.title}`}>
            <td className="index-title">
              <Link {...refLink(item)}>{item.title}</Link>
              {item.description && <small>{item.description}</small>}
            </td>
            <td className="hide-sm">{sourceLabel(item.wiki)}</td>
            <td className="index-date">{shortDate(item.createdAt)}</td>
            <td className="index-actions">
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${item.title} from saved`}
                title="Remove"
                onClick={() => {
                  library.setBookmark(item, false);
                  toast(`Removed “${item.title}”`, { action: { label: "Undo", onClick: () => library.setBookmark(item, true) } });
                }}
              >
                <Icon name="trash" size={17} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function HighlightList({ highlights, onRemove }: { highlights: Highlight[]; onRemove: (id: string) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, { wiki: string; title: string; url: string | null; items: Highlight[] }>();
    for (const highlight of highlights) {
      const key = `${highlight.wiki}:${highlight.articleTitle}`;
      const group = map.get(key) ?? { wiki: highlight.wiki, title: highlight.articleTitle, url: highlight.url ?? null, items: [] };
      group.items.push(highlight);
      map.set(key, group);
    }
    return [...map.values()];
  }, [highlights]);

  if (!groups.length) {
    return <Empty icon="pen" title="No highlights yet" body="Select a passage in any article and pick a color. Your highlights and notes collect here." />;
  }

  return (
    <div className="highlight-groups">
      {groups.map((group) => (
        <section key={`${group.wiki}:${group.title}`} className="highlight-group">
          <h3>
            <Link {...refLink(group)}>{group.title}</Link>
            <span className="section-meta">{pluralize(group.items.length, "highlight")}</span>
          </h3>
          {group.items.map((highlight) => (
            <article key={highlight.id} className={`note-card ${highlight.color}`}>
              <blockquote>{highlight.text}</blockquote>
              {highlight.note && <p className="note-text">{highlight.note}</p>}
              <footer>
                <span>
                  {highlight.sectionTitle || "Introduction"} · {formatRelative(highlight.createdAt)}
                </span>
                <span className="actions">
                  <Link
                    {...refLink(group, highlight.sectionId || undefined)}
                    className="icon-btn"
                    aria-label="Open in article"
                    title="Open in article"
                  >
                    <Icon name="arrowRight" size={16} />
                  </Link>
                  <button type="button" className="icon-btn" onClick={() => onRemove(highlight.id)} aria-label="Delete highlight" title="Delete">
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </footer>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

/** AI notes grouped by the page they were asked on; general questions last. */
function AiNoteGroups({ notes, onRemove, onRestore }: { notes: AiNote[]; onRemove: (note: AiNote) => void; onRestore: (note: AiNote) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, { wiki: string; title: string; url: string | null; items: AiNote[] }>();
    for (const note of notes) {
      const key = note.wiki === "general" ? "general" : `${note.wiki}:${note.articleTitle}`;
      const group = map.get(key) ?? { wiki: note.wiki, title: note.articleTitle, url: note.url ?? null, items: [] };
      group.items.push(note);
      map.set(key, group);
    }
    return [...map.values()].sort((a, b) => Number(a.wiki === "general") - Number(b.wiki === "general"));
  }, [notes]);

  if (!groups.length) {
    return (
      <Empty
        icon="sparkle"
        title="No AI notes yet"
        body="Ask a question from the bar at the bottom of any article. Each answer is saved here and with the article, ready for when you come back."
      />
    );
  }

  return (
    <div className="highlight-groups">
      {groups.map((group) => (
        <section key={`${group.wiki}:${group.title}`} className="highlight-group">
          <h3>
            {group.wiki === "general" ? <span>General questions</span> : <Link {...refLink(group)}>{group.title}</Link>}
            <span className="section-meta">{pluralize(group.items.length, "question")}</span>
          </h3>
          <NotesList notes={group.items} onRemove={onRemove} onRestore={onRestore} canFollowUp={false} />
        </section>
      ))}
    </div>
  );
}

function HistoryList({
  library,
  items,
  sort,
  onSort,
  onClear,
}: {
  library: LibraryApi;
  items: HistoryEntry[];
  sort: HistorySort;
  onSort: (sort: HistorySort) => void;
  onClear: () => void;
}) {
  if (!library.snapshot.history.length) {
    return <Empty icon="clock" title="No reading history" body="Articles you open show up here, with your place saved so you can pick up where you left off." />;
  }
  return (
    <>
      <div className="index-tools">
        <SortSelect<HistorySort>
          label="Show"
          value={sort}
          options={[
            ["recent", "Most recent"],
            ["unfinished", "Unfinished first"],
          ]}
          onChange={onSort}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          Clear history
        </button>
      </div>
      <table className="index-table">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col" className="hide-sm">
              Progress
            </th>
            <th scope="col">Last read</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => (
            <tr key={`${entry.wiki}:${entry.title}`}>
              <td className="index-title">
                <Link {...refLink(entry, entry.sectionId ?? undefined)}>{entry.title}</Link>
                {entry.description && <small>{entry.description}</small>}
              </td>
              <td className="hide-sm">
                {entry.progress >= 0.97 ? "Finished" : `${Math.round(entry.progress * 100)}%`}
                <span className="progress-track" aria-hidden="true">
                  <span style={{ transform: `scaleX(${Math.max(0.03, entry.progress)})` }} />
                </span>
              </td>
              <td className="index-date">{formatRelative(entry.readAt)}</td>
              <td className="index-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${entry.title} from history`}
                  title="Remove"
                  onClick={() => library.removeHistory(entry.wiki, entry.title)}
                >
                  <Icon name="x" size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
