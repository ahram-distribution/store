-- ============================================================================
-- FIX order_status_history CHECK constraints — missing statuses
-- ============================================================================
-- The original constraint only listed 8 statuses, but the workflow uses 13.
-- This caused 409 Conflict when governed_change_order_status tried to
-- INSERT a row with a status not in the CHECK list.

ALTER TABLE order_status_history DROP CONSTRAINT IF EXISTS ck_order_status_to;
ALTER TABLE order_status_history ADD CONSTRAINT ck_order_status_to
  CHECK (to_status IN (
    'draft','submitted','reviewing','returned_for_revision',
    'approved','preparing','prepared','ready_for_dispatch',
    'sent_to_delivery','dispatched','delivered','deferred','cancelled'
  ));

ALTER TABLE order_status_history DROP CONSTRAINT IF EXISTS ck_order_status_from;
ALTER TABLE order_status_history ADD CONSTRAINT ck_order_status_from
  CHECK (
    from_status IN (
      'draft','submitted','reviewing','returned_for_revision',
      'approved','preparing','prepared','ready_for_dispatch',
      'sent_to_delivery','dispatched','delivered','deferred','cancelled'
    ) OR from_status IS NULL
  );

-- ============================================================================
-- FIX FK violation: order_status_history.changed_by now references
-- identities(id), but some RPCs still pass v_session.employee_id (employee
-- UUID).  Switch to v_session.identity_id for order_status_history inserts.
-- ============================================================================

-- [36/83] governed_change_order_status
DROP FUNCTION IF EXISTS public.governed_change_order_status(p_token text, p_order_id uuid, p_new_status text, p_reason text);

CREATE OR REPLACE FUNCTION public.governed_change_order_status(p_token text, p_order_id uuid, p_new_status text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_current_status text;
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

  SELECT status::text INTO v_current_status FROM orders WHERE id = p_order_id;
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

  RETURN json_build_object('success', true, 'from_status', v_current_status, 'to_status', p_new_status);
END;
$function$;

-- [38/83] governed_complete_preparation
DROP FUNCTION IF EXISTS public.governed_complete_preparation(p_token uuid, p_preparation_id uuid, p_notes text);

CREATE OR REPLACE FUNCTION public.governed_complete_preparation(p_token uuid, p_preparation_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_rec public.preparation_records; v_order_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_session.employee_id IS NULL THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'warehouse.prepare') THEN RETURN json_build_object('error', 'FORBIDDEN'); END IF;
  SELECT INTO v_rec FROM public.preparation_records WHERE id = p_preparation_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'PREPARATION_NOT_FOUND'); END IF;
  IF v_rec.status != 'in_progress' THEN RETURN json_build_object('error', 'INVALID_STATUS'); END IF;
  SELECT order_id INTO v_order_id FROM public.preparation_records WHERE id = p_preparation_id;
  UPDATE public.preparation_records
  SET status = 'completed', completed_by = v_session.employee_id, completed_at = now(),
      notes = COALESCE(p_notes, notes), updated_at = now()
  WHERE id = p_preparation_id;
  UPDATE public.orders SET status = 'prepared', updated_at = now() WHERE id = v_order_id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (v_order_id, 'preparing', 'prepared', v_session.identity_id, COALESCE(p_notes, 'Preparation completed'));
  RETURN json_build_object('id', p_preparation_id, 'status', 'completed', 'completed_by', v_session.employee_id, 'completed_at', now(), 'order_status', 'prepared');
END;
$function$;

-- [47/83] governed_dispatch_decision
DROP FUNCTION IF EXISTS public.governed_dispatch_decision(p_token uuid, p_id uuid, p_action text, p_assigned_to uuid, p_reason text, p_follow_up_date timestamptz);

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
    RETURN json_build_object('action', 'cancelled', 'order_status', 'cancelled', 'cancelled_at', now());
  ELSE
    RETURN json_build_object('error', 'INVALID_ACTION', 'detail', 'Action must be send, defer, or cancel');
  END IF;
END;
$function$;

-- governed_fail_preparation
DROP FUNCTION IF EXISTS public.governed_fail_preparation(p_token uuid, p_preparation_id uuid, p_failure_reason text, p_notes text);

CREATE OR REPLACE FUNCTION public.governed_fail_preparation(p_token uuid, p_preparation_id uuid, p_failure_reason text, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_session app.sessions;
  v_prep_status text;
  v_order_id uuid;
  v_order_status text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_session.employee_id IS NULL THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'warehouse.prepare') THEN
    RETURN json_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT status::text, order_id INTO v_prep_status, v_order_id
  FROM public.preparation_records WHERE id = p_preparation_id;
  IF v_order_id IS NULL THEN RETURN json_build_object('error', 'PREPARATION_NOT_FOUND'); END IF;
  IF v_prep_status NOT IN ('in_progress', 'completed') THEN
    RETURN json_build_object('error', 'INVALID_STATUS', 'detail', 'Can only fail in_progress or completed preparations');
  END IF;

  SELECT status::text INTO v_order_status FROM public.orders WHERE id = v_order_id;

  UPDATE public.preparation_records
  SET status = 'failed'::preparation_status,
      cancelled_by = v_session.employee_id,
      cancelled_at = now(),
      notes = COALESCE(p_notes, notes) || E'\nFailure reason: ' || p_failure_reason,
      updated_at = now()
  WHERE id = p_preparation_id;

  UPDATE public.orders SET status = 'approved', updated_at = now() WHERE id = v_order_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (v_order_id, v_order_status, 'approved', v_session.identity_id, 'Preparation failed: ' || p_failure_reason, now());

  RETURN json_build_object(
    'id', p_preparation_id,
    'order_id', v_order_id,
    'status', 'failed',
    'failure_reason', p_failure_reason,
    'cancelled_by', v_session.employee_id,
    'cancelled_at', now()
  );
END;
$function$;

-- [57/83] governed_reject_order
DROP FUNCTION IF EXISTS public.governed_reject_order(p_token uuid, p_id uuid, p_reason text);

CREATE OR REPLACE FUNCTION public.governed_reject_order(p_token uuid, p_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS orders
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

      RETURN v_order;
    END;
$function$;

-- [59/83] governed_reopen_cancelled
DROP FUNCTION IF EXISTS public.governed_reopen_cancelled(p_token uuid, p_order_id uuid, p_reason text);

CREATE OR REPLACE FUNCTION public.governed_reopen_cancelled(p_token uuid, p_order_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_authorized boolean; v_emp_code text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  SELECT code INTO v_emp_code FROM public.employees WHERE id = v_session.employee_id;
  v_authorized := EXISTS (SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN','EXECUTIVE_MANAGER','Sales Manager'));
  IF NOT v_authorized THEN RETURN json_build_object('error', 'FORBIDDEN', 'detail', 'Only Sales Manager and higher can reopen cancelled orders'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND status = 'cancelled') THEN
    RETURN json_build_object('error', 'INVALID_STATE', 'detail', 'Only cancelled orders can be reopened');
  END IF;
  UPDATE public.orders SET status = 'ready_for_dispatch', cancelled_at = NULL, cancel_reason = NULL, updated_at = now() WHERE id = p_order_id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_order_id, 'cancelled', 'ready_for_dispatch', v_session.identity_id, COALESCE(p_reason, 'Order reopened for dispatch'));
  RETURN json_build_object('action', 'reopened', 'order_status', 'ready_for_dispatch');
END;
$function$;

-- [66/83] governed_start_preparation
DROP FUNCTION IF EXISTS public.governed_start_preparation(p_token uuid, p_id uuid, p_notes text);

CREATE OR REPLACE FUNCTION public.governed_start_preparation(p_token uuid, p_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_session app.sessions; v_order public.orders; v_prep public.preparation_records;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  PERFORM check_capability(p_token, 'orders.prepare');
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_order.status NOT IN ('approved', 'ready_for_dispatch') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;
  IF EXISTS (SELECT 1 FROM public.preparation_records WHERE order_id = p_id AND status = 'in_progress') THEN RETURN jsonb_build_object('error', 'ALREADY_IN_PREPARATION'); END IF;
  INSERT INTO public.preparation_records (order_id, started_by, status, notes) VALUES (p_id, v_session.employee_id, 'in_progress', p_notes) RETURNING * INTO v_prep;
  UPDATE public.orders SET status = 'preparing', updated_at = now() WHERE id = p_id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, v_order.status, 'preparing', v_session.identity_id, 'Preparation started');
  RETURN jsonb_build_object('success', true, 'preparation_id', v_prep.id);
END;
$function$;
