const crypto = require("crypto");
const net = require("net");
const express = require("express");
const db = require("../db");
const {
  hashPassword, verifyPassword, issueSession, requireAuth, clearSessionCookie,
  cookieToken, tokenHash,
} = require("../auth");
const emailService = require("../services/email");

const router = express.Router();
const attempts = new Map();
const now = () => new Date().toISOString();
const GENERIC_RESET_MESSAGE = "If that address belongs to a verified account, a password reset email will arrive shortly.";
const GENERIC_VERIFY_MESSAGE = "If we can create or verify the account, a verification email will arrive shortly.";

function limitAuthAttempts(req, res, next) {
  const cfIp = process.env.TRUST_CF_CONNECTING_IP === "true" ? req.get("cf-connecting-ip") : "";
  const key = cfIp && net.isIP(cfIp) ? cfIp : (req.ip || req.socket.remoteAddress || "unknown");
  const currentTime = Date.now();
  const record = attempts.get(key);
  if (!record || currentTime - record.startedAt > 60_000) {
    attempts.set(key, { startedAt: currentTime, count: 1 });
  } else if (record.count >= 10) {
    return res.status(429).json({ error: "Too many attempts. Wait a minute and try again." });
  } else {
    record.count += 1;
  }
  if (attempts.size > 100) {
    for (const [ip, entry] of attempts) if (currentTime - entry.startedAt > 60_000) attempts.delete(ip);
  }
  next();
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validPassword(password) {
  return typeof password === "string" && password.length >= 12 && Buffer.byteLength(password, "utf8") <= 128;
}

function safeTimezone(value) {
  if (typeof value !== "string" || value.length > 100) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function createEmailToken(userId, purpose, lifetimeMs) {
  const token = crypto.randomBytes(32).toString("base64url");
  const timestamp = now();
  const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
  const save = db.transaction(() => {
    db.prepare("DELETE FROM email_tokens WHERE expires_at <= ? OR used_at IS NOT NULL").run(timestamp);
    db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?").run(userId, purpose);
    db.prepare(`
      INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tokenHash(token), userId, purpose, expiresAt, timestamp);
  });
  save();
  return token;
}

function genericSendError(error, context) {
  console.error(`${context}:`, error.message);
}

router.post("/register", limitAuthAttempts, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address" });
    if (!validPassword(password)) return res.status(400).json({ error: "Password must be at least 12 characters and no more than 128 bytes" });

    // Validate deployment configuration before creating a new account.
    emailService.config();
    const existing = db.prepare("SELECT id, email_verified_at FROM users WHERE email = ?").get(email);
    if (existing) {
      if (!existing.email_verified_at) {
        const token = createEmailToken(existing.id, "verify", 24 * 60 * 60 * 1000);
        try { await emailService.sendVerificationEmail(email, token); }
        catch (error) { genericSendError(error, "Verification email delivery failed"); }
      }
      return res.status(202).json({ message: GENERIC_VERIFY_MESSAGE });
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const createUser = db.transaction(() => {
      db.prepare(`
        INSERT INTO users (id, email, password_hash, timezone, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, email, passwordHash, safeTimezone(req.body?.timezone), now());
      const hasOtherUsers = db.prepare("SELECT 1 FROM users WHERE id != ? LIMIT 1").get(id);
      if (!hasOtherUsers) {
        db.prepare("UPDATE tasks SET user_id = ? WHERE user_id IS NULL").run(id);
        db.prepare("UPDATE recurring_tasks SET user_id = ? WHERE user_id IS NULL").run(id);
      }
    });
    createUser();
    const token = createEmailToken(id, "verify", 24 * 60 * 60 * 1000);
    try {
      await emailService.sendVerificationEmail(email, token);
    } catch (error) {
      genericSendError(error, "Verification email delivery failed");
      return res.status(503).json({ error: "Account created, but the verification email could not be sent. Try creating the account again to request another link." });
    }
    res.status(202).json({ message: GENERIC_VERIFY_MESSAGE });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(202).json({ message: GENERIC_VERIFY_MESSAGE });
    }
    next(error);
  }
});

router.post("/verify-email", limitAuthAttempts, (req, res) => {
  const token = req.body?.token;
  if (typeof token !== "string" || token.length < 32 || token.length > 128) {
    return res.status(400).json({ error: "This verification link is invalid or expired." });
  }
  const tokenDigest = tokenHash(token);
  const timestamp = now();
  const verify = db.transaction(() => {
    const record = db.prepare(`
      SELECT email_tokens.user_id
      FROM email_tokens JOIN users ON users.id = email_tokens.user_id
      WHERE email_tokens.token_hash = ? AND email_tokens.purpose = 'verify'
        AND email_tokens.used_at IS NULL AND email_tokens.expires_at > ?
        AND users.email_verified_at IS NULL
    `).get(tokenDigest, timestamp);
    if (!record) return false;
    const consumed = db.prepare("UPDATE email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL")
      .run(timestamp, tokenDigest);
    if (!consumed.changes) return false;
    db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL")
      .run(timestamp, record.user_id);
    db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'verify' AND token_hash != ?")
      .run(record.user_id, tokenDigest);
    return true;
  });
  if (!verify()) return res.status(400).json({ error: "This verification link is invalid or expired." });
  res.json({ message: "Email verified. You can now sign in." });
});

router.post("/login", limitAuthAttempts, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const user = db.prepare(`
      SELECT id, email, password_hash, email_verified_at, email_reminders_enabled, timezone
      FROM users WHERE email = ?
    `).get(email);
    const valid = user && user.email_verified_at && typeof password === "string" && Buffer.byteLength(password, "utf8") <= 128
      ? await verifyPassword(password, user.password_hash)
      : false;
    if (!valid) return res.status(401).json({ error: "Email or password is incorrect, or the email has not been verified" });
    issueSession(user.id, res);
    res.json({ user: {
      id: user.id,
      email: user.email,
      emailVerified: true,
      emailRemindersEnabled: !!user.email_reminders_enabled,
      timezone: user.timezone,
    } });
  } catch (error) {
    next(error);
  }
});

router.post("/resend-verification", limitAuthAttempts, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (validEmail(email)) {
    const user = db.prepare("SELECT id FROM users WHERE email = ? AND email_verified_at IS NULL").get(email);
    if (user) {
      try {
        const token = createEmailToken(user.id, "verify", 24 * 60 * 60 * 1000);
        await emailService.sendVerificationEmail(email, token);
      } catch (error) { genericSendError(error, "Verification email delivery failed"); }
    }
  }
  res.status(202).json({ message: GENERIC_VERIFY_MESSAGE });
});

router.post("/forgot-password", limitAuthAttempts, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (validEmail(email)) {
    const user = db.prepare("SELECT id FROM users WHERE email = ? AND email_verified_at IS NOT NULL").get(email);
    if (user) {
      try {
        const token = createEmailToken(user.id, "reset", 30 * 60 * 1000);
        await emailService.sendPasswordResetEmail(email, token);
      } catch (error) { genericSendError(error, "Password reset email delivery failed"); }
    }
  }
  res.status(202).json({ message: GENERIC_RESET_MESSAGE });
});

router.post("/reset-password", limitAuthAttempts, async (req, res, next) => {
  try {
    const token = req.body?.token;
    const password = req.body?.password;
    if (typeof token !== "string" || token.length < 32 || token.length > 128) {
      return res.status(400).json({ error: "This password reset link is invalid or expired." });
    }
    if (!validPassword(password)) {
      return res.status(400).json({ error: "Password must be at least 12 characters and no more than 128 bytes" });
    }

    const tokenDigest = tokenHash(token);
    const record = db.prepare(`
      SELECT user_id FROM email_tokens
      WHERE token_hash = ? AND purpose = 'reset' AND used_at IS NULL AND expires_at > ?
    `).get(tokenDigest, now());
    if (!record) return res.status(400).json({ error: "This password reset link is invalid or expired." });

    const passwordHash = await hashPassword(password);
    const timestamp = now();
    const reset = db.transaction(() => {
      const consumed = db.prepare(`
        UPDATE email_tokens SET used_at = ?
        WHERE token_hash = ? AND purpose = 'reset' AND used_at IS NULL AND expires_at > ?
      `).run(timestamp, tokenDigest, timestamp);
      if (!consumed.changes) return false;
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, record.user_id);
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(record.user_id);
      db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'reset' AND token_hash != ?")
        .run(record.user_id, tokenDigest);
      return true;
    });
    if (!reset()) return res.status(400).json({ error: "This password reset link is invalid or expired." });
    clearSessionCookie(res);
    res.json({ message: "Password updated. Sign in with your new password." });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.put("/preferences", requireAuth, (req, res) => {
  const enabled = req.body?.emailRemindersEnabled === true;
  const timezone = safeTimezone(req.body?.timezone);
  if (enabled && !req.user.emailVerified) {
    return res.status(400).json({ error: "Verify your email address before enabling email reminders." });
  }
  db.prepare("UPDATE users SET email_reminders_enabled = ?, timezone = ? WHERE id = ?")
    .run(enabled ? 1 : 0, timezone, req.user.id);
  res.json({ emailRemindersEnabled: enabled, timezone });
});

router.post("/logout", (req, res) => {
  const token = cookieToken(req);
  if (token) db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash(token));
  clearSessionCookie(res);
  res.status(204).end();
});

module.exports = router;
