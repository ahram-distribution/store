-- ============================================================================
-- PATCH 1 of 4: runtime.get_activity — Remove OR-join compatibility pattern
--
-- Why necessary:   This function contains WHERE o.owner_id IN (v_employee_id,
--                  v_identity_id) — a workaround from when owner_id could be
--                  either employees.id or employees.identity_id. With zero
--                  contaminated rows in production, the identity_id branch
--                  is dead code.
--
-- What it fixes:   Eliminates the identity_id fallback from individual
--                  activity aggregation. Makes future identity mixing
--                  immediately visible.
--
-- Depends on:      Data clean (verified: 0 contaminated rows).
--                  KPI consistency verified: Direct=77, Team=77 (Jul 1-14).
--
-- Risk level:      LOW. CREATE OR REPLACE FUNCTION. All callers use
--                  get_runtime_activity public wrapper which delegates here.
--                  With clean data, results are IDENTICAL.
--
-- Rollback:        Re-run migration 20261231_fix_activity_submitted_at.sql
--                  which contains the previous definition.
--
-- Regression:      Before:  Record KPI totals (direct orders vs team activity)
--                  After:   Compare KPI totals — must be identical
--                           node scripts/verify_identity_integrity.mjs
--                           node scripts/full_regression_suite.mjs
-- ============================================================================

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
  v_customers bigint := 0;
  v_orders bigint := 0;
  v_visits bigint := 0;
  v_sales numeric := 0;
  v_ex_customers bigint := 0;
  v_ex_orders bigint := 0;
  v_ex_visits bigint := 0;
  v_ex_collections bigint := 0;
BEGIN
  SELECT e.employee_id INTO v_employee_id
  FROM runtime.resolve_scope(p_employee_id) e;

  IF v_employee_id IS NULL THEN
    RETURN jsonb_build_object('error', 'employee_not_found');
  END IF;

  IF p_date_from IS NULL THEN p_date_from := date_trunc('day', now());
  END IF;
  IF p_date_to IS NULL THEN p_date_to := date_trunc('day', now()) + interval '1 day';
  END IF;

  -- A01: Customers Registered (uses actor_employee_id — already correct)
  SELECT COUNT(*)::bigint INTO v_customers
  FROM runtime_event_views.customer_registered_events ev
  WHERE ev.actor_employee_id = v_employee_id
    AND ev.event_timestamp >= p_date_from
    AND ev.event_timestamp < p_date_to;

  -- A02: Orders Created + sales amount
  -- CHANGED: Removed IN (v_employee_id, v_identity_id) — now uses = v_employee_id only
  SELECT COUNT(*)::bigint, COALESCE(SUM(o.total_amount), 0)::numeric
  INTO v_orders, v_sales
  FROM orders o
  WHERE o.owner_id = v_employee_id
    AND o.submitted_at >= p_date_from
    AND o.submitted_at < p_date_to
    AND o.status NOT IN ('draft', 'cancelled');

  -- A03: Visits Completed (uses actor_employee_id — already correct)
  SELECT COUNT(*)::bigint INTO v_visits
  FROM runtime_event_views.visit_completed_events ev
  WHERE ev.actor_employee_id = v_employee_id
    AND ev.event_timestamp >= p_date_from
    AND ev.event_timestamp < p_date_to;

  -- Excluded events (all use direct employee_id — already correct)
  SELECT COUNT(*)::bigint INTO v_ex_customers
  FROM customers c WHERE c.owner_id = v_employee_id
    AND (c.registered_at IS NULL AND c.created_at IS NULL);

  SELECT COUNT(*)::bigint INTO v_ex_orders
  FROM orders o WHERE o.owner_id = v_employee_id
    AND o.created_at IS NULL;

  SELECT COUNT(*)::bigint INTO v_ex_visits
  FROM visits v WHERE v.employee_id = v_employee_id
    AND v.status = 'completed'
    AND (v.check_in_at IS NULL OR v.check_out_at IS NULL OR v.check_out_at <= v.check_in_at);

  SELECT COUNT(*)::bigint INTO v_ex_collections
  FROM collections col WHERE col.owner_id = v_employee_id
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

COMMENT ON FUNCTION runtime.get_activity IS
  'Canonical activity aggregation. Removed identity_id fallback on 2026-07-14 (Phase 5B Patch 1).';
