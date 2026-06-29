-- ================================================================
-- Fix: Persist session distance at end_workday + backfill history
--
-- Problem:
--   end_workday never updates workday_sessions.total_distance_meters.
--   All RPCs read the stored column, which is always 0 or NULL.
--
-- Fix (Option D — hybrid):
--   1. Helper function calculate_session_distance — Haversine + drift
--      filters (accuracy >50m, min move 20m, speed >5m/s → skip).
--      Same algorithm as get_employee_day_map.
--   2. backfill_session_distances — loops all zero/NULL records and
--      persists computed distance. Designed for one-time historical fix.
--   3. Modified end_workday — calls calculate_session_distance before
--      the final UPDATE and stores it in total_distance_meters.
--   4. On-the-fly fallback exists via RPC call if cached value is
--      missing (edge case for sessions closed before this migration).
-- ================================================================

-- ================================================================
-- 1. Helper: calculate_session_distance
--    Pure function — same Haversine + 3 drift filters as
--    get_employee_day_map. Returns meters (integer).
-- ================================================================

CREATE OR REPLACE FUNCTION public.calculate_session_distance(
    p_session_id uuid,
    p_min_distance_threshold numeric DEFAULT 20,
    p_max_accuracy numeric DEFAULT 50,
    p_max_speed numeric DEFAULT 5
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_total_distance numeric := 0;
    v_anchor_lat numeric;
    v_anchor_lng numeric;
    v_anchor_time timestamptz;
    v_anchor_set boolean := false;
    v_pt record;
    v_dist numeric;
    v_time_diff_sec numeric;
    v_speed numeric;
    v_i int := 0;
BEGIN
    FOR v_pt IN
        SELECT tp.latitude, tp.longitude, tp.recorded_at, tp.accuracy_meters
        FROM public.tracking_points tp
        WHERE tp.session_id = p_session_id
        ORDER BY tp.recorded_at
    LOOP
        v_i := v_i + 1;

        IF v_i = 1 THEN
            IF v_pt.accuracy_meters IS NULL OR v_pt.accuracy_meters <= p_max_accuracy THEN
                v_anchor_lat := v_pt.latitude;
                v_anchor_lng := v_pt.longitude;
                v_anchor_time := v_pt.recorded_at;
                v_anchor_set := true;
            END IF;
        ELSIF NOT v_anchor_set THEN
            IF v_pt.accuracy_meters IS NULL OR v_pt.accuracy_meters <= p_max_accuracy THEN
                v_anchor_lat := v_pt.latitude;
                v_anchor_lng := v_pt.longitude;
                v_anchor_time := v_pt.recorded_at;
                v_anchor_set := true;
            END IF;
        ELSE
            IF v_pt.accuracy_meters IS NOT NULL AND v_pt.accuracy_meters > p_max_accuracy THEN
                CONTINUE;
            END IF;

            v_dist := 6371000 * 2 * asin(sqrt(
                power(sin(radians(v_pt.latitude - v_anchor_lat) / 2), 2) +
                cos(radians(v_anchor_lat)) * cos(radians(v_pt.latitude)) *
                power(sin(radians(v_pt.longitude - v_anchor_lng) / 2), 2)
            ));

            IF v_dist < p_min_distance_threshold THEN
                CONTINUE;
            END IF;

            v_time_diff_sec := EXTRACT(EPOCH FROM (v_pt.recorded_at - v_anchor_time));
            IF v_time_diff_sec > 0 THEN
                v_speed := v_dist / v_time_diff_sec;
                IF v_speed > p_max_speed THEN
                    CONTINUE;
                END IF;
            END IF;

            v_total_distance := v_total_distance + v_dist;

            v_anchor_lat := v_pt.latitude;
            v_anchor_lng := v_pt.longitude;
            v_anchor_time := v_pt.recorded_at;
        END IF;
    END LOOP;

    RETURN v_total_distance::int;
END;
$function$;

-- ================================================================
-- 2. Backfill: loop all sessions with zero/NULL distance and persist
--    Run ONCE after migration:
--       SELECT public.backfill_session_distances();
-- ================================================================

CREATE OR REPLACE FUNCTION public.backfill_session_distances(
    p_min_distance_threshold numeric DEFAULT 20,
    p_max_accuracy numeric DEFAULT 50,
    p_max_speed numeric DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session record;
    v_distance integer;
    v_updated int := 0;
    v_with_points int := 0;
    v_no_points int := 0;
    v_null_before int := 0;
    v_zero_before int := 0;
BEGIN
    SELECT COUNT(*) INTO v_null_before
    FROM public.workday_sessions
    WHERE total_distance_meters IS NULL;

    SELECT COUNT(*) INTO v_zero_before
    FROM public.workday_sessions
    WHERE total_distance_meters = 0;

    FOR v_session IN
        SELECT id
        FROM public.workday_sessions
        WHERE total_distance_meters IS NULL OR total_distance_meters = 0
        ORDER BY date ASC
    LOOP
        SELECT COUNT(*) INTO v_no_points
        FROM public.tracking_points
        WHERE session_id = v_session.id
        LIMIT 1;

        v_distance := public.calculate_session_distance(
            v_session.id,
            p_min_distance_threshold,
            p_max_accuracy,
            p_max_speed
        );

        UPDATE public.workday_sessions
        SET total_distance_meters = v_distance,
            updated_at = now()
        WHERE id = v_session.id;

        v_updated := v_updated + 1;
        IF v_no_points > 0 THEN
            v_with_points := v_with_points + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'total_processed', v_updated,
        'with_tracking_points', v_with_points,
        'no_tracking_points', (v_updated - v_with_points),
        'null_before', v_null_before,
        'zero_before', v_zero_before,
        'thresholds', jsonb_build_object(
            'min_distance', p_min_distance_threshold,
            'max_accuracy', p_max_accuracy,
            'max_speed', p_max_speed
        )
    );
END;
$function$;

-- ================================================================
-- 3. Update end_workday — persist distance at close
--    Only change: calculate_session_distance() + total_distance_meters
--    in the final UPDATE.
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
        'total_distance_meters', v_distance
    );
END;
$function$;

-- ================================================================
-- 4. Grants
-- ================================================================

GRANT EXECUTE ON FUNCTION public.calculate_session_distance TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_session_distances TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_workday TO authenticated;
