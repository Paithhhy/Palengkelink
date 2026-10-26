const jwt = require("jsonwebtoken");
const { prisma } = require("../db");
const { HttpError } = require("../errors");
const { readToken } = require("../session");

/**
 * Reads the login cookie (see session.js) and puts { id, role } on req.user.
 * Besides the signature, every request asks the database (fn_session_check) whether the account is still active and
 * whether the token's version is current. So a stolen token stops working as soon as the password changes, the person
 * uses "Log out of all devices", or the admin disables the account. The role also comes from the database, not the token.
 */
async function requireLogin(req, res, next) {
  const token = readToken(req);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    return next(new HttpError(401, "Please log in."));
  }
  try {
    const [s] = await prisma.$queryRaw`SELECT * FROM fn_session_check(${Number(payload.id)}::int)`;
    if (!s || s.status !== "active" || s.token_version !== Number(payload.v ?? 0)) {
      return next(new HttpError(401, "Your session has ended. Please sign in again."));
    }
    req.user = { id: payload.id, role: s.role };
    next();
  } catch (e) {
    next(e);
  }
}

/** Only let the listed roles through, e.g. requireRole("admin", "staff"). */
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, "Your role cannot use this feature."));

module.exports = { requireLogin, requireRole };
