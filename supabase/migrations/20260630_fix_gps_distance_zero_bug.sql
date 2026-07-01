-- ================================================================
-- Fix: Zero distance bug in GPS tracking
--
-- Problems:
--   1. Garbage GPS coordinates (near 0,0) poison the anchor point,
--      causing all subsequent real coordinates to be filtered as
--      speed outliers → 0 distance despite real travel.
--   2. When ALL points have accuracy > p_max_accuracy (e.g. 88m
--      vs 50m threshold), every point is filtered → 0 distance
--      even for 15+ km of real movement.
--   3. No anchor reset mechanism: once anchor is set on a bad
--      point, there is no recovery for the entire session.
--
-- Fix:
--   1. GPS coordinate validation — skip points with lat/lng
--      outside valid range or too close to (0,0).
--   2. Two-pass fallback — if pass 1 yields 0 despite having
--      ≥2 valid points, retry with relaxed accuracy (max 500m).
--   3. Speed outlier anchor reset — after 5 consecutive speed
--      skips, reset anchor to the current point.
-- ================================================================

-- ================================================================
-- 1. Fix calculate_session_distance
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
    v_valid_count int := 0;
    v_consecutive_speed_skips int := 0;
    v_use_relaxed_accuracy boolean := false;
    v_effective_max_accuracy numeric;
BEGIN
    LOOP
        v_total_distance := 0;
        v_anchor_set := false;
        v_consecutive_speed_skips := 0;
        v_i := 0;

        IF v_use_relaxed_accuracy THEN
            v_effective_max_accuracy := GREATEST(p_max_accuracy, 500);
        ELSE
            v_effective_max_accuracy := p_max_accuracy;
        END IF;

        FOR v_pt IN
            SELECT tp.latitude, tp.longitude, tp.recorded_at, tp.accuracy_meters
            FROM public.tracking_points tp
            WHERE tp.session_id = p_session_id
            ORDER BY tp.recorded_at
        LOOP
            v_i := v_i + 1;

            -- 1. GPS coordinate validation — skip garbage points
            IF v_pt.latitude < -90 OR v_pt.latitude > 90
               OR v_pt.longitude < -180 OR v_pt.longitude > 180
               OR (ABS(v_pt.latitude) < 0.01 AND ABS(v_pt.longitude) < 0.01) THEN
                CONTINUE;
            END IF;

            v_valid_count := v_valid_count + 1;

            IF NOT v_anchor_set THEN
                IF v_pt.accuracy_meters IS NULL OR v_pt.accuracy_meters <= v_effective_max_accuracy THEN
                    v_anchor_lat := v_pt.latitude;
                    v_anchor_lng := v_pt.longitude;
                    v_anchor_time := v_pt.recorded_at;
                    v_anchor_set := true;
                END IF;
            ELSE
                -- Accuracy filter
                IF v_pt.accuracy_meters IS NOT NULL AND v_pt.accuracy_meters > v_effective_max_accuracy THEN
                    CONTINUE;
                END IF;

                -- Haversine distance from anchor
                v_dist := 6371000 * 2 * asin(sqrt(
                    power(sin(radians(v_pt.latitude - v_anchor_lat) / 2), 2) +
                    cos(radians(v_anchor_lat)) * cos(radians(v_pt.latitude)) *
                    power(sin(radians(v_pt.longitude - v_anchor_lng) / 2), 2)
                ));

                -- Min distance filter (GPS drift)
                IF v_dist < p_min_distance_threshold THEN
                    v_consecutive_speed_skips := 0;
                    CONTINUE;
                END IF;

                -- Speed filter
                v_time_diff_sec := EXTRACT(EPOCH FROM (v_pt.recorded_at - v_anchor_time));
                IF v_time_diff_sec > 0 THEN
                    v_speed := v_dist / v_time_diff_sec;
                    IF v_speed > p_max_speed THEN
                        v_consecutive_speed_skips := v_consecutive_speed_skips + 1;
                        -- Reset anchor if too many consecutive speed outliers
                        IF v_consecutive_speed_skips >= 5 THEN
                            v_anchor_lat := v_pt.latitude;
                            v_anchor_lng := v_pt.longitude;
                            v_anchor_time := v_pt.recorded_at;
                            v_consecutive_speed_skips := 0;
                        END IF;
                        CONTINUE;
                    END IF;
                END IF;

                -- Passed all filters
                v_total_distance := v_total_distance + v_dist;
                v_consecutive_speed_skips := 0;
                v_anchor_lat := v_pt.latitude;
                v_anchor_lng := v_pt.longitude;
                v_anchor_time := v_pt.recorded_at;
            END IF;
        END LOOP;

        -- Exit if: result is non-zero, already tried relaxed, or too few valid points
        IF v_total_distance > 0 OR v_use_relaxed_accuracy OR v_valid_count < 2 THEN
            EXIT;
        END IF;

        v_use_relaxed_accuracy := true;
    END LOOP;

    RETURN v_total_distance::int;
END;
$function$;

-- ================================================================
-- 2. Fix get_employee_day_map — same coordinate validation +
--    two-pass fallback + speed outlier anchor reset
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_employee_day_map(
    p_token uuid,
    p_employee_id uuid,
    p_date date DEFAULT CURRENT_DATE,
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
    v_session app.sessions;
    v_subtree_ids uuid[];
    v_session_record record;
    v_route jsonb;
    v_stops jsonb;
    v_visit_locations jsonb;
    v_route_arr jsonb[];
    v_pt record;
    v_i int := 0;
    v_prev_time timestamptz;
    v_prev_lat numeric;
    v_prev_lng numeric;
    v_gap_minutes numeric;

    -- Drift-filtered distance tracking (anchor-based)
    v_total_distance numeric := 0;
    v_anchor_lat numeric;
    v_anchor_lng numeric;
    v_anchor_time timestamptz;
    v_anchor_set boolean := false;
    v_dist numeric;
    v_time_diff_sec numeric;
    v_speed numeric;
    v_consecutive_speed_skips int := 0;

    -- Statistics
    v_max_consecutive_distance numeric := 0;
    v_skipped_accuracy int := 0;
    v_skipped_min_distance int := 0;
    v_skipped_speed int := 0;
    v_counted_segments int := 0;
    v_valid_count int := 0;

    -- Fallback pass
    v_use_relaxed_accuracy boolean := false;
    v_effective_max_accuracy numeric;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'attendance.view_timeline') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;
    IF v_subtree_ids IS NOT NULL AND NOT (p_employee_id = ANY(v_subtree_ids)) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT * INTO v_session_record FROM public.workday_sessions wds
    WHERE wds.employee_id = p_employee_id AND wds.date = p_date
    ORDER BY wds.start_time DESC LIMIT 1;

    -- Build route array (unfiltered — always correct for visual map) and calculate distance
    LOOP
        -- Reset per-pass counters (route is kept across passes)
        v_total_distance := 0;
        v_anchor_set := false;
        v_consecutive_speed_skips := 0;
        v_skipped_accuracy := 0;
        v_skipped_min_distance := 0;
        v_skipped_speed := 0;
        v_counted_segments := 0;
        v_valid_count := 0;
        v_i := 0;

        IF v_use_relaxed_accuracy THEN
            v_effective_max_accuracy := GREATEST(p_max_accuracy, 500);
        ELSE
            v_effective_max_accuracy := p_max_accuracy;
        END IF;

        FOR v_pt IN
            SELECT tp.latitude, tp.longitude, tp.recorded_at, tp.point_type, tp.accuracy_meters
            FROM public.tracking_points tp
            WHERE tp.employee_id = p_employee_id AND tp.recorded_at::date = p_date
            ORDER BY tp.recorded_at
        LOOP
            v_i := v_i + 1;

            -- Only build route array on first pass
            IF NOT v_use_relaxed_accuracy THEN
                v_route_arr := array_append(v_route_arr, jsonb_build_object(
                    'latitude', v_pt.latitude,
                    'longitude', v_pt.longitude,
                    'time', v_pt.recorded_at,
                    'type', v_pt.point_type
                ));

                -- Stop detection (uses all consecutive raw points, unfiltered)
                IF v_i > 1 AND v_prev_time IS NOT NULL THEN
                    v_gap_minutes := EXTRACT(EPOCH FROM (v_pt.recorded_at - v_prev_time)) / 60;
                    IF v_gap_minutes > 5 THEN
                        v_stops := COALESCE(v_stops, '[]'::jsonb) || jsonb_build_object(
                            'start_time', v_prev_time,
                            'end_time', v_pt.recorded_at,
                            'duration_minutes', v_gap_minutes::int,
                            'latitude', v_prev_lat,
                            'longitude', v_prev_lng,
                            'type', 'gap'
                        );
                    END IF;
                END IF;
                v_prev_time := v_pt.recorded_at;
                v_prev_lat := v_pt.latitude;
                v_prev_lng := v_pt.longitude;
            END IF;

            -- GPS coordinate validation — skip garbage points
            IF v_pt.latitude < -90 OR v_pt.latitude > 90
               OR v_pt.longitude < -180 OR v_pt.longitude > 180
               OR (ABS(v_pt.latitude) < 0.01 AND ABS(v_pt.longitude) < 0.01) THEN
                CONTINUE;
            END IF;

            v_valid_count := v_valid_count + 1;

            -- Distance calculation with GPS drift filters (anchor-based)
            IF NOT v_anchor_set THEN
                IF v_pt.accuracy_meters IS NULL OR v_pt.accuracy_meters <= v_effective_max_accuracy THEN
                    v_anchor_lat := v_pt.latitude;
                    v_anchor_lng := v_pt.longitude;
                    v_anchor_time := v_pt.recorded_at;
                    v_anchor_set := true;
                END IF;
            ELSE
                -- Filter 1: low-accuracy points excluded from distance
                IF v_pt.accuracy_meters IS NOT NULL AND v_pt.accuracy_meters > v_effective_max_accuracy THEN
                    v_skipped_accuracy := v_skipped_accuracy + 1;
                    CONTINUE;
                END IF;

                -- Haversine distance from anchor in meters
                v_dist := 6371000 * 2 * asin(sqrt(
                    power(sin(radians(v_pt.latitude - v_anchor_lat) / 2), 2) +
                    cos(radians(v_anchor_lat)) * cos(radians(v_pt.latitude)) *
                    power(sin(radians(v_pt.longitude - v_anchor_lng) / 2), 2)
                ));

                -- Filter 2: below threshold = GPS drift, skip
                IF v_dist < p_min_distance_threshold THEN
                    v_skipped_min_distance := v_skipped_min_distance + 1;
                    CONTINUE;
                END IF;

                -- Filter 3: speed-based outlier (phantom jump detection)
                v_time_diff_sec := EXTRACT(EPOCH FROM (v_pt.recorded_at - v_anchor_time));
                IF v_time_diff_sec > 0 THEN
                    v_speed := v_dist / v_time_diff_sec;
                    IF v_speed > p_max_speed THEN
                        v_skipped_speed := v_skipped_speed + 1;
                        v_consecutive_speed_skips := v_consecutive_speed_skips + 1;
                        -- Reset anchor if too many consecutive speed outliers
                        IF v_consecutive_speed_skips >= 5 THEN
                            v_anchor_lat := v_pt.latitude;
                            v_anchor_lng := v_pt.longitude;
                            v_anchor_time := v_pt.recorded_at;
                            v_consecutive_speed_skips := 0;
                        END IF;
                        CONTINUE;
                    END IF;
                END IF;

                -- Passed all filters: count this segment
                v_total_distance := v_total_distance + v_dist;
                v_counted_segments := v_counted_segments + 1;
                v_consecutive_speed_skips := 0;

                -- Track max consecutive distance
                IF v_dist > v_max_consecutive_distance THEN
                    v_max_consecutive_distance := v_dist;
                END IF;

                -- Update anchor to current point
                v_anchor_lat := v_pt.latitude;
                v_anchor_lng := v_pt.longitude;
                v_anchor_time := v_pt.recorded_at;
            END IF;
        END LOOP;

        -- Exit if: result is non-zero, already tried relaxed, or too few valid points
        IF v_total_distance > 0 OR v_use_relaxed_accuracy OR v_valid_count < 2 THEN
            EXIT;
        END IF;

        v_use_relaxed_accuracy := true;
    END LOOP;

    -- Build visit locations (only once)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'visit_id', v.id,
        'customer_id', v.customer_id,
        'customer_name', c.company_name,
        'latitude', v.check_in_latitude,
        'longitude', v.check_in_longitude,
        'check_in_at', v.check_in_at,
        'check_out_at', v.check_out_at,
        'visit_result', v.visit_result
    ) ORDER BY v.check_in_at), '[]'::jsonb) INTO v_visit_locations
    FROM public.visits v
    LEFT JOIN public.customers c ON c.id = v.customer_id
    WHERE v.employee_id = p_employee_id AND v.check_in_at::date = p_date
    AND v.check_in_latitude IS NOT NULL;

    v_route := COALESCE((SELECT jsonb_agg(elem) FROM unnest(v_route_arr) AS elem), '[]'::jsonb);

    RETURN jsonb_build_object(
        'session', jsonb_build_object(
            'employee_id', v_session_record.employee_id,
            'date', v_session_record.date,
            'start_time', v_session_record.start_time,
            'end_time', v_session_record.end_time,
            'attendance_status', v_session_record.attendance_status
        ),
        'route', COALESCE(v_route, '[]'::jsonb),
        'total_points', v_i,
        'total_distance_meters', v_total_distance::int,
        'total_distance_km', round((v_total_distance / 1000)::numeric, 2),
        'total_counted_segments', v_counted_segments,
        'max_consecutive_distance', v_max_consecutive_distance::int,
        'filter_stats', jsonb_build_object(
            'skipped_accuracy', v_skipped_accuracy,
            'skipped_min_distance', v_skipped_min_distance,
            'skipped_speed', v_skipped_speed,
            'min_distance_threshold', p_min_distance_threshold,
            'max_accuracy', p_max_accuracy,
            'max_speed', p_max_speed
        ),
        'visit_locations', COALESCE(v_visit_locations, '[]'::jsonb),
        'long_stops', COALESCE(v_stops, '[]'::jsonb),
        'long_stops_count', COALESCE(jsonb_array_length(v_stops), 0),
        'long_stops_total_minutes', COALESCE((SELECT SUM((s->>'duration_minutes')::int) FROM jsonb_array_elements(v_stops) s), 0)
    );
END;
$function$;

-- ================================================================
-- 3. Grants
-- ================================================================

GRANT EXECUTE ON FUNCTION public.calculate_session_distance TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_session_distances TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_day_map TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_workday TO authenticated;
