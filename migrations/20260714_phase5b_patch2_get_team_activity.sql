-- ============================================================================
-- PATCH 2 of 4: runtime.get_team_activity — Remove OR-join compatibility pattern
--
-- Why necessary:   This function includes e.identity_id in the team CTE and
--                  uses IN (t.employee_id, t.identity_id) in three LEFT JOINs.
--                  With zero contaminated rows, the identity_id branch never
--                  matches. This was the ORIGINAL root cause of the duplicate
--                  row bug in Activity Reports.
--
-- What it fixes:   Eliminates the OR-join at the source. Prevents duplicate
--                  rows in team activity aggregation. Future identity mixing
--                  would cause missing data (visible immediately) instead of
--                  duplicate data (visible only on cross-reference).
--
-- Depends on:      Data clean (verified: 0 contaminated rows).
--                  Patch 1 complete and verified.
--
-- Risk level:      LOW. CREATE OR REPLACE FUNCTION. The simplified JOINs
--                  produce identical results with clean data.
--
-- Rollback:        Re-run migration 20261231_fix_activity_submitted_at.sql
--                  which contains the previous definition.
--
-- Regression:      Before:  Record team activity KPI totals for current month
--                  After:   Compare — must be identical
--                           node scripts/verify_identity_integrity.mjs
--                           node scripts/full_regression_suite.mjs
-- ============================================================================

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
    SELECT e.id AS employee_id, e.code, e.full_name, e.manager_id
    FROM employees e
    WHERE (p_manager_employee_id IS NULL OR e.manager_id = p_manager_employee_id)
      AND e.is_active = true
    UNION ALL
    SELECT e.id, e.code, e.full_name, e.manager_id
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
  -- CHANGED: Removed IN (t.employee_id, t.identity_id) — now uses = t.employee_id only
  LEFT JOIN order_stats os ON os.owner_id = t.employee_id
  LEFT JOIN visit_stats vs ON vs.actor_employee_id = t.employee_id
  LEFT JOIN customer_stats cs ON cs.actor_employee_id = t.employee_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION runtime.get_team_activity IS
  'Canonical team activity aggregation. Removed identity_id OR-join on 2026-07-14 (Phase 5B Patch 2).';
