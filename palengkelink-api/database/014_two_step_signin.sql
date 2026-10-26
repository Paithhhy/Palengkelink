-- PalengkeLink | 014 | Two-step sign-in: after the password, a 6-digit code sent by email (admins, inspectors and vendors).
-- Each person turns it on for their own account (Account -> Security). The admin can turn it off for someone who lost
-- access to their email. Run AFTER 013, as the owner, in the Neon SQL Editor.
BEGIN;

ALTER TABLE account_security ADD COLUMN two_factor BOOLEAN NOT NULL DEFAULT false;

-- One open challenge per sign-in (purpose 'login') or per "turn on" (purpose 'enable').
-- challenge_hash = SHA-256 of the random id the browser holds; code_hash = HMAC of the emailed code.
CREATE TABLE login_challenges (
  challenge_hash CHAR(64) PRIMARY KEY,
  user_id        INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  purpose        VARCHAR(10) NOT NULL CHECK (purpose IN ('login','enable')),
  code_hash      CHAR(64) NOT NULL,
  attempts       INT NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_login_challenges_user ON login_challenges (user_id);

-- Is two-step sign-in on for this account?
CREATE FUNCTION fn_two_factor_on(p_user_id int) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT two_factor FROM account_security WHERE user_id = p_user_id), false)
$$;

-- Start a challenge (only the newest one of that purpose works). Returns the name + email to send the code to.
CREATE FUNCTION fn_create_login_challenge(p_user_id int, p_purpose text, p_challenge_hash text, p_code_hash text)
RETURNS TABLE (first_name text, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM login_challenges WHERE user_id = p_user_id AND (purpose = p_purpose OR expires_at < now());
  INSERT INTO login_challenges (challenge_hash, user_id, purpose, code_hash, expires_at)
  VALUES (p_challenge_hash, p_user_id, p_purpose, p_code_hash, now() + INTERVAL '10 minutes');
  RETURN QUERY SELECT u.first_name::text, u.email::text FROM users u WHERE u.user_id = p_user_id;
END $$;

-- Check a code. result: 'ok' (challenge used up), 'wrong', 'locked' (5th wrong code: start again) or 'expired'.
-- Returns instead of raising an error, so the wrong-try counter is saved.
CREATE FUNCTION fn_check_login_challenge(p_challenge_hash text, p_purpose text, p_code_hash text)
RETURNS TABLE (result text, user_id int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c login_challenges%ROWTYPE;
BEGIN
  SELECT * INTO c FROM login_challenges
   WHERE challenge_hash = p_challenge_hash AND purpose = p_purpose AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN result := 'expired'; RETURN NEXT; RETURN; END IF;
  user_id := c.user_id;
  IF c.code_hash <> p_code_hash THEN
    IF c.attempts + 1 >= 5 THEN
      DELETE FROM login_challenges WHERE challenge_hash = c.challenge_hash;
      result := 'locked';
    ELSE
      UPDATE login_challenges SET attempts = attempts + 1 WHERE challenge_hash = c.challenge_hash;
      result := 'wrong';
    END IF;
    IF p_purpose = 'login' THEN
      INSERT INTO audit_logs (user_id, table_name, record_id, action) VALUES (c.user_id, 'logins', c.user_id, 'CODE_FAIL');
    END IF;
    RETURN NEXT; RETURN;
  END IF;
  DELETE FROM login_challenges WHERE challenge_hash = c.challenge_hash;
  result := 'ok';
  RETURN NEXT;
END $$;

-- Turn two-step sign-in on or off (the API checks who may do it: the person, or an admin turning it off).
CREATE FUNCTION fn_set_two_factor(p_user_id int, p_on boolean, p_by int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO account_security (user_id, two_factor) VALUES (p_user_id, p_on)
  ON CONFLICT (user_id) DO UPDATE SET two_factor = p_on;
  INSERT INTO audit_logs (user_id, table_name, record_id, action)
  VALUES (p_by, 'logins', p_user_id, CASE WHEN p_on THEN '2STEP_ON' ELSE '2STEP_OFF' END);
END $$;

REVOKE EXECUTE ON FUNCTION fn_two_factor_on(int), fn_create_login_challenge(int,text,text,text),
  fn_check_login_challenge(text,text,text), fn_set_two_factor(int,boolean,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_two_factor_on(int), fn_create_login_challenge(int,text,text,text),
  fn_check_login_challenge(text,text,text), fn_set_two_factor(int,boolean,int) TO palengkelink_app;

-- The admin's Accounts list shows who uses two-step sign-in
GRANT SELECT (user_id, two_factor) ON account_security TO app_admin;

COMMIT;
