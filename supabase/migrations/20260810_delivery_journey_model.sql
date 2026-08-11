-- ============================================================================
-- DELIVERY JOURNEY MODEL — رحلة واحدة = عدة طلبات
-- ============================================================================
-- Follows 20260809_delivery_operations.sql and
-- 20260810_delivery_journey_visibility.sql. Introduces the journey concept:
--
--   * A journey (رحلة) groups ONE OR MORE shipped orders with a single crew
--     (مندوب توصيل / سائق — both optional, one of them must exist).
--   * delivery_journeys     : journey header (crew, status, start/return).
--   * journey_orders        : journey -> order membership (1 order = 1 active
--                             journey).
--   * journey_events        : journey-level events (استلام الشحنة = started,
--                             الرجوع لمقر الشركة = returned).
--   * Per-order steps stay on the existing delivery_tracking row
--     (delivery_step) + delivery_actions (events) + collections. delivery_tracking
--     gains a journey_id column linking each order row to its journey.
--
-- FLOW:
--   UM builds a journey from dispatched orders (governed_create_journey) ->
--   crew member taps "استلام الشحنة" (governed_start_journey, starts GPS) ->
--   per order: بدء التحرك -> وصول -> نتيجة (تم الوصول / لم يتم العثور) ->
--   تحصيل (تم التحصيل + مبلغ / بدون تحصيل) -> journey returns
--   (governed_return_journey, stops GPS, order statuses unchanged).
--
-- COMPATIBILITY:
--   Legacy per-order deliveries (delivery_tracking.journey_id IS NULL) keep the
--   old 5-step flow untouched. The employee screens unify them as "virtual"
--   single-order journeys so existing tasks stay visible and actionable.
--
-- SAFETY: Written as code only (same policy as the delivery_operations file);
-- it is NOT applied to the live Supabase project.
-- ============================================================================

BEGIN;

-- ============================ TABLE CHANGES ================================

-- Link each order's tracking row to its journey.
ALTER TABLE public.delivery_tracking ADD COLUMN IF NOT EXISTS journey_id uuid;
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_journey ON public.delivery_tracking (journey_id) WHERE journey_id IS NOT NULL;

-- Journey header: crew + lifecycle timestamps.
CREATE TABLE IF NOT EXISTS public.delivery_journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_code text UNIQUE,
  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'returned')),
  assigned_to uuid REFERENCES public.employees(id),
  driver_id uuid REFERENCES public.employees(id),
  assigned_by uuid,
  assigned_at timestamptz,
  started_at timestamptz,
  returned_at timestamptz,
  return_latitude numeric(10,7),
  return_longitude numeric(10,7),
  return_accuracy numeric(8,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_journeys_crew ON public.delivery_journeys (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_journeys_driver ON public.delivery_journeys (driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_journeys_status ON public.delivery_journeys (status);

-- Journey <-> order membership. One order can belong to at most one active
-- journey (governed_create_journey enforces it at build time).
CREATE TABLE IF NOT EXISTS public.journey_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES public.delivery_journeys(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (journey_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_journey_orders_journey ON public.journey_orders (journey_id);
CREATE INDEX IF NOT EXISTS idx_journey_orders_order ON public.journey_orders (order_id);

-- Journey-level events (استلام الشحنة / الرجوع لمقر الشركة).
CREATE TABLE IF NOT EXISTS public.journey_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES public.delivery_journeys(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('started', 'returned')),
  latitude numeric(10,7),
  longitude numeric(10,7),
  accuracy_meters numeric(8,2),
  captured_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journey_events_journey ON public.journey_events (journey_id, created_at);

-- RLS: journey tables are read/written through SECURITY DEFINER RPCs; only
-- Upper Management has direct access (mirrors delivery_actions).
ALTER TABLE public.delivery_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "upper_management_all_delivery_journeys" ON public.delivery_journeys;
CREATE POLICY "upper_management_all_delivery_journeys"
  ON public.delivery_journeys
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

DROP POLICY IF EXISTS "upper_management_all_journey_orders" ON public.journey_orders;
CREATE POLICY "upper_management_all_journey_orders"
  ON public.journey_orders
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

DROP POLICY IF EXISTS "upper_management_all_journey_events" ON public.journey_events;
CREATE POLICY "upper_management_all_journey_events"
  ON public.journey_events
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_journeys TO authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.journey_orders TO authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.journey_events TO authenticated';
  END IF;
END
$grant$;

-- ============================ INTERNAL HELPERS ==============================
-- Not granted to authenticated; reused by the governed_* RPCs so journey JSON
-- shaping lives in one place.

-- ---------------------------------------------------------------------------
-- _journey_orders_json: full order rows of a journey.
--   p_journey_id : journey id (real) or delivery_tracking id (virtual)
--   p_is_virtual : true -> the single legacy order of that tracking row
--   p_emp        : calling employee id (for is_rep/is_driver), or NULL (UM)
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
-- _journey_totals_json: orders_count / total_value / total_collected.
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
    'total_collected', COALESCE(sum(COALESCE(a.amount, 0)), 0)
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

  RETURN COALESCE(v_result, '{"orders_count":0,"total_value":0,"total_collected":0}'::jsonb);
END;
$function$;

-- ---------------------------------------------------------------------------
-- _journey_events_json: journey-level events. For virtual (legacy) journeys
-- the received / returned_to_company order actions become started / returned.
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
             WHEN da.action = 'returned_to_company' THEN 'returned' END AS action,
        COALESCE(e.full_name, '') AS employee_name,
        da.latitude, da.longitude, da.captured_at, da.created_at
      FROM public.delivery_actions da
      LEFT JOIN public.employees e ON e.id = da.employee_id
      WHERE da.delivery_tracking_id = p_journey_id
        AND da.action IN ('received', 'returned_to_company')
    ) ev;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'action', je.action,
      'employee_id', je.employee_id,
      'employee_name', COALESCE(e.full_name, ''),
      'latitude', je.latitude,
      'longitude', je.longitude,
      'captured_at', je.captured_at,
      'created_at', je.created_at
    ) ORDER BY je.created_at), '[]'::jsonb)
    INTO v_result
    FROM public.journey_events je
    LEFT JOIN public.employees e ON e.id = je.employee_id
    WHERE je.journey_id = p_journey_id;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- ============================ RPCs ===========================================

-- ---------------------------------------------------------------------------
-- governed_create_journey
-- Upper Management builds a journey from dispatched orders. Each order must be
-- 'dispatched' and not already inside an active journey. The crew is attached
-- to the journey and mirrored onto each order's delivery_tracking row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_create_journey(
  p_token uuid,
  p_order_ids uuid[],
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
  v_seq int;
  v_code text;
  v_journey public.delivery_journeys;
  v_bad uuid;
  v_dt public.delivery_tracking;
  v_order_id uuid;
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

    SELECT * INTO v_dt FROM public.delivery_tracking
    WHERE order_id = v_order_id AND is_active = true
    ORDER BY created_at DESC LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.delivery_tracking (
        order_id, status, assigned_to, driver_id, assigned_by, assigned_at,
        is_active, attempt_number, journey_id
      )
      VALUES (
        v_order_id, 'assigned', p_rep_id, p_driver_id, v_session.employee_id, now(),
        true, 1, v_journey.id
      );
    ELSE
      UPDATE public.delivery_tracking
      SET assigned_to = COALESCE(p_rep_id, assigned_to),
          driver_id = COALESCE(p_driver_id, driver_id),
          assigned_by = v_session.employee_id,
          assigned_at = now(),
          journey_id = v_journey.id,
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
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_create_journey(uuid, uuid[], uuid, uuid) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_update_journey_crew
-- Upper Management reassigns the crew before the journey starts. The crew is
-- mirrored onto each order's delivery_tracking row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_update_journey_crew(
  p_token uuid,
  p_journey_id uuid,
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
  v_journey public.delivery_journeys;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  SELECT * INTO v_journey FROM public.delivery_journeys WHERE id = p_journey_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_journey.status <> 'assigned' THEN RETURN jsonb_build_object('error', 'JOURNEY_STARTED'); END IF;
  IF p_rep_id IS NULL AND p_driver_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_CREW');
  END IF;

  UPDATE public.delivery_journeys
  SET assigned_to = p_rep_id,
      driver_id = p_driver_id,
      assigned_by = v_session.employee_id,
      assigned_at = now(),
      updated_at = now()
  WHERE id = p_journey_id;

  UPDATE public.delivery_tracking
  SET assigned_to = COALESCE(p_rep_id, assigned_to),
      driver_id = COALESCE(p_driver_id, driver_id),
      updated_at = now()
  WHERE journey_id = p_journey_id AND is_active = true;

  RETURN jsonb_build_object(
    'success', true,
    'journey_id', p_journey_id,
    'rep_id', p_rep_id,
    'driver_id', p_driver_id
  );
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_update_journey_crew(uuid, uuid, uuid, uuid) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_start_journey
-- "استلام الشحنة": crew member (or UM) starts the journey. Marks it
-- in_progress, records the journey event, sets every order's tracking status to
-- out_for_delivery. Client starts GPS tracking on success.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_start_journey(
  p_token uuid,
  p_journey_id uuid,
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
  v_journey public.delivery_journeys;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT * INTO v_journey FROM public.delivery_journeys WHERE id = p_journey_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF NOT public.is_upper_management(v_session.employee_id)
     AND COALESCE(v_journey.assigned_to, v_journey.driver_id) IS DISTINCT FROM v_session.employee_id
     AND COALESCE(v_journey.driver_id, v_journey.assigned_to) IS DISTINCT FROM v_session.employee_id THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  IF v_journey.status <> 'assigned' THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE', 'status', v_journey.status);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.journey_orders WHERE journey_id = p_journey_id) THEN
    RETURN jsonb_build_object('error', 'NO_ORDERS');
  END IF;

  UPDATE public.delivery_journeys
  SET status = 'in_progress', started_at = now(), updated_at = now()
  WHERE id = p_journey_id;

  INSERT INTO public.journey_events (
    journey_id, employee_id, action, latitude, longitude, accuracy_meters, captured_at
  )
  VALUES (
    p_journey_id, v_session.employee_id, 'started',
    p_latitude, p_longitude, p_accuracy_meters,
    COALESCE(p_captured_at, now())
  );

  UPDATE public.delivery_tracking
  SET status = 'out_for_delivery', updated_at = now()
  WHERE journey_id = p_journey_id AND is_active = true AND status = 'assigned';

  RETURN jsonb_build_object('success', true, 'journey_id', p_journey_id, 'status', 'in_progress');
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_start_journey(uuid, uuid, numeric, numeric, numeric, timestamptz) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_return_journey
-- "الرجوع لمقر الشركة": crew member (or UM) ends the journey. Stops tracking
-- on the client, records the return time + location as a journey event. Order
-- statuses are left unchanged (the journey may return before all orders finish).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_return_journey(
  p_token uuid,
  p_journey_id uuid,
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
  v_journey public.delivery_journeys;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT * INTO v_journey FROM public.delivery_journeys WHERE id = p_journey_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF NOT public.is_upper_management(v_session.employee_id)
     AND COALESCE(v_journey.assigned_to, v_journey.driver_id) IS DISTINCT FROM v_session.employee_id
     AND COALESCE(v_journey.driver_id, v_journey.assigned_to) IS DISTINCT FROM v_session.employee_id THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  IF v_journey.status <> 'in_progress' THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE', 'status', v_journey.status);
  END IF;

  UPDATE public.delivery_journeys
  SET status = 'returned', returned_at = now(),
      return_latitude = p_latitude, return_longitude = p_longitude,
      return_accuracy = p_accuracy_meters,
      updated_at = now()
  WHERE id = p_journey_id;

  INSERT INTO public.journey_events (
    journey_id, employee_id, action, latitude, longitude, accuracy_meters, captured_at
  )
  VALUES (
    p_journey_id, v_session.employee_id, 'returned',
    p_latitude, p_longitude, p_accuracy_meters,
    COALESCE(p_captured_at, now())
  );

  RETURN jsonb_build_object('success', true, 'journey_id', p_journey_id, 'status', 'returned');
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_return_journey(uuid, uuid, numeric, numeric, numeric, timestamptz) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_get_my_journeys
-- Employee list: real journeys (crew member) + virtual journeys for legacy
-- per-order deliveries. Completed (returned) items stay visible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_get_my_journeys(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_emp uuid;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  v_emp := v_session.employee_id;

  SELECT COALESCE(jsonb_agg(t ORDER BY
      CASE WHEN t.status = 'returned' THEN 1 ELSE 0 END,
      t.assigned_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      j.journey_id,
      j.journey_code,
      j.status,
      j.is_virtual,
      j.rep_name,
      j.driver_name,
      j.assigned_at,
      j.started_at,
      j.returned_at,
      public._journey_orders_json(j.journey_id, j.is_virtual, v_emp) AS orders,
      public._journey_totals_json(j.journey_id, j.is_virtual) AS totals,
      public._journey_events_json(j.journey_id, j.is_virtual) AS events
    FROM (
      SELECT
        dj.id AS journey_id,
        dj.journey_code,
        dj.status,
        false AS is_virtual,
        rep.full_name AS rep_name,
        drv.full_name AS driver_name,
        dj.assigned_at,
        dj.started_at,
        dj.returned_at
      FROM public.delivery_journeys dj
      LEFT JOIN public.employees rep ON rep.id = dj.assigned_to
      LEFT JOIN public.employees drv ON drv.id = dj.driver_id
      WHERE (dj.assigned_to = v_emp OR dj.driver_id = v_emp)

      UNION ALL

      SELECT
        dt.id AS journey_id,
        NULL AS journey_code,
        CASE WHEN dt.delivery_step = 'returned_to_company' THEN 'returned'
             WHEN dt.delivery_step IS NOT NULL THEN 'in_progress'
             ELSE 'assigned' END AS status,
        true AS is_virtual,
        rep.full_name AS rep_name,
        drv.full_name AS driver_name,
        dt.assigned_at,
        dt.started_at,
        dt.returned_at
      FROM public.delivery_tracking dt
      LEFT JOIN public.employees rep ON rep.id = dt.assigned_to
      LEFT JOIN public.employees drv ON drv.id = dt.driver_id
      WHERE dt.is_active = true
        AND dt.journey_id IS NULL
        AND (dt.assigned_to = v_emp OR dt.driver_id = v_emp)
    ) j
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_get_my_journeys(uuid) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_get_journey
-- Single journey detail (employee crew member or Upper Management). For legacy
-- deliveries the id is a delivery_tracking id (virtual journey).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_get_journey(p_token uuid, p_journey_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_emp uuid;
  v_is_virtual boolean;
  v_rep_name text;
  v_driver_name text;
  v_status text;
  v_code text;
  v_assigned_at timestamptz;
  v_started_at timestamptz;
  v_returned_at timestamptz;
  v_journey public.delivery_journeys;
  v_dt public.delivery_tracking;
  v_can_manage boolean;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  v_emp := v_session.employee_id;

  SELECT * INTO v_journey FROM public.delivery_journeys WHERE id = p_journey_id;
  IF FOUND THEN
    v_is_virtual := false;
    v_status := v_journey.status;
    v_code := v_journey.journey_code;
    v_assigned_at := v_journey.assigned_at;
    v_started_at := v_journey.started_at;
    v_returned_at := v_journey.returned_at;
    SELECT COALESCE(rep.full_name, '') INTO v_rep_name FROM public.employees rep WHERE rep.id = v_journey.assigned_to;
    SELECT COALESCE(drv.full_name, '') INTO v_driver_name FROM public.employees drv WHERE drv.id = v_journey.driver_id;
    v_can_manage := public.is_upper_management(v_emp)
      OR COALESCE(v_journey.assigned_to, v_journey.driver_id) = v_emp
      OR COALESCE(v_journey.driver_id, v_journey.assigned_to) = v_emp;
    IF NOT v_can_manage THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  ELSE
    SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_journey_id;
    IF NOT FOUND OR NOT v_dt.is_active THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
    v_is_virtual := true;
    v_status := CASE WHEN v_dt.delivery_step = 'returned_to_company' THEN 'returned'
                     WHEN v_dt.delivery_step IS NOT NULL THEN 'in_progress'
                     ELSE 'assigned' END;
    v_code := NULL;
    v_assigned_at := v_dt.assigned_at;
    v_started_at := v_dt.started_at;
    v_returned_at := v_dt.returned_at;
    SELECT COALESCE(rep.full_name, '') INTO v_rep_name FROM public.employees rep WHERE rep.id = v_dt.assigned_to;
    SELECT COALESCE(drv.full_name, '') INTO v_driver_name FROM public.employees drv WHERE drv.id = v_dt.driver_id;
    v_can_manage := public.is_upper_management(v_emp)
      OR COALESCE(v_dt.assigned_to, v_dt.driver_id) = v_emp
      OR COALESCE(v_dt.driver_id, v_dt.assigned_to) = v_emp;
    IF NOT v_can_manage THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  END IF;

  v_result := jsonb_build_object(
    'journey_id', p_journey_id,
    'journey_code', v_code,
    'status', v_status,
    'is_virtual', v_is_virtual,
    'rep_name', v_rep_name,
    'driver_name', v_driver_name,
    'assigned_at', v_assigned_at,
    'started_at', v_started_at,
    'returned_at', v_returned_at,
    'can_manage', v_can_manage,
    'orders', public._journey_orders_json(p_journey_id, v_is_virtual, v_emp),
    'totals', public._journey_totals_json(p_journey_id, v_is_virtual),
    'events', public._journey_events_json(p_journey_id, v_is_virtual)
  );

  RETURN v_result;
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_get_journey(uuid, uuid) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_get_journeys
-- Upper Management list of all real journeys. Filters: 'active' (assigned +
-- in_progress), 'returned', NULL (all).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_get_journeys(
  p_token uuid,
  p_filter text DEFAULT NULL
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
      CASE WHEN t.status = 'returned' THEN 1 ELSE 0 END,
      t.assigned_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      dj.id AS journey_id,
      dj.journey_code,
      dj.status,
      false AS is_virtual,
      rep.full_name AS rep_name,
      drv.full_name AS driver_name,
      dj.assigned_at,
      dj.started_at,
      dj.returned_at,
      public._journey_orders_json(dj.id, false, NULL) AS orders,
      public._journey_totals_json(dj.id, false) AS totals,
      public._journey_events_json(dj.id, false) AS events
    FROM public.delivery_journeys dj
    LEFT JOIN public.employees rep ON rep.id = dj.assigned_to
    LEFT JOIN public.employees drv ON drv.id = dj.driver_id
    WHERE (
      p_filter IS NULL
      OR (p_filter = 'active' AND dj.status IN ('assigned', 'in_progress'))
      OR (p_filter = 'returned' AND dj.status = 'returned')
    )
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_get_journeys(uuid, text) TO authenticated';
  END IF;
END
$grant$;

COMMIT;
