-- Add GPS null validation safety net to start_workday and end_workday RPCs
-- Prevents inserting NULL latitude/longitude into tracking_points (NOT NULL columns)

-- start_workday: reject null coordinates before INSERT into tracking_points
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
    v_policy_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    v_employee_id := v_session.employee_id;
    SELECT id INTO v_existing_id FROM public.workday_sessions
    WHERE employee_id = v_employee_id AND date = CURRENT_DATE AND status = 'active';
    IF FOUND THEN RETURN jsonb_build_object('error', 'ALREADY_ACTIVE', 'session_id', v_existing_id); END IF;
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

-- end_workday: reject null coordinates before INSERT into tracking_points
CREATE OR REPLACE FUNCTION public.end_workday(
    p_token uuid,
    p_session_id uuid,
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
    v_workday record;
    v_break_id uuid;
    v_open_breaks int := 0;
    v_start_time time;
    v_end_time time;
    v_late_thresh int;
    v_early_thresh int;
    v_attendance_status varchar(20) := 'ontime';
    v_late_min int := 0;
    v_early_min int := 0;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;
    SELECT * INTO v_workday FROM public.workday_sessions
    WHERE id = p_session_id AND employee_id = v_employee_id AND status = 'active';
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;
    IF p_latitude IS NULL OR p_longitude IS NULL THEN
        RETURN jsonb_build_object('error', 'GPS_REQUIRED');
    END IF;
    FOR v_break_id IN SELECT id FROM public.workday_breaks
        WHERE session_id = p_session_id AND break_end IS NULL
    LOOP
        UPDATE public.workday_breaks SET
            break_end = now(),
            duration_seconds = EXTRACT(EPOCH FROM (now() - break_start))::integer,
            auto_closed = true
        WHERE id = v_break_id;
        v_open_breaks := v_open_breaks + 1;
    END LOOP;
    SELECT official_start_time, official_end_time, late_threshold_minutes, early_departure_threshold_minutes
    INTO v_start_time, v_end_time, v_late_thresh, v_early_thresh
    FROM public.workday_settings LIMIT 1;
    IF v_workday.start_time::time > v_start_time + (v_late_thresh || ' minutes')::interval THEN
        v_attendance_status := 'late';
        v_late_min := EXTRACT(EPOCH FROM (v_workday.start_time::time - v_start_time)) / 60;
    END IF;
    IF v_attendance_status = 'ontime' AND now()::time < v_end_time - (v_early_thresh || ' minutes')::interval THEN
        v_attendance_status := 'early_departure';
        v_early_min := EXTRACT(EPOCH FROM (v_end_time - now()::time)) / 60;
    END IF;
    UPDATE public.workday_sessions SET
        end_time = now(),
        end_latitude = p_latitude,
        end_longitude = p_longitude,
        end_device_status = p_device_status,
        status = 'completed',
        attendance_status = v_attendance_status,
        late_minutes = v_late_min,
        early_departure_minutes = v_early_min,
        updated_at = now()
    WHERE id = p_session_id;
    INSERT INTO public.tracking_points (session_id, employee_id, latitude, longitude, recorded_at, point_type)
    VALUES (p_session_id, v_employee_id, p_latitude, p_longitude, now(), 'end');
    RETURN jsonb_build_object('session_id', p_session_id, 'ended_at', now(), 'auto_closed_breaks', v_open_breaks, 'attendance_status', v_attendance_status, 'late_minutes', v_late_min, 'early_departure_minutes', v_early_min);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.start_workday TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_workday TO authenticated;

NOTIFY pgrst, 'reload schema';
