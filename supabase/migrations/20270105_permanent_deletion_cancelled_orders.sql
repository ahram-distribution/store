-- ============================================================================
-- Permanent Deletion of Cancelled Orders
-- Business Decision (Approved by PO, 2026-07-07):
-- Any sales order whose status becomes "ملغاة" (Cancelled) must be
-- permanently deleted from the operational system immediately.
-- ============================================================================

-- ============================================================================
-- Part 1: Trigger function — cleanup + delete on status change to 'cancelled'
-- Fires AFTER UPDATE of status to 'cancelled' and handles:
--   1. Restore inventory (if order was approved and inventory deducted)
--   2. Release credit reservation (if payment_method = 'credit')
--   3. Delete related operational records (returns, delivery, prep, etc.)
--   4. Delete the order itself (cascades to order_items, history, deals)
--   5. Log to deletion_audit_log
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_cancelled_order_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_employee_id uuid;
BEGIN
  -- Only fire when status changes TO 'cancelled' (not updating an already-cancelled order)
  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    v_employee_id := NEW.created_by;

    -- 1. Restore inventory if order was in a state where inventory was deducted
    -- (inventory deducted at approval; draft/submitted/reviewing haven't been approved yet)
    IF OLD.status IN ('approved', 'preparing', 'prepared', 'ready_for_dispatch', 'sent_to_delivery', 'dispatched', 'delivered', 'deferred') THEN
      INSERT INTO public.inventory (product_id, quantity)
      SELECT oi.product_id, oi.piece_quantity
      FROM public.order_items oi
      WHERE oi.order_id = NEW.id
      ON CONFLICT (product_id) DO UPDATE
      SET quantity = public.inventory.quantity + EXCLUDED.quantity,
          updated_at = now();
    END IF;

    -- 2. Release credit reservation
    IF NEW.payment_method = 'credit' THEN
      UPDATE public.customer_credit_accounts
      SET reserved_credit = GREATEST(reserved_credit - NEW.total_amount, 0),
          updated_at = now()
      WHERE customer_id = NEW.customer_id;
    END IF;

    -- 3. Delete treasury_transactions referencing collections linked to this order
    DELETE FROM public.treasury_transactions
    WHERE reference_type = 'collection'
      AND reference_id IN (SELECT id FROM public.collections WHERE order_id = NEW.id);

    -- 4. Delete collections linked to this order
    DELETE FROM public.collections WHERE order_id = NEW.id;

    -- 5. Delete preparation_exceptions (FK -> preparation_records)
    DELETE FROM public.preparation_exceptions
    WHERE preparation_id IN (SELECT id FROM public.preparation_records WHERE order_id = NEW.id);

    -- 6. Delete preparation_records
    DELETE FROM public.preparation_records WHERE order_id = NEW.id;

    -- 7. Delete delivery_tracking
    DELETE FROM public.delivery_tracking WHERE order_id = NEW.id;

    -- 8. Delete package_orders
    DELETE FROM public.package_orders WHERE order_id = NEW.id;

    -- 9. Delete return_items (FK -> returns)
    DELETE FROM public.return_items
    WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = NEW.id);

    -- 10. Delete returns
    DELETE FROM public.returns WHERE order_id = NEW.id;

    -- 11. Delete credit_invoice_cheques (FK -> credit_invoices)
    DELETE FROM public.credit_invoice_cheques
    WHERE invoice_id IN (SELECT id FROM public.credit_invoices WHERE order_id = NEW.id);

    -- 12. Delete credit_invoices
    DELETE FROM public.credit_invoices WHERE order_id = NEW.id;

    -- 13. Delete auction_awards
    DELETE FROM public.auction_awards WHERE order_id = NEW.id;

    -- 14. Delete the order itself
    -- (Cascades to: order_items, order_status_history, order_modification_history,
    --  order_daily_deals, order_flash_offers)
    DELETE FROM public.orders WHERE id = NEW.id;

    -- 15. Audit log
    INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
    VALUES (v_employee_id, 'order', ARRAY[NEW.id], 1,
            '["order_items","order_status_history","order_modification_history","order_daily_deals","order_flash_offers","preparation_records","preparation_exceptions","delivery_tracking","package_orders","returns","return_items","return_status_history","credit_invoices","credit_invoice_cheques","auction_awards","collections","treasury_transactions","inventory","customer_credit_accounts"]'::jsonb);
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- Part 2: Trigger on orders table
-- ============================================================================

DROP TRIGGER IF EXISTS trg_cancelled_order_deletion ON public.orders;

CREATE TRIGGER trg_cancelled_order_deletion
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_cancelled_order_deletion();

-- ============================================================================
-- Part 3: Restructure governed_cancel_order
-- Move INSERT order_status_history + credit release BEFORE the UPDATE so
-- the trigger (which deletes the order) fires last.
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

  SELECT status, customer_id, total_amount, payment_method
  INTO v_old_status, v_customer_id, v_total_amount, v_payment_method
  FROM public.orders WHERE id = p_id;

  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status IN ('cancelled', 'delivered', 'collected') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;

  -- Write status history BEFORE status update (trigger will fire and delete the order)
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'cancelled', v_employee_id, p_reason, now());

  -- Release credit reservation BEFORE status update
  IF v_payment_method = 'credit' THEN
    UPDATE public.customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  -- Status update — trigger fires, cleans up, and deletes the order
  UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- Part 4: Restructure governed_change_order_status
-- Move history INSERT + credit release BEFORE the UPDATE for all transitions.
-- For cancellation, the trigger fires and deletes the order.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_change_order_status(
  p_token text,
  p_order_id uuid,
  p_new_status text,
  p_reason text DEFAULT NULL::text
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
  statuses text[] := ARRAY['draft','submitted','reviewing','returned_for_revision','approved','preparing','prepared','ready_for_dispatch','sent_to_delivery','dispatched','deferred','cancelled','delivered'];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_SESSION');
  END IF;

  IF NOT (p_new_status = ANY(statuses)) THEN
    RETURN json_build_object('success', false, 'error', 'حالة غير صالحة');
  END IF;

  SELECT status::text, customer_id, total_amount, payment_method
  INTO v_current_status, v_customer_id, v_total_amount, v_payment_method
  FROM orders WHERE id = p_order_id;

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

  -- Write status history BEFORE status update (trigger fires for cancellation)
  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, now());

  -- Release credit BEFORE status update (only for cancellation)
  IF p_new_status = 'cancelled' AND v_payment_method = 'credit' THEN
    UPDATE customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  -- Status update — trigger fires for cancellation, cleans up, and deletes the order
  UPDATE orders SET
    status = p_new_status,
    delivered_at = CASE WHEN p_new_status = 'delivered' THEN now() ELSE delivered_at END,
    updated_at = now()
  WHERE id = p_order_id;

  RETURN json_build_object('success', true, 'from_status', v_current_status, 'to_status', p_new_status);
END;
$function$;

-- ============================================================================
-- Part 5: Restructure governed_dispatch_decision (cancel action)
-- Move INSERT order_status_history BEFORE the UPDATE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_dispatch_decision(
  p_token uuid,
  p_id uuid,
  p_action text,
  p_assigned_to uuid DEFAULT NULL::uuid,
  p_reason text DEFAULT NULL::text,
  p_follow_up_date timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_authorized boolean;
  v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;

  v_authorized := public.is_upper_management(v_session.employee_id);
  IF NOT v_authorized THEN RETURN json_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'NOT_FOUND'); END IF;
  IF v_order.status != 'ready_for_dispatch' THEN
    RETURN json_build_object('error', 'INVALID_STATE', 'detail', 'Order must be in ready_for_dispatch status');
  END IF;

  IF p_action = 'send' THEN
    IF p_assigned_to IS NULL THEN
      RETURN json_build_object('error', 'MISSING_ASSIGNEE', 'detail', 'A delivery employee must be assigned');
    END IF;
    UPDATE public.orders SET status = 'sent_to_delivery', updated_at = now() WHERE id = p_id;
    INSERT INTO public.delivery_tracking (order_id, status, assigned_to, assigned_by, assigned_at)
    VALUES (p_id, 'assigned', p_assigned_to, v_session.employee_id, now()) RETURNING * INTO v_dt;
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
    VALUES (p_id, 'ready_for_dispatch', 'sent_to_delivery', v_session.identity_id, COALESCE(p_reason, 'Sent to delivery'));
    RETURN json_build_object('action', 'sent_to_delivery', 'order_status', 'sent_to_delivery', 'delivery_id', v_dt.id);

  ELSIF p_action = 'defer' THEN
    IF p_follow_up_date IS NULL THEN
      RETURN json_build_object('error', 'MISSING_FOLLOW_UP', 'detail', 'Follow-up date is required for deferral');
    END IF;
    UPDATE public.orders SET status = 'deferred', deferred_until = p_follow_up_date, defer_reason = p_reason, updated_at = now() WHERE id = p_id;
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
    VALUES (p_id, 'ready_for_dispatch', 'deferred', v_session.identity_id, COALESCE(p_reason, 'Order deferred'));
    RETURN json_build_object('action', 'deferred', 'order_status', 'deferred', 'deferred_until', p_follow_up_date);

  ELSIF p_action = 'cancel' THEN
    IF p_reason IS NULL THEN
      RETURN json_build_object('error', 'MISSING_REASON', 'detail', 'Cancellation reason is required');
    END IF;
    -- Write status history BEFORE status update (trigger fires and deletes the order)
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
    VALUES (p_id, 'ready_for_dispatch', 'cancelled', v_session.identity_id, p_reason);
    -- Status update — trigger fires, cleans up, and deletes the order
    UPDATE public.orders SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, updated_at = now() WHERE id = p_id;
    RETURN json_build_object('action', 'cancelled', 'order_status', 'cancelled', 'cancelled_at', now());

  ELSE
    RETURN json_build_object('error', 'INVALID_ACTION', 'detail', 'Action must be send, defer, or cancel');
  END IF;
END;
$function$;

-- ============================================================================
-- Part 6: Restructure governed_reject_order
-- Move INSERT order_status_history BEFORE the UPDATE.
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_reject_order(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.governed_reject_order(
  p_token text,
  p_id uuid,
  p_reason text DEFAULT NULL::text
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  IF NOT public.check_capability(p_token, 'orders.approve') THEN
    RAISE EXCEPTION 'MISSING_CAPABILITY: orders.approve';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF v_order.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATE: order cannot be rejected';
  END IF;

  -- Write status history BEFORE status update (trigger fires and deletes the order)
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_id, v_order.status, 'cancelled', v_session.identity_id, COALESCE(p_reason, 'Order rejected'));

  -- Status update — trigger fires, cleans up, and deletes the order
  UPDATE public.orders SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = p_id
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

-- ============================================================================
-- Part 7: governed_reopen_cancelled — no longer applicable
-- Cancelled orders are permanently deleted. Reopening is impossible.
-- Return clear error message to prevent confusion.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_reopen_cancelled(
  p_token uuid,
  p_order_id uuid,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_session app.sessions;
  v_authorized boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;

  v_authorized := public.is_upper_management(v_session.employee_id);
  IF NOT v_authorized THEN
    RETURN json_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only');
  END IF;

  RETURN json_build_object(
    'error', 'CANCELLED_ORDER_DELETED',
    'detail', 'Cancelled orders are permanently deleted. The order cannot be reopened. A new order must be created.'
  );
END;
$function$;

-- ============================================================================
-- Done
-- ============================================================================
