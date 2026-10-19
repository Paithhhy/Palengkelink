-- PalengkeLink | 003 | Stored functions / procedures (business rules live in the database)
BEGIN;

-- Who is the logged-in vendor? (API sets app.current_user_id for every request.)
CREATE FUNCTION fn_current_vendor_id() RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vendor_id FROM vendors WHERE user_id = NULLIF(current_setting('app.current_user_id', true), '')::int
$$;

-- Login lookup: the API reads credentials through this function only.
CREATE FUNCTION fn_login_lookup(p_username text)
RETURNS TABLE (user_id int, password_hash text, role text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.user_id, u.password_hash::text, u.role::text, u.status::text FROM users u WHERE u.username = p_username
$$;

-- Monthly billing: one unpaid row per active assignment. Safe to run twice (ON CONFLICT DO NOTHING).
CREATE FUNCTION fn_generate_monthly_balances(p_month date) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_month date := date_trunc('month', p_month)::date; v_rows int;
BEGIN
  INSERT INTO rental_payments (assignment_id, billing_month, amount_due)
  SELECT a.assignment_id, v_month, s.monthly_rent
    FROM stall_assignments a JOIN stalls s USING (stall_id)
   WHERE a.status = 'active'
     AND a.start_date <= (v_month + INTERVAL '1 month - 1 day')::date
     AND (a.end_date IS NULL OR a.end_date >= v_month)
  ON CONFLICT (assignment_id, billing_month) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

-- Cash payment taken at the market office. Row lock + one UPDATE = no double payment, trigger sets the status.
CREATE PROCEDURE sp_record_cash_payment(p_payment_id int, p_amount numeric, p_received_by int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r rental_payments%ROWTYPE;
BEGIN
  SELECT * INTO r FROM rental_payments WHERE payment_id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment % not found', p_payment_id; END IF;
  IF p_amount <= 0 OR r.amount_paid + p_amount > r.amount_due THEN
    RAISE EXCEPTION 'Invalid amount % (balance is %)', p_amount, r.amount_due - r.amount_paid;
  END IF;
  UPDATE rental_payments
     SET amount_paid = amount_paid + p_amount, payment_method = 'cash', received_by = p_received_by
   WHERE payment_id = p_payment_id;
END $$;

-- PayMongo step 1: the API created a Checkout Session (cs_xxx) for this balance; remember it.
-- Returns the amount to charge in centavos (PayMongo amounts are in the smallest currency unit).
CREATE FUNCTION fn_start_paymongo_checkout(p_payment_id int, p_session_id text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r rental_payments%ROWTYPE; v_vendor int := fn_current_vendor_id(); v_owner int;
BEGIN
  SELECT * INTO r FROM rental_payments WHERE payment_id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment % not found', p_payment_id; END IF;
  SELECT vendor_id INTO v_owner FROM stall_assignments WHERE assignment_id = r.assignment_id;
  IF v_vendor IS NOT NULL AND v_vendor <> v_owner THEN RAISE EXCEPTION 'Not your payment record'; END IF;
  IF r.status = 'paid' THEN RAISE EXCEPTION 'Payment % is already paid', p_payment_id; END IF;
  UPDATE rental_payments SET paymongo_checkout_session_id = p_session_id WHERE payment_id = p_payment_id;
  RETURN ((r.amount_due - r.amount_paid) * 100)::bigint;
END $$;

-- PayMongo step 2: webhook `checkout_session.payment.paid` -> data.id (cs_xxx), the payment id (pay_xxx), amount, method.
-- Idempotent (webhook retries), amount-checked, and atomic with the audit trigger.
CREATE PROCEDURE sp_apply_paymongo_payment(p_session_id text, p_paymongo_payment_id text, p_amount_centavos bigint, p_method text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r rental_payments%ROWTYPE;
BEGIN
  SELECT * INTO r FROM rental_payments WHERE paymongo_checkout_session_id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown checkout session %', p_session_id; END IF;
  IF r.paymongo_payment_id = p_paymongo_payment_id THEN RETURN; END IF;           -- retry: already applied
  IF r.status = 'paid' THEN RAISE EXCEPTION 'Payment % already settled', r.payment_id; END IF;
  IF p_amount_centavos <> ((r.amount_due - r.amount_paid) * 100)::bigint THEN
    RAISE EXCEPTION 'Amount mismatch for payment %: got % centavos', r.payment_id, p_amount_centavos;
  END IF;
  UPDATE rental_payments
     SET amount_paid = amount_due, payment_method = lower(p_method),
         paymongo_payment_id = p_paymongo_payment_id, reference_number = p_paymongo_payment_id
   WHERE payment_id = r.payment_id;
END $$;

-- Vendor self-service writes (vendors have no direct table access, see 004)
CREATE FUNCTION fn_vendor_add_product(p_product_id int, p_supplier_id int, p_price numeric, p_stock int) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vendor int := fn_current_vendor_id(); v_id int;
BEGIN
  IF v_vendor IS NULL THEN RAISE EXCEPTION 'Not a vendor session'; END IF;
  INSERT INTO vendor_products (vendor_id, product_id, supplier_id, selling_price, stock_quantity)
  VALUES (v_vendor, p_product_id, p_supplier_id, p_price, p_stock) RETURNING vendor_product_id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION fn_vendor_submit_request(p_stall_id int, p_issue text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vendor int := fn_current_vendor_id(); v_id int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stall_assignments WHERE stall_id = p_stall_id AND vendor_id = v_vendor AND status = 'active') THEN
    RAISE EXCEPTION 'You can only report problems on your own stall';
  END IF;
  INSERT INTO maintenance_requests (stall_id, vendor_id, issue) VALUES (p_stall_id, v_vendor, p_issue) RETURNING request_id INTO v_id;
  RETURN v_id;
END $$;

COMMIT;
