// Sends email. Settings come from .env, checked in this order:
// 1) MAILTRAP_TOKEN -> Mailtrap SDK (MAILTRAP_INBOX_ID set = Sandbox: emails land in a Mailtrap test inbox;
//                      not set = Email Sending: real delivery from your verified domain)
// 2) SMTP_HOST      -> any SMTP server (Gmail app password, Brevo, Mailtrap SMTP, ...)
// 3) neither        -> the email is printed in the server terminal, so you can still test on your computer.
const nodemailer = require("nodemailer");
const { MailtrapClient } = require("mailtrap");

let transport;
function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  transport ||= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transport;
}

/** "PalengkeLink <no-reply@site.com>" -> { name: "PalengkeLink", email: "no-reply@site.com" } */
function parseAddress(s) {
  const m = String(s || "").match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2].trim() } : { email: String(s || "").trim() };
}

// Mailtrap's official SDK (npm "mailtrap"). Sent emails: https://mailtrap.io/sending/email_logs
let mailtrap;
function getMailtrap() {
  const inbox = process.env.MAILTRAP_INBOX_ID;
  mailtrap ||= new MailtrapClient({
    token: process.env.MAILTRAP_TOKEN,
    ...(inbox ? { sandbox: true, testInboxId: Number(inbox) } : {}),
  });
  return mailtrap;
}

async function sendWithMailtrap({ to, subject, text, html }) {
  try {
    await getMailtrap().send({ from: parseAddress(process.env.MAIL_FROM), to: [{ email: to }], subject, text, html, category: "Password reset" });
  } catch (e) {
    throw new Error(`Mailtrap: ${e.message}`);
  }
}

async function sendMail({ to, subject, text, html }) {
  // Testing: MAIL_ONLY_TO sends every email to that one address instead (the subject says who it was for).
  if (process.env.MAIL_ONLY_TO) {
    subject = `[TEST for ${to}] ${subject}`;
    to = process.env.MAIL_ONLY_TO;
  }
  if (process.env.MAILTRAP_TOKEN) return sendWithMailtrap({ to, subject, text, html });
  const t = getTransport();
  if (!t) {
    console.log(`\n----- EMAIL (SMTP not configured, so it is shown here) -----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n-----------------------------------------------------------\n`);
    return;
  }
  await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
}

module.exports = { sendMail };
