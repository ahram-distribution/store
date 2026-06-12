-- ============================================================================
-- HOTFIX: Companies public access + SalesRep governance identity_id
-- Issues:
--   1. CompaniesPage: 401 Unauthorized on companies table direct query
--   2. SalesRep screens: FORBIDDEN / empty data from governed RPCs
--
-- Fix 1: Enable RLS on companies + allow public SELECT (anon + authenticated)
-- Fix 2: get_governed_customers — set app.identity_id before calling
--        app.current_employee_id() / app.has_capability()
-- Fix 3: get_employee_activity, get_sales_by_rep, get_sales_by_manager —
--        same app.identity_id fix
-- ============================================================================

-- ============================================================================
-- 1. Companies: Enable RLS + public SELECT policy
--    Allows the storefront CompaniesPage to read companies directly
--    without requiring authentication (fixes 401 Unauthorized)
-- ============================================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Companies are publicly readable"
  ON companies FOR SELECT
  USING (true);

-- Grant SELECT privilege so anon/authenticated roles can access the tables
GRANT SELECT ON public.companies TO anon, authenticated;
GRANT SELECT ON public.products TO anon, authenticated;
GRANT SELECT ON public.product_units TO anon, authenticated;
GRANT SELECT ON public.inventory TO anon, authenticated;

-- ============================================================================
-- 2. get_governed_customers — set app.identity_id from session
--    The function uses app.current_employee_id() and app.has_capability()
--    which rely on current_setting('app.identity_id'). Without the config
--    being set, these return NULL/false, causing empty results.
--    Also fixed: p_token::uuid cast for uuid = text comparison.
-- ============================================================================

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
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

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
-- 3. get_employee_activity — set app.identity_id from session
--    Fixed: visits_activity CTE had v.status, v.visit_result as status causing
--    UNION type mismatch (varchar vs numeric at position 4).
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

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

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
    SELECT 'visit' as activity_type, v.code as ref, v.visit_result as status, NULL::numeric as total_amount, v.created_at
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
-- 4. get_sales_by_rep — set app.identity_id from session
--    Uses subquery pattern from 20260611 fix to avoid nested aggregate.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_sales_by_rep(
  p_token uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
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

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  v_emp_id := app.current_employee_id();

  IF app.has_capability('customers.read') THEN
    SELECT array_agg(id) INTO v_visible_ids FROM employees;
  ELSE
    v_visible_ids := app.get_subtree_ids(v_emp_id);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'employee_id', s.employee_id, 'employee_name', s.employee_name,
    'employee_code', s.employee_code, 'total_orders', s.total_orders,
    'total_amount', s.total_amount, 'customer_count', s.customer_count
  ) ORDER BY s.total_amount DESC NULLS LAST) INTO v_result
  FROM (
    SELECT e.id AS employee_id, e.full_name AS employee_name, e.code AS employee_code,
      COUNT(o.id) AS total_orders,
      COALESCE(SUM(o.total_amount), 0) AS total_amount,
      COUNT(DISTINCT o.customer_id) AS customer_count
    FROM employees e
    JOIN identities i ON i.id = e.identity_id
    JOIN orders o ON o.created_by = i.id
    WHERE e.id = ANY(v_visible_ids)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      AND o.status NOT IN ('draft', 'cancelled')
    GROUP BY e.id, e.full_name, e.code
  ) s;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 5. get_sales_by_manager — set app.identity_id from session
--    Uses subquery pattern to avoid nested aggregate (same as get_sales_by_rep).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_sales_by_manager(
  p_token uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
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

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  v_emp_id := app.current_employee_id();

  IF app.has_capability('customers.read') THEN
    SELECT array_agg(id) INTO v_visible_ids FROM employees;
  ELSE
    v_visible_ids := app.get_subtree_ids(v_emp_id);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'manager_id', s.manager_id, 'manager_name', s.manager_name,
    'total_orders', s.total_orders, 'total_amount', s.total_amount,
    'rep_count', s.rep_count
  ) ORDER BY s.total_amount DESC NULLS LAST) INTO v_result
  FROM (
    SELECT m.id AS manager_id, m.full_name AS manager_name,
      COUNT(o.id) AS total_orders,
      COALESCE(SUM(o.total_amount), 0) AS total_amount,
      COUNT(DISTINCT e.id) AS rep_count
    FROM employees m
    JOIN employees e ON e.manager_id = m.id
    JOIN identities i ON i.id = e.identity_id
    JOIN orders o ON o.created_by = i.id
    WHERE m.id = ANY(v_visible_ids)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      AND o.status NOT IN ('draft', 'cancelled')
    GROUP BY m.id, m.full_name
  ) s;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
