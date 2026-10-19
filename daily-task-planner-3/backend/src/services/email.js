const nodemailer = require("nodemailer");

function config() {
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_APP_PASSWORD;
  const from = process.env.EMAIL_FROM;
  const appUrl = process.env.APP_BASE_URL;
  if (!user || !password || !from || !appUrl) {
    throw new Error("Email is not configured. Set SMTP_USER, SMTP_APP_PASSWORD, EMAIL_FROM, and APP_BASE_URL.");
  }

  const parsedUrl = new URL(appUrl);
  if (!parsedUrl.hostname || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash
      || (parsedUrl.pathname && parsedUrl.pathname !== "/")) {
    throw new Error("APP_BASE_URL must be the site's origin without a path, credentials, query, or fragment.");
  }
  if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use HTTPS in production.");
  }
  return { user, password: password.replace(/\s/g, ""), from, appUrl: parsedUrl.origin };
}

async function sendEmail({ to, subject, html, text }) {
  const { user, password, from } = config();
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  try {
    await transporter.sendMail({ from, to, subject, text, html });
  } catch (error) {
    console.error(`Gmail SMTP request failed: ${error.code || "SMTP_ERROR"}`);
    throw new Error("Email provider rejected the message.");
  } finally {
    transporter.close();
  }
  return true;
}

function actionUrl(action, token) {
  const { appUrl } = config();
  return `${appUrl}/#${action}=${encodeURIComponent(token)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

async function sendVerificationEmail(email, token) {
  const link = actionUrl("verify", token);
  await sendEmail({
    to: email,
    subject: "Verify your Daily Task Planner account",
    text: `Verify your email address: ${link}\nThis link expires in 24 hours. If you did not create this account, ignore this email.`,
    html: `<p>Verify your email address to finish creating your Daily Task Planner account.</p><p><a href="${link}">Verify email address</a></p><p>This link expires in 24 hours. If you did not create this account, ignore this email.</p>`,
  });
}

async function sendPasswordResetEmail(email, token) {
  const link = actionUrl("reset", token);
  await sendEmail({
    to: email,
    subject: "Reset your Daily Task Planner password",
    text: `Choose a new password: ${link}\nThis link expires in 30 minutes. If you did not request this, ignore this email.`,
    html: `<p>A password reset was requested for your Daily Task Planner account.</p><p><a href="${link}">Choose a new password</a></p><p>This link expires in 30 minutes. If you did not request this, ignore this email.</p>`,
  });
}

async function sendTaskReminder({ email, title, date, time, timezone }) {
  const safeTitle = escapeHtml(title);
  const safeSubject = String(title).replace(/[\r\n]+/g, " ").slice(0, 120);
  const when = `${date} ${time} (${timezone})`;
  await sendEmail({
    to: email,
    subject: `Task reminder: ${safeSubject}`,
    text: `Your task "${title}" is due at ${when}.`,
    html: `<p>Your task <strong>${safeTitle}</strong> is due at ${escapeHtml(when)}.</p>`,
  });
}

module.exports = {
  config,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendTaskReminder,
};
