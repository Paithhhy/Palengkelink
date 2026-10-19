// Sends email through any SMTP server (Gmail app password, Brevo, Mailtrap, ...). Settings come from .env.
// Without SMTP_HOST the email is printed in the server terminal instead, so you can still test on your computer.
const nodemailer = require("nodemailer");

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

async function sendMail({ to, subject, text, html }) {
  const t = getTransport();
  if (!t) {
    console.log(`\n----- EMAIL (SMTP not configured, so it is shown here) -----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n-----------------------------------------------------------\n`);
    return;
  }
  await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
}

module.exports = { sendMail };
