-- ============================================================================
-- 20260705_create_daily_target_vs_actual
-- Creates the missing get_daily_target_vs_actual RPC referenced by:
--   - get_my_workday_status_v3 (internal call)
--   - EmployeeWorkdayDetailPage (TargetResponse progress)
--   - HistoryPage (KPI targets vs actuals)
--   - ReportsPage (team-level KPI targets vs actuals)
-- ============================================================================

-- Drop first in case a stub was ever created
DROP FUNCTION IF EXISTS public.get_daily_target_vs_actual CASCADE;

CREATE OR REPLACE FUNCTION public.get_daily_target_vs_actual(
    p_token uuid,
    p_employee_id uuid DEFAULT NULL,
    p_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_target_date date;
    v_employee_ids uuid[];
    v_result jsonb;
    v_emp_record record;
    v_policy record;
    v_monthly_target record;
    v_target_hours numeric;
    v_today_net_seconds numeric;
    v_progress_pct numeric;
    v_remaining_seconds numeric;
    v_last_7 jsonb;
    v_kpi jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    v_target_date := COALESCE(p_date, CURRENT_DATE);

    -- Determine which employees to process
    IF p_employee_id IS NOT NULL THEN
        v_employee_ids := ARRAY[p_employee_id];
    ELSE
        -- All governed employees (team scope)
        IF public.check_capability(p_token, 'attendance.view_all') THEN
            SELECT ARRAY(SELECT id FROM public.employees WHERE is_active = true) INTO v_employee_ids;
        ELSE
            v_employee_ids := app.get_subtree_ids(v_session.employee_id);
        END IF;
    END IF;

    IF v_employee_ids IS NULL OR array_length(v_employee_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_EMPLOYEES');
    END IF;

    -- For single employee: detailed TargetResponse + KPI fields
    IF p_employee_id IS NOT NULL AND array_length(v_employee_ids, 1) = 1 THEN
        SELECT * INTO v_emp_record FROM public.employees WHERE id = p_employee_id;
        SELECT * INTO v_policy FROM public.employee_work_policies WHERE employee_id = p_employee_id;

        v_target_hours := COALESCE(v_policy.required_daily_hours, 8);

        -- Net work seconds for the target date
        SELECT COALESCE(SUM(
            EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) -
            COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = wds.id), 0)
        ), 0) INTO v_today_net_seconds
        FROM public.workday_sessions wds
        WHERE wds.employee_id = p_employee_id
          AND wds.date = v_target_date
          AND wds.status = 'completed';

        v_progress_pct := CASE WHEN v_target_hours > 0 THEN ROUND((v_today_net_seconds / (v_target_hours * 3600) * 100)::numeric, 1) ELSE 0 END;
        v_remaining_seconds := GREATEST(0, (v_target_hours * 3600) - v_today_net_seconds);

        -- Last 7 days
        SELECT jsonb_agg(jsonb_build_object(
            'date', d.d::text,
            'net_hours', COALESCE(ROUND((
                EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) -
                COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = wds.id), 0)
            ) / 3600, 1), 0),
            'target_hours', v_target_hours,
            'met_target', COALESCE((
                EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) -
                COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = wds.id), 0)
            ) / 3600 >= v_target_hours, false)
        ) ORDER BY d.d)
        INTO v_last_7
        FROM (
            SELECT generate_series(v_target_date - 6, v_target_date, '1 day'::interval)::date AS d
        ) d
        LEFT JOIN public.workday_sessions wds ON wds.employee_id = p_employee_id AND wds.date = d.d AND wds.status = 'completed';

        -- Monthly target for KPI fields
        SELECT * INTO v_monthly_target FROM public.employee_monthly_targets
        WHERE employee_id = p_employee_id
          AND target_month = EXTRACT(MONTH FROM v_target_date)
          AND target_year = EXTRACT(YEAR FROM v_target_date);

        RETURN jsonb_build_object(
            -- TargetResponse fields (EmployeeWorkdayDetailPage / get_my_workday_status)
            'target_hours', v_target_hours,
            'current_net_seconds', v_today_net_seconds,
            'current_net_hours', ROUND((v_today_net_seconds / 3600)::numeric, 2),
            'progress_pct', v_progress_pct,
            'remaining_seconds', v_remaining_seconds,
            'schedule_type', COALESCE(v_policy.schedule_type, 'fixed_shift'),
            'last_7_days', COALESCE(v_last_7, '[]'::jsonb),
            -- KPI target/actual fields (HistoryPage / ReportsPage)
            'hours_target', v_target_hours,
            'hours_actual', ROUND((v_today_net_seconds / 3600)::numeric, 2),
            'orders_target', COALESCE(v_monthly_target.orders_target / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)), 0),
            'orders_actual', COALESCE((SELECT COUNT(*)::numeric FROM public.orders WHERE owner_id = p_employee_id AND created_at::date = v_target_date), 0),
            'sales_target', COALESCE(v_monthly_target.sales_target / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)), 0),
            'sales_actual', COALESCE((SELECT SUM(total_amount)::numeric FROM public.orders WHERE owner_id = p_employee_id AND created_at::date = v_target_date), 0),
            'collections_target', COALESCE(v_monthly_target.collections_target / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)), 0),
            'collections_actual', COALESCE((SELECT SUM(amount)::numeric FROM public.collections WHERE owner_id = p_employee_id AND created_at::date = v_target_date), 0),
            'new_customers_target', COALESCE(v_monthly_target.new_customers_target / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)), 0),
            'new_customers_actual', COALESCE((SELECT COUNT(*)::numeric FROM public.customers WHERE owner_id = p_employee_id AND created_at::date = v_target_date), 0)
        );
    END IF;

    -- For team/aggregate: return aggregated KPI fields
    SELECT jsonb_build_object(
        'hours_target', SUM(COALESCE(ewp.required_daily_hours, 8)),
        'hours_actual', ROUND(SUM(COALESCE((
            SELECT EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) -
                COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = wds.id), 0)
            FROM public.workday_sessions wds
            WHERE wds.employee_id = e.id AND wds.date = v_target_date AND wds.status = 'completed'
        ), 0)) / 3600, 1),
        'orders_target', SUM(COALESCE(emt.orders_target, 0)) / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)),
        'orders_actual', COALESCE((SELECT COUNT(*)::numeric FROM public.orders o JOIN unnest(v_employee_ids) eid ON eid = o.owner_id WHERE o.created_at::date = v_target_date), 0),
        'sales_target', SUM(COALESCE(emt.sales_target, 0)) / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)),
        'sales_actual', COALESCE((SELECT SUM(total_amount)::numeric FROM public.orders o JOIN unnest(v_employee_ids) eid ON eid = o.owner_id WHERE o.created_at::date = v_target_date), 0),
        'collections_target', SUM(COALESCE(emt.collections_target, 0)) / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)),
        'collections_actual', COALESCE((SELECT SUM(amount)::numeric FROM public.collections c JOIN unnest(v_employee_ids) eid ON eid = c.owner_id WHERE c.created_at::date = v_target_date), 0),
        'new_customers_target', SUM(COALESCE(emt.new_customers_target, 0)) / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)),
        'new_customers_actual', COALESCE((SELECT COUNT(*)::numeric FROM public.customers cu JOIN unnest(v_employee_ids) eid ON eid = cu.owner_id WHERE cu.created_at::date = v_target_date), 0)
    ) INTO v_result
    FROM public.employees e
    LEFT JOIN public.employee_work_policies ewp ON ewp.employee_id = e.id
    LEFT JOIN public.employee_monthly_targets emt ON emt.employee_id = e.id
        AND emt.target_month = EXTRACT(MONTH FROM v_target_date)
        AND emt.target_year = EXTRACT(YEAR FROM v_target_date)
    WHERE e.id = ANY(v_employee_ids);

    RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_daily_target_vs_actual IS 'الحصول على الأداء اليومي مقابل الأهدف (ساعات، طلبات، مبيعات، تحصيلات، عملاء جدد)';

GRANT EXECUTE ON FUNCTION public.get_daily_target_vs_actual TO anon;
GRANT EXECUTE ON FUNCTION public.get_daily_target_vs_actual TO authenticated;
