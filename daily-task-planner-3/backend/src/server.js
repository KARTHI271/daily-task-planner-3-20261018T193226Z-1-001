const express = require("express");
const path = require("path");

const authRouter = require("./routes/auth");
const tasksRouter = require("./routes/tasks");
const statsRouter = require("./routes/stats");
const recurringRouter = require("./routes/recurring");
const { requireAuth } = require("./auth");
const startScheduler = require("./services/scheduler");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "32kb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "daily-task-planner" });
});

app.use("/api/auth", authRouter);
app.use("/api", requireAuth);
app.use("/api/tasks", tasksRouter);
app.use("/api/stats", statsRouter);
app.use("/api/recurring", recurringRouter);

// Serve frontend
const frontendPath = path.join(__dirname, "../../frontend/public");

app.use(express.static(frontendPath));

app.use((req, res, next) => {
  if (req.originalUrl.startsWith("/api/")) {
    return res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  }

  res.sendFile(path.join(frontendPath, "index.html"));
});

app.use((err, req, res, _next) => {
  console.error("API Error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

const server = app.listen(PORT, () => {
  console.log(`Daily Task Planner running on http://localhost:${PORT}`);
});

startScheduler();

module.exports = server;
