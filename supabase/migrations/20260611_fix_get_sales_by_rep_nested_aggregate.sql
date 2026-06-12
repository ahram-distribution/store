-- ============================================================================
-- FIX get_sales_by_rep — nested aggregate in jsonb_agg ORDER BY
-- ============================================================================
-- PostgreSQL does not allow SUM() inside the ORDER BY clause of jsonb_agg().
-- Fix: compute aggregates in a subquery, then jsonb_agg with field reference.

DROP FUNCTION IF EXISTS public.get_sales_by_rep(p_token uuid, p_date_from timestamptz, p_date_to timestamptz);

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
