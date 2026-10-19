const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma } = require("../db");
const { HttpError, need } = require("../errors");

// POST /api/auth/login  { username, password }  ->  { token, user }
exports.login = async (req, res) => {
  need(req.body, ["username", "password"]);
  // The app user may only call this one function to read credentials (see 003_procedures.sql).
  const [u] = await prisma.$queryRaw`SELECT * FROM fn_login_lookup(${String(req.body.username)})`;
  const ok = u && u.status === "active" && (await bcrypt.compare(String(req.body.password), u.password_hash));
  if (!ok) throw new HttpError(401, "Wrong username or password.");
  const token = jwt.sign({ id: u.user_id, role: u.role }, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, user: { id: u.user_id, role: u.role } });
};
