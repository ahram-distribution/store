-- ================================================================
-- Attendance Engine — طبقة الحضور المستقلة
--
-- المصدر فقط: workday_sessions, workday_breaks, tracking_points
-- لا يحتوي أي Business Data
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_employees_attendance_summary(
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
    v_offset int;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF public.is_upper_management(v_session.employee_id) THEN
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
    -- Per-session attendance (deduplicated by employee_id, date)
    session_attendance AS (
        SELECT DISTINCT ON (wds.employee_id, wds.date)
            wds.employee_id,
            wds.date,
            wds.start_time,
            wds.end_time,
            wds.status,
            wds.attendance_status,
            wds.late_minutes,
            wds.early_departure_minutes,
            wds.total_distance_meters,
            GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60) AS duration_minutes,
            COALESCE(wb.break_minutes, 0) AS break_minutes,
            COALESCE(wb.break_count, 0) AS break_count,
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
            SELECT tp.session_id,
                COUNT(*)::int AS tracking_points_count
            FROM public.tracking_points tp
            GROUP BY tp.session_id
        ) tp ON tp.session_id = wds.id
        WHERE wds.date >= p_from AND wds.date <= p_to
        ORDER BY wds.employee_id, wds.date, wds.start_time DESC
    ),
    -- Aggregated attendance per employee (LEFT JOIN from ALL visible employees)
    emp_aggregated AS (
        SELECT
            sa2.employee_id,
            COUNT(*)::int AS total_days,
            COUNT(*) FILTER (WHERE sa2.attendance_status = 'late')::int AS late_count,
            COUNT(*) FILTER (WHERE sa2.attendance_status = 'ontime')::int AS ontime_count,
            COUNT(*) FILTER (WHERE sa2.attendance_status = 'early_departure')::int AS early_departure_count,
            COALESCE(SUM(GREATEST(COALESCE(sa2.duration_minutes, 0) - COALESCE(sa2.break_minutes, 0), 0))::int, 0) AS total_net_minutes,
            COALESCE(AVG(GREATEST(COALESCE(sa2.duration_minutes, 0) - COALESCE(sa2.break_minutes, 0), 0))::int, 0) AS avg_net_minutes,
            COALESCE(SUM(sa2.total_distance_meters)::int, 0) AS total_distance_meters,
            COALESCE(SUM(sa2.tracking_points_count)::int, 0) AS total_tracking_points
        FROM session_attendance sa2
        GROUP BY sa2.employee_id
    ),
    emp_attendance AS (
        SELECT
            ve.id AS employee_id,
            COALESCE(ea.total_days, 0)::int AS total_days,
            COALESCE(ea.late_count, 0)::int AS late_count,
            COALESCE(ea.ontime_count, 0)::int AS ontime_count,
            COALESCE(ea.early_departure_count, 0)::int AS early_departure_count,
            COALESCE(ea.total_net_minutes, 0)::int AS total_net_minutes,
            COALESCE(ea.avg_net_minutes, 0)::int AS avg_net_minutes,
            COALESCE(ea.total_distance_meters, 0)::int AS total_distance_meters,
            COALESCE(ea.total_tracking_points, 0)::int AS total_tracking_points
        FROM visible_employees ve
        LEFT JOIN emp_aggregated ea ON ea.employee_id = ve.id
    ),
    grand_totals AS (
        SELECT
            COUNT(*)::int AS total_employees,
            COALESCE(SUM(ea.total_days)::int, 0) AS total_days,
            COALESCE(SUM(ea.total_net_minutes)::int, 0) AS total_net_minutes,
            COALESCE(SUM(ea.total_distance_meters)::int, 0) AS total_distance_meters,
            COALESCE(SUM(ea.late_count)::int, 0) AS total_late_days,
            COALESCE(SUM(ea.ontime_count)::int, 0) AS total_ontime_days,
            COALESCE(SUM(ea.early_departure_count)::int, 0) AS total_early_departure_days
        FROM emp_attendance ea
    ),
    paginated AS (
        SELECT *
        FROM emp_attendance
        ORDER BY
            CASE WHEN p_sort_by = 'total_net_minutes' AND p_sort_order = 'desc' THEN total_net_minutes END DESC NULLS LAST,
            CASE WHEN p_sort_by = 'total_net_minutes' AND p_sort_order = 'asc' THEN total_net_minutes END ASC NULLS LAST,
            CASE WHEN p_sort_by = 'total_days' AND p_sort_order = 'desc' THEN total_days END DESC NULLS LAST,
            CASE WHEN p_sort_by = 'total_days' AND p_sort_order = 'asc' THEN total_days END ASC NULLS LAST,
            total_net_minutes DESC NULLS LAST
        LIMIT p_per_page OFFSET v_offset
    )
    SELECT jsonb_build_object(
        'employees', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                'employee_id', p.employee_id,
                'employee_name', ve.full_name,
                'employee_code', ve.code,
                'total_days', p.total_days,
                'total_net_minutes', p.total_net_minutes,
                'avg_net_minutes', p.avg_net_minutes,
                'total_distance_meters', p.total_distance_meters,
                'total_tracking_points', p.total_tracking_points,
                'late_count', p.late_count,
                'ontime_count', p.ontime_count,
                'early_departure_count', p.early_departure_count
            ) ORDER BY p.total_net_minutes DESC)
            FROM paginated p
            JOIN visible_employees ve ON ve.id = p.employee_id),
            '[]'::jsonb
        ),
        'totals', (SELECT jsonb_build_object(
            'total_employees', gt.total_employees,
            'total_days', gt.total_days,
            'total_net_minutes', gt.total_net_minutes,
            'total_distance_meters', gt.total_distance_meters,
            'late_days', gt.total_late_days,
            'ontime_days', gt.total_ontime_days,
            'early_departure_days', gt.total_early_departure_days
        ) FROM grand_totals gt),
        'pagination', jsonb_build_object(
            'page', p_page,
            'per_page', p_per_page,
            'total', (SELECT cnt FROM total_count),
            'total_pages', GREATEST(1, CEIL((SELECT cnt::numeric FROM total_count) / p_per_page)::int)
        )
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_employees_attendance_summary TO authenticated;

COMMENT ON FUNCTION public.get_employees_attendance_summary IS 'سجل الحضور للمندوبين — أيام، ساعات، مسافة (بدون بيانات تجارية)';
