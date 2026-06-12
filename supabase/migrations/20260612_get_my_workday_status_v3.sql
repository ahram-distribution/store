-- V3: get_my_workday_status — always returns data, includes policy + KPIs + employee info
-- Fix: never returns NULL (returns status=null for "before work" with policy/KPI data)
-- Fix: includes work_location, schedule_type, attendance_enabled from employee_work_policies
-- Fix: includes employee_name, employee_code
-- Fix: includes today KPIs (orders, sales, collections, new customers) even without session
-- Fix: includes daily_target_vs_actual (best-effort)

CREATE OR REPLACE FUNCTION public.get_my_workday_status(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_employee record;
    v_policy record;
    v_session_data record;
    v_break_count int := 0;
    v_break_total_seconds int := 0;
    v_visit_count int := 0;
    v_on_break boolean := false;
    v_open_break_id uuid := NULL;
    v_today_orders int := 0;
    v_today_sales numeric := 0;
    v_today_collections int := 0;
    v_today_collection_amount numeric := 0;
    v_today_new_customers int := 0;
    v_target_data jsonb := NULL;
    v_duration_minutes numeric := 0;
    v_net_work_minutes numeric := 0;
    v_ended_at timestamptz := NULL;
    v_started_at timestamptz := NULL;
    v_session_status text := NULL;
    v_session_id uuid := NULL;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT id, full_name, code INTO v_employee FROM public.employees WHERE id = v_employee_id;
    SELECT ep.* INTO v_policy FROM public.employee_work_policies ep WHERE ep.employee_id = v_employee_id;

    SELECT * INTO v_session_data FROM public.workday_sessions
    WHERE employee_id = v_employee_id AND date = CURRENT_DATE
    ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, start_time DESC
    LIMIT 1;

    IF FOUND THEN
        v_session_id := v_session_data.id;
        v_session_status := v_session_data.status;
        v_started_at := v_session_data.start_time;
        v_ended_at := v_session_data.end_time;

        IF v_session_data.status = 'active' THEN
            v_duration_minutes := EXTRACT(EPOCH FROM (now() - v_session_data.start_time)) / 60;
            SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) INTO v_break_count, v_break_total_seconds
            FROM public.workday_breaks WHERE session_id = v_session_data.id;
            SELECT COUNT(*) INTO v_visit_count FROM public.visits
            WHERE employee_id = v_employee_id AND check_in_at::date = CURRENT_DATE;
            SELECT EXISTS(SELECT 1 FROM public.workday_breaks
                          WHERE session_id = v_session_data.id AND break_end IS NULL) INTO v_on_break;
            SELECT id INTO v_open_break_id FROM public.workday_breaks
            WHERE session_id = v_session_data.id AND break_end IS NULL LIMIT 1;
        ELSE
            v_duration_minutes := EXTRACT(EPOCH FROM (v_session_data.end_time - v_session_data.start_time)) / 60;
            SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) INTO v_break_count, v_break_total_seconds
            FROM public.workday_breaks WHERE session_id = v_session_data.id;
        END IF;

        v_net_work_minutes := v_duration_minutes - (v_break_total_seconds / 60);
    END IF;

    SELECT COUNT(*)::int, COALESCE(SUM(total_amount), 0) INTO v_today_orders, v_today_sales
    FROM public.orders WHERE owner_id = v_employee_id AND created_at::date = CURRENT_DATE;
    SELECT COUNT(*)::int, COALESCE(SUM(amount), 0) INTO v_today_collections, v_today_collection_amount
    FROM public.collections WHERE owner_id = v_employee_id AND created_at::date = CURRENT_DATE;
    SELECT COUNT(*)::int INTO v_today_new_customers
    FROM public.customers WHERE owner_id = v_employee_id AND created_at::date = CURRENT_DATE;

    BEGIN
        v_target_data := public.get_daily_target_vs_actual(p_token, v_employee_id, CURRENT_DATE);
    EXCEPTION WHEN OTHERS THEN
        v_target_data := NULL;
    END;

    RETURN jsonb_build_object(
        'status', v_session_status,
        'employee_name', v_employee.full_name,
        'employee_code', v_employee.code,
        'session_id', v_session_id,
        'started_at', v_started_at,
        'ended_at', v_ended_at,
        'duration_minutes', v_duration_minutes,
        'break_count', v_break_count,
        'break_minutes', v_break_total_seconds / 60,
        'visit_count', v_visit_count,
        'net_work_minutes', v_net_work_minutes,
        'on_break', CASE WHEN v_session_status = 'active' THEN v_on_break ELSE false END,
        'open_break_id', CASE WHEN v_session_status = 'active' THEN v_open_break_id ELSE NULL::uuid END,
        'work_location', v_policy.work_location,
        'schedule_type', v_policy.schedule_type,
        'required_daily_hours', v_policy.required_daily_hours,
        'attendance_enabled', v_policy.attendance_enabled,
        'today_orders', v_today_orders,
        'today_sales', v_today_sales,
        'today_collections', v_today_collections,
        'today_new_customers', v_today_new_customers,
        'daily_target_vs_actual', v_target_data
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_workday_status TO anon;
