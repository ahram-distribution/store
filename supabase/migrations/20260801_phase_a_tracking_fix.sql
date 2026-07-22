-- ================================================================
-- Phase A — Tracking Fix: connection_status depends on last_activity
-- (not tracking_points only)
--
-- Problem:
--   get_live_workday_overview + get_team_map calculated connection_status
--   solely from tracking_points.recorded_at. An employee with active
--   visits, orders, or collections but no recent GPS point appeared 🔴 lost.
--
-- Fix:
--   Introduce `last_activity` CTE that considers 5 sources:
--     1. workday_sessions.last_seen_at  (heartbeat)
--     2. tracking_points.recorded_at    (GPS)
--     3. visits.check_in_at             (business)
--     4. orders.created_at              (business)
--     5. collections.created_at         (business)
--
--   Introduce `last_location` CTE for actual GPS position (separate).
--
--   connection_status is now driven by last_activity_at.
--   GPS position (latitude/longitude) remains from tracking_points.
--   New output fields: last_activity_at, last_activity_type, last_location_at
-- ================================================================

-- ================================================================
-- 1. get_live_workday_overview — connection_status from last_activity
-- ================================================================

DROP FUNCTION IF EXISTS public.get_live_workday_overview(uuid) CASCADE;

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
            wds.last_seen_at, e.full_name AS employee_name
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
            AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
    ),
    -- ============================================================
    -- Source 1: Heartbeat (workday_sessions.last_seen_at)
    -- ============================================================
    session_activity AS (
        SELECT ws.employee_id, ws.last_seen_at AS activity_at,
            'heartbeat'::text AS activity_type
        FROM active_sessions ws
        WHERE ws.last_seen_at IS NOT NULL
    ),
    -- ============================================================
    -- Source 2: GPS tracking points
    -- ============================================================
    tracking_activity AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.recorded_at AS activity_at,
            'gps'::text AS activity_type
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    -- ============================================================
    -- Source 3: Visit check-ins
    -- ============================================================
    visit_activity AS (
        SELECT v.employee_id, MAX(v.check_in_at) AS activity_at,
            'visit'::text AS activity_type
        FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE
        GROUP BY v.employee_id
    ),
    -- ============================================================
    -- Source 4: Orders
    -- ============================================================
    order_activity AS (
        SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
            MAX(o.created_at) AS activity_at,
            'order'::text AS activity_type
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(o.owner_id)
    ),
    -- ============================================================
    -- Source 5: Collections
    -- ============================================================
    collection_activity AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            MAX(c.created_at) AS activity_at,
            'collection'::text AS activity_type
        FROM public.collections c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    -- ============================================================
    -- Combine all activity sources, pick the latest per employee
    -- ============================================================
    combined_activity AS (
        SELECT employee_id, activity_at, activity_type FROM session_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM tracking_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM visit_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM order_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM collection_activity
    ),
    last_activity AS (
        SELECT DISTINCT ON (employee_id)
            employee_id, activity_at AS last_activity_at,
            activity_type AS last_activity_type
        FROM combined_activity
        ORDER BY employee_id, activity_at DESC NULLS LAST
    ),
    -- ============================================================
    -- Last GPS position (separate from activity — for map display)
    -- ============================================================
    last_location AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.latitude, tp.longitude,
            tp.recorded_at AS last_location_at, tp.accuracy_meters
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE
          AND tp.latitude IS NOT NULL AND tp.longitude IS NOT NULL
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    -- ============================================================
    -- Existing CTEs (unchanged)
    -- ============================================================
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id
        FROM public.workday_breaks wb WHERE wb.break_end IS NULL
    ),
    today_orders AS (
        SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
            COUNT(*)::int AS order_count,
            COALESCE(SUM(o.total_amount), 0) AS sales_value
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(o.owner_id)
    ),
    today_collections AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            COUNT(*)::int AS collection_count,
            COALESCE(SUM(c.amount), 0) AS collection_amount
        FROM public.collections c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    today_customers AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            COUNT(*)::int AS new_customer_count
        FROM public.customers c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    today_visits AS (
        SELECT v.employee_id, COUNT(*)::int AS visit_count
        FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE GROUP BY v.employee_id
    ),
    -- ============================================================
    -- Employee summary with new activity-based connection_status
    -- ============================================================
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
            -- GPS position (for map)
            ll.latitude, ll.longitude, ll.last_location_at,
            -- Latest activity across all sources
            la.last_activity_at,
            la.last_activity_type,
            -- Backward-compat: last_seen_at = MAX(last_activity_at, last_location_at)
            CASE
                WHEN la.last_activity_at IS NOT NULL AND ll.last_location_at IS NOT NULL
                    THEN GREATEST(la.last_activity_at, ll.last_location_at)
                WHEN la.last_activity_at IS NOT NULL THEN la.last_activity_at
                WHEN ll.last_location_at IS NOT NULL THEN ll.last_location_at
                ELSE NULL
            END AS last_seen_at,
            -- connection_status from last_activity_at (not tracking_points only)
            CASE
                WHEN la.last_activity_at IS NULL THEN 'no_data'
                WHEN la.last_activity_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                WHEN la.last_activity_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                ELSE 'lost'
            END AS connection_status,
            as2.status AS session_status,
            COALESCE(to2.order_count, 0) AS order_count,
            COALESCE(to2.sales_value, 0) AS sales_value,
            COALESCE(tc.collection_count, 0) AS collection_count,
            COALESCE(tc.collection_amount, 0) AS collection_amount,
            COALESCE(tcu.new_customer_count, 0) AS new_customer_count,
            COALESCE(tv.visit_count, 0) AS visit_count
        FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN LATERAL (
            SELECT v2.id, v2.employee_id FROM public.visits v2
            WHERE v2.employee_id = as2.employee_id AND v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL
            LIMIT 1
        ) vl ON true
        LEFT JOIN last_activity la ON la.employee_id = as2.employee_id
        LEFT JOIN last_location ll ON ll.employee_id = as2.employee_id
        LEFT JOIN today_orders to2 ON to2.employee_id = as2.employee_id
        LEFT JOIN today_collections tc ON tc.employee_id = as2.employee_id
        LEFT JOIN today_customers tcu ON tcu.employee_id = as2.employee_id
        LEFT JOIN today_visits tv ON tv.employee_id = as2.employee_id
    ),
    -- ============================================================
    -- No-start and ended (unchanged)
    -- ============================================================
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
            wds.visit_count,
            COALESCE(to2.order_count, 0) AS order_count,
            COALESCE(to2.sales_value, 0) AS sales_value,
            COALESCE(tc.collection_count, 0) AS collection_count,
            COALESCE(tc.collection_amount, 0) AS collection_amount,
            COALESCE(tcu.new_customer_count, 0) AS new_customer_count
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        LEFT JOIN today_orders to2 ON to2.employee_id = wds.employee_id
        LEFT JOIN today_collections tc ON tc.employee_id = wds.employee_id
        LEFT JOIN today_customers tcu ON tcu.employee_id = wds.employee_id
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
            -- NEW: separate activity and location fields
            'last_activity_at', es.last_activity_at,
            'last_activity_type', es.last_activity_type,
            'last_location_at', es.last_location_at,
            'last_seen_label',
                CASE es.connection_status
                    WHEN 'connected' THEN 'متصل الآن'
                    WHEN 'delayed' THEN
                        'آخر نشاط منذ ' || EXTRACT(EPOCH FROM (now() - es.last_seen_at))::int / 60 || ' دقيقة'
                    WHEN 'lost' THEN 'انقطاع متابعة'
                    ELSE 'لا توجد بيانات حديثة'
                END,
            'order_count', es.order_count,
            'sales_value', es.sales_value,
            'collection_count', es.collection_count,
            'collection_amount', es.collection_amount,
            'new_customer_count', es.new_customer_count,
            'visit_count', es.visit_count
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
            'visit_count', ed.visit_count,
            'order_count', ed.order_count,
            'sales_value', ed.sales_value,
            'collection_count', ed.collection_count,
            'collection_amount', ed.collection_amount,
            'new_customer_count', ed.new_customer_count
        ) ORDER BY ed.end_time DESC) FROM ended ed), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_live_workday_overview TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_workday_overview TO anon;

COMMENT ON FUNCTION public.get_live_workday_overview IS
  'غرفة العمليات — حالة الاتصال تعتمد على last_activity_at (وليس tracking_points فقط). last_activity يشمل: heartbeat, GPS, visits, orders, collections.';

-- ================================================================
-- 2. get_team_map — connection_status from last_activity
-- ================================================================

DROP FUNCTION IF EXISTS public.get_team_map(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.get_team_map(p_token uuid)
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
    IF NOT public.check_capability(p_token, 'attendance.view_team_map') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;
    SELECT location_interval_seconds INTO v_interval_seconds FROM public.workday_settings LIMIT 1;
    v_interval_seconds := COALESCE(v_interval_seconds, 300);

    WITH filtered_employees AS (
        SELECT e.id FROM public.employees e WHERE e.is_active = true
        AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
    ),
    active_sessions AS (
        SELECT wds.id, wds.employee_id, wds.start_time, wds.status,
            wds.last_seen_at, e.full_name AS employee_name
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
        AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
    ),
    -- ============================================================
    -- 5 sources of activity + combined + last_activity
    -- ============================================================
    session_activity AS (
        SELECT ws.employee_id, ws.last_seen_at AS activity_at,
            'heartbeat'::text AS activity_type
        FROM active_sessions ws WHERE ws.last_seen_at IS NOT NULL
    ),
    tracking_activity AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.recorded_at AS activity_at,
            'gps'::text AS activity_type
        FROM public.tracking_points tp WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    visit_activity AS (
        SELECT v.employee_id, MAX(v.check_in_at) AS activity_at,
            'visit'::text AS activity_type
        FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE
        GROUP BY v.employee_id
    ),
    order_activity AS (
        SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
            MAX(o.created_at) AS activity_at,
            'order'::text AS activity_type
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(o.owner_id)
    ),
    collection_activity AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            MAX(c.created_at) AS activity_at,
            'collection'::text AS activity_type
        FROM public.collections c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    combined_activity AS (
        SELECT employee_id, activity_at, activity_type FROM session_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM tracking_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM visit_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM order_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM collection_activity
    ),
    last_activity AS (
        SELECT DISTINCT ON (employee_id)
            employee_id, activity_at AS last_activity_at,
            activity_type AS last_activity_type
        FROM combined_activity
        ORDER BY employee_id, activity_at DESC NULLS LAST
    ),
    -- ============================================================
    -- Last GPS position (separate)
    -- ============================================================
    last_location AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.latitude, tp.longitude,
            tp.recorded_at AS last_location_at, tp.accuracy_meters
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE
          AND tp.latitude IS NOT NULL AND tp.longitude IS NOT NULL
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    -- ============================================================
    -- Existing CTEs (unchanged)
    -- ============================================================
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id FROM public.workday_breaks wb WHERE wb.break_end IS NULL
    ),
    today_orders AS (
        SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
            COUNT(*)::int AS order_count,
            COALESCE(SUM(o.total_amount), 0) AS sales_value
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(o.owner_id)
    ),
    today_collections AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            COUNT(*)::int AS collection_count,
            COALESCE(SUM(c.amount), 0) AS collection_amount
        FROM public.collections c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    today_customers AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            COUNT(*)::int AS new_customer_count
        FROM public.customers c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    today_visits AS (
        SELECT v.employee_id, COUNT(*)::int AS visit_count
        FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE GROUP BY v.employee_id
    )
    SELECT jsonb_build_object(
        'counters', jsonb_build_object(
            'active', (SELECT COUNT(*) FROM active_sessions),
            'on_break', (SELECT COUNT(DISTINCT ab.employee_id) FROM active_sessions as2 JOIN active_breaks ab ON ab.session_id = as2.id),
            'on_visit', (SELECT COUNT(*) FROM active_sessions as2 WHERE EXISTS (SELECT 1 FROM public.visits v2 WHERE v2.employee_id = as2.employee_id AND v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL)),
            'not_started', (SELECT COUNT(*) FROM filtered_employees fe WHERE fe.id NOT IN (SELECT employee_id FROM active_sessions) AND fe.id NOT IN (SELECT employee_id FROM public.workday_sessions WHERE date = CURRENT_DATE AND status = 'completed')),
            -- connection_lost now uses last_activity_at (not tracking_points)
            'connection_lost', (SELECT COUNT(*) FROM active_sessions as2
                LEFT JOIN last_activity la ON la.employee_id = as2.employee_id
                WHERE la.last_activity_at IS NULL
                   OR la.last_activity_at < now() - ((v_interval_seconds * 5) || ' seconds')::interval),
            'zero_visits_today', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN today_visits tv2 ON tv2.employee_id = as2.employee_id WHERE COALESCE(tv2.visit_count, 0) = 0),
            'zero_orders_today', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN today_orders too2 ON too2.employee_id = as2.employee_id WHERE COALESCE(too2.order_count, 0) = 0),
            -- inactive_over_2h now uses last_activity_at
            'inactive_over_2h', (SELECT COUNT(*) FROM active_sessions as2
                LEFT JOIN last_activity la2 ON la2.employee_id = as2.employee_id
                WHERE EXTRACT(EPOCH FROM (now() - as2.start_time)) / 3600 > 2
                  AND (la2.last_activity_at IS NULL OR la2.last_activity_at < now() - interval '30 minutes'))
        ),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', as2.employee_id, 'name', as2.employee_name,
            'role_name', COALESCE(role_info.name, ''),
            'status', CASE WHEN ab.employee_id IS NOT NULL THEN 'on_break'
                           WHEN vl.employee_id IS NOT NULL THEN 'on_visit'
                           ELSE 'working' END,
            -- connection_status from last_activity_at
            'connection_status', CASE WHEN la.last_activity_at IS NULL THEN 'no_data'
                 WHEN la.last_activity_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                 WHEN la.last_activity_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                 ELSE 'lost' END,
            -- GPS position from last_location (separate)
            'latitude', ll.latitude, 'longitude', ll.longitude,
            -- Backward-compat last_seen_at
            'last_seen_at', CASE
                WHEN la.last_activity_at IS NOT NULL AND ll.last_location_at IS NOT NULL
                    THEN GREATEST(la.last_activity_at, ll.last_location_at)
                WHEN la.last_activity_at IS NOT NULL THEN la.last_activity_at
                WHEN ll.last_location_at IS NOT NULL THEN ll.last_location_at
                ELSE NULL END,
            -- NEW: separate activity and location fields
            'last_activity_at', la.last_activity_at,
            'last_activity_type', la.last_activity_type,
            'last_location_at', ll.last_location_at,
            'duration_minutes', EXTRACT(EPOCH FROM (now() - as2.start_time)) / 60,
            'order_count', COALESCE(too.order_count, 0), 'sales_value', COALESCE(too.sales_value, 0),
            'collection_count', COALESCE(tco.collection_count, 0), 'collection_amount', COALESCE(tco.collection_amount, 0),
            'new_customer_count', COALESCE(tc.new_customer_count, 0),
            'visit_count', COALESCE(tv.visit_count, 0)
        )) FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN LATERAL (SELECT v2.id, v2.employee_id FROM public.visits v2 WHERE v2.employee_id = as2.employee_id AND v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL LIMIT 1) vl ON true
        LEFT JOIN last_activity la ON la.employee_id = as2.employee_id
        LEFT JOIN last_location ll ON ll.employee_id = as2.employee_id
        LEFT JOIN today_orders too ON too.employee_id = as2.employee_id
        LEFT JOIN today_collections tco ON tco.employee_id = as2.employee_id
        LEFT JOIN today_customers tc ON tc.employee_id = as2.employee_id
        LEFT JOIN today_visits tv ON tv.employee_id = as2.employee_id
        LEFT JOIN LATERAL (
            SELECT r.name FROM public.employee_roles er
            JOIN public.roles r ON r.id = er.role_id
            WHERE er.employee_id = as2.employee_id LIMIT 1
        ) role_info ON true), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_team_map TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_map TO anon;

COMMENT ON FUNCTION public.get_team_map IS
  'خريطة الفريق — حالة الاتصال تعتمد على last_activity_at (وليس tracking_points فقط). last_activity يشمل: heartbeat, GPS, visits, orders, collections.';

-- ================================================================
-- 3. get_coverage_map — connection_status from last_activity
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
    -- ============================================================
    -- Source 1: Heartbeat (workday_sessions.last_seen_at)
    -- ============================================================
    session_activity AS (
        SELECT ws.employee_id, ws.last_seen_at AS activity_at,
            'heartbeat'::text AS activity_type
        FROM active_sessions ws
        WHERE ws.last_seen_at IS NOT NULL
    ),
    -- ============================================================
    -- Source 2: GPS tracking points
    -- ============================================================
    tracking_activity AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.recorded_at AS activity_at,
            'gps'::text AS activity_type
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    -- ============================================================
    -- Source 3: Visit check-ins
    -- ============================================================
    visit_activity AS (
        SELECT v.employee_id, MAX(v.check_in_at) AS activity_at,
            'visit'::text AS activity_type
        FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE
        GROUP BY v.employee_id
    ),
    -- ============================================================
    -- Source 4: Orders
    -- ============================================================
    order_activity AS (
        SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
            MAX(o.created_at) AS activity_at,
            'order'::text AS activity_type
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(o.owner_id)
    ),
    -- ============================================================
    -- Source 5: Collections
    -- ============================================================
    collection_activity AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            MAX(c.created_at) AS activity_at,
            'collection'::text AS activity_type
        FROM public.collections c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    -- ============================================================
    -- Combine all activity sources, pick the latest per employee
    -- ============================================================
    combined_activity AS (
        SELECT employee_id, activity_at, activity_type FROM session_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM tracking_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM visit_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM order_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM collection_activity
    ),
    last_activity AS (
        SELECT DISTINCT ON (employee_id)
            employee_id, activity_at AS last_activity_at,
            activity_type AS last_activity_type
        FROM combined_activity
        ORDER BY employee_id, activity_at DESC NULLS LAST
    ),
    -- ============================================================
    -- Last GPS position (separate from activity — for map display)
    -- ============================================================
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
    -- CUSTOMER LOCATIONS — modified with priority logic + new fields
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
            -- Priority location logic:
            -- 1. GPS from unified_locations
            -- 2. Geocoded coords from customer_addresses
            -- 3. City center from reference_cities
            -- 4. Governorate center from reference_governorates
            COALESCE(ul.latitude, caddr.latitude, ct.latitude, gov.latitude) AS latitude,
            COALESCE(ul.longitude, caddr.longitude, ct.longitude, gov.longitude) AS longitude,
            CASE
                WHEN ul.latitude IS NOT NULL THEN 'gps'
                WHEN caddr.latitude IS NOT NULL THEN 'address_geocoded'
                WHEN ct.latitude IS NOT NULL THEN 'city_center'
                WHEN gov.latitude IS NOT NULL THEN 'governorate_center'
                ELSE 'unknown'
            END AS location_source,
            CASE
                WHEN ul.latitude IS NOT NULL THEN 'GPS'
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
            -- connection_status from last_activity_at
            'connection_status', CASE WHEN la.last_activity_at IS NULL THEN 'no_data'
                 WHEN la.last_activity_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                 WHEN la.last_activity_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                 ELSE 'lost' END,
            -- GPS position from last_location (separate)
            'latitude', ll.latitude, 'longitude', ll.longitude,
            'accuracy_meters', ll.accuracy_meters,
            -- Backward-compat last_seen_at
            'last_seen_at', CASE
                WHEN la.last_activity_at IS NOT NULL AND ll.last_location_at IS NOT NULL
                    THEN GREATEST(la.last_activity_at, ll.last_location_at)
                WHEN la.last_activity_at IS NOT NULL THEN la.last_activity_at
                WHEN ll.last_location_at IS NOT NULL THEN ll.last_location_at
                ELSE NULL END,
            -- NEW: separate activity and location fields
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
  'خريطة التغطية — 4 مستويات: GPS ← ترميز جغرافي ← مركز مدينة ← مركز محافظة. حالة الاتصال تعتمد على last_activity_at.';

NOTIFY pgrst, 'reload schema';
