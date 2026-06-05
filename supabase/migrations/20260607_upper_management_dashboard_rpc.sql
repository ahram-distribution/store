-- Unified Upper Management Dashboard RPC
-- Phase 1 of Unified Upper Management Dashboard Execution Plan
-- Returns all 12 approved KPIs for upper management roles (SUPER_ADMIN, CHAIRMAN, ADMIN)
-- Replaces: get_dashboard_management, get_credit_dashboard_stats, get_governed_dashboard_counts, get_order_status_counts for upper management

CREATE OR REPLACE FUNCTION public.get_upper_management_dashboard(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_is_upper boolean;
  v_new_orders int;
  v_pending_orders int;
  v_active_visits int;
  v_today_visits int;
  v_new_customers int;
  v_stagnant_customers int;
  v_daily_sales numeric;
  v_monthly_sales numeric;
  v_best_rep jsonb;
  v_weakest_rep jsonb;
  v_total_customers int;
  v_total_reps int;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = v_session.employee_id
    AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
  ) INTO v_is_upper;

  IF NOT v_is_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only'); END IF;

  -- Upper management sees ALL data per Ownership Visibility Matrix
  SELECT COUNT(*) INTO v_new_orders FROM public.orders WHERE created_at >= CURRENT_DATE;
  SELECT COUNT(*) INTO v_pending_orders FROM public.orders WHERE status IN ('draft', 'reviewing', 'submitted');
  SELECT COUNT(*) INTO v_active_visits FROM public.visits WHERE status = 'active';
  SELECT COUNT(*) INTO v_today_visits FROM public.visits WHERE created_at >= CURRENT_DATE;
  SELECT COUNT(*) INTO v_new_customers FROM public.customers WHERE created_at >= date_trunc('month', CURRENT_DATE);
  SELECT COUNT(*) INTO v_stagnant_customers FROM public.customers WHERE is_active = true AND NOT EXISTS (SELECT 1 FROM public.orders WHERE customer_id = customers.id AND created_at >= CURRENT_DATE - INTERVAL '90 days');
  SELECT COALESCE(SUM(total_amount), 0) INTO v_daily_sales FROM public.orders WHERE status NOT IN ('draft', 'cancelled') AND submitted_at >= CURRENT_DATE;
  SELECT COALESCE(SUM(total_amount), 0) INTO v_monthly_sales FROM public.orders WHERE status NOT IN ('draft', 'cancelled') AND submitted_at >= date_trunc('month', CURRENT_DATE);
  SELECT COUNT(*) INTO v_total_customers FROM public.customers;
  SELECT COUNT(*) INTO v_total_reps FROM public.employees;

  -- Best rep: highest total sales this month
  -- Uses IN (e.id, e.identity_id) for backward compatibility:
  --   old orders store employees.id as owner_id,
  --   new orders (post 20260605 migration) store employees.identity_id
  SELECT jsonb_build_object('id', e.id, 'code', e.code, 'name', e.full_name, 'total_sales', COALESCE(SUM(o.total_amount), 0))
  INTO v_best_rep
  FROM public.employees e
  JOIN public.orders o ON o.owner_id IN (e.id, e.identity_id)
  WHERE o.status NOT IN ('draft', 'cancelled')
    AND o.submitted_at >= date_trunc('month', CURRENT_DATE)
  GROUP BY e.id, e.code, e.full_name
  ORDER BY COALESCE(SUM(o.total_amount), 0) DESC
  LIMIT 1;

  -- Weakest rep: lowest total sales this month (among those with at least one order)
  SELECT jsonb_build_object('id', e.id, 'code', e.code, 'name', e.full_name, 'total_sales', COALESCE(SUM(o.total_amount), 0))
  INTO v_weakest_rep
  FROM public.employees e
  JOIN public.orders o ON o.owner_id IN (e.id, e.identity_id)
  WHERE o.status NOT IN ('draft', 'cancelled')
    AND o.submitted_at >= date_trunc('month', CURRENT_DATE)
  GROUP BY e.id, e.code, e.full_name
  ORDER BY COALESCE(SUM(o.total_amount), 0) ASC
  LIMIT 1;

  RETURN jsonb_build_object(
    'new_orders', COALESCE(v_new_orders, 0),
    'pending_orders', COALESCE(v_pending_orders, 0),
    'active_visits', COALESCE(v_active_visits, 0),
    'today_visits', COALESCE(v_today_visits, 0),
    'new_customers', COALESCE(v_new_customers, 0),
    'stagnant_customers', COALESCE(v_stagnant_customers, 0),
    'daily_sales', COALESCE(v_daily_sales, 0),
    'monthly_sales', COALESCE(v_monthly_sales, 0),
    'best_rep', COALESCE(v_best_rep, 'null'::jsonb),
    'weakest_rep', COALESCE(v_weakest_rep, 'null'::jsonb),
    'total_customers', COALESCE(v_total_customers, 0),
    'total_reps', COALESCE(v_total_reps, 0)
  );
END;
$function$;

COMMENT ON FUNCTION public.get_upper_management_dashboard IS 'لوحة الإدارة العليا الموحدة — 12 KPI';
