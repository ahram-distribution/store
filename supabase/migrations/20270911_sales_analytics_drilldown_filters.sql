-- ============================================================================
-- Migration 20270911: Sales Analytics drill-down — apply the same filters as
--   the KPI aggregate (get_sales_analytics) so drill-down sources reconcile
--   exactly with the numbers shown on the screen.
--
-- Problem: get_sales_analytics_drilldown resolved the source orders using only
--   the date range + visibility. It ignored:
--     * p_owner_id / p_owner_ids (employee / manager-team scope)  -> when a
--       scope or employee/manager filter was active, the drill-down showed
--       orders OUTSIDE the KPI's owner scope, so the sum/count did not
--       reconcile with the number on the screen.
--     * p_search  -> the customers aggregation in get_sales_analytics applies
--       p_search (order_number / company_name / snapshot_customer_name), but
--       the drill-down did not, so customer drill-downs under search did not
--       reconcile.
--
-- Fix: the drill-down now accepts the same p_owner_id / p_owner_ids / p_search
--   params as get_sales_analytics and applies them identically:
--     * Owner scope: applied to every entity branch.
--     * Search: applied to the 'all' and 'customer' branches only (matching
--       the customers aggregation, which is the only aggregate that applies
--       p_search; companies/products/totals do not, so their drill-downs must
--       not apply it either).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_sales_analytics_drilldown(
  p_token text,
  p_entity_type text,
  p_entity_name text,
  p_filter_delivered boolean DEFAULT false,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_owner_ids uuid[] DEFAULT NULL,
  p_search text DEFAULT NULL
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

  -- Resolve matching order IDs based on entity type.
  -- Owner scope + date range match get_sales_analytics exactly.
  IF p_entity_type = 'all' THEN
    SELECT COALESCE(array_agg(o.id), '{}'::uuid[]) INTO v_order_ids
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
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
  ELSIF p_entity_type = 'customer' THEN
    SELECT COALESCE(array_agg(o.id), '{}'::uuid[]) INTO v_order_ids
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE public.is_order_in_statistics(o.status)
      AND (v_is_super OR c.owner_id = ANY(v_visible))
      AND COALESCE(o.snapshot_customer_name, c.company_name) = p_entity_name
      AND (p_owner_id IS NULL OR o.owner_id = p_owner_id)
      AND (p_owner_ids IS NULL OR o.owner_id = ANY(p_owner_ids))
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
      AND (p_owner_id IS NULL OR o.owner_id = p_owner_id)
      AND (p_owner_ids IS NULL OR o.owner_id = ANY(p_owner_ids))
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
      AND (p_owner_id IS NULL OR o.owner_id = p_owner_id)
      AND (p_owner_ids IS NULL OR o.owner_id = ANY(p_owner_ids))
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

COMMENT ON FUNCTION public.get_sales_analytics_drilldown IS 'Sales Analytics drill-down: returns orders + items matching entity criteria. Applies the same owner scope (p_owner_id/p_owner_ids) and date range as get_sales_analytics, plus p_search for the all/customer branches, so drill-down totals reconcile exactly with the KPI shown on the screen.';
