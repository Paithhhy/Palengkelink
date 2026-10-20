-- PalengkeLink | 011 | "Forgot password" also emails a 6-digit code; stalls no longer need a type.
-- Run AFTER 010, as the owner, in the Neon SQL Editor.
BEGIN;

-- ---------- 1) Stall type is no longer used by the website ----------
ALTER TABLE stalls ALTER COLUMN stall_type DROP NOT NULL;

-- ---------- 2) Verification codes: the reset email has a link AND a 6-digit code (either one works, once) ----------
-- Only an HMAC of the code is stored. 5 wrong codes = the code stops working and a new one must be requested.
ALTER TABLE password_resets ADD COLUMN code_hash CHAR(64), ADD COLUMN attempts INT NOT NULL DEFAULT 0;

DROP FUNCTION fn_create_password_reset(text, text);
CREATE FUNCTION fn_create_password_reset(p_email text, p_token_hash text, p_code_hash text)
RETURNS TABLE (first_name text, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u users%ROWTYPE;
BEGIN
  SELECT * INTO u FROM users WHERE lower(users.email) = lower(trim(p_email)) AND status = 'active';
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM password_resets WHERE user_id = u.user_id AND used_at IS NULL;   -- only the newest link / code works
  INSERT INTO password_resets (user_id, token_hash, code_hash, expires_at)
  VALUES (u.user_id, p_token_hash, p_code_hash, now() + INTERVAL '30 minutes');
  first_name := u.first_name; email := u.email;
  RETURN NEXT;
END $$;

-- Finish a reset with the emailed code. Returns 'ok', 'wrong', 'locked' (5th wrong try) or 'expired'.
-- It returns instead of raising an error, so the wrong-try counter is saved.
CREATE FUNCTION fn_reset_password_code(p_email text, p_code_hash text, p_new_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r password_resets%ROWTYPE;
BEGIN
  SELECT pr.* INTO r FROM password_resets pr JOIN users u ON u.user_id = pr.user_id
   WHERE lower(u.email) = lower(trim(p_email)) AND u.status = 'active'
     AND pr.used_at IS NULL AND pr.expires_at > now() AND pr.code_hash IS NOT NULL
   ORDER BY pr.reset_id DESC LIMIT 1
   FOR UPDATE OF pr;
  IF NOT FOUND THEN RETURN 'expired'; END IF;
  IF r.code_hash <> p_code_hash THEN
    UPDATE password_resets SET attempts = attempts + 1, used_at = CASE WHEN attempts + 1 >= 5 THEN now() END
     WHERE reset_id = r.reset_id;
    RETURN CASE WHEN r.attempts + 1 >= 5 THEN 'locked' ELSE 'wrong' END;
  END IF;
  UPDATE password_resets SET used_at = now() WHERE reset_id = r.reset_id;
  UPDATE users SET password_hash = p_new_hash WHERE user_id = r.user_id;
  RETURN 'ok';
END $$;

REVOKE EXECUTE ON FUNCTION fn_create_password_reset(text,text,text), fn_reset_password_code(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_create_password_reset(text,text,text), fn_reset_password_code(text,text,text) TO palengkelink_app;

COMMIT;
