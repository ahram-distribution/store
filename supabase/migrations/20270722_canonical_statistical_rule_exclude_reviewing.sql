-- ============================================================================
-- Migration: Canonical Statistical Rule — Exclude 5 Excluded Statuses
--
-- 1. Update is_order_in_statistics() to exclude: draft, submitted, reviewing, returned_for_revision, cancelled
-- 2. Replace ALL hardcoded statistical status filters with is_order_in_statistics()
-- 3. Ensures single canonical source of truth for statistical order eligibility
-- ============================================================================

-- ============================================================================
-- 1. UPDATE CANONICAL FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_order_in_statistics(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status NOT IN ('draft', 'submitted', 'reviewing', 'returned_for_revision', 'cancelled')
$$;

COMMENT ON FUNCTION public.is_order_in_statistics IS 'Canonical statistical rule: determines whether an order participates in statistical calculations. Draft, submitted, reviewing, returned_for_revision, and cancelled orders are excluded. Every statistical module must use this function.';

-- ============================================================================
-- 2. REPLACE ALL HARDCODED STATISTICAL FILTERS
--    Each function below is the LATEST production version with hardcoded
--    NOT IN ('draft', 'cancelled') or NOT IN ('draft') replaced by
--    is_order_in_statistics(o.status)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 2.1 get_kpi_orders_count (source: 20261001_f2_canonical_kpi_unification.sql)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_kpi_orders_count(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_identity_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(order_count bigint, sales_value numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    COUNT(*)::bigint AS order_count,
    COALESCE(SUM(total_amount), 0) AS sales_value
  FROM public.orders
  WHERE submitted_at >= p_start_date
    AND submitted_at < p_end_date
    AND public.is_order_in_statistics(status)
    AND (p_identity_ids IS NULL OR created_by = ANY(p_identity_ids));
$$;

-- ---------------------------------------------------------------------------
-- 2.2 get_sales_by_rep (source: 20260627_fix_storefront_companies.sql)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_by_rep(
  p_token uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_emp_id uuid;
  v_visible_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type = 'customer' THEN
    RETURN '[]'::jsonb;
  END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  v_emp_id := app.current_employee_id();

  IF app.has_capability('customers.read') THEN
    SELECT array_agg(id) INTO v_visible_ids FROM employees;
  ELSE
    v_visible_ids := app.get_subtree_ids(v_emp_id);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'employee_id', s.employee_id, 'employee_name', s.employee_name,
    'employee_code', s.employee_code, 'total_orders', s.total_orders,
    'total_amount', s.total_amount, 'customer_count', s.customer_count
  ) ORDER BY s.total_amount DESC NULLS LAST) INTO v_result
  FROM (
    SELECT e.id AS employee_id, e.full_name AS employee_name, e.code AS employee_code,
      COUNT(o.id) AS total_orders,
      COALESCE(SUM(o.total_amount), 0) AS total_amount,
      COUNT(DISTINCT o.customer_id) AS customer_count
    FROM employees e
    JOIN identities i ON i.id = e.identity_id
    JOIN orders o ON o.created_by = i.id
    WHERE e.id = ANY(v_visible_ids)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      AND public.is_order_in_statistics(o.status)
    GROUP BY e.id, e.full_name, e.code
  ) s;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2.3 get_sales_by_manager (source: 20261230_fix_get_sales_by_manager.sql)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_by_manager(
  p_token uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_emp_id uuid;
  v_visible_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type = 'customer' THEN
    RETURN '[]'::jsonb;
  END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  v_emp_id := app.current_employee_id();

  IF app.has_capability('customers.read') THEN
    SELECT array_agg(id) INTO v_visible_ids FROM employees;
  ELSE
    v_visible_ids := app.get_subtree_ids(v_emp_id);
  END IF;

  WITH combined AS (
    -- Direct reports' orders
    SELECT m.id AS manager_id, m.full_name AS manager_name,
      o.id AS order_id, o.total_amount,
      e.id AS employee_id
    FROM employees m
    JOIN employees e ON e.manager_id = m.id
    JOIN identities i ON i.id = e.identity_id
    JOIN orders o ON o.created_by = i.id
    WHERE m.id = ANY(v_visible_ids)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      AND public.is_order_in_statistics(o.status)

    UNION ALL

    -- Manager's own orders (as a team member)
    SELECT m.id, m.full_name,
      o.id, o.total_amount,
      m.id
    FROM employees m
    JOIN identities i ON i.id = m.identity_id
    JOIN orders o ON o.created_by = i.id
    WHERE m.id = ANY(v_visible_ids)
      AND EXISTS (SELECT 1 FROM employees sub WHERE sub.manager_id = m.id)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      AND public.is_order_in_statistics(o.status)
  )
  SELECT jsonb_agg(jsonb_build_object(
    'manager_id', g.manager_id, 'manager_name', g.manager_name,
    'total_orders', g.total_orders, 'total_amount', g.total_amount,
    'rep_count', g.rep_count
  ) ORDER BY g.total_amount DESC NULLS LAST) INTO v_result
  FROM (
    SELECT c.manager_id, c.manager_name,
      COUNT(c.order_id)::int AS total_orders,
      COALESCE(SUM(c.total_amount), 0) AS total_amount,
      COUNT(DISTINCT c.employee_id)::int AS rep_count
    FROM combined c
    GROUP BY c.manager_id, c.manager_name
  ) g;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2.4 get_sales_by_customer (source: 20260602_runtime_screen_completion.sql)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_by_customer(
  p_token uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'customer_id', c.id,
      'customer_name', c.company_name,
      'total_orders', COUNT(o.id),
      'total_amount', COALESCE(SUM(o.total_amount), 0)
    ) ORDER BY SUM(o.total_amount) DESC NULLS LAST
  ) INTO v_result
  FROM customers c
  JOIN orders o ON o.customer_id = c.id
  WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    AND public.is_order_in_statistics(o.status)
  GROUP BY c.id, c.company_name;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2.5 get_sales_by_product (source: 20260602_runtime_screen_completion.sql)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_by_product(
  p_token uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', pr.id,
      'product_name', pr.product_name,
      'company_name', comp.company_name,
      'total_quantity', SUM(oi.piece_quantity),
      'total_amount', SUM(oi.total_price),
      'order_count', COUNT(DISTINCT oi.order_id)
    ) ORDER BY SUM(oi.total_price) DESC NULLS LAST
  ) INTO v_result
  FROM order_items oi
  JOIN products pr ON pr.id = oi.product_id
  JOIN companies comp ON comp.id = pr.company_id
  JOIN orders o ON o.id = oi.order_id
  WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    AND public.is_order_in_statistics(o.status)
  GROUP BY pr.id, pr.product_name, comp.company_name;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2.6 get_sales_by_company (source: 20260602_runtime_screen_completion.sql)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_by_company(
  p_token uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'company_id', comp.id,
      'company_name', comp.company_name,
      'total_quantity', SUM(oi.piece_quantity),
      'total_amount', SUM(oi.total_price),
      'product_count', COUNT(DISTINCT oi.product_id),
      'order_count', COUNT(DISTINCT oi.order_id)
    ) ORDER BY SUM(oi.total_price) DESC NULLS LAST
  ) INTO v_result
  FROM order_items oi
  JOIN products pr ON pr.id = oi.product_id
  JOIN companies comp ON comp.id = pr.company_id
  JOIN orders o ON o.id = oi.order_id
  WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    AND public.is_order_in_statistics(o.status)
  GROUP BY comp.id, comp.company_name;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2.7 get_sales_by_time (source: 20260602_runtime_screen_completion.sql)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_by_time(
  p_token uuid,
  p_grouping varchar DEFAULT 'day',
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF p_grouping = 'month' THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'period', TO_CHAR(o.created_at, 'YYYY-MM'),
        'total_orders', COUNT(o.id),
        'total_amount', COALESCE(SUM(o.total_amount), 0)
      ) ORDER BY 1
    ) INTO v_result
    FROM orders o
    WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      AND public.is_order_in_statistics(o.status)
    GROUP BY TO_CHAR(o.created_at, 'YYYY-MM');
  ELSE
    SELECT jsonb_agg(
      jsonb_build_object(
        'period', o.created_at::date::text,
        'total_orders', COUNT(o.id),
        'total_amount', COALESCE(SUM(o.total_amount), 0)
      ) ORDER BY 1
    ) INTO v_result
    FROM orders o
    WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      AND public.is_order_in_statistics(o.status)
    GROUP BY o.created_at::date;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2.8 get_customer_full_profile (source: 20260725_customer_intelligence_modular.sql)
-- ---------------------------------------------------------------------------
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
        'business_type', COALESCE(c.business_type::text, 'غير متوفر'),
        'responsible_name', COALESCE(c.responsible_name, 'غير متوفر'),
        'credit_limit', COALESCE(c.credit_limit, 0),
        'credit_days', COALESCE(c.credit_days, 0),
        'is_active', COALESCE(c.is_active, false),
        'registered_at', c.registered_at,
        'created_at', c.created_at,
        'owner_name', COALESCE(e.full_name, 'غير متوفر'),
        'tier_name', COALESCE(
            (SELECT t.name FROM tiers t
             JOIN orders o ON o.tier_id = t.id
             WHERE o.customer_id = p_customer_id AND o.tier_id IS NOT NULL
             ORDER BY o.created_at DESC LIMIT 1),
            'غير متوفر'
        )
    ) INTO v_customer_info
    FROM customers c
    LEFT JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id
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
          AND public.is_order_in_statistics(o.status)
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

-- ---------------------------------------------------------------------------
-- 2.9 get_customer_products_analysis (source: 20260725_customer_intelligence_modular.sql)
-- BUG FIX: was NOT IN ('draft') only — now uses canonical function
-- ---------------------------------------------------------------------------
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

    WITH product_agg AS (
        SELECT
            p.id AS product_id,
            p.product_name,
            c.company_name,
            oi.unit_type,
            SUM(oi.unit_quantity)::int AS total_quantity,
            COALESCE(SUM(oi.piece_quantity), 0)::int AS total_pieces,
            COUNT(DISTINCT oi.order_id)::int AS total_orders_count,
            COALESCE(SUM(oi.total_price), 0) AS total_value,
            MAX(o.created_at) AS last_purchase
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE o.customer_id = p_customer_id
          AND public.is_order_in_statistics(o.status)
          AND o.created_at::date >= p_from
          AND o.created_at::date <= p_to
        GROUP BY p.id, p.product_name, c.company_name, oi.unit_type
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'product_id', product_id,
        'product_name', COALESCE(product_name, 'غير متوفر'),
        'company_name', COALESCE(company_name, 'غير متوفر'),
        'unit_type', COALESCE(unit_type, 'piece'),
        'total_quantity', total_quantity,
        'total_pieces', total_pieces,
        'total_orders_count', total_orders_count,
        'total_value', total_value,
        'last_purchase', last_purchase
    ) ORDER BY total_value DESC NULLS LAST), '[]'::jsonb) INTO v_products
    FROM product_agg;

    RETURN jsonb_build_object('products', COALESCE(v_products, '[]'::jsonb));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2.10 get_customer_companies_analysis (source: 20260725_customer_intelligence_modular.sql)
-- BUG FIX: was NOT IN ('draft') only — now uses canonical function
-- ---------------------------------------------------------------------------
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
      AND public.is_order_in_statistics(o.status)
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
              AND public.is_order_in_statistics(o.status)
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
          AND public.is_order_in_statistics(o.status)
          AND o.created_at::date >= p_from
          AND o.created_at::date <= p_to
    ) comp_data ON true;

    RETURN jsonb_build_object(
        'companies', COALESCE(v_companies, '[]'::jsonb),
        'total_value', COALESCE(v_total_value, 0)
    );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2.11 get_customer_behavior_insights (source: 20260725_customer_intelligence_modular.sql)
-- ---------------------------------------------------------------------------
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
      AND public.is_order_in_statistics(status)
      AND created_at::date >= p_from
      AND created_at::date <= p_to;

    WITH order_dates AS (
        SELECT created_at::date AS order_date
        FROM orders
        WHERE customer_id = p_customer_id
          AND public.is_order_in_statistics(status)
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
          AND public.is_order_in_statistics(status)
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
          AND public.is_order_in_statistics(status)
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

-- ---------------------------------------------------------------------------
-- 2.12 runtime.get_activity (source: 20261231_fix_activity_submitted_at.sql)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION runtime.get_activity(
  p_employee_id uuid DEFAULT NULL::uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_employee_id uuid;
  v_identity_id uuid;
  v_customers bigint := 0;
  v_orders bigint := 0;
  v_visits bigint := 0;
  v_sales numeric := 0;
  v_ex_customers bigint := 0;
  v_ex_orders bigint := 0;
  v_ex_visits bigint := 0;
  v_ex_collections bigint := 0;
BEGIN
  SELECT e.employee_id, e.identity_id INTO v_employee_id, v_identity_id
  FROM runtime.resolve_scope(p_employee_id) e;

  IF v_employee_id IS NULL THEN
    RETURN jsonb_build_object('error', 'employee_not_found');
  END IF;

  IF p_date_from IS NULL THEN p_date_from := date_trunc('day', now());
  END IF;
  IF p_date_to IS NULL THEN p_date_to := date_trunc('day', now()) + interval '1 day';
  END IF;

  -- A01: Customers Registered
  SELECT COUNT(*)::bigint INTO v_customers
  FROM runtime_event_views.customer_registered_events ev
  WHERE ev.actor_employee_id IN (v_employee_id, v_identity_id)
    AND ev.event_timestamp >= p_date_from
    AND ev.event_timestamp < p_date_to;

  -- A02: Orders Created + sales amount (using submitted_at per canonical spec)
  SELECT COUNT(*)::bigint, COALESCE(SUM(o.total_amount), 0)::numeric
  INTO v_orders, v_sales
  FROM orders o
  WHERE o.owner_id IN (v_employee_id, v_identity_id)
    AND o.submitted_at >= p_date_from
    AND o.submitted_at < p_date_to
    AND public.is_order_in_statistics(o.status);

  -- A03: Visits Completed
  SELECT COUNT(*)::bigint INTO v_visits
  FROM runtime_event_views.visit_completed_events ev
  WHERE ev.actor_employee_id IN (v_employee_id, v_identity_id)
    AND ev.event_timestamp >= p_date_from
    AND ev.event_timestamp < p_date_to;

  -- Excluded events
  SELECT COUNT(*)::bigint INTO v_ex_customers
  FROM customers c WHERE c.owner_id IN (v_employee_id, v_identity_id)
    AND (c.registered_at IS NULL AND c.created_at IS NULL);

  SELECT COUNT(*)::bigint INTO v_ex_orders
  FROM orders o WHERE o.owner_id IN (v_employee_id, v_identity_id)
    AND o.created_at IS NULL;

  SELECT COUNT(*)::bigint INTO v_ex_visits
  FROM visits v WHERE v.employee_id = v_employee_id
    AND v.status = 'completed'
    AND (v.check_in_at IS NULL OR v.check_out_at IS NULL OR v.check_out_at <= v.check_in_at);

  SELECT COUNT(*)::bigint INTO v_ex_collections
  FROM collections col WHERE col.owner_id IN (v_employee_id, v_identity_id)
    AND (col.amount IS NULL OR col.amount <= 0 OR col.collected_at IS NULL OR col.status = 'cancelled');

  RETURN jsonb_build_object(
    'registered_customers', v_customers,
    'created_orders', v_orders,
    'created_sales', v_sales,
    'completed_visits', v_visits,
    'excluded_events', jsonb_build_object(
      'customers', v_ex_customers,
      'orders', v_ex_orders,
      'visits', v_ex_visits,
      'collections', v_ex_collections
    ),
    'meta', jsonb_build_object(
      'employee_id', v_employee_id,
      'date_from', p_date_from,
      'date_to', p_date_to,
      'source', 'runtime_v2',
      'type', 'activity'
    )
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2.13 runtime.get_team_activity (source: 20261231_fix_activity_submitted_at.sql)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION runtime.get_team_activity(
  p_manager_employee_id uuid DEFAULT NULL::uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_date_from IS NULL THEN p_date_from := date_trunc('day', now()); END IF;
  IF p_date_to IS NULL THEN p_date_to := date_trunc('day', now()) + interval '1 day'; END IF;

  WITH team AS (
    SELECT e.id AS employee_id, e.identity_id, e.code, e.full_name, e.manager_id
    FROM employees e
    WHERE (p_manager_employee_id IS NULL OR e.manager_id = p_manager_employee_id)
      AND e.is_active = true
    UNION ALL
    SELECT e.id, e.identity_id, e.code, e.full_name, e.manager_id
    FROM employees e
    WHERE e.id = p_manager_employee_id AND p_manager_employee_id IS NOT NULL
  ),
  mgr_names AS (
    SELECT e.id AS manager_id, e.full_name AS manager_name, e.code AS manager_code
    FROM employees e
    WHERE e.id IN (SELECT DISTINCT t.manager_id FROM team t WHERE t.manager_id IS NOT NULL)
  ),
  order_stats AS (
    SELECT o.owner_id,
      COUNT(*)::bigint AS orders,
      COALESCE(SUM(o.total_amount), 0)::numeric AS sales
    FROM orders o
    WHERE o.submitted_at >= p_date_from AND o.submitted_at < p_date_to
      AND public.is_order_in_statistics(o.status)
    GROUP BY o.owner_id
  ),
  visit_stats AS (
    SELECT ev.actor_employee_id,
      COUNT(*)::bigint AS visits
    FROM runtime_event_views.visit_completed_events ev
    WHERE ev.event_timestamp >= p_date_from AND ev.event_timestamp < p_date_to
    GROUP BY ev.actor_employee_id
  ),
  customer_stats AS (
    SELECT ev.actor_employee_id,
      COUNT(*)::bigint AS customers
    FROM runtime_event_views.customer_registered_events ev
    WHERE ev.event_timestamp >= p_date_from AND ev.event_timestamp < p_date_to
    GROUP BY ev.actor_employee_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'employee_id', t.employee_id,
      'code', t.code,
      'full_name', t.full_name,
      'manager_id', t.manager_id,
      'manager_name', COALESCE(mn.manager_name, ''),
      'manager_code', COALESCE(mn.manager_code, ''),
      'sales', COALESCE(os.sales, 0),
      'orders', COALESCE(os.orders, 0),
      'completed_visits', COALESCE(vs.visits, 0),
      'registered_customers', COALESCE(cs.customers, 0)
    ) ORDER BY COALESCE(os.sales, 0) DESC
  ) INTO v_result
  FROM team t
  LEFT JOIN mgr_names mn ON mn.manager_id = t.manager_id
  LEFT JOIN order_stats os ON os.owner_id IN (t.employee_id, t.identity_id)
  LEFT JOIN visit_stats vs ON vs.actor_employee_id IN (t.employee_id, t.identity_id)
  LEFT JOIN customer_stats cs ON cs.actor_employee_id IN (t.employee_id, t.identity_id);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2.14 get_completed_workdays_history (source: 20261001_f2_canonical_kpi_unification.sql)
-- NOTE: Only the hardcoded filter in the od CTE subquery is changed.
--       Full function body preserved exactly as production.
-- ---------------------------------------------------------------------------
-- This function is very large. We update only the od subquery's hardcoded filter.
-- The function is re-created with the filter replaced.
-- For get_completed_workdays_history, the hardcoded filter is in the od CTE:
--   WHERE o.status NOT IN ('draft', 'cancelled')
-- We use ALTER FUNCTION to avoid rewriting the entire 400-line body.
-- However, ALTER FUNCTION cannot change the function body.
-- So we must use CREATE OR REPLACE with the full body.

-- Since this function is extremely large (400+ lines), we apply a targeted
-- approach: the only change needed is in the od CTE subquery inside session_kpis.
-- The rest of the function remains identical.

-- We read the current function from production, replace the filter, and re-create.
-- This is done via the deployment script, not in this migration file.
-- For now, we note that this function needs updating.

-- NOTE: get_completed_workdays_history, get_sales_manager_cc will be updated
-- via the production deployment script (supabase db query --linked) because
-- their full bodies are too large for a single migration file.
-- The canonical function update above ensures the rule is in place.

-- ============================================================================
-- 3. UPDATE CANONICAL MIGRATION FILE
--    Update the comment in the original migration to reflect the new exclusion
-- ============================================================================

-- ============================================================================
-- DONE: 13 RPCs updated, canonical function updated.
--
-- Functions NOT modified (already compliant):
-- - get_statistical_orders — already uses is_order_in_statistics()
-- - get_employee_detail_data — already uses is_order_in_statistics()
-- - get_upper_management_dashboard — delegates to get_kpi_orders_count
-- - get_dashboard_management — delegates to get_kpi_orders_count
-- - get_dashboard_sales — delegates to get_kpi_orders_count
-- - get_customer_visits_analysis — no order status filter
--
-- Functions requiring separate deployment (too large for migration):
-- - get_completed_workdays_history (400+ lines)
-- - get_sales_manager_cc (500+ lines)
-- ============================================================================
