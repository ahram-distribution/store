-- ============================================================================
-- Migration 20270914: Sales Analytics — resolve owner via resolve_employee_id()
--
-- Problem: Sales Analytics filtered orders by raw ownership:
--     o.owner_id = p_owner_id
--     o.owner_id = ANY(p_owner_ids)
-- while Employee Activity (get_employee_detail_data) resolves ownership through
--     public.resolve_employee_id(o.owner_id) = p_employee_id
-- which matches orders whose owner_id holds either the employee id OR the
-- employee's identity_id (legacy orders). As a result Sales Analytics silently
-- dropped legacy orders whose owner_id stored identity_id, causing the two
-- modules to disagree (e.g. EMP-2026-000015: 7 orders / 392,771.06 in Employee
-- Activity vs 2 orders / 140,420.03 in Sales Analytics).
--
-- Fix: apply the same owner resolution to get_sales_analytics and
-- get_sales_analytics_drilldown so both modules use identical ownership
-- semantics. Nothing else is changed: the status rule (is_order_in_statistics),
-- date filtering, search, delivered-target logic, and payload shape are
-- preserved exactly.
-- ============================================================================

-- ============================================================================
-- 1. GET_SALES_ANALYTICS — resolve owner in all four aggregations
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_sales_analytics(p_token text, p_search text DEFAULT NULL::text, p_owner_id uuid DEFAULT NULL::uuid, p_owner_ids uuid[] DEFAULT NULL::uuid[], p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
        AND (p_owner_id IS NULL OR public.resolve_employee_id(o.owner_id) = p_owner_id)
        AND (p_owner_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(p_owner_ids))
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
        AND (p_owner_id IS NULL OR public.resolve_employee_id(o.owner_id) = p_owner_id)
        AND (p_owner_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(p_owner_ids))
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
        AND (p_owner_id IS NULL OR public.resolve_employee_id(o.owner_id) = p_owner_id)
        AND (p_owner_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(p_owner_ids))
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
      AND (p_owner_id IS NULL OR public.resolve_employee_id(o.owner_id) = p_owner_id)
      AND (p_owner_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(p_owner_ids))
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
  ) t;

  RETURN COALESCE(v_result, jsonb_build_object(
    'customers', '[]'::jsonb, 'companies', '[]'::jsonb,
    'products', '[]'::jsonb,
    'totals', jsonb_build_object('total_activity', 0, 'total_target', 0)
  ));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_sales_analytics TO authenticated;

COMMENT ON FUNCTION public.get_sales_analytics IS 'Sales Analytics: pre-aggregated data for customers/companies/products tabs + totals. Owner scope resolved via resolve_employee_id() so employee-id and identity-id ownership are treated identically (matches get_employee_detail_data). Uses same is_order_in_statistics() and status=delivered rules.';

-- ============================================================================
-- 2. GET_SALES_ANALYTICS_DRILLDOWN — same owner resolution in every branch
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_sales_analytics_drilldown(p_token text, p_entity_type text, p_entity_name text, p_filter_delivered boolean DEFAULT false, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_owner_id uuid DEFAULT NULL::uuid, p_owner_ids uuid[] DEFAULT NULL::uuid[], p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  -- Resolve matching order IDs based on entity type.
  -- Owner scope + date range match get_sales_analytics exactly.
  -- Owner scope uses resolve_employee_id() so employee-id and identity-id
  -- ownership are treated identically (matches get_sales_analytics).
  IF p_entity_type = 'all' THEN
    SELECT COALESCE(array_agg(o.id), '{}'::uuid[]) INTO v_order_ids
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE public.is_order_in_statistics(o.status)
      AND (v_is_super OR c.owner_id = ANY(v_visible))
      AND (p_owner_id IS NULL OR public.resolve_employee_id(o.owner_id) = p_owner_id)
      AND (p_owner_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(p_owner_ids))
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%')
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
  ELSIF p_entity_type = 'customer' THEN
    SELECT COALESCE(array_agg(o.id), '{}'::uuid[]) INTO v_order_ids
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE public.is_order_in_statistics(o.status)
      AND (v_is_super OR c.owner_id = ANY(v_visible))
      AND COALESCE(o.snapshot_customer_name, c.company_name) = p_entity_name
      AND (p_owner_id IS NULL OR public.resolve_employee_id(o.owner_id) = p_owner_id)
      AND (p_owner_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(p_owner_ids))
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%')
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
      AND (p_owner_id IS NULL OR public.resolve_employee_id(o.owner_id) = p_owner_id)
      AND (p_owner_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(p_owner_ids))
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
      AND (p_owner_id IS NULL OR public.resolve_employee_id(o.owner_id) = p_owner_id)
      AND (p_owner_ids IS NULL OR public.resolve_employee_id(o.owner_id) = ANY(p_owner_ids))
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
$function$;

GRANT EXECUTE ON FUNCTION public.get_sales_analytics_drilldown TO authenticated;

COMMENT ON FUNCTION public.get_sales_analytics_drilldown IS 'Sales Analytics drill-down: returns orders + items matching entity criteria. Applies the same owner scope (p_owner_id/p_owner_ids via resolve_employee_id()), date range and p_search rules as get_sales_analytics, so drill-down totals reconcile exactly with the KPI shown on the screen.';
