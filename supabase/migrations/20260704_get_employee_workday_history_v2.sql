-- Phase 2: get_employee_workday_history V2
-- Adds: net_minutes, break_minutes, order_count, sales_value,
--   collection_count, collection_amount, new_customer_count,
--   tracking_points_count, distance_meters
-- Summary adds: all totals, averages, best/worst day

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
    v_subtree_ids uuid[];
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
    IF v_subtree_ids IS NOT NULL AND NOT (p_employee_id = ANY(v_subtree_ids)) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    WITH session_data AS (
        SELECT
            wds.id, wds.date, wds.start_time, wds.end_time, wds.status,
            EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60 AS duration_minutes,
            COALESCE(wb.break_seconds, 0) / 60 AS break_minutes,
            COALESCE(wb.break_count, 0) AS break_count,
            wds.visit_count,
            wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
            wds.total_distance_meters,
            COALESCE(od.order_count, 0) AS order_count,
            COALESCE(od.sales_value, 0) AS sales_value,
            COALESCE(cd.collection_count, 0) AS collection_count,
            COALESCE(cd.collection_amount, 0) AS collection_amount,
            COALESCE(nd.new_customer_count, 0) AS new_customer_count,
            COALESCE(tp.tracking_points_count, 0) AS tracking_points_count
        FROM public.workday_sessions wds
        LEFT JOIN (
            SELECT session_id,
                COUNT(*) AS break_count,
                SUM(COALESCE(duration_seconds, 0)) AS break_seconds
            FROM public.workday_breaks
            GROUP BY session_id
        ) wb ON wb.session_id = wds.id
        LEFT JOIN (
            SELECT o.owner_id, o.created_at::date AS d,
                COUNT(*)::int AS order_count,
                COALESCE(SUM(o.total_amount), 0) AS sales_value
            FROM public.orders o GROUP BY o.owner_id, o.created_at::date
        ) od ON od.owner_id = wds.employee_id AND od.d = wds.date
        LEFT JOIN (
            SELECT c.owner_id, c.created_at::date AS d,
                COUNT(*)::int AS collection_count,
                COALESCE(SUM(c.amount), 0) AS collection_amount
            FROM public.collections c GROUP BY c.owner_id, c.created_at::date
        ) cd ON cd.owner_id = wds.employee_id AND cd.d = wds.date
        LEFT JOIN (
            SELECT c2.owner_id, c2.created_at::date AS d,
                COUNT(*)::int AS new_customer_count
            FROM public.customers c2 GROUP BY c2.owner_id, c2.created_at::date
        ) nd ON nd.owner_id = wds.employee_id AND nd.d = wds.date
        LEFT JOIN (
            SELECT tp.session_id,
                COUNT(*)::int AS tracking_points_count
            FROM public.tracking_points tp GROUP BY tp.session_id
        ) tp ON tp.session_id = wds.id
        WHERE wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to
    )
    SELECT jsonb_build_object(
        'sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', sd.id, 'date', sd.date, 'start_time', sd.start_time, 'end_time', sd.end_time,
            'status', sd.status,
            'duration_minutes', GREATEST(COALESCE(sd.duration_minutes, 0), 0)::int,
            'break_minutes', sd.break_minutes::int,
            'net_minutes', GREATEST(COALESCE(sd.duration_minutes, 0) - COALESCE(sd.break_minutes, 0), 0)::int,
            'break_count', sd.break_count,
            'visit_count', sd.visit_count,
            'order_count', sd.order_count,
            'sales_value', sd.sales_value,
            'collection_count', sd.collection_count,
            'collection_amount', sd.collection_amount,
            'new_customer_count', sd.new_customer_count,
            'distance_meters', COALESCE(sd.total_distance_meters, 0)::int,
            'tracking_points_count', sd.tracking_points_count,
            'attendance_status', sd.attendance_status,
            'late_minutes', sd.late_minutes,
            'early_departure_minutes', sd.early_departure_minutes
        ) ORDER BY sd.date DESC) FROM session_data sd), '[]'::jsonb),
        'summary', (SELECT jsonb_build_object(
            'total_days', COUNT(*) FILTER (WHERE status = 'completed'),
            'total_duration_minutes', COALESCE(SUM(duration_minutes) FILTER (WHERE status = 'completed'), 0)::int,
            'total_break_minutes', COALESCE(SUM(break_minutes) FILTER (WHERE status = 'completed'), 0)::int,
            'total_net_minutes', COALESCE(SUM(GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0)) FILTER (WHERE status = 'completed'), 0)::int,
            'avg_net_minutes', COALESCE(
                AVG(GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0)) FILTER (WHERE status = 'completed'),
                0
            )::int,
            'max_net_day', COALESCE(
                MAX(GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0)) FILTER (WHERE status = 'completed'),
                0
            )::int,
            'min_net_day', COALESCE(
                MIN(GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0)) FILTER (WHERE status = 'completed'),
                0
            )::int,
            'total_sales_value', COALESCE(SUM(sales_value)::int, 0),
            'total_orders', COALESCE(SUM(order_count)::int, 0),
            'total_visits', COALESCE(SUM(visit_count)::int, 0),
            'total_collections', COALESCE(SUM(collection_count)::int, 0),
            'total_collections_amount', COALESCE(SUM(collection_amount)::int, 0),
            'total_new_customers', COALESCE(SUM(new_customer_count)::int, 0),
            'total_distance_meters', COALESCE(SUM(total_distance_meters)::int, 0),
            'total_tracking_points', COALESCE(SUM(tracking_points_count)::int, 0),
            'late_days', COUNT(*) FILTER (WHERE status = 'completed' AND attendance_status = 'late'),
            'early_departure_days', COUNT(*) FILTER (WHERE status = 'completed' AND attendance_status = 'early_departure'),
            'ontime_days', COUNT(*) FILTER (WHERE status = 'completed' AND attendance_status = 'ontime'),
            'absent_days', COUNT(*) FILTER (WHERE status = 'completed' AND attendance_status = 'absent')
        ) FROM session_data)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_employee_workday_history TO authenticated;
