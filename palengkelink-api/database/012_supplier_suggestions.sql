-- PalengkeLink | 012 | Vendors suggest suppliers; the admin approves (supplier is added) or declines (with a note).
-- Run AFTER 011, as the owner, in the Neon SQL Editor.
BEGIN;

CREATE TABLE supplier_suggestions (
  suggestion_id  INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_id      INT NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
  supplier_name  VARCHAR(150) NOT NULL CHECK (trim(supplier_name) <> ''),
  contact_number VARCHAR(30),                 -- the vendor may not know these; the admin fills them in when approving
  address        VARCHAR(255),
  supplies       TEXT,                        -- what they sell, e.g. "fresh fish from Navotas"
  reason         TEXT,                        -- why the vendor suggests them
  status         VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  admin_note     TEXT,
  supplier_id    INT REFERENCES suppliers(supplier_id) ON DELETE SET NULL,   -- the supplier created on approval
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at    TIMESTAMPTZ
);
CREATE INDEX idx_supplier_suggestions_vendor ON supplier_suggestions (vendor_id);
CREATE INDEX idx_supplier_suggestions_status ON supplier_suggestions (status);

CREATE TRIGGER trg_audit_suggestions AFTER INSERT OR UPDATE OR DELETE ON supplier_suggestions
  FOR EACH ROW EXECUTE FUNCTION fn_audit('suggestion_id');

-- ---------- Vendor: only their own suggestions ----------
CREATE VIEW v_my_supplier_suggestions WITH (security_barrier = true) AS
  SELECT suggestion_id, supplier_name, contact_number, address, supplies, reason, status, admin_note, created_at, reviewed_at
    FROM supplier_suggestions
   WHERE vendor_id = fn_current_vendor_id();

CREATE FUNCTION fn_vendor_suggest_supplier(p_name text, p_contact text, p_address text, p_supplies text, p_reason text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vendor int := fn_current_vendor_id(); v_id int;
BEGIN
  IF v_vendor IS NULL THEN RAISE EXCEPTION 'Only vendors can suggest suppliers.'; END IF;
  IF EXISTS (SELECT 1 FROM suppliers WHERE lower(supplier_name) = lower(trim(p_name))) THEN
    RAISE EXCEPTION 'That supplier is already in the list. You can pick it when you add or edit a product.';
  END IF;
  IF EXISTS (SELECT 1 FROM supplier_suggestions WHERE vendor_id = v_vendor AND status = 'pending'
                AND lower(supplier_name) = lower(trim(p_name))) THEN
    RAISE EXCEPTION 'You already suggested this supplier. The market office will review it soon.';
  END IF;
  INSERT INTO supplier_suggestions (vendor_id, supplier_name, contact_number, address, supplies, reason)
  VALUES (v_vendor, trim(p_name), NULLIF(trim(p_contact), ''), NULLIF(trim(p_address), ''),
          NULLIF(trim(p_supplies), ''), NULLIF(trim(p_reason), ''))
  RETURNING suggestion_id INTO v_id;
  RETURN v_id;
END $$;

-- A vendor may take back a suggestion while it is still pending.
CREATE FUNCTION fn_vendor_withdraw_suggestion(p_id int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM supplier_suggestions WHERE suggestion_id = p_id AND vendor_id = fn_current_vendor_id() AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only your own pending suggestions can be withdrawn.'; END IF;
END $$;

REVOKE EXECUTE ON FUNCTION fn_vendor_suggest_supplier(text,text,text,text,text), fn_vendor_withdraw_suggestion(int) FROM PUBLIC;
GRANT SELECT ON v_my_supplier_suggestions TO app_vendor;
GRANT EXECUTE ON FUNCTION fn_vendor_suggest_supplier(text,text,text,text,text), fn_vendor_withdraw_suggestion(int) TO app_vendor;

-- ---------- Admin: read every suggestion, approve or decline ----------
GRANT SELECT, UPDATE ON supplier_suggestions TO app_admin;

COMMIT;
