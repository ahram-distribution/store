-- Scope get_live_workday_overview + get_alerts to user's subtree
-- Users with attendance.view_all capability see ALL employees
-- Users without (e.g. sales managers) see only their subtree

-- 1. get_live_workday_overview — add subtree scoping
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
            AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
            AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
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
    employee_summary AS (
        SELECT
            as2.id AS session_id,
            as2.employee_id,
            as2.employee_name,
            as2.start_time,
            EXTRACT(EPOCH FROM (now() - as2.start_time)) / 60 AS duration_minutes,
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
            as2.status AS session_status
        FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN LATERAL (
            SELECT vl2.session_id, vl2.employee_id FROM public.visit_links vl2
            WHERE vl2.session_id = as2.id AND vl2.checkout_at IS NULL
            LIMIT 1
        ) vl ON true
        LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
    ),
    no_start AS (
        SELECT e.id AS employee_id, e.full_name AS employee_name
        FROM public.employees e
        WHERE (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        AND e.id NOT IN (SELECT employee_id FROM active_sessions)
        AND e.id NOT IN (
            SELECT employee_id FROM public.workday_sessions
            WHERE date = CURRENT_DATE AND status = 'completed'
        )
        AND e.is_active = true
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
    ),
    ended AS (
        SELECT wds.employee_id, e.full_name AS employee_name, wds.end_time,
            EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) / 60 AS duration_minutes,
            wds.visit_count
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        WHERE wds.date = CURRENT_DATE AND wds.status = 'completed'
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

GRANT EXECUTE ON FUNCTION public.get_live_workday_overview TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_workday_overview TO anon;

-- 2. get_alerts — fix column names + add subtree scoping
CREATE OR REPLACE FUNCTION public.get_alerts(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_settings record;
    v_interval_seconds int;
    v_start_time time;
    v_end_time time;
    v_subtree_ids uuid[];
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;

    SELECT official_start_time, official_end_time, location_interval_seconds
    INTO v_start_time, v_end_time, v_interval_seconds
    FROM public.workday_settings LIMIT 1;
    v_interval_seconds := COALESCE(v_interval_seconds, 300);

    WITH
    not_started AS (
        SELECT 'not_started' AS alert_type, e.id AS employee_id, e.full_name AS employee_name,
            'لم يبدأ يوم العمل بعد موعد الدوام' AS title,
            'الساعة الآن ' || to_char(now()::time, 'HH:MI') || ' — وقت البدء الرسمي ' || to_char(v_start_time, 'HH:MI') AS description,
            now() AS detected_at
        FROM public.employees e
        WHERE e.is_active = true
        AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        AND NOT EXISTS (SELECT 1 FROM public.workday_sessions wds WHERE wds.employee_id = e.id AND wds.date = CURRENT_DATE)
        AND CURRENT_TIME > v_start_time + interval '30 minutes'
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
    ),
    open_yesterday AS (
        SELECT 'open_yesterday' AS alert_type, wds.employee_id AS employee_id, e.full_name AS employee_name,
            'يوم عمل مفتوح من اليوم السابق' AS title,
            'بدأ يوم ' || wds.date || ' الساعة ' || to_char(wds.start_time, 'HH:MI') || ' — لم ينته بعد' AS description,
            now() AS detected_at
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        WHERE wds.date < CURRENT_DATE AND wds.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = wds.employee_id AND ewp.attendance_enabled = false)
    ),
    long_break AS (
        SELECT 'long_break' AS alert_type, wb.employee_id, e.full_name AS employee_name,
            'استراحة طويلة بشكل غير طبيعي' AS title,
            'في استراحة منذ ' || round(EXTRACT(EPOCH FROM (now() - wb.break_start)) / 60) || ' دقيقة' AS description,
            wb.break_start AS detected_at
        FROM public.workday_breaks wb
        JOIN public.employees e ON e.id = wb.employee_id
            AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        WHERE wb.break_end IS NULL
        AND EXTRACT(EPOCH FROM (now() - wb.break_start)) > 7200
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = wb.employee_id AND ewp.attendance_enabled = false)
    ),
    no_updates AS (
        SELECT 'no_updates' AS alert_type, wds.employee_id, e.full_name AS employee_name,
            'لا توجد تحديثات حديثة' AS title,
            'آخر تحديث منذ ' || round(EXTRACT(EPOCH FROM (now() - tp.recorded_at)) / 60) || ' دقيقة' AS description,
            tp.recorded_at AS detected_at
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        JOIN LATERAL (
            SELECT recorded_at FROM public.tracking_points
            WHERE employee_id = wds.employee_id AND recorded_at >= CURRENT_DATE
            ORDER BY recorded_at DESC LIMIT 1
        ) tp ON true
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
        AND tp.recorded_at < now() - ((v_interval_seconds * 5) || ' seconds')::interval
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = wds.employee_id AND ewp.attendance_enabled = false)
    ),
    no_visits AS (
        SELECT 'no_visits' AS alert_type, wds.employee_id, e.full_name AS employee_name,
            'لا توجد زيارات اليوم' AS title,
            'بدأ اليوم ' || to_char(wds.start_time, 'HH:MI') || ' — 0 زيارات حتى الآن' AS description,
            now() AS detected_at
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
        AND wds.start_time < CURRENT_DATE + v_start_time + interval '4 hours'
        AND NOT EXISTS (SELECT 1 FROM public.visit_links vl WHERE vl.session_id = wds.id)
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = wds.employee_id AND ewp.attendance_enabled = false)
    )
    SELECT jsonb_build_object(
        'active_alerts', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.detected_at DESC) FROM (
            SELECT * FROM not_started UNION ALL
            SELECT * FROM open_yesterday UNION ALL
            SELECT * FROM long_break UNION ALL
            SELECT * FROM no_updates UNION ALL
            SELECT * FROM no_visits
        ) t), '[]'::jsonb),
        'resolved_alerts', '[]'::jsonb
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_alerts TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_alerts TO anon;

NOTIFY pgrst, 'reload schema';
