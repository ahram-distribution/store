-- 20260729_orders_unification_phase1.sql
-- Orders Data Unification Layer — Phase 1
--
-- Adds:
--   1. external_carriers reference table
--   2. orders.delivery_mode
--   3. delivery_tracking: attempt_number, is_active, external carrier fields
--   4. collections.order_id (nullable)
--   5. Updates governed_dispatch_order for attempt_number + is_active
--   6. Updates get_governed_deliveries to filter by is_active = true
--   7. New unified RPCs: get_unified_order, get_unified_orders

-- ============================================================
-- 1. External Carriers Reference Table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.external_carriers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(30) NOT NULL UNIQUE,
    name varchar(200) NOT NULL,
    phone varchar(30),
    tracking_url_template text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.external_carriers IS 'شركات الشحن الخارجية (أرامكس، DHL، بوسطة، إلخ)';
COMMENT ON COLUMN public.external_carriers.tracking_url_template IS 'قالب رابط التتبع، مثال: https://www.aramex.com/track?shipment={waybill}';

INSERT INTO public.external_carriers (code, name, phone) VALUES
    ('ARAMEX', 'أرامكس', '19002'),
    ('DHL', 'DHL', '16345'),
    ('POSTA', 'بوسطة', '19660'),
    ('OTHER', 'أخرى', NULL)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. orders.delivery_mode
-- ============================================================
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_mode varchar(20) NOT NULL DEFAULT 'internal';

COMMENT ON COLUMN public.orders.delivery_mode IS 'internal = توصيل داخلي (مندوب/سائق الشركة), external = شركة شحن خارجية';

-- ============================================================
-- 3. delivery_tracking — multiple attempts + external carrier support
-- ============================================================

-- Remove old single-attempt constraint
DROP INDEX IF EXISTS public.uq_delivery_tracking_order;

-- New columns
ALTER TABLE public.delivery_tracking ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 1;
ALTER TABLE public.delivery_tracking ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.delivery_tracking ADD COLUMN IF NOT EXISTS external_carrier_id uuid REFERENCES public.external_carriers(id);
ALTER TABLE public.delivery_tracking ADD COLUMN IF NOT EXISTS waybill_number varchar(100);
ALTER TABLE public.delivery_tracking ADD COLUMN IF NOT EXISTS tracking_url text;

-- New unique constraint: one attempt per (order, attempt_number)
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_tracking_order_attempt ON public.delivery_tracking(order_id, attempt_number);

COMMENT ON COLUMN public.delivery_tracking.attempt_number IS 'رقم محاولة التوصيل (1, 2, 3...)';
COMMENT ON COLUMN public.delivery_tracking.is_active IS 'true = المحاولة الحالية النشطة — مصدر الحقيقة للتوصيل الحالي';
COMMENT ON COLUMN public.delivery_tracking.external_carrier_id IS 'شركة الشحن الخارجية (إذا كان delivery_mode = external)';
COMMENT ON COLUMN public.delivery_tracking.waybill_number IS 'رقم البوليصة / التتبع من شركة الشحن';
COMMENT ON COLUMN public.delivery_tracking.tracking_url IS 'رابط تتبع الشحنة';

-- Ensure existing records conform (they are all attempt 1, active)
UPDATE public.delivery_tracking SET is_active = true WHERE is_active IS NULL;
UPDATE public.delivery_tracking SET attempt_number = 1 WHERE attempt_number IS NULL;

-- ============================================================
-- 4. collections.order_id (nullable)
-- ============================================================
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id);

COMMENT ON COLUMN public.collections.order_id IS 'ربط تحصيل بطلب (اختياري) — Collection → Customer (Primary), Order (Optional)';

-- ============================================================
-- 5. Update governed_dispatch_order
--    - Deactivate previous active delivery attempt
--    - Auto-increment attempt_number
--    - New delivery_tracking row gets is_active = true
-- ============================================================
DROP FUNCTION IF EXISTS public.governed_dispatch_order(p_token uuid, p_id uuid) CASCADE;
DROP FUNCTION IF EXISTS public.governed_dispatch_order(p_token uuid, p_id uuid, p_assigned_to uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.governed_dispatch_order(
  p_token uuid,
  p_id uuid,
  p_assigned_to uuid DEFAULT NULL
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
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;

  PERFORM check_capability(p_token, 'orders.dispatch');

  SELECT status INTO v_old_status FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status NOT IN ('approved', 'ready_for_dispatch', 'sent_to_delivery') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;

  UPDATE public.orders SET status = 'dispatched', updated_at = now() WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'dispatched', v_session.identity_id, now());

  -- Deactivate any previous active delivery attempt
  UPDATE public.delivery_tracking SET is_active = false
  WHERE order_id = p_id AND is_active = true;

  -- Calculate next attempt number
  SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_prev_attempt
  FROM public.delivery_tracking WHERE order_id = p_id;

  -- Create new delivery_tracking record
  INSERT INTO public.delivery_tracking (
    order_id, status, assigned_to, assigned_by, assigned_at,
    attempt_number, is_active
  )
  VALUES (
    p_id, 'assigned', p_assigned_to, v_employee_id, now(),
    v_prev_attempt, true
  )
  RETURNING * INTO v_dt;

  RETURN jsonb_build_object('success', true, 'delivery_id', v_dt.id, 'attempt_number', v_dt.attempt_number);
END;
$$;

COMMENT ON FUNCTION public.governed_dispatch_order IS 'شحن طلب — مع دعم محاولات متعددة (is_active, attempt_number)';

-- ============================================================
-- 6. Update get_governed_deliveries — filter by is_active = true
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_governed_deliveries(
  p_token uuid,
  p_status_filter character varying DEFAULT NULL::character varying
)
 RETURNS TABLE(
   id uuid,
   order_id uuid,
   order_number character varying,
   customer_name character varying,
   status character varying,
   assigned_to_name character varying,
   assigned_at timestamp with time zone,
   started_at timestamp with time zone,
   completed_at timestamp with time zone,
   failure_reason character varying,
   notes text,
   total_amount numeric
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[]; v_is_super boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  v_is_super := public.is_upper_management(v_session.employee_id);
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  RETURN QUERY
  SELECT dt.id, o.id, o.order_number, c.company_name, dt.status,
         ast.code, dt.assigned_at, dt.started_at, dt.completed_at,
         dt.failure_reason, dt.notes, o.total_amount
  FROM public.delivery_tracking dt
  JOIN public.orders o ON o.id = dt.order_id
  JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
  WHERE dt.is_active = true
    AND (v_is_super OR o.owner_id = ANY(v_visible))
    AND (p_status_filter IS NULL OR dt.status = p_status_filter)
  ORDER BY dt.created_at DESC;
END;
$function$;

-- ============================================================
-- 7. get_unified_order — Single Source of Truth for one order
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_unified_order(
  p_token uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_visible uuid[];
  v_is_super boolean;
  v_customer_id uuid;
BEGIN
  -- Session validation
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Access check
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_session.identity_type = 'customer' THEN
    IF v_order.customer_id != v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  ELSE
    v_is_super := public.is_upper_management(v_session.employee_id);
    IF NOT v_is_super THEN
      v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
      IF NOT EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.id = v_order.customer_id AND c.owner_id = ANY(v_visible)
      ) THEN
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
          'address', ca.address_line1
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
          'changed_at', osh.changed_at
        ) ORDER BY osh.changed_at)
        FROM public.order_status_history osh
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
          'external_carrier_name', ec.name
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
          'external_carrier_name', ec.name
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

-- ============================================================
-- 8. get_unified_orders — Unified order list
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_unified_orders(
  p_token uuid,
  p_search text DEFAULT NULL,
  p_status varchar DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_visible uuid[];
  v_is_super boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;

  IF v_session.identity_type = 'customer' THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'total_amount', o.total_amount,
        'revision_number', o.revision_number,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'notes', o.notes,
        'item_count', (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id),
        'current_delivery_status', (
          SELECT dt.status FROM public.delivery_tracking dt
          WHERE dt.order_id = o.id AND dt.is_active = true LIMIT 1
        )
      ) ORDER BY o.created_at DESC), '[]'::jsonb)
      FROM public.orders o
      WHERE o.customer_id = v_session.customer_id
        AND (p_status IS NULL OR o.status = p_status)
        AND (p_date_from IS NULL OR o.created_at >= p_date_from)
        AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    );
  END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
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
        'owner_name', COALESCE(o.snapshot_owner_name, e.full_name),
        'created_by', o.created_by,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'notes', o.notes,
        'item_count', (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id),
        'current_delivery_status', (
          SELECT dt.status FROM public.delivery_tracking dt
          WHERE dt.order_id = o.id AND dt.is_active = true LIMIT 1
        ),
        'has_collections', EXISTS(
          SELECT 1 FROM public.collections col
          WHERE col.customer_id = o.customer_id
        )
      )
      ORDER BY o.created_at DESC
    ), '[]'::jsonb)
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.identities ci ON ci.id = c.identity_id
    LEFT JOIN public.employees e ON e.id = o.owner_id
    WHERE (v_is_super OR c.owner_id = ANY(v_visible))
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
  );
END;
$$;

COMMENT ON FUNCTION public.get_unified_orders IS 'قائمة موحدة للطلبات — مع delivery_mode, current_delivery_status, has_collections';
