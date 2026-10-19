const express = require("express");
const db = require("../db");
const { generateForDate } = require("../services/scheduler");

const router = express.Router();
const now = () => new Date().toISOString();
const PRIORITIES = ["High", "Medium", "Low"];
const STATUSES = ["Pending", "In Progress", "Completed", "Cancelled"];
const CATEGORIES = ["SRE", "AWS", "GCP", "Linux", "DevOps", "AI", "Documentation", "Personal", "Other"];

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return typeof value === "string" && (value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function validSubtasks(value) {
  return Array.isArray(value) && value.length <= 100 && value.every((item) =>
    item && typeof item === "object" && typeof item.title === "string" && item.title.trim().length > 0
      && item.title.length <= 200 && (item.completed === undefined || typeof item.completed === "boolean")
  );
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

router.get("/", (req, res) => {
  const { date, from, to, status, category, priority, search, overdue, sortBy, sortOrder = "asc" } = req.query;

  if ((date && !validDate(date)) || (from && !validDate(from)) || (to && !validDate(to))
      || (from && to && from > to) || (status && !STATUSES.includes(status))
      || (category && !CATEGORIES.includes(category)) || (priority && !PRIORITIES.includes(priority))
      || (search && (typeof search !== "string" || search.length > 200))) {
    return res.status(400).json({ error: "One or more task filters are invalid." });
  }

  if (date) {
    try {
      const [y, m, d] = date.split("-").map(Number);
      if (y && m && d) generateForDate(new Date(y, m - 1, d), req.user.id);
    } catch (e) {
      console.error("Error generating tasks for date:", e);
    }
  } else if (from && to) {
    try {
      const [fy, fm, fd] = from.split("-").map(Number);
      const [ty, tm, td] = to.split("-").map(Number);
      const startD = new Date(fy, fm - 1, fd);
      const endD = new Date(ty, tm - 1, td);
      const diffDays = Math.round((endD - startD) / 86400000);
      if (diffDays >= 0 && diffDays <= 45) {
        const cur = new Date(startD);
        while (cur <= endD) {
          generateForDate(cur, req.user.id);
          cur.setDate(cur.getDate() + 1);
        }
      }
    } catch (e) {
      console.error("Error generating tasks for range:", e);
    }
  }

  let sql = "SELECT * FROM tasks WHERE user_id = @userId";
  const params = { userId: req.user.id };

  if (overdue === "true") {
    sql += " AND date < @today AND status NOT IN ('Completed', 'Cancelled')";
    params.today = todayKey();
  } else if (date) {
    sql += " AND date = @date";
    params.date = date;
  }

  if (from) { sql += " AND date >= @from"; params.from = from; }
  if (to) { sql += " AND date <= @to"; params.to = to; }
  if (status) { sql += " AND status = @status"; params.status = status; }
  if (category) { sql += " AND category = @category"; params.category = category; }
  if (priority) { sql += " AND priority = @priority"; params.priority = priority; }
  if (search) {
    sql += " AND (title LIKE @search OR description LIKE @search OR notes LIKE @search)";
    params.search = `%${search}%`;
  }

  const dir = sortOrder === "desc" ? "DESC" : "ASC";
  if (sortBy === "date") {
    sql += ` ORDER BY date ${dir}, CASE WHEN start_time = '' THEN 1 ELSE 0 END, start_time ${dir}`;
  } else if (sortBy === "title") {
    sql += ` ORDER BY LOWER(title) ${dir}`;
  } else if (sortBy === "startTime") {
    sql += ` ORDER BY CASE WHEN start_time = '' THEN 1 ELSE 0 END, start_time ${dir}, CASE priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END`;
  } else {
    // Default sort by Priority -> start_time -> created_at
    sql += ` ORDER BY CASE priority
      WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END ${dir},
      CASE WHEN start_time = '' THEN 1 ELSE 0 END, start_time ASC, created_at ASC`;
  }

  res.json(db.prepare(sql).all(params));
});

router.post("/:id/snooze", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const { minutes = 15, until } = req.body || {};
  let snoozedUntil;

  if (until) {
    const parsedUntil = new Date(until);
    if (Number.isNaN(parsedUntil.getTime()) || parsedUntil <= new Date()) {
      return res.status(400).json({ error: "Snooze time must be a valid future date." });
    }
    snoozedUntil = parsedUntil.toISOString();
  } else {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      return res.status(400).json({ error: "Snooze duration must be between 1 and 1440 minutes." });
    }
    snoozedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  }

  db.prepare("UPDATE tasks SET snoozed_until = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(snoozedUntil, now(), task.id, req.user.id);

  res.json(db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(task.id, req.user.id));
});

router.post("/:id/reschedule", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const targetDate = req.body?.date || todayKey();
  if (!validDate(targetDate)) return res.status(400).json({ error: "Enter a valid date in YYYY-MM-DD format." });
  db.prepare("UPDATE tasks SET date = ?, updated_at = ?, last_reminder_sent_for = NULL WHERE id = ? AND user_id = ?")
    .run(targetDate, now(), task.id, req.user.id);

  res.json(db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(task.id, req.user.id));
});

router.post("/", (req, res) => {
  const {
    id = `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    recurringId = null,
    title,
    description = "",
    date,
    startTime = "",
    priority = "Medium",
    category = "Other",
    status = "Pending",
    notes = "",
    subtasks = [],
    reminderTime = "",
    snoozedUntil = ""
  } = req.body;

  const sanitizedSubtasks = Array.isArray(subtasks)
    ? subtasks.filter((item) => item && typeof item.title === "string" && item.title.trim().length > 0)
    : [];

  if (typeof title !== "string" || !title.trim() || title.length > 200 || !validDate(date)) {
    return res.status(400).json({ error: "title and date are required" });
  }
  if (typeof description !== "string" || description.length > 5000
      || typeof notes !== "string" || notes.length > 5000
      || !validTime(startTime) || !validTime(reminderTime)
      || !PRIORITIES.includes(priority) || !CATEGORIES.includes(category) || !STATUSES.includes(status)
      || !Array.isArray(sanitizedSubtasks) || sanitizedSubtasks.length > 100
      || sanitizedSubtasks.some((item) => !item || typeof item.title !== "string" || !item.title.trim() || item.title.length > 200)) {
    return res.status(400).json({ error: "One or more task fields are invalid." });
  }

  const timestamp = now();
  const subtasksJson = JSON.stringify(sanitizedSubtasks);

  db.prepare(`
    INSERT INTO tasks
    (id, user_id, recurring_id, title, description, date, start_time, priority, category,
     status, notes, subtasks, reminder_time, snoozed_until, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, recurringId, title.trim(), description, date, startTime, priority, category,
    status, notes, subtasksJson, reminderTime, snoozedUntil, timestamp, timestamp,
    status === "Completed" ? timestamp : null
  );

  res.status(201).json(db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(id, req.user.id));
});

router.put("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: "Task not found" });

  const next = { ...existing, ...req.body };
  const nextTitle = next.title;
  const nextDate = next.date;
  const nextDescription = next.description ?? "";
  const nextNotes = next.notes ?? "";
  const nextStartTime = next.startTime ?? existing.start_time ?? "";
  const nextReminderTime = next.reminderTime ?? next.reminder_time ?? "";
  let nextSubtasks = req.body.subtasks === undefined ? existing.subtasks || "[]" : req.body.subtasks;
  try { if (typeof nextSubtasks === "string") nextSubtasks = JSON.parse(nextSubtasks); } catch { nextSubtasks = null; }
  if (Array.isArray(nextSubtasks)) {
    nextSubtasks = nextSubtasks.filter((item) => item && typeof item.title === "string" && item.title.trim().length > 0);
  }
  let nextSnoozedUntil = next.snoozedUntil ?? next.snoozed_until ?? "";
  if (nextSnoozedUntil !== "") {
    const parsedSnooze = new Date(nextSnoozedUntil);
    nextSnoozedUntil = Number.isNaN(parsedSnooze.getTime()) ? null : parsedSnooze.toISOString();
  }
  if (typeof nextTitle !== "string" || !nextTitle.trim() || nextTitle.length > 200 || !validDate(nextDate)
      || typeof nextDescription !== "string" || nextDescription.length > 5000
      || typeof nextNotes !== "string" || nextNotes.length > 5000
      || !validTime(nextStartTime) || !validTime(nextReminderTime)
      || !PRIORITIES.includes(next.priority) || !CATEGORIES.includes(next.category) || !STATUSES.includes(next.status)
      || !validSubtasks(nextSubtasks) || nextSnoozedUntil === null) {
    return res.status(400).json({ error: "One or more task fields are invalid." });
  }
  const completedAt =
    next.status === "Completed"
      ? (existing.status === "Completed" ? existing.completed_at : now())
      : null;

  const subtasksJson = JSON.stringify(nextSubtasks);

  db.prepare(`
    UPDATE tasks SET
      recurring_id=?, title=?, description=?, date=?, start_time=?, priority=?, category=?,
      status=?, notes=?, subtasks=?, reminder_time=?, snoozed_until=?,
      updated_at=?, completed_at=?,
      last_reminder_sent_for=CASE WHEN date != ? OR reminder_time != ? THEN NULL ELSE last_reminder_sent_for END
    WHERE id=? AND user_id=?
  `).run(
    next.recurringId ?? existing.recurring_id,
    nextTitle.trim(),
    nextDescription,
    nextDate,
    nextStartTime,
    next.priority,
    next.category,
    next.status,
    nextNotes,
    subtasksJson,
    nextReminderTime,
    nextSnoozedUntil,
    now(),
    completedAt,
    nextDate,
    nextReminderTime,
    existing.id,
    req.user.id
  );

  res.json(db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(existing.id, req.user.id));
});

router.patch("/:id/status", (req, res) => {
  const order = ["Pending", "In Progress", "Completed", "Cancelled"];
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const status = req.body?.status || order[(order.indexOf(task.status) + 1) % order.length];
  if (!order.includes(status)) return res.status(400).json({ error: "Invalid task status." });
  const timestamp = now();

  db.prepare(`
    UPDATE tasks SET status=?, completed_at=?, updated_at=? WHERE id=? AND user_id=?
  `).run(
    status,
    status === "Completed" ? timestamp : null,
    timestamp,
    task.id,
    req.user.id
  );

  res.json(db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(task.id, req.user.id));
});

router.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: "Task not found" });
  res.status(204).end();
});

module.exports = router;
