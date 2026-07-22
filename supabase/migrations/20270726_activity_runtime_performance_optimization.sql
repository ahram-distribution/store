-- ============================================================================
-- Activity Runtime Performance Optimization
-- 
-- 1. Composite indexes for (owner_id, created_at) covering the most expensive
--    query patterns in get_employee_detail_data and similar RPCs
-- 2. Partial index for is_order_in_statistics() to enable index-only scans
-- 3. get_employee_activity_summary_batch — replaces N individual
--    get_employee_detail_data calls with a single batch RPC (N+1 → 1)
-- 4. get_customer_first_deliveries — lightweight RPC replacing the full
--    get_statistical_orders(all-time) call used by DeliveredOrdersKPI
-- ============================================================================

-- ============================================================================
-- 1. COMPOSITE INDEXES
-- ============================================================================

-- orders: the most common filter is owner_id + created_at range
CREATE INDEX IF NOT EXISTS idx_orders_owner_id_created_at
  ON public.orders (owner_id, created_at DESC);

-- customers: owner_id + created_at range (for new customer count)
CREATE INDEX IF NOT EXISTS idx_customers_owner_id_created_at
  ON public.customers (owner_id, created_at DESC);

-- visits: employee_id + check_in_at range (for visit count)
CREATE INDEX IF NOT EXISTS idx_visits_employee_id_check_in_at
  ON public.visits (employee_id, check_in_at DESC);

-- ============================================================================
-- 2. PARTIAL INDEX for is_order_in_statistics
--    Covers the vast majority of rows (draft/submitted/cancelled excluded)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_statistical
  ON public.orders (owner_id, created_at DESC)
  WHERE status NOT IN ('draft', 'submitted', 'reviewing', 'returned_for_revision', 'cancelled');

ANALYZE public.orders;
ANALYZE public.customers;
ANALYZE public.visits;

-- ============================================================================
-- 3. get_employee_activity_summary_batch
--    Accepts an array of employee IDs + date range, returns aggregated totals
--    in a single scan per table. Replaces N individual detail_data calls.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_employee_activity_summary_batch(
  p_token uuid,
  p_employee_ids uuid[],
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_is_super boolean;
  v_visible uuid[];
  v_effective_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type != 'employee' THEN
    RETURN jsonb_build_object('error', 'NOT_EMPLOYEE');
  END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);

  -- Security: non-super users can only see their subtree
  IF NOT v_is_super THEN
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
    SELECT ARRAY_AGG(x) INTO v_effective_ids
    FROM UNNEST(p_employee_ids) u(x)
    WHERE x = ANY(v_visible);
    IF v_effective_ids IS NULL OR array_length(v_effective_ids, 1) IS NULL THEN
      RETURN '[]'::jsonb;
    END IF;
  ELSE
    v_effective_ids := p_employee_ids;
  END IF;

  RETURN (
    WITH order_data AS (
      SELECT
        resolve_employee_id(o.owner_id) AS eid,
        COUNT(*)::int AS order_count,
        COALESCE(SUM(o.total_amount), 0) AS sales_total
      FROM public.orders o
      WHERE resolve_employee_id(o.owner_id) = ANY(v_effective_ids)
        AND o.created_at::date >= p_from
        AND o.created_at::date <= p_to
        AND public.is_order_in_statistics(o.status)
      GROUP BY resolve_employee_id(o.owner_id)
    ),
    visit_data AS (
      SELECT
        v.employee_id AS eid,
        COUNT(*)::int AS visit_count
      FROM public.visits v
      WHERE v.employee_id = ANY(v_effective_ids)
        AND v.check_in_at::date >= p_from
        AND v.check_in_at::date <= p_to
      GROUP BY v.employee_id
    ),
    customer_data AS (
      SELECT
        resolve_employee_id(c.owner_id) AS eid,
        COUNT(*)::int AS customer_count
      FROM public.customers c
      WHERE resolve_employee_id(c.owner_id) = ANY(v_effective_ids)
        AND c.created_at::date >= p_from
        AND c.created_at::date <= p_to
      GROUP BY resolve_employee_id(c.owner_id)
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'employee_id', e.eid,
        'sales', COALESCE(o.sales_total, 0),
        'orders', COALESCE(o.order_count, 0),
        'visits', COALESCE(v.visit_count, 0),
        'customers', COALESCE(c.customer_count, 0)
      )
    ), '[]'::jsonb)
    FROM (SELECT UNNEST(v_effective_ids) AS eid) e
    LEFT JOIN order_data o ON o.eid = e.eid
    LEFT JOIN visit_data v ON v.eid = e.eid
    LEFT JOIN customer_data c ON c.eid = e.eid
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_employee_activity_summary_batch TO authenticated;

COMMENT ON FUNCTION public.get_employee_activity_summary_batch IS
  'Batch aggregate KPIs for multiple employees. Replaces N individual get_employee_detail_data calls. Returns sales, orders, visits, customers per employee.';

-- ============================================================================
-- 4. get_customer_first_deliveries
--    Lightweight: returns {customer_id, first_delivery_at} for all delivered
--    orders. Used by DeliveredOrdersKPI to avoid the expensive
--    get_statistical_orders(all-time) call.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_customer_first_deliveries(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_is_super boolean;
  v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type != 'employee' THEN
    RETURN jsonb_build_object('error', 'NOT_EMPLOYEE');
  END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);

  IF NOT v_is_super THEN
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'customer_id', o.customer_id,
        'first_delivery_at', MIN(COALESCE(o.delivered_at, o.created_at))
      )
    ), '[]'::jsonb)
    FROM public.orders o
    WHERE o.status = 'delivered'
      AND public.is_order_in_statistics(o.status)
      AND (v_is_super OR o.owner_id = ANY(v_visible))
    GROUP BY o.customer_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_first_deliveries TO authenticated;

COMMENT ON FUNCTION public.get_customer_first_deliveries IS
  'Returns first delivery timestamp per customer. Lightweight replacement for all-time get_statistical_orders call used in new-customer calculation.';
