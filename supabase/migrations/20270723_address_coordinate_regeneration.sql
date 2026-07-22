-- ================================================================
-- Address coordinate regeneration from reference geography
--
-- Changes:
--   1. fn_enrich_customer_location — when no GPS coordinates are
--      available, use coordinates from reference_cities or
--      reference_governorates as address_geocoded fallback.
--
--   2. One-time backfill: update customer_addresses coordinates
--      for all existing customers that have a city/governorate
--      lookup but NULL lat/lng.
--
-- Business impact:
--   - Address changes (Cairo → Giza) now auto-generate coordinates
--     from reference geography data
--   - Customers who lost city_center/governorate_center locations
--     regain map visibility via address_geocoded source
-- ================================================================

-- ================================================================
-- 1. Updated fn_enrich_customer_location with reference coordinate fallback
-- ================================================================

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
  v_ref_lat           numeric;
  v_ref_lng           numeric;
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

    -- ── Resolve reference coordinates from matched city or governorate ──
    v_ref_lat := COALESCE(
      (SELECT rc.latitude FROM reference_cities rc WHERE rc.id = v_city_id),
      (SELECT rg.latitude FROM reference_governorates rg WHERE rg.id = v_gov_id)
    );
    v_ref_lng := COALESCE(
      (SELECT rc.longitude FROM reference_cities rc WHERE rc.id = v_city_id),
      (SELECT rg.longitude FROM reference_governorates rg WHERE rg.id = v_gov_id)
    );

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
      COALESCE(v_ex_lat, p_latitude, v_ref_lat),
      COALESCE(v_ex_lng, p_longitude, v_ref_lng),
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
      latitude         = COALESCE(customer_addresses.latitude, EXCLUDED.latitude, v_ref_lat),
      longitude        = COALESCE(customer_addresses.longitude, EXCLUDED.longitude, v_ref_lng),
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
  'إثراء بيانات العميل (الموقع GPS والمحافظة والمدينة والإحداثيات) من بيانات متاحة — يدعم الإحداثيات المرجعية كبديل عند عدم وجود GPS';

-- ================================================================
-- 2. One-time backfill: populate customer_addresses coordinates
--    from reference geography for existing customers
-- ================================================================

UPDATE customer_addresses ca
SET
  latitude = COALESCE(ca.latitude, rc.latitude, rg.latitude),
  longitude = COALESCE(ca.longitude, rc.longitude, rg.longitude),
  address_source = CASE
    WHEN ca.latitude IS NULL AND ca.longitude IS NULL AND (rc.latitude IS NOT NULL OR rg.latitude IS NOT NULL)
    THEN 'mixed'::address_source_type
    ELSE ca.address_source
  END,
  location_accuracy = CASE
    WHEN ca.latitude IS NULL AND ca.longitude IS NULL AND (rc.latitude IS NOT NULL OR rg.latitude IS NOT NULL)
    THEN 'GEOCODED'::location_accuracy_level
    ELSE ca.location_accuracy
  END,
  address_updated_at = now()
FROM customers c
LEFT JOIN reference_cities rc ON rc.id = ca.city_id
LEFT JOIN reference_governorates rg ON rg.id = ca.governorate_id
WHERE ca.customer_id = c.id
  AND c.is_active = true
  AND ca.is_default = true
  AND (ca.latitude IS NULL OR ca.longitude IS NULL)
  AND (rc.latitude IS NOT NULL OR rg.latitude IS NOT NULL);
