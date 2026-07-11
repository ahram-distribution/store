-- ============================================================================
-- ENRICH CUSTOMER DATA ON VISIT COMPLETE
--
-- When a visit is checked out, automatically enrich the customer's:
--   1. GPS location (unified_locations → customers.location_id)
--   2. City / Governorate (customer_addresses)
--
-- Rule: enrich only when data is missing — never overwrite existing values.
-- Sources: visit checkout coordinates, unified_locations.formatted_address,
--          reference_governorates, reference_cities.
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
  v_location_id uuid;
  v_new_location_id uuid;
  v_formatted_address text;
  v_matched_gov_id uuid;
  v_matched_city_id uuid;
  v_matched_gov_name varchar(200);
  v_matched_city_name varchar(200);
  v_existing_city varchar(100);
  v_existing_governorate varchar(100);
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

  -- ==========================================================================
  -- ENRICHMENT 1: GPS (customers.location_id → unified_locations)
  -- Only if customer has no location_id AND checkout coordinates are provided
  -- ==========================================================================
  SELECT location_id INTO v_location_id FROM customers WHERE id = v_customer_id;

  IF v_location_id IS NULL AND p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    v_new_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, captured_at)
    VALUES (v_new_location_id, p_latitude, p_longitude, now());
    UPDATE customers SET location_id = v_new_location_id, updated_at = now() WHERE id = v_customer_id;
  END IF;

  -- ==========================================================================
  -- ENRICHMENT 2: City / Governorate (customer_addresses)
  -- Only if the customer's default address is missing city or governorate
  -- ==========================================================================
  SELECT city, governorate INTO v_existing_city, v_existing_governorate
  FROM customer_addresses
  WHERE customer_id = v_customer_id AND is_default = true;

  IF v_existing_city IS NULL OR v_existing_governorate IS NULL THEN
    SELECT formatted_address INTO v_formatted_address
    FROM unified_locations
    WHERE id = COALESCE(p_end_location_id, v_new_location_id);

    IF v_formatted_address IS NOT NULL THEN
      SELECT rg.id, rg.name_ar INTO v_matched_gov_id, v_matched_gov_name
      FROM reference_governorates rg
      WHERE v_formatted_address ILIKE '%' || rg.name_ar || '%'
      ORDER BY rg.display_order
      LIMIT 1;

      SELECT rc.id, rc.name_ar INTO v_matched_city_id, v_matched_city_name
      FROM reference_cities rc
      WHERE (v_matched_gov_id IS NULL OR rc.governorate_id = v_matched_gov_id)
        AND v_formatted_address ILIKE '%' || rc.name_ar || '%'
      ORDER BY rc.display_order
      LIMIT 1;
    END IF;

    INSERT INTO customer_addresses (customer_id, address_line1, city, governorate, city_id, governorate_id, is_default)
    VALUES (
      v_customer_id,
      COALESCE(v_formatted_address, ''),
      COALESCE(v_matched_city_name, v_existing_city, ''),
      COALESCE(v_matched_gov_name, v_existing_governorate, ''),
      v_matched_city_id,
      v_matched_gov_id,
      true
    )
    ON CONFLICT (customer_id) WHERE is_default = true
    DO UPDATE SET
      city = COALESCE(NULLIF(customer_addresses.city, ''), EXCLUDED.city),
      governorate = COALESCE(NULLIF(customer_addresses.governorate, ''), EXCLUDED.governorate),
      city_id = COALESCE(customer_addresses.city_id, EXCLUDED.city_id),
      governorate_id = COALESCE(customer_addresses.governorate_id, EXCLUDED.governorate_id);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_checkout_visit IS 'تسجيل خروج زيارة مع إثراء بيانات العميل (الموقع GPS والمدينة/المحافظة) تلقائياً';
