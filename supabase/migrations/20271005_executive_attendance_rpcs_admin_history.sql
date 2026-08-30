-- ============================================================================
-- شاشة الحضور والمتابعة — الجزء 5: الإدارة والتاريخ (تقارير + سياسة مُدارة)
-- ============================================================================
-- get_executive_auto_close_report: سياسة + عدد أيام الإغلاق التلقائي حسب السبب
--   + قائمة الجلسات المغلقة تلقائياً (آخر نشاط / دقائق الخمول).
-- get_executive_workforce_history: مصفوفة موظف × يوم (كل مقاييس الفترة) + المجاميع.
-- get_executive_policy / set_executive_policy: قراءة/تعديل إعدادات الإدارة
--   (set يُسجِّل التغيير في executive_policy_changes ويعيد old/new).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_executive_auto_close_report(
    p_token uuid,
    p_from date DEFAULT CURRENT_DATE,
    p_to date DEFAULT CURRENT_DATE
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

    SELECT COALESCE(inactivity_timeout_minutes, 60)::int INTO v_timeout_minutes
    FROM public.workday_settings LIMIT 1;

    RETURN (
        WITH st AS (
            SELECT wds.id, wds.employee_id, wds.date, wds.start_time, wds.end_time,
                   wds.close_reason, wds.attendance_status,
                   wds.last_seen_at, wds.status
            FROM public.workday_sessions wds
            WHERE wds.employee_id = ANY(v_visible)
              AND wds.date >= p_from AND wds.date <= p_to
              AND wds.close_reason IN ('auto_closed_inactivity', 'no_activity_timeout', 'day_rollover')
        )
        SELECT jsonb_build_object(
            'error', NULL,
            'period', jsonb_build_object('from', p_from, 'to', p_to),
            'policy', jsonb_build_object('inactivity_timeout_minutes', v_timeout_minutes),
            'by_reason', jsonb_build_object(
                'auto_closed_inactivity', (SELECT COUNT(*)::int FROM st WHERE close_reason = 'auto_closed_inactivity'),
                'no_activity_timeout', (SELECT COUNT(*)::int FROM st WHERE close_reason = 'no_activity_timeout'),
                'day_rollover', (SELECT COUNT(*)::int FROM st WHERE close_reason = 'day_rollover'),
                'total', (SELECT COUNT(*)::int FROM st)
            ),
            'sessions', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'session_id', st.id,
                    'employee_id', st.employee_id,
                    'employee_name', COALESCE(NULLIF(e.full_name, ''), e.code),
                    'code', e.code,
                    'date', st.date,
                    'start_time', st.start_time, 'end_time', st.end_time,
                    'close_reason', st.close_reason,
                    'attendance_status', st.attendance_status,
                    'last_activity_at', st.last_seen_at,
                    'inactive_minutes', CASE WHEN st.last_seen_at IS NOT NULL
                        THEN (EXTRACT(EPOCH FROM (st.end_time - st.last_seen_at)) / 60)::int
                        ELSE NULL END
                ) ORDER BY st.date DESC, st.end_time DESC)
                FROM public.employees e
                JOIN st ON st.employee_id = e.id
            ), '[]'::jsonb)
        ) LIMIT 1
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_auto_close_report TO authenticated;

-- ----------------------------------------------------------------------------
-- get_executive_workforce_history — مصفوفة موظف × يوم (التعريفات الموثقة نفسها)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_executive_workforce_history(
    p_token uuid,
    p_from date DEFAULT CURRENT_DATE - 6,
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

    RETURN (
        WITH ss AS (
            SELECT wds.employee_id, wds.date, wds.start_time, wds.end_time, wds.status,
                   wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
                   wds.close_reason, wds.visit_count, wds.total_distance_meters
            FROM public.workday_sessions wds
            WHERE wds.employee_id = ANY(v_visible)
              AND wds.date >= p_from AND wds.date <= p_to
        ),
        br AS (
            SELECT w2.employee_id, w2.date,
                   COUNT(*)::int AS break_count,
                   COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0) AS break_seconds
            FROM public.workday_breaks wb
            JOIN public.workday_sessions w2 ON w2.id = wb.session_id
            WHERE w2.employee_id = ANY(v_visible)
              AND w2.date >= p_from AND w2.date <= p_to
            GROUP BY w2.employee_id, w2.date
        ),
        mat AS (
            SELECT
                ve.employee_id, ve.code, MAX(COALESCE(NULLIF(ve.full_name, ''), ve.code)) AS full_name,
                MAX(ve.role_name) AS role_name, BOOL_OR(ve.is_active) AS is_active,
                MAX(ve.work_location) AS work_location, MAX(ve.schedule_type) AS schedule_type,
                MAX(ve.required_daily_hours) AS required_daily_hours,
                MAX(ve.shift_start_time) AS shift_start_time, MAX(ve.shift_end_time) AS shift_end_time,
                ss.date,
                COUNT(ss.employee_id) AS present_days,
                MIN(ss.start_time) AS start_time,
                MAX(ss.end_time) AS end_time,
                MAX(ss.status) AS status,
                MAX(ss.attendance_status) AS attendance_status,
                SUM(COALESCE(ss.late_minutes, 0))::int AS late_minutes,
                SUM(COALESCE(ss.early_departure_minutes, 0))::int AS early_minutes,
                MAX(ss.close_reason) AS close_reason,
                CASE WHEN MAX(ve.schedule_type) IN ('flexible', 'hourly')
                     THEN COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ss.end_time, ss.start_time) - ss.start_time)) / 60), 0)::int
                ELSE GREATEST(COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ss.end_time, ss.start_time) - ss.start_time)) / 60), 0)
                              - COALESCE(SUM(COALESCE(br.break_seconds, 0)), 0)::numeric / 60, 0)::int END AS net_minutes,
                COALESCE(SUM(COALESCE(br.break_count, 0)), 0)::int AS break_count,
                COALESCE(SUM(COALESCE(br.break_seconds, 0)), 0)::int AS break_seconds,
                COALESCE(MAX(ss.visit_count), 0)::int AS visit_count,
                COALESCE(SUM(o.order_count), 0)::int AS order_count,
                COALESCE(SUM(o.sales_value), 0)::numeric AS sales_value,
                COALESCE(SUM(col.collection_count), 0)::int AS collection_count,
                COALESCE(SUM(col.collection_amount), 0)::numeric AS collection_amount,
                COALESCE(SUM(nc.new_customer_count), 0)::int AS new_customer_count
            FROM (
                SELECT e.id AS employee_id, e.code, e.full_name,
                       COALESCE((SELECT r.name FROM public.employee_roles er2
                                 JOIN public.roles r ON r.id = er2.role_id
                                 WHERE er2.employee_id = e.id LIMIT 1), '') AS role_name,
                       e.is_active,
                       ewp.work_location, ewp.schedule_type, ewp.required_daily_hours,
                       ewp.shift_start_time, ewp.shift_end_time
                FROM public.employees e
                LEFT JOIN public.employee_work_policies ewp ON ewp.employee_id = e.id
                WHERE e.id = ANY(v_visible) AND (p_include_inactive OR e.is_active)
            ) ve
            LEFT JOIN ss ON ss.employee_id = ve.employee_id
            LEFT JOIN br ON br.employee_id = ve.employee_id AND br.date = ss.date
            LEFT JOIN (
                SELECT public.resolve_employee_id(o.owner_id) AS eid, o.created_at::date AS d,
                       COUNT(*)::int AS order_count, SUM(o.total_amount) AS sales_value
                FROM public.orders o
                WHERE o.status NOT IN ('draft', 'cancelled')
                  AND o.created_at::date >= p_from AND o.created_at::date <= p_to
                  AND public.resolve_employee_id(o.owner_id) = ANY(v_visible)
                GROUP BY 1, 2
            ) o ON o.eid = ve.employee_id AND o.d = ss.date
            LEFT JOIN (
                SELECT public.resolve_employee_id(c.owner_id) AS eid, c.created_at::date AS d,
                       COUNT(*)::int AS collection_count, SUM(c.amount) AS collection_amount
                FROM public.collections c
                WHERE c.created_at::date >= p_from AND c.created_at::date <= p_to
                  AND public.resolve_employee_id(c.owner_id) = ANY(v_visible)
                GROUP BY 1, 2
            ) col ON col.eid = ve.employee_id AND col.d = ss.date
            LEFT JOIN (
                SELECT public.resolve_employee_id(c2.owner_id) AS eid, c2.created_at::date AS d,
                       COUNT(*)::int AS new_customer_count
                FROM public.customers c2
                WHERE c2.created_at::date >= p_from AND c2.created_at::date <= p_to
                  AND public.resolve_employee_id(c2.owner_id) = ANY(v_visible)
                GROUP BY 1, 2
            ) nc ON nc.eid = ve.employee_id AND nc.d = ss.date
            GROUP BY ve.employee_id, ve.code, ss.date
        )
        SELECT jsonb_build_object(
            'error', NULL,
            'period', jsonb_build_object('from', p_from, 'to', p_to),
            'totals', jsonb_build_object(
                'present_days', (SELECT COUNT(*)::int FROM mat WHERE present_days > 0),
                'presence_hours_total', ROUND(COALESCE((SELECT SUM(net_minutes) FROM mat), 0)::numeric / 60, 1),
                'avg_daily_presence_hours', ROUND(COALESCE((SELECT AVG(net_minutes) FROM mat WHERE present_days > 0), 0)::numeric / 60, 1),
                'late_days', (SELECT COUNT(*)::int FROM mat WHERE attendance_status = 'late'),
                'early_days', (SELECT COUNT(*)::int FROM mat WHERE attendance_status = 'early_departure' OR early_minutes > 0),
                'auto_closed_days', (SELECT COUNT(*)::int FROM mat WHERE close_reason IN ('auto_closed_inactivity', 'no_activity_timeout', 'day_rollover')),
                'orders', (SELECT COALESCE(SUM(order_count), 0)::int FROM mat),
                'sales', (SELECT COALESCE(SUM(sales_value), 0)::numeric FROM mat),
                'visits', (SELECT COALESCE(SUM(visit_count), 0)::int FROM mat),
                'collections', (SELECT COALESCE(SUM(collection_count), 0)::int FROM mat),
                'collection_amount', (SELECT COALESCE(SUM(collection_amount), 0)::numeric FROM mat),
                'new_customers', (SELECT COALESCE(SUM(new_customer_count), 0)::int FROM mat)
            ),
            'employees', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'employee_id', m.employee_id, 'code', m.code, 'name', m.full_name,
                    'role_name', m.role_name, 'is_active', m.is_active,
                    'work_location', m.work_location, 'schedule_type', m.schedule_type,
                    'required_daily_hours', m.required_daily_hours,
                    'shift_start_time', m.shift_start_time::text, 'shift_end_time', m.shift_end_time::text,
                    'days', (SELECT jsonb_agg(jsonb_build_object(
                                'date', d2.date,
                                'start_time', d2.start_time, 'end_time', d2.end_time,
                                'status', d2.status, 'attendance_status', d2.attendance_status,
                                'late_minutes', d2.late_minutes, 'early_minutes', d2.early_minutes,
                                'close_reason', d2.close_reason,
                                'net_minutes', d2.net_minutes,
                                'break_count', d2.break_count, 'break_minutes', (d2.break_seconds / 60)::int,
                                'visit_count', d2.visit_count,
                                'orders', d2.order_count, 'sales', d2.sales_value,
                                'collections', d2.collection_count, 'collection_amount', d2.collection_amount,
                                'new_customers', d2.new_customer_count
                            ) ORDER BY d2.date)
                            FROM mat d2 WHERE d2.employee_id = m.employee_id AND d2.present_days > 0
                    )
                ) ORDER BY m.full_name, m.code)
                FROM (SELECT DISTINCT employee_id, code, full_name, role_name, is_active, work_location,
                                     schedule_type, required_daily_hours, shift_start_time, shift_end_time
                      FROM mat) m
            ), '[]'::jsonb),
            'matrix', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'date', m.date, 'employee_id', m.employee_id, 'code', m.code,
                    'name', m.full_name, 'present', m.present_days > 0,
                    'net_minutes', m.net_minutes, 'status', m.status,
                    'attendance_status', m.attendance_status, 'close_reason', m.close_reason
                ) ORDER BY m.date DESC, m.full_name)
                FROM mat m WHERE m.present_days > 0
            ), '[]'::jsonb)
        ) LIMIT 1
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_workforce_history TO authenticated;

-- ----------------------------------------------------------------------------
-- سياسة مُدارة: get_executive_policy / set_executive_policy (تدقيق + old/new)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_executive_policy(
    p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
    v_session app.sessions;
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

    RETURN (SELECT jsonb_build_object(
        'error', NULL,
        'inactivity_timeout_minutes', COALESCE(w.inactivity_timeout_minutes, 60),
        'location_interval_seconds', COALESCE(w.location_interval_seconds, 300),
        'official_start_time', w.official_start_time::text,
        'official_end_time', w.official_end_time::text
    ) FROM public.workday_settings w LIMIT 1);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_policy TO authenticated;

CREATE OR REPLACE FUNCTION public.set_executive_policy(
    p_token uuid,
    p_inactivity_timeout_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
    v_session app.sessions;
    v_old integer;
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

    IF p_inactivity_timeout_minutes < 5 OR p_inactivity_timeout_minutes > 1440 THEN
        RETURN jsonb_build_object('error', 'INVALID_RANGE', 'message', 'القيمة يجب أن تكون بين 5 و 1440 دقيقة.');
    END IF;

    SELECT COALESCE(inactivity_timeout_minutes, 60) INTO v_old FROM public.workday_settings LIMIT 1;

    INSERT INTO public.executive_policy_changes (policy_key, old_value, new_value, changed_by, reason)
    VALUES ('inactivity_timeout_minutes', v_old, p_inactivity_timeout_minutes, v_session.employee_id,
            'تعديل من شاشة الحضور والمتابعة');

    UPDATE public.workday_settings
    SET inactivity_timeout_minutes = p_inactivity_timeout_minutes
    WHERE id = (SELECT id FROM public.workday_settings LIMIT 1);

    RETURN jsonb_build_object(
        'error', NULL,
        'old_value', v_old,
        'new_value', p_inactivity_timeout_minutes,
        'changed_by', v_session.employee_id,
        'changed_at', now()
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.set_executive_policy TO authenticated;

-- إعادة تحميل مخطط PostgREST لرؤية الوظائف الجديدة فوراً
NOTIFY pgrst, 'reload schema';