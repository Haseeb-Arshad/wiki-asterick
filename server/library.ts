import { randomUUID } from "node:crypto";
import { Router } from "express";
import type {
  ArticleRef,
  Bookmark,
  Highlight,
  HighlightColor,
  HistoryEntry,
  LibrarySnapshot,
} from "../shared/types.js";
import { normalizeWikiHost } from "../shared/wiki.js";
import { currentUserId, requireAuth } from "./auth/routes.js";
import { db, transaction } from "./db.js";
import { HttpError, readOptionalString, readString } from "./http.js";

const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink"];
const HISTORY_LIMIT = 200;
const IMPORT_LIMIT = 500;

// ---- validation -----------------------------------------------------------

function readWiki(value: unknown): string {
  const wiki = typeof value === "string" ? normalizeWikiHost(value) : null;
  if (!wiki) throw new HttpError(400, "Unsupported wiki.");
  return wiki;
}

/** Only keep Wikimedia-hosted images so stored rows cannot point at tracking pixels. */
function readThumbnail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".wikimedia.org") ? url.toString() : null;
  } catch {
    return null;
  }
}

function readArticleRef(body: Record<string, unknown>): ArticleRef {
  return {
    wiki: readWiki(body.wiki),
    title: readString(body.title, "Title", { max: 300 }),
    description: readOptionalString(body.description, 500),
    thumbnail: readThumbnail(body.thumbnail),
  };
}

function readColor(value: unknown): HighlightColor {
  return HIGHLIGHT_COLORS.includes(value as HighlightColor) ? (value as HighlightColor) : "yellow";
}

function readHighlight(body: Record<string, unknown>): Omit<Highlight, "createdAt" | "updatedAt"> {
  const id = typeof body.id === "string" && /^[\w-]{8,64}$/.test(body.id) ? body.id : randomUUID();
  return {
    id,
    wiki: readWiki(body.wiki),
    articleTitle: readString(body.articleTitle, "Article title", { max: 300 }),
    sectionId: readOptionalString(body.sectionId, 300),
    sectionTitle: readOptionalString(body.sectionTitle, 300),
    text: readString(body.text, "Highlighted text", { max: 2000 }),
    prefix: readOptionalString(body.prefix, 64),
    suffix: readOptionalString(body.suffix, 64),
    note: readOptionalString(body.note, 2000),
    color: readColor(body.color),
  };
}

function readProgress(value: unknown): number {
  const progress = Number(value);
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
}

// ---- queries --------------------------------------------------------------

interface BookmarkRow {
  wiki: string;
  title: string;
  description: string;
  thumbnail: string | null;
  created_at: number;
}

interface HistoryRow extends Omit<BookmarkRow, "created_at"> {
  progress: number;
  section_id: string | null;
  read_at: number;
}

interface HighlightRow {
  id: string;
  wiki: string;
  article_title: string;
  section_id: string;
  section_title: string;
  text: string;
  prefix: string;
  suffix: string;
  note: string;
  color: HighlightColor;
  created_at: number;
  updated_at: number;
}

const toBookmark = (row: BookmarkRow): Bookmark => ({
  wiki: row.wiki,
  title: row.title,
  description: row.description,
  thumbnail: row.thumbnail,
  createdAt: row.created_at,
});

const toHistory = (row: HistoryRow): HistoryEntry => ({
  wiki: row.wiki,
  title: row.title,
  description: row.description,
  thumbnail: row.thumbnail,
  progress: row.progress,
  sectionId: row.section_id,
  readAt: row.read_at,
});

const toHighlight = (row: HighlightRow): Highlight => ({
  id: row.id,
  wiki: row.wiki,
  articleTitle: row.article_title,
  sectionId: row.section_id,
  sectionTitle: row.section_title,
  text: row.text,
  prefix: row.prefix,
  suffix: row.suffix,
  note: row.note,
  color: row.color,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const listBookmarks = db.prepare(`SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC`);
const listHistory = db.prepare(`SELECT * FROM history WHERE user_id = ? ORDER BY read_at DESC LIMIT ${HISTORY_LIMIT}`);
const listHighlights = db.prepare(`SELECT * FROM highlights WHERE user_id = ? ORDER BY created_at DESC`);

const upsertBookmark = db.prepare(`
  INSERT INTO bookmarks (user_id, wiki, title, description, thumbnail, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (user_id, wiki, title) DO UPDATE SET
    description = excluded.description,
    thumbnail = COALESCE(excluded.thumbnail, bookmarks.thumbnail)
`);
const getBookmark = db.prepare(`SELECT * FROM bookmarks WHERE user_id = ? AND wiki = ? AND title = ?`);
const deleteBookmark = db.prepare(`DELETE FROM bookmarks WHERE user_id = ? AND wiki = ? AND title = ?`);

const upsertHistory = db.prepare(`
  INSERT INTO history (user_id, wiki, title, description, thumbnail, progress, section_id, read_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (user_id, wiki, title) DO UPDATE SET
    description = excluded.description,
    thumbnail = COALESCE(excluded.thumbnail, history.thumbnail),
    progress = excluded.progress,
    section_id = excluded.section_id,
    read_at = MAX(history.read_at, excluded.read_at)
`);
const getHistory = db.prepare(`SELECT * FROM history WHERE user_id = ? AND wiki = ? AND title = ?`);
const deleteHistoryEntry = db.prepare(`DELETE FROM history WHERE user_id = ? AND wiki = ? AND title = ?`);
const clearHistory = db.prepare(`DELETE FROM history WHERE user_id = ?`);
const trimHistory = db.prepare(`
  DELETE FROM history WHERE user_id = ? AND rowid NOT IN (
    SELECT rowid FROM history WHERE user_id = ? ORDER BY read_at DESC LIMIT ${HISTORY_LIMIT}
  )
`);

const insertHighlight = db.prepare(`
  INSERT INTO highlights (id, user_id, wiki, article_title, section_id, section_title, text, prefix, suffix, note, color, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO NOTHING
`);
const getHighlight = db.prepare(`SELECT * FROM highlights WHERE id = ? AND user_id = ?`);
const updateHighlight = db.prepare(`
  UPDATE highlights SET note = ?, color = ?, updated_at = ? WHERE id = ? AND user_id = ?
`);
const deleteHighlight = db.prepare(`DELETE FROM highlights WHERE id = ? AND user_id = ?`);

function snapshot(userId: string): LibrarySnapshot {
  return {
    bookmarks: (listBookmarks.all(userId) as unknown as BookmarkRow[]).map(toBookmark),
    highlights: (listHighlights.all(userId) as unknown as HighlightRow[]).map(toHighlight),
    history: (listHistory.all(userId) as unknown as HistoryRow[]).map(toHistory),
  };
}

function saveHighlight(userId: string, highlight: Omit<Highlight, "createdAt" | "updatedAt">, createdAt = Date.now()) {
  insertHighlight.run(
    highlight.id,
    userId,
    highlight.wiki,
    highlight.articleTitle,
    highlight.sectionId,
    highlight.sectionTitle,
    highlight.text,
    highlight.prefix,
    highlight.suffix,
    highlight.note,
    highlight.color,
    createdAt,
    createdAt
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.slice(0, IMPORT_LIMIT).map(asRecord) : [];
}

function readTimestamp(value: unknown): number {
  const time = Number(value);
  return Number.isFinite(time) && time > 0 && time <= Date.now() ? time : Date.now();
}

// ---- routes ---------------------------------------------------------------

export const libraryRouter = Router();
libraryRouter.use(requireAuth);

libraryRouter.get("/", (req, res) => {
  res.json(snapshot(currentUserId(req)));
});

libraryRouter.put("/bookmarks", (req, res) => {
  const userId = currentUserId(req);
  const ref = readArticleRef(asRecord(req.body));
  upsertBookmark.run(userId, ref.wiki, ref.title, ref.description, ref.thumbnail, Date.now());
  res.json(toBookmark(getBookmark.get(userId, ref.wiki, ref.title) as unknown as BookmarkRow));
});

libraryRouter.delete("/bookmarks", (req, res) => {
  const wiki = readWiki(req.query.wiki);
  const title = readString(req.query.title, "Title", { max: 300 });
  deleteBookmark.run(currentUserId(req), wiki, title);
  res.status(204).end();
});

libraryRouter.put("/history", (req, res) => {
  const userId = currentUserId(req);
  const body = asRecord(req.body);
  const ref = readArticleRef(body);
  const sectionId = readOptionalString(body.sectionId, 300) || null;

  upsertHistory.run(
    userId,
    ref.wiki,
    ref.title,
    ref.description,
    ref.thumbnail,
    readProgress(body.progress),
    sectionId,
    Date.now()
  );
  trimHistory.run(userId, userId);
  res.json(toHistory(getHistory.get(userId, ref.wiki, ref.title) as unknown as HistoryRow));
});

libraryRouter.delete("/history", (req, res) => {
  const userId = currentUserId(req);
  if (req.query.wiki && req.query.title) {
    deleteHistoryEntry.run(userId, readWiki(req.query.wiki), readString(req.query.title, "Title", { max: 300 }));
  } else {
    clearHistory.run(userId);
  }
  res.status(204).end();
});

libraryRouter.post("/highlights", (req, res) => {
  const userId = currentUserId(req);
  const highlight = readHighlight(asRecord(req.body));
  saveHighlight(userId, highlight);

  const row = getHighlight.get(highlight.id, userId) as unknown as HighlightRow | undefined;
  if (!row) throw new HttpError(409, "That highlight id is already in use.");
  res.status(201).json(toHighlight(row));
});

libraryRouter.patch("/highlights/:id", (req, res) => {
  const userId = currentUserId(req);
  const existing = getHighlight.get(req.params.id, userId) as unknown as HighlightRow | undefined;
  if (!existing) throw new HttpError(404, "Highlight not found.");

  const body = asRecord(req.body);
  const note = body.note === undefined ? existing.note : readOptionalString(body.note, 2000);
  const color = body.color === undefined ? existing.color : readColor(body.color);
  updateHighlight.run(note, color, Date.now(), existing.id, userId);

  res.json(toHighlight(getHighlight.get(existing.id, userId) as unknown as HighlightRow));
});

libraryRouter.delete("/highlights/:id", (req, res) => {
  deleteHighlight.run(req.params.id, currentUserId(req));
  res.status(204).end();
});

/** Merges what a guest saved in this browser into their account after sign-in. */
libraryRouter.post("/import", (req, res) => {
  const userId = currentUserId(req);
  const body = asRecord(req.body);

  transaction(() => {
    for (const item of asRecords(body.bookmarks)) {
      try {
        const ref = readArticleRef(item);
        upsertBookmark.run(userId, ref.wiki, ref.title, ref.description, ref.thumbnail, readTimestamp(item.createdAt));
      } catch {
        // skip malformed entries rather than failing the whole import
      }
    }

    for (const item of asRecords(body.history)) {
      try {
        const ref = readArticleRef(item);
        const sectionId = readOptionalString(item.sectionId, 300) || null;
        upsertHistory.run(
          userId,
          ref.wiki,
          ref.title,
          ref.description,
          ref.thumbnail,
          readProgress(item.progress),
          sectionId,
          readTimestamp(item.readAt)
        );
      } catch {
        // skip malformed entries
      }
    }

    for (const item of asRecords(body.highlights)) {
      try {
        saveHighlight(userId, readHighlight(item), readTimestamp(item.createdAt));
      } catch {
        // skip malformed entries
      }
    }

    trimHistory.run(userId, userId);
  });

  res.json(snapshot(userId));
});
