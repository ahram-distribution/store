-- ============================================================================
-- FIX 1: get_governed_customer — JOIN customer_addresses to return address fields
-- Problem: RPC does not return governorate_id, city, street_address, landmark
--          so the edit form initializes address fields as empty.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_customer(
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
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT jsonb_build_object(
    'id', c.id,
    'code', c.code,
    'company_name', c.company_name,
    'responsible_name', c.responsible_name,
    'business_type', c.business_type,
    'email', c.email,
    'phone', i.phone,
    'credit_limit', c.credit_limit,
    'credit_days', c.credit_days,
    'owner_id', c.owner_id,
    'owner_name', e.full_name,
    'owner_code', e.code,
    'is_active', c.is_active,
    'location_id', c.location_id,
    'registered_at', c.registered_at,
    'created_at', c.created_at,
    -- Address fields from customer_addresses
    'governorate_id', ca.governorate_id,
    'governorate_name', ca.governorate,
    'city_name', ca.city,
    'street_address', ca.street_address,
    'landmark', ca.landmark
  ) INTO v_result
  FROM customers c
  JOIN identities i ON i.id = c.identity_id
  LEFT JOIN employees e ON e.id = c.owner_id
  LEFT JOIN customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = true
  WHERE c.id = p_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_governed_customer IS 'بيانات عميل كاملة مع العنوان والنشاط التجاري (v2 — يُعيد بيانات customer_addresses)';


-- ============================================================================
-- FIX 2: governed_update_customer — fix COALESCE + add p_city_name (text)
-- Problem: COALESCE in UPSERT keeps old values when new values are provided.
--          Also p_city_id (UUID) is used but city is now manual text input.
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_update_customer(
  uuid, uuid, varchar, varchar, decimal, integer, business_type, varchar, varchar, varchar,
  text, numeric, numeric, numeric, varchar, varchar, uuid, uuid, varchar, text
);

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
  p_street_address character varying DEFAULT NULL::character varying,
  p_landmark text DEFAULT NULL::text,
  -- NEW: text city name (preferred over UUID lookup)
  p_city_name character varying DEFAULT NULL::character varying
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
  v_city_text text;
  v_governorate_text text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'customers.update');

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

  v_has_any_address_input := p_governorate_id IS NOT NULL
    OR p_city_id IS NOT NULL
    OR p_city_name IS NOT NULL
    OR p_street_address IS NOT NULL
    OR p_landmark IS NOT NULL;

  IF v_has_any_address_input THEN
    v_fmt := COALESCE(p_formatted_address,
      (SELECT formatted_address FROM unified_locations WHERE id =
        (SELECT location_id FROM customers WHERE id = p_id)
      )
    );

    -- Resolve city text: prefer p_city_name, fallback to reference_cities UUID lookup, fallback to existing
    v_city_text := COALESCE(
      p_city_name,
      (SELECT name_ar FROM reference_cities WHERE id = p_city_id),
      (SELECT city FROM customer_addresses WHERE customer_id = p_id AND is_default = true),
      ''
    );

    -- Resolve governorate text: prefer reference_governorates lookup, fallback to existing
    v_governorate_text := COALESCE(
      (SELECT name_ar FROM reference_governorates WHERE id = p_governorate_id),
      (SELECT governorate FROM customer_addresses WHERE customer_id = p_id AND is_default = true),
      ''
    );

    INSERT INTO customer_addresses (customer_id, address_line1, city, governorate, city_id, governorate_id, street_address, landmark, address_source, address_updated_at, is_default)
    VALUES (
      p_id,
      COALESCE(v_fmt, ''),
      v_city_text,
      v_governorate_text,
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
      -- FIX: new values take priority over old values
      city             = COALESCE(NULLIF(EXCLUDED.city, ''), customer_addresses.city),
      governorate      = COALESCE(NULLIF(EXCLUDED.governorate, ''), customer_addresses.governorate),
      city_id          = COALESCE(EXCLUDED.city_id, customer_addresses.city_id),
      governorate_id   = COALESCE(EXCLUDED.governorate_id, customer_addresses.governorate_id),
      street_address   = COALESCE(NULLIF(EXCLUDED.street_address, ''), customer_addresses.street_address),
      landmark         = COALESCE(NULLIF(EXCLUDED.landmark, ''), customer_addresses.landmark),
      address_line1    = COALESCE(NULLIF(EXCLUDED.address_line1, ''), customer_addresses.address_line1),
      address_source   = 'manual',
      address_updated_at = now();
  END IF;

  PERFORM fn_enrich_customer_location(
    p_customer_id        := p_id,
    p_latitude           := p_latitude,
    p_longitude          := p_longitude,
    p_accuracy_meters    := p_accuracy_meters,
    p_formatted_address  := p_formatted_address,
    p_accuracy_level     := (CASE WHEN p_latitude IS NOT NULL THEN 'GPS' ELSE 'GEOCODED' END)::location_accuracy_level
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_customer IS 'تعديل بيانات عميل مع العنوان (v2 — يقبل city_name نصي + يُصلح COALESCE)';


-- ============================================================================
-- FIX 3: governed_create_customer — accept governorate_id, city_name, street, landmark
-- Problem: Does not write governorate/city/street to customer_addresses.
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_create_customer(
  uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, business_type, varchar,
  numeric, numeric, numeric, text, varchar, varchar, decimal, integer
);

CREATE OR REPLACE FUNCTION public.governed_create_customer(
  p_token uuid,
  p_company_name varchar,
  p_phone varchar DEFAULT NULL,
  p_contact_name varchar DEFAULT NULL,
  p_contact_phone varchar DEFAULT NULL,
  p_address_line1 varchar DEFAULT NULL,
  p_city varchar DEFAULT 'القاهرة',
  p_region varchar DEFAULT NULL,
  p_business_type business_type DEFAULT NULL,
  p_responsible_name varchar DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_accuracy_meters numeric DEFAULT NULL,
  p_formatted_address text DEFAULT NULL,
  p_password varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL,
  p_credit_limit decimal DEFAULT NULL,
  p_credit_days integer DEFAULT NULL,
  -- NEW: structured address fields
  p_governorate_id uuid DEFAULT NULL,
  p_city_name varchar DEFAULT NULL,
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
  v_employee_id uuid;
  v_identity_id uuid;
  v_customer_id uuid;
  v_contact_id uuid;
  v_address_id uuid;
  v_location_id uuid;
  v_code varchar(20);
  v_year integer := EXTRACT(YEAR FROM now());
  v_seq integer;
  v_resolved_city text;
  v_resolved_governorate text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;

  PERFORM check_capability(p_token, 'customers.create');

  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('customer', v_year, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  v_code := 'CUS-' || v_year::text || '-' || LPAD(v_seq::text, 6, '0');

  v_identity_id := gen_random_uuid();
  v_customer_id := gen_random_uuid();

  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    v_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
    VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, COALESCE(p_formatted_address, p_address_line1), now());
  ELSIF p_formatted_address IS NOT NULL THEN
    v_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, formatted_address, captured_at)
    VALUES (v_location_id, p_formatted_address, now());
  END IF;

  INSERT INTO public.identities (id, phone, password_hash, identity_type, is_active)
  VALUES (
    v_identity_id,
    COALESCE(p_phone, 'ext-' || v_customer_id::text || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
    CASE WHEN p_password IS NOT NULL THEN extensions.crypt(p_password::text, extensions.gen_salt('bf'))
         ELSE extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))
    END,
    'customer',
    true
  );

  INSERT INTO public.customers (id, identity_id, code, company_name, responsible_name, business_type, location_id, owner_type, owner_id, is_active, email, credit_limit, credit_days)
  VALUES (v_customer_id, v_identity_id, v_code, p_company_name, COALESCE(p_responsible_name, p_contact_name), p_business_type, v_location_id, 'employee', v_employee_id, true, p_email, COALESCE(p_credit_limit, 0), COALESCE(p_credit_days, 0));

  IF p_contact_phone IS NOT NULL OR p_contact_name IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, full_name, phone, is_primary)
    VALUES (v_customer_id, COALESCE(p_contact_name, p_company_name), COALESCE(p_contact_phone, '0000000000'), true)
    RETURNING id INTO v_contact_id;
  END IF;

  -- Resolve city and governorate text for customer_addresses
  v_resolved_city := COALESCE(
    p_city_name,
    p_city,
    ''
  );

  v_resolved_governorate := COALESCE(
    (SELECT name_ar FROM reference_governorates WHERE id = p_governorate_id),
    p_region,
    ''
  );

  -- Always insert customer_addresses with structured address data
  INSERT INTO public.customer_addresses (customer_id, address_line1, city, governorate, city_id, governorate_id, street_address, landmark, is_default)
  VALUES (
    v_customer_id,
    COALESCE(p_address_line1, p_formatted_address, ''),
    v_resolved_city,
    v_resolved_governorate,
    NULL, -- city_id is NULL when city is manual text
    p_governorate_id,
    p_street_address,
    p_landmark,
    true
  )
  RETURNING id INTO v_address_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_customer_id,
    'code', v_code,
    'company_name', p_company_name
  );
END;
$$;

COMMENT ON FUNCTION public.governed_create_customer IS 'إضافة عميل جديد مع هوية وموقع وعنوان منظم (v2 — يحفظ governorate/city/street/landmark)';
