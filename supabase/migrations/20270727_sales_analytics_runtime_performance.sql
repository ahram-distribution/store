-- ============================================================================
-- Migration: Sales Analytics Runtime Performance
--
-- Problem: get_statistical_orders returns 1MB+ payload (all orders with full
--   items array) for just 1 month of data. The Sales Analytics page fetches
--   this entire payload on every load, transfers it over network, parses 1MB
--   JSON, then re-aggregates client-side for all three tabs.
--
-- Root cause: Single monolithic RPC that joins 8+ tables and includes
--   correlated subqueries per row (items, item_count, delivery_tracking).
--   90% of returned fields are unused by the page.
--
-- Solution:
--   1. get_sales_analytics — returns pre-aggregated data for customers,
--      companies, and products in a single efficient call. Payload: ~2KB.
--   2. get_sales_analytics_orders — lightweight drill-down RPC that returns
--      order details only for specified order IDs. Called on-demand.
-- ============================================================================

-- ============================================================================
-- 1. GET_SALES_ANALYTICS — pre-aggregated data for all 3 tabs + totals
--    Replaces get_statistical_orders for SalesAnalyticsPage.
--    Business logic identical — uses same is_order_in_statistics() and
--    isDelivered (status = 'delivered') rules.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_sales_analytics(
  p_token text,
  p_search text DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_owner_ids uuid[] DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token uuid;
  v_session app.sessions;
  v_visible uuid[];
  v_is_super boolean;
  v_result jsonb;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_TOKEN');
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type = 'customer' THEN
    RETURN jsonb_build_object(
      'customers', '[]'::jsonb, 'companies', '[]'::jsonb,
      'products', '[]'::jsonb,
      'totals', jsonb_build_object('total_activity', 0, 'total_target', 0)
    );
  END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_visible := COALESCE(public.get_visible_employee_ids(v_token), '{}'::uuid[]);

  SELECT jsonb_build_object(
    'customers', COALESCE(cust.json, '[]'::jsonb),
    'companies', COALESCE(comp.json, '[]'::jsonb),
    'products', COALESCE(prod.json, '[]'::jsonb),
    'totals', jsonb_build_object(
      'total_activity', COALESCE(t.total_activity, 0),
      'total_target', COALESCE(t.total_target, 0)
    )
  ) INTO v_result
  FROM (
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', x.name,
        'activity', x.activity,
        'target', x.target,
        'order_count', x.order_count
      ) ORDER BY x.activity DESC
    ) AS json
    FROM (
      SELECT
        COALESCE(o.snapshot_customer_name, c.company_name) AS name,
        SUM(o.total_amount) AS activity,
        SUM(CASE WHEN o.status = 'delivered' THEN o.total_amount ELSE 0 END) AS target,
        COUNT(*)::int AS order_count
      FROM public.orders o
      JOIN public.customers c ON c.id = o.customer_id
      WHERE public.is_order_in_statistics(o.status)
        AND (v_is_super OR c.owner_id = ANY(v_visible))
        AND (p_owner_id IS NULL OR o.owner_id = p_owner_id)
        AND (p_owner_ids IS NULL OR o.owner_id = ANY(p_owner_ids))
        AND (p_search IS NULL OR
             o.order_number ILIKE '%' || p_search || '%' OR
             c.company_name ILIKE '%' || p_search || '%' OR
             o.snapshot_customer_name ILIKE '%' || p_search || '%')
        AND (p_date_from IS NULL OR o.created_at >= p_date_from)
        AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      GROUP BY COALESCE(o.snapshot_customer_name, c.company_name)
    ) x
  ) cust,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', x.name,
        'activity', x.activity,
        'target', x.target
      ) ORDER BY x.activity DESC
    ) AS json
    FROM (
      SELECT
        comp.company_name AS name,
        SUM(oi.total_price) AS activity,
        SUM(CASE WHEN o.status = 'delivered' THEN oi.total_price ELSE 0 END) AS target
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.products pr ON pr.id = oi.product_id
      JOIN public.companies comp ON comp.id = pr.company_id
      JOIN public.customers c ON c.id = o.customer_id
      WHERE public.is_order_in_statistics(o.status)
        AND (v_is_super OR c.owner_id = ANY(v_visible))
        AND (p_owner_id IS NULL OR o.owner_id = p_owner_id)
        AND (p_owner_ids IS NULL OR o.owner_id = ANY(p_owner_ids))
        AND (p_date_from IS NULL OR o.created_at >= p_date_from)
        AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      GROUP BY comp.company_name
    ) x
  ) comp,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', x.name,
        'activity', x.activity,
        'target', x.target
      ) ORDER BY x.activity DESC
    ) AS json
    FROM (
      SELECT
        pr.product_name AS name,
        SUM(oi.total_price) AS activity,
        SUM(CASE WHEN o.status = 'delivered' THEN oi.total_price ELSE 0 END) AS target
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.products pr ON pr.id = oi.product_id
      JOIN public.customers c ON c.id = o.customer_id
      WHERE public.is_order_in_statistics(o.status)
        AND (v_is_super OR c.owner_id = ANY(v_visible))
        AND (p_owner_id IS NULL OR o.owner_id = p_owner_id)
        AND (p_owner_ids IS NULL OR o.owner_id = ANY(p_owner_ids))
        AND (p_date_from IS NULL OR o.created_at >= p_date_from)
        AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      GROUP BY pr.product_name
    ) x
  ) prod,
  (
    SELECT
      COALESCE(SUM(o.total_amount) FILTER (WHERE public.is_order_in_statistics(o.status)), 0) AS total_activity,
      COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'delivered'), 0) AS total_target
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE (v_is_super OR c.owner_id = ANY(v_visible))
      AND (p_owner_id IS NULL OR o.owner_id = p_owner_id)
      AND (p_owner_ids IS NULL OR o.owner_id = ANY(p_owner_ids))
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
  ) t;

  RETURN COALESCE(v_result, jsonb_build_object(
    'customers', '[]'::jsonb, 'companies', '[]'::jsonb,
    'products', '[]'::jsonb,
    'totals', jsonb_build_object('total_activity', 0, 'total_target', 0)
  ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_analytics TO authenticated;

COMMENT ON FUNCTION public.get_sales_analytics IS 'Sales Analytics: pre-aggregated data for customers/companies/products tabs + totals. Lightweight replacement for get_statistical_orders in SalesAnalyticsPage. Uses same is_order_in_statistics() and status=delivered rules.';

-- ============================================================================
-- 2. GET_SALES_ANALYTICS_ORDERS — lightweight drill-down data for modal
--    Returns minimal order + items details for specified order IDs.
--    Called on-demand when user opens drill-down modal.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_sales_analytics_orders(
  p_token text,
  p_order_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token uuid;
  v_session app.sessions;
  v_visible uuid[];
  v_is_super boolean;
  v_result jsonb;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_TOKEN');
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type = 'customer' THEN RETURN '[]'::jsonb; END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_visible := COALESCE(public.get_visible_employee_ids(v_token), '{}'::uuid[]);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'customer_name', COALESCE(o.snapshot_customer_name, c.company_name),
      'total_amount', o.total_amount,
      'status', o.status,
      'created_at', o.created_at,
      'owner_id', o.owner_id
    ) ORDER BY o.created_at DESC
  ), '[]'::jsonb) INTO v_result
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.id = ANY(p_order_ids)
    AND (v_is_super OR c.owner_id = ANY(v_visible));

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_analytics_orders TO authenticated;

COMMENT ON FUNCTION public.get_sales_analytics_orders IS 'Sales Analytics drill-down: returns minimal order details for specified order IDs. Lightweight - no items array, no delivery tracking, no redundant joins.';

-- ============================================================================
-- 3. GET_SALES_ANALYTICS_ORDER_ITEMS — drill-down items for order IDs
--    Minimal fields: product_name, company_name, total_price.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_sales_analytics_order_items(
  p_token text,
  p_order_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token uuid;
  v_session app.sessions;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_TOKEN');
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'order_id', oi.order_id,
      'product_name', p.product_name,
      'company_name', comp.company_name,
      'total_price', oi.total_price
    ))
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.companies comp ON comp.id = p.company_id
    WHERE oi.order_id = ANY(p_order_ids)
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_analytics_order_items TO authenticated;

COMMENT ON FUNCTION public.get_sales_analytics_order_items IS 'Sales Analytics drill-down: returns minimal item details for specified order IDs. Lightweight - no image_url, legacy_code, unit breakdowns.';

-- ============================================================================
-- 4. GET_SALES_ANALYTICS_DRILLDOWN — on-demand drill-down data for modal
--    Returns orders + items matching the entity criteria.
--    Called lazily when user opens drill-down modal.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_sales_analytics_drilldown(
  p_token text,
  p_entity_type text,
  p_entity_name text,
  p_filter_delivered boolean DEFAULT false,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token uuid;
  v_session app.sessions;
  v_visible uuid[];
  v_is_super boolean;
  v_order_ids uuid[];
  v_orders jsonb;
  v_items jsonb;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_TOKEN');
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN jsonb_build_object('orders', '[]'::jsonb, 'items', '[]'::jsonb);
  END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_visible := COALESCE(public.get_visible_employee_ids(v_token), '{}'::uuid[]);

  -- Resolve matching order IDs based on entity type
  IF p_entity_type = 'all' THEN
    SELECT COALESCE(array_agg(o.id), '{}'::uuid[]) INTO v_order_ids
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE public.is_order_in_statistics(o.status)
      AND (v_is_super OR c.owner_id = ANY(v_visible))
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
  ELSIF p_entity_type = 'customer' THEN
    SELECT COALESCE(array_agg(o.id), '{}'::uuid[]) INTO v_order_ids
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE public.is_order_in_statistics(o.status)
      AND (v_is_super OR c.owner_id = ANY(v_visible))
      AND COALESCE(o.snapshot_customer_name, c.company_name) = p_entity_name
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
  ELSIF p_entity_type = 'company' THEN
    SELECT COALESCE(array_agg(DISTINCT oi.order_id), '{}'::uuid[]) INTO v_order_ids
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.products pr ON pr.id = oi.product_id
    JOIN public.companies comp ON comp.id = pr.company_id
    JOIN public.customers c ON c.id = o.customer_id
    WHERE public.is_order_in_statistics(o.status)
      AND (v_is_super OR c.owner_id = ANY(v_visible))
      AND comp.company_name = p_entity_name
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
  ELSIF p_entity_type = 'product' THEN
    SELECT COALESCE(array_agg(DISTINCT oi.order_id), '{}'::uuid[]) INTO v_order_ids
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.products pr ON pr.id = oi.product_id
    JOIN public.customers c ON c.id = o.customer_id
    WHERE public.is_order_in_statistics(o.status)
      AND (v_is_super OR c.owner_id = ANY(v_visible))
      AND pr.product_name = p_entity_name
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
  END IF;

  -- Filter by delivered status if requested
  IF p_filter_delivered AND cardinality(v_order_ids) > 0 THEN
    SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_order_ids
    FROM public.orders
    WHERE id = ANY(v_order_ids) AND status = 'delivered';
  END IF;

  -- Fetch orders
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'customer_name', COALESCE(o.snapshot_customer_name, c.company_name),
      'total_amount', o.total_amount,
      'status', o.status,
      'created_at', o.created_at,
      'owner_id', o.owner_id
    ) ORDER BY o.created_at DESC
  ), '[]'::jsonb) INTO v_orders
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.id = ANY(v_order_ids);

  -- Fetch items
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'order_id', oi.order_id,
    'product_name', p.product_name,
    'company_name', comp.company_name,
    'total_price', oi.total_price
  )), '[]'::jsonb) INTO v_items
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.companies comp ON comp.id = p.company_id
  WHERE oi.order_id = ANY(v_order_ids);

  RETURN jsonb_build_object('orders', v_orders, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_analytics_drilldown TO authenticated;

COMMENT ON FUNCTION public.get_sales_analytics_drilldown IS 'Sales Analytics drill-down: returns orders + items matching entity criteria. Called on-demand when user opens drill-down.';

-- ============================================================================
-- 5. COMPOSITE INDEX: created_at + status for date-range queries
--    The default company-wide view filters by (created_at range, status).
--    A composite index lets Postgres filter both conditions in one index scan.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_created_at_status
  ON public.orders (created_at DESC, status);

COMMENT ON INDEX public.idx_orders_created_at_status IS 'Optimizes sales analytics date-range queries: filters by created_at range + status in a single index scan.';
