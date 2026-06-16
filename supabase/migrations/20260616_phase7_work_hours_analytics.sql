-- ===============================================================
-- Phase 7: Work Hours Analytics Layer
-- Expands get_employee_workday_history to V2 with net_minutes,
-- order/sales/collection/new_customer data per session + rich summary
-- ===============================================================

-- 1. get_employee_workday_history V2 (check_capability governance)
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
    v_sessions_json jsonb;
    v_summary_json jsonb;
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
        WHERE wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to
    )
    SELECT
        COALESCE(jsonb_agg(jsonb_build_object(
            'id', sd.id, 'date', sd.date, 'start_time', sd.start_time, 'end_time', sd.end_time,
            'status', sd.status,
            'duration_minutes', sd.duration_minutes::int,
            'break_minutes', sd.break_minutes::int,
            'net_minutes', GREATEST(sd.duration_minutes - sd.break_minutes, 0)::int,
            'break_count', sd.break_count,
            'visit_count', sd.visit_count,
            'order_count', sd.order_count,
            'sales_value', sd.sales_value,
            'collection_count', sd.collection_count,
            'collection_amount', sd.collection_amount,
            'new_customer_count', sd.new_customer_count,
            'distance_meters', sd.distance_meters::int,
            'attendance_status', sd.attendance_status,
            'late_minutes', sd.late_minutes,
            'early_departure_minutes', sd.early_departure_minutes
        ) ORDER BY sd.date DESC), '[]'::jsonb) INTO v_sessions_json
    FROM session_data sd WHERE sd.status = 'completed';

    SELECT jsonb_build_object(
        'total_days', (SELECT COUNT(*) FROM session_data WHERE status = 'completed'),
        'total_duration_minutes', COALESCE((SELECT SUM(duration_minutes)::int FROM session_data WHERE status = 'completed'), 0),
        'total_break_minutes', COALESCE((SELECT SUM(break_minutes)::int FROM session_data WHERE status = 'completed'), 0),
        'total_net_minutes', COALESCE((SELECT SUM(GREATEST(duration_minutes - break_minutes, 0))::int FROM session_data WHERE status = 'completed'), 0),
        'avg_net_minutes', COALESCE((SELECT AVG(GREATEST(duration_minutes - break_minutes, 0))::int FROM session_data WHERE status = 'completed'), 0),
        'max_net_day', COALESCE((SELECT MAX(GREATEST(duration_minutes - break_minutes, 0))::int FROM session_data WHERE status = 'completed'), 0),
        'min_net_day', COALESCE((SELECT MIN(GREATEST(duration_minutes - break_minutes, 0))::int FROM session_data WHERE status = 'completed'), 0),
        'total_sales_value', COALESCE((SELECT SUM(sales_value)::int FROM session_data WHERE status = 'completed'), 0),
        'total_orders', COALESCE((SELECT SUM(order_count)::int FROM session_data WHERE status = 'completed'), 0),
        'total_visits', COALESCE((SELECT SUM(visit_count)::int FROM session_data WHERE status = 'completed'), 0),
        'total_collections', COALESCE((SELECT SUM(collection_count)::int FROM session_data WHERE status = 'completed'), 0),
        'total_collections_amount', COALESCE((SELECT SUM(collection_amount)::int FROM session_data WHERE status = 'completed'), 0),
        'total_new_customers', COALESCE((SELECT SUM(new_customer_count)::int FROM session_data WHERE status = 'completed'), 0),
        'late_days', (SELECT COUNT(*) FROM session_data WHERE status = 'completed' AND attendance_status = 'late'),
        'early_departure_days', (SELECT COUNT(*) FROM session_data WHERE status = 'completed' AND attendance_status = 'early_departure'),
        'ontime_days', (SELECT COUNT(*) FROM session_data WHERE status = 'completed' AND attendance_status = 'ontime')
    ) INTO v_summary_json;

    RETURN jsonb_build_object('sessions', v_sessions_json, 'summary', v_summary_json);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_employee_workday_history TO anon;

-- 2. get_my_workday_status — already V3 in 20260612, verify expansion
--    Already includes today_orders, today_sales, today_collections,
--    today_new_customers. No change needed.
