// Outgoing email, sent through the business mailbox over SMTP.
//
// Without SMTP settings nothing can be sent. In development the message is
// printed to the console instead, so the reset flow can still be tried out.
const nodemailer = require("nodemailer");
const env = require("../config/env");

const isConfigured = Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);

let transport = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
      // A serverless function must not hang waiting on a slow mail server.
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transport;
}

async function send({ to, subject, text, html }) {
  if (!isConfigured) {
    if (env.nodeEnv === "production") throw new Error("SMTP is not configured");
    console.log(`\n[email not sent - no SMTP settings]\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return { logged: true };
  }
  return getTransport().sendMail({ from: env.emailFrom, to, subject, text, html });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function sendPasswordReset(user, link, minutes) {
  const name = user.name || "there";
  const text = [
    `Hi ${name},`,
    "",
    "Someone asked to reset the password for your ADI Check Pro account.",
    `Choose a new password here (the link works for ${minutes} minutes, once):`,
    "",
    link,
    "",
    "If this wasn't you, ignore this email - your password stays the same.",
    "",
    "ADI Check Pro",
  ].join("\n");

  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">
  <p>Hi ${escapeHtml(name)},</p>
  <p>Someone asked to reset the password for your ADI Check Pro account.</p>
  <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Choose a new password</a></p>
  <p style="color:#555">The link works for ${minutes} minutes, once. If the button does not work, copy this into your browser:<br>${escapeHtml(link)}</p>
  <p style="color:#555">If this wasn't you, ignore this email - your password stays the same.</p>
  <p>ADI Check Pro</p>
</div>`;

  return send({ to: user.email, subject: "Reset your ADI Check Pro password", text, html });
}

module.exports = { isConfigured, sendPasswordReset };
