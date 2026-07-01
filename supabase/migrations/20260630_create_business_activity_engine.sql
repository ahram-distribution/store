-- ================================================================
-- Business Activity Engine — طبقة النشاط التجاري المستقلة
-- 
-- المصدر فقط: orders, visits, customers, collections
-- لا يعتمد إطلاقًا على وجود workday_sessions
--
-- لو مدير البيع لم يسجل حضورًا:
-- Attendance = صفر
-- Business Activity = كامل (إن كان لديه نشاط)
-- ================================================================

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

COMMENT ON FUNCTION public.get_employees_business_activity IS 'النشاط التجاري للمندوبين — طلبات، مبيعات، زيارات، عملاء، تحصيل (بدون اعتماد على Attendance)';
