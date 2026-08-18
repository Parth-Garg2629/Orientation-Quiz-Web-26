import { Pool, types } from "pg";

// Parse BIGINT (OID 20) as JS number instead of string.
// Timestamps stored as BIGINT (ms since epoch) would otherwise come back as strings.
types.setTypeParser(20, (val: string) => (val !== null ? Number(val) : null));

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ [DB] FATAL: DATABASE_URL environment variable is not set!");
  console.error("Set DATABASE_URL to your PostgreSQL connection string in .env or environment.");
  process.exit(1);
}

export const pool = new Pool({
  connectionString,
  // Render's managed Postgres requires SSL in production; disable cert verification
  // since Render uses self-signed certs on internal connections.
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
  max: 10,                    // max pool connections (well within free tier limits)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected PostgreSQL pool error:", err);
});

// ---------------------------------------------------------------------------
// Query helpers — mirror the old synchronous db.prepare().get/run/all() API
// ---------------------------------------------------------------------------

/** Run a SELECT and return ALL matching rows. */
export async function query<T extends object = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

/** Run a SELECT and return the FIRST matching row, or null. */
export async function queryOne<T extends object = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const result = await pool.query<T>(sql, params);
  return result.rows[0] ?? null;
}

/** Run an INSERT / UPDATE / DELETE with no return value needed. */
export async function execute(sql: string, params?: unknown[]): Promise<void> {
  await pool.query(sql, params);
}

// ---------------------------------------------------------------------------
// Table initialisation — called once at server startup before any requests
// ---------------------------------------------------------------------------

export async function initDb(): Promise<void> {
  console.log("[DB] Connecting to PostgreSQL and initialising tables...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quiz_session (
      id                TEXT     PRIMARY KEY,
      status            TEXT     NOT NULL
                                 CHECK (status IN ('waiting','starting','running','paused','completed','scored')),
      question_index    INTEGER  NOT NULL DEFAULT 0,
      question_deadline BIGINT,
      paused_at         BIGINT,
      remaining_ms      BIGINT,
      winner_revealed   BOOLEAN  NOT NULL DEFAULT FALSE,
      updated_at        TEXT     NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team (
      id          TEXT             PRIMARY KEY,
      name        TEXT             NOT NULL,
      name_lower  TEXT             NOT NULL UNIQUE,
      code        TEXT             NOT NULL UNIQUE,
      total_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at  TEXT             NOT NULL
    );

    CREATE TABLE IF NOT EXISTS submission (
      id              TEXT             PRIMARY KEY,
      team_id         TEXT             NOT NULL REFERENCES team(id) ON DELETE CASCADE,
      question_index  INTEGER          NOT NULL,
      selected_option INTEGER          NOT NULL,
      is_correct      BOOLEAN          NOT NULL,
      points_awarded  DOUBLE PRECISION NOT NULL,
      submitted_at    TEXT             NOT NULL,
      UNIQUE(team_id, question_index)
    );

    CREATE TABLE IF NOT EXISTS score_override (
      id         TEXT             PRIMARY KEY,
      team_id    TEXT             NOT NULL REFERENCES team(id) ON DELETE CASCADE,
      delta      DOUBLE PRECISION NOT NULL,
      note       TEXT,
      applied_at TEXT             NOT NULL
    );
  `);

  console.log("[DB] PostgreSQL tables ready.");
}
