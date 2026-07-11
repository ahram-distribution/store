-- ============================================================================
-- UNIFIED CUSTOMER ENRICHMENT SYSTEM
--
-- 1. fn_enrich_customer_location — shared enrichment service (single source
--    of truth for all customer data enrichment logic)
-- 2. governed_checkout_visit — updated to use shared enrichment
-- 3. governed_create_order — calls enrichment after order creation
-- 4. governed_update_customer — refactored to use shared enrichment +
--    new address params (governorate_id, city_id, street_address, landmark)
-- 5. get_governed_data_quality_report — management dashboard for data quality
-- ============================================================================

-- ============================================================================
-- 1. SHARED ENRICHMENT FUNCTION
-- ============================================================================
-- Called by any RPC that has fresh customer GPS / address data.
-- Enriches only missing fields — never overwrites existing data.
-- Matching strategy (priority order):
--   1. Word-boundary regex on reference_cities.name_ar → infer governorate
--   2. Word-boundary regex on reference_governorates.name_ar
--   3. ILIKE fallback on reference_cities.name_ar
--   4. ILIKE fallback on reference_governorates.name_ar
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_enrich_customer_location(
  p_customer_id  uuid,
  p_latitude     numeric DEFAULT NULL,
  p_longitude    numeric DEFAULT NULL,
  p_accuracy_meters numeric DEFAULT NULL,
  p_formatted_address text DEFAULT NULL,
  p_accuracy_level location_accuracy_level DEFAULT 'GPS'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_cur_location_id   uuid;
  v_cur_lat           numeric;
  v_cur_lng           numeric;
  v_cur_fmt_addr      text;

  v_addr_id           uuid;
  v_ex_city           varchar(100);
  v_ex_gov            varchar(100);
  v_ex_city_id        uuid;
  v_ex_gov_id         uuid;

  v_new_location_id   uuid;
  v_fmt               text;

  v_city_id           uuid;
  v_city_name         varchar(200);
  v_gov_id_from_city  uuid;
  v_gov_id            uuid;
  v_gov_name          varchar(200);
BEGIN
  -- ── Read current customer state ──
  SELECT location_id INTO v_cur_location_id
  FROM customers WHERE id = p_customer_id;

  SELECT city, governorate, city_id, governorate_id, id
  INTO v_ex_city, v_ex_gov, v_ex_city_id, v_ex_gov_id, v_addr_id
  FROM customer_addresses
  WHERE customer_id = p_customer_id AND is_default = true;

  -- ========================================================================
  -- GPS ENRICHMENT (customers.location_id → unified_locations)
  -- ========================================================================
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    IF v_cur_location_id IS NULL THEN
      -- No location yet → create one
      v_new_location_id := gen_random_uuid();
      INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
      VALUES (v_new_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());
      UPDATE customers SET location_id = v_new_location_id, updated_at = now()
      WHERE id = p_customer_id;
    ELSE
      -- Has location → update only NULL columns
      SELECT latitude, longitude, formatted_address
      INTO v_cur_lat, v_cur_lng, v_cur_fmt_addr
      FROM unified_locations WHERE id = v_cur_location_id;

      UPDATE unified_locations
      SET
        latitude         = COALESCE(NULLIF(latitude, 0), p_latitude),
        longitude        = COALESCE(NULLIF(longitude, 0), p_longitude),
        accuracy_meters  = CASE WHEN accuracy_meters IS NULL THEN p_accuracy_meters ELSE accuracy_meters END,
        formatted_address = COALESCE(formatted_address, p_formatted_address)
      WHERE id = v_cur_location_id;
    END IF;
  END IF;

  -- ── Resolve the formatted_address to use for city/gov matching ──
  v_fmt := p_formatted_address;
  IF v_fmt IS NULL THEN
    SELECT formatted_address INTO v_fmt
    FROM unified_locations
    WHERE id = COALESCE(v_cur_location_id, v_new_location_id);
  END IF;

  -- ========================================================================
  -- CITY / GOVERNORATE ENRICHMENT (customer_addresses)
  -- Skip if both governorate and city are already populated
  -- ========================================================================
  IF (v_ex_city IS NULL OR v_ex_city = '' OR v_ex_gov IS NULL OR v_ex_gov = '')
    AND v_fmt IS NOT NULL AND v_fmt != ''
  THEN
    -- ── Attempt 1: word-boundary match on city name → infer governorate ──
    SELECT rc.id, rc.name_ar, rc.governorate_id
    INTO v_city_id, v_city_name, v_gov_id_from_city
    FROM reference_cities rc
    WHERE v_fmt ~* '\m' || rc.name_ar || '\M'
    ORDER BY rc.display_order
    LIMIT 1;

    IF v_city_id IS NOT NULL THEN
      SELECT rg.id, rg.name_ar INTO v_gov_id, v_gov_name
      FROM reference_governorates rg WHERE rg.id = v_gov_id_from_city;
    END IF;

    -- ── Attempt 2: word-boundary match on governorate name ──
    IF v_gov_id IS NULL THEN
      SELECT rg.id, rg.name_ar INTO v_gov_id, v_gov_name
      FROM reference_governorates rg
      WHERE v_fmt ~* '\m' || rg.name_ar || '\M'
      ORDER BY rg.display_order
      LIMIT 1;
    END IF;

    -- ── Attempt 3: ILIKE fallback on city (scoped to matched governorate) ──
    IF v_city_id IS NULL THEN
      SELECT rc.id, rc.name_ar INTO v_city_id, v_city_name
      FROM reference_cities rc
      WHERE (v_gov_id IS NULL OR rc.governorate_id = v_gov_id)
        AND v_fmt ILIKE '%' || rc.name_ar || '%'
      ORDER BY rc.display_order
      LIMIT 1;

      IF v_city_id IS NOT NULL AND v_gov_id IS NULL THEN
        SELECT rg.id, rg.name_ar INTO v_gov_id, v_gov_name
        FROM reference_governorates rg
        WHERE rg.id = (SELECT governorate_id FROM reference_cities WHERE id = v_city_id);
      END IF;
    END IF;

    -- ── Attempt 4: ILIKE fallback on governorate ──
    IF v_gov_id IS NULL THEN
      SELECT rg.id, rg.name_ar INTO v_gov_id, v_gov_name
      FROM reference_governorates rg
      WHERE v_fmt ILIKE '%' || rg.name_ar || '%'
      ORDER BY rg.display_order
      LIMIT 1;
    END IF;

    -- ── UPSERT default address (only fill missing fields) ──
    INSERT INTO customer_addresses (
      customer_id, address_line1,
      city, governorate, city_id, governorate_id,
      address_source, location_accuracy, address_updated_at,
      is_default
    ) VALUES (
      p_customer_id,
      COALESCE(NULLIF(v_fmt, ''), ''),
      COALESCE(NULLIF(v_city_name, ''), v_ex_city, ''),
      COALESCE(NULLIF(v_gov_name, ''), v_ex_gov, ''),
      COALESCE(v_city_id, v_ex_city_id),
      COALESCE(v_gov_id, v_ex_gov_id),
      p_accuracy_level, p_accuracy_level, now(),
      true
    )
    ON CONFLICT (customer_id) WHERE is_default = true
    DO UPDATE SET
      city             = COALESCE(NULLIF(customer_addresses.city, ''), EXCLUDED.city),
      governorate      = COALESCE(NULLIF(customer_addresses.governorate, ''), EXCLUDED.governorate),
      city_id          = COALESCE(customer_addresses.city_id, EXCLUDED.city_id),
      governorate_id   = COALESCE(customer_addresses.governorate_id, EXCLUDED.governorate_id),
      address_source   = CASE WHEN customer_addresses.address_source IS NULL THEN EXCLUDED.address_source ELSE customer_addresses.address_source END,
      location_accuracy = CASE WHEN customer_addresses.location_accuracy IS NULL THEN EXCLUDED.location_accuracy ELSE customer_addresses.location_accuracy END,
      address_updated_at = now(),
      street_address   = COALESCE(customer_addresses.street_address,
                           CASE WHEN EXCLUDED.address_line1 IS NOT NULL AND EXCLUDED.address_line1 != ''
                           THEN LEFT(EXCLUDED.address_line1, 255) END);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_enrich_customer_location IS
  'إثراء بيانات العميل (الموقع GPS والمحافظة والمدينة) من بيانات متاحة — لا يتم الكتابة فوق البيانات الموجودة';

-- ============================================================================
-- 2. governed_checkout_visit (updated — uses shared enrichment)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_checkout_visit(
  p_token uuid,
  p_visit_id uuid,
  p_visit_result varchar DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_end_location_id uuid DEFAULT NULL,
  p_latitude decimal DEFAULT NULL,
  p_longitude decimal DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_visit_status varchar(20);
  v_customer_id uuid;
  v_formatted_address text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT status, customer_id INTO v_visit_status, v_customer_id FROM visits WHERE id = p_visit_id;
  IF v_visit_status IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_visit_status != 'active' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE public.visits
  SET
    status = 'completed',
    check_out_at = now(),
    end_location_id = COALESCE(p_end_location_id, end_location_id),
    check_out_latitude = COALESCE(p_latitude, check_out_latitude),
    check_out_longitude = COALESCE(p_longitude, check_out_longitude),
    visit_result = COALESCE(p_visit_result, visit_result),
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE id = p_visit_id;

  -- Resolve formatted_address from the visit's end_location if available
  SELECT formatted_address INTO v_formatted_address
  FROM unified_locations WHERE id = p_end_location_id;

  -- Enrich customer using shared service
  PERFORM fn_enrich_customer_location(
    p_customer_id        := v_customer_id,
    p_latitude           := p_latitude,
    p_longitude          := p_longitude,
    p_formatted_address  := v_formatted_address,
    p_accuracy_level     := 'GPS'
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_checkout_visit IS 'تسجيل خروج زيارة مع إثراء بيانات العميل تلقائياً';

-- ============================================================================
-- 3. governed_update_customer (updated — new address params + shared enrichment)
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_update_customer(p_token uuid, p_id uuid, p_company_name varchar, p_email varchar, p_credit_limit decimal, p_credit_days integer, p_business_type business_type, p_responsible_name varchar, p_password varchar, p_phone varchar);

CREATE OR REPLACE FUNCTION public.governed_update_customer(
  p_token uuid,
  p_id uuid,
  p_company_name varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL,
  p_credit_limit decimal DEFAULT NULL,
  p_credit_days integer DEFAULT NULL,
  p_business_type business_type DEFAULT NULL,
  p_responsible_name varchar DEFAULT NULL,
  p_password varchar DEFAULT NULL,
  p_phone varchar DEFAULT NULL,
  -- Location / Address (unified_locations)
  p_formatted_address text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_accuracy_meters numeric DEFAULT NULL,
  -- Contact info
  p_contact_name varchar DEFAULT NULL,
  p_contact_phone varchar DEFAULT NULL,
  -- Structured address (customer_addresses)
  p_governorate_id uuid DEFAULT NULL,
  p_city_id uuid DEFAULT NULL,
  p_street_address varchar DEFAULT NULL,
  p_landmark text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_identity_id uuid;
  v_location_id uuid;
  v_has_any_location_input boolean;
  v_has_any_contact_input boolean;
  v_has_any_address_input boolean;
  v_fmt text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'customers.update');

  -- Update customers table fields
  UPDATE public.customers
  SET
    company_name = COALESCE(p_company_name, company_name),
    email = COALESCE(p_email, email),
    credit_limit = COALESCE(p_credit_limit, credit_limit),
    credit_days = COALESCE(p_credit_days, credit_days),
    business_type = COALESCE(p_business_type, business_type),
    responsible_name = COALESCE(p_responsible_name, responsible_name),
    updated_at = now()
  WHERE id = p_id;

  -- Update identity phone
  IF p_phone IS NOT NULL THEN
    SELECT identity_id INTO v_identity_id FROM public.customers WHERE id = p_id;
    IF v_identity_id IS NOT NULL THEN
      UPDATE public.identities SET phone = p_phone WHERE id = v_identity_id;
    END IF;
  END IF;

  -- Update identity password
  IF p_password IS NOT NULL THEN
    IF v_identity_id IS NULL THEN
      SELECT identity_id INTO v_identity_id FROM public.customers WHERE id = p_id;
    END IF;
    IF v_identity_id IS NOT NULL THEN
      UPDATE public.identities SET password_hash = extensions.crypt(p_password::text, extensions.gen_salt('bf')) WHERE id = v_identity_id;
    END IF;
  END IF;

  -- ==========================================================================
  -- Update Location (unified_locations)
  -- ==========================================================================
  v_has_any_location_input := p_formatted_address IS NOT NULL
    OR p_latitude IS NOT NULL
    OR p_longitude IS NOT NULL
    OR p_accuracy_meters IS NOT NULL;

  IF v_has_any_location_input THEN
    SELECT location_id INTO v_location_id FROM public.customers WHERE id = p_id;

    IF v_location_id IS NOT NULL THEN
      UPDATE public.unified_locations
      SET
        formatted_address = COALESCE(p_formatted_address, formatted_address),
        latitude = COALESCE(p_latitude, latitude),
        longitude = COALESCE(p_longitude, longitude),
        accuracy_meters = COALESCE(p_accuracy_meters, accuracy_meters)
      WHERE id = v_location_id;
    ELSIF p_formatted_address IS NOT NULL OR p_latitude IS NOT NULL THEN
      v_location_id := gen_random_uuid();
      IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
        INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
        VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());
      ELSE
        INSERT INTO unified_locations (id, formatted_address, captured_at)
        VALUES (v_location_id, COALESCE(p_formatted_address, ''), now());
      END IF;
      UPDATE public.customers SET location_id = v_location_id, updated_at = now() WHERE id = p_id;
    END IF;
  END IF;

  -- ==========================================================================
  -- Update Contact Info (customer_contacts)
  -- ==========================================================================
  v_has_any_contact_input := p_contact_name IS NOT NULL OR p_contact_phone IS NOT NULL;

  IF v_has_any_contact_input THEN
    IF EXISTS (SELECT 1 FROM public.customer_contacts WHERE customer_id = p_id AND is_primary = true) THEN
      UPDATE public.customer_contacts
      SET
        full_name = COALESCE(p_contact_name, full_name),
        phone = COALESCE(p_contact_phone, phone)
      WHERE customer_id = p_id AND is_primary = true;
    ELSE
      INSERT INTO public.customer_contacts (customer_id, full_name, phone, is_primary)
      VALUES (p_id, COALESCE(p_contact_name, ''), COALESCE(p_contact_phone, ''), true);
    END IF;
  END IF;

  -- ==========================================================================
  -- Update Structured Address (customer_addresses)
  -- ==========================================================================
  v_has_any_address_input := p_governorate_id IS NOT NULL
    OR p_city_id IS NOT NULL
    OR p_street_address IS NOT NULL
    OR p_landmark IS NOT NULL;

  IF v_has_any_address_input THEN
    v_fmt := COALESCE(p_formatted_address,
      (SELECT formatted_address FROM unified_locations WHERE id =
        (SELECT location_id FROM customers WHERE id = p_id)
      )
    );

    INSERT INTO customer_addresses (customer_id, address_line1, city, governorate, city_id, governorate_id, street_address, landmark, address_source, address_updated_at, is_default)
    VALUES (
      p_id,
      COALESCE(v_fmt, ''),
      COALESCE((SELECT name_ar FROM reference_cities WHERE id = p_city_id),
               (SELECT city FROM customer_addresses WHERE customer_id = p_id AND is_default = true), ''),
      COALESCE((SELECT name_ar FROM reference_governorates WHERE id = p_governorate_id),
               (SELECT governorate FROM customer_addresses WHERE customer_id = p_id AND is_default = true), ''),
      p_city_id,
      p_governorate_id,
      p_street_address,
      p_landmark,
      'manual',
      now(),
      true
    )
    ON CONFLICT (customer_id) WHERE is_default = true
    DO UPDATE SET
      city             = COALESCE(NULLIF(customer_addresses.city, ''), EXCLUDED.city),
      governorate      = COALESCE(NULLIF(customer_addresses.governorate, ''), EXCLUDED.governorate),
      city_id          = COALESCE(customer_addresses.city_id, EXCLUDED.city_id),
      governorate_id   = COALESCE(customer_addresses.governorate_id, EXCLUDED.governorate_id),
      street_address   = COALESCE(NULLIF(customer_addresses.street_address, ''), p_street_address),
      landmark         = COALESCE(NULLIF(customer_addresses.landmark, ''), p_landmark),
      address_source   = COALESCE(customer_addresses.address_source, 'manual'),
      address_updated_at = now();
  END IF;

  -- Call shared enrichment (fills in any remaining gaps)
  PERFORM fn_enrich_customer_location(
    p_customer_id        := p_id,
    p_latitude           := p_latitude,
    p_longitude          := p_longitude,
    p_accuracy_meters    := p_accuracy_meters,
    p_formatted_address  := p_formatted_address,
    p_accuracy_level     := CASE WHEN p_latitude IS NOT NULL THEN 'GPS' ELSE 'GEOCODED' END
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_customer IS 'تعديل بيانات عميل مع النشاط التجاري والمسؤول والعنوان والموقع والمرجع';

-- ============================================================================
-- 4. governed_create_order (updated — calls enrichment after creation)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_create_order(
  p_token uuid, p_customer_id uuid,
  p_tier_id uuid DEFAULT NULL, p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]',
  p_execution_location_id uuid DEFAULT NULL,
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
  v_exec_location_id uuid;

  -- Snapshot variables
  v_cust_code text;
  v_cust_name text;
  v_cust_phone text;
  v_cust_address text;
  v_owner_name text;
  v_owner_phone text;
  v_owner_address text;
  v_sender_name text;
  v_sender_phone text;
  v_sender_address text;
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
  END IF;

  -- Validate no out_of_stock products in the order
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS v_item
    JOIN public.products p ON p.id = (v_item->>'product_id')::uuid
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

  -- Capture snapshot data BEFORE inserting
  SELECT
    c.code,
    c.company_name,
    COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
    COALESCE(
      (SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
      (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1),
      ''
    )
  INTO v_cust_code, v_cust_name, v_cust_phone, v_cust_address
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

  -- Insert order with snapshot
  IF v_session.identity_type = 'employee' THEN
    INSERT INTO public.orders (
      order_number, customer_id, owner_type, owner_id, created_by,
      notes, tier_id,
      execution_location_id, execution_latitude, execution_longitude,
      execution_accuracy_meters, execution_captured_at,
      snapshot_customer_code, snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
      snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
      snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address
    ) VALUES (
      v_order_number, p_customer_id, 'employee', v_session.identity_id, v_session.identity_id,
      p_notes, p_tier_id,
      v_exec_location_id, p_execution_latitude, p_execution_longitude,
      p_execution_accuracy_meters, p_execution_captured_at,
      v_cust_code, v_cust_name, v_cust_phone, v_cust_address,
      v_owner_name, v_owner_phone, v_owner_address,
      v_sender_name, v_sender_phone, v_sender_address
    )
    RETURNING * INTO v_order;
  ELSE
    INSERT INTO public.orders (
      order_number, customer_id, owner_type, owner_id, created_by,
      notes, tier_id,
      execution_location_id, execution_latitude, execution_longitude,
      execution_accuracy_meters, execution_captured_at,
      snapshot_customer_code, snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
      snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
      snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address
    ) VALUES (
      v_order_number, p_customer_id, 'customer', v_session.identity_id, v_session.identity_id,
      p_notes, p_tier_id,
      v_exec_location_id, p_execution_latitude, p_execution_longitude,
      p_execution_accuracy_meters, p_execution_captured_at,
      v_cust_code, v_cust_name, v_cust_phone, v_cust_address,
      v_owner_name, v_owner_phone, v_owner_address,
      v_sender_name, v_sender_phone, v_sender_address
    )
    RETURNING * INTO v_order;
  END IF;

  -- Insert order items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, product_code, product_name, unit_id, product_unit_id,
           selling_price, max_price, min_price, has_tax, tax_ratio, commercial_unit_ratio
    INTO v_product
    FROM products
    WHERE id = (v_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %', (v_item->>'product_id')::uuid;
    END IF;

    IF v_product.has_tax THEN
      v_calculated_unit_price := ROUND(
        ((v_item->>'unit_price')::numeric * (1 + v_product.tax_ratio / 100))::numeric, 2
      );
    ELSE
      v_calculated_unit_price := (v_item->>'unit_price')::numeric;
    END IF;

    v_calculated_total_price := ROUND(
      (v_calculated_unit_price * (v_item->>'unit_quantity')::numeric)::numeric, 2
    );

    INSERT INTO public.order_items (
      order_id, product_id, product_code, product_name, unit_id, product_unit_id,
      quantity, unit_price, total_price, selling_price, max_price, min_price,
      has_tax, tax_ratio, commercial_unit_ratio
    ) VALUES (
      v_order.id, v_product.id, v_product.product_code, v_product.product_name,
      v_product.unit_id, v_product.product_unit_id,
      (v_item->>'unit_quantity')::numeric, v_calculated_unit_price, v_calculated_total_price,
      v_product.selling_price, v_product.max_price, v_product.min_price,
      v_product.has_tax, v_product.tax_ratio, v_product.commercial_unit_ratio
    );
  END LOOP;

  INSERT INTO public.order_status_history (order_id, from_status, to_status)
  VALUES (v_order.id, 'draft', 'pending');

  UPDATE public.code_sequences
  SET last_sequence = v_seq
  WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int;

  -- Enrich customer from order execution location (if available)
  PERFORM fn_enrich_customer_location(
    p_customer_id        := p_customer_id,
    p_latitude           := p_execution_latitude,
    p_longitude          := p_execution_longitude,
    p_accuracy_meters    := p_execution_accuracy_meters,
    p_accuracy_level     := 'GEOCODED'
  );

  PERFORM pg_notify('order_created', jsonb_build_object('order_id', v_order.id, 'number', v_order.order_number)::text);

  RETURN jsonb_build_object(
    'success', true,
    'id', v_order.id,
    'order_number', v_order.order_number
  );
END;
$$;

COMMENT ON FUNCTION public.governed_create_order IS 'إنشاء طلب جديد مع إثراء بيانات العميل تلقائياً';

-- ============================================================================
-- 5. get_governed_data_quality_report — management dashboard
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_data_quality_report(
  p_token uuid,
  p_employee_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_total bigint;
  v_with_address bigint;
  v_with_gps bigint;
  v_with_governorate_only bigint;
  v_with_city_only bigint;
  v_with_address_no_gps bigint;
  v_with_gps_no_address bigint;
  v_complete bigint;
  v_needs_review bigint;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'locations.view_all') THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  -- Helper: filter by employee scope when p_employee_id is provided
  CREATE TEMP TABLE v_customer_ids ON COMMIT DROP AS
  SELECT c.id FROM customers c
  WHERE c.is_active = true
    AND (p_employee_id IS NULL OR c.owner_id = p_employee_id);

  SELECT COUNT(*) INTO v_total FROM v_customer_ids;

  -- Have city AND governorate in default address
  SELECT COUNT(*) INTO v_with_address
  FROM v_customer_ids v
  WHERE EXISTS (
    SELECT 1 FROM customer_addresses ca
    WHERE ca.customer_id = v.id AND ca.is_default = true
      AND ca.city IS NOT NULL AND ca.city != ''
      AND ca.governorate IS NOT NULL AND ca.governorate != ''
  );

  -- Have GPS (location_id)
  SELECT COUNT(*) INTO v_with_gps
  FROM v_customer_ids v
  JOIN customers c ON c.id = v.id AND c.location_id IS NOT NULL;

  -- Have governorate only (no city)
  SELECT COUNT(*) INTO v_with_governorate_only
  FROM v_customer_ids v
  WHERE EXISTS (
    SELECT 1 FROM customer_addresses ca
    WHERE ca.customer_id = v.id AND ca.is_default = true
      AND (ca.governorate IS NOT NULL AND ca.governorate != '')
      AND (ca.city IS NULL OR ca.city = '')
  );

  -- Have city only (no governorate)
  SELECT COUNT(*) INTO v_with_city_only
  FROM v_customer_ids v
  WHERE EXISTS (
    SELECT 1 FROM customer_addresses ca
    WHERE ca.customer_id = v.id AND ca.is_default = true
      AND (ca.city IS NOT NULL AND ca.city != '')
      AND (ca.governorate IS NULL OR ca.governorate = '')
  );

  -- Have address but no GPS
  SELECT COUNT(*) INTO v_with_address_no_gps
  FROM v_customer_ids v
  JOIN customers c ON c.id = v.id AND c.location_id IS NULL
  WHERE EXISTS (
    SELECT 1 FROM customer_addresses ca
    WHERE ca.customer_id = v.id AND ca.is_default = true
      AND ca.city IS NOT NULL AND ca.city != ''
      AND ca.governorate IS NOT NULL AND ca.governorate != ''
  );

  -- Have GPS but no address
  SELECT COUNT(*) INTO v_with_gps_no_address
  FROM v_customer_ids v
  JOIN customers c ON c.id = v.id AND c.location_id IS NOT NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM customer_addresses ca
    WHERE ca.customer_id = v.id AND ca.is_default = true
      AND ca.city IS NOT NULL AND ca.city != ''
      AND ca.governorate IS NOT NULL AND ca.governorate != ''
  );

  -- Complete (GPS + city + governorate + city_id + governorate_id)
  SELECT COUNT(*) INTO v_complete
  FROM v_customer_ids v
  JOIN customers c ON c.id = v.id AND c.location_id IS NOT NULL
  WHERE EXISTS (
    SELECT 1 FROM customer_addresses ca
    WHERE ca.customer_id = v.id AND ca.is_default = true
      AND ca.city IS NOT NULL AND ca.city != ''
      AND ca.governorate IS NOT NULL AND ca.governorate != ''
      AND ca.city_id IS NOT NULL
      AND ca.governorate_id IS NOT NULL
  );

  -- Need review (missing any core field)
  SELECT COUNT(*) INTO v_needs_review
  FROM v_customer_ids v
  WHERE NOT EXISTS (
    SELECT 1 FROM customer_addresses ca
    WHERE ca.customer_id = v.id AND ca.is_default = true
      AND ca.city IS NOT NULL AND ca.city != ''
      AND ca.governorate IS NOT NULL AND ca.governorate != ''
      AND ca.city_id IS NOT NULL
      AND ca.governorate_id IS NOT NULL
  )
  OR NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = v.id AND c.location_id IS NOT NULL);

  v_result := jsonb_build_object(
    'total_customers', v_total,
    'with_gps', v_with_gps,
    'with_address_city_governorate', v_with_address,
    'with_governorate_only', v_with_governorate_only,
    'with_city_only', v_with_city_only,
    'with_address_no_gps', v_with_address_no_gps,
    'with_gps_no_address', v_with_gps_no_address,
    'complete_data', v_complete,
    'needs_review', v_needs_review,
    'gps_percentage', CASE WHEN v_total > 0 THEN ROUND((v_with_gps::numeric / v_total) * 100, 1) ELSE 0 END,
    'address_percentage', CASE WHEN v_total > 0 THEN ROUND((v_with_address::numeric / v_total) * 100, 1) ELSE 0 END,
    'complete_percentage', CASE WHEN v_total > 0 THEN ROUND((v_complete::numeric / v_total) * 100, 1) ELSE 0 END
  );

  DROP TABLE IF EXISTS v_customer_ids;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_governed_data_quality_report IS 'تقرير جودة بيانات العملاء للإدارة';

-- ============================================================================
-- END OF UNIFIED CUSTOMER ENRICHMENT SYSTEM
-- ============================================================================
