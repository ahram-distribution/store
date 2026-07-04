-- ============================================================================
-- Sales Manager Filtered List Screens — Server-side Filtering Support
-- Adds filter parameters to get_governed_customers and get_governed_visits
-- All new params have DEFAULT NULL → fully backward compatible
-- ============================================================================

-- ============================================================================
-- 1. get_governed_customers — add search + employee + date filter params
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_governed_customers(p_token text);

CREATE OR REPLACE FUNCTION public.get_governed_customers(
  p_token text,
  p_search text DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_emp_id uuid;
  v_is_customer boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  v_emp_id := app.current_employee_id();
  v_is_customer := (v_session.identity_type = 'customer');

  -- Customer sessions: show only their own customer record
  IF v_is_customer THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'company_name', c.company_name,
      'responsible_name', c.responsible_name, 'business_type', c.business_type,
      'email', c.email, 'phone', i.phone,
      'credit_limit', c.credit_limit, 'credit_days', c.credit_days,
      'owner_id', c.owner_id, 'owner_name', e.full_name,
      'is_active', c.is_active, 'location_id', c.location_id,
      'registered_at', c.registered_at, 'created_at', c.created_at
    )) INTO v_result
    FROM customers c
    JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id
    WHERE c.identity_id = v_session.identity_id
      AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%')
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Employees with customers.read capability: all customers
  IF app.has_capability('customers.read') THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'company_name', c.company_name,
      'responsible_name', c.responsible_name, 'business_type', c.business_type,
      'email', c.email, 'phone', i.phone,
      'credit_limit', c.credit_limit, 'credit_days', c.credit_days,
      'owner_id', c.owner_id, 'owner_name', e.full_name,
      'is_active', c.is_active, 'location_id', c.location_id,
      'registered_at', c.registered_at, 'created_at', c.created_at
    )) INTO v_result
    FROM customers c
    JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id
    WHERE (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%')
      AND (p_employee_id IS NULL OR c.owner_id = p_employee_id)
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Employees without customers.read: own + reports' customers
  SELECT jsonb_agg(jsonb_build_object(
    'id', c.id, 'code', c.code, 'company_name', c.company_name,
    'responsible_name', c.responsible_name, 'business_type', c.business_type,
    'email', c.email, 'phone', i.phone,
    'credit_limit', c.credit_limit, 'credit_days', c.credit_days,
    'owner_id', c.owner_id, 'owner_name', e.full_name,
    'is_active', c.is_active, 'location_id', c.location_id,
    'registered_at', c.registered_at, 'created_at', c.created_at
  )) INTO v_result
  FROM customers c
  JOIN identities i ON i.id = c.identity_id
  LEFT JOIN employees e ON e.id = c.owner_id
  WHERE c.owner_id = ANY(app.get_subtree_ids(v_emp_id))
    AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%')
    AND (p_employee_id IS NULL OR c.owner_id = p_employee_id)
    AND (p_date_from IS NULL OR c.created_at >= p_date_from)
    AND (p_date_to IS NULL OR c.created_at <= p_date_to);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_customers IS 'قائمة العملاء مع دعم البحث والنطاق الهرمي والفلاتر الزمنية';

-- ============================================================================
-- 2. get_governed_visits — convert to jsonb, add filter params, add name joins
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_governed_visits(p_token uuid);

CREATE OR REPLACE FUNCTION public.get_governed_visits(
  p_token uuid,
  p_search text DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Customer: own visits
  IF v_session.identity_type = 'customer' THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'code', v.code, 'employee_id', v.employee_id,
      'customer_id', v.customer_id, 'customer_name', c.company_name,
      'employee_name', e.full_name,
      'status', v.status, 'visit_result', v.visit_result,
      'notes', v.notes, 'check_in_at', v.check_in_at,
      'check_out_at', v.check_out_at,
      'check_in_latitude', v.check_in_latitude, 'check_in_longitude', v.check_in_longitude,
      'check_out_latitude', v.check_out_latitude, 'check_out_longitude', v.check_out_longitude,
      'start_location_id', v.start_location_id, 'created_at', v.created_at
    ) ORDER BY v.created_at DESC) INTO v_result
    FROM public.visits v
    LEFT JOIN customers c ON c.id = v.customer_id
    LEFT JOIN employees e ON e.id = v.employee_id
    WHERE v.customer_id = v_session.customer_id
      AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR v.code ILIKE '%' || p_search || '%')
      AND (p_employee_id IS NULL OR v.employee_id = p_employee_id)
      AND (p_date_from IS NULL OR v.check_in_at >= p_date_from)
      AND (p_date_to IS NULL OR v.check_in_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Upper management: all visits
  IF public.is_upper_management(v_session.employee_id) THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'code', v.code, 'employee_id', v.employee_id,
      'customer_id', v.customer_id, 'customer_name', c.company_name,
      'employee_name', e.full_name,
      'status', v.status, 'visit_result', v.visit_result,
      'notes', v.notes, 'check_in_at', v.check_in_at,
      'check_out_at', v.check_out_at,
      'check_in_latitude', v.check_in_latitude, 'check_in_longitude', v.check_in_longitude,
      'check_out_latitude', v.check_out_latitude, 'check_out_longitude', v.check_out_longitude,
      'start_location_id', v.start_location_id, 'created_at', v.created_at
    ) ORDER BY v.created_at DESC) INTO v_result
    FROM public.visits v
    LEFT JOIN customers c ON c.id = v.customer_id
    LEFT JOIN employees e ON e.id = v.employee_id
    WHERE (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR v.code ILIKE '%' || p_search || '%')
      AND (p_employee_id IS NULL OR v.employee_id = p_employee_id)
      AND (p_date_from IS NULL OR v.check_in_at >= p_date_from)
      AND (p_date_to IS NULL OR v.check_in_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Others: tree-scoped visits
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  SELECT jsonb_agg(jsonb_build_object(
    'id', v.id, 'code', v.code, 'employee_id', v.employee_id,
    'customer_id', v.customer_id, 'customer_name', c.company_name,
    'employee_name', e.full_name,
    'status', v.status, 'visit_result', v.visit_result,
    'notes', v.notes, 'check_in_at', v.check_in_at,
    'check_out_at', v.check_out_at,
    'check_in_latitude', v.check_in_latitude, 'check_in_longitude', v.check_in_longitude,
    'check_out_latitude', v.check_out_latitude, 'check_out_longitude', v.check_out_longitude,
    'start_location_id', v.start_location_id, 'created_at', v.created_at
  ) ORDER BY v.created_at DESC) INTO v_result
  FROM public.visits v
  LEFT JOIN customers c ON c.id = v.customer_id
  LEFT JOIN employees e ON e.id = v.employee_id
  WHERE v.employee_id = ANY(v_visible)
    AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR v.code ILIKE '%' || p_search || '%')
    AND (p_employee_id IS NULL OR v.employee_id = p_employee_id)
    AND (p_date_from IS NULL OR v.check_in_at >= p_date_from)
    AND (p_date_to IS NULL OR v.check_in_at <= p_date_to);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_visits IS 'قائمة الزيارات مع دعم البحث والنطاق الهرمي والفلاتر الزمنية';

-- ============================================================================
-- 3. get_governed_orders — already has filter params, adding p_employee_id alias
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_governed_orders(p_token uuid, p_search text, p_status varchar, p_customer_id uuid, p_created_by uuid, p_date_from timestamptz, p_date_to timestamptz);

CREATE OR REPLACE FUNCTION public.get_governed_orders(
  p_token uuid,
  p_search text DEFAULT NULL,
  p_status varchar DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
      'owner_name', COALESCE(o.snapshot_owner_name, ''),
      'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
      'owner_address', COALESCE(o.snapshot_owner_address, ''),
      'status', o.status, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
      'total_amount', o.total_amount, 'notes', o.notes, 'revision_number', o.revision_number,
      'created_by', o.created_by, 'created_by_name', COALESCE(o.snapshot_sender_name, ''),
      'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
      'created_by_address', COALESCE(o.snapshot_sender_address, ''),
      'created_at', o.created_at, 'updated_at', o.updated_at,
      'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
      'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
    ) ORDER BY o.created_at DESC) INTO v_result
    FROM orders o
    WHERE o.created_by = v_session.identity_id
      AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_employee_id IS NULL OR o.created_by = p_employee_id)
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
      'owner_name', COALESCE(o.snapshot_owner_name, ''),
      'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
      'owner_address', COALESCE(o.snapshot_owner_address, ''),
      'status', o.status, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
      'total_amount', o.total_amount, 'notes', o.notes, 'revision_number', o.revision_number,
      'created_by', o.created_by, 'created_by_name', COALESCE(o.snapshot_sender_name, ''),
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
      AND (p_employee_id IS NULL OR o.created_by = p_employee_id)
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
    'owner_name', COALESCE(o.snapshot_owner_name, ''),
    'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
    'owner_address', COALESCE(o.snapshot_owner_address, ''),
    'status', o.status, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
    'total_amount', o.total_amount, 'notes', o.notes, 'revision_number', o.revision_number,
    'created_by', o.created_by, 'created_by_name', COALESCE(o.snapshot_sender_name, ''),
    'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
    'created_by_address', COALESCE(o.snapshot_sender_address, ''),
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
    'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
  ) ORDER BY o.created_at DESC) INTO v_result
  FROM orders o
  WHERE (o.created_by = ANY(v_identity_ids) OR o.customer_id IN (SELECT c2.id FROM customers c2 WHERE c2.owner_id = ANY(v_subtree_ids)))
    AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR o.status = p_status)
    AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
    AND (p_employee_id IS NULL OR o.created_by = p_employee_id)
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to);
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_orders IS 'قائمة الطلبات مع دعم البحث والنطاق الهرمي والفلاتر الزمنية';

-- Grant execute
GRANT EXECUTE ON FUNCTION public.get_governed_customers TO anon;
GRANT EXECUTE ON FUNCTION public.get_governed_orders TO anon;
GRANT EXECUTE ON FUNCTION public.get_governed_visits TO anon;
