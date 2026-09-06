-- ============================================================================
-- TIER & DISCOUNT SYSTEM — Pre-Implementation Specification v2.0 (approved)
-- ============================================================================
-- Introduces the centralized multi-choice discount system:
--   Group 1: Order Value Tier bands   (reuses existing `tiers` table)
--   Group 2: Payment Method options   (new `payment_method_options`)
--   Group 3: Shipping Method options  (new `shipping_method_options`)
--
-- Rules:
--   * Each order picks exactly ONE option per group (null = none).
--   * Discount percentages are SUMMED and applied ONCE on the base price
--     (Method B — user-confirmed).
--   * Admin controls name / discount / sort order / visibility / activation.
--   * Hiding an option never deletes it; historical orders keep snapshots,
--     so later admin edits cannot change past orders (spec section 29/33).
-- ============================================================================

-- 1. Payment Method Options ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_method_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_method_options ADD CONSTRAINT ck_payment_method_options_discount
  CHECK (discount_percent >= 0 AND discount_percent <= 100);

CREATE INDEX IF NOT EXISTS idx_payment_method_options_active_visible
  ON public.payment_method_options (sort_order)
  WHERE is_active = true AND is_visible = true;

COMMENT ON TABLE public.payment_method_options IS 'Discount options for the Payment Method group (Group 2).';
COMMENT ON COLUMN public.payment_method_options.is_visible IS 'Customer-facing display. Hiding never affects historical orders.';

-- 2. Shipping Method Options --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.shipping_method_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shipping_method_options ADD CONSTRAINT ck_shipping_method_options_discount
  CHECK (discount_percent >= 0 AND discount_percent <= 100);

CREATE INDEX IF NOT EXISTS idx_shipping_method_options_active_visible
  ON public.shipping_method_options (sort_order)
  WHERE is_active = true AND is_visible = true;

COMMENT ON TABLE public.shipping_method_options IS 'Discount options for the Shipping Method group (Group 3).';
COMMENT ON COLUMN public.shipping_method_options.is_visible IS 'Customer-facing display. Hiding never affects historical orders.';

-- 3. Seed Order Value Tier bands ---------------------------------------------
--    New default bands replace the legacy bronze/silver/gold set.
--    The legacy tiers are deactivated + hidden for new orders but KEPT
--    (FK references from historical orders must remain valid).

INSERT INTO public.tiers (name, description, discount_percent, minimum_order_amount, sort_order, is_visible, is_active, color)
VALUES
  ('100000', 'شريحة 100 ألف', 1.0, 100000, 10, true, true, '#3B82F6'),
  ('50000', 'شريحة 50 ألف',    0.5, 50000,  20, true, true, '#10B981'),
  ('250000', 'شريحة 250 ألف',  1.5, 250000, 30, true, true, '#F59E0B'),
  ('500000', 'شريحة 500 ألف',  2.0, 500000, 40, true, true, '#EF4444'),
  ('1000000', 'شريحة مليون',   2.5, 1000000, 50, true, true, '#8B5CF6'),
  ('2000000', 'شريحة 2 مليون', 3.0, 2000000, 60, true, true, '#F97316')
ON CONFLICT DO NOTHING;

-- Deactivate + hide legacy tiers (برونزي/فضي/ذهبي currently have sort_order 1-3).
UPDATE public.tiers
SET is_active = false,
    is_visible = false,
    updated_at = now()
WHERE is_active = true
  AND sort_order < 10;

-- 4. Seed Payment Method options ---------------------------------------------

INSERT INTO public.payment_method_options (name, discount_percent, sort_order, is_visible, is_active)
VALUES
  ('نقدي / تحويل',      0.0, 10, true, true),
  ('كاش سيارة',         0.5, 20, true, true),
  ('دفع مسبق',          1.0, 30, true, true)
ON CONFLICT DO NOTHING;

-- 5. Seed Shipping Method options --------------------------------------------

INSERT INTO public.shipping_method_options (name, discount_percent, sort_order, is_visible, is_active)
VALUES
  ('توصيل إلى باب المخزن',  0.0, 10, true, true),
  ('شحن',                   0.0, 20, true, true),
  ('استلام من مخزن الشركة', 1.0, 30, true, true)
ON CONFLICT DO NOTHING;

-- 6. Orders columns (option ids + frozen snapshots) --------------------------

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method_option_id uuid REFERENCES public.payment_method_options(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_method_option_id uuid REFERENCES public.shipping_method_options(id);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS snapshot_tier_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS snapshot_tier_discount numeric(5,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS snapshot_payment_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS snapshot_payment_discount numeric(5,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS snapshot_shipping_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS snapshot_shipping_discount numeric(5,2);

CREATE INDEX IF NOT EXISTS idx_orders_payment_method_option_id ON public.orders (payment_method_option_id);
CREATE INDEX IF NOT EXISTS idx_orders_shipping_method_option_id ON public.orders (shipping_method_option_id);

-- Backfill snapshots for existing orders so historical display never depends
-- on live tier/option settings.
UPDATE public.orders o
SET snapshot_tier_name = t.name,
    snapshot_tier_discount = t.discount_percent
FROM public.tiers t
WHERE o.tier_id = t.id
  AND o.snapshot_tier_name IS NULL;

UPDATE public.orders o
SET snapshot_payment_name = p.name,
    snapshot_payment_discount = p.discount_percent
FROM public.payment_method_options p
WHERE o.payment_method_option_id = p.id
  AND o.snapshot_payment_name IS NULL;

UPDATE public.orders o
SET snapshot_shipping_name = s.name,
    snapshot_shipping_discount = s.discount_percent
FROM public.shipping_method_options s
WHERE o.shipping_method_option_id = s.id
  AND o.snapshot_shipping_name IS NULL;

-- ============================================================================
-- 7. READ API — get_governed_discount_options
--    Returns ALL options (incl. inactive/hidden) per group, ordered for admin.
--    Customer-facing callers filter by is_active AND is_visible.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_discount_options(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  RETURN jsonb_build_object(
    'tiers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'description', t.description,
        'discount_percent', t.discount_percent,
        'minimum_order_amount', t.minimum_order_amount,
        'sort_order', t.sort_order,
        'is_visible', t.is_visible,
        'is_active', t.is_active,
        'color', t.color,
        'icon_url', t.icon_url,
        'starts_at', t.starts_at,
        'ends_at', t.ends_at,
        'updated_at', t.updated_at
      ) ORDER BY t.sort_order ASC)
      FROM public.tiers t), '[]'::jsonb),
    'payment_methods', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'discount_percent', p.discount_percent,
        'sort_order', p.sort_order,
        'is_visible', p.is_visible,
        'is_active', p.is_active,
        'updated_at', p.updated_at
      ) ORDER BY p.sort_order ASC)
      FROM public.payment_method_options p), '[]'::jsonb),
    'shipping_methods', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'discount_percent', s.discount_percent,
        'sort_order', s.sort_order,
        'is_visible', s.is_visible,
        'is_active', s.is_active,
        'updated_at', s.updated_at
      ) ORDER BY s.sort_order ASC)
      FROM public.shipping_method_options s), '[]'::jsonb)
  );
END;
$$;

-- ============================================================================
-- 8. WRITE API — Payment Method options
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_create_payment_method_option(
  p_token uuid,
  p_name varchar,
  p_discount_percent numeric DEFAULT 0,
  p_sort_order integer DEFAULT 0,
  p_is_visible boolean DEFAULT true
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  INSERT INTO public.payment_method_options (name, discount_percent, sort_order, is_visible)
  VALUES (p_name, p_discount_percent, p_sort_order, p_is_visible)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.governed_update_payment_method_option(
  p_token uuid,
  p_id uuid,
  p_name varchar DEFAULT NULL,
  p_discount_percent numeric DEFAULT NULL,
  p_sort_order integer DEFAULT NULL,
  p_is_visible boolean DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  UPDATE public.payment_method_options SET
    name = COALESCE(p_name, name),
    discount_percent = COALESCE(p_discount_percent, discount_percent),
    sort_order = COALESCE(p_sort_order, sort_order),
    is_visible = COALESCE(p_is_visible, is_visible),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE id = p_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 9. WRITE API — Shipping Method options
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_create_shipping_method_option(
  p_token uuid,
  p_name varchar,
  p_discount_percent numeric DEFAULT 0,
  p_sort_order integer DEFAULT 0,
  p_is_visible boolean DEFAULT true
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  INSERT INTO public.shipping_method_options (name, discount_percent, sort_order, is_visible)
  VALUES (p_name, p_discount_percent, p_sort_order, p_is_visible)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.governed_update_shipping_method_option(
  p_token uuid,
  p_id uuid,
  p_name varchar DEFAULT NULL,
  p_discount_percent numeric DEFAULT NULL,
  p_sort_order integer DEFAULT NULL,
  p_is_visible boolean DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  UPDATE public.shipping_method_options SET
    name = COALESCE(p_name, name),
    discount_percent = COALESCE(p_discount_percent, discount_percent),
    sort_order = COALESCE(p_sort_order, sort_order),
    is_visible = COALESCE(p_is_visible, is_visible),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE id = p_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 10. governed_create_order — accept the two option ids + freeze snapshots
--     Superset of 20270804_auto_close_inactivity_60min (matches it verbatim
--     except two new trailing params + tier snapshots + option id columns).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_create_order(
  p_token uuid, p_customer_id uuid,
  p_tier_id uuid DEFAULT NULL, p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]',
  p_execution_location_id uuid DEFAULT NULL,
  p_execution_latitude numeric DEFAULT NULL,
  p_execution_longitude numeric DEFAULT NULL,
  p_execution_accuracy_meters numeric DEFAULT NULL,
  p_execution_captured_at timestamptz DEFAULT NULL,
  p_order_type varchar DEFAULT 'cash',
  p_payment_method_option_id uuid DEFAULT NULL,
  p_shipping_method_option_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_order_number text;
  v_seq int;
  v_order_item jsonb;
  v_product record;
  v_calculated_unit_price numeric;
  v_calculated_total_price numeric;
  v_exec_location_id uuid;

  -- Snapshot variables
  v_cust_name text;
  v_cust_phone text;
  v_cust_address text;
  v_owner_name text;
  v_owner_phone text;
  v_owner_address text;
  v_sender_name text;
  v_sender_phone text;
  v_sender_address text;

  -- Frozen option snapshots
  v_tier_name text;
  v_tier_discount numeric;
  v_payment_name text;
  v_payment_discount numeric;
  v_shipping_name text;
  v_shipping_discount numeric;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.create') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: orders.create'; END IF;
  ELSE
    IF v_session.customer_id IS NULL OR p_customer_id IS DISTINCT FROM v_session.customer_id THEN
      RAISE EXCEPTION 'FORBIDDEN: customers can only create orders for themselves';
    END IF;
  END IF;

  IF p_tier_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE id = p_tier_id AND is_active = true) THEN
      RAISE EXCEPTION 'TIER_NOT_FOUND_OR_INACTIVE';
    END IF;
    SELECT name, discount_percent INTO v_tier_name, v_tier_discount
    FROM public.tiers WHERE id = p_tier_id;
  END IF;

  IF p_payment_method_option_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.payment_method_options WHERE id = p_payment_method_option_id AND is_active = true) THEN
      RAISE EXCEPTION 'PAYMENT_METHOD_NOT_FOUND_OR_INACTIVE';
    END IF;
    SELECT name, discount_percent INTO v_payment_name, v_payment_discount
    FROM public.payment_method_options WHERE id = p_payment_method_option_id;
  END IF;

  IF p_shipping_method_option_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.shipping_method_options WHERE id = p_shipping_method_option_id AND is_active = true) THEN
      RAISE EXCEPTION 'SHIPPING_METHOD_NOT_FOUND_OR_INACTIVE';
    END IF;
    SELECT name, discount_percent INTO v_shipping_name, v_shipping_discount
    FROM public.shipping_method_options WHERE id = p_shipping_method_option_id;
  END IF;

  -- Validate no out_of_stock products in the order
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS vi
    JOIN public.products p ON p.id = (vi->>'product_id')::uuid
    WHERE p.is_out_of_stock = true AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'ORDER_CONTAINS_OUT_OF_STOCK_PRODUCTS';
  END IF;

  v_exec_location_id := p_execution_location_id;
  IF v_exec_location_id IS NULL AND p_execution_latitude IS NOT NULL AND p_execution_longitude IS NOT NULL THEN
    v_exec_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, captured_at)
    VALUES (v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, COALESCE(p_execution_captured_at, now()));
  END IF;

  -- Customer snapshot
  SELECT
    c.company_name,
    COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
    COALESCE(
      (SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
      (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1),
      ''
    )
  INTO v_cust_name, v_cust_phone, v_cust_address
  FROM customers c
  WHERE c.id = p_customer_id;

  -- Owner snapshot
  SELECT
    COALESCE(e.full_name, ''),
    COALESCE(i.phone, ''),
    COALESCE(e.address, '')
  INTO v_owner_name, v_owner_phone, v_owner_address
  FROM customers c
  LEFT JOIN employees e ON e.id = c.owner_id
  LEFT JOIN identities i ON i.id = e.identity_id
  WHERE c.id = p_customer_id;

  -- Sender snapshot
  IF v_session.identity_type = 'employee' THEN
    SELECT
      COALESCE(e.full_name, ''),
      COALESCE(i.phone, ''),
      COALESCE(e.address, '')
    INTO v_sender_name, v_sender_phone, v_sender_address
    FROM employees e
    LEFT JOIN identities i ON i.id = e.identity_id
    WHERE e.identity_id = v_session.identity_id;
  ELSE
    SELECT
      COALESCE(c.company_name, ''),
      COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
      COALESCE(
        (SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
        (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1),
        ''
      )
    INTO v_sender_name, v_sender_phone, v_sender_address
    FROM customers c
    WHERE c.identity_id = v_session.identity_id;
  END IF;

  -- Generate order number
  SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
  IF NOT FOUND THEN v_seq := 1; END IF;
  v_order_number := 'ORD-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

  -- Insert order with snapshots
  IF v_session.identity_type = 'employee' THEN
    INSERT INTO public.orders (
      order_number, customer_id, owner_type, owner_id, created_by,
      notes, tier_id, order_type,
      payment_method_option_id, shipping_method_option_id,
      snapshot_tier_name, snapshot_tier_discount,
      snapshot_payment_name, snapshot_payment_discount,
      snapshot_shipping_name, snapshot_shipping_discount,
      execution_location_id, execution_latitude, execution_longitude,
      execution_accuracy_meters, execution_captured_at,
      snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
      snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
      snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address
    ) VALUES (
      v_order_number, p_customer_id, 'employee', v_session.identity_id, v_session.identity_id,
      p_notes, p_tier_id, p_order_type,
      p_payment_method_option_id, p_shipping_method_option_id,
      v_tier_name, v_tier_discount,
      v_payment_name, v_payment_discount,
      v_shipping_name, v_shipping_discount,
      v_exec_location_id, p_execution_latitude, p_execution_longitude,
      p_execution_accuracy_meters, p_execution_captured_at,
      v_cust_name, v_cust_phone, v_cust_address,
      v_owner_name, v_owner_phone, v_owner_address,
      v_sender_name, v_sender_phone, v_sender_address
    )
    RETURNING * INTO v_order;
  ELSE
    INSERT INTO public.orders (
      order_number, customer_id, owner_type, owner_id, created_by,
      notes, tier_id, order_type,
      payment_method_option_id, shipping_method_option_id,
      snapshot_tier_name, snapshot_tier_discount,
      snapshot_payment_name, snapshot_payment_discount,
      snapshot_shipping_name, snapshot_shipping_discount,
      execution_location_id, execution_latitude, execution_longitude,
      execution_accuracy_meters, execution_captured_at,
      snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
      snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
      snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address
    ) VALUES (
      v_order_number, p_customer_id, 'customer', v_session.identity_id, v_session.identity_id,
      p_notes, p_tier_id, p_order_type,
      p_payment_method_option_id, p_shipping_method_option_id,
      v_tier_name, v_tier_discount,
      v_payment_name, v_payment_discount,
      v_shipping_name, v_shipping_discount,
      v_exec_location_id, p_execution_latitude, p_execution_longitude,
      p_execution_accuracy_meters, p_execution_captured_at,
      v_cust_name, v_cust_phone, v_cust_address,
      v_owner_name, v_owner_phone, v_owner_address,
      v_sender_name, v_sender_phone, v_sender_address
    )
    RETURNING * INTO v_order;
  END IF;

  -- Insert order items (only real columns from schema)
  FOR v_order_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, product_name, legacy_code AS product_code, carton_price, carton_quantity
    INTO v_product
    FROM public.products
    WHERE id = (v_order_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %', (v_order_item->>'product_id')::uuid;
    END IF;

    v_calculated_unit_price := (v_order_item->>'unit_price')::numeric;

    v_calculated_total_price := ROUND(
      (v_calculated_unit_price * (v_order_item->>'unit_quantity')::numeric)::numeric, 2
    );

    INSERT INTO public.order_items (
      order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price
    ) VALUES (
      v_order.id, v_product.id,
      COALESCE(v_order_item->>'unit_type', 'piece'),
      GREATEST(COALESCE((v_order_item->>'unit_quantity')::integer, 1), 1),
      GREATEST(COALESCE((v_order_item->>'piece_quantity')::integer, 0), 1),
      v_calculated_unit_price, v_calculated_total_price
    );
  END LOOP;

  -- Update order totals
  UPDATE public.orders SET
    subtotal = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id),
    total_amount = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id)
  WHERE id = v_order.id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (v_order.id, NULL, 'draft', v_session.identity_id, 'Order created');

  UPDATE public.code_sequences
  SET last_sequence = v_seq
  WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int;

  -- Enrich customer from order execution location (best-effort)
  BEGIN
    PERFORM fn_enrich_customer_location(
      p_customer_id        := p_customer_id,
      p_latitude           := p_execution_latitude,
      p_longitude          := p_execution_longitude,
      p_accuracy_meters    := p_execution_accuracy_meters,
      p_accuracy_level     := 'GEOCODED'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'governed_create_order: enrichment failed for order % (customer %): %', v_order.id, p_customer_id, SQLERRM;
  END;

  PERFORM pg_notify('order_created', jsonb_build_object('order_id', v_order.id, 'number', v_order.order_number)::text);

  -- Reset inactivity timer (order creation is a qualifying activity)
  IF v_session.identity_type = 'employee' THEN
    PERFORM public.touch_qualifying_activity(v_session.employee_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_order.id,
    'order_number', v_order.order_number
  );
END;
$$;

-- ============================================================================
-- 11. Superset edit API — update the three discount choices on an existing order
--     (used by Upper Management order editor; snapshots are refreshed)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_update_order_discount_options(
  p_token uuid,
  p_order_id uuid,
  p_tier_id uuid DEFAULT NULL,
  p_payment_method_option_id uuid DEFAULT NULL,
  p_shipping_method_option_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_tier_name text;
  v_tier_discount numeric;
  v_payment_name text;
  v_payment_discount numeric;
  v_shipping_name text;
  v_shipping_discount numeric;
  v_rev integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT revision_number INTO v_rev FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF p_tier_id IS NOT NULL THEN
    SELECT name, discount_percent INTO v_tier_name, v_tier_discount
    FROM public.tiers WHERE id = p_tier_id AND is_active = true;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TIER_NOT_FOUND_OR_INACTIVE'); END IF;
  END IF;

  IF p_payment_method_option_id IS NOT NULL THEN
    SELECT name, discount_percent INTO v_payment_name, v_payment_discount
    FROM public.payment_method_options WHERE id = p_payment_method_option_id AND is_active = true;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PAYMENT_METHOD_NOT_FOUND_OR_INACTIVE'); END IF;
  END IF;

  IF p_shipping_method_option_id IS NOT NULL THEN
    SELECT name, discount_percent INTO v_shipping_name, v_shipping_discount
    FROM public.shipping_method_options WHERE id = p_shipping_method_option_id AND is_active = true;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SHIPPING_METHOD_NOT_FOUND_OR_INACTIVE'); END IF;
  END IF;

  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value, modified_by, reason, modified_at
  ) VALUES (
    p_order_id, v_rev, 'discount_options',
    jsonb_build_object(
      'tier_id', (SELECT tier_id FROM public.orders WHERE id = p_order_id),
      'payment_method_option_id', (SELECT payment_method_option_id FROM public.orders WHERE id = p_order_id),
      'shipping_method_option_id', (SELECT shipping_method_option_id FROM public.orders WHERE id = p_order_id)
    )::text,
    jsonb_build_object(
      'tier_id', p_tier_id,
      'payment_method_option_id', p_payment_method_option_id,
      'shipping_method_option_id', p_shipping_method_option_id
    )::text,
    v_session.identity_id,
    COALESCE(p_reason, 'تعديل خيارات الخصم من الإدارة العليا'),
    now()
  );

  UPDATE public.orders SET
    tier_id = COALESCE(p_tier_id, tier_id),
    payment_method_option_id = COALESCE(p_payment_method_option_id, payment_method_option_id),
    shipping_method_option_id = COALESCE(p_shipping_method_option_id, shipping_method_option_id),
    snapshot_tier_name = COALESCE(v_tier_name, snapshot_tier_name),
    snapshot_tier_discount = COALESCE(v_tier_discount, snapshot_tier_discount),
    snapshot_payment_name = COALESCE(v_payment_name, snapshot_payment_name),
    snapshot_payment_discount = COALESCE(v_payment_discount, snapshot_payment_discount),
    snapshot_shipping_name = COALESCE(v_shipping_name, snapshot_shipping_name),
    snapshot_shipping_discount = COALESCE(v_shipping_discount, snapshot_shipping_discount),
    updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 12. READ API — get_order_discount_snapshots (batch, additive)
--     Returns the frozen option references + snapshots for a set of order ids.
--     Clients merge these into unified-order payloads without forcing a
--     wholesale rewrite of the large get_unified_order(s) functions.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_order_discount_snapshots(
  p_token uuid,
  p_order_ids uuid[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  RETURN jsonb_build_object(
    'snapshots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_id', o.id,
        'tier_id', o.tier_id,
        'payment_method_option_id', o.payment_method_option_id,
        'shipping_method_option_id', o.shipping_method_option_id,
        'effective_discount_percent', o.effective_discount_percent,
        'snapshot_tier_name', o.snapshot_tier_name,
        'snapshot_tier_discount', o.snapshot_tier_discount,
        'snapshot_payment_name', o.snapshot_payment_name,
        'snapshot_payment_discount', o.snapshot_payment_discount,
        'snapshot_shipping_name', o.snapshot_shipping_name,
        'snapshot_shipping_discount', o.snapshot_shipping_discount
      ))
      FROM public.orders o
      WHERE o.id = ANY(p_order_ids)
    ), '[]'::jsonb)
  );
END;
$$;

-- ============================================================================
-- END OF TIER & DISCOUNT SYSTEM MIGRATION
-- ============================================================================