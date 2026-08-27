-- ============================================================================
-- 20270930_sales_roles_no_status_mutation.sql
--
-- PURPOSE: Enforce the business rule that BOTH the Sales Manager (مدير البيع)
-- and the Sales Representative (مندوب مبيعات) roles have ZERO order-status
-- mutation authority, in the UI and on the backend.
--
--   1. governed_approve_order: replace the discarded `PERFORM check_capability`
--      (result never read → any valid session could approve) with an enforced
--      capability gate on BOTH overloads.
--   2. Revoke `orders.approve` from the Sales Manager role (granted by
--      20270902_sales_manager_approved_status.sql and never revoked). This was
--      the only status-mutation capability held by either role; Sales Reps
--      never had any. Both roles keep `orders.create`/`orders.read`, which the
--      returned_for_revision → تعديل الطلب (content edit + resubmit) flow
--      needs via governed_submit_order.
--
-- All statements are idempotent / additive-safe.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1a. governed_approve_order — full overload (p_confirm_adjustments)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_approve_order(
  p_token text,
  p_id uuid,
  p_reason text DEFAULT NULL::text,
  p_confirm_adjustments boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $fn$
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

  IF NOT public.check_capability(p_token, 'orders.approve') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

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
$fn$;

-- ---------------------------------------------------------------------------
-- 1b. governed_approve_order — short overload (no p_confirm_adjustments)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_approve_order(
  p_token text,
  p_id uuid,
  p_reason text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $fn$
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

  IF NOT public.check_capability(p_token, 'orders.approve') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  v_old_status := v_order.status;
  IF v_old_status NOT IN ('submitted', 'reviewing') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;

  -- Dynamic Reservation engine computes only — order_items is never modified
  -- at approval (the quantity is deducted exactly as the user submitted it).
  -- Reservations are released as soon as the order leaves 'submitted'.
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
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Revoke orders.approve from the Sales Manager role (مدير البيع).
--    Safe DELETE — idempotent.
-- ---------------------------------------------------------------------------
DELETE FROM public.role_capabilities
WHERE role_id = (SELECT id FROM public.roles WHERE name = 'مدير البيع')
  AND capability_id = (SELECT id FROM public.capabilities WHERE code = 'orders.approve');

-- ---------------------------------------------------------------------------
-- 3. Defensive: ensure no direct employee grants of status-mutation codes on
--    any Sales Manager / Sales Representative employee (none observed).
-- ---------------------------------------------------------------------------
DELETE FROM public.employee_capabilities
WHERE capability_id IN (
    SELECT id FROM public.capabilities
    WHERE code IN ('orders.manage','orders.review','orders.approve','orders.cancel','orders.prepare','orders.dispatch')
  )
  AND employee_id IN (
    SELECT er.employee_id
    FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE r.name IN ('مدير البيع','مندوب مبيعات')
  );