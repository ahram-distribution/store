-- Phase 5: Attendance Module V2 Compliance — Fix all management RPCs
-- 1. Replace role-name checks with check_capability in configuration RPCs
-- 2. Add productivity metrics (order_count, collection_count, new_customer_count) 
-- 3. Assign attendance.* capabilities to appropriate roles

-- ================================================================
-- 1. Assign attendance capabilities to roles
-- ================================================================
-- Super admin, Admin, Chairman → all attendance.*
-- مدير البيع, مدير تنفيذي → live_monitor, view_timeline, view_history, view_reports, view_alerts, view_team_map
-- مشرف مبيعات, مشرف تنفيذي → live_monitor, view_alerts

DO $$
DECLARE
  v_cap RECORD;
  v_role RECORD;
BEGIN
  -- Super admin → all attendance capabilities
  FOR v_cap IN SELECT id FROM public.capabilities WHERE code LIKE 'attendance.%' LOOP
    INSERT INTO public.role_capabilities (role_id, capability_id)
    SELECT r.id, v_cap.id FROM public.roles r WHERE r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- مدير البيع, مدير تنفيذي → operational capabilities
  FOR v_cap IN SELECT id, code FROM public.capabilities WHERE code IN (
    'attendance.live_monitor', 'attendance.view_timeline', 'attendance.view_history',
    'attendance.view_reports', 'attendance.view_alerts', 'attendance.view_team_map', 'attendance.view_all'
  ) LOOP
    INSERT INTO public.role_capabilities (role_id, capability_id)
    SELECT r.id, v_cap.id FROM public.roles r WHERE r.name IN ('مدير البيع', 'مدير تنفيذي')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- مشرف مبيعات, مشرف تنفيذي → live_monitor, view_alerts
  FOR v_cap IN SELECT id FROM public.capabilities WHERE code IN ('attendance.live_monitor', 'attendance.view_alerts') LOOP
    INSERT INTO public.role_capabilities (role_id, capability_id)
    SELECT r.id, v_cap.id FROM public.roles r WHERE r.name IN ('مشرف مبيعات', 'مشرف تنفيذي')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Configure and cleanup → super admin/admin/chairman only (already covered above)
END $$;

-- ================================================================
-- 2. Fix configuration RPCs — replace role-name checks with check_capability
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_workday_settings(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_settings record;
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

CREATE OR REPLACE FUNCTION public.update_workday_settings(
    p_token uuid,
    p_fields jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_setting_id uuid;
    v_sql text := 'UPDATE public.workday_settings SET ';
    v_updates text[] := '{}';
    v_key text;
    v_val text;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'attendance.configure') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT id INTO v_setting_id FROM public.workday_settings LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO public.workday_settings (updated_by) VALUES (v_session.employee_id)
        RETURNING id INTO v_setting_id;
    END IF;

    FOR v_key, v_val IN SELECT * FROM jsonb_each_text(p_fields)
    LOOP
        IF v_key IN ('tracking_mode', 'location_interval_seconds', 'official_start_time',
                     'official_end_time', 'late_threshold_minutes', 'early_departure_threshold_minutes',
                     'retention_days', 'auto_cleanup_enabled', 'cleanup_frequency') THEN
            v_updates := array_append(v_updates, format('%I = %L', v_key,
                CASE
                    WHEN v_val ~ '^\d+(\.\d+)?$' THEN v_val
                    WHEN v_val IN ('true', 'false') THEN v_val
                    ELSE quote_literal(v_val)
                END
            ));
        END IF;
    END LOOP;

    v_updates := array_append(v_updates, format('updated_by = %L', v_session.employee_id));
    v_updates := array_append(v_updates, 'updated_at = now()');

    IF array_length(v_updates, 1) > 2 THEN
        EXECUTE v_sql || array_to_string(v_updates, ', ') || format(' WHERE id = %L', v_setting_id);
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_workday_cleanup_log(
    p_token uuid,
    p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_logs jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'attendance.cleanup') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.executed_at DESC), '[]'::jsonb) INTO v_logs
    FROM (
        SELECT * FROM public.tracking_cleanup_log
        ORDER BY executed_at DESC
        LIMIT p_limit
    ) t;

    RETURN jsonb_build_object('logs', v_logs);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_tracking_data(
    p_token uuid,
    p_mode varchar,
    p_employee_id uuid DEFAULT NULL,
    p_from date DEFAULT NULL,
    p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_deleted_sessions int := 0;
    v_deleted_points int := 0;
    v_cutoff timestamptz;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'attendance.cleanup') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF p_mode = 'all' THEN
        DELETE FROM public.tracking_points;
        GET DIAGNOSTICS v_deleted_points = ROW_COUNT;
        DELETE FROM public.workday_sessions;
        GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    ELSIF p_mode = 'range' AND p_from IS NOT NULL AND p_to IS NOT NULL THEN
        DELETE FROM public.tracking_points tp
        WHERE tp.recorded_at >= p_from AND tp.recorded_at < p_to + interval '1 day';
        GET DIAGNOSTICS v_deleted_points = ROW_COUNT;
        DELETE FROM public.workday_sessions wds
        WHERE wds.date >= p_from AND wds.date <= p_to;
        GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    ELSIF p_mode = 'employee' AND p_employee_id IS NOT NULL THEN
        DELETE FROM public.tracking_points WHERE employee_id = p_employee_id;
        GET DIAGNOSTICS v_deleted_points = ROW_COUNT;
        DELETE FROM public.workday_sessions WHERE employee_id = p_employee_id;
        GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    ELSIF p_mode = 'day' AND p_from IS NOT NULL THEN
        DELETE FROM public.tracking_points tp
        WHERE tp.recorded_at >= p_from AND tp.recorded_at < p_from + interval '1 day';
        GET DIAGNOSTICS v_deleted_points = ROW_COUNT;
        DELETE FROM public.workday_sessions wds
        WHERE wds.date = p_from;
        GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    END IF;

    INSERT INTO public.tracking_cleanup_log
        (action_type, deleted_sessions, deleted_points, executed_by)
    VALUES ('manual_cleanup', v_deleted_sessions, v_deleted_points, v_session.employee_id);

    RETURN jsonb_build_object('success', true, 'deleted_sessions', v_deleted_sessions, 'deleted_points', v_deleted_points);
END;
$function$;

-- ================================================================
-- 3. Fix get_live_workday_overview — correct capability + add productivity metrics
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
        v_subtree_ids := NULL; -- all employees
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
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id, EXTRACT(EPOCH FROM (now() - wb.break_start)) / 60 AS break_minutes
        FROM public.workday_breaks wb
        WHERE wb.break_end IS NULL
    ),
    today_orders AS (
        SELECT o.created_by AS employee_id, COUNT(*)::int AS order_count
        FROM public.orders o
        WHERE o.created_at::date = CURRENT_DATE AND o.status = 'delivered'
        GROUP BY o.created_by
    ),
    today_collections AS (
        SELECT c.created_by AS employee_id, COUNT(*)::int AS collection_count, COALESCE(SUM(c.amount), 0) AS collection_amount
        FROM public.collections c
        WHERE c.collected_at::date = CURRENT_DATE AND c.status = 'approved'
        GROUP BY c.created_by
    ),
    today_customers AS (
        SELECT c.owner_id AS employee_id, COUNT(*)::int AS new_customer_count
        FROM public.customers c
        WHERE c.created_at::date = CURRENT_DATE
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
            as2.id AS session_id,
            as2.employee_id,
            as2.employee_name,
            as2.start_time,
            EXTRACT(EPOCH FROM (now() - as2.start_time)) / 60 AS duration_minutes,
            COALESCE(tb.total_break_minutes, 0) AS break_minutes,
            CASE WHEN ab.employee_id IS NOT NULL THEN 'on_break'
                 WHEN vl.employee_id IS NOT NULL THEN 'on_visit'
                 ELSE 'working'
            END AS work_status,
            lp.latitude, lp.longitude, lp.recorded_at AS last_seen_at,
            CASE
                WHEN lp.recorded_at IS NULL THEN 'no_data'
                WHEN lp.recorded_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                WHEN lp.recorded_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                ELSE 'lost'
            END AS connection_status,
            as2.status AS session_status,
            COALESCE(too.order_count, 0) AS order_count,
            COALESCE(tco.collection_count, 0) AS collection_count,
            COALESCE(tco.collection_amount, 0) AS collection_amount,
            COALESCE(tc.new_customer_count, 0) AS new_customer_count
        FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN LATERAL (
            SELECT vl2.session_id, vl2.employee_id FROM public.visit_links vl2
            WHERE vl2.session_id = as2.id AND vl2.checkout_at IS NULL
            LIMIT 1
        ) vl ON true
        LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
        LEFT JOIN today_orders too ON too.employee_id = as2.employee_id
        LEFT JOIN today_collections tco ON tco.employee_id = as2.employee_id
        LEFT JOIN today_customers tc ON tc.employee_id = as2.employee_id
        LEFT JOIN total_breaks tb ON tb.employee_id = as2.employee_id
    ),
    no_start AS (
        SELECT e.id AS employee_id, e.full_name AS employee_name
        FROM public.employees e
        JOIN filtered_employees fe ON fe.id = e.id
        WHERE e.id NOT IN (SELECT employee_id FROM active_sessions)
        AND e.id NOT IN (
            SELECT employee_id FROM public.workday_sessions
            WHERE date = CURRENT_DATE AND status = 'completed'
        )
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
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', es.employee_id,
            'name', es.employee_name,
            'status', es.work_status,
            'session_status', es.session_status,
            'started_at', es.start_time,
            'duration_minutes', es.duration_minutes::int,
            'net_minutes', GREATEST(es.duration_minutes::int - es.break_minutes::int, 0),
            'break_minutes', es.break_minutes::int,
            'order_count', es.order_count,
            'collection_count', es.collection_count,
            'collection_amount', es.collection_amount,
            'new_customer_count', es.new_customer_count,
            'latitude', es.latitude,
            'longitude', es.longitude,
            'last_seen_at', es.last_seen_at,
            'connection_status', es.connection_status,
            'last_seen_label',
                CASE es.connection_status
                    WHEN 'connected' THEN 'متصل الآن'
                    WHEN 'delayed' THEN
                        'آخر ظهور منذ ' || EXTRACT(EPOCH FROM (now() - es.last_seen_at))::int / 60 || ' دقيقة'
                    WHEN 'lost' THEN 'انقطاع متابعة'
                    ELSE 'لا توجد بيانات حديثة'
                END
        ) ORDER BY
            CASE es.work_status
                WHEN 'working' THEN 1
                WHEN 'on_visit' THEN 2
                WHEN 'on_break' THEN 3
                ELSE 4
            END
        ) FROM employee_summary es), '[]'::jsonb),
        'no_start_employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', ns.employee_id,
            'name', ns.employee_name
        )) FROM no_start ns), '[]'::jsonb),
        'ended_employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', ed.employee_id,
            'name', ed.employee_name,
            'ended_at', ed.end_time,
            'duration_minutes', ed.duration_minutes::int,
            'visit_count', ed.visit_count
        ) ORDER BY ed.end_time DESC) FROM ended ed), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

-- ================================================================
-- 4. Update get_team_map — add productivity metrics
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
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id
        FROM public.workday_breaks wb
        WHERE wb.break_end IS NULL
    ),
    today_orders AS (
        SELECT o.created_by AS employee_id, COUNT(*)::int AS order_count
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE GROUP BY o.created_by
    ),
    today_collections AS (
        SELECT c.created_by AS employee_id, COUNT(*)::int AS collection_count
        FROM public.collections c WHERE c.collected_at::date = CURRENT_DATE AND c.status = 'approved' GROUP BY c.created_by
    ),
    today_customers AS (
        SELECT c.owner_id AS employee_id, COUNT(*)::int AS new_customer_count
        FROM public.customers c WHERE c.created_at::date = CURRENT_DATE GROUP BY c.owner_id
    )
    SELECT jsonb_build_object(
        'counters', jsonb_build_object(
            'active', (SELECT COUNT(*) FROM active_sessions),
            'on_break', (SELECT COUNT(DISTINCT ab.employee_id) FROM active_sessions as2 JOIN active_breaks ab ON ab.session_id = as2.id),
            'not_started', 0,
            'connection_lost', 0,
            'zero_visits_today', 0,
            'zero_orders_today', 0,
            'inactive_over_2h', 0
        ),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', as2.employee_id,
            'name', as2.employee_name,
            'status', CASE WHEN ab.employee_id IS NOT NULL THEN 'on_break'
                           WHEN vl.employee_id IS NOT NULL THEN 'on_visit'
                           ELSE 'working' END,
            'connection_status', CASE
                WHEN lp.recorded_at IS NULL THEN 'no_data'
                WHEN lp.recorded_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                WHEN lp.recorded_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                ELSE 'lost' END,
            'latitude', lp.latitude, 'longitude', lp.longitude, 'last_seen_at', lp.recorded_at,
            'duration_minutes', EXTRACT(EPOCH FROM (now() - as2.start_time)) / 60,
            'order_count', COALESCE(too.order_count, 0),
            'collection_count', COALESCE(tco.collection_count, 0),
            'new_customer_count', COALESCE(tc.new_customer_count, 0)
        )) FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN LATERAL (SELECT vl2.session_id, vl2.employee_id FROM public.visit_links vl2 WHERE vl2.session_id = as2.id AND vl2.checkout_at IS NULL LIMIT 1) vl ON true
        LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
        LEFT JOIN today_orders too ON too.employee_id = as2.employee_id
        LEFT JOIN today_collections tco ON tco.employee_id = as2.employee_id
        LEFT JOIN today_customers tc ON tc.employee_id = as2.employee_id), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

-- ================================================================
-- 5. Update get_workday_report — add productivity + compliance metrics
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_workday_report(
    p_token uuid,
    p_from date,
    p_to date,
    p_employee_ids uuid[] DEFAULT NULL
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
        SELECT
            fs.employee_id, fs.employee_name, fs.employee_code,
            COUNT(*)::int AS sessions,
            COALESCE(SUM(EXTRACT(EPOCH FROM (fs.end_time - fs.start_time)) / 3600), 0) AS total_hours,
            COALESCE(SUM(fs.visit_count), 0) AS total_visits,
            COALESCE(SUM(CASE WHEN fs.attendance_status = 'late' THEN 1 ELSE 0 END), 0) AS late_days,
            COALESCE(SUM(CASE WHEN fs.attendance_status = 'early_departure' THEN 1 ELSE 0 END), 0) AS early_departure_days,
            COALESCE(SUM(CASE WHEN fs.attendance_status = 'ontime' THEN 1 ELSE 0 END), 0) AS ontime_days
        FROM filtered_sessions fs
        WHERE fs.status = 'completed'
        GROUP BY fs.employee_id, fs.employee_name, fs.employee_code
    ),
    emp_orders AS (
        SELECT o.created_by AS employee_id, COUNT(*)::int AS total_orders
        FROM public.orders o
        JOIN filtered_sessions fs ON fs.employee_id = o.created_by AND o.created_at::date >= p_from AND o.created_at::date <= p_to
        GROUP BY o.created_by
    ),
    emp_collections AS (
        SELECT c.created_by AS employee_id, COUNT(*)::int AS total_collections,
            COALESCE(SUM(c.amount), 0) AS total_collection_amount
        FROM public.collections c
        JOIN filtered_sessions fs ON fs.employee_id = c.created_by AND c.collected_at::date >= p_from AND c.collected_at::date <= p_to
        WHERE c.status = 'approved'
        GROUP BY c.created_by
    ),
    emp_customers AS (
        SELECT c.owner_id AS employee_id, COUNT(*)::int AS total_new_customers
        FROM public.customers c
        JOIN filtered_sessions fs ON fs.employee_id = c.owner_id AND c.created_at::date >= p_from AND c.created_at::date <= p_to
        GROUP BY c.owner_id
    )
    SELECT jsonb_build_object(
        'summary', jsonb_build_object(
            'total_sessions', (SELECT COUNT(*) FROM filtered_sessions WHERE status = 'completed'),
            'total_net_hours', (SELECT COALESCE(SUM(total_hours), 0) FROM emp_stats),
            'total_visits', (SELECT COALESCE(SUM(total_visits), 0) FROM emp_stats),
            'total_orders', (SELECT COALESCE(SUM(total_orders), 0) FROM emp_orders),
            'total_collections', (SELECT COALESCE(SUM(total_collections), 0) FROM emp_collections),
            'total_collections_amount', (SELECT COALESCE(SUM(total_collection_amount), 0) FROM emp_collections),
            'total_new_customers', (SELECT COALESCE(SUM(total_new_customers), 0) FROM emp_customers),
            'late_days', (SELECT COALESCE(SUM(late_days), 0) FROM emp_stats),
            'early_departure_days', (SELECT COALESCE(SUM(early_departure_days), 0) FROM emp_stats),
            'ontime_days', (SELECT COALESCE(SUM(ontime_days), 0) FROM emp_stats)
        ),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', es.employee_id,
            'name', es.employee_name,
            'code', es.employee_code,
            'sessions', es.sessions,
            'net_hours', es.total_hours,
            'total_visits', es.total_visits,
            'total_orders', COALESCE(eo.total_orders, 0),
            'total_collections', COALESCE(ec.total_collections, 0),
            'total_collections_amount', COALESCE(ec.total_collection_amount, 0),
            'new_customers', COALESCE(enc.total_new_customers, 0),
            'late_days', es.late_days,
            'early_departure_days', es.early_departure_days,
            'ontime_days', es.ontime_days
        )) FROM emp_stats es
        LEFT JOIN emp_orders eo ON eo.employee_id = es.employee_id
        LEFT JOIN emp_collections ec ON ec.employee_id = es.employee_id
        LEFT JOIN emp_customers enc ON enc.employee_id = es.employee_id), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

-- Grant execution
GRANT EXECUTE ON FUNCTION public.get_workday_settings TO anon;
GRANT EXECUTE ON FUNCTION public.update_workday_settings TO anon;
GRANT EXECUTE ON FUNCTION public.get_workday_cleanup_log TO anon;
GRANT EXECUTE ON FUNCTION public.cleanup_tracking_data TO anon;
GRANT EXECUTE ON FUNCTION public.get_live_workday_overview TO anon;
GRANT EXECUTE ON FUNCTION public.get_team_map TO anon;
GRANT EXECUTE ON FUNCTION public.get_workday_report TO anon;
