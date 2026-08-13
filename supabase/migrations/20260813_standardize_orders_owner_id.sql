-- 20260813_standardize_orders_owner_id.sql
-- PHASE 2: orders.owner_id = employee_id (employee-owned orders)
--          orders.created_by = identity_id  (UNCHANGED - remains the creating identity)
-- Scope:
--   1. governed_create_order  : employee branch owner_id -> v_session.employee_id
--   2. Backfill               : identity_id -> employee_id for employee-owned orders (verified 1:1)
--   3. get_governed_orders    : employee filter via resolve_employee_id(created_by)
--   4. _emp_cascade_order_ids : match owner_id (employee id) in addition to created_by (identity id)
-- No FK added. created_by semantics unchanged. Customer-owned orders untouched.

BEGIN;

-- 1. governed_create_order: only the employee-branch owner_id value changes.
--    created_by remains v_session.identity_id (both branches).
CREATE OR REPLACE FUNCTION public.governed_create_order(p_token uuid, p_customer_id uuid, p_tier_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_execution_location_id uuid DEFAULT NULL::uuid, p_execution_latitude numeric DEFAULT NULL::numeric, p_execution_longitude numeric DEFAULT NULL::numeric, p_execution_accuracy_meters numeric DEFAULT NULL::numeric, p_execution_captured_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_order_type character varying DEFAULT 'cash'::character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_order_number text;
  v_seq int;
  v_order_item jsonb;
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

  -- Validate no out_of_stock products in the order
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS vi
    JOIN public.products p ON p.id = (vi->>'product_id')::uuid
    WHERE p.is_out_of_stock = true AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'ORDER_CONTAINS_OUT_OF_STOCK_PRODUCTS';
  END IF;

  v_exec_location_id := p_execution_location_id;
  IF v_exec_location_id IS NULL AND p_execution_latitude IS NOT NULL AND p_execution_longitude IS NOT NULL THEN
    v_exec_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, captured_at)
    VALUES (v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, COALESCE(p_execution_captured_at, now()));
  END IF;

  -- Customer snapshot
  SELECT
    c.company_name,
    COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
    COALESCE(
      (SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
      (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1),
      ''
    )
  INTO v_cust_name, v_cust_phone, v_cust_address
  FROM customers c
  WHERE c.id = p_customer_id;

  -- Owner snapshot
  SELECT
    COALESCE(e.full_name, ''),
    COALESCE(i.phone, ''),
    COALESCE(e.address, '')
  INTO v_owner_name, v_owner_phone, v_owner_address
  FROM customers c
  LEFT JOIN employees e ON e.id = c.owner_id
  LEFT JOIN identities i ON i.id = e.identity_id
  WHERE c.id = p_customer_id;

  -- Sender snapshot
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
      COALESCE(
        (SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
        (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1),
        ''
      )
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
      notes, tier_id, order_type,
      execution_location_id, execution_latitude, execution_longitude,
      execution_accuracy_meters, execution_captured_at,
      snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
      snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
      snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address
    ) VALUES (
      v_order_number, p_customer_id, 'employee', v_session.employee_id, v_session.identity_id,
      p_notes, p_tier_id, p_order_type,
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
      notes, tier_id, order_type,
      execution_location_id, execution_latitude, execution_longitude,
      execution_accuracy_meters, execution_captured_at,
      snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
      snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
      snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address
    ) VALUES (
      v_order_number, p_customer_id, 'customer', v_session.identity_id, v_session.identity_id,
      p_notes, p_tier_id, p_order_type,
      v_exec_location_id, p_execution_latitude, p_execution_longitude,
      p_execution_accuracy_meters, p_execution_captured_at,
      v_cust_name, v_cust_phone, v_cust_address,
      v_owner_name, v_owner_phone, v_owner_address,
      v_sender_name, v_sender_phone, v_sender_address
    )
    RETURNING * INTO v_order;
  END IF;

  -- Insert order items (only real columns from schema)
  FOR v_order_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, product_name, legacy_code AS product_code, carton_price, carton_quantity
    INTO v_product
    FROM public.products
    WHERE id = (v_order_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %', (v_order_item->>'product_id')::uuid;
    END IF;

    v_calculated_unit_price := (v_order_item->>'unit_price')::numeric;

    v_calculated_total_price := ROUND(
      (v_calculated_unit_price * (v_order_item->>'unit_quantity')::numeric)::numeric, 2
    );

    INSERT INTO public.order_items (
      order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price
    ) VALUES (
      v_order.id, v_product.id,
      COALESCE(v_order_item->>'unit_type', 'piece'),
      GREATEST(COALESCE((v_order_item->>'unit_quantity')::integer, 1), 1),
      GREATEST(COALESCE((v_order_item->>'piece_quantity')::integer, 0), 1),
      v_calculated_unit_price, v_calculated_total_price
    );
  END LOOP;

  -- Update order totals
  UPDATE public.orders SET
    subtotal = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id),
    total_amount = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id)
  WHERE id = v_order.id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (v_order.id, NULL, 'draft', v_session.identity_id, 'Order created');

  UPDATE public.code_sequences
  SET last_sequence = v_seq
  WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int;

  -- Enrich customer from order execution location (best-effort)
  BEGIN
    PERFORM fn_enrich_customer_location(
      p_customer_id        := p_customer_id,
      p_latitude           := p_execution_latitude,
      p_longitude          := p_execution_longitude,
      p_accuracy_meters    := p_execution_accuracy_meters,
      p_accuracy_level     := 'GEOCODED'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'governed_create_order: enrichment failed for order % (customer %): %', v_order.id, p_customer_id, SQLERRM;
  END;

  PERFORM pg_notify('order_created', jsonb_build_object('order_id', v_order.id, 'number', v_order.order_number)::text);

  -- Reset inactivity timer (order creation is a qualifying activity)
  IF v_session.identity_type = 'employee' THEN
    PERFORM public.touch_qualifying_activity(v_session.employee_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_order.id,
    'order_number', v_order.order_number
  );
END;
$function$;
-- 2. Backfill employee-owned orders whose owner_id still holds an identity_id.
--    Runs AFTER the create-order correction so no new identity-owned rows can be introduced.
--    Guard: skip rows that already hold an employee id (the 23 canonical rows).
UPDATE public.orders o
SET owner_id = e.id
FROM public.employees e
WHERE o.owner_type = 'employee'
  AND o.owner_id = e.identity_id
  AND NOT EXISTS (SELECT 1 FROM public.employees ee WHERE ee.id = o.owner_id);

-- 3. get_governed_orders: employee filter must resolve created_by (identity_id) to an employee id.
--    List scoping logic is unchanged.
CREATE OR REPLACE FUNCTION public.get_governed_orders(p_token uuid, p_search text DEFAULT NULL::text, p_status character varying DEFAULT NULL::character varying, p_customer_id uuid DEFAULT NULL::uuid, p_employee_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
  v_subtree_ids uuid[]; v_identity_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  -- Customer: own orders only
  IF v_session.identity_type = 'customer' THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_number', o.order_number,
      'customer_id', o.customer_id, 'customer_code', COALESCE(o.snapshot_customer_code, ''),
      'customer_name', COALESCE(o.snapshot_customer_name, ''),
      'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
      'customer_address', COALESCE(o.snapshot_customer_address, ''),
      'customer_maps_url', '', 'owner_type', o.owner_type, 'owner_id', o.owner_id,
      'owner_name', e.full_name,
      'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
      'owner_address', COALESCE(o.snapshot_owner_address, ''),
      'status', o.status, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
      'total_amount', o.total_amount, 'notes', o.notes, 'revision_number', o.revision_number,
      'created_by', o.created_by, 'created_by_name', COALESCE(o.snapshot_sender_name, ''),
      'created_by_id', CASE
        WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
        WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
        ELSE NULL
      END,
      'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
      'created_by_address', COALESCE(o.snapshot_sender_address, ''),
      'created_at', o.created_at, 'updated_at', o.updated_at,
      'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
      'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
    ) ORDER BY o.created_at DESC) INTO v_result
    FROM orders o
    LEFT JOIN public.employees e ON e.id = o.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    WHERE o.created_by = v_session.identity_id
      AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_employee_id IS NULL OR public.resolve_employee_id(o.created_by) = p_employee_id)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;
  -- Upper management: all orders
  IF public.is_upper_management(v_session.employee_id) THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_number', o.order_number,
      'customer_id', o.customer_id, 'customer_code', COALESCE(o.snapshot_customer_code, ''),
      'customer_name', COALESCE(o.snapshot_customer_name, ''),
      'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
      'customer_address', COALESCE(o.snapshot_customer_address, ''),
      'customer_maps_url', '', 'owner_type', o.owner_type, 'owner_id', o.owner_id,
      'owner_name', e.full_name,
      'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
      'owner_address', COALESCE(o.snapshot_owner_address, ''),
      'status', o.status, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
      'total_amount', o.total_amount, 'notes', o.notes, 'revision_number', o.revision_number,
      'created_by', o.created_by, 'created_by_name', COALESCE(o.snapshot_sender_name, ''),
      'created_by_id', CASE
        WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
        WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
        ELSE NULL
      END,
      'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
      'created_by_address', COALESCE(o.snapshot_sender_address, ''),
      'created_at', o.created_at, 'updated_at', o.updated_at,
      'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
      'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
    ) ORDER BY o.created_at DESC) INTO v_result
    FROM orders o
    LEFT JOIN public.employees e ON e.id = o.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    WHERE (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_employee_id IS NULL OR public.resolve_employee_id(o.created_by) = p_employee_id)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;
  -- Others: tree-scoped orders
  v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
  SELECT COALESCE(array_agg(identity_id), '{}'::uuid[]) INTO v_identity_ids
  FROM public.employees WHERE id = ANY(v_subtree_ids);
  SELECT jsonb_agg(jsonb_build_object(
    'id', o.id, 'order_number', o.order_number,
    'customer_id', o.customer_id, 'customer_code', COALESCE(o.snapshot_customer_code, ''),
    'customer_name', COALESCE(o.snapshot_customer_name, ''),
    'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
    'customer_address', COALESCE(o.snapshot_customer_address, ''),
    'customer_maps_url', '', 'owner_type', o.owner_type, 'owner_id', o.owner_id,
    'owner_name', e.full_name,
    'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
    'owner_address', COALESCE(o.snapshot_owner_address, ''),
    'status', o.status, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
    'total_amount', o.total_amount, 'notes', o.notes, 'revision_number', o.revision_number,
    'created_by', o.created_by, 'created_by_name', COALESCE(o.snapshot_sender_name, ''),
    'created_by_id', CASE
      WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
      WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
      ELSE NULL
    END,
    'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
    'created_by_address', COALESCE(o.snapshot_sender_address, ''),
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
    'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
  ) ORDER BY o.created_at DESC) INTO v_result
  FROM orders o
  LEFT JOIN public.employees e ON e.id = o.owner_id
  LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
  LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
  LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
  WHERE (o.created_by = ANY(v_identity_ids) OR o.customer_id IN (SELECT c2.id FROM customers c2 WHERE c2.owner_id = ANY(v_subtree_ids)))
    AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR o.status = p_status)
    AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
    AND (p_employee_id IS NULL OR public.resolve_employee_id(o.created_by) = p_employee_id)
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to);
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;
-- 4. _emp_cascade_order_ids: employee deletion must also find orders by employee-owned owner_id.
CREATE OR REPLACE FUNCTION public._emp_cascade_order_ids(p_ids uuid[])
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT ARRAY(SELECT id FROM public.orders WHERE created_by = ANY(p_ids) OR owner_id = ANY(p_ids))
$function$;

COMMIT;

