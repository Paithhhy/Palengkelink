// Vendor self-service. Vendors can only read the v_my_* views, so they only ever see their own rows.
const { asUser } = require("../db");
const { need, intParam } = require("../errors");

const run = (req, work) => asUser(req.user, work);

exports.myStalls = async (req, res) => res.json(await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_my_stalls`));
exports.myPayments = async (req, res) => res.json(await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_my_payments ORDER BY billing_month DESC`));
exports.myProducts = async (req, res) => res.json(await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_my_products ORDER BY product_name`));
exports.myRequests = async (req, res) => res.json(await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_my_requests ORDER BY request_id DESC`));

// Dropdown data for the "Add product" form
exports.catalog = async (req, res) => {
  const [products, suppliers] = await run(req, async (tx) => [
    await tx.$queryRaw`SELECT product_id, product_name, category, unit FROM products ORDER BY product_name`,
    await tx.$queryRaw`SELECT supplier_id, supplier_name FROM suppliers ORDER BY supplier_name`,
  ]);
  res.json({ products, suppliers });
};

exports.addMyProduct = async (req, res) => {
  need(req.body, ["product_id", "selling_price", "stock_quantity"]);
  const supplier = req.body.supplier_id ? intParam(req.body.supplier_id) : null;
  const [row] = await run(req, (tx) => tx.$queryRaw`SELECT fn_vendor_add_product(
    ${intParam(req.body.product_id)}::int, ${supplier}::int, ${Number(req.body.selling_price)}::numeric, ${Number(req.body.stock_quantity)}::int) AS vendor_product_id`);
  res.status(201).json(row);
};

exports.addMyRequest = async (req, res) => {
  need(req.body, ["stall_id", "issue"]);
  const [row] = await run(req, (tx) => tx.$queryRaw`SELECT fn_vendor_submit_request(${intParam(req.body.stall_id)}::int, ${String(req.body.issue)}::text) AS request_id`);
  res.status(201).json(row);
};
