// SQLite database: opens the file, applies migrations, exports the handle.
// Run directly (`npm run db:init`) to create the database and print its status.
//
// Env:
//   DB_PATH  Path to the database file (default ./data/csat.db)
//
// All timestamps are Unix seconds (UTC), the same format Intercom uses.

const fs = require("fs");
const path = require("path");
// Built into Node 22.13+. No native module to compile, so it runs on any glibc.
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "csat.db");

// Each entry runs once, in order. Append new migrations; never edit old ones.
const MIGRATIONS = [
  `
  -- One row per rated conversation. The latest rating wins.
  CREATE TABLE ratings (
    conversation_id TEXT PRIMARY KEY,
    score           INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    remark          TEXT,
    admin_id        TEXT,
    admin_name      TEXT,
    admin_email     TEXT,
    contact_id      TEXT,
    contact_name    TEXT,
    contact_email   TEXT,
    rated_at        INTEGER NOT NULL,
    posted_at       INTEGER,
    slack_ts        TEXT,
    source          TEXT NOT NULL DEFAULT 'webhook'
                    CHECK (source IN ('webhook', 'reconcile', 'backfill')),
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX ratings_rated_at ON ratings (rated_at);
  CREATE INDEX ratings_admin ON ratings (admin_id, rated_at);

  -- Ratings waiting for the 5-minute delay before they are posted.
  -- A new event for the same conversation moves due_at forward.
  CREATE TABLE pending_posts (
    conversation_id TEXT PRIMARY KEY,
    due_at          INTEGER NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX pending_posts_due ON pending_posts (due_at);

  -- One row per broken streak. The current streak is counted from the
  -- latest break, and the record is the longest length_days.
  CREATE TABLE streak_breaks (
    id              INTEGER PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    broken_at       INTEGER NOT NULL,
    length_days     INTEGER NOT NULL,
    was_record      INTEGER NOT NULL DEFAULT 0,
    posted_at       INTEGER
  );
  CREATE INDEX streak_breaks_broken_at ON streak_breaks (broken_at);

  -- Scheduled jobs that have run, so a restart never sends a post twice.
  -- run_key is the period, for example '2026-09-30' or '2026-W40'.
  CREATE TABLE scheduled_runs (
    job     TEXT NOT NULL,
    run_key TEXT NOT NULL,
    ran_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (job, run_key)
  );
  `,
];

function schemaVersion(db) {
  return db.prepare("PRAGMA user_version").get().user_version;
}

function migrate(db) {
  for (let v = schemaVersion(db); v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

function open(file = DB_PATH) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

module.exports = { open, schemaVersion, DB_PATH };

if (require.main === module) {
  const db = open();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((t) => t.name);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Schema version: ${schemaVersion(db)}`);
  console.log(`Tables: ${tables.join(", ")}`);
  db.close();
}
