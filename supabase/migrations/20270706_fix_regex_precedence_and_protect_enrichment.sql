-- ============================================================================
-- FIX: Regex operator precedence + enrichment exception protection
--
-- Problem:
--   PostgreSQL `~*` and `||` share the same operator-precedence group.
--   `WHERE v_fmt ~* '\m' || rc.name_ar || '\M'`
--   was evaluated as `(v_fmt ~* '\m') || rc.name_ar || '\M'`
--   → boolean || text → "argument of WHERE must be type boolean, not type text"
--
-- Fix:
--   1. Wrap all regex concatenation in parentheses:
--      `WHERE v_fmt ~* ('\m' || rc.name_ar || '\M')`
--   2. Enrichment runs inside a BEGIN/EXCEPTION block in
--      governed_checkout_visit so a failure never kills the visit.
-- ============================================================================

-- ============================================================================
-- 1. fn_enrich_customer_location — fix regex parens
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
  v_ex_lat            numeric;
  v_ex_lng            numeric;

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

  SELECT city, governorate, city_id, governorate_id, id, latitude, longitude
  INTO v_ex_city, v_ex_gov, v_ex_city_id, v_ex_gov_id, v_addr_id, v_ex_lat, v_ex_lng
  FROM customer_addresses
  WHERE customer_id = p_customer_id AND is_default = true;

  -- ========================================================================
  -- GPS ENRICHMENT (customers.location_id → unified_locations)
  -- ========================================================================
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    IF v_cur_location_id IS NULL THEN
      v_new_location_id := gen_random_uuid();
      INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
      VALUES (v_new_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());
      UPDATE customers SET location_id = v_new_location_id, updated_at = now()
      WHERE id = p_customer_id;
    ELSE
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

  -- ── Resolve the formatted_address for city/gov matching ──
  v_fmt := p_formatted_address;
  IF v_fmt IS NULL THEN
    SELECT formatted_address INTO v_fmt
    FROM unified_locations
    WHERE id = COALESCE(v_cur_location_id, v_new_location_id);
  END IF;

  -- ========================================================================
  -- CITY / GOVERNORATE + COORDINATES ENRICHMENT (customer_addresses)
  -- ========================================================================
  IF (v_ex_city IS NULL OR v_ex_city = '' OR v_ex_gov IS NULL OR v_ex_gov = ''
      OR v_ex_lat IS NULL OR v_ex_lng IS NULL)
    AND (v_fmt IS NOT NULL AND v_fmt != ''
         OR p_latitude IS NOT NULL AND p_longitude IS NOT NULL)
  THEN
    -- ── Attempt 1: word-boundary match on city → infer governorate ──
    SELECT rc.id, rc.name_ar, rc.governorate_id
    INTO v_city_id, v_city_name, v_gov_id_from_city
    FROM reference_cities rc
    WHERE v_fmt ~* ('\m' || rc.name_ar || '\M')
    ORDER BY rc.display_order
    LIMIT 1;

    IF v_city_id IS NOT NULL THEN
      SELECT rg.id, rg.name_ar INTO v_gov_id, v_gov_name
      FROM reference_governorates rg WHERE rg.id = v_gov_id_from_city;
    END IF;

    -- ── Attempt 2: word-boundary match on governorate ──
    IF v_gov_id IS NULL THEN
      SELECT rg.id, rg.name_ar INTO v_gov_id, v_gov_name
      FROM reference_governorates rg
      WHERE v_fmt ~* ('\m' || rg.name_ar || '\M')
      ORDER BY rg.display_order
      LIMIT 1;
    END IF;

    -- ── Attempt 3: ILIKE fallback on city ──
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

    -- ── UPSERT default address with latitude/longitude ──
    INSERT INTO customer_addresses (
      customer_id, address_line1,
      city, governorate, city_id, governorate_id,
      latitude, longitude,
      address_source, location_accuracy, address_updated_at,
      is_default
    ) VALUES (
      p_customer_id,
      COALESCE(NULLIF(v_fmt, ''), ''),
      COALESCE(NULLIF(v_city_name, ''), v_ex_city, ''),
      COALESCE(NULLIF(v_gov_name, ''), v_ex_gov, ''),
      COALESCE(v_city_id, v_ex_city_id),
      COALESCE(v_gov_id, v_ex_gov_id),
      COALESCE(v_ex_lat, p_latitude),
      COALESCE(v_ex_lng, p_longitude),
      CASE WHEN p_latitude IS NOT NULL THEN 'gps'::address_source_type ELSE 'mixed'::address_source_type END,
      p_accuracy_level, now(),
      true
    )
    ON CONFLICT (customer_id) WHERE is_default = true
    DO UPDATE SET
      city             = COALESCE(NULLIF(customer_addresses.city, ''), EXCLUDED.city),
      governorate      = COALESCE(NULLIF(customer_addresses.governorate, ''), EXCLUDED.governorate),
      city_id          = COALESCE(customer_addresses.city_id, EXCLUDED.city_id),
      governorate_id   = COALESCE(customer_addresses.governorate_id, EXCLUDED.governorate_id),
      latitude         = COALESCE(customer_addresses.latitude, EXCLUDED.latitude),
      longitude        = COALESCE(customer_addresses.longitude, EXCLUDED.longitude),
      address_source   = CASE WHEN customer_addresses.address_source IS NULL THEN EXCLUDED.address_source ELSE customer_addresses.address_source END,
      location_accuracy = CASE WHEN customer_addresses.location_accuracy IS NULL THEN EXCLUDED.location_accuracy ELSE customer_addresses.location_accuracy END,
      address_updated_at = now(),
      street_address   = COALESCE(customer_addresses.street_address,
                           CASE WHEN EXCLUDED.address_line1 IS NOT NULL AND EXCLUDED.address_line1 != ''
                           THEN LEFT(EXCLUDED.address_line1, 255) END);
  END IF;
END;
$$;

-- ============================================================================
-- 2. governed_checkout_visit — enrichment wrapped in BEGIN/EXCEPTION
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

  -- Enrich customer using shared service (best-effort, must never fail visit)
  BEGIN
    SELECT formatted_address INTO v_formatted_address
    FROM unified_locations WHERE id = p_end_location_id;

    PERFORM fn_enrich_customer_location(
      p_customer_id        := v_customer_id,
      p_latitude           := p_latitude,
      p_longitude          := p_longitude,
      p_formatted_address  := v_formatted_address,
      p_accuracy_level     := 'GPS'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'governed_checkout_visit: enrichment failed for visit % (customer %): %', p_visit_id, v_customer_id, SQLERRM;
  END;

  RETURN jsonb_build_object('success', true);
END;
$$;
