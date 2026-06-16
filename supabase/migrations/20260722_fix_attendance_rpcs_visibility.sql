-- Fix 3 attendance RPCs: get_visible_employee_ids returns uuid[], not SETOF
-- Replace FROM-subquery pattern with = ANY() to avoid:
--   operator does not exist: uuid[] = uuid  (→ PostgREST translates to 404)

CREATE OR REPLACE FUNCTION public.get_employee_day_map(p_token uuid, p_employee_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_session_record record;
    v_start_point jsonb; v_end_point jsonb; v_route jsonb; v_visit_locations jsonb;
    v_total_distance numeric := 0; v_prev_lat numeric; v_prev_lng numeric;
    v_pt record; v_i int := 0; v_pt_count int; v_dist numeric;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      IF NOT (p_employee_id = ANY(public.get_visible_employee_ids(p_token))) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
    SELECT * INTO v_session_record FROM public.workday_sessions
    WHERE employee_id = p_employee_id AND date = p_date ORDER BY start_time DESC LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_SESSION'); END IF;

    SELECT COUNT(*) INTO v_pt_count
    FROM public.tracking_points WHERE session_id = v_session_record.id AND point_type IN ('periodic', 'start', 'end');

    -- Build route polyline with time and type
    SELECT COALESCE(jsonb_agg(jsonb_build_object('latitude', latitude, 'longitude', longitude, 'time', recorded_at, 'type', point_type) ORDER BY recorded_at), '[]'::jsonb) INTO v_route
    FROM public.tracking_points WHERE session_id = v_session_record.id AND point_type IN ('periodic', 'start', 'end');

    -- Calculate total distance via Haversine
    FOR v_pt IN
        SELECT latitude, longitude FROM public.tracking_points
        WHERE session_id = v_session_record.id AND point_type IN ('periodic', 'start', 'end')
        ORDER BY recorded_at
    LOOP
        v_i := v_i + 1;
        IF v_i > 1 THEN
            v_dist := 6371000 * 2 * asin(sqrt(
                power(sin(radians(v_pt.latitude - v_prev_lat) / 2), 2) +
                cos(radians(v_prev_lat)) * cos(radians(v_pt.latitude)) *
                power(sin(radians(v_pt.longitude - v_prev_lng) / 2), 2)
            ));
            v_total_distance := v_total_distance + COALESCE(v_dist, 0);
        END IF;
        v_prev_lat := v_pt.latitude;
        v_prev_lng := v_pt.longitude;
    END LOOP;

    SELECT jsonb_build_object('latitude', latitude, 'longitude', longitude, 'recorded_at', recorded_at) INTO v_start_point
    FROM public.tracking_points WHERE session_id = v_session_record.id AND point_type = 'start' ORDER BY recorded_at LIMIT 1;
    SELECT jsonb_build_object('latitude', latitude, 'longitude', longitude, 'recorded_at', recorded_at) INTO v_end_point
    FROM public.tracking_points WHERE session_id = v_session_record.id AND point_type = 'end' ORDER BY recorded_at DESC LIMIT 1;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('visit_id', vl.visit_id, 'latitude', tp.latitude, 'longitude', tp.longitude, 'check_in_at', vl.checkin_at, 'check_out_at', vl.checkout_at) ORDER BY vl.checkin_at), '[]'::jsonb) INTO v_visit_locations
    FROM public.visit_links vl JOIN public.tracking_points tp ON tp.id = vl.checkin_tracking_point_id WHERE vl.session_id = v_session_record.id;

    RETURN jsonb_build_object(
        'session', jsonb_build_object('employee_id', v_session_record.employee_id, 'date', v_session_record.date, 'start_time', v_session_record.start_time, 'end_time', v_session_record.end_time, 'attendance_status', v_session_record.attendance_status),
        'start_point', v_start_point, 'end_point', v_end_point, 'route_polyline', v_route,
        'visit_locations', v_visit_locations,
        'total_points', v_pt_count,
        'total_distance_meters', v_total_distance::int,
        'total_distance_km', round((v_total_distance / 1000)::numeric, 2)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_employee_day_timeline(p_token uuid, p_employee_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_session_record record;
    v_points jsonb; v_breaks jsonb; v_visit_links jsonb; v_distribution jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      IF NOT (p_employee_id = ANY(public.get_visible_employee_ids(p_token))) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
    SELECT * INTO v_session_record FROM public.workday_sessions
    WHERE employee_id = p_employee_id AND date = p_date ORDER BY start_time DESC LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_SESSION'); END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(tp) ORDER BY tp.recorded_at), '[]'::jsonb) INTO v_points
    FROM (SELECT id, latitude, longitude, recorded_at, point_type FROM public.tracking_points WHERE session_id = v_session_record.id ORDER BY recorded_at) tp;
    SELECT COALESCE(jsonb_agg(to_jsonb(wb) ORDER BY wb.break_start), '[]'::jsonb) INTO v_breaks
    FROM (SELECT id, break_start, break_end, duration_seconds, break_reason, auto_closed FROM public.workday_breaks WHERE session_id = v_session_record.id ORDER BY break_start) wb;
    SELECT COALESCE(jsonb_agg(to_jsonb(vl) ORDER BY vl.checkin_at), '[]'::jsonb) INTO v_visit_links
    FROM (SELECT id, visit_id, checkin_at, checkout_at FROM public.visit_links WHERE session_id = v_session_record.id ORDER BY checkin_at) vl;
    SELECT jsonb_build_object(
        'net_work_seconds', EXTRACT(EPOCH FROM (COALESCE(v_session_record.end_time, now()) - v_session_record.start_time)) - COALESCE((SELECT SUM(COALESCE(duration_seconds, 0)) FROM public.workday_breaks WHERE session_id = v_session_record.id), 0),
        'visit_seconds', COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(checkout_at, now()) - checkin_at))) FROM public.visit_links WHERE session_id = v_session_record.id), 0),
        'travel_seconds', COALESCE((SELECT EXTRACT(EPOCH FROM (COALESCE(v_session_record.end_time, now()) - v_session_record.start_time)) - SUM(EXTRACT(EPOCH FROM (COALESCE(checkout_at, now()) - checkin_at))) - COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0) FROM public.visit_links vl2 LEFT JOIN public.workday_breaks wb ON wb.session_id = vl2.session_id AND wb.break_end IS NOT NULL WHERE vl2.session_id = v_session_record.id), 0),
        'break_seconds', COALESCE((SELECT SUM(COALESCE(duration_seconds, 0)) FROM public.workday_breaks WHERE session_id = v_session_record.id), 0)
    ) INTO v_distribution;
    RETURN jsonb_build_object('session', row_to_json(v_session_record), 'points', v_points, 'breaks', v_breaks, 'visit_links', v_visit_links, 'time_distribution', v_distribution, 'attendance_status', v_session_record.attendance_status, 'late_minutes', v_session_record.late_minutes, 'early_departure_minutes', v_session_record.early_departure_minutes);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_employee_workday_history(p_token uuid, p_employee_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      IF NOT (p_employee_id = ANY(public.get_visible_employee_ids(p_token))) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date DESC), '[]'::jsonb) INTO v_result
    FROM (SELECT wds.id, wds.date, wds.start_time, wds.end_time, wds.status,
        EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) / 60 AS duration_minutes,
        wds.total_distance_meters AS distance_meters, wds.visit_count,
        wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
        (SELECT COUNT(*) FROM public.workday_breaks wb WHERE wb.session_id = wds.id) AS break_count,
        (SELECT COALESCE(SUM(duration_seconds), 0) FROM public.workday_breaks wb WHERE wb.session_id = wds.id) AS break_seconds
        FROM public.workday_sessions wds WHERE wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to ORDER BY wds.date DESC) t;
    RETURN jsonb_build_object('sessions', v_result, 'summary', jsonb_build_object(
        'total_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to AND status = 'completed'),
        'late_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to AND attendance_status = 'late'),
        'early_departure_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to AND attendance_status = 'early_departure'),
        'ontime_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to AND attendance_status = 'ontime')));
END;
$$;
