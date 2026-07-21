-- =============================================================================
-- Migration 20270721: owner_name canonical fix + ownership fields
-- =============================================================================
-- Canonical rule: owner_name = employees.full_name via orders.owner_id ONLY.
-- No snapshot fallback. No cached value. Live JOIN always.
-- Also adds owner_id / created_by_id for OrderOwnershipInfo transfer detection.
-- =============================================================================

-- 1. get_unified_orders: add owner_id (JOIN e already exists)
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
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_is_super boolean;
  v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

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
        'owner_id', o.owner_id,
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
$function$;

-- 2. get_governed_orders: add created_by_id + identity JOINs + live owner_name (all 3 branches)
CREATE OR REPLACE FUNCTION public.get_governed_orders(
  p_token uuid, p_search text DEFAULT NULL, p_status varchar DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL, p_employee_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL, p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_session app.sessions; v_result jsonb;
  v_subtree_ids uuid[]; v_identity_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  -- Customer: own orders only
  IF v_session.identity_type = 'customer' THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_number', o.order_number,
      'customer_id', o.customer_id, 'customer_code', COALESCE(o.snapshot_customer_code, ''),
      'customer_name', COALESCE(o.snapshot_customer_name, ''),
      'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
      'customer_address', COALESCE(o.snapshot_customer_address, ''),
      'customer_maps_url', '', 'owner_type', o.owner_type, 'owner_id', o.owner_id,
      'owner_name', e.full_name,
      'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
      'owner_address', COALESCE(o.snapshot_owner_address, ''),
      'status', o.status, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
      'total_amount', o.total_amount, 'notes', o.notes, 'revision_number', o.revision_number,
      'created_by', o.created_by, 'created_by_name', COALESCE(o.snapshot_sender_name, ''),
      'created_by_id', CASE
        WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
        WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
        ELSE NULL
      END,
      'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
      'created_by_address', COALESCE(o.snapshot_sender_address, ''),
      'created_at', o.created_at, 'updated_at', o.updated_at,
      'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
      'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
    ) ORDER BY o.created_at DESC) INTO v_result
    FROM orders o
    LEFT JOIN public.employees e ON e.id = o.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    WHERE o.created_by = v_session.identity_id
      AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_employee_id IS NULL OR o.created_by = p_employee_id)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;
  -- Upper management: all orders
  IF public.is_upper_management(v_session.employee_id) THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_number', o.order_number,
      'customer_id', o.customer_id, 'customer_code', COALESCE(o.snapshot_customer_code, ''),
      'customer_name', COALESCE(o.snapshot_customer_name, ''),
      'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
      'customer_address', COALESCE(o.snapshot_customer_address, ''),
      'customer_maps_url', '', 'owner_type', o.owner_type, 'owner_id', o.owner_id,
      'owner_name', e.full_name,
      'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
      'owner_address', COALESCE(o.snapshot_owner_address, ''),
      'status', o.status, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
      'total_amount', o.total_amount, 'notes', o.notes, 'revision_number', o.revision_number,
      'created_by', o.created_by, 'created_by_name', COALESCE(o.snapshot_sender_name, ''),
      'created_by_id', CASE
        WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
        WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
        ELSE NULL
      END,
      'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
      'created_by_address', COALESCE(o.snapshot_sender_address, ''),
      'created_at', o.created_at, 'updated_at', o.updated_at,
      'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
      'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
    ) ORDER BY o.created_at DESC) INTO v_result
    FROM orders o
    LEFT JOIN public.employees e ON e.id = o.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    WHERE (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_employee_id IS NULL OR o.created_by = p_employee_id)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;
  -- Others: tree-scoped orders
  v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
  SELECT COALESCE(array_agg(identity_id), '{}'::uuid[]) INTO v_identity_ids
  FROM public.employees WHERE id = ANY(v_subtree_ids);
  SELECT jsonb_agg(jsonb_build_object(
    'id', o.id, 'order_number', o.order_number,
    'customer_id', o.customer_id, 'customer_code', COALESCE(o.snapshot_customer_code, ''),
    'customer_name', COALESCE(o.snapshot_customer_name, ''),
    'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
    'customer_address', COALESCE(o.snapshot_customer_address, ''),
    'customer_maps_url', '', 'owner_type', o.owner_type, 'owner_id', o.owner_id,
    'owner_name', e.full_name,
    'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
    'owner_address', COALESCE(o.snapshot_owner_address, ''),
    'status', o.status, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
    'total_amount', o.total_amount, 'notes', o.notes, 'revision_number', o.revision_number,
    'created_by', o.created_by, 'created_by_name', COALESCE(o.snapshot_sender_name, ''),
    'created_by_id', CASE
      WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
      WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
      ELSE NULL
    END,
    'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
    'created_by_address', COALESCE(o.snapshot_sender_address, ''),
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
    'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
  ) ORDER BY o.created_at DESC) INTO v_result
  FROM orders o
  LEFT JOIN public.employees e ON e.id = o.owner_id
  LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
  LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
  LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
  WHERE (o.created_by = ANY(v_identity_ids) OR o.customer_id IN (SELECT c2.id FROM customers c2 WHERE c2.owner_id = ANY(v_subtree_ids)))
    AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR o.status = p_status)
    AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
    AND (p_employee_id IS NULL OR o.created_by = p_employee_id)
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to);
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- 3. get_governed_executive_queue: add owner_id + created_by_id (JOINs already exist)
CREATE OR REPLACE FUNCTION public.get_governed_executive_queue(
  p_token uuid,
  p_status varchar DEFAULT NULL::varchar,
  p_search text DEFAULT NULL::text,
  p_governorate varchar DEFAULT NULL::varchar,
  p_delivery_mode varchar DEFAULT NULL::varchar,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_employee_name text DEFAULT NULL::text,
  p_date_filter varchar DEFAULT NULL::varchar
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_visible uuid[];
  v_is_super boolean;
  v_can_see_all boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_can_see_all := v_is_super OR public.check_capability(p_token, 'orders.manage');
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'total_amount', o.total_amount,
        'revision_number', o.revision_number,
        'customer_id', o.customer_id,
        'customer_name', COALESCE(o.snapshot_customer_name, c.company_name),
        'customer_code', o.snapshot_customer_code,
        'customer_phone', COALESCE(o.snapshot_customer_phone, ci.phone),
        'governorate', ca.governorate,
        'owner_name', e.full_name,
        'owner_id', o.owner_id,
        'created_by_name', COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, ''),
        'created_by_id', CASE
          WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
          WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
          ELSE NULL
        END,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'current_delivery_status', (
          SELECT dt.status FROM public.delivery_tracking dt
          WHERE dt.order_id = o.id AND dt.is_active = true LIMIT 1
        ),
        'has_collections', EXISTS(
          SELECT 1 FROM public.collections col
          WHERE (col.order_id = o.id OR col.customer_id = o.customer_id)
        ),
        'collected_amount', (
          SELECT COALESCE(SUM(col.amount), 0) FROM public.collections col
          WHERE (col.order_id = o.id OR col.customer_id = o.customer_id)
            AND col.status IN ('approved', 'treasury_posted')
        ),
        'item_count', (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id),
        'customer_owner_name', COALESCE(co_emp.full_name, ''),
        'customer_owner_role', COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = c.owner_id LIMIT 1), '')
      )
      ORDER BY o.updated_at DESC
    ), '[]'::jsonb)
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.identities ci ON ci.id = c.identity_id
    LEFT JOIN public.customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = true
    LEFT JOIN public.employees co_emp ON co_emp.id = c.owner_id
    LEFT JOIN public.employees e ON e.id = o.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    WHERE (v_can_see_all OR c.owner_id = ANY(v_visible))
      AND o.status IN ('submitted', 'reviewing', 'approved', 'preparing', 'prepared', 'ready_for_dispatch', 'dispatched', 'sent_to_delivery', 'delivered', 'deferred', 'returned_for_revision')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_delivery_mode IS NULL OR o.delivery_mode = p_delivery_mode)
      AND (p_governorate IS NULL OR ca.governorate = p_governorate)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'))
      AND (p_employee_name IS NULL OR
           e.full_name ILIKE '%' || p_employee_name || '%' OR
           oc_emp.full_name ILIKE '%' || p_employee_name || '%')
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%')
  );
END;
$function$;
