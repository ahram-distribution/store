-- register_customer: Self-service customer registration with auto-login
-- Creates identity + customer + session in one transaction.
-- Password is bcrypt-hashed via extensions.crypt().
-- Customer is auto-assigned to the first active employee.
CREATE OR REPLACE FUNCTION public.register_customer(
  p_phone varchar,
  p_password varchar,
  p_company_name varchar DEFAULT NULL
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
  v_session app.sessions;
  v_code varchar;
BEGIN
  IF EXISTS (SELECT 1 FROM identities WHERE phone = p_phone) THEN
    RETURN json_build_object('success', false, 'error', 'رقم الهاتف موجود بالفعل');
  END IF;

  v_identity_id := gen_random_uuid();
  v_customer_id := gen_random_uuid();

  v_code := 'REG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  WHILE EXISTS (SELECT 1 FROM customers WHERE code = v_code) LOOP
    v_code := 'REG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  END LOOP;

  INSERT INTO identities (id, phone, password_hash, identity_type, is_active)
  VALUES (v_identity_id, p_phone, extensions.crypt(p_password::text, extensions.gen_salt('bf')), 'customer', true);

  SELECT id INTO v_owner_id FROM employees WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
  IF NOT FOUND THEN
    DELETE FROM identities WHERE id = v_identity_id;
    RETURN json_build_object('success', false, 'error', 'لا يوجد موظفون نشطون');
  END IF;

  INSERT INTO customers (id, identity_id, code, company_name, owner_type, owner_id, is_active, registered_at)
  VALUES (v_customer_id, v_identity_id, v_code, COALESCE(p_company_name, p_phone), 'employee', v_owner_id, true, now());

  INSERT INTO app.sessions (identity_id, customer_id, identity_type)
  VALUES (v_identity_id, v_customer_id, 'customer')
  RETURNING * INTO v_session;

  RETURN json_build_object(
    'success', true,
    'token', v_session.token,
    'identity_type', 'customer',
    'customer', json_build_object(
      'id', v_customer_id,
      'company_name', COALESCE(p_company_name, p_phone),
      'code', v_code
    ),
    'expires_at', v_session.expires_at
  );
END;
$$;
