-- ================================================================
-- Session Lifecycle Policy — Active Session Management
-- 
-- Implements:
-- 1. 3-hour inactivity → INACTIVE_WARNING
-- 2. Auto-close after warning timeout
-- 3. Midnight rollover (date < CURRENT_DATE)
-- 4. Stale session blocking on start_workday
-- 5. Close reason tracking
-- ================================================================

-- ================================================================
-- 1. Schema Changes
-- ================================================================

-- Extend status to include 'inactive_warning'
ALTER TABLE public.workday_sessions
DROP CONSTRAINT IF EXISTS workday_sessions_status_check;

ALTER TABLE public.workday_sessions
ADD CONSTRAINT workday_sessions_status_check
CHECK (status IN ('active', 'completed', 'cancelled', 'inactive_warning'));

-- Add close_reason column
ALTER TABLE public.workday_sessions
ADD COLUMN IF NOT EXISTS close_reason varchar(50) DEFAULT NULL;

ALTER TABLE public.workday_sessions
DROP CONSTRAINT IF EXISTS workday_sessions_close_reason_check;

ALTER TABLE public.workday_sessions
ADD CONSTRAINT workday_sessions_close_reason_check
CHECK (close_reason IN ('manual_close', 'auto_closed_no_activity', 'auto_closed_day_rollover', 'admin_closed'));

-- Add warning_sent_at for tracking when the 3-hour warning was issued
ALTER TABLE public.workday_sessions
ADD COLUMN IF NOT EXISTS warning_sent_at timestamptz DEFAULT NULL;

-- ================================================================
-- 2. Modified start_workday — blocks new session if stale session exists
-- ================================================================

CREATE OR REPLACE FUNCTION public.start_workday(
    p_token uuid,
    p_latitude decimal DEFAULT NULL,
    p_longitude decimal DEFAULT NULL,
    p_device_status jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_existing_id uuid;
    v_stale_session uuid;
    v_stale_date date;
    v_stale_start timestamptz;
    v_stale_seen timestamptz;
    v_policy_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    v_employee_id := v_session.employee_id;

    -- CHECK 1: Stale active session from a previous day?
    SELECT id, date, start_time, last_seen_at INTO v_stale_session, v_stale_date, v_stale_start, v_stale_seen
    FROM public.workday_sessions
    WHERE employee_id = v_employee_id AND status IN ('active', 'inactive_warning') AND date < CURRENT_DATE
    ORDER BY date DESC LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'error', 'STALE_SESSION_EXISTS',
            'session_id', v_stale_session,
            'stale_date', v_stale_date,
            'stale_start_time', v_stale_start,
            'last_seen_at', v_stale_seen
        );
    END IF;

    -- CHECK 2: Already active today?
    SELECT id INTO v_existing_id FROM public.workday_sessions
    WHERE employee_id = v_employee_id AND date = CURRENT_DATE AND status = 'active';
    IF FOUND THEN RETURN jsonb_build_object('error', 'ALREADY_ACTIVE', 'session_id', v_existing_id); END IF;

    -- CHECK 3: GPS required
    IF p_latitude IS NULL OR p_longitude IS NULL THEN
        RETURN jsonb_build_object('error', 'GPS_REQUIRED');
    END IF;

    SELECT id INTO v_policy_id FROM public.employee_work_policies WHERE employee_id = v_employee_id;

    INSERT INTO public.workday_sessions (employee_id, start_latitude, start_longitude, start_device_status, work_policy_id)
    VALUES (v_employee_id, p_latitude, p_longitude, p_device_status, v_policy_id)
    RETURNING id INTO v_existing_id;

    INSERT INTO public.tracking_points (session_id, employee_id, latitude, longitude, recorded_at, point_type)
    VALUES (v_existing_id, v_employee_id, p_latitude, p_longitude, now(), 'start');

    RETURN jsonb_build_object('session_id', v_existing_id, 'started_at', now());
END;
$function$;

-- ================================================================
-- 3. Modified end_workday — records close_reason
-- ================================================================

CREATE OR REPLACE FUNCTION public.end_workday(
    p_token uuid,
    p_session_id uuid,
    p_latitude decimal DEFAULT NULL,
    p_longitude decimal DEFAULT NULL,
    p_device_status jsonb DEFAULT NULL,
    p_close_reason text DEFAULT 'manual_close'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_workday record;
    v_open_breaks int := 0;
    v_break_id uuid;
    v_start_time time;
    v_end_time time;
    v_late_thresh int;
    v_early_thresh int;
    v_attendance_status text := 'unknown';
    v_late_min int := 0;
    v_early_min int := 0;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_workday FROM public.workday_sessions
    WHERE id = p_session_id AND employee_id = v_employee_id AND status IN ('active', 'inactive_warning');
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;

    -- GPS optional for auto-close; required for manual close
    IF p_close_reason = 'manual_close' AND (p_latitude IS NULL OR p_longitude IS NULL) THEN
        RETURN jsonb_build_object('error', 'GPS_REQUIRED');
    END IF;

    -- Auto-close open breaks
    FOR v_break_id IN SELECT id FROM public.workday_breaks
        WHERE session_id = p_session_id AND break_end IS NULL
    LOOP
        UPDATE public.workday_breaks SET
            break_end = now(),
            duration_seconds = EXTRACT(EPOCH FROM (now() - break_start))::int,
            auto_closed = true
        WHERE id = v_break_id;
        v_open_breaks := v_open_breaks + 1;
    END LOOP;

    -- Calculate attendance status (only for manual close)
    IF p_close_reason = 'manual_close' THEN
        SELECT official_start_time, official_end_time, late_threshold_minutes, early_departure_threshold_minutes
        INTO v_start_time, v_end_time, v_late_thresh, v_early_thresh
        FROM public.workday_settings LIMIT 1;

        IF v_workday.start_time::time > v_start_time + COALESCE(v_late_thresh, 0) * interval '1 minute' THEN
            v_attendance_status := 'late';
            v_late_min := EXTRACT(EPOCH FROM (v_workday.start_time::time - v_start_time)) / 60;
        END IF;

        IF v_attendance_status = 'unknown' AND now()::time < v_end_time - COALESCE(v_early_thresh, 0) * interval '1 minute' THEN
            v_attendance_status := 'early_departure';
            v_early_min := EXTRACT(EPOCH FROM (v_end_time - now()::time)) / 60;
        END IF;

        IF v_attendance_status = 'unknown' THEN
            v_attendance_status := 'ontime';
        END IF;
    END IF;

    UPDATE public.workday_sessions SET
        end_time = CASE WHEN p_close_reason = 'manual_close' THEN now()
                        ELSE COALESCE(last_seen_at, now()) END,
        end_latitude = COALESCE(p_latitude, v_workday.start_latitude),
        end_longitude = COALESCE(p_longitude, v_workday.start_longitude),
        end_device_status = p_device_status,
        status = 'completed',
        attendance_status = CASE WHEN p_close_reason = 'manual_close' THEN v_attendance_status ELSE 'unknown' END,
        late_minutes = v_late_min,
        early_departure_minutes = v_early_min,
        close_reason = p_close_reason,
        updated_at = now()
    WHERE id = p_session_id;

    IF p_latitude IS NOT NULL THEN
        INSERT INTO public.tracking_points (session_id, employee_id, latitude, longitude, recorded_at, point_type)
        VALUES (p_session_id, v_employee_id, p_latitude, p_longitude, now(), 'end');
    END IF;

    RETURN jsonb_build_object(
        'ok', true, 'end_time', now(),
        'close_reason', p_close_reason,
        'open_breaks_closed', v_open_breaks,
        'attendance_status', v_attendance_status
    );
END;
$function$;

-- ================================================================
-- 4. check_session_timeout — called by frontend heartbeat
--    Evaluates: 3h inactivity warning, auto-close, midnight rollover
-- ================================================================

CREATE OR REPLACE FUNCTION public.check_session_timeout(
    p_token uuid,
    p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_ws record;
    v_inactive_hours numeric;
    v_warning_duration_hours numeric;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_ws FROM public.workday_sessions
    WHERE id = p_session_id AND employee_id = v_employee_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;

    -- Case 1: Midnight rollover — session from a previous day
    IF v_ws.status IN ('active', 'inactive_warning') AND v_ws.date < CURRENT_DATE THEN
        -- Auto-close: day rolled over
        PERFORM public.end_workday(p_token, p_session_id,
            p_latitude => v_ws.end_latitude,
            p_longitude => v_ws.end_longitude,
            p_close_reason => 'auto_closed_day_rollover'
        );
        RETURN jsonb_build_object(
            'action', 'auto_closed',
            'reason', 'day_rollover',
            'message', 'تم إنهاء يوم العمل تلقائياً لانتهاء اليوم وعدم تسجيل خروج.'
        );
    END IF;

    -- Calculate inactivity duration from last_seen_at or start_time
    v_inactive_hours := EXTRACT(EPOCH FROM (now() - COALESCE(v_ws.last_seen_at, v_ws.start_time))) / 3600;

    -- Case 2: Already in warning — check if should auto-close
    IF v_ws.status = 'inactive_warning' THEN
        v_warning_duration_hours := EXTRACT(EPOCH FROM (now() - v_ws.warning_sent_at)) / 3600;

        IF v_warning_duration_hours >= 0.5 THEN  -- 30 min grace after warning
            PERFORM public.end_workday(p_token, p_session_id,
                p_latitude => v_ws.end_latitude,
                p_longitude => v_ws.end_longitude,
                p_close_reason => 'auto_closed_no_activity'
            );
            RETURN jsonb_build_object(
                'action', 'auto_closed',
                'reason', 'no_activity_timeout',
                'message', 'تم إنهاء يوم العمل تلقائياً بسبب عدم وجود نشاط.'
            );
        END IF;

        RETURN jsonb_build_object(
            'action', 'warning_active',
            'inactive_hours', v_inactive_hours::int,
            'message', 'لم يتم رصد أي نشاط منذ ' || v_inactive_hours::int || ' ساعات. سيتم إنهاء يوم العمل تلقائياً إذا لم يعد الاتصال.'
        );
    END IF;

    -- Case 3: Active but 3h+ inactivity — issue warning
    IF v_ws.status = 'active' AND v_inactive_hours >= 3 THEN
        UPDATE public.workday_sessions
        SET status = 'inactive_warning', warning_sent_at = now(), updated_at = now()
        WHERE id = p_session_id;

        RETURN jsonb_build_object(
            'action', 'warning_issued',
            'inactive_hours', v_inactive_hours::int,
            'message', 'لم يتم رصد أي نشاط منذ ' || v_inactive_hours::int || ' ساعات. سيتم إنهاء يوم العمل تلقائياً إذا لم يعد الاتصال.'
        );
    END IF;

    -- Case 4: Active and within timeout — no action
    RETURN jsonb_build_object(
        'action', 'ok',
        'inactive_hours', v_inactive_hours::int
    );
END;
$function$;

-- ================================================================
-- 5. resolve_stale_session — called when user wants to close the
--    stale session and continue with a new one
-- ================================================================

CREATE OR REPLACE FUNCTION public.resolve_stale_session(
    p_token uuid,
    p_stale_session_id uuid,
    p_action text  -- 'close_and_continue' or 'request_review'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_ws record;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_ws FROM public.workday_sessions
    WHERE id = p_stale_session_id AND employee_id = v_employee_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;

    IF p_action = 'close_and_continue' THEN
        PERFORM public.end_workday(p_token, p_stale_session_id,
            p_latitude => v_ws.end_latitude,
            p_longitude => v_ws.end_longitude,
            p_close_reason => 'auto_closed_day_rollover'
        );
        RETURN jsonb_build_object('ok', true, 'action', 'closed');
    ELSIF p_action = 'request_review' THEN
        -- Just return ok — the session stays active for admin review
        RETURN jsonb_build_object('ok', true, 'action', 'pending_review');
    ELSE
        RETURN jsonb_build_object('error', 'INVALID_ACTION');
    END IF;
END;
$function$;

-- ================================================================
-- 6. Grants
-- ================================================================

GRANT EXECUTE ON FUNCTION public.start_workday TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_workday TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_session_timeout TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_stale_session TO authenticated;

-- ================================================================
-- 7. Scheduled Job (requires pg_cron or Edge Function)
--    Run this via Supabase Dashboard → SQL Editor or Edge Function
--    for off-hours session cleanup.
--
--    For Edge Function setup:
--    supabase functions new auto-close-sessions
--    Contents: fetch('https://project.supabase.co/rest/v1/rpc/auto_close_stale_sessions')
--
--    Equivalent SQL batch for cron:
--    SELECT public.check_session_timeout_for_all();
-- ================================================================

-- Batch version for scheduled execution (cleans up ALL stale sessions)
CREATE OR REPLACE FUNCTION public.auto_close_stale_sessions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_closed int := 0;
    v_warned int := 0;
    v_ws record;
BEGIN
    FOR v_ws IN
        SELECT * FROM public.workday_sessions
        WHERE status IN ('active', 'inactive_warning')
        AND (
            -- Midnight rollover
            date < CURRENT_DATE
            OR
            -- 3h+ inactivity with no heartbeat/tracking
            (
                status = 'active'
                AND EXTRACT(EPOCH FROM (now() - COALESCE(last_seen_at, start_time))) / 3600 >= 3
            )
            OR
            -- Warning for 30+ min with no recovery
            (
                status = 'inactive_warning'
                AND EXTRACT(EPOCH FROM (now() - warning_sent_at)) / 3600 >= 0.5
            )
        )
    LOOP
        IF v_ws.date < CURRENT_DATE OR v_ws.status = 'inactive_warning' THEN
            UPDATE public.workday_sessions
            SET end_time = COALESCE(last_seen_at, now()),
                status = 'completed',
                close_reason = CASE WHEN v_ws.date < CURRENT_DATE THEN 'auto_closed_day_rollover'
                                    ELSE 'auto_closed_no_activity' END,
                attendance_status = 'unknown',
                updated_at = now()
            WHERE id = v_ws.id;
            v_closed := v_closed + 1;
        ELSE
            UPDATE public.workday_sessions
            SET status = 'inactive_warning', warning_sent_at = now(), updated_at = now()
            WHERE id = v_ws.id;
            v_warned := v_warned + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('closed', v_closed, 'warned', v_warned);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.auto_close_stale_sessions TO authenticated;
