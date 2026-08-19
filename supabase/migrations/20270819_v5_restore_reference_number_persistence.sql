-- ============================================================================
-- Migration: Restore reference-number persistence in governed_change_order_status
--
-- ROOT CAUSE (verified on ORD-2026-000213): the v3 canonical-status rewrite
-- (20270819_v3_remove_exceptional_change.sql) recreated
-- governed_change_order_status but DROPPED the reference_number assignment
-- from its UPDATE. The RPC validated the mandatory reference number and wrote
-- it to order_status_history only — orders.reference_number stayed NULL, so
-- get_unified_order / get_unified_orders returned NULL and the Order Details
-- header and Order Card rendered "الرقم المرجعى: —" while Event History
-- (history rows) showed the value.
--
-- Fix: restore the persistence line exactly as the pre-canonical production
-- function had it, generalized to ANY transition into 'reviewing' (the policy
-- requires the reference number on entry to تم القيد بالسيستم when the order
-- has none):
--   * write the provided reference number when entering 'reviewing' and the
--     order currently has no reference number
--   * never overwrite an existing reference number
--   * unchanged for every other status
-- ============================================================================

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
  v_reference_number text;
  v_has_capability boolean;
  v_required_capability varchar(100);
  v_adjust_plan jsonb;
  v_neg boolean;
  v_deducted_at timestamptz;
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
    RETURN json_build_object('success', false, 'error', E'\u062d\u0627\u0644\u0629 \u063a\u064a\u0631 \u0635\u0627\u0644\u062d\u0629');
  END IF;

  SELECT status::text, reference_number
  INTO v_current_status, v_reference_number
  FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', E'\u0627\u0644\u0637\u0644\u0628 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f');
  END IF;

  IF v_current_status = p_new_status THEN
    RETURN json_build_object('success', false, 'error', E'\u0627\u0644\u0637\u0644\u0628 \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064a \u0627\u0644\u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629');
  END IF;

  -- Capability determination (unchanged)
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
    RETURN json_build_object('success', false, 'error', E'\u0644\u064a\u0633 \u0644\u062f\u064a\u0643 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0629 \u0627\u0644\u0644\u0627\u0632\u0645\u0629 \u0644\u0644\u0625\u062c\u0631\u0627\u0621');
  END IF;

  -- Reference number rule — mandatory only when entering reviewing (تم القيد بالسيستم)
  IF p_new_status = 'reviewing' THEN
    IF COALESCE(trim(v_reference_number), '') = '' THEN
      IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
        RETURN json_build_object('success', false, 'error', E'\u0627\u0644\u0631\u062c\u0627\u0621 \u0625\u062f\u062e\u0627\u0644 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0645\u0631\u062c\u0639\u0649 \u0639\u0646\u062f \u0627\u0644\u062a\u062d\u0648\u064a\u0644 \u0625\u0644\u0649 \u062a\u0645 \u0627\u0644\u0642\u064a\u062f \u0628\u0627\u0644\u0633\u064a\u0633\u062a\u0645');
      END IF;
    END IF;
  END IF;

  -- Execution Group Entry Finalization (unchanged): adjustments preview when
  -- entering the deduction zone and inventory not yet deducted
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
            'details', E'\u064a\u062c\u0628 \u0645\u0631\u0627\u062c\u0639\u0629 \u062a\u0639\u062f\u064a\u0644\u0627\u062a \u0627\u0644\u0643\u0645\u064a\u0627\u062a \u0642\u0628\u0644 \u062f\u062e\u0648\u0644 \u0645\u0631\u062d\u0644\u0629 \u0627\u0644\u062a\u0646\u0641\u064a\u0630'
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- Execute the transition (no exceptional logic — all canonical transitions free)
  UPDATE orders
  SET status = p_new_status,
      updated_at = now(),
      submitted_at = CASE WHEN p_new_status = 'submitted' AND v_current_status = 'draft' THEN now() ELSE submitted_at END,
      cancelled_at = CASE WHEN p_new_status = 'cancelled' THEN now() ELSE cancelled_at END,
      cancel_reason = CASE WHEN p_new_status = 'cancelled' THEN p_reason ELSE cancel_reason END,
      reference_number = CASE
        WHEN p_new_status = 'reviewing' AND COALESCE(trim(v_reference_number), '') = ''
        THEN COALESCE(NULLIF(trim(p_reference_number), ''), reference_number)
        ELSE reference_number
      END
  WHERE id = p_order_id;

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at, reference_number)
  VALUES (p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, now(),
    CASE
      WHEN p_new_status = 'reviewing'
        THEN COALESCE(NULLIF(trim(p_reference_number), ''), v_reference_number)
      ELSE NULL
    END);

  RETURN json_build_object('success', true, 'new_status', p_new_status);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.governed_change_order_status(text,uuid,varchar,text,text,boolean) TO authenticated;

COMMENT ON FUNCTION public.governed_change_order_status IS
  'Canonical 8-status free-transition workflow: no exceptional-change concept. Reference number required on entry to reviewing; persisted to orders.reference_number when provided and none exists; never overwrites an existing reference number.';

NOTIFY pgrst, 'reload schema';