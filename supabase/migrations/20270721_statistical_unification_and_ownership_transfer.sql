-- ============================================================================
-- Migration: Statistical Unification + Order Ownership Transfer
--
-- 1. is_order_in_statistics() — canonical statistical rule (Rules 1-3)
-- 2. get_statistical_orders — bulk statistical source for all analytics modules
-- 3. get_employee_detail_data — fix: use is_order_in_statistics + created_at date
-- 4. governed_transfer_order_owner — formal business operation (Rule 6)
-- ============================================================================

-- ============================================================================
-- 1. CANONICAL STATISTICAL RULE FUNCTION
--    Answers: "Should this order participate in statistical calculations?"
--    Orders with status draft, submitted, or cancelled are NEVER counted.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_order_in_statistics(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status NOT IN ('draft', 'submitted', 'cancelled')
$$;

COMMENT ON FUNCTION public.is_order_in_statistics IS 'Canonical statistical rule: determines whether an order participates in statistical calculations. Draft, submitted, and cancelled orders are excluded. Every statistical module must use this function.';

-- ============================================================================
-- 2. GET_STATISTICAL_ORDERS — bulk statistical source
--    Replaces get_unified_orders for all statistical/analytics modules.
--    Filters by is_order_in_statistics() and orders.owner_id (not created_by).
--    Returns items array for company/product aggregation.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_statistical_orders(
  p_token text,
  p_search text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token uuid := p_token::uuid;
  v_session app.sessions;
  v_visible uuid[];
  v_is_super boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;

  IF v_session.identity_type = 'customer' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_visible := COALESCE(public.get_visible_employee_ids(v_token), '{}'::uuid[]);

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
        'customer_owner_name', COALESCE(co_emp.full_name, ''),
        'customer_owner_role', COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = c.owner_id LIMIT 1), ''),
        'customer_owner_id', c.owner_id,
        'created_by_id', CASE
          WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
          WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
          ELSE NULL
        END,
        'created_by_type', oc_i.identity_type
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
    WHERE public.is_order_in_statistics(o.status)
      AND (v_is_super OR c.owner_id = ANY(v_visible))
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%')
      AND (p_owner_id IS NULL OR o.owner_id = p_owner_id)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_statistical_orders TO authenticated;

COMMENT ON FUNCTION public.get_statistical_orders IS 'Canonical statistical source for all analytics modules. Excludes draft/cancelled orders. Filters by orders.owner_id (statistical owner, Rule 2). Returns items array for company/product aggregation.';

-- ============================================================================
-- 3. FIX get_employee_detail_data
--    a) Replace hardcoded NOT IN ('draft','cancelled') with is_order_in_statistics()
--    b) Fix date field from submitted_at to created_at (consistency with other modules)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_employee_detail_data(
    p_token uuid,
    p_employee_id uuid,
    p_from date,
    p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.is_upper_management(v_session.employee_id) THEN
        IF NOT (p_employee_id = ANY(public.get_visible_employee_ids(p_token))) THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN');
        END IF;
    END IF;

    WITH
    order_detail AS (
        SELECT jsonb_agg(jsonb_build_object(
            'id', o.id,
            'order_number', o.order_number,
            'total_amount', o.total_amount,
            'status', o.status,
            'submitted_at', o.submitted_at,
            'customer_name', COALESCE(o.snapshot_customer_name, ''),
            'customer_phone', COALESCE(o.snapshot_customer_phone, '')
        ) ORDER BY o.created_at DESC)
        FROM public.orders o
        WHERE public.resolve_employee_id(o.owner_id) = p_employee_id
          AND o.created_at::date >= p_from AND o.created_at::date <= p_to
          AND public.is_order_in_statistics(o.status)
    ),
    customer_detail AS (
        SELECT jsonb_agg(jsonb_build_object(
            'id', c.id,
            'code', c.code,
            'company_name', c.company_name,
            'created_at', c.created_at,
            'responsible_name', COALESCE(c.responsible_name, '')
        ) ORDER BY c.created_at DESC)
        FROM public.customers c
        WHERE public.resolve_employee_id(c.owner_id) = p_employee_id
          AND c.created_at::date >= p_from AND c.created_at::date <= p_to
    ),
    visit_detail AS (
        SELECT jsonb_agg(jsonb_build_object(
            'id', v.id,
            'code', v.code,
            'customer_name', COALESCE(c.company_name, ''),
            'check_in_at', v.check_in_at,
            'check_out_at', v.check_out_at,
            'status', v.status,
            'visit_result', COALESCE(v.visit_result, ''),
            'latitude', v.check_in_latitude,
            'longitude', v.check_in_longitude
        ) ORDER BY v.check_in_at DESC)
        FROM public.visits v
        LEFT JOIN public.customers c ON c.id = v.customer_id
        WHERE v.employee_id = p_employee_id
          AND v.check_in_at::date >= p_from AND v.check_in_at::date <= p_to
    ),
    collection_detail AS (
        SELECT jsonb_agg(jsonb_build_object(
            'id', col.id,
            'code', col.code,
            'amount', col.amount,
            'status', col.status,
            'created_at', col.created_at,
            'collected_at', col.collected_at,
            'customer_name', COALESCE(c.company_name, ''),
            'reference_number', COALESCE(col.reference_number, '')
        ) ORDER BY col.created_at DESC)
        FROM public.collections col
        LEFT JOIN public.customers c ON c.id = col.customer_id
        WHERE public.resolve_employee_id(col.owner_id) = p_employee_id
          AND col.created_at::date >= p_from AND col.created_at::date <= p_to
    )
    SELECT jsonb_build_object(
        'orders', COALESCE((SELECT * FROM order_detail), '[]'::jsonb),
        'customers', COALESCE((SELECT * FROM customer_detail), '[]'::jsonb),
        'visits', COALESCE((SELECT * FROM visit_detail), '[]'::jsonb),
        'collections', COALESCE((SELECT * FROM collection_detail), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_employee_detail_data TO authenticated;

COMMENT ON FUNCTION public.get_employee_detail_data IS 'السجلات الخام التي كوّنت كل KPI — طلبات، عملاء، زيارات، تحصيل. Uses is_order_in_statistics() and created_at for date filtering.';

-- ============================================================================
-- 4. GOVERNED TRANSFER ORDER OWNER — formal business operation
--    Transfers orders.owner_id (statistical owner) with full audit trail.
--    Permission: Upper Management or Sales Manager (own orders or direct reports).
--    Prevents: same-owner transfer, invalid target, unauthorized access.
--    Guarantees: atomic transaction, audit record, clear result.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_transfer_order_owner(
  p_token text,
  p_order_id uuid,
  p_new_owner_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token uuid := p_token::uuid;
  v_session app.sessions;
  v_order RECORD;
  v_old_owner_id uuid;
  v_old_owner_name text;
  v_new_owner_name text;
  v_is_super boolean;
  v_new_owner_exists boolean;
  v_visible uuid[];
BEGIN
  -- 1. Validate session
  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  -- 2. Load order
  SELECT o.id, o.owner_id, o.revision_number, o.order_number, o.status
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  v_old_owner_id := v_order.owner_id;

  -- 3. Permission check
  v_is_super := public.is_upper_management(v_session.employee_id);
  IF NOT v_is_super THEN
    IF NOT (
      v_old_owner_id = v_session.employee_id
      OR EXISTS (
        SELECT 1 FROM public.employees
        WHERE id = v_old_owner_id AND manager_id = v_session.employee_id
      )
    ) THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  END IF;

  -- 4. Validate new owner is in caller's governed tree
  IF v_is_super THEN
    SELECT EXISTS(SELECT 1 FROM public.employees WHERE id = p_new_owner_id AND is_active = true)
    INTO v_new_owner_exists;
  ELSE
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
    v_new_owner_exists := (p_new_owner_id = ANY(v_visible));
  END IF;
  IF NOT v_new_owner_exists THEN
    RETURN jsonb_build_object('error', 'NEW_OWNER_NOT_IN_SCOPE');
  END IF;

  -- 5. Prevent same owner
  IF v_old_owner_id = p_new_owner_id THEN
    RETURN jsonb_build_object('error', 'SAME_OWNER');
  END IF;

  -- 6. Get names for audit
  v_old_owner_name := COALESCE(
    (SELECT full_name FROM public.employees WHERE id = v_old_owner_id),
    'غير محدد'
  );
  v_new_owner_name := COALESCE(
    (SELECT full_name FROM public.employees WHERE id = p_new_owner_id),
    'غير محدد'
  );

  -- 7. Atomic transfer + audit
  UPDATE public.orders
  SET owner_id = p_new_owner_id,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    modified_by, reason, modified_at
  ) VALUES (
    p_order_id,
    GREATEST(COALESCE(v_order.revision_number, 1), 1),
    'OWNER_TRANSFER',
    v_old_owner_name,
    v_new_owner_name,
    v_session.identity_id,
    COALESCE(p_reason, 'نقل ملكية الطلب'),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'old_owner_id', v_old_owner_id,
    'new_owner_id', p_new_owner_id,
    'old_owner_name', v_old_owner_name,
    'new_owner_name', v_new_owner_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.governed_transfer_order_owner TO authenticated;

COMMENT ON FUNCTION public.governed_transfer_order_owner IS 'نقل ملكية الطلب — عملية עסקية رسمية. تغير orders.owner_id فقط مع سجل تدريجي كامل.';
