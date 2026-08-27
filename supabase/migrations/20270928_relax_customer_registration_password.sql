-- ============================================================================
-- Relax register_customer password validation
-- Previously required exactly 6 digits (^\d{6}$).
-- Now accepts any non-empty password with at least 4 characters.
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

  IF p_password IS NULL OR length(trim(p_password)) < 4 THEN
    RETURN json_build_object('success', false, 'error', 'كلمة المرور يجب أن تكون 4 أحرف على الأقل');
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

  SELECT e.id INTO v_owner_id
  FROM employees e
  JOIN employee_roles er ON er.employee_id = e.id
  JOIN roles r ON r.id = er.role_id
  WHERE r.name = 'الإدارة العليا'
  ORDER BY e.created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    DELETE FROM identities WHERE id = v_identity_id;
    DELETE FROM unified_locations WHERE id = v_location_id;
    RETURN json_build_object('success', false, 'error', 'لا يوجد مسؤول من الإدارة العليا في النظام');
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

COMMENT ON FUNCTION public.register_customer IS 'تسجيل عميل جديد — يقبل كلمة مرور 4+ أحرف';
