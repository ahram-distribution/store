-- ============================================================================
-- DELIVERY JOURNEY — PER-ORDER COLLECTION CONFIG + FULL EVENT HISTORY
-- ============================================================================
-- Surgical additions on top of 20260810_delivery_journey_model.sql and
-- 20260810_delivery_journey_rpcs.sql. No redesign of the journey model.
--
--   1. delivery_tracking.collection_amount: the expected collection amount for
--      an order (editable by Upper Management at journey creation). Does NOT
--      assume the order total is always the amount to collect.
--   2. governed_create_journey accepts p_collection jsonb with per-order
--      {order_id, required, amount}; collection_required + collection_amount
--      are written onto each order's delivery_tracking row.
--   3. _journey_orders_json / governed_get_shipping_orders surface the
--      persisted collection_amount.
--   4. _journey_totals_json adds total_collection_required (إجمالي التحصيل
--      المطلوب) = sum of required collection amounts (fallback to order total).
--   5. _journey_events_json now returns the COMPLETE timeline for real
--      journeys: journey-level events (started/returned) + every per-order
--      delivery_action (moving/arrived/customer_not_found/collected), ordered
--      by captured_at, each carrying employee, date/time, GPS coords,
--      order_number and amount. Virtual (legacy) journeys keep the mapped
--      started/returned view and gain order_number/amount.
-- ============================================================================

BEGIN;

-- ============================ TABLE CHANGE ================================

ALTER TABLE public.delivery_tracking
  ADD COLUMN IF NOT EXISTS collection_amount numeric(14,2);

-- ============================ INTERNAL HELPERS =============================

-- ---------------------------------------------------------------------------
-- _journey_orders_json: full order rows of a journey (+ collection config).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_orders_json(
  p_journey_id uuid,
  p_is_virtual boolean,
  p_emp uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(ord ORDER BY ord.delivery_step IS NOT NULL, ord.customer_name), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      dt.id AS delivery_id,
      o.id AS order_id,
      o.order_number,
      o.status AS order_status,
      COALESCE(c.company_name, o.snapshot_customer_name, '') AS customer_name,
      COALESCE(o.snapshot_customer_phone, '') AS customer_phone,
      COALESCE(o.snapshot_customer_address, '') AS customer_address,
      COALESCE(ca.latitude, ul.latitude) AS customer_latitude,
      COALESCE(ca.longitude, ul.longitude) AS customer_longitude,
      o.total_amount,
      o.payment_method,
      o.invoice_number,
      o.invoice_total,
      COALESCE(o.snapshot_owner_name, '') AS owner_name,
      COALESCE(o.snapshot_owner_phone, '') AS owner_phone,
      (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id) AS items_count,
      dt.status AS delivery_status,
      dt.delivery_step,
      dt.collection_required,
      dt.collection_amount,
      dt.assigned_at,
      dt.started_at,
      dt.completed_at,
      dt.returned_at,
      rep.full_name AS rep_name,
      drv.full_name AS driver_name,
      (p_emp IS NOT NULL AND dt.assigned_to = p_emp) AS is_rep,
      (p_emp IS NOT NULL AND dt.driver_id = p_emp) AS is_driver,
      (SELECT a.amount FROM public.delivery_actions a
       WHERE a.delivery_tracking_id = dt.id AND a.action = 'collected'
       ORDER BY a.created_at DESC LIMIT 1) AS collected_amount,
      (SELECT jsonb_build_object(
         'id', co.id,
         'status', co.status,
         'amount', co.amount,
         'collected_at', co.collected_at,
         'approved_at', co.approved_at
       )
       FROM public.collections co
       WHERE co.order_id = dt.order_id AND co.owner_type = 'delivery'
       ORDER BY co.created_at DESC LIMIT 1) AS collection,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'action', a.action,
          'employee_id', a.employee_id,
          'employee_name', COALESCE(e.full_name, ''),
          'amount', a.amount,
          'latitude', a.latitude,
          'longitude', a.longitude,
          'captured_at', a.captured_at,
          'created_at', a.created_at
        ) ORDER BY a.created_at)
        FROM public.delivery_actions a
        LEFT JOIN public.employees e ON e.id = a.employee_id
        WHERE a.delivery_tracking_id = dt.id
      ), '[]'::jsonb) AS actions
    FROM public.delivery_tracking dt
    JOIN public.orders o ON o.id = dt.order_id
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
    WHERE dt.is_active = true
      AND (
        (p_is_virtual = false AND dt.journey_id = p_journey_id)
        OR (p_is_virtual = true AND dt.id = p_journey_id)
      )
  ) ord;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- ---------------------------------------------------------------------------
-- _journey_totals_json: orders_count / total_value / total_collected /
-- total_collection_required.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_totals_json(
  p_journey_id uuid,
  p_is_virtual boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'orders_count', count(*)::int,
    'total_value', COALESCE(sum(o.total_amount), 0),
    'total_collected', COALESCE(sum(COALESCE(a.amount, 0)), 0),
    'total_collection_required', COALESCE(sum(
      CASE WHEN dt.collection_required THEN COALESCE(dt.collection_amount, o.total_amount) ELSE 0 END
    ), 0)
  )
  INTO v_result
  FROM public.delivery_tracking dt
  JOIN public.orders o ON o.id = dt.order_id
  LEFT JOIN LATERAL (
    SELECT amount FROM public.delivery_actions da
    WHERE da.delivery_tracking_id = dt.id AND da.action = 'collected'
    ORDER BY da.created_at DESC LIMIT 1
  ) a ON true
  WHERE dt.is_active = true
    AND (
      (p_is_virtual = false AND dt.journey_id = p_journey_id)
      OR (p_is_virtual = true AND dt.id = p_journey_id)
    );

  RETURN COALESCE(v_result, '{"orders_count":0,"total_value":0,"total_collected":0,"total_collection_required":0}'::jsonb);
END;
$function$;

-- ---------------------------------------------------------------------------
-- _journey_events_json: COMPLETE journey timeline.
--   Real journeys: journey_events (started/returned) UNION per-order
--   delivery_actions, ordered by captured_at. Each event carries the employee,
--   date/time (captured_at), GPS coordinates, order_number and amount.
--   Virtual (legacy) journeys: mapped started/returned events only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_events_json(
  p_journey_id uuid,
  p_is_virtual boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_is_virtual THEN
    SELECT COALESCE(jsonb_agg(ev ORDER BY ev.created_at), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT
        CASE WHEN da.action = 'received' THEN 'started'
             WHEN da.action = 'returned_to_company' THEN 'returned'
             ELSE da.action END AS action,
        da.employee_id,
        COALESCE(e.full_name, '') AS employee_name,
        o.order_number,
        da.amount,
        da.latitude, da.longitude, da.captured_at, da.created_at
      FROM public.delivery_actions da
      LEFT JOIN public.employees e ON e.id = da.employee_id
      LEFT JOIN public.delivery_tracking dt ON dt.id = da.delivery_tracking_id
      LEFT JOIN public.orders o ON o.id = da.order_id
      WHERE da.delivery_tracking_id = p_journey_id
        AND da.action IN ('received', 'returned_to_company')
    ) ev;
  ELSE
    SELECT COALESCE(jsonb_agg(ev ORDER BY ev.captured_at NULLS LAST, ev.created_at), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT
        'journey'::text AS source,
        je.action,
        je.employee_id,
        COALESCE(e.full_name, '') AS employee_name,
        NULL::text AS order_number,
        NULL::numeric AS amount,
        je.latitude,
        je.longitude,
        je.captured_at,
        je.created_at
      FROM public.journey_events je
      LEFT JOIN public.employees e ON e.id = je.employee_id
      WHERE je.journey_id = p_journey_id

      UNION ALL

      SELECT
        'order'::text AS source,
        da.action,
        da.employee_id,
        COALESCE(e.full_name, '') AS employee_name,
        o.order_number,
        da.amount,
        da.latitude,
        da.longitude,
        da.captured_at,
        da.created_at
      FROM public.delivery_actions da
      JOIN public.delivery_tracking dt ON dt.id = da.delivery_tracking_id
      JOIN public.orders o ON o.id = da.order_id
      LEFT JOIN public.employees e ON e.id = da.employee_id
      WHERE dt.journey_id = p_journey_id AND dt.is_active = true
    ) ev;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- ============================ RPCs ===========================================

-- ---------------------------------------------------------------------------
-- governed_create_journey
-- Adds p_collection jsonb: array of {order_id, required, amount}. Per-order
-- collection_required / collection_amount are written onto each order's
-- delivery_tracking row. Amount falls back to the order total when required
-- and no amount was supplied.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_create_journey(
  p_token uuid,
  p_order_ids uuid[],
  p_rep_id uuid DEFAULT NULL,
  p_driver_id uuid DEFAULT NULL,
  p_collection jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_seq int;
  v_code text;
  v_journey public.delivery_journeys;
  v_bad uuid;
  v_dt public.delivery_tracking;
  v_order_id uuid;
  v_cfg jsonb;
  v_required boolean;
  v_amount numeric;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  IF p_order_ids IS NULL OR cardinality(p_order_ids) = 0 THEN
    RETURN jsonb_build_object('error', 'NO_ORDERS');
  END IF;

  IF p_rep_id IS NULL AND p_driver_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_CREW');
  END IF;

  -- Every order must exist, be dispatched, and not be inside an active journey.
  SELECT t.id INTO v_bad
  FROM unnest(p_order_ids) t(id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = t.id
  )
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = t.id AND o.status <> 'dispatched'
  )
  OR EXISTS (
    SELECT 1 FROM public.journey_orders jo
    JOIN public.delivery_journeys dj ON dj.id = jo.journey_id
    WHERE jo.order_id = t.id AND dj.status <> 'returned'
  )
  LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'INVALID_ORDER_STATE', 'order_id', v_bad);
  END IF;

  SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences
  WHERE code_type = 'journey' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
  IF NOT FOUND THEN v_seq := 1; END IF;
  v_code := 'JRN-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

  INSERT INTO public.delivery_journeys (
    journey_code, status, assigned_to, driver_id, assigned_by, assigned_at
  )
  VALUES (
    v_code, 'assigned', p_rep_id, p_driver_id, v_session.employee_id, now()
  )
  RETURNING * INTO v_journey;

  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('journey', EXTRACT(year FROM now())::int, v_seq)
  ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_seq;

  FOR v_order_id IN
    SELECT DISTINCT id FROM unnest(p_order_ids) id
  LOOP
    INSERT INTO public.journey_orders (journey_id, order_id)
    VALUES (v_journey.id, v_order_id);

    v_cfg := NULL;
    v_required := true;
    v_amount := NULL;
    IF p_collection IS NOT NULL AND jsonb_typeof(p_collection) = 'array' THEN
      SELECT j.value INTO v_cfg
      FROM jsonb_array_elements(p_collection) j
      WHERE j.value->>'order_id' = v_order_id::text;
      IF v_cfg IS NOT NULL THEN
        v_required := COALESCE((v_cfg->>'required')::boolean, true);
        v_amount := NULLIF(v_cfg->>'amount', '')::numeric;
      END IF;
    END IF;
    IF v_required AND v_amount IS NULL THEN
      SELECT total_amount INTO v_amount FROM public.orders WHERE id = v_order_id;
    END IF;

    SELECT * INTO v_dt FROM public.delivery_tracking
    WHERE order_id = v_order_id AND is_active = true
    ORDER BY created_at DESC LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.delivery_tracking (
        order_id, status, assigned_to, driver_id, assigned_by, assigned_at,
        is_active, attempt_number, journey_id, collection_required, collection_amount
      )
      VALUES (
        v_order_id, 'assigned', p_rep_id, p_driver_id, v_session.employee_id, now(),
        true, 1, v_journey.id, v_required,
        CASE WHEN v_required THEN v_amount ELSE NULL END
      );
    ELSE
      UPDATE public.delivery_tracking
      SET assigned_to = COALESCE(p_rep_id, assigned_to),
          driver_id = COALESCE(p_driver_id, driver_id),
          assigned_by = v_session.employee_id,
          assigned_at = now(),
          journey_id = v_journey.id,
          collection_required = v_required,
          collection_amount = CASE WHEN v_required THEN v_amount ELSE NULL END,
          updated_at = now()
      WHERE id = v_dt.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'journey_id', v_journey.id,
    'journey_code', v_journey.journey_code
  );
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_create_journey(uuid, uuid[], uuid, uuid, jsonb) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_get_shipping_orders
-- Adds collection_amount so the journey build screen can prefill the expected
-- collection per order. Only the SELECT list changes.
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
      dt.collection_amount,
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
             d.driver_id, d.delivery_step, d.collection_required, d.collection_amount
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
