const crypto = require("crypto");
const express = require("express");
const db = require("../db");
const { hashPassword, verifyPassword, issueSession, requireAuth, clearSessionCookie, cookieToken, tokenHash } = require("../auth");

const router = express.Router();
const attempts = new Map();
const now = () => new Date().toISOString();

function limitAuthAttempts(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const currentTime = Date.now();
  const record = attempts.get(key);
  if (!record || currentTime - record.startedAt > 60_000) {
    attempts.set(key, { startedAt: currentTime, count: 1 });
  } else if (record.count >= 10) {
    return res.status(429).json({ error: "Too many attempts. Wait a minute and try again." });
  } else {
    record.count += 1;
  }
  if (attempts.size > 5000) {
    for (const [ip, entry] of attempts) if (currentTime - entry.startedAt > 60_000) attempts.delete(ip);
  }
  next();
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

router.post("/register", limitAuthAttempts, async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body.password;
    if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address" });
    if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 128) {
      return res.status(400).json({ error: "Password must be at least 12 characters and no more than 128 bytes" });
    }
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const createUser = db.transaction(() => {
      db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
        .run(id, email, passwordHash, now());
      // Preserve data from the original single-user app by assigning it to
      // the first account created after this upgrade.
      const hasOtherUsers = db.prepare("SELECT 1 FROM users WHERE id != ? LIMIT 1").get(id);
      if (!hasOtherUsers) {
        db.prepare("UPDATE tasks SET user_id = ? WHERE user_id IS NULL").run(id);
        db.prepare("UPDATE recurring_tasks SET user_id = ? WHERE user_id IS NULL").run(id);
      }
    });
    createUser();
    issueSession(id, res);
    res.status(201).json({ user: { id, email } });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "An account with that email already exists" });
    next(error);
  }
});

router.post("/login", limitAuthAttempts, async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body.password;
    const user = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").get(email);
    const valid = user && typeof password === "string" && Buffer.byteLength(password, "utf8") <= 128
      ? await verifyPassword(password, user.password_hash)
      : false;
    if (!valid) return res.status(401).json({ error: "Email or password is incorrect" });
    issueSession(user.id, res);
    res.json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post("/logout", (req, res) => {
  const token = cookieToken(req);
  if (token) db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash(token));
  clearSessionCookie(res);
  res.status(204).end();
});

module.exports = router;
