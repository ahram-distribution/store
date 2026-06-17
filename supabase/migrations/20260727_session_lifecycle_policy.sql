-- ================================================================
-- Session Lifecycle Policy v2 — Inactivity Timeout & Auto-Close
--
-- Policy:
--   2h no activity (tracking point / heartbeat / visit / order
--     / collection / new customer) → warning
--   5min warning → auto-close
--   Midnight rollover (00:00–00:05) → close stale sessions
--   attendance_status = 'auto_closed'
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

-- Extend attendance_status to include 'auto_closed'
ALTER TABLE public.workday_sessions
DROP CONSTRAINT IF EXISTS workday_sessions_attendance_status_check;

ALTER TABLE public.workday_sessions
ADD CONSTRAINT workday_sessions_attendance_status_check
CHECK (attendance_status IN ('ontime', 'late', 'early_departure', 'absent', 'unknown', 'auto_closed'));

-- close_reason column
ALTER TABLE public.workday_sessions
ADD COLUMN IF NOT EXISTS close_reason varchar(50) DEFAULT NULL;

ALTER TABLE public.workday_sessions
DROP CONSTRAINT IF EXISTS workday_sessions_close_reason_check;

ALTER TABLE public.workday_sessions
ADD CONSTRAINT workday_sessions_close_reason_check
CHECK (close_reason IN ('manual_close', 'no_activity_timeout', 'day_rollover', 'admin_closed'));

-- warning tracking columns
ALTER TABLE public.workday_sessions
ADD COLUMN IF NOT EXISTS warning_sent_at timestamptz DEFAULT NULL;

ALTER TABLE public.workday_sessions
ADD COLUMN IF NOT EXISTS warning_cleared_at timestamptz DEFAULT NULL;

-- ================================================================
-- 2. Helper: touch_session_activity
--    Called by heartbeat, tracking sync, visits, orders, etc.
--    Updates last_seen_at AND clears inactive_warning if active
-- ================================================================

CREATE OR REPLACE FUNCTION public.touch_session_activity(
    p_session_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    UPDATE public.workday_sessions
    SET last_seen_at = now(),
        status = CASE
            WHEN status = 'inactive_warning' THEN 'active'
            ELSE status
        END,
        warning_cleared_at = CASE
            WHEN status = 'inactive_warning' THEN now()
            ELSE warning_cleared_at
        END,
        updated_at = now()
    WHERE id = p_session_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.touch_session_activity TO authenticated;

-- ================================================================
-- 3. Modify record_heartbeat to use touch_session_activity
-- ================================================================

CREATE OR REPLACE FUNCTION public.record_heartbeat(
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
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    PERFORM public.touch_session_activity(p_session_id);

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ================================================================
-- 4. Modify sync_tracking_points to touch_session_activity
-- ================================================================

CREATE OR REPLACE FUNCTION public.sync_tracking_points(
    p_token uuid,
    p_session_id uuid,
    p_points jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_points_arr jsonb;
    v_point jsonb;
    v_synced int := 0;
    v_rejected int := 0;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    IF NOT EXISTS (SELECT 1 FROM public.workday_sessions
        WHERE id = p_session_id AND employee_id = v_employee_id) THEN
        RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
    END IF;

    PERFORM public.touch_session_activity(p_session_id);

    IF jsonb_typeof(p_points) = 'string' THEN
        v_points_arr := p_points::jsonb;
    ELSE
        v_points_arr := p_points;
    END IF;

    FOR v_point IN SELECT * FROM jsonb_array_elements(v_points_arr)
    LOOP
        BEGIN
            IF v_point->>'latitude' IS NULL OR v_point->>'longitude' IS NULL
               OR (v_point->>'latitude')::decimal IS NULL
               OR (v_point->>'longitude')::decimal IS NULL THEN
                v_rejected := v_rejected + 1;
                CONTINUE;
            END IF;
            INSERT INTO public.tracking_points (
                session_id, employee_id, latitude, longitude,
                accuracy_meters, altitude_meters, speed_mps, heading_degrees,
                battery_pct, recorded_at, point_type
            ) VALUES (
                p_session_id, v_employee_id,
                (v_point->>'latitude')::decimal,
                (v_point->>'longitude')::decimal,
                (v_point->>'accuracy_meters')::decimal,
                (v_point->>'altitude_meters')::decimal,
                (v_point->>'speed_mps')::decimal,
                (v_point->>'heading_degrees')::decimal,
                (v_point->>'battery_pct')::decimal,
                (v_point->>'recorded_at')::timestamptz,
                COALESCE(v_point->>'point_type', 'periodic')
            );
            v_synced := v_synced + 1;
        EXCEPTION WHEN OTHERS THEN
            v_rejected := v_rejected + 1;
        END;
    END LOOP;

    RETURN jsonb_build_object('synced', v_synced, 'rejected', v_rejected);
END;
$function$;

-- ================================================================
-- 5. Modified start_workday — blocks new session if stale session
--    exists from a previous day
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
    WHERE employee_id = v_employee_id AND date = CURRENT_DATE AND status IN ('active', 'inactive_warning');
    IF FOUND THEN RETURN jsonb_build_object('error', 'ALREADY_ACTIVE', 'session_id', v_existing_id); END IF;

    -- CHECK 3: GPS required
    IF p_latitude IS NULL OR p_longitude IS NULL THEN
        RETURN jsonb_build_object('error', 'GPS_REQUIRED');
    END IF;

    SELECT id INTO v_policy_id FROM public.employee_work_policies WHERE employee_id = v_employee_id;

    INSERT INTO public.workday_sessions (employee_id, start_latitude, start_longitude, start_device_status, work_policy_id)
    VALUES (v_employee_id, p_latitude, p_longitude, p_device_status, v_policy_id)
    RETURNING id INTO v_existing_id;

    PERFORM public.touch_session_activity(v_existing_id);

    INSERT INTO public.tracking_points (session_id, employee_id, latitude, longitude, recorded_at, point_type)
    VALUES (v_existing_id, v_employee_id, p_latitude, p_longitude, now(), 'start');

    RETURN jsonb_build_object('session_id', v_existing_id, 'started_at', now());
END;
$function$;

-- ================================================================
-- 6. Modified end_workday — records close_reason;
--    auto-closed sessions get attendance_status = 'auto_closed'
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

    -- Calculate attendance status
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
    ELSIF p_close_reason IN ('no_activity_timeout', 'day_rollover') THEN
        v_attendance_status := 'auto_closed';
    END IF;

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
-- 7. check_session_timeout — inactivity detection engine
--    Called by frontend heartbeat every 60s
--
--    Inactivity = no tracking_point, heartbeat, visit, order,
--                  collection, or new customer for 2 continuous hours
--    Warning = 5 min grace, then auto-close
--    Midnight rollover = 00:00–00:05 window
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
    v_inactive_seconds numeric;
    v_warning_seconds numeric;
    v_last_activity timestamptz;
    v_has_recent_activity boolean;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_ws FROM public.workday_sessions
    WHERE id = p_session_id AND employee_id = v_employee_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;

    -- Skip completed sessions
    IF v_ws.status = 'completed' THEN
        RETURN jsonb_build_object('action', 'completed');
    END IF;

    -- ============================================================
    -- Case 1: Midnight rollover (00:00–00:05) — close stale sessions
    -- ============================================================
    IF v_ws.status IN ('active', 'inactive_warning') AND v_ws.date < CURRENT_DATE
       AND EXTRACT(HOUR FROM now()) = 0 AND EXTRACT(MINUTE FROM now()) <= 5 THEN
        PERFORM public.end_workday(p_token, p_session_id,
            p_latitude => v_ws.end_latitude,
            p_longitude => v_ws.end_longitude,
            p_close_reason => 'day_rollover'
        );
        RETURN jsonb_build_object(
            'action', 'auto_closed',
            'reason', 'day_rollover',
            'message', 'تم إنهاء يوم العمل تلقائياً لانتهاء اليوم وعدم تسجيل خروج.'
        );
    END IF;

    -- ============================================================
    -- Determine last activity time
    -- Source of truth: last_seen_at (heartbeat) OR last tracking point
    -- ============================================================
    SELECT COALESCE(
        v_ws.last_seen_at,
        (SELECT MAX(recorded_at) FROM public.tracking_points WHERE session_id = p_session_id),
        v_ws.start_time
    ) INTO v_last_activity;

    v_inactive_seconds := EXTRACT(EPOCH FROM (now() - v_last_activity));

    -- Also check for business activity (visits, orders, collections, new customers)
    SELECT EXISTS (
        SELECT 1 FROM public.tracking_points
        WHERE session_id = p_session_id AND recorded_at > now() - interval '2 hours'
        UNION
        SELECT 1 FROM public.visits v
        WHERE v.employee_id = v_employee_id AND v.check_in_at > now() - interval '2 hours'
        UNION
        SELECT 1 FROM public.orders o
        WHERE o.owner_id = v_employee_id AND o.created_at > now() - interval '2 hours'
        UNION
        SELECT 1 FROM public.collections c
        WHERE c.owner_id = v_employee_id AND c.created_at > now() - interval '2 hours'
        UNION
        SELECT 1 FROM public.customers cu
        WHERE cu.owner_id = v_employee_id AND cu.created_at > now() - interval '2 hours'
    ) INTO v_has_recent_activity;

    -- If there's recent business activity but last_seen_at is old, update it
    IF v_has_recent_activity AND v_inactive_seconds > 120 THEN
        PERFORM public.touch_session_activity(p_session_id);
        IF v_ws.status = 'inactive_warning' THEN
            RETURN jsonb_build_object(
                'action', 'warning_cleared',
                'message', 'تم تسجيل نشاط جديد. تم إلغاء تحذير الخمول.'
            );
        END IF;
        v_inactive_seconds := 0;
    END IF;

    -- ============================================================
    -- Case 2: In inactive_warning — check grace period
    -- ============================================================
    IF v_ws.status = 'inactive_warning' THEN
        v_warning_seconds := EXTRACT(EPOCH FROM (now() - v_ws.warning_sent_at));

        -- Activity during warning → clear it
        IF v_inactive_seconds < 120 THEN
            UPDATE public.workday_sessions
            SET status = 'active', warning_cleared_at = now(), updated_at = now()
            WHERE id = p_session_id;

            RETURN jsonb_build_object(
                'action', 'warning_cleared',
                'message', 'تم تسجيل نشاط جديد. تم إلغاء تحذير الخمول.'
            );
        END IF;

        -- 5 min grace passed → auto-close
        IF v_warning_seconds >= 300 THEN
            PERFORM public.end_workday(p_token, p_session_id,
                p_latitude => v_ws.end_latitude,
                p_longitude => v_ws.end_longitude,
                p_close_reason => 'no_activity_timeout'
            );
            RETURN jsonb_build_object(
                'action', 'auto_closed',
                'reason', 'no_activity_timeout',
                'message', 'تم إنهاء يوم العمل تلقائياً لعدم وجود أى نشاط منذ أكثر من ساعتين.'
            );
        END IF;

        -- Still in warning grace period
        RETURN jsonb_build_object(
            'action', 'warning_active',
            'inactive_minutes', (v_inactive_seconds / 60)::int,
            'warning_remaining_seconds', (300 - v_warning_seconds)::int,
            'message', 'لم يتم رصد أى نشاط منذ ' || (v_inactive_seconds / 60)::int || ' دقيقة. سيتم إنهاء يوم العمل تلقائياً خلال ' || (300 - v_warning_seconds)::int || ' ثانية إذا لم يتم تسجيل أى نشاط جديد.'
        );
    END IF;

    -- ============================================================
    -- Case 3: Active but 2h+ inactivity → issue warning
    -- ============================================================
    IF v_ws.status = 'active' AND v_inactive_seconds >= 7200 THEN  -- 2 hours
        UPDATE public.workday_sessions
        SET status = 'inactive_warning', warning_sent_at = now(), updated_at = now()
        WHERE id = p_session_id;

        RETURN jsonb_build_object(
            'action', 'warning_issued',
            'inactive_minutes', (v_inactive_seconds / 60)::int,
            'message', 'لم يتم رصد أى نشاط منذ ساعتين. سيتم إنهاء يوم العمل تلقائياً خلال 5 دقائق إذا لم يتم تسجيل أى نشاط جديد.'
        );
    END IF;

    -- ============================================================
    -- Case 4: Active and within timeout — no action
    -- ============================================================
    RETURN jsonb_build_object(
        'action', 'ok',
        'inactive_minutes', (v_inactive_seconds / 60)::int
    );
END;
$function$;

-- ================================================================
-- 8. resolve_stale_session — called when user wants to close the
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
            p_close_reason => 'day_rollover'
        );
        RETURN jsonb_build_object('ok', true, 'action', 'closed');
    ELSIF p_action = 'request_review' THEN
        RETURN jsonb_build_object('ok', true, 'action', 'pending_review');
    ELSE
        RETURN jsonb_build_object('error', 'INVALID_ACTION');
    END IF;
END;
$function$;

-- ================================================================
-- 9. Batch cleanup — for Edge Function / pg_cron
-- ================================================================

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
    v_inactive_seconds numeric;
    v_warning_seconds numeric;
    v_last_activity timestamptz;
    v_is_midnight boolean;
BEGIN
    v_is_midnight := EXTRACT(HOUR FROM now()) = 0 AND EXTRACT(MINUTE FROM now()) <= 5;

    FOR v_ws IN
        SELECT * FROM public.workday_sessions
        WHERE status IN ('active', 'inactive_warning')
    LOOP
        SELECT COALESCE(
            v_ws.last_seen_at,
            (SELECT MAX(recorded_at) FROM public.tracking_points WHERE session_id = v_ws.id),
            v_ws.start_time
        ) INTO v_last_activity;

        v_inactive_seconds := EXTRACT(EPOCH FROM (now() - v_last_activity));

        -- Midnight rollover
        IF v_is_midnight AND v_ws.date < CURRENT_DATE THEN
            UPDATE public.workday_sessions
            SET end_time = COALESCE(v_ws.last_seen_at, now()),
                status = 'completed',
                close_reason = 'day_rollover',
                attendance_status = 'auto_closed',
                updated_at = now()
            WHERE id = v_ws.id;
            v_closed := v_closed + 1;

        -- In warning, 5min+ passed → auto-close
        ELSIF v_ws.status = 'inactive_warning' THEN
            v_warning_seconds := EXTRACT(EPOCH FROM (now() - v_ws.warning_sent_at));
            IF v_warning_seconds >= 300 THEN
                UPDATE public.workday_sessions
                SET end_time = COALESCE(v_ws.last_seen_at, now()),
                    status = 'completed',
                    close_reason = 'no_activity_timeout',
                    attendance_status = 'auto_closed',
                    updated_at = now()
                WHERE id = v_ws.id;
                v_closed := v_closed + 1;
            END IF;

        -- Active, 2h+ inactive → send warning
        ELSIF v_ws.status = 'active' AND v_inactive_seconds >= 7200 THEN
            UPDATE public.workday_sessions
            SET status = 'inactive_warning', warning_sent_at = now(), updated_at = now()
            WHERE id = v_ws.id;
            v_warned := v_warned + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('closed', v_closed, 'warned', v_warned);
END;
$function$;

-- ================================================================
-- 10. Admin RPCs — Auto-closed session counters
-- ================================================================

-- Today's auto-closed sessions (detailed)
CREATE OR REPLACE FUNCTION public.get_auto_closed_sessions_today(
    p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'employee_name', e.name,
            'employee_code', e.code,
            'close_reason', ws.close_reason,
            'last_seen_at', ws.last_seen_at,
            'auto_closed_at', ws.updated_at,
            'start_time', ws.start_time,
            'date', ws.date
        )
        ORDER BY ws.updated_at DESC
    ) INTO v_result
    FROM public.workday_sessions ws
    JOIN public.employees e ON e.id = ws.employee_id
    WHERE ws.status = 'completed'
      AND ws.close_reason IN ('no_activity_timeout', 'day_rollover')
      AND ws.updated_at >= CURRENT_DATE
      AND ws.updated_at < CURRENT_DATE + interval '1 day';

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- This month's auto-closed session count
CREATE OR REPLACE FUNCTION public.get_auto_closed_sessions_month(
    p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT jsonb_build_object(
        'total_count', COUNT(*),
        'by_reason', (
            SELECT jsonb_object_agg(ws.close_reason, cnt)
            FROM (
                SELECT ws.close_reason, COUNT(*) AS cnt
                FROM public.workday_sessions ws
                WHERE ws.status = 'completed'
                  AND ws.close_reason IN ('no_activity_timeout', 'day_rollover')
                  AND ws.updated_at >= date_trunc('month', CURRENT_DATE)
                  AND ws.updated_at < date_trunc('month', CURRENT_DATE) + interval '1 month'
                GROUP BY ws.close_reason
            ) ws
        ),
        'details', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'employee_name', e.name,
                    'employee_code', e.code,
                    'close_reason', ws.close_reason,
                    'last_seen_at', ws.last_seen_at,
                    'auto_closed_at', ws.updated_at,
                    'date', ws.date
                )
                ORDER BY ws.updated_at DESC
            )
            FROM public.workday_sessions ws
            JOIN public.employees e ON e.id = ws.employee_id
            WHERE ws.status = 'completed'
              AND ws.close_reason IN ('no_activity_timeout', 'day_rollover')
              AND ws.updated_at >= date_trunc('month', CURRENT_DATE)
              AND ws.updated_at < date_trunc('month', CURRENT_DATE) + interval '1 month'
        )
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

-- ================================================================
-- 11. Grants
-- ================================================================

GRANT EXECUTE ON FUNCTION public.start_workday TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_workday TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_heartbeat TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_tracking_points TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_session_timeout TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_stale_session TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_close_stale_sessions TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_session_activity TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auto_closed_sessions_today TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auto_closed_sessions_month TO authenticated;
