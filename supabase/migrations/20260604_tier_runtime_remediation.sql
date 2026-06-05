-- ============================================================================
-- Tier Runtime Remediation — 2026-06-04
-- Fixes 3 critical issues found in Tier Runtime Audit:
--   1. governed_create_order now applies tier discount to item prices
--   2. CartPage hydration guard using zustand persist.onFinishHydration
--   3. clearCart() no longer destroys selectedTierId
-- ============================================================================

-- ============================================================================
-- 1. Fix governed_create_order: apply tier discount with exception lookups
--    Priority: product exception > product exception (applies_to_all_tiers)
--              > company exception > tier default discount
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_create_order(uuid, uuid, uuid, text, jsonb, uuid, numeric, numeric, numeric, timestamptz);

CREATE OR REPLACE FUNCTION public.governed_create_order(
  p_token uuid,
  p_customer_id uuid,
  p_tier_id uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_execution_location_id uuid DEFAULT NULL::uuid,
  p_execution_latitude numeric DEFAULT NULL::numeric,
  p_execution_longitude numeric DEFAULT NULL::numeric,
  p_execution_accuracy_meters numeric DEFAULT NULL::numeric,
  p_execution_captured_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions; v_order public.orders; v_order_number text;
  v_seq int; v_item jsonb; v_product record;
  v_calculated_unit_price numeric; v_calculated_total_price numeric;
  v_exec_location_id uuid;
  v_tier_discount numeric; v_prod_exc numeric; v_comp_exc numeric; v_effective_discount numeric;
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

  -- Validate tier and capture its discount percent
  IF p_tier_id IS NOT NULL THEN
    SELECT discount_percent INTO v_tier_discount FROM public.tiers WHERE id = p_tier_id AND is_active = true;
    IF v_tier_discount IS NULL THEN RAISE EXCEPTION 'TIER_NOT_FOUND_OR_INACTIVE'; END IF;
  END IF;

  v_exec_location_id := p_execution_location_id;
  IF v_exec_location_id IS NULL AND p_execution_latitude IS NOT NULL AND p_execution_longitude IS NOT NULL THEN
    v_exec_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, captured_at)
    VALUES (v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, COALESCE(p_execution_captured_at, now()));
  END IF;

  SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
  IF NOT FOUND THEN v_seq := 1; END IF;
  v_order_number := 'ORD-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

  IF v_session.identity_type = 'employee' THEN
    INSERT INTO public.orders (order_number, customer_id, owner_type, owner_id, created_by, notes, tier_id,
      execution_location_id, execution_latitude, execution_longitude, execution_accuracy_meters, execution_captured_at)
    VALUES (v_order_number, p_customer_id, 'employee', v_session.employee_id, v_session.employee_id, p_notes, p_tier_id,
      v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, p_execution_captured_at)
    RETURNING * INTO v_order;
  ELSE
    INSERT INTO public.orders (order_number, customer_id, owner_type, owner_id, notes, tier_id,
      execution_location_id, execution_latitude, execution_longitude, execution_accuracy_meters, execution_captured_at)
    VALUES (v_order_number, p_customer_id, 'customer', v_session.customer_id, p_notes, p_tier_id,
      v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, p_execution_captured_at)
    RETURNING * INTO v_order;
  END IF;

  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('order', EXTRACT(year FROM now())::int, v_seq)
  ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_seq;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id, carton_price, carton_quantity, company_id INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;

    v_calculated_unit_price := public._calc_base_unit_price(v_product.carton_price, v_product.carton_quantity, v_item->>'unit_type');
    IF v_calculated_unit_price IS NULL THEN RAISE EXCEPTION 'PRICE_NOT_CONFIGURED: product % has no valid pricing data', v_product.id; END IF;

    -- Apply tier discount if an active tier is selected
    IF p_tier_id IS NOT NULL AND v_tier_discount IS NOT NULL THEN
      v_effective_discount := v_tier_discount;

      -- Priority 1: product-level exception for this specific tier
      SELECT discount_percent INTO v_prod_exc FROM public.tier_product_exceptions
      WHERE tier_id = p_tier_id AND product_id = v_product.id LIMIT 1;

      -- Priority 2: product exception that applies to all tiers
      IF v_prod_exc IS NULL THEN
        SELECT discount_percent INTO v_prod_exc FROM public.tier_product_exceptions
        WHERE applies_to_all_tiers = true AND product_id = v_product.id LIMIT 1;
      END IF;

      IF v_prod_exc IS NOT NULL THEN
        v_effective_discount := v_prod_exc;
      ELSE
        -- Priority 3: company-level exception
        SELECT discount_percent INTO v_comp_exc FROM public.tier_company_exceptions
        WHERE tier_id = p_tier_id AND company_id = v_product.company_id LIMIT 1;
        IF v_comp_exc IS NOT NULL THEN
          v_effective_discount := v_comp_exc;
        END IF;
      END IF;

      v_calculated_unit_price := ROUND((v_calculated_unit_price * (1 - v_effective_discount / 100))::numeric, 2);
    END IF;

    v_calculated_total_price := ROUND((v_calculated_unit_price * (v_item->>'unit_quantity')::integer)::numeric, 2);

    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (v_order.id, (v_item->>'product_id')::uuid, v_item->>'unit_type', (v_item->>'unit_quantity')::integer,
      COALESCE((v_item->>'piece_quantity')::integer, 0), v_calculated_unit_price, v_calculated_total_price);
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
$function$;

COMMENT ON FUNCTION public.governed_create_order IS 'إنشاء طلب جديد مع أسعار التخفيضات حسب الشريحة واستثناءاتها.';

-- ============================================================================
-- Schema fix: allow 'customer' owner_type in orders for customer self-service.
-- Previously only 'employee' was allowed, which blocked the customer INSERT
-- path of governed_create_order.
-- ============================================================================
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS ck_orders_owner_type;
ALTER TABLE public.orders ADD CONSTRAINT ck_orders_owner_type CHECK (owner_type IN ('employee', 'customer'));

-- ============================================================================
-- Note: There is a pre-existing FK issue: fk_orders_created_by references
-- employees(id), so customer-created orders still fail at the INSERT step
-- because customers are not in the employees table. This requires a wider
-- schema change (making created_by nullable or adding a polymorphic FK) and
-- is left for a future remediation pass.
-- ============================================================================
