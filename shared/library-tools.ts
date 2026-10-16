import type { AiNote, Bookmark, Highlight, HistoryEntry, LibrarySnapshot } from "./types.js";
import { wikiArticleUrl } from "./wiki.js";

// ---- search ---------------------------------------------------------------------------

/** Lower case with accents removed, so "cafe" finds "Café". */
const fold = (text: string) => text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/** True when every word of the query appears somewhere in the given fields. */
export function matchesQuery(fields: (string | null | undefined)[], query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fold(fields.filter(Boolean).join(" "));
  return words.every((word) => haystack.includes(word));
}

/** The library with only the items that match the query (everything when it's empty). */
export function filterSnapshot(snapshot: LibrarySnapshot, query: string): LibrarySnapshot {
  if (!query.trim()) return snapshot;
  return {
    bookmarks: snapshot.bookmarks.filter((item) => matchesQuery([item.title, item.description], query)),
    highlights: snapshot.highlights.filter((item) => matchesQuery([item.text, item.note, item.articleTitle, item.sectionTitle], query)),
    history: snapshot.history.filter((item) => matchesQuery([item.title, item.description], query)),
    notes: snapshot.notes.filter((item) => matchesQuery([item.question, item.answer, item.quote, item.articleTitle], query)),
  };
}

// ---- sorting --------------------------------------------------------------------------

export type SavedSort = "newest" | "oldest" | "title";
export type HistorySort = "recent" | "unfinished";

export function sortBookmarks(items: Bookmark[], sort: SavedSort): Bookmark[] {
  const copy = [...items];
  if (sort === "oldest") return copy.sort((a, b) => a.createdAt - b.createdAt);
  if (sort === "title") return copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));
  return copy.sort((a, b) => b.createdAt - a.createdAt);
}

const FINISHED = 0.97;

export function sortHistory(items: HistoryEntry[], sort: HistorySort): HistoryEntry[] {
  const copy = [...items].sort((a, b) => b.readAt - a.readAt);
  if (sort === "recent") return copy;
  // Stable: unfinished articles first, each group still newest first.
  return [...copy.filter((item) => item.progress < FINISHED), ...copy.filter((item) => item.progress >= FINISHED)];
}

// ---- export ---------------------------------------------------------------------------

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const dateOf = (time: number) => new Date(time).toISOString().slice(0, 10);

/** The page an item came from: the original address for web pages, the wiki page otherwise. */
function sourceUrl(ref: { wiki: string; title?: string; articleTitle?: string; url?: string | null }): string | null {
  if (ref.wiki === "general") return null;
  if (ref.wiki.startsWith("web:")) return ref.url ?? null;
  return wikiArticleUrl(ref.wiki, ref.title ?? ref.articleTitle ?? "");
}

function titleLink(title: string, url: string | null): string {
  return url ? `[${title}](${url})` : title;
}

function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    groups.set(id, [...(groups.get(id) ?? []), item]);
  }
  return [...groups.entries()];
}

function highlightsMarkdown(highlights: Highlight[]): string[] {
  const lines: string[] = [];
  for (const [, items] of groupBy(highlights, (item) => `${item.wiki}:${item.articleTitle}`)) {
    lines.push(`### ${titleLink(items[0].articleTitle, sourceUrl(items[0]))}`, "");
    for (const item of items) {
      lines.push(`> ${oneLine(item.text)}`, "");
      if (item.note) lines.push(oneLine(item.note), "");
      lines.push(`— ${item.sectionTitle || "Introduction"}, ${dateOf(item.createdAt)}`, "");
    }
  }
  return lines;
}

function notesMarkdown(notes: AiNote[]): string[] {
  const lines: string[] = [];
  for (const [, items] of groupBy(notes, (item) => (item.wiki === "general" ? "general" : `${item.wiki}:${item.articleTitle}`))) {
    lines.push(`### ${items[0].wiki === "general" ? "General questions" : titleLink(items[0].articleTitle, sourceUrl(items[0]))}`, "");
    for (const note of items) {
      lines.push(`**${oneLine(note.question)}**`, "");
      if (note.quote) lines.push(`> ${oneLine(note.quote)}`, "");
      lines.push(note.answer.trim(), "");
      if (note.sources.length) {
        lines.push(note.sources.map((source) => `${source.n}. [${oneLine(source.title)}](${source.url})`).join("  \n"), "");
      }
      lines.push(`_Asked ${dateOf(note.createdAt)}_`, "");
    }
  }
  return lines;
}

/** Everything in the library as one readable Markdown file. */
export function libraryToMarkdown(snapshot: LibrarySnapshot, exportedAt = new Date()): string {
  const lines: string[] = ["# My WikiAsterisk library", "", `Exported ${exportedAt.toISOString().slice(0, 10)}.`, ""];

  if (snapshot.bookmarks.length) {
    lines.push(`## Saved (${snapshot.bookmarks.length})`, "");
    for (const item of sortBookmarks(snapshot.bookmarks, "newest")) {
      const description = item.description ? ` — ${oneLine(item.description)}` : "";
      lines.push(`- ${titleLink(item.title, sourceUrl(item))}${description} (saved ${dateOf(item.createdAt)})`);
    }
    lines.push("");
  }

  if (snapshot.highlights.length) {
    lines.push(`## Highlights (${snapshot.highlights.length})`, "", ...highlightsMarkdown(snapshot.highlights));
  }

  if (snapshot.notes.length) {
    lines.push(`## AI notes (${snapshot.notes.length})`, "", ...notesMarkdown(snapshot.notes));
  }

  if (snapshot.history.length) {
    lines.push(`## Reading history (${snapshot.history.length})`, "");
    for (const item of sortHistory(snapshot.history, "recent")) {
      const progress = item.progress >= FINISHED ? "finished" : `${Math.round(item.progress * 100)}%`;
      lines.push(`- ${titleLink(item.title, sourceUrl(item))} (${progress}, last read ${dateOf(item.readAt)})`);
    }
    lines.push("");
  }

  lines.push("---", "", "Wikipedia and other Wikimedia text is available under CC BY-SA 4.0; each item links to its source.", "");
  return lines.join("\n");
}

/** A complete copy of the library, for backups. */
export function libraryToJson(snapshot: LibrarySnapshot, exportedAt = new Date()): string {
  return JSON.stringify({ app: "WikiAsterisk", exportedAt: exportedAt.toISOString(), ...snapshot }, null, 2);
}
