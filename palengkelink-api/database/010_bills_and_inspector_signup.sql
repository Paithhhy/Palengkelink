-- PalengkeLink | 010 | Editable bills, cash payments of any amount, inspectors can register themselves.
-- Run AFTER 009, as the owner, in the Neon SQL Editor.
BEGIN;

-- ---------- 1) Cash of any amount: a vendor may pay more than the balance (e.g. advance / no change) ----------
-- Drop the unnamed CHECK (amount_paid <= amount_due) whatever name PostgreSQL gave it.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'rental_payments'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%amount_paid <= amount_due%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE rental_payments DROP CONSTRAINT %I', c); END IF;
END $$;

-- Any positive amount is accepted; the status trigger still decides unpaid / partial / paid.
CREATE OR REPLACE PROCEDURE sp_record_cash_payment(p_payment_id int, p_amount numeric, p_received_by int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r rental_payments%ROWTYPE;
BEGIN
  SELECT * INTO r FROM rental_payments WHERE payment_id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment % not found', p_payment_id; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'The amount must be more than zero.'; END IF;
  UPDATE rental_payments
     SET amount_paid = amount_paid + p_amount, payment_method = 'cash', received_by = p_received_by
   WHERE payment_id = p_payment_id;
END $$;

-- ---------- 2) Inspectors register themselves (account starts "pending" until the admin approves) ----------
CREATE FUNCTION fn_register_staff(p_username text, p_hash text, p_first text, p_last text, p_email text) RETURNS int
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
  VALUES (trim(p_username), p_hash, trim(p_first), trim(p_last), lower(trim(p_email)), 'staff', 'pending')
  RETURNING user_id INTO v_user;
  RETURN v_user;
END $$;

REVOKE EXECUTE ON FUNCTION fn_register_staff(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_register_staff(text,text,text,text,text) TO palengkelink_app;

COMMIT;
