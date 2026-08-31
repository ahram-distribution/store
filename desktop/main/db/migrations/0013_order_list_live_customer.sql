-- Desktop migration 13: Order list displays LIVE customer name/phone.
-- Applied out-of-band to production (mirrors remote pattern) at deploy time.

-- Root cause of stale Order Card data:
--   get_unified_orders returned snapshot-first fields:
--     customer_name  = COALESCE(o.snapshot_customer_name, c.company_name)
--     customer_phone = COALESCE(o.snapshot_customer_phone, ci.phone)
--   So the card showed the historical snapshot even after the customer's
--   current record changed.
--
-- Fix: prefer the LIVE customer join (c.company_name / ci.phone), falling
--   back to the snapshot only when the live value is missing -- exactly the
--   same semantics the Order Details view already uses (customer-first).
--   No schema change. No historical order facts are modified: the snapshot_*
--   columns on public.orders remain untouched; only which value the RPC
--   surfaces as customer_name/customer_phone changes.
--
--   With this in place, a bounded background re-fetch of get_unified_orders
--   on the Order List page picks up the current customer info automatically.
CREATE OR REPLACE FUNCTION public.get_unified_orders(p_token uuid, p_search text DEFAULT NULL::text, p_status character varying DEFAULT NULL::character varying, p_customer_id uuid DEFAULT NULL::uuid, p_created_by uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_governorate_id uuid DEFAULT NULL::uuid, p_include_strict_previous boolean DEFAULT false, p_date_source text DEFAULT 'created'::text)
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
        'reference_number', o.reference_number,
        'customer_id', o.customer_id,
        'customer_name', COALESCE(c.company_name, o.snapshot_customer_name),
        'customer_code', o.snapshot_customer_code,
        'customer_phone', COALESCE(ci.phone, o.snapshot_customer_phone),
        'owner_name', e.full_name,
        'owner_id', o.owner_id,
        'created_by', o.created_by,
        'created_by_name', COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, ''),
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'submitted_at', o.submitted_at,
        'item_count', (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id),
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
        'customer_display_address',
          COALESCE(
            NULLIF(concat_ws(' - ',
              NULLIF(TRIM(ca.governorate), ''),
              NULLIF(TRIM(ca.city), ''),
              NULLIF(TRIM(COALESCE(ca.street_address, ca.address_line1, '')), '')
            ), ''),
            o.snapshot_customer_address
          ),
        'customer_governorate_id', ca.governorate_id,
        'previous_order_count', ps.order_count,
        'previous_orders_total', ps.orders_total,
        'previous_order_number', ps.last_order_number,
        'previous_order_date', ps.last_order_date,
        'previous_order_total', ps.last_order_total,
        'strict_previous_order_count', sps.order_count,
        'strict_previous_orders_total', sps.orders_total,
        'strict_previous_order_total', sps.last_order_total,
        'strict_previous_order_date', sps.last_order_date
      )
      ORDER BY
        CASE WHEN p_date_source = 'event' THEN o.updated_at ELSE o.created_at END DESC NULLS LAST,
        o.created_at DESC
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
    LEFT JOIN LATERAL (
      SELECT
        count(*)::bigint AS order_count,
        COALESCE(sum(total_amount), 0) AS orders_total,
        (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total,
        max(created_at) AS last_order_date
      FROM public.orders o3
      WHERE o3.customer_id = o.customer_id AND o3.created_at < o.created_at
    ) sps ON p_include_strict_previous
    WHERE (
      -- Customer: see only own orders by customer_id
      (v_session.identity_type = 'customer' AND o.customer_id = v_session.customer_id)
      OR
      -- Employee: use existing visibility rules
      (v_session.identity_type = 'employee' AND (v_is_super OR c.owner_id = ANY(v_visible)))
    )
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           o.reference_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%' OR
           COALESCE(o.snapshot_customer_phone, ci.phone) ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_date_from IS NULL OR
           CASE WHEN p_date_source = 'event' THEN o.updated_at ELSE o.created_at END >= p_date_from)
      AND (p_date_to IS NULL OR
           CASE WHEN p_date_source = 'event' THEN o.updated_at ELSE o.created_at END <= p_date_to)
      AND (p_governorate_id IS NULL OR ca.governorate_id = p_governorate_id)
  );
END;
$function$;
