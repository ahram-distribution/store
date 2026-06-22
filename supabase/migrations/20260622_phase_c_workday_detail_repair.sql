-- ===============================================================
-- Phase C — Workday Detail Repair
-- تاريخ: 22 يونيو 2026
--
-- 1. تأكيد: multiple workday_sessions per day مسموح (UNIQUE فقط على active)
-- 2. إنشاء: get_work_hours_ledger — polymorphic حسب schedule_type
-- 3. إصلاح: get_daily_target_vs_actual — إزالة شرط completed للأكتيف
-- ===============================================================

-- =============================================================
-- 1. التحقق من أن UNIQUE CONSTRAINT يسمح بعدة جلسات لنفس اليوم
-- =============================================================
-- موجود: CREATE UNIQUE INDEX uq_wds_active_per_day
--         ON workday_sessions (employee_id, date) WHERE status = 'active';
-- هذا يمنع فقط جلسة active ثانية. يسمح بجلسات completed متعددة.
-- لا تغيير مطلوب في الـ Schema.

-- =============================================================
-- 2. get_work_hours_ledger — Polymorphic Work Hours Ledger
-- =============================================================
-- للمندوب (flexible/hourly):
--   يرجع ledger بجلسات حضور فقط (activity_type = 'presence')
--   schedule_info: presence_minutes, sessions_count, day_start, day_end
--   لا يرجع late/early/break.
--
-- للمكتبي (fixed_shift):
--   يرجع ledger بجلسات عمل (activity_type = 'work')
--   schedule_info: presence_minutes, net_minutes, break_minutes, late, early, attendance_status
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_work_hours_ledger(
    p_token uuid,
    p_employee_id uuid,
    p_from date,
    p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_policy public.employee_work_policies;
    v_ledger jsonb;
    v_schedule_info jsonb;
    v_total_presence numeric := 0;
    v_session_count int := 0;
    v_min_start timestamptz;
    v_max_end timestamptz;
    v_total_break_seconds numeric := 0;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.is_upper_management(v_session.employee_id) THEN
        IF NOT public.check_capability(p_token, 'attendance.view_history') THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN');
        END IF;
        IF NOT (p_employee_id = ANY(public.get_visible_employee_ids(p_token))) THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN');
        END IF;
    END IF;

    SELECT * INTO v_policy FROM public.employee_work_policies WHERE employee_id = p_employee_id;

    IF v_policy.schedule_type = 'fixed_shift' THEN
        -- Fixed shift: ledger entries = session work periods + schedule_info مع net/break
        SELECT
            jsonb_agg(jsonb_build_object(
                'start_time', wds.start_time,
                'end_time', wds.end_time,
                'activity_type', 'work',
                'duration_minutes', COALESCE(EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60, 0)::int,
                'description', wds.status
            ) ORDER BY wds.start_time),

            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60), 0)::int,
            COUNT(*),
            MIN(wds.start_time),
            MAX(COALESCE(wds.end_time, now())),

            COALESCE(SUM(COALESCE(wb.total_break_seconds, 0)), 0)
        INTO v_ledger, v_total_presence, v_session_count, v_min_start, v_max_end, v_total_break_seconds
        FROM public.workday_sessions wds
        LEFT JOIN (
            SELECT session_id, SUM(COALESCE(duration_seconds, 0)) AS total_break_seconds
            FROM public.workday_breaks
            GROUP BY session_id
        ) wb ON wb.session_id = wds.id
        WHERE wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to
        AND wds.status IN ('completed', 'active');

        v_ledger := COALESCE(v_ledger, '[]'::jsonb);

        v_schedule_info := jsonb_build_object(
            'schedule_type', 'fixed_shift',
            'presence_minutes', v_total_presence,
            'net_minutes', GREATEST(v_total_presence - (v_total_break_seconds / 60)::int, 0),
            'break_minutes', (v_total_break_seconds / 60)::int,
            'late_minutes', COALESCE((SELECT SUM(late_minutes) FROM public.workday_sessions
                WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to
                AND status IN ('completed', 'active')), 0),
            'early_departure_minutes', COALESCE((SELECT SUM(early_departure_minutes) FROM public.workday_sessions
                WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to
                AND status IN ('completed', 'active')), 0),
            'sessions_count', v_session_count
        );
    ELSE
        -- Flexible or Hourly: ledger entries = presence periods (no break deduction)
        SELECT
            jsonb_agg(jsonb_build_object(
                'start_time', wds.start_time,
                'end_time', wds.end_time,
                'activity_type', 'presence',
                'duration_minutes', COALESCE(EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60, 0)::int,
                'description', CASE WHEN wds.status = 'active' THEN 'جاري' ELSE NULL END
            ) ORDER BY wds.start_time),

            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60), 0)::int,
            COUNT(*),
            MIN(wds.start_time),
            MAX(COALESCE(wds.end_time, now()))
        INTO v_ledger, v_total_presence, v_session_count, v_min_start, v_max_end
        FROM public.workday_sessions wds
        WHERE wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to
        AND wds.status IN ('completed', 'active');

        v_ledger := COALESCE(v_ledger, '[]'::jsonb);

        v_schedule_info := jsonb_build_object(
            'schedule_type', v_policy.schedule_type,
            'presence_minutes', v_total_presence,
            'sessions_count', v_session_count,
            'day_start', v_min_start,
            'day_end', v_max_end
        );
    END IF;

    RETURN jsonb_build_object(
        'schedule_type', COALESCE(v_policy.schedule_type, 'flexible'),
        'schedule_info', COALESCE(v_schedule_info, '{}'::jsonb),
        'ledger', v_ledger
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_work_hours_ledger TO authenticated;

-- =============================================================
-- 3. get_daily_target_vs_actual — Fix completed-only filter
-- =============================================================
-- المشكلة: الـ RPC كان يشترط status = 'completed' لحساب net_seconds.
-- هذا يجعل progress_pct = 0% لأي جلسة نشيطة اليوم.
-- الحل: للمندوبين (flexible/hourly): احسب حضور جميع الجلسات (active + completed)
--        للمكتبيين (fixed_shift): يبقى الشرط كما هو.
-- =============================================================

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
    v_today_seconds numeric;
    v_progress_pct numeric;
    v_remaining_seconds numeric;
    v_last_7 jsonb;
    v_kpi jsonb;
    v_use_net_calc boolean := true;  -- true = net (duration-breaks), false = presence (duration only)
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    v_target_date := COALESCE(p_date, CURRENT_DATE);

    IF p_employee_id IS NOT NULL THEN
        v_employee_ids := ARRAY[p_employee_id];
    ELSE
        IF public.check_capability(p_token, 'attendance.view_all') THEN
            SELECT ARRAY(SELECT id FROM public.employees WHERE is_active = true) INTO v_employee_ids;
        ELSE
            v_employee_ids := app.get_subtree_ids(v_session.employee_id);
        END IF;
    END IF;

    IF v_employee_ids IS NULL OR array_length(v_employee_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_EMPLOYEES');
    END IF;

    IF p_employee_id IS NOT NULL AND array_length(v_employee_ids, 1) = 1 THEN
        SELECT * INTO v_emp_record FROM public.employees WHERE id = p_employee_id;
        SELECT * INTO v_policy FROM public.employee_work_policies WHERE employee_id = p_employee_id;

        v_target_hours := COALESCE(v_policy.required_daily_hours, 8);
        v_use_net_calc := (v_policy.schedule_type = 'fixed_shift');

        -- Calculate work seconds: for fixed_shift = net (minus breaks), for others = presence (no deduction)
        IF v_use_net_calc THEN
            -- Fixed shift: net = presence - breaks, only completed sessions
            SELECT COALESCE(SUM(
                EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) -
                COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = wds.id), 0)
            ), 0) INTO v_today_seconds
            FROM public.workday_sessions wds
            WHERE wds.employee_id = p_employee_id
              AND wds.date = v_target_date
              AND wds.status = 'completed';
        ELSE
            -- Flexible/Hourly: presence = end_time - start_time, active + completed
            SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time))), 0)
            INTO v_today_seconds
            FROM public.workday_sessions wds
            WHERE wds.employee_id = p_employee_id
              AND wds.date = v_target_date
              AND wds.status IN ('active', 'completed');
        END IF;

        v_progress_pct := CASE WHEN v_target_hours > 0 THEN ROUND((v_today_seconds / (v_target_hours * 3600) * 100)::numeric, 1) ELSE 0 END;
        v_remaining_seconds := GREATEST(0, (v_target_hours * 3600) - v_today_seconds);

        -- Last 7 days (same logic: net for fixed_shift, presence for flexible)
        IF v_use_net_calc THEN
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
            FROM (SELECT generate_series(v_target_date - 6, v_target_date, '1 day'::interval)::date AS d) d
            LEFT JOIN public.workday_sessions wds ON wds.employee_id = p_employee_id AND wds.date = d.d AND wds.status = 'completed';
        ELSE
            SELECT jsonb_agg(jsonb_build_object(
                'date', d.d::text,
                'net_hours', COALESCE(ROUND((
                    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(wds2.end_time, now()) - wds2.start_time))), 0)
                    FROM public.workday_sessions wds2
                    WHERE wds2.employee_id = p_employee_id AND wds2.date = d.d AND wds2.status IN ('active', 'completed')
                ) / 3600, 1), 0),
                'target_hours', v_target_hours,
                'met_target', COALESCE((
                    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(wds2.end_time, now()) - wds2.start_time))), 0)
                    FROM public.workday_sessions wds2
                    WHERE wds2.employee_id = p_employee_id AND wds2.date = d.d AND wds2.status IN ('active', 'completed')
                ) / 3600 >= v_target_hours, false)
            ) ORDER BY d.d)
            INTO v_last_7
            FROM (SELECT generate_series(v_target_date - 6, v_target_date, '1 day'::interval)::date AS d) d;
        END IF;

        SELECT * INTO v_monthly_target FROM public.employee_monthly_targets
        WHERE employee_id = p_employee_id
          AND target_month = EXTRACT(MONTH FROM v_target_date)
          AND target_year = EXTRACT(YEAR FROM v_target_date);

        RETURN jsonb_build_object(
            'target_hours', v_target_hours,
            'current_net_seconds', v_today_seconds,
            'current_net_hours', ROUND((v_today_seconds / 3600)::numeric, 2),
            'progress_pct', v_progress_pct,
            'remaining_seconds', v_remaining_seconds,
            'schedule_type', COALESCE(v_policy.schedule_type, 'fixed_shift'),
            'last_7_days', COALESCE(v_last_7, '[]'::jsonb),
            'hours_target', v_target_hours,
            'hours_actual', ROUND((v_today_seconds / 3600)::numeric, 2),
            'orders_target', COALESCE(v_monthly_target.orders_target / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)), 0),
            'orders_actual', COALESCE((SELECT COUNT(*)::numeric FROM public.orders WHERE public.resolve_employee_id(owner_id) = p_employee_id AND created_at::date = v_target_date), 0),
            'sales_target', COALESCE(v_monthly_target.sales_target / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)), 0),
            'sales_actual', COALESCE((SELECT SUM(total_amount)::numeric FROM public.orders WHERE public.resolve_employee_id(owner_id) = p_employee_id AND created_at::date = v_target_date), 0),
            'collections_target', COALESCE(v_monthly_target.collections_target / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)), 0),
            'collections_actual', COALESCE((SELECT SUM(amount)::numeric FROM public.collections WHERE public.resolve_employee_id(owner_id) = p_employee_id AND created_at::date = v_target_date), 0),
            'new_customers_target', COALESCE(v_monthly_target.new_customers_target / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)), 0),
            'new_customers_actual', COALESCE((SELECT COUNT(*)::numeric FROM public.customers WHERE public.resolve_employee_id(owner_id) = p_employee_id AND created_at::date = v_target_date), 0)
        );
    END IF;

    -- Team/aggregate: same logic for simplicity (uses presence for all)
    SELECT jsonb_build_object(
        'hours_target', SUM(COALESCE(ewp.required_daily_hours, 8)),
        'hours_actual', ROUND(SUM(COALESCE((
            SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)))
            FROM public.workday_sessions wds
            WHERE wds.employee_id = e.id AND wds.date = v_target_date AND wds.status IN ('active', 'completed')
        ), 0)) / 3600, 1),
        'orders_target', SUM(COALESCE(emt.orders_target, 0)) / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)),
        'orders_actual', COALESCE((SELECT COUNT(*)::numeric FROM public.orders o WHERE public.resolve_employee_id(o.owner_id) = ANY(v_employee_ids) AND o.created_at::date = v_target_date), 0),
        'sales_target', SUM(COALESCE(emt.sales_target, 0)) / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)),
        'sales_actual', COALESCE((SELECT SUM(total_amount)::numeric FROM public.orders o WHERE public.resolve_employee_id(o.owner_id) = ANY(v_employee_ids) AND o.created_at::date = v_target_date), 0),
        'collections_target', SUM(COALESCE(emt.collections_target, 0)) / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)),
        'collections_actual', COALESCE((SELECT SUM(amount)::numeric FROM public.collections c WHERE public.resolve_employee_id(c.owner_id) = ANY(v_employee_ids) AND c.created_at::date = v_target_date), 0),
        'new_customers_target', SUM(COALESCE(emt.new_customers_target, 0)) / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)),
        'new_customers_actual', COALESCE((SELECT COUNT(*)::numeric FROM public.customers cu WHERE public.resolve_employee_id(cu.owner_id) = ANY(v_employee_ids) AND cu.created_at::date = v_target_date), 0)
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

GRANT EXECUTE ON FUNCTION public.get_daily_target_vs_actual TO authenticated;
