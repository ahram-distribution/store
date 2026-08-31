-- Desktop migration 12: Customer Phone Uniqueness Hardening
-- Applied out-of-band to production (mirrors remote pattern).

-- The phone-uniqueness invariant is already enforced by the unique index
-- uq_identities_phone on public.identities.phone. This migration hardens the
-- customer-update path so a duplicate phone fails safely, atomically, and with
-- a friendly Arabic error instead of a raw 23505 unique-violation.
-- Normalization reuses the same phone rules as registration/UI (English digits,
-- exactly 11 digits starting with 01).
CREATE OR REPLACE FUNCTION public.governed_update_customer(
  p_token uuid,
  p_id uuid,
  p_company_name character varying DEFAULT NULL::character varying,
  p_email character varying DEFAULT NULL::character varying,
  p_credit_limit numeric DEFAULT NULL::numeric,
  p_credit_days integer DEFAULT NULL::integer,
  p_business_type business_type DEFAULT NULL::business_type,
  p_responsible_name character varying DEFAULT NULL::character varying,
  p_password character varying DEFAULT NULL::character varying,
  p_phone character varying DEFAULT NULL::character varying,
  p_formatted_address text DEFAULT NULL::text,
  p_latitude numeric DEFAULT NULL::numeric,
  p_longitude numeric DEFAULT NULL::numeric,
  p_accuracy_meters numeric DEFAULT NULL::numeric,
  p_contact_name character varying DEFAULT NULL::character varying,
  p_contact_phone character varying DEFAULT NULL::character varying,
  p_governorate_id uuid DEFAULT NULL::uuid,
  p_city_id uuid DEFAULT NULL::uuid,
  p_city_name character varying DEFAULT NULL::character varying,
  p_street_address character varying DEFAULT NULL::character varying,
  p_landmark text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_identity_id uuid;
  v_location_id uuid;
  v_has_any_location_input boolean;
  v_has_any_contact_input boolean;
  v_has_any_address_input boolean;
  v_resolved_governorate_name text;
  v_resolved_city_name text;
  v_normalized_phone varchar;
  v_current_identity uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'customers.update');

  -- Phone format/authority: identities.phone is the single authoritative source.
  -- Normalize exactly as registration/UI does (English digits, ^01[0-9]{9}$).
  IF p_phone IS NOT NULL THEN
    v_normalized_phone := regexp_replace(translate(p_phone,
      '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹0123456789', '01234567890123456789'),
      '[^0-9]', '', 'g');

    IF v_normalized_phone !~ '^01[0-9]{9}$' THEN
      RETURN jsonb_build_object('error', 'رقم الهاتف غير صالح');
    END IF;

    SELECT identity_id INTO v_current_identity FROM public.customers WHERE id = p_id;

    -- HARD RULE: no two CURRENT (active) customer accounts may share a phone.
    -- Reject if a DIFFERENT active identity already owns this phone.
    IF v_current_identity IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.identities i
      WHERE i.phone = v_normalized_phone
        AND i.is_active = true
        AND i.id <> v_current_identity
    ) THEN
      RETURN jsonb_build_object('error', 'رقم الهاتف موجود بالفعل');
    END IF;

    p_phone := v_normalized_phone;
  END IF;

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

  IF p_phone IS NOT NULL THEN
    SELECT identity_id INTO v_identity_id FROM public.customers WHERE id = p_id;
    IF v_identity_id IS NOT NULL THEN
      UPDATE public.identities SET phone = p_phone WHERE id = v_identity_id;
    END IF;
  END IF;

  IF p_password IS NOT NULL THEN
    IF v_identity_id IS NULL THEN
      SELECT identity_id INTO v_identity_id FROM public.customers WHERE id = p_id;
    END IF;
    IF v_identity_id IS NOT NULL THEN
      UPDATE public.identities SET password_hash = extensions.crypt(p_password::text, extensions.gen_salt('bf')) WHERE id = v_identity_id;
    END IF;
  END IF;

  -- Location updates (GPS) — independent from manual address
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

  -- Manual address updates — independent from GPS/location
  v_has_any_address_input := p_governorate_id IS NOT NULL
    OR p_city_id IS NOT NULL
    OR p_city_name IS NOT NULL
    OR p_street_address IS NOT NULL
    OR p_landmark IS NOT NULL;

  IF v_has_any_address_input THEN
    v_resolved_governorate_name := COALESCE(
      (SELECT name_ar FROM reference_governorates WHERE id = p_governorate_id),
      (SELECT governorate FROM customer_addresses WHERE customer_id = p_id AND is_default = true),
      ''
    );

    v_resolved_city_name := COALESCE(
      p_city_name,
      (SELECT name_ar FROM reference_cities WHERE id = p_city_id),
      (SELECT city FROM customer_addresses WHERE customer_id = p_id AND is_default = true),
      ''
    );

    INSERT INTO customer_addresses (customer_id, address_line1, city, governorate, city_id, governorate_id, street_address, landmark, address_source, address_updated_at, is_default)
    VALUES (
      p_id,
      COALESCE(p_street_address, (SELECT address_line1 FROM customer_addresses WHERE customer_id = p_id AND is_default = true), ''),
      v_resolved_city_name,
      v_resolved_governorate_name,
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
      governorate        = CASE WHEN p_governorate_id IS NOT NULL THEN v_resolved_governorate_name
                               WHEN p_city_name IS NOT NULL OR p_street_address IS NOT NULL OR p_landmark IS NOT NULL
                               THEN COALESCE(NULLIF(customer_addresses.governorate, ''), v_resolved_governorate_name)
                               ELSE customer_addresses.governorate END,
      governorate_id     = COALESCE(p_governorate_id, customer_addresses.governorate_id),
      city               = CASE WHEN p_city_name IS NOT NULL THEN v_resolved_city_name
                               WHEN p_governorate_id IS NOT NULL OR p_street_address IS NOT NULL OR p_landmark IS NOT NULL
                               THEN COALESCE(NULLIF(customer_addresses.city, ''), v_resolved_city_name)
                               ELSE customer_addresses.city END,
      city_id            = COALESCE(p_city_id, customer_addresses.city_id),
      street_address     = COALESCE(p_street_address, customer_addresses.street_address),
      landmark           = COALESCE(p_landmark, customer_addresses.landmark),
      address_source     = COALESCE(customer_addresses.address_source, 'manual'),
      address_updated_at = now();

    IF p_governorate_id IS NOT NULL THEN
      UPDATE customers SET needs_address_correction = false WHERE id = p_id;
    END IF;
  END IF;

  PERFORM fn_enrich_customer_location(
    p_customer_id        := p_id,
    p_latitude           := p_latitude,
    p_longitude          := p_longitude,
    p_accuracy_meters    := p_accuracy_meters,
    p_formatted_address  := p_formatted_address,
    p_accuracy_level     := (CASE WHEN p_latitude IS NOT NULL THEN 'GPS' ELSE 'GEOCODED' END)::location_accuracy_level
  );

  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    PERFORM public.ensure_tracking_point(
      v_session.employee_id, NULL,
      p_latitude, p_longitude,
      p_accuracy_meters, NULL, NULL, NULL, NULL,
      now(), 'customer_location_updated'
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;