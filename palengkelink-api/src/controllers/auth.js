const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma, asUser } = require("../db");
const { HttpError, need } = require("../errors");
const { waitUntil } = require("@vercel/functions");
const { sendMail } = require("../mailer");

/** Who is logged in: { user_id, username, first_name, last_name, email, role, vendor_id } */
const me = async (user) => (await asUser(user, (tx) => tx.$queryRaw`SELECT * FROM fn_me()`))[0];

// Compared against when the username does not exist, so a wrong username takes as long as a wrong password
// (otherwise the response time would tell an attacker which usernames are real).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

/** Look up a user: { user, ok } where ok = the password is right (the app user may only read credentials through fn_login_lookup). */
async function checkLogin(username, password) {
  const [u] = await prisma.$queryRaw`SELECT * FROM fn_login_lookup(${String(username).trim()})`;
  const ok = await bcrypt.compare(String(password), u ? u.password_hash : DUMMY_HASH);
  return { user: u, ok: Boolean(u) && ok };
}
const findWithPassword = async (username, password) => {
  const { user, ok } = await checkLogin(username, password);
  return ok ? user : null;
};

const COMMON_PASSWORDS = ["password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123",
  "iloveyou", "11111111", "abc12345", "admin123", "welcome1", "palengke", "palengkelink", "letmein1", "00000000"];

/** New passwords: 8+ characters with letters AND numbers, not a well-known password, not the username. */
function checkNewPassword(password, username = "") {
  const p = String(password ?? "");
  if (p.length < 8) throw new HttpError(400, "The password needs at least 8 characters.");
  if (p.length > 72) throw new HttpError(400, "The password can have at most 72 characters.");   // bcrypt ignores the rest
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw new HttpError(400, "The password needs both letters and numbers.");
  if (COMMON_PASSWORDS.includes(p.toLowerCase())) throw new HttpError(400, "That password is too easy to guess. Please choose another.");
  const name = String(username).trim().toLowerCase();
  if (name.length >= 3 && p.toLowerCase().includes(name)) throw new HttpError(400, "The password must not contain the username.");
}
exports.checkNewPassword = checkNewPassword;

/** Login token: { id, role, v } where v = token version (raising it in the database ends every session). */
const signToken = (user, version) => jwt.sign({ id: user.id, role: user.role, v: version }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "8h" });

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
// 6-digit codes are easy to guess offline, so they are hashed with a server secret (HMAC) instead of plain SHA-256.
const codeHash = (code) => crypto.createHmac("sha256", process.env.JWT_SECRET).update(code).digest("hex");
const appUrl = (req) => process.env.APP_URL || `${req.protocol}://${req.get("host")}`;

// POST /api/auth/login  { username, password }  ->  { token, user }
exports.login = async (req, res) => {
  need(req.body, ["username", "password"]);
  const { user: u, ok } = await checkLogin(req.body.username, req.body.password);
  // A locked account is refused even with the right password, so guessing on stays useless.
  const [{ minutes }] = u ? await prisma.$queryRaw`SELECT fn_login_locked_minutes(${u.user_id}::int) AS minutes` : [{ minutes: 0 }];
  if (minutes > 0) throw new HttpError(429, `Too many wrong passwords. This account is locked for ${minutes} more minute(s), or use "Forgot password?".`);
  if (!ok) {
    if (u) {
      const [{ locked }] = await prisma.$queryRaw`SELECT fn_login_failed(${u.user_id}::int) AS locked`;
      if (locked > 0) throw new HttpError(429, `Too many wrong passwords. This account is locked for ${locked} minutes, or use "Forgot password?".`);
    }
    throw new HttpError(401, "Wrong username or password.");
  }
  // Only tell people about their account status after they proved the password is theirs.
  if (u.status === "pending") throw new HttpError(403, "Your registration is waiting for approval by the market office.");
  if (u.status !== "active") throw new HttpError(403, "This account is disabled. Please contact the market office.");
  const user = { id: u.user_id, role: u.role };
  const [{ version }] = await prisma.$queryRaw`SELECT fn_login_succeeded(${u.user_id}::int) AS version`;
  res.json({ token: signToken(user, version), user: await me(user) });
};

// POST /api/auth/register  { role: "vendor" | "staff", ... }  -> account in "pending" status until an admin approves it.
// Only vendors and inspectors (staff) can register themselves; admin accounts are made by an admin.
exports.register = async (req, res) => {
  const b = req.body;
  const role = b.role ?? "vendor";
  if (!["vendor", "staff"].includes(role)) throw new HttpError(400, "You can only register as a vendor or an inspector.");
  need(b, ["username", "password", "first_name", "last_name", "email",
    ...(role === "vendor" ? ["business_name", "contact_number", "address"] : [])]);
  checkNewPassword(b.password, b.username);
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(String(b.username).trim())) {
    throw new HttpError(400, "Username: 3-40 letters, numbers, dots, dashes or underscores.");
  }
  if (!/^\S+@\S+\.\S+$/.test(String(b.email).trim())) throw new HttpError(400, "Please enter a valid email address.");
  const hash = await bcrypt.hash(String(b.password), 10);
  if (role === "vendor") {
    await prisma.$queryRaw`SELECT fn_register_vendor(${String(b.username)}, ${hash}, ${String(b.first_name)}, ${String(b.last_name)},
      ${String(b.email)}, ${String(b.business_name)}, ${String(b.contact_number)}, ${String(b.address)}) AS user_id`;
  } else {
    await prisma.$queryRaw`SELECT fn_register_staff(${String(b.username)}, ${hash}, ${String(b.first_name)}, ${String(b.last_name)},
      ${String(b.email)}) AS user_id`;
  }
  res.status(201).json({ ok: true });
};

// POST /api/auth/forgot  { email }  -> always the same answer, so nobody can test which emails are registered.
// The email has a 6-digit code AND a link; either one resets the password (once, within 30 minutes).
exports.forgot = async (req, res) => {
  need(req.body, ["email"]);
  const token = crypto.randomBytes(32).toString("base64url");
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const [u] = await prisma.$queryRaw`SELECT * FROM fn_create_password_reset(${String(req.body.email)}, ${sha256(token)}, ${codeHash(code)})`;
  if (u) {
    const link = `${appUrl(req)}/#reset/${token}`;
    // Answer right away (waiting only when the email exists would tell people which emails are registered),
    // but tell Vercel to keep this function running until the email is sent. Locally, waitUntil does nothing.
    waitUntil(sendMail({
      to: u.email,
      subject: `PalengkeLink: your verification code is ${code}`,
      text: `Hi ${u.first_name},\n\nYour verification code is: ${code}\n\nType it on the "Forgot password" page, or open this link to choose a new password:\n${link}\n\nThe code and the link work once, for 30 minutes.\nIf you did not ask for this, you can ignore this email.`,
      html: `<p>Hi ${u.first_name.replace(/[<>&]/g, "")},</p><p>Your verification code is:</p>
        <p style="font-size:30px;font-weight:800;letter-spacing:8px;margin:8px 0 16px">${code}</p>
        <p>Type it on the "Forgot password" page, or click the button to choose a new password.</p>
        <p><a href="${link}" style="background:#1f8a4c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Reset my password</a></p>
        <p style="color:#666;font-size:13px">The code and the link work once, for 30 minutes. If you did not ask for this, you can ignore this email.</p>`,
    }).catch((e) => console.error("Could not send the reset email:", e.message)));
  }
  res.json({ ok: true });
};

// POST /api/auth/reset  { token, new_password }          (link from the email)
//                   or  { email, code, new_password }    (6-digit code from the email)
exports.reset = async (req, res) => {
  need(req.body, ["new_password"]);
  checkNewPassword(req.body.new_password);
  const hash = await bcrypt.hash(String(req.body.new_password), 10);
  if (req.body.token) {
    await prisma.$executeRaw`SELECT fn_reset_password(${sha256(String(req.body.token))}, ${hash})`;
    return res.json({ ok: true });
  }
  need(req.body, ["email", "code"]);
  const code = String(req.body.code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, "The code has 6 numbers.");
  const [{ result }] = await prisma.$queryRaw`SELECT fn_reset_password_code(${String(req.body.email)}, ${codeHash(code)}, ${hash}) AS result`;
  if (result === "wrong") throw new HttpError(400, "That code is wrong. Please check the email and try again.");
  if (result === "locked") throw new HttpError(400, "Too many wrong codes. Please request a new code.");
  if (result !== "ok") throw new HttpError(400, "This code has expired. Please request a new one.");
  res.json({ ok: true });
};

// GET /api/me
exports.me = async (req, res) => res.json(await me(req.user));

// PATCH /api/me/password  { current_password, new_password }
exports.changePassword = async (req, res) => {
  need(req.body, ["current_password", "new_password"]);
  const { username } = await me(req.user);
  checkNewPassword(req.body.new_password, username);
  if (!(await findWithPassword(username, req.body.current_password))) throw new HttpError(400, "Your current password is wrong.");
  const hash = await bcrypt.hash(String(req.body.new_password), 10);
  // Changing the password ends every session (database trigger); this device gets a fresh token so it stays signed in.
  const version = await asUser(req.user, async (tx) => {
    await tx.$executeRaw`SELECT fn_change_my_password(${hash}::text)`;
    return (await tx.$queryRaw`SELECT fn_my_token_version() AS v`)[0].v;
  });
  res.json({ ok: true, token: signToken(req.user, version) });
};

// POST /api/me/logout-everywhere  -> every device is signed out (also this one)
exports.logoutEverywhere = async (req, res) => {
  await asUser(req.user, (tx) => tx.$queryRaw`SELECT fn_logout_everywhere() AS v`);
  res.json({ ok: true });
};
