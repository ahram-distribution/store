-- ============================================================================
-- شاشة الحضور والمتابعة — الجزء 3: قائمة الموظفين (الجدول الرئيسي)
-- ============================================================================
-- get_executive_followup_list:
--   قائمة الموظفين بمجموع الفترة + الحالة اللحظية + الاتصال + آخر موقع، مع
--   فلاتر وبحث وترتيب وتقسيم صفحات كلها على الخادم (Payload خفيف عند البداية).
--
-- الفلاتر:
--   p_search       بحث في الاسم/الكود (ILIKE).
--   p_connection   connected | delayed | lost | no_data (حالة اتصال موثقة آنية).
--   p_attendance   عند الوضع اللحظي (الفترة تشمل اليوم): working | on_visit |
--                  on_break | no_start | ended | auto_closed | late | early.
--                  خارج الوضع اللحظي: late | early | auto_closed | absent
--                  (مبنية على أيام الفترة).
--   p_sort         name | sales | present | days | connection
--   ترتيب الحالة اللحظية: no_start → on_visit → on_break → working → ended/auto_closed.
--   على_الزيارة = زيارة مفعلة (status='active') تم تسجيل الدخول فيها
--                دون تسجيل خروج (check_out_at IS NULL) — مصدر حقيقي.
--   شارة غياب/تاريخية: الموظفون غير النشطين يظهرون بعلم is_active=false
--   (للإدارة العليا كامل القوى العاملة؛ لغير العليا النطاق الجاري فقط).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_executive_followup_list(
    p_token uuid,
    p_from date DEFAULT CURRENT_DATE,
    p_to date DEFAULT CURRENT_DATE,
    p_include_inactive boolean DEFAULT true,
    p_search text DEFAULT NULL,
    p_connection text DEFAULT NULL,
    p_attendance text DEFAULT NULL,
    p_page integer DEFAULT 0,
    p_page_size integer DEFAULT 100,
    p_sort text DEFAULT 'name'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
    v_session app.sessions;
    v_visible uuid[];
    v_include_live boolean;
    v_timeout_minutes integer;
    v_interval_seconds numeric;
    v_off_start text;
    v_off_end text;
    v_sort text;
    v_page_size int;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    -- هذه الشاشة للإدارة العليا فقط: نفس مسند is_upper_management الكنسي
    -- (دور الإدارة العليا) دون استثناء المشرف التنفيذي الخاص بمساحات أخرى،
    -- وبدون بديل عبر check_capability.
    IF NOT EXISTS (
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
          AND r.name = 'الإدارة العليا'
    ) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_visible := public.get_visible_employee_ids(v_session.token::text);
    IF v_visible IS NULL OR array_length(v_visible, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_VISIBLE_EMPLOYEES');
    END IF;

    v_include_live := (p_from <= CURRENT_DATE AND p_to >= CURRENT_DATE);

    SELECT COALESCE(inactivity_timeout_minutes, 60)::int INTO v_timeout_minutes
    FROM public.workday_settings LIMIT 1;
    SELECT COALESCE(location_interval_seconds, 300)::numeric INTO v_interval_seconds
    FROM public.workday_settings LIMIT 1;
    SELECT COALESCE(official_start_time::text, '09:00') INTO v_off_start FROM public.workday_settings LIMIT 1;
    SELECT COALESCE(official_end_time::text, '17:00') INTO v_off_end FROM public.workday_settings LIMIT 1;

    v_sort := COALESCE(NULLIF(p_sort, ''), 'name');
    v_page_size := LEAST(GREATEST(COALESCE(p_page_size, 100), 1), 500);

    RETURN (
        WITH ve AS (
            SELECT e.id AS employee_id, e.code, COALESCE(NULLIF(e.full_name, ''), e.code) AS full_name,
                   COALESCE((SELECT r.name FROM public.employee_roles er2
                             JOIN public.roles r ON r.id = er2.role_id
                             WHERE er2.employee_id = e.id LIMIT 1), '') AS role_name,
                   e.is_active, e.manager_id,
                   ewp.work_location, ewp.schedule_type, ewp.required_daily_hours,
                   ewp.shift_start_time, ewp.shift_end_time
            FROM public.employees e
            LEFT JOIN public.employee_work_policies ewp ON ewp.employee_id = e.id
            WHERE e.id = ANY(v_visible)
              AND (p_include_inactive OR e.is_active)
        ),
        ss AS (
            SELECT wds.id AS session_id, wds.employee_id, wds.date, wds.start_time, wds.end_time,
                   wds.status, wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
                   wds.close_reason, wds.visit_count, COALESCE(wds.total_distance_meters, 0) AS distance_meters,
                   wds.start_latitude, wds.start_longitude, wds.end_latitude, wds.end_longitude,
                   wds.last_seen_at
            FROM public.workday_sessions wds
            WHERE wds.employee_id = ANY(v_visible)
              AND wds.date >= p_from AND wds.date <= p_to
        ),
        br AS (
            SELECT wb.session_id,
                   COUNT(*)::int AS break_count,
                   COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0) AS break_seconds,
                   COUNT(*) FILTER (WHERE wb.break_end IS NULL)::int AS active_break_count
            FROM public.workday_breaks wb
            JOIN public.workday_sessions w2 ON w2.id = wb.session_id
            WHERE w2.employee_id = ANY(v_visible)
              AND w2.date >= p_from AND w2.date <= p_to
            GROUP BY wb.session_id
        ),
        od AS (
            SELECT public.resolve_employee_id(o.owner_id) AS eid,
                   COUNT(*)::int AS order_count,
                   COALESCE(SUM(o.total_amount), 0) AS sales_value
            FROM public.orders o
            WHERE o.status NOT IN ('draft', 'cancelled')
              AND o.created_at::date >= p_from AND o.created_at::date <= p_to
              AND public.resolve_employee_id(o.owner_id) = ANY(v_visible)
            GROUP BY public.resolve_employee_id(o.owner_id)
        ),
        cd AS (
            SELECT public.resolve_employee_id(c.owner_id) AS eid,
                   COUNT(*)::int AS collection_count,
                   COALESCE(SUM(c.amount), 0) AS collection_amount
            FROM public.collections c
            WHERE c.created_at::date >= p_from AND c.created_at::date <= p_to
              AND public.resolve_employee_id(c.owner_id) = ANY(v_visible)
            GROUP BY public.resolve_employee_id(c.owner_id)
        ),
        nd AS (
            SELECT public.resolve_employee_id(c2.owner_id) AS eid, COUNT(*)::int AS new_customer_count
            FROM public.customers c2
            WHERE c2.created_at::date >= p_from AND c2.created_at::date <= p_to
              AND public.resolve_employee_id(c2.owner_id) = ANY(v_visible)
            GROUP BY public.resolve_employee_id(c2.owner_id)
        ),
        vs AS (
            SELECT v.employee_id,
                   COUNT(*)::int AS visit_count,
                   COUNT(*) FILTER (WHERE v.status = 'active' AND v.check_out_at IS NULL)::int AS open_visit_count,
                   MAX(v.check_in_at) AS last_visit_at
            FROM public.visits v
            WHERE v.employee_id = ANY(v_visible)
              AND v.check_in_at::date >= p_from AND v.check_in_at::date <= p_to
            GROUP BY v.employee_id
        ),
        live_sessions AS (
            SELECT DISTINCT ON (wds.employee_id)
                wds.id AS session_id, wds.employee_id, wds.start_time, wds.end_time, wds.status,
                wds.attendance_status, wds.late_minutes, wds.early_departure_minutes, wds.close_reason,
                wds.last_seen_at, COALESCE(wds.total_distance_meters, 0) AS distance_meters
            FROM public.workday_sessions wds
            WHERE wds.employee_id = ANY(v_visible) AND wds.date = CURRENT_DATE
            ORDER BY wds.employee_id, wds.start_time DESC NULLS LAST
        ),
        today_breaks AS (
            SELECT wb.session_id,
                   COUNT(*) FILTER (WHERE wb.break_end IS NULL)::int AS active_break_count,
                   COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0) AS live_break_seconds
            FROM public.workday_breaks wb
            JOIN live_sessions l ON l.session_id = wb.session_id
            GROUP BY wb.session_id
        ),
        last_activity AS (
            SELECT DISTINCT ON (employee_id)
                employee_id, activity_at AS last_activity_at, activity_type AS last_activity_type
            FROM (
                SELECT l.employee_id, l.last_seen_at AS activity_at, 'heartbeat' AS activity_type
                FROM live_sessions l WHERE l.last_seen_at IS NOT NULL
                UNION ALL
                SELECT tp.employee_id, tp.recorded_at, 'gps'
                FROM public.tracking_points tp
                WHERE tp.employee_id = ANY(v_visible) AND tp.recorded_at > now() - interval '24 hours'
                UNION ALL
                SELECT v.employee_id, v.check_in_at, 'visit'
                FROM public.visits v
                WHERE v.employee_id = ANY(v_visible) AND v.check_in_at > now() - interval '24 hours'
                UNION ALL
                SELECT public.resolve_employee_id(o.owner_id), o.created_at, 'order'
                FROM public.orders o
                WHERE public.resolve_employee_id(o.owner_id) = ANY(v_visible)
                  AND o.created_at > now() - interval '24 hours'
                UNION ALL
                SELECT public.resolve_employee_id(c.owner_id), c.created_at, 'collection'
                FROM public.collections c
                WHERE public.resolve_employee_id(c.owner_id) = ANY(v_visible)
                  AND c.created_at > now() - interval '24 hours'
            ) ca
            ORDER BY employee_id, activity_at DESC NULLS LAST
        ),
        last_loc AS (
            SELECT DISTINCT ON (tp.employee_id)
                tp.employee_id, tp.latitude, tp.longitude, tp.recorded_at AS at
            FROM public.tracking_points tp
            WHERE tp.employee_id = ANY(v_visible)
              AND tp.recorded_at > now() - interval '30 days'
            ORDER BY tp.employee_id, tp.recorded_at DESC
        ),
        staff AS (
            SELECT
                ve.employee_id, ve.code, ve.full_name, ve.role_name, ve.is_active, ve.manager_id,
                ve.work_location, ve.schedule_type, ve.required_daily_hours,
                ve.shift_start_time, ve.shift_end_time,
                COUNT(DISTINCT ss.date)::int AS worked_days,
                COALESCE(SUM(
                    CASE WHEN ss.date IS NULL THEN 0
                         WHEN COALESCE(ve.schedule_type, 'fixed_shift') = 'fixed_shift'
                         THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(ss.end_time, now()) - ss.start_time)) / 60
                                       - COALESCE(br.break_seconds, 0)::numeric / 60, 0)
                         ELSE EXTRACT(EPOCH FROM (COALESCE(ss.end_time, now()) - ss.start_time)) / 60
                    END
                ), 0)::int AS present_minutes,
                COALESCE(SUM(COALESCE(br.break_count, 0)), 0)::int AS break_count,
                COALESCE(SUM(COALESCE(br.break_seconds, 0)), 0)::int AS break_seconds,
                COUNT(DISTINCT ss.date) FILTER (WHERE ss.attendance_status = 'late')::int AS late_days,
                COALESCE(SUM(COALESCE(ss.late_minutes, 0)), 0)::int AS late_minutes_total,
                COUNT(DISTINCT ss.date) FILTER (WHERE ss.attendance_status = 'early_departure' OR ss.early_departure_minutes > 0)::int AS early_days,
                COALESCE(SUM(COALESCE(ss.early_departure_minutes, 0)), 0)::int AS early_minutes_total,
                COUNT(DISTINCT ss.date) FILTER (WHERE ss.close_reason IN ('auto_closed_inactivity', 'no_activity_timeout'))::int AS auto_closed_days,
                COALESCE(SUM(ss.distance_meters), 0)::numeric AS distance_meters,
                COALESCE(od.order_count, 0)::int AS order_count,
                COALESCE(od.sales_value, 0)::numeric AS sales_value,
                COALESCE(cd.collection_count, 0)::int AS collection_count,
                COALESCE(cd.collection_amount, 0)::numeric AS collection_amount,
                COALESCE(nd.new_customer_count, 0)::int AS new_customer_count,
                COALESCE(vs.visit_count, 0)::int AS visit_count,
                COALESCE(vs.open_visit_count, 0)::int AS open_visit_count,
                ls.session_id AS live_session_id, ls.start_time AS live_start_time, ls.end_time AS live_end_time,
                ls.status AS live_session_status, ls.attendance_status AS live_attendance_status,
                ls.late_minutes AS live_late_minutes, ls.early_departure_minutes AS live_early_minutes,
                ls.close_reason AS live_close_reason, ls.last_seen_at AS live_last_seen_at,
                ls.distance_meters AS live_distance_meters,
                COALESCE(tb.active_break_count, 0) AS active_break_count_now,
                COALESCE(tb.live_break_seconds, 0) AS live_break_seconds,
                la.last_activity_at, la.last_activity_type,
                CASE
                    WHEN la.last_activity_at IS NULL THEN 'no_data'
                    WHEN la.last_activity_at > now() - (v_interval_seconds::text || ' seconds')::interval THEN 'connected'
                    WHEN la.last_activity_at > now() - ((v_interval_seconds * 5)::text || ' seconds')::interval THEN 'delayed'
                    ELSE 'lost'
                END AS connection_status,
                ll.latitude, ll.longitude, ll.at AS last_loc_at
            FROM ve
            LEFT JOIN ss ON ss.employee_id = ve.employee_id
            LEFT JOIN br ON br.session_id = ss.session_id
            LEFT JOIN od ON od.eid = ve.employee_id
            LEFT JOIN cd ON cd.eid = ve.employee_id
            LEFT JOIN nd ON nd.eid = ve.employee_id
            LEFT JOIN vs ON vs.employee_id = ve.employee_id
            LEFT JOIN live_sessions ls ON ls.employee_id = ve.employee_id
            LEFT JOIN today_breaks tb ON tb.session_id = ls.session_id
            LEFT JOIN last_activity la ON la.employee_id = ve.employee_id
            LEFT JOIN last_loc ll ON ll.employee_id = ve.employee_id
            GROUP BY ve.employee_id, ve.code, ve.full_name, ve.role_name, ve.is_active, ve.manager_id,
                     ve.work_location, ve.schedule_type, ve.required_daily_hours,
                     ve.shift_start_time, ve.shift_end_time,
                     ls.session_id, ls.start_time, ls.end_time, ls.status,
                     ls.attendance_status, ls.late_minutes, ls.early_departure_minutes,
                     ls.close_reason, ls.last_seen_at, ls.distance_meters,
                     tb.active_break_count, tb.live_break_seconds, la.last_activity_at, la.last_activity_type,
                     ll.latitude, ll.longitude, ll.at,
                     od.order_count, od.sales_value,
                     cd.collection_count, cd.collection_amount,
                     nd.new_customer_count,
                     vs.visit_count, vs.open_visit_count
        ),
        live_status AS (
            SELECT s.employee_id,
                   CASE
                       WHEN NOT v_include_live THEN NULL
                       WHEN s.live_session_id IS NULL THEN 'no_start'
                       WHEN s.live_session_status = 'completed' THEN
                           CASE WHEN COALESCE(s.live_close_reason, '') IN ('auto_closed_inactivity', 'no_activity_timeout', 'day_rollover')
                                THEN 'auto_closed' ELSE 'ended' END
                       WHEN s.open_visit_count > 0 THEN 'on_visit'
                       WHEN s.active_break_count_now > 0 THEN 'on_break'
                       ELSE 'working'
                   END AS status,
                   CASE WHEN s.live_session_id IS NOT NULL
                        THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(s.live_end_time, now()) - s.live_start_time)) / 60, 0)::int
                        ELSE NULL END AS elapsed_minutes,
                   CASE WHEN s.live_session_id IS NOT NULL
                        THEN CASE WHEN COALESCE(s.schedule_type, 'fixed_shift') = 'fixed_shift'
                                  THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(s.live_end_time, now()) - s.live_start_time)) / 60
                                                - COALESCE(s.live_break_seconds, 0)::numeric / 60, 0)::int
                                  ELSE EXTRACT(EPOCH FROM (COALESCE(s.live_end_time, now()) - s.live_start_time)) / 60::int
                             END
                        ELSE NULL END AS live_net_minutes
           FROM staff s
        ),
        filtered AS (
            SELECT st.*, lv.status AS disp_status, lv.elapsed_minutes, lv.live_net_minutes
            FROM staff st
            LEFT JOIN live_status lv ON lv.employee_id = st.employee_id
            WHERE (p_search IS NULL OR p_search = ''
                   OR st.full_name ILIKE '%' || p_search || '%'
                   OR st.code ILIKE '%' || p_search || '%')
              AND (p_connection IS NULL OR p_connection = ''
                   OR st.connection_status = p_connection)
              AND (
                   p_attendance IS NULL OR p_attendance = ''
                   OR (v_include_live AND lv.status = p_attendance)
                   OR (v_include_live AND p_attendance = 'late' AND st.live_attendance_status = 'late')
                   OR (v_include_live AND p_attendance = 'early' AND (st.live_attendance_status = 'early_departure' OR st.live_early_minutes > 0))
                   OR (NOT v_include_live AND p_attendance = 'late' AND st.late_days > 0)
                   OR (NOT v_include_live AND p_attendance = 'early' AND st.early_days > 0)
                   OR (NOT v_include_live AND p_attendance = 'auto_closed' AND st.auto_closed_days > 0)
                   OR (NOT v_include_live AND p_attendance = 'absent' AND st.is_active AND st.worked_days = 0)
              )
        )
        SELECT jsonb_build_object(
            'error', NULL,
            'live_mode', v_include_live,
            'total', (SELECT COUNT(*)::int FROM filtered),
            'period', jsonb_build_object('from', p_from, 'to', p_to),
            'policy', jsonb_build_object(
                'inactivity_timeout_minutes', v_timeout_minutes,
                'location_interval_seconds', v_interval_seconds
            ),
            'employees', COALESCE((
                SELECT jsonb_agg(pj.row_json) FROM (
                    SELECT jsonb_build_object(
                        'employee_id', f.employee_id, 'code', f.code, 'name', f.full_name,
                        'role_name', f.role_name, 'is_active', f.is_active, 'manager_id', f.manager_id,
                        'work_location', f.work_location, 'schedule_type', f.schedule_type,
                        'required_daily_hours', f.required_daily_hours,
                        'official_start_time', COALESCE(f.shift_start_time::text, v_off_start),
                        'official_end_time', COALESCE(f.shift_end_time::text, v_off_end),
                        'period', jsonb_build_object(
                            'worked_days', f.worked_days, 'present_minutes', f.present_minutes,
                            'break_count', f.break_count, 'break_minutes', (f.break_seconds / 60)::int,
                            'late_days', f.late_days, 'late_minutes_total', f.late_minutes_total,
                            'early_days', f.early_days, 'early_minutes_total', f.early_minutes_total,
                            'auto_closed_days', f.auto_closed_days,
                            'orders', f.order_count, 'sales', f.sales_value,
                            'visits', f.visit_count, 'collections', f.collection_count,
                            'collection_amount', f.collection_amount,
                            'new_customers', f.new_customer_count,
                            'distance_meters', ROUND(f.distance_meters, 1)
                        ),
                        'connection_status', f.connection_status,
                        'last_activity_at', f.last_activity_at,
                        'last_activity_type', f.last_activity_type,
                        'live', CASE WHEN v_include_live THEN jsonb_build_object(
                            'session_id', f.live_session_id,
                            'status', f.disp_status,
                            'attendance_status', f.live_attendance_status,
                            'late_minutes', f.live_late_minutes,
                            'early_departure_minutes', f.live_early_minutes,
                            'close_reason', f.live_close_reason,
                            'start_time', f.live_start_time, 'end_time', f.live_end_time,
                            'elapsed_minutes', f.elapsed_minutes,
                            'net_minutes', f.live_net_minutes,
                            'on_visit', f.open_visit_count > 0,
                            'on_break', f.active_break_count_now > 0,
                            'active_break_count', f.active_break_count_now,
                            'last_seen_at', f.live_last_seen_at,
                            'distance_meters', ROUND(f.live_distance_meters, 1),
                            'progress_pct', CASE WHEN COALESCE(f.required_daily_hours, 8) > 0 AND f.live_net_minutes IS NOT NULL THEN
                                LEAST(ROUND((f.live_net_minutes / (COALESCE(f.required_daily_hours, 8) * 60)) * 100)::numeric, 999) ELSE NULL END,
                            'last_location', jsonb_build_object(
                                'latitude', f.latitude, 'longitude', f.longitude,
                                'at', f.last_loc_at,
                                'source', CASE WHEN f.latitude IS NOT NULL THEN 'tracking' ELSE 'none' END,
                                'has_location', f.latitude IS NOT NULL AND f.longitude IS NOT NULL,
                                'freshness', CASE
                                    WHEN f.last_loc_at IS NULL THEN 'none'
                                    WHEN f.last_loc_at > now() - (v_interval_seconds::text || ' seconds')::interval THEN 'live'
                                    WHEN f.last_loc_at > now() - ((v_interval_seconds * 5)::text || ' seconds')::interval THEN 'fresh'
                                    ELSE 'stale'
                                END,
                                'age_seconds', CASE WHEN f.last_loc_at IS NOT NULL
                                    THEN EXTRACT(EPOCH FROM (now() - f.last_loc_at))::int ELSE NULL END
                            ),
                            'last_event', jsonb_build_object(
                                'type', f.last_activity_type, 'at', f.last_activity_at,
                                'has_event', f.last_activity_at IS NOT NULL
                            )
                        ) ELSE NULL END
                    ) AS row_json
                    FROM filtered f
                    ORDER BY
                        CASE v_sort WHEN 'name' THEN f.full_name END ASC NULLS LAST,
                        CASE v_sort WHEN 'sales' THEN f.sales_value END DESC NULLS LAST,
                        CASE v_sort WHEN 'present' THEN f.present_minutes END DESC NULLS LAST,
                        CASE v_sort WHEN 'days' THEN f.worked_days END DESC NULLS LAST,
                        CASE v_sort WHEN 'connection' THEN
                            (CASE f.connection_status WHEN 'lost' THEN 0 WHEN 'delayed' THEN 1 WHEN 'connected' THEN 2 ELSE 3 END)
                        END ASC NULLS LAST
                    LIMIT v_page_size OFFSET (GREATEST(p_page, 0) * v_page_size)
                ) pj
            ), '[]'::jsonb)
        ) LIMIT 1
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_followup_list TO authenticated;