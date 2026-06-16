-- ===============================================================
-- Customer Intelligence System — Modular RPC Architecture
-- 5 focused RPCs replacing monolithic get_customer_intelligence
-- Each RPC: pre-aggregated, safe defaults, no null/NaN/undefined
-- ===============================================================

-- ===============================================================
-- RPC 1: get_customer_full_profile
-- Customer info + order/visit KPIs
-- ===============================================================
CREATE OR REPLACE FUNCTION public.get_customer_full_profile(
    p_token uuid,
    p_customer_id uuid,
    p_from date DEFAULT NULL,
    p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_customer_info jsonb;
    v_stats jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF p_from IS NULL THEN p_from := CURRENT_DATE - INTERVAL '12 months'; END IF;
    IF p_to IS NULL THEN p_to := CURRENT_DATE; END IF;

    -- Customer base info
    SELECT jsonb_build_object(
        'id', c.id,
        'code', COALESCE(c.code, 'غير متوفر'),
        'company_name', COALESCE(c.company_name, 'غير متوفر'),
        'email', COALESCE(c.email, 'غير متوفر'),
        'phone', COALESCE(i.phone, 'غير متوفر'),
        'business_type', COALESCE(c.business_type, 'غير متوفر'),
        'responsible_name', COALESCE(c.responsible_name, 'غير متوفر'),
        'credit_limit', COALESCE(c.credit_limit, 0),
        'credit_days', COALESCE(c.credit_days, 0),
        'is_active', COALESCE(c.is_active, false),
        'registered_at', c.registered_at,
        'created_at', c.created_at,
        'owner_name', COALESCE(e.full_name, 'غير متوفر'),
        'tier_name', COALESCE(t.name, 'غير متوفر')
    ) INTO v_customer_info
    FROM customers c
    LEFT JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id
    LEFT JOIN tiers t ON t.id = c.tier_id
    WHERE c.id = p_customer_id;

    -- Aggregated stats
    WITH ord_stats AS (
        SELECT
            COUNT(*)::int AS total_orders,
            COALESCE(SUM(o.total_amount), 0) AS total_sales,
            CASE WHEN COUNT(*) > 0 THEN ROUND(COALESCE(SUM(o.total_amount), 0) / COUNT(*)::numeric, 2) ELSE 0 END AS avg_order_value,
            MAX(o.created_at) AS last_order_date,
            MIN(o.created_at) AS first_order_date,
            COUNT(DISTINCT o.created_at::date)::int AS active_days
        FROM orders o
        WHERE o.customer_id = p_customer_id
          AND o.status NOT IN ('draft', 'cancelled')
          AND o.created_at::date >= p_from
          AND o.created_at::date <= p_to
    ),
    vis_stats AS (
        SELECT
            COUNT(*)::int AS visit_count,
            COUNT(*) FILTER (WHERE v.status = 'completed')::int AS successful_visits,
            MAX(v.check_in_at) AS last_visit_date
        FROM visits v
        WHERE v.customer_id = p_customer_id
          AND v.check_in_at::date >= p_from
          AND v.check_in_at::date <= p_to
    )
    SELECT jsonb_build_object(
        'total_orders', COALESCE(ord_stats.total_orders, 0),
        'total_sales', COALESCE(ord_stats.total_sales, 0),
        'avg_order_value', COALESCE(ord_stats.avg_order_value, 0),
        'last_order_date', ord_stats.last_order_date,
        'first_order_date', ord_stats.first_order_date,
        'active_days', COALESCE(ord_stats.active_days, 0),
        'visit_count', COALESCE(vis_stats.visit_count, 0),
        'successful_visits', COALESCE(vis_stats.successful_visits, 0),
        'last_visit_date', vis_stats.last_visit_date
    ) INTO v_stats
    FROM ord_stats, vis_stats;

    RETURN jsonb_build_object(
        'customer', COALESCE(v_customer_info, jsonb_build_object()),
        'stats', COALESCE(v_stats, jsonb_build_object(
            'total_orders', 0, 'total_sales', 0, 'avg_order_value', 0,
            'active_days', 0, 'visit_count', 0, 'successful_visits', 0
        ))
    );
END;
$function$;


-- ===============================================================
-- RPC 2: get_customer_products_analysis
-- Product-level aggregation: quantities, values, order counts
-- Returns array grouped by (product_id, unit_type)
-- ===============================================================
CREATE OR REPLACE FUNCTION public.get_customer_products_analysis(
    p_token uuid,
    p_customer_id uuid,
    p_from date DEFAULT NULL,
    p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_products jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF p_from IS NULL THEN p_from := CURRENT_DATE - INTERVAL '12 months'; END IF;
    IF p_to IS NULL THEN p_to := CURRENT_DATE; END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'product_id', p.id,
        'product_name', COALESCE(p.product_name, 'غير متوفر'),
        'company_name', COALESCE(c.company_name, 'غير متوفر'),
        'unit_type', COALESCE(oi.unit_type, 'piece'),
        'total_quantity', SUM(oi.unit_quantity)::int,
        'total_pieces', COALESCE(SUM(oi.piece_quantity), 0)::int,
        'total_orders_count', COUNT(DISTINCT oi.order_id)::int,
        'total_value', COALESCE(SUM(oi.total_price), 0),
        'last_purchase', MAX(o.created_at)
    ) ORDER BY SUM(oi.total_price) DESC NULLS LAST), '[]'::jsonb) INTO v_products
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN companies c ON c.id = p.company_id
    WHERE o.customer_id = p_customer_id
      AND o.status NOT IN ('draft')
      AND o.created_at::date >= p_from
      AND o.created_at::date <= p_to
    GROUP BY p.id, p.product_name, c.company_name, oi.unit_type;

    RETURN jsonb_build_object('products', COALESCE(v_products, '[]'::jsonb));
END;
$function$;


-- ===============================================================
-- RPC 3: get_customer_companies_analysis
-- Company/brand aggregation with percentage share
-- ===============================================================
CREATE OR REPLACE FUNCTION public.get_customer_companies_analysis(
    p_token uuid,
    p_customer_id uuid,
    p_from date DEFAULT NULL,
    p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_total_value numeric;
    v_companies jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF p_from IS NULL THEN p_from := CURRENT_DATE - INTERVAL '12 months'; END IF;
    IF p_to IS NULL THEN p_to := CURRENT_DATE; END IF;

    -- Total customer spend in period
    SELECT COALESCE(SUM(oi.total_price), 0) INTO v_total_value
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.customer_id = p_customer_id
      AND o.status NOT IN ('draft')
      AND o.created_at::date >= p_from
      AND o.created_at::date <= p_to;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'company_id', comp.id,
        'company_name', COALESCE(comp.company_name, 'غير متوفر'),
        'orders_count', comp_data.order_count,
        'total_value', comp_data.total_value,
        'percentage_share', CASE WHEN v_total_value > 0 THEN ROUND((comp_data.total_value / v_total_value * 100)::numeric, 1) ELSE 0 END
    ) ORDER BY comp_data.total_value DESC NULLS LAST), '[]'::jsonb) INTO v_companies
    FROM (
        SELECT DISTINCT c.id, c.company_name
        FROM companies c
        WHERE EXISTS (
            SELECT 1 FROM products p
            JOIN order_items oi ON oi.product_id = p.id
            JOIN orders o ON o.id = oi.order_id
            WHERE p.company_id = c.id
              AND o.customer_id = p_customer_id
              AND o.status NOT IN ('draft')
              AND o.created_at::date >= p_from
              AND o.created_at::date <= p_to
        )
    ) comp
    JOIN LATERAL (
        SELECT
            COUNT(DISTINCT o.id)::int AS order_count,
            COALESCE(SUM(oi.total_price), 0) AS total_value
        FROM products p
        JOIN order_items oi ON oi.product_id = p.id
        JOIN orders o ON o.id = oi.order_id
        WHERE p.company_id = comp.id
          AND o.customer_id = p_customer_id
          AND o.status NOT IN ('draft')
          AND o.created_at::date >= p_from
          AND o.created_at::date <= p_to
    ) comp_data ON true;

    RETURN jsonb_build_object(
        'companies', COALESCE(v_companies, '[]'::jsonb),
        'total_value', COALESCE(v_total_value, 0)
    );
END;
$function$;


-- ===============================================================
-- RPC 4: get_customer_visits_analysis
-- Visit-level aggregation: counts, duration, success rate
-- ===============================================================
CREATE OR REPLACE FUNCTION public.get_customer_visits_analysis(
    p_token uuid,
    p_customer_id uuid,
    p_from date DEFAULT NULL,
    p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_visits jsonb;
    v_stats jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF p_from IS NULL THEN p_from := CURRENT_DATE - INTERVAL '12 months'; END IF;
    IF p_to IS NULL THEN p_to := CURRENT_DATE; END IF;

    -- Visit list
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', v.id,
        'code', COALESCE(v.code, 'غير متوفر'),
        'status', COALESCE(v.status, 'غير متوفر'),
        'visit_result', COALESCE(v.visit_result, 'غير متوفر'),
        'check_in_at', v.check_in_at,
        'check_out_at', v.check_out_at,
        'duration_minutes', CASE WHEN v.check_out_at IS NOT NULL THEN GREATEST(ROUND(EXTRACT(EPOCH FROM (v.check_out_at - v.check_in_at)) / 60)::int, 0) ELSE NULL END,
        'employee_name', COALESCE(e.full_name, 'غير متوفر')
    ) ORDER BY v.check_in_at DESC NULLS LAST), '[]'::jsonb) INTO v_visits
    FROM visits v
    LEFT JOIN employees e ON e.id = v.employee_id
    WHERE v.customer_id = p_customer_id
      AND v.check_in_at::date >= p_from
      AND v.check_in_at::date <= p_to;

    -- Visit stats
    WITH vis_agg AS (
        SELECT
            COUNT(*)::int AS total_visits,
            COUNT(*) FILTER (WHERE v.status = 'completed')::int AS successful_visits,
            COUNT(*) FILTER (WHERE v.status != 'completed')::int AS failed_visits,
            CASE
                WHEN COUNT(*) FILTER (WHERE v.check_out_at IS NOT NULL) > 0
                THEN ROUND(AVG(EXTRACT(EPOCH FROM (v.check_out_at - v.check_in_at)) / 60)::numeric, 1)
                ELSE 0
            END AS avg_duration_minutes,
            MAX(v.check_in_at) AS last_visit_date,
            MIN(v.check_in_at) AS first_visit_date,
            CASE WHEN COUNT(*) > 0
                THEN ROUND((COUNT(*) FILTER (WHERE v.status = 'completed'))::numeric / COUNT(*)::numeric * 100, 1)
                ELSE 0
            END AS success_rate
        FROM visits v
        WHERE v.customer_id = p_customer_id
          AND v.check_in_at::date >= p_from
          AND v.check_in_at::date <= p_to
    )
    SELECT jsonb_build_object(
        'total_visits', COALESCE(vis_agg.total_visits, 0),
        'successful_visits', COALESCE(vis_agg.successful_visits, 0),
        'failed_visits', COALESCE(vis_agg.failed_visits, 0),
        'avg_duration_minutes', COALESCE(vis_agg.avg_duration_minutes, 0),
        'last_visit_date', vis_agg.last_visit_date,
        'first_visit_date', vis_agg.first_visit_date,
        'success_rate', COALESCE(vis_agg.success_rate, 0)
    ) INTO v_stats
    FROM vis_agg;

    RETURN jsonb_build_object(
        'visits', COALESCE(v_visits, '[]'::jsonb),
        'stats', COALESCE(v_stats, jsonb_build_object(
            'total_visits', 0, 'successful_visits', 0, 'failed_visits', 0,
            'avg_duration_minutes', 0, 'success_rate', 0
        ))
    );
END;
$function$;


-- ===============================================================
-- RPC 5: get_customer_behavior_insights
-- Purchase frequency, peak day, trend, retention
-- ===============================================================
CREATE OR REPLACE FUNCTION public.get_customer_behavior_insights(
    p_token uuid,
    p_customer_id uuid,
    p_from date DEFAULT NULL,
    p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_total_orders int;
    v_total_value numeric;
    v_first_order_date timestamptz;
    v_last_order_date timestamptz;
    v_insights jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF p_from IS NULL THEN p_from := CURRENT_DATE - INTERVAL '12 months'; END IF;
    IF p_to IS NULL THEN p_to := CURRENT_DATE; END IF;

    -- Base metrics
    SELECT
        COUNT(*)::int,
        COALESCE(SUM(total_amount), 0),
        MIN(created_at),
        MAX(created_at)
    INTO v_total_orders, v_total_value, v_first_order_date, v_last_order_date
    FROM orders
    WHERE customer_id = p_customer_id
      AND status NOT IN ('draft', 'cancelled')
      AND created_at::date >= p_from
      AND created_at::date <= p_to;

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
    day_of_week AS (
        SELECT
            EXTRACT(DOW FROM created_at)::int AS dow,
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
        'total_orders', COALESCE(v_total_orders, 0),
        'total_value', COALESCE(v_total_value, 0),
        'repeat_customer', COALESCE(v_total_orders, 0) > 1,
        'purchase_frequency', CASE
            WHEN COALESCE(v_total_orders, 0) > 1 AND v_first_order_date IS NOT NULL AND v_last_order_date IS NOT NULL
            THEN GREATEST(0, ROUND(
                (EXTRACT(EPOCH FROM (v_last_order_date - v_first_order_date)) / 86400) /
                NULLIF((v_total_orders - 1)::numeric, 0)
            , 1))
            ELSE 0
        END,
        'avg_days_between_orders', (SELECT ROUND(AVG(gap_days)::numeric, 1) FROM gaps WHERE gap_days IS NOT NULL),
        'most_active_day', (SELECT CASE
            WHEN dow = 0 THEN 'الأحد' WHEN dow = 1 THEN 'الإثنين'
            WHEN dow = 2 THEN 'الثلاثاء' WHEN dow = 3 THEN 'الأربعاء'
            WHEN dow = 4 THEN 'الخميس' WHEN dow = 5 THEN 'الجمعة'
            WHEN dow = 6 THEN 'السبت' ELSE 'غير متوفر'
        END FROM day_of_week ORDER BY cnt DESC LIMIT 1),
        'most_active_day_orders', (SELECT COALESCE(cnt, 0) FROM day_of_week ORDER BY cnt DESC LIMIT 1),
        'growth_trend', CASE
            WHEN COALESCE(v_total_orders, 0) >= 3 THEN (
                SELECT CASE
                    WHEN first_half < second_half THEN 'زيادة'
                    WHEN first_half > second_half THEN 'انخفاض'
                    ELSE 'ثبات'
                END FROM half_split
            ) ELSE 'غير كافٍ'
        END,
        'retention_score', CASE
            WHEN COALESCE(v_total_orders, 0) = 0 THEN 0
            WHEN v_total_orders = 1 THEN 1
            WHEN v_total_orders <= 3 THEN 2
            WHEN v_total_orders <= 6 THEN 3
            WHEN v_total_orders <= 12 THEN 4
            ELSE 5
        END,
        'months_active', CASE
            WHEN v_first_order_date IS NOT NULL THEN
                GREATEST(1, (SELECT ROUND(EXTRACT(DAY FROM (COALESCE(v_last_order_date, v_first_order_date) - v_first_order_date)) / 30.44)::int))
            ELSE 0
        END,
        'last_order_date', v_last_order_date,
        'first_order_date', v_first_order_date
    ) INTO v_insights;

    RETURN jsonb_build_object(
        'insights', COALESCE(v_insights, jsonb_build_object(
            'total_orders', 0, 'total_value', 0, 'repeat_customer', false,
            'purchase_frequency', 0, 'growth_trend', 'غير كافٍ', 'retention_score', 0
        ))
    );
END;
$function$;
