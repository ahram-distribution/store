-- ============================================================================
-- TIER SYSTEM PHASE 2: Backend Enforcement
-- Makes backend the single source of truth for tier validation, discount
-- calculation, and price recalculation.
-- ============================================================================

-- 1. Add tier tracking columns to orders ------------------------------------

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tier_id uuid REFERENCES tiers(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS effective_discount_percent numeric(5,2);

CREATE INDEX IF NOT EXISTS idx_orders_tier_id ON orders (tier_id);

COMMENT ON COLUMN orders.tier_id IS 'The tier selected by the customer at order creation. NULL = base pricing. Validated at submit time.';
COMMENT ON COLUMN orders.effective_discount_percent IS 'The effective discount percent applied at submission. Computed from product/company exceptions or tier default.';

-- 2. Helper function: calculate base unit price from product -----------------

CREATE OR REPLACE FUNCTION public._calc_base_unit_price(
  p_carton_price numeric,
  p_carton_quantity integer,
  p_unit_type text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_carton_price IS NULL OR p_carton_price <= 0 OR p_carton_quantity IS NULL OR p_carton_quantity <= 0 THEN
    RETURN NULL;
  END IF;
  IF p_unit_type = 'piece' THEN
    RETURN ROUND((p_carton_price / p_carton_quantity)::numeric, 2);
  ELSIF p_unit_type = 'dozen' THEN
    RETURN ROUND((p_carton_price / p_carton_quantity * 12)::numeric, 2);
  ELSIF p_unit_type = 'carton' THEN
    RETURN ROUND(p_carton_price::numeric, 2);
  ELSE
    RETURN NULL;
  END IF;
END;
$$;

-- 3. Helper function: get effective discount percent for a product+tier -------

CREATE OR REPLACE FUNCTION public._get_effective_tier_discount(
  p_tier_id uuid,
  p_product_id uuid,
  p_company_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_product_exception numeric;
  v_company_exception numeric;
  v_tier_default numeric;
BEGIN
  -- Priority 1: Product exception (applies_to_all_tiers or specific tier)
  SELECT discount_percent INTO v_product_exception
  FROM tier_product_exceptions
  WHERE product_id = p_product_id
    AND (tier_id = p_tier_id OR (tier_id IS NULL AND applies_to_all_tiers = true))
  ORDER BY applies_to_all_tiers DESC NULLS LAST
  LIMIT 1;

  IF v_product_exception IS NOT NULL THEN
    RETURN v_product_exception;
  END IF;

  -- Priority 2: Company exception
  SELECT discount_percent INTO v_company_exception
  FROM tier_company_exceptions
  WHERE tier_id = p_tier_id AND company_id = p_company_id;

  IF v_company_exception IS NOT NULL THEN
    RETURN v_company_exception;
  END IF;

  -- Priority 3: Tier default
  SELECT discount_percent INTO v_tier_default
  FROM tiers WHERE id = p_tier_id;

  RETURN COALESCE(v_tier_default, 0);
END;
$$;

-- 4. Replace governed_create_order with tier_id support ----------------------

DROP FUNCTION IF EXISTS public.governed_create_order(uuid, uuid, text, jsonb, numeric, numeric, numeric, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.governed_create_order(
  p_token uuid,
  p_customer_id uuid,
  p_tier_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]',
  p_execution_latitude numeric DEFAULT NULL,
  p_execution_longitude numeric DEFAULT NULL,
  p_execution_accuracy_meters numeric DEFAULT NULL,
  p_execution_captured_at timestamptz DEFAULT NULL
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
  v_item jsonb;
  v_product record;
  v_calculated_unit_price numeric;
  v_calculated_total_price numeric;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.create') THEN
      RAISE EXCEPTION 'MISSING_CAPABILITY: orders.create';
    END IF;
  ELSE
    IF v_session.customer_id IS NULL OR p_customer_id IS DISTINCT FROM v_session.customer_id THEN
      RAISE EXCEPTION 'FORBIDDEN: customers can only create orders for themselves';
    END IF;
  END IF;

  -- Validate tier if provided
  IF p_tier_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE id = p_tier_id AND is_active = true) THEN
      RAISE EXCEPTION 'TIER_NOT_FOUND_OR_INACTIVE';
    END IF;
  END IF;

  SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
  IF NOT FOUND THEN v_seq := 1; END IF;
  v_order_number := 'ORD-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

  IF v_session.identity_type = 'employee' THEN
    INSERT INTO public.orders (order_number, customer_id, owner_type, owner_id, created_by, notes, tier_id,
      execution_latitude, execution_longitude, execution_accuracy_meters, execution_captured_at)
    VALUES (v_order_number, p_customer_id, 'employee', v_session.employee_id, v_session.employee_id, p_notes, p_tier_id,
      p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, p_execution_captured_at)
    RETURNING * INTO v_order;
  ELSE
    INSERT INTO public.orders (order_number, customer_id, owner_type, owner_id, notes, tier_id,
      execution_latitude, execution_longitude, execution_accuracy_meters, execution_captured_at)
    VALUES (v_order_number, p_customer_id, 'customer', v_session.customer_id, p_notes, p_tier_id,
      p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, p_execution_captured_at)
    RETURNING * INTO v_order;
  END IF;

  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('order', EXTRACT(year FROM now())::int, v_seq)
  ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_seq;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, carton_price, carton_quantity INTO v_product
    FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;

    v_calculated_unit_price := public._calc_base_unit_price(
      v_product.carton_price, v_product.carton_quantity, v_item->>'unit_type'
    );
    IF v_calculated_unit_price IS NULL THEN
      RAISE EXCEPTION 'PRICE_NOT_CONFIGURED: product % has no valid pricing data', v_product.id;
    END IF;

    v_calculated_total_price := ROUND((v_calculated_unit_price * (v_item->>'unit_quantity')::integer)::numeric, 2);

    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (
      v_order.id,
      (v_item->>'product_id')::uuid,
      v_item->>'unit_type',
      (v_item->>'unit_quantity')::integer,
      COALESCE((v_item->>'piece_quantity')::integer, 0),
      v_calculated_unit_price,
      v_calculated_total_price
    );
  END LOOP;

  UPDATE public.orders SET
    subtotal = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id),
    total_amount = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id)
  WHERE id = v_order.id;

  SELECT * INTO v_order FROM public.orders WHERE id = v_order.id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (v_order.id, NULL, 'draft', COALESCE(v_session.employee_id, v_session.customer_id), 'Order created');

  RETURN row_to_json(v_order);
END;
$$;

COMMENT ON FUNCTION public.governed_create_order IS 'إنشاء طلب جديد مع أسعار أساسية ورقم تسلسلي. يتم حساب التخفيضات في مرحلة الإرسال.';

-- 5. Replace governed_submit_order with tier enforcement ---------------------

DROP FUNCTION IF EXISTS public.governed_submit_order(uuid, uuid);

CREATE OR REPLACE FUNCTION public.governed_submit_order(
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
  v_old_status text;
  v_tier_record tiers;
  v_product_subtotal numeric := 0;
  v_deal_total numeric := 0;
  v_flash_offer_total numeric := 0;
  v_effective_discount_percent numeric := 0;
  v_total_discount numeric := 0;
  v_new_total numeric := 0;
  v_item record;
  v_product record;
  v_base_unit_price numeric;
  v_base_total_price numeric;
  v_discounted_unit_price numeric;
  v_discounted_total_price numeric;
  v_company_id uuid;
BEGIN
  -- Validate session
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Fetch order
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_order.status != 'draft' THEN RETURN jsonb_build_object('error', 'INVALID_STATE: only draft orders can be submitted'); END IF;

  -- Permission check
  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.create') THEN RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.create'); END IF;
    IF v_order.created_by IS DISTINCT FROM v_session.employee_id THEN RETURN jsonb_build_object('error', 'FORBIDDEN: only the order creator can submit'); END IF;
  ELSE
    IF v_session.customer_id IS NULL OR v_order.customer_id IS DISTINCT FROM v_session.customer_id THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  END IF;

  -- Calculate deal total and flash offer total (excluded from tier minimum)
  SELECT COALESCE(SUM(total_price), 0) INTO v_deal_total
  FROM public.order_daily_deals WHERE order_id = p_id;

  SELECT COALESCE(SUM(total_price), 0) INTO v_flash_offer_total
  FROM public.order_flash_offers WHERE order_id = p_id;

  -- Recalculate everything from authoritative tables (reject frontend-injected prices)
  v_product_subtotal := 0;
  v_total_discount := 0;

  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.unit_type, oi.unit_quantity, oi.piece_quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_id
  LOOP
    SELECT p.id, p.company_id, p.carton_price, p.carton_quantity
    INTO v_product
    FROM public.products p WHERE p.id = v_item.product_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND: ' || v_item.product_id);
    END IF;

    -- Recalculate base unit price from product data (reject stored prices)
    v_base_unit_price := public._calc_base_unit_price(
      v_product.carton_price, v_product.carton_quantity, v_item.unit_type
    );

    IF v_base_unit_price IS NULL THEN
      RETURN jsonb_build_object('error', 'PRICE_NOT_CONFIGURED: product ' || v_item.product_id);
    END IF;

    v_base_total_price := ROUND((v_base_unit_price * v_item.unit_quantity)::numeric, 2);
    v_product_subtotal := v_product_subtotal + v_base_total_price;

    -- If tier is selected, calculate effective discount and discounted prices
    IF v_order.tier_id IS NOT NULL THEN
      v_effective_discount_percent := public._get_effective_tier_discount(
        v_order.tier_id, v_item.product_id, v_product.company_id
      );

      IF v_effective_discount_percent > 0 THEN
        v_discounted_unit_price := ROUND((v_base_unit_price * (1 - v_effective_discount_percent / 100))::numeric, 2);
        v_discounted_total_price := ROUND((v_discounted_unit_price * v_item.unit_quantity)::numeric, 2);
        v_total_discount := v_total_discount + (v_base_total_price - v_discounted_total_price);
      ELSE
        v_discounted_unit_price := v_base_unit_price;
        v_discounted_total_price := v_base_total_price;
      END IF;
    ELSE
      v_discounted_unit_price := v_base_unit_price;
      v_discounted_total_price := v_base_total_price;
    END IF;

    -- Update order_item with recalculated prices (reject frontend-injected values)
    UPDATE public.order_items SET
      unit_price = v_discounted_unit_price,
      total_price = v_discounted_total_price
    WHERE id = v_item.id;
  END LOOP;

  -- Tier minimum validation (based on product base subtotal ONLY, excluding deals/flash offers)
  IF v_order.tier_id IS NOT NULL THEN
    SELECT * INTO v_tier_record FROM public.tiers WHERE id = v_order.tier_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TIER_NOT_FOUND'); END IF;

    IF NOT v_tier_record.is_active THEN RETURN jsonb_build_object('error', 'TIER_NOT_ACTIVE'); END IF;

    IF v_product_subtotal < v_tier_record.minimum_order_amount THEN
      RETURN jsonb_build_object(
        'error',
        'متبقي لك ' || ROUND((v_tier_record.minimum_order_amount - v_product_subtotal)::numeric, 0)
        || ' جنيه لتحقيق الحد الأدنى للشريحة المختارة'
      );
    END IF;
  END IF;

  -- Calculate new total: product subtotal after discount + deal total + flash offer total
  v_new_total := ROUND(((v_product_subtotal - v_total_discount) + v_deal_total + v_flash_offer_total)::numeric, 2);

  -- Update order with final amounts
  v_old_status := v_order.status;
  UPDATE public.orders SET
    status = 'submitted',
    subtotal = v_product_subtotal,
    discount_amount = ROUND(v_total_discount::numeric, 2),
    total_amount = v_new_total,
    effective_discount_percent = CASE WHEN v_order.tier_id IS NOT NULL THEN v_effective_discount_percent ELSE NULL END,
    submitted_at = now(),
    updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_order;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_id, v_old_status, 'submitted', COALESCE(v_session.employee_id, v_session.customer_id), 'Order submitted');

  RETURN row_to_json(v_order);
END;
$$;

COMMENT ON FUNCTION public.governed_submit_order IS 'إرسال الطلب مع التحقق من الشريحة السعرية وإعادة حساب كل الأسعار من المصدر (المنتجات والشرائح والاستثناءات).';

-- ============================================================================
-- END OF TIER SYSTEM PHASE 2
-- ============================================================================
