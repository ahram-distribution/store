-- ================================================================
-- Coverage Map: Full Representatives Visibility + All Location Sources
--
-- Root cause: active_sessions CTE limited to wds.status='active'
-- today (3 employees). Changed to ALL active employees (26).
--
-- Changes to get_coverage_map:
--   1. active_employees CTE — replaces active_sessions, returns
--      ALL employees where is_active=true, LEFT JOIN to sessions
--   2. representative_location — expanded to 4 sources with 30-day
--      lookback: tracking_runtime, visit_checkin, visit_checkout,
--      break_gps. Added location_source output.
--   3. employee_region — updated to join with active_employees
--   4. governorate_stats — updated for new CTE names
--   5. Employee JSON: added location_source, expanded status to
--      include 'offline', connection_status handles 'offline'
--   6. session_activity, tracking_activity, visit_activity —
--      date range expanded to 30 days for wider activity detection
--   7. active_breaks — updated for new CTE name
-- ================================================================

DROP FUNCTION IF EXISTS public.get_coverage_map(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.get_coverage_map(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $FUNC$
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
    -- ============================================================
    -- ACTIVE EMPLOYEES — ALL active employees, not just those with
    -- a session today. LEFT JOIN to sessions so we still get
    -- session info (start_time, status) when available.
    -- ============================================================
    active_employees AS (
        SELECT
            e.id AS employee_id,
            e.full_name AS employee_name,
            e.code AS employee_code,
            COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = e.id LIMIT 1), '') AS role_name,
            wds.id AS session_id,
            wds.start_time,
            wds.last_seen_at,
            wds.status AS session_status
        FROM public.employees e
        LEFT JOIN public.workday_sessions wds ON wds.employee_id = e.id AND wds.date = CURRENT_DATE
        WHERE e.is_active = true
          AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
    ),
    session_activity AS (
        SELECT ae.employee_id, ae.last_seen_at AS activity_at, 'heartbeat'::text AS activity_type
        FROM active_employees ae WHERE ae.session_id IS NOT NULL AND ae.last_seen_at IS NOT NULL
    ),
    tracking_activity AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.recorded_at AS activity_at, 'gps'::text AS activity_type
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    visit_activity AS (
        SELECT v.employee_id, MAX(v.check_in_at) AS activity_at, 'visit'::text AS activity_type
        FROM public.visits v WHERE v.check_in_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY v.employee_id
    ),
    order_activity AS (
        SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
            MAX(o.created_at) AS activity_at, 'order'::text AS activity_type
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(o.owner_id)
    ),
    collection_activity AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            MAX(c.created_at) AS activity_at, 'collection'::text AS activity_type
        FROM public.collections c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    combined_activity AS (
        SELECT employee_id, activity_at, activity_type FROM session_activity
        UNION ALL SELECT employee_id, activity_at, activity_type FROM tracking_activity
        UNION ALL SELECT employee_id, activity_at, activity_type FROM visit_activity
        UNION ALL SELECT employee_id, activity_at, activity_type FROM order_activity
        UNION ALL SELECT employee_id, activity_at, activity_type FROM collection_activity
    ),
    last_activity AS (
        SELECT DISTINCT ON (employee_id)
            employee_id, activity_at AS last_activity_at, activity_type AS last_activity_type
        FROM combined_activity ORDER BY employee_id, activity_at DESC NULLS LAST
    ),
    -- ============================================================
    -- REPRESENTATIVE LOCATION — 4 sources, 30-day lookback
    -- Priority (by newest timestamp):
    --   1. tracking_runtime (GPS pings)
    --   2. visit_checkin (visit check-in GPS)
    --   3. visit_checkout (visit check-out GPS)
    --   4. break_gps (break start GPS)
    -- ============================================================
    representative_location AS (
        SELECT DISTINCT ON (rl.employee_id)
            rl.employee_id, rl.latitude, rl.longitude, rl.accuracy_meters,
            rl.location_at, rl.source
        FROM (
            SELECT tp.employee_id, tp.latitude, tp.longitude, tp.accuracy_meters,
                   tp.recorded_at AS location_at, 'tracking_runtime'::text AS source
            FROM public.tracking_points tp
            WHERE tp.recorded_at >= CURRENT_DATE - INTERVAL '30 days'
              AND tp.latitude IS NOT NULL AND tp.longitude IS NOT NULL
            UNION ALL
            SELECT v.employee_id, v.check_in_latitude, v.check_in_longitude, NULL::numeric,
                   v.check_in_at, 'visit_checkin'::text
            FROM public.visits v
            WHERE v.check_in_at >= CURRENT_DATE - INTERVAL '30 days'
              AND v.check_in_latitude IS NOT NULL AND v.check_in_longitude IS NOT NULL
            UNION ALL
            SELECT v.employee_id, v.check_out_latitude, v.check_out_longitude, NULL::numeric,
                   v.check_out_at, 'visit_checkout'::text
            FROM public.visits v
            WHERE v.check_out_at >= CURRENT_DATE - INTERVAL '30 days'
              AND v.check_out_latitude IS NOT NULL AND v.check_out_longitude IS NOT NULL
            UNION ALL
            SELECT wb.employee_id, wb.latitude, wb.longitude, NULL::numeric,
                   wb.break_start, 'break_gps'::text
            FROM public.workday_breaks wb
            WHERE wb.break_start >= CURRENT_DATE - INTERVAL '30 days'
              AND wb.latitude IS NOT NULL AND wb.longitude IS NOT NULL
        ) rl
        ORDER BY rl.employee_id, rl.location_at DESC
    ),
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id FROM public.workday_breaks wb
        JOIN active_employees ae ON ae.session_id = wb.session_id
        WHERE wb.break_end IS NULL
    ),
    -- ============================================================
    -- CUSTOMER LOCATIONS — 3-tier priority (unchanged)
    -- ============================================================
    customer_locations AS (
        SELECT
            c.id, c.code,
            COALESCE(c.company_name, c.responsible_name, '') AS customer_name,
            c.responsible_name, c.owner_id,
            COALESCE(cc.phone, '') AS phone,
            COALESCE(gov.name_ar, ca_legacy.governorate, '') AS governorate,
            COALESCE(ct.name_ar, ca_legacy.city, '') AS city,
            caddr.street_address,
            caddr.landmark,
            caddr.governorate_id,
            caddr.city_id,
            COALESCE(ul.formatted_address, '') AS formatted_address,
            COALESCE(ul.latitude, v.latest_lat, caddr.latitude) AS latitude,
            COALESCE(ul.longitude, v.latest_lng, caddr.longitude) AS longitude,
            CASE
                WHEN ul.latitude IS NOT NULL THEN 'customer_location'
                WHEN v.latest_lat IS NOT NULL THEN 'visit_gps'
                WHEN caddr.latitude IS NOT NULL THEN 'address_geocoded'
                ELSE 'unknown'
            END AS location_source,
            CASE
                WHEN ul.latitude IS NOT NULL THEN 'CUSTOMER_LOCATION'
                WHEN v.latest_lat IS NOT NULL THEN 'VISIT_GPS'
                WHEN caddr.latitude IS NOT NULL AND caddr.location_accuracy IS NOT NULL THEN caddr.location_accuracy::text
                WHEN caddr.latitude IS NOT NULL THEN 'GEOCODED'
                ELSE 'UNKNOWN'
            END AS location_accuracy,
            e.code AS owner_code, e.full_name AS owner_name,
            c.created_at,
            (SELECT COUNT(*)::int FROM public.orders o WHERE o.customer_id = c.id) AS total_orders,
            (SELECT COALESCE(SUM(o.total_amount), 0) FROM public.orders o WHERE o.customer_id = c.id) AS total_sales,
            (SELECT MAX(o.created_at) FROM public.orders o WHERE o.customer_id = c.id) AS last_order_at,
            (SELECT MAX(v.check_in_at) FROM public.visits v WHERE v.customer_id = c.id) AS last_visit_at
        FROM public.customers c
        LEFT JOIN public.unified_locations ul ON ul.id = c.location_id
        LEFT JOIN LATERAL fn_customer_default_address(c.id) caddr ON true
        LEFT JOIN LATERAL (
            SELECT check_out_latitude AS latest_lat, check_out_longitude AS latest_lng
            FROM public.visits
            WHERE customer_id = c.id
              AND status = 'completed'
              AND check_out_latitude IS NOT NULL
              AND check_out_longitude IS NOT NULL
            ORDER BY check_out_at DESC
            LIMIT 1
        ) v ON true
        LEFT JOIN reference_governorates gov ON gov.id = caddr.governorate_id
        LEFT JOIN reference_cities ct ON ct.id = caddr.city_id
        LEFT JOIN LATERAL (
            SELECT governorate, city FROM public.customer_addresses
            WHERE customer_id = c.id AND is_default = true LIMIT 1
        ) ca_legacy ON true
        LEFT JOIN LATERAL (
            SELECT phone FROM public.customer_contacts
            WHERE customer_id = c.id AND is_primary = true LIMIT 1
        ) cc ON true
        LEFT JOIN public.employees e ON e.id = c.owner_id
        WHERE c.is_active = true
          AND (v_subtree_ids IS NULL OR c.owner_id = ANY(v_subtree_ids) OR c.owner_id IS NULL)
    ),
    -- ============================================================
    -- EMPLOYEE REGION — resolves governorate AND city from
    -- current location by matching nearest reference_city
    -- ============================================================
    employee_region AS (
        SELECT DISTINCT ON (rl.employee_id)
            rl.employee_id,
            COALESCE(g.name_ar, '') AS governorate,
            COALESCE(rc.name_ar, '') AS city
        FROM representative_location rl
        JOIN active_employees ae ON ae.employee_id = rl.employee_id
        CROSS JOIN public.reference_cities rc
        LEFT JOIN public.reference_governorates g ON g.id = rc.governorate_id
        WHERE rl.latitude IS NOT NULL AND rl.longitude IS NOT NULL
        ORDER BY rl.employee_id,
            (rl.latitude - rc.latitude)^2 + (rl.longitude - rc.longitude)^2
    ),
    -- ============================================================
    -- GOVERNORATE STATS — aggregates customers + employees together
    -- ============================================================
    governorate_stats AS (
        SELECT
            governorate,
            COUNT(*) FILTER (WHERE type = 'customer')::int AS customer_count,
            COUNT(*) FILTER (WHERE type = 'employee')::int AS employee_count
        FROM (
            SELECT governorate, 'customer' AS type
            FROM customer_locations
            WHERE COALESCE(governorate, '') != ''
            UNION ALL
            SELECT er.governorate, 'employee' AS type
            FROM employee_region er
            WHERE COALESCE(er.governorate, '') != ''
        ) combined
        GROUP BY governorate
        ORDER BY governorate
    ),
    visited_customers_today AS (
        SELECT COUNT(DISTINCT v.customer_id)::int AS cnt FROM public.visits v
        WHERE v.check_in_at::date = CURRENT_DATE
    )
    SELECT jsonb_build_object(
        'summary', jsonb_build_object(
            'total_customers', (SELECT COUNT(*) FROM customer_locations),
            'active_employees', (SELECT COUNT(*) FROM active_employees),
            'covered_governorates', (SELECT COUNT(DISTINCT governorate) FROM (
                SELECT governorate FROM customer_locations WHERE COALESCE(governorate, '') != ''
                UNION
                SELECT er2.governorate FROM employee_region er2 WHERE COALESCE(er2.governorate, '') != ''
            ) gov_union),
            'visited_customers_today', COALESCE((SELECT cnt FROM visited_customers_today), 0),
            'today_orders', COALESCE((SELECT SUM(order_count) FROM today_orders), 0),
            'today_sales', COALESCE((SELECT SUM(sales_value) FROM today_orders), 0)
        ),
        'customers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', cl.id, 'code', cl.code, 'name', cl.customer_name,
            'responsible_name', cl.responsible_name, 'phone', cl.phone,
            'governorate', cl.governorate, 'city', cl.city,
            'governorate_id', cl.governorate_id, 'city_id', cl.city_id,
            'street_address', cl.street_address, 'landmark', cl.landmark,
            'formatted_address', cl.formatted_address,
            'location_source', cl.location_source,
            'location_accuracy', cl.location_accuracy,
            'latitude', cl.latitude, 'longitude', cl.longitude,
            'owner_code', cl.owner_code, 'owner_name', cl.owner_name,
            'created_at', cl.created_at,
            'total_orders', cl.total_orders, 'total_sales', cl.total_sales,
            'last_order_at', cl.last_order_at, 'last_visit_at', cl.last_visit_at
        )) FROM customer_locations cl), '[]'::jsonb),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', ae.employee_id,
            'name', ae.employee_name,
            'code', ae.employee_code,
            'role_name', ae.role_name,
            'status', CASE WHEN ae.session_id IS NULL THEN 'offline'
                           WHEN ab.employee_id IS NOT NULL THEN 'on_break'
                           WHEN EXISTS (SELECT 1 FROM public.visits v2 WHERE v2.employee_id = ae.employee_id AND v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL) THEN 'on_visit'
                           ELSE 'working' END,
            'connection_status', CASE WHEN ae.session_id IS NULL THEN 'offline'
                                      WHEN la.last_activity_at IS NULL THEN 'no_data'
                 WHEN la.last_activity_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                 WHEN la.last_activity_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                 ELSE 'lost' END,
            'latitude', rl.latitude, 'longitude', rl.longitude,
            'accuracy_meters', rl.accuracy_meters,
            'location_source', rl.source,
            'governorate', COALESCE(er.governorate, ''),
            'city', COALESCE(er.city, ''),
            'last_seen_at', CASE
                WHEN ae.session_id IS NOT NULL AND la.last_activity_at IS NOT NULL AND rl.location_at IS NOT NULL
                    THEN GREATEST(la.last_activity_at, rl.location_at)
                WHEN la.last_activity_at IS NOT NULL THEN la.last_activity_at
                WHEN rl.location_at IS NOT NULL THEN rl.location_at
                ELSE NULL END,
            'last_activity_at', la.last_activity_at,
            'last_activity_type', la.last_activity_type,
            'last_location_at', rl.location_at,
            'duration_minutes', CASE WHEN ae.start_time IS NOT NULL THEN EXTRACT(EPOCH FROM (now() - ae.start_time)) / 60 ELSE 0 END,
            'order_count', COALESCE(to2.order_count, 0),
            'sales_value', COALESCE(to2.sales_value, 0),
            'visit_count', COALESCE(tv.visit_count, 0),
            'new_customer_count', COALESCE(tc.new_customer_count, 0)
        )) FROM active_employees ae
        LEFT JOIN active_breaks ab ON ab.session_id = ae.session_id
        LEFT JOIN last_activity la ON la.employee_id = ae.employee_id
        LEFT JOIN representative_location rl ON rl.employee_id = ae.employee_id
        LEFT JOIN employee_region er ON er.employee_id = ae.employee_id
        LEFT JOIN today_orders to2 ON to2.employee_id = ae.employee_id
        LEFT JOIN today_visits tv ON tv.employee_id = ae.employee_id
        LEFT JOIN today_customers_count tc ON tc.employee_id = ae.employee_id), '[]'::jsonb),
        'governorate_stats', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'governorate', gs.governorate,
            'customer_count', gs.customer_count,
            'employee_count', gs.employee_count
        ) ORDER BY gs.governorate) FROM governorate_stats gs), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$FUNC$;

GRANT EXECUTE ON FUNCTION public.get_coverage_map TO anon;
GRANT EXECUTE ON FUNCTION public.get_coverage_map TO authenticated;

COMMENT ON FUNCTION public.get_coverage_map IS
  'خريطة التغطية — كل العملاء (3 مستويات) + كل المندوبين النشطين (4 مصادر تتبع) + إحصائيات المحافظات';
