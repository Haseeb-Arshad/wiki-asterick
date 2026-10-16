import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AiNote, Bookmark, Highlight, HistoryEntry, LibrarySnapshot } from "../shared/types.ts";
import { filterSnapshot, libraryToJson, libraryToMarkdown, matchesQuery, sortBookmarks, sortHistory } from "../shared/library-tools.ts";

const bookmark = (title: string, createdAt: number, extra: Partial<Bookmark> = {}): Bookmark => ({
  wiki: "en.wikipedia.org",
  title,
  description: "",
  thumbnail: null,
  createdAt,
  ...extra,
});

const history = (title: string, readAt: number, progress: number): HistoryEntry => ({
  wiki: "en.wikipedia.org",
  title,
  description: "",
  thumbnail: null,
  progress,
  sectionId: null,
  readAt,
});

const highlight: Highlight = {
  id: "h1",
  wiki: "en.wikipedia.org",
  articleTitle: "Moon",
  sectionId: "s1",
  sectionTitle: "Formation",
  text: "The Moon formed 4.5 billion years ago.",
  prefix: "",
  suffix: "",
  note: "Giant impact theory",
  color: "yellow",
  createdAt: Date.UTC(2026, 9, 1),
  updatedAt: Date.UTC(2026, 9, 1),
};

const note: AiNote = {
  id: "n1",
  wiki: "general",
  articleTitle: "",
  question: "Why is the sky blue?",
  quote: "",
  quotePrefix: "",
  quoteSuffix: "",
  sectionId: "",
  answer: "Rayleigh scattering [1].",
  sources: [{ n: 1, kind: "web", title: "Sky", url: "https://example.com/sky", site: "example.com", date: null, favicon: null }],
  model: "m",
  mode: "quick",
  web: false,
  createdAt: Date.UTC(2026, 9, 2),
};

const snapshot: LibrarySnapshot = {
  bookmarks: [bookmark("Café culture", 200, { description: "Social life" }), bookmark("Apollo 11", 300), bookmark("Moon", 100)],
  highlights: [highlight],
  history: [history("Moon", 500, 1), history("Apollo 11", 400, 0.2), history("Mars", 450, 0.5)],
  notes: [note],
};

describe("matchesQuery", () => {
  test("ignores case and accents", () => {
    assert.equal(matchesQuery(["Café culture"], "CAFE"), true);
    assert.equal(matchesQuery(["Cafe"], "café"), true);
  });

  test("needs every word, in any order and any field", () => {
    assert.equal(matchesQuery(["Apollo 11", "Moon landing"], "moon apollo"), true);
    assert.equal(matchesQuery(["Apollo 11"], "apollo mars"), false);
  });

  test("an empty query matches everything", () => {
    assert.equal(matchesQuery(["anything"], "   "), true);
    assert.equal(matchesQuery([], ""), true);
  });
});

describe("filterSnapshot", () => {
  test("returns the same library for an empty query", () => {
    assert.equal(filterSnapshot(snapshot, " "), snapshot);
  });

  test("filters every section", () => {
    const moon = filterSnapshot(snapshot, "moon");
    assert.deepEqual(moon.bookmarks.map((item) => item.title), ["Moon"]);
    assert.deepEqual(moon.history.map((item) => item.title), ["Moon"]);
    assert.equal(moon.highlights.length, 1);
    assert.equal(moon.notes.length, 0);
  });

  test("searches notes, quotes and answers, not just titles", () => {
    assert.equal(filterSnapshot(snapshot, "rayleigh").notes.length, 1);
    assert.equal(filterSnapshot(snapshot, "giant impact").highlights.length, 1);
    assert.equal(filterSnapshot(snapshot, "social").bookmarks.length, 1);
  });
});

describe("sorting", () => {
  test("bookmarks: newest, oldest and A to Z", () => {
    assert.deepEqual(sortBookmarks(snapshot.bookmarks, "newest").map((item) => item.title), ["Apollo 11", "Café culture", "Moon"]);
    assert.deepEqual(sortBookmarks(snapshot.bookmarks, "oldest").map((item) => item.title), ["Moon", "Café culture", "Apollo 11"]);
    assert.deepEqual(sortBookmarks(snapshot.bookmarks, "title").map((item) => item.title), ["Apollo 11", "Café culture", "Moon"]);
  });

  test("history: recent, or unfinished first with each group newest first", () => {
    assert.deepEqual(sortHistory(snapshot.history, "recent").map((item) => item.title), ["Moon", "Mars", "Apollo 11"]);
    assert.deepEqual(sortHistory(snapshot.history, "unfinished").map((item) => item.title), ["Mars", "Apollo 11", "Moon"]);
  });

  test("does not change the original list", () => {
    const before = snapshot.bookmarks.map((item) => item.title);
    sortBookmarks(snapshot.bookmarks, "title");
    assert.deepEqual(snapshot.bookmarks.map((item) => item.title), before);
  });
});

describe("export", () => {
  const when = new Date(Date.UTC(2026, 9, 16));

  test("Markdown lists every section with links to the sources", () => {
    const markdown = libraryToMarkdown(snapshot, when);
    assert.match(markdown, /^# My WikiAsterisk library/);
    assert.match(markdown, /Exported 2026-10-16\./);
    assert.match(markdown, /## Saved \(3\)/);
    assert.match(markdown, /\[Apollo 11\]\(https:\/\/en\.wikipedia\.org\/wiki\/Apollo_11\)/);
    assert.match(markdown, /### \[Moon\]\(https:\/\/en\.wikipedia\.org\/wiki\/Moon\)\n\n> The Moon formed 4\.5 billion years ago\./);
    assert.match(markdown, /Giant impact theory/);
    assert.match(markdown, /### General questions\n\n\*\*Why is the sky blue\?\*\*/);
    assert.match(markdown, /1\. \[Sky\]\(https:\/\/example\.com\/sky\)/);
    assert.match(markdown, /CC BY-SA 4\.0/);
  });

  test("Markdown skips sections that are empty", () => {
    const markdown = libraryToMarkdown({ bookmarks: [], highlights: [], history: [], notes: [] }, when);
    assert.doesNotMatch(markdown, /## Saved/);
    assert.doesNotMatch(markdown, /## Highlights/);
  });

  test("web pages link to their original address", () => {
    const web = bookmark("An essay", 1, { wiki: "web:example.com", url: "https://example.com/essay" });
    const markdown = libraryToMarkdown({ ...snapshot, bookmarks: [web] }, when);
    assert.match(markdown, /\[An essay\]\(https:\/\/example\.com\/essay\)/);
  });

  test("JSON is a complete, parseable copy", () => {
    const parsed = JSON.parse(libraryToJson(snapshot, when));
    assert.equal(parsed.app, "WikiAsterisk");
    assert.equal(parsed.exportedAt, "2026-10-16T00:00:00.000Z");
    assert.equal(parsed.bookmarks.length, 3);
    assert.equal(parsed.notes[0].question, "Why is the sky blue?");
  });
});
