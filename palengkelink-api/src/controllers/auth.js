const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { prisma, asUser } = require("../db");
const { setSession, clearSession } = require("../session");
const { HttpError, need } = require("../errors");
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

// One place for these rules (register, forgot password, admin forms). The database has the same username rule (015).
function checkUsername(username) {
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(String(username ?? "").trim())) {
    throw new HttpError(400, "Username: 3-40 letters, numbers, dots, dashes or underscores.");
  }
}
function checkEmail(email) {
  if (!/^\S+@\S+\.\S+$/.test(String(email ?? "").trim())) throw new HttpError(400, "Please enter a valid email address.");
}
exports.checkUsername = checkUsername;
exports.checkEmail = checkEmail;

// ----- Two-step sign-in: a 6-digit code by email after the password -----
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
const cleanCode = (code) => {
  const c = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) throw new HttpError(400, "The code has 6 numbers.");
  return c;
};
/** "josedimitri@gmail.com" -> "jo•••••••@gmail.com" (shown on screen, so the full address is not revealed) */
const maskEmail = (email) => String(email).replace(/^(.{1,2})[^@]*/, (m, start) => start + "•".repeat(Math.max(3, m.length - start.length)));

/** Make a challenge, email its code, and return { challenge, email } for the browser. */
async function startChallenge(userId, purpose) {
  const challenge = crypto.randomBytes(32).toString("base64url");
  const code = newCode();
  const [u] = await prisma.$queryRaw`SELECT * FROM fn_create_login_challenge(${userId}::int, ${purpose}, ${sha256(challenge)}, ${codeHash(code)})`;
  const what = purpose === "login" ? "sign in" : "turn on two-step sign-in";
  // Wait for the email, so a failure is shown instead of a "we sent a code" that never arrives.
  await sendMail({
    category: "Two-step sign-in",
    to: u.email,
    subject: `PalengkeLink: your sign-in code is ${code}`,
    text: `Hi ${u.first_name},\n\nYour code to ${what} is: ${code}\n\nIt works once, for 10 minutes.\nIf this was not you, someone knows your password: change it right away on the Account page.`,
    html: `<p>Hi ${u.first_name.replace(/[<>&]/g, "")},</p><p>Your code to ${what} is:</p>
      <p style="font-size:30px;font-weight:800;letter-spacing:8px;margin:8px 0 16px">${code}</p>
      <p style="color:#666;font-size:13px">It works once, for 10 minutes. If this was not you, someone knows your password: change it right away on the Account page.</p>`,
  }).catch(async (e) => {
    console.error("Could not send the sign-in code:", e.message);
    // Nobody received this code, so it must not stay usable in the database
    await prisma.$executeRaw`SELECT fn_cancel_login_challenge(${sha256(challenge)})`.catch(() => {});
    throw new HttpError(502, "We could not send the code email right now. Please try again later, or ask the market office for help.");
  });
  return { challenge, email: maskEmail(u.email) };
}

/** Check a code; returns the user id or throws a clear message. */
async function checkChallenge(challenge, purpose, code) {
  const c = cleanCode(code);
  const [r] = await prisma.$queryRaw`SELECT * FROM fn_check_login_challenge(${sha256(String(challenge ?? ""))}, ${purpose}, ${codeHash(c)})`;
  if (r.result === "wrong") throw new HttpError(400, "That code is wrong. Please check the email and try again.");
  if (r.result === "locked") throw new HttpError(400, "Too many wrong codes. Please start again.");
  if (r.result !== "ok") throw new HttpError(400, "This code has expired. Please start again.");
  return r.user_id;
}

/** Password (and code, if needed) are right: count the sign-in, set the login cookie, answer with who it is. */
async function finishLogin(req, res, user) {
  const [{ version }] = await prisma.$queryRaw`SELECT fn_login_succeeded(${user.id}::int) AS version`;
  setSession(req, res, user, version);
  res.json({ user: await me(user) });
}

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
  const [{ is_on }] = await prisma.$queryRaw`SELECT fn_two_factor_on(${u.user_id}::int) AS is_on`;
  if (is_on) return res.json({ twoStep: true, ...(await startChallenge(u.user_id, "login")) });   // no session yet: the code comes first
  await finishLogin(req, res, user);
};

// POST /api/auth/login/code  { challenge, code }  -> second step of the sign-in
exports.loginCode = async (req, res) => {
  need(req.body, ["challenge", "code"]);
  const userId = await checkChallenge(req.body.challenge, "login", req.body.code);
  const [s] = await prisma.$queryRaw`SELECT * FROM fn_session_check(${userId}::int)`;
  if (!s || s.status !== "active") throw new HttpError(403, "This account is disabled. Please contact the market office.");
  await finishLogin(req, res, { id: userId, role: s.role });
};

// POST /api/auth/logout  -> removes the login cookie from this browser
exports.logout = async (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
};

// POST /api/auth/register  { role: "vendor" | "staff", ... }  -> account in "pending" status until an admin approves it.
// Only vendors and inspectors (staff) can register themselves; admin accounts are made by an admin.
exports.register = async (req, res) => {
  const b = req.body;
  const role = b.role ?? "vendor";
  if (!["vendor", "staff"].includes(role)) throw new HttpError(400, "You can only register as a vendor or an inspector.");
  need(b, ["username", "password", "first_name", "last_name", "email",
    ...(role === "vendor" ? ["business_name", "contact_number", "address"] : [])]);
  checkUsername(b.username);
  checkEmail(b.email);
  checkNewPassword(b.password, b.username);
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

// POST /api/auth/forgot  { email }  -> only the email of an ACTIVE account is accepted (anything else: a clear error).
// The email has a 6-digit code AND a link; either one resets the password (once, within 30 minutes).
// Rate limit: 5 tries per IP per 15 minutes (routes/index.js), so the answer cannot be used to test many emails.
exports.forgot = async (req, res) => {
  need(req.body, ["email"]);
  const email = String(req.body.email).trim();
  checkEmail(email);
  const token = crypto.randomBytes(32).toString("base64url");
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const [u] = await prisma.$queryRaw`SELECT * FROM fn_create_password_reset(${email}, ${sha256(token)}, ${codeHash(code)})`;
  if (!u) {
    throw new HttpError(404, "We could not find an account we can send a code to with this email. Check the spelling and use the email you registered with. "
      + "New registrations can reset their password after the market office approves them.");
  }
  const link = `${appUrl(req)}/#reset/${token}`;
  // Wait for the email, so a sending problem is shown instead of a "we sent a code" that never arrives.
  await sendMail({
    category: "Password reset",
    to: u.email,
    subject: `PalengkeLink: your verification code is ${code}`,
    text: `Hi ${u.first_name},\n\nYour verification code is: ${code}\n\nType it on the "Forgot password" page, or open this link to choose a new password:\n${link}\n\nThe code and the link work once, for 30 minutes.\nIf you did not ask for this, you can ignore this email.`,
    html: `<p>Hi ${u.first_name.replace(/[<>&]/g, "")},</p><p>Your verification code is:</p>
      <p style="font-size:30px;font-weight:800;letter-spacing:8px;margin:8px 0 16px">${code}</p>
      <p>Type it on the "Forgot password" page, or click the button to choose a new password.</p>
      <p><a href="${link}" style="background:#1f8a4c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Reset my password</a></p>
      <p style="color:#666;font-size:13px">The code and the link work once, for 30 minutes. If you did not ask for this, you can ignore this email.</p>`,
  }).catch(async (e) => {
    console.error("Could not send the reset email:", e.message);
    // Nobody received this code / link, so it must not stay usable in the database
    await prisma.$executeRaw`SELECT fn_cancel_password_reset(${sha256(token)})`.catch(() => {});
    throw new HttpError(502, "We could not send the email right now. Please try again later, or ask the market office for help.");
  });
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
exports.me = async (req, res) => {
  const [user, [{ is_on }]] = await Promise.all([me(req.user), prisma.$queryRaw`SELECT fn_two_factor_on(${req.user.id}::int) AS is_on`]);
  res.json({ ...user, two_factor: is_on });
};

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
  setSession(req, res, req.user, version);
  res.json({ ok: true });
};

// POST /api/me/logout-everywhere  -> every device is signed out (also this one)
exports.logoutEverywhere = async (req, res) => {
  await asUser(req.user, (tx) => tx.$queryRaw`SELECT fn_logout_everywhere() AS v`);
  clearSession(req, res);
  res.json({ ok: true });
};

// POST /api/me/two-step/start  -> emails a code; turning two-step sign-in on needs it, so we know the email works
exports.twoStepStart = async (req, res) => res.json(await startChallenge(req.user.id, "enable"));

// POST /api/me/two-step/enable  { challenge, code }
exports.twoStepEnable = async (req, res) => {
  need(req.body, ["challenge", "code"]);
  const userId = await checkChallenge(req.body.challenge, "enable", req.body.code);
  if (userId !== req.user.id) throw new HttpError(400, "This code is for another account.");
  await prisma.$executeRaw`SELECT fn_set_two_factor(${req.user.id}::int, true, ${req.user.id}::int)`;
  res.json({ ok: true });
};

// POST /api/me/two-step/disable  { password }  -> the password is asked again, so a forgotten open laptop is not enough
exports.twoStepDisable = async (req, res) => {
  need(req.body, ["password"]);
  const { username } = await me(req.user);
  if (!(await findWithPassword(username, req.body.password))) throw new HttpError(400, "Your password is wrong.");
  await prisma.$executeRaw`SELECT fn_set_two_factor(${req.user.id}::int, false, ${req.user.id}::int)`;
  res.json({ ok: true });
};
