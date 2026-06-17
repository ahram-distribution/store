-- ===============================================================
-- Fix EmployeeWorkdayDetail RPCs — P0 Recovery
-- 
-- Restores get_employee_day_timeline (with events + resolve_employee_id)
-- and get_employee_day_map (with long_stops + GPS drift filtering)
-- that were overwritten by 20260722_fix_attendance_rpcs_visibility.sql
--
-- References:
--   Phase 6 baseline: 20260611_phase6_attendance_v2_complete.sql
--   GPS drift fix:    20260717_fix_employee_day_map_route.sql
--   Identity layer:   20260724_identity_integration_layer.sql
-- ===============================================================

-- Drop old overloads first to avoid "function name is not unique" error
DROP FUNCTION IF EXISTS public.get_employee_day_timeline(uuid, uuid, date) CASCADE;
DROP FUNCTION IF EXISTS public.get_employee_day_map(uuid, uuid, date) CASCADE;
DROP FUNCTION IF EXISTS public.get_employee_day_map(uuid, uuid, date, numeric, numeric, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.get_employee_workday_history CASCADE;
DROP FUNCTION IF EXISTS public.get_completed_workdays_history CASCADE;
DROP FUNCTION IF EXISTS public.get_live_workday_overview CASCADE;

-- =============================================================
-- 1. get_employee_day_timeline — events + resolve_employee_id
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_employee_day_timeline(
    p_token uuid,
    p_employee_id uuid,
    p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_subtree_ids uuid[];
    v_events jsonb;
    v_session_record record;
    v_employee_info jsonb;
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

    SELECT wds.* INTO v_session_record FROM public.workday_sessions wds
    WHERE wds.employee_id = p_employee_id AND wds.date = p_date
    ORDER BY
        CASE WHEN p_date < CURRENT_DATE AND wds.status = 'completed' THEN 0
             WHEN p_date >= CURRENT_DATE AND wds.status = 'active' THEN 0
             ELSE 1 END,
        wds.start_time DESC
    LIMIT 1;

    SELECT jsonb_build_object(
        'id', e.id, 'full_name', e.full_name, 'code', e.code,
        'role_name', COALESCE(r.name, ''),
        'manager_name', COALESCE(m.full_name, '')
    ) INTO v_employee_info
    FROM public.employees e
    LEFT JOIN public.employee_roles er ON er.employee_id = e.id
    LEFT JOIN public.roles r ON r.id = er.role_id
    LEFT JOIN public.employees m ON m.id = e.manager_id
    WHERE e.id = p_employee_id;

    WITH all_events AS (
        SELECT ws.start_time AS event_time, 'workday_start' AS event_type,
            'بدء يوم العمل' AS title, '' AS description,
            ws.start_latitude::text AS lat, ws.start_longitude::text AS lng,
            jsonb_build_object('session_id', ws.id) AS metadata
        FROM public.workday_sessions ws
        WHERE ws.id = v_session_record.id
        UNION ALL
        SELECT ws.end_time, 'workday_end', 'إنهاء يوم العمل', '',
            ws.end_latitude::text, ws.end_longitude::text,
            jsonb_build_object('session_id', ws.id)
        FROM public.workday_sessions ws
        WHERE ws.id = v_session_record.id AND ws.end_time IS NOT NULL
        UNION ALL
        SELECT wb.break_start, 'break_start', 'بداية استراحة',
            COALESCE(wb.break_reason, ''),
            wb.latitude::text, wb.longitude::text,
            jsonb_build_object('break_id', wb.id, 'reason', wb.break_reason)
        FROM public.workday_breaks wb
        WHERE wb.session_id = v_session_record.id
        UNION ALL
        SELECT wb.break_end, 'break_end', 'نهاية استراحة',
            COALESCE(wb.break_reason, ''),
            wb.latitude::text, wb.longitude::text,
            jsonb_build_object('break_id', wb.id, 'duration_seconds', wb.duration_seconds)
        FROM public.workday_breaks wb
        WHERE wb.session_id = v_session_record.id AND wb.break_end IS NOT NULL
        UNION ALL
        SELECT v.check_in_at, 'visit_start', 'بداية زيارة',
            COALESCE(c.company_name, ''),
            v.check_in_latitude::text, v.check_in_longitude::text,
            jsonb_build_object('visit_id', v.id, 'customer_id', v.customer_id, 'customer_name', c.company_name)
        FROM public.visits v
        LEFT JOIN public.customers c ON c.id = v.customer_id
        WHERE v.employee_id = p_employee_id AND v.check_in_at::date = p_date
        UNION ALL
        SELECT v.check_out_at, 'visit_end', 'نهاية زيارة',
            COALESCE(c.company_name, '') || ' — ' || COALESCE(v.visit_result, ''),
            v.check_out_latitude::text, v.check_out_longitude::text,
            jsonb_build_object('visit_id', v.id, 'customer_id', v.customer_id, 'customer_name', c.company_name, 'visit_result', v.visit_result)
        FROM public.visits v
        LEFT JOIN public.customers c ON c.id = v.customer_id
        WHERE v.employee_id = p_employee_id AND v.check_in_at::date = p_date AND v.check_out_at IS NOT NULL
        UNION ALL
        SELECT o.created_at, 'order_created', 'طلب جديد',
            'طلب رقم ' || o.order_number || ' — ' || o.total_amount || ' ج.م',
            o.execution_latitude::text, o.execution_longitude::text,
            jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'total_amount', o.total_amount, 'status', o.status)
        FROM public.orders o
        WHERE public.resolve_employee_id(o.owner_id) = p_employee_id AND o.created_at::date = p_date
        UNION ALL
        SELECT c.created_at, 'collection_taken', 'تحصيل',
            c.amount || ' ج.م — ' || COALESCE(c.method, ''),
            NULL, NULL,
            jsonb_build_object('collection_id', c.id, 'amount', c.amount, 'method', c.method, 'status', c.status)
        FROM public.collections c
        WHERE public.resolve_employee_id(c.owner_id) = p_employee_id AND c.created_at::date = p_date
        UNION ALL
        SELECT c2.created_at, 'new_customer', 'عميل جديد',
            COALESCE(c2.company_name, ''),
            NULL, NULL,
            jsonb_build_object('customer_id', c2.id, 'customer_name', c2.company_name)
        FROM public.customers c2
        WHERE public.resolve_employee_id(c2.owner_id) = p_employee_id AND c2.created_at::date = p_date
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'time', ae.event_time,
        'type', ae.event_type,
        'title', ae.title,
        'description', ae.description,
        'latitude', ae.lat,
        'longitude', ae.lng,
        'metadata', ae.metadata
    ) ORDER BY ae.event_time), '[]'::jsonb) INTO v_events
    FROM all_events ae;

    RETURN jsonb_build_object(
        'employee', v_employee_info,
        'session', jsonb_build_object(
            'id', COALESCE(v_session_record.id, NULL),
            'status', v_session_record.status,
            'start_time', v_session_record.start_time,
            'end_time', v_session_record.end_time,
            'attendance_status', v_session_record.attendance_status
        ),
        'events', v_events
    );
END;
$function$;

-- =============================================================
-- 2. get_employee_day_map — long_stops + GPS drift filtering
-- =============================================================

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

    -- Statistics
    v_max_consecutive_distance numeric := 0;
    v_skipped_accuracy int := 0;
    v_skipped_min_distance int := 0;
    v_skipped_speed int := 0;
    v_counted_segments int := 0;
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
    ORDER BY
        CASE WHEN p_date < CURRENT_DATE AND wds.status = 'completed' THEN 0
             WHEN p_date >= CURRENT_DATE AND wds.status = 'active' THEN 0
             ELSE 1 END,
        wds.start_time DESC
    LIMIT 1;

    -- Build route array with drift-filtered distance calculation + long stop detection
    FOR v_pt IN
        SELECT tp.latitude, tp.longitude, tp.recorded_at, tp.point_type, tp.accuracy_meters
        FROM public.tracking_points tp
        WHERE tp.employee_id = p_employee_id AND tp.recorded_at::date = p_date
        ORDER BY tp.recorded_at
    LOOP
        v_i := v_i + 1;

        -- Always add point to route array for map display (unfiltered)
        v_route_arr := array_append(v_route_arr, jsonb_build_object(
            'latitude', v_pt.latitude,
            'longitude', v_pt.longitude,
            'time', v_pt.recorded_at,
            'type', v_pt.point_type
        ));

        -- Stop detection: uses ALL consecutive raw points (unfiltered)
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

        -- Distance calculation with GPS drift filters (anchor-based)
        IF v_i = 1 THEN
            -- First point: set anchor if accuracy is acceptable
            IF v_pt.accuracy_meters IS NULL OR v_pt.accuracy_meters <= p_max_accuracy THEN
                v_anchor_lat := v_pt.latitude;
                v_anchor_lng := v_pt.longitude;
                v_anchor_time := v_pt.recorded_at;
                v_anchor_set := true;
            END IF;
        ELSIF NOT v_anchor_set THEN
            -- No anchor yet (first point had poor accuracy), try with this point
            IF v_pt.accuracy_meters IS NULL OR v_pt.accuracy_meters <= p_max_accuracy THEN
                v_anchor_lat := v_pt.latitude;
                v_anchor_lng := v_pt.longitude;
                v_anchor_time := v_pt.recorded_at;
                v_anchor_set := true;
            END IF;
        ELSE
            IF v_pt.accuracy_meters IS NOT NULL AND v_pt.accuracy_meters > p_max_accuracy THEN
                v_skipped_accuracy := v_skipped_accuracy + 1;
                CONTINUE;
            END IF;

            v_dist := 6371000 * 2 * asin(sqrt(
                power(sin(radians(v_pt.latitude - v_anchor_lat) / 2), 2) +
                cos(radians(v_anchor_lat)) * cos(radians(v_pt.latitude)) *
                power(sin(radians(v_pt.longitude - v_anchor_lng) / 2), 2)
            ));

            IF v_dist < p_min_distance_threshold THEN
                v_skipped_min_distance := v_skipped_min_distance + 1;
                CONTINUE;
            END IF;

            v_time_diff_sec := EXTRACT(EPOCH FROM (v_pt.recorded_at - v_anchor_time));
            IF v_time_diff_sec > 0 THEN
                v_speed := v_dist / v_time_diff_sec;
                IF v_speed > p_max_speed THEN
                    v_skipped_speed := v_skipped_speed + 1;
                    CONTINUE;
                END IF;
            END IF;

            v_total_distance := v_total_distance + v_dist;
            v_counted_segments := v_counted_segments + 1;

            IF v_dist > v_max_consecutive_distance THEN
                v_max_consecutive_distance := v_dist;
            END IF;

            v_anchor_lat := v_pt.latitude;
            v_anchor_lng := v_pt.longitude;
            v_anchor_time := v_pt.recorded_at;
        END IF;
    END LOOP;

    -- Build visit locations
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

    -- Build flat jsonb array from the route array
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

-- =============================================================
-- 3. get_employee_workday_history — deduplicate by date,
--    include active sessions, pick latest start_time per day
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_employee_workday_history(
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
    v_sessions_json jsonb;
    v_summary_json jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      IF NOT (p_employee_id = ANY(public.get_visible_employee_ids(p_token))) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;

    WITH session_data AS (
        SELECT
            wds.id, wds.date, wds.start_time, wds.end_time, wds.status,
            EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60 AS duration_minutes,
            COALESCE(wb.break_seconds, 0) / 60 AS break_minutes,
            COALESCE(wb.break_count, 0) AS break_count,
            COALESCE(wds.total_distance_meters, 0) AS distance_meters,
            wds.visit_count,
            wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
            COALESCE(od.order_count, 0) AS order_count,
            COALESCE(od.sales_value, 0) AS sales_value,
            COALESCE(cd.collection_count, 0) AS collection_count,
            COALESCE(cd.collection_amount, 0) AS collection_amount,
            COALESCE(nd.new_customer_count, 0) AS new_customer_count
        FROM public.workday_sessions wds
        LEFT JOIN (
            SELECT session_id,
                COUNT(*) AS break_count,
                COALESCE(SUM(duration_seconds), 0) AS break_seconds
            FROM public.workday_breaks
            GROUP BY session_id
        ) wb ON wb.session_id = wds.id
        LEFT JOIN (
            SELECT public.resolve_employee_id(o.owner_id) AS resolved_employee_id,
                o.created_at::date AS d,
                COUNT(*)::int AS order_count,
                COALESCE(SUM(o.total_amount), 0) AS sales_value
            FROM public.orders o
            GROUP BY public.resolve_employee_id(o.owner_id), o.created_at::date
        ) od ON od.resolved_employee_id = wds.employee_id AND od.d = wds.date
        LEFT JOIN (
            SELECT public.resolve_employee_id(c.owner_id) AS resolved_employee_id,
                c.created_at::date AS d,
                COUNT(*)::int AS collection_count,
                COALESCE(SUM(c.amount), 0) AS collection_amount
            FROM public.collections c
            GROUP BY public.resolve_employee_id(c.owner_id), c.created_at::date
        ) cd ON cd.resolved_employee_id = wds.employee_id AND cd.d = wds.date
        LEFT JOIN (
            SELECT public.resolve_employee_id(c2.owner_id) AS resolved_employee_id,
                c2.created_at::date AS d,
                COUNT(*)::int AS new_customer_count
            FROM public.customers c2
            GROUP BY public.resolve_employee_id(c2.owner_id), c2.created_at::date
        ) nd ON nd.resolved_employee_id = wds.employee_id AND nd.d = wds.date
        WHERE wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to
    ),
    ranked AS (
        SELECT *,
            ROW_NUMBER() OVER (
                PARTITION BY employee_id, date
                ORDER BY
                    CASE WHEN date < CURRENT_DATE AND status = 'completed' THEN 0
                         WHEN date >= CURRENT_DATE AND status = 'active' THEN 0
                         ELSE 1 END,
                    start_time DESC
            ) AS rn
        FROM session_data
    )
    SELECT
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', r.id, 'date', r.date, 'start_time', r.start_time, 'end_time', r.end_time,
            'status', r.status,
            'duration_minutes', r.duration_minutes::int,
            'break_minutes', r.break_minutes::int,
            'net_minutes', GREATEST(r.duration_minutes - r.break_minutes, 0)::int,
            'break_count', r.break_count,
            'visit_count', r.visit_count,
            'order_count', r.order_count,
            'sales_value', r.sales_value,
            'collection_count', r.collection_count,
            'collection_amount', r.collection_amount,
            'new_customer_count', r.new_customer_count,
            'distance_meters', r.distance_meters::int,
            'attendance_status', r.attendance_status,
            'late_minutes', r.late_minutes,
            'early_departure_minutes', r.early_departure_minutes
        ) ORDER BY r.date DESC), '[]'::jsonb) FROM ranked r WHERE r.rn = 1),
        jsonb_build_object(
            'total_days', (SELECT COUNT(*) FROM ranked WHERE rn = 1),
            'total_duration_minutes', COALESCE((SELECT SUM(duration_minutes)::int FROM ranked WHERE rn = 1), 0),
            'total_break_minutes', COALESCE((SELECT SUM(break_minutes)::int FROM ranked WHERE rn = 1), 0),
            'total_net_minutes', COALESCE((SELECT SUM(GREATEST(duration_minutes - break_minutes, 0))::int FROM ranked WHERE rn = 1), 0),
            'avg_net_minutes', COALESCE((SELECT AVG(GREATEST(duration_minutes - break_minutes, 0))::int FROM ranked WHERE rn = 1), 0),
            'max_net_day', COALESCE((SELECT MAX(GREATEST(duration_minutes - break_minutes, 0))::int FROM ranked WHERE rn = 1), 0),
            'min_net_day', COALESCE((SELECT MIN(GREATEST(duration_minutes - break_minutes, 0))::int FROM ranked WHERE rn = 1), 0),
            'total_sales_value', COALESCE((SELECT SUM(sales_value)::int FROM ranked WHERE rn = 1), 0),
            'total_orders', COALESCE((SELECT SUM(order_count)::int FROM ranked WHERE rn = 1), 0),
            'total_visits', COALESCE((SELECT SUM(visit_count)::int FROM ranked WHERE rn = 1), 0),
            'total_collections', COALESCE((SELECT SUM(collection_count)::int FROM ranked WHERE rn = 1), 0),
            'total_collections_amount', COALESCE((SELECT SUM(collection_amount)::int FROM ranked WHERE rn = 1), 0),
            'total_new_customers', COALESCE((SELECT SUM(new_customer_count)::int FROM ranked WHERE rn = 1), 0),
            'late_days', (SELECT COUNT(*) FROM ranked WHERE rn = 1 AND attendance_status = 'late'),
            'early_departure_days', (SELECT COUNT(*) FROM ranked WHERE rn = 1 AND attendance_status = 'early_departure'),
            'ontime_days', (SELECT COUNT(*) FROM ranked WHERE rn = 1 AND attendance_status = 'ontime')
        )
    INTO v_sessions_json, v_summary_json;

    RETURN jsonb_build_object('sessions', v_sessions_json, 'summary', v_summary_json);
END;
$function$;

-- =============================================================
-- 4. get_completed_workdays_history — deduplicate by (employee_id, date)
--    using DISTINCT ON with ORDER BY start_time DESC (pick latest session per day)
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_completed_workdays_history(
    p_token uuid,
    p_from date,
    p_to date,
    p_search text DEFAULT NULL,
    p_sort_by text DEFAULT 'total_net_minutes',
    p_sort_order text DEFAULT 'desc',
    p_page int DEFAULT 1,
    p_per_page int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_subtree_ids uuid[];
    v_total_employees int := 0;
    v_offset int;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'attendance.view_history') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;

    v_offset := (p_page - 1) * p_per_page;

    WITH
    visible_employees AS (
        SELECT e.id, e.full_name, e.code, rpl.name AS role_name
        FROM public.employees e
        LEFT JOIN LATERAL (
            SELECT r.name FROM public.employee_roles er
            JOIN public.roles r ON r.id = er.role_id
            WHERE er.employee_id = e.id
            LIMIT 1
        ) rpl ON true
        WHERE e.is_active = true
        AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        AND (
            p_search IS NULL
            OR e.full_name ILIKE '%' || p_search || '%'
            OR e.code ILIKE '%' || p_search || '%'
        )
    ),
    total_count AS (
        SELECT COUNT(*)::int AS cnt FROM visible_employees
    ),
    session_kpis AS (
        SELECT DISTINCT ON (wds.employee_id, wds.date)
            wds.id,
            wds.employee_id,
            wds.date,
            wds.start_time,
            wds.end_time,
            wds.status,
            wds.attendance_status,
            wds.late_minutes,
            wds.early_departure_minutes,
            wds.total_distance_meters,
            wds.visit_count,
            GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60) AS duration_minutes,
            COALESCE(wb.break_minutes, 0) AS break_minutes,
            COALESCE(wb.break_count, 0) AS break_count,
            COALESCE(od.order_count, 0) AS order_count,
            COALESCE(od.sales_value, 0) AS sales_value,
            COALESCE(cd.collection_count, 0) AS collection_count,
            COALESCE(cd.collection_amount, 0) AS collection_amount,
            COALESCE(nd.new_customer_count, 0) AS new_customer_count,
            COALESCE(tp.tracking_points_count, 0) AS tracking_points_count
        FROM public.workday_sessions wds
        JOIN visible_employees ve ON ve.id = wds.employee_id
        LEFT JOIN (
            SELECT wb2.session_id,
                COUNT(*)::int AS break_count,
                COALESCE(SUM(COALESCE(wb2.duration_seconds, 0)), 0) / 60.0 AS break_minutes
            FROM public.workday_breaks wb2
            GROUP BY wb2.session_id
        ) wb ON wb.session_id = wds.id
        LEFT JOIN (
            SELECT o.owner_id, o.created_at::date AS d,
                COUNT(*)::int AS order_count,
                COALESCE(SUM(o.total_amount), 0) AS sales_value
            FROM public.orders o
            GROUP BY o.owner_id, o.created_at::date
        ) od ON od.owner_id = wds.employee_id AND od.d = wds.date
        LEFT JOIN (
            SELECT c.owner_id, c.created_at::date AS d,
                COUNT(*)::int AS collection_count,
                COALESCE(SUM(c.amount), 0) AS collection_amount
            FROM public.collections c
            GROUP BY c.owner_id, c.created_at::date
        ) cd ON cd.owner_id = wds.employee_id AND cd.d = wds.date
        LEFT JOIN (
            SELECT c2.owner_id, c2.created_at::date AS d,
                COUNT(*)::int AS new_customer_count
            FROM public.customers c2
            GROUP BY c2.owner_id, c2.created_at::date
        ) nd ON nd.owner_id = wds.employee_id AND nd.d = wds.date
        LEFT JOIN (
            SELECT tp.session_id,
                COUNT(*)::int AS tracking_points_count
            FROM public.tracking_points tp
            GROUP BY tp.session_id
        ) tp ON tp.session_id = wds.id
        WHERE wds.date >= p_from AND wds.date <= p_to
          AND wds.status = 'completed'
        ORDER BY wds.employee_id, wds.date, wds.start_time DESC
    ),
    emp_aggregates AS (
        SELECT
            sk.employee_id,
            COUNT(*)::int AS total_days,
            COALESCE(SUM(GREATEST(COALESCE(sk.duration_minutes, 0) - COALESCE(sk.break_minutes, 0), 0))::int, 0) AS total_net_minutes,
            COALESCE(AVG(GREATEST(COALESCE(sk.duration_minutes, 0) - COALESCE(sk.break_minutes, 0), 0))::int, 0) AS avg_net_minutes,
            COALESCE(SUM(sk.order_count)::int, 0) AS total_orders,
            COALESCE(SUM(sk.sales_value)::numeric, 0) AS total_sales_value,
            COALESCE(SUM(sk.collection_count)::int, 0) AS total_collection_count,
            COALESCE(SUM(sk.collection_amount)::numeric, 0) AS total_collection_amount,
            COALESCE(SUM(sk.new_customer_count)::int, 0) AS total_new_customers,
            COALESCE(SUM(sk.visit_count)::int, 0) AS total_visits,
            COALESCE(SUM(sk.total_distance_meters)::int, 0) AS total_distance_meters,
            COALESCE(SUM(sk.tracking_points_count)::int, 0) AS total_tracking_points,
            COUNT(*) FILTER (WHERE sk.attendance_status = 'late')::int AS late_count,
            COUNT(*) FILTER (WHERE sk.attendance_status = 'ontime')::int AS ontime_count,
            COUNT(*) FILTER (WHERE sk.attendance_status = 'early_departure')::int AS early_departure_count
        FROM session_kpis sk
        GROUP BY sk.employee_id
    ),

    -- Monthly targets for the date range (prorated by overlapping days)
    target_months AS (
        SELECT generate_series(
            date_trunc('month', p_from)::date,
            date_trunc('month', p_to)::date,
            '1 month'::interval
        )::date AS month_start
    ),
    month_ranges AS (
        SELECT
            tm.month_start,
            (tm.month_start + INTERVAL '1 month' - INTERVAL '1 day')::date AS month_end,
            EXTRACT(DAY FROM (tm.month_start + INTERVAL '1 month' - INTERVAL '1 day'))::int AS days_in_month,
            GREATEST(0, (LEAST(p_to, (tm.month_start + INTERVAL '1 month' - INTERVAL '1 day')::date) - GREATEST(p_from, tm.month_start) + 1))::int AS overlap_days
        FROM target_months tm
    ),
    prorated_targets AS (
        SELECT
            emt.employee_id,
            COALESCE(SUM(
                CASE WHEN mr.overlap_days > 0 AND emt.sales_target > 0
                    THEN (emt.sales_target::numeric / mr.days_in_month) * mr.overlap_days
                    ELSE 0 END
            ), 0) AS sales_target,
            COALESCE(SUM(
                CASE WHEN mr.overlap_days > 0 AND emt.visits_target > 0
                    THEN (emt.visits_target::numeric / mr.days_in_month) * mr.overlap_days
                    ELSE 0 END
            ), 0) AS visits_target,
            COALESCE(SUM(
                CASE WHEN mr.overlap_days > 0 AND emt.orders_target > 0
                    THEN (emt.orders_target::numeric / mr.days_in_month) * mr.overlap_days
                    ELSE 0 END
            ), 0) AS orders_target,
            COALESCE(SUM(
                CASE WHEN mr.overlap_days > 0 AND emt.collections_target > 0
                    THEN (emt.collections_target::numeric / mr.days_in_month) * mr.overlap_days
                    ELSE 0 END
            ), 0) AS collections_target,
            COALESCE(SUM(
                CASE WHEN mr.overlap_days > 0 AND emt.new_customers_target > 0
                    THEN (emt.new_customers_target::numeric / mr.days_in_month) * mr.overlap_days
                    ELSE 0 END
            ), 0) AS new_customers_target
        FROM public.employee_monthly_targets emt
        CROSS JOIN month_ranges mr
        WHERE emt.target_month = EXTRACT(MONTH FROM mr.month_start)::int
          AND emt.target_year = EXTRACT(YEAR FROM mr.month_start)::int
        GROUP BY emt.employee_id
    ),

    -- Paginated employees with KPIs sorted
    paginated_employees AS (
        SELECT
            ve.id,
            ve.full_name,
            ve.code,
            ve.role_name,
            ea.total_days,
            ea.total_net_minutes,
            ea.avg_net_minutes,
            ea.total_orders,
            ea.total_sales_value,
            ea.total_collection_count,
            ea.total_collection_amount,
            ea.total_new_customers,
            ea.total_visits,
            ea.total_distance_meters,
            ea.total_tracking_points,
            ea.late_count,
            ea.ontime_count,
            ea.early_departure_count,
            CASE WHEN pt.sales_target > 0 THEN ROUND(pt.sales_target::numeric, 2) ELSE NULL END AS sales_target,
            CASE WHEN pt.visits_target > 0 THEN ROUND(pt.visits_target::numeric, 2) ELSE NULL END AS visits_target,
            CASE WHEN pt.orders_target > 0 THEN ROUND(pt.orders_target::numeric, 2) ELSE NULL END AS orders_target,
            CASE WHEN pt.collections_target > 0 THEN ROUND(pt.collections_target::numeric, 2) ELSE NULL END AS collections_target,
            CASE WHEN pt.new_customers_target > 0 THEN ROUND(pt.new_customers_target::numeric, 2) ELSE NULL END AS new_customers_target,
            CASE WHEN COALESCE(pt.sales_target, 0) > 0 THEN ROUND((ea.total_sales_value / pt.sales_target * 100)::numeric, 1) ELSE NULL END AS sales_achievement_pct,
            CASE WHEN COALESCE(pt.visits_target, 0) > 0 THEN ROUND((ea.total_visits::numeric / pt.visits_target * 100)::numeric, 1) ELSE NULL END AS visits_achievement_pct,
            CASE WHEN COALESCE(pt.orders_target, 0) > 0 THEN ROUND((ea.total_orders::numeric / pt.orders_target * 100)::numeric, 1) ELSE NULL END AS orders_achievement_pct,
            CASE WHEN COALESCE(pt.collections_target, 0) > 0 THEN ROUND((ea.total_collection_amount / pt.collections_target * 100)::numeric, 1) ELSE NULL END AS collections_achievement_pct,
            CASE WHEN COALESCE(pt.new_customers_target, 0) > 0 THEN ROUND((ea.total_new_customers::numeric / pt.new_customers_target * 100)::numeric, 1) ELSE NULL END AS new_customers_achievement_pct,
            ROW_NUMBER() OVER (
                ORDER BY
                    CASE WHEN p_sort_by = 'total_net_minutes' AND p_sort_order = 'desc' THEN ea.total_net_minutes END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_net_minutes' AND p_sort_order = 'asc' THEN ea.total_net_minutes END ASC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_sales_value' AND p_sort_order = 'desc' THEN ea.total_sales_value END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_sales_value' AND p_sort_order = 'asc' THEN ea.total_sales_value END ASC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_orders' AND p_sort_order = 'desc' THEN ea.total_orders END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_orders' AND p_sort_order = 'asc' THEN ea.total_orders END ASC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_visits' AND p_sort_order = 'desc' THEN ea.total_visits END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_visits' AND p_sort_order = 'asc' THEN ea.total_visits END ASC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_collection_amount' AND p_sort_order = 'desc' THEN ea.total_collection_amount END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_collection_amount' AND p_sort_order = 'asc' THEN ea.total_collection_amount END ASC NULLS LAST,
                    ea.total_net_minutes DESC NULLS LAST
            ) AS sort_rank
        FROM visible_employees ve
        JOIN emp_aggregates ea ON ea.employee_id = ve.id
        LEFT JOIN prorated_targets pt ON pt.employee_id = ve.id
    ),
    total_emps AS (
        SELECT COUNT(*)::int AS cnt FROM paginated_employees
    ),

    -- Sessions for paginated employees only
    paginated_employee_ids AS (
        SELECT pe.id, pe.full_name, pe.code, pe.role_name,
            pe.total_days, pe.total_net_minutes, pe.avg_net_minutes,
            pe.total_orders, pe.total_sales_value,
            pe.total_collection_count, pe.total_collection_amount,
            pe.total_new_customers, pe.total_visits,
            pe.total_distance_meters, pe.total_tracking_points,
            pe.late_count, pe.ontime_count, pe.early_departure_count,
            pe.sales_target, pe.visits_target, pe.orders_target,
            pe.collections_target, pe.new_customers_target,
            pe.sales_achievement_pct, pe.visits_achievement_pct,
            pe.orders_achievement_pct, pe.collections_achievement_pct,
            pe.new_customers_achievement_pct
        FROM paginated_employees pe
        ORDER BY pe.sort_rank
        LIMIT p_per_page OFFSET v_offset
    ),
    paginated_sessions AS (
        SELECT
            sk.employee_id,
            sk.date, sk.start_time, sk.end_time,
            GREATEST(COALESCE(sk.duration_minutes, 0) - COALESCE(sk.break_minutes, 0), 0)::int AS net_minutes,
            sk.break_minutes::int,
            sk.break_count,
            sk.visit_count,
            sk.order_count,
            sk.sales_value,
            sk.collection_count,
            sk.collection_amount,
            sk.new_customer_count,
            sk.attendance_status,
            sk.late_minutes,
            sk.early_departure_minutes,
            COALESCE(sk.total_distance_meters, 0)::int AS distance_meters,
            sk.tracking_points_count
        FROM session_kpis sk
        WHERE sk.employee_id = ANY(SELECT pei.id FROM paginated_employee_ids pei)
    ),

    -- Grand totals across ALL visible employees (not just paginated)
    grand_totals AS (
        SELECT
            COUNT(*) FILTER (WHERE status = 'completed')::int AS total_days,
            COALESCE(SUM(GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0))::int, 0) AS total_net_minutes,
            COALESCE(SUM(order_count)::int, 0) AS total_orders,
            COALESCE(SUM(sales_value)::numeric, 0) AS total_sales,
            COALESCE(SUM(collection_count)::int, 0) AS total_collections,
            COALESCE(SUM(collection_amount)::numeric, 0) AS total_collection_amount,
            COALESCE(SUM(new_customer_count)::int, 0) AS total_new_customers,
            COALESCE(SUM(visit_count)::int, 0) AS total_visits
        FROM session_kpis
    )

    SELECT jsonb_build_object(
        'employees', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                'employee_id', pei.id,
                'employee_name', pei.full_name,
                'employee_code', pei.code,
                'role_name', pei.role_name,
                'summary', jsonb_build_object(
                    'total_days', pei.total_days,
                    'total_net_minutes', pei.total_net_minutes,
                    'avg_net_minutes', pei.avg_net_minutes,
                    'total_orders', pei.total_orders,
                    'total_sales_value', pei.total_sales_value,
                    'total_collection_count', pei.total_collection_count,
                    'total_collection_amount', pei.total_collection_amount,
                    'total_new_customers', pei.total_new_customers,
                    'total_visits', pei.total_visits,
                    'total_distance_meters', pei.total_distance_meters,
                    'total_tracking_points', pei.total_tracking_points,
                    'late_count', pei.late_count,
                    'ontime_count', pei.ontime_count,
                    'early_departure_count', pei.early_departure_count,
                    'sales_target', pei.sales_target,
                    'visits_target', pei.visits_target,
                    'orders_target', pei.orders_target,
                    'collections_target', pei.collections_target,
                    'new_customers_target', pei.new_customers_target,
                    'sales_achievement_pct', pei.sales_achievement_pct,
                    'visits_achievement_pct', pei.visits_achievement_pct,
                    'orders_achievement_pct', pei.orders_achievement_pct,
                    'collections_achievement_pct', pei.collections_achievement_pct,
                    'new_customers_achievement_pct', pei.new_customers_achievement_pct
                ),
                'sessions', COALESCE(
                    (SELECT jsonb_agg(jsonb_build_object(
                        'date', ps.date,
                        'start_time', ps.start_time,
                        'end_time', ps.end_time,
                        'net_minutes', ps.net_minutes,
                        'break_minutes', ps.break_minutes,
                        'break_count', ps.break_count,
                        'visit_count', ps.visit_count,
                        'order_count', ps.order_count,
                        'sales_value', ps.sales_value,
                        'collection_count', ps.collection_count,
                        'collection_amount', ps.collection_amount,
                        'new_customer_count', ps.new_customer_count,
                        'attendance_status', ps.attendance_status,
                        'late_minutes', ps.late_minutes,
                        'early_departure_minutes', ps.early_departure_minutes,
                        'distance_meters', ps.distance_meters,
                        'tracking_points_count', ps.tracking_points_count
                    ) ORDER BY ps.date DESC)
                    FROM paginated_sessions ps
                    WHERE ps.employee_id = pei.id),
                    '[]'::jsonb
                )
            ) ORDER BY pei.total_net_minutes DESC)
            FROM paginated_employee_ids pei),
            '[]'::jsonb
        ),
        'totals', (SELECT jsonb_build_object(
            'total_employees', (SELECT cnt FROM total_emps),
            'total_days', gt.total_days,
            'total_net_minutes', gt.total_net_minutes,
            'total_orders', gt.total_orders,
            'total_sales', gt.total_sales,
            'total_collections', gt.total_collections,
            'total_collection_amount', gt.total_collection_amount,
            'total_new_customers', gt.total_new_customers,
            'total_visits', gt.total_visits
        ) FROM grand_totals gt),
        'pagination', jsonb_build_object(
            'page', p_page,
            'per_page', p_per_page,
            'total', (SELECT cnt FROM total_emps),
            'total_pages', GREATEST(1, CEIL((SELECT cnt::numeric FROM total_emps) / p_per_page)::int)
        )
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_completed_workdays_history IS 'الأداء التاريخي للموظفين — تاريخي، مبيعات، تحصيلات، أهداف، نسب إنجاز';

-- =============================================================
-- Grants
-- =============================================================
GRANT EXECUTE ON FUNCTION public.get_employee_day_timeline TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_day_map TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_workday_history TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_completed_workdays_history TO authenticated;
