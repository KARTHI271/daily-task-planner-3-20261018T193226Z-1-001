const cron = require("node-cron");
const db = require("../db");
const { notify } = require("./notifications");

function keyFromDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shouldRun(rec, date) {
  if (!rec.enabled) return false;

  const start = new Date(`${rec.start_date}T00:00:00`);
  if (start > date) return false;

  if (rec.frequency === "daily") return true;
  if (rec.frequency === "weekly") return start.getDay() === date.getDay();
  if (rec.frequency === "monthly") return start.getDate() === date.getDate();

  return false;
}

function generateForDate(date = new Date(), onlyUserId = null) {
  const dateKey = keyFromDate(date);
  const recurring = onlyUserId
    ? db.prepare("SELECT * FROM recurring_tasks WHERE enabled=1 AND user_id=?").all(onlyUserId)
    : db.prepare("SELECT * FROM recurring_tasks WHERE enabled=1").all();
  const insert = db.prepare(`
    INSERT INTO tasks
    (id, user_id, recurring_id, title, description, date, start_time, priority, category,
     status, notes, subtasks, reminder_time, created_at, updated_at, completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const create = db.transaction(() => {
    let created = 0;
    for (const r of recurring) {
      if (!shouldRun(r, date)) continue;

      const exists = db.prepare(
        "SELECT 1 FROM tasks WHERE recurring_id=? AND date=? AND user_id=?"
      ).get(r.id, dateKey, r.user_id);

      if (exists) continue;

      const timestamp = new Date().toISOString();
      insert.run(
        `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
        r.user_id, r.id, r.title, r.description || "", dateKey, r.start_time || "",
        r.priority, r.category, "Pending", "", r.subtasks || "[]", r.reminder_time || "",
        timestamp, timestamp, null
      );
      created++;
    }
    return created;
  });

  return create();
}

function checkReminders() {
  const nowIso = new Date().toISOString();
  const today = keyFromDate(new Date());

  const pendingTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE status NOT IN ('Completed', 'Cancelled')
      AND date <= ?
      AND (reminder_time IS NOT NULL AND reminder_time != '')
  `).all(today);

  for (const t of pendingTasks) {
    if (t.snoozed_until && new Date(t.snoozed_until) > new Date()) {
      continue; // Currently snoozed
    }

    const taskTime = t.reminder_time || t.start_time;
    if (!taskTime) continue;

    const taskDateTimeStr = `${t.date}T${taskTime.length === 5 ? taskTime + ":00" : taskTime}`;
    const taskDateTime = new Date(taskDateTimeStr);

    if (!isNaN(taskDateTime.getTime()) && taskDateTime <= new Date()) {
      notify(`Task Reminder: ${t.title}`, `Priority: ${t.priority} | Time: ${t.start_time || "All day"}`);
    }
  }
}

function startScheduler() {
  generateForDate(new Date());

  cron.schedule("* * * * *", () => {
    try {
      generateForDate(new Date());
      checkReminders();
    } catch (error) {
      console.error("Recurring scheduler error:", error);
    }
  });

  console.log("Recurring-task & reminder scheduler started.");
}

module.exports = startScheduler;
module.exports.generateForDate = generateForDate;
