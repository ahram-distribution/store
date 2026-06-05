-- ============================================================================
-- CUSTOMER DIRECT OWNERSHIP MODEL
-- Actor = Identity, Owner = Employee
-- Created: 2026-06-05
--
-- Changes:
-- 1. ensure_system_customer_owner() helper + الأهرام employee
-- 2. orders.created_by FK → identities(id)
-- 3. order_status_history.changed_by FK → identities(id)
-- 4. order_modification_history.modified_by FK → identities(id)
-- 5. governed_create_order uses v_session.identity_id
-- 6. governed_submit_order uses v_session.identity_id
-- 7. Reporting RPCs JOIN through identities
-- 8. register_customer assigns الأهرام as owner
-- ============================================================================

-- ============================================================================
-- 1. Helper function: ensure_system_customer_owner
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_system_customer_owner()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_employee_id uuid;
  v_identity_id uuid;
BEGIN
  SELECT id INTO v_employee_id FROM employees WHERE code = 'SYS-OWNER' LIMIT 1;
  IF v_employee_id IS NOT NULL THEN
    RETURN v_employee_id;
  END IF;
  v_identity_id := gen_random_uuid();
  v_employee_id := gen_random_uuid();
  INSERT INTO identities (id, phone, password_hash, identity_type, is_active)
  VALUES (v_identity_id, '0000000000', extensions.crypt('000000', extensions.gen_salt('bf')), 'employee', true);
  INSERT INTO employees (id, identity_id, code, full_name, is_active)
  VALUES (v_employee_id, v_identity_id, 'SYS-OWNER', 'الأهرام', true);
  RETURN v_employee_id;
END;
$$;

COMMENT ON FUNCTION public.ensure_system_customer_owner IS 'إرجاع موظف الأهرام (مسؤول العملاء المباشرين). ينشئه إن لم يكن موجوداً.';

-- ============================================================================
-- 2-4. FK changes: orders.*_by → identities(id)
-- ============================================================================

ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_created_by;
ALTER TABLE order_status_history DROP CONSTRAINT IF EXISTS fk_order_status_history_changed_by;
ALTER TABLE order_modification_history DROP CONSTRAINT IF EXISTS fk_order_mod_history_modified_by;

-- Data migration: employees.id → identities.id
UPDATE orders SET created_by = (SELECT identity_id FROM employees WHERE id = orders.created_by)
WHERE created_by IS NOT NULL;
UPDATE order_status_history SET changed_by = (SELECT identity_id FROM employees WHERE id = order_status_history.changed_by)
WHERE changed_by IS NOT NULL;
UPDATE order_modification_history SET modified_by = (SELECT identity_id FROM employees WHERE id = order_modification_history.modified_by)
WHERE modified_by IS NOT NULL;

ALTER TABLE orders ADD CONSTRAINT fk_orders_created_by FOREIGN KEY (created_by) REFERENCES identities(id);
ALTER TABLE order_status_history ADD CONSTRAINT fk_order_status_history_changed_by FOREIGN KEY (changed_by) REFERENCES identities(id);
ALTER TABLE order_modification_history ADD CONSTRAINT fk_order_mod_history_modified_by FOREIGN KEY (modified_by) REFERENCES identities(id);

-- ============================================================================
-- 5. governed_create_order: use v_session.identity_id
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_create_order(
  p_token uuid, p_customer_id uuid,
  p_tier_id uuid DEFAULT NULL, p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]',
  p_execution_location_id uuid DEFAULT NULL,
  p_execution_latitude numeric DEFAULT NULL,
  p_execution_longitude numeric DEFAULT NULL,
  p_execution_accuracy_meters numeric DEFAULT NULL,
  p_execution_captured_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_order_number text;
  v_seq int;
  v_item jsonb;
  v_product record;
  v_calculated_unit_price numeric;
  v_calculated_total_price numeric;
  v_exec_location_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.create') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: orders.create'; END IF;
  ELSE
    IF v_session.customer_id IS NULL OR p_customer_id IS DISTINCT FROM v_session.customer_id THEN
      RAISE EXCEPTION 'FORBIDDEN: customers can only create orders for themselves';
    END IF;
  END IF;
  IF p_tier_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE id = p_tier_id AND is_active = true) THEN
      RAISE EXCEPTION 'TIER_NOT_FOUND_OR_INACTIVE';
    END IF;
  END IF;
  v_exec_location_id := p_execution_location_id;
  IF v_exec_location_id IS NULL AND p_execution_latitude IS NOT NULL AND p_execution_longitude IS NOT NULL THEN
    v_exec_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, captured_at)
    VALUES (v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, COALESCE(p_execution_captured_at, now()));
  END IF;
  SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
  IF NOT FOUND THEN v_seq := 1; END IF;
  v_order_number := 'ORD-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');
  IF v_session.identity_type = 'employee' THEN
    INSERT INTO public.orders (order_number, customer_id, owner_type, owner_id, created_by, notes, tier_id,
      execution_location_id, execution_latitude, execution_longitude, execution_accuracy_meters, execution_captured_at)
    VALUES (v_order_number, p_customer_id, 'employee', v_session.identity_id, v_session.identity_id, p_notes, p_tier_id,
      v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, p_execution_captured_at)
    RETURNING * INTO v_order;
  ELSE
    INSERT INTO public.orders (order_number, customer_id, owner_type, owner_id, created_by, notes, tier_id,
      execution_location_id, execution_latitude, execution_longitude, execution_accuracy_meters, execution_captured_at)
    VALUES (v_order_number, p_customer_id, 'customer', v_session.identity_id, v_session.identity_id, p_notes, p_tier_id,
      v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, p_execution_captured_at)
    RETURNING * INTO v_order;
  END IF;
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('order', EXTRACT(year FROM now())::int, v_seq)
  ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_seq;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, carton_price, carton_quantity INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
    v_calculated_unit_price := public._calc_base_unit_price(v_product.carton_price, v_product.carton_quantity, v_item->>'unit_type');
    IF v_calculated_unit_price IS NULL THEN RAISE EXCEPTION 'PRICE_NOT_CONFIGURED: product % has no valid pricing data', v_product.id; END IF;
    v_calculated_total_price := ROUND((v_calculated_unit_price * (v_item->>'unit_quantity')::integer)::numeric, 2);
    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (v_order.id, (v_item->>'product_id')::uuid, v_item->>'unit_type', (v_item->>'unit_quantity')::integer,
      COALESCE((v_item->>'piece_quantity')::integer, 0), v_calculated_unit_price, v_calculated_total_price);
  END LOOP;
  UPDATE public.orders SET
    subtotal = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id),
    total_amount = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id)
  WHERE id = v_order.id;
  SELECT * INTO v_order FROM public.orders WHERE id = v_order.id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (v_order.id, NULL, 'draft', v_session.identity_id, 'Order created');
  RETURN row_to_json(v_order);
END;
$$;

COMMENT ON FUNCTION public.governed_create_order IS 'إنشاء طلب جديد. يستخدم v_session.identity_id للمُحرر (المُنشئ)';

-- ============================================================================
-- 6. governed_submit_order: use v_session.identity_id
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_submit_order(
  p_token uuid, p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_status text;
  v_tier_record tiers;
  v_product_subtotal numeric := 0;
  v_deal_total numeric := 0;
  v_flash_offer_total numeric := 0;
  v_effective_discount_percent numeric := 0;
  v_total_discount numeric := 0;
  v_new_total numeric := 0;
  v_item record;
  v_product record;
  v_base_unit_price numeric;
  v_base_total_price numeric;
  v_discounted_unit_price numeric;
  v_discounted_total_price numeric;
  v_company_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_order.status != 'draft' THEN RETURN jsonb_build_object('error', 'INVALID_STATE: only draft orders can be submitted'); END IF;
  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.create') THEN RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.create'); END IF;
    IF v_order.created_by IS DISTINCT FROM v_session.identity_id THEN RETURN jsonb_build_object('error', 'FORBIDDEN: only the order creator can submit'); END IF;
  ELSE
    IF v_session.customer_id IS NULL OR v_order.customer_id IS DISTINCT FROM v_session.customer_id THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  END IF;
  SELECT COALESCE(SUM(total_price), 0) INTO v_deal_total FROM public.order_daily_deals WHERE order_id = p_id;
  SELECT COALESCE(SUM(total_price), 0) INTO v_flash_offer_total FROM public.order_flash_offers WHERE order_id = p_id;
  v_product_subtotal := 0; v_total_discount := 0;
  FOR v_item IN SELECT oi.id, oi.product_id, oi.unit_type, oi.unit_quantity, oi.piece_quantity FROM public.order_items oi WHERE oi.order_id = p_id
  LOOP
    SELECT p.id, p.company_id, p.carton_price, p.carton_quantity INTO v_product FROM public.products p WHERE p.id = v_item.product_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND: ' || v_item.product_id); END IF;
    v_base_unit_price := public._calc_base_unit_price(v_product.carton_price, v_product.carton_quantity, v_item.unit_type);
    IF v_base_unit_price IS NULL THEN RETURN jsonb_build_object('error', 'PRICE_NOT_CONFIGURED: product ' || v_item.product_id); END IF;
    v_base_total_price := ROUND((v_base_unit_price * v_item.unit_quantity)::numeric, 2);
    v_product_subtotal := v_product_subtotal + v_base_total_price;
    IF v_order.tier_id IS NOT NULL THEN
      v_effective_discount_percent := public._get_effective_tier_discount(v_order.tier_id, v_item.product_id, v_product.company_id);
      IF v_effective_discount_percent > 0 THEN
        v_discounted_unit_price := ROUND((v_base_unit_price * (1 - v_effective_discount_percent / 100))::numeric, 2);
        v_discounted_total_price := ROUND((v_discounted_unit_price * v_item.unit_quantity)::numeric, 2);
        v_total_discount := v_total_discount + (v_base_total_price - v_discounted_total_price);
      ELSE
        v_discounted_unit_price := v_base_unit_price;
        v_discounted_total_price := v_base_total_price;
      END IF;
    ELSE
      v_discounted_unit_price := v_base_unit_price;
      v_discounted_total_price := v_base_total_price;
    END IF;
    UPDATE public.order_items SET unit_price = v_discounted_unit_price, total_price = v_discounted_total_price WHERE id = v_item.id;
  END LOOP;
  IF v_order.tier_id IS NOT NULL THEN
    SELECT * INTO v_tier_record FROM public.tiers WHERE id = v_order.tier_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TIER_NOT_FOUND'); END IF;
    IF NOT v_tier_record.is_active THEN RETURN jsonb_build_object('error', 'TIER_NOT_ACTIVE'); END IF;
    IF v_product_subtotal < v_tier_record.minimum_order_amount THEN
      RETURN jsonb_build_object('error', 'متبقي لك ' || ROUND((v_tier_record.minimum_order_amount - v_product_subtotal)::numeric, 0) || ' جنيه لتحقيق الحد الأدنى للشريحة المختارة');
    END IF;
  END IF;
  v_new_total := ROUND(((v_product_subtotal - v_total_discount) + v_deal_total + v_flash_offer_total)::numeric, 2);
  v_old_status := v_order.status;
  UPDATE public.orders SET
    status = 'submitted', subtotal = v_product_subtotal, discount_amount = ROUND(v_total_discount::numeric, 2),
    total_amount = v_new_total,
    effective_discount_percent = CASE WHEN v_order.tier_id IS NOT NULL THEN v_effective_discount_percent ELSE NULL END,
    submitted_at = now(), updated_at = now()
  WHERE id = p_id RETURNING * INTO v_order;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_id, v_old_status, 'submitted', v_session.identity_id, 'Order submitted');
  RETURN row_to_json(v_order);
END;
$$;

COMMENT ON FUNCTION public.governed_submit_order IS 'إرسال الطلب. يستخدم v_session.identity_id للمُحرر';

-- ============================================================================
-- 7. Reporting RPCs: JOIN through identities
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_orders(
  p_token uuid, p_search text DEFAULT NULL, p_status varchar DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL, p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'id', o.id, 'order_number', o.order_number,
    'customer_id', o.customer_id, 'customer_name_snapshot', c.company_name,
    'owner_type', o.owner_type, 'owner_id', o.owner_id,
    'status', o.status, 'subtotal', o.subtotal,
    'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
    'notes', o.notes, 'revision_number', o.revision_number,
    'created_by', o.created_by, 'created_by_employee_id', o.created_by,
    'created_by_name_snapshot', COALESCE(e.full_name, cu.company_name),
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
    'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
  ) ORDER BY o.created_at DESC) INTO v_result
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN identities i ON i.id = o.created_by
  LEFT JOIN employees e ON e.identity_id = i.id AND i.identity_type = 'employee'
  LEFT JOIN customers cu ON cu.identity_id = i.id AND i.identity_type = 'customer'
  WHERE (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%' OR c.company_name ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR o.status = p_status)
    AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
    AND (p_created_by IS NULL OR o.created_by = p_created_by)
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to);
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_orders(
  p_token uuid, p_customer_id uuid, p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'id', o.id, 'order_number', o.order_number,
    'status', o.status, 'total_amount', o.total_amount,
    'created_at', o.created_at, 'created_by_name', COALESCE(e.full_name, cu.company_name)
  ) ORDER BY o.created_at DESC) INTO v_result
  FROM orders o
  LEFT JOIN identities i ON i.id = o.created_by
  LEFT JOIN employees e ON e.identity_id = i.id AND i.identity_type = 'employee'
  LEFT JOIN customers cu ON cu.identity_id = i.id AND i.identity_type = 'customer'
  WHERE o.customer_id = p_customer_id
  LIMIT p_limit;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_employee_activity(
  p_token uuid, p_employee_id uuid, p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  WITH orders_activity AS (
    SELECT 'order' as activity_type, o.order_number as ref, o.status, o.total_amount, o.created_at
    FROM orders o WHERE o.created_by = (SELECT identity_id FROM employees WHERE id = p_employee_id)
    ORDER BY o.created_at DESC LIMIT p_limit
  ),
  visits_activity AS (
    SELECT 'visit' as activity_type, v.code as ref, v.status, v.visit_result as status, v.created_at
    FROM visits v WHERE v.employee_id = p_employee_id
    ORDER BY v.created_at DESC LIMIT p_limit
  ),
  collections_activity AS (
    SELECT 'collection' as activity_type, c.code as ref, c.status, c.amount as total_amount, c.created_at
    FROM collections c WHERE c.created_by = p_employee_id
    ORDER BY c.created_at DESC LIMIT p_limit
  ),
  combined AS (SELECT * FROM orders_activity UNION ALL SELECT * FROM visits_activity UNION ALL SELECT * FROM collections_activity)
  SELECT jsonb_agg(jsonb_build_object(
    'activity_type', activity_type, 'ref', ref,
    'status', status, 'total_amount', total_amount, 'created_at', created_at
  ) ORDER BY created_at DESC) INTO v_result FROM combined;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sales_by_rep(
  p_token uuid, p_date_from timestamptz DEFAULT NULL, p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'employee_id', e.id, 'employee_name', e.full_name, 'employee_code', e.code,
    'total_orders', COUNT(o.id), 'total_amount', COALESCE(SUM(o.total_amount), 0),
    'customer_count', COUNT(DISTINCT o.customer_id)
  ) ORDER BY SUM(o.total_amount) DESC NULLS LAST) INTO v_result
  FROM employees e
  JOIN identities i ON i.id = e.identity_id
  JOIN orders o ON o.created_by = i.id
  WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    AND o.status NOT IN ('draft', 'cancelled')
  GROUP BY e.id, e.full_name, e.code;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sales_by_manager(
  p_token uuid, p_date_from timestamptz DEFAULT NULL, p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'manager_id', m.id, 'manager_name', m.full_name,
    'total_orders', COUNT(o.id), 'total_amount', COALESCE(SUM(o.total_amount), 0),
    'rep_count', COUNT(DISTINCT e.id)
  ) ORDER BY SUM(o.total_amount) DESC NULLS LAST) INTO v_result
  FROM employees m
  JOIN employees e ON e.manager_id = m.id
  JOIN identities i ON i.id = e.identity_id
  JOIN orders o ON o.created_by = i.id
  WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    AND o.status NOT IN ('draft', 'cancelled')
  GROUP BY m.id, m.full_name;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 8. register_customer: assign الأهرام as customer owner
-- ============================================================================

CREATE OR REPLACE FUNCTION public.register_customer(
  p_phone varchar, p_password varchar,
  p_company_name varchar, p_responsible_name varchar,
  p_business_type business_type DEFAULT NULL,
  p_latitude numeric DEFAULT NULL, p_longitude numeric DEFAULT NULL,
  p_accuracy_meters numeric DEFAULT NULL,
  p_formatted_address text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_identity_id uuid; v_customer_id uuid; v_owner_id uuid;
  v_location_id uuid; v_session app.sessions; v_code varchar;
BEGIN
  IF p_phone !~ '^01[0-9]{9}$' THEN
    RETURN json_build_object('success', false, 'error', 'رقم الهاتف غير صالح');
  END IF;
  IF p_password !~ '^\d{6}$' THEN
    RETURN json_build_object('success', false, 'error', 'كلمة المرور يجب أن تكون 6 أرقام');
  END IF;
  IF EXISTS (SELECT 1 FROM identities WHERE phone = p_phone) THEN
    RETURN json_build_object('success', false, 'error', 'رقم الهاتف موجود بالفعل');
  END IF;
  v_identity_id := gen_random_uuid();
  v_customer_id := gen_random_uuid();
  v_location_id := gen_random_uuid();
  v_code := 'REG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  WHILE EXISTS (SELECT 1 FROM customers WHERE code = v_code) LOOP
    v_code := 'REG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  END LOOP;
  INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
  VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());
  INSERT INTO identities (id, phone, password_hash, identity_type, is_active)
  VALUES (v_identity_id, p_phone, extensions.crypt(p_password::text, extensions.gen_salt('bf')), 'customer', true);
  -- Assign الأهرام as the customer owner
  v_owner_id := public.ensure_system_customer_owner();
  INSERT INTO customers (id, identity_id, code, company_name, responsible_name, business_type, location_id, owner_type, owner_id, is_active, registered_at)
  VALUES (v_customer_id, v_identity_id, v_code, p_company_name, p_responsible_name, p_business_type, v_location_id, 'employee', v_owner_id, true, now());
  INSERT INTO customer_contacts (customer_id, full_name, phone, is_primary)
  VALUES (v_customer_id, p_responsible_name, p_phone, true);
  INSERT INTO app.sessions (identity_id, customer_id, identity_type)
  VALUES (v_identity_id, v_customer_id, 'customer')
  RETURNING * INTO v_session;
  RETURN json_build_object(
    'success', true, 'token', v_session.token,
    'identity_type', 'customer',
    'customer', json_build_object(
      'id', v_customer_id, 'company_name', p_company_name,
      'code', v_code, 'business_type', p_business_type
    ),
    'expires_at', v_session.expires_at
  );
END;
$$;

COMMENT ON FUNCTION public.register_customer IS 'تسجيل عميل جديد. يتم تعيين الأهرام كمسؤول افتراضي عن العميل.';

-- ============================================================================
-- END OF CUSTOMER DIRECT OWNERSHIP MODEL
-- ============================================================================
