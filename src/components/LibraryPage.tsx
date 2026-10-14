import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import type { Highlight } from "../../shared/types";
import { useSession } from "../lib/auth";
import { formatDate, formatRelative, pluralize } from "../lib/format";
import { useLibrary } from "../lib/library";
import { articleLink } from "../lib/links";
import { setPaletteOpen } from "../lib/search";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";

export type LibraryTab = "saved" | "highlights" | "history";

export function LibraryPage({ tab }: { tab: LibraryTab }) {
  const { user } = useSession();
  const library = useLibrary(user);
  const navigate = useNavigate();
  const { bookmarks, highlights, history } = library.snapshot;

  const tabs: { id: LibraryTab; label: string; count: number }[] = [
    { id: "saved", label: "Saved", count: bookmarks.length },
    { id: "highlights", label: "Highlights", count: highlights.length },
    { id: "history", label: "History", count: history.length },
  ];

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

      <div className="tabs" role="tablist" aria-label="Library sections">
        {tabs.map((item) => (
          <Link
            key={item.id}
            to="/library"
            search={{ tab: item.id }}
            role="tab"
            aria-selected={tab === item.id}
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
      ) : tab === "saved" ? (
        <SavedList library={library} />
      ) : tab === "highlights" ? (
        <HighlightList highlights={highlights} onRemove={library.removeHighlight} />
      ) : (
        <HistoryList
          library={library}
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

function SavedList({ library }: { library: LibraryApi }) {
  const { bookmarks } = library.snapshot;
  if (!bookmarks.length) {
    return <Empty icon="bookmark" title="Nothing saved yet" body="Tap Save on any article to keep it here for later." />;
  }
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
        {bookmarks.map((item) => (
          <tr key={`${item.wiki}:${item.title}`}>
            <td className="index-title">
              <Link {...articleLink(item.wiki, item.title)}>{item.title}</Link>
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
    const map = new Map<string, { wiki: string; title: string; items: Highlight[] }>();
    for (const highlight of highlights) {
      const key = `${highlight.wiki}:${highlight.articleTitle}`;
      const group = map.get(key) ?? { wiki: highlight.wiki, title: highlight.articleTitle, items: [] };
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
            <Link {...articleLink(group.wiki, group.title)}>{group.title}</Link>
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
                    {...articleLink(group.wiki, group.title, highlight.sectionId || undefined)}
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

function HistoryList({ library, onClear }: { library: LibraryApi; onClear: () => void }) {
  const { history } = library.snapshot;
  if (!history.length) {
    return <Empty icon="clock" title="No reading history" body="Articles you open show up here, with your place saved so you can pick up where you left off." />;
  }
  return (
    <>
      <div className="index-tools">
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
          {history.map((entry) => (
            <tr key={`${entry.wiki}:${entry.title}`}>
              <td className="index-title">
                <Link {...articleLink(entry.wiki, entry.title, entry.sectionId ?? undefined)}>{entry.title}</Link>
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
