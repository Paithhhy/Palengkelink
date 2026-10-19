// Public vendor profiles: every logged-in user (admin, staff, vendor) can browse active vendors.
const { asUser } = require("../db");
const { HttpError, intParam } = require("../errors");

const run = (req, work) => asUser(req.user, work);

// GET /api/directory  (no cover photos here, to keep the list light)
exports.list = async (req, res) =>
  res.json(await run(req, (tx) => tx.$queryRaw`
    SELECT vendor_id, business_name, owner_name, address, bio, avatar, stalls, products
      FROM v_vendor_directory ORDER BY business_name`));

// GET /api/directory/:id  ->  profile + stalls + products
exports.profile = async (req, res) => {
  const id = intParam(req.params.id);
  const [profile, stalls, products] = await run(req, async (tx) => [
    (await tx.$queryRaw`SELECT * FROM v_vendor_directory WHERE vendor_id = ${id}`)[0],
    await tx.$queryRaw`SELECT stall_number, section, stall_type FROM v_vendor_public_stalls WHERE vendor_id = ${id} ORDER BY stall_number`,
    await tx.$queryRaw`SELECT product_name, category, unit, selling_price, stock_quantity, status
      FROM v_vendor_public_products WHERE vendor_id = ${id} ORDER BY product_name`,
  ]);
  if (!profile) throw new HttpError(404, "This vendor profile is not available.");
  res.json({ ...profile, stall_list: stalls, product_list: products });
};
