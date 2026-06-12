-- ============================================================================
-- CREDIT LIFECYCLE WIRING — Phase 2
-- Wires the 3 orphaned credit RPCs into the order lifecycle:
--   1. Reserve credit on order submission
--   2. Convert reservation → outstanding on delivery
--   3. Release reservation on cancellation/rejection/deletion
--
-- No new tables, no new columns, no schema redesign.
-- Uses existing entities: orders.payment_method, customer_credit_accounts,
-- credit_invoices, customer_credit_ledger
-- ============================================================================

-- ============================================================================
-- 1. governed_reserve_credit_for_order
--    * Accept 'submitted' status (was: 'draft' only)
--    * Soft-check over-limit: return over_limit flag instead of hard error
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_reserve_credit_for_order(uuid, uuid);

CREATE OR REPLACE FUNCTION public.governed_reserve_credit_for_order(
  p_token uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_account public.customer_credit_accounts;
  v_available decimal;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_order.status NOT IN ('draft', 'submitted') THEN RETURN jsonb_build_object('error', 'INVALID_STATUS'); END IF;

  SELECT * INTO v_account FROM public.customer_credit_accounts
  WHERE customer_id = v_order.customer_id AND credit_status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_ACTIVE_CREDIT'); END IF;

  v_available := v_account.credit_limit - v_account.outstanding_credit - v_account.reserved_credit;

  -- Soft-check: if over limit, still set payment_method and flag for UM review
  IF v_order.total_amount > v_available THEN
    UPDATE public.orders SET payment_method = 'credit' WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'over_limit', true, 'available', v_available, 'required', v_order.total_amount);
  END IF;

  UPDATE public.customer_credit_accounts SET
    reserved_credit = reserved_credit + v_order.total_amount,
    updated_at = now()
  WHERE id = v_account.id;

  UPDATE public.orders SET payment_method = 'credit' WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'reserved', v_order.total_amount);
END;
$$;

COMMENT ON FUNCTION public.governed_reserve_credit_for_order IS 'حجز رصيد ائتماني للطلب (يقبل draft و submitted، لا يمنع عند تجاوز الحد)';

-- ============================================================================
-- 2. governed_complete_delivery
--    * After delivery, convert credit reservation → outstanding + create invoice
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_complete_delivery(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.governed_complete_delivery(p_token uuid, p_delivery_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session app.sessions;
  v_dt public.delivery_tracking;
  v_order public.orders;
  v_invoice_id uuid;
  v_invoice_num varchar(50);
  v_due_date date;
  v_account public.customer_credit_accounts;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;

  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_dt.status NOT IN ('out_for_delivery','assigned') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.delivery_tracking SET status = 'delivered', completed_at = now(), notes = COALESCE(p_notes, notes), updated_at = now() WHERE id = p_delivery_id RETURNING * INTO v_dt;
  UPDATE public.orders SET status = 'delivered', delivered_at = now(), updated_at = now() WHERE id = v_dt.order_id RETURNING * INTO v_order;

  -- If credit order, convert reservation to outstanding and create invoice
  IF v_order.payment_method = 'credit' THEN
    SELECT * INTO v_account FROM public.customer_credit_accounts
    WHERE customer_id = v_order.customer_id AND credit_status = 'active';
    IF FOUND THEN
      UPDATE public.customer_credit_accounts SET
        reserved_credit = GREATEST(0, reserved_credit - v_order.total_amount),
        outstanding_credit = outstanding_credit + v_order.total_amount,
        updated_at = now()
      WHERE id = v_account.id;

      v_invoice_num := 'CI-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || COALESCE((SELECT MAX(SUBSTRING(invoice_number FROM '\d+$'))::int + 1 FROM public.credit_invoices WHERE invoice_number LIKE 'CI-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-%'), 1);
      v_due_date := CURRENT_DATE + v_account.payment_term_days;

      INSERT INTO public.credit_invoices (invoice_number, customer_id, order_id, invoice_amount, issue_date, due_date, status)
      VALUES (v_invoice_num, v_order.customer_id, v_dt.order_id, v_order.total_amount, CURRENT_DATE, v_due_date, 'open')
      RETURNING id INTO v_invoice_id;

      INSERT INTO public.customer_credit_ledger (customer_id, transaction_type, amount, running_balance, reference_type, reference_id, notes, created_by)
      SELECT v_order.customer_id, 'debit', v_order.total_amount,
        (SELECT outstanding_credit FROM public.customer_credit_accounts WHERE customer_id = v_order.customer_id),
        'credit_invoice', v_invoice_id, 'تحويل طلب رقم ' || v_order.order_number || ' إلى فاتورة ائتمان', v_session.employee_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('delivery_status', 'delivered', 'order_status', v_order.status, 'delivered_at', v_order.delivered_at);
END;
$function$;

-- ============================================================================
-- 3. governed_cancel_order
--    * Release credit reservation on cancellation
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_cancel_order(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.governed_cancel_order(
  p_token uuid,
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;

  PERFORM check_capability(p_token, 'orders.cancel');

  SELECT status, customer_id, total_amount, payment_method INTO v_old_status, v_customer_id, v_total_amount, v_payment_method FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status IN ('cancelled', 'delivered', 'collected') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;

  UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'cancelled', v_employee_id, p_reason, now());

  -- Release credit reservation if credit order
  IF v_payment_method = 'credit' THEN
    UPDATE public.customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 4. governed_change_order_status
--    * Release credit reservation when transitioning to cancelled
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_change_order_status(text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.governed_change_order_status(p_token text, p_order_id uuid, p_new_status text, p_reason text DEFAULT NULL::text)
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
  statuses text[] := ARRAY['draft','submitted','reviewing','returned_for_revision','approved','preparing','prepared','ready_for_dispatch','sent_to_delivery','dispatched','deferred','cancelled','delivered'];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_SESSION');
  END IF;

  IF NOT (p_new_status = ANY(statuses)) THEN
    RETURN json_build_object('success', false, 'error', 'حالة غير صالحة');
  END IF;

  SELECT status::text, customer_id, total_amount, payment_method INTO v_current_status, v_customer_id, v_total_amount, v_payment_method FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'الطلب غير موجود');
  END IF;

  IF v_current_status = p_new_status THEN
    RETURN json_build_object('success', false, 'error', 'الطلب بنفس الحالة');
  END IF;

  v_from_idx := array_position(statuses, v_current_status);
  v_to_idx := array_position(statuses, p_new_status);

  SELECT check_capability(p_token::uuid, 'orders.manage') INTO v_has_capability;
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

  SELECT check_capability(p_token::uuid, v_required_capability) INTO v_has_capability;
  IF NOT v_has_capability THEN
    RETURN json_build_object('success', false, 'error', 'ليس لديك الصلاحية لهذا الإجراء');
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
    RETURN json_build_object('success', false, 'error', 'الرجاء إدخال سبب للتغيير الاستثنائي');
  END IF;

  UPDATE orders SET status = p_new_status, updated_at = now() WHERE id = p_order_id;

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, now());

  -- Release credit reservation when cancelling a credit order
  IF p_new_status = 'cancelled' AND v_payment_method = 'credit' THEN
    UPDATE customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  RETURN json_build_object('success', true, 'from_status', v_current_status, 'to_status', p_new_status);
END;
$function$;

-- ============================================================================
-- 5. governed_dispatch_decision (cancel action)
--    * Release credit reservation on dispatch cancellation
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_dispatch_decision(uuid, uuid, text, uuid, text, timestamptz);

CREATE OR REPLACE FUNCTION public.governed_dispatch_decision(p_token uuid, p_id uuid, p_action text, p_assigned_to uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_follow_up_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_session app.sessions; v_order public.orders; v_emp_code text; v_authorized boolean; v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  SELECT code INTO v_emp_code FROM public.employees WHERE id = v_session.employee_id;
  v_authorized := EXISTS (SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN','EXECUTIVE_MANAGER','Sales Manager'));
  IF NOT v_authorized THEN RETURN json_build_object('error', 'FORBIDDEN', 'detail', 'Only Sales Manager and higher can make dispatch decisions'); END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'NOT_FOUND'); END IF;
  IF v_order.status != 'ready_for_dispatch' THEN RETURN json_build_object('error', 'INVALID_STATE', 'detail', 'Order must be in ready_for_dispatch status'); END IF;
  IF p_action = 'send' THEN
    IF p_assigned_to IS NULL THEN RETURN json_build_object('error', 'MISSING_ASSIGNEE', 'detail', 'A delivery employee must be assigned'); END IF;
    UPDATE public.orders SET status = 'sent_to_delivery', updated_at = now() WHERE id = p_id;
    INSERT INTO public.delivery_tracking (order_id, status, assigned_to, assigned_by, assigned_at) VALUES (p_id, 'assigned', p_assigned_to, v_session.employee_id, now()) RETURNING * INTO v_dt;
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, 'ready_for_dispatch', 'sent_to_delivery', v_session.identity_id, COALESCE(p_reason, 'Sent to delivery'));
    RETURN json_build_object('action', 'sent_to_delivery', 'order_status', 'sent_to_delivery', 'delivery_id', v_dt.id);
  ELSIF p_action = 'defer' THEN
    IF p_follow_up_date IS NULL THEN RETURN json_build_object('error', 'MISSING_FOLLOW_UP', 'detail', 'Follow-up date is required for deferral'); END IF;
    UPDATE public.orders SET status = 'deferred', deferred_until = p_follow_up_date, defer_reason = p_reason, updated_at = now() WHERE id = p_id;
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, 'ready_for_dispatch', 'deferred', v_session.identity_id, COALESCE(p_reason, 'Order deferred'));
    RETURN json_build_object('action', 'deferred', 'order_status', 'deferred', 'deferred_until', p_follow_up_date);
  ELSIF p_action = 'cancel' THEN
    IF p_reason IS NULL THEN RETURN json_build_object('error', 'MISSING_REASON', 'detail', 'Cancellation reason is required'); END IF;
    UPDATE public.orders SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, updated_at = now() WHERE id = p_id;
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, 'ready_for_dispatch', 'cancelled', v_session.identity_id, p_reason);
    -- Release credit reservation if credit order
    IF v_order.payment_method = 'credit' THEN
      UPDATE public.customer_credit_accounts SET
        reserved_credit = GREATEST(0, reserved_credit - v_order.total_amount),
        updated_at = now()
      WHERE customer_id = v_order.customer_id;
    END IF;
    RETURN json_build_object('action', 'cancelled', 'order_status', 'cancelled', 'cancelled_at', now());
  ELSE
    RETURN json_build_object('error', 'INVALID_ACTION', 'detail', 'Action must be send, defer, or cancel');
  END IF;
END;
$function$;

-- ============================================================================
-- 6. governed_reject_order
--    * Release credit reservation on rejection (sets status to cancelled)
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_reject_order(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.governed_reject_order(p_token uuid, p_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_order public.orders;
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
      IF NOT public.check_capability(p_token, 'orders.approve') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: orders.approve'; END IF;

      SELECT * INTO v_order FROM public.orders WHERE id = p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF v_order.status IN ('delivered', 'cancelled') THEN RAISE EXCEPTION 'INVALID_STATE: order cannot be rejected'; END IF;

      UPDATE public.orders SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO v_order;

      INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
      VALUES (p_id, v_order.status, 'cancelled', v_session.identity_id, COALESCE(p_reason, 'Order rejected'));

      -- Release credit reservation if credit order
      IF v_order.payment_method = 'credit' THEN
        UPDATE public.customer_credit_accounts SET
          reserved_credit = GREATEST(0, reserved_credit - v_order.total_amount),
          updated_at = now()
        WHERE customer_id = v_order.customer_id;
      END IF;

      RETURN jsonb_build_object('success', true);
    END;
    $function$;

-- ============================================================================
-- 7. governed_delete_order
--    * Release credit reservation before physical deletion
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_delete_order(uuid, uuid);

CREATE OR REPLACE FUNCTION public.governed_delete_order(p_token uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_order public.orders;
      v_visible uuid[];
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
      IF NOT public.check_capability(p_token, 'orders.delete') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: orders.delete'; END IF;

      SELECT * INTO v_order FROM public.orders WHERE id = p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

      IF v_session.identity_type = 'employee' THEN
        v_visible := public.get_visible_employee_ids(p_token);
        IF NOT (v_order.owner_id = ANY(v_visible)) THEN RAISE EXCEPTION 'FORBIDDEN: order not in visibility scope'; END IF;
      ELSE
        RAISE EXCEPTION 'FORBIDDEN';
      END IF;

      -- Release credit reservation before deleting
      IF v_order.payment_method = 'credit' THEN
        UPDATE public.customer_credit_accounts SET
          reserved_credit = GREATEST(0, reserved_credit - v_order.total_amount),
          updated_at = now()
        WHERE customer_id = v_order.customer_id;
      END IF;

      DELETE FROM public.order_items WHERE order_id = p_id;
      DELETE FROM public.order_status_history WHERE order_id = p_id;
      DELETE FROM public.order_modification_history WHERE order_id = p_id;
      DELETE FROM public.orders WHERE id = p_id;
      RETURN true;
    END;
    $function$;

-- ============================================================================
-- 8. governed_check_order_over_limit (read-only helper for frontend)
--     Returns { over_limit, available, required } by joining order with
--     customer_credit_accounts — no schema change.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_check_order_over_limit(
  p_token uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_account public.customer_credit_accounts;
  v_available decimal;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_order.payment_method != 'credit' THEN RETURN jsonb_build_object('over_limit', false); END IF;

  SELECT * INTO v_account FROM public.customer_credit_accounts
  WHERE customer_id = v_order.customer_id AND credit_status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('over_limit', false); END IF;

  v_available := v_account.credit_limit - v_account.outstanding_credit - v_account.reserved_credit;

  RETURN jsonb_build_object(
    'over_limit', v_order.total_amount > v_available,
    'available', v_available,
    'required', v_order.total_amount
  );
END;
$$;

COMMENT ON FUNCTION public.governed_check_order_over_limit IS 'التحقق من تجاوز الحد الائتماني للطلب (قراءة فقط)';

-- ============================================================================
-- END OF CREDIT LIFECYCLE WIRING
-- ============================================================================
