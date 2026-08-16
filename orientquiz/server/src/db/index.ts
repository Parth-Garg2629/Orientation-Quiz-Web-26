import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const dbPath = process.env.DATABASE_PATH || "./quiz.db";
const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);

// Ensure dir exists
const dir = path.dirname(absoluteDbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new DatabaseSync(absoluteDbPath);

// Performance pragmas for high concurrency (300-400 users)
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;
  PRAGMA cache_size=-32000;
  PRAGMA temp_store=MEMORY;
  PRAGMA mmap_size=268435456;
`);

// Initialize tables (with 'starting' status support)
db.exec(`
  CREATE TABLE IF NOT EXISTS quiz_session (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('waiting', 'starting', 'running', 'paused', 'completed', 'scored')),
    question_index INTEGER NOT NULL DEFAULT 0,
    question_deadline INTEGER,
    paused_at INTEGER,
    remaining_ms INTEGER,
    winner_revealed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_lower TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    total_score REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS submission (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    question_index INTEGER NOT NULL,
    selected_option INTEGER NOT NULL,
    is_correct INTEGER NOT NULL,
    points_awarded REAL NOT NULL,
    submitted_at TEXT NOT NULL,
    UNIQUE(team_id, question_index)
  );

  CREATE TABLE IF NOT EXISTS score_override (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    delta REAL NOT NULL,
    note TEXT,
    applied_at TEXT NOT NULL
  );
`);

// Migration: add 'starting' to quiz_session CHECK constraint if not present
const tableSchema = (
  db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='quiz_session'").get() as any
)?.sql ?? "";

if (tableSchema && !tableSchema.includes("'starting'")) {
  console.log("[DB] Migrating quiz_session table to support 'starting' status...");
  db.exec(`
    BEGIN TRANSACTION;
    CREATE TABLE quiz_session_new (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('waiting', 'starting', 'running', 'paused', 'completed', 'scored')),
      question_index INTEGER NOT NULL DEFAULT 0,
      question_deadline INTEGER,
      paused_at INTEGER,
      remaining_ms INTEGER,
      winner_revealed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    INSERT INTO quiz_session_new SELECT * FROM quiz_session;
    DROP TABLE quiz_session;
    ALTER TABLE quiz_session_new RENAME TO quiz_session;
    COMMIT;
  `);
  console.log("[DB] Migration complete.");
}

console.log(`[DB] Native SQLite initialized at ${absoluteDbPath}`);
