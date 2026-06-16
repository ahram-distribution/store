-- ===============================================================
-- Customer Intelligence System
-- Two RPCs: per-customer intelligence + global customer overview
-- All aggregation in backend, unified filtering, no null values
-- ===============================================================

-- ===============================================================
-- RPC 1: get_customer_intelligence
-- Returns full 360° intelligence for one customer
-- ===============================================================
CREATE OR REPLACE FUNCTION public.get_customer_intelligence(
    p_token uuid,
    p_customer_id uuid,
    p_from date DEFAULT NULL,
    p_to date DEFAULT NULL,
    p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_summary jsonb;
    v_orders jsonb;
    v_visits jsonb;
    v_products jsonb;
    v_companies jsonb;
    v_insights jsonb;
    v_filter_options jsonb;
    v_total_value numeric;
    v_expected_next date;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF p_from IS NULL THEN p_from := CURRENT_DATE - INTERVAL '12 months'; END IF;
    IF p_to IS NULL THEN p_to := CURRENT_DATE; END IF;

    -- ==========================================
    -- SUMMARY
    -- ==========================================
    WITH cust_orders AS (
        SELECT o.id, o.total_amount, o.created_at, o.status
        FROM orders o
        WHERE o.customer_id = p_customer_id
          AND o.status NOT IN ('draft', 'cancelled')
          AND o.created_at::date >= p_from
          AND o.created_at::date <= p_to
    ),
    cust_visits AS (
        SELECT COUNT(*) AS cnt
        FROM visits v
        WHERE v.customer_id = p_customer_id
          AND v.status = 'completed'
          AND v.check_in_at::date >= p_from
          AND v.check_in_at::date <= p_to
    )
    SELECT jsonb_build_object(
        'total_orders', COALESCE((SELECT COUNT(*)::int FROM cust_orders), 0),
        'total_value', COALESCE((SELECT SUM(total_amount) FROM cust_orders), 0),
        'avg_order_value', CASE WHEN (SELECT COUNT(*) FROM cust_orders) > 0 THEN ROUND((SELECT SUM(total_amount) FROM cust_orders) / (SELECT COUNT(*)::numeric FROM cust_orders), 2) ELSE 0 END,
        'last_order_date', (SELECT MAX(created_at) FROM cust_orders),
        'first_order_date', (SELECT MIN(created_at) FROM cust_orders),
        'total_visits', COALESCE((SELECT cnt FROM cust_visits), 0),
        'active_days', COALESCE((SELECT COUNT(DISTINCT created_at::date)::int FROM cust_orders), 0)
    ) INTO v_summary;

    v_total_value := COALESCE((v_summary->>'total_value')::numeric, 0);

    -- ==========================================
    -- ORDERS
    -- ==========================================
    SELECT jsonb_agg(jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'total_amount', o.total_amount,
        'created_at', o.created_at,
        'item_count', (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id),
        'owner_name', e.full_name
    ) ORDER BY o.created_at DESC)
    INTO v_orders
    FROM orders o
    LEFT JOIN employees e ON e.id = o.created_by
    WHERE o.customer_id = p_customer_id
      AND o.status NOT IN ('draft')
      AND o.created_at::date >= p_from
      AND o.created_at::date <= p_to
      AND (p_filters->>'status' IS NULL OR p_filters->>'status' = '' OR o.status = p_filters->>'status');

    -- ==========================================
    -- VISITS
    -- ==========================================
    SELECT jsonb_agg(jsonb_build_object(
        'id', v.id,
        'code', v.code,
        'status', v.status,
        'visit_result', COALESCE(v.visit_result, 'غير متوفر'),
        'check_in_at', v.check_in_at,
        'check_out_at', v.check_out_at,
        'duration_minutes', CASE WHEN v.check_out_at IS NOT NULL THEN GREATEST(ROUND(EXTRACT(EPOCH FROM (v.check_out_at - v.check_in_at)) / 60)::int, 0) ELSE NULL END,
        'employee_name', COALESCE(e.full_name, 'غير متوفر')
    ) ORDER BY v.check_in_at DESC)
    INTO v_visits
    FROM visits v
    LEFT JOIN employees e ON e.id = v.employee_id
    WHERE v.customer_id = p_customer_id
      AND v.check_in_at::date >= p_from
      AND v.check_in_at::date <= p_to;

    -- ==========================================
    -- PRODUCTS ANALYSIS
    -- ==========================================
    SELECT jsonb_agg(jsonb_build_object(
        'product_id', p.id,
        'product_name', p.product_name,
        'company_name', COALESCE(c.company_name, 'غير متوفر'),
        'total_pieces', SUM(oi.piece_quantity)::int,
        'total_value', SUM(oi.total_price),
        'order_count', COUNT(DISTINCT oi.order_id)::int,
        'last_purchase', MAX(o.created_at),
        'qty_piece', COALESCE(SUM(CASE WHEN oi.unit_type = 'piece' THEN oi.unit_quantity ELSE 0 END), 0)::int,
        'qty_dozen', COALESCE(SUM(CASE WHEN oi.unit_type = 'dozen' THEN oi.unit_quantity ELSE 0 END), 0)::int,
        'qty_carton', COALESCE(SUM(CASE WHEN oi.unit_type = 'carton' THEN oi.unit_quantity ELSE 0 END), 0)::int
    ) ORDER BY SUM(oi.total_price) DESC NULLS LAST)
    INTO v_products
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN companies c ON c.id = p.company_id
    WHERE o.customer_id = p_customer_id
      AND o.status NOT IN ('draft')
      AND o.created_at::date >= p_from
      AND o.created_at::date <= p_to
      AND (p_filters->>'product_id' IS NULL OR p_filters->>'product_id' = '' OR oi.product_id = (p_filters->>'product_id')::uuid)
      AND (p_filters->>'company_id' IS NULL OR p_filters->>'company_id' = '' OR p.company_id = (p_filters->>'company_id')::uuid)
    GROUP BY p.id, p.product_name, c.company_name;

    -- ==========================================
    -- COMPANIES / BRANDS ANALYSIS
    -- ==========================================
    SELECT jsonb_agg(jsonb_build_object(
        'company_id', comp.id,
        'company_name', comp.company_name,
        'order_count', comp_data.order_count,
        'total_spent', comp_data.total_spent,
        'share_pct', CASE WHEN v_total_value > 0 THEN ROUND((comp_data.total_spent / v_total_value * 100)::numeric, 1) ELSE 0 END
    ) ORDER BY comp_data.total_spent DESC)
    INTO v_companies
    FROM (
        SELECT c.id, c.company_name
        FROM companies c
        WHERE EXISTS (
            SELECT 1 FROM products p
            JOIN order_items oi ON oi.product_id = p.id
            JOIN orders o ON o.id = oi.order_id
            WHERE p.company_id = c.id
              AND o.customer_id = p_customer_id
              AND o.status NOT IN ('draft')
              AND o.created_at::date >= p_from AND o.created_at::date <= p_to
        )
    ) comp
    JOIN LATERAL (
        SELECT COUNT(DISTINCT o.id)::int AS order_count,
               COALESCE(SUM(oi.total_price), 0) AS total_spent
        FROM products p
        JOIN order_items oi ON oi.product_id = p.id
        JOIN orders o ON o.id = oi.order_id
        WHERE p.company_id = comp.id
          AND o.customer_id = p_customer_id
          AND o.status NOT IN ('draft')
          AND o.created_at::date >= p_from AND o.created_at::date <= p_to
    ) comp_data ON true;

    -- ==========================================
    -- BEHAVIOR INSIGHTS
    -- ==========================================
    WITH order_dates AS (
        SELECT created_at::date AS order_date
        FROM orders
        WHERE customer_id = p_customer_id
          AND status NOT IN ('draft', 'cancelled')
          AND created_at::date >= p_from
          AND created_at::date <= p_to
        ORDER BY created_at
    ),
    gaps AS (
        SELECT order_date - LAG(order_date) OVER (ORDER BY order_date) AS gap_days
        FROM order_dates
    ),
    dow AS (
        SELECT EXTRACT(DOW FROM created_at) AS day_of_week,
               COUNT(*)::int AS cnt
        FROM orders
        WHERE customer_id = p_customer_id
          AND status NOT IN ('draft', 'cancelled')
          AND created_at::date >= p_from
          AND created_at::date <= p_to
        GROUP BY EXTRACT(DOW FROM created_at)
    ),
    half_split AS (
        SELECT
            COUNT(*) FILTER (WHERE created_at::date <= (p_from::date + ((p_to - p_from) / 2)::int)) AS first_half,
            COUNT(*) FILTER (WHERE created_at::date > (p_from::date + ((p_to - p_from) / 2)::int)) AS second_half
        FROM orders
        WHERE customer_id = p_customer_id
          AND status NOT IN ('draft', 'cancelled')
          AND created_at::date >= p_from
          AND created_at::date <= p_to
    )
    SELECT jsonb_build_object(
        'total_orders', COALESCE((v_summary->>'total_orders')::int, 0),
        'repeat_customer', COALESCE((v_summary->>'total_orders')::int, 0) > 1,
        'avg_days_between_orders', (SELECT ROUND(AVG(gap_days)::numeric, 1) FROM gaps WHERE gap_days IS NOT NULL),
        'peak_day_name', (SELECT CASE
            WHEN day_of_week = 0 THEN 'الأحد' WHEN day_of_week = 1 THEN 'الإثنين'
            WHEN day_of_week = 2 THEN 'الثلاثاء' WHEN day_of_week = 3 THEN 'الأربعاء'
            WHEN day_of_week = 4 THEN 'الخميس' WHEN day_of_week = 5 THEN 'الجمعة'
            WHEN day_of_week = 6 THEN 'السبت' ELSE 'غير متوفر'
        END FROM dow ORDER BY cnt DESC LIMIT 1),
        'peak_day_orders', (SELECT cnt FROM dow ORDER BY cnt DESC LIMIT 1),
        'trend', CASE
            WHEN (SELECT COUNT(*) FROM order_dates) >= 3 THEN (
                SELECT CASE
                    WHEN first_half < second_half THEN 'زيادة'
                    WHEN first_half > second_half THEN 'انخفاض'
                    ELSE 'ثبات'
                END FROM half_split
            ) ELSE 'غير كافٍ'
        END,
        'first_order_date', (v_summary->>'first_order_date')::text,
        'last_order_date', (v_summary->>'last_order_date')::text,
        'total_months_active', CASE
            WHEN (v_summary->>'first_order_date') IS NOT NULL THEN
                GREATEST(1, (SELECT ROUND(EXTRACT(DAY FROM (p_to::timestamp - (v_summary->>'first_order_date')::timestamp)) / 30.44)::int))
            ELSE 0
        END,
        'value_per_month', CASE
            WHEN (v_summary->>'first_order_date') IS NOT NULL AND v_total_value > 0 THEN
                ROUND(v_total_value / NULLIF(GREATEST(1, (SELECT ROUND(EXTRACT(DAY FROM (p_to::timestamp - (v_summary->>'first_order_date')::timestamp)) / 30.44)::int)), 0), 2)
            ELSE 0
        END
    ) INTO v_insights;

    -- ==========================================
    -- FILTER OPTIONS
    -- ==========================================
    SELECT jsonb_build_object(
        'statuses', COALESCE((SELECT jsonb_agg(DISTINCT o.status) FROM orders o WHERE o.customer_id = p_customer_id AND o.status NOT IN ('draft') AND o.created_at::date >= p_from AND o.created_at::date <= p_to), '[]'::jsonb),
        'products', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('id', p.id, 'name', p.product_name)) FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id WHERE o.customer_id = p_customer_id AND o.status NOT IN ('draft') AND o.created_at::date >= p_from AND o.created_at::date <= p_to), '[]'::jsonb),
        'companies', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('id', c.id, 'name', c.company_name)) FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id JOIN companies c ON c.id = p.company_id WHERE o.customer_id = p_customer_id AND o.status NOT IN ('draft') AND o.created_at::date >= p_from AND o.created_at::date <= p_to), '[]'::jsonb)
    ) INTO v_filter_options;

    RETURN jsonb_build_object(
        'summary', COALESCE(v_summary, jsonb_build_object('total_orders', 0, 'total_value', 0, 'avg_order_value', 0, 'total_visits', 0, 'active_days', 0)),
        'orders', COALESCE(v_orders, '[]'::jsonb),
        'visits', COALESCE(v_visits, '[]'::jsonb),
        'products', COALESCE(v_products, '[]'::jsonb),
        'companies', COALESCE(v_companies, '[]'::jsonb),
        'insights', COALESCE(v_insights, '{}'::jsonb),
        'filter_options', COALESCE(v_filter_options, '{}'::jsonb)
    );
END;
$function$;


-- ===============================================================
-- RPC 2: get_customer_intelligence_overview
-- Global customer comparison: top buyers, most diverse, most frequent
-- ===============================================================
CREATE OR REPLACE FUNCTION public.get_customer_intelligence_overview(
    p_token uuid,
    p_from date DEFAULT NULL,
    p_to date DEFAULT NULL,
    p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_customer_ids uuid[];
    v_general jsonb;
    v_top_customers jsonb;
    v_most_diverse jsonb;
    v_most_frequent jsonb;
    v_total_customers int;
    v_total_orders int;
    v_total_value numeric;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF p_from IS NULL THEN p_from := CURRENT_DATE - INTERVAL '12 months'; END IF;
    IF p_to IS NULL THEN p_to := CURRENT_DATE; END IF;

    -- Visible customers
    v_customer_ids := public.get_visible_employee_ids(p_token);
    IF v_customer_ids IS NULL THEN
        SELECT array_agg(DISTINCT o.customer_id) INTO v_customer_ids
        FROM orders o WHERE o.status NOT IN ('draft');
    END IF;

    IF v_customer_ids IS NULL OR array_length(v_customer_ids, 1) IS NULL THEN
        RETURN jsonb_build_object(
            'general_stats', '{}'::jsonb, 'top_customers', '[]'::jsonb,
            'most_diverse', '[]'::jsonb, 'most_frequent', '[]'::jsonb
        );
    END IF;

    -- ==========================================
    -- GENERAL STATS
    -- ==========================================
    WITH filtered AS (
        SELECT o.customer_id, o.total_amount, oi.product_id, oi.unit_type, oi.unit_quantity, oi.piece_quantity,
               p.company_id
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        WHERE o.customer_id = ANY(v_customer_ids)
          AND o.status NOT IN ('draft', 'cancelled')
          AND o.created_at::date >= p_from
          AND o.created_at::date <= p_to
          AND (p_search IS NULL OR p_search = '' OR EXISTS (
              SELECT 1 FROM customers cc WHERE cc.id = o.customer_id AND cc.company_name ILIKE '%' || p_search || '%'
          ))
    )
    SELECT jsonb_build_object(
        'customer_count', COALESCE((SELECT COUNT(DISTINCT customer_id)::int FROM filtered), 0),
        'order_count', COALESCE((SELECT COUNT(*)::int FROM orders o WHERE o.customer_id = ANY(v_customer_ids) AND o.status NOT IN ('draft', 'cancelled') AND o.created_at::date >= p_from AND o.created_at::date <= p_to), 0),
        'total_sales', COALESCE((SELECT SUM(total_amount) FROM orders o WHERE o.customer_id = ANY(v_customer_ids) AND o.status NOT IN ('draft', 'cancelled') AND o.created_at::date >= p_from AND o.created_at::date <= p_to), 0),
        'companies_count', COALESCE((SELECT COUNT(DISTINCT company_id)::int FROM filtered), 0),
        'products_count', COALESCE((SELECT COUNT(DISTINCT product_id)::int FROM filtered), 0),
        'total_pieces', COALESCE((SELECT SUM(piece_quantity)::int FROM filtered), 0),
        'total_dozens', COALESCE((SELECT SUM(unit_quantity) FILTER (WHERE unit_type = 'dozen')::int FROM filtered), 0),
        'total_cartons', COALESCE((SELECT SUM(unit_quantity) FILTER (WHERE unit_type = 'carton')::int FROM filtered), 0)
    ) INTO v_general;

    -- ==========================================
    -- TOP CUSTOMERS (by purchase value)
    -- ==========================================
    SELECT jsonb_agg(jsonb_build_object(
        'customer_id', c.id,
        'company_name', c.company_name,
        'total_spent', COALESCE(SUM(o.total_amount), 0),
        'order_count', COUNT(DISTINCT o.id)::int,
        'last_order', MAX(o.created_at)
    ) ORDER BY SUM(o.total_amount) DESC NULLS LAST LIMIT 20)
    INTO v_top_customers
    FROM customers c
    JOIN orders o ON o.customer_id = c.id
    WHERE c.id = ANY(v_customer_ids)
      AND o.status NOT IN ('draft', 'cancelled')
      AND o.created_at::date >= p_from
      AND o.created_at::date <= p_to
      AND (p_search IS NULL OR p_search = '' OR c.company_name ILIKE '%' || p_search || '%')
    GROUP BY c.id, c.company_name;

    -- ==========================================
    -- MOST DIVERSE (by unique products + brands)
    -- ==========================================
    SELECT jsonb_agg(jsonb_build_object(
        'customer_id', c.id,
        'company_name', c.company_name,
        'unique_products', COALESCE(d.unique_products, 0),
        'unique_brands', COALESCE(d.unique_brands, 0),
        'diversity_score', COALESCE(d.diversity_score, 0)
    ) ORDER BY d.diversity_score DESC NULLS LAST LIMIT 20)
    INTO v_most_diverse
    FROM customers c
    JOIN LATERAL (
        SELECT
            COUNT(DISTINCT oi.product_id)::int AS unique_products,
            COUNT(DISTINCT p.company_id)::int AS unique_brands,
            (COUNT(DISTINCT oi.product_id) + COUNT(DISTINCT p.company_id))::int AS diversity_score
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        WHERE o.customer_id = c.id
          AND o.status NOT IN ('draft', 'cancelled')
          AND o.created_at::date >= p_from
          AND o.created_at::date <= p_to
    ) d ON true
    WHERE c.id = ANY(v_customer_ids)
      AND (p_search IS NULL OR p_search = '' OR c.company_name ILIKE '%' || p_search || '%')
      AND d.unique_products > 0;

    -- ==========================================
    -- MOST FREQUENT (by order count)
    -- ==========================================
    SELECT jsonb_agg(jsonb_build_object(
        'customer_id', c.id,
        'company_name', c.company_name,
        'order_count', COALESCE(f.order_count, 0),
        'avg_days_between', f.avg_days_between,
        'first_order', f.first_order,
        'last_order', f.last_order
    ) ORDER BY f.order_count DESC NULLS LAST LIMIT 20)
    INTO v_most_frequent
    FROM customers c
    JOIN LATERAL (
        SELECT
            COUNT(*)::int AS order_count,
            CASE WHEN COUNT(*) > 1 THEN ROUND((EXTRACT(DAY FROM (MAX(created_at) - MIN(created_at))) / (COUNT(*) - 1)::numeric), 1) ELSE NULL END AS avg_days_between,
            MIN(created_at) AS first_order,
            MAX(created_at) AS last_order
        FROM orders o
        WHERE o.customer_id = c.id
          AND o.status NOT IN ('draft', 'cancelled')
          AND o.created_at::date >= p_from
          AND o.created_at::date <= p_to
    ) f ON true
    WHERE c.id = ANY(v_customer_ids)
      AND (p_search IS NULL OR p_search = '' OR c.company_name ILIKE '%' || p_search || '%')
      AND f.order_count > 1
    ORDER BY f.order_count DESC;

    RETURN jsonb_build_object(
        'general_stats', COALESCE(v_general, '{}'::jsonb),
        'top_customers', COALESCE(v_top_customers, '[]'::jsonb),
        'most_diverse', COALESCE(v_most_diverse, '[]'::jsonb),
        'most_frequent', COALESCE(v_most_frequent, '[]'::jsonb)
    );
END;
$function$;
