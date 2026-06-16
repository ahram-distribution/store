-- ===============================================================
-- Identity Integration Layer
-- Resolves the polymorphic owner_id problem across the system.
-- 
-- Problem: orders.owner_id sometimes references identities.id
-- (12 out of 58 rows) instead of employees.id. This breaks all
-- JOINs between attendance/workday sessions and orders.
--
-- employees.identity_id already provides the mapping:
--   employees.identity_id = identities.id
--
-- Solution: resolve_employee_id() normalizes any ID (whether it's
-- identities.id or employees.id) to employees.id. All analytics
-- RPCs use this function for JOINs.
-- ===============================================================

-- =============================================================
-- 1. Identity Resolution Function
-- =============================================================
CREATE OR REPLACE FUNCTION public.resolve_employee_id(target_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT e.id FROM public.employees e WHERE e.id = target_id),
    (SELECT e.id FROM public.employees e WHERE e.identity_id = target_id)
  );
$$;

-- =============================================================
-- 2. get_employee_workday_history — use resolve_employee_id
--    for orders, collections, and customers JOINs
-- =============================================================
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
    v_sessions_json jsonb;
    v_summary_json jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      IF NOT (p_employee_id = ANY(public.get_visible_employee_ids(p_token))) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
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
            SELECT public.resolve_employee_id(o.owner_id) AS resolved_employee_id,
                o.created_at::date AS d,
                COUNT(*)::int AS order_count,
                COALESCE(SUM(o.total_amount), 0) AS sales_value
            FROM public.orders o
            GROUP BY public.resolve_employee_id(o.owner_id), o.created_at::date
        ) od ON od.resolved_employee_id = wds.employee_id AND od.d = wds.date
        LEFT JOIN (
            SELECT public.resolve_employee_id(c.owner_id) AS resolved_employee_id,
                c.created_at::date AS d,
                COUNT(*)::int AS collection_count,
                COALESCE(SUM(c.amount), 0) AS collection_amount
            FROM public.collections c
            GROUP BY public.resolve_employee_id(c.owner_id), c.created_at::date
        ) cd ON cd.resolved_employee_id = wds.employee_id AND cd.d = wds.date
        LEFT JOIN (
            SELECT public.resolve_employee_id(c2.owner_id) AS resolved_employee_id,
                c2.created_at::date AS d,
                COUNT(*)::int AS new_customer_count
            FROM public.customers c2
            GROUP BY public.resolve_employee_id(c2.owner_id), c2.created_at::date
        ) nd ON nd.resolved_employee_id = wds.employee_id AND nd.d = wds.date
        WHERE wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to
    )
    SELECT
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
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
        ) ORDER BY sd.date DESC), '[]'::jsonb) FROM session_data sd WHERE sd.status = 'completed'),
        jsonb_build_object(
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
        )
    INTO v_sessions_json, v_summary_json;

    RETURN jsonb_build_object('sessions', v_sessions_json, 'summary', v_summary_json);
END;
$function$;

-- =============================================================
-- 3. get_team_map — use resolve_employee_id for today_orders,
--    today_collections, and today_customers CTEs
-- =============================================================
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
            e.full_name AS employee_name
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
        AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
    ),
    last_points AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.latitude, tp.longitude, tp.recorded_at
        FROM public.tracking_points tp WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
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
            'connection_lost', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id WHERE lp.recorded_at IS NULL OR lp.recorded_at < now() - ((v_interval_seconds * 5) || ' seconds')::interval),
            'zero_visits_today', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN today_visits tv2 ON tv2.employee_id = as2.employee_id WHERE COALESCE(tv2.visit_count, 0) = 0),
            'zero_orders_today', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN today_orders too2 ON too2.employee_id = as2.employee_id WHERE COALESCE(too2.order_count, 0) = 0),
            'inactive_over_2h', (SELECT COUNT(*) FROM active_sessions as2 WHERE EXTRACT(EPOCH FROM (now() - as2.start_time)) / 3600 > 2 AND NOT EXISTS (SELECT 1 FROM last_points lp2 WHERE lp2.employee_id = as2.employee_id AND lp2.recorded_at > now() - interval '30 minutes'))
        ),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', as2.employee_id, 'name', as2.employee_name,
            'role_name', COALESCE(role_info.name, ''),
            'status', CASE WHEN ab.employee_id IS NOT NULL THEN 'on_break'
                           WHEN vl.employee_id IS NOT NULL THEN 'on_visit'
                           ELSE 'working' END,
            'connection_status', CASE WHEN lp.recorded_at IS NULL THEN 'no_data'
                 WHEN lp.recorded_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                 WHEN lp.recorded_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                 ELSE 'lost' END,
            'latitude', lp.latitude, 'longitude', lp.longitude, 'last_seen_at', lp.recorded_at,
            'duration_minutes', EXTRACT(EPOCH FROM (now() - as2.start_time)) / 60,
            'order_count', COALESCE(too.order_count, 0), 'sales_value', COALESCE(too.sales_value, 0),
            'collection_count', COALESCE(tco.collection_count, 0), 'collection_amount', COALESCE(tco.collection_amount, 0),
            'new_customer_count', COALESCE(tc.new_customer_count, 0),
            'visit_count', COALESCE(tv.visit_count, 0)
        )) FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN LATERAL (SELECT v2.id, v2.employee_id FROM public.visits v2 WHERE v2.employee_id = as2.employee_id AND v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL LIMIT 1) vl ON true
        LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
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

-- =============================================================
-- 4. get_my_workday_status — use resolve_employee_id for
--    orders, collections, customers KPIs
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_my_workday_status(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_employee record;
    v_policy record;
    v_session_data record;
    v_break_count int := 0;
    v_break_total_seconds int := 0;
    v_visit_count int := 0;
    v_on_break boolean := false;
    v_open_break_id uuid := NULL;
    v_today_orders int := 0;
    v_today_sales numeric := 0;
    v_today_collections int := 0;
    v_today_collection_amount numeric := 0;
    v_today_new_customers int := 0;
    v_target_data jsonb := NULL;
    v_duration_minutes numeric := 0;
    v_net_work_minutes numeric := 0;
    v_ended_at timestamptz := NULL;
    v_started_at timestamptz := NULL;
    v_session_status text := NULL;
    v_session_id uuid := NULL;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT id, full_name, code INTO v_employee FROM public.employees WHERE id = v_employee_id;
    SELECT ep.* INTO v_policy FROM public.employee_work_policies ep WHERE ep.employee_id = v_employee_id;

    SELECT * INTO v_session_data FROM public.workday_sessions
    WHERE employee_id = v_employee_id AND date = CURRENT_DATE
    ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, start_time DESC
    LIMIT 1;

    IF FOUND THEN
        v_session_id := v_session_data.id;
        v_session_status := v_session_data.status;
        v_started_at := v_session_data.start_time;
        v_ended_at := v_session_data.end_time;

        IF v_session_data.status = 'active' THEN
            v_duration_minutes := EXTRACT(EPOCH FROM (now() - v_session_data.start_time)) / 60;
            SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) INTO v_break_count, v_break_total_seconds
            FROM public.workday_breaks WHERE session_id = v_session_data.id;
            SELECT COUNT(*) INTO v_visit_count FROM public.visits
            WHERE employee_id = v_employee_id AND check_in_at::date = CURRENT_DATE;
            SELECT EXISTS(SELECT 1 FROM public.workday_breaks
                          WHERE session_id = v_session_data.id AND break_end IS NULL) INTO v_on_break;
            SELECT id INTO v_open_break_id FROM public.workday_breaks
            WHERE session_id = v_session_data.id AND break_end IS NULL LIMIT 1;
        ELSE
            v_duration_minutes := EXTRACT(EPOCH FROM (v_session_data.end_time - v_session_data.start_time)) / 60;
            SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) INTO v_break_count, v_break_total_seconds
            FROM public.workday_breaks WHERE session_id = v_session_data.id;
        END IF;

        v_net_work_minutes := v_duration_minutes - (v_break_total_seconds / 60);
    END IF;

    SELECT COUNT(*)::int, COALESCE(SUM(total_amount), 0) INTO v_today_orders, v_today_sales
    FROM public.orders WHERE public.resolve_employee_id(owner_id) = v_employee_id AND created_at::date = CURRENT_DATE;
    SELECT COUNT(*)::int, COALESCE(SUM(amount), 0) INTO v_today_collections, v_today_collection_amount
    FROM public.collections WHERE public.resolve_employee_id(owner_id) = v_employee_id AND created_at::date = CURRENT_DATE;
    SELECT COUNT(*)::int INTO v_today_new_customers
    FROM public.customers WHERE public.resolve_employee_id(owner_id) = v_employee_id AND created_at::date = CURRENT_DATE;

    BEGIN
        v_target_data := public.get_daily_target_vs_actual(p_token, v_employee_id, CURRENT_DATE);
    EXCEPTION WHEN OTHERS THEN
        v_target_data := NULL;
    END;

    RETURN jsonb_build_object(
        'status', v_session_status,
        'employee_name', v_employee.full_name,
        'employee_code', v_employee.code,
        'session_id', v_session_id,
        'started_at', v_started_at,
        'ended_at', v_ended_at,
        'duration_minutes', v_duration_minutes,
        'break_count', v_break_count,
        'break_minutes', v_break_total_seconds / 60,
        'visit_count', v_visit_count,
        'net_work_minutes', v_net_work_minutes,
        'on_break', CASE WHEN v_session_status = 'active' THEN v_on_break ELSE false END,
        'open_break_id', CASE WHEN v_session_status = 'active' THEN v_open_break_id ELSE NULL::uuid END,
        'work_location', v_policy.work_location,
        'schedule_type', v_policy.schedule_type,
        'required_daily_hours', v_policy.required_daily_hours,
        'attendance_enabled', v_policy.attendance_enabled,
        'today_orders', v_today_orders,
        'today_sales', v_today_sales,
        'today_collections', v_today_collections,
        'today_new_customers', v_today_new_customers,
        'daily_target_vs_actual', v_target_data
    );
END;
$function$;

-- =============================================================
-- 5. get_daily_target_vs_actual — use resolve_employee_id for
--    orders, collections, customers actuals
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_daily_target_vs_actual(
    p_token uuid,
    p_employee_id uuid DEFAULT NULL,
    p_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_target_date date;
    v_employee_ids uuid[];
    v_result jsonb;
    v_emp_record record;
    v_policy record;
    v_monthly_target record;
    v_target_hours numeric;
    v_today_net_seconds numeric;
    v_progress_pct numeric;
    v_remaining_seconds numeric;
    v_last_7 jsonb;
    v_kpi jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    v_target_date := COALESCE(p_date, CURRENT_DATE);

    -- Determine which employees to process
    IF p_employee_id IS NOT NULL THEN
        v_employee_ids := ARRAY[p_employee_id];
    ELSE
        -- All governed employees (team scope)
        IF public.check_capability(p_token, 'attendance.view_all') THEN
            SELECT ARRAY(SELECT id FROM public.employees WHERE is_active = true) INTO v_employee_ids;
        ELSE
            v_employee_ids := app.get_subtree_ids(v_session.employee_id);
        END IF;
    END IF;

    IF v_employee_ids IS NULL OR array_length(v_employee_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_EMPLOYEES');
    END IF;

    -- For single employee: detailed TargetResponse + KPI fields
    IF p_employee_id IS NOT NULL AND array_length(v_employee_ids, 1) = 1 THEN
        SELECT * INTO v_emp_record FROM public.employees WHERE id = p_employee_id;
        SELECT * INTO v_policy FROM public.employee_work_policies WHERE employee_id = p_employee_id;

        v_target_hours := COALESCE(v_policy.required_daily_hours, 8);

        -- Net work seconds for the target date
        SELECT COALESCE(SUM(
            EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) -
            COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = wds.id), 0)
        ), 0) INTO v_today_net_seconds
        FROM public.workday_sessions wds
        WHERE wds.employee_id = p_employee_id
          AND wds.date = v_target_date
          AND wds.status = 'completed';

        v_progress_pct := CASE WHEN v_target_hours > 0 THEN ROUND((v_today_net_seconds / (v_target_hours * 3600) * 100)::numeric, 1) ELSE 0 END;
        v_remaining_seconds := GREATEST(0, (v_target_hours * 3600) - v_today_net_seconds);

        -- Last 7 days
        SELECT jsonb_agg(jsonb_build_object(
            'date', d.d::text,
            'net_hours', COALESCE(ROUND((
                EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) -
                COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = wds.id), 0)
            ) / 3600, 1), 0),
            'target_hours', v_target_hours,
            'met_target', COALESCE((
                EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) -
                COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = wds.id), 0)
            ) / 3600 >= v_target_hours, false)
        ) ORDER BY d.d)
        INTO v_last_7
        FROM (
            SELECT generate_series(v_target_date - 6, v_target_date, '1 day'::interval)::date AS d
        ) d
        LEFT JOIN public.workday_sessions wds ON wds.employee_id = p_employee_id AND wds.date = d.d AND wds.status = 'completed';

        -- Monthly target for KPI fields
        SELECT * INTO v_monthly_target FROM public.employee_monthly_targets
        WHERE employee_id = p_employee_id
          AND target_month = EXTRACT(MONTH FROM v_target_date)
          AND target_year = EXTRACT(YEAR FROM v_target_date);

        RETURN jsonb_build_object(
            -- TargetResponse fields (EmployeeWorkdayDetailPage / get_my_workday_status)
            'target_hours', v_target_hours,
            'current_net_seconds', v_today_net_seconds,
            'current_net_hours', ROUND((v_today_net_seconds / 3600)::numeric, 2),
            'progress_pct', v_progress_pct,
            'remaining_seconds', v_remaining_seconds,
            'schedule_type', COALESCE(v_policy.schedule_type, 'fixed_shift'),
            'last_7_days', COALESCE(v_last_7, '[]'::jsonb),
            -- KPI target/actual fields (HistoryPage / ReportsPage)
            'hours_target', v_target_hours,
            'hours_actual', ROUND((v_today_net_seconds / 3600)::numeric, 2),
            'orders_target', COALESCE(v_monthly_target.orders_target / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)), 0),
            'orders_actual', COALESCE((SELECT COUNT(*)::numeric FROM public.orders WHERE public.resolve_employee_id(owner_id) = p_employee_id AND created_at::date = v_target_date), 0),
            'sales_target', COALESCE(v_monthly_target.sales_target / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)), 0),
            'sales_actual', COALESCE((SELECT SUM(total_amount)::numeric FROM public.orders WHERE public.resolve_employee_id(owner_id) = p_employee_id AND created_at::date = v_target_date), 0),
            'collections_target', COALESCE(v_monthly_target.collections_target / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)), 0),
            'collections_actual', COALESCE((SELECT SUM(amount)::numeric FROM public.collections WHERE public.resolve_employee_id(owner_id) = p_employee_id AND created_at::date = v_target_date), 0),
            'new_customers_target', COALESCE(v_monthly_target.new_customers_target / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)), 0),
            'new_customers_actual', COALESCE((SELECT COUNT(*)::numeric FROM public.customers WHERE public.resolve_employee_id(owner_id) = p_employee_id AND created_at::date = v_target_date), 0)
        );
    END IF;

    -- For team/aggregate: return aggregated KPI fields
    SELECT jsonb_build_object(
        'hours_target', SUM(COALESCE(ewp.required_daily_hours, 8)),
        'hours_actual', ROUND(SUM(COALESCE((
            SELECT EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) -
                COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = wds.id), 0)
            FROM public.workday_sessions wds
            WHERE wds.employee_id = e.id AND wds.date = v_target_date AND wds.status = 'completed'
        ), 0)) / 3600, 1),
        'orders_target', SUM(COALESCE(emt.orders_target, 0)) / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)),
        'orders_actual', COALESCE((SELECT COUNT(*)::numeric FROM public.orders o WHERE public.resolve_employee_id(o.owner_id) = ANY(v_employee_ids) AND o.created_at::date = v_target_date), 0),
        'sales_target', SUM(COALESCE(emt.sales_target, 0)) / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)),
        'sales_actual', COALESCE((SELECT SUM(total_amount)::numeric FROM public.orders o WHERE public.resolve_employee_id(o.owner_id) = ANY(v_employee_ids) AND o.created_at::date = v_target_date), 0),
        'collections_target', SUM(COALESCE(emt.collections_target, 0)) / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)),
        'collections_actual', COALESCE((SELECT SUM(amount)::numeric FROM public.collections c WHERE public.resolve_employee_id(c.owner_id) = ANY(v_employee_ids) AND c.created_at::date = v_target_date), 0),
        'new_customers_target', SUM(COALESCE(emt.new_customers_target, 0)) / EXTRACT(DAY FROM date_trunc('month', v_target_date) + interval '1 month' - date_trunc('month', v_target_date)),
        'new_customers_actual', COALESCE((SELECT COUNT(*)::numeric FROM public.customers cu WHERE public.resolve_employee_id(cu.owner_id) = ANY(v_employee_ids) AND cu.created_at::date = v_target_date), 0)
    ) INTO v_result
    FROM public.employees e
    LEFT JOIN public.employee_work_policies ewp ON ewp.employee_id = e.id
    LEFT JOIN public.employee_monthly_targets emt ON emt.employee_id = e.id
        AND emt.target_month = EXTRACT(MONTH FROM v_target_date)
        AND emt.target_year = EXTRACT(YEAR FROM v_target_date)
    WHERE e.id = ANY(v_employee_ids);

    RETURN v_result;
END;
$function$;

-- =============================================================
-- 6. get_live_workday_overview — add order_count, sales_value,
--    collection_count, collection_amount, new_customer_count
--    with identity resolution via resolve_employee_id
-- =============================================================
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
            e.full_name AS employee_name
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
            AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
    ),
    last_points AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.latitude, tp.longitude, tp.recorded_at
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id
        FROM public.workday_breaks wb
        WHERE wb.break_end IS NULL
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
            lp.latitude, lp.longitude, lp.recorded_at AS last_seen_at,
            CASE
                WHEN lp.recorded_at IS NULL THEN 'no_data'
                WHEN lp.recorded_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                WHEN lp.recorded_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
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
        LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
        LEFT JOIN today_orders to2 ON to2.employee_id = as2.employee_id
        LEFT JOIN today_collections tc ON tc.employee_id = as2.employee_id
        LEFT JOIN today_customers tcu ON tcu.employee_id = as2.employee_id
        LEFT JOIN today_visits tv ON tv.employee_id = as2.employee_id
    ),
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
            'last_seen_label',
                CASE es.connection_status
                    WHEN 'connected' THEN 'متصل الآن'
                    WHEN 'delayed' THEN
                        'آخر ظهور منذ ' || EXTRACT(EPOCH FROM (now() - es.last_seen_at))::int / 60 || ' دقيقة'
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
