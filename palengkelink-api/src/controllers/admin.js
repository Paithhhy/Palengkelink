// Admin / staff features. Every query runs through asUser(), so PostgreSQL decides what is allowed.
const bcrypt = require("bcryptjs");
const { asUser } = require("../db");
const { need, intParam } = require("../errors");

const run = (req, work) => asUser(req.user, work);

// ----- Dashboard -----
exports.dashboard = async (req, res) =>
  res.json((await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_dashboard_stats`))[0]);

// ----- Vendors -----
exports.listVendors = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`SELECT vendor_id, business_name, contact_number, address, status FROM vendors ORDER BY vendor_id`));

exports.createVendor = async (req, res) => {
  const b = req.body;
  need(b, ["username", "password", "first_name", "last_name", "email", "business_name", "contact_number", "address"]);
  const hash = await bcrypt.hash(String(b.password), 10);
  // Two inserts in ONE transaction: either both are saved or neither.
  const vendor = await run(req, async (tx) => {
    const [u] = await tx.$queryRaw`INSERT INTO users (username, password_hash, first_name, last_name, email, role)
      VALUES (${b.username}, ${hash}, ${b.first_name}, ${b.last_name}, ${b.email}, 'vendor') RETURNING user_id`;
    const [v] = await tx.$queryRaw`INSERT INTO vendors (user_id, business_name, contact_number, address)
      VALUES (${u.user_id}, ${b.business_name}, ${b.contact_number}, ${b.address}) RETURNING vendor_id`;
    return v;
  });
  res.status(201).json(vendor);
};

// ----- Stalls -----
exports.listStalls = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT s.stall_id, s.stall_number, s.section, s.stall_type, s.monthly_rent, s.status, v.business_name
      FROM stalls s
      LEFT JOIN stall_assignments a ON a.stall_id = s.stall_id AND a.status = 'active'
      LEFT JOIN vendors v ON v.vendor_id = a.vendor_id
     ORDER BY s.stall_number`));

exports.setStallStatus = async (req, res) => {
  need(req.body, ["status"]);
  await run(req, (tx) => tx.$executeRaw`UPDATE stalls SET status = ${req.body.status} WHERE stall_id = ${intParam(req.params.id)}`);
  res.json({ ok: true });
};

// Assign a vendor to a stall. The trigger fn_sync_stall_status then marks the stall "occupied".
exports.assignStall = async (req, res) => {
  need(req.body, ["stall_id", "vendor_id", "start_date"]);
  const [row] = await run(req, (tx) => tx.$queryRaw`INSERT INTO stall_assignments (stall_id, vendor_id, start_date)
    VALUES (${intParam(req.body.stall_id)}, ${intParam(req.body.vendor_id)}, ${req.body.start_date}::date) RETURNING assignment_id`);
  res.status(201).json(row);
};

// ----- Products & suppliers -----
exports.listProducts = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT v.business_name, p.product_name, p.category, vp.selling_price, vp.stock_quantity, vp.status, s.supplier_name
      FROM vendor_products vp JOIN vendors v USING (vendor_id) JOIN products p USING (product_id)
      LEFT JOIN suppliers s USING (supplier_id) ORDER BY v.business_name, p.product_name`));

exports.createProduct = async (req, res) => {
  need(req.body, ["product_name", "category", "unit"]);
  const [row] = await run(req, (tx) => tx.$queryRaw`INSERT INTO products (product_name, category, unit)
    VALUES (${req.body.product_name}, ${req.body.category}, ${req.body.unit}) RETURNING product_id`);
  res.status(201).json(row);
};

exports.listSuppliers = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT s.*, (SELECT count(*) FROM vendor_products vp WHERE vp.supplier_id = s.supplier_id)::int AS products
      FROM suppliers s ORDER BY supplier_id`));

exports.createSupplier = async (req, res) => {
  need(req.body, ["supplier_name", "contact_number", "address"]);
  const [row] = await run(req, (tx) => tx.$queryRaw`INSERT INTO suppliers (supplier_name, contact_number, address)
    VALUES (${req.body.supplier_name}, ${req.body.contact_number}, ${req.body.address}) RETURNING supplier_id`);
  res.status(201).json(row);
};

// ----- Inspections (inspector = the logged-in staff member) -----
exports.listInspections = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT i.inspection_id, st.stall_number, i.inspection_date, i.inspection_type, i.result, i.remarks
      FROM inspections i JOIN stalls st USING (stall_id) ORDER BY i.inspection_date DESC, i.inspection_id DESC`));

exports.createInspection = async (req, res) => {
  need(req.body, ["stall_id", "inspection_type", "result"]);
  const [row] = await run(req, (tx) => tx.$queryRaw`INSERT INTO inspections (stall_id, inspector_id, inspection_type, result, remarks)
    VALUES (${intParam(req.body.stall_id)}, ${req.user.id}, ${req.body.inspection_type}, ${req.body.result}, ${req.body.remarks ?? null})
    RETURNING inspection_id`);
  res.status(201).json(row);
};

// ----- Maintenance requests -----
exports.listRequests = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT m.request_id, st.stall_number, v.business_name, m.issue, m.request_date, m.status
      FROM maintenance_requests m JOIN stalls st USING (stall_id) JOIN vendors v USING (vendor_id)
     ORDER BY m.request_id DESC`));

exports.setRequestStatus = async (req, res) => {
  need(req.body, ["status"]);
  await run(req, (tx) => tx.$executeRaw`UPDATE maintenance_requests SET status = ${req.body.status} WHERE request_id = ${intParam(req.params.id)}`);
  res.json({ ok: true });
};

// ----- Audit log (written only by database triggers) -----
exports.auditLog = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`SELECT log_id, user_id, table_name, record_id, action, logged_at FROM audit_logs ORDER BY log_id DESC LIMIT 100`));
