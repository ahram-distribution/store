-- ============================================================================
-- Sales Manager Approved (موافقة مدير البيع) — new order status
-- Inserted immediately after Submitted.
--
-- Workflow: Submitted → Sales Manager Approved → Reviewing → (Returned for
-- Revision) → Approved → existing workflow unchanged.
--
-- Business rules:
--   • Sales Manager (مدير البيع) may ONLY do, while the order is Submitted:
--       submitted → sales_manager_approved  (orders.approve)
--       submitted → returned_for_revision   (orders.approve)
--       submitted → cancelled               (orders.approve)
--   • Review responsibility unchanged: the reviewer moves
--       sales_manager_approved → reviewing  (orders.review)
--     (was: submitted → reviewing).
-- ============================================================================

-- 1. Include the new status in the orders.status CHECK constraint
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS ck_orders_status;

ALTER TABLE public.orders
  ADD CONSTRAINT ck_orders_status
  CHECK (status IN (
    'draft', 'submitted', 'sales_manager_approved', 'reviewing', 'returned_for_revision',
    'approved', 'preparing', 'prepared', 'ready_for_dispatch',
    'sent_to_delivery', 'dispatched', 'deferred', 'cancelled',
    'delivered', 'stock_review'
  ));

-- 2. Include the new status in the order_status_history CHECK constraints
ALTER TABLE public.order_status_history
  DROP CONSTRAINT IF EXISTS ck_order_status_from;

ALTER TABLE public.order_status_history
  ADD CONSTRAINT ck_order_status_from
  CHECK (from_status IN (
    'draft', 'submitted', 'sales_manager_approved', 'reviewing', 'returned_for_revision',
    'approved', 'preparing', 'prepared', 'ready_for_dispatch',
    'sent_to_delivery', 'dispatched', 'deferred', 'cancelled',
    'delivered', 'stock_review'
  ) OR from_status IS NULL);

ALTER TABLE public.order_status_history
  DROP CONSTRAINT IF EXISTS ck_order_status_to;

ALTER TABLE public.order_status_history
  ADD CONSTRAINT ck_order_status_to
  CHECK (to_status IN (
    'draft', 'submitted', 'sales_manager_approved', 'reviewing', 'returned_for_revision',
    'approved', 'preparing', 'prepared', 'ready_for_dispatch',
    'sent_to_delivery', 'dispatched', 'deferred', 'cancelled',
    'delivered', 'stock_review'
  ));

-- ============================================================================
-- 3. governed_change_order_status — add the new status to the transition
--    engine, extend the Sales Manager's three Submitted actions, and move the
--    review edge from (submitted → reviewing) to (sales_manager_approved → reviewing).
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
    RETURN json_build_object('success', false, 'error', chr(1581)||chr(1575)||chr(1604)||chr(1577)||' '||chr(1594)||chr(1610)||chr(1585)||' '||chr(1589)||chr(1575)||chr(1604)||chr(1581)||chr(1577));
  END IF;

  SELECT status::text, customer_id, total_amount, payment_method
  INTO v_current_status, v_customer_id, v_total_amount, v_payment_method
  FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1591)||chr(1604)||chr(1576)||' '||chr(1594)||chr(1610)||chr(1585)||' '||chr(1605)||chr(1608)||chr(1580)||chr(1608)||chr(1583));
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
    ELSIF v_current_status = 'submitted' AND p_new_status IN ('sales_manager_approved','returned_for_revision','cancelled') THEN
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
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1580)||chr(1575)||chr(1569)||' '||chr(1573)||chr(1583)||chr(1582)||chr(1575)||chr(1604)||' '||chr(1587)||chr(1576)||chr(1576)||' '||chr(1604)||chr(1604)||chr(1578)||chr(1594)||chr(1610)||chr(1585)||' '||chr(1575)||chr(1604)||chr(1575)||chr(1587)||chr(1578)||chr(1579)||chr(1606)||chr(1575)||chr(1574)||chr(1610));
  END IF;

  IF v_current_status = 'sales_manager_approved' AND p_new_status = 'reviewing' THEN
    IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
      RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1602)||chr(1605)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1580)||chr(1593)||chr(1609)||' '||chr(1575)||chr(1580)||chr(1576)||chr(1575)||chr(1583)||chr(1610)||' '||chr(1593)||chr(1606)||chr(1583)||' '||chr(1575)||chr(1604)||chr(1578)||chr(1581)||chr(1608)||chr(1610)||chr(1604)||' '||chr(1573)||chr(1604)||chr(1609)||' '||chr(1580)||chr(1575)||chr(1585)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1575)||chr(1580)||chr(1593)||chr(1577));
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
      WHEN v_current_status = 'sales_manager_approved' AND p_new_status = 'reviewing' THEN trim(p_reference_number)
      ELSE reference_number
    END,
    delivered_at = CASE WHEN p_new_status = 'delivered' THEN now() ELSE delivered_at END,
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, now());

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
-- END OF MIGRATION
-- ============================================================================
