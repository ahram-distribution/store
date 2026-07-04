-- ================================================================
-- Migration: 20260704_flexible_attendance_logic
-- Description: Modify end_workday to respect schedule_type from
--   employee_work_policies. Flexible schedule employees skip late
--   and early departure calculations entirely.
-- ================================================================

-- ================================================================
-- 1. Update end_workday to use schedule_type
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
    v_distance integer;
    v_schedule_type text;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_workday FROM public.workday_sessions
    WHERE id = p_session_id AND employee_id = v_employee_id AND status IN ('active', 'inactive_warning');
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;

    -- Read schedule_type from the employee's work policy (snapshot via work_policy_id)
    SELECT ewp.schedule_type INTO v_schedule_type
    FROM public.employee_work_policies ewp
    WHERE ewp.id = v_workday.work_policy_id;
    -- Default to 'flexible' if no policy found (should not happen for new sessions)
    IF v_schedule_type IS NULL THEN v_schedule_type := 'flexible'; END IF;

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

    -- Calculate attendance status based on schedule_type
    IF p_close_reason = 'manual_close' THEN
        IF v_schedule_type = 'fixed_shift' THEN
            -- Fixed-shift: use global workday_settings for late/early calculation
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
        ELSE
            -- Flexible or hourly: always ontime, no late/early calculation
            v_attendance_status := 'ontime';
        END IF;
    ELSIF p_close_reason IN ('no_activity_timeout', 'day_rollover') THEN
        v_attendance_status := 'auto_closed';
    END IF;

    -- Calculate and persist distance
    v_distance := public.calculate_session_distance(p_session_id);

    UPDATE public.workday_sessions SET
        end_time = CASE WHEN p_close_reason = 'manual_close' THEN now()
                        ELSE COALESCE(last_seen_at, now()) END,
        end_latitude = COALESCE(p_latitude, v_workday.start_latitude),
        end_longitude = COALESCE(p_longitude, v_workday.start_longitude),
        end_device_status = p_device_status,
        status = 'completed',
        attendance_status = v_attendance_status,
        late_minutes = v_late_min,
        early_departure_minutes = v_early_min,
        close_reason = p_close_reason,
        total_distance_meters = v_distance,
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
        'attendance_status', v_attendance_status,
        'total_distance_meters', v_distance,
        'schedule_type', v_schedule_type
    );
END;
$function$;

-- ================================================================
-- 2. Grants
-- ================================================================

GRANT EXECUTE ON FUNCTION public.end_workday TO authenticated;
