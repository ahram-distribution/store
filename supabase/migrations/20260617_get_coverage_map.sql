CREATE OR REPLACE FUNCTION public.get_coverage_map(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $FUNC$
DECLARE
    v_session app.sessions;
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

    WITH today_orders AS (
        SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
            COUNT(*)::int AS order_count,
            COALESCE(SUM(o.total_amount), 0) AS sales_value
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(o.owner_id)
    ),
    today_visits AS (
        SELECT v.employee_id, COUNT(*)::int AS visit_count
        FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE GROUP BY v.employee_id
    ),
    today_customers_count AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            COUNT(*)::int AS new_customer_count
        FROM public.customers c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    active_sessions AS (
        SELECT wds.id, wds.employee_id, wds.start_time, e.full_name AS employee_name,
            e.code AS employee_code, e.id AS eid,
            COALESCE(r.name, '') AS role_name
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        LEFT JOIN public.roles r ON r.id = e.role_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
        AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
    ),
    last_points AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.latitude, tp.longitude, tp.recorded_at, tp.accuracy_meters
        FROM public.tracking_points tp WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id FROM public.workday_breaks wb WHERE wb.break_end IS NULL
    ),
    customer_locations AS (
        SELECT
            c.id, c.code, COALESCE(c.company_name, c.responsible_name, '') AS customer_name,
            c.responsible_name, c.owner_id,
            COALESCE(cc.phone, '') AS phone,
            COALESCE(ca.governorate, '') AS governorate,
            COALESCE(ca.city, '') AS city,
            COALESCE(ul.formatted_address, '') AS formatted_address,
            ul.latitude, ul.longitude,
            e.code AS owner_code, e.full_name AS owner_name,
            c.created_at,
            (SELECT COUNT(*)::int FROM public.orders o WHERE o.customer_id = c.id) AS total_orders,
            (SELECT COALESCE(SUM(o.total_amount), 0) FROM public.orders o WHERE o.customer_id = c.id) AS total_sales,
            (SELECT MAX(o.created_at) FROM public.orders o WHERE o.customer_id = c.id) AS last_order_at,
            (SELECT MAX(v.check_in_at) FROM public.visits v WHERE v.customer_id = c.id) AS last_visit_at
        FROM public.customers c
        LEFT JOIN public.unified_locations ul ON ul.id = c.location_id
        LEFT JOIN LATERAL (
            SELECT phone FROM public.customer_contacts
            WHERE customer_id = c.id AND is_primary = true LIMIT 1
        ) cc ON true
        LEFT JOIN LATERAL (
            SELECT governorate, city FROM public.customer_addresses
            WHERE customer_id = c.id AND is_default = true LIMIT 1
        ) ca ON true
        LEFT JOIN public.employees e ON e.id = c.owner_id
        WHERE ul.latitude IS NOT NULL AND ul.longitude IS NOT NULL
        AND (v_subtree_ids IS NULL OR c.owner_id = ANY(v_subtree_ids) OR c.owner_id IS NULL)
    ),
    visited_customers_today AS (
        SELECT COUNT(DISTINCT v.customer_id)::int AS cnt FROM public.visits v
        WHERE v.check_in_at::date = CURRENT_DATE
    )
    SELECT jsonb_build_object(
        'summary', jsonb_build_object(
            'total_customers', (SELECT COUNT(*) FROM customer_locations),
            'active_employees', (SELECT COUNT(*) FROM active_sessions),
            'covered_governorates', (SELECT COUNT(DISTINCT ca.governorate) FROM public.customer_addresses ca WHERE ca.governorate IS NOT NULL AND ca.governorate != ''),
            'visited_customers_today', COALESCE((SELECT cnt FROM visited_customers_today), 0),
            'today_orders', COALESCE((SELECT SUM(order_count) FROM today_orders), 0),
            'today_sales', COALESCE((SELECT SUM(sales_value) FROM today_orders), 0)
        ),
        'customers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', cl.id, 'code', cl.code, 'name', cl.customer_name,
            'responsible_name', cl.responsible_name, 'phone', cl.phone,
            'governorate', cl.governorate, 'city', cl.city,
            'formatted_address', cl.formatted_address,
            'latitude', cl.latitude, 'longitude', cl.longitude,
            'owner_code', cl.owner_code, 'owner_name', cl.owner_name,
            'created_at', cl.created_at,
            'total_orders', cl.total_orders, 'total_sales', cl.total_sales,
            'last_order_at', cl.last_order_at, 'last_visit_at', cl.last_visit_at
        )) FROM customer_locations cl), '[]'::jsonb),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', as2.employee_id,
            'name', as2.employee_name,
            'code', as2.employee_code,
            'role_name', as2.role_name,
            'status', CASE WHEN ab.employee_id IS NOT NULL THEN 'on_break'
                           WHEN EXISTS (SELECT 1 FROM public.visits v2 WHERE v2.employee_id = as2.employee_id AND v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL) THEN 'on_visit'
                           ELSE 'working' END,
            'connection_status', CASE WHEN lp.recorded_at IS NULL THEN 'no_data'
                 WHEN lp.recorded_at > now() - interval '5 minutes' THEN 'connected'
                 WHEN lp.recorded_at > now() - interval '30 minutes' THEN 'delayed'
                 ELSE 'lost' END,
            'latitude', lp.latitude, 'longitude', lp.longitude,
            'last_seen_at', lp.recorded_at, 'accuracy_meters', lp.accuracy_meters,
            'duration_minutes', EXTRACT(EPOCH FROM (now() - as2.start_time)) / 60,
            'order_count', COALESCE(to2.order_count, 0),
            'sales_value', COALESCE(to2.sales_value, 0),
            'visit_count', COALESCE(tv.visit_count, 0),
            'new_customer_count', COALESCE(tc.new_customer_count, 0)
        )) FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
        LEFT JOIN today_orders to2 ON to2.employee_id = as2.employee_id
        LEFT JOIN today_visits tv ON tv.employee_id = as2.employee_id
        LEFT JOIN today_customers_count tc ON tc.employee_id = as2.employee_id
        ORDER BY as2.employee_name), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$FUNC$;

GRANT EXECUTE ON FUNCTION public.get_coverage_map TO anon;
GRANT EXECUTE ON FUNCTION public.get_coverage_map TO authenticated;
