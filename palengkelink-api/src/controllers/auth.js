const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma, asUser } = require("../db");
const { HttpError, need } = require("../errors");
const { sendMail } = require("../mailer");

/** Who is logged in: { user_id, username, first_name, last_name, email, role, vendor_id } */
const me = async (user) => (await asUser(user, (tx) => tx.$queryRaw`SELECT * FROM fn_me()`))[0];

/** Look up a user and check the password (the app user may only read credentials through fn_login_lookup). */
async function findWithPassword(username, password) {
  const [u] = await prisma.$queryRaw`SELECT * FROM fn_login_lookup(${String(username).trim()})`;
  return u && (await bcrypt.compare(String(password), u.password_hash)) ? u : null;
}

function checkNewPassword(password) {
  if (String(password ?? "").length < 8) throw new HttpError(400, "The password needs at least 8 characters.");
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const appUrl = (req) => process.env.APP_URL || `${req.protocol}://${req.get("host")}`;

// POST /api/auth/login  { username, password }  ->  { token, user }
exports.login = async (req, res) => {
  need(req.body, ["username", "password"]);
  const u = await findWithPassword(req.body.username, req.body.password);
  if (!u) throw new HttpError(401, "Wrong username or password.");
  // Only tell people about their account status after they proved the password is theirs.
  if (u.status === "pending") throw new HttpError(403, "Your registration is waiting for approval by the market office.");
  if (u.status !== "active") throw new HttpError(403, "This account is disabled. Please contact the market office.");
  const user = { id: u.user_id, role: u.role };
  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, user: await me(user) });
};

// POST /api/auth/register  -> vendor account in "pending" status until an admin approves it
exports.register = async (req, res) => {
  const b = req.body;
  need(b, ["username", "password", "first_name", "last_name", "email", "business_name", "contact_number", "address"]);
  checkNewPassword(b.password);
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(String(b.username).trim())) {
    throw new HttpError(400, "Username: 3-40 letters, numbers, dots, dashes or underscores.");
  }
  if (!/^\S+@\S+\.\S+$/.test(String(b.email).trim())) throw new HttpError(400, "Please enter a valid email address.");
  const hash = await bcrypt.hash(String(b.password), 10);
  await prisma.$queryRaw`SELECT fn_register_vendor(${String(b.username)}, ${hash}, ${String(b.first_name)}, ${String(b.last_name)},
    ${String(b.email)}, ${String(b.business_name)}, ${String(b.contact_number)}, ${String(b.address)}) AS user_id`;
  res.status(201).json({ ok: true });
};

// POST /api/auth/forgot  { email }  -> always the same answer, so nobody can test which emails are registered
exports.forgot = async (req, res) => {
  need(req.body, ["email"]);
  const token = crypto.randomBytes(32).toString("base64url");
  const [u] = await prisma.$queryRaw`SELECT * FROM fn_create_password_reset(${String(req.body.email)}, ${sha256(token)})`;
  if (u) {
    const link = `${appUrl(req)}/#reset/${token}`;
    sendMail({
      to: u.email,
      subject: "PalengkeLink: reset your password",
      text: `Hi ${u.first_name},\n\nOpen this link to choose a new password (it works once, for 30 minutes):\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
      html: `<p>Hi ${u.first_name.replace(/[<>&]/g, "")},</p><p>Click the button to choose a new password. The link works once, for 30 minutes.</p>
        <p><a href="${link}" style="background:#1f8a4c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Reset my password</a></p>
        <p style="color:#666;font-size:13px">If you did not ask for this, you can ignore this email.</p>`,
    }).catch((e) => console.error("Could not send the reset email:", e.message));
  }
  res.json({ ok: true });
};

// POST /api/auth/reset  { token, new_password }
exports.reset = async (req, res) => {
  need(req.body, ["token", "new_password"]);
  checkNewPassword(req.body.new_password);
  const hash = await bcrypt.hash(String(req.body.new_password), 10);
  await prisma.$executeRaw`SELECT fn_reset_password(${sha256(String(req.body.token))}, ${hash})`;
  res.json({ ok: true });
};

// GET /api/me
exports.me = async (req, res) => res.json(await me(req.user));

// PATCH /api/me/password  { current_password, new_password }
exports.changePassword = async (req, res) => {
  need(req.body, ["current_password", "new_password"]);
  checkNewPassword(req.body.new_password);
  const { username } = await me(req.user);
  if (!(await findWithPassword(username, req.body.current_password))) throw new HttpError(400, "Your current password is wrong.");
  const hash = await bcrypt.hash(String(req.body.new_password), 10);
  await asUser(req.user, (tx) => tx.$executeRaw`SELECT fn_change_my_password(${hash}::text)`);
  res.json({ ok: true });
};
