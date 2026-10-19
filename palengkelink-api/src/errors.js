// Error helpers: turn database errors into clean JSON answers (no crashes, no stack traces for users).
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Express 4 does not catch errors from async handlers, so wrap each one. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Throw 400 if a required field is missing. */
function need(body, fields) {
  const missing = fields.filter((f) => body?.[f] === undefined || body[f] === "");
  if (missing.length) throw new HttpError(400, `Missing: ${missing.join(", ")}`);
}

/** Read a positive whole number from the URL, e.g. /payments/:id */
function intParam(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "Invalid id");
  return n;
}

/** Read a number from the request body, e.g. { amount: 1500 } */
function num(value, name) {
  const n = Number(value);
  if (value === null || value === "" || !Number.isFinite(n)) throw new HttpError(400, `Invalid ${name}`);
  return n;
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "That is too large to upload." });
  if (err.name === "PrismaClientInitializationError" || ["P1000", "P1001", "P1002"].includes(err.errorCode)) {   // wrong DATABASE_URL / password, or database asleep
    console.error(err.message);
    return res.status(503).json({ error: "Cannot reach the database. Check DATABASE_URL in .env." });
  }

  const sqlState = err.meta?.code;                       // Postgres error code, e.g. 23503
  const raw = String(err.meta?.message || err.message || "");
  const text = (raw.match(/ERROR:\s*([^\n]*)/) || [])[1] || "";

  if (sqlState === "P0001") return res.status(400).json({ error: text });   // our RAISE EXCEPTION messages
  if (sqlState === "42501") return res.status(403).json({ error: "You are not allowed to do that." });
  if (sqlState === "23503") return res.status(409).json({ error: "This record is still used by other records (or the related record does not exist)." });
  if (sqlState === "23505") return res.status(409).json({ error: "That record already exists." });
  if (["23502", "23514", "22P02", "22007", "22003"].includes(sqlState)) return res.status(400).json({ error: "Invalid data." });

  console.error(err);                                    // details stay in the server log
  res.status(500).json({ error: "Something went wrong on the server." });
}

module.exports = { HttpError, wrap, need, intParam, num, errorHandler };
