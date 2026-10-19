// Register the PayMongo webhook for your deployed site and print its signing secret.
//   npm run paymongo-webhook -- https://YOUR-APP.vercel.app
// Put the printed whsk_... value in PAYMONGO_WEBHOOK_SECRET (in .env and in Vercel's Environment Variables).
// PayMongo has no button for webhooks in its dashboard; they are created through the API like this.
require("dotenv").config();

(async () => {
  const site = (process.argv[2] || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(site)) {
    console.error("Usage: npm run paymongo-webhook -- https://YOUR-APP.vercel.app   (must be https; localhost cannot receive webhooks)");
    process.exit(1);
  }
  const key = process.env.PAYMONGO_SECRET_KEY || "";
  if (!/^sk_(test|live)_/.test(key)) { console.error("Set PAYMONGO_SECRET_KEY in .env first."); process.exit(1); }
  const headers = { accept: "application/json", "content-type": "application/json", authorization: "Basic " + Buffer.from(key + ":").toString("base64") };
  const url = `${site}/api/webhooks/paymongo`;

  const list = await (await fetch("https://api.paymongo.com/v1/webhooks", { headers })).json();
  const existing = (list.data || []).find((w) => w.attributes.url === url);
  if (existing) {
    console.log(`A webhook for ${url} already exists (${existing.id}, ${existing.attributes.status}).`);
    console.log(`Its secret: ${existing.attributes.secret_key}`);
    return;
  }
  const res = await fetch("https://api.paymongo.com/v1/webhooks", {
    method: "POST", headers,
    body: JSON.stringify({ data: { attributes: { url, events: ["checkout_session.payment.paid"] } } }),
  });
  const body = await res.json();
  if (!res.ok) { console.error("PayMongo said:", JSON.stringify(body.errors || body)); process.exit(1); }
  console.log(`Webhook created for ${url}`);
  console.log(`PAYMONGO_WEBHOOK_SECRET="${body.data.attributes.secret_key}"`);
})().catch((e) => { console.error(e.message); process.exit(1); });
