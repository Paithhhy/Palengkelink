-- PalengkeLink | 007 | Vendor profiles, editing for every role, account functions.
-- Run AFTER 001-005, as the owner, in the Neon SQL Editor. Safe on a database that already has data.
BEGIN;

-- ---------- 1) Profile fields (pictures are small JPEG data URLs, resized in the browser) ----------
ALTER TABLE vendors
  ADD COLUMN bio    TEXT CHECK (length(bio) <= 1000),
  ADD COLUMN avatar TEXT CHECK (avatar ~ '^data:image/(jpeg|png|webp);base64,' AND length(avatar) <= 200000),
  ADD COLUMN cover  TEXT CHECK (cover  ~ '^data:image/(jpeg|png|webp);base64,' AND length(cover)  <= 400000);

-- ---------- 2) Public profile views: every logged-in user may see ACTIVE vendors' public info ----------
CREATE VIEW v_vendor_directory AS
  SELECT v.vendor_id, v.business_name, u.first_name || ' ' || u.last_name AS owner_name,
         v.contact_number, v.address, v.bio, v.avatar, v.cover, v.registration_date,
         (SELECT string_agg(s.stall_number, ', ' ORDER BY s.stall_number)
            FROM stall_assignments a JOIN stalls s USING (stall_id)
           WHERE a.vendor_id = v.vendor_id AND a.status = 'active') AS stalls,
         (SELECT count(*) FROM vendor_products vp WHERE vp.vendor_id = v.vendor_id)::int AS products
    FROM vendors v JOIN users u USING (user_id)
   WHERE v.status = 'active';

CREATE VIEW v_vendor_public_products AS
  SELECT vp.vendor_id, vp.vendor_product_id, p.product_name, p.category, p.unit, vp.selling_price, vp.stock_quantity, vp.status
    FROM vendor_products vp JOIN products p USING (product_id) JOIN vendors v USING (vendor_id)
   WHERE v.status = 'active';

CREATE VIEW v_vendor_public_stalls AS
  SELECT a.vendor_id, s.stall_id, s.stall_number, s.section, s.stall_type
    FROM stall_assignments a JOIN stalls s USING (stall_id)
   WHERE a.status = 'active';

-- The vendor's own editable profile
CREATE VIEW v_my_profile WITH (security_barrier = true) AS
  SELECT vendor_id, business_name, contact_number, address, bio, avatar, cover, status
    FROM vendors WHERE vendor_id = fn_current_vendor_id();

-- v_my_products gains the ids the edit form needs (new columns may only be added at the end)
CREATE OR REPLACE VIEW v_my_products WITH (security_barrier = true) AS
  SELECT vp.vendor_product_id, p.product_name, p.category, p.unit, vp.selling_price, vp.stock_quantity, vp.status, sp.supplier_name,
         vp.supplier_id, vp.product_id
    FROM vendor_products vp JOIN products p USING (product_id) LEFT JOIN suppliers sp USING (supplier_id)
   WHERE vp.vendor_id = fn_current_vendor_id();

-- Inspections with the inspector's name (staff cannot read the users table directly)
CREATE VIEW v_inspections AS
  SELECT i.inspection_id, i.stall_id, st.stall_number, i.inspection_date, i.inspection_type, i.result, i.remarks,
         i.inspector_id, u.first_name || ' ' || u.last_name AS inspector
    FROM inspections i JOIN stalls st USING (stall_id) LEFT JOIN users u ON u.user_id = i.inspector_id;

-- ---------- 3) Functions for every logged-in user ----------
CREATE FUNCTION fn_me()
RETURNS TABLE (user_id int, username text, first_name text, last_name text, email text, role text, vendor_id int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.user_id, u.username::text, u.first_name::text, u.last_name::text, u.email::text, u.role::text, v.vendor_id
    FROM users u LEFT JOIN vendors v ON v.user_id = u.user_id
   WHERE u.user_id = NULLIF(current_setting('app.current_user_id', true), '')::int
$$;

-- The API checks the old password first, then calls this with the new bcrypt hash.
CREATE FUNCTION fn_change_my_password(p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE users SET password_hash = p_hash
   WHERE user_id = NULLIF(current_setting('app.current_user_id', true), '')::int;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not logged in'; END IF;
END $$;

-- ---------- 4) Vendor self-service (vendors still have no direct table access) ----------
CREATE FUNCTION fn_vendor_update_profile(p_business_name text, p_contact text, p_address text, p_bio text, p_avatar text, p_cover text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vendor int := fn_current_vendor_id();
BEGIN
  IF v_vendor IS NULL THEN RAISE EXCEPTION 'Not a vendor session'; END IF;
  UPDATE vendors
     SET business_name = p_business_name, contact_number = p_contact, address = p_address,
         bio = NULLIF(p_bio, ''), avatar = NULLIF(p_avatar, ''), cover = NULLIF(p_cover, '')
   WHERE vendor_id = v_vendor;
END $$;

-- Add a product by name; a product that is not in the catalog yet is created (category + unit required).
CREATE FUNCTION fn_vendor_add_product_by_name(p_name text, p_category text, p_unit text, p_supplier_id int, p_price numeric, p_stock int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vendor int := fn_current_vendor_id(); v_product int; v_id int;
BEGIN
  IF v_vendor IS NULL THEN RAISE EXCEPTION 'Not a vendor session'; END IF;
  SELECT product_id INTO v_product FROM products WHERE lower(product_name) = lower(trim(p_name));
  IF NOT FOUND THEN
    IF coalesce(trim(p_category), '') = '' OR coalesce(trim(p_unit), '') = '' THEN
      RAISE EXCEPTION '"%" is a new product: please also enter its category and unit', trim(p_name);
    END IF;
    INSERT INTO products (product_name, category, unit) VALUES (trim(p_name), trim(p_category), trim(p_unit))
      RETURNING product_id INTO v_product;
  END IF;
  IF EXISTS (SELECT 1 FROM vendor_products WHERE vendor_id = v_vendor AND product_id = v_product) THEN
    RAISE EXCEPTION 'You already sell %. Edit it in your list instead.', trim(p_name);
  END IF;
  INSERT INTO vendor_products (vendor_id, product_id, supplier_id, selling_price, stock_quantity)
  VALUES (v_vendor, v_product, p_supplier_id, p_price, p_stock) RETURNING vendor_product_id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION fn_vendor_update_product(p_id int, p_supplier_id int, p_price numeric, p_stock int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE vendor_products SET supplier_id = p_supplier_id, selling_price = p_price, stock_quantity = p_stock
   WHERE vendor_product_id = p_id AND vendor_id = fn_current_vendor_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
END $$;

CREATE FUNCTION fn_vendor_delete_product(p_id int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM vendor_products WHERE vendor_product_id = p_id AND vendor_id = fn_current_vendor_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
END $$;

CREATE FUNCTION fn_vendor_update_request(p_id int, p_issue text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE maintenance_requests SET issue = p_issue
   WHERE request_id = p_id AND vendor_id = fn_current_vendor_id() AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only your own open requests can be edited'; END IF;
END $$;

-- ---------- 5) Permissions ----------
-- Functions are private unless granted below (also fixes databases created with the old 001 line).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON ROUTINES FROM PUBLIC;
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;

GRANT SELECT ON v_vendor_directory, v_vendor_public_products, v_vendor_public_stalls TO app_admin, app_staff, app_vendor;
GRANT SELECT ON v_inspections TO app_admin, app_staff;
GRANT EXECUTE ON FUNCTION fn_me(), fn_change_my_password(text) TO app_admin, app_staff, app_vendor;

-- Staff / inspector may also correct a stall's section and type, and edit inspection records.
GRANT UPDATE (section, stall_type) ON stalls TO app_staff;
GRANT UPDATE (inspection_type, result, remarks) ON inspections TO app_staff;

-- Vendor
GRANT SELECT ON v_my_profile TO app_vendor;
GRANT EXECUTE ON FUNCTION fn_current_vendor_id(),
  fn_vendor_update_profile(text,text,text,text,text,text),
  fn_vendor_add_product_by_name(text,text,text,int,numeric,int),
  fn_vendor_update_product(int,int,numeric,int), fn_vendor_delete_product(int),
  fn_vendor_update_request(int,text) TO app_vendor;

-- Re-grant what 004 granted (REVOKE above only removed PUBLIC, but keep this list complete in one place)
GRANT EXECUTE ON FUNCTION fn_login_lookup(text) TO palengkelink_app;
GRANT EXECUTE ON FUNCTION fn_generate_monthly_balances(date), fn_start_paymongo_checkout(int,text) TO app_admin;
GRANT EXECUTE ON PROCEDURE sp_record_cash_payment(int,numeric,int) TO app_admin;
GRANT EXECUTE ON FUNCTION fn_vendor_add_product(int,int,numeric,int), fn_vendor_submit_request(int,text),
                          fn_start_paymongo_checkout(int,text) TO app_vendor;
GRANT EXECUTE ON PROCEDURE sp_apply_paymongo_payment(text,text,bigint,text) TO app_gateway;

COMMIT;
