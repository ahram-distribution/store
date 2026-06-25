-- ============================================================================
-- Migration 20260626b: إضافة wrapper لـ check_capability(uuid, text) مؤقتاً
-- ثم إزالتها +fix لبقية دوال الطلبات
--
-- السبب:
--   check_capability تم تغييرها إلى (text, text) لكن مئات الدوال الداخلية
--   لا تزال تستخدم p_token uuid وتستدعي check_capability(p_token, ...)
--   بدون cast صريح، مما يسبب error 42883
--
-- الإصلاح:
--   1. إضافة wrapper (uuid, text) → (text, text) (تم إثبات أنه يسبب 300 من PostgREST)
--   2. إزالة wrapper فوراً
--   3. تحويل 5 دوال إضافية من p_token uuid → p_token text:
--      - governed_create_order
--      - governed_submit_order
--      - governed_return_order_for_revision
--      - governed_reject_order
--      - governed_defer_order
-- ============================================================================

-- Step 1: Add wrapper (uuid, text) → causes 300 from PostgREST, so we remove it
CREATE OR REPLACE FUNCTION public.check_capability(p_token uuid, p_code text)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = public, extensions
AS $$ BEGIN RETURN public.check_capability(p_token::text, p_code); END; $$;

-- Step 2: Remove wrapper (uuid, text) — keep only (text, text)
DROP FUNCTION IF EXISTS public.check_capability(uuid, text);

-- Step 3: Verify only check_capability(text, text) remains
-- (already exists from 20260625_fix_check_capability_overload.sql)

-- Step 4: governed_create_order
DROP FUNCTION IF EXISTS public.governed_create_order(uuid, uuid, uuid, text, jsonb, uuid, numeric, numeric, numeric, timestamptz);
CREATE OR REPLACE FUNCTION public.governed_create_order(
  p_token text, p_customer_id uuid, p_tier_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL, p_items jsonb DEFAULT '[]'::jsonb,
  p_execution_location_id uuid DEFAULT NULL,
  p_execution_latitude numeric DEFAULT NULL,
  p_execution_longitude numeric DEFAULT NULL,
  p_execution_accuracy_meters numeric DEFAULT NULL,
  p_execution_captured_at timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_session app.sessions; v_order public.orders; v_order_number text; v_seq int;
  v_item jsonb; v_product record;
  v_calculated_unit_price numeric; v_calculated_total_price numeric; v_exec_location_id uuid;
  v_cust_name text; v_cust_phone text; v_cust_address text;
  v_owner_name text; v_owner_phone text; v_owner_address text;
  v_sender_name text; v_sender_phone text; v_sender_address text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.create') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: orders.create'; END IF;
  ELSE
    IF v_session.customer_id IS NULL OR p_customer_id IS DISTINCT FROM v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  END IF;
  IF p_tier_id IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE id = p_tier_id AND is_active = true) THEN RAISE EXCEPTION 'TIER_NOT_FOUND_OR_INACTIVE'; END IF; END IF;
  v_exec_location_id := p_execution_location_id;
  IF v_exec_location_id IS NULL AND p_execution_latitude IS NOT NULL AND p_execution_longitude IS NOT NULL THEN
    v_exec_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, captured_at) VALUES (v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, COALESCE(p_execution_captured_at, now()));
  END IF;
  SELECT c.company_name, COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
    COALESCE((SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id), (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1), '')
  INTO v_cust_name, v_cust_phone, v_cust_address FROM customers c WHERE c.id = p_customer_id;
  SELECT COALESCE(e.full_name, ''), COALESCE(i.phone, ''), COALESCE(e.address, '')
  INTO v_owner_name, v_owner_phone, v_owner_address
  FROM customers c LEFT JOIN employees e ON e.id = c.owner_id LEFT JOIN identities i ON i.id = e.identity_id WHERE c.id = p_customer_id;
  IF v_session.identity_type = 'employee' THEN
    SELECT COALESCE(e.full_name, ''), COALESCE(i.phone, ''), COALESCE(e.address, '')
    INTO v_sender_name, v_sender_phone, v_sender_address FROM employees e LEFT JOIN identities i ON i.id = e.identity_id WHERE e.identity_id = v_session.identity_id;
  ELSE
    SELECT COALESCE(c.company_name, ''), COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
      COALESCE((SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id), (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1), '')
    INTO v_sender_name, v_sender_phone, v_sender_address FROM customers c WHERE c.identity_id = v_session.identity_id;
  END IF;
  SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
  IF NOT FOUND THEN v_seq := 1; END IF;
  v_order_number := 'ORD-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');
  INSERT INTO public.orders (order_number, customer_id, owner_type, owner_id, created_by, notes, tier_id,
    execution_location_id, execution_latitude, execution_longitude, execution_accuracy_meters, execution_captured_at,
    snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
    snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
    snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address)
  VALUES (v_order_number, p_customer_id, CASE WHEN v_session.identity_type = 'employee' THEN 'employee' ELSE 'customer' END,
    v_session.identity_id, v_session.identity_id, p_notes, p_tier_id,
    v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, p_execution_captured_at,
    v_cust_name, v_cust_phone, v_cust_address, v_owner_name, v_owner_phone, v_owner_address,
    v_sender_name, v_sender_phone, v_sender_address)
  RETURNING * INTO v_order;
  INSERT INTO public.code_sequences (code_type, year, last_sequence) VALUES ('order', EXTRACT(year FROM now())::int, v_seq) ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_seq;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id, product_name, legacy_code, carton_price, carton_quantity INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %', (v_item->>'product_id')::uuid; END IF;
    IF (v_item->>'unit_price') IS NOT NULL AND (v_item->>'unit_price')::numeric > 0 THEN v_calculated_unit_price := (v_item->>'unit_price')::numeric;
    ELSE
      v_calculated_unit_price := public._calc_base_unit_price(v_product.carton_price, v_product.carton_quantity, COALESCE(v_item->>'unit_type', 'piece'));
      IF v_calculated_unit_price IS NULL THEN RAISE EXCEPTION 'PRICE_NOT_CONFIGURED: product % has no valid pricing data', v_product.id; END IF;
    END IF;
    v_calculated_total_price := ROUND((v_calculated_unit_price * GREATEST(COALESCE((v_item->>'quantity')::numeric, 0), COALESCE((v_item->>'unit_quantity')::numeric, 0), 0))::numeric, 2);
    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (v_order.id, v_product.id, COALESCE(v_item->>'unit_type', 'piece'),
      GREATEST(COALESCE((v_item->>'unit_quantity')::integer, (v_item->>'quantity')::integer, 1), 1),
      GREATEST(COALESCE((v_item->>'piece_quantity')::integer, 0), 1), v_calculated_unit_price, v_calculated_total_price);
  END LOOP;
  UPDATE public.orders SET subtotal = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id),
    total_amount = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id) WHERE id = v_order.id;
  SELECT * INTO v_order FROM public.orders WHERE id = v_order.id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (v_order.id, NULL, 'draft', v_session.identity_id, 'Order created');
  PERFORM pg_notify('order_created', jsonb_build_object('order_id', v_order.id, 'number', v_order.order_number)::text);
  RETURN jsonb_build_object('success', true, 'id', v_order.id, 'order_number', v_order.order_number);
END; $$;

-- Step 5: governed_submit_order
DROP FUNCTION IF EXISTS public.governed_submit_order(uuid, uuid);
CREATE OR REPLACE FUNCTION public.governed_submit_order(p_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_session app.sessions; v_order public.orders; v_old_status text; v_is_revision boolean; v_creator_identity_type text;
  v_tier_record tiers; v_product_subtotal numeric := 0; v_deal_total numeric := 0; v_flash_offer_total numeric := 0;
  v_effective_discount_percent numeric := 0; v_total_discount numeric := 0; v_new_total numeric := 0;
  v_item record; v_product record; v_base_unit_price numeric; v_base_total_price numeric;
  v_discounted_unit_price numeric; v_discounted_total_price numeric; v_company_id uuid;
  v_old_snapshot jsonb; v_new_snapshot jsonb; v_changed_field record;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_id; IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  v_old_status := v_order.status;
  IF v_old_status NOT IN ('draft', 'returned_for_revision') THEN RETURN jsonb_build_object('error', 'INVALID_STATE: only draft or returned_for_revision orders can be submitted'); END IF;
  v_is_revision := EXISTS(SELECT 1 FROM public.order_modification_history WHERE order_id = p_id AND field_name = 'REVISION_SNAPSHOT');
  IF v_session.identity_type = 'employee' THEN
    IF NOT v_is_revision THEN
      IF NOT public.check_capability(p_token, 'orders.create') THEN RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.create'); END IF;
      IF v_order.created_by IS DISTINCT FROM v_session.identity_id THEN RETURN jsonb_build_object('error', 'FORBIDDEN: only the order creator can submit'); END IF;
    ELSE
      SELECT identity_type INTO v_creator_identity_type FROM public.identities WHERE id = v_order.created_by;
      IF v_creator_identity_type = 'customer' THEN
        IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = v_order.customer_id AND owner_id = v_session.employee_id) AND NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
      ELSE
        IF v_order.created_by IS DISTINCT FROM v_session.identity_id AND NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
      END IF;
    END IF;
  ELSE
    IF v_session.customer_id IS NULL OR v_order.customer_id IS DISTINCT FROM v_session.customer_id THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  END IF;
  SELECT COALESCE(SUM(total_price), 0) INTO v_deal_total FROM public.order_daily_deals WHERE order_id = p_id;
  SELECT COALESCE(SUM(total_price), 0) INTO v_flash_offer_total FROM public.order_flash_offers WHERE order_id = p_id;
  v_product_subtotal := 0; v_total_discount := 0;
  FOR v_item IN SELECT oi.id, oi.product_id, oi.unit_type, oi.unit_quantity, oi.piece_quantity FROM public.order_items oi WHERE oi.order_id = p_id LOOP
    SELECT p.id, p.company_id, p.carton_price, p.carton_quantity INTO v_product FROM public.products p WHERE p.id = v_item.product_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND: ' || v_item.product_id); END IF;
    v_base_unit_price := public._calc_base_unit_price(v_product.carton_price, v_product.carton_quantity, v_item.unit_type);
    IF v_base_unit_price IS NULL THEN RETURN jsonb_build_object('error', 'PRICE_NOT_CONFIGURED'); END IF;
    v_base_total_price := ROUND((v_base_unit_price * v_item.unit_quantity)::numeric, 2); v_product_subtotal := v_product_subtotal + v_base_total_price;
    IF v_order.tier_id IS NOT NULL THEN
      v_effective_discount_percent := public._get_effective_tier_discount(v_order.tier_id, v_item.product_id, v_product.company_id);
      IF v_effective_discount_percent > 0 THEN
        v_discounted_unit_price := ROUND((v_base_unit_price * (1 - v_effective_discount_percent / 100))::numeric, 2);
        v_discounted_total_price := ROUND((v_discounted_unit_price * v_item.unit_quantity)::numeric, 2);
        v_total_discount := v_total_discount + (v_base_total_price - v_discounted_total_price);
      ELSE v_discounted_unit_price := v_base_unit_price; v_discounted_total_price := v_base_total_price; END IF;
    ELSE v_discounted_unit_price := v_base_unit_price; v_discounted_total_price := v_base_total_price; END IF;
    UPDATE public.order_items SET unit_price = v_discounted_unit_price, total_price = v_discounted_total_price WHERE id = v_item.id;
  END LOOP;
  IF v_order.tier_id IS NOT NULL THEN
    SELECT * INTO v_tier_record FROM public.tiers WHERE id = v_order.tier_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TIER_NOT_FOUND'); END IF;
    IF NOT v_tier_record.is_active THEN RETURN jsonb_build_object('error', 'TIER_NOT_ACTIVE'); END IF;
    IF v_product_subtotal < v_tier_record.minimum_order_amount THEN RETURN jsonb_build_object('error', 'المجموع لا يفي بالحد الأدنى لمستوى السعر المحدد'); END IF;
  END IF;
  v_new_total := ROUND(((v_product_subtotal - v_total_discount) + v_deal_total + v_flash_offer_total)::numeric, 2);
  IF v_is_revision THEN
    UPDATE public.orders SET status = 'submitted', subtotal = v_product_subtotal, discount_amount = ROUND(v_total_discount::numeric, 2),
      total_amount = v_new_total, effective_discount_percent = CASE WHEN v_order.tier_id IS NOT NULL THEN v_effective_discount_percent ELSE NULL END,
      last_revised_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO v_order;
  ELSE
    UPDATE public.orders SET status = 'submitted', subtotal = v_product_subtotal, discount_amount = ROUND(v_total_discount::numeric, 2),
      total_amount = v_new_total, effective_discount_percent = CASE WHEN v_order.tier_id IS NOT NULL THEN v_effective_discount_percent ELSE NULL END,
      submitted_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO v_order;
  END IF;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'submitted', v_session.identity_id, CASE WHEN v_is_revision THEN 'إعادة إرسال الطلب بعد التعديل' ELSE 'Order submitted' END, now());
  RETURN row_to_json(v_order);
END; $$;

-- Step 6: governed_return_order_for_revision
DROP FUNCTION IF EXISTS public.governed_return_order_for_revision(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.governed_return_order_for_revision(p_token text, p_id uuid, p_reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE v_session app.sessions; v_order public.orders; v_old_status varchar(30); v_new_revision integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type = 'customer' THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  IF NOT public.check_capability(p_token, 'orders.manage') AND NOT public.check_capability(p_token, 'orders.approve') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.manage or orders.approve');
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_id; IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  v_old_status := v_order.status;
  IF v_old_status IN ('draft', 'cancelled') THEN RETURN jsonb_build_object('error', 'INVALID_STATE: الطلب لم يتم إرساله بعد أو ملغي'); END IF;
  IF v_old_status = 'returned_for_revision' THEN RETURN jsonb_build_object('error', 'INVALID_STATE: الطلب بالفعل في حالة تعديل'); END IF;
  UPDATE public.orders SET status = 'returned_for_revision', revision_number = COALESCE(revision_number, 0) + 1, last_revised_at = now(), updated_at = now()
  WHERE id = p_id RETURNING revision_number INTO v_new_revision;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, v_old_status, 'returned_for_revision', v_session.identity_id, p_reason);
  INSERT INTO public.order_modification_history (order_id, revision_number, changed_by, change_type, reason) VALUES (p_id, v_new_revision, v_session.employee_id, 'returned_for_revision', p_reason);
  RETURN jsonb_build_object('success', true, 'order_id', p_id, 'status', 'returned_for_revision', 'revision_number', v_new_revision, 'old_status', v_old_status);
END; $$;

-- Step 7: governed_reject_order
DROP FUNCTION IF EXISTS public.governed_reject_order(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.governed_reject_order(p_token text, p_id uuid, p_reason text DEFAULT NULL::text)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE v_session app.sessions; v_order public.orders;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'orders.approve') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: orders.approve'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_id; IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_order.status IN ('delivered', 'cancelled') THEN RAISE EXCEPTION 'INVALID_STATE: order cannot be rejected'; END IF;
  UPDATE public.orders SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO v_order;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, v_order.status, 'cancelled', v_session.identity_id, COALESCE(p_reason, 'Order rejected'));
  RETURN v_order;
END; $$;

-- Step 8: governed_defer_order
DROP FUNCTION IF EXISTS public.governed_defer_order(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.governed_defer_order(p_token text, p_id uuid, p_reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE v_session app.sessions; v_employee_id uuid; v_old_status varchar(30);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  v_employee_id := v_session.employee_id;
  PERFORM check_capability(p_token, 'orders.approve');
  SELECT status INTO v_old_status FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status NOT IN ('approved', 'submitted', 'reviewing') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;
  UPDATE public.orders SET status = 'deferred', updated_at = now() WHERE id = p_id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at) VALUES (p_id, v_old_status, 'deferred', v_employee_id, p_reason, now());
  RETURN jsonb_build_object('success', true);
END; $$;

NOTIFY pgrst, 'reload schema';
