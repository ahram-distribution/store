-- ============================================================================
-- CUSTOMER FOLLOW-UP GAP CLOSURE (business-requirement alignment)
-- ----------------------------------------------------------------------------
-- Closes the gaps between the approved "متابعة العملاء" business requirements
-- and the deployed follow-up module WITHOUT redesigning any existing screen,
-- without weakening global governance, and without touching ownership / sales
-- attribution / order-state / inventory semantics.
--
-- Changes are strictly additive and role-isolated:
--
--   1. GAP 1 (see ALL customers): the role is granted the EXISTING capability
--      customers.read.  get_governed_customers already branches on
--      customers.read to return ALL customers ("all periods" is its natural
--      behavior — no date bound by default). Only this role gains the cap;
--      every other role's visibility is untouched.
--
--   2. GAP 2 (see ALL orders + governed order creation):
--        * orders.read      — EXISTING capability (orders module coherence).
--        * orders.create    — EXISTING capability: governed_create_order keeps
--                             enforcing created_by = the actual creating
--                             employee; order-state / inventory / attribution
--                             logic is untouched.
--        * orders.view_all  — NEW dedicated read-only capability granted ONLY
--                             to this role. get_unified_orders and
--                             get_unified_order are amended (server-side,
--                             within the existing governed RPCs) so that an
--                             employee holding orders.view_all observes ALL
--                             orders; employees WITHOUT it keep the exact
--                             hierarchical visibility they had before.
--
--   orders.read is deliberately NOT overloaded to mean "all orders": it is
--   already granted to most roles (sales rep, supervisor, delivery, ...), so
--   changing its meaning would silently broaden existing roles. A dedicated
--   capability follows the platform precedent (attendance.view_all /
--   targets.view_all).
--
--   3. GAP 2 also covers orders for NEWLY created customers: the role is
--      granted the EXISTING customers.create capability (governed_create_customer).
--
--   OWNER ≠ FOLLOW-UP ASSIGNEE: nothing below alters customers.owner_id,
--   customers.created_by, follow_up_assignee_id, sales attribution, order
--   ownership, order status transitions, or inventory movement.
--
--   4. GAP 4: new governed RPC get_smart_follow_up_suggestions(p_token,
--      p_customer_id). Deterministic + explainable; derived ONLY from real
--      data (statistical orders via public.is_order_in_statistics, previous
--      follow-up activity, logged contact events). Never fabricates a
--      schedule: insufficient history yields an explicit 'insufficient' item
--      with the reason and a NULL schedule so manual scheduling is retained.
--
-- GAP 3 (manual scheduling presets) and GAP 5 (existing PWA push path) are
-- handled in frontend / deployment materials, NOT in this schema file.
-- ============================================================================

-- 1. CAPABILITY -------------------------------------------------------------
-- New read-only "view all orders" capability (reuse-precedent: attendance.view_all).
INSERT INTO public.capabilities (code, name, "group")
VALUES ('orders.view_all', 'عرض كل الطلبات', 'orders')
ON CONFLICT (code) DO NOTHING;

-- 2. ROLE → CAPABILITIES ----------------------------------------------------
-- Grants the role the EXISTING customer/order capabilities it needs plus the
-- new orders.view_all. Resolve-by-code + ON CONFLICT DO NOTHING keeps this
-- idempotent and order-safe. No other role is modified.
DO $$
DECLARE
    v_role_id uuid;
    v_cap_id uuid;
    v_code text;
    v_codes text[] := ARRAY['customers.read','customers.create','orders.read','orders.create','orders.view_all'];
BEGIN
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'متابعة العملاء' LIMIT 1;
    IF v_role_id IS NULL THEN RETURN; END IF;

    FOREACH v_code IN ARRAY v_codes LOOP
        SELECT id INTO v_cap_id FROM public.capabilities WHERE code = v_code;
        IF v_cap_id IS NOT NULL THEN
            INSERT INTO public.role_capabilities (role_id, capability_id)
            VALUES (v_role_id, v_cap_id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END $$;
-- ============================================================================
-- 3. get_unified_orders -- amended for orders.view_all (GAP 2)
-- ============================================================================
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
  v_view_all boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_view_all := (v_session.identity_type = 'employee') AND app.has_capability('orders.view_all');
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
      (v_session.identity_type = 'employee' AND (v_is_super OR v_view_all OR c.owner_id = ANY(v_visible)))
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

-- ============================================================================
-- 4. get_unified_order -- amended for orders.view_all (GAP 2)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_unified_order(p_token text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_is_upper boolean;
  v_visible uuid[];
  v_order public.orders%ROWTYPE;
  v_customer_id uuid;
  v_allowed boolean;
  v_view_all boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_session.identity_type = 'customer' THEN
    IF v_order.customer_id != v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  ELSE
    v_employee_id := v_session.employee_id;
    v_is_upper := public.is_upper_management(v_employee_id);
    v_view_all := app.has_capability('orders.view_all');
    IF NOT (v_is_upper OR v_view_all) THEN
      v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
      SELECT EXISTS(
        SELECT 1 FROM public.customers c
        WHERE c.id = v_order.customer_id
          AND (c.owner_id = ANY(v_visible))
      ) INTO v_allowed;
      IF NOT v_allowed THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
  END IF;

  v_customer_id := v_order.customer_id;

  RETURN (
    SELECT jsonb_build_object(
      'order', jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'order_type', o.order_type,
        'subtotal', o.subtotal,
        'discount_amount', o.discount_amount,
        'tax_amount', o.tax_amount,
        'total_amount', o.total_amount,
        'notes', o.notes,
        'revision_number', o.revision_number,
        'last_revised_at', o.last_revised_at,
        'customer_id', o.customer_id,
        'owner_type', o.owner_type,
        'owner_id', o.owner_id,
        'created_by', o.created_by,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'delivered_at', o.delivered_at,
        'cancelled_at', o.cancelled_at,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'deferred_until', o.deferred_until,
        'defer_reason', o.defer_reason,
        'cancel_reason', o.cancel_reason,
        'execution_latitude', o.execution_latitude,
        'execution_longitude', o.execution_longitude,
        'execution_accuracy_meters', o.execution_accuracy_meters,
        'execution_captured_at', o.execution_captured_at,
        'execution_location_id', o.execution_location_id,
        'tier_id', o.tier_id,
        'effective_discount_percent', o.effective_discount_percent
      ) || jsonb_build_object(
        'snapshot_customer_name', o.snapshot_customer_name,
        'snapshot_customer_phone', o.snapshot_customer_phone,
        'snapshot_customer_address', o.snapshot_customer_address,
        'snapshot_customer_code', o.snapshot_customer_code,
        'snapshot_owner_name', o.snapshot_owner_name,
        'snapshot_owner_phone', o.snapshot_owner_phone,
        'snapshot_owner_address', o.snapshot_owner_address,
        'snapshot_sender_name', o.snapshot_sender_name,
        'snapshot_sender_phone', o.snapshot_sender_phone,
        'snapshot_sender_address', o.snapshot_sender_address,
        'customer_owner_name', COALESCE(co_emp.full_name, ''),
        'customer_owner_role', COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = c.owner_id LIMIT 1), ''),
        'order_creator_name', COALESCE(oc_emp.full_name, oc_cust.company_name, ''),
        'order_creator_role', CASE
          WHEN oc_i.identity_type = 'employee' THEN COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = oc_emp.id LIMIT 1), '')
          ELSE NULL
        END,
        'customer_owner_id', c.owner_id,
        'order_creator_id', CASE
          WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
          WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
          ELSE NULL
        END,
        'order_creator_type', oc_i.identity_type,
        'reference_number', o.reference_number
      ),
      'customer', (
        SELECT jsonb_build_object(
          'id', c.id,
          'code', c.code,
          'company_name', c.company_name,
          'phone', i.phone,
          'address_line1', ca.address_line1,
          'address_line2', ca.address_line2,
          'city', ca.city,
          'governorate', ca.governorate,
          'address_latitude', ca.latitude,
          'address_longitude', ca.longitude
        )
        FROM public.customers c
        LEFT JOIN public.identities i ON i.id = c.identity_id
        LEFT JOIN public.customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = true
        WHERE c.id = v_customer_id
        LIMIT 1
      ),
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
      'status_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', osh.id,
          'from_status', osh.from_status,
          'to_status', osh.to_status,
          'changed_by', osh.changed_by,
          'changed_at', osh.changed_at,
          'changed_by_name', e_changed.full_name,
          'reason', osh.reason,
          'reference_number', osh.reference_number
        ) ORDER BY osh.changed_at)
        FROM public.order_status_history osh
        LEFT JOIN public.employees e_changed ON e_changed.identity_id = osh.changed_by
        WHERE osh.order_id = o.id
      ), '[]'::jsonb),
      'modification_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', omh.id,
          'revision_number', omh.revision_number,
          'field_name', omh.field_name,
          'old_value', omh.old_value,
          'new_value', omh.new_value,
          'old_order_items', omh.old_order_items,
          'new_order_items', omh.new_order_items,
          'old_daily_deals', omh.old_daily_deals,
          'new_daily_deals', omh.new_daily_deals,
          'old_flash_offers', omh.old_flash_offers,
          'new_flash_offers', omh.new_flash_offers,
          'modified_by', omh.modified_by,
          'modified_by_name', e_modified.full_name,
          'reason', omh.reason,
          'modified_at', omh.modified_at
        ) ORDER BY omh.modified_at DESC)
        FROM public.order_modification_history omh
        LEFT JOIN public.employees e_modified ON e_modified.identity_id = omh.modified_by
        WHERE omh.order_id = o.id
      ), '[]'::jsonb),
      'current_delivery', (
        SELECT jsonb_build_object(
          'id', dt.id,
          'status', dt.status,
          'attempt_number', dt.attempt_number,
          'assigned_to', dt.assigned_to,
          'assigned_by', dt.assigned_by,
          'assigned_at', dt.assigned_at,
          'started_at', dt.started_at,
          'completed_at', dt.completed_at,
          'failure_reason', dt.failure_reason,
          'failure_notes', dt.failure_notes,
          'notes', dt.notes,
          'returned_at', dt.returned_at,
          'external_carrier_id', dt.external_carrier_id,
          'waybill_number', dt.waybill_number,
          'tracking_url', dt.tracking_url,
          'assigned_to_name', ast.code,
          'assigned_to_phone', i_assigned.phone,
          'external_carrier_name', ec.name,
          'updated_at', dt.updated_at
        )
        FROM public.delivery_tracking dt
        LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
        LEFT JOIN public.identities i_assigned ON i_assigned.id = ast.identity_id
        LEFT JOIN public.external_carriers ec ON ec.id = dt.external_carrier_id
        WHERE dt.order_id = o.id AND dt.is_active = true
        LIMIT 1
      ),
      'delivery_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', dt.id,
          'status', dt.status,
          'attempt_number', dt.attempt_number,
          'is_active', dt.is_active,
          'assigned_to', dt.assigned_to,
          'assigned_by', dt.assigned_by,
          'assigned_at', dt.assigned_at,
          'started_at', dt.started_at,
          'completed_at', dt.completed_at,
          'failure_reason', dt.failure_reason,
          'failure_notes', dt.failure_notes,
          'notes', dt.notes,
          'returned_at', dt.returned_at,
          'external_carrier_id', dt.external_carrier_id,
          'waybill_number', dt.waybill_number,
          'tracking_url', dt.tracking_url,
          'assigned_to_name', ast.code,
          'assigned_to_phone', i_assigned.phone,
          'external_carrier_name', ec.name,
          'updated_at', dt.updated_at
        ) ORDER BY dt.attempt_number)
        FROM public.delivery_tracking dt
        LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
        LEFT JOIN public.identities i_assigned ON i_assigned.id = ast.identity_id
        LEFT JOIN public.external_carriers ec ON ec.id = dt.external_carrier_id
        WHERE dt.order_id = o.id
      ), '[]'::jsonb),
      'preparation', (
        SELECT jsonb_build_object(
          'id', pr.id,
          'status', pr.status,
          'started_by', pr.started_by,
          'started_at', pr.started_at,
          'completed_by', pr.completed_by,
          'completed_at', pr.completed_at,
          'reviewed_by', pr.reviewed_by,
          'reviewed_at', pr.reviewed_at,
          'cancelled_by', pr.cancelled_by,
          'cancelled_at', pr.cancelled_at,
          'notes', pr.notes
        )
        FROM public.preparation_records pr
        WHERE pr.order_id = o.id
        ORDER BY pr.created_at DESC
        LIMIT 1
      ),
      'returns', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', r.id,
          'code', r.code,
          'status', r.status,
          'credit_note_amount', r.credit_note_amount,
          'notes', r.notes,
          'created_at', r.created_at
        ) ORDER BY r.created_at)
        FROM public.returns r
        WHERE r.order_id = o.id
      ), '[]'::jsonb),
      'collections', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', col.id,
          'code', col.code,
          'method', col.method,
          'amount', col.amount,
          'status', col.status,
          'reference_number', col.reference_number,
          'collected_at', col.collected_at,
          'order_id', col.order_id
        ) ORDER BY col.created_at)
        FROM public.collections col
        WHERE col.order_id = o.id
           OR (col.customer_id = v_customer_id AND col.order_id IS NULL)
      ), '[]'::jsonb)
    )
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.employees co_emp ON co_emp.id = c.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    WHERE o.id = p_id
  );
END;
$function$;

-- ============================================================================
-- 5. SMART FOLLOW-UP SUGGESTIONS RPC (GAP 4)
-- ----------------------------------------------------------------------------
-- Deterministic, explainable per-customer suggestions derived ONLY from real
-- governed data:
--   * statistical sales orders filtered by public.is_order_in_statistics (the
--     SAME "actual sales" definition used by platform sales reports — non-
--     statistical / cancelled orders are excluded; no second sales engine).
--   * previous follow-up activity (customer_follow_ups)
--   * logged contact events (customer_follow_up_contacts, visits)
-- No schedule is ever fabricated: when the history is insufficient the RPC
-- returns an explicit 'insufficient' suggestion with the reason and a NULL
-- schedule, so the user keeps the manual scheduling option.
-- Governance mirrors get_customer_orders: employees only, and only customers
-- visible via customers.read OR owned inside the caller's subtree.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_smart_follow_up_suggestions(p_token text, p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_token uuid := p_token::uuid;
  v_session app.sessions;
  v_emp_id uuid;
  v_customer_exists boolean;
  v_order_count bigint;
  v_first_order_at timestamptz;
  v_last_order_at timestamptz;
  v_avg_interval numeric;
  v_days_since_last_order bigint;
  v_recent_30d numeric;
  v_previous_30d numeric;
  v_last_contact timestamptz;
  v_prev_follow_ups bigint;
  v_suggestions jsonb := jsonb_build_array();
  v_data jsonb;
  v_next_expected timestamptz;
  v_next_in_days bigint;
  v_days_since_contact bigint;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  -- Internal CRM suggestions: employees only; access mirrors get_customer_orders.
  IF v_session.identity_type = 'customer' THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  v_emp_id := v_session.employee_id;
  IF NOT app.has_capability('customers.read')
     AND NOT EXISTS(SELECT 1 FROM public.customers c
                    WHERE c.id = p_customer_id
                      AND c.owner_id = ANY(app.get_subtree_ids(v_emp_id))) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.customers WHERE id = p_customer_id) INTO v_customer_exists;
  IF NOT v_customer_exists THEN RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND'); END IF;

  -- (A) Statistical sales history (governed "actual sales" definition).
  SELECT
    count(*)::bigint,
    min(created_at),
    max(created_at)
  INTO v_order_count, v_first_order_at, v_last_order_at
  FROM public.orders o
  WHERE o.customer_id = p_customer_id
    AND public.is_order_in_statistics(o.status);

  -- (B) Average inter-order interval across statistical orders.
  IF v_order_count >= 2 AND v_first_order_at IS NOT NULL AND v_last_order_at IS NOT NULL THEN
    v_avg_interval := round(
      extract(epoch FROM (v_last_order_at - v_first_order_at)) / (v_order_count - 1) / 86400.0
    )::numeric;
  END IF;

  -- (C) Recent vs previous 30-day statistical totals (trend).
  SELECT
    COALESCE(sum(total_amount) FILTER (WHERE created_at >= now() - interval '30 days'), 0),
    COALESCE(sum(total_amount) FILTER (
      WHERE created_at >= now() - interval '60 days' AND created_at < now() - interval '30 days'), 0)
  INTO v_recent_30d, v_previous_30d
  FROM public.orders o
  WHERE o.customer_id = p_customer_id
    AND public.is_order_in_statistics(o.status);

  -- (D) Last contact event: completed follow-up / logged contact / visit.
  SELECT GREATEST(
    COALESCE((SELECT max(completed_at) FROM public.customer_follow_ups
              WHERE customer_id = p_customer_id AND completed_at IS NOT NULL), '-infinity'::timestamptz),
    COALESCE((SELECT max(contact_at) FROM public.customer_follow_up_contacts
              WHERE customer_id = p_customer_id), '-infinity'::timestamptz),
    COALESCE((SELECT max(check_in_at) FROM public.visits
              WHERE customer_id = p_customer_id AND check_in_at IS NOT NULL), '-infinity'::timestamptz)
  ) INTO v_last_contact;

  -- (E) Previous follow-up activity.
  SELECT count(*)::bigint INTO v_prev_follow_ups
  FROM public.customer_follow_ups
  WHERE customer_id = p_customer_id;

  IF v_last_order_at IS NOT NULL THEN
    v_days_since_last_order := floor(extract(epoch FROM (now() - v_last_order_at)) / 86400.0)::bigint;
  END IF;
  IF v_last_contact > '-infinity'::timestamptz THEN
    v_days_since_contact := floor(extract(epoch FROM (now() - v_last_contact)) / 86400.0)::bigint;
  END IF;

  -- ===== Suggestion assembly (deterministic priority: primary then secondary) ====

  -- No statistical sales at all.
  IF v_order_count = 0 THEN
    IF v_prev_follow_ups = 0 THEN
      v_suggestions := v_suggestions || jsonb_build_array(jsonb_build_object(
        'kind', 'insufficient',
        'title', 'بيانات غير كافية',
        'reason', 'لا يوجد للعميل سجل طلبات فعلي ولا سجل متابعة سابق، لذا لا يمكن بناء اقتراح على سلوك العميل. حدد موعدًا يدويًا للمتابعة.',
        'suggested_at', NULL, 'suggested_interval_days', NULL));
    ELSE
      v_suggestions := v_suggestions || jsonb_build_array(jsonb_build_object(
        'kind', 'insufficient',
        'title', 'بيانات غير كافية لدورة الشراء',
        'reason', 'لا يوجد للعميل طلبات فعلية (' || v_order_count || ') لكن توجد ' || v_prev_follow_ups
                || ' متابعة سابقة. البيانات غير كافية لحساب دورة الشراء؛ حدد موعدًا يدويًا للمتابعة.',
        'suggested_at', NULL, 'suggested_interval_days', NULL));
    END IF;

  -- Only a single statistical order: cannot compute a purchase cycle.
  ELSIF v_order_count = 1 THEN
    v_suggestions := v_suggestions || jsonb_build_array(jsonb_build_object(
      'kind', 'insufficient',
      'title', 'بيانات غير كافية لدورة الشراء',
      'reason', 'سجل العميل يحتوي على طلب واحد فقط (' || to_char(v_last_order_at, 'YYYY-MM-DD')
              || ') — لا يمكن حساب متوسط دورة الشراء. حدد موعدًا يدويًا للمتابعة.',
      'suggested_at', NULL, 'suggested_interval_days', NULL));
    IF v_days_since_last_order IS NOT NULL AND v_days_since_last_order >= 30 THEN
      v_suggestions := v_suggestions || jsonb_build_array(jsonb_build_object(
        'kind', 'inactivity',
        'title', 'متابعة بسبب توقف النشاط',
        'reason', 'آخر طلب فعلي قبل ' || v_days_since_last_order || ' يومًا (' || to_char(v_last_order_at, 'YYYY-MM-DD')
                || ') — العميل متوقف عن الطلب، يُوصى بالتواصل الآن.',
        'suggested_at', now(), 'suggested_interval_days', NULL));
    END IF;

  -- Two or more statistical orders: real purchase-cycle math is possible.
  ELSE
    v_next_expected := v_last_order_at + (v_avg_interval::text || ' days')::interval;
    v_next_in_days := floor(extract(epoch FROM (v_next_expected - now())) / 86400.0)::bigint;

    IF v_next_in_days <= 0 THEN
      v_suggestions := v_suggestions || jsonb_build_array(jsonb_build_object(
        'kind', 'interval_elapsed',
        'title', 'متابعة لأن دورة الشراء تجاوزت',
        'reason', 'متوسط دورة شراء العميل ' || v_avg_interval::bigint || ' يومًا، ولم يسجل طلبًا منذ '
                || v_days_since_last_order || ' يومًا. الموعد المتوقع للطلب التالي كان ' || to_char(v_next_expected, 'YYYY-MM-DD')
                || ' — يوصى بمتابعة فورية.',
        'suggested_at', now(), 'suggested_interval_days', NULL));
    ELSE
      v_suggestions := v_suggestions || jsonb_build_array(jsonb_build_object(
        'kind', 'expected_reorder',
        'title', 'اقتراح المتابعة: بعد ' || v_next_in_days || ' يومًا',
        'reason', 'متوسط دورة شراء العميل ' || v_avg_interval::bigint || ' يومًا ولم يسجل طلبًا منذ '
                || v_days_since_last_order || ' يومًا. الموعد المتوقع للطلب التالي: ' || to_char(v_next_expected, 'YYYY-MM-DD') || '.',
        'suggested_at', v_next_expected, 'suggested_interval_days', v_next_in_days));
    END IF;
  END IF;

  -- Secondary: sales-trend decline (early follow-up).
  IF v_previous_30d > 0 AND v_recent_30d < v_previous_30d * 0.6 THEN
    v_suggestions := v_suggestions || jsonb_build_array(jsonb_build_object(
      'kind', 'sales_decline',
      'title', 'اقتراح متابعة مبكرة',
      'reason', 'انخفاض مبيعات العميل مقارنة بالفترة السابقة (آخر 30 يومًا: ' || v_recent_30d::numeric(14,2)
              || ' مقابل ' || v_previous_30d::numeric(14,2) || ' في الفترة السابقة).',
      'suggested_at', now(), 'suggested_interval_days', NULL));
  END IF;

  -- Secondary: contact gap.
  IF v_days_since_contact IS NOT NULL AND v_days_since_contact >= 30 THEN
    v_suggestions := v_suggestions || jsonb_build_array(jsonb_build_object(
      'kind', 'contact_stale',
      'title', 'متابعة بسبب انقطاع التواصل',
      'reason', 'آخر تواصل مع العميل قبل ' || v_days_since_contact || ' يومًا (' || to_char(v_last_contact, 'YYYY-MM-DD') || ').',
      'suggested_at', now(), 'suggested_interval_days', NULL));
  END IF;

  v_data := jsonb_build_object(
    'order_count', v_order_count,
    'last_order_date', v_last_order_at,
    'days_since_last_order', v_days_since_last_order,
    'avg_interval_days', CASE WHEN v_order_count >= 2 THEN v_avg_interval ELSE NULL END,
    'last_contact_date', CASE WHEN v_last_contact > '-infinity'::timestamptz THEN v_last_contact ELSE NULL END,
    'days_since_last_contact', v_days_since_contact,
    'previous_follow_ups', v_prev_follow_ups,
    'recent_30d_total', v_recent_30d,
    'previous_30d_total', v_previous_30d
  );

  RETURN jsonb_build_object('customer_id', p_customer_id, 'suggestions', v_suggestions, 'data', v_data);
END;
$function$;
