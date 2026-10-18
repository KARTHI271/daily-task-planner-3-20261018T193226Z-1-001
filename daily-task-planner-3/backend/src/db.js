const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "../data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "tasks.db"));
db.pragma("journal_mode = WAL");

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
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
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

addColumnIfNotExists("recurring_tasks", "subtasks", "TEXT DEFAULT '[]'");
addColumnIfNotExists("recurring_tasks", "reminder_time", "TEXT DEFAULT ''");
addColumnIfNotExists("recurring_tasks", "user_id", "TEXT");

db.exec(`
CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, date);
CREATE INDEX IF NOT EXISTS idx_recurring_user_date ON recurring_tasks(user_id, start_date);
CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry ON auth_sessions(user_id, expires_at);
`);

module.exports = db;

