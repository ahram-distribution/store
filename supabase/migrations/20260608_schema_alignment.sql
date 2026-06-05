-- ============================================================================
-- SCHEMA ALIGNMENT: Product Visibility, Company Visibility/Logo, Employee Address
-- Approved: 2026-06-05
-- Aligns DB columns with RPC parameters and UI expectations
-- ============================================================================

-- ============================================================================
-- 1. Missing DB Columns
-- ============================================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS address text;
COMMENT ON COLUMN employees.address IS 'Employee residential/business address';

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN products.is_visible IS 'Controls customer-facing display independently from is_active. A product can be active but hidden.';

ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN companies.is_visible IS 'Controls customer-facing display independently from is_active. A company can be active but hidden.';

ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url text;
COMMENT ON COLUMN companies.logo_url IS 'Company logo image URL for storefront display';

-- ============================================================================
-- 2. Update governed_create_employee — accept and store p_address
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_create_employee(
  p_token uuid,
  p_full_name varchar,
  p_phone varchar,
  p_password varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL,
  p_role_id uuid DEFAULT NULL,
  p_manager_id uuid DEFAULT NULL,
  p_address text DEFAULT NULL
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
  v_code varchar(20);
  v_year integer := EXTRACT(YEAR FROM now());
  v_seq integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'employees.manage');

  IF EXISTS (SELECT 1 FROM identities WHERE phone = p_phone) THEN
    RETURN jsonb_build_object('error', 'PHONE_EXISTS');
  END IF;

  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('employee', v_year, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  v_code := 'EMP-' || v_year::text || '-' || LPAD(v_seq::text, 6, '0');
  v_identity_id := gen_random_uuid();
  v_employee_id := gen_random_uuid();

  INSERT INTO public.identities (id, phone, password_hash, identity_type, is_active)
  VALUES (
    v_identity_id,
    p_phone,
    extensions.crypt(COALESCE(p_password, p_phone), extensions.gen_salt('bf')),
    'employee',
    true
  );

  INSERT INTO public.employees (id, identity_id, code, full_name, email, manager_id, is_active, address)
  VALUES (v_employee_id, v_identity_id, v_code, p_full_name, p_email, p_manager_id, true, p_address);

  IF p_role_id IS NOT NULL THEN
    INSERT INTO public.employee_roles (employee_id, role_id, assigned_by)
    VALUES (v_employee_id, p_role_id, v_session.employee_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_employee_id,
    'code', v_code,
    'full_name', p_full_name
  );
END;
$$;

COMMENT ON FUNCTION public.governed_create_employee IS 'إضافة موظف جديد مع هوية وحساب (مع العنوان)';

-- ============================================================================
-- 3. Update governed_update_employee — accept and update p_address
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_update_employee(
  p_token uuid,
  p_id uuid,
  p_full_name varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL,
  p_phone varchar DEFAULT NULL,
  p_address text DEFAULT NULL
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

  PERFORM check_capability(p_token, 'employees.manage');

  UPDATE public.employees
  SET
    full_name = COALESCE(p_full_name, full_name),
    email = COALESCE(p_email, email),
    address = COALESCE(p_address, address),
    updated_at = now()
  WHERE id = p_id;

  IF p_phone IS NOT NULL THEN
    SELECT identity_id INTO v_identity_id FROM public.employees WHERE id = p_id;
    IF v_identity_id IS NOT NULL THEN
      UPDATE public.identities SET phone = p_phone WHERE id = v_identity_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_employee IS 'تعديل بيانات موظف (مع العنوان)';

-- ============================================================================
-- 4. Update get_governed_employees — return address field
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_employees(p_token uuid)
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
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'code', e.code,
      'full_name', e.full_name,
      'email', e.email,
      'phone', i.phone,
      'manager_id', e.manager_id,
      'is_active', e.is_active,
      'address', e.address,
      'created_at', e.created_at,
      'roles', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name))
         FROM employee_roles er JOIN roles r ON r.id = er.role_id
         WHERE er.employee_id = e.id), '[]'::jsonb),
      'role_names', COALESCE(
        (SELECT string_agg(r.name, ', ')
         FROM employee_roles er JOIN roles r ON r.id = er.role_id
         WHERE er.employee_id = e.id), ''),
      'direct_capabilities', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'grant_type', ec.grant_type))
         FROM employee_capabilities ec JOIN capabilities c ON c.id = ec.capability_id
         WHERE ec.employee_id = e.id), '[]'::jsonb)
    )
    ORDER BY e.created_at DESC
  ) INTO v_result FROM employees e JOIN identities i ON i.id = e.identity_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_employees IS 'قائمة الموظفين مع الأدوار والصلاحيات المباشرة (مع العنوان)';

-- ============================================================================
-- 5. Update get_governed_companies — return logo_url and is_visible
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_companies(p_token uuid)
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', comp.id,
      'company_name', comp.company_name,
      'legacy_code', comp.legacy_code,
      'is_active', comp.is_active,
      'is_visible', comp.is_visible,
      'logo_url', comp.logo_url,
      'created_at', comp.created_at,
      'product_count', (SELECT COUNT(*) FROM products p WHERE p.company_id = comp.id)
    ) ORDER BY comp.company_name
  ) INTO v_result FROM companies comp;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_companies IS 'قائمة الشركات مع عدد المنتجات والشعار والرؤية';
