-- ============================================================================
-- Migration 20270907: Reference Number Rule — "تم القيد بالسيستم" (reviewing)
--
-- BUSINESS RULE:
--   أي طلب يدخل حالة "تم القيد بالسيستم" (reviewing) من أي حالة سابقة يجب أن
--   يكون له رقم مرجعي:
--     - إذا كان للطلب رقم مرجعي بالفعل → لا يُطلب مرة أخرى ويُحفظ كما هو.
--     - إذا لم يوجد رقم مرجعي → يجب إدخاله قبل تغيير الحالة.
--   والرقم المرجعي يُخزَّن أيضًا داخل حدث تاريخ الحالة (order_status_history)
--   الخاص بالدخول إلى reviewing.
--
-- SCOPE:
--   1. إضافة عمود reference_number (nullable) إلى order_status_history.
--   2. تحديث governed_change_order_status:
--        - فرض القاعدة عند أي انتقال إلى reviewing (من أي حالة سابقة).
--        - حفظ الرقم المرجعي الفعلي (الجديد أو الموجود) في orders و history.
--   3. تحديث get_unified_order ليعيد reference_number ضمن status_history.
-- ============================================================================

-- ============================================================================
-- 1. order_status_history.reference_number (nullable)
-- ============================================================================
ALTER TABLE public.order_status_history
  ADD COLUMN IF NOT EXISTS reference_number text DEFAULT NULL;

COMMENT ON COLUMN public.order_status_history.reference_number
  IS 'الرقم المرجعي الفعلي للطلب عند دخوله حالة تم القيد بالسيستم (reviewing) — يخزَّن عند to_status = reviewing فقط';

-- ============================================================================
-- 2. governed_change_order_status — تطبيق القاعدة عند أي انتقال إلى reviewing
--    (نفس توقيع الدالة: p_token text, p_order_id uuid, p_new_status text,
--     p_reason text, p_reference_number text, p_confirm_adjustments boolean)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_change_order_status(
  p_token               text,
  p_order_id            uuid,
  p_new_status          text,
  p_reason              text DEFAULT NULL::text,
  p_reference_number    text DEFAULT NULL::text,
  p_confirm_adjustments boolean DEFAULT false
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_current_status text;
  v_customer_id uuid;
  v_total_amount decimal(12,2);
  v_payment_method varchar(20);
  v_reference_number text;
  v_from_idx int;
  v_to_idx int;
  v_required_capability text;
  v_has_capability boolean;
  v_is_exceptional boolean;
  v_order record;
  v_deduct_result jsonb;
  v_restore_result jsonb;
  v_req_row record;
  v_requested integer;
  v_capacity integer;
  v_reserved integer;
  v_notices jsonb := '[]'::jsonb;
  v_adjust_plan jsonb;
  v_neg boolean;
  v_deducted_at timestamptz;
  statuses text[] := ARRAY[
    'draft','submitted','sales_manager_approved','reviewing','returned_for_revision',
    'approved','preparing','prepared','ready_for_dispatch',
    'sent_to_delivery','dispatched','deferred','cancelled',
    'delivered','stock_review'
  ];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_SESSION');
  END IF;

  IF NOT (p_new_status = ANY(statuses)) THEN
    RETURN json_build_object('success', false, 'error', chr(1581)||chr(1575)||chr(1604)||chr(1577)||' '||chr(1593)||chr(1610)||chr(1585)||' '||chr(1589)||chr(1575)||chr(1604)||chr(1581)||chr(1577));
  END IF;

  SELECT status::text, customer_id, total_amount, payment_method, reference_number
  INTO v_current_status, v_customer_id, v_total_amount, v_payment_method, v_reference_number
  FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1591)||chr(1604)||chr(1576)||' '||chr(1593)||chr(1610)||chr(1585)||' '||chr(1605)||chr(1608)||chr(1580)||chr(1608)||chr(1583));
  END IF;

  IF v_current_status = p_new_status THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1591)||chr(1604)||chr(1576)||' '||chr(1576)||chr(1606)||chr(1601)||chr(1587)||' '||chr(1575)||chr(1604)||chr(1581)||chr(1575)||chr(1604)||chr(1577));
  END IF;

  v_from_idx := array_position(statuses, v_current_status);
  v_to_idx := array_position(statuses, p_new_status);

  SELECT check_capability(p_token, 'orders.manage') INTO v_has_capability;
  IF v_has_capability THEN
    v_required_capability := 'orders.manage';
  ELSE
    IF v_current_status = 'sales_manager_approved' AND p_new_status = 'reviewing' THEN
      v_required_capability := 'orders.review';
    ELSIF v_current_status IN ('submitted','sales_manager_approved','returned_for_revision','cancelled')
          AND p_new_status IN ('submitted','sales_manager_approved','returned_for_revision','cancelled')
          AND p_new_status <> v_current_status THEN
      v_required_capability := 'orders.approve';
    ELSIF v_current_status = 'approved' AND p_new_status = 'preparing' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF v_current_status = 'preparing' AND p_new_status = 'prepared' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF (v_current_status = 'prepared' OR v_current_status = 'ready_for_dispatch') AND p_new_status = 'sent_to_delivery' THEN
      v_required_capability := 'transportation.send_to_delivery';
    ELSE
      v_required_capability := 'orders.manage';
    END IF;
  END IF;

  SELECT check_capability(p_token, v_required_capability) INTO v_has_capability;
  IF NOT v_has_capability THEN
    RETURN json_build_object('success', false, 'error', chr(1604)||chr(1610)||chr(1587)||' '||chr(1604)||chr(1583)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1589)||chr(1604)||chr(1575)||chr(1581)||chr(1610)||chr(1577)||' '||chr(1604)||chr(1607)||chr(1584)||chr(1575)||' '||chr(1575)||chr(1604)||chr(1573)||chr(1580)||chr(1585)||chr(1575)||chr(1569));
  END IF;

  v_is_exceptional := false;
  IF v_current_status = 'cancelled' OR p_new_status = 'cancelled' THEN
    v_is_exceptional := true;
  ELSIF v_current_status = 'deferred' OR p_new_status = 'deferred' THEN
    v_is_exceptional := true;
  ELSIF v_to_idx < v_from_idx THEN
    v_is_exceptional := true;
  ELSIF v_to_idx > v_from_idx + 1 THEN
    v_is_exceptional := true;
  END IF;

  IF v_is_exceptional AND (p_reason IS NULL OR trim(p_reason) = '') THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1580)||chr(1575)||chr(1569)||' '||chr(1573)||chr(1583)||chr(1582)||chr(1575)||chr(1604)||' '||chr(1587)||chr(1576)||chr(1576)||' '||chr(1604)||chr(1604)||chr(1578)||chr(1593)||chr(1610)||chr(1585)||' '||chr(1575)||chr(1604)||chr(1575)||chr(1587)||chr(1578)||chr(1579)||chr(1606)||chr(1575)||chr(1574)||chr(1610));
  END IF;

  -- Reference number rule — mandatory when entering reviewing (from ANY previous
  -- status) UNLESS the order already carries a reference number.
  IF p_new_status = 'reviewing' THEN
    IF COALESCE(trim(v_reference_number), '') = '' THEN
      IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
        RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1602)||chr(1605)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1580)||chr(1593)||chr(1609)||' '||chr(1575)||chr(1580)||chr(1576)||chr(1575)||chr(1583)||chr(1610)||' '||chr(1593)||chr(1606)||chr(1583)||' '||chr(1575)||chr(1604)||chr(1578)||chr(1581)||chr(1608)||chr(1610)||chr(1604)||' '||chr(1573)||chr(1604)||chr(1609)||' '||chr(1580)||chr(1575)||chr(1585)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1575)||chr(1580)||chr(1593)||chr(1577));
      END IF;
    END IF;
  END IF;

  -- Execution Group Entry Finalization (القرارات 1..6):
  -- يُنفَّذ قبل تحرير الحجز حتى تعكس الكميات المُحرَّرة/المُبقاة الكمية القابلة للتنفيذ.
  IF p_new_status = ANY(public.execution_status_group())
     AND v_current_status <> ALL(public.execution_status_group()) THEN
    SELECT order_negative_selling_allowed, inventory_deducted_at
    INTO v_neg, v_deducted_at
    FROM public.orders WHERE id = p_order_id;

    IF v_deducted_at IS NULL AND NOT COALESCE(v_neg, true) THEN
      v_adjust_plan := public._plan_execution_entry_adjustments(p_order_id, true);
      IF jsonb_array_length(v_adjust_plan) > 0 THEN
        IF p_confirm_adjustments THEN
          PERFORM public._apply_execution_entry_adjustments(p_order_id, v_adjust_plan, v_session.identity_id);
        ELSE
          RETURN json_build_object(
            'success', false,
            'error', 'ADJUSTMENT_REQUIRED',
            'details', 'الكمية المطلوبة تتجاوز المخزون الفيزيائي المتاح. يلزم تأكيد التعديل قبل دخول مرحلة التنفيذ.',
            'adjustments', v_adjust_plan
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- Dynamic Reservation محرك حساب فقط — لا يُعدَّل order_items عند الاعتماد إطلاقًا.

  -- تحرير الحجز عند الخروج من submitted (قبل أي خصم/تغيير حالة).
  IF v_current_status = 'submitted' AND p_new_status <> 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      IF v_reserved > 0 THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, -v_reserved, 'RESERVATION_RELEASE',
          'تم تغيير حالة الفاتورة وتم تحرير حجز الكمية.',
          v_reserved, 0, v_session.identity_id
        );
      END IF;
    END LOOP;
  END IF;

  -- الدخول إلى submitted: تخصيص + إشعار عند تجاوز السعة المحدودة (لا رفض).
  IF p_new_status = 'submitted' AND v_current_status <> 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_requested := public._requested_quantity_for_order(v_req_row.product_id, p_order_id);
      v_reserved  := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      v_capacity  := public._reservation_capacity(v_req_row.product_id, p_order_id);

      IF v_reserved > 0 AND v_capacity IS NOT NULL THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_reserved, 'RESERVATION_ALLOCATE',
          'تم حجز الكمية لهذا الصنف.',
          0, v_reserved, v_session.identity_id
        );
      END IF;

      IF v_capacity IS NOT NULL AND v_requested > v_capacity THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_requested, 'RESERVATION_NOTICE',
          'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك.',
          0, v_requested, v_session.identity_id
        );
        v_notices := v_notices || jsonb_build_object(
          'product_id', v_req_row.product_id,
          'requested_quantity', v_requested,
          'available_capacity', v_capacity
        );
      END IF;
    END LOOP;
  END IF;

  -- Inventory management (Execution State Group)
  IF p_new_status != v_current_status THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

    -- Case 1: Entering the Execution State Group → deduct exactly once.
    IF p_new_status = ANY(public.execution_status_group())
       AND v_current_status <> ALL(public.execution_status_group())
       AND v_order.inventory_deducted_at IS NULL THEN
      v_deduct_result := public.governed_inventory_deduct(p_order_id);
      IF (v_deduct_result->>'error') IS NOT NULL THEN
        RETURN v_deduct_result::json;
      END IF;
    END IF;

    -- Case 2: Leaving the Execution State Group via cancellation → restore.
    IF p_new_status = 'cancelled' THEN
      v_restore_result := public.governed_inventory_restore(p_order_id);
    END IF;
  END IF;

  UPDATE orders SET
    status = p_new_status,
    reference_number = CASE
      WHEN p_new_status = 'reviewing'
        THEN COALESCE(NULLIF(trim(p_reference_number), ''), v_reference_number)
      ELSE reference_number
    END,
    delivered_at = CASE WHEN p_new_status = 'delivered' THEN now() ELSE delivered_at END,
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at, reference_number)
  VALUES (
    p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, now(),
    CASE
      WHEN p_new_status = 'reviewing'
        THEN COALESCE(NULLIF(trim(p_reference_number), ''), v_reference_number)
      ELSE NULL
    END
  );

  IF p_new_status = 'cancelled' AND v_payment_method = 'credit' THEN
    UPDATE customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'from_status', v_current_status,
    'to_status', p_new_status,
    'reservations_notice', v_notices
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.governed_change_order_status(text, uuid, text, text, text, boolean) TO PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- 3. get_unified_order — إعادة reference_number ضمن status_history
--    (نفس التعريف الحالي 20270825 مع إضافة حقل واحد في status_history)
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_unified_order(text, uuid);

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
  v_session app.sessions;
  v_employee_id uuid;
  v_is_upper boolean;
  v_visible uuid[];
  v_order public.orders%ROWTYPE;
  v_customer_id uuid;
  v_allowed boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_session.identity_type = 'customer' THEN
    IF v_order.customer_id != v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  ELSE
    v_employee_id := v_session.employee_id;
    v_is_upper := public.is_upper_management(v_employee_id);
    IF NOT v_is_upper THEN
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
$$;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
