const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "../data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "tasks.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  recurring_id TEXT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  date TEXT NOT NULL,
  start_time TEXT DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'Medium',
  category TEXT NOT NULL DEFAULT 'Other',
  status TEXT NOT NULL DEFAULT 'Pending',
  notes TEXT DEFAULT '',
  subtasks TEXT DEFAULT '[]',
  reminder_time TEXT DEFAULT '',
  snoozed_until TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS recurring_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  start_time TEXT DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'Medium',
  category TEXT NOT NULL DEFAULT 'Other',
  frequency TEXT NOT NULL,
  start_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  subtasks TEXT DEFAULT '[]',
  reminder_time TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified_at TEXT,
  email_reminders_enabled INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`);

// Safe column migrations for existing databases
function addColumnIfNotExists(table, column, def) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

addColumnIfNotExists("tasks", "subtasks", "TEXT DEFAULT '[]'");
addColumnIfNotExists("tasks", "reminder_time", "TEXT DEFAULT ''");
addColumnIfNotExists("tasks", "snoozed_until", "TEXT DEFAULT ''");
addColumnIfNotExists("tasks", "user_id", "TEXT");
addColumnIfNotExists("tasks", "last_reminder_sent_for", "TEXT");

addColumnIfNotExists("recurring_tasks", "subtasks", "TEXT DEFAULT '[]'");
addColumnIfNotExists("recurring_tasks", "reminder_time", "TEXT DEFAULT ''");
addColumnIfNotExists("recurring_tasks", "user_id", "TEXT");

addColumnIfNotExists("users", "email_verified_at", "TEXT");
addColumnIfNotExists("users", "email_reminders_enabled", "INTEGER NOT NULL DEFAULT 0");
addColumnIfNotExists("users", "timezone", "TEXT NOT NULL DEFAULT 'UTC'");

// Existing single-user accounts predate email verification. Mark those legacy
// accounts verified once; newly registered accounts remain unverified.
const legacyEmailMigration = "legacy_accounts_email_verified";
if (!db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(legacyEmailMigration)) {
  const markLegacyAccounts = db.transaction(() => {
    db.prepare("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL").run();
    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
      .run(legacyEmailMigration, new Date().toISOString());
  });
  markLegacyAccounts();
}

db.exec(`
CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, date);
CREATE INDEX IF NOT EXISTS idx_recurring_user_date ON recurring_tasks(user_id, start_date);
CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry ON auth_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user_purpose ON email_tokens(user_id, purpose, expires_at);
CREATE INDEX IF NOT EXISTS idx_tasks_reminder_due ON tasks(user_id, date, reminder_time);
`);

module.exports = db;

