-- =============================================================================
-- Migration 20260821: Expand executive queue — show all non-draft/cancelled statuses
-- =============================================================================
-- المشكلة: دالة get_governed_executive_queue تعرض فقط الطلبات ذات الحالات
-- التشغيلية (approved+) ولا تُظهر الطلبات في حالات submitted و reviewing
-- الحل: توسيع IN clause ليشمل submitted و reviewing
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

-- =============================================================================
-- Update KPIs RPC to include submitted and reviewing counts
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_governed_executive_kpis CASCADE;

CREATE OR REPLACE FUNCTION public.get_governed_executive_kpis(
  p_token uuid,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date
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
  v_waiting_review bigint;
  v_under_review bigint;
  v_waiting_prep bigint;
  v_in_prep bigint;
  v_ready_for_dispatch bigint;
  v_in_delivery bigint;
  v_delivered bigint;
  v_uncollected bigint;
  v_partially_collected bigint;
  v_fully_collected bigint;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_can_see_all := v_is_super OR public.check_capability(p_token, 'orders.manage');
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

  SELECT count(*) INTO v_waiting_review FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'submitted'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'));

  SELECT count(*) INTO v_under_review FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'reviewing'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'));

  SELECT count(*) INTO v_waiting_prep FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'approved'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'));

  SELECT count(*) INTO v_in_prep FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'preparing'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'));

  SELECT count(*) INTO v_ready_for_dispatch FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'prepared'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'));

  SELECT count(*) INTO v_in_delivery FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status IN ('dispatched', 'sent_to_delivery', 'deferred')
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'));

  SELECT count(*) INTO v_delivered FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'delivered'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'));

  SELECT count(*) INTO v_uncollected FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'delivered'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'))
    AND NOT EXISTS (
      SELECT 1 FROM public.collections col
      WHERE (col.order_id = o.id OR col.customer_id = o.customer_id)
        AND col.status IN ('approved', 'treasury_posted')
    );

  SELECT count(*) INTO v_fully_collected FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'delivered'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'))
    AND (
      SELECT COALESCE(SUM(col.amount), 0) FROM public.collections col
      WHERE (col.order_id = o.id OR col.customer_id = o.customer_id)
        AND col.status IN ('approved', 'treasury_posted')
    ) >= o.total_amount;

  SELECT count(*) INTO v_partially_collected FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'delivered'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'))
    AND EXISTS (
      SELECT 1 FROM public.collections col
      WHERE (col.order_id = o.id OR col.customer_id = o.customer_id)
        AND col.status IN ('approved', 'treasury_posted')
    )
    AND (
      SELECT COALESCE(SUM(col.amount), 0) FROM public.collections col
      WHERE (col.order_id = o.id OR col.customer_id = o.customer_id)
        AND col.status IN ('approved', 'treasury_posted')
    ) < o.total_amount;

  RETURN jsonb_build_object(
    'waiting_review', v_waiting_review,
    'under_review', v_under_review,
    'waiting_preparation', v_waiting_prep,
    'in_preparation', v_in_prep,
    'ready_for_dispatch', v_ready_for_dispatch,
    'in_delivery', v_in_delivery,
    'delivered', v_delivered,
    'uncollected', v_uncollected,
    'partially_collected', v_partially_collected,
    'fully_collected', v_fully_collected
  );
END;
$function$;
