const cron = require("node-cron");
const db = require("../db");
const emailService = require("./email");

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

function localClock(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).reduce((values, part) => {
    values[part.type] = part.value;
    return values;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

async function checkReminders() {
  const users = db.prepare(`
    SELECT id, email, timezone FROM users
    WHERE email_verified_at IS NOT NULL AND email_reminders_enabled = 1
  `).all();
  const findTasks = db.prepare(`
    SELECT id, title, date, reminder_time, snoozed_until, last_reminder_sent_for
    FROM tasks
    WHERE user_id = ? AND status NOT IN ('Completed', 'Cancelled')
      AND reminder_time IS NOT NULL AND reminder_time != ''
      AND date = ?
    ORDER BY date, reminder_time
  `);

  for (const user of users) {
    let clock;
    try { clock = localClock(new Date(), user.timezone || "UTC"); }
    catch (error) {
      console.error(`Invalid reminder timezone for user ${user.id}:`, error.message);
      continue;
    }
    const nowKey = `${clock.date}T${clock.time}`;
    for (const task of findTasks.all(user.id, clock.date)) {
      const normalDue = `${task.date}T${task.reminder_time.slice(0, 5)}`;
      let dueKey = normalDue;
      let reminderKey = `${normalDue}|`;
      if (task.snoozed_until) {
        const snoozeDate = new Date(task.snoozed_until);
        if (!Number.isNaN(snoozeDate.getTime())) {
          const localSnooze = localClock(snoozeDate, user.timezone || "UTC");
          dueKey = `${localSnooze.date}T${localSnooze.time}`;
          reminderKey = `${normalDue}|${task.snoozed_until}`;
        }
      }
      if (dueKey > nowKey || task.last_reminder_sent_for === reminderKey) continue;

      try {
        await emailService.sendTaskReminder({
          email: user.email,
          title: task.title,
          date: dueKey.slice(0, 10),
          time: dueKey.slice(11),
          timezone: user.timezone || "UTC",
        });
        db.prepare("UPDATE tasks SET last_reminder_sent_for = ? WHERE id = ? AND user_id = ?")
          .run(reminderKey, task.id, user.id);
      } catch (error) {
        console.error(`Reminder email failed for task ${task.id}:`, error.message);
      }
    }
  }
}

function startScheduler() {
  generateForDate(new Date());

  cron.schedule("* * * * *", async () => {
    try {
      generateForDate(new Date());
      await checkReminders();
    } catch (error) {
      console.error("Recurring scheduler error:", error);
    }
  });

  console.log("Recurring-task & reminder scheduler started.");
}

module.exports = startScheduler;
module.exports.generateForDate = generateForDate;
