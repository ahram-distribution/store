-- ============================================================================
-- FIX: Customer Creation + Update — Address Storage
-- Problem: governed_create_customer checks p_address_line1 (never sent from
--          frontend) instead of p_formatted_address in the text-only (no GPS)
--          branch. Result: text address without GPS is never saved.
--
-- Fix 1: Make latitude/longitude nullable in unified_locations (text-only
--        addresses don't have GPS coordinates).
--
-- Fix 2: governed_create_customer — change ELSIF condition from
--        p_address_line1 to p_formatted_address
--
-- Fix 3: governed_update_customer — add params for address, location, contacts
--        so the edit screen can update unified_locations + customer_contacts
--
-- Source of truth: unified_locations only
-- ============================================================================

-- Allow text-only addresses without GPS coordinates
ALTER TABLE IF EXISTS unified_locations
  ALTER COLUMN latitude  DROP NOT NULL,
  ALTER COLUMN longitude DROP NOT NULL;

-- ============================================================================
-- FIX 1: governed_create_customer — use p_formatted_address instead of p_address_line1
-- ============================================================================
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
  p_credit_days integer DEFAULT NULL
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

  -- Create unified_locations record:
  --   - GPS present → full record
  --   - GPS absent + formatted_address → address-only record
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

  IF p_address_line1 IS NOT NULL THEN
    INSERT INTO public.customer_addresses (customer_id, address_line1, city, is_default)
    VALUES (v_customer_id, p_address_line1, p_city, true)
    RETURNING id INTO v_address_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_customer_id,
    'code', v_code,
    'company_name', p_company_name
  );
END;
$$;

COMMENT ON FUNCTION public.governed_create_customer IS 'إضافة عميل جديد مع هوية وموقع وكلمة مرور (يدعم عناوين نصية بدون GPS)';

-- ============================================================================
-- FIX 2: governed_update_customer — add address, location, contact params
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
  -- NEW: Address / Location (source: unified_locations)
  p_formatted_address text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_accuracy_meters numeric DEFAULT NULL,
  -- NEW: Contact info (source: customer_contacts)
  p_contact_name varchar DEFAULT NULL,
  p_contact_phone varchar DEFAULT NULL
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
  -- Update Address / Location (unified_locations)
  -- ==========================================================================
  v_has_any_location_input := p_formatted_address IS NOT NULL
    OR p_latitude IS NOT NULL
    OR p_longitude IS NOT NULL
    OR p_accuracy_meters IS NOT NULL;

  IF v_has_any_location_input THEN
    SELECT location_id INTO v_location_id FROM public.customers WHERE id = p_id;

    IF v_location_id IS NOT NULL THEN
      -- Existing location → update
      UPDATE public.unified_locations
      SET
        formatted_address = COALESCE(p_formatted_address, formatted_address),
        latitude = COALESCE(p_latitude, latitude),
        longitude = COALESCE(p_longitude, longitude),
        accuracy_meters = COALESCE(p_accuracy_meters, accuracy_meters)
      WHERE id = v_location_id;
    ELSIF p_formatted_address IS NOT NULL OR p_latitude IS NOT NULL THEN
      -- No existing location → create one
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

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_customer IS 'تعديل بيانات عميل مع النشاط التجاري والمسؤول والعنوان والموقع وجهات الاتصال';
