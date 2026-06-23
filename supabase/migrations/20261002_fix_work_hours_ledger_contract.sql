-- ===============================================================
-- Fix: EmployeeWorkdayDetailPage crash — get_work_hours_ledger
-- contract mismatch
--
-- Root Cause:
--   Phase C migration (20260622_phase_c_workday_detail_repair.sql)
--   was never deployed. A different function with the same name
--   (text params, no schedule_info) existed in production,
--   causing Cannot read properties of undefined (reading
--   'presence_minutes').
--
-- Fix:
--   1. Drop the old text-param function
--   2. Create the correct Phase C version (uuid+date params,
--      with schedule_info.presence_minutes)
-- =============================================================

-- =============================================================
-- 1. Drop old function (text params, wrong contract)
-- =============================================================
DROP FUNCTION IF EXISTS public.get_work_hours_ledger(text, text, text, text) CASCADE;

-- =============================================================
-- 2. Create correct function — polymorphic per schedule_type
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
-- 3. Force PostgREST schema cache reload
-- =============================================================
SELECT pg_notify('pgrst', 'reload schema');
