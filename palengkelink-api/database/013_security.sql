-- PalengkeLink | 013 | Security: lock accounts after many wrong passwords, end stolen sessions, log sign-ins.
-- Run AFTER 012, as the owner, in the Neon SQL Editor. The website will not let anyone in until this has run.
BEGIN;

-- ---------- 1) Per-account security state (its own table, so failed logins do not flood the audit log) ----------
-- token_version: every login token carries it. Raising it ends every session of that account at once
--                (password changed / reset, "log out of all devices").
CREATE TABLE account_security (
  user_id       INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  token_version INT NOT NULL DEFAULT 0,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ
);
INSERT INTO account_security (user_id) SELECT user_id FROM users;

-- New accounts get a row automatically
CREATE FUNCTION fn_new_account_security() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO account_security (user_id) VALUES (NEW.user_id) ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_new_account_security AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION fn_new_account_security();

-- Any password change (own change, reset by email, admin sets a new one) ends all sessions of that account
-- and lifts a lock. Done by a trigger, so no code path can forget it.
CREATE FUNCTION fn_password_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO account_security (user_id, token_version) VALUES (NEW.user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET token_version = account_security.token_version + 1, failed_logins = 0, locked_until = NULL;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_password_changed AFTER UPDATE OF password_hash ON users
  FOR EACH ROW WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash) EXECUTE FUNCTION fn_password_changed();

-- ---------- 2) Sign-in (called by the API before anyone is logged in, as palengkelink_app) ----------
-- Minutes left on a lock, or 0 when the account may try to sign in.
CREATE FUNCTION fn_login_locked_minutes(p_user_id int) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT ceil(extract(epoch FROM locked_until - now()) / 60)::int
                     FROM account_security WHERE user_id = p_user_id AND locked_until > now()), 0)
$$;

-- Wrong password: count it; the 10th wrong password in a row locks the account for 15 minutes.
-- Sign-in events go into audit_logs (table_name 'logins') so the admin sees them in the Activity log.
CREATE FUNCTION fn_login_failed(p_user_id int) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fails int;
BEGIN
  INSERT INTO account_security (user_id, failed_logins) VALUES (p_user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET failed_logins = account_security.failed_logins + 1
  RETURNING failed_logins INTO v_fails;
  IF v_fails >= 10 THEN
    UPDATE account_security SET locked_until = now() + INTERVAL '15 minutes', failed_logins = 0 WHERE user_id = p_user_id;
    INSERT INTO audit_logs (user_id, table_name, record_id, action) VALUES (p_user_id, 'logins', p_user_id, 'LOCKED');
    RETURN 15;
  END IF;
  INSERT INTO audit_logs (user_id, table_name, record_id, action) VALUES (p_user_id, 'logins', p_user_id, 'LOGIN_FAIL');
  RETURN 0;
END $$;

-- Right password: reset the counter, log it, and return the token version to put in the new token.
CREATE FUNCTION fn_login_succeeded(p_user_id int) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_version int;
BEGIN
  INSERT INTO account_security (user_id, last_login_at) VALUES (p_user_id, now())
  ON CONFLICT (user_id) DO UPDATE SET failed_logins = 0, locked_until = NULL, last_login_at = now()
  RETURNING token_version INTO v_version;
  INSERT INTO audit_logs (user_id, table_name, record_id, action) VALUES (p_user_id, 'logins', p_user_id, 'LOGIN');
  RETURN v_version;
END $$;

-- Every request: is this account still active, what is its role, and is the token's version still valid?
CREATE FUNCTION fn_session_check(p_user_id int) RETURNS TABLE (role text, status text, token_version int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.role::text, u.status::text, COALESCE(s.token_version, 0)
    FROM users u LEFT JOIN account_security s USING (user_id)
   WHERE u.user_id = p_user_id
$$;

REVOKE EXECUTE ON FUNCTION fn_login_locked_minutes(int), fn_login_failed(int), fn_login_succeeded(int), fn_session_check(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_login_locked_minutes(int), fn_login_failed(int), fn_login_succeeded(int), fn_session_check(int) TO palengkelink_app;

-- ---------- 3) "Log out of all devices" (any logged-in user, own account only) ----------
CREATE FUNCTION fn_logout_everywhere() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user int := NULLIF(current_setting('app.current_user_id', true), '')::int; v_version int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not logged in'; END IF;
  INSERT INTO account_security (user_id, token_version) VALUES (v_user, 1)
  ON CONFLICT (user_id) DO UPDATE SET token_version = account_security.token_version + 1
  RETURNING token_version INTO v_version;
  INSERT INTO audit_logs (user_id, table_name, record_id, action) VALUES (v_user, 'logins', v_user, 'LOGOUT_ALL');
  RETURN v_version;
END $$;

-- The current token version of the logged-in user (to give a fresh token after changing the password).
CREATE FUNCTION fn_my_token_version() RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT token_version FROM account_security
                    WHERE user_id = NULLIF(current_setting('app.current_user_id', true), '')::int), 0)
$$;

REVOKE EXECUTE ON FUNCTION fn_logout_everywhere(), fn_my_token_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_logout_everywhere(), fn_my_token_version() TO app_admin, app_staff, app_vendor;

-- ---------- 4) Profile pictures must really be small pictures (blocks links to outside sites and scripts) ----------
CREATE OR REPLACE FUNCTION fn_vendor_update_profile(p_business_name text, p_contact text, p_address text, p_bio text, p_avatar text, p_cover text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vendor int := fn_current_vendor_id();
BEGIN
  IF v_vendor IS NULL THEN RAISE EXCEPTION 'Not a vendor session'; END IF;
  IF NULLIF(p_avatar, '') IS NOT NULL AND (p_avatar !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' OR length(p_avatar) > 200000) THEN
    RAISE EXCEPTION 'The profile picture is not a valid picture.';
  END IF;
  IF NULLIF(p_cover, '') IS NOT NULL AND (p_cover !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' OR length(p_cover) > 400000) THEN
    RAISE EXCEPTION 'The cover photo is not a valid picture.';
  END IF;
  UPDATE vendors
     SET business_name = p_business_name, contact_number = p_contact, address = p_address,
         bio = NULLIF(p_bio, ''), avatar = NULLIF(p_avatar, ''), cover = NULLIF(p_cover, '')
   WHERE vendor_id = v_vendor;
END $$;

COMMIT;
