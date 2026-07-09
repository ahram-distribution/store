-- ============================================================================
-- Migration v2: Add customer_last_order_total to both unified order RPCs
-- ============================================================================
-- Adds to BOTH get_unified_orders and get_unified_order:
--   customer_last_order_total / last_order_total
--
-- Single-pass CTE addition only. All new fields nullable.
-- ============================================================================

-- ============================================================================
-- 1. Update get_unified_orders — add customer_last_order_total
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_unified_orders(p_token text, p_search text, p_status varchar, p_customer_id uuid, p_created_by uuid, p_date_from timestamptz, p_date_to timestamptz);
DROP FUNCTION IF EXISTS public.get_unified_orders(p_token uuid, p_search text, p_status varchar, p_customer_id uuid, p_created_by uuid, p_date_from timestamptz, p_date_to timestamptz);

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
      WITH customer_stats AS (
        SELECT
          customer_id,
          count(*)::bigint AS order_count,
          COALESCE(sum(total_amount), 0) AS lifetime_total,
          max(created_at) AS last_order_date,
          (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
          (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total
        FROM public.orders
        GROUP BY customer_id
      )
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
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
        'created_by', o.created_by,
        'created_by_name', COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, ''),
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'notes', o.notes,
        'item_count', (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id),
        'current_delivery_status', (
          SELECT dt.status FROM public.delivery_tracking dt
          WHERE dt.order_id = o.id AND dt.is_active = true LIMIT 1
        ),
        'customer_owner_name', COALESCE(co_emp.full_name, ''),
        'customer_owner_role', COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = c.owner_id LIMIT 1), ''),
        'customer_owner_id', c.owner_id,
        'owner_name', COALESCE(o.snapshot_owner_name, e.full_name),
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
        'customer_order_count', cs.order_count,
        'customer_lifetime_total', cs.lifetime_total,
        'customer_last_order_date', cs.last_order_date,
        'customer_last_order_number', cs.last_order_number,
        'customer_last_order_total', cs.last_order_total
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
      LEFT JOIN customer_stats cs ON cs.customer_id = o.customer_id
      WHERE o.customer_id = v_session.customer_id
        AND (p_status IS NULL OR o.status = p_status)
        AND (p_date_from IS NULL OR o.created_at >= p_date_from)
        AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    );
  END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

  RETURN (
    WITH customer_stats AS (
      SELECT
        customer_id,
        count(*)::bigint AS order_count,
        COALESCE(sum(total_amount), 0) AS lifetime_total,
        max(created_at) AS last_order_date,
        (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
        (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total
      FROM public.orders
      GROUP BY customer_id
    )
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
        'owner_name', COALESCE(o.snapshot_owner_name, e.full_name),
        'created_by', o.created_by,
        'created_by_name', COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, ''),
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'notes', o.notes,
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
        'created_by_type', oc_i.identity_type,
        'customer_display_address',
          COALESCE(
            NULLIF(concat_ws(' - ', ca.address_line1, ca.city, ca.governorate), ''),
            o.snapshot_customer_address
          ),
        'customer_order_count', cs.order_count,
        'customer_lifetime_total', cs.lifetime_total,
        'customer_last_order_date', cs.last_order_date,
        'customer_last_order_number', cs.last_order_number,
        'customer_last_order_total', cs.last_order_total
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
    LEFT JOIN customer_stats cs ON cs.customer_id = o.customer_id
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

COMMENT ON FUNCTION public.get_unified_orders IS 'قائمة موحدة للطلبات — مع customer_owner, created_by_name, customer_stats (v2)';

-- ============================================================================
-- 2. Update get_unified_order — add last_order_total to customer object
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_unified_order(p_token text, p_id uuid);
DROP FUNCTION IF EXISTS public.get_unified_order(p_token uuid, p_id uuid);

CREATE OR REPLACE FUNCTION public.get_unified_order(
  p_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token uuid := p_token::uuid;
  v_session app.sessions;
  v_order public.orders;
  v_visible uuid[];
  v_is_super boolean;
  v_customer_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_session.identity_type = 'customer' THEN
    IF v_order.customer_id != v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  ELSE
    v_is_super := public.is_upper_management(v_session.employee_id);
    IF NOT v_is_super THEN
      v_visible := COALESCE(public.get_visible_employee_ids(v_token), '{}'::uuid[]);
      IF NOT EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.id = v_order.customer_id AND c.owner_id = ANY(v_visible)
      ) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
  END IF;

  v_customer_id := v_order.customer_id;

  RETURN (
    WITH customer_stats AS (
      SELECT
        customer_id,
        count(*)::bigint AS order_count,
        COALESCE(sum(total_amount), 0) AS lifetime_total,
        max(created_at) AS last_order_date,
        (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
        (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total
      FROM public.orders
      GROUP BY customer_id
    )
    SELECT jsonb_build_object(
      'order', jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
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
        'effective_discount_percent', o.effective_discount_percent,
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
        'order_creator_type', oc_i.identity_type
      ),
      'customer', (
        SELECT jsonb_build_object(
          'id', c2.id,
          'code', c2.code,
          'company_name', c2.company_name,
          'phone', i.phone,
          'address_line1', ca.address_line1,
          'address_line2', ca.address_line2,
          'city', ca.city,
          'governorate', ca.governorate,
          'address_latitude', ca.latitude,
          'address_longitude', ca.longitude,
          'display_address',
            COALESCE(
              NULLIF(concat_ws(' - ', ca.address_line1, ca.city, ca.governorate), ''),
              v_order.snapshot_customer_address
            ),
          'order_count', cs.order_count,
          'lifetime_total', cs.lifetime_total,
          'last_order_date', cs.last_order_date,
          'last_order_number', cs.last_order_number,
          'last_order_total', cs.last_order_total
        )
        FROM public.customers c2
        LEFT JOIN public.identities i ON i.id = c2.identity_id
        LEFT JOIN public.customer_addresses ca ON ca.customer_id = c2.id AND ca.is_default = true
        LEFT JOIN customer_stats cs ON cs.customer_id = c2.id
        WHERE c2.id = v_customer_id
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
          'changed_at', osh.changed_at
        ) ORDER BY osh.changed_at)
        FROM public.order_status_history osh
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
          'reason', omh.reason,
          'modified_at', omh.modified_at
        ) ORDER BY omh.modified_at DESC)
        FROM public.order_modification_history omh
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
          'delivery_mode', o.delivery_mode,
          'assigned_to_name', ast.code,
          'external_carrier_name', ec.name,
          'updated_at', dt.updated_at
        )
        FROM public.delivery_tracking dt
        LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
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
          'external_carrier_name', ec.name
        ) ORDER BY dt.attempt_number)
        FROM public.delivery_tracking dt
        LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
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
$$;

COMMENT ON FUNCTION public.get_unified_order IS 'مصدر الحقيقة الموحد للطلب — مع customer_stats v2 و Signature واحد: (p_token text, p_id uuid)';
