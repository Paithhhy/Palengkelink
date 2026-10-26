-- PalengkeLink | 015 | Username rule + clean-up when an email cannot be sent.
-- Run AFTER 014, as the owner, in the Neon SQL Editor. Safe to run on any data: it never fails because of
-- existing usernames, it lists the ones that need a manual fix instead (see the NOTICE messages).
-- Neon SQL Editor note: no semicolons inside comments or text in this file (the editor splits on them).
-- Safe to run more than once (an earlier version already added the username rule: it is replaced, not added twice).
BEGIN;

-- ---------- 1) Usernames: 3-40 letters, numbers, dots, dashes, underscores ----------
-- An invisible line break at the end of a username (added by editing the table by hand) made sign-in impossible,
-- because the website trims what people type.

-- a) Trim spaces / tabs / line breaks at the start or end, but only when that does not clash with another
--    username (e.g. 'ramos' and 'ramos\n' both existing). Clashes are left alone and listed below.
UPDATE users u SET username = btrim(u.username, E' \t\r\n')
 WHERE u.username <> btrim(u.username, E' \t\r\n')
   AND NOT EXISTS (SELECT 1 FROM users o WHERE o.user_id <> u.user_id
                     AND lower(o.username) = lower(btrim(u.username, E' \t\r\n')));

-- b) The rule. NOT VALID = checked for every new or changed username from now on, without failing on old rows.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_format;
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9._-]{3,40}$') NOT VALID;

-- c) Old rows: if all follow the rule, mark the rule fully valid, otherwise list the ones to fix by hand
--    (Accounts page cannot rename, so: UPDATE users SET username = 'new_name' WHERE user_id = <id>)
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('user_id %s: %L', user_id, username), ' | ' ORDER BY user_id) INTO bad
    FROM users WHERE username !~ '^[A-Za-z0-9._-]{3,40}$';
  IF bad IS NULL THEN
    ALTER TABLE users VALIDATE CONSTRAINT users_username_format;
    RAISE NOTICE 'All usernames follow the rule.';
  ELSE
    RAISE NOTICE 'These usernames break the rule. Rename them, then run ALTER TABLE users VALIDATE CONSTRAINT users_username_format -> %', bad;
  END IF;
END $$;

-- ---------- 2) An email could not be sent: remove the code that was never delivered ----------
-- Otherwise a working reset code / sign-in code would stay in the database although nobody received it.
CREATE OR REPLACE FUNCTION fn_cancel_password_reset(p_token_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM password_resets WHERE token_hash = p_token_hash AND used_at IS NULL
$$;

CREATE OR REPLACE FUNCTION fn_cancel_login_challenge(p_challenge_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM login_challenges WHERE challenge_hash = p_challenge_hash
$$;

REVOKE EXECUTE ON FUNCTION fn_cancel_password_reset(text), fn_cancel_login_challenge(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_cancel_password_reset(text), fn_cancel_login_challenge(text) TO palengkelink_app;

COMMIT;
