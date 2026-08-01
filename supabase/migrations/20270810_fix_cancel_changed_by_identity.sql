-- ============================================================================
-- FIX-017 (2026-08-01) — governed_cancel_order: changed_by يجب أن يكون identity_id
--
-- المشكلة المعتمدة كخلل تنفيذي (Verified Defect — Severity High):
--   order_status_history.changed_by يحمل FK إلى identities(id)، لكن
--   governed_cancel_order كان يكتب v_session.employee_id (معرّف الموظف ليس
--   معرّف هوية) → فشل إلغاء أي طلب بواسطة جلسة موظف بـ FK 23503.
--
-- الإصلاح (سطر واحد فقط — لا تغيير في أي سلوك آخر):
--   v_employee_id := v_session.employee_id   →   v_employee_id := v_session.identity_id
--
-- التأكيد على عدم تغيير سلوك آخر: منطق الحجز (RESERVATION_RELEASE)، الاسترجاع،
-- تحديث الحالة، ومعاملة الأرصدة الائتمانية كما هي بدون أي تعديل.
-- المرجع: docs/08-FIXES-HISTORY/FIX_HISTORY.md (FIX-017)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_cancel_order(
  p_token text,
  p_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_customer_id uuid;
  v_total_amount decimal(12,2);
  v_payment_method varchar(20);
  v_restore_result jsonb;
  v_req_row record;
  v_reserved integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.identity_id;

  PERFORM check_capability(p_token, 'orders.cancel');

  SELECT status, customer_id, total_amount, payment_method
  INTO v_old_status, v_customer_id, v_total_amount, v_payment_method
  FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status IN ('cancelled', 'delivered', 'collected') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;

  -- تحرير الحجز عند الخروج من submitted (قبل الاسترجاع/تغيير الحالة).
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
          'reservation released on cancellation',
          v_reserved, 0, v_session.identity_id
        );
      END IF;
    END LOOP;
  END IF;

  v_restore_result := public.governed_inventory_restore(p_id);

  UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'cancelled', v_employee_id, p_reason, now());

  IF v_payment_method = 'credit' THEN
    UPDATE public.customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
