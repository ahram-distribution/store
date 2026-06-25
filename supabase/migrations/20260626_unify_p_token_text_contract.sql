-- ============================================================================
-- Migration 20260626: توحيد عقد p_token إلى text لجميع RPCs المتعلقة بالطلبات
--
-- السبب:
--   PostgREST يُرسل جميع الباراميترات كنصوص (JSON → text)
--   الدوال التي تنتظر p_token uuid كانت تسبب 404/400
--   (نفس مشكلة check_capability)
--
-- الإصلاح:
--   1. تغيير جميع دوال الطلبات من p_token uuid → p_token text
--   2. إضافة delivered_at = now() في governed_change_order_status
--      عند الانتقال إلى حالة 'delivered'
-- ============================================================================

-- ============================================================================
-- 1. get_unified_order — فتح تفاصيل الطلب
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_unified_order(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_unified_order(
  p_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_is_upper boolean;
  v_visible uuid[];
  v_order public.orders%ROWTYPE;
  v_customer_id uuid;
  v_allowed boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_session.identity_type = 'customer' THEN
    IF v_order.customer_id != v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  ELSE
    v_employee_id := v_session.employee_id;
    v_is_upper := public.is_upper_management(v_employee_id);
    IF NOT v_is_upper THEN
      v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
      SELECT EXISTS(
        SELECT 1 FROM public.customers c
        WHERE c.id = v_order.customer_id
          AND (c.owner_id = ANY(v_visible))
      ) INTO v_allowed;
      IF NOT v_allowed THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
  END IF;

  v_customer_id := v_order.customer_id;

  RETURN (
    SELECT jsonb_build_object(
      'order', jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'subtotal', o.subtotal,
        'discount_amount', o.discount_amount,
        'tax_amount', o.tax_amount,
        'total_amount', o.total_amount,
        'notes', o.notes,
        'revision_number', o.revision_number,
        'customer_id', o.customer_id,
        'owner_type', o.owner_type,
        'owner_id', o.owner_id,
        'created_by', o.created_by,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'delivered_at', o.delivered_at,
        'cancelled_at', o.cancelled_at,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'deferred_until', o.deferred_until,
        'defer_reason', o.defer_reason,
        'cancel_reason', o.cancel_reason,
        'execution_latitude', o.execution_latitude,
        'execution_longitude', o.execution_longitude,
        'execution_accuracy_meters', o.execution_accuracy_meters,
        'execution_captured_at', o.execution_captured_at,
        'execution_location_id', o.execution_location_id,
        'tier_id', o.tier_id,
        'effective_discount_percent', o.effective_discount_percent,
        'snapshot_customer_name', o.snapshot_customer_name,
        'snapshot_customer_phone', o.snapshot_customer_phone,
        'snapshot_customer_address', o.snapshot_customer_address,
        'snapshot_customer_code', o.snapshot_customer_code,
        'snapshot_owner_name', o.snapshot_owner_name,
        'snapshot_owner_phone', o.snapshot_owner_phone,
        'snapshot_owner_address', o.snapshot_owner_address,
        'snapshot_sender_name', o.snapshot_sender_name,
        'snapshot_sender_phone', o.snapshot_sender_phone,
        'snapshot_sender_address', o.snapshot_sender_address
      ),
      'customer', (
        SELECT jsonb_build_object(
          'id', c.id,
          'code', c.code,
          'company_name', c.company_name,
          'phone', i.phone,
          'address_line1', ca.address_line1,
          'address_line2', ca.address_line2,
          'city', ca.city,
          'governorate', ca.governorate,
          'address_latitude', ca.latitude,
          'address_longitude', ca.longitude
        )
        FROM public.customers c
        LEFT JOIN public.identities i ON i.id = c.identity_id
        LEFT JOIN public.customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = true
        WHERE c.id = v_customer_id
        LIMIT 1
      ),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'product_name', p.product_name,
          'legacy_code', p.legacy_code,
          'image_url', p.image_url,
          'company_id', p.company_id,
          'company_name', comp.company_name,
          'unit_type', oi.unit_type,
          'unit_quantity', oi.unit_quantity,
          'piece_quantity', oi.piece_quantity,
          'unit_price', oi.unit_price,
          'total_price', oi.total_price
        ) ORDER BY oi.id)
        FROM public.order_items oi
        LEFT JOIN public.products p ON p.id = oi.product_id
        LEFT JOIN public.companies comp ON comp.id = p.company_id
        WHERE oi.order_id = o.id
      ), '[]'::jsonb),
      'status_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', osh.id,
          'from_status', osh.from_status,
          'to_status', osh.to_status,
          'changed_by', osh.changed_by,
          'changed_at', osh.changed_at,
          'changed_by_name', e_changed.full_name
        ) ORDER BY osh.changed_at)
        FROM public.order_status_history osh
        LEFT JOIN public.employees e_changed ON e_changed.id = osh.changed_by
        WHERE osh.order_id = o.id
      ), '[]'::jsonb),
      'current_delivery', (
        SELECT jsonb_build_object(
          'id', dt.id,
          'status', dt.status,
          'attempt_number', dt.attempt_number,
          'assigned_to', dt.assigned_to,
          'assigned_by', dt.assigned_by,
          'assigned_at', dt.assigned_at,
          'started_at', dt.started_at,
          'completed_at', dt.completed_at,
          'failure_reason', dt.failure_reason,
          'failure_notes', dt.failure_notes,
          'notes', dt.notes,
          'returned_at', dt.returned_at,
          'external_carrier_id', dt.external_carrier_id,
          'waybill_number', dt.waybill_number,
          'tracking_url', dt.tracking_url,
          'delivery_mode', o.delivery_mode,
          'assigned_to_name', ast.code,
          'assigned_to_phone', ast.phone,
          'external_carrier_name', ec.name,
          'updated_at', dt.updated_at
        )
        FROM public.delivery_tracking dt
        LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
        LEFT JOIN public.external_carriers ec ON ec.id = dt.external_carrier_id
        WHERE dt.order_id = o.id AND dt.is_active = true
        LIMIT 1
      ),
      'delivery_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', dt.id,
          'status', dt.status,
          'attempt_number', dt.attempt_number,
          'is_active', dt.is_active,
          'assigned_to', dt.assigned_to,
          'assigned_by', dt.assigned_by,
          'assigned_at', dt.assigned_at,
          'started_at', dt.started_at,
          'completed_at', dt.completed_at,
          'failure_reason', dt.failure_reason,
          'failure_notes', dt.failure_notes,
          'notes', dt.notes,
          'returned_at', dt.returned_at,
          'external_carrier_id', dt.external_carrier_id,
          'waybill_number', dt.waybill_number,
          'tracking_url', dt.tracking_url,
          'assigned_to_name', ast.code,
          'assigned_to_phone', ast.phone,
          'external_carrier_name', ec.name,
          'updated_at', dt.updated_at
        ) ORDER BY dt.attempt_number)
        FROM public.delivery_tracking dt
        LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
        LEFT JOIN public.external_carriers ec ON ec.id = dt.external_carrier_id
        WHERE dt.order_id = o.id
      ), '[]'::jsonb),
      'preparation', (
        SELECT jsonb_build_object(
          'id', pr.id,
          'status', pr.status,
          'started_by', pr.started_by,
          'started_at', pr.started_at,
          'completed_by', pr.completed_by,
          'completed_at', pr.completed_at,
          'reviewed_by', pr.reviewed_by,
          'reviewed_at', pr.reviewed_at,
          'cancelled_by', pr.cancelled_by,
          'cancelled_at', pr.cancelled_at,
          'notes', pr.notes
        )
        FROM public.preparation_records pr
        WHERE pr.order_id = o.id
        ORDER BY pr.created_at DESC
        LIMIT 1
      ),
      'returns', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', r.id,
          'code', r.code,
          'status', r.status,
          'credit_note_amount', r.credit_note_amount,
          'notes', r.notes,
          'created_at', r.created_at
        ) ORDER BY r.created_at)
        FROM public.returns r
        WHERE r.order_id = o.id
      ), '[]'::jsonb),
      'collections', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', col.id,
          'code', col.code,
          'method', col.method,
          'amount', col.amount,
          'status', col.status,
          'reference_number', col.reference_number,
          'collected_at', col.collected_at,
          'order_id', col.order_id
        ) ORDER BY col.created_at)
        FROM public.collections col
        WHERE col.order_id = o.id
           OR (col.customer_id = v_customer_id AND col.order_id IS NULL)
      ), '[]'::jsonb)
    )
    FROM public.orders o
    WHERE o.id = p_id
  );
END;
$$;

COMMENT ON FUNCTION public.get_unified_order IS 'مصدر الحقيقة الموحد للطلب — يعرض الطلب مع العميل والأصناف والتوصيل والتحصيل والمرتجعات';

-- ============================================================================
-- 2. get_dashboard_management — لوحة تحكم الإدارة
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_dashboard_management(uuid);

CREATE OR REPLACE FUNCTION public.get_dashboard_management(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session app.sessions; v_is_super_admin boolean;
  v_visible uuid[]; v_ali_id uuid; v_mahmoud_id uuid;
  v_total_orders int; v_pending_orders int; v_approved_orders int;
  v_total_customers int; v_active_visits int; v_pending_collections int;
  v_pending_returns int; v_today_orders int; v_today_visits int;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type = 'customer' THEN
    SELECT count(*) INTO v_total_orders FROM public.orders WHERE customer_id = v_session.customer_id;
    SELECT count(*) INTO v_pending_orders FROM public.orders WHERE customer_id = v_session.customer_id AND status IN ('draft','reviewing','submitted');
    SELECT count(*) INTO v_approved_orders FROM public.orders WHERE customer_id = v_session.customer_id AND status = 'approved';
    SELECT count(*) INTO v_total_customers FROM public.customers WHERE id = v_session.customer_id;
    SELECT count(*) INTO v_active_visits FROM public.visits WHERE customer_id = v_session.customer_id AND status = 'active';
    SELECT count(*) INTO v_pending_collections FROM public.collections WHERE customer_id = v_session.customer_id AND status = 'pending';
    SELECT count(*) INTO v_pending_returns FROM public.returns WHERE customer_id = v_session.customer_id AND status = 'pending';
    SELECT count(*) INTO v_today_orders FROM public.orders WHERE customer_id = v_session.customer_id AND created_at >= CURRENT_DATE;
    SELECT count(*) INTO v_today_visits FROM public.visits WHERE customer_id = v_session.customer_id AND created_at >= CURRENT_DATE;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin;
    IF v_is_super_admin THEN SELECT array_agg(id) INTO v_visible FROM public.employees;
    ELSE
      SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
      SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
      IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
        WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
      ELSE
        WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
      END IF;
    END IF;
    SELECT count(*) INTO v_total_orders FROM public.orders WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[]));
    SELECT count(*) INTO v_pending_orders FROM public.orders WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND status IN ('draft','reviewing','submitted');
    SELECT count(*) INTO v_approved_orders FROM public.orders WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND status = 'approved';
    SELECT count(*) INTO v_total_customers FROM public.customers WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[]));
    SELECT count(*) INTO v_active_visits FROM public.visits WHERE employee_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND status = 'active';
    SELECT count(*) INTO v_pending_collections FROM public.collections WHERE created_by = ANY(COALESCE(v_visible, '{}'::uuid[])) AND status = 'pending';
    SELECT count(*) INTO v_pending_returns FROM public.returns WHERE created_by = ANY(COALESCE(v_visible, '{}'::uuid[])) AND status = 'pending';
    SELECT count(*) INTO v_today_orders FROM public.orders WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND created_at >= CURRENT_DATE;
    SELECT count(*) INTO v_today_visits FROM public.visits WHERE employee_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND created_at >= CURRENT_DATE;
  END IF;
  RETURN json_build_object('total_orders', COALESCE(v_total_orders, 0), 'pending_orders', COALESCE(v_pending_orders, 0), 'approved_orders', COALESCE(v_approved_orders, 0), 'total_customers', COALESCE(v_total_customers, 0), 'active_visits', COALESCE(v_active_visits, 0), 'pending_collections', COALESCE(v_pending_collections, 0), 'pending_returns', COALESCE(v_pending_returns, 0), 'today_orders', COALESCE(v_today_orders, 0), 'today_visits', COALESCE(v_today_visits, 0));
END;
$function$;

-- ============================================================================
-- 3. governed_approve_order — اعتماد الطلب
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_approve_order(uuid, uuid);

CREATE OR REPLACE FUNCTION public.governed_approve_order(
  p_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_daily_deal record;
  v_deal_item record;
  v_flash_offer record;
  v_fo_item record;
  v_inv record;
  v_new_qty integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.identity_id;

  PERFORM check_capability(p_token, 'orders.approve');

  SELECT status INTO v_old_status FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status NOT IN ('submitted', 'reviewing') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  FOR v_daily_deal IN
    SELECT odd.deal_id, odd.quantity
    FROM order_daily_deals odd
    WHERE odd.order_id = p_id
  LOOP
    UPDATE public.daily_deals
    SET available_quantity = GREATEST(available_quantity - v_daily_deal.quantity, 0),
        status = CASE
          WHEN available_quantity - v_daily_deal.quantity <= 0 THEN 'sold_out'::daily_deal_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = v_daily_deal.deal_id;

    FOR v_deal_item IN
      SELECT di.product_id, di.quantity
      FROM daily_deal_items di
      WHERE di.deal_id = v_daily_deal.deal_id
    LOOP
      SELECT * INTO v_inv FROM public.inventory WHERE product_id = v_deal_item.product_id;
      IF FOUND THEN
        v_new_qty := GREATEST(v_inv.quantity - (v_deal_item.quantity * v_daily_deal.quantity), 0);
        UPDATE public.inventory SET quantity = v_new_qty, updated_at = now()
        WHERE product_id = v_deal_item.product_id;
      END IF;
    END LOOP;
  END LOOP;

  FOR v_flash_offer IN
    SELECT ofo.offer_id, ofo.quantity
    FROM order_flash_offers ofo
    WHERE ofo.order_id = p_id
  LOOP
    UPDATE public.flash_offers
    SET available_quantity = GREATEST(available_quantity - v_flash_offer.quantity, 0),
        status = CASE
          WHEN available_quantity - v_flash_offer.quantity <= 0 THEN 'sold_out'::flash_offer_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = v_flash_offer.offer_id;

    FOR v_fo_item IN
      SELECT foi.product_id, foi.quantity
      FROM flash_offer_items foi
      WHERE foi.offer_id = v_flash_offer.offer_id
    LOOP
      SELECT * INTO v_inv FROM public.inventory WHERE product_id = v_fo_item.product_id;
      IF FOUND THEN
        v_new_qty := GREATEST(v_inv.quantity - (v_fo_item.quantity * v_flash_offer.quantity), 0);
        UPDATE public.inventory SET quantity = v_new_qty, updated_at = now()
        WHERE product_id = v_fo_item.product_id;
      END IF;
    END LOOP;
  END LOOP;

  FOR v_deal_item IN
    SELECT oi.product_id, oi.piece_quantity
    FROM order_items oi
    WHERE oi.order_id = p_id
  LOOP
    SELECT * INTO v_inv FROM public.inventory WHERE product_id = v_deal_item.product_id;
    IF FOUND THEN
      v_new_qty := GREATEST(v_inv.quantity - v_deal_item.piece_quantity, 0);
      UPDATE public.inventory SET quantity = v_new_qty, updated_at = now()
      WHERE product_id = v_deal_item.product_id;
    END IF;
  END LOOP;

  UPDATE public.orders SET status = 'approved', approved_at = now(), updated_at = now()
  WHERE id = p_id AND status IN ('submitted', 'reviewing');

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'approved', v_employee_id, now());

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_approve_order IS 'اعتماد طلب مع خصم المخزون (منتجات + عروض يومية + عروض ساعة)';

-- ============================================================================
-- 4. governed_dispatch_order — شحن الطلب (يحافظ على إنشاء سجل التوصيل)
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_dispatch_order(uuid, uuid, uuid, uuid, varchar, text, varchar, timestamptz, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.governed_dispatch_order(
  p_token text,
  p_id uuid,
  p_assigned_to uuid DEFAULT NULL,
  p_external_carrier_id uuid DEFAULT NULL,
  p_waybill_number varchar DEFAULT NULL,
  p_tracking_url text DEFAULT NULL,
  p_vehicle_number varchar DEFAULT NULL,
  p_departure_date timestamptz DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_carrier_name text DEFAULT NULL,
  p_carrier_delivery_date timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_prev_attempt integer;
  v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
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
$$;

COMMENT ON FUNCTION public.governed_dispatch_order IS 'شحن طلب مع إنشاء سجل توصيل داخلي/خارجي';

-- ============================================================================
-- 5. governed_cancel_order — إلغاء الطلب
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_cancel_order(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.governed_cancel_order(
  p_token text,
  p_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_customer_id uuid;
  v_total_amount decimal(12,2);
  v_payment_method varchar(20);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;

  PERFORM check_capability(p_token, 'orders.cancel');

  SELECT status, customer_id, total_amount, payment_method INTO v_old_status, v_customer_id, v_total_amount, v_payment_method FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status IN ('cancelled', 'delivered', 'collected') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;

  UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'cancelled', v_employee_id, p_reason, now());

  IF v_payment_method = 'credit' THEN
    UPDATE public.customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 6. governed_complete_delivery — تسليم الطلب (يكتب delivered_at)
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_complete_delivery(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.governed_complete_delivery(p_token text, p_delivery_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session app.sessions;
  v_dt public.delivery_tracking;
  v_order public.orders;
  v_invoice_id uuid;
  v_invoice_num varchar(50);
  v_due_date date;
  v_account public.customer_credit_accounts;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;

  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_dt.status NOT IN ('out_for_delivery','assigned') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.delivery_tracking SET status = 'delivered', completed_at = now(), notes = COALESCE(p_notes, notes), updated_at = now() WHERE id = p_delivery_id RETURNING * INTO v_dt;
  UPDATE public.orders SET status = 'delivered', delivered_at = now(), updated_at = now() WHERE id = v_dt.order_id RETURNING * INTO v_order;

  IF v_order.payment_method = 'credit' THEN
    SELECT * INTO v_account FROM public.customer_credit_accounts
    WHERE customer_id = v_order.customer_id AND credit_status = 'active';
    IF FOUND THEN
      UPDATE public.customer_credit_accounts SET
        reserved_credit = GREATEST(0, reserved_credit - v_order.total_amount),
        outstanding_credit = outstanding_credit + v_order.total_amount,
        updated_at = now()
      WHERE id = v_account.id;

      v_invoice_num := 'CI-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || COALESCE((SELECT MAX(SUBSTRING(invoice_number FROM '\d+$'))::int + 1 FROM public.credit_invoices WHERE invoice_number LIKE 'CI-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-%'), 1);
      v_due_date := CURRENT_DATE + v_account.payment_term_days;

      INSERT INTO public.credit_invoices (invoice_number, customer_id, order_id, invoice_amount, issue_date, due_date, status)
      VALUES (v_invoice_num, v_order.customer_id, v_dt.order_id, v_order.total_amount, CURRENT_DATE, v_due_date, 'open')
      RETURNING id INTO v_invoice_id;

      INSERT INTO public.customer_credit_ledger (customer_id, transaction_type, amount, running_balance, reference_type, reference_id, notes, created_by)
      SELECT v_order.customer_id, 'debit', v_order.total_amount,
        (SELECT outstanding_credit FROM public.customer_credit_accounts WHERE customer_id = v_order.customer_id),
        'credit_invoice', v_invoice_id, 'تحويل طلب رقم ' || v_order.order_number || ' إلى فاتورة ائتمان', v_session.employee_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('delivery_status', 'delivered', 'order_status', v_order.status, 'delivered_at', v_order.delivered_at);
END;
$function$;

-- ============================================================================
-- 7. governed_change_order_status — تغيير الحالة العام (يكتب delivered_at)
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_change_order_status(text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.governed_change_order_status(p_token text, p_order_id uuid, p_new_status text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_current_status text;
  v_customer_id uuid;
  v_total_amount decimal(12,2);
  v_payment_method varchar(20);
  v_from_idx int;
  v_to_idx int;
  v_required_capability text;
  v_has_capability boolean;
  v_is_exceptional boolean;
  statuses text[] := ARRAY['draft','submitted','reviewing','returned_for_revision','approved','preparing','prepared','ready_for_dispatch','sent_to_delivery','dispatched','deferred','cancelled','delivered'];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_SESSION');
  END IF;

  IF NOT (p_new_status = ANY(statuses)) THEN
    RETURN json_build_object('success', false, 'error', 'حالة غير صالحة');
  END IF;

  SELECT status::text, customer_id, total_amount, payment_method INTO v_current_status, v_customer_id, v_total_amount, v_payment_method FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'الطلب غير موجود');
  END IF;

  IF v_current_status = p_new_status THEN
    RETURN json_build_object('success', false, 'error', 'الطلب بنفس الحالة');
  END IF;

  v_from_idx := array_position(statuses, v_current_status);
  v_to_idx := array_position(statuses, p_new_status);

  SELECT check_capability(p_token, 'orders.manage') INTO v_has_capability;
  IF v_has_capability THEN
    v_required_capability := 'orders.manage';
  ELSE
    IF v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN
      v_required_capability := 'orders.review';
    ELSIF v_current_status = 'approved' AND p_new_status = 'preparing' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF v_current_status = 'preparing' AND p_new_status = 'prepared' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF (v_current_status = 'prepared' OR v_current_status = 'ready_for_dispatch') AND p_new_status = 'sent_to_delivery' THEN
      v_required_capability := 'transportation.send_to_delivery';
    ELSE
      v_required_capability := 'orders.manage';
    END IF;
  END IF;

  SELECT check_capability(p_token, v_required_capability) INTO v_has_capability;
  IF NOT v_has_capability THEN
    RETURN json_build_object('success', false, 'error', 'ليس لديك الصلاحية لهذا الإجراء');
  END IF;

  v_is_exceptional := false;
  IF v_current_status = 'cancelled' OR p_new_status = 'cancelled' THEN
    v_is_exceptional := true;
  ELSIF v_current_status = 'deferred' OR p_new_status = 'deferred' THEN
    v_is_exceptional := true;
  ELSIF v_to_idx < v_from_idx THEN
    v_is_exceptional := true;
  ELSIF v_to_idx > v_from_idx + 1 THEN
    v_is_exceptional := true;
  END IF;

  IF v_is_exceptional AND (p_reason IS NULL OR trim(p_reason) = '') THEN
    RETURN json_build_object('success', false, 'error', 'الرجاء إدخال سبب للتغيير الاستثنائي');
  END IF;

  -- 🔥 Fix: كتابة delivered_at عند التسليم
  UPDATE orders SET
    status = p_new_status,
    delivered_at = CASE WHEN p_new_status = 'delivered' THEN now() ELSE delivered_at END,
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, now());

  IF p_new_status = 'cancelled' AND v_payment_method = 'credit' THEN
    UPDATE customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  RETURN json_build_object('success', true, 'from_status', v_current_status, 'to_status', p_new_status);
END;
$function$;

-- ============================================================================
-- 8. Delivery lifecycle RPCs
-- ============================================================================

-- governed_start_delivery
DROP FUNCTION IF EXISTS public.governed_start_delivery(uuid, uuid);
CREATE OR REPLACE FUNCTION public.governed_start_delivery(p_token text, p_delivery_id uuid)
 RETURNS delivery_tracking
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_dt.status != 'assigned' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.delivery_tracking SET status = 'out_for_delivery', started_at = now(), updated_at = now() WHERE id = p_delivery_id RETURNING * INTO v_dt;
  RETURN v_dt;
END;
$function$;

-- governed_fail_delivery
DROP FUNCTION IF EXISTS public.governed_fail_delivery(uuid, uuid, varchar, text);
CREATE OR REPLACE FUNCTION public.governed_fail_delivery(p_token text, p_delivery_id uuid, p_reason character varying, p_notes text DEFAULT NULL::text)
 RETURNS delivery_tracking
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_dt.status NOT IN ('out_for_delivery','assigned') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.delivery_tracking SET status = 'failed', failure_reason = p_reason, failure_notes = p_notes, completed_at = now(), updated_at = now() WHERE id = p_delivery_id RETURNING * INTO v_dt;
  RETURN v_dt;
END;
$function$;

-- governed_return_delivery
DROP FUNCTION IF EXISTS public.governed_return_delivery(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.governed_return_delivery(p_token text, p_delivery_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_dt.status NOT IN ('out_for_delivery','assigned') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.delivery_tracking SET status = 'returned', failure_reason = 'returned_to_warehouse', failure_notes = p_notes, returned_at = now(), updated_at = now() WHERE id = p_delivery_id RETURNING * INTO v_dt;
  UPDATE public.orders SET status = 'approved', updated_at = now() WHERE id = v_dt.order_id;
  RETURN jsonb_build_object('delivery_status', 'returned', 'order_status', 'approved');
END;
$function$;

-- governed_get_delivery
DROP FUNCTION IF EXISTS public.governed_get_delivery(uuid, uuid);
CREATE OR REPLACE FUNCTION public.governed_get_delivery(p_token text, p_delivery_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('delivery', row_to_json(dt)::jsonb, 'order', row_to_json(o)::jsonb, 'customer', row_to_json(c)::jsonb, 'assigned_employee', (SELECT row_to_json(e)::jsonb FROM employees e WHERE e.id = dt.assigned_to)) INTO v_result FROM public.delivery_tracking dt JOIN public.orders o ON o.id = dt.order_id JOIN public.customers c ON c.id = o.customer_id WHERE dt.id = p_delivery_id AND (v_session.identity_type != 'customer' OR o.customer_id = v_session.customer_id);
  RETURN v_result;
END;
$function$;

-- ============================================================================
-- 9. Notify PostgREST reload schema
-- ============================================================================

NOTIFY pgrst, 'reload schema';
