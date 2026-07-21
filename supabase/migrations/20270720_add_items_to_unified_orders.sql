-- ============================================================================
-- Migration: Add items array to get_unified_orders (plural)
--
-- The singular get_unified_order returns a complete payload including an
-- items array with product_name, company_name, etc.
--
-- The plural get_unified_orders currently only returns item_count.
-- Sales Analytics needs the same governed item-level data across filtered
-- orders for aggregation by company and product.
--
-- Change: Add the identical items subquery from get_unified_order (singular)
-- to both branches of get_unified_orders (plural).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_unified_orders(
  p_token uuid,
  p_search text DEFAULT NULL,
  p_status varchar DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
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
  v_visible uuid[];
  v_is_super boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;

  IF v_session.identity_type = 'customer' THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'order_type', o.order_type,
        'total_amount', o.total_amount,
        'revision_number', o.revision_number,
        'customer_id', o.customer_id,
        'customer_name', COALESCE(o.snapshot_customer_name, c.company_name),
        'customer_code', o.snapshot_customer_code,
        'customer_phone', COALESCE(o.snapshot_customer_phone, ci.phone),
        'created_by', o.created_by,
        'created_by_name', COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, ''),
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'notes', o.notes,
        'item_count', (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id),
        'items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', oi.id,
            'product_id', oi.product_id,
            'product_name', p.product_name,
            'legacy_code', p.legacy_code,
            'image_url', p.image_url,
            'company_id', p.company_id,
            'company_name', comp.company_name,
            'unit_type', oi.unit_type,
            'unit_quantity', oi.unit_quantity,
            'piece_quantity', oi.piece_quantity,
            'unit_price', oi.unit_price,
            'total_price', oi.total_price
          ) ORDER BY oi.id)
          FROM public.order_items oi
          LEFT JOIN public.products p ON p.id = oi.product_id
          LEFT JOIN public.companies comp ON comp.id = p.company_id
          WHERE oi.order_id = o.id
        ), '[]'::jsonb),
        'current_delivery_status', (
          SELECT dt.status FROM public.delivery_tracking dt
          WHERE dt.order_id = o.id AND dt.is_active = true LIMIT 1
        ),
        'customer_owner_name', COALESCE(co_emp.full_name, ''),
        'customer_owner_role', COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = c.owner_id LIMIT 1), ''),
        'customer_owner_id', c.owner_id,
        'owner_name', e.full_name,
        'created_by_id', CASE
          WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
          WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
          ELSE NULL
        END,
        'created_by_type', oc_i.identity_type,
        'customer_display_address',
          COALESCE(
            NULLIF(concat_ws(' - ', ca.address_line1, ca.city, ca.governorate), ''),
            o.snapshot_customer_address
          ),
        'previous_order_count', ps.order_count,
        'previous_orders_total', ps.orders_total,
        'previous_order_number', ps.last_order_number,
        'previous_order_date', ps.last_order_date,
        'previous_order_total', ps.last_order_total
      ) ORDER BY o.created_at DESC), '[]'::jsonb)
      FROM public.orders o
      JOIN public.customers c ON c.id = o.customer_id
      LEFT JOIN public.identities ci ON ci.id = c.identity_id
      LEFT JOIN public.employees co_emp ON co_emp.id = c.owner_id
      LEFT JOIN public.employees e ON e.id = o.owner_id
      LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
      LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
      LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
      LEFT JOIN public.customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = true
      LEFT JOIN LATERAL (
        SELECT
          count(*)::bigint AS order_count,
          COALESCE(sum(total_amount), 0) AS orders_total,
          (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
          max(created_at) AS last_order_date,
          (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total
        FROM public.orders o2
        WHERE o2.customer_id = o.customer_id AND o2.id <> o.id
      ) ps ON true
      WHERE o.customer_id = v_session.customer_id
        AND (p_status IS NULL OR o.status = p_status)
        AND (p_date_from IS NULL OR o.created_at >= p_date_from)
        AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    );
  END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'order_type', o.order_type,
        'total_amount', o.total_amount,
        'revision_number', o.revision_number,
        'customer_id', o.customer_id,
        'customer_name', COALESCE(o.snapshot_customer_name, c.company_name),
        'customer_code', o.snapshot_customer_code,
        'customer_phone', COALESCE(o.snapshot_customer_phone, ci.phone),
        'owner_name', e.full_name,
        'created_by', o.created_by,
        'created_by_name', COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, ''),
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'notes', o.notes,
        'item_count', (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id),
        'items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', oi.id,
            'product_id', oi.product_id,
            'product_name', p.product_name,
            'legacy_code', p.legacy_code,
            'image_url', p.image_url,
            'company_id', p.company_id,
            'company_name', comp.company_name,
            'unit_type', oi.unit_type,
            'unit_quantity', oi.unit_quantity,
            'piece_quantity', oi.piece_quantity,
            'unit_price', oi.unit_price,
            'total_price', oi.total_price
          ) ORDER BY oi.id)
          FROM public.order_items oi
          LEFT JOIN public.products p ON p.id = oi.product_id
          LEFT JOIN public.companies comp ON comp.id = p.company_id
          WHERE oi.order_id = o.id
        ), '[]'::jsonb),
        'current_delivery_status', (
          SELECT dt.status FROM public.delivery_tracking dt
          WHERE dt.order_id = o.id AND dt.is_active = true LIMIT 1
        ),
        'has_collections', EXISTS(
          SELECT 1 FROM public.collections col
          WHERE col.customer_id = o.customer_id
        ),
        'customer_owner_name', COALESCE(co_emp.full_name, ''),
        'customer_owner_role', COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = c.owner_id LIMIT 1), ''),
        'customer_owner_id', c.owner_id,
        'created_by_id', CASE
          WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
          WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
          ELSE NULL
        END,
        'created_by_type', oc_i.identity_type,
        'customer_display_address',
          COALESCE(
            NULLIF(concat_ws(' - ', ca.address_line1, ca.city, ca.governorate), ''),
            o.snapshot_customer_address
          ),
        'previous_order_count', ps.order_count,
        'previous_orders_total', ps.orders_total,
        'previous_order_number', ps.last_order_number,
        'previous_order_date', ps.last_order_date,
        'previous_order_total', ps.last_order_total
      )
      ORDER BY o.created_at DESC
    ), '[]'::jsonb)
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.identities ci ON ci.id = c.identity_id
    LEFT JOIN public.employees co_emp ON co_emp.id = c.owner_id
    LEFT JOIN public.employees e ON e.id = o.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    LEFT JOIN public.customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = true
    LEFT JOIN LATERAL (
      SELECT
        count(*)::bigint AS order_count,
        COALESCE(sum(total_amount), 0) AS orders_total,
        (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
        max(created_at) AS last_order_date,
        (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total
      FROM public.orders o2
      WHERE o2.customer_id = o.customer_id AND o2.id <> o.id
    ) ps ON true
    WHERE (v_is_super OR c.owner_id = ANY(v_visible))
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
  );
END;
$$;
