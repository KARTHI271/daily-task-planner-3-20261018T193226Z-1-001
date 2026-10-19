const express = require("express");
const db = require("../db");

const router = express.Router();

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rangeStat(tasks) {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === "Completed").length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

router.get("/", (req, res) => {
  const tasks = db.prepare("SELECT * FROM tasks WHERE user_id = ? ORDER BY date").all(req.user.id);
  const now = new Date();

  const weekFrom = new Date(now);
  weekFrom.setDate(now.getDate() - 6);
  const monthFrom = new Date(now);
  monthFrom.setDate(now.getDate() - 29);

  const week = tasks.filter(t => {
    const d = new Date(`${t.date}T00:00:00`);
    return d >= weekFrom && d <= now;
  });

  const month = tasks.filter(t => {
    const d = new Date(`${t.date}T00:00:00`);
    return d >= monthFrom && d <= now;
  });

  const today = dateKey(new Date());
  const overdueCount = tasks.filter(t => t.date < today && t.status !== "Completed" && t.status !== "Cancelled").length;

  const byCategoryMap = {};
  const byPriorityMap = { High: { total: 0, done: 0 }, Medium: { total: 0, done: 0 }, Low: { total: 0, done: 0 } };
  let totalSubtasks = 0;
  let completedSubtasks = 0;

  for (const t of tasks) {
    byCategoryMap[t.category] ||= { total: 0, done: 0 };
    byCategoryMap[t.category].total++;
    if (t.status === "Completed") byCategoryMap[t.category].done++;

    if (byPriorityMap[t.priority]) {
      byPriorityMap[t.priority].total++;
      if (t.status === "Completed") byPriorityMap[t.priority].done++;
    }

    try {
      const subs = typeof t.subtasks === "string" ? JSON.parse(t.subtasks || "[]") : (t.subtasks || []);
      if (Array.isArray(subs)) {
        totalSubtasks += subs.length;
        completedSubtasks += subs.filter(s => s.completed).length;
      }
    } catch {}
  }

  const byCategory = Object.entries(byCategoryMap).map(([category, s]) => ({
    category,
    total: s.total,
    done: s.done
  }));

  const byPriority = Object.entries(byPriorityMap).map(([priority, s]) => ({
    priority,
    total: s.total,
    done: s.done
  }));

  const byDate = {};
  for (const t of tasks) (byDate[t.date] ||= []).push(t);

  let streak = 0;
  const cursor = new Date();
  const todayKeyStr = dateKey(cursor);
  const todayList = byDate[todayKeyStr];

  // If today has tasks and all are completed, today counts towards streak
  if (todayList?.length && todayList.every(t => t.status === "Completed")) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  } else {
    // If today is in progress or has no tasks yet, start checking from yesterday
    // so an active streak is preserved during the day
    cursor.setDate(cursor.getDate() - 1);
  }

  while (true) {
    const list = byDate[dateKey(cursor)];
    if (!list?.length || !list.every(t => t.status === "Completed")) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  res.json({
    week: rangeStat(week),
    month: rangeStat(month),
    allTime: rangeStat(tasks),
    streak,
    overdueCount,
    byCategory,
    byPriority,
    subtaskStats: {
      total: totalSubtasks,
      done: completedSubtasks,
      pct: totalSubtasks ? Math.round((completedSubtasks / totalSubtasks) * 100) : 0
    }
  });
});

module.exports = router;
