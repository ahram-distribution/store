-- Migration 0007: Phase B — Configurable inventory deduction threshold
-- No auto-reduce, always check stock, threshold-based deduct/restore.
-- Supersedes parts of 0006 (pre-Phase B function bodies).

-- 1. New helper: _is_deduction_eligible(p_status)
CREATE OR REPLACE FUNCTION public._is_deduction_eligible(p_status text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_threshold text;
  v_exec      text[] := ARRAY[
    'approved','preparing','prepared','ready_for_dispatch',
    'sent_to_delivery','dispatched','delivered'
  ];
  v_fwd       text[] := ARRAY[
    'draft','submitted','sales_manager_approved','reviewing',
    'returned_for_revision','approved','preparing','prepared',
    'ready_for_dispatch','sent_to_delivery','dispatched','deferred',
    'cancelled','delivered','stock_review'
  ];
  v_thr_idx   int;
  v_sts_idx   int;
  v_raw       text;
BEGIN
  SELECT value #>> '{value}' INTO v_raw
    FROM app.app_settings
   WHERE key = 'inventory_deduction_status';
  v_threshold := COALESCE(v_raw, 'approved');
  IF v_threshold <> ALL(v_exec) THEN
    v_threshold := 'approved';
  END IF;
  IF p_status <> ALL(v_exec) THEN
    RETURN false;
  END IF;
  v_thr_idx := array_position(v_fwd, v_threshold);
  v_sts_idx := array_position(v_fwd, p_status);
  IF v_thr_idx IS NULL THEN v_thr_idx := array_position(v_fwd, 'approved'); END IF;
  RETURN v_sts_idx >= v_thr_idx;
END;
$function$;

-- 2. Updated trigger: threshold-based deduct/restore
CREATE OR REPLACE FUNCTION public.enforce_execution_group_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_deduct_result jsonb;
BEGIN
  IF public._is_deduction_eligible(NEW.status)
     AND NOT public._is_deduction_eligible(OLD.status)
     AND OLD.inventory_deducted_at IS NULL THEN
    v_deduct_result := public.governed_inventory_deduct(OLD.id);
    IF (v_deduct_result->>'error') IS NOT NULL THEN
      RAISE EXCEPTION 'INVENTORY_DEDUCT_FAILED: %', (v_deduct_result->>'error');
    END IF;
  END IF;

  IF NOT public._is_deduction_eligible(NEW.status)
     AND OLD.inventory_deducted_at IS NOT NULL THEN
    PERFORM public.governed_inventory_restore(
      OLD.id,
      'ORDER_EXECUTION_EXIT_RESTORE',
      'تمت إعادة الكمية لأن الطلب غادر مرحلة الالتزام.'
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_inventory_on_execution_group_crossing ON public.orders;
CREATE TRIGGER trg_inventory_on_execution_group_crossing
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_execution_group_inventory();

-- 3. governed_preview_execution_entry: use threshold, always check stock
CREATE OR REPLACE FUNCTION public.governed_preview_execution_entry(
  p_token    text,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_order   record;
  v_has_approve boolean;
  v_has_manage boolean;
  v_plan    jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND');
  END IF;

  SELECT check_capability(p_token, 'orders.approve') INTO v_has_approve;
  SELECT check_capability(p_token, 'orders.manage') INTO v_has_manage;
  IF NOT (v_has_approve OR v_has_manage) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  IF public._is_deduction_eligible(v_order.status) OR v_order.inventory_deducted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'entering', false,
      'exempt', false,
      'adjustments', '[]'::jsonb
    );
  END IF;

  v_plan := public._plan_execution_entry_adjustments(p_order_id, false);

  RETURN jsonb_build_object(
    'entering', true,
    'exempt', false,
    'adjustments', v_plan
  );
END;
$function$;

-- 4. governed_approve_order (4-arg): always check stock, never auto-reduce
CREATE OR REPLACE FUNCTION public.governed_approve_order(
  p_token               text,
  p_id                  uuid,
  p_reason              text DEFAULT NULL::text,
  p_confirm_adjustments boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_order record;
  v_deduct_result jsonb;
  v_req_row record;
  v_reserved integer;
  v_adjust_plan jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.identity_id;

  PERFORM check_capability(p_token, 'orders.approve');

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  v_old_status := v_order.status;
  IF v_old_status NOT IN ('submitted', 'reviewing') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;

  v_adjust_plan := public._plan_execution_entry_adjustments(p_id, true);
  IF jsonb_array_length(v_adjust_plan) > 0 THEN
    IF p_confirm_adjustments THEN
      NULL;
    ELSE
      RETURN jsonb_build_object(
        'error', 'ADJUSTMENT_REQUIRED',
        'details', 'الكمية المطلوبة تتجاوز المخزون الفيزيائي المتاح. يرجى مراجعة مخزون الأصناف قبل الاعتماد.',
        'adjustments', v_adjust_plan
      );
    END IF;
  END IF;

  IF v_old_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_id
    LOOP
      v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_id);
      IF v_reserved > 0 THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_id, -v_reserved, 'RESERVATION_RELEASE',
          'تم اعتماد الفاتورة وتم تحرير حجز الكمية.',
          v_reserved, 0, v_employee_id
        );
      END IF;
    END LOOP;
  END IF;

  IF public._is_deduction_eligible('approved') THEN
    v_deduct_result := public.governed_inventory_deduct(p_id);
    IF (v_deduct_result->>'error') IS NOT NULL THEN
      RETURN v_deduct_result;
    END IF;
  END IF;

  UPDATE public.orders
  SET status = 'approved', approved_at = now(), updated_at = now()
  WHERE id = p_id AND status IN ('submitted', 'reviewing');

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'approved', v_employee_id, p_reason, now());

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 5. governed_change_order_status (6-arg): threshold-based, never auto-reduce
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
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1580)||chr(1575)||chr(1569)||' '||chr(1573)||chr(1583)||chr(1582)||chr(1575)||chr(1604)||' '||chr(1587)||chr(1576)||chr(1576)||' '||chr(1604)||chr(1604)||chr(1578)||chr(1594)||chr(1610)||chr(1585)||' '||chr(1575)||chr(1604)||chr(1575)||chr(1587)||chr(1578)||chr(1579)||chr(1606)||chr(1575)||chr(1574)||chr(1610));
  END IF;

  IF p_new_status = 'reviewing' THEN
    IF COALESCE(trim(v_reference_number), '') = '' THEN
      IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
        RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1602)||chr(1605)||' '||chr(1575)||chr(1604)||chr(1585)||chr(1602)||chr(1605)||' '||chr(1575)||chr(1580)||chr(1576)||chr(1575)||chr(1583)||chr(1610)||' '||chr(1593)||chr(1606)||chr(1583)||' '||chr(1575)||chr(1604)||chr(1578)||chr(1581)||chr(1608)||chr(1610)||chr(1604)||' '||chr(1573)||chr(1604)||chr(1609)||' '||chr(1580)||chr(1575)||chr(1585)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1585)||chr(1602)||chr(1577));
      END IF;
    END IF;
  END IF;

  IF public._is_deduction_eligible(p_new_status)
     AND NOT public._is_deduction_eligible(v_current_status) THEN
    v_adjust_plan := public._plan_execution_entry_adjustments(p_order_id, true);
    IF jsonb_array_length(v_adjust_plan) > 0 THEN
      IF p_confirm_adjustments THEN
        NULL;
      ELSE
        RETURN json_build_object(
          'success', false,
          'error', 'ADJUSTMENT_REQUIRED',
          'details', 'الكمية المطلوبة تتجاوز المخزون الفيزيائي المتاح. يرجى مراجعة مخزون الأصناف قبل الاعتماد.',
          'adjustments', v_adjust_plan
        );
      END IF;
    END IF;
  END IF;

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

  IF p_new_status != v_current_status THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

    IF public._is_deduction_eligible(p_new_status)
       AND NOT public._is_deduction_eligible(v_current_status)
       AND v_order.inventory_deducted_at IS NULL THEN
      v_deduct_result := public.governed_inventory_deduct(p_order_id);
      IF (v_deduct_result->>'error') IS NOT NULL THEN
        RETURN v_deduct_result::json;
      END IF;
    END IF;

    IF NOT public._is_deduction_eligible(p_new_status)
       AND v_order.inventory_deducted_at IS NOT NULL THEN
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
