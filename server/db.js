// Lightweight persistence using Node's built-in SQLite (Node 22+).
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, 'vaani.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    persona     TEXT NOT NULL DEFAULT '',
    lang_pref   TEXT NOT NULL DEFAULT 'auto',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS turns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,            -- 'user' | 'agent'
    text        TEXT NOT NULL,
    language    TEXT,                     -- e.g. ta-IN, hi-IN, en-IN
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );
`);

export function createSession({ id, persona, langPref }) {
  db.prepare(
    `INSERT INTO sessions (id, persona, lang_pref) VALUES (?, ?, ?)`
  ).run(id, persona ?? '', langPref ?? 'auto');
  return getSession(id);
}

export function getSession(id) {
  return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id);
}

export function ensureSession({ id, persona, langPref }) {
  const existing = getSession(id);
  if (existing) return existing;
  return createSession({ id, persona, langPref });
}

export function addTurn({ sessionId, role, text, language }) {
  const info = db
    .prepare(
      `INSERT INTO turns (session_id, role, text, language) VALUES (?, ?, ?, ?)`
    )
    .run(sessionId, role, text, language ?? null);
  return db.prepare(`SELECT * FROM turns WHERE id = ?`).get(info.lastInsertRowid);
}

export function getTurns(sessionId, limit = 40) {
  return db
    .prepare(
      `SELECT role, text, language, created_at FROM turns
       WHERE session_id = ? ORDER BY id ASC LIMIT ?`
    )
    .all(sessionId, limit);
}

export default db;
