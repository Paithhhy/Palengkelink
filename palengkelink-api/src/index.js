require("dotenv").config();
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const { wrap, errorHandler, HttpError } = require("./errors");
const payments = require("./controllers/payments");
const routes = require("./routes");

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not set (see .env.example)");

BigInt.prototype.toJSON = function () { return Number(this); };   // lets JSON send database bigint values

const app = express();
app.set("trust proxy", 1);   // behind Vercel's proxy: use the real visitor IP (the login rate limit depends on it)
app.use(helmet({ contentSecurityPolicy: false }));

// PayMongo webhook FIRST: it needs the raw body to check the signature (before express.json touches it).
app.post("/api/webhooks/paymongo", express.raw({ type: "*/*" }), wrap(payments.webhook));

app.use(express.json({ limit: "1mb" }));   // room for a resized profile picture + cover photo
app.use(express.static(path.join(__dirname, "..", "public")));   // the website
app.use("/api", routes);
app.use("/api", (req, res, next) => next(new HttpError(404, "Unknown API address.")));
app.use(errorHandler);

// Vercel runs the exported app itself; locally we start a server.
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`PalengkeLink running on http://localhost:${port}`));
}
module.exports = app;
