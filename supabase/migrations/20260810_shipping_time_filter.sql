-- Time filter (اليوم / أمس / هذا الأسبوع / هذا الشهر / فترة مخصصة) for the
-- Upper Management "شحن الطلبات" screen. The client passes an inclusive
-- from/to range; orders are filtered by their creation date (o.created_at).
-- The week runs Saturday -> Friday (Saturday first).

BEGIN;

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
    AND (
      p_filter IS NULL
      OR (p_filter = 'need_crew' AND ((dt.id IS NULL) OR (dt.assigned_to IS NULL AND dt.driver_id IS NULL AND dt.delivery_step IS NULL)))
      OR (p_filter = 'in_delivery' AND dt.delivery_step IN ('received', 'moving_to_customer', 'arrived_at_customer', 'customer_not_found'))
      OR (p_filter = 'collected' AND dt.delivery_step = 'collected')
      OR (p_filter = 'returned_to_company' AND dt.delivery_step = 'returned_to_company')
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
