-- ================================================================
-- Add visit_gps fallback tier to get_coverage_map
--
-- New 5-tier priority:
--   1. gps (unified_locations) — permanent customer location
--   2. visit_gps (latest completed visit check-out GPS) — NEW
--   3. address_geocoded (customer_addresses coordinates)
--   4. city_center (reference_cities)
--   5. governorate_center (reference_governorates)
--
-- Rules:
--   - Tier 1 (customers.location_id) is NEVER overwritten
--   - Visit GPS is a fallback ONLY when Tier 1 has no usable coords
--   - No existing business data is modified
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
    active_sessions AS (
        SELECT wds.id, wds.employee_id, wds.start_time, wds.last_seen_at,
            e.full_name AS employee_name,
            e.code AS employee_code, e.id AS eid,
            COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = e.id LIMIT 1), '') AS role_name
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
        AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
    ),
    session_activity AS (
        SELECT ws.employee_id, ws.last_seen_at AS activity_at, 'heartbeat'::text AS activity_type
        FROM active_sessions ws WHERE ws.last_seen_at IS NOT NULL
    ),
    tracking_activity AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.recorded_at AS activity_at, 'gps'::text AS activity_type
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    visit_activity AS (
        SELECT v.employee_id, MAX(v.check_in_at) AS activity_at, 'visit'::text AS activity_type
        FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE GROUP BY v.employee_id
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
    last_location AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.latitude, tp.longitude,
            tp.recorded_at AS last_location_at, tp.accuracy_meters
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE
          AND tp.latitude IS NOT NULL AND tp.longitude IS NOT NULL
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id FROM public.workday_breaks wb WHERE wb.break_end IS NULL
    ),
    -- ============================================================
    -- CUSTOMER LOCATIONS — 5-tier priority
    --   1. gps:      unified_locations (permanent customer location)
    --   2. visit_gps: latest completed visit check-out GPS (fallback)
    --   3. address:  geocoded coords from customer_addresses
    --   4. city:     reference_cities center
    --   5. gov:      reference_governorates center
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
            COALESCE(ul.latitude, v.latest_lat, caddr.latitude, ct.latitude, gov.latitude) AS latitude,
            COALESCE(ul.longitude, v.latest_lng, caddr.longitude, ct.longitude, gov.longitude) AS longitude,
            CASE
                WHEN ul.latitude IS NOT NULL THEN 'gps'
                WHEN v.latest_lat IS NOT NULL THEN 'visit_gps'
                WHEN caddr.latitude IS NOT NULL THEN 'address_geocoded'
                WHEN ct.latitude IS NOT NULL THEN 'city_center'
                WHEN gov.latitude IS NOT NULL THEN 'governorate_center'
                ELSE 'unknown'
            END AS location_source,
            CASE
                WHEN ul.latitude IS NOT NULL THEN 'GPS'
                WHEN v.latest_lat IS NOT NULL THEN 'VISIT_GPS'
                WHEN caddr.latitude IS NOT NULL AND caddr.location_accuracy IS NOT NULL THEN caddr.location_accuracy::text
                WHEN caddr.latitude IS NOT NULL THEN 'GEOCODED'
                WHEN ct.latitude IS NOT NULL THEN 'CITY_CENTER'
                WHEN gov.latitude IS NOT NULL THEN 'GOVERNORATE_CENTER'
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
    visited_customers_today AS (
        SELECT COUNT(DISTINCT v.customer_id)::int AS cnt FROM public.visits v
        WHERE v.check_in_at::date = CURRENT_DATE
    )
    SELECT jsonb_build_object(
        'summary', jsonb_build_object(
            'total_customers', (SELECT COUNT(*) FROM customer_locations),
            'active_employees', (SELECT COUNT(*) FROM active_sessions),
            'covered_governorates', (SELECT COUNT(DISTINCT COALESCE(gov.name_ar, ca_legacy2.governorate)) FROM customer_locations cl2
              LEFT JOIN reference_governorates gov ON gov.id = cl2.governorate_id
              LEFT JOIN LATERAL (SELECT governorate FROM public.customer_addresses WHERE customer_id = cl2.id AND is_default = true LIMIT 1) ca_legacy2 ON true
              WHERE cl2.governorate != ''),
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
            'employee_id', as2.employee_id,
            'name', as2.employee_name,
            'code', as2.employee_code,
            'role_name', as2.role_name,
            'status', CASE WHEN ab.employee_id IS NOT NULL THEN 'on_break'
                           WHEN EXISTS (SELECT 1 FROM public.visits v2 WHERE v2.employee_id = as2.employee_id AND v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL) THEN 'on_visit'
                           ELSE 'working' END,
            'connection_status', CASE WHEN la.last_activity_at IS NULL THEN 'no_data'
                 WHEN la.last_activity_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                 WHEN la.last_activity_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                 ELSE 'lost' END,
            'latitude', ll.latitude, 'longitude', ll.longitude,
            'accuracy_meters', ll.accuracy_meters,
            'last_seen_at', CASE
                WHEN la.last_activity_at IS NOT NULL AND ll.last_location_at IS NOT NULL
                    THEN GREATEST(la.last_activity_at, ll.last_location_at)
                WHEN la.last_activity_at IS NOT NULL THEN la.last_activity_at
                WHEN ll.last_location_at IS NOT NULL THEN ll.last_location_at
                ELSE NULL END,
            'last_activity_at', la.last_activity_at,
            'last_activity_type', la.last_activity_type,
            'last_location_at', ll.last_location_at,
            'duration_minutes', EXTRACT(EPOCH FROM (now() - as2.start_time)) / 60,
            'order_count', COALESCE(to2.order_count, 0),
            'sales_value', COALESCE(to2.sales_value, 0),
            'visit_count', COALESCE(tv.visit_count, 0),
            'new_customer_count', COALESCE(tc.new_customer_count, 0)
        )) FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN last_activity la ON la.employee_id = as2.employee_id
        LEFT JOIN last_location ll ON ll.employee_id = as2.employee_id
        LEFT JOIN today_orders to2 ON to2.employee_id = as2.employee_id
        LEFT JOIN today_visits tv ON tv.employee_id = as2.employee_id
        LEFT JOIN today_customers_count tc ON tc.employee_id = as2.employee_id), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$FUNC$;

GRANT EXECUTE ON FUNCTION public.get_coverage_map TO anon;
GRANT EXECUTE ON FUNCTION public.get_coverage_map TO authenticated;

COMMENT ON FUNCTION public.get_coverage_map IS
  'خريطة التغطية — 5 مستويات: GPS ← زيارة GPS ← ترميز جغرافي ← مركز مدينة ← مركز محافظة. حالة الاتصال تعتمد على last_activity_at.';
