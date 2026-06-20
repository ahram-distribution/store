-- =============================================================================
-- Phase 5c — Executive Workspace Final: permissions, delivery text, collection
-- =============================================================================
-- 1. Add collections.create, collections.approve, orders.review to role
-- 2. Add carrier_name, carrier_delivery_date to delivery_tracking
-- 3. Update governed_dispatch_order with p_carrier_name, p_carrier_delivery_date
-- 4. Update governed_create_collection with p_order_id
-- =============================================================================

-- =============================================================================
-- 1. Add missing capabilities to Executive Supervisor role
-- =============================================================================
INSERT INTO public.capabilities (code, name)
VALUES
  ('collections.create', 'تسجيل تحصيل'),
  ('collections.approve', 'اعتماد تحصيل'),
  ('orders.review', 'مراجعة الطلبات')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  v_role_id uuid;
BEGIN
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'مشرف تنفيذي';
  IF v_role_id IS NULL THEN
    RAISE WARNING 'Role مشرف تنفيذي not found';
    RETURN;
  END IF;

  INSERT INTO public.role_capabilities (role_id, capability_id)
  SELECT v_role_id, c.id FROM public.capabilities c
  WHERE c.code IN ('collections.create', 'collections.approve', 'orders.review')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_capabilities rc
    WHERE rc.role_id = v_role_id AND rc.capability_id = c.id
  );
END;
$$;

-- =============================================================================
-- 2. Add carrier_name, carrier_delivery_date to delivery_tracking
-- =============================================================================
ALTER TABLE public.delivery_tracking
  ADD COLUMN IF NOT EXISTS carrier_name text,
  ADD COLUMN IF NOT EXISTS carrier_delivery_date timestamptz;

-- =============================================================================
-- 3. Update governed_dispatch_order with p_carrier_name, p_carrier_delivery_date
-- =============================================================================
DROP FUNCTION IF EXISTS public.governed_dispatch_order CASCADE;
CREATE OR REPLACE FUNCTION public.governed_dispatch_order(
  p_token uuid,
  p_id uuid,
  p_assigned_to uuid DEFAULT NULL::uuid,
  p_external_carrier_id uuid DEFAULT NULL::uuid,
  p_waybill_number varchar DEFAULT NULL::varchar,
  p_tracking_url text DEFAULT NULL::text,
  p_vehicle_number varchar DEFAULT NULL::varchar,
  p_departure_date timestamptz DEFAULT NULL::timestamptz,
  p_notes text DEFAULT NULL::text,
  p_carrier_name text DEFAULT NULL::text,
  p_carrier_delivery_date timestamptz DEFAULT NULL::timestamptz
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_prev_attempt integer;
  v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  v_employee_id := v_session.employee_id;
  PERFORM check_capability(p_token, 'orders.dispatch');

  SELECT status INTO v_old_status FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status NOT IN ('approved', 'preparing', 'prepared', 'ready_for_dispatch', 'sent_to_delivery') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: cannot dispatch order in status ' || v_old_status);
  END IF;

  IF p_carrier_name IS NOT NULL OR p_external_carrier_id IS NOT NULL THEN
    UPDATE public.orders SET delivery_mode = 'external', updated_at = now() WHERE id = p_id;
  ELSIF p_assigned_to IS NOT NULL THEN
    UPDATE public.orders SET delivery_mode = 'internal', updated_at = now() WHERE id = p_id;
  END IF;

  UPDATE public.orders SET status = 'dispatched', updated_at = now() WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'dispatched', v_session.identity_id, now());

  UPDATE public.delivery_tracking SET is_active = false
  WHERE order_id = p_id AND is_active = true;

  SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_prev_attempt
  FROM public.delivery_tracking WHERE order_id = p_id;

  IF p_carrier_name IS NOT NULL THEN
    INSERT INTO public.delivery_tracking (
      order_id, status, carrier_name, waybill_number, tracking_url,
      carrier_delivery_date, assigned_by, assigned_at, attempt_number, is_active, notes
    ) VALUES (
      p_id, 'assigned', p_carrier_name, p_waybill_number, p_tracking_url,
      p_carrier_delivery_date, v_employee_id, now(), v_prev_attempt, true,
      COALESCE(p_notes, 'External delivery')
    ) RETURNING * INTO v_dt;
  ELSIF p_external_carrier_id IS NOT NULL THEN
    INSERT INTO public.delivery_tracking (
      order_id, status, external_carrier_id, waybill_number, tracking_url,
      assigned_by, assigned_at, attempt_number, is_active, notes
    ) VALUES (
      p_id, 'assigned', p_external_carrier_id, p_waybill_number, p_tracking_url,
      v_employee_id, now(), v_prev_attempt, true,
      COALESCE(p_notes, 'External delivery')
    ) RETURNING * INTO v_dt;
  ELSE
    INSERT INTO public.delivery_tracking (
      order_id, status, assigned_to, assigned_by, assigned_at, attempt_number, is_active,
      vehicle_number, departure_date, notes
    ) VALUES (
      p_id, 'assigned', p_assigned_to, v_employee_id, now(), v_prev_attempt, true,
      p_vehicle_number, p_departure_date, p_notes
    ) RETURNING * INTO v_dt;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'delivery_id', v_dt.id,
    'attempt_number', v_dt.attempt_number,
    'delivery_mode', CASE WHEN p_carrier_name IS NOT NULL OR p_external_carrier_id IS NOT NULL THEN 'external' ELSE 'internal' END
  );
END;
$function$;

-- =============================================================================
-- 4. Update governed_create_collection with p_order_id
-- =============================================================================
DROP FUNCTION IF EXISTS public.governed_create_collection CASCADE;
CREATE OR REPLACE FUNCTION public.governed_create_collection(
  p_token uuid,
  p_customer_id uuid,
  p_method text,
  p_amount numeric,
  p_reference_number text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_order_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_collection public.collections;
  v_code text;
  v_seq int;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF v_session.identity_type = 'customer' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public.check_capability(p_token, 'collections.create') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: collections.create'; END IF;

  SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences WHERE code_type = 'collection' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
  IF NOT FOUND THEN v_seq := 1; END IF;
  v_code := 'COL-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

  INSERT INTO public.collections (code, customer_id, owner_type, owner_id, method, amount, reference_number, notes, created_by, order_id)
  VALUES (v_code, p_customer_id, 'employee', v_session.employee_id, p_method, p_amount, p_reference_number, p_notes, v_session.employee_id, p_order_id)
  RETURNING * INTO v_collection;

  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('collection', EXTRACT(year FROM now())::int, v_seq)
  ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_seq;

  RETURN row_to_json(v_collection);
END;
$function$;
