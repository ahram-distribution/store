-- =============================================================================
-- Phase 5d — Add customer_owner_name/role to executive queue RPC
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_governed_executive_queue CASCADE;
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
  v_sql text;
  v_result jsonb;
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
        'owner_name', COALESCE(o.snapshot_owner_name, e.full_name),
        'created_by_name', COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, ''),
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
      AND o.status IN ('approved', 'preparing', 'prepared', 'ready_for_dispatch', 'dispatched', 'sent_to_delivery', 'delivered', 'deferred', 'returned_for_revision')
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
