-- ============================================================================
-- Sales Manager Command Center RPC
-- Returns comprehensive data for 8 sections of the Sales Manager Command
-- Center page, scoped to the manager's subtree via app.get_subtree_ids().
-- Does NOT require attendance.live_monitor — Sales Managers see their own
-- team's live tracking by default.
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

  -- Team overview
  v_member_count int;
  v_active_today int;
  v_customer_count int;

  -- Attendance & live tracking
  v_active_sessions jsonb := '[]'::jsonb;
  v_no_start jsonb := '[]'::jsonb;
  v_ended jsonb := '[]'::jsonb;

  -- Orders monitoring
  v_today_orders int;
  v_today_sales numeric;
  v_month_orders int;
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

  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

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
      tp.employee_id, tp.latitude, tp.longitude, tp.recorded_at
    FROM public.tracking_points tp
    WHERE tp.recorded_at >= CURRENT_DATE
      AND tp.employee_id = ANY(v_subtree_ids)
    ORDER BY tp.employee_id, tp.recorded_at DESC
  ),
  active_breaks AS (
    SELECT wb.session_id, wb.employee_id,
      EXTRACT(EPOCH FROM (now() - wb.break_start)) / 60 AS break_minutes
    FROM public.workday_breaks wb
    WHERE wb.break_end IS NULL
      AND wb.employee_id = ANY(v_subtree_ids)
  ),
  today_orders AS (
    SELECT o.owner_id AS employee_id,
      COUNT(*)::int AS order_count,
      COALESCE(SUM(o.total_amount), 0) AS sales_value
    FROM public.orders o
    WHERE o.created_at::date = CURRENT_DATE
      AND o.owner_id = ANY(v_subtree_ids)
    GROUP BY o.owner_id
  ),
  total_breaks AS (
    SELECT wb.employee_id,
      COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(wb.break_end, now()) - wb.break_start))), 0) / 60 AS total_break_minutes
    FROM public.workday_breaks wb
    JOIN public.workday_sessions ws ON ws.id = wb.session_id AND ws.date = CURRENT_DATE
    WHERE wb.employee_id = ANY(v_subtree_ids)
    GROUP BY wb.employee_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'employee_id', as2.employee_id,
    'employee_name', as2.employee_name,
    'session_status', as2.session_status,
    'started_at', as2.start_time,
    'duration_minutes', as2.duration_minutes::int,
    'net_minutes', GREATEST(as2.duration_minutes::int - COALESCE(tb.total_break_minutes, 0)::int, 0),
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
    'last_seen_at', lp.recorded_at,
    'connection_status',
      CASE
        WHEN lp.recorded_at IS NULL THEN 'no_data'
        WHEN lp.recorded_at > now() - interval '5 minutes' THEN 'connected'
        WHEN lp.recorded_at > now() - interval '25 minutes' THEN 'delayed'
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
  LEFT JOIN today_orders too ON too.employee_id = as2.employee_id
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
  -- 3. Orders Monitoring
  -- ==========================================================================

  SELECT count(*), COALESCE(sum(total_amount), 0)
  INTO v_today_orders, v_today_sales
  FROM public.orders
  WHERE created_by = ANY(v_identity_ids)
    AND created_at >= CURRENT_DATE;

  SELECT count(*), COALESCE(sum(total_amount), 0)
  INTO v_month_orders, v_month_sales
  FROM public.orders
  WHERE created_by = ANY(v_identity_ids)
    AND created_at >= date_trunc('month', CURRENT_DATE)
    AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month';

  SELECT count(*) INTO v_pending_followup
  FROM public.orders
  WHERE created_by = ANY(v_identity_ids)
    AND status IN ('draft', 'reviewing', 'submitted');

  SELECT COALESCE(sum(amount), 0) INTO v_pending_collections
  FROM public.collections
  WHERE created_by = ANY(v_subtree_ids) AND status = 'pending';

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

      SELECT count(*), COALESCE(sum(total_amount), 0)
      INTO v_mem_month_orders, v_mem_month_sales
      FROM public.orders
      WHERE created_by = v_member_record.identity_id
        AND created_at >= date_trunc('month', CURRENT_DATE)
        AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month';

      SELECT count(*) INTO v_mem_today_orders
      FROM public.orders
      WHERE created_by = v_member_record.identity_id
        AND created_at >= CURRENT_DATE;

      SELECT count(*) INTO v_mem_today_visits
      FROM public.visits
      WHERE employee_id = v_member_record.id
        AND created_at >= CURRENT_DATE;

      SELECT count(*) INTO v_mem_month_visits
      FROM public.visits
      WHERE employee_id = v_member_record.id
        AND created_at >= date_trunc('month', CURRENT_DATE)
        AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month';

      SELECT
        COALESCE(sales_target, 0),
        COALESCE(visits_target, 0),
        COALESCE(orders_target, 0),
        COALESCE(new_customers_target, 0)
      INTO
        v_mem_sales_target,
        v_mem_visits_target,
        v_mem_orders_target,
        v_mem_new_customers_target
      FROM public.employee_monthly_targets
      WHERE employee_id = v_member_record.id
        AND target_month = v_target_month
        AND target_year = v_target_year;

      IF v_mem_sales_target > 0 THEN
        v_mem_achievement_pct := ROUND((v_mem_month_sales / v_mem_sales_target * 100)::numeric, 1);
      ELSE
        v_mem_achievement_pct := 0;
      END IF;

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
        'achievement_pct', v_mem_achievement_pct
      );

      v_team_sales_target := v_team_sales_target + COALESCE(v_mem_sales_target, 0);
      v_team_visits_target := v_team_visits_target + COALESCE(v_mem_visits_target, 0);
      v_team_orders_target := v_team_orders_target + COALESCE(v_mem_orders_target, 0);
      v_team_new_customers_target := v_team_new_customers_target + COALESCE(v_mem_new_customers_target, 0);
      v_team_sales_achievement := v_team_sales_achievement + v_mem_month_sales;
      v_team_visits_achievement := v_team_visits_achievement + v_mem_month_visits;
      v_team_orders_achievement := v_team_orders_achievement + v_mem_month_orders;
      v_team_new_customers_achievement := v_team_new_customers_achievement + COALESCE(v_mem_new_customers_target, 0);
    END;
  END LOOP;

  -- ==========================================================================
  -- 7. Personal Summary (manager's own data)
  -- ==========================================================================

  SELECT count(*) INTO v_personal_customer_count
  FROM public.customers
  WHERE owner_id = v_emp_id AND is_active = true;

  SELECT count(*), COALESCE(sum(total_amount), 0)
  INTO v_personal_month_orders, v_personal_month_sales
  FROM public.orders
  WHERE created_by = v_identity_id
    AND created_at >= date_trunc('month', CURRENT_DATE)
    AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month';

  SELECT count(*) INTO v_personal_today_orders
  FROM public.orders
  WHERE created_by = v_identity_id AND created_at >= CURRENT_DATE;

  SELECT count(*) INTO v_personal_active_visits
  FROM public.visits
  WHERE employee_id = v_emp_id AND status = 'active';

  SELECT count(*) INTO v_personal_today_visits
  FROM public.visits
  WHERE employee_id = v_emp_id AND created_at >= CURRENT_DATE;

  SELECT count(*) INTO v_personal_month_visits
  FROM public.visits
  WHERE employee_id = v_emp_id
    AND created_at >= date_trunc('month', CURRENT_DATE)
    AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month';

  SELECT COALESCE(sum(amount), 0) INTO v_personal_pending_collections
  FROM public.collections
  WHERE created_by = v_emp_id AND status = 'pending';

  -- ==========================================================================
  -- Build final result
  -- ==========================================================================

  v_result := jsonb_build_object(
    'team_overview', jsonb_build_object(
      'member_count', v_member_count,
      'active_today', v_active_today,
      'customer_count', v_customer_count
    ),
    'attendance', jsonb_build_object(
      'active_sessions', v_active_sessions,
      'no_start_employees', v_no_start,
      'ended_employees', v_ended,
      'active_count', (SELECT count(*) FROM jsonb_array_elements(v_active_sessions)),
      'on_visit_count', (SELECT count(*) FROM jsonb_array_elements(v_active_sessions) WHERE value->>'work_status' = 'on_visit'),
      'on_break_count', (SELECT count(*) FROM jsonb_array_elements(v_active_sessions) WHERE value->>'work_status' = 'on_break'),
      'no_start_count', (SELECT count(*) FROM jsonb_array_elements(v_no_start)),
      'ended_count', (SELECT count(*) FROM jsonb_array_elements(v_ended))
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
      'members', COALESCE(v_members, '[]'::jsonb),
      'team_targets', jsonb_build_object(
        'sales_target', v_team_sales_target,
        'visits_target', v_team_visits_target,
        'orders_target', v_team_orders_target,
        'new_customers_target', v_team_new_customers_target,
        'sales_achievement', v_team_sales_achievement,
        'visits_achievement', v_team_visits_achievement,
        'orders_achievement', v_team_orders_achievement,
        'new_customers_achievement', v_team_new_customers_achievement,
        'sales_achievement_pct', CASE WHEN v_team_sales_target > 0 THEN ROUND((v_team_sales_achievement / v_team_sales_target * 100)::numeric, 1) ELSE 0 END,
        'visits_achievement_pct', CASE WHEN v_team_visits_target > 0 THEN ROUND((v_team_visits_achievement::numeric / v_team_visits_target * 100)::numeric, 1) ELSE 0 END,
        'orders_achievement_pct', CASE WHEN v_team_orders_target > 0 THEN ROUND((v_team_orders_achievement::numeric / v_team_orders_target * 100)::numeric, 1) ELSE 0 END,
        'new_customers_achievement_pct', CASE WHEN v_team_new_customers_target > 0 THEN ROUND((v_team_new_customers_achievement::numeric / v_team_new_customers_target * 100)::numeric, 1) ELSE 0 END
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
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_sales_manager_cc IS 'مركز قيادة مدير البيع — بيانات الفريق المباشر والأداء والتتبع الحي';
