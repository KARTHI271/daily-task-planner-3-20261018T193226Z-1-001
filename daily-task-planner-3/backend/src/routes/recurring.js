const express = require("express");
const db = require("../db");

const router = express.Router();
const PRIORITIES = ["High", "Medium", "Low"];
const CATEGORIES = ["SRE", "AWS", "GCP", "Linux", "DevOps", "AI", "Documentation", "Personal", "Other"];
const FREQUENCIES = ["daily", "weekly", "monthly"];

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

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM recurring_tasks WHERE user_id = ? ORDER BY start_date, start_time").all(req.user.id));
});

router.post("/", (req, res) => {
  const {
    id = `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    title,
    description = "",
    startTime = "",
    priority = "Medium",
    category = "Other",
    frequency = "daily",
    startDate,
    enabled = true,
    subtasks = [],
    reminderTime = ""
  } = req.body;

  if (typeof title !== "string" || !title.trim() || title.length > 200 || !validDate(startDate)
      || typeof description !== "string" || description.length > 5000 || !validTime(startTime)
      || !validTime(reminderTime) || !PRIORITIES.includes(priority) || !CATEGORIES.includes(category)
      || !FREQUENCIES.includes(frequency) || typeof enabled !== "boolean" || !validSubtasks(subtasks)) {
    return res.status(400).json({ error: "title and startDate are required" });
  }

  db.prepare(`
    INSERT INTO recurring_tasks
    (id,user_id,title,description,start_time,priority,category,frequency,start_date,enabled,subtasks,reminder_time)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, req.user.id, title.trim(), description, startTime, priority, category,
    frequency, startDate, enabled ? 1 : 0, JSON.stringify(subtasks), reminderTime
  );

  res.status(201).json(db.prepare("SELECT * FROM recurring_tasks WHERE id=? AND user_id=?").get(id, req.user.id));
});

router.put("/:id", (req, res) => {
  const current = db.prepare("SELECT * FROM recurring_tasks WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!current) return res.status(404).json({ error: "Recurring task not found" });

  const next = { ...current, ...req.body };
  const nextDate = next.startDate ?? next.start_date;
  const nextTime = next.startTime ?? next.start_time ?? "";
  const nextEnabled = next.enabled;
  let nextSubtasks = next.subtasks ?? "[]";
  try { if (typeof nextSubtasks === "string") nextSubtasks = JSON.parse(nextSubtasks); } catch { nextSubtasks = null; }
  const nextReminderTime = next.reminderTime ?? next.reminder_time ?? "";
  if (typeof next.title !== "string" || !next.title.trim() || next.title.length > 200
      || typeof (next.description ?? "") !== "string" || (next.description ?? "").length > 5000
      || !validTime(nextTime) || !validTime(nextReminderTime) || !validDate(nextDate)
      || !PRIORITIES.includes(next.priority) || !CATEGORIES.includes(next.category)
      || !FREQUENCIES.includes(next.frequency) || typeof nextEnabled !== "boolean" && nextEnabled !== 0 && nextEnabled !== 1
      || !validSubtasks(nextSubtasks)) {
    return res.status(400).json({ error: "One or more recurring task fields are invalid." });
  }
  db.prepare(`
    UPDATE recurring_tasks SET
      title=?, description=?, start_time=?, priority=?, category=?,
      frequency=?, start_date=?, enabled=?, subtasks=?, reminder_time=?
    WHERE id=? AND user_id=?
  `).run(
    next.title.trim(), next.description ?? "", nextTime,
    next.priority, next.category, next.frequency, nextDate,
    nextEnabled ? 1 : 0, JSON.stringify(nextSubtasks), nextReminderTime, current.id, req.user.id
  );

  res.json(db.prepare("SELECT * FROM recurring_tasks WHERE id=? AND user_id=?").get(current.id, req.user.id));
});

router.patch("/:id/toggle", (req, res) => {
  const current = db.prepare("SELECT * FROM recurring_tasks WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!current) return res.status(404).json({ error: "Recurring task not found" });

  const requested = req.body?.enabled;
  if (requested !== undefined && typeof requested !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean." });
  }
  const enabled = requested === undefined ? !current.enabled : requested;
  db.prepare("UPDATE recurring_tasks SET enabled=? WHERE id=? AND user_id=?").run(enabled ? 1 : 0, current.id, req.user.id);

  res.json(db.prepare("SELECT * FROM recurring_tasks WHERE id=? AND user_id=?").get(current.id, req.user.id));
});

router.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM recurring_tasks WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: "Recurring task not found" });
  res.status(204).end();
});

module.exports = router;
