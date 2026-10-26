// Admin / staff features. Every query runs through asUser(), so PostgreSQL decides what is allowed.
const bcrypt = require("bcryptjs");
const { asUser } = require("../db");
const { HttpError, need, intParam, num } = require("../errors");
const { checkNewPassword } = require("./auth");

const run = (req, work) => asUser(req.user, work);
const text = (v) => (v === undefined || v === null ? null : String(v).trim());

// ----- Dashboard -----
exports.dashboard = async (req, res) =>
  res.json((await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_dashboard_stats`))[0]);

// ----- Vendors (admin) -----
exports.listVendors = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT v.vendor_id, v.business_name, v.contact_number, v.address, v.status, v.registration_date,
           u.user_id, u.username, u.first_name, u.last_name, u.email, u.status AS account_status
      FROM vendors v JOIN users u USING (user_id) ORDER BY v.vendor_id`));

exports.createVendor = async (req, res) => {
  const b = req.body;
  need(b, ["username", "password", "first_name", "last_name", "email", "business_name", "contact_number", "address"]);
  checkNewPassword(b.password, b.username);
  const hash = await bcrypt.hash(String(b.password), 10);
  // Two inserts in ONE transaction: either both are saved or neither.
  const vendor = await run(req, async (tx) => {
    const [u] = await tx.$queryRaw`INSERT INTO users (username, password_hash, first_name, last_name, email, role)
      VALUES (${text(b.username)}, ${hash}, ${text(b.first_name)}, ${text(b.last_name)}, ${text(b.email)}, 'vendor') RETURNING user_id`;
    const [v] = await tx.$queryRaw`INSERT INTO vendors (user_id, business_name, contact_number, address)
      VALUES (${u.user_id}, ${text(b.business_name)}, ${text(b.contact_number)}, ${text(b.address)}) RETURNING vendor_id`;
    return v;
  });
  res.status(201).json(vendor);
};

exports.updateVendor = async (req, res) => {
  const b = req.body;
  need(b, ["business_name", "contact_number", "address", "status", "first_name", "last_name", "email"]);
  const id = intParam(req.params.id);
  await run(req, async (tx) => {
    const n = await tx.$executeRaw`UPDATE vendors SET business_name = ${text(b.business_name)}, contact_number = ${text(b.contact_number)},
      address = ${text(b.address)}, status = ${text(b.status)} WHERE vendor_id = ${id}`;
    if (!n) throw new HttpError(404, "Vendor not found.");
    await tx.$executeRaw`UPDATE users SET first_name = ${text(b.first_name)}, last_name = ${text(b.last_name)}, email = ${text(b.email)}
      WHERE user_id = (SELECT user_id FROM vendors WHERE vendor_id = ${id})`;
  });
  res.json({ ok: true });
};

// ----- User accounts (admin): create staff/admin, edit, deactivate, reset password -----
exports.listUsers = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT u.user_id, u.username, u.first_name, u.last_name, u.email, u.role, u.status, u.created_at,
           v.vendor_id, v.business_name, v.contact_number, v.address
      FROM users u LEFT JOIN vendors v ON v.user_id = u.user_id ORDER BY u.user_id`));

exports.createUser = async (req, res) => {
  const b = req.body;
  need(b, ["username", "password", "first_name", "last_name", "email", "role"]);
  if (!["admin", "staff"].includes(b.role)) throw new HttpError(400, "Role must be admin or staff (add vendors on the Vendors page).");
  checkNewPassword(b.password, b.username);
  const hash = await bcrypt.hash(String(b.password), 10);
  const [row] = await run(req, (tx) => tx.$queryRaw`INSERT INTO users (username, password_hash, first_name, last_name, email, role)
    VALUES (${text(b.username)}, ${hash}, ${text(b.first_name)}, ${text(b.last_name)}, ${text(b.email)}, ${b.role}) RETURNING user_id`);
  res.status(201).json(row);
};

exports.updateUser = async (req, res) => {
  const b = req.body;
  need(b, ["first_name", "last_name", "email", "status"]);
  const id = intParam(req.params.id);
  if (id === req.user.id && b.status !== "active") throw new HttpError(400, "You cannot deactivate your own account.");
  if (b.password) checkNewPassword(b.password);
  const hash = b.password ? await bcrypt.hash(String(b.password), 10) : null;   // optional password reset (ends that person's sessions)
  const n = await run(req, (tx) => tx.$executeRaw`UPDATE users SET first_name = ${text(b.first_name)}, last_name = ${text(b.last_name)},
    email = ${text(b.email)}, status = ${text(b.status)}, password_hash = COALESCE(${hash}, password_hash) WHERE user_id = ${id}`);
  if (!n) throw new HttpError(404, "User not found.");
  res.json({ ok: true });
};

// Approve ("active") or decline ("inactive") an online registration, or switch any account on/off.
exports.setUserStatus = async (req, res) => {
  need(req.body, ["status"]);
  const id = intParam(req.params.id);
  if (id === req.user.id) throw new HttpError(400, "You cannot change your own account status.");
  const n = await run(req, (tx) => tx.$executeRaw`UPDATE users SET status = ${text(req.body.status)} WHERE user_id = ${id}`);
  if (!n) throw new HttpError(404, "User not found.");
  res.json({ ok: true });
};

// ----- Stalls -----
exports.listStalls = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT s.stall_id, s.stall_number, s.section, s.stall_type, s.monthly_rent, s.status, v.vendor_id, v.business_name
      FROM stalls s
      LEFT JOIN stall_assignments a ON a.stall_id = s.stall_id AND a.status = 'active'
      LEFT JOIN vendors v ON v.vendor_id = a.vendor_id
     ORDER BY s.stall_number`));

exports.createStall = async (req, res) => {
  const b = req.body;
  need(b, ["stall_number", "section", "monthly_rent"]);
  const [row] = await run(req, (tx) => tx.$queryRaw`INSERT INTO stalls (stall_number, section, monthly_rent)
    VALUES (${text(b.stall_number)}, ${text(b.section)}, ${num(b.monthly_rent, "monthly_rent")}::numeric) RETURNING stall_id`);
  res.status(201).json(row);
};

// Admin edits everything; staff may change section and maintenance status (see 007_features.sql).
// status: "maintenance" or anything else = "in use" (then occupied/vacant follows the active assignment).
exports.updateStall = async (req, res) => {
  const b = req.body;
  const id = intParam(req.params.id);
  need(b, ["section", "status"]);
  const maintenance = b.status === "maintenance";
  await run(req, async (tx) => {
    if (req.user.role === "admin") {
      need(b, ["stall_number", "monthly_rent"]);
      await tx.$executeRaw`UPDATE stalls SET stall_number = ${text(b.stall_number)}, monthly_rent = ${num(b.monthly_rent, "monthly_rent")}::numeric
        WHERE stall_id = ${id}`;
    }
    const n = await tx.$executeRaw`UPDATE stalls SET section = ${text(b.section)},
      status = CASE WHEN ${maintenance} THEN 'maintenance'
                    WHEN EXISTS (SELECT 1 FROM stall_assignments a WHERE a.stall_id = ${id} AND a.status = 'active') THEN 'occupied'
                    ELSE 'vacant' END
      WHERE stall_id = ${id}`;
    if (!n) throw new HttpError(404, "Stall not found.");
  });
  res.json({ ok: true });
};

// Admin: change who rents a stall. Ends the current assignment, then starts the new one (vendor_id empty = make vacant).
// The trigger fn_sync_stall_status keeps the stall's occupied/vacant status right.
exports.setStallVendor = async (req, res) => {
  const id = intParam(req.params.id);
  const vendorId = req.body.vendor_id ? intParam(req.body.vendor_id) : null;
  const start = req.body.start_date || new Date().toISOString().slice(0, 10);
  await run(req, async (tx) => {
    await tx.$executeRaw`UPDATE stall_assignments SET status = 'ended', end_date = GREATEST(CURRENT_DATE, start_date)
      WHERE stall_id = ${id} AND status = 'active'`;
    if (vendorId) await tx.$executeRaw`INSERT INTO stall_assignments (stall_id, vendor_id, start_date) VALUES (${id}, ${vendorId}, ${start}::date)`;
  });
  res.json({ ok: true });
};

// ----- Products & suppliers (admin) -----
exports.listCatalog = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT p.product_id, p.product_name, p.category, p.unit,
           (SELECT count(*) FROM vendor_products vp WHERE vp.product_id = p.product_id)::int AS vendors
      FROM products p ORDER BY p.product_name`));

exports.listVendorProducts = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT v.vendor_id, v.business_name, p.product_name, p.category, vp.selling_price, vp.stock_quantity, vp.status, s.supplier_name
      FROM vendor_products vp JOIN vendors v USING (vendor_id) JOIN products p USING (product_id)
      LEFT JOIN suppliers s USING (supplier_id) ORDER BY v.business_name, p.product_name`));

exports.createProduct = async (req, res) => {
  need(req.body, ["product_name", "category", "unit"]);
  const [row] = await run(req, (tx) => tx.$queryRaw`INSERT INTO products (product_name, category, unit)
    VALUES (${text(req.body.product_name)}, ${text(req.body.category)}, ${text(req.body.unit)}) RETURNING product_id`);
  res.status(201).json(row);
};

exports.updateProduct = async (req, res) => {
  need(req.body, ["product_name", "category", "unit"]);
  const n = await run(req, (tx) => tx.$executeRaw`UPDATE products SET product_name = ${text(req.body.product_name)},
    category = ${text(req.body.category)}, unit = ${text(req.body.unit)} WHERE product_id = ${intParam(req.params.id)}`);
  if (!n) throw new HttpError(404, "Product not found.");
  res.json({ ok: true });
};

exports.listSuppliers = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT s.*, (SELECT count(*) FROM vendor_products vp WHERE vp.supplier_id = s.supplier_id)::int AS products
      FROM suppliers s ORDER BY supplier_id`));

exports.createSupplier = async (req, res) => {
  need(req.body, ["supplier_name", "contact_number", "address"]);
  const [row] = await run(req, (tx) => tx.$queryRaw`INSERT INTO suppliers (supplier_name, contact_number, address)
    VALUES (${text(req.body.supplier_name)}, ${text(req.body.contact_number)}, ${text(req.body.address)}) RETURNING supplier_id`);
  res.status(201).json(row);
};

exports.updateSupplier = async (req, res) => {
  const b = req.body;
  need(b, ["supplier_name", "contact_number", "address", "status"]);
  const n = await run(req, (tx) => tx.$executeRaw`UPDATE suppliers SET supplier_name = ${text(b.supplier_name)},
    contact_number = ${text(b.contact_number)}, address = ${text(b.address)}, status = ${text(b.status)}
    WHERE supplier_id = ${intParam(req.params.id)}`);
  if (!n) throw new HttpError(404, "Supplier not found.");
  res.json({ ok: true });
};

// ----- Supplier suggestions from vendors -----
exports.listSuggestions = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT g.*, v.business_name
      FROM supplier_suggestions g JOIN vendors v USING (vendor_id)
     ORDER BY (g.status = 'pending') DESC, g.suggestion_id DESC`));

// PATCH /suggestions/:id  { status: "approved", supplier_name, contact_number, address, admin_note? }
//                      or { status: "declined", admin_note? }
// Approving adds the supplier and marks the suggestion in ONE transaction: both are saved or neither.
exports.reviewSuggestion = async (req, res) => {
  const b = req.body;
  const id = intParam(req.params.id);
  need(b, ["status"]);
  if (!["approved", "declined"].includes(b.status)) throw new HttpError(400, "Status must be approved or declined.");
  await run(req, async (tx) => {
    let supplierId = null;
    if (b.status === "approved") {
      need(b, ["supplier_name", "contact_number", "address"]);
      [{ supplier_id: supplierId }] = await tx.$queryRaw`INSERT INTO suppliers (supplier_name, contact_number, address)
        VALUES (${text(b.supplier_name)}, ${text(b.contact_number)}, ${text(b.address)}) RETURNING supplier_id`;
    }
    const n = await tx.$executeRaw`UPDATE supplier_suggestions SET status = ${b.status}, admin_note = ${text(b.admin_note) || null},
      supplier_id = ${supplierId}, reviewed_at = now() WHERE suggestion_id = ${id} AND status = 'pending'`;
    if (!n) throw new HttpError(404, "This suggestion was not found or was already reviewed.");
  });
  res.json({ ok: true });
};

// ----- Inspections (inspector = the logged-in staff member) -----
exports.listInspections = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`SELECT * FROM v_inspections ORDER BY inspection_date DESC, inspection_id DESC`));

exports.createInspection = async (req, res) => {
  need(req.body, ["stall_id", "inspection_type", "result"]);
  const [row] = await run(req, (tx) => tx.$queryRaw`INSERT INTO inspections (stall_id, inspector_id, inspection_type, result, remarks)
    VALUES (${intParam(req.body.stall_id)}, ${req.user.id}, ${text(req.body.inspection_type)}, ${text(req.body.result)}, ${text(req.body.remarks) || null})
    RETURNING inspection_id`);
  res.status(201).json(row);
};

exports.updateInspection = async (req, res) => {
  need(req.body, ["inspection_type", "result"]);
  const n = await run(req, (tx) => tx.$executeRaw`UPDATE inspections SET inspection_type = ${text(req.body.inspection_type)},
    result = ${text(req.body.result)}, remarks = ${text(req.body.remarks) || null} WHERE inspection_id = ${intParam(req.params.id)}`);
  if (!n) throw new HttpError(404, "Inspection not found.");
  res.json({ ok: true });
};

// ----- Maintenance requests -----
exports.listRequests = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT m.request_id, st.stall_number, v.vendor_id, v.business_name, m.issue, m.request_date, m.status
      FROM maintenance_requests m JOIN stalls st USING (stall_id) JOIN vendors v USING (vendor_id)
     ORDER BY m.request_id DESC`));

exports.setRequestStatus = async (req, res) => {
  need(req.body, ["status"]);
  const n = await run(req, (tx) => tx.$executeRaw`UPDATE maintenance_requests SET status = ${text(req.body.status)} WHERE request_id = ${intParam(req.params.id)}`);
  if (!n) throw new HttpError(404, "Request not found.");
  res.json({ ok: true });
};

// ----- Activity log (admin only; written only by database triggers) -----
// label = a readable name for the changed record; changed = which columns an UPDATE changed.
// The full old/new JSON is not sent: vendor rows hold base64 pictures that would make the list very heavy.
exports.auditLog = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT l.log_id, l.table_name, l.record_id, l.action, l.logged_at, u.username, u.first_name || ' ' || u.last_name AS actor,
           COALESCE(l.new_value, l.old_value) ->> CASE l.table_name
             WHEN 'users' THEN 'username' WHEN 'vendors' THEN 'business_name' WHEN 'stalls' THEN 'stall_number'
             WHEN 'maintenance_requests' THEN 'issue' WHEN 'inspections' THEN 'inspection_type'
             WHEN 'rental_payments' THEN 'billing_month' WHEN 'supplier_suggestions' THEN 'supplier_name' ELSE '' END AS label,
           (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(l.new_value) AS k
             WHERE l.action = 'UPDATE' AND l.new_value -> k IS DISTINCT FROM l.old_value -> k) AS changed
      FROM audit_logs l LEFT JOIN users u ON u.user_id = l.user_id
     ORDER BY l.log_id DESC LIMIT 200`));
