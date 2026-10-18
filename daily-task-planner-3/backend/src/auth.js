const crypto = require("crypto");
const argon2 = require("argon2");
const db = require("./db");

const COOKIE_NAME = "planner_session";
const SESSION_DAYS = 30;

function cookieToken(req) {
  const cookies = (req.headers.cookie || "").split(";");
  const prefix = `${COOKIE_NAME}=`;
  const item = cookies.find((part) => part.trim().startsWith(prefix));
  if (!item) return null;
  try { return decodeURIComponent(item.trim().slice(prefix.length)); }
  catch { return null; }
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

async function verifyPassword(password, encoded) {
  if (!encoded?.startsWith("$argon2id$")) return false;
  return argon2.verify(encoded, password);
}

function issueSession(userId, res) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString();
  db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now.toISOString());
  db.prepare("INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(tokenHash(token), userId, expiresAt, now.toISOString());
  setSessionCookie(res, token);
}

function requireAuth(req, res, next) {
  const token = cookieToken(req);
  if (!token) return res.status(401).json({ error: "Please sign in to continue" });

  const session = db.prepare(`
    SELECT users.id, users.email, users.email_verified_at,
      users.email_reminders_enabled, users.timezone
    FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
    WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?
  `).get(tokenHash(token), new Date().toISOString());
  if (!session) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Your session expired. Please sign in again." });
  }
  req.user = {
    id: session.id,
    email: session.email,
    emailVerified: !!session.email_verified_at,
    emailRemindersEnabled: !!session.email_reminders_enabled,
    timezone: session.timezone,
  };
  req.sessionTokenHash = tokenHash(token);
  next();
}

module.exports = { hashPassword, verifyPassword, issueSession, requireAuth, clearSessionCookie, cookieToken, tokenHash };
