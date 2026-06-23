-- ============================================================================
-- F2: CANONICAL KPI UNIFICATION
-- Aligns all RPCs to the approved CANONICAL_KPI_DEFINITIONS.md
-- ============================================================================
-- Changes:
--   F1/F2: Orders Count & Sales Value
--     - Use submitted_at (not created_at)
--     - Exclude status IN ('draft', 'cancelled')
--     - Scope by created_by (identity_id)
--   F3: Collections
--     - Collected Amount Today: SUM(amount) WHERE status='collected' AND collected_at>=date
--     - Pending Collections Value: SUM(amount) WHERE status='pending'
--   F4: New Customers
--     - Rename labels on Upper Management Dashboard
--     - Keep both definitions with distinct Arabic labels
--   F5: Presence Hours
--     - All RPCs use schedule-aware calculation
--     - Field reps (flexible/hourly): no break deduction
--     - Office employees (fixed_shift): break deduction
-- ============================================================================

-- ============================================================================
-- 0. Helper: calculate_net_work_hours (schedule-aware)
--    Drop first if exists with different return type
-- ============================================================================

DROP FUNCTION IF EXISTS public.calculate_net_work_hours CASCADE;

CREATE OR REPLACE FUNCTION public.calculate_net_work_hours(p_session_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_schedule_type text;
  v_duration_min numeric;
  v_break_min numeric;
  v_net_min numeric;
BEGIN
  SELECT ws.start_time, ws.end_time, ewp.schedule_type
  INTO v_start_time, v_end_time, v_schedule_type
  FROM workday_sessions ws
  LEFT JOIN employee_work_policies ewp ON ewp.employee_id = ws.employee_id
  WHERE ws.id = p_session_id;

  IF v_start_time IS NULL THEN
    RETURN 0;
  END IF;

  v_end_time := COALESCE(v_end_time, now());
  v_duration_min := EXTRACT(EPOCH FROM (v_end_time - v_start_time)) / 60;

  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(wb.break_end, now()) - wb.break_start)) / 60), 0)
  INTO v_break_min
  FROM workday_breaks wb
  WHERE wb.session_id = p_session_id;

  -- Canonical rule: only subtract breaks for fixed_shift (office employees)
  IF v_schedule_type = 'fixed_shift' THEN
    v_net_min := v_duration_min - v_break_min;
  ELSE
    v_net_min := v_duration_min;
  END IF;

  RETURN GREATEST(v_net_min, 0);
END;
$$;

-- ============================================================================
-- 1. CANONICAL FUNCTION: get_kpi_orders_count
--    Single source of truth for Orders Count + Sales Value
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kpi_orders_count(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_identity_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(order_count bigint, sales_value numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    COUNT(*)::bigint AS order_count,
    COALESCE(SUM(total_amount), 0) AS sales_value
  FROM public.orders
  WHERE submitted_at >= p_start_date
    AND submitted_at < p_end_date
    AND status NOT IN ('draft', 'cancelled')
    AND (p_identity_ids IS NULL OR created_by = ANY(p_identity_ids));
$$;

-- ============================================================================
-- 2. CANONICAL FUNCTION: get_kpi_collections_collected_amount
--    Collected Amount Today (Primary KPI)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kpi_collections_collected_amount(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_employee_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(collected_amount numeric, collected_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    COALESCE(SUM(amount), 0) AS collected_amount,
    COUNT(*)::bigint AS collected_count
  FROM public.collections
  WHERE status = 'collected'
    AND collected_at >= p_start_date
    AND collected_at < p_end_date
    AND (p_employee_ids IS NULL OR created_by = ANY(p_employee_ids) OR owner_id = ANY(p_employee_ids));
$$;

-- ============================================================================
-- 3. CANONICAL FUNCTION: get_kpi_collections_pending_value
--    Pending Collections Value (Snapshot)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kpi_collections_pending_value(
  p_employee_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(pending_amount numeric, pending_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    COALESCE(SUM(amount), 0) AS pending_amount,
    COUNT(*)::bigint AS pending_count
  FROM public.collections
  WHERE status = 'pending'
    AND (p_employee_ids IS NULL OR created_by = ANY(p_employee_ids) OR owner_id = ANY(p_employee_ids));
$$;

-- ============================================================================
-- 4. REWRITE: get_sales_manager_cc (original)
--    Updates orders/sales to canonical, fixes presence hours
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_sales_manager_cc(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_emp_id uuid;
  v_identity_id uuid;
  v_subtree_ids uuid[];
  v_identity_ids uuid[];
  v_interval_seconds int;

  -- Team overview
  v_member_count int;
  v_active_today int;
  v_customer_count int;

  -- Attendance & live tracking
  v_active_sessions jsonb := '[]'::jsonb;
  v_no_start jsonb := '[]'::jsonb;
  v_ended jsonb := '[]'::jsonb;

  -- Orders monitoring (CANONICAL)
  v_today_orders bigint;
  v_today_sales numeric;
  v_month_orders bigint;
  v_month_sales numeric;
  v_pending_followup int;
  v_pending_collections numeric;

  -- Visits monitoring
  v_active_visits int;
  v_today_visits int;
  v_month_visits int;

  -- Customer growth
  v_new_customers_month int;
  v_inactive_customers int;

  -- Per-member performance
  v_member_record record;
  v_members jsonb := '[]'::jsonb;

  -- Team targets
  v_team_sales_target numeric := 0;
  v_team_visits_target numeric := 0;
  v_team_orders_target numeric := 0;
  v_team_new_customers_target numeric := 0;
  v_team_sales_achievement numeric := 0;
  v_team_visits_achievement int := 0;
  v_team_orders_achievement int := 0;
  v_team_new_customers_achievement int := 0;

  -- Personal summary
  v_personal_customer_count int;
  v_personal_month_orders int;
  v_personal_month_sales numeric;
  v_personal_today_orders int;
  v_personal_active_visits int;
  v_personal_today_visits int;
  v_personal_month_visits int;
  v_personal_pending_collections numeric;

  v_target_month int;
  v_target_year int;
  v_interval_seconds int;

  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'attendance.view_team_map') THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  v_emp_id := v_session.employee_id;
  v_identity_id := v_session.identity_id;
  v_target_month := EXTRACT(MONTH FROM CURRENT_DATE)::int;
  v_target_year := EXTRACT(YEAR FROM CURRENT_DATE)::int;

  -- Get subtree employee IDs (manager + all descendants)
  v_subtree_ids := app.get_subtree_ids(v_emp_id);

  -- Get corresponding identity IDs for orders queries
  SELECT COALESCE(array_agg(identity_id), '{}'::uuid[])
  INTO v_identity_ids
  FROM public.employees
  WHERE id = ANY(v_subtree_ids);

  -- Read dynamic interval for connection status
  SELECT location_interval_seconds INTO v_interval_seconds
  FROM public.workday_settings LIMIT 1;
  v_interval_seconds := COALESCE(v_interval_seconds, 300);

  -- ==========================================================================
  -- 1. Team Overview
  -- ==========================================================================

  SELECT count(*) INTO v_member_count FROM unnest(v_subtree_ids);

  SELECT count(DISTINCT employee_id) INTO v_active_today
  FROM public.workday_sessions
  WHERE date = CURRENT_DATE AND status = 'active'
    AND employee_id = ANY(v_subtree_ids);

  SELECT count(*) INTO v_customer_count
  FROM public.customers
  WHERE owner_id = ANY(v_subtree_ids) AND is_active = true;

  -- ==========================================================================
  -- 2. Attendance & Live Tracking (no capability check — own team only)
  -- ==========================================================================

  WITH active_sessions AS (
    SELECT
      wds.id AS session_id,
      wds.employee_id,
      e.full_name AS employee_name,
      wds.start_time,
      wds.status AS session_status,
      EXTRACT(EPOCH FROM (now() - wds.start_time)) / 60 AS duration_minutes
    FROM public.workday_sessions wds
    JOIN public.employees e ON e.id = wds.employee_id
    WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
      AND wds.employee_id = ANY(v_subtree_ids)
  ),
  last_points AS (
    SELECT DISTINCT ON (tp.employee_id)
      tp.employee_id, tp.latitude, tp.longitude, tp.synced_at
    FROM public.tracking_points tp
    WHERE tp.synced_at >= CURRENT_DATE
      AND tp.employee_id = ANY(v_subtree_ids)
    ORDER BY tp.employee_id, tp.synced_at DESC
  ),
  active_breaks AS (
    SELECT wb.session_id, wb.employee_id,
      EXTRACT(EPOCH FROM (now() - wb.break_start)) / 60 AS break_minutes
    FROM public.workday_breaks wb
    WHERE wb.break_end IS NULL
      AND wb.employee_id = ANY(v_subtree_ids)
  ),
  today_orders AS (
    SELECT o.created_by AS identity_id,
      COUNT(*)::int AS order_count,
      COALESCE(SUM(o.total_amount), 0) AS sales_value
    FROM public.orders o
    WHERE o.submitted_at::date = CURRENT_DATE
      AND o.status NOT IN ('draft', 'cancelled')
      AND o.created_by = ANY(v_identity_ids)
    GROUP BY o.created_by
  ),
  total_breaks AS (
    SELECT wb.employee_id,
      COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(wb.break_end, now()) - wb.break_start))), 0) / 60 AS total_break_minutes,
      ewp.schedule_type
    FROM public.workday_breaks wb
    JOIN public.workday_sessions ws ON ws.id = wb.session_id AND ws.date = CURRENT_DATE
    LEFT JOIN public.employee_work_policies ewp ON ewp.employee_id = wb.employee_id
    WHERE wb.employee_id = ANY(v_subtree_ids)
    GROUP BY wb.employee_id, ewp.schedule_type
  )
  SELECT jsonb_agg(jsonb_build_object(
    'employee_id', as2.employee_id,
    'employee_name', as2.employee_name,
    'session_status', as2.session_status,
    'started_at', as2.start_time,
    'duration_minutes', as2.duration_minutes::int,
    -- CANONICAL F5: schedule-aware net minutes
    'net_minutes', GREATEST(
      CASE WHEN COALESCE(tb.schedule_type, 'flexible') = 'fixed_shift'
        THEN as2.duration_minutes::int - COALESCE(tb.total_break_minutes, 0)::int
        ELSE as2.duration_minutes::int
      END, 0),
    'break_minutes', COALESCE(tb.total_break_minutes, 0)::int,
    'work_status',
      CASE WHEN ab.employee_id IS NOT NULL THEN 'on_break'
           WHEN vl.employee_id IS NOT NULL THEN 'on_visit'
           ELSE 'working'
      END,
    'order_count', COALESCE(too.order_count, 0),
    'sales_value', COALESCE(too.sales_value, 0),
    'latitude', lp.latitude,
    'longitude', lp.longitude,
    'last_seen_at', lp.synced_at,
    'connection_status',
      CASE
        WHEN lp.synced_at IS NULL THEN 'no_data'
        WHEN lp.synced_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
        WHEN lp.synced_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
        ELSE 'lost'
      END
  ) ORDER BY
    CASE WHEN ab.employee_id IS NOT NULL THEN 3
         WHEN vl.employee_id IS NOT NULL THEN 2
         ELSE 1
    END
  ) INTO v_active_sessions
  FROM active_sessions as2
  LEFT JOIN active_breaks ab ON ab.session_id = as2.id
  LEFT JOIN LATERAL (
    SELECT v2.id, v2.employee_id FROM public.visits v2
    WHERE v2.employee_id = as2.employee_id
      AND v2.check_in_at::date = CURRENT_DATE
      AND v2.check_out_at IS NULL LIMIT 1
  ) vl ON true
  LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
  LEFT JOIN today_orders too ON too.identity_id = (SELECT identity_id FROM public.employees WHERE id = as2.employee_id)
  LEFT JOIN total_breaks tb ON tb.employee_id = as2.employee_id;

  v_active_sessions := COALESCE(v_active_sessions, '[]'::jsonb);

  -- No-start employees
  SELECT jsonb_agg(jsonb_build_object(
    'employee_id', e.id, 'employee_name', e.full_name
  )) INTO v_no_start
  FROM public.employees e
  WHERE e.id = ANY(v_subtree_ids)
    AND e.is_active = true
    AND e.id NOT IN (
      SELECT employee_id FROM public.workday_sessions WHERE date = CURRENT_DATE
    );

  v_no_start := COALESCE(v_no_start, '[]'::jsonb);

  -- Ended sessions today
  SELECT jsonb_agg(jsonb_build_object(
    'employee_id', wds.employee_id,
    'employee_name', e.full_name,
    'ended_at', wds.end_time,
    'duration_minutes', EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) / 60::int,
    'visit_count', wds.visit_count
  ) ORDER BY wds.end_time DESC) INTO v_ended
  FROM public.workday_sessions wds
  JOIN public.employees e ON e.id = wds.employee_id
  WHERE wds.date = CURRENT_DATE AND wds.status = 'completed'
    AND wds.employee_id = ANY(v_subtree_ids);

  v_ended := COALESCE(v_ended, '[]'::jsonb);

  -- ==========================================================================
  -- 3. Orders Monitoring (CANONICAL F1/F2)
  -- ==========================================================================

  -- Today: submitted_at >= CURRENT_DATE, exclude draft/cancelled
  SELECT order_count, sales_value INTO v_today_orders, v_today_sales
  FROM public.get_kpi_orders_count(
    CURRENT_DATE,
    CURRENT_DATE + interval '1 day',
    v_identity_ids
  );

  -- Month: submitted_at >= month start, exclude draft/cancelled
  SELECT order_count, sales_value INTO v_month_orders, v_month_sales
  FROM public.get_kpi_orders_count(
    date_trunc('month', CURRENT_DATE),
    date_trunc('month', CURRENT_DATE) + interval '1 month',
    v_identity_ids
  );

  -- Pending follow-up (operational, not KPI — keep original logic)
  SELECT count(*) INTO v_pending_followup
  FROM public.orders
  WHERE created_by = ANY(v_identity_ids)
    AND status IN ('draft', 'reviewing', 'submitted');

  -- Pending collections (CANONICAL F3: Pending Collections Value)
  SELECT pending_amount INTO v_pending_collections
  FROM public.get_kpi_collections_pending_value(v_subtree_ids);

  -- ==========================================================================
  -- 4. Visits Monitoring
  -- ==========================================================================

  SELECT count(*) INTO v_active_visits
  FROM public.visits
  WHERE employee_id = ANY(v_subtree_ids) AND status = 'active';

  SELECT count(*) INTO v_today_visits
  FROM public.visits
  WHERE employee_id = ANY(v_subtree_ids) AND created_at >= CURRENT_DATE;

  SELECT count(*) INTO v_month_visits
  FROM public.visits
  WHERE employee_id = ANY(v_subtree_ids)
    AND created_at >= date_trunc('month', CURRENT_DATE)
    AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month';

  -- ==========================================================================
  -- 5. Customer Growth
  -- ==========================================================================

  SELECT count(*) INTO v_new_customers_month
  FROM public.customers
  WHERE owner_id = ANY(v_subtree_ids)
    AND created_at >= date_trunc('month', CURRENT_DATE)
    AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month';

  SELECT count(*) INTO v_inactive_customers
  FROM public.customers
  WHERE owner_id = ANY(v_subtree_ids)
    AND is_active = true
    AND COALESCE(updated_at, created_at) < CURRENT_DATE - 30;

  -- ==========================================================================
  -- 6. Team Performance (per-member KPIs with targets)
  -- ==========================================================================

  FOR v_member_record IN
    SELECT e.id, e.code, e.full_name, e.identity_id
    FROM public.employees e
    WHERE e.id = ANY(v_subtree_ids) AND e.is_active = true
    ORDER BY e.full_name
  LOOP
    DECLARE
      v_mem_customer_count int;
      v_mem_month_orders int;
      v_mem_month_sales numeric;
      v_mem_today_orders int;
      v_mem_today_visits int;
      v_mem_month_visits int;
      v_mem_sales_target numeric;
      v_mem_visits_target numeric;
      v_mem_orders_target numeric;
      v_mem_new_customers_target numeric;
      v_mem_achievement_pct numeric;
    BEGIN
      SELECT count(*) INTO v_mem_customer_count
      FROM public.customers
      WHERE owner_id = v_member_record.id AND is_active = true;

      -- CANONICAL F1/F2: per-member month orders/sales
      SELECT order_count, sales_value INTO v_mem_month_orders, v_mem_month_sales
      FROM public.get_kpi_orders_count(
        date_trunc('month', CURRENT_DATE),
        date_trunc('month', CURRENT_DATE) + interval '1 month',
        ARRAY[v_member_record.identity_id]
      );

      -- CANONICAL F1/F2: per-member today orders
      SELECT order_count INTO v_mem_today_orders
      FROM public.get_kpi_orders_count(
        CURRENT_DATE,
        CURRENT_DATE + interval '1 day',
        ARRAY[v_member_record.identity_id]
      );

      SELECT count(*) INTO v_mem_today_visits
      FROM public.visits
      WHERE employee_id = v_member_record.id AND created_at >= CURRENT_DATE;

      SELECT count(*) INTO v_mem_month_visits
      FROM public.visits
      WHERE employee_id = v_member_record.id
        AND created_at >= date_trunc('month', CURRENT_DATE)
        AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month';

      -- Targets
      SELECT COALESCE(SUM(sales_target), 0), COALESCE(SUM(visits_target), 0),
             COALESCE(SUM(orders_target), 0), COALESCE(SUM(new_customers_target), 0)
      INTO v_mem_sales_target, v_mem_visits_target, v_mem_orders_target, v_mem_new_customers_target
      FROM public.employee_monthly_targets
      WHERE employee_id = v_member_record.id
        AND target_month = v_target_month
        AND target_year = v_target_year;

      -- Achievement %
      IF v_mem_sales_target > 0 THEN
        v_team_sales_achievement := v_team_sales_achievement + (v_mem_month_sales / v_mem_sales_target * 100);
        v_team_sales_target := v_team_sales_target + v_mem_sales_target;
      END IF;
      v_team_visits_achievement := v_team_visits_achievement + v_mem_today_visits;
      v_team_visits_target := v_team_visits_target + v_mem_visits_target;
      v_team_orders_achievement := v_team_orders_achievement + v_mem_today_orders;
      v_team_orders_target := v_team_orders_target + v_mem_orders_target;
      v_team_new_customers_achievement := v_team_new_customers_achievement + v_mem_month_orders;
      v_team_new_customers_target := v_team_new_customers_target + v_mem_new_customers_target;

      v_members := v_members || jsonb_build_object(
        'employee_id', v_member_record.id,
        'employee_code', v_member_record.code,
        'employee_name', v_member_record.full_name,
        'customer_count', v_mem_customer_count,
        'month_orders', v_mem_month_orders,
        'month_sales', v_mem_month_sales,
        'today_orders', v_mem_today_orders,
        'today_visits', v_mem_today_visits,
        'month_visits', v_mem_month_visits,
        'sales_target', v_mem_sales_target,
        'visits_target', v_mem_visits_target,
        'orders_target', v_mem_orders_target,
        'new_customers_target', v_mem_new_customers_target,
        'achievement_pct',
          CASE WHEN v_mem_sales_target > 0
            THEN ROUND((v_mem_month_sales / v_mem_sales_target * 100)::numeric, 1)
            ELSE NULL
          END
      );
    END;
  END LOOP;

  -- ==========================================================================
  -- 7. Personal Summary (manager's own KPIs)
  -- ==========================================================================

  SELECT count(*) INTO v_personal_customer_count
  FROM public.customers
  WHERE owner_id = v_emp_id AND is_active = true;

  -- CANONICAL F1/F2: manager's own month orders/sales
  SELECT order_count, sales_value INTO v_personal_month_orders, v_personal_month_sales
  FROM public.get_kpi_orders_count(
    date_trunc('month', CURRENT_DATE),
    date_trunc('month', CURRENT_DATE) + interval '1 month',
    ARRAY[v_identity_id]
  );

  -- CANONICAL F1/F2: manager's own today orders
  SELECT order_count INTO v_personal_today_orders
  FROM public.get_kpi_orders_count(
    CURRENT_DATE,
    CURRENT_DATE + interval '1 day',
    ARRAY[v_identity_id]
  );

  SELECT count(*) INTO v_personal_active_visits
  FROM public.visits
  WHERE employee_id = ANY(v_subtree_ids) AND status = 'active';

  SELECT count(*) INTO v_personal_today_visits
  FROM public.visits
  WHERE employee_id = v_emp_id AND created_at >= CURRENT_DATE;

  SELECT count(*) INTO v_personal_month_visits
  FROM public.visits
  WHERE employee_id = v_emp_id
    AND created_at >= date_trunc('month', CURRENT_DATE)
    AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month';

  -- CANONICAL F3: pending collections
  SELECT pending_amount INTO v_personal_pending_collections
  FROM public.get_kpi_collections_pending_value(ARRAY[v_emp_id]);

  -- ==========================================================================
  -- 8. Build JSON result
  -- ==========================================================================

  SELECT jsonb_build_object(
    'team_overview', jsonb_build_object(
      'member_count', v_member_count,
      'active_today', v_active_today,
      'customer_count', v_customer_count
    ),
    'attendance', jsonb_build_object(
      'active_sessions', v_active_sessions,
      'no_start_employees', v_no_start,
      'ended_employees', v_ended,
      'active_count', (SELECT COUNT(*) FROM jsonb_array_elements(v_active_sessions)),
      'no_start_count', (SELECT COUNT(*) FROM jsonb_array_elements(v_no_start)),
      'ended_count', (SELECT COUNT(*) FROM jsonb_array_elements(v_ended))
    ),
    'orders', jsonb_build_object(
      'today_orders', v_today_orders,
      'today_sales', v_today_sales,
      'month_orders', v_month_orders,
      'month_sales', v_month_sales,
      'pending_followup', v_pending_followup,
      'pending_collections', v_pending_collections
    ),
    'visits', jsonb_build_object(
      'active_visits', v_active_visits,
      'today_visits', v_today_visits,
      'month_visits', v_month_visits
    ),
    'customers', jsonb_build_object(
      'total_customers', v_customer_count,
      'new_customers_month', v_new_customers_month,
      'inactive_customers', v_inactive_customers
    ),
    'team_performance', jsonb_build_object(
      'members', v_members,
      'team_targets', jsonb_build_object(
        'sales_target', v_team_sales_target,
        'sales_achievement', ROUND(v_team_sales_achievement::numeric, 1),
        'visits_target', v_team_visits_target,
        'visits_achievement', v_team_visits_achievement,
        'orders_target', v_team_orders_target,
        'orders_achievement', v_team_orders_achievement,
        'new_customers_target', v_team_new_customers_target,
        'new_customers_achievement', v_team_new_customers_achievement
      )
    ),
    'personal_summary', jsonb_build_object(
      'customer_count', v_personal_customer_count,
      'month_orders', v_personal_month_orders,
      'month_sales', v_personal_month_sales,
      'today_orders', v_personal_today_orders,
      'active_visits', v_personal_active_visits,
      'today_visits', v_personal_today_visits,
      'month_visits', v_personal_month_visits,
      'pending_collections', v_personal_pending_collections
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 5. REWRITE: get_upper_management_dashboard
--    Uses canonical orders, renames new customer labels
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_upper_management_dashboard(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_emp_id uuid;
  v_month_start date;
  v_company_id uuid;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(p_token) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

  v_emp_id := v_session.employee_id;
  v_month_start := date_trunc('month', CURRENT_DATE)::date;

  SELECT company_id INTO v_company_id FROM public.employees WHERE id = v_emp_id;

  WITH
  -- CANONICAL F1/F2: today total orders (unscoped for executive view)
  today_orders_cte AS (
    SELECT order_count AS today_total_orders, sales_value AS today_total_sales
    FROM public.get_kpi_orders_count(CURRENT_DATE, CURRENT_DATE + interval '1 day', NULL)
  ),
  -- CANONICAL F1/F2: month total orders (unscoped)
  month_orders_cte AS (
    SELECT order_count AS month_total_orders, sales_value AS month_total_sales
    FROM public.get_kpi_orders_count(v_month_start::timestamptz, (v_month_start + interval '1 month')::timestamptz, NULL)
  ),
  -- today_total_orders (kept for backward compat, now same as today_orders_cte)
  today_total AS (
    SELECT order_count AS val FROM public.get_kpi_orders_count(CURRENT_DATE, CURRENT_DATE + interval '1 day', NULL)
  ),
  -- daily_sales_total (kept for backward compat, now same canonical definition)
  daily_sales AS (
    SELECT sales_value AS val FROM public.get_kpi_orders_count(CURRENT_DATE, CURRENT_DATE + interval '1 day', NULL)
  ),
  -- CANONICAL F4: New Customers (Registered — تم تسجيلهم)
  v_new_customers AS (
    SELECT COUNT(*) AS val FROM public.customers WHERE created_at >= v_month_start
  ),
  -- CANONICAL F4: New Customers (First Delivered Order — أول طلب تم تسليمه)
  company_new_customers_actual AS (
    SELECT COUNT(DISTINCT c.id) AS val
    FROM public.customers c
    WHERE EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.customer_id = c.id
        AND o.status = 'delivered'
        AND o.delivered_at >= v_month_start
    )
  ),
  today_visits_cte AS (
    SELECT COUNT(*) AS val FROM public.visits WHERE created_at >= CURRENT_DATE
  ),
  active_visits_cte AS (
    SELECT COUNT(*) AS val FROM public.visits WHERE status = 'active'
  ),
  company_profile_cte AS (
    SELECT company_name, commercial_registration_no, tax_no, logo_url
    FROM public.company_profile LIMIT 1
  ),
  -- Company monthly targets
  company_targets_cte AS (
    SELECT sales_target, visits_target, orders_target, new_customers_target
    FROM public.company_monthly_targets
    WHERE target_month = EXTRACT(MONTH FROM CURRENT_DATE)::int
      AND target_year = EXTRACT(YEAR FROM CURRENT_DATE)::int
    LIMIT 1
  ),
  -- Top/Bottom performers by sales value (CANONICAL)
  top_reps_cte AS (
    SELECT e.full_name, kpi.sales_value
    FROM public.employees e
    CROSS JOIN LATERAL (
      SELECT sales_value FROM public.get_kpi_orders_count(
        v_month_start::timestamptz,
        (v_month_start + interval '1 month')::timestamptz,
        ARRAY[e.identity_id]
      )
    ) kpi
    WHERE e.is_active = true AND e.manager_id IS NOT NULL
    ORDER BY kpi.sales_value DESC
    LIMIT 5
  ),
  bottom_reps_cte AS (
    SELECT e.full_name, kpi.sales_value
    FROM public.employees e
    CROSS JOIN LATERAL (
      SELECT sales_value FROM public.get_kpi_orders_count(
        v_month_start::timestamptz,
        (v_month_start + interval '1 month')::timestamptz,
        ARRAY[e.identity_id]
      )
    ) kpi
    WHERE e.is_active = true AND e.manager_id IS NOT NULL
    ORDER BY kpi.sales_value ASC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'today_total_orders', (SELECT val FROM today_total),
    'today_total_sales', (SELECT val FROM daily_sales),
    'daily_sales', jsonb_build_object(
      'total', (SELECT val FROM daily_sales),
      'count', (SELECT val FROM today_total)
    ),
    'new_customers', jsonb_build_object(
      -- CANONICAL F4: distinct Arabic labels
      'تم تسجيلهم', (SELECT val FROM v_new_customers),
      'أول طلب تم تسليمه', (SELECT val FROM company_new_customers_actual)
    ),
    'today_visits', (SELECT val FROM today_visits_cte),
    'active_visits', (SELECT val FROM active_visits_cte),
    'today_total_orders_unscoped', (SELECT today_total_orders FROM today_orders_cte),
    'today_total_sales_unscoped', (SELECT today_total_sales FROM today_orders_cte),
    'month_total_orders', (SELECT month_total_orders FROM month_orders_cte),
    'month_total_sales', (SELECT month_total_sales FROM month_orders_cte),
    'company_name', (SELECT company_name FROM company_profile_cte),
    'commercial_registration_no', (SELECT commercial_registration_no FROM company_profile_cte),
    'tax_no', (SELECT tax_no FROM company_profile_cte),
    'logo_url', (SELECT logo_url FROM company_profile_cte),
    'company_targets', COALESCE((SELECT row_to_json(cte.*)::jsonb FROM company_targets_cte cte), '{}'::jsonb),
    'best_performers', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', full_name, 'sales', sales_value)) FROM top_reps_cte), '[]'::jsonb),
    'weakest_performers', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', full_name, 'sales', sales_value)) FROM bottom_reps_cte), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 6. REWRITE: get_dashboard_management
--    Uses canonical orders count
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_management(p_token uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_visible uuid[];
  v_identity_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;

  v_visible := public.get_visible_employee_ids(p_token);

  SELECT COALESCE(array_agg(e.identity_id), '{}'::uuid[])
  INTO v_identity_ids
  FROM public.employees e
  WHERE e.id = ANY(v_visible);

  RETURN (SELECT json_build_object(
    'total_orders', (SELECT order_count FROM public.get_kpi_orders_count('1970-01-01'::timestamptz, '9999-12-31'::timestamptz, v_identity_ids)),
    'pending_orders', (SELECT COUNT(*)::int FROM public.orders WHERE status IN ('reviewing', 'submitted', 'approved', 'preparing', 'prepared', 'dispatched') AND (v_visible IS NULL OR owner_id = ANY(v_visible))),
    'approved_orders', (SELECT COUNT(*)::int FROM public.orders WHERE status = 'approved' AND (v_visible IS NULL OR owner_id = ANY(v_visible))),
    'total_customers', (SELECT COUNT(*)::int FROM public.customers WHERE is_active = true),
    'active_visits', (SELECT COUNT(*)::int FROM public.visits WHERE status = 'active' AND (v_visible IS NULL OR employee_id = ANY(v_visible))),
    -- CANONICAL F3: Pending Collections Value (amount, not count)
    'pending_collections', (SELECT pending_amount FROM public.get_kpi_collections_pending_value(v_visible)),
    'pending_collections_count', (SELECT pending_count FROM public.get_kpi_collections_pending_value(v_visible)),
    'pending_returns', (SELECT COUNT(*)::int FROM public.returns WHERE status = 'pending' AND (v_visible IS NULL OR employee_id = ANY(v_visible))),
    -- CANONICAL F1/F2: today orders
    'today_orders', (SELECT order_count FROM public.get_kpi_orders_count(CURRENT_DATE, CURRENT_DATE + interval '1 day', v_identity_ids)),
    -- CANONICAL F1/F2: today sales value
    'today_sales', (SELECT sales_value FROM public.get_kpi_orders_count(CURRENT_DATE, CURRENT_DATE + interval '1 day', v_identity_ids)),
    'today_visits', (SELECT COUNT(*)::int FROM public.visits WHERE created_at >= CURRENT_DATE AND (v_visible IS NULL OR employee_id = ANY(v_visible)))
  ));
END;
$$;

-- ============================================================================
-- 7. REWRITE: get_dashboard_sales
--    Uses canonical orders count
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_sales(p_token uuid, p_inactive_days int DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_visible uuid[];
  v_identity_ids uuid[];
  v_today_orders bigint;
  v_pending_followup int;
  v_inactive_customers int;
  v_today_visits int;
  v_today_collections_count bigint;
  v_today_collections_amount numeric;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;

  v_visible := public.get_visible_employee_ids(p_token);

  SELECT COALESCE(array_agg(e.identity_id), '{}'::uuid[])
  INTO v_identity_ids
  FROM public.employees e
  WHERE e.id = ANY(v_visible);

  -- CANONICAL F1/F2: today orders
  SELECT order_count INTO v_today_orders
  FROM public.get_kpi_orders_count(CURRENT_DATE, CURRENT_DATE + interval '1 day', v_identity_ids);

  SELECT COUNT(*)::int INTO v_pending_followup
  FROM public.orders
  WHERE created_by = ANY(v_identity_ids) AND status IN ('draft', 'reviewing', 'submitted');

  SELECT COUNT(*)::int INTO v_inactive_customers
  FROM public.customers
  WHERE owner_id = ANY(v_visible)
    AND is_active = true
    AND COALESCE(updated_at, created_at) < CURRENT_DATE - p_inactive_days;

  SELECT COUNT(*)::int INTO v_today_visits
  FROM public.visits
  WHERE employee_id = ANY(v_visible) AND created_at >= CURRENT_DATE;

  -- CANONICAL F3: Collected Amount Today
  SELECT collected_count, collected_amount
  INTO v_today_collections_count, v_today_collections_amount
  FROM public.get_kpi_collections_collected_amount(CURRENT_DATE, CURRENT_DATE + interval '1 day', v_visible);

  RETURN json_build_object(
    'today_orders', v_today_orders,
    'pending_followup', v_pending_followup,
    'inactive_customers', v_inactive_customers,
    'today_visits', v_today_visits,
    -- CANONICAL F3: Collected Amount Today (value is primary, count is secondary)
    'today_collections', v_today_collections_amount,
    'today_collections_count', v_today_collections_count
  );
END;
$$;

-- ============================================================================
-- 8. REWRITE: get_completed_workdays_history
--    Uses canonical orders/collections/presence calculations
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_completed_workdays_history CASCADE;

CREATE OR REPLACE FUNCTION public.get_completed_workdays_history(
    p_token uuid,
    p_from date,
    p_to date,
    p_search text DEFAULT NULL,
    p_sort_by text DEFAULT 'total_net_minutes',
    p_sort_order text DEFAULT 'desc',
    p_page int DEFAULT 1,
    p_per_page int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_subtree_ids uuid[];
    v_total_employees int := 0;
    v_offset int;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'attendance.view_history') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;

    v_offset := (p_page - 1) * p_per_page;

    WITH
    visible_employees AS (
        SELECT e.id, e.full_name, e.code, e.identity_id, rpl.name AS role_name
        FROM public.employees e
        LEFT JOIN LATERAL (
            SELECT r.name FROM public.employee_roles er
            JOIN public.roles r ON r.id = er.role_id
            WHERE er.employee_id = e.id
            LIMIT 1
        ) rpl ON true
        WHERE e.is_active = true
        AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        AND (
            p_search IS NULL
            OR e.full_name ILIKE '%' || p_search || '%'
            OR e.code ILIKE '%' || p_search || '%'
        )
    ),
    total_count AS (
        SELECT COUNT(*)::int AS cnt FROM visible_employees
    ),
    -- CANONICAL F5: schedule-aware net minutes
    session_kpis AS (
        SELECT
            wds.employee_id,
            wds.date,
            wds.start_time,
            wds.end_time,
            wds.status,
            wds.attendance_status,
            wds.late_minutes,
            wds.early_departure_minutes,
            wds.total_distance_meters,
            wds.visit_count,
            GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60) AS duration_minutes,
            COALESCE(wb.break_minutes, 0) AS break_minutes,
            COALESCE(wb.break_count, 0) AS break_count,
            ewp.schedule_type,
            COALESCE(od.order_count, 0) AS order_count,
            COALESCE(od.sales_value, 0) AS sales_value,
            COALESCE(cd.canonical_collection_count, 0) AS collection_count,
            COALESCE(cd.canonical_collected_amount, 0) AS collection_amount,
            COALESCE(nd.new_customer_count, 0) AS new_customer_count,
            COALESCE(tp.tracking_points_count, 0) AS tracking_points_count
        FROM public.workday_sessions wds
        JOIN visible_employees ve ON ve.id = wds.employee_id
        LEFT JOIN public.employee_work_policies ewp ON ewp.employee_id = wds.employee_id
        LEFT JOIN (
            SELECT wb2.session_id,
                COUNT(*)::int AS break_count,
                COALESCE(SUM(COALESCE(wb2.duration_seconds, 0)), 0) / 60.0 AS break_minutes
            FROM public.workday_breaks wb2
            GROUP BY wb2.session_id
        ) wb ON wb.session_id = wds.id
        -- CANONICAL F1/F2: orders by created_by (identity_id), submitted_at, exclude draft/cancelled
        LEFT JOIN (
            SELECT o.created_by,
                o.submitted_at::date AS d,
                COUNT(*)::int AS order_count,
                COALESCE(SUM(o.total_amount), 0) AS sales_value
            FROM public.orders o
            WHERE o.status NOT IN ('draft', 'cancelled')
            GROUP BY o.created_by, o.submitted_at::date
        ) od ON od.created_by = ve.identity_id AND od.d = wds.date
        -- CANONICAL F3: collections (collected status only for amount; all statuses for count)
        LEFT JOIN (
            SELECT c.created_by,
                c.collected_at::date AS d,
                COUNT(*)::int AS canonical_collection_count,
                COALESCE(SUM(CASE WHEN c.status = 'collected' THEN c.amount ELSE 0 END), 0) AS canonical_collected_amount
            FROM public.collections c
            GROUP BY c.created_by, c.collected_at::date
        ) cd ON cd.created_by = ve.identity_id AND cd.d = wds.date
        LEFT JOIN (
            SELECT c2.owner_id, c2.created_at::date AS d,
                COUNT(*)::int AS new_customer_count
            FROM public.customers c2
            GROUP BY c2.owner_id, c2.created_at::date
        ) nd ON nd.owner_id = wds.employee_id AND nd.d = wds.date
        LEFT JOIN (
            SELECT tp.session_id,
                COUNT(*)::int AS tracking_points_count
            FROM public.tracking_points tp
            GROUP BY tp.session_id
        ) tp ON tp.session_id = wds.id
        WHERE wds.date >= p_from AND wds.date <= p_to
          AND wds.status = 'completed'
    ),
    emp_aggregates AS (
        SELECT
            sk.employee_id,
            COUNT(*)::int AS total_days,
            -- CANONICAL F5: schedule-aware net minutes
            COALESCE(SUM(
                GREATEST(COALESCE(sk.duration_minutes, 0) -
                    CASE WHEN COALESCE(sk.schedule_type, 'flexible') = 'fixed_shift'
                        THEN COALESCE(sk.break_minutes, 0)
                        ELSE 0
                    END, 0)
            )::int, 0) AS total_net_minutes,
            COALESCE(AVG(
                GREATEST(COALESCE(sk.duration_minutes, 0) -
                    CASE WHEN COALESCE(sk.schedule_type, 'flexible') = 'fixed_shift'
                        THEN COALESCE(sk.break_minutes, 0)
                        ELSE 0
                    END, 0)
            )::int, 0) AS avg_net_minutes,
            COALESCE(SUM(sk.order_count)::int, 0) AS total_orders,
            COALESCE(SUM(sk.sales_value)::numeric, 0) AS total_sales_value,
            COALESCE(SUM(sk.collection_count)::int, 0) AS total_collection_count,
            COALESCE(SUM(sk.collection_amount)::numeric, 0) AS total_collection_amount,
            COALESCE(SUM(sk.new_customer_count)::int, 0) AS total_new_customers,
            COALESCE(SUM(sk.visit_count)::int, 0) AS total_visits,
            COALESCE(SUM(sk.total_distance_meters)::int, 0) AS total_distance_meters,
            COALESCE(SUM(sk.tracking_points_count)::int, 0) AS total_tracking_points,
            COUNT(*) FILTER (WHERE sk.attendance_status = 'late')::int AS late_count,
            COUNT(*) FILTER (WHERE sk.attendance_status = 'ontime')::int AS ontime_count,
            COUNT(*) FILTER (WHERE sk.attendance_status = 'early_departure')::int AS early_departure_count
        FROM session_kpis sk
        GROUP BY sk.employee_id
    ),
    target_months AS (
        SELECT generate_series(
            date_trunc('month', p_from)::date,
            date_trunc('month', p_to)::date,
            '1 month'::interval
        )::date AS month_start
    ),
    month_ranges AS (
        SELECT
            tm.month_start,
            (tm.month_start + INTERVAL '1 month' - INTERVAL '1 day')::date AS month_end,
            EXTRACT(DAY FROM (tm.month_start + INTERVAL '1 month' - INTERVAL '1 day'))::int AS days_in_month,
            GREATEST(0, (LEAST(p_to, (tm.month_start + INTERVAL '1 month' - INTERVAL '1 day')::date) - GREATEST(p_from, tm.month_start) + 1))::int AS overlap_days
        FROM target_months tm
    ),
    prorated_targets AS (
        SELECT
            emt.employee_id,
            COALESCE(SUM(
                CASE WHEN mr.overlap_days > 0 AND emt.sales_target > 0
                    THEN (emt.sales_target::numeric / mr.days_in_month) * mr.overlap_days
                    ELSE 0 END
            ), 0) AS sales_target,
            COALESCE(SUM(
                CASE WHEN mr.overlap_days > 0 AND emt.visits_target > 0
                    THEN (emt.visits_target::numeric / mr.days_in_month) * mr.overlap_days
                    ELSE 0 END
            ), 0) AS visits_target,
            COALESCE(SUM(
                CASE WHEN mr.overlap_days > 0 AND emt.orders_target > 0
                    THEN (emt.orders_target::numeric / mr.days_in_month) * mr.overlap_days
                    ELSE 0 END
            ), 0) AS orders_target,
            COALESCE(SUM(
                CASE WHEN mr.overlap_days > 0 AND emt.collections_target > 0
                    THEN (emt.collections_target::numeric / mr.days_in_month) * mr.overlap_days
                    ELSE 0 END
            ), 0) AS collections_target,
            COALESCE(SUM(
                CASE WHEN mr.overlap_days > 0 AND emt.new_customers_target > 0
                    THEN (emt.new_customers_target::numeric / mr.days_in_month) * mr.overlap_days
                    ELSE 0 END
            ), 0) AS new_customers_target
        FROM public.employee_monthly_targets emt
        CROSS JOIN month_ranges mr
        WHERE emt.target_month = EXTRACT(MONTH FROM mr.month_start)::int
          AND emt.target_year = EXTRACT(YEAR FROM mr.month_start)::int
        GROUP BY emt.employee_id
    ),
    paginated_employees AS (
        SELECT
            ve.id,
            ve.full_name,
            ve.code,
            ve.role_name,
            ea.total_days,
            ea.total_net_minutes,
            ea.avg_net_minutes,
            ea.total_orders,
            ea.total_sales_value,
            ea.total_collection_count,
            ea.total_collection_amount,
            ea.total_new_customers,
            ea.total_visits,
            ea.total_distance_meters,
            ea.total_tracking_points,
            ea.late_count,
            ea.ontime_count,
            ea.early_departure_count,
            CASE WHEN pt.sales_target > 0 THEN ROUND(pt.sales_target::numeric, 2) ELSE NULL END AS sales_target,
            CASE WHEN pt.visits_target > 0 THEN ROUND(pt.visits_target::numeric, 2) ELSE NULL END AS visits_target,
            CASE WHEN pt.orders_target > 0 THEN ROUND(pt.orders_target::numeric, 2) ELSE NULL END AS orders_target,
            CASE WHEN pt.collections_target > 0 THEN ROUND(pt.collections_target::numeric, 2) ELSE NULL END AS collections_target,
            CASE WHEN pt.new_customers_target > 0 THEN ROUND(pt.new_customers_target::numeric, 2) ELSE NULL END AS new_customers_target,
            CASE WHEN COALESCE(pt.sales_target, 0) > 0 THEN ROUND((ea.total_sales_value / pt.sales_target * 100)::numeric, 1) ELSE NULL END AS sales_achievement_pct,
            CASE WHEN COALESCE(pt.visits_target, 0) > 0 THEN ROUND((ea.total_visits::numeric / pt.visits_target * 100)::numeric, 1) ELSE NULL END AS visits_achievement_pct,
            CASE WHEN COALESCE(pt.orders_target, 0) > 0 THEN ROUND((ea.total_orders::numeric / pt.orders_target * 100)::numeric, 1) ELSE NULL END AS orders_achievement_pct,
            CASE WHEN COALESCE(pt.collections_target, 0) > 0 THEN ROUND((ea.total_collection_amount / pt.collections_target * 100)::numeric, 1) ELSE NULL END AS collections_achievement_pct,
            CASE WHEN COALESCE(pt.new_customers_target, 0) > 0 THEN ROUND((ea.total_new_customers::numeric / pt.new_customers_target * 100)::numeric, 1) ELSE NULL END AS new_customers_achievement_pct,
            ROW_NUMBER() OVER (
                ORDER BY
                    CASE WHEN p_sort_by = 'total_net_minutes' AND p_sort_order = 'desc' THEN ea.total_net_minutes END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_net_minutes' AND p_sort_order = 'asc' THEN ea.total_net_minutes END ASC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_sales_value' AND p_sort_order = 'desc' THEN ea.total_sales_value END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_sales_value' AND p_sort_order = 'asc' THEN ea.total_sales_value END ASC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_orders' AND p_sort_order = 'desc' THEN ea.total_orders END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_orders' AND p_sort_order = 'asc' THEN ea.total_orders END ASC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_visits' AND p_sort_order = 'desc' THEN ea.total_visits END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_visits' AND p_sort_order = 'asc' THEN ea.total_visits END ASC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_collection_amount' AND p_sort_order = 'desc' THEN ea.total_collection_amount END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_collection_amount' AND p_sort_order = 'asc' THEN ea.total_collection_amount END ASC NULLS LAST,
                    ea.total_net_minutes DESC NULLS LAST
            ) AS sort_rank
        FROM visible_employees ve
        JOIN emp_aggregates ea ON ea.employee_id = ve.id
        LEFT JOIN prorated_targets pt ON pt.employee_id = ve.id
    ),
    total_emps AS (
        SELECT COUNT(*)::int AS cnt FROM paginated_employees
    ),
    paginated_employee_ids AS (
        SELECT pe.id, pe.full_name, pe.code, pe.role_name,
            pe.total_days, pe.total_net_minutes, pe.avg_net_minutes,
            pe.total_orders, pe.total_sales_value,
            pe.total_collection_count, pe.total_collection_amount,
            pe.total_new_customers, pe.total_visits,
            pe.total_distance_meters, pe.total_tracking_points,
            pe.late_count, pe.ontime_count, pe.early_departure_count,
            pe.sales_target, pe.visits_target, pe.orders_target,
            pe.collections_target, pe.new_customers_target,
            pe.sales_achievement_pct, pe.visits_achievement_pct,
            pe.orders_achievement_pct, pe.collections_achievement_pct,
            pe.new_customers_achievement_pct
        FROM paginated_employees pe
        ORDER BY pe.sort_rank
        LIMIT p_per_page OFFSET v_offset
    ),
    paginated_sessions AS (
        SELECT
            sk.employee_id,
            sk.date, sk.start_time, sk.end_time,
            -- CANONICAL F5: schedule-aware net minutes
            GREATEST(COALESCE(sk.duration_minutes, 0) -
                CASE WHEN COALESCE(sk.schedule_type, 'flexible') = 'fixed_shift'
                    THEN COALESCE(sk.break_minutes, 0)
                    ELSE 0
                END, 0)::int AS net_minutes,
            sk.break_minutes::int,
            sk.break_count,
            sk.visit_count,
            sk.order_count,
            sk.sales_value,
            sk.collection_count,
            sk.collection_amount,
            sk.new_customer_count,
            sk.attendance_status,
            sk.late_minutes,
            sk.early_departure_minutes,
            COALESCE(sk.total_distance_meters, 0)::int AS distance_meters,
            sk.tracking_points_count
        FROM session_kpis sk
        WHERE sk.employee_id = ANY(SELECT pei.id FROM paginated_employee_ids pei)
    ),
    grand_totals AS (
        SELECT
            COUNT(*) FILTER (WHERE status = 'completed')::int AS total_days,
            -- CANONICAL F5: schedule-aware
            COALESCE(SUM(GREATEST(COALESCE(duration_minutes, 0) -
                CASE WHEN COALESCE(schedule_type, 'flexible') = 'fixed_shift'
                    THEN COALESCE(break_minutes, 0)
                    ELSE 0
                END, 0))::int, 0) AS total_net_minutes,
            COALESCE(SUM(order_count)::int, 0) AS total_orders,
            COALESCE(SUM(sales_value)::numeric, 0) AS total_sales,
            COALESCE(SUM(collection_count)::int, 0) AS total_collections,
            COALESCE(SUM(collection_amount)::numeric, 0) AS total_collection_amount,
            COALESCE(SUM(new_customer_count)::int, 0) AS total_new_customers,
            COALESCE(SUM(visit_count)::int, 0) AS total_visits
        FROM session_kpis
    )
    SELECT jsonb_build_object(
        'employees', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                'employee_id', pei.id,
                'employee_name', pei.full_name,
                'employee_code', pei.code,
                'role_name', pei.role_name,
                'summary', jsonb_build_object(
                    'total_days', pei.total_days,
                    'total_net_minutes', pei.total_net_minutes,
                    'avg_net_minutes', pei.avg_net_minutes,
                    'total_orders', pei.total_orders,
                    'total_sales_value', pei.total_sales_value,
                    'total_collection_count', pei.total_collection_count,
                    'total_collection_amount', pei.total_collection_amount,
                    'total_new_customers', pei.total_new_customers,
                    'total_visits', pei.total_visits,
                    'total_distance_meters', pei.total_distance_meters,
                    'total_tracking_points', pei.total_tracking_points,
                    'late_count', pei.late_count,
                    'ontime_count', pei.ontime_count,
                    'early_departure_count', pei.early_departure_count
                ),
                'targets', jsonb_build_object(
                    'sales_target', pei.sales_target,
                    'visits_target', pei.visits_target,
                    'orders_target', pei.orders_target,
                    'collections_target', pei.collections_target,
                    'new_customers_target', pei.new_customers_target
                ),
                'achievement', jsonb_build_object(
                    'sales_achievement_pct', pei.sales_achievement_pct,
                    'visits_achievement_pct', pei.visits_achievement_pct,
                    'orders_achievement_pct', pei.orders_achievement_pct,
                    'collections_achievement_pct', pei.collections_achievement_pct,
                    'new_customers_achievement_pct', pei.new_customers_achievement_pct
                ),
                'sessions', COALESCE(
                    (SELECT jsonb_agg(jsonb_build_object(
                        'date', ps.date,
                        'start_time', ps.start_time,
                        'end_time', ps.end_time,
                        'net_minutes', ps.net_minutes,
                        'break_minutes', ps.break_minutes,
                        'break_count', ps.break_count,
                        'visit_count', ps.visit_count,
                        'order_count', ps.order_count,
                        'sales_value', ps.sales_value,
                        'collection_count', ps.collection_count,
                        'collection_amount', ps.collection_amount,
                        'new_customer_count', ps.new_customer_count,
                        'attendance_status', ps.attendance_status,
                        'late_minutes', ps.late_minutes,
                        'early_departure_minutes', ps.early_departure_minutes,
                        'distance_meters', ps.distance_meters,
                        'tracking_points_count', ps.tracking_points_count
                    ) ORDER BY ps.date DESC)
                    FROM paginated_sessions ps
                    WHERE ps.employee_id = pei.id
                ), '[]'::jsonb)
            ) ORDER BY pei.sort_rank)
            FROM paginated_employee_ids pei
        ), '[]'::jsonb),
        'totals', (SELECT row_to_json(gt.*)::jsonb FROM grand_totals gt),
        'pagination', jsonb_build_object(
            'page', p_page,
            'per_page', p_per_page,
            'total', (SELECT cnt FROM total_count),
            'total_pages', GREATEST(1, CEIL((SELECT cnt::numeric FROM total_count) / p_per_page)::int)
        )
    ) INTO v_result;

    RETURN v_result;
END;
$function$;
