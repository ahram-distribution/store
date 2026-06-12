-- Phase 6: Attendance V2 Complete — Create new RPCs + update existing for target image
-- 1. get_employee_detail (NEW) — single-employee KPI + header
-- 2. get_employee_day_timeline (REWRITE) — V2 governance + orders/collections/customers
-- 3. get_employee_day_map (REWRITE → get_employee_day_route) — route polyline + distance + stops
-- 4. get_live_workday_overview (UPDATE) — add sales_value, role, region, avatar_url
-- 5. get_team_map (UPDATE) — add role, sales_value, collection_amount
-- 6. get_workday_report (UPDATE) — add sales_value to summary + employees
-- 7. get_alerts (UPDATE) — V2 governance + zero_orders + fix column refs

-- ================================================================
-- 1. get_employee_detail — NEW
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_employee_detail(
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
    v_result jsonb;
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

    WITH emp_info AS (
        SELECT e.id, e.full_name, e.code,
            COALESCE(r.name, '') AS role_name,
            COALESCE(m.full_name, '') AS manager_name,
            e.region, e.avatar_url
        FROM public.employees e
        LEFT JOIN public.employee_roles er ON er.employee_id = e.id
        LEFT JOIN public.roles r ON r.id = er.role_id
        LEFT JOIN public.employees m ON m.id = e.manager_id
        WHERE e.id = p_employee_id
    ),
    session_info AS (
        SELECT wds.*
        FROM public.workday_sessions wds
        WHERE wds.employee_id = p_employee_id AND wds.date = p_date
        ORDER BY wds.start_time DESC LIMIT 1
    ),
    last_point AS (
        SELECT tp.latitude, tp.longitude, tp.recorded_at
        FROM public.tracking_points tp
        WHERE tp.employee_id = p_employee_id
        ORDER BY tp.recorded_at DESC LIMIT 1
    ),
    today_orders AS (
        SELECT COUNT(*)::int AS total_orders,
            COALESCE(SUM(o.total_amount), 0) AS total_sales
        FROM public.orders o
        WHERE o.owner_id = p_employee_id AND o.created_at::date = p_date
    ),
    today_collections AS (
        SELECT COUNT(*)::int AS total_collections,
            COALESCE(SUM(c.amount), 0) AS total_collections_amount
        FROM public.collections c
        WHERE c.owner_id = p_employee_id AND c.created_at::date = p_date
    ),
    today_customers AS (
        SELECT COUNT(*)::int AS new_customers
        FROM public.customers c
        WHERE c.owner_id = p_employee_id AND c.created_at::date = p_date
    ),
    today_visits AS (
        SELECT COUNT(*)::int AS total_visits,
            COUNT(*) FILTER (WHERE v.check_out_at IS NOT NULL) AS completed_visits
        FROM public.visits v
        WHERE v.employee_id = p_employee_id AND v.check_in_at::date = p_date
    ),
    today_break_minutes AS (
        SELECT COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0) / 60 AS break_minutes
        FROM public.workday_breaks wb
        WHERE wb.employee_id = p_employee_id AND wb.break_start::date = p_date
    )
    SELECT jsonb_build_object(
        'employee', jsonb_build_object(
            'id', ei.id, 'full_name', ei.full_name, 'code', ei.code,
            'role_name', ei.role_name, 'region', ei.region, 'avatar_url', ei.avatar_url,
            'manager_name', ei.manager_name
        ),
        'session', CASE WHEN si.id IS NOT NULL THEN jsonb_build_object(
            'id', si.id, 'status', si.status, 'start_time', si.start_time, 'end_time', si.end_time,
            'attendance_status', si.attendance_status, 'late_minutes', si.late_minutes,
            'early_departure_minutes', si.early_departure_minutes,
            'duration_minutes', EXTRACT(EPOCH FROM (COALESCE(si.end_time, now()) - si.start_time)) / 60,
            'net_minutes', GREATEST(EXTRACT(EPOCH FROM (COALESCE(si.end_time, now()) - si.start_time)) / 60 - COALESCE(tbm.break_minutes, 0), 0),
            'break_minutes', COALESCE(tbm.break_minutes, 0)
        ) ELSE NULL END,
        'last_location', CASE WHEN lp.recorded_at IS NOT NULL THEN jsonb_build_object(
            'latitude', lp.latitude, 'longitude', lp.longitude, 'recorded_at', lp.recorded_at
        ) ELSE NULL END,
        'summary', jsonb_build_object(
            'total_orders', COALESCE(to2.total_orders, 0),
            'total_sales', COALESCE(to2.total_sales, 0),
            'total_collections', COALESCE(tc2.total_collections, 0),
            'total_collections_amount', COALESCE(tc2.total_collections_amount, 0),
            'new_customers', COALESCE(tc3.new_customers, 0),
            'total_visits', COALESCE(tv.total_visits, 0),
            'completed_visits', COALESCE(tv.completed_visits, 0)
        )
    ) INTO v_result
    FROM emp_info ei
    LEFT JOIN session_info si ON true
    LEFT JOIN last_point lp ON true
    LEFT JOIN today_orders to2 ON true
    LEFT JOIN today_collections tc2 ON true
    LEFT JOIN today_customers tc3 ON true
    LEFT JOIN today_visits tv ON true
    LEFT JOIN today_break_minutes tbm ON true;

    RETURN v_result;
END;
$function$;

-- ================================================================
-- 2. get_employee_day_timeline — REWRITE with V2 governance + events
-- ================================================================

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
    ORDER BY wds.start_time DESC LIMIT 1;

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
        -- Session start event
        SELECT ws.start_time AS event_time, 'workday_start' AS event_type,
            'بدء يوم العمل' AS title, '' AS description,
            ws.start_latitude::text AS lat, ws.start_longitude::text AS lng,
            jsonb_build_object('session_id', ws.id) AS metadata
        FROM public.workday_sessions ws
        WHERE ws.id = v_session_record.id
        UNION ALL
        -- Session end event
        SELECT ws.end_time, 'workday_end', 'إنهاء يوم العمل', '',
            ws.end_latitude::text, ws.end_longitude::text,
            jsonb_build_object('session_id', ws.id)
        FROM public.workday_sessions ws
        WHERE ws.id = v_session_record.id AND ws.end_time IS NOT NULL
        UNION ALL
        -- Break start events
        SELECT wb.break_start, 'break_start', 'بداية استراحة',
            COALESCE(wb.break_reason, ''),
            wb.latitude::text, wb.longitude::text,
            jsonb_build_object('break_id', wb.id, 'reason', wb.break_reason)
        FROM public.workday_breaks wb
        WHERE wb.session_id = v_session_record.id
        UNION ALL
        -- Break end events
        SELECT wb.break_end, 'break_end', 'نهاية استراحة',
            COALESCE(wb.break_reason, ''),
            wb.latitude::text, wb.longitude::text,
            jsonb_build_object('break_id', wb.id, 'duration_seconds', wb.duration_seconds)
        FROM public.workday_breaks wb
        WHERE wb.session_id = v_session_record.id AND wb.break_end IS NOT NULL
        UNION ALL
        -- Visit events (from visits table)
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
        -- Order events
        SELECT o.created_at, 'order_created', 'طلب جديد',
            'طلب رقم ' || o.order_number || ' — ' || o.total_amount || ' ج.م',
            o.execution_latitude::text, o.execution_longitude::text,
            jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'total_amount', o.total_amount, 'status', o.status)
        FROM public.orders o
        WHERE o.owner_id = p_employee_id AND o.created_at::date = p_date
        UNION ALL
        -- Collection events
        SELECT c.created_at, 'collection_taken', 'تحصيل',
            c.amount || ' ج.م — ' || COALESCE(c.method, ''),
            NULL, NULL,
            jsonb_build_object('collection_id', c.id, 'amount', c.amount, 'method', c.method, 'status', c.status)
        FROM public.collections c
        WHERE c.owner_id = p_employee_id AND c.created_at::date = p_date
        UNION ALL
        -- New customer events
        SELECT c2.created_at, 'new_customer', 'عميل جديد',
            COALESCE(c2.company_name, ''),
            NULL, NULL,
            jsonb_build_object('customer_id', c2.id, 'customer_name', c2.company_name)
        FROM public.customers c2
        WHERE c2.owner_id = p_employee_id AND c2.created_at::date = p_date
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

-- ================================================================
-- 3. get_employee_day_map — REWRITE with route polyline + distance + stops
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_employee_day_map(
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
    v_session_record record;
    v_route jsonb;
    v_stops jsonb;
    v_visit_locations jsonb;
    v_total_distance numeric := 0;
    v_prev_lat numeric;
    v_prev_lng numeric;
    v_curr_lat numeric;
    v_curr_lng numeric;
    v_i int := 0;
    v_stop_start timestamptz;
    v_stop_lat numeric;
    v_stop_lng numeric;
    v_route_arr jsonb[];
    v_pt record;
    v_prev_time timestamptz;
    v_gap_minutes numeric;
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

    -- Build route array with distance calculation (Haversine)
    FOR v_pt IN
        SELECT tp.latitude, tp.longitude, tp.recorded_at, tp.point_type
        FROM public.tracking_points tp
        WHERE tp.employee_id = p_employee_id AND tp.recorded_at::date = p_date
        ORDER BY tp.recorded_at
    LOOP
        v_i := v_i + 1;
        v_curr_lat := v_pt.latitude;
        v_curr_lng := v_pt.longitude;

        IF v_i > 1 THEN
            -- Haversine distance in meters
            v_total_distance := v_total_distance + (
                6371000 * 2 * asin(sqrt(
                    power(sin(radians(v_curr_lat - v_prev_lat) / 2), 2) +
                    cos(radians(v_prev_lat)) * cos(radians(v_curr_lat)) *
                    power(sin(radians(v_curr_lng - v_prev_lng) / 2), 2)
                ))
            );
        END IF;

        v_route_arr := array_append(v_route_arr, jsonb_build_object(
            'latitude', v_pt.latitude,
            'longitude', v_pt.longitude,
            'time', v_pt.recorded_at,
            'type', v_pt.point_type
        ));

        v_prev_lat := v_curr_lat;
        v_prev_lng := v_curr_lng;

        -- Detect long stops (gap > 5 min between consecutive points)
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
    END LOOP;

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

    v_route := CASE WHEN array_length(v_route_arr, 1) > 0
        THEN jsonb_build_array(v_route_arr)
        ELSE '[]'::jsonb
    END;

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
        'visit_locations', COALESCE(v_visit_locations, '[]'::jsonb),
        'long_stops', COALESCE(v_stops, '[]'::jsonb),
        'long_stops_count', COALESCE(jsonb_array_length(v_stops), 0),
        'long_stops_total_minutes', COALESCE((SELECT SUM((s->>'duration_minutes')::int) FROM jsonb_array_elements(v_stops) s), 0)
    );
END;
$function$;

-- ================================================================
-- 4. Update get_live_workday_overview — add sales_value, role
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_live_workday_overview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_interval_seconds int;
    v_subtree_ids uuid[];
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'attendance.live_monitor') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;
    SELECT location_interval_seconds INTO v_interval_seconds FROM public.workday_settings LIMIT 1;
    v_interval_seconds := COALESCE(v_interval_seconds, 300);

    WITH filtered_employees AS (
        SELECT e.id FROM public.employees e WHERE e.is_active = true
        AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
    ),
    active_sessions AS (
        SELECT wds.id, wds.employee_id, wds.start_time, wds.status,
            e.full_name AS employee_name
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
        AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
    ),
    last_points AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.latitude, tp.longitude, tp.recorded_at
        FROM public.tracking_points tp WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id,
            EXTRACT(EPOCH FROM (now() - wb.break_start)) / 60 AS break_minutes
        FROM public.workday_breaks wb WHERE wb.break_end IS NULL
    ),
    today_orders AS (
        SELECT o.owner_id AS employee_id, COUNT(*)::int AS order_count,
            COALESCE(SUM(o.total_amount), 0) AS sales_value
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE
        GROUP BY o.owner_id
    ),
    today_collections AS (
        SELECT c.owner_id AS employee_id, COUNT(*)::int AS collection_count,
            COALESCE(SUM(c.amount), 0) AS collection_amount
        FROM public.collections c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY c.owner_id
    ),
    today_customers AS (
        SELECT c.owner_id AS employee_id, COUNT(*)::int AS new_customer_count
        FROM public.customers c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY c.owner_id
    ),
    total_breaks AS (
        SELECT wb.employee_id,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(wb.break_end, now()) - wb.break_start))), 0) / 60 AS total_break_minutes
        FROM public.workday_breaks wb
        JOIN public.workday_sessions ws ON ws.id = wb.session_id AND ws.date = CURRENT_DATE
        GROUP BY wb.employee_id
    ),
    employee_summary AS (
        SELECT
            as2.id AS session_id, as2.employee_id, as2.employee_name,
            as2.start_time,
            EXTRACT(EPOCH FROM (now() - as2.start_time)) / 60 AS duration_minutes,
            COALESCE(tb.total_break_minutes, 0) AS break_minutes,
            CASE WHEN ab.employee_id IS NOT NULL THEN 'on_break'
                 WHEN vl.employee_id IS NOT NULL THEN 'on_visit'
                 ELSE 'working'
            END AS work_status,
            lp.latitude, lp.longitude, lp.recorded_at AS last_seen_at,
            CASE WHEN lp.recorded_at IS NULL THEN 'no_data'
                 WHEN lp.recorded_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                 WHEN lp.recorded_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                 ELSE 'lost'
            END AS connection_status,
            as2.status AS session_status,
            COALESCE(too.order_count, 0) AS order_count,
            COALESCE(too.sales_value, 0) AS sales_value,
            COALESCE(tco.collection_count, 0) AS collection_count,
            COALESCE(tco.collection_amount, 0) AS collection_amount,
            COALESCE(tc.new_customer_count, 0) AS new_customer_count,
            COALESCE(r.name, '') AS role_name
        FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN LATERAL (
            SELECT vl2.session_id, vl2.employee_id FROM public.visit_links vl2
            WHERE vl2.session_id = as2.id AND vl2.checkout_at IS NULL LIMIT 1
        ) vl ON true
        LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
        LEFT JOIN today_orders too ON too.employee_id = as2.employee_id
        LEFT JOIN today_collections tco ON tco.employee_id = as2.employee_id
        LEFT JOIN today_customers tc ON tc.employee_id = as2.employee_id
        LEFT JOIN total_breaks tb ON tb.employee_id = as2.employee_id
        LEFT JOIN public.employee_roles er ON er.employee_id = as2.employee_id
        LEFT JOIN public.roles r ON r.id = er.role_id
    ),
    no_start AS (
        SELECT e.id AS employee_id, e.full_name AS employee_name
        FROM public.employees e JOIN filtered_employees fe ON fe.id = e.id
        WHERE e.id NOT IN (SELECT employee_id FROM active_sessions)
        AND e.id NOT IN (SELECT employee_id FROM public.workday_sessions WHERE date = CURRENT_DATE AND status = 'completed')
        AND e.is_active = true
    ),
    ended AS (
        SELECT wds.employee_id, e.full_name AS employee_name, wds.end_time,
            EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) / 60 AS duration_minutes,
            wds.visit_count
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'completed'
        AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
    )
    SELECT jsonb_build_object(
        'active_count', (SELECT COUNT(*) FROM employee_summary),
        'on_visit_count', (SELECT COUNT(*) FROM employee_summary WHERE work_status = 'on_visit'),
        'on_break_count', (SELECT COUNT(*) FROM employee_summary WHERE work_status = 'on_break'),
        'connection_loss_count', (SELECT COUNT(*) FROM employee_summary WHERE connection_status = 'lost'),
        'no_start_count', (SELECT COUNT(*) FROM no_start),
        'ended_count', (SELECT COUNT(*) FROM ended),
        'zero_visits_count', (SELECT COUNT(*) FROM employee_summary WHERE visit_count = 0),
        'zero_orders_count', (SELECT COUNT(*) FROM employee_summary WHERE order_count = 0),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', es.employee_id, 'name', es.employee_name,
            'role_name', es.role_name,
            'status', es.work_status, 'session_status', es.session_status,
            'started_at', es.start_time,
            'duration_minutes', es.duration_minutes::int,
            'net_minutes', GREATEST(es.duration_minutes::int - es.break_minutes::int, 0),
            'break_minutes', es.break_minutes::int,
            'order_count', es.order_count, 'sales_value', es.sales_value,
            'collection_count', es.collection_count, 'collection_amount', es.collection_amount,
            'new_customer_count', es.new_customer_count,
            'latitude', es.latitude, 'longitude', es.longitude,
            'last_seen_at', es.last_seen_at, 'connection_status', es.connection_status,
            'last_seen_label',
                CASE es.connection_status
                    WHEN 'connected' THEN 'متصل الآن'
                    WHEN 'delayed' THEN 'آخر ظهور منذ ' || EXTRACT(EPOCH FROM (now() - es.last_seen_at))::int / 60 || ' دقيقة'
                    WHEN 'lost' THEN 'انقطاع متابعة'
                    ELSE 'لا توجد بيانات حديثة'
                END
        ) ORDER BY
            CASE es.work_status WHEN 'working' THEN 1 WHEN 'on_visit' THEN 2 WHEN 'on_break' THEN 3 ELSE 4 END
        ) FROM employee_summary es), '[]'::jsonb),
        'no_start_employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', ns.employee_id, 'name', ns.employee_name
        )) FROM no_start ns), '[]'::jsonb),
        'ended_employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', ed.employee_id, 'name', ed.employee_name,
            'ended_at', ed.end_time, 'duration_minutes', ed.duration_minutes::int,
            'visit_count', ed.visit_count
        ) ORDER BY ed.end_time DESC) FROM ended ed), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

-- ================================================================
-- 5. Update get_team_map — add role, sales_value, collection_amount
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_team_map(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_interval_seconds int;
    v_subtree_ids uuid[];
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'attendance.view_team_map') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;
    SELECT location_interval_seconds INTO v_interval_seconds FROM public.workday_settings LIMIT 1;
    v_interval_seconds := COALESCE(v_interval_seconds, 300);

    WITH active_sessions AS (
        SELECT wds.id, wds.employee_id, wds.start_time, wds.status,
            e.full_name AS employee_name
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
        AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
    ),
    last_points AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.latitude, tp.longitude, tp.recorded_at
        FROM public.tracking_points tp WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id FROM public.workday_breaks wb WHERE wb.break_end IS NULL
    ),
    today_orders AS (
        SELECT o.owner_id AS employee_id, COUNT(*)::int AS order_count,
            COALESCE(SUM(o.total_amount), 0) AS sales_value
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE GROUP BY o.owner_id
    ),
    today_collections AS (
        SELECT c.owner_id AS employee_id, COUNT(*)::int AS collection_count,
            COALESCE(SUM(c.amount), 0) AS collection_amount
        FROM public.collections c WHERE c.created_at::date = CURRENT_DATE GROUP BY c.owner_id
    ),
    today_customers AS (
        SELECT c.owner_id AS employee_id, COUNT(*)::int AS new_customer_count
        FROM public.customers c WHERE c.created_at::date = CURRENT_DATE GROUP BY c.owner_id
    ),
    today_visits AS (
        SELECT v.employee_id, COUNT(*)::int AS visit_count
        FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE GROUP BY v.employee_id
    )
    SELECT jsonb_build_object(
        'counters', jsonb_build_object(
            'active', (SELECT COUNT(*) FROM active_sessions),
            'on_break', (SELECT COUNT(DISTINCT ab.employee_id) FROM active_sessions as2 JOIN active_breaks ab ON ab.session_id = as2.id),
            'on_visit', (SELECT COUNT(*) FROM active_sessions as2 WHERE EXISTS (SELECT 1 FROM public.visit_links vl2 WHERE vl2.session_id = as2.id AND vl2.checkout_at IS NULL)),
            'not_started', (SELECT COUNT(*) FROM filtered_employees fe WHERE fe.id NOT IN (SELECT employee_id FROM active_sessions) AND fe.id NOT IN (SELECT employee_id FROM public.workday_sessions WHERE date = CURRENT_DATE AND status = 'completed')),
            'connection_lost', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id WHERE lp.recorded_at IS NULL OR lp.recorded_at < now() - ((v_interval_seconds * 5) || ' seconds')::interval),
            'zero_visits_today', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN today_visits tv2 ON tv2.employee_id = as2.employee_id WHERE COALESCE(tv2.visit_count, 0) = 0),
            'zero_orders_today', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN today_orders too2 ON too2.employee_id = as2.employee_id WHERE COALESCE(too2.order_count, 0) = 0),
            'inactive_over_2h', (SELECT COUNT(*) FROM active_sessions as2 WHERE EXTRACT(EPOCH FROM (now() - as2.start_time)) / 3600 > 2 AND NOT EXISTS (SELECT 1 FROM last_points lp2 WHERE lp2.employee_id = as2.employee_id AND lp2.recorded_at > now() - interval '30 minutes'))
        ),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', as2.employee_id, 'name', as2.employee_name,
            'role_name', COALESCE(r.name, ''),
            'status', CASE WHEN ab.employee_id IS NOT NULL THEN 'on_break'
                           WHEN vl.employee_id IS NOT NULL THEN 'on_visit'
                           ELSE 'working' END,
            'connection_status', CASE WHEN lp.recorded_at IS NULL THEN 'no_data'
                 WHEN lp.recorded_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                 WHEN lp.recorded_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                 ELSE 'lost' END,
            'latitude', lp.latitude, 'longitude', lp.longitude, 'last_seen_at', lp.recorded_at,
            'duration_minutes', EXTRACT(EPOCH FROM (now() - as2.start_time)) / 60,
            'order_count', COALESCE(too.order_count, 0), 'sales_value', COALESCE(too.sales_value, 0),
            'collection_count', COALESCE(tco.collection_count, 0), 'collection_amount', COALESCE(tco.collection_amount, 0),
            'new_customer_count', COALESCE(tc.new_customer_count, 0),
            'visit_count', COALESCE(tv.visit_count, 0)
        )) FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN LATERAL (SELECT vl2.session_id, vl2.employee_id FROM public.visit_links vl2 WHERE vl2.session_id = as2.id AND vl2.checkout_at IS NULL LIMIT 1) vl ON true
        LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
        LEFT JOIN today_orders too ON too.employee_id = as2.employee_id
        LEFT JOIN today_collections tco ON tco.employee_id = as2.employee_id
        LEFT JOIN today_customers tc ON tc.employee_id = as2.employee_id
        LEFT JOIN today_visits tv ON tv.employee_id = as2.employee_id
        LEFT JOIN public.employee_roles er ON er.employee_id = as2.employee_id
        LEFT JOIN public.roles r ON r.id = er.role_id), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

-- ================================================================
-- 6. Update get_workday_report — add sales_value
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_workday_report(
    p_token uuid, p_from date, p_to date, p_employee_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_subtree_ids uuid[];
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'attendance.view_reports') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;

    WITH filtered_sessions AS (
        SELECT wds.*, e.full_name AS employee_name, e.code AS employee_code
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date >= p_from AND wds.date <= p_to
        AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
        AND (p_employee_ids IS NULL OR wds.employee_id = ANY(p_employee_ids))
    ),
    emp_stats AS (
        SELECT fs.employee_id, fs.employee_name, fs.employee_code,
            COUNT(*)::int AS sessions,
            COALESCE(SUM(EXTRACT(EPOCH FROM (fs.end_time - fs.start_time)) / 3600), 0) AS total_hours,
            COALESCE(SUM(fs.visit_count), 0) AS total_visits,
            COALESCE(SUM(CASE WHEN fs.attendance_status = 'late' THEN 1 ELSE 0 END), 0) AS late_days,
            COALESCE(SUM(CASE WHEN fs.attendance_status = 'early_departure' THEN 1 ELSE 0 END), 0) AS early_departure_days,
            COALESCE(SUM(CASE WHEN fs.attendance_status = 'ontime' THEN 1 ELSE 0 END), 0) AS ontime_days
        FROM filtered_sessions fs WHERE fs.status = 'completed'
        GROUP BY fs.employee_id, fs.employee_name, fs.employee_code
    ),
    emp_orders AS (
        SELECT o.owner_id AS employee_id, COUNT(*)::int AS total_orders,
            COALESCE(SUM(o.total_amount), 0) AS total_sales_value
        FROM public.orders o
        WHERE o.created_at::date >= p_from AND o.created_at::date <= p_to
        GROUP BY o.owner_id
    ),
    emp_collections AS (
        SELECT c.owner_id AS employee_id, COUNT(*)::int AS total_collections,
            COALESCE(SUM(c.amount), 0) AS total_collection_amount
        FROM public.collections c
        WHERE c.created_at::date >= p_from AND c.created_at::date <= p_to
        GROUP BY c.owner_id
    ),
    emp_customers AS (
        SELECT c.owner_id AS employee_id, COUNT(*)::int AS total_new_customers
        FROM public.customers c WHERE c.created_at::date >= p_from AND c.created_at::date <= p_to
        GROUP BY c.owner_id
    )
    SELECT jsonb_build_object(
        'summary', jsonb_build_object(
            'total_sessions', (SELECT COUNT(*) FROM filtered_sessions WHERE status = 'completed'),
            'total_net_hours', (SELECT COALESCE(SUM(total_hours), 0) FROM emp_stats),
            'total_visits', (SELECT COALESCE(SUM(total_visits), 0) FROM emp_stats),
            'total_orders', (SELECT COALESCE(SUM(total_orders), 0) FROM emp_orders),
            'total_sales_value', (SELECT COALESCE(SUM(total_sales_value), 0) FROM emp_orders),
            'total_collections', (SELECT COALESCE(SUM(total_collections), 0) FROM emp_collections),
            'total_collections_amount', (SELECT COALESCE(SUM(total_collection_amount), 0) FROM emp_collections),
            'total_new_customers', (SELECT COALESCE(SUM(total_new_customers), 0) FROM emp_customers),
            'late_days', (SELECT COALESCE(SUM(late_days), 0) FROM emp_stats),
            'early_departure_days', (SELECT COALESCE(SUM(early_departure_days), 0) FROM emp_stats),
            'ontime_days', (SELECT COALESCE(SUM(ontime_days), 0) FROM emp_stats)
        ),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', es.employee_id, 'name', es.employee_name, 'code', es.employee_code,
            'sessions', es.sessions, 'net_hours', es.total_hours,
            'total_visits', es.total_visits,
            'total_orders', COALESCE(eo.total_orders, 0),
            'total_sales_value', COALESCE(eo.total_sales_value, 0),
            'total_collections', COALESCE(ec.total_collections, 0),
            'total_collections_amount', COALESCE(ec.total_collection_amount, 0),
            'new_customers', COALESCE(enc.total_new_customers, 0),
            'late_days', es.late_days, 'early_departure_days', es.early_departure_days, 'ontime_days', es.ontime_days
        )) FROM emp_stats es
        LEFT JOIN emp_orders eo ON eo.employee_id = es.employee_id
        LEFT JOIN emp_collections ec ON ec.employee_id = es.employee_id
        LEFT JOIN emp_customers enc ON enc.employee_id = es.employee_id), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

-- ================================================================
-- 7. Update get_alerts — V2 governance + zero_orders + fix column refs
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_alerts(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_subtree_ids uuid[];
    v_settings record;
    v_interval_seconds int;
    v_start_time time;
    v_end_time time;
    v_active_alerts jsonb;
    v_resolved_alerts jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'attendance.view_alerts') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;

    SELECT official_start_time, official_end_time, location_interval_seconds
    INTO v_start_time, v_end_time, v_interval_seconds
    FROM public.workday_settings LIMIT 1;
    v_interval_seconds := COALESCE(v_interval_seconds, 300);

    WITH active_sessions AS (
        SELECT wds.id, wds.employee_id, wds.start_time,
            e.full_name AS employee_name
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
        AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
    ),
    all_employees AS (
        SELECT e.id, e.full_name FROM public.employees e
        WHERE e.is_active = true
        AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
    ),
    not_started AS (
        SELECT 'not_started' AS alert_type, ae.id AS employee_id, ae.full_name AS employee_name,
            'لم يبدأ يوم العمل' AS title,
            'الساعة الآن ' || to_char(now()::time, 'HH:MI') || ' — وقت البدء الرسمي ' || to_char(v_start_time, 'HH:MI') AS description,
            now() AS detected_at
        FROM all_employees ae
        WHERE NOT EXISTS (SELECT 1 FROM public.workday_sessions wds WHERE wds.employee_id = ae.id AND wds.date = CURRENT_DATE)
        AND CURRENT_TIME > v_start_time + interval '30 minutes'
    ),
    open_yesterday AS (
        SELECT 'open_yesterday' AS alert_type, wds.employee_id, e.full_name AS employee_name,
            'يوم عمل مفتوح من اليوم السابق' AS title,
            'بدأ يوم ' || wds.date || ' الساعة ' || to_char(wds.start_time, 'HH:MI') AS description,
            now() AS detected_at
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date < CURRENT_DATE AND wds.status = 'active'
    ),
    long_break AS (
        SELECT 'long_break' AS alert_type, wb.employee_id, e.full_name AS employee_name,
            'استراحة طويلة' AS title,
            'في استراحة منذ ' || round(EXTRACT(EPOCH FROM (now() - wb.break_start)) / 60) || ' دقيقة' AS description,
            wb.break_start AS detected_at
        FROM public.workday_breaks wb
        JOIN public.employees e ON e.id = wb.employee_id
        WHERE wb.break_end IS NULL AND EXTRACT(EPOCH FROM (now() - wb.break_start)) > 3600
    ),
    no_updates AS (
        SELECT 'no_updates' AS alert_type, as2.employee_id, as2.employee_name,
            'انقطاع متابعة' AS title,
            'آخر تحديث منذ أكثر من ' || (v_interval_seconds * 5 / 60) || ' دقيقة' AS description,
            COALESCE(tp.recorded_at, now()) AS detected_at
        FROM active_sessions as2
        LEFT JOIN LATERAL (
            SELECT recorded_at FROM public.tracking_points
            WHERE employee_id = as2.employee_id AND recorded_at >= CURRENT_DATE
            ORDER BY recorded_at DESC LIMIT 1
        ) tp ON true
        WHERE tp.recorded_at IS NULL OR tp.recorded_at < now() - ((v_interval_seconds * 5) || ' seconds')::interval
    ),
    zero_visits AS (
        SELECT 'zero_visits' AS alert_type, as2.employee_id, as2.employee_name,
            'لا توجد زيارات اليوم' AS title,
            'بدأ اليوم ' || to_char(as2.start_time, 'HH:MI') || ' — 0 زيارات حتى الآن' AS description,
            now() AS detected_at
        FROM active_sessions as2
        WHERE NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.employee_id = as2.employee_id AND v.check_in_at::date = CURRENT_DATE)
    ),
    zero_orders AS (
        SELECT 'zero_orders' AS alert_type, as2.employee_id, as2.employee_name,
            'لا توجد طلبات اليوم' AS title,
            'بدأ اليوم ' || to_char(as2.start_time, 'HH:MI') || ' — 0 طلبات بعد 4 ساعات من العمل' AS description,
            now() AS detected_at
        FROM active_sessions as2
        WHERE as2.start_time < now() - interval '4 hours'
        AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.owner_id = as2.employee_id AND o.created_at::date = CURRENT_DATE)
    )
    SELECT jsonb_build_object(
        'active_alerts', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.detected_at DESC) FROM (
            SELECT * FROM not_started UNION ALL
            SELECT * FROM open_yesterday UNION ALL
            SELECT * FROM long_break UNION ALL
            SELECT * FROM no_updates UNION ALL
            SELECT * FROM zero_visits UNION ALL
            SELECT * FROM zero_orders
        ) t), '[]'::jsonb),
        'resolved_alerts', '[]'::jsonb
    ) INTO v_active_alerts;

    RETURN jsonb_build_object('active_alerts', COALESCE(v_active_alerts->'active_alerts', '[]'::jsonb), 'resolved_alerts', '[]'::jsonb);
END;
$function$;

-- Grant execution on all new/updated RPCs
GRANT EXECUTE ON FUNCTION public.get_employee_detail TO anon;
GRANT EXECUTE ON FUNCTION public.get_employee_day_timeline TO anon;
GRANT EXECUTE ON FUNCTION public.get_employee_day_map TO anon;
GRANT EXECUTE ON FUNCTION public.get_live_workday_overview TO anon;
GRANT EXECUTE ON FUNCTION public.get_team_map TO anon;
GRANT EXECUTE ON FUNCTION public.get_workday_report TO anon;
GRANT EXECUTE ON FUNCTION public.get_alerts TO anon;
