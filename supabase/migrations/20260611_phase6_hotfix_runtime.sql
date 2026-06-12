-- Phase 6 Hotfix — Fix 4 RPCs for end-to-end attendance runtime
-- Errors fixed:
--   get_workday_settings:  COALESCE(record, jsonb) type mismatch → record→jsonb
--   get_live_workday_overview: visit_links.employee_id DNE → visits table
--   get_team_map: filtered_employees CTE missing + visit_links refs
--   get_my_workday_status: visit_count reads from visit_links (empty) → visits

-- ================================================================
-- 1. get_workday_settings — v_settings record → jsonb
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_workday_settings(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_settings jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'attendance.configure') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT row_to_json(s)::jsonb INTO v_settings FROM (
        SELECT * FROM public.workday_settings LIMIT 1
    ) s;

    RETURN COALESCE(v_settings, '{}'::jsonb);
END;
$function$;

-- ================================================================
-- 2. get_live_workday_overview — visit_links → visits, +visit_count
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
    today_visits AS (
        SELECT v.employee_id, COUNT(*)::int AS visit_count
        FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE GROUP BY v.employee_id
    ),
    total_breaks AS (
        SELECT wb.employee_id,
            COUNT(*)::int AS break_count,
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
            COALESCE(tb.break_count, 0) AS break_count,
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
            COALESCE(tv.visit_count, 0) AS visit_count,
            COALESCE(role_info.name, '') AS role_name
        FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN LATERAL (
            SELECT v2.id, v2.employee_id FROM public.visits v2
            WHERE v2.employee_id = as2.employee_id
              AND v2.check_in_at::date = CURRENT_DATE
              AND v2.check_out_at IS NULL LIMIT 1
        ) vl ON true
        LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
        LEFT JOIN today_orders too ON too.employee_id = as2.employee_id
        LEFT JOIN today_collections tco ON tco.employee_id = as2.employee_id
        LEFT JOIN today_customers tc ON tc.employee_id = as2.employee_id
        LEFT JOIN today_visits tv ON tv.employee_id = as2.employee_id
        LEFT JOIN total_breaks tb ON tb.employee_id = as2.employee_id
        LEFT JOIN LATERAL (
            SELECT r.name FROM public.employee_roles er
            JOIN public.roles r ON r.id = er.role_id
            WHERE er.employee_id = as2.employee_id LIMIT 1
        ) role_info ON true
    ),
    no_start AS (
        SELECT e.id AS employee_id, e.full_name AS employee_name
        FROM public.employees e JOIN filtered_employees fe ON fe.id = e.id
        WHERE e.id NOT IN (SELECT employee_id FROM active_sessions)
        AND e.id NOT IN (SELECT employee_id FROM public.workday_sessions WHERE date = CURRENT_DATE AND status = 'completed')
        AND e.is_active = true
    ),
    ended AS (
        SELECT DISTINCT ON (wds.employee_id)
            wds.employee_id, e.full_name AS employee_name, wds.end_time,
            EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) / 60 AS duration_minutes,
            wds.visit_count
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'completed'
        AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
        ORDER BY wds.employee_id, wds.end_time DESC
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
            'break_count', es.break_count,
            'break_minutes', es.break_minutes::int,
            'order_count', es.order_count, 'sales_value', es.sales_value,
            'collection_count', es.collection_count, 'collection_amount', es.collection_amount,
            'new_customer_count', es.new_customer_count,
            'visit_count', es.visit_count,
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
-- 3. get_team_map — add filtered_employees CTE, fix visit_links refs
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
            'on_visit', (SELECT COUNT(*) FROM active_sessions as2 WHERE EXISTS (SELECT 1 FROM public.visits v2 WHERE v2.employee_id = as2.employee_id AND v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL)),
            'not_started', (SELECT COUNT(*) FROM filtered_employees fe WHERE fe.id NOT IN (SELECT employee_id FROM active_sessions) AND fe.id NOT IN (SELECT employee_id FROM public.workday_sessions WHERE date = CURRENT_DATE AND status = 'completed')),
            'connection_lost', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id WHERE lp.recorded_at IS NULL OR lp.recorded_at < now() - ((v_interval_seconds * 5) || ' seconds')::interval),
            'zero_visits_today', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN today_visits tv2 ON tv2.employee_id = as2.employee_id WHERE COALESCE(tv2.visit_count, 0) = 0),
            'zero_orders_today', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN today_orders too2 ON too2.employee_id = as2.employee_id WHERE COALESCE(too2.order_count, 0) = 0),
            'inactive_over_2h', (SELECT COUNT(*) FROM active_sessions as2 WHERE EXTRACT(EPOCH FROM (now() - as2.start_time)) / 3600 > 2 AND NOT EXISTS (SELECT 1 FROM last_points lp2 WHERE lp2.employee_id = as2.employee_id AND lp2.recorded_at > now() - interval '30 minutes'))
        ),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', as2.employee_id, 'name', as2.employee_name,
            'role_name', COALESCE(role_info.name, ''),
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
        LEFT JOIN LATERAL (SELECT v2.id, v2.employee_id FROM public.visits v2 WHERE v2.employee_id = as2.employee_id AND v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL LIMIT 1) vl ON true
        LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
        LEFT JOIN today_orders too ON too.employee_id = as2.employee_id
        LEFT JOIN today_collections tco ON tco.employee_id = as2.employee_id
        LEFT JOIN today_customers tc ON tc.employee_id = as2.employee_id
        LEFT JOIN today_visits tv ON tv.employee_id = as2.employee_id
        LEFT JOIN LATERAL (
            SELECT r.name FROM public.employee_roles er
            JOIN public.roles r ON r.id = er.role_id
            WHERE er.employee_id = as2.employee_id LIMIT 1
        ) role_info ON true), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

-- ================================================================
-- 4. get_my_workday_status — visit_links → visits
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_my_workday_status(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_workday record;
    v_break_count int;
    v_break_total_seconds int := 0;
    v_visit_count int;
    v_on_break boolean;
    v_open_break_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_workday FROM public.workday_sessions
    WHERE employee_id = v_employee_id AND date = CURRENT_DATE AND status = 'active';
    IF NOT FOUND THEN
        SELECT * INTO v_workday FROM public.workday_sessions
        WHERE employee_id = v_employee_id AND date = CURRENT_DATE AND status = 'completed'
        ORDER BY end_time DESC LIMIT 1;
        IF NOT FOUND THEN RETURN NULL; END IF;
        RETURN jsonb_build_object(
            'status', 'completed',
            'session_id', v_workday.id,
            'started_at', v_workday.start_time,
            'ended_at', v_workday.end_time,
            'duration_minutes', EXTRACT(EPOCH FROM (v_workday.end_time - v_workday.start_time)) / 60
        );
    END IF;

    SELECT COUNT(*) INTO v_visit_count FROM public.visits
    WHERE employee_id = v_employee_id AND check_in_at::date = CURRENT_DATE;

    SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) INTO v_break_count, v_break_total_seconds
    FROM public.workday_breaks WHERE session_id = v_workday.id;

    SELECT EXISTS(SELECT 1 FROM public.workday_breaks
                  WHERE session_id = v_workday.id AND break_end IS NULL) INTO v_on_break;
    SELECT id INTO v_open_break_id FROM public.workday_breaks
    WHERE session_id = v_workday.id AND break_end IS NULL LIMIT 1;

    RETURN jsonb_build_object(
        'status', 'active',
        'session_id', v_workday.id,
        'started_at', v_workday.start_time,
        'duration_minutes', EXTRACT(EPOCH FROM (now() - v_workday.start_time)) / 60,
        'break_count', v_break_count,
        'break_minutes', v_break_total_seconds / 60,
        'visit_count', v_visit_count,
        'net_work_minutes', (EXTRACT(EPOCH FROM (now() - v_workday.start_time)) - v_break_total_seconds) / 60,
        'on_break', v_on_break,
        'open_break_id', v_open_break_id
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_workday_settings TO anon;
GRANT EXECUTE ON FUNCTION public.get_live_workday_overview TO anon;
GRANT EXECUTE ON FUNCTION public.get_team_map TO anon;
GRANT EXECUTE ON FUNCTION public.get_my_workday_status TO anon;
