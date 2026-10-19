// PayMongo helper: create a hosted Checkout Session, read it back, and verify webhook signatures.
const crypto = require("crypto");
const { HttpError } = require("./errors");

const headers = () => ({
  accept: "application/json",
  "content-type": "application/json",
  authorization: "Basic " + Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString("base64"),
});

/** Create a checkout page. amountCentavos: PayMongo uses the smallest unit (PHP 1,500.00 = 150000). */
async function createCheckoutSession({ amountCentavos, name, referenceNumber, appUrl }) {
  const res = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      data: { attributes: {
        line_items: [{ currency: "PHP", amount: amountCentavos, name, quantity: 1 }],
        payment_method_types: (process.env.PAYMONGO_METHODS || "gcash,card").split(","),
        reference_number: referenceNumber,
        description: name,
        success_url: `${appUrl}/?paid=1&pid=${referenceNumber}#payments`,   // pid lets the website confirm this bill on return
        cancel_url: `${appUrl}/?paid=0#payments`,
      } },
    }),
  });
  const body = await res.json();
  if (!res.ok) { console.error("PayMongo error:", JSON.stringify(body)); throw new HttpError(502, "Could not start the online payment."); }
  return { id: body.data.id, checkoutUrl: body.data.attributes.checkout_url };
}

/** Read a checkout session straight from PayMongo (trusted: it comes from PayMongo with our secret key). */
async function getCheckoutSession(id) {
  const res = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(id)}`, { headers: headers() });
  const body = await res.json();
  if (!res.ok) { console.error("PayMongo error:", JSON.stringify(body)); throw new HttpError(502, "Could not check the payment with PayMongo."); }
  return body.data;
}

/**
 * Check that a webhook really came from PayMongo.
 * Header looks like: t=1496734173,te=<test signature>,li=<live signature>
 * Signature = HMAC-SHA256( secret, "<t>.<raw body>" ). Needs the RAW body, not parsed JSON.
 */
function verifyWebhook(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));
  if (!parts.t || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;   // reject old requests (5 min)
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${rawBody.toString("utf8")}`).digest("hex");
  const given = parts.te || parts.li || "";                                              // te = test mode, li = live mode
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

module.exports = { createCheckoutSession, getCheckoutSession, verifyWebhook };
