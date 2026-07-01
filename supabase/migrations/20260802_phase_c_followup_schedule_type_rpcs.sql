-- ===============================================================
-- Phase C Follow-up — Schedule Type-Aware RPCs
-- تاريخ: 22 يونيو 2026
--
-- الهدف: إصلاح جميع RPCs المربوطة بشاشات الحضور والتتبع
-- لتصبح schedule_type-aware (تفرّق بين المندوب والمكتبي)
--
-- RPCs المصلحة:
-- 1. get_employee_workday_history — net = presence فقط للمندوبين
-- 2. get_employee_day_timeline — net = حضور بدون خصم استراحات للمندوبين
-- 3. get_live_workday_overview — net_minutes = حضور بدون خصم للمندوبين
-- 4. get_completed_workdays_history — presence للمندوبين بدلاً من net
-- ===============================================================

-- =============================================================
-- 1. get_employee_workday_history — Schedule Type-Aware
-- =============================================================
-- للمكتبي (fixed_shift): net_minutes = duration - breaks (كما هو)
-- للمندوب (flexible/hourly): net_minutes = duration (حضور فقط، لا خصم)
-- يتضمن active + completed للمندوبين في اليوم الحالي
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
    v_use_net_calc := (v_policy.schedule_type = 'fixed_shift');

    WITH session_data AS (
        SELECT
            wds.id, wds.employee_id, wds.date, wds.start_time, wds.end_time, wds.status,
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
    ),
    ranked AS (
        SELECT *,
            ROW_NUMBER() OVER (
                PARTITION BY employee_id, date
                ORDER BY
                    CASE WHEN date < CURRENT_DATE AND status = 'completed' THEN 0
                         WHEN date >= CURRENT_DATE AND status = 'active' THEN 0
                         ELSE 1 END,
                    start_time DESC
            ) AS rn
        FROM session_data
    )
    SELECT
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', r.id, 'date', r.date, 'start_time', r.start_time, 'end_time', r.end_time,
            'status', r.status,
            'duration_minutes', r.duration_minutes::int,
            'break_minutes', r.break_minutes::int,
            'net_minutes', CASE WHEN v_use_net_calc
                THEN GREATEST(r.duration_minutes - r.break_minutes, 0)::int
                ELSE r.duration_minutes::int
            END,
            'break_count', r.break_count,
            'visit_count', r.visit_count,
            'order_count', r.order_count,
            'sales_value', r.sales_value,
            'collection_count', r.collection_count,
            'collection_amount', r.collection_amount,
            'new_customer_count', r.new_customer_count,
            'distance_meters', r.distance_meters::int,
            'attendance_status', r.attendance_status,
            'late_minutes', r.late_minutes,
            'early_departure_minutes', r.early_departure_minutes
        ) ORDER BY r.date DESC), '[]'::jsonb) FROM ranked r WHERE r.rn = 1),
        jsonb_build_object(
            'total_days', (SELECT COUNT(*) FROM ranked WHERE rn = 1),
            'total_duration_minutes', COALESCE((SELECT SUM(duration_minutes)::int FROM ranked WHERE rn = 1), 0),
            'total_break_minutes', COALESCE((SELECT SUM(break_minutes)::int FROM ranked WHERE rn = 1), 0),
            'total_net_minutes', COALESCE((SELECT SUM(CASE WHEN v_use_net_calc
                THEN GREATEST(duration_minutes - break_minutes, 0)
                ELSE duration_minutes END)::int FROM ranked WHERE rn = 1), 0),
            'avg_net_minutes', COALESCE((SELECT AVG(CASE WHEN v_use_net_calc
                THEN GREATEST(duration_minutes - break_minutes, 0)
                ELSE duration_minutes END)::int FROM ranked WHERE rn = 1), 0),
            'max_net_day', COALESCE((SELECT MAX(CASE WHEN v_use_net_calc
                THEN GREATEST(duration_minutes - break_minutes, 0)
                ELSE duration_minutes END)::int FROM ranked WHERE rn = 1), 0),
            'min_net_day', COALESCE((SELECT MIN(CASE WHEN v_use_net_calc
                THEN GREATEST(duration_minutes - break_minutes, 0)
                ELSE duration_minutes END)::int FROM ranked WHERE rn = 1), 0),
            'total_sales_value', COALESCE((SELECT SUM(sales_value)::int FROM ranked WHERE rn = 1), 0),
            'total_orders', COALESCE((SELECT SUM(order_count)::int FROM ranked WHERE rn = 1), 0),
            'total_visits', COALESCE((SELECT SUM(visit_count)::int FROM ranked WHERE rn = 1), 0),
            'total_collections', COALESCE((SELECT SUM(collection_count)::int FROM ranked WHERE rn = 1), 0),
            'total_collections_amount', COALESCE((SELECT SUM(collection_amount)::int FROM ranked WHERE rn = 1), 0),
            'total_new_customers', COALESCE((SELECT SUM(new_customer_count)::int FROM ranked WHERE rn = 1), 0),
            'late_days', (SELECT COUNT(*) FROM ranked WHERE rn = 1 AND attendance_status = 'late'),
            'early_departure_days', (SELECT COUNT(*) FROM ranked WHERE rn = 1 AND attendance_status = 'early_departure'),
            'ontime_days', (SELECT COUNT(*) FROM ranked WHERE rn = 1 AND attendance_status = 'ontime')
        )
    INTO v_sessions_json, v_summary_json;

    RETURN jsonb_build_object('sessions', v_sessions_json, 'summary', v_summary_json);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_employee_workday_history TO authenticated;

-- =============================================================
-- 2. get_employee_day_timeline — Schedule Type-Aware
-- =============================================================
-- للمكتبي: net_work_seconds = حضور - استراحات
-- للمندوب: net_work_seconds = حضور فقط (لا خصم)
-- للمندوب: break_start/break_end أحداث لا تؤثر على الحضور
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_employee_day_timeline(
    p_token uuid,
    p_employee_id uuid,
    p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_session_record record;
    v_employee record;
    v_events_json jsonb;
    v_net_work_seconds numeric;
    v_break_count int;
    v_total_break_seconds numeric;
    v_policy record;
    v_use_net_calc boolean := true;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.is_upper_management(v_session.employee_id) THEN
        IF NOT public.check_capability(p_token, 'attendance.view_timeline') THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN');
        END IF;
        IF NOT (p_employee_id = ANY(public.get_visible_employee_ids(p_token))) THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN');
        END IF;
    END IF;

    SELECT id, full_name, code INTO v_employee FROM public.employees WHERE id = p_employee_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'EMPLOYEE_NOT_FOUND'); END IF;

    SELECT * INTO v_policy FROM public.employee_work_policies WHERE employee_id = p_employee_id;
    v_use_net_calc := (v_policy.schedule_type = 'fixed_shift');

    WITH events AS (
        -- workday start
        SELECT 0 AS evt_order, wds.start_time AS event_time, 'workday_start'::text AS event_type,
            'بداية يوم العمل'::text AS title,
            CASE WHEN wds.status = 'active' THEN 'جاري' ELSE wds.status END AS description,
            NULL::numeric AS e_lat, NULL::numeric AS e_lng,
            '{}'::jsonb AS e_metadata
        FROM public.workday_sessions wds
        WHERE wds.employee_id = p_employee_id AND wds.date = p_date
        UNION ALL
        -- workday end
        SELECT 1, wds.end_time, 'workday_end',
            'نهاية يوم العمل',
            wds.status,
            NULL, NULL, '{}'::jsonb
        FROM public.workday_sessions wds
        WHERE wds.employee_id = p_employee_id AND wds.date = p_date AND wds.end_time IS NOT NULL
        UNION ALL
        -- breaks
        SELECT 2, wbs.break_start, 'break_start',
            'بداية استراحة',
            NULL,
            wbs.latitude, wbs.longitude, '{}'::jsonb
        FROM public.workday_breaks wbs
        JOIN public.workday_sessions wds ON wds.id = wbs.session_id
        WHERE wds.employee_id = p_employee_id AND wds.date = p_date
        UNION ALL
        SELECT 3, wbs.break_end, 'break_end',
            'نهاية استراحة',
            'المدة: ' || ROUND(COALESCE(wbs.duration_seconds, 0) / 60) || ' دقيقة',
            wbs.latitude, wbs.longitude, '{}'::jsonb
        FROM public.workday_breaks wbs
        JOIN public.workday_sessions wds ON wds.id = wbs.session_id
        WHERE wds.employee_id = p_employee_id AND wds.date = p_date AND wbs.break_end IS NOT NULL
        UNION ALL
        -- visit start
        SELECT 4, v.check_in_at, 'visit_start',
            'بداية زيارة',
            c.company_name,
            v.latitude, v.longitude, '{}'::jsonb
        FROM public.visits v
        JOIN public.customers c ON c.id = v.customer_id
        WHERE public.resolve_employee_id(v.created_by) = p_employee_id AND v.check_in_at::date = p_date
        UNION ALL
        -- visit end
        SELECT 5, v.check_out_at, 'visit_end',
            'نهاية زيارة',
            c.company_name || CASE WHEN v.result IS NOT NULL THEN ' — ' || v.result ELSE '' END,
            v.latitude, v.longitude, '{}'::jsonb
        FROM public.visits v
        JOIN public.customers c ON c.id = v.customer_id
        WHERE public.resolve_employee_id(v.created_by) = p_employee_id AND v.check_out_at::date = p_date
        UNION ALL
        -- orders
        SELECT 6, o.created_at, 'order_created',
            'طلب جديد',
            'رقم: ' || COALESCE(o.order_number, o.id::text),
            NULL, NULL, jsonb_build_object('amount', o.total_amount, 'status', o.status)
        FROM public.orders o
        WHERE public.resolve_employee_id(o.owner_id) = p_employee_id AND o.created_at::date = p_date
        UNION ALL
        -- collections
        SELECT 7, c2.created_at, 'collection_taken',
            'تحصيل',
            'المبلغ: ' || COALESCE(c2.amount, 0)::text,
            NULL, NULL, jsonb_build_object('amount', c2.amount)
        FROM public.collections c2
        WHERE public.resolve_employee_id(c2.owner_id) = p_employee_id AND c2.created_at::date = p_date
        UNION ALL
        -- new customers
        SELECT 8, c3.created_at, 'new_customer',
            'عميل جديد',
            c3.company_name,
            NULL, NULL, '{}'::jsonb
        FROM public.customers c3
        WHERE public.resolve_employee_id(c3.owner_id) = p_employee_id AND c3.created_at::date = p_date
    )
    SELECT jsonb_agg(jsonb_build_object(
        'time', e.event_time,
        'type', e.event_type,
        'title', e.title,
        'description', e.description,
        'latitude', e.e_lat,
        'longitude', e.e_lng,
        'metadata', e.e_metadata
    ) ORDER BY e.event_time, e.evt_order)
    INTO v_events_json
    FROM events e
    WHERE e.event_time IS NOT NULL;

    v_events_json := COALESCE(v_events_json, '[]'::jsonb);

    -- Session info for net calculation
    SELECT wds.id, wds.start_time, wds.end_time, wds.status INTO v_session_record
    FROM public.workday_sessions wds
    WHERE wds.employee_id = p_employee_id AND wds.date = p_date
    ORDER BY CASE WHEN wds.status = 'active' THEN 0 ELSE 1 END, wds.start_time DESC
    LIMIT 1;

    IF v_session_record.id IS NOT NULL THEN
        IF v_use_net_calc THEN
            -- Fixed_shift: net = presence - breaks
            SELECT
                COUNT(*),
                COALESCE(SUM(duration_seconds), 0)
            INTO v_break_count, v_total_break_seconds
            FROM public.workday_breaks
            WHERE session_id = v_session_record.id;

            v_net_work_seconds := EXTRACT(EPOCH FROM (COALESCE(v_session_record.end_time, now()) - v_session_record.start_time)) - v_total_break_seconds;
        ELSE
            -- Flexible/Hourly: net = presence only (no break deduction)
            v_net_work_seconds := EXTRACT(EPOCH FROM (COALESCE(v_session_record.end_time, now()) - v_session_record.start_time));
            v_break_count := 0;
            v_total_break_seconds := 0;
        END IF;
    ELSE
        v_net_work_seconds := 0;
        v_break_count := 0;
        v_total_break_seconds := 0;
    END IF;

    RETURN jsonb_build_object(
        'employee', jsonb_build_object('id', v_employee.id, 'full_name', v_employee.full_name, 'code', v_employee.code),
        'session', CASE WHEN v_session_record.id IS NOT NULL THEN
            jsonb_build_object('id', v_session_record.id, 'status', v_session_record.status, 'start_time', v_session_record.start_time, 'end_time', v_session_record.end_time)
        ELSE NULL END,
        'events', v_events_json,
        'metrics', jsonb_build_object(
            'net_work_seconds', GREATEST(v_net_work_seconds, 0)::int,
            'net_work_minutes', GREATEST(ROUND(v_net_work_seconds / 60), 0)::int,
            'break_count', v_break_count,
            'total_break_seconds', v_total_break_seconds::int,
            'schedule_type', COALESCE(v_policy.schedule_type, 'fixed_shift')
        )
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_employee_day_timeline TO authenticated;

-- =============================================================
-- 3. get_live_workday_overview — Schedule Type-Aware net_minutes
-- =============================================================
-- يُصلح net_minutes للمندوبين: net = حضور فقط (لا خصم استراحات)
-- الأصل: get_live_workday_overview مصلح بالفعل في Phase A لـ last_activity
-- لكنه لا يزال يستخدم net = duration - breaks للجميع
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_live_workday_overview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_token uuid := p_token;
    v_current_employees text[];
    v_interval_seconds numeric := 300;
    v_employee_id uuid;
    v_result jsonb;
    v_is_supervisor boolean;
    v_is_management boolean;
    v_visible_ids uuid[];
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    v_employee_id := v_session.employee_id;
    v_is_management := public.is_upper_management(v_employee_id);

    IF v_is_management THEN
        SELECT ARRAY(SELECT id FROM public.employees WHERE is_active = true) INTO v_visible_ids;
    ELSE
        v_visible_ids := app.get_subtree_ids(v_employee_id);
    END IF;

    IF v_visible_ids IS NULL OR array_length(v_visible_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_VISIBLE_EMPLOYEES');
    END IF;

    WITH visible_employees AS (
        SELECT e.id AS employee_id, e.full_name, e.code, e.role_name,
            ewp.schedule_type, ewp.work_location, ewp.required_daily_hours,
            ewp.shift_start_time, ewp.shift_end_time
        FROM public.employees e
        LEFT JOIN public.employee_work_policies ewp ON ewp.employee_id = e.id
        WHERE e.id = ANY(v_visible_ids) AND e.is_active = true
    ),
    live_sessions AS (
        SELECT
            wds.id AS session_id, wds.employee_id, wds.date, wds.start_time, wds.end_time,
            wds.status AS session_status,
            EXTRACT(EPOCH FROM (now() - wds.start_time)) / 60 AS duration_minutes,
            COALESCE(wds.latitude, wds.longitude) IS NOT NULL AS has_location,
            wds.latitude, wds.longitude,
            wds.last_seen_at,
            wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
            wds.visit_count,
            wds.total_distance_meters
        FROM public.workday_sessions wds
        WHERE wds.employee_id = ANY(v_visible_ids) AND wds.date = CURRENT_DATE
    ),
    break_info AS (
        SELECT
            wbs.session_id,
            COUNT(*) FILTER (WHERE wbs.ended_at IS NULL) AS active_break_count,
            COUNT(*) AS total_break_count,
            COALESCE(SUM(COALESCE(wbs.duration_seconds, 0)), 0) AS total_break_seconds
        FROM public.workday_breaks wbs
        JOIN live_sessions ls ON ls.session_id = wbs.session_id
        GROUP BY wbs.session_id
    ),
    last_activity AS (
        SELECT DISTINCT ON (employee_id)
            employee_id, activity_at AS last_activity_at, activity_type AS last_activity_type
        FROM (
            SELECT employee_id, last_seen_at AS activity_at, 'heartbeat' AS activity_type FROM live_sessions WHERE last_seen_at IS NOT NULL
            UNION ALL
            SELECT tp.employee_id, MAX(tp.recorded_at), 'gps' FROM public.tracking_points tp WHERE tp.employee_id = ANY(v_visible_ids) AND tp.recorded_at > now() - interval '24 hours' GROUP BY tp.employee_id
            UNION ALL
            SELECT public.resolve_employee_id(v.created_by), MAX(v.check_in_at), 'visit' FROM public.visits v WHERE public.resolve_employee_id(v.created_by) = ANY(v_visible_ids) AND v.check_in_at > now() - interval '24 hours' GROUP BY public.resolve_employee_id(v.created_by)
            UNION ALL
            SELECT public.resolve_employee_id(o.owner_id), MAX(o.created_at), 'order' FROM public.orders o WHERE public.resolve_employee_id(o.owner_id) = ANY(v_visible_ids) AND o.created_at > now() - interval '24 hours' GROUP BY public.resolve_employee_id(o.owner_id)
            UNION ALL
            SELECT public.resolve_employee_id(c.owner_id), MAX(c.created_at), 'collection' FROM public.collections c WHERE public.resolve_employee_id(c.owner_id) = ANY(v_visible_ids) AND c.created_at > now() - interval '24 hours' GROUP BY public.resolve_employee_id(c.owner_id)
        ) ca
        ORDER BY employee_id, activity_at DESC NULLS LAST
    ),
    employee_stats AS (
        SELECT
            ve.employee_id, ve.full_name, ve.code, ve.role_name,
            ve.schedule_type, ve.work_location, ve.required_daily_hours,
            ve.shift_start_time, ve.shift_end_time,
            ls.session_id, ls.session_status, ls.start_time, ls.end_time,
            ls.duration_minutes::int,
            COALESCE(bi.active_break_count, 0) AS active_break_count,
            COALESCE(bi.total_break_count, 0) AS total_break_count,
            CASE WHEN COALESCE(ve.schedule_type, 'fixed_shift') = 'fixed_shift'
                THEN GREATEST(COALESCE(ls.duration_minutes, 0)::int - COALESCE(bi.total_break_seconds / 60, 0)::int, 0)
                ELSE COALESCE(ls.duration_minutes, 0)::int
            END AS net_minutes,
            ls.has_location, ls.latitude, ls.longitude,
            ls.last_seen_at,
            ls.attendance_status, ls.late_minutes, ls.early_departure_minutes,
            ls.visit_count, ls.total_distance_meters,
            la.last_activity_at, la.last_activity_type,
            CASE
                WHEN la.last_activity_at IS NULL THEN 'no_data'
                WHEN la.last_activity_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                WHEN la.last_activity_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                ELSE 'lost'
            END AS connection_status,
            COALESCE(od.order_count, 0) AS order_count,
            COALESCE(od.sales_value, 0) AS sales_value,
            COALESCE(cd.collection_count, 0) AS collection_count,
            COALESCE(cd.collection_amount, 0) AS collection_amount,
            COALESCE(nd.new_customer_count, 0) AS new_customer_count
        FROM visible_employees ve
        LEFT JOIN live_sessions ls ON ls.employee_id = ve.employee_id
        LEFT JOIN break_info bi ON bi.session_id = ls.session_id
        LEFT JOIN last_activity la ON la.employee_id = ve.employee_id
        LEFT JOIN (
            SELECT public.resolve_employee_id(owner_id) AS eid,
                COUNT(*)::int AS order_count, COALESCE(SUM(total_amount), 0) AS sales_value
            FROM public.orders WHERE created_at::date = CURRENT_DATE AND public.resolve_employee_id(owner_id) = ANY(v_visible_ids)
            GROUP BY public.resolve_employee_id(owner_id)
        ) od ON od.eid = ve.employee_id
        LEFT JOIN (
            SELECT public.resolve_employee_id(owner_id) AS eid,
                COUNT(*)::int AS collection_count, COALESCE(SUM(amount), 0) AS collection_amount
            FROM public.collections WHERE created_at::date = CURRENT_DATE AND public.resolve_employee_id(owner_id) = ANY(v_visible_ids)
            GROUP BY public.resolve_employee_id(owner_id)
        ) cd ON cd.eid = ve.employee_id
        LEFT JOIN (
            SELECT public.resolve_employee_id(owner_id) AS eid, COUNT(*)::int AS new_customer_count
            FROM public.customers WHERE created_at::date = CURRENT_DATE AND public.resolve_employee_id(owner_id) = ANY(v_visible_ids)
            GROUP BY public.resolve_employee_id(owner_id)
        ) nd ON nd.eid = ve.employee_id
    )
    SELECT jsonb_build_object(
        'active_count', (SELECT COUNT(*) FROM employee_stats WHERE session_status = 'active'),
        'on_visit_count', (SELECT COUNT(*) FROM employee_stats WHERE session_status = 'active' AND visit_count > 0),
        'on_break_count', (SELECT COUNT(*) FROM employee_stats WHERE session_status = 'active' AND active_break_count > 0),
        'connection_loss_count', (SELECT COUNT(*) FROM employee_stats WHERE connection_status = 'lost'),
        'no_start_count', (SELECT COUNT(*) FROM employee_stats WHERE session_id IS NULL),
        'ended_count', (SELECT COUNT(*) FROM employee_stats WHERE session_status = 'completed'),
        'zero_orders_count', (SELECT COUNT(*) FROM employee_stats WHERE order_count = 0 AND session_status IS NOT NULL),
        'zero_visits_count', (SELECT COUNT(*) FROM employee_stats WHERE visit_count = 0 AND session_status IS NOT NULL),
        'late_count', (SELECT COUNT(*) FROM employee_stats WHERE attendance_status = 'late'),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', es.employee_id, 'name', es.full_name, 'code', es.code, 'role_name', es.role_name,
            'status', CASE
                WHEN es.session_id IS NULL THEN 'no_start'
                WHEN es.session_status = 'active' AND es.active_break_count > 0 THEN 'on_break'
                WHEN es.session_status = 'active' THEN 'working'
                WHEN es.session_status = 'completed' THEN 'ended'
                ELSE es.session_status
            END,
            'connection_status', es.connection_status,
            'last_activity_at', es.last_activity_at, 'last_activity_type', es.last_activity_type,
            'work_location', es.work_location, 'schedule_type', es.schedule_type,
            'start_time', es.start_time, 'end_time', es.end_time,
            'duration_minutes', es.duration_minutes, 'net_minutes', es.net_minutes,
            'latitude', es.latitude, 'longitude', es.longitude, 'has_location', es.has_location,
            'last_seen_at', es.last_seen_at,
            'attendance_status', es.attendance_status, 'late_minutes', es.late_minutes, 'early_departure_minutes', es.early_departure_minutes,
            'visit_count', es.visit_count, 'order_count', es.order_count, 'sales_value', es.sales_value,
            'collection_count', es.collection_count, 'collection_amount', es.collection_amount,
            'new_customer_count', es.new_customer_count, 'total_distance_meters', es.total_distance_meters
        ) ORDER BY es.connection_status = 'lost' DESC, es.duration_minutes DESC NULLS LAST), '[]'::jsonb) FROM employee_stats es),
        'no_start_employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', es.employee_id, 'name', es.full_name, 'code', es.code, 'role_name', es.role_name,
            'schedule_type', es.schedule_type, 'work_location', es.work_location,
            'shift_start_time', es.shift_start_time
        ) ORDER BY es.full_name) FROM employee_stats es WHERE es.session_id IS NULL), '[]'::jsonb),
        'ended_employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', es.employee_id, 'name', es.full_name, 'code', es.code, 'role_name', es.role_name,
            'schedule_type', es.schedule_type,
            'ended_at', es.end_time, 'duration_minutes', es.duration_minutes,
            'net_minutes', es.net_minutes,
            'attendance_status', es.attendance_status, 'late_minutes', es.late_minutes, 'early_departure_minutes', es.early_departure_minutes,
            'visit_count', es.visit_count, 'order_count', es.order_count, 'sales_value', es.sales_value,
            'collection_count', es.collection_count, 'collection_amount', es.collection_amount,
            'new_customer_count', es.new_customer_count
        ) ORDER BY es.end_time DESC NULLS LAST) FROM employee_stats es WHERE es.session_status = 'completed'), '[]'::jsonb),
        'team_aggregates', jsonb_build_object(
            'total_employees', (SELECT COUNT(*) FROM employee_stats),
            'active_today', (SELECT COUNT(*) FROM employee_stats WHERE session_id IS NOT NULL),
            'progress_pct', CASE WHEN (SELECT COUNT(*) FROM employee_stats WHERE session_id IS NOT NULL) > 0
                THEN ROUND((SELECT AVG(LEAST(COALESCE(es.net_minutes, 0) / NULLIF(COALESCE(es.required_daily_hours, 8) * 60, 0), 1) * 100) FROM employee_stats es WHERE es.session_id IS NOT NULL)::numeric, 1)
                ELSE 0 END,
            'avg_net_minutes', COALESCE((SELECT AVG(es.net_minutes)::int FROM employee_stats es WHERE es.session_id IS NOT NULL), 0),
            'late_count', (SELECT COUNT(*) FROM employee_stats WHERE attendance_status = 'late'),
            'connection_loss_count', (SELECT COUNT(*) FROM employee_stats WHERE connection_status = 'lost'),
            'total_orders', COALESCE((SELECT SUM(order_count)::int FROM employee_stats), 0),
            'total_sales', COALESCE((SELECT SUM(sales_value)::numeric FROM employee_stats), 0),
            'total_visits', COALESCE((SELECT SUM(visit_count)::int FROM employee_stats), 0),
            'total_collections', COALESCE((SELECT SUM(collection_amount)::numeric FROM employee_stats), 0),
            'best_performer', (SELECT jsonb_build_object('employee_id', employee_id, 'name', full_name, 'sales', sales_value)
                FROM employee_stats ORDER BY sales_value DESC LIMIT 1),
            'worst_performer', (SELECT jsonb_build_object('employee_id', employee_id, 'name', full_name, 'sales', sales_value)
                FROM employee_stats WHERE session_id IS NOT NULL ORDER BY sales_value ASC LIMIT 1)
        )
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_live_workday_overview TO authenticated;

-- =============================================================
-- 4. grant for get_team_map (Phase A used last_activity, verified)
-- 5. grant for get_coverage_map (Phase A, verified)
-- لا تغيير مطلوب — Phase A صحيح وموجود بالفعل
-- =============================================================

-- =============================================================
-- 6. get_my_workday_status — إضافة net = حضور للمندوبين
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_my_workday_status(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_workday record;
    v_break_total_seconds numeric := 0;
    v_break_count int := 0;
    v_duration_minutes numeric;
    v_net_work_minutes numeric;
    v_last_activity timestamptz;
    v_connection_status text;
    v_policy record;
    v_use_net_calc boolean := true;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT * INTO v_policy FROM public.employee_work_policies WHERE employee_id = v_session.employee_id;
    v_use_net_calc := (COALESCE(v_policy.schedule_type, 'fixed_shift') = 'fixed_shift');

    SELECT wds.id, wds.date, wds.start_time, wds.end_time, wds.status, wds.latitude, wds.longitude,
        wds.last_seen_at, wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
        wds.visit_count, wds.total_distance_meters
    INTO v_workday
    FROM public.workday_sessions wds
    WHERE wds.employee_id = v_session.employee_id AND wds.date = CURRENT_DATE
    ORDER BY CASE WHEN wds.status = 'active' THEN 0 ELSE 1 END, wds.start_time DESC
    LIMIT 1;

    IF v_workday.id IS NOT NULL THEN
        v_duration_minutes := EXTRACT(EPOCH FROM (now() - v_workday.start_time)) / 60;

        SELECT COALESCE(SUM(duration_seconds), 0), COUNT(*)
        INTO v_break_total_seconds, v_break_count
        FROM public.workday_breaks
        WHERE session_id = v_workday.id;

        IF v_use_net_calc THEN
            v_net_work_minutes := v_duration_minutes - (v_break_total_seconds / 60);
        ELSE
            v_net_work_minutes := v_duration_minutes;
        END IF;

        SELECT COALESCE(
            v_workday.last_seen_at,
            (SELECT MAX(recorded_at) FROM public.tracking_points WHERE session_id = v_workday.id),
            v_workday.start_time
        ) INTO v_last_activity;

        v_connection_status := CASE
            WHEN v_last_activity IS NULL THEN 'no_data'
            WHEN v_last_activity > now() - interval '5 minutes' THEN 'connected'
            WHEN v_last_activity > now() - interval '25 minutes' THEN 'delayed'
            ELSE 'lost'
        END;
    END IF;

    RETURN jsonb_build_object(
        'has_active_session', v_workday.id IS NOT NULL AND v_workday.status = 'active',
        'session_id', v_workday.id,
        'date', v_workday.date,
        'start_time', v_workday.start_time,
        'status', v_workday.status,
        'duration_minutes', ROUND(v_duration_minutes)::int,
        'net_work_minutes', GREATEST(ROUND(v_net_work_minutes), 0)::int,
        'break_total_seconds', v_break_total_seconds::int,
        'break_count', v_break_count,
        'latitude', v_workday.latitude,
        'longitude', v_workday.longitude,
        'last_seen_at', v_workday.last_seen_at,
        'last_activity_at', v_last_activity,
        'connection_status', v_connection_status,
        'attendance_status', v_workday.attendance_status,
        'late_minutes', v_workday.late_minutes,
        'early_departure_minutes', v_workday.early_departure_minutes,
        'visit_count', v_workday.visit_count,
        'total_distance_meters', v_workday.total_distance_meters,
        'schedule_type', COALESCE(v_policy.schedule_type, 'fixed_shift')
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_workday_status TO authenticated;
