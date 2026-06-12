-- ============================================================================
-- Supervisor Dashboard RPC
-- Returns aggregated team data for the supervisor's subtree including
-- team summary, per-member performance with targets, team targets, and
-- personal summary for the supervisor.
-- Uses existing app.get_subtree_ids() for scoping — no new tables or
-- governance changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_supervisor_dashboard(
  p_token uuid,
  p_month int DEFAULT NULL,
  p_year int DEFAULT NULL
)
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
  v_target_month int;
  v_target_year int;

  -- Team summary
  v_member_count int;
  v_customer_count int;

  -- Orders (identity_id based)
  v_month_orders int;
  v_month_sales numeric;
  v_month_visits int;
  v_today_orders int;
  v_today_sales numeric;
  v_today_visits int;

  -- Visits (employee_id based)
  v_active_visits int;

  -- Collections (employee_id based)
  v_pending_collections int;

  -- New customers this month (employee_id based)
  v_new_customers_month int;

  -- Per-member data
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
  v_personal_pending_collections int;

  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  v_emp_id := v_session.employee_id;
  v_identity_id := v_session.identity_id;

  v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
  v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);

  -- Get subtree employee IDs
  v_subtree_ids := app.get_subtree_ids(v_emp_id);

  -- Get corresponding identity IDs for orders queries
  SELECT COALESCE(array_agg(identity_id), '{}'::uuid[])
  INTO v_identity_ids
  FROM public.employees
  WHERE id = ANY(v_subtree_ids);

  -- ── Team summary ──

  SELECT count(*) INTO v_member_count FROM unnest(v_subtree_ids);

  SELECT count(*) INTO v_customer_count
  FROM public.customers
  WHERE owner_id = ANY(v_subtree_ids) AND is_active = true;

  SELECT count(*) INTO v_active_visits
  FROM public.visits
  WHERE employee_id = ANY(v_subtree_ids) AND status = 'active';

  SELECT count(*) INTO v_today_visits
  FROM public.visits
  WHERE employee_id = ANY(v_subtree_ids) AND created_at >= CURRENT_DATE;

  SELECT count(*), COALESCE(sum(total_amount), 0)
  INTO v_month_orders, v_month_sales
  FROM public.orders
  WHERE created_by = ANY(v_identity_ids)
    AND created_at >= date_trunc('month', CURRENT_DATE)
    AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month';

  SELECT count(*), COALESCE(sum(total_amount), 0)
  INTO v_today_orders, v_today_sales
  FROM public.orders
  WHERE created_by = ANY(v_identity_ids)
    AND created_at >= CURRENT_DATE;

  SELECT count(*) INTO v_month_visits
  FROM public.visits
  WHERE employee_id = ANY(v_subtree_ids)
    AND created_at >= date_trunc('month', CURRENT_DATE)
    AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month';

  SELECT count(*) INTO v_pending_collections
  FROM public.collections
  WHERE created_by = ANY(v_subtree_ids) AND status = 'pending';

  SELECT count(*) INTO v_new_customers_month
  FROM public.customers
  WHERE owner_id = ANY(v_subtree_ids)
    AND created_at >= date_trunc('month', CURRENT_DATE)
    AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month';

  -- ── Per-member performance ──

  FOR v_member_record IN
    SELECT
      e.id,
      e.code,
      e.full_name,
      e.identity_id
    FROM public.employees e
    WHERE e.id = ANY(v_subtree_ids)
      AND e.is_active = true
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

      -- Accumulate team targets
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

  -- ── Personal summary (supervisor's own data) ──

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

  SELECT count(*) INTO v_personal_pending_collections
  FROM public.collections
  WHERE created_by = v_emp_id AND status = 'pending';

  -- ── Build result ──

  v_result := jsonb_build_object(
    'team_summary', jsonb_build_object(
      'member_count', v_member_count,
      'customer_count', v_customer_count,
      'active_visits', v_active_visits,
      'today_visits', v_today_visits,
      'month_visits', v_month_visits,
      'today_orders', v_today_orders,
      'today_sales', v_today_sales,
      'month_orders', v_month_orders,
      'month_sales', v_month_sales,
      'pending_collections', v_pending_collections,
      'new_customers_month', v_new_customers_month
    ),
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

COMMENT ON FUNCTION public.get_supervisor_dashboard IS 'لوحة تحكم السوبر فايزر — بيانات الفريق والأهداف والأداء الشخصي';
