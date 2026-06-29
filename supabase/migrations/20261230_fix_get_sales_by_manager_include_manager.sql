-- ================================================================
-- Fix: get_sales_by_manager — include manager's own data
--
-- Problem:
--   JOIN employees e ON e.manager_id = m.id only returns direct
--   reports, excluding the manager's personal orders/sales.
--
-- Fix:
--   UNION ALL + outer GROUP BY: subordinates' data + manager's
--   own data combined. rep_count includes manager (subordinates + 1).
-- ================================================================

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

  WITH combined AS (
    -- Direct reports' orders
    SELECT m.id AS manager_id, m.full_name AS manager_name,
      o.id AS order_id, o.total_amount,
      e.id AS employee_id
    FROM employees m
    JOIN employees e ON e.manager_id = m.id
    JOIN identities i ON i.id = e.identity_id
    JOIN orders o ON o.created_by = i.id
    WHERE m.id = ANY(v_visible_ids)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      AND o.status NOT IN ('draft', 'cancelled')

    UNION ALL

    -- Manager's own orders (as a team member)
    SELECT m.id, m.full_name,
      o.id, o.total_amount,
      m.id
    FROM employees m
    JOIN identities i ON i.id = m.identity_id
    JOIN orders o ON o.created_by = i.id
    WHERE m.id = ANY(v_visible_ids)
      AND EXISTS (SELECT 1 FROM employees sub WHERE sub.manager_id = m.id)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      AND o.status NOT IN ('draft', 'cancelled')
  )
  SELECT jsonb_agg(jsonb_build_object(
    'manager_id', g.manager_id, 'manager_name', g.manager_name,
    'total_orders', g.total_orders, 'total_amount', g.total_amount,
    'rep_count', g.rep_count
  ) ORDER BY g.total_amount DESC NULLS LAST) INTO v_result
  FROM (
    SELECT c.manager_id, c.manager_name,
      COUNT(c.order_id)::int AS total_orders,
      COALESCE(SUM(c.total_amount), 0) AS total_amount,
      COUNT(DISTINCT c.employee_id)::int AS rep_count
    FROM combined c
    GROUP BY c.manager_id, c.manager_name
  ) g;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_by_manager TO authenticated;
