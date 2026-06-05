-- ============================================================================
-- CUSTOMER REALITY GAP CLOSURE
-- 1. Unify data model across RegistrationPage / NewCustomerPage / CustomerProfilePage
-- 2. Add password support for employee-created customers
-- 3. Close Reality Audit gaps: expose hidden DB fields
-- ============================================================================

-- ============================================================================
-- 1. Update register_customer — accept p_email
-- Drop old overload first to avoid ambiguity
-- ============================================================================

DROP FUNCTION IF EXISTS public.register_customer(p_phone varchar, p_password varchar, p_company_name varchar, p_responsible_name varchar, p_business_type business_type, p_latitude numeric, p_longitude numeric, p_accuracy_meters numeric, p_formatted_address text);

CREATE OR REPLACE FUNCTION public.register_customer(
  p_phone             varchar,
  p_password          varchar,
  p_company_name      varchar,
  p_responsible_name  varchar,
  p_business_type     business_type,
  p_latitude          numeric,
  p_longitude         numeric,
  p_accuracy_meters   numeric,
  p_formatted_address text DEFAULT NULL,
  p_email             varchar DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_identity_id uuid;
  v_customer_id uuid;
  v_owner_id uuid;
  v_location_id uuid;
  v_session app.sessions;
  v_code varchar;
BEGIN
  IF p_phone !~ '^01[0-9]{9}$' THEN
    RETURN json_build_object('success', false, 'error', 'رقم الهاتف غير صالح');
  END IF;

  IF p_password !~ '^\d{6}$' THEN
    RETURN json_build_object('success', false, 'error', 'كلمة المرور يجب أن تكون 6 أرقام');
  END IF;

  IF EXISTS (SELECT 1 FROM identities WHERE phone = p_phone) THEN
    RETURN json_build_object('success', false, 'error', 'رقم الهاتف موجود بالفعل');
  END IF;

  v_identity_id := gen_random_uuid();
  v_customer_id := gen_random_uuid();
  v_location_id := gen_random_uuid();

  v_code := 'REG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  WHILE EXISTS (SELECT 1 FROM customers WHERE code = v_code) LOOP
    v_code := 'REG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  END LOOP;

  INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
  VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());

  INSERT INTO identities (id, phone, password_hash, identity_type, is_active)
  VALUES (v_identity_id, p_phone, extensions.crypt(p_password::text, extensions.gen_salt('bf')), 'customer', true);

  SELECT id INTO v_owner_id FROM employees WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
  IF NOT FOUND THEN
    DELETE FROM identities WHERE id = v_identity_id;
    DELETE FROM unified_locations WHERE id = v_location_id;
    RETURN json_build_object('success', false, 'error', 'لا يوجد موظفون نشطون');
  END IF;

  INSERT INTO customers (id, identity_id, code, company_name, responsible_name, business_type, location_id, owner_type, owner_id, is_active, email, registered_at)
  VALUES (v_customer_id, v_identity_id, v_code, p_company_name, p_responsible_name, p_business_type, v_location_id, 'employee', v_owner_id, true, p_email, now());

  INSERT INTO customer_contacts (customer_id, full_name, phone, is_primary)
  VALUES (v_customer_id, p_responsible_name, p_phone, true);

  INSERT INTO app.sessions (identity_id, customer_id, identity_type)
  VALUES (v_identity_id, v_customer_id, 'customer')
  RETURNING * INTO v_session;

  RETURN json_build_object(
    'success', true,
    'token', v_session.token,
    'identity_type', 'customer',
    'customer', json_build_object(
      'id', v_customer_id,
      'company_name', p_company_name,
      'code', v_code,
      'business_type', p_business_type
    ),
    'expires_at', v_session.expires_at
  );
END;
$$;

COMMENT ON FUNCTION public.register_customer IS 'تسجيل عميل جديد مع هوية وموقع موحد وبريد إلكتروني';

-- ============================================================================
-- 2. Update governed_create_customer — accept password, email, credit fields
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_create_customer(p_token uuid, p_company_name varchar, p_phone varchar, p_contact_name varchar, p_contact_phone varchar, p_address_line1 varchar, p_city varchar, p_region varchar, p_business_type business_type, p_responsible_name varchar, p_latitude numeric, p_longitude numeric, p_accuracy_meters numeric, p_formatted_address text);

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

  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    v_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
    VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());
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

COMMENT ON FUNCTION public.governed_create_customer IS 'إضافة عميل جديد مع هوية وموقع وكلمة مرور';

-- ============================================================================
-- 3. Update governed_update_customer — accept password, phone; update identity
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_update_customer(p_token uuid, p_id uuid, p_company_name varchar, p_email varchar, p_credit_limit decimal, p_credit_days integer, p_business_type business_type, p_responsible_name varchar);

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
  p_phone varchar DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_identity_id uuid;
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

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_customer IS 'تعديل بيانات عميل مع النشاط التجاري والمسؤول وكلمة المرور';
