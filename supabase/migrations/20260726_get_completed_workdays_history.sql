-- ============================================================================
-- 20260726_get_completed_workdays_history
-- Historical performance for Operations Center "الأداء التاريخي" tab
-- Returns paginated employees with per-employee KPIs + session-level detail
-- Uses employee_id only (no name matching, no resolve_employee_id)
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_completed_workdays_history CASCADE;

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
    -- Step 1: Visible employees filtered by search (name/code only, no snapshot)
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

    -- Step 2: Total count before pagination
    total_count AS (
        SELECT COUNT(*)::int AS cnt FROM visible_employees
    ),

    -- Step 3: Sessions with all KPIs for all visible employees in date range
    session_kpis AS (
        SELECT
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
    ),

    -- Step 4: Per-employee aggregation
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

    -- Step 5: Monthly targets for the date range (prorated by overlapping days)
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

    -- Step 6: Paginated employees with KPIs sorted
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

    -- Step 7: Sessions for paginated employees only
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

    -- Step 8: Grand totals across ALL visible employees (not just paginated)
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

GRANT EXECUTE ON FUNCTION public.get_completed_workdays_history TO authenticated;
