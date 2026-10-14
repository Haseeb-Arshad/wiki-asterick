import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

export const db = new DatabaseSync(config.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

/** Append-only. Each entry runs once, tracked with PRAGMA user_version. */
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    revoked_reason TEXT,
    user_agent TEXT
  );
  CREATE INDEX refresh_tokens_user ON refresh_tokens(user_id);
  CREATE INDEX refresh_tokens_family ON refresh_tokens(family_id);

  CREATE TABLE bookmarks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wiki TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    thumbnail TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, wiki, title)
  );

  CREATE TABLE history (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wiki TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    thumbnail TEXT,
    progress REAL NOT NULL DEFAULT 0,
    section_id TEXT,
    read_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, wiki, title)
  );
  CREATE INDEX history_recent ON history(user_id, read_at DESC);

  CREATE TABLE highlights (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wiki TEXT NOT NULL,
    article_title TEXT NOT NULL,
    section_id TEXT NOT NULL DEFAULT '',
    section_title TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    prefix TEXT NOT NULL DEFAULT '',
    suffix TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'yellow',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX highlights_article ON highlights(user_id, wiki, article_title);
  `,
  // 2: web pages opened from shared links ("web:<host>" wikis) need their address.
  `
  ALTER TABLE bookmarks ADD COLUMN url TEXT;
  ALTER TABLE history ADD COLUMN url TEXT;
  ALTER TABLE highlights ADD COLUMN url TEXT;
  `,
];

function migrate() {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };

  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

migrate();

export function transaction<T>(work: () => T): T {
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
