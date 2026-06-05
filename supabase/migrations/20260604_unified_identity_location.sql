-- ============================================================================
-- UNIFIED IDENTITY & LOCATION STANDARD
-- Implements business_type ENUM, unified_locations table,
-- customer schema updates, phone uniqueness, and upgraded RPCs.
-- ============================================================================

-- 1. business_type ENUM -------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE business_type AS ENUM (
    'wholesaler', 'distributor', 'cosmetics_store', 'supermarket',
    'hypermarket', 'perfume_store', 'pharmacy', 'warehouse', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. unified_locations table --------------------------------------------------

CREATE TABLE IF NOT EXISTS unified_locations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    latitude          numeric NOT NULL,
    longitude         numeric NOT NULL,
    accuracy_meters   numeric,
    google_maps_url   text GENERATED ALWAYS AS (
      'https://www.google.com/maps?q=' || latitude || ',' || longitude
    ) STORED,
    formatted_address text,
    captured_at       timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE unified_locations IS 'Unified location record reused across all modules';

-- 2a. RLS — defense-in-depth (no policies = default-deny for anon/authenticated)
--      Only SECURITY DEFINER RPCs bypass this.
ALTER TABLE unified_locations ENABLE ROW LEVEL SECURITY;

-- 2b. check_capability — needed by this migration and all governed RPCs.
--      Previously defined only server-side, not in migration history.
--      This ensures the migration is self-contained and replayable.
CREATE OR REPLACE FUNCTION public.check_capability(p_token uuid, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_cap_id uuid;
  v_role_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT id INTO v_cap_id FROM capabilities WHERE code = p_code;
  IF v_cap_id IS NULL THEN RETURN false; END IF;

  -- Direct employee grants (grant overrides role)
  IF EXISTS (
    SELECT 1 FROM employee_capabilities
    WHERE employee_id = v_session.employee_id AND capability_id = v_cap_id AND grant_type = 'grant'
  ) THEN RETURN true; END IF;

  -- Direct employee denies (deny overrides grant)
  IF EXISTS (
    SELECT 1 FROM employee_capabilities
    WHERE employee_id = v_session.employee_id AND capability_id = v_cap_id AND grant_type = 'deny'
  ) THEN RETURN false; END IF;

  -- Role-based capabilities
  SELECT array_agg(role_id) INTO v_role_ids FROM employee_roles WHERE employee_id = v_session.employee_id;
  IF v_role_ids IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM role_capabilities WHERE role_id = ANY(v_role_ids) AND capability_id = v_cap_id
  );
END;
$$;

COMMENT ON FUNCTION public.check_capability IS 'التحقق من صلاحية الموظف بناءً على الجلسة والكود';

-- 2c. locations.view_all capability — allows cross-scope location read for managers
INSERT INTO public.capabilities (code, name, description, "group")
SELECT 'locations.view_all', 'عرض كل المواقع', 'View any location record regardless of ownership scope', 'locations'
WHERE NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'locations.view_all');

-- 3. ALTER customers -----------------------------------------------------------

ALTER TABLE customers ADD COLUMN IF NOT EXISTS business_type    business_type;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS responsible_name varchar(255);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS location_id      uuid REFERENCES unified_locations(id);

COMMENT ON COLUMN customers.business_type IS 'نوع النشاط التجاري';
COMMENT ON COLUMN customers.responsible_name IS 'اسم المسؤول عن العميل';
COMMENT ON COLUMN customers.location_id IS 'الموقع الجغرافي للعميل';

-- 4. ALTER identities ----------------------------------------------------------

ALTER TABLE identities DROP CONSTRAINT IF EXISTS uq_identities_phone;
ALTER TABLE identities ADD CONSTRAINT uq_identities_phone UNIQUE (phone);

-- ============================================================================
-- 5. register_customer (replaced)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.register_customer(
  p_phone             varchar,
  p_password          varchar,
  p_company_name      varchar,
  p_responsible_name  varchar,
  p_business_type     business_type,
  p_latitude          numeric,
  p_longitude         numeric,
  p_accuracy_meters   numeric,
  p_formatted_address text DEFAULT NULL
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
  -- Validate Egyptian phone: 11 digits, 010/011/012/015 prefix
  IF p_phone !~ '^01[0-9]{9}$' THEN
    RETURN json_build_object('success', false, 'error', 'رقم الهاتف غير صالح');
  END IF;

  -- Validate password: exactly 6 numeric digits
  IF p_password !~ '^\d{6}$' THEN
    RETURN json_build_object('success', false, 'error', 'كلمة المرور يجب أن تكون 6 أرقام');
  END IF;

  -- Check phone uniqueness
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

  -- Insert unified location
  INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
  VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());

  -- Insert identity (phone uniqueness enforced by DB constraint uq_identities_phone)
  INSERT INTO identities (id, phone, password_hash, identity_type, is_active)
  VALUES (v_identity_id, p_phone, extensions.crypt(p_password::text, extensions.gen_salt('bf')), 'customer', true);

  -- Get first active employee as owner
  SELECT id INTO v_owner_id FROM employees WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
  IF NOT FOUND THEN
    DELETE FROM identities WHERE id = v_identity_id;
    DELETE FROM unified_locations WHERE id = v_location_id;
    RETURN json_build_object('success', false, 'error', 'لا يوجد موظفون نشطون');
  END IF;

  -- Insert customer with new fields
  INSERT INTO customers (id, identity_id, code, company_name, responsible_name, business_type, location_id, owner_type, owner_id, is_active, registered_at)
  VALUES (v_customer_id, v_identity_id, v_code, p_company_name, p_responsible_name, p_business_type, v_location_id, 'employee', v_owner_id, true, now());

  -- Insert primary contact
  INSERT INTO customer_contacts (customer_id, full_name, phone, is_primary)
  VALUES (v_customer_id, p_responsible_name, p_phone, true);

  -- Create session — immediate activation, no approval
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

COMMENT ON FUNCTION public.register_customer IS 'تسجيل عميل جديد مع هوية وموقع موحد';

-- ============================================================================
-- 6. governed_create_customer (updated)
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
  p_formatted_address text DEFAULT NULL
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

  -- Insert unified location if coordinates provided
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    v_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
    VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());
  END IF;

  INSERT INTO public.identities (id, phone, password_hash, identity_type, is_active)
  VALUES (
    v_identity_id,
    COALESCE(p_phone, 'ext-' || v_customer_id::text || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    'customer',
    false
  );

  INSERT INTO public.customers (id, identity_id, code, company_name, responsible_name, business_type, location_id, owner_type, owner_id, is_active)
  VALUES (v_customer_id, v_identity_id, v_code, p_company_name, COALESCE(p_responsible_name, p_contact_name), p_business_type, v_location_id, 'employee', v_employee_id, true);

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

COMMENT ON FUNCTION public.governed_create_customer IS 'إضافة عميل جديد مع هوية وموقع موحد';

-- ============================================================================
-- 7. governed_update_customer (updated)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_update_customer(
  p_token uuid,
  p_id uuid,
  p_company_name varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL,
  p_credit_limit decimal DEFAULT NULL,
  p_credit_days integer DEFAULT NULL,
  p_business_type business_type DEFAULT NULL,
  p_responsible_name varchar DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
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

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_customer IS 'تعديل بيانات عميل مع النشاط التجاري والمسؤول';

-- ============================================================================
-- 8. get_governed_customer (updated — returns new columns + location)
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
    'created_at', c.created_at
  ) INTO v_result
  FROM customers c
  JOIN identities i ON i.id = c.identity_id
  LEFT JOIN employees e ON e.id = c.owner_id
  WHERE c.id = p_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_governed_customer IS 'بيانات عميل كاملة مع الموقع والنشاط التجاري';

-- ============================================================================
-- 9. get_governed_customers (updated — returns new columns + location)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_customers(
  p_token uuid
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

  SELECT jsonb_agg(jsonb_build_object(
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
    'is_active', c.is_active,
    'location_id', c.location_id,
    'registered_at', c.registered_at,
    'created_at', c.created_at
  )) INTO v_result
  FROM customers c
  JOIN identities i ON i.id = c.identity_id
  LEFT JOIN employees e ON e.id = c.owner_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_customers IS 'قائمة العملاء كاملة مع الموقع والنشاط التجاري';

-- ============================================================================
-- 10. ALTER visits — unified location FKs
-- ============================================================================

ALTER TABLE visits ADD COLUMN IF NOT EXISTS start_location_id uuid REFERENCES unified_locations(id);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS end_location_id   uuid REFERENCES unified_locations(id);

COMMENT ON COLUMN visits.start_location_id IS 'موقع بدء الزيارة (unified_locations)';
COMMENT ON COLUMN visits.end_location_id IS 'موقع إنهاء الزيارة (unified_locations)';

-- ============================================================================
-- 11. ALTER orders — unified execution location FK
-- ============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS execution_location_id uuid REFERENCES unified_locations(id);

COMMENT ON COLUMN orders.execution_location_id IS 'موقع تنفيذ الطلب (unified_locations)';

-- ============================================================================
-- 12. governed_create_location — standalone RPC to create a location record
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_create_location(
  p_token uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric DEFAULT NULL,
  p_formatted_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_location_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_location_id := gen_random_uuid();

  INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
  VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());

  RETURN jsonb_build_object(
    'success', true,
    'id', v_location_id,
    'latitude', p_latitude,
    'longitude', p_longitude,
    'accuracy_meters', p_accuracy_meters
  );
END;
$$;

COMMENT ON FUNCTION public.governed_create_location IS 'إنشاء سجل موقع موحد جديد';

-- ============================================================================
-- 13. get_governed_location — scoped read (ownership-aware)
--      Authorization rules:
--        Employee: can read if they own the related customer/visit/order,
--                  OR have locations.view_all capability.
--        Customer: can read only their own customer location.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_location(
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
  v_authorized boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Check scope authorization
  IF v_session.employee_id IS NOT NULL THEN
    v_authorized := EXISTS (
      SELECT 1 FROM customers WHERE location_id = p_id AND owner_id = v_session.employee_id
    ) OR EXISTS (
      SELECT 1 FROM visits WHERE (start_location_id = p_id OR end_location_id = p_id)
        AND employee_id = v_session.employee_id
    ) OR EXISTS (
      SELECT 1 FROM orders WHERE execution_location_id = p_id
        AND (created_by = v_session.employee_id OR owner_id = v_session.employee_id)
    ) OR public.check_capability(p_token, 'locations.view_all');
  ELSIF v_session.customer_id IS NOT NULL THEN
    v_authorized := EXISTS (
      SELECT 1 FROM customers WHERE location_id = p_id AND id = v_session.customer_id
    );
  ELSE
    v_authorized := false;
  END IF;

  IF v_authorized IS NOT TRUE THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT jsonb_build_object(
    'id', id,
    'latitude', latitude,
    'longitude', longitude,
    'accuracy_meters', accuracy_meters,
    'google_maps_url', google_maps_url,
    'formatted_address', formatted_address,
    'captured_at', captured_at,
    'created_at', created_at
  ) INTO v_result
  FROM unified_locations
  WHERE id = p_id;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'NOT_FOUND'));
END;
$$;

COMMENT ON FUNCTION public.get_governed_location IS 'جلب سجل موقع موحد مع التحقق من نطاق الصلاحية';

-- ============================================================================
-- 13b. get_governed_locations — batch read with same scope logic
--      Replaces N+1 pattern from frontend.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_locations(
  p_token uuid,
  p_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_has_view_all boolean;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.employee_id IS NOT NULL THEN
    v_has_view_all := public.check_capability(p_token, 'locations.view_all');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', ul.id,
    'latitude', ul.latitude,
    'longitude', ul.longitude,
    'accuracy_meters', ul.accuracy_meters,
    'google_maps_url', ul.google_maps_url,
    'formatted_address', ul.formatted_address,
    'captured_at', ul.captured_at,
    'created_at', ul.created_at
  )) INTO v_result
  FROM unified_locations ul
  WHERE ul.id = ANY(p_ids)
    AND (
      (v_session.employee_id IS NOT NULL AND (
        v_has_view_all
        OR ul.id IN (SELECT location_id FROM customers WHERE owner_id = v_session.employee_id AND location_id IS NOT NULL)
        OR ul.id IN (SELECT start_location_id FROM visits WHERE employee_id = v_session.employee_id AND start_location_id IS NOT NULL)
        OR ul.id IN (SELECT end_location_id FROM visits WHERE employee_id = v_session.employee_id AND end_location_id IS NOT NULL)
        OR ul.id IN (SELECT execution_location_id FROM orders WHERE (created_by = v_session.employee_id OR owner_id = v_session.employee_id) AND execution_location_id IS NOT NULL)
      ))
      OR
      (v_session.customer_id IS NOT NULL AND
       ul.id IN (SELECT location_id FROM customers WHERE id = v_session.customer_id AND location_id IS NOT NULL))
    );

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_locations IS 'جلب سجلات مواقع موحدة متعددة مع التحقق من نطاق الصلاحية';

-- ============================================================================
-- 14. governed_checkin_visit (updated — unified location support)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_checkin_visit(
  p_token uuid,
  p_customer_id uuid,
  p_start_location_id uuid DEFAULT NULL,
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
  v_visit_id uuid;
  v_code varchar(30);
  v_year integer := EXTRACT(YEAR FROM now());
  v_seq integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Check for existing active visit
  SELECT id INTO v_visit_id FROM visits
  WHERE employee_id = v_session.employee_id AND customer_id = p_customer_id AND status = 'active'
  LIMIT 1;

  IF v_visit_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'id', v_visit_id, 'existing', true);
  END IF;

  -- Generate visit code
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('visit', v_year, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  v_code := 'VIS-' || v_year::text || '-' || LPAD(v_seq::text, 6, '0');

  INSERT INTO public.visits (code, employee_id, customer_id, status, check_in_at,
    start_location_id, check_in_latitude, check_in_longitude)
  VALUES (v_code, v_session.employee_id, p_customer_id, 'active', now(),
    p_start_location_id, p_latitude, p_longitude)
  RETURNING id INTO v_visit_id;

  RETURN jsonb_build_object('success', true, 'id', v_visit_id, 'code', v_code);
END;
$$;

COMMENT ON FUNCTION public.governed_checkin_visit IS 'تسجيل دخول زيارة مع موقع موحد';

-- ============================================================================
-- 15. governed_checkout_visit (updated — unified location support)
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT status INTO v_visit_status FROM visits WHERE id = p_visit_id;
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

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_checkout_visit IS 'تسجيل خروج زيارة مع موقع موحد';

-- ============================================================================
-- 16. governed_create_order (updated — execution_location_id support)
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_create_order(uuid, uuid, uuid, text, jsonb, numeric, numeric, numeric, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.governed_create_order(
  p_token uuid,
  p_customer_id uuid,
  p_tier_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.create') THEN
      RAISE EXCEPTION 'MISSING_CAPABILITY: orders.create';
    END IF;
  ELSE
    IF v_session.customer_id IS NULL OR p_customer_id IS DISTINCT FROM v_session.customer_id THEN
      RAISE EXCEPTION 'FORBIDDEN: customers can only create orders for themselves';
    END IF;
  END IF;

  -- Validate tier if provided
  IF p_tier_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE id = p_tier_id AND is_active = true) THEN
      RAISE EXCEPTION 'TIER_NOT_FOUND_OR_INACTIVE';
    END IF;
  END IF;

  -- Resolve execution location: prefer explicit location_id, else create from coords if provided
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

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, carton_price, carton_quantity INTO v_product
    FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;

    v_calculated_unit_price := public._calc_base_unit_price(
      v_product.carton_price, v_product.carton_quantity, v_item->>'unit_type'
    );
    IF v_calculated_unit_price IS NULL THEN
      RAISE EXCEPTION 'PRICE_NOT_CONFIGURED: product % has no valid pricing data', v_product.id;
    END IF;

    v_calculated_total_price := ROUND((v_calculated_unit_price * (v_item->>'unit_quantity')::integer)::numeric, 2);

    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (
      v_order.id,
      (v_item->>'product_id')::uuid,
      v_item->>'unit_type',
      (v_item->>'unit_quantity')::integer,
      COALESCE((v_item->>'piece_quantity')::integer, 0),
      v_calculated_unit_price,
      v_calculated_total_price
    );
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
$$;

COMMENT ON FUNCTION public.governed_create_order IS 'إنشاء طلب جديد مع أسعار أساسية ورقم تسلسلي وموقع تنفيذ موحد. يتم حساب التخفيضات في مرحلة الإرسال.';

-- ============================================================================
-- END OF UNIFIED IDENTITY & LOCATION STANDARD
-- ============================================================================
