CREATE OR REPLACE FUNCTION public.get_live_activity_center(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_subtree_ids uuid[];
    v_kpis jsonb;
    v_activity jsonb;
    v_anomalies jsonb;
    v_overview jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_employee_id);
    END IF;

    -- 1 — Reuse existing employee overview
    v_overview := public.get_live_workday_overview(p_token);

    -- 2 — Executive KPIs (daily totals + hourly pulse)
    SELECT jsonb_build_object(
        'today_orders', COALESCE((SELECT COUNT(*)::int FROM public.orders o
            WHERE o.created_at::date = CURRENT_DATE
            AND (v_subtree_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(v_subtree_ids))), 0),
        'today_sales', COALESCE((SELECT SUM(o.total_amount)::numeric FROM public.orders o
            WHERE o.created_at::date = CURRENT_DATE
            AND (v_subtree_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(v_subtree_ids))), 0),
        'today_collections', COALESCE((SELECT COUNT(*)::int FROM public.collections cl
            WHERE cl.created_at::date = CURRENT_DATE
            AND (v_subtree_ids IS NULL OR cl.created_by = ANY(v_subtree_ids))), 0),
        'today_collections_amount', COALESCE((SELECT SUM(cl.amount)::numeric FROM public.collections cl
            WHERE cl.created_at::date = CURRENT_DATE
            AND (v_subtree_ids IS NULL OR cl.created_by = ANY(v_subtree_ids))), 0),
        'today_visits', COALESCE((SELECT COUNT(*)::int FROM public.visits v
            WHERE v.check_in_at::date = CURRENT_DATE
            AND (v_subtree_ids IS NULL OR v.employee_id = ANY(v_subtree_ids))), 0),
        'today_new_customers', COALESCE((SELECT COUNT(*)::int FROM public.customers cu
            WHERE cu.created_at::date = CURRENT_DATE
            AND (v_subtree_ids IS NULL OR public.resolve_employee_id(cu.owner_id) = ANY(v_subtree_ids))), 0),
        'active_employees', COALESCE((SELECT COUNT(*)::int FROM public.workday_sessions wds
            WHERE wds.date = CURRENT_DATE AND wds.status = 'active'), 0),
        'active_visits', COALESCE((SELECT COUNT(*)::int FROM public.visits v
            WHERE v.check_in_at::date = CURRENT_DATE AND v.check_out_at IS NULL), 0),
        'served_customers', COALESCE((SELECT COUNT(DISTINCT o.customer_id)::int FROM public.orders o
            WHERE o.created_at::date = CURRENT_DATE
            AND (v_subtree_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(v_subtree_ids))), 0),
        'hourly_orders', COALESCE((SELECT COUNT(*)::int FROM public.orders o
            WHERE o.created_at > now() - interval '1 hour'
            AND (v_subtree_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(v_subtree_ids))), 0),
        'hourly_sales', COALESCE((SELECT SUM(o.total_amount)::numeric FROM public.orders o
            WHERE o.created_at > now() - interval '1 hour'
            AND (v_subtree_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(v_subtree_ids))), 0)
    ) INTO v_kpis;

    -- 3 — Activity feed (last 24h, up to 30 events)
    WITH activity_union AS (
        SELECT aal.created_at AS event_time,
            aal.event_type,
            e.full_name AS actor_name,
            e.id AS actor_id,
            CASE aal.event_type
                WHEN 'workday_start' THEN 'بدء يوم العمل'
                WHEN 'manual_close' THEN 'إنهاء يوم العمل'
                WHEN 'auto_closed' THEN 'إنهاء تلقائي'
                WHEN 'day_rollover' THEN 'تجاوز منتصف الليل'
                WHEN 'admin_closed' THEN 'إنهاء بواسطة الإدارة'
                WHEN 'warning_sent' THEN 'إنذار إنهاء'
                WHEN 'warning_cleared' THEN 'إلغاء الإنذار'
                ELSE aal.event_type
            END AS summary,
            'attendance' AS ref_type,
            aal.session_id::text AS ref_id
        FROM public.attendance_audit_log aal
        JOIN public.employees e ON e.id = aal.employee_id
        WHERE (v_subtree_ids IS NULL OR aal.employee_id = ANY(v_subtree_ids))
        AND aal.created_at > now() - interval '24 hours'

        UNION ALL

        SELECT o.created_at,
            'order_created',
            COALESCE(e.full_name, 'النظام'),
            COALESCE(public.resolve_employee_id(o.owner_id), o.created_by),
            'طلب جديد - ' || COALESCE(o.order_number, '#' || o.id::text) || ' (' || o.total_amount::text || ' ج.م)',
            'order',
            o.id::text
        FROM public.orders o
        LEFT JOIN public.employees e ON e.id = public.resolve_employee_id(o.owner_id)
        WHERE (v_subtree_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(v_subtree_ids))
        AND o.created_at > now() - interval '24 hours'

        UNION ALL

        SELECT v.check_in_at,
            CASE WHEN v.check_out_at IS NULL THEN 'visit_started' ELSE 'visit_completed' END,
            e.full_name,
            v.employee_id,
            COALESCE(c.company_name, 'عميل') || CASE WHEN v.check_out_at IS NULL THEN ' قيد الزيارة' ELSE ' تمت الزيارة' END,
            'visit',
            v.id::text
        FROM public.visits v
        JOIN public.employees e ON e.id = v.employee_id
        LEFT JOIN public.customers c ON c.id = v.customer_id
        WHERE (v_subtree_ids IS NULL OR v.employee_id = ANY(v_subtree_ids))
        AND v.check_in_at > now() - interval '24 hours'

        UNION ALL

        SELECT cl.created_at,
            'collection_made',
            e.full_name,
            cl.created_by,
            'تحصيل ' || cl.amount::text || ' ج.م',
            'collection',
            cl.id::text
        FROM public.collections cl
        JOIN public.employees e ON e.id = cl.created_by
        WHERE (v_subtree_ids IS NULL OR cl.created_by = ANY(v_subtree_ids))
        AND cl.created_at > now() - interval '24 hours'

        UNION ALL

        SELECT cu.created_at,
            'customer_registered',
            COALESCE(e.full_name, 'النظام'),
            COALESCE(public.resolve_employee_id(cu.owner_id), cu.owner_id),
            cu.company_name || ' (عميل جديد)',
            'customer',
            cu.id::text
        FROM public.customers cu
        LEFT JOIN public.employees e ON e.id = public.resolve_employee_id(cu.owner_id)
        WHERE (v_subtree_ids IS NULL OR public.resolve_employee_id(cu.owner_id) = ANY(v_subtree_ids))
        AND cu.created_at > now() - interval '24 hours'
    )
    SELECT jsonb_agg(jsonb_build_object(
        'time', au.event_time,
        'type', au.event_type,
        'actor', au.actor_name,
        'actor_id', au.actor_id,
        'summary', au.summary,
        'ref_type', au.ref_type,
        'ref_id', au.ref_id
    ) ORDER BY au.event_time DESC)
    INTO v_activity FROM activity_union au;

    IF v_activity IS NULL THEN v_activity := '[]'::jsonb; END IF;

    -- 4 — Anomaly detection
    WITH active_sessions AS (
        SELECT wds.id, wds.employee_id, e.full_name, wds.last_seen_at, wds.start_time, wds.visit_count
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
    )
    SELECT jsonb_agg(sub.anomaly) INTO v_anomalies FROM (
        SELECT jsonb_build_object(
            'type', 'stale_session', 'severity', 'high',
            'employee_id', a.employee_id, 'employee_name', a.full_name,
            'detail', 'جلسة معلقة — آخر ظهور منذ ' || EXTRACT(EPOCH FROM (now() - COALESCE(a.last_seen_at, a.start_time)))::int / 60 || ' دقيقة'
        ) AS anomaly
        FROM active_sessions a
        WHERE COALESCE(a.last_seen_at, a.start_time) < now() - interval '30 minutes'

        UNION ALL

        SELECT jsonb_build_object(
            'type', 'no_gps', 'severity', 'medium',
            'employee_id', a.employee_id, 'employee_name', a.full_name,
            'detail', 'لا توجد نقاط GPS حديثة'
        )
        FROM active_sessions a
        WHERE NOT EXISTS (
            SELECT 1 FROM public.tracking_points tp
            WHERE tp.employee_id = a.employee_id
            AND tp.recorded_at > now() - interval '5 minutes'
        )

        UNION ALL

        SELECT jsonb_build_object(
            'type', 'no_heartbeat', 'severity', 'medium',
            'employee_id', a.employee_id, 'employee_name', a.full_name,
            'detail', 'آخر Heartbeat منذ ' || EXTRACT(EPOCH FROM (now() - COALESCE(a.last_seen_at, a.start_time)))::int / 60 || ' دقيقة'
        )
        FROM active_sessions a
        WHERE COALESCE(a.last_seen_at, a.start_time) < now() - interval '10 minutes'

        UNION ALL

        SELECT jsonb_build_object(
            'type', 'no_visits', 'severity', 'low',
            'employee_id', a.employee_id, 'employee_name', a.full_name,
            'detail', 'بدون زيارات منذ ' || EXTRACT(EPOCH FROM (now() - a.start_time))::int / 60 || ' دقيقة'
        )
        FROM active_sessions a
        WHERE a.start_time < now() - interval '2 hours'
        AND NOT EXISTS (
            SELECT 1 FROM public.visits v
            WHERE v.employee_id = a.employee_id AND v.check_in_at::date = CURRENT_DATE
        )

        UNION ALL

        SELECT jsonb_build_object(
            'type', 'no_orders', 'severity', 'low',
            'employee_id', a.employee_id, 'employee_name', a.full_name,
            'detail', 'بدون طلبات منذ ' || EXTRACT(EPOCH FROM (now() - a.start_time))::int / 60 || ' دقيقة'
        )
        FROM active_sessions a
        WHERE a.start_time < now() - interval '4 hours'
        AND NOT EXISTS (
            SELECT 1 FROM public.orders o
            WHERE public.resolve_employee_id(o.owner_id) = a.employee_id
            AND o.created_at::date = CURRENT_DATE
        )
    ) sub;

    IF v_anomalies IS NULL THEN v_anomalies := '[]'::jsonb; END IF;

    RETURN v_overview || jsonb_build_object(
        'kpis', v_kpis,
        'activity', v_activity,
        'anomalies', v_anomalies
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_live_activity_center TO authenticated;
