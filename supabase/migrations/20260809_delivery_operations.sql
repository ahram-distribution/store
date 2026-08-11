-- ============================================================================
-- DELIVERY OPERATIONS — مندوب توصيل + سائق
-- ============================================================================
-- Adds the two delivery roles (reactivating the deprecated 'التوصيل' role as
-- the displayed role 'مندوب توصيل'), a two-assignee delivery model, a per-order
-- four-step delivery workflow, and Upper-Management shipping management.
--
-- ORDER LIFECYCLE REUSE:
--   * "تم الشحن" = existing 'dispatched' order status (set by
--     governed_dispatch_order, which also creates the delivery_tracking row).
--   * The order reaches the existing terminal 'delivered' state ONLY through
--     the existing governed_complete_delivery RPC (delivery_tracking.status
--     'delivered' + orders.status 'delivered' + delivered_at + credit-invoice
--     handling). It is invoked at the third step ("تم التحصيل") because the
--     delivery to the customer is complete at collection time. This is the
--     existing lifecycle contract: dispatched orders can only move forward to
--     a terminal state via governed_complete_delivery (or the failure paths),
--     so the four-step flow MUST reuse it — no new 'delivered' transition is
--     introduced.
--   * The four delivery actions are recorded as per-order EVENTS in
--     delivery_actions — no new order status represents them.
--
-- TRACKING REUSE:
--   The device continuously tracks via the existing trackingEngine /
--   tracking_points / sync_tracking_points infrastructure. Delivery action
--   locations are additionally stored on each delivery_actions row, so event
--   locations and "last known location" work even when no workday session is
--   active. tracking_points.session_id is FK-bound to workday_sessions, so the
--   client starts trackingEngine with the employee's active workday session id.
--
-- COLLECTION REUSE:
--   Each order gets its own row in the existing collections table
--   (owner_type='delivery', order_id set, status 'pending'). Upper Management
--   reconciles each individually via governed_reconcile_delivery_collection
--   (which reuses the collections 'pending' -> 'approved' status contract).
--
-- SAFETY: Written for later deployment. This migration was created as code
-- only; it is NOT applied to the live Supabase project.
-- ============================================================================

BEGIN;

-- ============================ ROLES & NORMALIZATION =========================

-- The deprecated 'التوصيل' role becomes the displayed role 'مندوب توصيل'.
-- Handles both historical spellings ('التوصيل' / 'توصيل').
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.roles WHERE name IN ('التوصيل', 'توصيل')) THEN
    UPDATE public.roles
    SET name = 'مندوب توصيل',
        description = 'مندوب توصيل الطلبات',
        is_system = true
    WHERE name IN ('التوصيل', 'توصيل');
  ELSIF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'مندوب توصيل') THEN
    INSERT INTO public.roles (id, name, description, is_system)
    VALUES (gen_random_uuid(), 'مندوب توصيل', 'مندوب توصيل الطلبات', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'سائق') THEN
    INSERT INTO public.roles (id, name, description, is_system)
    VALUES (gen_random_uuid(), 'سائق', 'سائق التوصيل', true);
  END IF;
END $$;

-- role_normalization exists on the Supabase project; the desktop local
-- snapshot does not carry it, so it is only seeded when the table exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'role_normalization') THEN
    INSERT INTO public.role_normalization (old_role_name, target_role_name, status) VALUES
      ('التوصيل',     'مندوب توصيل', 'mapped'),
      ('توصيل',       'مندوب توصيل', 'mapped'),
      ('delivery',    'مندوب توصيل', 'mapped'),
      ('مندوب توصيل', 'مندوب توصيل', 'new'),
      ('سائق',        'سائق',        'new'),
      ('driver',      'سائق',        'mapped')
    ON CONFLICT (old_role_name) DO UPDATE SET
      target_role_name = EXCLUDED.target_role_name,
      status = EXCLUDED.status;
  END IF;
END $$;

-- Grant the operational delivery capability to both roles.
INSERT INTO public.role_capabilities (id, role_id, capability_id)
SELECT gen_random_uuid(), r.id, c.id
FROM public.roles r
CROSS JOIN public.capabilities c
WHERE r.name IN ('مندوب توصيل', 'سائق')
  AND c.code = 'delivery.deliver'
ON CONFLICT DO NOTHING;

-- ============================= TABLE CHANGES ================================

-- Two-assignee model: assigned_to = مندوب توصيل, driver_id = سائق.
-- delivery_step tracks the current step of the 4-action sequence.
-- collection_required: مطلوب التحصيل (default) vs بدون تحصيل. Set by Upper
-- Management before the delivery starts; when false the "تم التحصيل" step is
-- still performed (order is handed over / completed) but no collections row is
-- created and no amount is entered.
ALTER TABLE public.delivery_tracking
  ADD COLUMN IF NOT EXISTS driver_id uuid,
  ADD COLUMN IF NOT EXISTS delivery_step text,
  ADD COLUMN IF NOT EXISTS collection_required boolean DEFAULT true;

-- Delivery collections are per-order rows in the existing collections table
-- owned by the delivery_tracking row (owner_type 'delivery'). The historical
-- constraint (phase6) only allowed owner_type 'employee'; widen it so delivery
-- collections can be created. All other producers keep using 'employee'.
ALTER TABLE public.collections DROP CONSTRAINT IF EXISTS ck_collections_owner_type;
ALTER TABLE public.collections ADD CONSTRAINT ck_collections_owner_type
  CHECK (owner_type IN ('employee', 'delivery'));

-- Per-order delivery action events (the four steps).
CREATE TABLE IF NOT EXISTS public.delivery_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  delivery_tracking_id uuid NOT NULL REFERENCES public.delivery_tracking(id),
  employee_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('received', 'moving_to_customer', 'collected', 'returned_to_company')),
  amount numeric,
  latitude numeric(10,7),
  longitude numeric(10,7),
  accuracy_meters numeric(8,2),
  captured_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_actions_tracking ON public.delivery_actions (delivery_tracking_id, created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_actions_order ON public.delivery_actions (order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_actions_employee ON public.delivery_actions (employee_id, created_at);

ALTER TABLE public.delivery_actions ENABLE ROW LEVEL SECURITY;

-- Delivery actions are read/written through SECURITY DEFINER RPCs; Upper
-- Management (and only Upper Management) also has direct access.
DROP POLICY IF EXISTS "upper_management_all_delivery_actions" ON public.delivery_actions;
CREATE POLICY "upper_management_all_delivery_actions"
  ON public.delivery_actions
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_actions TO authenticated';
  END IF;
END
$grant$;

-- ============================ RPCs ===========================================

-- ---------------------------------------------------------------------------
-- governed_assign_delivery_crew
-- Assigns / updates the delivery crew of an active delivery. Both members are
-- optional (مندوب توصيل only / سائق only / both). Upper Management only.
-- ---------------------------------------------------------------------------
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
    IF EXISTS (
      SELECT 1 FROM public.delivery_tracking WHERE order_id = p_delivery_id AND is_active = true
    ) THEN
      RETURN jsonb_build_object('error', 'ORDER_TRACKING_EXISTS');
    END IF;
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
  ELSE
    IF NOT v_dt.is_active THEN RETURN jsonb_build_object('error', 'DELIVERY_INACTIVE'); END IF;
    IF v_dt.delivery_step IS NOT NULL THEN RETURN jsonb_build_object('error', 'DELIVERY_STARTED'); END IF;

    UPDATE public.delivery_tracking
    SET assigned_to = COALESCE(p_rep_id, assigned_to),
        driver_id = COALESCE(p_driver_id, driver_id),
        assigned_by = v_session.employee_id,
        assigned_at = now(),
        updated_at = now()
    WHERE id = p_delivery_id
    RETURNING * INTO v_dt;
  END IF;

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

-- ---------------------------------------------------------------------------
-- governed_set_delivery_collection_required
-- Upper Management sets whether the order requires collection (مطلوب التحصيل)
-- or is delivered بدون تحصيل. Only before the delivery starts. Upper
-- Management only.
-- ---------------------------------------------------------------------------
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  -- Only Upper Management (الإدارة العليا) can dispatch / assign crews.
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_dt.delivery_step IS NOT NULL THEN RETURN jsonb_build_object('error', 'DELIVERY_STARTED'); END IF;

  UPDATE public.delivery_tracking
  SET collection_required = p_collection_required, updated_at = now()
  WHERE id = p_delivery_id;

  RETURN jsonb_build_object(
    'success', true,
    'delivery_id', p_delivery_id,
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

-- ---------------------------------------------------------------------------
-- governed_get_my_delivery_orders
-- Returns the active deliveries assigned to the calling employee (as مندوب
-- توصيل or سائق). Excludes fully-returned deliveries. Includes order summary,
-- crew, current step, the full action event history and collection state.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_get_my_delivery_orders(p_token uuid)
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

  SELECT COALESCE(jsonb_agg(t ORDER BY t.assigned_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      dt.id AS delivery_id,
      dt.order_id,
      o.order_number,
      o.status AS order_status,
      COALESCE(c.company_name, o.snapshot_customer_name, '') AS customer_name,
      COALESCE(o.snapshot_customer_phone, '') AS customer_phone,
      COALESCE(o.snapshot_customer_address, '') AS customer_address,
      o.total_amount,
      o.payment_method,
      COALESCE(o.snapshot_owner_name, '') AS owner_name,
      COALESCE(o.snapshot_owner_phone, '') AS owner_phone,
      COALESCE(ca.latitude, ul.latitude) AS customer_latitude,
      COALESCE(ca.longitude, ul.longitude) AS customer_longitude,
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
      (dt.assigned_to = v_session.employee_id) AS is_rep,
      (dt.driver_id = v_session.employee_id) AS is_driver,
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
      ), '[]'::jsonb) AS actions,
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
       ORDER BY co.created_at DESC LIMIT 1) AS collection
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
      AND (dt.assigned_to = v_session.employee_id OR dt.driver_id = v_session.employee_id)
      AND (dt.delivery_step IS NULL OR dt.delivery_step <> 'returned_to_company')
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_get_my_delivery_orders(uuid) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_delivery_action
-- Records one of the four delivery actions with sequence enforcement. Only the
-- assigned مندوب توصيل / سائق (or Upper Management) may act. On "تم التحصيل"
-- the order transitions to the existing 'delivered' lifecycle via
-- governed_complete_delivery and a per-order collection row is created.
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
  -- Checked BEFORE capability so an employee outside the crew gets FORBIDDEN
  -- rather than MISSING_CAPABILITY (explicit deny of the assignment).
  -- NULL-safe: single-assignee deliveries (one of assigned_to/driver_id NULL)
  -- must not let the comparison collapse to NULL.
  IF NOT public.is_upper_management(v_session.employee_id)
     AND COALESCE(v_dt.assigned_to, v_dt.driver_id) IS DISTINCT FROM v_session.employee_id
     AND COALESCE(v_dt.driver_id, v_dt.assigned_to) IS DISTINCT FROM v_session.employee_id THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  -- Sequence enforcement
  v_expected := CASE COALESCE(v_dt.delivery_step, '')
    WHEN '' THEN 'received'
    WHEN 'received' THEN 'moving_to_customer'
    WHEN 'moving_to_customer' THEN 'collected'
    WHEN 'collected' THEN 'returned_to_company'
    ELSE 'returned_to_company'
  END;

  IF p_action IS DISTINCT FROM v_expected THEN
    RETURN jsonb_build_object('error', 'INVALID_STEP', 'expected', v_expected, 'current_step', v_dt.delivery_step);
  END IF;

  IF p_action NOT IN ('received', 'moving_to_customer', 'collected', 'returned_to_company') THEN
    RETURN jsonb_build_object('error', 'INVALID_ACTION');
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

  IF p_action = 'received' THEN
    -- Reuse the existing start-delivery transition (assigned -> out_for_delivery)
    UPDATE public.delivery_tracking
    SET status = 'out_for_delivery', started_at = now(), delivery_step = 'received', updated_at = now()
    WHERE id = v_dt.id;

  ELSIF p_action = 'moving_to_customer' THEN
    UPDATE public.delivery_tracking
    SET delivery_step = 'moving_to_customer', updated_at = now()
    WHERE id = v_dt.id;

  ELSIF p_action = 'collected' THEN
    v_amount := COALESCE(p_amount, 0);

    -- Reuse the existing lifecycle transition to 'delivered' (order handed
    -- over to the customer at collection time). Handles credit invoices.
    PERFORM public.governed_complete_delivery(p_token::text, v_dt.id);

    UPDATE public.delivery_tracking
    SET delivery_step = 'collected', updated_at = now()
    WHERE id = v_dt.id;

    -- Per-order collection record (never merged across orders) — only when the
    -- order actually requires collection (مطلوب التحصيل). For بدون تحصيل the
    -- order is completed without a collections row.
    IF v_dt.collection_required THEN
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
        v_code, v_order.customer_id, 'delivery', v_dt.id, 'cash', v_amount, 'pending',
        'تحصيل توصيل - طلب ' || v_order.order_number, now(), v_session.employee_id, v_dt.order_id
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
-- Upper Management "شحن الطلبات" list. Shows in-flight shipped orders with
-- crew, current step, last action and last known location.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_get_shipping_orders(
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

  -- Only Upper Management (الإدارة العليا) can dispatch / assign crews.
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.assigned_at DESC NULLS LAST), '[]'::jsonb)
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
        AND d.delivery_step IS DISTINCT FROM 'returned_to_company'
      ORDER BY d.created_at DESC
      LIMIT 1
    ) dt ON true
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
    AND NOT (
      o.status = 'dispatched'
      AND EXISTS (SELECT 1 FROM public.delivery_tracking d
                  WHERE d.order_id = o.id AND d.delivery_step = 'returned_to_company')
    )
    AND (
      p_filter IS NULL
      OR (p_filter = 'need_crew' AND ((dt.id IS NULL) OR (dt.assigned_to IS NULL AND dt.driver_id IS NULL AND dt.delivery_step IS NULL)))
      OR (p_filter = 'in_delivery' AND dt.delivery_step IN ('received', 'moving_to_customer'))
      OR (p_filter = 'collected' AND dt.delivery_step = 'collected')
    )
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_get_shipping_orders(uuid, text) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_get_shipping_order
-- Full detail for a single shipped order: order + customer + crew + step +
-- action event history + items + last location + collection state.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_get_shipping_order(p_token uuid, p_delivery_id uuid)
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

  -- Only Upper Management (الإدارة العليا) can dispatch / assign crews.
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  SELECT jsonb_build_object(
    'delivery', jsonb_build_object(
      'id', COALESCE(dt.id, o.id),
      'order_id', o.id,
      'status', dt.status,
      'delivery_step', dt.delivery_step,
      'collection_required', COALESCE(dt.collection_required, true),
      'rep_name', rep.full_name,
      'driver_name', drv.full_name,
      'assigned_at', dt.assigned_at,
      'started_at', dt.started_at,
      'completed_at', dt.completed_at,
      'returned_at', dt.returned_at,
      'attempt_number', COALESCE(dt.attempt_number, 0),
      'notes', dt.notes
    ),
    'order', jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'status', o.status,
      'total_amount', o.total_amount,
      'payment_method', o.payment_method,
      'discount_amount', o.discount_amount,
      'created_at', o.created_at,
      'delivery_mode', o.delivery_mode,
      'owner_name', COALESCE(o.snapshot_owner_name, ''),
      'owner_phone', COALESCE(o.snapshot_owner_phone, '')
    ),
    'customer', jsonb_build_object(
      'name', COALESCE(c.company_name, o.snapshot_customer_name, ''),
      'phone', COALESCE(o.snapshot_customer_phone, ''),
      'address', COALESCE(o.snapshot_customer_address, ''),
      'latitude', COALESCE(ca.latitude, ul.latitude),
      'longitude', COALESCE(ca.longitude, ul.longitude)
    ),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_name', COALESCE(p.product_name, ''),
        'unit_type', oi.unit_type,
        'unit_quantity', oi.unit_quantity,
        'piece_quantity', oi.piece_quantity,
        'unit_price', oi.unit_price,
        'total_price', oi.total_price
      ))
      FROM public.order_items oi
      LEFT JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = o.id
    ), '[]'::jsonb),
    'actions', COALESCE((
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
    ), '[]'::jsonb),
    'collection', (SELECT jsonb_build_object(
      'id', co.id,
      'code', co.code,
      'status', co.status,
      'amount', co.amount,
      'collected_at', co.collected_at,
      'approved_at', co.approved_at,
      'collected_by_name', COALESCE(colemp.full_name, '')
    )
    FROM public.collections co
    LEFT JOIN public.employees colemp ON colemp.id = co.created_by
    WHERE co.order_id = o.id AND co.owner_type = 'delivery'
    ORDER BY co.created_at DESC LIMIT 1),
    'last_location', (
      SELECT jsonb_build_object(
        'latitude', COALESCE(a.latitude, tp.latitude),
        'longitude', COALESCE(a.longitude, tp.longitude),
        'at', COALESCE(a.captured_at, tp.recorded_at),
        'source', CASE WHEN a.id IS NOT NULL THEN 'delivery_action' ELSE 'tracking_point' END
      )
      FROM public.delivery_actions a
      FULL JOIN LATERAL (
        SELECT tp.latitude, tp.longitude, tp.recorded_at
        FROM public.tracking_points tp
        WHERE tp.employee_id = COALESCE(dt.assigned_to, dt.driver_id)
        ORDER BY tp.recorded_at DESC LIMIT 1
      ) tp ON true
      WHERE a.delivery_tracking_id = dt.id
      ORDER BY COALESCE(a.captured_at, tp.recorded_at) DESC NULLS LAST
      LIMIT 1
    )
  ) INTO v_result
  FROM public.orders o
  LEFT JOIN LATERAL (
    SELECT d.id, d.order_id, d.status, d.assigned_to, d.assigned_by, d.assigned_at, d.started_at,
           d.completed_at, d.failure_reason, d.failure_notes, d.notes, d.returned_at, d.created_at,
           d.updated_at, d.attempt_number, d.is_active, d.external_carrier_id, d.waybill_number,
           d.tracking_url, d.vehicle_number, d.departure_date, d.carrier_name, d.carrier_delivery_date,
           d.driver_id, d.delivery_step, d.collection_required
    FROM public.delivery_tracking d
    WHERE d.id = p_delivery_id
    LIMIT 1
  ) dt ON true
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
  WHERE o.id = COALESCE(dt.order_id, p_delivery_id);

  IF v_result IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  RETURN v_result;
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_get_shipping_order(uuid, uuid) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_get_delivery_monitor
-- Upper Management per-employee monitoring: number of active orders currently
-- with the employee, total value of those orders, and last known location.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_get_delivery_monitor(p_token uuid)
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

  -- Only Upper Management (الإدارة العليا) can dispatch / assign crews.
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.active_orders DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      e.id AS employee_id,
      e.full_name,
      e.code,
      r.name AS role_name,
      COALESCE(agg.active_orders, 0) AS active_orders,
      COALESCE(agg.total_value, 0) AS total_value,
      COALESCE(tp.last_location, al.last_location) AS last_location,
      COALESCE(tp.last_at, al.last_at) AS last_update_at
    FROM public.employees e
    JOIN public.employee_roles er ON er.employee_id = e.id
    JOIN public.roles r ON r.id = er.role_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS active_orders, COALESCE(sum(o.total_amount), 0) AS total_value
      FROM public.delivery_tracking dt
      JOIN public.orders o ON o.id = dt.order_id
      WHERE dt.is_active = true
        AND (dt.assigned_to = e.id OR dt.driver_id = e.id)
        AND (dt.delivery_step IS NULL OR dt.delivery_step <> 'returned_to_company')
    ) agg ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('latitude', tp.latitude, 'longitude', tp.longitude) AS last_location, tp.recorded_at AS last_at
      FROM public.tracking_points tp
      WHERE tp.employee_id = e.id
      ORDER BY tp.recorded_at DESC LIMIT 1
    ) tp ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('latitude', a.latitude, 'longitude', a.longitude) AS last_location, a.captured_at AS last_at
      FROM public.delivery_actions a
      WHERE a.employee_id = e.id AND a.latitude IS NOT NULL
      ORDER BY a.created_at DESC LIMIT 1
    ) al ON true
    WHERE e.is_active = true
      AND r.name IN ('مندوب توصيل', 'سائق')
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_get_delivery_monitor(uuid) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_reconcile_delivery_collection
-- Upper Management reconciles (receives) one delivery collection individually.
-- Reuses the collections status contract ('pending' -> 'approved', approved_by
-- / approved_at). Upper Management only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_reconcile_delivery_collection(
  p_token uuid,
  p_collection_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_co public.collections;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  -- Only Upper Management (الإدارة العليا) can dispatch / assign crews.
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  SELECT * INTO v_co FROM public.collections WHERE id = p_collection_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_co.owner_type != 'delivery' THEN RETURN jsonb_build_object('error', 'NOT_DELIVERY_COLLECTION'); END IF;
  IF v_co.status != 'pending' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE public.collections
  SET status = 'approved', approved_by = v_session.employee_id, approved_at = now(), updated_at = now()
  WHERE id = p_collection_id;

  RETURN jsonb_build_object('success', true, 'collection_id', p_collection_id);
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_reconcile_delivery_collection(uuid, uuid) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- governed_get_delivery_collections
-- Upper Management list of delivery collections (one row per order) awaiting
-- reconciliation. Each is reconciled individually via governed_approve_collection.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_get_delivery_collections(p_token uuid)
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

  -- Only Upper Management (الإدارة العليا) can dispatch / assign crews.
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.collected_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      co.id AS collection_id,
      co.code,
      co.amount,
      co.status,
      co.collected_at,
      co.approved_at,
      co.order_id,
      o.order_number,
      o.payment_method,
      COALESCE(c.company_name, o.snapshot_customer_name, '') AS customer_name,
      o.total_amount AS order_total,
      COALESCE(e.full_name, '') AS collected_by_name,
      dt.delivery_step,
      dt.returned_at
    FROM public.collections co
    JOIN public.orders o ON o.id = co.order_id
    LEFT JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.employees e ON e.id = co.created_by
    LEFT JOIN public.delivery_tracking dt ON dt.id = co.owner_id
    WHERE co.owner_type = 'delivery'
      AND co.status = 'pending'
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_get_delivery_collections(uuid) TO authenticated';
  END IF;
END
$grant$;

COMMIT;
