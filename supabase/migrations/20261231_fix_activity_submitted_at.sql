-- ============================================================
-- Migration: Fix Activity Tab — Use submitted_at + correct status filter
-- 
-- Phase: 5.1 — Commit 1 (Activity Tab)
-- Cause: runtime.get_activity and runtime.get_team_activity
--        used o.created_at instead of o.submitted_at,
--        and o.status != 'cancelled' instead of NOT IN ('draft','cancelled')
--
-- Changes:
--   1. runtime.get_activity:       o.created_at → o.submitted_at
--                                  o.status != 'cancelled' → NOT IN ('draft','cancelled')
--   2. runtime.get_team_activity:  same change in order_stats CTE
--
-- Verified: All 89 orders have submitted_at populated (zero NULLs).
--           56 have sub-second diff from created_at; all in same month.
--           No data loss risk.
-- ============================================================

-- ============ 1. Fix runtime.get_activity ============

CREATE OR REPLACE FUNCTION runtime.get_activity(
  p_employee_id uuid DEFAULT NULL::uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_employee_id uuid;
  v_identity_id uuid;
  v_customers bigint := 0;
  v_orders bigint := 0;
  v_visits bigint := 0;
  v_sales numeric := 0;
  v_ex_customers bigint := 0;
  v_ex_orders bigint := 0;
  v_ex_visits bigint := 0;
  v_ex_collections bigint := 0;
BEGIN
  SELECT e.employee_id, e.identity_id INTO v_employee_id, v_identity_id
  FROM runtime.resolve_scope(p_employee_id) e;

  IF v_employee_id IS NULL THEN
    RETURN jsonb_build_object('error', 'employee_not_found');
  END IF;

  IF p_date_from IS NULL THEN p_date_from := date_trunc('day', now());
  END IF;
  IF p_date_to IS NULL THEN p_date_to := date_trunc('day', now()) + interval '1 day';
  END IF;

  -- A01: Customers Registered
  SELECT COUNT(*)::bigint INTO v_customers
  FROM runtime_event_views.customer_registered_events ev
  WHERE ev.actor_employee_id IN (v_employee_id, v_identity_id)
    AND ev.event_timestamp >= p_date_from
    AND ev.event_timestamp < p_date_to;

  -- A02: Orders Created + sales amount (using submitted_at per canonical spec)
  SELECT COUNT(*)::bigint, COALESCE(SUM(o.total_amount), 0)::numeric
  INTO v_orders, v_sales
  FROM orders o
  WHERE o.owner_id IN (v_employee_id, v_identity_id)
    AND o.submitted_at >= p_date_from
    AND o.submitted_at < p_date_to
    AND o.status NOT IN ('draft', 'cancelled');

  -- A03: Visits Completed
  SELECT COUNT(*)::bigint INTO v_visits
  FROM runtime_event_views.visit_completed_events ev
  WHERE ev.actor_employee_id IN (v_employee_id, v_identity_id)
    AND ev.event_timestamp >= p_date_from
    AND ev.event_timestamp < p_date_to;

  -- Excluded events
  SELECT COUNT(*)::bigint INTO v_ex_customers
  FROM customers c WHERE c.owner_id IN (v_employee_id, v_identity_id)
    AND (c.registered_at IS NULL AND c.created_at IS NULL);

  SELECT COUNT(*)::bigint INTO v_ex_orders
  FROM orders o WHERE o.owner_id IN (v_employee_id, v_identity_id)
    AND o.created_at IS NULL;

  SELECT COUNT(*)::bigint INTO v_ex_visits
  FROM visits v WHERE v.employee_id = v_employee_id
    AND v.status = 'completed'
    AND (v.check_in_at IS NULL OR v.check_out_at IS NULL OR v.check_out_at <= v.check_in_at);

  SELECT COUNT(*)::bigint INTO v_ex_collections
  FROM collections col WHERE col.owner_id IN (v_employee_id, v_identity_id)
    AND (col.amount IS NULL OR col.amount <= 0 OR col.collected_at IS NULL OR col.status = 'cancelled');

  RETURN jsonb_build_object(
    'registered_customers', v_customers,
    'created_orders', v_orders,
    'created_sales', v_sales,
    'completed_visits', v_visits,
    'excluded_events', jsonb_build_object(
      'customers', v_ex_customers,
      'orders', v_ex_orders,
      'visits', v_ex_visits,
      'collections', v_ex_collections
    ),
    'meta', jsonb_build_object(
      'employee_id', v_employee_id,
      'date_from', p_date_from,
      'date_to', p_date_to,
      'source', 'runtime_v2',
      'type', 'activity'
    )
  );
END;
$function$;

-- ============ 2. Fix runtime.get_team_activity ============

CREATE OR REPLACE FUNCTION runtime.get_team_activity(
  p_manager_employee_id uuid DEFAULT NULL::uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_date_from IS NULL THEN p_date_from := date_trunc('day', now()); END IF;
  IF p_date_to IS NULL THEN p_date_to := date_trunc('day', now()) + interval '1 day'; END IF;

  WITH team AS (
    SELECT e.id AS employee_id, e.identity_id, e.code, e.full_name, e.manager_id
    FROM employees e
    WHERE (p_manager_employee_id IS NULL OR e.manager_id = p_manager_employee_id)
      AND e.is_active = true
    UNION ALL
    SELECT e.id, e.identity_id, e.code, e.full_name, e.manager_id
    FROM employees e
    WHERE e.id = p_manager_employee_id AND p_manager_employee_id IS NOT NULL
  ),
  mgr_names AS (
    SELECT e.id AS manager_id, e.full_name AS manager_name, e.code AS manager_code
    FROM employees e
    WHERE e.id IN (SELECT DISTINCT t.manager_id FROM team t WHERE t.manager_id IS NOT NULL)
  ),
  order_stats AS (
    SELECT o.owner_id,
      COUNT(*)::bigint AS orders,
      COALESCE(SUM(o.total_amount), 0)::numeric AS sales
    FROM orders o
    WHERE o.submitted_at >= p_date_from AND o.submitted_at < p_date_to
      AND o.status NOT IN ('draft', 'cancelled')
    GROUP BY o.owner_id
  ),
  visit_stats AS (
    SELECT ev.actor_employee_id,
      COUNT(*)::bigint AS visits
    FROM runtime_event_views.visit_completed_events ev
    WHERE ev.event_timestamp >= p_date_from AND ev.event_timestamp < p_date_to
    GROUP BY ev.actor_employee_id
  ),
  customer_stats AS (
    SELECT ev.actor_employee_id,
      COUNT(*)::bigint AS customers
    FROM runtime_event_views.customer_registered_events ev
    WHERE ev.event_timestamp >= p_date_from AND ev.event_timestamp < p_date_to
    GROUP BY ev.actor_employee_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'employee_id', t.employee_id,
      'code', t.code,
      'full_name', t.full_name,
      'manager_id', t.manager_id,
      'manager_name', COALESCE(mn.manager_name, ''),
      'manager_code', COALESCE(mn.manager_code, ''),
      'sales', COALESCE(os.sales, 0),
      'orders', COALESCE(os.orders, 0),
      'completed_visits', COALESCE(vs.visits, 0),
      'registered_customers', COALESCE(cs.customers, 0)
    ) ORDER BY COALESCE(os.sales, 0) DESC
  ) INTO v_result
  FROM team t
  LEFT JOIN mgr_names mn ON mn.manager_id = t.manager_id
  LEFT JOIN order_stats os ON os.owner_id IN (t.employee_id, t.identity_id)
  LEFT JOIN visit_stats vs ON vs.actor_employee_id IN (t.employee_id, t.identity_id)
  LEFT JOIN customer_stats cs ON cs.actor_employee_id IN (t.employee_id, t.identity_id);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

