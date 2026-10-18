const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", (_req, res) => {
  res.json(db.prepare("SELECT * FROM recurring_tasks ORDER BY start_date, start_time").all());
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
    enabled = true
  } = req.body;

  if (!title?.trim() || !startDate) {
    return res.status(400).json({ error: "title and startDate are required" });
  }

  db.prepare(`
    INSERT INTO recurring_tasks
    (id,title,description,start_time,priority,category,frequency,start_date,enabled)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    id, title.trim(), description, startTime, priority, category,
    frequency, startDate, enabled ? 1 : 0
  );

  res.status(201).json(db.prepare("SELECT * FROM recurring_tasks WHERE id=?").get(id));
});

router.put("/:id", (req, res) => {
  const current = db.prepare("SELECT * FROM recurring_tasks WHERE id=?").get(req.params.id);
  if (!current) return res.status(404).json({ error: "Recurring task not found" });

  const next = { ...current, ...req.body };
  db.prepare(`
    UPDATE recurring_tasks SET
      title=?, description=?, start_time=?, priority=?, category=?,
      frequency=?, start_date=?, enabled=?
    WHERE id=?
  `).run(
    next.title, next.description ?? "", next.startTime ?? next.start_time ?? "",
    next.priority, next.category, next.frequency, next.startDate ?? next.start_date,
    next.enabled ? 1 : 0, current.id
  );

  res.json(db.prepare("SELECT * FROM recurring_tasks WHERE id=?").get(current.id));
});

router.patch("/:id/toggle", (req, res) => {
  const current = db.prepare("SELECT * FROM recurring_tasks WHERE id=?").get(req.params.id);
  if (!current) return res.status(404).json({ error: "Recurring task not found" });

  const enabled = req.body.enabled === undefined ? !current.enabled : !!req.body.enabled;
  db.prepare("UPDATE recurring_tasks SET enabled=? WHERE id=?").run(enabled ? 1 : 0, current.id);

  res.json(db.prepare("SELECT * FROM recurring_tasks WHERE id=?").get(current.id));
});

router.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM recurring_tasks WHERE id=?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Recurring task not found" });
  res.status(204).end();
});

module.exports = router;
