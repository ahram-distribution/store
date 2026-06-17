CREATE OR REPLACE FUNCTION public.get_auto_closed_sessions_today(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_session app.sessions;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'employee_name', e.full_name,
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

CREATE OR REPLACE FUNCTION public.get_auto_closed_sessions_month(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
                    'employee_name', e.full_name,
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

CREATE OR REPLACE FUNCTION public.get_attendance_analysis(p_token uuid, p_from date, p_to date, p_employee_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    SELECT jsonb_build_object(
        'summary', jsonb_build_object(
            'total_work_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND status = 'completed' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'ontime_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'ontime' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'late_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'late' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'total_late_minutes', (SELECT COALESCE(SUM(late_minutes), 0) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'late' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'early_departure_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'early_departure' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'total_early_departure_minutes', (SELECT COALESCE(SUM(early_departure_minutes), 0) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'early_departure' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'absent_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'absent' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids)))),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', sub.employee_id, 'name', sub.employee_name,
            'work_days', sub.work_days, 'ontime_days', sub.ontime_days, 'late_days', sub.late_days,
            'late_minutes', sub.late_minutes, 'early_departure_days', sub.early_departure_days,
            'early_departure_minutes', sub.early_departure_minutes, 'absent_days', sub.absent_days,
            'compliance_rate', CASE WHEN sub.work_days > 0 THEN ROUND((sub.ontime_days::numeric / sub.work_days) * 100, 1) ELSE 0 END
        ) ORDER BY sub.compliance_rate DESC)), '[]'::jsonb)
    ) INTO v_result
    FROM (SELECT wds.employee_id, e.full_name AS employee_name, COUNT(*) AS work_days,
        COUNT(*) FILTER (WHERE wds.attendance_status = 'ontime') AS ontime_days,
        COUNT(*) FILTER (WHERE wds.attendance_status = 'late') AS late_days,
        COALESCE(SUM(wds.late_minutes) FILTER (WHERE wds.attendance_status = 'late'), 0) AS late_minutes,
        COUNT(*) FILTER (WHERE wds.attendance_status = 'early_departure') AS early_departure_days,
        COALESCE(SUM(wds.early_departure_minutes) FILTER (WHERE wds.attendance_status = 'early_departure'), 0) AS early_departure_minutes,
        COUNT(*) FILTER (WHERE wds.attendance_status IN ('absent', 'unknown')) AS absent_days
        FROM public.workday_sessions wds JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date >= p_from AND wds.date <= p_to AND wds.status = 'completed'
        AND (p_employee_ids IS NULL OR wds.employee_id = ANY(p_employee_ids))
        GROUP BY wds.employee_id, e.full_name) sub;
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_employee_current_location(p_token uuid, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      IF NOT EXISTS (SELECT 1 FROM public.get_visible_employee_ids(p_token) AS eid WHERE eid = p_employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
    SELECT jsonb_build_object('employee_id', e.id, 'name', e.full_name, 'latitude', tp.latitude, 'longitude', tp.longitude,
        'address', COALESCE(ea.address, ''), 'status', COALESCE(wds.status, 'inactive'),
        'attendance_status', wds.attendance_status, 'last_updated_at', tp.recorded_at,
        'last_seen_label', CASE WHEN tp.recorded_at > now() - interval '5 minutes' THEN 'منذ لحظات'
            WHEN tp.recorded_at > now() - interval '30 minutes' THEN 'منذ حوالي ' || round(EXTRACT(EPOCH FROM (now() - tp.recorded_at)) / 60) || ' دقيقة'
            ELSE 'قبل أكثر من نصف ساعة' END)
    INTO v_result
    FROM public.employees e
    LEFT JOIN LATERAL (SELECT latitude, longitude, recorded_at FROM public.tracking_points WHERE employee_id = p_employee_id ORDER BY recorded_at DESC LIMIT 1) tp ON true
    LEFT JOIN LATERAL (SELECT * FROM public.workday_sessions WHERE employee_id = p_employee_id AND date = CURRENT_DATE ORDER BY start_time DESC LIMIT 1) wds ON true
    LEFT JOIN public.employee_addresses ea ON ea.employee_id = e.id AND ea.is_primary = true
    WHERE e.id = p_employee_id;
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_workday_report(p_token uuid, p_from date, p_to date, p_employee_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_session app.sessions;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT jsonb_build_object(
        'summary', jsonb_build_object(
            'total_sessions', COUNT(*),
            'total_net_hours', COALESCE(SUM(
                EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 -
                COALESCE((SELECT SUM(COALESCE(duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = wds.id)::numeric / 3600, 0)
            ), 0),
            'total_visits', COALESCE(SUM(visit_count), 0),
            'total_distance_km', COALESCE(SUM(total_distance_meters), 0) / 1000,
            'late_days', COUNT(*) FILTER (WHERE attendance_status = 'late'),
            'total_late_minutes', COALESCE(SUM(late_minutes), 0),
            'early_departure_days', COUNT(*) FILTER (WHERE attendance_status = 'early_departure'),
            'total_early_departure_minutes', COALESCE(SUM(early_departure_minutes), 0),
            'ontime_days', COUNT(*) FILTER (WHERE attendance_status = 'ontime'),
            'absent_days', COUNT(*) FILTER (WHERE attendance_status = 'absent')
        ),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', sub.employee_id,
            'name', sub.employee_name,
            'sessions', sub.session_count,
            'net_hours', sub.net_hours,
            'total_visits', sub.total_visits,
            'late_days', sub.late_days,
            'late_minutes', sub.late_minutes,
            'early_departure_days', sub.early_departure_days,
            'early_departure_minutes', sub.early_departure_minutes,
            'ontime_days', sub.ontime_days
        ) ORDER BY sub.session_count DESC)), '[]'::jsonb)
    ) INTO v_result
    FROM (
        SELECT
            wds.employee_id, e.full_name AS employee_name,
            COUNT(*) AS session_count,
            ROUND(COALESCE(SUM(
                EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) / 3600 -
                COALESCE((SELECT SUM(COALESCE(wb2.duration_seconds, 0)) FROM public.workday_breaks wb2 WHERE wb2.session_id = wds.id)::numeric / 3600, 0)
            ), 0)::numeric, 2) AS net_hours,
            SUM(wds.visit_count) AS total_visits,
            COUNT(*) FILTER (WHERE wds.attendance_status = 'late') AS late_days,
            SUM(wds.late_minutes) AS late_minutes,
            COUNT(*) FILTER (WHERE wds.attendance_status = 'early_departure') AS early_departure_days,
            SUM(wds.early_departure_minutes) AS early_departure_minutes,
            COUNT(*) FILTER (WHERE wds.attendance_status = 'ontime') AS ontime_days
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
        WHERE wds.date >= p_from AND wds.date <= p_to AND wds.status = 'completed'
        AND (p_employee_ids IS NULL OR wds.employee_id = ANY(p_employee_ids))
        GROUP BY wds.employee_id, e.full_name
    ) sub;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.test_report(p_token uuid, p_from date, p_to date, p_employee_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'name', sub.employee_name
        )) FROM (SELECT e.full_name AS employee_name, COUNT(*) AS session_count
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date >= p_from AND wds.date <= p_to AND wds.status = 'completed'
        AND (p_employee_ids IS NULL OR wds.employee_id = ANY(p_employee_ids))
        GROUP BY wds.employee_id, e.full_name) sub), '[]'::jsonb)
    ) INTO v_result
    FROM (SELECT 1) dummy;
    RETURN v_result;
END;
$function$;
