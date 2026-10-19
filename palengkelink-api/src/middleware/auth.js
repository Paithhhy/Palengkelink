const jwt = require("jsonwebtoken");
const { HttpError } = require("../errors");

/** Reads "Authorization: Bearer <token>" and puts { id, role } on req.user. */
function requireLogin(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch {
    next(new HttpError(401, "Please log in."));
  }
}

/** Only let the listed roles through, e.g. requireRole("admin", "staff"). */
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, "Your role cannot use this feature."));

module.exports = { requireLogin, requireRole };
