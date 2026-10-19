-- PalengkeLink | 008 | Self-registration (admin approves) + "forgot password" email links.
-- Run AFTER 007, as the owner, in the Neon SQL Editor.
BEGIN;

-- ---------- 1) New account status "pending" = registered online, waiting for the admin ----------
ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active','inactive','pending'));

-- Pending / disabled vendors must not appear in the public directory
CREATE OR REPLACE VIEW v_vendor_directory AS
  SELECT v.vendor_id, v.business_name, u.first_name || ' ' || u.last_name AS owner_name,
         v.contact_number, v.address, v.bio, v.avatar, v.cover, v.registration_date,
         (SELECT string_agg(s.stall_number, ', ' ORDER BY s.stall_number)
            FROM stall_assignments a JOIN stalls s USING (stall_id)
           WHERE a.vendor_id = v.vendor_id AND a.status = 'active') AS stalls,
         (SELECT count(*) FROM vendor_products vp WHERE vp.vendor_id = v.vendor_id)::int AS products
    FROM vendors v JOIN users u USING (user_id)
   WHERE v.status = 'active' AND u.status = 'active';

CREATE OR REPLACE VIEW v_vendor_public_products AS
  SELECT vp.vendor_id, vp.vendor_product_id, p.product_name, p.category, p.unit, vp.selling_price, vp.stock_quantity, vp.status
    FROM vendor_products vp JOIN products p USING (product_id) JOIN vendors v USING (vendor_id) JOIN users u ON u.user_id = v.user_id
   WHERE v.status = 'active' AND u.status = 'active';

-- ---------- 2) Password reset tokens (only a SHA-256 hash of the emailed token is stored) ----------
CREATE TABLE password_resets (
  reset_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX idx_password_resets_user ON password_resets (user_id);

-- ---------- 3) Functions the API calls BEFORE anyone is logged in (as palengkelink_app) ----------
-- Register a vendor. The account starts as "pending"; an admin approves it on the Accounts page.
CREATE FUNCTION fn_register_vendor(p_username text, p_hash text, p_first text, p_last text, p_email text,
                                   p_business text, p_contact text, p_address text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user int;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE lower(username) = lower(trim(p_username))) THEN
    RAISE EXCEPTION 'That username is already taken.';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(trim(p_email))) THEN
    RAISE EXCEPTION 'That email is already registered. Use "Forgot password" if it is yours.';
  END IF;
  INSERT INTO users (username, password_hash, first_name, last_name, email, role, status)
  VALUES (trim(p_username), p_hash, trim(p_first), trim(p_last), lower(trim(p_email)), 'vendor', 'pending')
  RETURNING user_id INTO v_user;
  INSERT INTO vendors (user_id, business_name, contact_number, address)
  VALUES (v_user, trim(p_business), trim(p_contact), trim(p_address));
  RETURN v_user;
END $$;

-- Start a reset: returns the person's name + email, or nothing if no ACTIVE account has that email.
CREATE FUNCTION fn_create_password_reset(p_email text, p_token_hash text)
RETURNS TABLE (first_name text, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u users%ROWTYPE;
BEGIN
  SELECT * INTO u FROM users WHERE lower(users.email) = lower(trim(p_email)) AND status = 'active';
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM password_resets WHERE user_id = u.user_id AND used_at IS NULL;   -- only the newest link works
  INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (u.user_id, p_token_hash, now() + INTERVAL '30 minutes');
  first_name := u.first_name; email := u.email;
  RETURN NEXT;
END $$;

-- Finish a reset: the link works once, for 30 minutes.
CREATE FUNCTION fn_reset_password(p_token_hash text, p_new_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user int;
BEGIN
  UPDATE password_resets SET used_at = now()
   WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
  RETURNING user_id INTO v_user;
  IF v_user IS NULL THEN RAISE EXCEPTION 'This reset link is invalid or has expired. Please request a new one.'; END IF;
  UPDATE users SET password_hash = p_new_hash WHERE user_id = v_user;
END $$;

REVOKE EXECUTE ON FUNCTION fn_register_vendor(text,text,text,text,text,text,text,text),
  fn_create_password_reset(text,text), fn_reset_password(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_register_vendor(text,text,text,text,text,text,text,text),
  fn_create_password_reset(text,text), fn_reset_password(text,text) TO palengkelink_app;

COMMIT;
