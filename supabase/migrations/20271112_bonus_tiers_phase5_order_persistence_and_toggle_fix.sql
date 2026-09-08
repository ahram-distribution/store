-- ============================================================================
-- BONUS TIERS — PHASE 5 (ORDER PERSISTENCE + TOGGLE FIX)
-- Companion: docs\Bonus Tiers — Final Implementation Design Review.md (approved)
--            docs\Bonus Tiers — بونص الشرائح.md (v2.2, locked business spec)
--
-- PART A — CLOSE THE PHASE 4 GAP: server-side Bonus persistence in the governed
--          order-creation path (verify-not-reprice, single bonus system).
-- PART B — FIX THE BONUS ELIGIBILITY TOGGLES: guarantee the exact superset
--          signatures + EXECUTE grants the frontend relies on (the reported
--          404 / "Could not find the function ... in the schema cache").
--
-- PART A. SCOPE (validate ONE system, PERsist the complete Bonus state):
--   1. governed_create_order  — accept bonus items + the frozen Bonus financial
--      snapshot; VERIFY against authoritative server data and per-line geo base
--      prices (_bonus_geo_base_unit_price using the ONE geographic resolver and
--      the STORED storefront prices piece_price/dozen_price/carton_price);
--      persist is_bonus lines + bonus_mode_used/credit/products_total/applied/
--      unused/overflow/main_base_total with the SERVER-verified numbers.
--   2. governed_submit_order  — bonus-aware final totals at submit:
--      total = main_base_total + bonus_overflow + deals + flash_offers;
--      discount_amount = bonus_applied (transforms the order's accounting into
--      the approved Bonus model without touching the direct-discount branch).
--   3. get_order_bonus_snapshots — additive read API for saved Bonus state.
--
-- PART A. BUSINESS RULES ENFORCED SERVER-SIDE:
--     * Bonus products are NEVER free: priced exactly at the geo-adjusted base,
--       unit_price == base_unit_price (verified per line, tolerance 0.011).
--     * No discount group may touch a Bonus product line.
--     * Credit is generated ONLY from MAIN products (tier+payment+shipping
--       combined %, Product > Company > Global precedence) — identical formula
--       to the approved engine (computeBonusCredit).
--     * applied = MIN(credit, bonus_products_total);
--       unused  = MAX(credit - bonus_products_total, 0);
--       overflow= MAX(bonus_products_total - credit, 0).
--     * overflow > 0 requires explicit approval (p_bonus_overflow_approved)
--       server-side — cannot be bypassed from the client.
--     * No whole-EGP rounding: money is numeric(%,2) / round2 everywhere
--       (639.60 stays 639.60).
--     * Historical orders are immutable: the frozen snapshot is written at
--       creation; submit/revision flows never rewrite bonus_* columns.
--     * Deals/Flash Offers neither generate nor consume credit (D-O11), and
--       only add to the payable at submit.
--     * OFF MODE = byte-identical: every new parameter defaults to NULL/false
--       and every Bonus branch is guarded by bonus_mode_used IS TRUE.
--
-- PART B. TOGGLE FIX (root cause + deterministic solution):
--     The frontend toggles call named params {p_token, p_id, p_bonus_enabled} on
--     governed_update_company / governed_update_product. The reported 404 can
--     only happen when the target database lacks the 7-arg superset (migration
--     20271111 not applied) or the authenticated role lacks EXECUTE on it —
--     PostgREST reports the exact same "Could not find the function ... in the
--     schema cache" 404 for a missing exhaustive grant. This migration therefore
--     RE-DECLARES both supersets verbatim (idempotent CREATE OR REPLACE) AND
--     issues EXPLICIT GRANT EXECUTE to authenticated + service_role, so the path
--     works regardless of default-privilege timing. The 6-arg legacy overloads
--     are untouched (no ambiguity: PostgREST fingerprints by the provided named
--     parameters; the legacy product-edit call sends only the 6 base names).
-- ============================================================================

-- ============================================================================
-- PART B — BONUS ELIGIBILITY TOGGLES (superset re-declaration + explicit grants)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B1. governed_update_product — superset: p_bonus_enabled (products.manage).
--     Trailing nullable parameter; COALESCE keeps NULL = no change. Persists
--     products.bonus_enabled. Product-level eligibility stays independent of the
--     company-level flag. NEVER touches company_id (no reassignment to 7000).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_product(
  p_token uuid,
  p_id uuid,
  p_product_name varchar DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_legacy_code varchar DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_bonus_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_bonus boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'products.manage');

  UPDATE public.products
  SET
    product_name = COALESCE(p_product_name, product_name),
    description = COALESCE(p_description, description),
    legacy_code = COALESCE(p_legacy_code, legacy_code),
    image_url = COALESCE(p_image_url, image_url),
    bonus_enabled = COALESCE(p_bonus_enabled, bonus_enabled),
    updated_at = now()
  WHERE id = p_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF p_bonus_enabled IS NOT NULL THEN
    SELECT bonus_enabled INTO v_bonus FROM public.products WHERE id = p_id;
    RETURN jsonb_build_object('success', true, 'bonus_enabled', v_bonus);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_product(uuid, uuid, varchar, text, varchar, text, boolean) IS
  'تعديل بيانات منتج (مع الصورة وأهلية البونص: يضاف إلى الهدايا والبونص) — لا يغيّر الشركة التابعة أبداً';

-- ----------------------------------------------------------------------------
-- B2. governed_update_company — superset: p_bonus_enabled (companies.manage).
--     When true, ALL products of the company become Bonus-eligible through the
--     single eligibility predicate (products.bonus_enabled OR companies.bonus_enabled).
--     Products are NEVER reassigned into company 7000.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_company(
  p_token uuid,
  p_id uuid,
  p_company_name varchar DEFAULT NULL,
  p_legacy_code varchar DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_is_visible boolean DEFAULT NULL,
  p_bonus_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_bonus boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'companies.manage');

  UPDATE public.companies
  SET
    company_name = COALESCE(p_company_name, company_name),
    legacy_code = COALESCE(p_legacy_code, legacy_code),
    logo_url = COALESCE(p_logo_url, logo_url),
    is_visible = COALESCE(p_is_visible, is_visible),
    bonus_enabled = COALESCE(p_bonus_enabled, bonus_enabled),
    updated_at = now()
  WHERE id = p_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF p_bonus_enabled IS NOT NULL THEN
    SELECT bonus_enabled INTO v_bonus FROM public.companies WHERE id = p_id;
    RETURN jsonb_build_object('success', true, 'bonus_enabled', v_bonus);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_company(uuid, uuid, varchar, varchar, text, boolean, boolean) IS
  'تعديل بيانات شركة (مع الشعار والظهور وأهلية البونص: تضاف إلى الهدايا والبونص) — تفعيلها يجعل كل منتجات الشركة مؤهلة للبونص دون نقل أي منتج إلى شركة 7000';

GRANT EXECUTE ON FUNCTION public.governed_update_product(uuid, uuid, varchar, text, varchar, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_update_company(uuid, uuid, varchar, varchar, text, boolean, boolean) TO authenticated, service_role;

-- ============================================================================
-- PART A — ORDER-CREATION SERVER-SIDE BONUS PERSISTENCE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A1. _bonus_geo_base_unit_price — authoritative geo-adjusted BASE unit price.
--     Matches EXACTLY what the storefront displays: the STORED product prices
--     piece_price / dozen_price / carton_price (never recomputed from carton
--     price) overlaid with the ONE authoritative geographic resolver
--     (get_effective_geographic_adjustment). round2. NULL when not configured.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._bonus_geo_base_unit_price(
  p_carton_price numeric,
  p_piece_price numeric,
  p_dozen_price numeric,
  p_unit_type text,
  p_governorate_id uuid DEFAULT NULL::uuid,
  p_company_id uuid DEFAULT NULL::uuid,
  p_product_id uuid DEFAULT NULL::uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_base numeric;
  v_adj numeric := 0;
BEGIN
  IF p_unit_type = 'piece' THEN
    v_base := p_piece_price;
  ELSIF p_unit_type = 'dozen' THEN
    v_base := p_dozen_price;
  ELSIF p_unit_type = 'carton' THEN
    v_base := p_carton_price;
  ELSE
    RETURN NULL;
  END IF;

  IF v_base IS NULL OR v_base <= 0 THEN RETURN NULL; END IF;

  IF p_governorate_id IS NOT NULL THEN
    SELECT COALESCE(g.adjustment_percent, 0) INTO v_adj
    FROM public.get_effective_geographic_adjustment(
      p_governorate_id, p_company_id, p_product_id
    ) g;
  END IF;

  RETURN ROUND(COALESCE(v_base, 0) * (1 + COALESCE(v_adj, 0) / 100), 2);
END;
$$;

COMMENT ON FUNCTION public._bonus_geo_base_unit_price IS
  'السعر الأساسي الجغرافي المعتمد لعنصر البونص — يستخدم أسعار الواجهة المخزنة (piece_price/dozen_price/carton_price) مع المفسر الجغرافي الوحيد، وتسوية منزلتين (639.60 تبقى 639.60). يعيد NULL عندما لا يكون السعر مهيئاً.';

-- ----------------------------------------------------------------------------
-- A2. _bonus_product_eligible — the ONE Bonus-catalog eligibility predicate
--     (mirrors src/engine/bonusEligibility.ts): products.bonus_enabled OR
--     companies.bonus_enabled OR company legacy code 7000. No exclusion path.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._bonus_product_eligible(p_product_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT COALESCE(p.bonus_enabled, false)
      OR COALESCE(c.bonus_enabled, false)
      OR c.legacy_code = '7000'
  FROM public.products p
  JOIN public.companies c ON c.id = p.company_id
  WHERE p.id = p_product_id
$$;

COMMENT ON FUNCTION public._bonus_product_eligible IS
  'معيار أهلية منتجات البونص الوحيد: منتجات.bonus_enabled أو شركات.bonus_enabled أو شركة البونص 7000 — بلا استثناءات وبدون آلية ثانية.';

-- ----------------------------------------------------------------------------
-- A3. governed_create_order — SUPERSET.
--     Trailing params default to NULL/false, so every existing caller
--     (LegacySalesOrderProvider, employee storefront, customers) and the OFF
--     direct-discount path stay byte-identical. In Bonus Mode the function:
--       (a) guards global mode + requires the full financial snapshot,
--       (b) verifies each MAIN line unit price == server geo base (0.011 tol),
--       (c) verifies each BONUS line unit/base price == server geo base and
--           Bonus-eligibility,
--       (d) accumulates the server-side aggregates and rejects any mismatch
--           with the client values (RAISE rolls the whole transaction back),
--       (e) allocates bonus_applied_amount per bonus line (consume credit in
--           payload order until exhausted),
--       (f) persists orders.bonus_* + main_base_total with the SERVER numbers.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_create_order(uuid, uuid, uuid, text, jsonb, uuid, numeric, numeric, numeric, timestamptz, varchar, uuid, uuid);

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
  p_shipping_method_option_id uuid DEFAULT NULL,
  -- Bonus Mode persistence (verify-not-reprice). All NULL/false when OFF.
  p_bonus_items jsonb DEFAULT NULL,
  p_bonus_mode_used boolean DEFAULT NULL,
  p_bonus_credit numeric DEFAULT NULL,
  p_bonus_products_total numeric DEFAULT NULL,
  p_bonus_applied numeric DEFAULT NULL,
  p_bonus_unused numeric DEFAULT NULL,
  p_bonus_overflow numeric DEFAULT NULL,
  p_main_base_total numeric DEFAULT NULL,
  p_bonus_overflow_approved boolean DEFAULT false,
  p_bonus_governorate_id uuid DEFAULT NULL
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

  -- Bonus Mode server-side verification + persistence (Phase 5)
  v_bonus_active boolean := p_bonus_mode_used IS TRUE;
  v_bonus_mode_enabled boolean := false;
  v_bonus_geo_base numeric;
  v_bonus_item jsonb;
  v_bonus_product record;
  v_percent_tier numeric := 0;
  v_percent_payment numeric := 0;
  v_percent_shipping numeric := 0;
  v_combined_pct numeric := 0;
  v_line_base_total numeric := 0;
  v_server_main_base_total numeric := 0;
  v_server_bonus_credit numeric := 0;
  v_server_bonus_products_total numeric := 0;
  v_server_bonus_applied numeric := 0;
  v_server_bonus_unused numeric := 0;
  v_server_bonus_overflow numeric := 0;
  v_remaining_bonus_credit numeric := 0;
  v_line_bonus_applied numeric := 0;
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

  -- Bonus Mode consistency guards (single system — verify-not-reprice, OFF guard)
  IF v_bonus_active THEN
    SELECT COALESCE((value->>'value')::boolean, false) INTO v_bonus_mode_enabled
    FROM app.app_settings WHERE key = 'bonus_mode_enabled';

    IF NOT v_bonus_mode_enabled THEN
      RAISE EXCEPTION 'BONUS_MODE_OFF_SERVER';
    END IF;
    IF p_bonus_credit IS NULL OR p_bonus_products_total IS NULL OR p_bonus_applied IS NULL
       OR p_bonus_unused IS NULL OR p_bonus_overflow IS NULL OR p_main_base_total IS NULL THEN
      RAISE EXCEPTION 'BONUS_FINANCIALS_REQUIRED';
    END IF;
  ELSIF p_bonus_items IS NOT NULL AND jsonb_array_length(p_bonus_items) > 0 THEN
    RAISE EXCEPTION 'BONUS_ITEMS_WITHOUT_MODE';
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

  -- Validate no out_of_stock products in the MAIN order (bonus lines checked per line)
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

  -- Insert order items: MAIN products are real items with their normal values
  -- (geo-adjusted base price in Bonus Mode, verified line-by-line).
  FOR v_order_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT p.id, p.product_name, p.legacy_code AS product_code, p.carton_price, p.carton_quantity,
           p.is_out_of_stock, p.is_active, p.company_id, p.piece_price, p.dozen_price
    INTO v_product
    FROM public.products p
    WHERE p.id = (v_order_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %', (v_order_item->>'product_id')::uuid;
    END IF;

    v_calculated_unit_price := (v_order_item->>'unit_price')::numeric;

    IF v_bonus_active THEN
      v_bonus_geo_base := public._bonus_geo_base_unit_price(
        v_product.carton_price, v_product.piece_price, v_product.dozen_price,
        COALESCE(v_order_item->>'unit_type', 'piece'),
        p_bonus_governorate_id, v_product.company_id, v_product.id
      );
      IF v_bonus_geo_base IS NULL THEN
        RAISE EXCEPTION 'PRICE_NOT_CONFIGURED: %', v_product.id;
      END IF;
      -- verify-not-reprice: the client's unit price must equal the authoritative base
      IF ABS(v_calculated_unit_price - v_bonus_geo_base) > 0.011 THEN
        RAISE EXCEPTION 'BONUS_PRICE_MISMATCH: %', v_product.id;
      END IF;
      IF (v_order_item ? 'base_unit_price')
         AND ABS(((v_order_item->>'base_unit_price')::numeric) - v_bonus_geo_base) > 0.011 THEN
        RAISE EXCEPTION 'BONUS_BASE_PRICE_MISMATCH: %', v_product.id;
      END IF;
    END IF;

    v_calculated_total_price := ROUND(
      (v_calculated_unit_price * (v_order_item->>'unit_quantity')::numeric)::numeric, 2
    );

    INSERT INTO public.order_items (
      order_id, product_id, unit_type, unit_quantity, piece_quantity,
      unit_price, base_unit_price, total_price, is_bonus
    ) VALUES (
      v_order.id, v_product.id,
      COALESCE(v_order_item->>'unit_type', 'piece'),
      GREATEST(COALESCE((v_order_item->>'unit_quantity')::integer, 1), 1),
      GREATEST(COALESCE((v_order_item->>'piece_quantity')::integer, 0), 1),
      v_calculated_unit_price,
      CASE WHEN v_bonus_active THEN v_bonus_geo_base ELSE 0 END,
      v_calculated_total_price,
      false
    );

    -- Credit is generated ONLY from MAIN products (tier+payment+shipping, Product > Company > Global).
    IF v_bonus_active THEN
      v_line_base_total := ROUND((v_bonus_geo_base * (v_order_item->>'unit_quantity')::numeric)::numeric, 2);
      v_server_main_base_total := v_server_main_base_total + v_line_base_total;

      IF p_tier_id IS NOT NULL THEN
        v_percent_tier := public._get_effective_tier_discount(p_tier_id, v_product.id, v_product.company_id);
      ELSE
        v_percent_tier := 0;
      END IF;

      IF p_payment_method_option_id IS NOT NULL THEN
        SELECT COALESCE(
          (SELECT pe.discount_percent FROM public.product_payment_method_exceptions pe
           WHERE pe.payment_method_option_id = p_payment_method_option_id AND pe.product_id = v_product.id LIMIT 1),
          (SELECT ce.discount_percent FROM public.company_payment_method_exceptions ce
           WHERE ce.payment_method_option_id = p_payment_method_option_id AND ce.company_id = v_product.company_id LIMIT 1),
          opt.discount_percent
        ) INTO v_percent_payment
        FROM public.payment_method_options opt WHERE opt.id = p_payment_method_option_id;
      ELSE
        v_percent_payment := 0;
      END IF;

      IF p_shipping_method_option_id IS NOT NULL THEN
        SELECT COALESCE(
          (SELECT pe.discount_percent FROM public.product_shipping_method_exceptions pe
           WHERE pe.shipping_method_option_id = p_shipping_method_option_id AND pe.product_id = v_product.id LIMIT 1),
          (SELECT ce.discount_percent FROM public.company_shipping_method_exceptions ce
           WHERE ce.shipping_method_option_id = p_shipping_method_option_id AND ce.company_id = v_product.company_id LIMIT 1),
          opt.discount_percent
        ) INTO v_percent_shipping
        FROM public.shipping_method_options opt WHERE opt.id = p_shipping_method_option_id;
      ELSE
        v_percent_shipping := 0;
      END IF;

      v_combined_pct := COALESCE(v_percent_tier, 0) + COALESCE(v_percent_payment, 0) + COALESCE(v_percent_shipping, 0);
      v_server_bonus_credit := v_server_bonus_credit
        + ROUND((v_line_base_total * v_combined_pct / 100)::numeric, 2);
    END IF;
  END LOOP;

  -- Insert order items: BONUS products are REAL order items at the geo-adjusted
  -- BASE price only (never free, never discounted). Each line consumes Credit
  -- until exhausted (payload order); the rest is the payable cash portion.
  IF v_bonus_active AND p_bonus_items IS NOT NULL AND jsonb_array_length(p_bonus_items) > 0 THEN
    v_remaining_bonus_credit := v_server_bonus_credit;
    FOR v_bonus_item IN SELECT * FROM jsonb_array_elements(p_bonus_items)
    LOOP
      SELECT p.id, p.product_name, p.carton_price, p.carton_quantity,
             p.is_out_of_stock, p.is_active, p.company_id, p.piece_price, p.dozen_price
      INTO v_bonus_product
      FROM public.products p
      WHERE p.id = (v_bonus_item->>'product_id')::uuid;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %', (v_bonus_item->>'product_id')::uuid;
      END IF;

      IF NOT public._bonus_product_eligible(v_bonus_product.id) THEN
        RAISE EXCEPTION 'BONUS_PRODUCT_NOT_ELIGIBLE: %', v_bonus_product.id;
      END IF;

      IF v_bonus_product.is_out_of_stock = true AND v_bonus_product.is_active = true THEN
        RAISE EXCEPTION 'ORDER_CONTAINS_OUT_OF_STOCK_PRODUCTS';
      END IF;

      v_bonus_geo_base := public._bonus_geo_base_unit_price(
        v_bonus_product.carton_price, v_bonus_product.piece_price, v_bonus_product.dozen_price,
        COALESCE(v_bonus_item->>'unit_type', 'piece'),
        p_bonus_governorate_id, v_bonus_product.company_id, v_bonus_product.id
      );
      IF v_bonus_geo_base IS NULL THEN
        RAISE EXCEPTION 'PRICE_NOT_CONFIGURED: %', v_bonus_product.id;
      END IF;

      -- Bonus lines must be priced EXACTLY at the geo base (no discount allowed)
      IF ABS(COALESCE((v_bonus_item->>'unit_price')::numeric, 0) - v_bonus_geo_base) > 0.011
         OR ABS(COALESCE((v_bonus_item->>'base_unit_price')::numeric, 0) - v_bonus_geo_base) > 0.011 THEN
        RAISE EXCEPTION 'BONUS_PRICE_MISMATCH: %', v_bonus_product.id;
      END IF;

      v_calculated_total_price := ROUND((v_bonus_geo_base
        * GREATEST(COALESCE((v_bonus_item->>'unit_quantity')::integer, 1), 1))::numeric, 2);
      v_server_bonus_products_total := v_server_bonus_products_total + v_calculated_total_price;

      v_line_bonus_applied := GREATEST(LEAST(v_remaining_bonus_credit, v_calculated_total_price), 0);
      v_remaining_bonus_credit := v_remaining_bonus_credit - v_line_bonus_applied;

      INSERT INTO public.order_items (
        order_id, product_id, unit_type, unit_quantity, piece_quantity,
        unit_price, base_unit_price, total_price, is_bonus, bonus_applied_amount
      ) VALUES (
        v_order.id, v_bonus_product.id,
        COALESCE(v_bonus_item->>'unit_type', 'piece'),
        GREATEST(COALESCE((v_bonus_item->>'unit_quantity')::integer, 1), 1),
        GREATEST(COALESCE((v_bonus_item->>'piece_quantity')::integer, 0), 1),
        v_bonus_geo_base, v_bonus_geo_base, v_calculated_total_price,
        true, v_line_bonus_applied
      );
    END LOOP;
  END IF;

  -- Verify the client-provided Bonus financial snapshot against the SERVER
  -- aggregates (verify-not-reprice). Any mismatch aborts the whole order.
  IF v_bonus_active THEN
    v_server_main_base_total := ROUND(v_server_main_base_total, 2);
    v_server_bonus_credit := ROUND(v_server_bonus_credit, 2);
    v_server_bonus_products_total := ROUND(v_server_bonus_products_total, 2);
    v_server_bonus_applied := ROUND(LEAST(v_server_bonus_credit, v_server_bonus_products_total), 2);
    v_server_bonus_unused := ROUND(GREATEST(v_server_bonus_credit - v_server_bonus_products_total, 0), 2);
    v_server_bonus_overflow := ROUND(GREATEST(v_server_bonus_products_total - v_server_bonus_credit, 0), 2);

    IF ABS(v_server_main_base_total - COALESCE(p_main_base_total, 0)) > 0.011
       OR ABS(v_server_bonus_credit - COALESCE(p_bonus_credit, 0)) > 0.011
       OR ABS(v_server_bonus_products_total - COALESCE(p_bonus_products_total, 0)) > 0.011
       OR ABS(v_server_bonus_applied - COALESCE(p_bonus_applied, 0)) > 0.011
       OR ABS(v_server_bonus_unused - COALESCE(p_bonus_unused, 0)) > 0.011
       OR ABS(v_server_bonus_overflow - COALESCE(p_bonus_overflow, 0)) > 0.011 THEN
      RAISE EXCEPTION 'BONUS_FINANCIALS_MISMATCH: server_credit=% products=% overflow=% vs client_credit=% products=% overflow=%',
        v_server_bonus_credit, v_server_bonus_products_total, v_server_bonus_overflow,
        p_bonus_credit, p_bonus_products_total, p_bonus_overflow;
    END IF;

    -- Overflow requires EXPLICIT approval server-side; bypassing it is impossible.
    IF v_server_bonus_overflow > 0 AND COALESCE(p_bonus_overflow_approved, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'BONUS_OVERFLOW_NOT_APPROVED';
    END IF;
  END IF;

  -- Finalize draft totals + freeze the verified Bonus state (NULL when OFF).
  UPDATE public.orders SET
    subtotal = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id),
    total_amount = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id),
    bonus_mode_used = CASE WHEN v_bonus_active THEN true ELSE NULL END,
    bonus_credit = CASE WHEN v_bonus_active THEN v_server_bonus_credit ELSE NULL END,
    bonus_products_total = CASE WHEN v_bonus_active THEN v_server_bonus_products_total ELSE NULL END,
    bonus_applied = CASE WHEN v_bonus_active THEN v_server_bonus_applied ELSE NULL END,
    bonus_unused = CASE WHEN v_bonus_active THEN v_server_bonus_unused ELSE NULL END,
    bonus_overflow = CASE WHEN v_bonus_active THEN v_server_bonus_overflow ELSE NULL END,
    main_base_total = CASE WHEN v_bonus_active THEN v_server_main_base_total ELSE NULL END
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
    'order_number', v_order.order_number,
    'bonus_mode_used', CASE WHEN v_bonus_active THEN true ELSE NULL END,
    'bonus_credit', v_server_bonus_credit,
    'bonus_products_total', v_server_bonus_products_total,
    'bonus_applied', v_server_bonus_applied,
    'bonus_unused', v_server_bonus_unused,
    'bonus_overflow', v_server_bonus_overflow,
    'main_base_total', v_server_main_base_total
  );
END;
$$;

COMMENT ON FUNCTION public.governed_create_order(uuid, uuid, uuid, text, jsonb, uuid, numeric, numeric, numeric, timestamptz, varchar, uuid, uuid, jsonb, boolean, numeric, numeric, numeric, numeric, numeric, numeric, boolean, uuid) IS
  'إنشاء طلب (نسخة فائقة): بونص شرائح يُفعّل عند تمرير p_bonus_mode_used=true مع عناصر البونص والبيانات المالية المجمدة — يتحقق الخادم من الأسعار والائتمان والمجاميع (verify-not-reprice) ويجمد الحالة كاملة، ويتطلب موافقة صريحة عند تجاوز رصيد البونص. وضع الخصم المباشر (OFF) لا يتغير إطلاقاً.';

-- ----------------------------------------------------------------------------
-- A4. governed_submit_order — SUPERSET (bonus-aware final totals).
--     Signature preserved: (p_token text, p_id uuid). OFF branch is untouched.
--     For Bonus orders: subtotal = Σ order_items + deals + flash;
--     discount_amount := bonus_applied; total := main_base_total + bonus_overflow
--     + deals + flash == netTotal the client displayed. Snapshot columns and the
--     allocation/notice engine are unchanged.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_submit_order(
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
  v_order public.orders;
  v_old_status text;
  v_is_revision boolean;
  v_creator_identity_type text;
  v_bonus_active boolean;
  v_product_subtotal numeric := 0;
  v_deal_total numeric := 0;
  v_flash_offer_total numeric := 0;
  v_req_row record;
  v_requested integer;
  v_reserved integer;
  v_capacity integer;
  v_notices jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_old_status := v_order.status;

  IF v_old_status NOT IN ('draft', 'returned_for_revision', 'stock_review') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: only draft, returned_for_revision, or stock_review orders can be submitted');
  END IF;

  v_is_revision := EXISTS(
    SELECT 1 FROM public.order_modification_history
    WHERE order_id = p_id AND field_name = 'REVISION_SNAPSHOT'
  );

  IF v_session.identity_type = 'employee' THEN
    IF NOT v_is_revision THEN
      IF NOT public.check_capability(p_token, 'orders.create') THEN
        RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.create');
      END IF;
      IF v_order.created_by IS DISTINCT FROM v_session.identity_id THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN: only the order creator can submit');
      END IF;
    ELSE
      SELECT identity_type INTO v_creator_identity_type
      FROM public.identities WHERE id = v_order.created_by;
    END IF;
  END IF;

  -- Bonus Mode snapshot (frozen at creation; immutable later)
  v_bonus_active := COALESCE(v_order.bonus_mode_used, false);

  SELECT COALESCE(SUM(total_price), 0) INTO v_product_subtotal
  FROM public.order_items WHERE order_id = p_id;

  SELECT COALESCE(SUM(total_price), 0) INTO v_deal_total
  FROM public.order_daily_deals WHERE order_id = p_id;

  SELECT COALESCE(SUM(total_price), 0) INTO v_flash_offer_total
  FROM public.order_flash_offers WHERE order_id = p_id;

  UPDATE public.orders SET
    status = 'submitted',
    submitted_at = now(),
    subtotal = v_product_subtotal + v_deal_total + v_flash_offer_total,
    discount_amount = CASE
      -- Bonus Mode: the bonus products are "paid for" by the verified Credit, so
      -- the payable discount equals bonus_applied and the final payable is
      -- main_base_total + bonus_overflow + deals + flash.
      WHEN v_bonus_active THEN COALESCE(v_order.bonus_applied, 0)
      ELSE discount_amount
    END,
    total_amount = CASE
      WHEN v_bonus_active THEN
        ROUND((COALESCE(v_order.main_base_total, 0) + COALESCE(v_order.bonus_overflow, 0)
               + v_deal_total + v_flash_offer_total)::numeric, 2)
      ELSE v_product_subtotal + v_deal_total + v_flash_offer_total - COALESCE(discount_amount, 0)
    END,
    updated_at = now()
  WHERE id = p_id;

  -- Allocation + capacity notice (BR-RS-03/05), unchanged.
  FOR v_req_row IN
    SELECT DISTINCT oi.product_id
    FROM public.order_items oi
    WHERE oi.order_id = p_id
  LOOP
    v_requested := public._requested_quantity_for_order(v_req_row.product_id, p_id);
    v_reserved  := public._reserved_quantity_for_order(v_req_row.product_id, p_id);
    v_capacity  := public._reservation_capacity(v_req_row.product_id, p_id);

    IF v_reserved > 0 AND v_capacity IS NOT NULL THEN
      INSERT INTO public.inventory_movements
        (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
      VALUES (
        v_req_row.product_id, p_id, v_reserved, 'RESERVATION_ALLOCATE',
        'تم حجز الكمية لهذا الصنف.',
        0, v_reserved, v_session.identity_id
      );
    END IF;

    IF v_capacity IS NOT NULL AND v_requested > v_capacity THEN
      INSERT INTO public.inventory_movements
        (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
      VALUES (
        v_req_row.product_id, p_id, v_requested, 'RESERVATION_NOTICE',
        'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك. قد يتم تعديل الكمية تلقائيًا عند اعتماد الفواتير حسب أولوية التقديم.',
        0, v_requested, v_session.identity_id
      );
      v_notices := v_notices || jsonb_build_object(
        'product_id', v_req_row.product_id,
        'requested_quantity', v_requested,
        'available_capacity', v_capacity
      );
    END IF;
  END LOOP;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'submitted', v_session.identity_id, now());

  RETURN jsonb_build_object(
    'success', true,
    'status', 'submitted',
    'reservations_notice', v_notices,
    'bonus_mode_used', v_bonus_active,
    'total_amount', CASE
      WHEN v_bonus_active THEN
        ROUND((COALESCE(v_order.main_base_total, 0) + COALESCE(v_order.bonus_overflow, 0)
               + v_deal_total + v_flash_offer_total)::numeric, 2)
      ELSE v_product_subtotal + v_deal_total + v_flash_offer_total - COALESCE(v_order.discount_amount, 0)
    END
  );
END;
$$;

COMMENT ON FUNCTION public.governed_submit_order IS
  'إرسال الطلب (نسخة فائقة): في وضع بونص الشرائح يصبح المطلوب نهائياً = الرئيسي + تجاوز البونص + العروض والصفقات، ويُسجل الخصم = البونص المطبق. وضع الخصم المباشر بلا أي تغيير.';

-- ----------------------------------------------------------------------------
-- A5. get_order_bonus_snapshots — additive read API for saved Bonus state.
--     Mirrors the get_order_discount_snapshots pattern: session-validated,
--     access-restricted to the caller's own orders, returns the frozen bonus_*
--     fields + per-line (is_bonus, base/unit/total price, bonus_applied_amount).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_order_bonus_snapshots(
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
  v_count int;
  v_snap jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT COUNT(*) INTO v_count FROM public.orders o
  WHERE o.id = ANY(p_order_ids)
    AND (o.created_by = v_session.identity_id OR o.owner_id = v_session.identity_id);

  IF v_count <> COALESCE(array_length(p_order_ids, 1), 0) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'order_id', o.id,
      'order_number', o.order_number,
      'bonus_mode_used', o.bonus_mode_used,
      'bonus_credit', o.bonus_credit,
      'bonus_products_total', o.bonus_products_total,
      'bonus_applied', o.bonus_applied,
      'bonus_unused', o.bonus_unused,
      'bonus_overflow', o.bonus_overflow,
      'main_base_total', o.main_base_total,
      'items', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            'product_id', oi.product_id,
            'unit_type', oi.unit_type,
            'unit_quantity', oi.unit_quantity,
            'piece_quantity', oi.piece_quantity,
            'base_unit_price', oi.base_unit_price,
            'unit_price', oi.unit_price,
            'total_price', oi.total_price,
            'is_bonus', oi.is_bonus,
            'bonus_applied_amount', oi.bonus_applied_amount
          ) ORDER BY oi.id
        ) FROM public.order_items oi WHERE oi.order_id = o.id),
        '[]'::jsonb
      )
    )
    ORDER BY o.created_at
  ), '[]'::jsonb) INTO v_snap
  FROM public.orders o
  WHERE o.id = ANY(p_order_ids)
    AND (o.created_by = v_session.identity_id OR o.owner_id = v_session.identity_id);

  RETURN v_snap;
END;
$$;

COMMENT ON FUNCTION public.get_order_bonus_snapshots IS
  'قراءة لقطات البونص المجمدة للطلبات (للقراءة فقط، ضمن صلاحيات المنشئ/المالك): bonus_* + عناصر البونص (السعر الأساسي والمطبق).';

-- ============================================================================
-- GRANTS (authoritative + deterministic, mirrors 20260708 rationale)
-- ============================================================================

GRANT EXECUTE ON FUNCTION public._bonus_geo_base_unit_price(numeric, numeric, numeric, text, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._bonus_product_eligible(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_create_order(uuid, uuid, uuid, text, jsonb, uuid, numeric, numeric, numeric, timestamptz, varchar, uuid, uuid, jsonb, boolean, numeric, numeric, numeric, numeric, numeric, numeric, boolean, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_submit_order(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_order_bonus_snapshots(uuid, uuid[]) TO authenticated, service_role;

-- ============================================================================
-- END OF PHASE 5 — ORDER-CREATION SERVER-SIDE BONUS PERSISTENCE + TOGGLE FIX
-- ============================================================================