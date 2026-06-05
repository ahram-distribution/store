-- ============================================================================
-- CUSTOMER VISIBILITY & ORDER ACCESS FIX
-- Hierarchical customer scoping for employees, customer session support
-- Created: 2026-06-06
--
-- Changes:
-- 1. Data fix: all REG-* customers assigned to الأهرام (SYS-OWNER)
-- 2. get_governed_customers: customer sessions + hierarchical filter
-- 3. get_employee_activity: scoping — restrict to visible subtree
-- 4. get_sales_by_rep: scoping — restrict to visible subtree
-- 5. get_sales_by_manager: scoping — restrict to visible subtree
-- ============================================================================

-- ============================================================================
-- 1. DATA FIX: Assign all REG-* (direct/self-registered) customers to الأهرام
-- ============================================================================

DO $$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT id INTO v_owner_id FROM employees WHERE code = 'SYS-OWNER';
  UPDATE customers SET owner_id = v_owner_id
  WHERE code LIKE 'REG-%'
    AND owner_id IS DISTINCT FROM v_owner_id;
END;
$$;

-- ============================================================================
-- 2. get_governed_customers: customer session + hierarchical filter
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_governed_customers(p_token text);

CREATE OR REPLACE FUNCTION public.get_governed_customers(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_emp_id uuid;
  v_is_customer boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_emp_id := app.current_employee_id();
  v_is_customer := (v_session.identity_type = 'customer');

  -- Customer sessions: show only their own customer record
  IF v_is_customer THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'code', c.code,
      'company_name', c.company_name,
      'responsible_name', c.responsible_name,
      'business_type', c.business_type,
      'email', c.email,
      'phone', i.phone,
      'credit_limit', c.credit_limit,
      'credit_days', c.credit_days,
      'owner_id', c.owner_id,
      'owner_name', e.full_name,
      'is_active', c.is_active,
      'location_id', c.location_id,
      'registered_at', c.registered_at,
      'created_at', c.created_at
    )) INTO v_result
    FROM customers c
    JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id
    WHERE c.identity_id = v_session.identity_id;

    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Employees with customers.read capability: all customers
  IF app.has_capability('customers.read') THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'code', c.code,
      'company_name', c.company_name,
      'responsible_name', c.responsible_name,
      'business_type', c.business_type,
      'email', c.email,
      'phone', i.phone,
      'credit_limit', c.credit_limit,
      'credit_days', c.credit_days,
      'owner_id', c.owner_id,
      'owner_name', e.full_name,
      'is_active', c.is_active,
      'location_id', c.location_id,
      'registered_at', c.registered_at,
      'created_at', c.created_at
    )) INTO v_result
    FROM customers c
    JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id;

    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Employees without customers.read: own + reports' customers
  SELECT jsonb_agg(jsonb_build_object(
    'id', c.id,
    'code', c.code,
    'company_name', c.company_name,
    'responsible_name', c.responsible_name,
    'business_type', c.business_type,
    'email', c.email,
    'phone', i.phone,
    'credit_limit', c.credit_limit,
    'credit_days', c.credit_days,
    'owner_id', c.owner_id,
    'owner_name', e.full_name,
    'is_active', c.is_active,
    'location_id', c.location_id,
    'registered_at', c.registered_at,
    'created_at', c.created_at
  )) INTO v_result
  FROM customers c
  JOIN identities i ON i.id = c.identity_id
  LEFT JOIN employees e ON e.id = c.owner_id
  WHERE c.owner_id = ANY(app.get_subtree_ids(v_emp_id));

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_customers IS 'عرض العملاء المسموحين بناءً على الصلاحية الهرمية. العملاء يرون سجلهم فقط. الموظفون بدون صلاحية customers.read يرون عملاءهم وعملاء مرؤوسيهم.';

-- ============================================================================
-- 3. get_employee_activity: restrict to visible subtree
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_employee_activity(
  p_token uuid, p_employee_id uuid, p_limit integer DEFAULT 10
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Customer sessions cannot view employee activity
  IF v_session.identity_type = 'customer' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_emp_id := app.current_employee_id();

  -- If no customers.read capability, restrict to visible subtree
  IF NOT app.has_capability('customers.read') THEN
    IF p_employee_id != ALL(app.get_subtree_ids(v_emp_id)) THEN
      RETURN '[]'::jsonb;
    END IF;
  END IF;

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

-- ============================================================================
-- 4. get_sales_by_rep: restrict to visible subtree
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_sales_by_rep(
  p_token uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone
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
  v_visible_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type = 'customer' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_emp_id := app.current_employee_id();

  IF app.has_capability('customers.read') THEN
    SELECT array_agg(id) INTO v_visible_ids FROM employees;
  ELSE
    v_visible_ids := app.get_subtree_ids(v_emp_id);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'employee_id', e.id, 'employee_name', e.full_name, 'employee_code', e.code,
    'total_orders', COUNT(o.id), 'total_amount', COALESCE(SUM(o.total_amount), 0),
    'customer_count', COUNT(DISTINCT o.customer_id)
  ) ORDER BY SUM(o.total_amount) DESC NULLS LAST) INTO v_result
  FROM employees e
  JOIN identities i ON i.id = e.identity_id
  JOIN orders o ON o.created_by = i.id
  WHERE e.id = ANY(v_visible_ids)
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    AND o.status NOT IN ('draft', 'cancelled')
  GROUP BY e.id, e.full_name, e.code;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 5. get_sales_by_manager: restrict to visible subtree
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_sales_by_manager(
  p_token uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone
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
  v_visible_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type = 'customer' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_emp_id := app.current_employee_id();

  IF app.has_capability('customers.read') THEN
    SELECT array_agg(id) INTO v_visible_ids FROM employees;
  ELSE
    v_visible_ids := app.get_subtree_ids(v_emp_id);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'manager_id', m.id, 'manager_name', m.full_name,
    'total_orders', COUNT(o.id), 'total_amount', COALESCE(SUM(o.total_amount), 0),
    'rep_count', COUNT(DISTINCT e.id)
  ) ORDER BY SUM(o.total_amount) DESC NULLS LAST) INTO v_result
  FROM employees m
  JOIN employees e ON e.manager_id = m.id
  JOIN identities i ON i.id = e.identity_id
  JOIN orders o ON o.created_by = i.id
  WHERE m.id = ANY(v_visible_ids)
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    AND o.status NOT IN ('draft', 'cancelled')
  GROUP BY m.id, m.full_name;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- END OF CUSTOMER VISIBILITY & ORDER ACCESS FIX
-- ============================================================================
