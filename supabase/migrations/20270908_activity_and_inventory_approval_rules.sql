-- ============================================================================
-- Migration 20270908: Activity & Inventory — Approval Point = approved (معتمد)
--
-- APPROVED BUSINESS SEQUENCE:
--   طلب شراء (submitted)
--     ↓
--   موافقة مدير البيع (sales_manager_approved)
--     ↓
--   معتمد (approved)  ← approval point
--     ↓
--   تم القيد بالسيستم (reviewing)  ← subsequent step, NOT an approval point
--     ↓
--   post-approval statuses
--
-- PART 1 — ACTIVITY (إجمالي النشاط / Monthly Activity):
--   Order eligibility now starts at معتمد (approved).
--   INCLUDE: approved, reviewing (تم القيد بالسيستم), preparing, prepared,
--     ready_for_dispatch, sent_to_delivery, dispatched, deferred, delivered.
--   EXCLUDE: draft, submitted (طلب شراء), sales_manager_approved
--     (موافقة مدير البيع), returned_for_revision (معاد للتعديل), cancelled (ملغى).
--   1. is_order_in_statistics() updated — canonical rule used by every module.
--   2. Partial index idx_orders_statistical recreated with the matching
--      predicate (keep index-only scans valid).
--   3. get_employees_business_activity — order totals routed through the
--      canonical rule.
--   4. get_live_activity_center — order KPIs (today/hourly orders + sales,
--      served customers, today-orders drill) routed through the canonical rule.
--
-- PART 2 — INVENTORY:
--   Inventory becomes committed/deducted at approved (معتمد).
--   It stays committed through reviewing (تم القيد بالسيستم) and the rest of
--   the post-approval lifecycle.
--   It is RELEASED only when the order moves back to a status that invalidates
--   the approval/commitment: returned_for_revision, submitted, cancelled,
--   sales_manager_approved.
--   1. inventory_release_status_group() — canonical release-status set.
--   2. enforce_execution_group_inventory() trigger — restore only when the NEW
--      status is a release status (deduct-on-group-entry unchanged). This also
--      replaces the old "any execution-group exit releases" rule: deferred is
--      no longer a release path.
--   3. governed_change_order_status — restore branch extended to the release
--      status set.
--   4. governed_supreme_edit_order — re-deduct after edit driven by the
--      exactly-once committed flag so committed orders (including committed
--      reviewing orders) stay committed: no silent release, no double
--      deduction.
-- ============================================================================

-- ============================================================================
-- PART 1 / 1. is_order_in_statistics — canonical Activity eligibility
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_order_in_statistics(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status NOT IN ('draft', 'submitted', 'sales_manager_approved', 'returned_for_revision', 'cancelled')
$$;

COMMENT ON FUNCTION public.is_order_in_statistics IS 'Canonical statistical rule: determines whether an order participates in statistical calculations. Draft, submitted (طلب شراء), sales_manager_approved (موافقة مدير البيع), returned_for_revision (معاد للتعديل), and cancelled (ملغى) orders are excluded. Eligibility starts at approved (معتمد); reviewing (تم القيد بالسيستم) and all later post-approval statuses count. Every statistical module must use this function.';

-- ============================================================================
-- PART 1 / 2. Partial index mirroring the canonical eligibility rule
-- ============================================================================
DROP INDEX IF EXISTS public.idx_orders_statistical;

CREATE INDEX idx_orders_statistical
  ON public.orders (owner_id, created_at DESC)
  WHERE status NOT IN ('draft', 'submitted', 'sales_manager_approved', 'returned_for_revision', 'cancelled');

-- ============================================================================
-- PART 1 / 3. get_employees_business_activity — canonical order eligibility
-- (same definition as 20260630 with the canonical status rule applied to the
--  order aggregation; visits/customers/collections unchanged)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_employees_business_activity(
    p_token uuid,
    p_from date,
    p_to date,
    p_search text DEFAULT NULL,
    p_sort_by text DEFAULT 'sales_value',
    p_sort_order text DEFAULT 'desc',
    p_page int DEFAULT 1,
    p_per_page int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_subtree_ids uuid[];
    v_offset int;
    v_result jsonb;
    v_total_employees int := 0;
BEGIN
    -- Auth
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    -- Scope: visible employees under this manager
    IF public.is_upper_management(v_session.employee_id) THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;

    v_offset := (p_page - 1) * p_per_page;

    WITH
    -- Step 1: All visible employees (regardless of attendance)
    visible_employees AS (
        SELECT e.id, e.full_name, e.code, rpl.name AS role_name
        FROM public.employees e
        LEFT JOIN LATERAL (
            SELECT r.name FROM public.employee_roles er
            JOIN public.roles r ON r.id = er.role_id
            WHERE er.employee_id = e.id
            LIMIT 1
        ) rpl ON true
        WHERE e.is_active = true
        AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        AND (
            p_search IS NULL
            OR e.full_name ILIKE '%' || p_search || '%'
            OR e.code ILIKE '%' || p_search || '%'
        )
    ),
    total_count AS (
        SELECT COUNT(*)::int AS cnt FROM visible_employees
    ),
    -- Step 2: Business activity — pure, NO session dependency
    biz_orders AS (
        SELECT
            public.resolve_employee_id(o.owner_id) AS employee_id,
            COUNT(*)::int AS order_count,
            COALESCE(SUM(o.total_amount), 0) AS sales_value
        FROM public.orders o
        WHERE o.created_at::date >= p_from AND o.created_at::date <= p_to
        AND public.is_order_in_statistics(o.status)
        AND public.resolve_employee_id(o.owner_id) = ANY(SELECT id FROM visible_employees)
        GROUP BY public.resolve_employee_id(o.owner_id)
    ),
    biz_visits AS (
        SELECT
            v.employee_id,
            COUNT(*)::int AS visit_count
        FROM public.visits v
        WHERE v.check_in_at::date >= p_from AND v.check_in_at::date <= p_to
        AND v.employee_id = ANY(SELECT id FROM visible_employees)
        GROUP BY v.employee_id
    ),
    biz_customers AS (
        SELECT
            public.resolve_employee_id(c.owner_id) AS employee_id,
            COUNT(*)::int AS customer_count
        FROM public.customers c
        WHERE c.created_at::date >= p_from AND c.created_at::date <= p_to
        AND public.resolve_employee_id(c.owner_id) = ANY(SELECT id FROM visible_employees)
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    biz_collections AS (
        SELECT
            public.resolve_employee_id(c.owner_id) AS employee_id,
            COUNT(*)::int AS collection_count,
            COALESCE(SUM(c.amount), 0) AS collection_amount
        FROM public.collections c
        WHERE c.created_at::date >= p_from AND c.created_at::date <= p_to
        AND public.resolve_employee_id(c.owner_id) = ANY(SELECT id FROM visible_employees)
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    -- Step 3: Merge business activity per employee
    employee_biz AS (
        SELECT
            ve.id AS employee_id,
            COALESCE(bo.order_count, 0) AS order_count,
            COALESCE(bo.sales_value, 0) AS sales_value,
            COALESCE(bv.visit_count, 0) AS visit_count,
            COALESCE(bc.customer_count, 0) AS customer_count,
            COALESCE(bco.collection_count, 0) AS collection_count,
            COALESCE(bco.collection_amount, 0) AS collection_amount
        FROM visible_employees ve
        LEFT JOIN biz_orders bo ON bo.employee_id = ve.id
        LEFT JOIN biz_visits bv ON bv.employee_id = ve.id
        LEFT JOIN biz_customers bc ON bc.employee_id = ve.id
        LEFT JOIN biz_collections bco ON bco.employee_id = ve.id
    ),
    -- Step 4: Grand totals
    grand_totals AS (
        SELECT
            COUNT(*)::int AS total_employees,
            COALESCE(SUM(order_count)::int, 0) AS total_orders,
            COALESCE(SUM(sales_value)::numeric, 0) AS total_sales,
            COALESCE(SUM(visit_count)::int, 0) AS total_visits,
            COALESCE(SUM(customer_count)::int, 0) AS total_customers,
            COALESCE(SUM(collection_count)::int, 0) AS total_collections,
            COALESCE(SUM(collection_amount)::numeric, 0) AS total_collection_amount
        FROM employee_biz
    ),
    -- Step 5: Paginated employees
    paginated AS (
        SELECT *
        FROM employee_biz
        ORDER BY
            CASE WHEN p_sort_by = 'sales_value' AND p_sort_order = 'desc' THEN sales_value END DESC NULLS LAST,
            CASE WHEN p_sort_by = 'sales_value' AND p_sort_order = 'asc' THEN sales_value END ASC NULLS LAST,
            CASE WHEN p_sort_by = 'order_count' AND p_sort_order = 'desc' THEN order_count END DESC NULLS LAST,
            CASE WHEN p_sort_by = 'order_count' AND p_sort_order = 'asc' THEN order_count END ASC NULLS LAST,
            CASE WHEN p_sort_by = 'visit_count' AND p_sort_order = 'desc' THEN visit_count END DESC NULLS LAST,
            CASE WHEN p_sort_by = 'visit_count' AND p_sort_order = 'asc' THEN visit_count END ASC NULLS LAST,
            sales_value DESC NULLS LAST
        LIMIT p_per_page OFFSET v_offset
    )
    SELECT jsonb_build_object(
        'employees', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                'employee_id', p.employee_id,
                'employee_name', ve.full_name,
                'employee_code', ve.code,
                'role_name', ve.role_name,
                'order_count', p.order_count,
                'sales_value', p.sales_value,
                'visit_count', p.visit_count,
                'customer_count', p.customer_count,
                'collection_count', p.collection_count,
                'collection_amount', p.collection_amount
            ) ORDER BY
                CASE WHEN p_sort_by = 'sales_value' AND p_sort_order = 'desc' THEN p.sales_value END DESC NULLS LAST,
                CASE WHEN p_sort_by = 'sales_value' AND p_sort_order = 'asc' THEN p.sales_value END ASC NULLS LAST,
                p.sales_value DESC)
            FROM paginated p
            JOIN visible_employees ve ON ve.id = p.employee_id),
            '[]'::jsonb
        ),
        'totals', (SELECT jsonb_build_object(
            'total_employees', gt.total_employees,
            'total_orders', gt.total_orders,
            'total_sales', gt.total_sales,
            'total_visits', gt.total_visits,
            'total_customers', gt.total_customers,
            'total_collections', gt.total_collections,
            'total_collection_amount', gt.total_collection_amount
        ) FROM grand_totals gt),
        'pagination', jsonb_build_object(
            'page', p_page,
            'per_page', p_per_page,
            'total', (SELECT cnt FROM total_count),
            'total_pages', GREATEST(1, CEIL((SELECT cnt::numeric FROM total_count) / p_per_page)::int)
        )
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_employees_business_activity TO authenticated;

-- ============================================================================
-- PART 1 / 4. get_live_activity_center — canonical order eligibility on the
-- order-based KPIs (today/hourly orders + sales, served customers, and the
-- today-orders drill). Activity feed, anomalies, and non-order KPIs unchanged.
-- ============================================================================
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
    v_today_orders jsonb;
    v_today_visits jsonb;
    v_today_customers jsonb;
    v_today_collections jsonb;
    v_now_panel jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_employee_id);
    END IF;

    -- 1 - Reuse existing employee overview
    v_overview := public.get_live_workday_overview(p_token);

    -- 2 - Executive KPIs (daily totals + hourly pulse)
    SELECT jsonb_build_object(
        'today_orders', COALESCE((SELECT COUNT(*)::int FROM public.orders o
            WHERE o.created_at::date = CURRENT_DATE
            AND public.is_order_in_statistics(o.status)
            AND (v_subtree_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(v_subtree_ids))), 0),
        'today_sales', COALESCE((SELECT SUM(o.total_amount)::numeric FROM public.orders o
            WHERE o.created_at::date = CURRENT_DATE
            AND public.is_order_in_statistics(o.status)
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
            AND public.is_order_in_statistics(o.status)
            AND (v_subtree_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(v_subtree_ids))), 0),
        'hourly_orders', COALESCE((SELECT COUNT(*)::int FROM public.orders o
            WHERE o.created_at > now() - interval '1 hour'
            AND public.is_order_in_statistics(o.status)
            AND (v_subtree_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(v_subtree_ids))), 0),
        'hourly_sales', COALESCE((SELECT SUM(o.total_amount)::numeric FROM public.orders o
            WHERE o.created_at > now() - interval '1 hour'
            AND public.is_order_in_statistics(o.status)
            AND (v_subtree_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(v_subtree_ids))), 0)
    ) INTO v_kpis;

    -- 3 - Activity feed (last 24h, up to 50 events)
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

    -- 4 - Anomaly detection
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
            'detail', 'جلسة معلقة - آخر ظهور منذ ' || EXTRACT(EPOCH FROM (now() - COALESCE(a.last_seen_at, a.start_time)))::int / 60 || ' دقيقة'
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

    -- 5 - Today orders (drill-down)
    SELECT jsonb_agg(jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'customer_name', c.company_name,
        'employee_name', COALESCE(e.full_name, '-'),
        'total_amount', o.total_amount,
        'status', o.status,
        'created_at', o.created_at
    ) ORDER BY o.created_at DESC)
    INTO v_today_orders
    FROM public.orders o
    LEFT JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.employees e ON e.id = public.resolve_employee_id(o.owner_id)
    WHERE o.created_at::date = CURRENT_DATE
    AND public.is_order_in_statistics(o.status)
    AND (v_subtree_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(v_subtree_ids));

    IF v_today_orders IS NULL THEN v_today_orders := '[]'::jsonb; END IF;

    -- 6 - Today visits (drill-down)
    SELECT jsonb_agg(jsonb_build_object(
        'id', v.id,
        'customer_name', c.company_name,
        'employee_name', e.full_name,
        'check_in_at', v.check_in_at,
        'check_out_at', v.check_out_at,
        'status', CASE WHEN v.check_out_at IS NULL THEN 'active' ELSE 'completed' END
    ) ORDER BY v.check_in_at DESC)
    INTO v_today_visits
    FROM public.visits v
    JOIN public.customers c ON c.id = v.customer_id
    JOIN public.employees e ON e.id = v.employee_id
    WHERE v.check_in_at::date = CURRENT_DATE
    AND (v_subtree_ids IS NULL OR v.employee_id = ANY(v_subtree_ids));

    IF v_today_visits IS NULL THEN v_today_visits := '[]'::jsonb; END IF;

    -- 7 - Today new customers (drill-down)
    SELECT jsonb_agg(jsonb_build_object(
        'id', cu.id,
        'code', cu.code,
        'company_name', cu.company_name,
        'employee_name', COALESCE(e.full_name, '-'),
        'registered_at', cu.registered_at,
        'created_at', cu.created_at
    ) ORDER BY cu.created_at DESC)
    INTO v_today_customers
    FROM public.customers cu
    LEFT JOIN public.employees e ON e.id = public.resolve_employee_id(cu.owner_id)
    WHERE cu.created_at::date = CURRENT_DATE
    AND (v_subtree_ids IS NULL OR public.resolve_employee_id(cu.owner_id) = ANY(v_subtree_ids));

    IF v_today_customers IS NULL THEN v_today_customers := '[]'::jsonb; END IF;

    -- 8 - Today collections (drill-down)
    SELECT jsonb_agg(jsonb_build_object(
        'id', cl.id,
        'amount', cl.amount,
        'employee_name', e.full_name,
        'created_at', cl.created_at
    ) ORDER BY cl.created_at DESC)
    INTO v_today_collections
    FROM public.collections cl
    JOIN public.employees e ON e.id = cl.created_by
    WHERE cl.created_at::date = CURRENT_DATE
    AND (v_subtree_ids IS NULL OR cl.created_by = ANY(v_subtree_ids));

    IF v_today_collections IS NULL THEN v_today_collections := '[]'::jsonb; END IF;

    -- 9 - Now Panel (يحدث الآن)
    SELECT jsonb_build_object(
        'employees_in_visit', COALESCE((SELECT COUNT(*)::int FROM public.visits v2
            WHERE v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL), 0),
        'employees_working', COALESCE((SELECT COUNT(*)::int FROM public.workday_sessions wds2
            WHERE wds2.date = CURRENT_DATE AND wds2.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM public.visits v3 WHERE v3.employee_id = wds2.employee_id AND v3.check_out_at IS NULL)), 0),
        'employees_on_break', COALESCE((SELECT COUNT(*)::int FROM public.workday_sessions wds3
            WHERE wds3.date = CURRENT_DATE AND wds3.status = 'on_break'), 0),
        'orders_in_progress', COALESCE((SELECT COUNT(*)::int FROM public.orders o2
            WHERE o2.created_at::date = CURRENT_DATE AND o2.status IN ('pending','approved')), 0),
        'collection_in_progress', COALESCE((SELECT COUNT(*)::int FROM public.collections cl2
            WHERE cl2.created_at::date = CURRENT_DATE), 0)
    ) INTO v_now_panel;

    RETURN v_overview || jsonb_build_object(
        'kpis', v_kpis,
        'activity', v_activity,
        'anomalies', v_anomalies,
        'today_orders', v_today_orders,
        'today_visits', v_today_visits,
        'today_customers', v_today_customers,
        'today_collections', v_today_collections,
        'now_panel', v_now_panel
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_live_activity_center TO authenticated;

-- ============================================================================
-- PART 2 / 1. inventory_release_status_group — canonical release-status set
-- ============================================================================
CREATE OR REPLACE FUNCTION public.inventory_release_status_group()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['returned_for_revision','submitted','cancelled','sales_manager_approved']::text[];
$$;

COMMENT ON FUNCTION public.inventory_release_status_group IS
  'Canonical inventory-release set: moving an order to one of these statuses releases its committed inventory exactly once. Statuses: returned_for_revision (معاد للتعديل), submitted (طلب شراء), cancelled (ملغى), sales_manager_approved (موافقة مدير البيع).';

-- ============================================================================
-- PART 2 / 2. enforce_execution_group_inventory — deduct on group entry
-- (unchanged); restore ONLY when the new status is an inventory-release status
-- (the old "any execution-group exit releases" rule is replaced: inventory
--  stays committed through reviewing / تم القيد بالسيستم and deferred)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_execution_group_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_deduct_result jsonb;
BEGIN
  -- Entering the Execution State Group → deduct exactly once
  -- (the group starts at approved / معتمد — the approval/commitment point).
  IF NEW.status = ANY(public.execution_status_group())
     AND OLD.status <> ALL(public.execution_status_group())
     AND OLD.inventory_deducted_at IS NULL THEN
    v_deduct_result := public.governed_inventory_deduct(OLD.id);
    IF (v_deduct_result->>'error') IS NOT NULL THEN
      RAISE EXCEPTION 'INVENTORY_DEDUCT_FAILED: %', (v_deduct_result->>'error');
    END IF;
  END IF;

  -- Moving back to an inventory-release status → restore exactly once
  -- (the approval/commitment is no longer valid only for these statuses).
  IF NEW.status = ANY(public.inventory_release_status_group())
     AND OLD.inventory_deducted_at IS NOT NULL THEN
    PERFORM public.governed_inventory_restore(
      OLD.id,
      'ORDER_EXECUTION_EXIT_RESTORE',
      'تمت إعادة الكمية لأن الطلب عاد إلى حالة تُلغي الاعتماد/الالتزام.'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_inventory_on_execution_group_crossing
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_execution_group_inventory();

-- ============================================================================
-- PART 2 / 3. governed_change_order_status — restore branch uses the release
-- status set instead of cancelled only (same function definition as 20270907
-- with this single condition change)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_change_order_status(
  p_token               text,
  p_order_id            uuid,
  p_new_status          text,
  p_reason              text DEFAULT NULL::text,
  p_reference_number    text DEFAULT NULL::text,
  p_confirm_adjustments boolean DEFAULT false
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_current_status text;
  v_customer_id uuid;
  v_total_amount decimal(12,2);
  v_payment_method varchar(20);
  v_reference_number text;
  v_from_idx int;
  v_to_idx int;
  v_required_capability text;
  v_has_capability boolean;
  v_is_exceptional boolean;
  v_order record;
  v_deduct_result jsonb;
  v_restore_result jsonb;
  v_req_row record;
  v_requested integer;
  v_capacity integer;
  v_reserved integer;
  v_notices jsonb := '[]'::jsonb;
  v_adjust_plan jsonb;
  v_neg boolean;
  v_deducted_at timestamptz;
  statuses text[] := ARRAY[
    'draft','submitted','sales_manager_approved','reviewing','returned_for_revision',
    'approved','preparing','prepared','ready_for_dispatch',
    'sent_to_delivery','dispatched','deferred','cancelled',
    'delivered','stock_review'
  ];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_SESSION');
  END IF;

  IF NOT (p_new_status = ANY(statuses)) THEN
    RETURN json_build_object('success', false, 'error', chr(1581)||chr(1575)||chr(1604)||chr(1577)||' '||chr(1593)||chr(1610)||chr(1585)||' '||chr(1589)||chr(1575)||chr(1604)||chr(1581)||chr(1577));
  END IF;

  SELECT status::text, customer_id, total_amount, payment_method, reference_number
  INTO v_current_status, v_customer_id, v_total_amount, v_payment_method, v_reference_number
  FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1591)||chr(1604)||chr(1576)||' '||chr(1593)||chr(1610)||chr(1585)||' '||chr(1605)||chr(1608)||chr(1580)||chr(1608)||chr(1583));
  END IF;

  IF v_current_status = p_new_status THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1591)||chr(1604)||chr(1576)||' '||chr(1576)||chr(1606)||chr(1601)||chr(1587)||' '||chr(1575)||chr(1604)||chr(1581)||chr(1575)||chr(1604)||chr(1577));
  END IF;

  v_from_idx := array_position(statuses, v_current_status);
  v_to_idx := array_position(statuses, p_new_status);

  SELECT check_capability(p_token, 'orders.manage') INTO v_has_capability;
  IF v_has_capability THEN
    v_required_capability := 'orders.manage';
  ELSE
    IF v_current_status = 'sales_manager_approved' AND p_new_status = 'reviewing' THEN
      v_required_capability := 'orders.review';
    ELSIF v_current_status IN ('submitted','sales_manager_approved','returned_for_revision','cancelled')
          AND p_new_status IN ('submitted','sales_manager_approved','returned_for_revision','cancelled')
          AND p_new_status <> v_current_status THEN
      v_required_capability := 'orders.approve';
    ELSIF v_current_status = 'approved' AND p_new_status = 'preparing' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF v_current_status = 'preparing' AND p_new_status = 'prepared' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF (v_current_status = 'prepared' OR v_current_status = 'ready_for_dispatch') AND p_new_status = 'sent_to_delivery' THEN
      v_required_capability := 'transportation.send_to_delivery';
    ELSE
      v_required_capability := 'orders.manage';
    END IF;
  END IF;

  SELECT check_capability(p_token, v_required_capability) INTO v_has_capability;
  IF NOT v_has_capability THEN
    RETURN json_build_object('success', false, 'error', chr(1604)||chr(1610)||chr(1587)||' '||chr(1604)||chr(1583)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1589)||chr(1604)||chr(1575)||chr(1581)||chr(1610)||chr(1577)||' '||chr(1604)||chr(1607)||chr(1584)||chr(1575)||' '||chr(1575)||chr(1604)||chr(1573)||chr(1580)||chr(1585)||chr(1575)||chr(1569));
  END IF;

  v_is_exceptional := false;
  IF v_current_status = 'cancelled' OR p_new_status = 'cancelled' THEN
    v_is_exceptional := true;
  ELSIF v_current_status = 'deferred' OR p_new_status = 'deferred' THEN
    v_is_exceptional := true;
  ELSIF v_to_idx < v_from_idx THEN
    v_is_exceptional := true;
  ELSIF v_to_idx > v_from_idx + 1 THEN
    v_is_exceptional := true;
  END IF;

  IF v_is_exceptional AND (p_reason IS NULL OR trim(p_reason) = '') THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1580)||chr(1575)||chr(1569)||' '||chr(1573)||chr(1583)||chr(1582)||chr(1575)||chr(1604)||' '||chr(1587)||chr(1576)||chr(1576)||' '||chr(1604)||chr(1604)||chr(1578)||chr(1593)||chr(1610)||chr(1585)||' '||chr(1575)||chr(1604)||chr(1575)||chr(1587)||chr(1578)||chr(1579)||chr(1606)||chr(1575)||chr(1574)||chr(1610));
  END IF;

  -- Reference number rule — mandatory when entering reviewing (from ANY previous
  -- status) UNLESS the order already carries a reference number.
  IF p_new_status = 'reviewing' THEN
    IF COALESCE(trim(v_reference_number), '') = '' THEN
      IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
        RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1602)||chr(1605)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1580)||chr(1593)||chr(1609)||' '||chr(1575)||chr(1580)||chr(1576)||chr(1575)||chr(1583)||chr(1610)||' '||chr(1593)||chr(1606)||chr(1583)||' '||chr(1575)||chr(1604)||chr(1578)||chr(1581)||chr(1608)||chr(1610)||chr(1604)||' '||chr(1573)||chr(1604)||chr(1609)||' '||chr(1580)||chr(1575)||chr(1585)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1575)||chr(1580)||chr(1593)||chr(1577));
      END IF;
    END IF;
  END IF;

  -- Execution Group Entry Finalization (القرارات 1..6):
  -- يُنفَّذ قبل تحرير الحجز حتى تعكس الكميات المُحرَّرة/المُبقاة الكمية القابلة للتنفيذ.
  IF p_new_status = ANY(public.execution_status_group())
     AND v_current_status <> ALL(public.execution_status_group()) THEN
    SELECT order_negative_selling_allowed, inventory_deducted_at
    INTO v_neg, v_deducted_at
    FROM public.orders WHERE id = p_order_id;

    IF v_deducted_at IS NULL AND NOT COALESCE(v_neg, true) THEN
      v_adjust_plan := public._plan_execution_entry_adjustments(p_order_id, true);
      IF jsonb_array_length(v_adjust_plan) > 0 THEN
        IF p_confirm_adjustments THEN
          PERFORM public._apply_execution_entry_adjustments(p_order_id, v_adjust_plan, v_session.identity_id);
        ELSE
          RETURN json_build_object(
            'success', false,
            'error', 'ADJUSTMENT_REQUIRED',
            'details', 'الكمية المطلوبة تتجاوز المخزون الفيزيائي المتاح. يلزم تأكيد التعديل قبل دخول مرحلة التنفيذ.',
            'adjustments', v_adjust_plan
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- Dynamic Reservation محرك حساب فقط — لا يُعدَّل order_items عند الاعتماد إطلاقًا.

  -- تحرير الحجز عند الخروج من submitted (قبل أي خصم/تغيير حالة).
  IF v_current_status = 'submitted' AND p_new_status <> 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      IF v_reserved > 0 THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, -v_reserved, 'RESERVATION_RELEASE',
          'تم تغيير حالة الفاتورة وتم تحرير حجز الكمية.',
          v_reserved, 0, v_session.identity_id
        );
      END IF;
    END LOOP;
  END IF;

  -- الدخول إلى submitted: تخصيص + إشعار عند تجاوز السعة المحدودة (لا رفض).
  IF p_new_status = 'submitted' AND v_current_status <> 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_requested := public._requested_quantity_for_order(v_req_row.product_id, p_order_id);
      v_reserved  := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      v_capacity  := public._reservation_capacity(v_req_row.product_id, p_order_id);

      IF v_reserved > 0 AND v_capacity IS NOT NULL THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_reserved, 'RESERVATION_ALLOCATE',
          'تم حجز الكمية لهذا الصنف.',
          0, v_reserved, v_session.identity_id
        );
      END IF;

      IF v_capacity IS NOT NULL AND v_requested > v_capacity THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_requested, 'RESERVATION_NOTICE',
          'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك.',
          0, v_requested, v_session.identity_id
        );
        v_notices := v_notices || jsonb_build_object(
          'product_id', v_req_row.product_id,
          'requested_quantity', v_requested,
          'available_capacity', v_capacity
        );
      END IF;
    END LOOP;
  END IF;

  -- Inventory management (Execution State Group)
  IF p_new_status != v_current_status THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

    -- Case 1: Entering the Execution State Group → deduct exactly once.
    IF p_new_status = ANY(public.execution_status_group())
       AND v_current_status <> ALL(public.execution_status_group())
       AND v_order.inventory_deducted_at IS NULL THEN
      v_deduct_result := public.governed_inventory_deduct(p_order_id);
      IF (v_deduct_result->>'error') IS NOT NULL THEN
        RETURN v_deduct_result::json;
      END IF;
    END IF;

    -- Case 2: Moving back to an inventory-release status → restore exactly once.
    IF p_new_status = ANY(public.inventory_release_status_group()) THEN
      v_restore_result := public.governed_inventory_restore(p_order_id);
    END IF;
  END IF;

  UPDATE orders SET
    status = p_new_status,
    reference_number = CASE
      WHEN p_new_status = 'reviewing'
        THEN COALESCE(NULLIF(trim(p_reference_number), ''), v_reference_number)
      ELSE reference_number
    END,
    delivered_at = CASE WHEN p_new_status = 'delivered' THEN now() ELSE delivered_at END,
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at, reference_number)
  VALUES (
    p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, now(),
    CASE
      WHEN p_new_status = 'reviewing'
        THEN COALESCE(NULLIF(trim(p_reference_number), ''), v_reference_number)
      ELSE NULL
    END
  );

  IF p_new_status = 'cancelled' AND v_payment_method = 'credit' THEN
    UPDATE customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'from_status', v_current_status,
    'to_status', p_new_status,
    'reservations_notice', v_notices
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.governed_change_order_status(text, uuid, text, text, text, boolean) TO PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- PART 2 / 4. governed_supreme_edit_order — re-deduct after edit driven by the
-- exactly-once committed flag (inventory_deducted_at) instead of execution-group
-- membership, so a committed order that is currently in reviewing
-- (تم القيد بالسيستم / committed but outside the execution group) stays
-- committed after a supreme edit: no silent release, no double deduction.
-- (Same definition as 20270816 with two condition changes.)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_supreme_edit_order(p_token text, p_order_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text, p_discount_amount numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_order_type character varying DEFAULT NULL::character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_items jsonb;
  v_new_items jsonb;
  v_item jsonb;
  v_product record;
  v_subtotal decimal(12,2);
  v_discount_amount decimal(12,2);
  v_total decimal(12,2);
  v_is_super boolean;
  v_order_status text;
  v_was_deducted boolean;
  v_old_res_map jsonb := '{}'::jsonb;
  v_restore_map jsonb := '{}'::jsonb;
  v_req_row record;
  v_restore_item jsonb;
  v_requested integer;
  v_capacity integer;
  v_available integer;
  v_prev integer;
  v_new integer;
  v_key text;
  v_actor_id uuid;
  v_restore_result jsonb;
  v_deduct_result jsonb;
  v_notices jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_is_super := public.is_supreme_management(v_session.employee_id);
  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Only Supreme Management can edit orders');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_actor_id := v_session.identity_id;
  v_order_status := v_order.status;
  v_was_deducted := v_order.inventory_deducted_at IS NOT NULL;

  -- خريطة الحجز القديم لكل منتج (النموذج المشتق — قبل أي تغيير).
  IF v_order_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_old_res_map := v_old_res_map || jsonb_build_object(
        v_req_row.product_id::text,
        public._reserved_quantity_for_order(v_req_row.product_id, p_order_id)
      );
    END LOOP;
  END IF;

  -- خريطة المبالغ المستردة من الخصم السابق (للتحقق المسبق من الرصيد بعد الاسترجاع).
  IF v_was_deducted THEN
    FOR v_restore_item IN SELECT * FROM jsonb_array_elements(v_order.inventory_deducted_items)
    LOOP
      v_restore_map := v_restore_map || jsonb_build_object(
        v_restore_item->>'product_id',
        COALESCE((v_restore_item->>'piece_quantity')::integer, 0)
      );
    END LOOP;
  END IF;

  -- تحقق مسبق من الرصيد لطلب محسوم سيُعاد خصمه بعد الاسترجاع (يماثل فحص الخصم الفعلي).
  IF v_was_deducted THEN
    FOR v_req_row IN
      SELECT vi.product_id, SUM(vi.req)::integer AS total_requested FROM (
        SELECT (vi->>'product_id')::uuid AS product_id,
               public._to_pieces(
                 vi->>'unit_type',
                 GREATEST(COALESCE((vi->>'unit_quantity')::integer, 1), 1),
                 pr.carton_quantity
               ) AS req
        FROM jsonb_array_elements(p_items) vi
        LEFT JOIN public.products pr ON pr.id = (vi->>'product_id')::uuid
      ) vi
      WHERE vi.product_id IS NOT NULL
      GROUP BY vi.product_id
    LOOP
      SELECT quantity INTO v_available
      FROM public.inventory
      WHERE product_id = v_req_row.product_id;

      IF NOT FOUND THEN v_available := 0; END IF;

      v_available := v_available
        + COALESCE((v_restore_map->>v_req_row.product_id::text)::integer, 0);

      IF v_available < v_req_row.total_requested THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'INSUFFICIENT_STOCK',
          'shortages', jsonb_build_array(jsonb_build_object(
            'product_id', v_req_row.product_id,
            'requested_quantity', v_req_row.total_requested,
            'available_quantity', v_available
          ))
        );
      END IF;
    END LOOP;
  END IF;

  -- طلب في submitted مع تجاوز سعة الحجز عند زيادة المحتوى: إشعار فقط (لا رفض — BR-RS-03/05).
  IF v_order_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT vi.product_id, SUM(vi.req)::integer AS total_requested FROM (
        SELECT (vi->>'product_id')::uuid AS product_id,
               public._to_pieces(
                 vi->>'unit_type',
                 GREATEST(COALESCE((vi->>'unit_quantity')::integer, 1), 1),
                 pr.carton_quantity
               ) AS req
        FROM jsonb_array_elements(p_items) vi
        LEFT JOIN public.products pr ON pr.id = (vi->>'product_id')::uuid
      ) vi
      WHERE vi.product_id IS NOT NULL
      GROUP BY vi.product_id
    LOOP
      v_capacity := public._reservation_capacity(v_req_row.product_id, p_order_id);
      IF v_capacity IS NOT NULL AND v_req_row.total_requested > v_capacity THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_req_row.total_requested, 'RESERVATION_NOTICE',
          'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك.',
          COALESCE((v_old_res_map->>v_req_row.product_id::text)::integer, 0),
          v_req_row.total_requested,
          v_actor_id
        );
        v_notices := v_notices || jsonb_build_object(
          'product_id', v_req_row.product_id,
          'requested_quantity', v_req_row.total_requested,
          'available_capacity', v_capacity
        );
      END IF;
    END LOOP;
  END IF;

  -- استرجاع الخصم القديم قبل استبدال المحتوى.
  IF v_was_deducted THEN
    v_restore_result := public.governed_inventory_restore(
      p_order_id, 'ORDER_EDIT_RESTORE', COALESCE(p_reason, 'Supreme Management edit')
    );
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price
    )
  ) INTO v_old_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;

  DELETE FROM public.order_items WHERE order_id = p_order_id;

  v_subtotal := 0;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, carton_price, carton_quantity INTO v_product
    FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND', 'detail', 'Product ' || (v_item->>'product_id'));
    END IF;

    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (
      p_order_id, (v_item->>'product_id')::uuid, v_item->>'unit_type',
      (v_item->>'unit_quantity')::int, COALESCE((v_item->>'piece_quantity')::int, 0),
      COALESCE((v_item->>'unit_price')::numeric, 0), COALESCE((v_item->>'total_price')::numeric, 0)
    );

    v_subtotal := v_subtotal + COALESCE((v_item->>'total_price')::numeric, 0);
  END LOOP;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price
    )
  ) INTO v_new_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;

  -- أحداث RESERVATION_UPDATE لطلب في submitted (لم يُعَد خصمه في نفس العملية).
  IF v_order_status = 'submitted'
     AND NOT (v_was_deducted AND v_order_status = ANY(public.execution_status_group())) THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_new := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      v_prev := COALESCE((v_old_res_map->>v_req_row.product_id::text)::integer, 0);
      IF v_prev <> v_new THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_new - v_prev, 'RESERVATION_UPDATE',
          'تم تعديل كمية الحجز بعد تعديل الفاتورة.',
          v_prev, v_new, v_actor_id
        );
      END IF;
    END LOOP;

    -- منتجات أُزيلت من الطلب: حجزها القديم يتلاشى (previous → 0).
    FOR v_key IN SELECT jsonb_object_keys(v_old_res_map)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.order_items
        WHERE order_id = p_order_id AND product_id = v_key::uuid
      ) THEN
        v_prev := (v_old_res_map->>v_key)::integer;
        IF v_prev > 0 THEN
          INSERT INTO public.inventory_movements
            (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
          VALUES (
            v_key::uuid, p_order_id, -v_prev, 'RESERVATION_UPDATE',
            'تم تحرير حجز الصنف المحذوف من الفاتورة.',
            v_prev, 0, v_actor_id
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- إعادة خصم المحتوى الجديد إن كان الطلب محسومًا (ملتزمًا بالمخزون).
  IF v_was_deducted THEN
    v_deduct_result := public.governed_inventory_deduct(p_order_id);
    IF (v_deduct_result->>'error') IS NOT NULL THEN
      RETURN v_deduct_result;
    END IF;
  END IF;

  v_subtotal := COALESCE(v_subtotal, 0);
  v_discount_amount := COALESCE(p_discount_amount, 0);
  v_total := GREATEST(v_subtotal - v_discount_amount, 0);

  UPDATE public.orders SET
    subtotal = v_subtotal, discount_amount = v_discount_amount, tax_amount = 0,
    total_amount = v_total, notes = COALESCE(p_notes, notes),
    order_type = COALESCE(p_order_type, order_type),
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, new_order_items, modified_by, reason, modified_at
  ) VALUES (
    p_order_id, v_order.revision_number, 'supreme_edit',
    jsonb_build_object('subtotal', v_order.subtotal, 'discount_amount', v_order.discount_amount, 'total_amount', v_order.total_amount, 'notes', v_order.notes)::text,
    jsonb_build_object('subtotal', v_subtotal, 'discount_amount', v_discount_amount, 'total_amount', v_total, 'notes', COALESCE(p_notes, v_order.notes))::text,
    v_old_items, v_new_items, v_session.identity_id, COALESCE(p_reason, 'Supreme Management edit'), now()
  );

  RETURN jsonb_build_object(
    'success', true, 'order_id', p_order_id,
    'item_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = p_order_id),
    'subtotal', v_subtotal, 'discount_amount', v_discount_amount, 'total_amount', v_total,
    'reservations_notice', v_notices
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.governed_supreme_edit_order(text, uuid, jsonb, text, numeric, text, character varying) TO PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- PART 2 / 3b. governed_change_order_status (legacy 5-arg overload) — same
-- release-set extension as the 6-arg version above. This overload is the
-- pre-20270903 definition (20270816) still present in the database and still
-- reachable via 4-arg RPC calls (e.g. the legacy provider's cancelOrder).
-- Kept behaviorally consistent: restore fires for every inventory-release
-- status, not only cancelled.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_change_order_status(p_token text, p_order_id uuid, p_new_status text, p_reason text DEFAULT NULL::text, p_reference_number text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_current_status text;
  v_customer_id uuid;
  v_total_amount decimal(12,2);
  v_payment_method varchar(20);
  v_from_idx int;
  v_to_idx int;
  v_required_capability text;
  v_has_capability boolean;
  v_is_exceptional boolean;
  v_order record;
  v_deduct_result jsonb;
  v_restore_result jsonb;
  v_req_row record;
  v_requested integer;
  v_capacity integer;
  v_reserved integer;
  v_notices jsonb := '[]'::jsonb;
  statuses text[] := ARRAY[
    'draft','submitted','reviewing','returned_for_revision',
    'approved','preparing','prepared','ready_for_dispatch',
    'sent_to_delivery','dispatched','deferred','cancelled',
    'delivered','stock_review'
  ];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_SESSION');
  END IF;

  IF NOT (p_new_status = ANY(statuses)) THEN
    RETURN json_build_object('success', false, 'error', chr(1581)||chr(1575)||chr(1604)||chr(1577)||' '||chr(1594)||chr(1610)||chr(1585)||' '||chr(1589)||chr(1575)||chr(1604)||chr(1581)||chr(1577));
  END IF;

  SELECT status::text, customer_id, total_amount, payment_method
  INTO v_current_status, v_customer_id, v_total_amount, v_payment_method
  FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1591)||chr(1604)||chr(1576)||' '||chr(1594)||chr(1610)||chr(1585)||' '||chr(1605)||chr(1608)||chr(1580)||chr(1608)||chr(1583));
  END IF;

  IF v_current_status = p_new_status THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1591)||chr(1604)||chr(1576)||' '||chr(1576)||chr(1606)||chr(1601)||chr(1587)||' '||chr(1575)||chr(1604)||chr(1581)||chr(1575)||chr(1604)||chr(1577));
  END IF;

  v_from_idx := array_position(statuses, v_current_status);
  v_to_idx := array_position(statuses, p_new_status);

  SELECT check_capability(p_token, 'orders.manage') INTO v_has_capability;
  IF v_has_capability THEN
    v_required_capability := 'orders.manage';
  ELSE
    IF v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN
      v_required_capability := 'orders.review';
    ELSIF v_current_status = 'approved' AND p_new_status = 'preparing' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF v_current_status = 'preparing' AND p_new_status = 'prepared' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF (v_current_status = 'prepared' OR v_current_status = 'ready_for_dispatch') AND p_new_status = 'sent_to_delivery' THEN
      v_required_capability := 'transportation.send_to_delivery';
    ELSE
      v_required_capability := 'orders.manage';
    END IF;
  END IF;

  SELECT check_capability(p_token, v_required_capability) INTO v_has_capability;
  IF NOT v_has_capability THEN
    RETURN json_build_object('success', false, 'error', chr(1604)||chr(1610)||chr(1587)||' '||chr(1604)||chr(1583)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1589)||chr(1604)||chr(1575)||chr(1581)||chr(1610)||chr(1577)||' '||chr(1604)||chr(1607)||chr(1584)||chr(1575)||' '||chr(1575)||chr(1604)||chr(1573)||chr(1580)||chr(1585)||chr(1575)||chr(1569));
  END IF;

  v_is_exceptional := false;
  IF v_current_status = 'cancelled' OR p_new_status = 'cancelled' THEN
    v_is_exceptional := true;
  ELSIF v_current_status = 'deferred' OR p_new_status = 'deferred' THEN
    v_is_exceptional := true;
  ELSIF v_to_idx < v_from_idx THEN
    v_is_exceptional := true;
  ELSIF v_to_idx > v_from_idx + 1 THEN
    v_is_exceptional := true;
  END IF;

  IF v_is_exceptional AND (p_reason IS NULL OR trim(p_reason) = '') THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1580)||chr(1575)||chr(1569)||' '||chr(1573)||chr(1583)||chr(1582)||chr(1575)||chr(1604)||' '||chr(1587)||chr(1576)||chr(1576)||' '||chr(1604)||chr(1604)||chr(1578)||chr(1594)||chr(1610)||chr(1585)||' '||chr(1575)||chr(1604)||chr(1575)||chr(1587)||chr(1578)||chr(1579)||chr(1606)||chr(1575)||chr(1574)||chr(1610));
  END IF;

  IF v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN
    IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
      RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1602)||chr(1605)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1580)||chr(1593)||chr(1609)||' '||chr(1575)||chr(1580)||chr(1576)||chr(1575)||chr(1583)||chr(1610)||' '||chr(1593)||chr(1606)||chr(1583)||' '||chr(1575)||chr(1604)||chr(1578)||chr(1581)||chr(1608)||chr(1610)||chr(1604)||' '||chr(1573)||chr(1604)||chr(1609)||' '||chr(1580)||chr(1575)||chr(1585)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1575)||chr(1580)||chr(1593)||chr(1577));
    END IF;
  END IF;

  -- Dynamic Reservation محرك حساب فقط — لا يُعدَّل order_items عند الاعتماد إطلاقًا.

  -- تحرير الحجز عند الخروج من submitted (قبل أي خصم/تغيير حالة).
  IF v_current_status = 'submitted' AND p_new_status <> 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      IF v_reserved > 0 THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, -v_reserved, 'RESERVATION_RELEASE',
          'تم تغيير حالة الفاتورة وتم تحرير حجز الكمية.',
          v_reserved, 0, v_session.identity_id
        );
      END IF;
    END LOOP;
  END IF;

  -- الدخول إلى submitted: تخصيص + إشعار عند تجاوز السعة المحدودة (لا رفض).
  IF p_new_status = 'submitted' AND v_current_status <> 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_requested := public._requested_quantity_for_order(v_req_row.product_id, p_order_id);
      v_reserved  := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      v_capacity  := public._reservation_capacity(v_req_row.product_id, p_order_id);

      IF v_reserved > 0 AND v_capacity IS NOT NULL THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_reserved, 'RESERVATION_ALLOCATE',
          'تم حجز الكمية لهذا الصنف.',
          0, v_reserved, v_session.identity_id
        );
      END IF;

      IF v_capacity IS NOT NULL AND v_requested > v_capacity THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_requested, 'RESERVATION_NOTICE',
          'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك.',
          0, v_requested, v_session.identity_id
        );
        v_notices := v_notices || jsonb_build_object(
          'product_id', v_req_row.product_id,
          'requested_quantity', v_requested,
          'available_capacity', v_capacity
        );
      END IF;
    END LOOP;
  END IF;

  -- Inventory management (Execution State Group)
  IF p_new_status != v_current_status THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

    -- Case 1: Entering the Execution State Group → deduct exactly once.
    IF p_new_status = ANY(public.execution_status_group())
       AND v_current_status <> ALL(public.execution_status_group())
       AND v_order.inventory_deducted_at IS NULL THEN
      v_deduct_result := public.governed_inventory_deduct(p_order_id);
      IF (v_deduct_result->>'error') IS NOT NULL THEN
        RETURN v_deduct_result::json;
      END IF;
    END IF;

    -- Case 2: Moving back to an inventory-release status → restore exactly once.
    IF p_new_status = ANY(public.inventory_release_status_group()) THEN
      v_restore_result := public.governed_inventory_restore(p_order_id);
    END IF;
  END IF;

  UPDATE orders SET
    status = p_new_status,
    reference_number = CASE
      WHEN v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN trim(p_reference_number)
      ELSE reference_number
    END,
    delivered_at = CASE WHEN p_new_status = 'delivered' THEN now() ELSE delivered_at END,
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, now());

  IF p_new_status = 'cancelled' AND v_payment_method = 'credit' THEN
    UPDATE customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'from_status', v_current_status,
    'to_status', p_new_status,
    'reservations_notice', v_notices
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.governed_change_order_status(text, uuid, text, text, text) TO PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
