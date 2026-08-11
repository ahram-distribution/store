-- ============================================================================
-- DELIVERY JOURNEY â€” order action + shipping list updates
-- ============================================================================
-- Companion to 20260810_delivery_journey_model.sql.
--
--   * governed_delivery_action becomes DUAL-MODE:
--       - Journey orders (delivery_tracking.journey_id NOT NULL): the journey
--         must be in_progress and the order runs the reduced flow
--         ط¨ط¯ط، ط§ظ„طھط­ط±ظƒ -> ظˆطµظˆظ„ -> ظ†طھظٹط¬ط© -> طھط­طµظٹظ„ (no per-order ط§ط³طھظ„ط§ظ… / ط±ط¬ظˆط¹).
--       - Legacy orders (journey_id IS NULL): unchanged 5-step flow.
--   * governed_get_shipping_orders gains journey columns + an 'in_journey'
--     filter so Upper Management can see which dispatched orders are already
--     inside a journey.
--
-- SAFETY: code only; not applied to the live project (same policy as the rest
-- of the delivery migrations).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- governed_delivery_action (dual-mode)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_delivery_action(
  p_token uuid,
  p_delivery_id uuid,
  p_action text,
  p_amount numeric DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_accuracy_meters numeric DEFAULT NULL,
  p_captured_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_dt public.delivery_tracking;
  v_journey public.delivery_journeys;
  v_expected text;
  v_collection_id uuid;
  v_seq int;
  v_code text;
  v_order public.orders;
  v_amount numeric;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF NOT v_dt.is_active THEN RETURN jsonb_build_object('error', 'DELIVERY_INACTIVE'); END IF;

  -- Only the assigned crew may act (Upper Management bypasses for oversight).
  IF NOT public.is_upper_management(v_session.employee_id)
     AND COALESCE(v_dt.assigned_to, v_dt.driver_id) IS DISTINCT FROM v_session.employee_id
     AND COALESCE(v_dt.driver_id, v_dt.assigned_to) IS DISTINCT FROM v_session.employee_id THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  IF v_dt.journey_id IS NOT NULL THEN
    -- ====================== JOURNEY ORDER FLOW ======================
    SELECT * INTO v_journey FROM public.delivery_journeys WHERE id = v_dt.journey_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'JOURNEY_NOT_FOUND'); END IF;
    IF v_journey.status <> 'in_progress' THEN
      RETURN jsonb_build_object('error', 'JOURNEY_NOT_STARTED', 'journey_status', v_journey.status);
    END IF;

    IF p_action NOT IN ('moving_to_customer', 'arrived_at_customer', 'customer_not_found', 'collected') THEN
      RETURN jsonb_build_object('error', 'INVALID_ACTION');
    END IF;

    -- Sequence: NULL -> moving -> arrived|customer_not_found -> collected.
    v_expected := CASE COALESCE(v_dt.delivery_step, '')
      WHEN '' THEN 'moving_to_customer'
      WHEN 'moving_to_customer' THEN 'arrived_at_customer'
      WHEN 'arrived_at_customer' THEN 'collected'
      ELSE NULL
    END;

    IF v_expected IS NULL THEN
      RETURN jsonb_build_object('error', 'INVALID_STEP', 'expected', NULL, 'current_step', v_dt.delivery_step);
    END IF;

    IF p_action IS DISTINCT FROM v_expected
       AND NOT (v_expected = 'arrived_at_customer' AND p_action IN ('arrived_at_customer', 'customer_not_found')) THEN
      RETURN jsonb_build_object('error', 'INVALID_STEP', 'expected', v_expected, 'current_step', v_dt.delivery_step);
    END IF;
  ELSE
    -- ====================== LEGACY ORDER FLOW ======================
    v_expected := CASE COALESCE(v_dt.delivery_step, '')
      WHEN '' THEN 'received'
      WHEN 'received' THEN 'moving_to_customer'
      WHEN 'moving_to_customer' THEN 'arrived_at_customer'
      WHEN 'arrived_at_customer' THEN CASE WHEN v_dt.collection_required THEN 'collected' ELSE 'returned_to_company' END
      WHEN 'customer_not_found' THEN 'returned_to_company'
      WHEN 'collected' THEN 'returned_to_company'
      ELSE 'returned_to_company'
    END;

    IF p_action IS DISTINCT FROM v_expected
       AND NOT (v_expected = 'arrived_at_customer' AND p_action IN ('arrived_at_customer', 'customer_not_found')) THEN
      RETURN jsonb_build_object('error', 'INVALID_STEP', 'expected', v_expected, 'current_step', v_dt.delivery_step);
    END IF;

    IF p_action NOT IN ('received', 'moving_to_customer', 'arrived_at_customer', 'customer_not_found', 'collected', 'returned_to_company') THEN
      RETURN jsonb_build_object('error', 'INVALID_ACTION');
    END IF;
  END IF;

  -- Record the event first (single source of truth for the action history)
  INSERT INTO public.delivery_actions (
    order_id, delivery_tracking_id, employee_id, action, amount,
    latitude, longitude, accuracy_meters, captured_at
  )
  VALUES (
    v_dt.order_id, v_dt.id, v_session.employee_id, p_action,
    CASE WHEN p_action = 'collected' THEN COALESCE(p_amount, 0) ELSE NULL END,
    p_latitude, p_longitude, p_accuracy_meters,
    COALESCE(p_captured_at, now())
  );

  -- ====================== STATE TRANSITIONS ======================
  IF v_dt.journey_id IS NOT NULL THEN
    IF p_action = 'moving_to_customer' THEN
      UPDATE public.delivery_tracking
      SET delivery_step = 'moving_to_customer',
          status = CASE WHEN status = 'assigned' THEN 'out_for_delivery' ELSE status END,
          updated_at = now()
      WHERE id = v_dt.id;

    ELSIF p_action = 'arrived_at_customer' THEN
      UPDATE public.delivery_tracking
      SET delivery_step = 'arrived_at_customer', updated_at = now()
      WHERE id = v_dt.id;

    ELSIF p_action = 'customer_not_found' THEN
      UPDATE public.delivery_tracking
      SET delivery_step = 'customer_not_found', updated_at = now()
      WHERE id = v_dt.id;

    ELSIF p_action = 'collected' THEN
      v_amount := COALESCE(p_amount, 0);

      -- Reuse the existing lifecycle transition to 'delivered'.
      PERFORM public.governed_complete_delivery(p_token::text, v_dt.id);

      UPDATE public.delivery_tracking
      SET delivery_step = 'collected', updated_at = now()
      WHERE id = v_dt.id;

      -- Per-order collection record (never merged across orders).
      IF v_dt.collection_required AND p_amount IS NOT NULL THEN
        SELECT * INTO v_order FROM public.orders WHERE id = v_dt.order_id;

        SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences
        WHERE code_type = 'collection' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
        IF NOT FOUND THEN v_seq := 1; END IF;
        v_code := 'COL-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

        INSERT INTO public.collections (
          code, customer_id, owner_type, owner_id, method, amount, status, notes,
          collected_at, created_by, order_id
        )
        VALUES (
          v_code, v_order.customer_id, 'delivery', v_dt.id, 'cash', p_amount, 'pending',
          'طھط­طµظٹظ„ طھظˆطµظٹظ„ - ط·ظ„ط¨ ' || v_order.order_number, now(), v_session.employee_id, v_dt.order_id
        )
        RETURNING id INTO v_collection_id;

        INSERT INTO public.code_sequences (code_type, year, last_sequence)
        VALUES ('collection', EXTRACT(year FROM now())::int, v_seq)
        ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_seq;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'delivery_id', v_dt.id,
      'action', p_action,
      'delivery_step', p_action,
      'collection_id', v_collection_id,
      'order_status', (SELECT status FROM public.orders WHERE id = v_dt.order_id)
    );
  END IF;

  -- ====================== LEGACY TRANSITIONS ======================
  IF p_action = 'received' THEN
    UPDATE public.delivery_tracking
    SET status = 'out_for_delivery', started_at = now(), delivery_step = 'received', updated_at = now()
    WHERE id = v_dt.id;

  ELSIF p_action = 'moving_to_customer' THEN
    UPDATE public.delivery_tracking
    SET delivery_step = 'moving_to_customer', updated_at = now()
    WHERE id = v_dt.id;

  ELSIF p_action = 'arrived_at_customer' THEN
    UPDATE public.delivery_tracking
    SET delivery_step = 'arrived_at_customer', updated_at = now()
    WHERE id = v_dt.id;

  ELSIF p_action = 'customer_not_found' THEN
    UPDATE public.delivery_tracking
    SET delivery_step = 'customer_not_found', updated_at = now()
    WHERE id = v_dt.id;

  ELSIF p_action = 'collected' THEN
    v_amount := COALESCE(p_amount, 0);

    PERFORM public.governed_complete_delivery(p_token::text, v_dt.id);

    UPDATE public.delivery_tracking
    SET delivery_step = 'collected', updated_at = now()
    WHERE id = v_dt.id;

    IF v_dt.collection_required AND p_amount IS NOT NULL THEN
      SELECT * INTO v_order FROM public.orders WHERE id = v_dt.order_id;

      SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences
      WHERE code_type = 'collection' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
      IF NOT FOUND THEN v_seq := 1; END IF;
      v_code := 'COL-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

      INSERT INTO public.collections (
        code, customer_id, owner_type, owner_id, method, amount, status, notes,
        collected_at, created_by, order_id
      )
      VALUES (
        v_code, v_order.customer_id, 'delivery', v_dt.id, 'cash', p_amount, 'pending',
        'طھط­طµظٹظ„ طھظˆطµظٹظ„ - ط·ظ„ط¨ ' || v_order.order_number, now(), v_session.employee_id, v_dt.order_id
      )
      RETURNING id INTO v_collection_id;

      INSERT INTO public.code_sequences (code_type, year, last_sequence)
      VALUES ('collection', EXTRACT(year FROM now())::int, v_seq)
      ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_seq;
    END IF;

  ELSIF p_action = 'returned_to_company' THEN
    UPDATE public.delivery_tracking
    SET delivery_step = 'returned_to_company', returned_at = now(), updated_at = now()
    WHERE id = v_dt.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'delivery_id', v_dt.id,
    'action', p_action,
    'delivery_step', CASE p_action
      WHEN 'received' THEN 'received'
      WHEN 'moving_to_customer' THEN 'moving_to_customer'
      WHEN 'arrived_at_customer' THEN 'arrived_at_customer'
      WHEN 'customer_not_found' THEN 'customer_not_found'
      WHEN 'collected' THEN 'collected'
      ELSE 'returned_to_company'
    END,
    'collection_id', v_collection_id,
    'order_status', (SELECT status FROM public.orders WHERE id = v_dt.order_id)
  );
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_delivery_action(uuid, uuid, text, numeric, numeric, numeric, numeric, timestamptz) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_get_shipping_orders
-- Upper Management shipping list. Surfaces the active journey an order is
-- inside (journey_id / journey_code / journey_status) and gains an
-- 'in_journey' filter. 'need_crew' excludes orders already inside a journey.
-- Keeps the from/to creation-date range used by the time filter screen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_get_shipping_orders(
  p_token uuid,
  p_filter text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY
      CASE WHEN t.delivery_step = 'returned_to_company' THEN 1 ELSE 0 END,
      t.assigned_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      COALESCE(dt.id, o.id) AS delivery_id,
      o.id AS order_id,
      o.order_number,
      o.status AS order_status,
      COALESCE(c.company_name, o.snapshot_customer_name, '') AS customer_name,
      COALESCE(o.snapshot_customer_phone, '') AS customer_phone,
      COALESCE(ca.latitude, ul.latitude) AS customer_latitude,
      COALESCE(ca.longitude, ul.longitude) AS customer_longitude,
      o.total_amount,
      o.payment_method,
      o.invoice_number,
      o.invoice_total,
      (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id) AS items_count,
      dt.status AS delivery_status,
      dt.delivery_step,
      dt.collection_required,
      rep.full_name AS rep_name,
      drv.full_name AS driver_name,
      (dt.id IS NOT NULL) AS has_tracking,
      COALESCE(dt.attempt_number, 0) AS attempt_number,
      dt.assigned_to,
      dt.driver_id,
      dt.assigned_at,
      dt.started_at,
      dt.completed_at,
      dt.returned_at,
      j.journey_id,
      j.journey_code,
      j.journey_status,
      (SELECT jsonb_build_object(
         'action', a.action,
         'employee_name', COALESCE(e.full_name, ''),
         'latitude', a.latitude,
         'longitude', a.longitude,
         'amount', a.amount,
         'captured_at', a.captured_at
       )
       FROM public.delivery_actions a
       LEFT JOIN public.employees e ON e.id = a.employee_id
       WHERE a.delivery_tracking_id = dt.id
       ORDER BY a.created_at DESC LIMIT 1) AS last_action,
      (SELECT jsonb_build_object('status', co.status, 'amount', co.amount, 'collected_at', co.collected_at, 'approved_at', co.approved_at, 'id', co.id)
       FROM public.collections co
       WHERE co.order_id = o.id AND co.owner_type = 'delivery'
       ORDER BY co.created_at DESC LIMIT 1) AS collection
    FROM public.orders o
    LEFT JOIN LATERAL (
      SELECT d.id, d.order_id, d.status, d.assigned_to, d.assigned_by, d.assigned_at, d.started_at,
             d.completed_at, d.failure_reason, d.failure_notes, d.notes, d.returned_at, d.created_at,
             d.updated_at, d.attempt_number, d.is_active, d.external_carrier_id, d.waybill_number,
             d.tracking_url, d.vehicle_number, d.departure_date, d.carrier_name, d.carrier_delivery_date,
             d.driver_id, d.delivery_step, d.collection_required
      FROM public.delivery_tracking d
      WHERE d.order_id = o.id AND d.is_active = true
      ORDER BY d.created_at DESC
      LIMIT 1
    ) dt ON true
    LEFT JOIN LATERAL (
      SELECT dj.id AS journey_id, dj.journey_code, dj.status AS journey_status
      FROM public.journey_orders jo
      JOIN public.delivery_journeys dj ON dj.id = jo.journey_id
      WHERE jo.order_id = o.id AND dj.status <> 'returned'
      ORDER BY dj.created_at DESC
      LIMIT 1
    ) j ON true
    LEFT JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN LATERAL (
      SELECT ca.latitude, ca.longitude FROM public.customer_addresses ca
      WHERE ca.customer_id = c.id
      ORDER BY ca.is_default DESC NULLS LAST, ca.address_updated_at DESC NULLS LAST
      LIMIT 1
    ) ca ON true
    LEFT JOIN public.unified_locations ul ON ul.id = c.location_id
    LEFT JOIN public.employees rep ON rep.id = dt.assigned_to
    LEFT JOIN public.employees drv ON drv.id = dt.driver_id
    WHERE (
      o.status = 'dispatched'
      OR (dt.id IS NOT NULL AND dt.delivery_step IS NOT NULL)
    )
    AND (
      p_filter IS NULL
      OR (p_filter = 'need_crew' AND (dt.id IS NULL OR (dt.assigned_to IS NULL AND dt.driver_id IS NULL AND dt.delivery_step IS NULL)) AND j.journey_id IS NULL)
      OR (p_filter = 'in_delivery' AND dt.delivery_step IN ('received', 'moving_to_customer', 'arrived_at_customer', 'customer_not_found'))
      OR (p_filter = 'collected' AND dt.delivery_step = 'collected')
      OR (p_filter = 'returned_to_company' AND dt.delivery_step = 'returned_to_company')
      OR (p_filter = 'in_journey' AND j.journey_id IS NOT NULL)
    )
    AND (p_from IS NULL OR o.created_at >= p_from)
    AND (p_to IS NULL OR o.created_at < p_to)
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_get_shipping_orders(uuid, text, timestamptz, timestamptz) TO authenticated';
  END IF;
END
$grant$;

COMMIT;
