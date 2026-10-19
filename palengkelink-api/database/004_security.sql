-- PalengkeLink | 004 | RBAC + tenant isolation. Run as the owner; the app NEVER connects as owner/root.
-- Per request the API does:  SET LOCAL ROLE app_vendor;  SELECT set_config('app.current_user_id','<id>',true);
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_admin')   THEN CREATE ROLE app_admin   NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_staff')   THEN CREATE ROLE app_staff   NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_vendor')  THEN CREATE ROLE app_vendor  NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_gateway') THEN CREATE ROLE app_gateway NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='palengkelink_app')
    THEN CREATE ROLE palengkelink_app LOGIN NOINHERIT PASSWORD 'palengkelink333'; END IF;
END $$;
GRANT app_admin, app_staff, app_vendor, app_gateway TO palengkelink_app;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;   -- only the GRANTs below may call functions

-- Vendor-isolated views: Vendor A can never see Vendor B's rows.
CREATE VIEW v_my_stalls WITH (security_barrier = true) AS
  SELECT s.stall_id, s.stall_number, s.section, s.stall_type, s.monthly_rent, s.status, a.start_date
    FROM stall_assignments a JOIN stalls s USING (stall_id)
   WHERE a.vendor_id = fn_current_vendor_id() AND a.status = 'active';

CREATE VIEW v_my_payments WITH (security_barrier = true) AS
  SELECT p.payment_id, s.stall_number, p.billing_month, p.amount_due, p.amount_paid,
         p.amount_due - p.amount_paid AS balance, p.payment_date, p.payment_method, p.status
    FROM rental_payments p
    JOIN stall_assignments a USING (assignment_id) JOIN stalls s USING (stall_id)
   WHERE a.vendor_id = fn_current_vendor_id();

CREATE VIEW v_my_products WITH (security_barrier = true) AS
  SELECT vp.vendor_product_id, p.product_name, p.category, p.unit, vp.selling_price, vp.stock_quantity, vp.status, sp.supplier_name
    FROM vendor_products vp JOIN products p USING (product_id) LEFT JOIN suppliers sp USING (supplier_id)
   WHERE vp.vendor_id = fn_current_vendor_id();

CREATE VIEW v_my_requests WITH (security_barrier = true) AS
  SELECT m.request_id, s.stall_number, m.issue, m.request_date, m.status
    FROM maintenance_requests m JOIN stalls s USING (stall_id)
   WHERE m.vendor_id = fn_current_vendor_id();

-- Management views
CREATE VIEW v_unpaid_balances AS
  SELECT v.business_name, s.stall_number, p.billing_month, p.amount_due - p.amount_paid AS balance
    FROM rental_payments p
    JOIN stall_assignments a USING (assignment_id) JOIN vendors v USING (vendor_id) JOIN stalls s USING (stall_id)
   WHERE p.status <> 'paid';

CREATE VIEW v_dashboard_stats AS
  SELECT (SELECT count(*) FROM stalls WHERE status='occupied') AS occupied_stalls,
         (SELECT count(*) FROM stalls WHERE status='vacant')   AS vacant_stalls,
         (SELECT count(*) FROM vendors)                        AS vendors,
         (SELECT coalesce(sum(amount_due - amount_paid),0) FROM rental_payments WHERE status <> 'paid') AS unpaid_rent,
         (SELECT round(100.0 * count(*) FILTER (WHERE result='passed') / nullif(count(*),0)) FROM inspections) AS inspections_passed_pct;

-- Admin: full control of business tables, read-only audit log
GRANT SELECT, INSERT, UPDATE, DELETE ON users, vendors, stalls, stall_assignments, rental_payments,
      products, suppliers, vendor_products, inspections, maintenance_requests TO app_admin;
GRANT SELECT ON audit_logs, v_unpaid_balances, v_dashboard_stats TO app_admin;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_admin, app_staff;
GRANT EXECUTE ON FUNCTION fn_generate_monthly_balances(date), fn_start_paymongo_checkout(int,text) TO app_admin;
GRANT EXECUTE ON PROCEDURE sp_record_cash_payment(int,numeric,int) TO app_admin;

-- Staff / inspector: read vendors & stalls, record inspections, update stall + request status. No payments, no users.
GRANT SELECT ON vendors, stalls, stall_assignments, inspections, maintenance_requests, v_dashboard_stats TO app_staff;
GRANT INSERT ON inspections TO app_staff;
GRANT INSERT, UPDATE (status) ON maintenance_requests TO app_staff;
GRANT UPDATE (status) ON stalls TO app_staff;

-- Vendor: only the isolated views + two self-service functions + PayMongo checkout start
GRANT SELECT ON v_my_stalls, v_my_payments, v_my_products, v_my_requests TO app_vendor;
GRANT EXECUTE ON FUNCTION fn_current_vendor_id() TO app_vendor;   -- the v_my_* views call it with the vendor's rights
GRANT SELECT ON products TO app_vendor;
GRANT SELECT (supplier_id, supplier_name) ON suppliers TO app_vendor;
GRANT EXECUTE ON FUNCTION fn_vendor_add_product(int,int,numeric,int), fn_vendor_submit_request(int,text),
                          fn_start_paymongo_checkout(int,text) TO app_vendor;

-- Gateway (PayMongo webhook): may do exactly one thing
GRANT EXECUTE ON PROCEDURE sp_apply_paymongo_payment(text,text,bigint,text) TO app_gateway;

-- Login lookup for the API's own connection
GRANT EXECUTE ON FUNCTION fn_login_lookup(text) TO palengkelink_app;

COMMIT;
