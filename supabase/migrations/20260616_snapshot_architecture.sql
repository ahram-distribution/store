-- ============================================================================
-- SNAPSHOT ARCHITECTURE v1
-- ============================================================================
-- تخزين نسخة ثابتة من بيانات العميل والمسؤول ومرسل الطلب وقت إنشاء الطلب.
-- جميع الشاشات ورسائل الواتساب وملفات PDF والتقارير تقرأ من Snapshot فقط.
-- ============================================================================

-- ============================================================================
-- 1. Add snapshot columns to orders table
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS snapshot_customer_name text,
  ADD COLUMN IF NOT EXISTS snapshot_customer_phone text,
  ADD COLUMN IF NOT EXISTS snapshot_customer_address text,
  ADD COLUMN IF NOT EXISTS snapshot_owner_name text,
  ADD COLUMN IF NOT EXISTS snapshot_owner_phone text,
  ADD COLUMN IF NOT EXISTS snapshot_owner_address text,
  ADD COLUMN IF NOT EXISTS snapshot_sender_name text,
  ADD COLUMN IF NOT EXISTS snapshot_sender_phone text,
  ADD COLUMN IF NOT EXISTS snapshot_sender_address text;

-- ============================================================================
-- 2. Backfill snapshot for existing orders from live data
-- ============================================================================

UPDATE public.orders o SET
  snapshot_customer_name  = c.company_name,
  snapshot_customer_phone = COALESCE(
    (SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''
  ),
  snapshot_customer_address = COALESCE(
    (SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id), ''
  ),
  snapshot_owner_name    = COALESCE(e_owner.full_name, ''),
  snapshot_owner_phone   = COALESCE(i_owner.phone, ''),
  snapshot_owner_address = COALESCE(e_owner.address, ''),
  snapshot_sender_name   = COALESCE(e_creator.full_name, cu_creator.company_name, ''),
  snapshot_sender_phone  = COALESCE(
    i_creator.phone,
    (SELECT phone FROM customer_contacts WHERE customer_id = cu_creator.id AND is_primary = true LIMIT 1), ''
  ),
  snapshot_sender_address = COALESCE(
    e_creator.address,
    (SELECT formatted_address FROM unified_locations ul WHERE ul.id = cu_creator.location_id), ''
  )
FROM customers c
LEFT JOIN employees e_owner ON e_owner.id = c.owner_id
LEFT JOIN identities i_owner ON i_owner.id = e_owner.identity_id
LEFT JOIN identities i_creator ON i_creator.id = o.created_by
LEFT JOIN employees e_creator ON e_creator.identity_id = i_creator.id AND i_creator.identity_type = 'employee'
LEFT JOIN customers cu_creator ON cu_creator.identity_id = i_creator.id AND i_creator.identity_type = 'customer'
WHERE c.id = o.customer_id
  AND o.snapshot_customer_name IS NULL;

-- ============================================================================
-- 3. Rewrite governed_create_order — capture snapshot at creation time
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

  -- Snapshot variables
  v_cust_name text;
  v_cust_phone text;
  v_cust_address text;
  v_owner_name text;
  v_owner_phone text;
  v_owner_address text;
  v_sender_name text;
  v_sender_phone text;
  v_sender_address text;
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

  -- ── Capture snapshot data BEFORE inserting ──

  -- Customer snapshot
  SELECT
    c.company_name,
    COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
    COALESCE((SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id), '')
  INTO v_cust_name, v_cust_phone, v_cust_address
  FROM customers c
  WHERE c.id = p_customer_id;

  -- Owner snapshot (employee responsible for the customer)
  SELECT
    COALESCE(e.full_name, ''),
    COALESCE(i.phone, ''),
    COALESCE(e.address, '')
  INTO v_owner_name, v_owner_phone, v_owner_address
  FROM customers c
  LEFT JOIN employees e ON e.id = c.owner_id
  LEFT JOIN identities i ON i.id = e.identity_id
  WHERE c.id = p_customer_id;

  -- Sender snapshot (the person creating the order)
  IF v_session.identity_type = 'employee' THEN
    SELECT
      COALESCE(e.full_name, ''),
      COALESCE(i.phone, ''),
      COALESCE(e.address, '')
    INTO v_sender_name, v_sender_phone, v_sender_address
    FROM employees e
    LEFT JOIN identities i ON i.id = e.identity_id
    WHERE e.identity_id = v_session.identity_id;
  ELSE
    SELECT
      COALESCE(c.company_name, ''),
      COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
      COALESCE((SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id), '')
    INTO v_sender_name, v_sender_phone, v_sender_address
    FROM customers c
    WHERE c.identity_id = v_session.identity_id;
  END IF;

  -- Generate order number
  SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
  IF NOT FOUND THEN v_seq := 1; END IF;
  v_order_number := 'ORD-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

  -- Insert order with snapshot
  IF v_session.identity_type = 'employee' THEN
    INSERT INTO public.orders (
      order_number, customer_id, owner_type, owner_id, created_by,
      notes, tier_id,
      execution_location_id, execution_latitude, execution_longitude,
      execution_accuracy_meters, execution_captured_at,
      snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
      snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
      snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address
    ) VALUES (
      v_order_number, p_customer_id, 'employee', v_session.identity_id, v_session.identity_id,
      p_notes, p_tier_id,
      v_exec_location_id, p_execution_latitude, p_execution_longitude,
      p_execution_accuracy_meters, p_execution_captured_at,
      v_cust_name, v_cust_phone, v_cust_address,
      v_owner_name, v_owner_phone, v_owner_address,
      v_sender_name, v_sender_phone, v_sender_address
    )
    RETURNING * INTO v_order;
  ELSE
    INSERT INTO public.orders (
      order_number, customer_id, owner_type, owner_id, created_by,
      notes, tier_id,
      execution_location_id, execution_latitude, execution_longitude,
      execution_accuracy_meters, execution_captured_at,
      snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
      snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
      snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address
    ) VALUES (
      v_order_number, p_customer_id, 'customer', v_session.identity_id, v_session.identity_id,
      p_notes, p_tier_id,
      v_exec_location_id, p_execution_latitude, p_execution_longitude,
      p_execution_accuracy_meters, p_execution_captured_at,
      v_cust_name, v_cust_phone, v_cust_address,
      v_owner_name, v_owner_phone, v_owner_address,
      v_sender_name, v_sender_phone, v_sender_address
    )
    RETURNING * INTO v_order;
  END IF;

  -- Update code sequence
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('order', EXTRACT(year FROM now())::int, v_seq)
  ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_seq;

  -- Insert items
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

  -- Update totals
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

-- ============================================================================
-- 4. Rewrite get_governed_order — return snapshot fields instead of live joins
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_order(
  p_token uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_emp_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  -- Authorization: customer access
  IF v_session.identity_type = 'customer' THEN
    IF v_order.customer_id != v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  ELSE
    v_emp_id := v_session.employee_id;
    IF NOT app.has_capability('customers.read') THEN
      IF NOT EXISTS(SELECT 1 FROM public.orders o
                    JOIN public.customers c ON c.id = o.customer_id
                    WHERE o.id = p_id
                      AND c.owner_id = ANY(app.get_subtree_ids(v_emp_id))) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
  END IF;

  -- Return all order data including snapshot fields
  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'customer_id', v_order.customer_id,

    'customer_name', COALESCE(v_order.snapshot_customer_name, ''),
    'customer_phone', COALESCE(v_order.snapshot_customer_phone, ''),
    'customer_address', COALESCE(v_order.snapshot_customer_address, ''),
    'customer_maps_url', '',

    'owner_type', v_order.owner_type,
    'owner_id', v_order.owner_id,
    'owner_name', COALESCE(v_order.snapshot_owner_name, ''),
    'owner_phone', COALESCE(v_order.snapshot_owner_phone, ''),
    'owner_address', COALESCE(v_order.snapshot_owner_address, ''),

    'status', v_order.status,
    'subtotal', v_order.subtotal,
    'discount_amount', v_order.discount_amount,
    'total_amount', v_order.total_amount,
    'notes', v_order.notes,
    'revision_number', v_order.revision_number,
    'created_by', v_order.created_by,
    'created_by_name', COALESCE(v_order.snapshot_sender_name, ''),
    'created_by_phone', COALESCE(v_order.snapshot_sender_phone, ''),
    'created_by_address', COALESCE(v_order.snapshot_sender_address, ''),
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'approved_at', v_order.approved_at,
    'submitted_at', v_order.submitted_at,
    'execution_latitude', v_order.execution_latitude,
    'execution_longitude', v_order.execution_longitude,
    'execution_accuracy_meters', v_order.execution_accuracy_meters,
    'execution_captured_at', v_order.execution_captured_at,
    'execution_maps_url', CASE WHEN v_order.execution_latitude IS NOT NULL AND v_order.execution_longitude IS NOT NULL
      THEN 'https://maps.google.com/?q=' || v_order.execution_latitude || ',' || v_order.execution_longitude
      ELSE NULL END
  );
END;
$$;

-- ============================================================================
-- 5. Rewrite get_governed_orders — return snapshot fields instead of live joins
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
    'customer_id', o.customer_id,
    'customer_name', COALESCE(o.snapshot_customer_name, ''),
    'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
    'customer_address', COALESCE(o.snapshot_customer_address, ''),
    'customer_maps_url', '',
    'owner_type', o.owner_type, 'owner_id', o.owner_id,
    'owner_name', COALESCE(o.snapshot_owner_name, ''),
    'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
    'owner_address', COALESCE(o.snapshot_owner_address, ''),
    'status', o.status, 'subtotal', o.subtotal,
    'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
    'notes', o.notes, 'revision_number', o.revision_number,
    'created_by', o.created_by,
    'created_by_name', COALESCE(o.snapshot_sender_name, ''),
    'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
    'created_by_address', COALESCE(o.snapshot_sender_address, ''),
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
    'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
  ) ORDER BY o.created_at DESC) INTO v_result
  FROM orders o
  WHERE (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR o.status = p_status)
    AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
    AND (p_created_by IS NULL OR o.created_by = p_created_by)
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
