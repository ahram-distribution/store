-- Fix: "حفظ فريق التوصيل" (governed_assign_delivery_crew) returned
-- ORDER_TRACKING_EXISTS. The shipping detail page sends delivery.id =
-- COALESCE(dt.id, o.id), which can be the ORDER id (e.g. a page opened before
-- the tracking row was created, or a stale tab). When that order already has an
-- active tracking row, the fallback errored instead of updating that row.
-- Resolve the order id to its active tracking row and update it, mirroring the
-- collection-toggle fix.

CREATE OR REPLACE FUNCTION public.governed_assign_delivery_crew(
  p_token uuid,
  p_delivery_id uuid,
  p_rep_id uuid DEFAULT NULL,
  p_driver_id uuid DEFAULT NULL
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

  -- Only Upper Management (الإدارة العليا) can dispatch / assign crews.
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

    -- Prefer the order's active tracking row (the page may hold the order id).
    SELECT * INTO v_dt FROM public.delivery_tracking
    WHERE order_id = p_delivery_id AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_attempt
      FROM public.delivery_tracking WHERE order_id = p_delivery_id;
      INSERT INTO public.delivery_tracking (
        order_id, status, assigned_to, driver_id, assigned_by, assigned_at,
        is_active, attempt_number, delivery_step
      )
      VALUES (
        p_delivery_id, 'assigned', p_rep_id, p_driver_id, v_session.employee_id, now(),
        true, v_attempt, NULL
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
  SET assigned_to = COALESCE(p_rep_id, assigned_to),
      driver_id = COALESCE(p_driver_id, driver_id),
      assigned_by = v_session.employee_id,
      assigned_at = now(),
      updated_at = now()
  WHERE id = v_dt.id
  RETURNING * INTO v_dt;

  RETURN jsonb_build_object(
    'success', true,
    'delivery_id', v_dt.id,
    'rep_id', v_dt.assigned_to,
    'driver_id', v_dt.driver_id
  );
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_assign_delivery_crew(uuid, uuid, uuid, uuid) TO authenticated';
  END IF;
END
$grant$;
