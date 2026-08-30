-- ============================================================================
-- شاشة الحضور والمتابعة — الجزء 2: مؤشرات نظرة عامة (KPIs)
-- ============================================================================
-- get_executive_overview_kpis:
--   مؤشرات مجمَّعة على مستوى الفريق للفترة المحددة + مؤشرات اليوم اللحظية
--   عندما تشمل الفترة اليوم الحالي. كل الحسابات تحدث على الخادم وضمن نطاق
--   الصلاحية (subtree للإدارة غير العليا، كامل القوى العاملة للإدارة العليا).
--
-- تعريفات موثقة (مصدر حقيقة موحَّد — نفس التعريف للفترة والتقارير):
--   ساعات الحضور = مجموع دقائق الجلسات (net):
--       fixed_shift → المدة مطروحاً منها الاستراحات.
--       flexible/hourly → المدة كما هي (حضور).
--   الطلبات      = طلبات غير draft وغير cancelled، بتاريخ الإنشاء ضمن الفترة،
--                  عبر resolve_employee_id(owner_id).
--   التحصيلات    = كل التحصيلات بتاريخ الإنشاء ضمن الفترة (count + amount).
--   الزيارات     = زيارات تاريخ الوصول (check_in_at) ضمن الفترة.
--   العملاء الجدد = عملاء تاريخ الإنشاء ضمن الفترة.
--   مؤشر الأداء الأساسي (best/worst) = صافي المبيعات لكل ساعة حضور.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_executive_overview_kpis(
    p_token uuid,
    p_from date DEFAULT CURRENT_DATE,
    p_to date DEFAULT CURRENT_DATE,
    p_include_inactive boolean DEFAULT true
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
    v_interval_seconds numeric;
    v_timeout_minutes integer;
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
    SELECT COALESCE(location_interval_seconds, 300)::numeric INTO v_interval_seconds
    FROM public.workday_settings LIMIT 1;
    SELECT COALESCE(inactivity_timeout_minutes, 60)::int INTO v_timeout_minutes
    FROM public.workday_settings LIMIT 1;

    RETURN (
        WITH ve AS (
            SELECT e.id AS employee_id, e.code, COALESCE(NULLIF(e.full_name, ''), e.code) AS full_name
            FROM public.employees e
            WHERE e.id = ANY(v_visible)
              AND (p_include_inactive OR e.is_active)
        ),
        ss AS (
            SELECT wds.id AS session_id, wds.employee_id, wds.date, wds.start_time, wds.end_time,
                   wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
                   wds.close_reason, wds.status
            FROM public.workday_sessions wds
            WHERE wds.employee_id = ANY(v_visible)
              AND wds.date >= p_from AND wds.date <= p_to
        ),
        br AS (
            SELECT wb.session_id, COUNT(*)::int AS break_count,
                   COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0) AS break_seconds
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
                   COUNT(*) FILTER (WHERE v.status = 'active' AND v.check_out_at IS NULL)::int AS open_visit_count
            FROM public.visits v
            WHERE v.employee_id = ANY(v_visible)
              AND v.check_in_at::date >= p_from AND v.check_in_at::date <= p_to
            GROUP BY v.employee_id
        ),
        live_sessions AS (
            SELECT DISTINCT ON (wds.employee_id)
                wds.employee_id, wds.id AS session_id, wds.status, wds.attendance_status,
                wds.start_time, wds.end_time, wds.close_reason, wds.last_seen_at,
                COALESCE(wds.total_distance_meters, 0) AS distance_meters
            FROM public.workday_sessions wds
            WHERE wds.employee_id = ANY(v_visible) AND wds.date = CURRENT_DATE
            ORDER BY wds.employee_id, wds.start_time DESC NULLS LAST
        ),
        today_breaks AS (
            SELECT wb.session_id,
                   COUNT(*) FILTER (WHERE wb.break_end IS NULL)::int AS active_break_count
            FROM public.workday_breaks wb
            JOIN live_sessions l ON l.session_id = wb.session_id
            GROUP BY wb.session_id
        ),
        last_activity AS (
            SELECT DISTINCT ON (employee_id)
                employee_id, activity_at AS last_activity_at
            FROM (
                SELECT l.employee_id, l.last_seen_at AS activity_at FROM live_sessions l WHERE l.last_seen_at IS NOT NULL
                UNION ALL
                SELECT tp.employee_id, tp.recorded_at FROM public.tracking_points tp
                WHERE tp.employee_id = ANY(v_visible) AND tp.recorded_at > now() - interval '24 hours'
                UNION ALL
                SELECT v.employee_id, v.check_in_at FROM public.visits v
                WHERE v.employee_id = ANY(v_visible) AND v.check_in_at > now() - interval '24 hours'
                UNION ALL
                SELECT public.resolve_employee_id(o.owner_id), o.created_at FROM public.orders o
                WHERE public.resolve_employee_id(o.owner_id) = ANY(v_visible)
                  AND o.created_at > now() - interval '24 hours'
                UNION ALL
                SELECT public.resolve_employee_id(c.owner_id), c.created_at FROM public.collections c
                WHERE public.resolve_employee_id(c.owner_id) = ANY(v_visible)
                  AND c.created_at > now() - interval '24 hours'
            ) ca
            ORDER BY employee_id, activity_at DESC NULLS LAST
        ),
        staff AS (
            SELECT
                ve.employee_id, ve.code, ve.full_name,
                COUNT(DISTINCT ss.date)::int AS worked_days,
                COALESCE(SUM(
                    CASE WHEN ss.date IS NULL THEN 0
                         WHEN COALESCE(ewp.schedule_type, 'fixed_shift') = 'fixed_shift'
                         THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(ss.end_time, now()) - ss.start_time)) / 60
                                       - COALESCE(br.break_seconds, 0)::numeric / 60, 0)
                         ELSE EXTRACT(EPOCH FROM (COALESCE(ss.end_time, now()) - ss.start_time)) / 60
                    END
                ), 0)::int AS present_minutes,
                COUNT(DISTINCT ss.date) FILTER (WHERE ss.attendance_status = 'late')::int AS late_days,
                COALESCE(SUM(COALESCE(ss.late_minutes, 0)), 0)::int AS late_minutes_total,
                COUNT(DISTINCT ss.date) FILTER (WHERE ss.attendance_status = 'early_departure' OR ss.early_departure_minutes > 0)::int AS early_days,
                COUNT(DISTINCT ss.date) FILTER (WHERE ss.close_reason IN ('auto_closed_inactivity', 'no_activity_timeout'))::int AS auto_closed_days,
                COALESCE(SUM(br.break_count), 0)::int AS break_count,
                COALESCE(od.order_count, 0)::int AS order_count,
                COALESCE(od.sales_value, 0)::numeric AS sales_value,
                COALESCE(cd.collection_count, 0)::int AS collection_count,
                COALESCE(cd.collection_amount, 0)::numeric AS collection_amount,
                COALESCE(nd.new_customer_count, 0)::int AS new_customer_count,
                COALESCE(vs.visit_count, 0)::int AS visit_count,
                COALESCE(vs.open_visit_count, 0)::int AS open_visit_count,
                ls.session_id AS live_session_id, ls.status AS live_status,
                ls.attendance_status AS live_attendance_status, ls.close_reason AS live_close_reason,
                ls.end_time AS live_end_time, ls.start_time AS live_start_time,
                COALESCE(tb.active_break_count, 0) AS live_active_breaks,
                la.last_activity_at,
                CASE
                    WHEN la.last_activity_at IS NULL THEN 'no_data'
                    WHEN la.last_activity_at > now() - (v_interval_seconds::text || ' seconds')::interval THEN 'connected'
                    WHEN la.last_activity_at > now() - ((v_interval_seconds * 5)::text || ' seconds')::interval THEN 'delayed'
                    ELSE 'lost'
                END AS connection_status
            FROM ve
            LEFT JOIN public.employee_work_policies ewp ON ewp.employee_id = ve.employee_id
            LEFT JOIN ss ON ss.employee_id = ve.employee_id
            LEFT JOIN br ON br.session_id = ss.session_id
            LEFT JOIN od ON od.eid = ve.employee_id
            LEFT JOIN cd ON cd.eid = ve.employee_id
            LEFT JOIN nd ON nd.eid = ve.employee_id
            LEFT JOIN vs ON vs.employee_id = ve.employee_id
            LEFT JOIN live_sessions ls ON ls.employee_id = ve.employee_id
            LEFT JOIN today_breaks tb ON tb.session_id = ls.session_id
            LEFT JOIN last_activity la ON la.employee_id = ve.employee_id
            GROUP BY ve.employee_id, ve.code, ve.full_name,
                     od.order_count, od.sales_value,
                     cd.collection_count, cd.collection_amount,
                     nd.new_customer_count, vs.visit_count, vs.open_visit_count,
                     ls.session_id, ls.status, ls.attendance_status, ls.close_reason,
                     ls.end_time, ls.start_time, tb.active_break_count,
                     la.last_activity_at
        )
        SELECT jsonb_build_object(
            'error', NULL,
            'live_mode', v_include_live,
            'period', jsonb_build_object('from', p_from, 'to', p_to),
            'policy', jsonb_build_object(
                'inactivity_timeout_minutes', v_timeout_minutes,
                'location_interval_seconds', v_interval_seconds
            ),
            'definition_note', 'مؤشر الأداء الأساسي (best/worst) = صافي المبيعات لكل ساعة حضور. ساعات الحضور = net للجلسات (fixed_shift يخصم الاستراحات، المرن/بالساعة دون خصم). الطلبات تستثني draft/cancelled.',
            'kpis', jsonb_build_object(
                'workforce', (SELECT COUNT(*)::int FROM ve),
                'present_employees', (SELECT COUNT(*)::int FROM staff WHERE worked_days > 0),
                'worked_days_total', (SELECT COALESCE(SUM(worked_days), 0)::int FROM staff),
                'presence_hours_total', ROUND((SELECT COALESCE(SUM(present_minutes), 0)::numeric FROM staff) / 60, 1),
                'avg_daily_presence_minutes', COALESCE(ROUND((SELECT AVG(present_minutes)::numeric FROM staff), 0), 0)::int,
                'late_days_total', (SELECT COALESCE(SUM(late_days), 0)::int FROM staff),
                'late_minutes_total', (SELECT COALESCE(SUM(late_minutes_total), 0)::int FROM staff),
                'early_days_total', (SELECT COALESCE(SUM(early_days), 0)::int FROM staff),
                'auto_closed_days_total', (SELECT COALESCE(SUM(auto_closed_days), 0)::int FROM staff),
                'total_orders', (SELECT COALESCE(SUM(order_count), 0)::int FROM staff),
                'total_sales', (SELECT COALESCE(SUM(sales_value), 0)::numeric FROM staff),
                'total_visits', (SELECT COALESCE(SUM(visit_count), 0)::int FROM staff),
                'total_collections', (SELECT COALESCE(SUM(collection_amount), 0)::numeric FROM staff),
                'total_new_customers', (SELECT COALESCE(SUM(new_customer_count), 0)::int FROM staff),
                'best_performer', (SELECT jsonb_build_object(
                    'employee_id', employee_id, 'name', full_name, 'code', code,
                    'sales', sales_value, 'orders', order_count,
                    'presence_hours', ROUND(present_minutes::numeric / 60, 1),
                    'sales_per_hour', CASE WHEN present_minutes > 0 THEN ROUND(sales_value / (present_minutes::numeric / 60), 2) ELSE 0 END
                ) FROM staff WHERE present_minutes > 0 ORDER BY sales_value / NULLIF(present_minutes::numeric / 60, 0) DESC LIMIT 1),
                'worst_performer', (SELECT jsonb_build_object(
                    'employee_id', employee_id, 'name', full_name, 'code', code,
                    'sales', sales_value, 'orders', order_count,
                    'presence_hours', ROUND(present_minutes::numeric / 60, 1),
                    'sales_per_hour', CASE WHEN present_minutes > 0 THEN ROUND(sales_value / (present_minutes::numeric / 60), 2) ELSE 0 END
                ) FROM staff WHERE present_minutes > 0 ORDER BY sales_value / NULLIF(present_minutes::numeric / 60, 0) ASC LIMIT 1),
                'live', CASE WHEN v_include_live THEN jsonb_build_object(
                    'active_today', (SELECT COUNT(*)::int FROM staff WHERE live_session_id IS NOT NULL AND live_status IN ('active', 'inactive_warning')),
                    'on_visit_today', (SELECT COUNT(*)::int FROM staff WHERE live_session_id IS NOT NULL AND live_status IN ('active', 'inactive_warning') AND open_visit_count > 0),
                    'on_break_today', (SELECT COUNT(*)::int FROM staff WHERE live_session_id IS NOT NULL AND live_status IN ('active', 'inactive_warning') AND live_active_breaks > 0),
                    'connected_today', (SELECT COUNT(*)::int FROM staff WHERE connection_status = 'connected'),
                    'delayed_today', (SELECT COUNT(*)::int FROM staff WHERE connection_status = 'delayed'),
                    'lost_today', (SELECT COUNT(*)::int FROM staff WHERE connection_status = 'lost'),
                    'no_data_today', (SELECT COUNT(*)::int FROM staff WHERE connection_status = 'no_data'),
                    'no_start_today', (SELECT COUNT(*)::int FROM staff WHERE live_session_id IS NULL),
                    'ended_today', (SELECT COUNT(*)::int FROM staff WHERE live_session_id IS NOT NULL AND live_status = 'completed' AND COALESCE(live_close_reason, '') NOT IN ('auto_closed_inactivity', 'no_activity_timeout', 'day_rollover')),
                    'auto_closed_today', (SELECT COUNT(*)::int FROM staff WHERE live_session_id IS NOT NULL AND live_status = 'completed' AND COALESCE(live_close_reason, '') IN ('auto_closed_inactivity', 'no_activity_timeout', 'day_rollover')),
                    'late_today', (SELECT COUNT(*)::int FROM staff WHERE live_attendance_status = 'late')
                ) ELSE NULL END
            )
        ) LIMIT 1
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_overview_kpis TO authenticated;