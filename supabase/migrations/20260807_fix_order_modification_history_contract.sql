-- ============================================================================
-- Fix: Schema Regression — order_modification_history column mismatch
-- Root Cause:
--   governed_return_order_for_revision (20260806) uses changed_by/change_type
--   but the table has modified_by/field_name. Bug originated in version 1
--   (20260626) and was reintroduced in the latest rewrite (20260806).
--
-- Audit of all INSERTs into order_modification_history:
--   ✅ 20260730_phase3 (line 218, 513) — correct
--   ✅ 20260731_phase4 (line 182, 620) — correct
--   ✅ 20260801_fix_order_creation (line 123, 436) — correct
--   ❌ 20260626_fix_check_capability (line 208) — changed_by, change_type
--   ❌ 20260806_fix_executive (line 277) — changed_by, change_type (CURRENT)
-- ============================================================================

-- ============================================================================
-- 1. Fix: governed_return_order_for_revision
--    Correct the INSERT to use order_modification_history column names
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_return_order_for_revision CASCADE;

CREATE OR REPLACE FUNCTION public.governed_return_order_for_revision(
  p_token uuid,
  p_id uuid,
  p_reason text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_status varchar(30);
  v_new_revision integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type = 'customer' THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  IF NOT public.check_capability(p_token, 'orders.manage')
     AND NOT public.check_capability(p_token, 'orders.approve') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.manage or orders.approve');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_old_status := v_order.status;

  IF v_old_status IN ('draft', 'cancelled') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: الطلب لم يتم إرساله بعد أو ملغي');
  END IF;

  IF v_old_status = 'returned_for_revision' THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: الطلب بالفعل في حالة تعديل');
  END IF;

  -- Set status to returned_for_revision
  UPDATE public.orders SET
    status = 'returned_for_revision',
    revision_number = COALESCE(revision_number, 0) + 1,
    last_revised_at = now(),
    updated_at = now()
  WHERE id = p_id
  RETURNING revision_number INTO v_new_revision;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_id, v_old_status, 'returned_for_revision', v_session.identity_id, p_reason);

  -- FIX: use correct column names for order_modification_history
  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, new_value, modified_by, reason, modified_at
  ) VALUES (
    p_id, v_new_revision, 'status', 'returned_for_revision',
    v_session.identity_id, p_reason, now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_id,
    'status', 'returned_for_revision',
    'revision_number', v_new_revision,
    'old_status', v_old_status
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.governed_return_order_for_revision TO authenticated;

-- ============================================================================
-- 2. Force PostgREST schema cache reload
-- ============================================================================
SELECT pg_notify('pgrst', 'reload schema');
