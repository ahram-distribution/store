-- ================================================================
-- FIX: Business Activity مستقل عن Workday Sessions
-- 
-- المشكلة:
--   get_completed_workdays_history يبدأ من workday_sessions
--   → الموظفون بدون جلسات يُستبعدون بالكامل
--   → حتى لو لديهم طلبات/مبيعات/عملاء
-- 
-- get_employee_workday_history نفس المشكلة
--
-- الحل:
--   business data يُجلب من الجداول الخام مباشرة
--   attendance data يبقى من workday_sessions
--   ثم merge في paginated_employees
-- ================================================================

-- ================================================================
-- 1. get_completed_workdays_history
-- ================================================================

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
        SELECT e.id, e.full_name, e.code, e.identity_id, rpl.name AS role_name
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
    -- Session KPIs — ATTENDANCE ONLY (بدون Business Data)
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
            ewp.schedule_type,
            COALESCE(tp.tracking_points_count, 0) AS tracking_points_count
        FROM public.workday_sessions wds
        JOIN visible_employees ve ON ve.id = wds.employee_id
        LEFT JOIN public.employee_work_policies ewp ON ewp.employee_id = wds.employee_id
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
          AND wds.status = 'completed'
    ),
    -- Attendance totals per employee (من session_kpis فقط)
    emp_aggregates AS (
        SELECT
            sk.employee_id,
            COUNT(*)::int AS total_days,
            COALESCE(SUM(
                GREATEST(COALESCE(sk.duration_minutes, 0) -
                    CASE WHEN COALESCE(sk.schedule_type, 'flexible') = 'fixed_shift'
                        THEN COALESCE(sk.break_minutes, 0)
                        ELSE 0
                    END, 0)
            )::int, 0) AS total_net_minutes,
            COALESCE(AVG(
                GREATEST(COALESCE(sk.duration_minutes, 0) -
                    CASE WHEN COALESCE(sk.schedule_type, 'flexible') = 'fixed_shift'
                        THEN COALESCE(sk.break_minutes, 0)
                        ELSE 0
                    END, 0)
            )::int, 0) AS avg_net_minutes,
            COALESCE(SUM(sk.total_distance_meters)::int, 0) AS total_distance_meters,
            COALESCE(SUM(sk.tracking_points_count)::int, 0) AS total_tracking_points,
            COALESCE(SUM(sk.visit_count)::int, 0) AS total_visits_att,
            COUNT(*) FILTER (WHERE sk.attendance_status = 'late')::int AS late_count,
            COUNT(*) FILTER (WHERE sk.attendance_status = 'ontime')::int AS ontime_count,
            COUNT(*) FILTER (WHERE sk.attendance_status = 'early_departure')::int AS early_departure_count
        FROM session_kpis sk
        GROUP BY sk.employee_id
    ),
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
    -- Business Activity — من الجداول الخام، مستقل تمامًا عن Sessions
    -- يستخدم resolve_employee_id (مثل get_employee_day_timeline) للتعامل مع owner_id سواء كان employee_id أو identity_id
    biz_data AS (
        SELECT
            ve.id AS employee_id,
            COALESCE(bo.order_count, 0)::int AS total_orders,
            COALESCE(bo.sales_value, 0)::numeric AS total_sales_value,
            COALESCE(bv.visit_count, 0)::int AS total_visits,
            COALESCE(bc.customer_count, 0)::int AS total_new_customers,
            COALESCE(bco.collection_count, 0)::int AS total_collection_count,
            COALESCE(bco.collection_amount, 0)::numeric AS total_collection_amount
        FROM visible_employees ve
        LEFT JOIN (
            SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
                COUNT(*)::int AS order_count,
                SUM(o.total_amount)::numeric AS sales_value
            FROM public.orders o
            WHERE o.status NOT IN ('draft', 'cancelled')
              AND o.submitted_at::date >= p_from AND o.submitted_at::date <= p_to
            GROUP BY public.resolve_employee_id(o.owner_id)
        ) bo ON bo.employee_id = ve.id
        LEFT JOIN (
            SELECT v.employee_id,
                COUNT(*)::int AS visit_count
            FROM public.visits v
            WHERE v.check_in_at::date >= p_from AND v.check_in_at::date <= p_to
            GROUP BY v.employee_id
        ) bv ON bv.employee_id = ve.id
        LEFT JOIN (
            SELECT public.resolve_employee_id(c2.owner_id) AS employee_id,
                COUNT(*)::int AS customer_count
            FROM public.customers c2
            WHERE c2.created_at::date >= p_from AND c2.created_at::date <= p_to
            GROUP BY public.resolve_employee_id(c2.owner_id)
        ) bc ON bc.employee_id = ve.id
        LEFT JOIN (
            SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
                COUNT(*)::int AS collection_count,
                COALESCE(SUM(CASE WHEN c.status = 'collected' THEN c.amount ELSE 0 END), 0)::numeric AS collection_amount
            FROM public.collections c
            WHERE c.created_at::date >= p_from AND c.created_at::date <= p_to
            GROUP BY public.resolve_employee_id(c.owner_id)
        ) bco ON bco.employee_id = ve.id
    ),
    -- Merge Attendance + Business لكل الموظفين
    emp_extended AS (
        SELECT
            ve.id,
            ve.full_name,
            ve.code,
            ve.role_name,
            COALESCE(ea.total_days, 0)::int AS total_days,
            COALESCE(ea.total_net_minutes, 0)::int AS total_net_minutes,
            COALESCE(ea.avg_net_minutes, 0)::int AS avg_net_minutes,
            COALESCE(ea.total_distance_meters, 0)::int AS total_distance_meters,
            COALESCE(ea.total_tracking_points, 0)::int AS total_tracking_points,
            COALESCE(ea.late_count, 0)::int AS late_count,
            COALESCE(ea.ontime_count, 0)::int AS ontime_count,
            COALESCE(ea.early_departure_count, 0)::int AS early_departure_count,
            ba.total_orders,
            ba.total_sales_value,
            ba.total_visits,
            ba.total_new_customers,
            ba.total_collection_count,
            ba.total_collection_amount
        FROM visible_employees ve
        LEFT JOIN emp_aggregates ea ON ea.employee_id = ve.id
        JOIN biz_data ba ON ba.employee_id = ve.id
    ),
    paginated_employees AS (
        SELECT
            ee.id,
            ee.full_name,
            ee.code,
            ee.role_name,
            ee.total_days,
            ee.total_net_minutes,
            ee.avg_net_minutes,
            ee.total_orders,
            ee.total_sales_value,
            ee.total_collection_count,
            ee.total_collection_amount,
            ee.total_new_customers,
            ee.total_visits,
            ee.total_distance_meters,
            ee.total_tracking_points,
            ee.late_count,
            ee.ontime_count,
            ee.early_departure_count,
            CASE WHEN pt.sales_target > 0 THEN ROUND(pt.sales_target::numeric, 2) ELSE NULL END AS sales_target,
            CASE WHEN pt.visits_target > 0 THEN ROUND(pt.visits_target::numeric, 2) ELSE NULL END AS visits_target,
            CASE WHEN pt.orders_target > 0 THEN ROUND(pt.orders_target::numeric, 2) ELSE NULL END AS orders_target,
            CASE WHEN pt.collections_target > 0 THEN ROUND(pt.collections_target::numeric, 2) ELSE NULL END AS collections_target,
            CASE WHEN pt.new_customers_target > 0 THEN ROUND(pt.new_customers_target::numeric, 2) ELSE NULL END AS new_customers_target,
            CASE WHEN COALESCE(pt.sales_target, 0) > 0 THEN ROUND((ee.total_sales_value / pt.sales_target * 100)::numeric, 1) ELSE NULL END AS sales_achievement_pct,
            CASE WHEN COALESCE(pt.visits_target, 0) > 0 THEN ROUND((ee.total_visits::numeric / pt.visits_target * 100)::numeric, 1) ELSE NULL END AS visits_achievement_pct,
            CASE WHEN COALESCE(pt.orders_target, 0) > 0 THEN ROUND((ee.total_orders::numeric / pt.orders_target * 100)::numeric, 1) ELSE NULL END AS orders_achievement_pct,
            CASE WHEN COALESCE(pt.collections_target, 0) > 0 THEN ROUND((ee.total_collection_amount / pt.collections_target * 100)::numeric, 1) ELSE NULL END AS collections_achievement_pct,
            CASE WHEN COALESCE(pt.new_customers_target, 0) > 0 THEN ROUND((ee.total_new_customers::numeric / pt.new_customers_target * 100)::numeric, 1) ELSE NULL END AS new_customers_achievement_pct,
            ROW_NUMBER() OVER (
                ORDER BY
                    CASE WHEN p_sort_by = 'total_net_minutes' AND p_sort_order = 'desc' THEN ee.total_net_minutes END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_net_minutes' AND p_sort_order = 'asc' THEN ee.total_net_minutes END ASC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_sales_value' AND p_sort_order = 'desc' THEN ee.total_sales_value END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_sales_value' AND p_sort_order = 'asc' THEN ee.total_sales_value END ASC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_orders' AND p_sort_order = 'desc' THEN ee.total_orders END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_orders' AND p_sort_order = 'asc' THEN ee.total_orders END ASC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_visits' AND p_sort_order = 'desc' THEN ee.total_visits END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_visits' AND p_sort_order = 'asc' THEN ee.total_visits END ASC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_collection_amount' AND p_sort_order = 'desc' THEN ee.total_collection_amount END DESC NULLS LAST,
                    CASE WHEN p_sort_by = 'total_collection_amount' AND p_sort_order = 'asc' THEN ee.total_collection_amount END ASC NULLS LAST,
                    ee.total_net_minutes DESC NULLS LAST
            ) AS sort_rank
        FROM emp_extended ee
        LEFT JOIN prorated_targets pt ON pt.employee_id = ee.id
    ),
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
            pe.new_customers_achievement_pct,
            pe.sort_rank
        FROM paginated_employees pe
        ORDER BY pe.sort_rank
        LIMIT p_per_page OFFSET v_offset
    ),
    paginated_sessions AS (
        SELECT
            sk.employee_id,
            sk.date, sk.start_time, sk.end_time,
            GREATEST(COALESCE(sk.duration_minutes, 0) -
                CASE WHEN COALESCE(sk.schedule_type, 'flexible') = 'fixed_shift'
                    THEN COALESCE(sk.break_minutes, 0)
                    ELSE 0
                END, 0)::int AS net_minutes,
            sk.break_minutes::int,
            sk.break_count,
            GREATEST(sk.visit_count, COALESCE(vis.visit_count, 0)) AS visit_count,
            COALESCE(ord.order_count, 0)::int AS order_count,
            COALESCE(ord.sales_value, 0)::numeric AS sales_value,
            COALESCE(col.collection_count, 0)::int AS collection_count,
            COALESCE(col.collection_amount, 0)::numeric AS collection_amount,
            COALESCE(cst.customer_count, 0)::int AS new_customer_count,
            sk.attendance_status,
            sk.late_minutes,
            sk.early_departure_minutes,
            COALESCE(sk.total_distance_meters, 0)::int AS distance_meters,
            sk.tracking_points_count
        FROM session_kpis sk
        LEFT JOIN (
            SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
                o.submitted_at::date AS d,
                COUNT(*)::int AS order_count,
                SUM(o.total_amount)::numeric AS sales_value
            FROM public.orders o
            WHERE o.status NOT IN ('draft', 'cancelled')
              AND o.submitted_at::date >= p_from AND o.submitted_at::date <= p_to
            GROUP BY public.resolve_employee_id(o.owner_id), o.submitted_at::date
        ) ord ON ord.employee_id = sk.employee_id AND ord.d = sk.date
        LEFT JOIN (
            SELECT v.employee_id,
                v.check_in_at::date AS d,
                COUNT(*)::int AS visit_count
            FROM public.visits v
            WHERE v.check_in_at::date >= p_from AND v.check_in_at::date <= p_to
            GROUP BY v.employee_id, v.check_in_at::date
        ) vis ON vis.employee_id = sk.employee_id AND vis.d = sk.date
        LEFT JOIN (
            SELECT public.resolve_employee_id(c2.owner_id) AS employee_id,
                c2.created_at::date AS d,
                COUNT(*)::int AS customer_count
            FROM public.customers c2
            WHERE c2.created_at::date >= p_from AND c2.created_at::date <= p_to
            GROUP BY public.resolve_employee_id(c2.owner_id), c2.created_at::date
        ) cst ON cst.employee_id = sk.employee_id AND cst.d = sk.date
        LEFT JOIN (
            SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
                c.created_at::date AS d,
                COUNT(*)::int AS collection_count,
                COALESCE(SUM(c.amount), 0)::numeric AS collection_amount
            FROM public.collections c
            WHERE c.created_at::date >= p_from AND c.created_at::date <= p_to
            GROUP BY public.resolve_employee_id(c.owner_id), c.created_at::date
        ) col ON col.employee_id = sk.employee_id AND col.d = sk.date
        WHERE sk.employee_id = ANY(SELECT pei.id FROM paginated_employee_ids pei)
    ),
    grand_totals AS (
        SELECT
            (SELECT COALESCE(SUM(ee.total_days)::int, 0) FROM emp_extended ee) AS total_days,
            (SELECT COALESCE(SUM(ee.total_net_minutes)::int, 0) FROM emp_extended ee) AS total_net_minutes,
            (SELECT COALESCE(SUM(ee.total_orders)::int, 0) FROM emp_extended ee) AS total_orders,
            (SELECT COALESCE(SUM(ee.total_sales_value)::numeric, 0) FROM emp_extended ee) AS total_sales,
            (SELECT COALESCE(SUM(ee.total_collection_count)::int, 0) FROM emp_extended ee) AS total_collections,
            (SELECT COALESCE(SUM(ee.total_collection_amount)::numeric, 0) FROM emp_extended ee) AS total_collection_amount,
            (SELECT COALESCE(SUM(ee.total_new_customers)::int, 0) FROM emp_extended ee) AS total_new_customers,
            (SELECT COALESCE(SUM(ee.total_visits)::int, 0) FROM emp_extended ee) AS total_visits
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
                    'early_departure_count', pei.early_departure_count
                ),
                'targets', jsonb_build_object(
                    'sales_target', pei.sales_target,
                    'visits_target', pei.visits_target,
                    'orders_target', pei.orders_target,
                    'collections_target', pei.collections_target,
                    'new_customers_target', pei.new_customers_target
                ),
                'achievement', jsonb_build_object(
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
                    WHERE ps.employee_id = pei.id
                ), '[]'::jsonb)
            ) ORDER BY pei.sort_rank)
            FROM paginated_employee_ids pei
        ), '[]'::jsonb),
        'totals', (SELECT row_to_json(gt.*)::jsonb FROM grand_totals gt),
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

GRANT EXECUTE ON FUNCTION public.get_completed_workdays_history TO authenticated;

-- ================================================================
-- 2. get_employee_workday_history — تفاصيل الجلسات لفرد واحد
--    Business Activity من الجداول الخام، مستقل عن Sessions
-- ================================================================

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
    v_result jsonb;
    v_policy record;
    v_use_net_calc boolean := true;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      IF NOT (p_employee_id = ANY(public.get_visible_employee_ids(p_token))) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;

    SELECT * INTO v_policy FROM public.employee_work_policies WHERE employee_id = p_employee_id;
    v_use_net_calc := COALESCE((v_policy.schedule_type = 'fixed_shift'), false);

    WITH
    -- Attendance sessions (من workday_sessions)
    session_data AS (
        SELECT
            wds.id, wds.date, wds.start_time, wds.end_time, wds.status,
            EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60 AS duration_minutes,
            COALESCE(wb.break_seconds, 0) / 60 AS break_minutes,
            COALESCE(wb.break_count, 0) AS break_count,
            wds.visit_count,
            wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
            COALESCE(wds.total_distance_meters, 0) AS distance_meters
        FROM public.workday_sessions wds
        LEFT JOIN (
            SELECT session_id,
                COUNT(*) AS break_count,
                COALESCE(SUM(duration_seconds), 0) AS break_seconds
            FROM public.workday_breaks GROUP BY session_id
        ) wb ON wb.session_id = wds.id
        WHERE wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to
    ),
    -- Business activity per day (مستقل عن Sessions)
    daily_business AS (
        SELECT
            o.submitted_at::date AS d,
            COUNT(*)::int AS order_count,
            COALESCE(SUM(o.total_amount), 0)::numeric AS sales_value
        FROM public.orders o
        WHERE public.resolve_employee_id(o.owner_id) = p_employee_id
          AND o.submitted_at::date >= p_from AND o.submitted_at::date <= p_to
          AND o.status NOT IN ('draft', 'cancelled')
        GROUP BY o.submitted_at::date
    ),
    daily_visits AS (
        SELECT
            v.check_in_at::date AS d,
            COUNT(*)::int AS visit_count
        FROM public.visits v
        WHERE v.employee_id = p_employee_id
          AND v.check_in_at::date >= p_from AND v.check_in_at::date <= p_to
        GROUP BY v.check_in_at::date
    ),
    daily_customers AS (
        SELECT
            c2.created_at::date AS d,
            COUNT(*)::int AS new_customer_count
        FROM public.customers c2
        WHERE public.resolve_employee_id(c2.owner_id) = p_employee_id
          AND c2.created_at::date >= p_from AND c2.created_at::date <= p_to
        GROUP BY c2.created_at::date
    ),
    daily_collections AS (
        SELECT
            c.created_at::date AS d,
            COUNT(*)::int AS collection_count,
            COALESCE(SUM(c.amount), 0)::numeric AS collection_amount
        FROM public.collections c
        WHERE public.resolve_employee_id(c.owner_id) = p_employee_id
          AND c.created_at::date >= p_from AND c.created_at::date <= p_to
        GROUP BY c.created_at::date
    ),
    -- Merge sessions with business data
    merged_days AS (
        SELECT
            sd.id, sd.date, sd.start_time, sd.end_time, sd.status,
            sd.duration_minutes, sd.break_minutes, sd.break_count,
            sd.visit_count, sd.attendance_status, sd.late_minutes,
            sd.early_departure_minutes, sd.distance_meters,
            COALESCE(db.order_count, 0) AS order_count,
            COALESCE(db.sales_value, 0) AS sales_value,
            COALESCE(dv.visit_count, 0) AS biz_visits,
            COALESCE(dc.new_customer_count, 0) AS new_customer_count,
            COALESCE(dcol.collection_count, 0) AS collection_count,
            COALESCE(dcol.collection_amount, 0) AS collection_amount,
            true AS has_session
        FROM session_data sd
        LEFT JOIN daily_business db ON db.d = sd.date
        LEFT JOIN daily_visits dv ON dv.d = sd.date
        LEFT JOIN daily_customers dc ON dc.d = sd.date
        LEFT JOIN daily_collections dcol ON dcol.d = sd.date
    )
    SELECT jsonb_build_object(
        'sessions', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                'id', md.id, 'date', md.date, 'start_time', md.start_time, 'end_time', md.end_time,
                'status', md.status,
                'duration_minutes', GREATEST(COALESCE(md.duration_minutes, 0), 0)::int,
                'break_minutes', md.break_minutes::int,
                'net_minutes', CASE WHEN v_use_net_calc
                    THEN GREATEST(COALESCE(md.duration_minutes, 0) - COALESCE(md.break_minutes, 0), 0)::int
                    ELSE GREATEST(COALESCE(md.duration_minutes, 0), 0)::int
                END,
                'break_count', md.break_count,
                'visit_count', GREATEST(md.visit_count, md.biz_visits),
                'order_count', md.order_count,
                'sales_value', md.sales_value,
                'collection_count', md.collection_count,
                'collection_amount', md.collection_amount,
                'new_customer_count', md.new_customer_count,
                'distance_meters', md.distance_meters::int,
                'attendance_status', md.attendance_status,
                'late_minutes', md.late_minutes,
                'early_departure_minutes', md.early_departure_minutes
            ) ORDER BY md.date DESC, md.start_time ASC)
            FROM merged_days md),
        '[]'::jsonb),
        'summary', (SELECT jsonb_build_object(
            'total_days', COUNT(DISTINCT date),
            'total_duration_minutes', COALESCE(SUM(duration_minutes)::int, 0),
            'total_break_minutes', COALESCE(SUM(break_minutes)::int, 0),
            'total_net_minutes', COALESCE(SUM(CASE WHEN v_use_net_calc
                THEN GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0)
                ELSE GREATEST(COALESCE(duration_minutes, 0), 0) END)::int, 0),
            'avg_net_minutes', COALESCE(AVG(CASE WHEN v_use_net_calc
                THEN GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0)
                ELSE GREATEST(COALESCE(duration_minutes, 0), 0) END)::int, 0),
            'max_net_day', COALESCE(MAX(CASE WHEN v_use_net_calc
                THEN GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0)
                ELSE GREATEST(COALESCE(duration_minutes, 0), 0) END)::int, 0),
            'min_net_day', COALESCE(MIN(CASE WHEN v_use_net_calc
                THEN GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0)
                ELSE GREATEST(COALESCE(duration_minutes, 0), 0) END)::int, 0),
            'total_sales_value', COALESCE(SUM(sales_value)::int, 0),
            'total_orders', COALESCE(SUM(order_count)::int, 0),
            'total_visits', COALESCE(SUM(GREATEST(visit_count, biz_visits))::int, 0),
            'total_collections', COALESCE(SUM(collection_count)::int, 0),
            'total_collections_amount', COALESCE(SUM(collection_amount)::int, 0),
            'total_new_customers', COALESCE(SUM(new_customer_count)::int, 0),
            'late_days', COUNT(*) FILTER (WHERE attendance_status = 'late'),
            'early_departure_days', COUNT(*) FILTER (WHERE attendance_status = 'early_departure'),
            'ontime_days', COUNT(*) FILTER (WHERE attendance_status = 'ontime')
        ) FROM merged_days)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_employee_workday_history TO authenticated;

COMMENT ON FUNCTION public.get_completed_workdays_history IS 'تقارير المدير — حضور + نشاط تجاري (مستقل) + أهداف';
COMMENT ON FUNCTION public.get_employee_workday_history IS 'تفاصيل جلسات مندوب — حضور + نشاط تجاري (مستقل)';
