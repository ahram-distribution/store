-- Fix: Upper Management collection toggle (مطلوب التحصيل / بدون تحصيل) on the
-- shipping detail page returned NOT_FOUND.
--
-- governed_get_shipping_order returns delivery.id = COALESCE(dt.id, o.id). For
-- orders that were dispatched without a delivery_tracking row yet, that is the
-- ORDER id. governed_set_delivery_collection_required only matched
-- delivery_tracking.id, so clicking the toggle on such orders failed with
-- NOT_FOUND. Mirror the governed_assign_delivery_crew fallback: if p_delivery_id
-- is not a tracking row, resolve it as an order id (in a dispatchable state),
-- updating its active tracking row or creating one.

CREATE OR REPLACE FUNCTION public.governed_set_delivery_collection_required(
  p_token uuid,
  p_delivery_id uuid,
  p_collection_required boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_dt public.delivery_tracking;
  v_attempt integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  -- Only Upper Management (الإدارة العليا) can toggle collection mode.
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN
    -- Fallback: p_delivery_id is an order that was dispatched without a tracking row yet.
    IF NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = p_delivery_id
        AND status IN ('approved', 'preparing', 'prepared', 'ready_for_dispatch', 'sent_to_delivery', 'dispatched')
    ) THEN
      RETURN jsonb_build_object('error', 'NOT_FOUND');
    END IF;

    SELECT * INTO v_dt FROM public.delivery_tracking
    WHERE order_id = p_delivery_id AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_attempt
      FROM public.delivery_tracking WHERE order_id = p_delivery_id;
      INSERT INTO public.delivery_tracking (
        order_id, status, assigned_by, assigned_at, is_active, attempt_number,
        delivery_step, collection_required
      )
      VALUES (
        p_delivery_id, 'assigned', v_session.employee_id, now(), true, v_attempt,
        NULL, p_collection_required
      )
      RETURNING * INTO v_dt;
    END IF;
  ELSE
    IF NOT v_dt.is_active THEN RETURN jsonb_build_object('error', 'DELIVERY_INACTIVE'); END IF;
    IF v_dt.delivery_step IS NOT NULL THEN RETURN jsonb_build_object('error', 'DELIVERY_STARTED'); END IF;
  END IF;

  -- Only before the delivery starts.
  IF v_dt.delivery_step IS NOT NULL THEN RETURN jsonb_build_object('error', 'DELIVERY_STARTED'); END IF;

  UPDATE public.delivery_tracking
  SET collection_required = p_collection_required, updated_at = now()
  WHERE id = v_dt.id;

  RETURN jsonb_build_object(
    'success', true,
    'delivery_id', v_dt.id,
    'collection_required', p_collection_required
  );
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_set_delivery_collection_required(uuid, uuid, boolean) TO authenticated';
  END IF;
END
$grant$;
