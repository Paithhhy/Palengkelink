-- PalengkeLink | 002 | Triggers: audit logging + automatic column updates
BEGIN;

-- 1) Generic audit trigger. The API runs `SELECT set_config('app.current_user_id', '<id>', true)`
--    at the start of each request, so the log knows who acted. Webhooks leave it empty (NULL = system).
CREATE FUNCTION fn_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pk_col text := TG_ARGV[0];
  uid    int  := NULLIF(current_setting('app.current_user_id', true), '')::int;
  rec    jsonb;
BEGIN
  rec := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  INSERT INTO audit_logs (user_id, table_name, record_id, action, old_value, new_value)
  VALUES (uid, TG_TABLE_NAME, (rec ->> pk_col)::int, TG_OP,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'password_hash' END,   -- never log password hashes
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'password_hash' END);
  RETURN NULL;
END $$;

CREATE TRIGGER trg_audit_users        AFTER INSERT OR UPDATE OR DELETE ON users                FOR EACH ROW EXECUTE FUNCTION fn_audit('user_id');
CREATE TRIGGER trg_audit_vendors      AFTER INSERT OR UPDATE OR DELETE ON vendors              FOR EACH ROW EXECUTE FUNCTION fn_audit('vendor_id');
CREATE TRIGGER trg_audit_stalls       AFTER INSERT OR UPDATE OR DELETE ON stalls               FOR EACH ROW EXECUTE FUNCTION fn_audit('stall_id');
CREATE TRIGGER trg_audit_assignments  AFTER INSERT OR UPDATE OR DELETE ON stall_assignments    FOR EACH ROW EXECUTE FUNCTION fn_audit('assignment_id');
CREATE TRIGGER trg_audit_payments     AFTER INSERT OR UPDATE OR DELETE ON rental_payments      FOR EACH ROW EXECUTE FUNCTION fn_audit('payment_id');
CREATE TRIGGER trg_audit_vproducts    AFTER INSERT OR UPDATE OR DELETE ON vendor_products      FOR EACH ROW EXECUTE FUNCTION fn_audit('vendor_product_id');
CREATE TRIGGER trg_audit_inspections  AFTER INSERT OR UPDATE OR DELETE ON inspections          FOR EACH ROW EXECUTE FUNCTION fn_audit('inspection_id');
CREATE TRIGGER trg_audit_requests     AFTER INSERT OR UPDATE OR DELETE ON maintenance_requests FOR EACH ROW EXECUTE FUNCTION fn_audit('request_id');

-- 2) Stall status follows its assignments (occupied while an active assignment exists).
CREATE FUNCTION fn_sync_stall_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stalls
     SET status = CASE WHEN EXISTS (SELECT 1 FROM stall_assignments
                                     WHERE stall_id = NEW.stall_id AND status = 'active')
                       THEN 'occupied' ELSE 'vacant' END
   WHERE stall_id = NEW.stall_id AND status <> 'maintenance';
  RETURN NULL;
END $$;
CREATE TRIGGER trg_sync_stall_status AFTER INSERT OR UPDATE OF status ON stall_assignments
  FOR EACH ROW EXECUTE FUNCTION fn_sync_stall_status();

-- 3) Payment status and date are always derived from the amounts, never typed by hand.
CREATE FUNCTION fn_payment_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.status := CASE WHEN NEW.amount_paid >= NEW.amount_due THEN 'paid'
                     WHEN NEW.amount_paid > 0               THEN 'partial'
                     ELSE 'unpaid' END;
  IF NEW.status = 'paid' AND NEW.payment_date IS NULL THEN NEW.payment_date := CURRENT_DATE; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payment_status BEFORE INSERT OR UPDATE ON rental_payments
  FOR EACH ROW EXECUTE FUNCTION fn_payment_status();

-- 4) Stock level drives availability.
CREATE FUNCTION fn_stock_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.status := CASE WHEN NEW.stock_quantity = 0 THEN 'out_of_stock' ELSE 'available' END;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_stock_status BEFORE INSERT OR UPDATE OF stock_quantity ON vendor_products
  FOR EACH ROW EXECUTE FUNCTION fn_stock_status();

COMMIT;
