-- Invoice fields for delivery orders:
--  - orders.invoice_number  : editable invoice number (رقم الفاتورة), set by Upper Management.
--  - orders.invoice_total   : editable invoice total (إجمالي الفاتورة), overrides total_amount when set.
-- Upper Management can add/edit them from the shipping detail screen; the values are
-- surfaced to the driver / delivery-rep screens via governed_get_my_delivery_orders.

BEGIN;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_number text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_total numeric;

CREATE OR REPLACE FUNCTION public.governed_update_order_invoice(
  p_token uuid,
  p_order_id uuid,
  p_invoice_number text DEFAULT NULL,
  p_invoice_total numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_order public.orders;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  -- Only Upper Management (الإدارة العليا) can edit invoice data.
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  IF p_invoice_total IS NOT NULL AND p_invoice_total < 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_TOTAL');
  END IF;

  UPDATE public.orders
  SET invoice_number = NULLIF(btrim(COALESCE(p_invoice_number, '')), ''),
      invoice_total = p_invoice_total,
      updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'invoice_number', v_order.invoice_number,
    'invoice_total', v_order.invoice_total
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- governed_get_shipping_order: surface invoice fields to Upper Management.
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
      'invoice_number', o.invoice_number,
      'invoice_total', o.invoice_total,
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

-- ---------------------------------------------------------------------------
-- governed_get_my_delivery_orders: surface invoice fields to crew (driver / rep).
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

  SELECT COALESCE(jsonb_agg(t ORDER BY
      CASE WHEN t.delivery_step = 'returned_to_company' THEN 1 ELSE 0 END,
      t.assigned_at DESC), '[]'::jsonb)
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
      o.invoice_number,
      o.invoice_total,
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
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_update_order_invoice(uuid, uuid, text, numeric) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_get_shipping_order(uuid, uuid) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_get_my_delivery_orders(uuid) TO authenticated';
  END IF;
END
$grant$;

COMMIT;
