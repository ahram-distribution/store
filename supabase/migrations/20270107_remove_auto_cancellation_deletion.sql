-- ============================================================================
-- REMOVE AUTOMATIC CANCELLATION DELETION
--
-- Business Decision (Approved):
-- Cancelled orders MUST remain in the system.
-- Cancellation and permanent deletion are two different operations.
-- Supreme Management may manually delete cancelled orders.
-- ============================================================================

-- ============================================================================
-- 1. Remove the auto-deletion trigger and function
-- ============================================================================

DROP TRIGGER IF EXISTS trg_cancelled_order_deletion ON public.orders;

DROP FUNCTION IF EXISTS public.handle_cancelled_order_deletion();

-- ============================================================================
-- 2. Restore governed_cancel_order — original order (UPDATE then INSERT)
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
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
-- 3. Restore governed_change_order_status — original order (UPDATE then INSERT)
-- ============================================================================

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

  UPDATE orders SET
    status = p_new_status,
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

  RETURN json_build_object('success', true, 'from_status', v_current_status, 'to_status', p_new_status);
END;
$function$;

-- ============================================================================
-- 4. Restore governed_dispatch_decision — original order (UPDATE then INSERT for cancel)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_dispatch_decision(p_token uuid, p_id uuid, p_action text, p_assigned_to uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_follow_up_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_order public.orders; v_authorized boolean; v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  v_authorized := public.is_upper_management(v_session.employee_id);
  IF NOT v_authorized THEN RETURN json_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only'); END IF;
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
    RETURN json_build_object('action', 'cancelled', 'order_status', 'cancelled', 'cancelled_at', now());
  ELSE
    RETURN json_build_object('error', 'INVALID_ACTION', 'detail', 'Action must be send, defer, or cancel');
  END IF;
END;
$function$;

-- ============================================================================
-- 5. Restore governed_reject_order — original (UPDATE then INSERT)
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_reject_order(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.governed_reject_order(p_token text, p_id uuid, p_reason text DEFAULT NULL::text)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE v_session app.sessions; v_order public.orders;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'orders.approve') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: orders.approve'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_id; IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_order.status IN ('delivered', 'cancelled') THEN RAISE EXCEPTION 'INVALID_STATE: order cannot be rejected'; END IF;
  UPDATE public.orders SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO v_order;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, v_order.status, 'cancelled', v_session.identity_id, COALESCE(p_reason, 'Order rejected'));
  RETURN v_order;
END; $$;

-- ============================================================================
-- 6. Restore governed_reopen_cancelled — original (can reopen cancelled orders)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_reopen_cancelled(p_token uuid, p_order_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_authorized boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  v_authorized := public.is_upper_management(v_session.employee_id);
  IF NOT v_authorized THEN RETURN json_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND status = 'cancelled') THEN
    RETURN json_build_object('error', 'INVALID_STATE', 'detail', 'Only cancelled orders can be reopened');
  END IF;
  UPDATE public.orders SET status = 'ready_for_dispatch', cancelled_at = NULL, cancel_reason = NULL, updated_at = now() WHERE id = p_order_id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_order_id, 'cancelled', 'ready_for_dispatch', v_session.identity_id, COALESCE(p_reason, 'Order reopened for dispatch'));
  RETURN json_build_object('action', 'reopened', 'order_status', 'ready_for_dispatch');
END;
$function$;

-- ============================================================================
-- Done — 20270106 Supreme Management RPCs are kept untouched
-- ============================================================================
