// Vendor self-service. Vendors can only read the v_my_* views and call fn_vendor_* functions,
// so they only ever see and change their own rows.
const { asUser } = require("../db");
const { HttpError, need, intParam, num } = require("../errors");
const { checkName, checkText, checkPhone } = require("../validate");

const run = (req, work) => asUser(req.user, work);
const supplierOf = (body) => (body.supplier_id ? intParam(body.supplier_id) : null);

exports.myStalls = async (req, res) => res.json(await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_my_stalls ORDER BY stall_number`));
exports.myPayments = async (req, res) => res.json(await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_my_payments ORDER BY billing_month DESC, payment_id DESC`));
exports.myProducts = async (req, res) => res.json(await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_my_products ORDER BY product_name`));
exports.myRequests = async (req, res) => res.json(await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_my_requests ORDER BY request_id DESC`));

// ----- Profile -----
exports.myProfile = async (req, res) => {
  const [row] = await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_my_profile`);
  if (!row) throw new HttpError(404, "Vendor profile not found.");
  res.json(row);
};

exports.updateMyProfile = async (req, res) => {
  const b = req.body;
  need(b, ["business_name", "contact_number", "address"]);
  const business = checkName(b.business_name, "Business name"), contact = checkPhone(b.contact_number);
  const address = checkName(b.address, "Address", { max: 255 }), bio = checkText(b.bio, "About your business", { required: false });
  await run(req, (tx) => tx.$executeRaw`SELECT fn_vendor_update_profile(${business}::text,
    ${contact}::text, ${address}::text, ${bio}::text,
    ${String(b.avatar ?? "")}::text, ${String(b.cover ?? "")}::text)`);
  res.json({ ok: true });
};

// ----- Products -----
// Dropdown data for the "Add product" form
exports.catalog = async (req, res) => {
  const [products, suppliers] = await run(req, async (tx) => [
    await tx.$queryRaw`SELECT product_id, product_name, category, unit FROM products ORDER BY product_name`,
    await tx.$queryRaw`SELECT supplier_id, supplier_name FROM suppliers ORDER BY supplier_name`,
  ]);
  res.json({ products, suppliers });
};

// { product_name, category?, unit?, supplier_id?, selling_price, stock_quantity } - a new product name is added to the catalog
exports.addMyProduct = async (req, res) => {
  const b = req.body;
  need(b, ["product_name", "selling_price", "stock_quantity"]);
  // Category and unit are only needed for a product that is not in the catalog yet (checked when given)
  const name = checkName(b.product_name, "Product name");
  const category = String(b.category ?? "").trim() ? checkName(b.category, "Category", { max: 80 }) : "";
  const unit = String(b.unit ?? "").trim() ? checkName(b.unit, "Unit", { max: 30 }) : "";
  const [row] = await run(req, (tx) => tx.$queryRaw`SELECT fn_vendor_add_product_by_name(
    ${name}::text, ${category}::text, ${unit}::text, ${supplierOf(b)}::int,
    ${num(b.selling_price, "selling_price")}::numeric, ${num(b.stock_quantity, "stock_quantity")}::int) AS vendor_product_id`);
  res.status(201).json(row);
};

exports.updateMyProduct = async (req, res) => {
  const b = req.body;
  need(b, ["selling_price", "stock_quantity"]);
  await run(req, (tx) => tx.$executeRaw`SELECT fn_vendor_update_product(${intParam(req.params.id)}::int, ${supplierOf(b)}::int,
    ${num(b.selling_price, "selling_price")}::numeric, ${num(b.stock_quantity, "stock_quantity")}::int)`);
  res.json({ ok: true });
};

exports.deleteMyProduct = async (req, res) => {
  await run(req, (tx) => tx.$executeRaw`SELECT fn_vendor_delete_product(${intParam(req.params.id)}::int)`);
  res.json({ ok: true });
};

// ----- Maintenance requests -----
exports.addMyRequest = async (req, res) => {
  need(req.body, ["stall_id", "issue"]);
  const issue = checkText(req.body.issue, "Problem description");
  const [row] = await run(req, (tx) => tx.$queryRaw`SELECT fn_vendor_submit_request(${intParam(req.body.stall_id)}::int, ${issue}::text) AS request_id`);
  res.status(201).json(row);
};

exports.updateMyRequest = async (req, res) => {
  need(req.body, ["issue"]);
  const issue = checkText(req.body.issue, "Problem description");
  await run(req, (tx) => tx.$executeRaw`SELECT fn_vendor_update_request(${intParam(req.params.id)}::int, ${issue}::text)`);
  res.json({ ok: true });
};

// ----- Supplier suggestions (the admin approves or declines them) -----
exports.mySuggestions = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_my_supplier_suggestions ORDER BY suggestion_id DESC`));

exports.suggestSupplier = async (req, res) => {
  const b = req.body;
  need(b, ["supplier_name"]);
  const name = checkName(b.supplier_name, "Supplier name");
  const contact = String(b.contact_number ?? "").trim() ? checkPhone(b.contact_number) : "";
  const address = String(b.address ?? "").trim() ? checkName(b.address, "Address", { max: 255 }) : "";
  const supplies = checkText(b.supplies, "What they supply", { max: 300, required: false });
  const reason = checkText(b.reason, "Why you suggest them", { max: 500, required: false });
  const [row] = await run(req, (tx) => tx.$queryRaw`SELECT fn_vendor_suggest_supplier(${name}::text,
    ${contact}::text, ${address}::text, ${supplies}::text, ${reason}::text) AS suggestion_id`);
  res.status(201).json(row);
};

exports.withdrawSuggestion = async (req, res) => {
  await run(req, (tx) => tx.$executeRaw`SELECT fn_vendor_withdraw_suggestion(${intParam(req.params.id)}::int)`);
  res.json({ ok: true });
};
