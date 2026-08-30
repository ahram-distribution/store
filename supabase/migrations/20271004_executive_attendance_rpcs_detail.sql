-- ============================================================================
-- شاشة الحضور والمتابعة — الجزء 4: تفاصيل يوم الموظف + الخط الزمني التسلسلي
-- ============================================================================
-- get_executive_employee_day_detail:
--   بيانات يوم كاملة لموظف واحد (سياسة/جلسة/زمن عمل/استراحات/زيارات/طلبات/
--   تحصيلات/عملاء جدد/آخر نشاط/موقع اليوم/مقارنة مع اليوم السابق/إغلاق تلقائي).
--   يُستدعى من ورشة تفاصيل الموظف (Drawer).
--
-- get_executive_day_timeline:
--   خط زمني تسلسلي حقيقي (زيارات/طلبات/تحصيلات/عملاء جدد/استراحات/نقاط تتبع)
--   مع فجوات صريحة (خمول ≥ 10 دقائق خارج أوقات الاستراحة) وقَمْع عند الكبر.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_executive_employee_day_detail(
    p_token uuid,
    p_employee_id uuid,
    p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
    v_session app.sessions;
    v_visible uuid[];
    v_timeout_minutes integer;
    v_has_view_all boolean;
    v_employee record;
    v_policy record;
    v_session_id uuid := NULL;
    v_sdate date := NULL;
    v_start timestamptz := NULL;
    v_end timestamptz := NULL;
    v_status text := NULL;
    v_attendance text := NULL;
    v_late int := NULL;
    v_early int := NULL;
    v_close text := NULL;
    v_visit_count int := NULL;
    v_distance numeric := NULL;
    v_last_seen timestamptz := NULL;
    v_start_lat numeric := NULL;
    v_start_lng numeric := NULL;
    v_end_lat numeric := NULL;
    v_end_lng numeric := NULL;
    v_net_minutes int;
    v_break_minutes int;
    v_break_count int;
    v_prev_day jsonb;
    v_row record;
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

    IF NOT (p_employee_id = ANY(v_visible)) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_has_view_all := public.check_capability(v_session.employee_id, 'attendance.view_all');
    SELECT COALESCE(inactivity_timeout_minutes, 60)::int INTO v_timeout_minutes
    FROM public.workday_settings LIMIT 1;

    SELECT e.*,
           COALESCE((SELECT r.name FROM public.employee_roles er2
                     JOIN public.roles r ON r.id = er2.role_id
                     WHERE er2.employee_id = e.id LIMIT 1), '') AS role_name
    INTO v_employee
    FROM public.employees e
    WHERE e.id = p_employee_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'EMPLOYEE_NOT_FOUND'); END IF;

    SELECT * INTO v_policy FROM public.employee_work_policies WHERE employee_id = p_employee_id;

    SELECT * INTO v_row
    FROM public.workday_sessions
    WHERE employee_id = p_employee_id AND date = p_date
    ORDER BY start_time NULLS LAST
    LIMIT 1;

    IF FOUND THEN
        v_session_id := v_row.id;
        v_sdate := v_row.date;
        v_start := v_row.start_time;
        v_end := v_row.end_time;
        v_status := v_row.status;
        v_attendance := v_row.attendance_status;
        v_late := v_row.late_minutes;
        v_early := v_row.early_departure_minutes;
        v_close := v_row.close_reason;
        v_visit_count := v_row.visit_count;
        v_distance := COALESCE(v_row.total_distance_meters, 0);
        v_last_seen := v_row.last_seen_at;
        v_start_lat := v_row.start_latitude;
        v_start_lng := v_row.start_longitude;
        v_end_lat := v_row.end_latitude;
        v_end_lng := v_row.end_longitude;

        IF COALESCE(v_policy.schedule_type, 'fixed_shift') = 'fixed_shift' THEN
            v_net_minutes := GREATEST(
                EXTRACT(EPOCH FROM (COALESCE(v_end, now()) - v_start)) / 60
                    - COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = v_session_id), 0)::numeric / 60, 0)::int;
        ELSE
            v_net_minutes := EXTRACT(EPOCH FROM (COALESCE(v_end, now()) - v_start)) / 60::int;
        END IF;
        SELECT COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) / 60 FROM public.workday_breaks wb WHERE wb.session_id = v_session_id), 0)::int,
               (SELECT COUNT(*) FROM public.workday_breaks wb WHERE wb.session_id = v_session_id)
        INTO v_break_minutes, v_break_count;
    END IF;

    -- مقارنة مع اليوم السابق (نفس التعريفات الموثقة)
    SELECT jsonb_build_object(
        'date', sp.date,
        'net_minutes', CASE WHEN sp.id IS NOT NULL
            THEN CASE WHEN COALESCE(v_policy.schedule_type, 'fixed_shift') = 'fixed_shift'
                 THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(sp.end_time, now()) - sp.start_time)) / 60
                               - COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = sp.id), 0)::numeric / 60, 0)::int
                 ELSE EXTRACT(EPOCH FROM (COALESCE(sp.end_time, now()) - sp.start_time)) / 60::int END
            ELSE NULL END,
        'orders', COALESCE((SELECT COUNT(*) FROM public.orders o
            WHERE public.resolve_employee_id(o.owner_id) = p_employee_id AND o.created_at::date = sp.date AND o.status NOT IN ('draft', 'cancelled')), 0)::int,
        'sales', COALESCE((SELECT SUM(o.total_amount) FROM public.orders o
            WHERE public.resolve_employee_id(o.owner_id) = p_employee_id AND o.created_at::date = sp.date AND o.status NOT IN ('draft', 'cancelled')), 0)::numeric,
        'visits', COALESCE((SELECT COUNT(*) FROM public.visits v WHERE v.employee_id = p_employee_id AND v.check_in_at::date = sp.date), 0)::int,
        'collections', COALESCE((SELECT SUM(c.amount) FROM public.collections c
            WHERE public.resolve_employee_id(c.owner_id) = p_employee_id AND c.created_at::date = sp.date), 0)::numeric
    ) INTO v_prev_day
    FROM public.workday_sessions sp WHERE sp.employee_id = p_employee_id AND sp.date = p_date - 1 LIMIT 1;

    IF v_prev_day IS NULL THEN
        v_prev_day := jsonb_build_object('date', p_date - 1, 'net_minutes', NULL, 'orders', 0, 'sales', 0, 'visits', 0, 'collections', 0);
    END IF;

    RETURN jsonb_build_object(
        'error', NULL,
        'employee', jsonb_build_object(
            'employee_id', v_employee.id, 'code', v_employee.code,
            'name', COALESCE(v_employee.full_name, v_employee.code),
            'role_name', v_employee.role_name, 'is_active', v_employee.is_active,
            'work_location', v_policy.work_location, 'schedule_type', v_policy.schedule_type,
            'required_daily_hours', v_policy.required_daily_hours,
            'shift_start_time', v_policy.shift_start_time::text, 'shift_end_time', v_policy.shift_end_time::text
        ),
        'policy', jsonb_build_object(
            'inactivity_timeout_minutes', v_timeout_minutes,
            'official_start_time', (SELECT official_start_time::text FROM public.workday_settings LIMIT 1),
            'official_end_time', (SELECT official_end_time::text FROM public.workday_settings LIMIT 1)
        ),
        'can_view_all', v_has_view_all,
        'permission_note', CASE WHEN NOT v_employee.is_active AND NOT v_has_view_all
            THEN 'الموظف غير نشط. يُعرض فقط للإدارة العليا/من بصلاحية رؤية كاملة.' ELSE NULL END,
        'session', CASE WHEN v_session_id IS NOT NULL THEN jsonb_build_object(
            'session_id', v_session_id, 'date', v_sdate,
            'start_time', v_start, 'end_time', v_end,
            'status', v_status,
            'attendance_status', v_attendance,
            'late_minutes', v_late,
            'early_departure_minutes', v_early,
            'close_reason', v_close,
            'visit_count', v_visit_count,
            'distance_meters', ROUND(v_distance, 1),
            'elapsed_minutes', EXTRACT(EPOCH FROM (COALESCE(v_end, now()) - v_start)) / 60::int,
            'net_minutes', v_net_minutes,
            'last_seen_at', v_last_seen
        ) ELSE NULL END,
        'working_time', CASE WHEN v_session_id IS NOT NULL THEN jsonb_build_object(
            'start', v_start, 'end', v_end,
            'elapsed_minutes', EXTRACT(EPOCH FROM (COALESCE(v_end, now()) - v_start)) / 60::int,
            'net_minutes', v_net_minutes,
            'break_minutes', v_break_minutes,
            'break_count', v_break_count
        ) ELSE NULL END,
        'breaks', CASE WHEN v_session_id IS NOT NULL THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', wb.id, 'break_start', wb.break_start, 'break_end', wb.break_end,
                'duration_seconds', wb.duration_seconds, 'break_reason', wb.break_reason,
                'auto_closed', wb.auto_closed, 'latitude', wb.latitude, 'longitude', wb.longitude
            ) ORDER BY wb.break_start)
            FROM public.workday_breaks wb WHERE wb.session_id = v_session_id
        ), '[]'::jsonb) ELSE '[]'::jsonb END,
        'visits', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'visit_id', v.id, 'code', v.code, 'customer_id', v.customer_id,
                'status', v.status, 'check_in_at', v.check_in_at, 'check_out_at', v.check_out_at,
                'check_in_latitude', v.check_in_latitude, 'check_in_longitude', v.check_in_longitude,
                'check_out_latitude', v.check_out_latitude, 'check_out_longitude', v.check_out_longitude,
                'visit_result', v.visit_result, 'notes', v.notes,
                'customer_name', COALESCE(NULLIF(c.company_name, ''), c.code)
            ) ORDER BY v.check_in_at)
            FROM public.visits v
            LEFT JOIN public.customers c ON c.id = v.customer_id
            WHERE v.employee_id = p_employee_id AND v.check_in_at::date = p_date
        ), '[]'::jsonb),
        'orders', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'order_id', o.id, 'code', o.order_number, 'customer_id', o.customer_id,
                'status', o.status, 'total_amount', o.total_amount,
                'created_at', o.created_at, 'submitted_at', o.submitted_at,
                'customer_name', COALESCE(NULLIF(c.company_name, ''), c.code)
            ) ORDER BY o.created_at)
            FROM public.orders o
            LEFT JOIN public.customers c ON c.id = o.customer_id
            WHERE public.resolve_employee_id(o.owner_id) = p_employee_id
              AND o.created_at::date = p_date
              AND o.status NOT IN ('draft', 'cancelled')
        ), '[]'::jsonb),
        'collections', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'collection_id', col.id, 'code', col.code, 'customer_id', col.customer_id,
                'amount', col.amount, 'method', col.method, 'created_at', col.created_at,
                'customer_name', COALESCE(NULLIF(c.company_name, ''), c.code)
            ) ORDER BY col.created_at)
            FROM public.collections col
            LEFT JOIN public.customers c ON c.id = col.customer_id
            WHERE public.resolve_employee_id(col.owner_id) = p_employee_id
              AND col.created_at::date = p_date
        ), '[]'::jsonb),
        'new_customers', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'customer_id', c2.id, 'code', c2.code,
                'name', COALESCE(NULLIF(c2.company_name, ''), c2.code),
                'created_at', c2.created_at
            ) ORDER BY c2.created_at)
            FROM public.customers c2
            WHERE public.resolve_employee_id(c2.owner_id) = p_employee_id
              AND c2.created_at::date = p_date
        ), '[]'::jsonb),
        'connection_status', (
            SELECT CASE
                WHEN la.last_activity_at IS NULL THEN 'no_data'
                WHEN la.last_activity_at > now() - interval '5 minutes' THEN 'connected'
                WHEN la.last_activity_at > now() - interval '25 minutes' THEN 'delayed'
                ELSE 'lost' END
            FROM (
                SELECT DISTINCT ON (activity_at) activity_at AS last_activity_at
                FROM (
                    SELECT wds.last_seen_at AS activity_at FROM public.workday_sessions wds
                    WHERE wds.employee_id = p_employee_id AND wds.last_seen_at IS NOT NULL
                      AND wds.last_seen_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT tp.recorded_at FROM public.tracking_points tp
                    WHERE tp.employee_id = p_employee_id AND tp.recorded_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT v.check_in_at FROM public.visits v
                    WHERE v.employee_id = p_employee_id AND v.check_in_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT o.created_at FROM public.orders o
                    WHERE public.resolve_employee_id(o.owner_id) = p_employee_id
                      AND o.created_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT c.created_at FROM public.collections c
                    WHERE public.resolve_employee_id(c.owner_id) = p_employee_id
                      AND c.created_at > now() - interval '24 hours'
                ) ca ORDER BY activity_at DESC NULLS LAST
            ) la LIMIT 1
        ),
        'day_location', CASE WHEN v_session_id IS NOT NULL THEN (
            SELECT jsonb_build_object(
                'latitude', COALESCE((SELECT tp.latitude FROM public.tracking_points tp
                    WHERE tp.session_id = v_session_id ORDER BY tp.recorded_at DESC LIMIT 1),
                    v_end_lat, v_start_lat),
                'longitude', COALESCE((SELECT tp.longitude FROM public.tracking_points tp
                    WHERE tp.session_id = v_session_id ORDER BY tp.recorded_at DESC LIMIT 1),
                    v_end_lng, v_start_lng),
                'at', COALESCE((SELECT tp.recorded_at FROM public.tracking_points tp
                    WHERE tp.session_id = v_session_id ORDER BY tp.recorded_at DESC LIMIT 1),
                    COALESCE(v_end, v_start)),
                'source', CASE WHEN EXISTS (SELECT 1 FROM public.tracking_points tp
                        WHERE tp.session_id = v_session_id) THEN 'tracking'
                    WHEN v_end_lat IS NOT NULL THEN 'workday_end'
                    WHEN v_start_lat IS NOT NULL THEN 'workday_start'
                    ELSE 'none' END,
                'has_location', COALESCE((SELECT tp.latitude FROM public.tracking_points tp
                    WHERE tp.session_id = v_session_id ORDER BY tp.recorded_at DESC LIMIT 1),
                    v_end_lat, v_start_lat) IS NOT NULL
            )
        ) ELSE NULL END,
        'last_event', (
            SELECT jsonb_build_object(
                'type', la.activity_type, 'at', la.activity_at, 'has_event', la.activity_at IS NOT NULL
            )
            FROM (
                SELECT DISTINCT ON (activity_at) activity_at, activity_type
                FROM (
                    SELECT wds.last_seen_at AS activity_at, 'heartbeat' AS activity_type
                    FROM public.workday_sessions wds
                    WHERE wds.employee_id = p_employee_id AND wds.last_seen_at IS NOT NULL
                    UNION ALL
                    SELECT tp.recorded_at, 'gps' FROM public.tracking_points tp
                    WHERE tp.employee_id = p_employee_id AND tp.recorded_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT v.check_in_at, 'visit' FROM public.visits v
                    WHERE v.employee_id = p_employee_id AND v.check_in_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT o.created_at, 'order' FROM public.orders o
                    WHERE public.resolve_employee_id(o.owner_id) = p_employee_id
                      AND o.created_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT c.created_at, 'collection' FROM public.collections c
                    WHERE public.resolve_employee_id(c.owner_id) = p_employee_id
                      AND c.created_at > now() - interval '24 hours'
                ) ca ORDER BY activity_at DESC NULLS LAST
            ) la LIMIT 1
        ),
        'auto_close', CASE WHEN v_session_id IS NOT NULL
             AND v_close IN ('auto_closed_inactivity', 'no_activity_timeout', 'day_rollover') THEN jsonb_build_object(
                'reason', v_close,
                'reason_label', CASE v_close
                    WHEN 'auto_closed_inactivity' THEN 'إغلاق تلقائي لعدم النشاط'
                    WHEN 'no_activity_timeout' THEN 'انتهاء مهلة النشاط'
                    WHEN 'day_rollover' THEN 'انتقال يومي (منتصف الليل)' END,
                'policy_minutes', v_timeout_minutes
            ) ELSE NULL END,
        'comparison', jsonb_build_object('prev_day', v_prev_day)
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_employee_day_detail TO authenticated;

-- ----------------------------------------------------------------------------
-- get_executive_day_timeline — خط زمني تسلسلي حقيقي + فجوات صريحة
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_executive_day_timeline(
    p_token uuid,
    p_employee_id uuid,
    p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
    v_session app.sessions;
    v_visible uuid[];
    v_session_id uuid := NULL;
    v_session_start timestamptz := NULL;
    v_session_end timestamptz := NULL;
    v_session_status text := NULL;
    v_session_close text := NULL;
    v_row record;
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
    IF NOT (p_employee_id = ANY(v_visible)) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT * INTO v_row
    FROM public.workday_sessions
    WHERE employee_id = p_employee_id AND date = p_date
    ORDER BY start_time NULLS LAST
    LIMIT 1;

    IF FOUND THEN
        v_session_id := v_row.id;
        v_session_start := v_row.start_time;
        v_session_end := v_row.end_time;
        v_session_status := v_row.status;
        v_session_close := v_row.close_reason;
    END IF;

    RETURN (
        WITH breaks AS (
            SELECT wb.id, wb.break_start, wb.break_end
            FROM public.workday_breaks wb
            WHERE wb.session_id = v_session_id
        ),
        ev AS (
            SELECT e.t, e.type, e.label, e.detail, e.latitude, e.longitude, e.location_source
            FROM (
                SELECT wds.start_time AS t, 'workday_start'::text AS type, 'بدء يوم العمل'::text AS label,
                       ''::text AS detail, wds.start_latitude AS latitude, wds.start_longitude AS longitude,
                       CASE WHEN wds.start_latitude IS NOT NULL THEN 'workday_start'::text ELSE NULL END AS location_source
                FROM public.workday_sessions wds WHERE wds.id = v_session_id AND wds.start_time IS NOT NULL
                UNION ALL
                SELECT wb.break_start, 'break_start', 'بدء استراحة',
                       COALESCE(wb.break_reason, ''), wb.latitude, wb.longitude,
                       CASE WHEN wb.latitude IS NOT NULL THEN 'break' END
                FROM public.workday_breaks wb WHERE wb.session_id = v_session_id AND wb.break_start IS NOT NULL
                UNION ALL
                SELECT wb.break_end, 'break_end', 'نهاية استراحة',
                       COALESCE(wb.break_reason, ''), wb.latitude, wb.longitude,
                       CASE WHEN wb.latitude IS NOT NULL THEN 'break' END
                FROM public.workday_breaks wb WHERE wb.session_id = v_session_id AND wb.break_end IS NOT NULL
                UNION ALL
                SELECT v.check_in_at, 'visit_checkin', 'تسجيل حضور زيارة',
                       COALESCE(v.code, '') || COALESCE(' — ' || COALESCE(NULLIF(c.company_name, ''), c.code), ''),
                       v.check_in_latitude, v.check_in_longitude,
                       CASE WHEN v.check_in_latitude IS NOT NULL THEN 'visit' END
                FROM public.visits v LEFT JOIN public.customers c ON c.id = v.customer_id
                WHERE v.employee_id = p_employee_id AND v.check_in_at::date = p_date AND v.check_in_at IS NOT NULL
                UNION ALL
                SELECT v.check_out_at, 'visit_checkout', 'تسجيل خروج زيارة',
                       COALESCE(v.code, '') || COALESCE(' — ' || COALESCE(NULLIF(c.company_name, ''), c.code), ''),
                       v.check_out_latitude, v.check_out_longitude,
                       CASE WHEN v.check_out_latitude IS NOT NULL THEN 'visit' END
                FROM public.visits v LEFT JOIN public.customers c ON c.id = v.customer_id
                WHERE v.employee_id = p_employee_id AND v.check_in_at::date = p_date AND v.check_out_at IS NOT NULL
                UNION ALL
                SELECT o.created_at, 'order', 'طلب',
                       COALESCE(o.order_number, '') || COALESCE(' — ' || o.total_amount::text, ''),
                       NULL, NULL, NULL
                FROM public.orders o
                WHERE public.resolve_employee_id(o.owner_id) = p_employee_id
                  AND o.created_at::date = p_date AND o.status NOT IN ('draft', 'cancelled')
                  AND o.created_at IS NOT NULL
                UNION ALL
                SELECT col.created_at, 'collection', 'تحصيل',
                       COALESCE(col.code, '') || COALESCE(' — ' || col.amount::text, ''),
                       NULL, NULL, NULL
                FROM public.collections col
                WHERE public.resolve_employee_id(col.owner_id) = p_employee_id
                  AND col.created_at::date = p_date AND col.created_at IS NOT NULL
                UNION ALL
                SELECT c2.created_at, 'customer', 'عميل جديد',
                       COALESCE(c2.code, '') || COALESCE(' — ' || COALESCE(NULLIF(c2.company_name, ''), c2.code), ''),
                       NULL, NULL, NULL
                FROM public.customers c2
                WHERE public.resolve_employee_id(c2.owner_id) = p_employee_id
                  AND c2.created_at::date = p_date AND c2.created_at IS NOT NULL
                UNION ALL
                SELECT tp.recorded_at, 'tracking'::text, 'نقطة تتبع',
                       tp.point_type::text, tp.latitude, tp.longitude, 'tracking'::text
                FROM public.tracking_points tp
                WHERE tp.session_id = v_session_id AND tp.recorded_at IS NOT NULL
                UNION ALL
                SELECT wds.end_time, 'workday_end', 'إنهاء يوم العمل', COALESCE(wds.close_reason, ''),
                       wds.end_latitude, wds.end_longitude,
                       CASE WHEN wds.end_latitude IS NOT NULL THEN 'workday_end' END
                FROM public.workday_sessions wds WHERE wds.id = v_session_id AND wds.end_time IS NOT NULL
            ) e
            WHERE e.t IS NOT NULL
        ),
        ord AS (
            SELECT e.t, e.type, e.label, e.detail, e.latitude, e.longitude, e.location_source,
                   LAG(e.t) OVER (ORDER BY e.t) AS prev_t
            FROM ev e
        ),
        with_gaps AS (
            SELECT o.*,
                   CASE WHEN o.prev_t IS NOT NULL
                        AND EXTRACT(EPOCH FROM (o.t - o.prev_t)) / 60 >= 10
                        AND NOT EXISTS (
                            SELECT 1 FROM breaks b
                            WHERE b.break_start <= o.t AND COALESCE(b.break_end, o.t) > o.prev_t
                        )
                        AND (v_session_start IS NULL OR v_session_start <= o.t)
                   THEN (EXTRACT(EPOCH FROM (o.t - o.prev_t)) / 60)::int
                   ELSE 0 END AS gap_minutes
            FROM ord o
        )
        SELECT jsonb_build_object(
            'error', NULL,
            'date', p_date,
            'employee_id', p_employee_id,
            'session', CASE WHEN v_session_id IS NOT NULL THEN jsonb_build_object(
                'session_id', v_session_id, 'start_time', v_session_start,
                'end_time', v_session_end, 'status', v_session_status,
                'close_reason', v_session_close
            ) ELSE NULL END,
            'summary', jsonb_build_object(
                'event_count', (SELECT COUNT(*)::int FROM ev),
                'tracking_count', (SELECT COUNT(*)::int FROM ev WHERE type = 'tracking'),
                'visit_count', (SELECT COUNT(*)::int FROM ev WHERE type IN ('visit_checkin', 'visit_checkout')),
                'order_count', (SELECT COUNT(*)::int FROM ev WHERE type = 'order'),
                'collection_count', (SELECT COUNT(*)::int FROM ev WHERE type = 'collection'),
                'break_count', (SELECT COUNT(*)::int FROM ev WHERE type IN ('break_start', 'break_end')),
                'idle_minutes', (SELECT COALESCE(SUM(gap_minutes), 0)::int FROM with_gaps),
                'truncated', (SELECT COUNT(*)::int FROM ev) > 1000
            ),
            'events', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    't', wg.t, 'type', wg.type, 'label', wg.label, 'detail', wg.detail,
                    'has_location', wg.latitude IS NOT NULL AND wg.longitude IS NOT NULL,
                    'latitude', wg.latitude, 'longitude', wg.longitude,
                    'location_source', wg.location_source,
                    'gap_minutes', wg.gap_minutes
                ) ORDER BY wg.t DESC)
                FROM (SELECT * FROM with_gaps ORDER BY t DESC LIMIT 1000) wg
            ), '[]'::jsonb)
        ) LIMIT 1
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_day_timeline TO authenticated;