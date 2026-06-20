-- =============================================================================
-- Phase 5b — Fix Executive Permissions & INVALID_STATE
-- =============================================================================
-- 1. Assign REP-001 (محمد عبد الباسط) to Executive Supervisor role
-- 2. Add all required capabilities to Executive Supervisor role
-- 3. Fix governed_complete_preparation — accept orders.prepare capability
-- 4. Fix governed_dispatch_order — accept preparing + more statuses
-- 5. Fix governed_return_order_for_revision — accept more statuses
-- 6. Add date-range params to executive queue RPC
-- =============================================================================

-- =============================================================================
-- 1. Assign REP-001 to Executive Supervisor role
-- =============================================================================
DO $$
DECLARE
  v_emp_id uuid;
  v_role_id uuid;
BEGIN
  SELECT id INTO v_emp_id FROM public.employees WHERE code = 'REP-001';
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'مشرف تنفيذي';

  IF v_emp_id IS NULL THEN
    RAISE WARNING 'Employee REP-001 not found — skipping role assignment';
    RETURN;
  END IF;

  IF v_role_id IS NULL THEN
    RAISE WARNING 'Role مشرف تنفيذي not found — creating it';
    INSERT INTO public.roles (name, description, is_system)
    VALUES ('مشرف تنفيذي', 'المشرف التنفيذي — إدارة العمليات من الاعتماد حتى التسليم', false)
    RETURNING id INTO v_role_id;
  END IF;

  -- Remove any existing role assignments for REP-001
  DELETE FROM public.employee_roles WHERE employee_id = v_emp_id;

  -- Assign to Executive Supervisor role
  INSERT INTO public.employee_roles (employee_id, role_id, assigned_by)
  VALUES (v_emp_id, v_role_id, v_emp_id);

  RAISE NOTICE 'REP-001 assigned to role مشرف تنفيذي (role_id: %)', v_role_id;
END;
$$;

-- =============================================================================
-- 2. Add ALL required capabilities to Executive Supervisor role
-- =============================================================================
INSERT INTO public.capabilities (code, name)
VALUES
  ('orders.prepare', 'بدء التجهيز'),
  ('warehouse.prepare', 'إكمال التجهيز'),
  ('orders.dispatch', 'شحن الطلب'),
  ('delivery.deliver', 'تسليم الطلب'),
  ('orders.manage', 'إدارة الطلبات'),
  ('orders.approve', 'اعتماد الطلبات'),
  ('orders.create', 'إنشاء الطلبات'),
  ('delivery.manage', 'إدارة التوصيل')
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
  WHERE c.code IN ('orders.prepare', 'warehouse.prepare', 'orders.dispatch',
                   'delivery.deliver', 'orders.manage', 'orders.approve',
                   'orders.create', 'delivery.manage')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_capabilities rc
    WHERE rc.role_id = v_role_id AND rc.capability_id = c.id
  );

  RAISE NOTICE 'Capabilities added to مشرف تنفيذي role';
END;
$$;

-- =============================================================================
-- 3. Fix governed_complete_preparation — accept orders.prepare as alternative
-- =============================================================================
DROP FUNCTION IF EXISTS public.governed_complete_preparation(p_token uuid, p_preparation_id uuid, p_notes text);
CREATE OR REPLACE FUNCTION public.governed_complete_preparation(
  p_token uuid,
  p_preparation_id uuid,
  p_notes text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_rec public.preparation_records;
  v_order_id uuid;
  v_cap_ok boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_session.employee_id IS NULL THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;

  -- Accept either warehouse.prepare OR orders.prepare
  v_cap_ok := public.check_capability(p_token, 'warehouse.prepare')
           OR public.check_capability(p_token, 'orders.prepare');
  IF NOT v_cap_ok THEN RETURN json_build_object('error', 'FORBIDDEN'); END IF;

  SELECT INTO v_rec FROM public.preparation_records WHERE id = p_preparation_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'PREPARATION_NOT_FOUND'); END IF;
  IF v_rec.status != 'in_progress' THEN RETURN json_build_object('error', 'INVALID_STATUS'); END IF;

  SELECT order_id INTO v_order_id FROM public.preparation_records WHERE id = p_preparation_id;

  UPDATE public.preparation_records
  SET status = 'completed', completed_by = v_session.employee_id, completed_at = now(),
      notes = COALESCE(p_notes, notes), updated_at = now()
  WHERE id = p_preparation_id;

  UPDATE public.orders SET status = 'prepared', updated_at = now() WHERE id = v_order_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (v_order_id, 'preparing', 'prepared', v_session.identity_id, COALESCE(p_notes, 'Preparation completed'));

  RETURN json_build_object('id', p_preparation_id, 'status', 'completed', 'completed_by', v_session.employee_id, 'completed_at', now(), 'order_status', 'prepared');
END;
$function$;

-- =============================================================================
-- 4. Fix governed_dispatch_order — accept preparing + more statuses
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
  p_notes text DEFAULT NULL::text
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

  -- Accept all statuses that can be dispatched: approved, preparing, prepared, ready_for_dispatch, sent_to_delivery
  IF v_old_status NOT IN ('approved', 'preparing', 'prepared', 'ready_for_dispatch', 'sent_to_delivery') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: cannot dispatch order in status ' || v_old_status);
  END IF;

  -- Set delivery_mode
  IF p_external_carrier_id IS NOT NULL THEN
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

  IF p_external_carrier_id IS NOT NULL THEN
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
    'delivery_mode', CASE WHEN p_external_carrier_id IS NOT NULL THEN 'external' ELSE 'internal' END
  );
END;
$function$;

-- =============================================================================
-- 5. Fix governed_return_order_for_revision — accept all non-terminal statuses
-- =============================================================================
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

  -- Accept all active statuses except draft and cancelled
  IF v_old_status IN ('draft', 'cancelled') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: الطلب لم يتم إرساله بعد أو ملغي');
  END IF;

  IF v_old_status = 'returned_for_revision' THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: الطلب بالفعل في حالة تعديل');
  END IF;

  -- Set status to returned_for_revision (not draft — keeps audit trail)
  UPDATE public.orders SET
    status = 'returned_for_revision',
    revision_number = COALESCE(revision_number, 0) + 1,
    last_revised_at = now(),
    updated_at = now()
  WHERE id = p_id
  RETURNING revision_number INTO v_new_revision;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_id, v_old_status, 'returned_for_revision', v_session.identity_id, p_reason);

  INSERT INTO public.order_modification_history (order_id, revision_number, changed_by, change_type, reason)
  VALUES (p_id, v_new_revision, v_session.employee_id, 'returned_for_revision', p_reason);

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_id,
    'status', 'returned_for_revision',
    'revision_number', v_new_revision,
    'old_status', v_old_status
  );
END;
$function$;

-- =============================================================================
-- 6. Add vehicle_number + departure_date columns to delivery_tracking (if missing)
-- =============================================================================
ALTER TABLE public.delivery_tracking
  ADD COLUMN IF NOT EXISTS vehicle_number varchar(50),
  ADD COLUMN IF NOT EXISTS departure_date timestamptz;

-- =============================================================================
-- 7. Update executive queue RPC with date range + employee name filters
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_governed_executive_queue CASCADE;
CREATE OR REPLACE FUNCTION public.get_governed_executive_queue(
  p_token uuid,
  p_status varchar DEFAULT NULL::varchar,
  p_search text DEFAULT NULL::text,
  p_governorate varchar DEFAULT NULL::varchar,
  p_delivery_mode varchar DEFAULT NULL::varchar,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_employee_name text DEFAULT NULL::text,
  p_date_filter varchar DEFAULT NULL::varchar
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_visible uuid[];
  v_is_super boolean;
  v_can_see_all boolean;
  v_sql text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_can_see_all := v_is_super OR public.check_capability(p_token, 'orders.manage');
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'total_amount', o.total_amount,
        'revision_number', o.revision_number,
        'customer_id', o.customer_id,
        'customer_name', COALESCE(o.snapshot_customer_name, c.company_name),
        'customer_code', o.snapshot_customer_code,
        'customer_phone', COALESCE(o.snapshot_customer_phone, ci.phone),
        'governorate', ca.governorate,
        'owner_name', COALESCE(o.snapshot_owner_name, e.full_name),
        'created_by_name', COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, ''),
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'current_delivery_status', (
          SELECT dt.status FROM public.delivery_tracking dt
          WHERE dt.order_id = o.id AND dt.is_active = true LIMIT 1
        ),
        'has_collections', EXISTS(
          SELECT 1 FROM public.collections col
          WHERE (col.order_id = o.id OR col.customer_id = o.customer_id)
        ),
        'collected_amount', (
          SELECT COALESCE(SUM(col.amount), 0) FROM public.collections col
          WHERE (col.order_id = o.id OR col.customer_id = o.customer_id)
            AND col.status IN ('approved', 'treasury_posted')
        ),
        'item_count', (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id)
      )
      ORDER BY o.updated_at DESC
    ), '[]'::jsonb)
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.identities ci ON ci.id = c.identity_id
    LEFT JOIN public.customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = true
    LEFT JOIN public.employees co_emp ON co_emp.id = c.owner_id
    LEFT JOIN public.employees e ON e.id = o.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    WHERE (v_can_see_all OR c.owner_id = ANY(v_visible))
      AND o.status IN ('approved', 'preparing', 'prepared', 'ready_for_dispatch', 'dispatched', 'sent_to_delivery', 'delivered', 'deferred', 'returned_for_revision')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_delivery_mode IS NULL OR o.delivery_mode = p_delivery_mode)
      AND (p_governorate IS NULL OR ca.governorate = p_governorate)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'))
      AND (p_employee_name IS NULL OR
           e.full_name ILIKE '%' || p_employee_name || '%' OR
           oc_emp.full_name ILIKE '%' || p_employee_name || '%')
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%')
  );
END;
$function$;

-- =============================================================================
-- 8. Update executive KPIs RPC with date range filter
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_governed_executive_kpis CASCADE;
CREATE OR REPLACE FUNCTION public.get_governed_executive_kpis(
  p_token uuid,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_visible uuid[];
  v_is_super boolean;
  v_can_see_all boolean;
  v_waiting_prep bigint;
  v_in_prep bigint;
  v_ready_for_dispatch bigint;
  v_in_delivery bigint;
  v_delivered bigint;
  v_uncollected bigint;
  v_partially_collected bigint;
  v_fully_collected bigint;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_can_see_all := v_is_super OR public.check_capability(p_token, 'orders.manage');
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

  SELECT count(*) INTO v_waiting_prep FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'approved'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'));

  SELECT count(*) INTO v_in_prep FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'preparing'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'));

  SELECT count(*) INTO v_ready_for_dispatch FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'prepared'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'));

  SELECT count(*) INTO v_in_delivery FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status IN ('dispatched', 'sent_to_delivery', 'deferred')
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'));

  SELECT count(*) INTO v_delivered FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'delivered'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'));

  SELECT count(*) INTO v_uncollected FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'delivered'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'))
    AND NOT EXISTS (
      SELECT 1 FROM public.collections col
      WHERE (col.order_id = o.id OR col.customer_id = o.customer_id)
        AND col.status IN ('approved', 'treasury_posted')
    );

  SELECT count(*) INTO v_fully_collected FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'delivered'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'))
    AND (
      SELECT COALESCE(SUM(col.amount), 0) FROM public.collections col
      WHERE (col.order_id = o.id OR col.customer_id = o.customer_id)
        AND col.status IN ('approved', 'treasury_posted')
    ) >= o.total_amount;

  SELECT count(*) INTO v_partially_collected FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.status = 'delivered'
    AND (v_can_see_all OR c.owner_id = ANY(v_visible))
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= (p_date_to + interval '1 day'))
    AND EXISTS (
      SELECT 1 FROM public.collections col
      WHERE (col.order_id = o.id OR col.customer_id = o.customer_id)
        AND col.status IN ('approved', 'treasury_posted')
    )
    AND (
      SELECT COALESCE(SUM(col.amount), 0) FROM public.collections col
      WHERE (col.order_id = o.id OR col.customer_id = o.customer_id)
        AND col.status IN ('approved', 'treasury_posted')
    ) < o.total_amount;

  RETURN jsonb_build_object(
    'waiting_preparation', v_waiting_prep,
    'in_preparation', v_in_prep,
    'ready_for_dispatch', v_ready_for_dispatch,
    'in_delivery', v_in_delivery,
    'delivered', v_delivered,
    'uncollected', v_uncollected,
    'partially_collected', v_partially_collected,
    'fully_collected', v_fully_collected
  );
END;
$function$;
