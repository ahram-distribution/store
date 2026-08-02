-- ============================================================================
-- PHASE A — PHYSICAL INVENTORY ENGINE (Execution State Group)
-- ============================================================================
-- Frozen Business Contract (approved refinement):
--   • Inventory follows the EXECUTION lifecycle, not a single status name.
--   • Execution States (extensible group — add future execution statuses here):
--       approved, preparing, prepared, ready_for_dispatch, sent_to_delivery,
--       dispatched, delivered
--   • deferred is NOT an execution state: any execution state → deferred
--     restores inventory.
--   • Entering the group      → deduct exactly once.
--   • Leaving the group       → restore exactly once.
--   • Inside the group        → no inventory movement.
--   • Outside the group       → no inventory movement.
--   • The per-order single "deduction status"
--     (order_inventory_deduction_status) is removed from the decision logic.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Execution State Group — single source of truth (extensible).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execution_status_group()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['approved','preparing','prepared','ready_for_dispatch','sent_to_delivery','dispatched','delivered']::text[];
$$;

-- ---------------------------------------------------------------------------
-- 2) Group-crossing status trigger (deduct on entry, restore on exit).
--    Supersedes the previous approved-only restore trigger.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_restore_inventory_before_approved_order_exit ON public.orders;
DROP FUNCTION IF EXISTS public.restore_inventory_before_approved_order_exit();

CREATE OR REPLACE FUNCTION public.enforce_execution_group_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_deduct_result jsonb;
BEGIN
  -- Entering the Execution State Group → deduct exactly once.
  IF NEW.status = ANY(public.execution_status_group())
     AND OLD.status <> ALL(public.execution_status_group())
     AND OLD.inventory_deducted_at IS NULL THEN
    v_deduct_result := public.governed_inventory_deduct(OLD.id);
    IF (v_deduct_result->>'error') IS NOT NULL THEN
      RAISE EXCEPTION 'INVENTORY_DEDUCT_FAILED: %', (v_deduct_result->>'error');
    END IF;
  END IF;

  -- Leaving the Execution State Group → restore exactly once.
  IF OLD.status = ANY(public.execution_status_group())
     AND NEW.status <> ALL(public.execution_status_group())
     AND OLD.inventory_deducted_at IS NOT NULL THEN
    PERFORM public.governed_inventory_restore(
      OLD.id,
      'ORDER_EXECUTION_EXIT_RESTORE',
      'تمت إعادة الكمية لأن الطلب غادر مرحلة التنفيذ.'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_inventory_on_execution_group_crossing
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_execution_group_inventory();

-- ---------------------------------------------------------------------------
-- 3) governed_approve_order — deduct on group entry; drop the single-status
--    deduction-status gate (approve always crosses into the group).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_approve_order(p_token text, p_id uuid, p_reason text DEFAULT NULL::text)
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

  -- Dynamic Reservation محرك حساب فقط — لا يُعدَّل order_items إطلاقًا عند الاعتماد
  -- (تُخصم الكمية كما قدمها المستخدم بالضبط). تحرير الحجز عند الخروج من submitted.
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

  -- Entering the Execution State Group → deduct exactly once.
  v_deduct_result := public.governed_inventory_deduct(p_id);
  IF (v_deduct_result->>'error') IS NOT NULL THEN
    RETURN v_deduct_result;
  END IF;

  UPDATE public.orders
  SET status = 'approved', approved_at = now(), updated_at = now()
  WHERE id = p_id AND status IN ('submitted', 'reviewing');

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'approved', v_employee_id, p_reason, now());

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) governed_change_order_status — deduct on group entry, restore on exit
--    (cancelled), instead of the single deduction-status gate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_change_order_status(p_token text, p_order_id uuid, p_new_status text, p_reason text DEFAULT NULL::text, p_reference_number text DEFAULT NULL::text)
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
  statuses text[] := ARRAY[
    'draft','submitted','reviewing','returned_for_revision',
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
    IF v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN
      v_required_capability := 'orders.review';
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

  IF v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN
    IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
      RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1602)||chr(1605)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1580)||chr(1593)||chr(1609)||' '||chr(1575)||chr(1580)||chr(1576)||chr(1575)||chr(1583)||chr(1610)||' '||chr(1593)||chr(1606)||chr(1583)||' '||chr(1575)||chr(1604)||chr(1578)||chr(1581)||chr(1608)||chr(1610)||chr(1604)||' '||chr(1573)||chr(1604)||chr(1609)||' '||chr(1580)||chr(1575)||chr(1585)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1575)||chr(1580)||chr(1593)||chr(1577));
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
      WHEN v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN trim(p_reference_number)
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

-- ---------------------------------------------------------------------------
-- 5) governed_supreme_edit_order — decide by Execution State Group membership
--    instead of the single deduction status.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_supreme_edit_order(p_token text, p_order_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text, p_discount_amount numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_order_type character varying DEFAULT NULL::character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_items jsonb;
  v_new_items jsonb;
  v_item jsonb;
  v_product record;
  v_subtotal decimal(12,2);
  v_discount_amount decimal(12,2);
  v_total decimal(12,2);
  v_is_super boolean;
  v_order_status text;
  v_was_deducted boolean;
  v_old_res_map jsonb := '{}'::jsonb;
  v_restore_map jsonb := '{}'::jsonb;
  v_req_row record;
  v_restore_item jsonb;
  v_requested integer;
  v_capacity integer;
  v_available integer;
  v_prev integer;
  v_new integer;
  v_key text;
  v_actor_id uuid;
  v_restore_result jsonb;
  v_deduct_result jsonb;
  v_notices jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_is_super := public.is_supreme_management(v_session.employee_id);
  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Only Supreme Management can edit orders');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_actor_id := v_session.identity_id;
  v_order_status := v_order.status;
  v_was_deducted := v_order.inventory_deducted_at IS NOT NULL;

  -- خريطة الحجز القديم لكل منتج (النموذج المشتق — قبل أي تغيير).
  IF v_order_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_old_res_map := v_old_res_map || jsonb_build_object(
        v_req_row.product_id::text,
        public._reserved_quantity_for_order(v_req_row.product_id, p_order_id)
      );
    END LOOP;
  END IF;

  -- خريطة المبالغ المستردة من الخصم السابق (للتحقق المسبق من الرصيد بعد الاسترجاع).
  IF v_was_deducted THEN
    FOR v_restore_item IN SELECT * FROM jsonb_array_elements(v_order.inventory_deducted_items)
    LOOP
      v_restore_map := v_restore_map || jsonb_build_object(
        v_restore_item->>'product_id',
        COALESCE((v_restore_item->>'piece_quantity')::integer, 0)
      );
    END LOOP;
  END IF;

  -- تحقق مسبق من الرصيد لطلب محسوم سيُعاد خصمه بعد الاسترجاع (يماثل فحص الخصم الفعلي).
  IF v_was_deducted AND v_order_status = ANY(public.execution_status_group()) THEN
    FOR v_req_row IN
      SELECT vi.product_id, SUM(vi.req)::integer AS total_requested FROM (
        SELECT (vi->>'product_id')::uuid AS product_id,
               public._to_pieces(
                 vi->>'unit_type',
                 GREATEST(COALESCE((vi->>'unit_quantity')::integer, 1), 1),
                 pr.carton_quantity
               ) AS req
        FROM jsonb_array_elements(p_items) vi
        LEFT JOIN public.products pr ON pr.id = (vi->>'product_id')::uuid
      ) vi
      WHERE vi.product_id IS NOT NULL
      GROUP BY vi.product_id
    LOOP
      SELECT quantity INTO v_available
      FROM public.inventory
      WHERE product_id = v_req_row.product_id;

      IF NOT FOUND THEN v_available := 0; END IF;

      v_available := v_available
        + COALESCE((v_restore_map->>v_req_row.product_id::text)::integer, 0);

      IF v_available < v_req_row.total_requested THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'INSUFFICIENT_STOCK',
          'shortages', jsonb_build_array(jsonb_build_object(
            'product_id', v_req_row.product_id,
            'requested_quantity', v_req_row.total_requested,
            'available_quantity', v_available
          ))
        );
      END IF;
    END LOOP;
  END IF;

  -- طلب في submitted مع تجاوز سعة الحجز عند زيادة المحتوى: إشعار فقط (لا رفض — BR-RS-03/05).
  IF v_order_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT vi.product_id, SUM(vi.req)::integer AS total_requested FROM (
        SELECT (vi->>'product_id')::uuid AS product_id,
               public._to_pieces(
                 vi->>'unit_type',
                 GREATEST(COALESCE((vi->>'unit_quantity')::integer, 1), 1),
                 pr.carton_quantity
               ) AS req
        FROM jsonb_array_elements(p_items) vi
        LEFT JOIN public.products pr ON pr.id = (vi->>'product_id')::uuid
      ) vi
      WHERE vi.product_id IS NOT NULL
      GROUP BY vi.product_id
    LOOP
      v_capacity := public._reservation_capacity(v_req_row.product_id, p_order_id);
      IF v_capacity IS NOT NULL AND v_req_row.total_requested > v_capacity THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_req_row.total_requested, 'RESERVATION_NOTICE',
          'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك.',
          COALESCE((v_old_res_map->>v_req_row.product_id::text)::integer, 0),
          v_req_row.total_requested,
          v_actor_id
        );
        v_notices := v_notices || jsonb_build_object(
          'product_id', v_req_row.product_id,
          'requested_quantity', v_req_row.total_requested,
          'available_capacity', v_capacity
        );
      END IF;
    END LOOP;
  END IF;

  -- استرجاع الخصم القديم قبل استبدال المحتوى.
  IF v_was_deducted THEN
    v_restore_result := public.governed_inventory_restore(
      p_order_id, 'ORDER_EDIT_RESTORE', COALESCE(p_reason, 'Supreme Management edit')
    );
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price
    )
  ) INTO v_old_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;

  DELETE FROM public.order_items WHERE order_id = p_order_id;

  v_subtotal := 0;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, carton_price, carton_quantity INTO v_product
    FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND', 'detail', 'Product ' || (v_item->>'product_id'));
    END IF;

    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (
      p_order_id, (v_item->>'product_id')::uuid, v_item->>'unit_type',
      (v_item->>'unit_quantity')::int, COALESCE((v_item->>'piece_quantity')::int, 0),
      COALESCE((v_item->>'unit_price')::numeric, 0), COALESCE((v_item->>'total_price')::numeric, 0)
    );

    v_subtotal := v_subtotal + COALESCE((v_item->>'total_price')::numeric, 0);
  END LOOP;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price
    )
  ) INTO v_new_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;

  -- أحداث RESERVATION_UPDATE لطلب في submitted (لم يُعَد خصمه في نفس العملية).
  IF v_order_status = 'submitted'
     AND NOT (v_was_deducted AND v_order_status = ANY(public.execution_status_group())) THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_new := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      v_prev := COALESCE((v_old_res_map->>v_req_row.product_id::text)::integer, 0);
      IF v_prev <> v_new THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_new - v_prev, 'RESERVATION_UPDATE',
          'تم تعديل كمية الحجز بعد تعديل الفاتورة.',
          v_prev, v_new, v_actor_id
        );
      END IF;
    END LOOP;

    -- منتجات أُزيلت من الطلب: حجزها القديم يتلاشى (previous → 0).
    FOR v_key IN SELECT key FROM jsonb_object_keys(v_old_res_map)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.order_items
        WHERE order_id = p_order_id AND product_id = v_key::uuid
      ) THEN
        v_prev := (v_old_res_map->>v_key)::integer;
        IF v_prev > 0 THEN
          INSERT INTO public.inventory_movements
            (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
          VALUES (
            v_key::uuid, p_order_id, -v_prev, 'RESERVATION_UPDATE',
            'تم تحرير حجز الصنف المحذوف من الفاتورة.',
            v_prev, 0, v_actor_id
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- إعادة خصم المحتوى الجديد إن كان الطلب داخل مرحلة التنفيذ.
  IF v_was_deducted AND v_order_status = ANY(public.execution_status_group()) THEN
    v_deduct_result := public.governed_inventory_deduct(p_order_id);
    IF (v_deduct_result->>'error') IS NOT NULL THEN
      RETURN v_deduct_result;
    END IF;
  END IF;

  v_subtotal := COALESCE(v_subtotal, 0);
  v_discount_amount := COALESCE(p_discount_amount, 0);
  v_total := GREATEST(v_subtotal - v_discount_amount, 0);

  UPDATE public.orders SET
    subtotal = v_subtotal, discount_amount = v_discount_amount, tax_amount = 0,
    total_amount = v_total, notes = COALESCE(p_notes, notes),
    order_type = COALESCE(p_order_type, order_type),
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, new_order_items, modified_by, reason, modified_at
  ) VALUES (
    p_order_id, v_order.revision_number, 'supreme_edit',
    jsonb_build_object('subtotal', v_order.subtotal, 'discount_amount', v_order.discount_amount, 'total_amount', v_order.total_amount, 'notes', v_order.notes)::text,
    jsonb_build_object('subtotal', v_subtotal, 'discount_amount', v_discount_amount, 'total_amount', v_total, 'notes', COALESCE(p_notes, v_order.notes))::text,
    v_old_items, v_new_items, v_session.identity_id, COALESCE(p_reason, 'Supreme Management edit'), now()
  );

  RETURN jsonb_build_object(
    'success', true, 'order_id', p_order_id,
    'item_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = p_order_id),
    'subtotal', v_subtotal, 'discount_amount', v_discount_amount, 'total_amount', v_total,
    'reservations_notice', v_notices
  );
END;
$function$;
