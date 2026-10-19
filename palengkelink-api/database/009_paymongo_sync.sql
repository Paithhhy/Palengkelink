-- PalengkeLink | 009 | Confirm a PayMongo payment when the vendor returns from the checkout page.
-- (Works even where PayMongo's webhook cannot reach the app, e.g. on localhost.) Run AFTER 008, as the owner.
BEGIN;

-- The vendor's own bill -> its PayMongo checkout session id (cs_xxx). Another vendor's bill returns NULL.
CREATE FUNCTION fn_my_checkout_session(p_payment_id int) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.paymongo_checkout_session_id::text
    FROM rental_payments p JOIN stall_assignments a USING (assignment_id)
   WHERE p.payment_id = p_payment_id AND a.vendor_id = fn_current_vendor_id()
$$;

REVOKE EXECUTE ON FUNCTION fn_my_checkout_session(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_my_checkout_session(int) TO app_vendor;

COMMIT;
