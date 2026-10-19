// Rental payments: monthly billing, cash payments, PayMongo online payments.
const { asUser } = require("../db");
const { HttpError, need, intParam } = require("../errors");
const paymongo = require("../paymongo");

const run = (req, work) => asUser(req.user, work);

// Admin: all payments
exports.listPayments = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT p.payment_id, v.business_name, st.stall_number, p.billing_month, p.amount_due, p.amount_paid, p.payment_method, p.status
      FROM rental_payments p
      JOIN stall_assignments a USING (assignment_id) JOIN vendors v USING (vendor_id) JOIN stalls st USING (stall_id)
     ORDER BY p.billing_month DESC, p.payment_id DESC`));

// Admin: create this month's bills. Body: { month: "2026-11-01" }
exports.generateBalances = async (req, res) => {
  need(req.body, ["month"]);
  const [row] = await run(req, (tx) => tx.$queryRaw`SELECT fn_generate_monthly_balances(${req.body.month}::date) AS created`);
  res.json(row);
};

// Admin: cash paid at the office. Body: { amount: 1500 }
exports.recordCash = async (req, res) => {
  need(req.body, ["amount"]);
  await run(req, (tx) => tx.$executeRaw`CALL sp_record_cash_payment(${intParam(req.params.id)}::int, ${Number(req.body.amount)}::numeric, ${req.user.id}::int)`);
  res.json({ ok: true });
};

// Vendor: "Pay online" -> returns the PayMongo page to redirect to.
exports.startCheckout = async (req, res) => {
  const id = intParam(req.params.id);
  // 1) read my own bill through the vendor view (another vendor's bill simply does not exist for me)
  const [bill] = await run(req, (tx) => tx.$queryRaw`SELECT payment_id, stall_number, billing_month, balance, status FROM v_my_payments WHERE payment_id = ${id}::int`);
  if (!bill) throw new HttpError(404, "Payment not found.");
  if (bill.status === "paid") throw new HttpError(409, "Already paid.");
  // 2) ask PayMongo for a checkout page
  const centavos = Math.round(Number(bill.balance) * 100);
  const session = await paymongo.createCheckoutSession({ amountCentavos: centavos, name: `Stall ${bill.stall_number} rent`, referenceNumber: String(id) });
  // 3) save the session id in the database (the function re-checks ownership and the amount)
  const [saved] = await run(req, (tx) => tx.$queryRaw`SELECT fn_start_paymongo_checkout(${id}::int, ${session.id}::text) AS centavos`);
  if (Number(saved.centavos) !== centavos) throw new HttpError(409, "Balance changed, please try again.");
  res.json({ checkoutUrl: session.checkoutUrl });
};

// PayMongo -> us: POST /api/webhooks/paymongo (raw body, signature checked FIRST)
exports.webhook = async (req, res) => {
  if (!paymongo.verifyWebhook(req.body, req.headers["paymongo-signature"], process.env.PAYMONGO_WEBHOOK_SECRET)) {
    throw new HttpError(401, "Bad signature.");
  }
  const event = JSON.parse(req.body.toString("utf8")).data.attributes;
  if (event.type !== "checkout_session.payment.paid") return res.json({ ignored: event.type });

  const session = event.data;                                  // the checkout session
  const payment = session.attributes.payments[0];              // the payment that was made
  const method = payment.attributes.source?.type || session.attributes.payment_method_used || "online";
  // The gateway role may only call this one procedure. It checks the amount, ignores repeats, and marks the bill paid.
  await asUser({ role: "gateway" }, (tx) => tx.$executeRaw`CALL sp_apply_paymongo_payment(
    ${session.id}::text, ${payment.id}::text, ${Number(payment.attributes.amount)}::bigint, ${method}::text)`);
  res.json({ received: true });
};
