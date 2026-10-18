const express = require("express");
const db = require("../db");
const { generateForDate } = require("../services/scheduler");

const router = express.Router();
const now = () => new Date().toISOString();

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

router.get("/", (req, res) => {
  const { date, from, to, status, category, priority, search, overdue, sortBy, sortOrder = "asc" } = req.query;

  if (date) {
    try {
      const [y, m, d] = date.split("-").map(Number);
      if (y && m && d) generateForDate(new Date(y, m - 1, d), req.user.id);
    } catch (e) {
      console.error("Error generating tasks for date:", e);
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

  const dir = sortOrder.toLowerCase() === "desc" ? "DESC" : "ASC";
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

  const { minutes = 15, until } = req.body;
  let snoozedUntil;

  if (until) {
    snoozedUntil = new Date(until).toISOString();
  } else {
    snoozedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  }

  db.prepare("UPDATE tasks SET snoozed_until = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(snoozedUntil, now(), task.id, req.user.id);

  res.json(db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(task.id, req.user.id));
});

router.post("/:id/reschedule", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const targetDate = req.body.date || todayKey();
  db.prepare("UPDATE tasks SET date = ?, updated_at = ? WHERE id = ? AND user_id = ?")
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

  if (!title?.trim() || !date) {
    return res.status(400).json({ error: "title and date are required" });
  }

  const timestamp = now();
  const subtasksJson = typeof subtasks === "string" ? subtasks : JSON.stringify(subtasks || []);

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
  const completedAt =
    next.status === "Completed"
      ? (existing.status === "Completed" ? existing.completed_at : now())
      : null;

  const subtasksJson =
    req.body.subtasks !== undefined
      ? (typeof req.body.subtasks === "string" ? req.body.subtasks : JSON.stringify(req.body.subtasks))
      : existing.subtasks || "[]";

  db.prepare(`
    UPDATE tasks SET
      recurring_id=?, title=?, description=?, date=?, start_time=?, priority=?, category=?,
      status=?, notes=?, subtasks=?, reminder_time=?, snoozed_until=?,
      updated_at=?, completed_at=?
    WHERE id=? AND user_id=?
  `).run(
    next.recurringId ?? existing.recurring_id,
    next.title,
    next.description ?? "",
    next.date,
    next.startTime ?? existing.start_time ?? "",
    next.priority,
    next.category,
    next.status,
    next.notes ?? "",
    subtasksJson,
    next.reminderTime ?? next.reminder_time ?? "",
    next.snoozedUntil ?? next.snoozed_until ?? "",
    now(),
    completedAt,
    existing.id,
    req.user.id
  );

  res.json(db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(existing.id, req.user.id));
});

router.patch("/:id/status", (req, res) => {
  const order = ["Pending", "In Progress", "Completed", "Cancelled"];
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const status = req.body.status || order[(order.indexOf(task.status) + 1) % order.length];
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
