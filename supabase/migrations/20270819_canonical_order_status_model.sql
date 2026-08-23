-- ============================================================================
-- Migration: Canonical Order Status Model — enforce 8-status universe
--
-- Canonical statuses (exact order):
--   1. submitted   — طلب شراء
--   2. approved    — معتمد
--   3. reviewing   — تم القيد بالسيستم
--   4. preparing   — قيد التجهيز
--   5. prepared    — تم التجهيز
--   6. delivered   — تم التسليم
--   7. returned_for_revision — معاد للتعديل
--   8. cancelled   — ملغى
--
-- Internal-only (NOT user-facing):
--   draft — order creation / initialization state
--
-- Removed from active workflow:
--   dispatched, ready_for_dispatch, sent_to_delivery, sales_manager_approved,
--   deferred, stock_review
-- ============================================================================

-- ============================================================================
-- 1. execution_status_group — deduction zone
--    Now: approved, reviewing, preparing, prepared, delivered
--    Removed: ready_for_dispatch, sent_to_delivery (obsolete)
--    Added: reviewing (القيد بالسيستم is inside the deduction zone)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.execution_status_group()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['approved','reviewing','preparing','prepared','delivered']::text[];
$$;

COMMENT ON FUNCTION public.execution_status_group IS
  'Canonical deduction/execution zone: approved → reviewing → preparing → prepared → delivered. Inventory is deducted exactly once when an order first enters this group.';

-- ============================================================================
-- 2. inventory_release_status_group — restore zone
--    Now: returned_for_revision, submitted, cancelled
--    Removed: sales_manager_approved (obsolete)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.inventory_release_status_group()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['returned_for_revision','submitted','cancelled']::text[];
$$;

COMMENT ON FUNCTION public.inventory_release_status_group IS
  'Canonical inventory-release set: returning to any of these statuses restores inventory exactly once.';

-- ============================================================================
-- 3. governed_change_order_status v5 — canonical 8-status workflow
--    Key changes from v4:
--    a) statuses array: draft kept as internal-only, dispatched removed
--    b) workflow order: reviewing AFTER approved (was before)
--    c) reference number: only when target = reviewing
-- ============================================================================
DROP FUNCTION IF EXISTS public.governed_change_order_status(text, uuid, varchar, text, text, boolean);

CREATE OR REPLACE FUNCTION public.governed_change_order_status(
  p_token               text,
  p_order_id            uuid,
  p_new_status          varchar(50),
  p_reason              text DEFAULT NULL::text,
  p_reference_number    text DEFAULT NULL::text,
  p_confirm_adjustments boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_current_status varchar(50);
  v_customer_id uuid;
  v_total_amount numeric;
  v_payment_method varchar(20);
  v_reference_number text;
  v_has_capability boolean;
  v_required_capability varchar(100);
  v_from_idx integer;
  v_to_idx integer;
  v_is_exceptional boolean;
  v_adjust_plan jsonb;
  v_neg boolean;
  v_deducted_at timestamptz;
  -- Canonical 8 statuses + draft (internal). Order matters for exceptional detection.
  statuses text[] := ARRAY[
    'draft','submitted','approved','reviewing','preparing','prepared','delivered',
    'returned_for_revision','cancelled'
  ];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_SESSION');
  END IF;

  IF NOT (p_new_status = ANY(statuses)) THEN
    RETURN json_build_object('success', false, 'error', 'حالة غير صالحة');
  END IF;

  SELECT status::text, customer_id, total_amount, payment_method, reference_number
  INTO v_current_status, v_customer_id, v_total_amount, v_payment_method, v_reference_number
  FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'الطلب غير موجود');
  END IF;

  IF v_current_status = p_new_status THEN
    RETURN json_build_object('success', false, 'error', 'الطلب بالفعل في الحالة المطلوبة');
  END IF;

  v_from_idx := array_position(statuses, v_current_status);
  v_to_idx := array_position(statuses, p_new_status);

  SELECT check_capability(p_token, 'orders.manage') INTO v_has_capability;
  IF v_has_capability THEN
    v_required_capability := 'orders.manage';
  ELSE
    IF v_current_status = 'submitted' AND p_new_status = 'approved' THEN
      v_required_capability := 'orders.approve';
    ELSIF v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN
      v_required_capability := 'orders.review';
    ELSIF v_current_status IN ('submitted','returned_for_revision','cancelled')
          AND p_new_status IN ('returned_for_revision','cancelled')
          AND p_new_status <> v_current_status THEN
      v_required_capability := 'orders.approve';
    ELSIF v_current_status = 'approved' AND p_new_status = 'reviewing' THEN
      v_required_capability := 'orders.review';
    ELSIF v_current_status = 'reviewing' AND p_new_status = 'preparing' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF v_current_status = 'preparing' AND p_new_status = 'prepared' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF v_current_status = 'prepared' AND p_new_status = 'delivered' THEN
      v_required_capability := 'transportation.send_to_delivery';
    ELSE
      v_required_capability := 'orders.manage';
    END IF;
  END IF;

  SELECT check_capability(p_token, v_required_capability) INTO v_has_capability;
  IF NOT v_has_capability THEN
    RETURN json_build_object('success', false, 'error', 'ليس لديك الصلاحية اللازمة للإجراء');
  END IF;

  -- Exceptional transition detection
  v_is_exceptional := false;
  IF v_current_status = 'cancelled' OR p_new_status = 'cancelled' THEN
    v_is_exceptional := true;
  ELSIF v_to_idx < v_from_idx THEN
    v_is_exceptional := true;
  ELSIF v_to_idx > v_from_idx + 1 THEN
    v_is_exceptional := true;
  END IF;

  IF v_is_exceptional AND (p_reason IS NULL OR trim(p_reason) = '') THEN
    RETURN json_build_object('success', false, 'error', 'الرجاء إدخال سبب التغيير الاستثنائي');
  END IF;

  -- Reference number rule — mandatory only when entering reviewing (تم القيد بالسيستم)
  IF p_new_status = 'reviewing' THEN
    IF COALESCE(trim(v_reference_number), '') = '' THEN
      IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
        RETURN json_build_object('success', false, 'error', 'الرجاء إدخال الرقم المرجعى عند التحويل إلى تم القيد بالسيستم');
      END IF;
    END IF;
  END IF;

  -- Execution Group Entry Finalization
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
            'error', 'ADJUSTMENTS_REQUIRED',
            'adjustments', v_adjust_plan,
            'details', 'يجب مراجعة تعديلات الكميات قبل دخول مرحلة التنفيذ'
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- Execute the transition
  UPDATE orders
  SET status = p_new_status,
      updated_at = now(),
      submitted_at = CASE WHEN p_new_status = 'submitted' AND v_current_status = 'draft' THEN now() ELSE submitted_at END,
      cancelled_at = CASE WHEN p_new_status = 'cancelled' THEN now() ELSE cancelled_at END,
      cancel_reason = CASE WHEN p_new_status = 'cancelled' THEN p_reason ELSE cancel_reason END
  WHERE id = p_order_id;

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, reference_number)
  VALUES (p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, p_reference_number);

  RETURN json_build_object('success', true, 'new_status', p_new_status);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.governed_change_order_status(text, uuid, varchar, text, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.governed_change_order_status IS
  'Canonical 8-status workflow v5: submitted→approved→reviewing→preparing→prepared→delivered. draft is internal-only.';

-- ============================================================================
-- 4. Migrate the single draft order to submitted
--    (has customer, 27 items, submitted_at already set — safe mapping)
-- ============================================================================
UPDATE public.orders
SET status = 'submitted',
    updated_at = now()
WHERE status = 'draft';

-- Record the migration in status history
INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason)
SELECT id, 'draft', 'submitted', created_by, 'تم التحويل تلقائياً من مسودة إلى طلب شراء — نظام الحالة الم canonized'
FROM orders
WHERE status = 'submitted' AND submitted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM order_status_history h
    WHERE h.order_id = orders.id AND h.from_status = 'draft' AND h.to_status = 'submitted'
  );

NOTIFY pgrst, 'reload schema';
