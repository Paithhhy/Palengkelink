// The login lives in a cookie the browser's JavaScript cannot read (HttpOnly), so even an injected script
// cannot steal it. SameSite=Strict + the X-Requested-With check in routes/index.js stop other sites from
// making requests with it (CSRF).
const jwt = require("jsonwebtoken");

const COOKIE = "pl_session";
const HOURS = 8;

/** Login token: { id, role, v } where v = token version (raising it in the database ends every session). */
const signToken = (user, version) =>
  jwt.sign({ id: user.id, role: user.role, v: version }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: `${HOURS}h` });

const cookieOptions = (req) => ({
  httpOnly: true,                 // JavaScript cannot read it
  secure: req.secure,             // HTTPS only on Vercel (trust proxy is on); plain http on localhost
  sameSite: "strict",             // never sent with requests that start on another site
  path: "/api",
});

function setSession(req, res, user, version) {
  res.cookie(COOKIE, signToken(user, version), { ...cookieOptions(req), maxAge: HOURS * 3600 * 1000 });
}

function clearSession(req, res) {
  res.clearCookie(COOKIE, cookieOptions(req));
}

/** The token from the cookie, or "" */
function readToken(req) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

module.exports = { setSession, clearSession, readToken };
