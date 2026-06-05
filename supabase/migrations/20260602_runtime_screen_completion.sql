-- ============================================================================
-- RUNTIME_SCREEN_COMPLETION_AND_OPERATIONALIZATION
-- Converts every display screen into a fully operational business screen.
--
-- PART A:  Employee Management RPCs  (Phase 3)
-- PART B:  Customer Management RPCs  (Phase 2 — missing operations)
-- PART C:  Product Management RPCs   (Phase 4)
-- PART D:  Company Management RPCs   (Phase 5)
-- PART E:  Visit Management RPCs     (Phase 7 — missing operations)
-- PART F:  Collection Management RPCs (Phase 8 — missing operations)
-- PART G:  Order Enhancement RPCs    (Phase 6)
-- PART H:  Reporting RPCs            (Phase 9)
-- ============================================================================

-- ============================================================================
-- PART A: EMPLOYEE MANAGEMENT RPCs
-- ============================================================================

-- A1. get_governed_employees ------------------------------------------------

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

COMMENT ON FUNCTION public.get_governed_employees IS 'قائمة الموظفين مع الأدوار والصلاحيات المباشرة';

-- A2. governed_create_employee ----------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_create_employee(
  p_token uuid,
  p_full_name varchar,
  p_phone varchar,
  p_password varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL,
  p_role_id uuid DEFAULT NULL,
  p_manager_id uuid DEFAULT NULL
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

  -- Validate phone uniqueness
  IF EXISTS (SELECT 1 FROM identities WHERE phone = p_phone) THEN
    RETURN jsonb_build_object('error', 'PHONE_EXISTS');
  END IF;

  -- Generate employee code
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('employee', v_year, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  v_code := 'EMP-' || v_year::text || '-' || LPAD(v_seq::text, 6, '0');
  v_identity_id := gen_random_uuid();
  v_employee_id := gen_random_uuid();

  -- Create identity
  INSERT INTO public.identities (id, phone, password_hash, identity_type, is_active)
  VALUES (
    v_identity_id,
    p_phone,
    extensions.crypt(COALESCE(p_password, p_phone), extensions.gen_salt('bf')),
    'employee',
    true
  );

  -- Create employee
  INSERT INTO public.employees (id, identity_id, code, full_name, email, manager_id, is_active)
  VALUES (v_employee_id, v_identity_id, v_code, p_full_name, p_email, p_manager_id, true);

  -- Assign role if provided
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

COMMENT ON FUNCTION public.governed_create_employee IS 'إضافة موظف جديد مع هوية وحساب';

-- A3. governed_update_employee ----------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_employee(
  p_token uuid,
  p_id uuid,
  p_full_name varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL,
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

  PERFORM check_capability(p_token, 'employees.manage');

  -- Update employee record
  UPDATE public.employees
  SET
    full_name = COALESCE(p_full_name, full_name),
    email = COALESCE(p_email, email),
    updated_at = now()
  WHERE id = p_id;

  -- Update phone in identities if provided
  IF p_phone IS NOT NULL THEN
    SELECT identity_id INTO v_identity_id FROM public.employees WHERE id = p_id;
    IF v_identity_id IS NOT NULL THEN
      UPDATE public.identities SET phone = p_phone WHERE id = v_identity_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_employee IS 'تعديل بيانات موظف';

-- A4. governed_activate_employee --------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_activate_employee(
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
  v_identity_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'employees.manage');

  SELECT identity_id INTO v_identity_id FROM public.employees WHERE id = p_id;
  IF v_identity_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  UPDATE public.employees SET is_active = true, updated_at = now() WHERE id = p_id;
  UPDATE public.identities SET is_active = true WHERE id = v_identity_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_activate_employee IS 'تفعيل موظف';

-- A5. governed_deactivate_employee ------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_deactivate_employee(
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
  v_identity_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'employees.manage');

  SELECT identity_id INTO v_identity_id FROM public.employees WHERE id = p_id;
  IF v_identity_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  UPDATE public.employees SET is_active = false, updated_at = now() WHERE id = p_id;
  UPDATE public.identities SET is_active = false WHERE id = v_identity_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_deactivate_employee IS 'إيقاف موظف';

-- A6. governed_reset_employee_password --------------------------------------

CREATE OR REPLACE FUNCTION public.governed_reset_employee_password(
  p_token uuid,
  p_id uuid,
  p_new_password varchar DEFAULT NULL
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

  SELECT identity_id INTO v_identity_id FROM public.employees WHERE id = p_id;
  IF v_identity_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  UPDATE public.identities
  SET password_hash = extensions.crypt(COALESCE(p_new_password, '123456'), extensions.gen_salt('bf'))
  WHERE id = v_identity_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_reset_employee_password IS 'إعادة تعيين كلمة مرور موظف';

-- A7. governed_change_employee_manager --------------------------------------

CREATE OR REPLACE FUNCTION public.governed_change_employee_manager(
  p_token uuid,
  p_id uuid,
  p_manager_id uuid
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

  PERFORM check_capability(p_token, 'employees.manage');

  -- Prevent self-manager
  IF p_id = p_manager_id THEN RETURN jsonb_build_object('error', 'SELF_MANAGER'); END IF;

  UPDATE public.employees SET manager_id = p_manager_id, updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_change_employee_manager IS 'تغيير المدير المسؤول للموظف';

-- A8. governed_change_employee_role -----------------------------------------

CREATE OR REPLACE FUNCTION public.governed_change_employee_role(
  p_token uuid,
  p_id uuid,
  p_role_id uuid
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

  PERFORM check_capability(p_token, 'employees.manage');

  -- Remove existing roles
  DELETE FROM public.employee_roles WHERE employee_id = p_id;

  -- Assign new role
  INSERT INTO public.employee_roles (employee_id, role_id, assigned_by)
  VALUES (p_id, p_role_id, v_session.employee_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_change_employee_role IS 'تغيير صلاحية الموظف';

-- A9. governed_update_employee_capabilities ---------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_employee_capabilities(
  p_token uuid,
  p_id uuid,
  p_capabilities jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_item jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'employees.manage');

  -- Remove all existing direct capabilities
  DELETE FROM public.employee_capabilities WHERE employee_id = p_id;

  -- Insert new capabilities
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_capabilities)
  LOOP
    INSERT INTO public.employee_capabilities (employee_id, capability_id, grant_type, assigned_by)
    VALUES (p_id, (v_item->>'capability_id')::uuid, COALESCE(v_item->>'grant_type', 'grant'), v_session.employee_id);
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_employee_capabilities IS 'تحديث الصلاحيات المباشرة للموظف';

-- A10. get_employee_activity ------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_employee_activity(
  p_token uuid,
  p_employee_id uuid,
  p_limit integer DEFAULT 50
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

  WITH orders_activity AS (
    SELECT 'order' as activity_type, o.order_number as ref, o.status, o.total_amount, o.created_at
    FROM orders o WHERE o.created_by = p_employee_id
    ORDER BY o.created_at DESC LIMIT p_limit
  ),
  visits_activity AS (
    SELECT 'visit' as activity_type, v.code as ref, v.status, v.visit_result as status, v.created_at
    FROM visits v WHERE v.employee_id = p_employee_id
    ORDER BY v.created_at DESC LIMIT p_limit
  ),
  collections_activity AS (
    SELECT 'collection' as activity_type, c.code as ref, c.status, c.amount as total_amount, c.created_at
    FROM collections c WHERE c.created_by = p_employee_id
    ORDER BY c.created_at DESC LIMIT p_limit
  ),
  combined AS (
    SELECT * FROM orders_activity
    UNION ALL SELECT * FROM visits_activity
    UNION ALL SELECT * FROM collections_activity
    ORDER BY created_at DESC LIMIT p_limit
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'type', activity_type,
      'ref', ref,
      'status', status,
      'amount', total_amount,
      'created_at', created_at
    )
  ) INTO v_result FROM combined;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_employee_activity IS 'نشاط الموظف (الطلبات والزيارات والتحصيلات)';

-- ============================================================================
-- PART B: CUSTOMER MANAGEMENT RPCs (Missing Operations)
-- ============================================================================

-- B1. get_governed_customer -------------------------------------------------

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
    'email', c.email,
    'phone', i.phone,
    'credit_limit', c.credit_limit,
    'credit_days', c.credit_days,
    'owner_id', c.owner_id,
    'owner_name', e.full_name,
    'owner_code', e.code,
    'is_active', c.is_active,
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

COMMENT ON FUNCTION public.get_governed_customer IS 'بيانات عميل كاملة';

-- B2. governed_update_customer ----------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_customer(
  p_token uuid,
  p_id uuid,
  p_company_name varchar DEFAULT NULL,
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
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_customer IS 'تعديل بيانات عميل';

-- B3. governed_activate_customer --------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_activate_customer(
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'customers.manage');

  UPDATE public.customers SET is_active = true, updated_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_activate_customer IS 'تفعيل عميل';

-- B4. governed_deactivate_customer ------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_deactivate_customer(
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'customers.manage');

  UPDATE public.customers SET is_active = false, updated_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_deactivate_customer IS 'إيقاف عميل';

-- B5. governed_change_customer_ownership ------------------------------------

CREATE OR REPLACE FUNCTION public.governed_change_customer_ownership(
  p_token uuid,
  p_customer_id uuid,
  p_new_owner_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_prev_owner_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'customers.manage');

  SELECT owner_id INTO v_prev_owner_id FROM public.customers WHERE id = p_customer_id;
  IF v_prev_owner_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  -- Record ownership history
  INSERT INTO public.customer_ownership_history (customer_id, previous_owner_id, new_owner_id, changed_by, reason)
  VALUES (p_customer_id, v_prev_owner_id, p_new_owner_id, v_session.employee_id, p_reason);

  -- Update ownership
  UPDATE public.customers SET owner_id = p_new_owner_id, updated_at = now() WHERE id = p_customer_id;

  RETURN jsonb_build_object('success', true, 'previous_owner_id', v_prev_owner_id);
END;
$$;

COMMENT ON FUNCTION public.governed_change_customer_ownership IS 'نقل ملكية عميل إلى موظف آخر';

-- B6. get_customer_orders ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_customer_orders(
  p_token uuid,
  p_customer_id uuid,
  p_limit integer DEFAULT 50
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'status', o.status,
      'total_amount', o.total_amount,
      'created_at', o.created_at,
      'created_by_name', e.full_name
    ) ORDER BY o.created_at DESC
  ) INTO v_result
  FROM orders o
  LEFT JOIN employees e ON e.id = o.created_by
  WHERE o.customer_id = p_customer_id
  LIMIT p_limit;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_customer_orders IS 'طلبات عميل';

-- B7. get_customer_collections ----------------------------------------------

CREATE OR REPLACE FUNCTION public.get_customer_collections(
  p_token uuid,
  p_customer_id uuid,
  p_limit integer DEFAULT 50
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', col.id,
      'code', col.code,
      'method', col.method,
      'amount', col.amount,
      'status', col.status,
      'reference_number', col.reference_number,
      'collected_at', col.collected_at,
      'created_by_name', e.full_name
    ) ORDER BY col.created_at DESC
  ) INTO v_result
  FROM collections col
  LEFT JOIN employees e ON e.id = col.created_by
  WHERE col.customer_id = p_customer_id
  LIMIT p_limit;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_customer_collections IS 'تحصيلات عميل';

-- B8. get_customer_visits ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_customer_visits(
  p_token uuid,
  p_customer_id uuid,
  p_limit integer DEFAULT 50
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', v.id,
      'code', v.code,
      'status', v.status,
      'visit_result', v.visit_result,
      'check_in_at', v.check_in_at,
      'check_out_at', v.check_out_at,
      'notes', v.notes,
      'employee_name', e.full_name,
      'employee_code', e.code
    ) ORDER BY v.created_at DESC
  ) INTO v_result
  FROM visits v
  LEFT JOIN employees e ON e.id = v.employee_id
  WHERE v.customer_id = p_customer_id
  LIMIT p_limit;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_customer_visits IS 'زيارات عميل';

-- ============================================================================
-- PART C: PRODUCT MANAGEMENT RPCs
-- ============================================================================

-- C1. governed_create_product -----------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_create_product(
  p_token uuid,
  p_company_id uuid,
  p_product_name varchar,
  p_legacy_code varchar,
  p_description text DEFAULT NULL,
  p_carton_quantity integer DEFAULT NULL,
  p_carton_price decimal DEFAULT NULL,
  p_units jsonb DEFAULT '["piece", "dozen", "carton"]'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_product_id uuid;
  v_unit text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'products.manage');

  INSERT INTO public.products (company_id, product_name, legacy_code, description, carton_quantity, carton_price, is_active)
  VALUES (p_company_id, p_product_name, p_legacy_code, p_description, p_carton_quantity, p_carton_price, true)
  RETURNING id INTO v_product_id;

  -- Create product units
  FOR v_unit IN SELECT * FROM jsonb_array_elements_text(p_units)
  LOOP
    INSERT INTO public.product_units (product_id, unit_type, is_active)
    VALUES (v_product_id, v_unit, true);
  END LOOP;

  -- Create inventory record
  INSERT INTO public.inventory (product_id, quantity)
  VALUES (v_product_id, 0);

  RETURN jsonb_build_object('success', true, 'id', v_product_id);
END;
$$;

COMMENT ON FUNCTION public.governed_create_product IS 'إضافة منتج جديد';

-- C2. governed_update_product -----------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_product(
  p_token uuid,
  p_id uuid,
  p_product_name varchar DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_legacy_code varchar DEFAULT NULL
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

  PERFORM check_capability(p_token, 'products.manage');

  UPDATE public.products
  SET
    product_name = COALESCE(p_product_name, product_name),
    description = COALESCE(p_description, description),
    legacy_code = COALESCE(p_legacy_code, legacy_code),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_product IS 'تعديل بيانات منتج';

-- C3. governed_activate_product ---------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_activate_product(
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'products.manage');

  UPDATE public.products SET is_active = true, updated_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_activate_product IS 'تفعيل منتج';

-- C4. governed_deactivate_product -------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_deactivate_product(
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'products.manage');

  UPDATE public.products SET is_active = false, updated_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_deactivate_product IS 'إيقاف منتج';

-- C5. governed_change_product_company ---------------------------------------

CREATE OR REPLACE FUNCTION public.governed_change_product_company(
  p_token uuid,
  p_product_id uuid,
  p_new_company_id uuid
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

  PERFORM check_capability(p_token, 'products.manage');

  UPDATE public.products SET company_id = p_new_company_id, updated_at = now() WHERE id = p_product_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_change_product_company IS 'نقل منتج لشركة أخرى';

-- C6. governed_update_product_pricing ---------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_product_pricing(
  p_token uuid,
  p_id uuid,
  p_carton_price decimal DEFAULT NULL,
  p_carton_quantity integer DEFAULT NULL
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

  PERFORM check_capability(p_token, 'products.manage');

  UPDATE public.products
  SET
    carton_price = COALESCE(p_carton_price, carton_price),
    carton_quantity = COALESCE(p_carton_quantity, carton_quantity),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_product_pricing IS 'تحديث أسعار المنتج';

-- C7. governed_update_product_units -----------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_product_units(
  p_token uuid,
  p_id uuid,
  p_units jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_unit jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'products.manage');

  -- Deactivate all existing units
  UPDATE public.product_units SET is_active = false WHERE product_id = p_id;

  -- Activate specified units
  FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units)
  LOOP
    INSERT INTO public.product_units (product_id, unit_type, is_active)
    VALUES (p_id, v_unit->>'unit_type', true)
    ON CONFLICT (product_id, unit_type)
    DO UPDATE SET is_active = true;
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_product_units IS 'تحديث وحدات البيع للمنتج';

-- ============================================================================
-- PART D: COMPANY MANAGEMENT RPCs
-- ============================================================================

-- D1. get_governed_companies ------------------------------------------------

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
      'created_at', comp.created_at,
      'product_count', (SELECT COUNT(*) FROM products p WHERE p.company_id = comp.id)
    ) ORDER BY comp.company_name
  ) INTO v_result FROM companies comp;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_companies IS 'قائمة الشركات مع عدد المنتجات';

-- D2. governed_create_company -----------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_create_company(
  p_token uuid,
  p_company_name varchar,
  p_legacy_code varchar
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_company_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'companies.manage');

  INSERT INTO public.companies (company_name, legacy_code, is_active)
  VALUES (p_company_name, p_legacy_code, true)
  RETURNING id INTO v_company_id;

  RETURN jsonb_build_object('success', true, 'id', v_company_id);
END;
$$;

COMMENT ON FUNCTION public.governed_create_company IS 'إضافة شركة جديدة';

-- D3. governed_update_company -----------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_company(
  p_token uuid,
  p_id uuid,
  p_company_name varchar DEFAULT NULL,
  p_legacy_code varchar DEFAULT NULL
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

  PERFORM check_capability(p_token, 'companies.manage');

  UPDATE public.companies
  SET
    company_name = COALESCE(p_company_name, company_name),
    legacy_code = COALESCE(p_legacy_code, legacy_code),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_company IS 'تعديل بيانات شركة';

-- D4. governed_activate_company ---------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_activate_company(
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'companies.manage');

  UPDATE public.companies SET is_active = true, updated_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_activate_company IS 'تفعيل شركة';

-- D5. governed_deactivate_company -------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_deactivate_company(
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'companies.manage');

  UPDATE public.companies SET is_active = false, updated_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_deactivate_company IS 'إيقاف شركة';

-- D6. get_company_products --------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_company_products(
  p_token uuid,
  p_company_id uuid
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'product_name', p.product_name,
      'legacy_code', p.legacy_code,
      'is_active', p.is_active,
      'carton_price', p.carton_price,
      'carton_quantity', p.carton_quantity,
      'created_at', p.created_at
    ) ORDER BY p.product_name
  ) INTO v_result
  FROM products p
  WHERE p.company_id = p_company_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- D7. get_company_analytics -------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_company_analytics(
  p_token uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_total_products integer;
  v_active_products integer;
  v_total_orders integer;
  v_total_revenue decimal;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT COUNT(*) INTO v_total_products FROM products WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_active_products FROM products WHERE company_id = p_company_id AND is_active = true;

  SELECT COUNT(*), COALESCE(SUM(oi.total_price), 0)
  INTO v_total_orders, v_total_revenue
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE p.company_id = p_company_id;

  RETURN jsonb_build_object(
    'total_products', v_total_products,
    'active_products', v_active_products,
    'total_order_items', v_total_orders,
    'total_revenue', v_total_revenue
  );
END;
$$;

-- ============================================================================
-- PART E: VISIT MANAGEMENT RPCs (Missing Operations)
-- ============================================================================

-- E1. governed_checkin_visit -------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_checkin_visit(
  p_token uuid,
  p_customer_id uuid,
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

  INSERT INTO public.visits (code, employee_id, customer_id, status, check_in_at, check_in_latitude, check_in_longitude)
  VALUES (v_code, v_session.employee_id, p_customer_id, 'active', now(), p_latitude, p_longitude)
  RETURNING id INTO v_visit_id;

  RETURN jsonb_build_object('success', true, 'id', v_visit_id, 'code', v_code);
END;
$$;

COMMENT ON FUNCTION public.governed_checkin_visit IS 'تسجيل دخول زيارة';

-- E2. governed_checkout_visit ------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_checkout_visit(
  p_token uuid,
  p_visit_id uuid,
  p_visit_result varchar DEFAULT NULL,
  p_notes text DEFAULT NULL,
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
    check_out_latitude = COALESCE(p_latitude, check_out_latitude),
    check_out_longitude = COALESCE(p_longitude, check_out_longitude),
    visit_result = COALESCE(p_visit_result, visit_result),
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE id = p_visit_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_checkout_visit IS 'تسجيل خروج زيارة';

-- E3. governed_update_visit --------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_visit(
  p_token uuid,
  p_id uuid,
  p_notes text DEFAULT NULL,
  p_visit_result varchar DEFAULT NULL
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

  UPDATE public.visits
  SET
    notes = COALESCE(p_notes, notes),
    visit_result = COALESCE(p_visit_result, visit_result),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_visit IS 'تعديل بيانات الزيارة';

-- ============================================================================
-- PART F: COLLECTION MANAGEMENT RPCs (Missing Operations)
-- ============================================================================

-- F1. governed_approve_collection -------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_approve_collection(
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
  v_old_status varchar(30);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'collections.approve');

  SELECT status INTO v_old_status FROM collections WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_old_status != 'pending' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE collections
  SET status = 'approved', approved_by = v_session.employee_id, approved_at = now(), updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_approve_collection IS 'اعتماد تحصيل';

-- F2. governed_update_collection --------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_collection(
  p_token uuid,
  p_id uuid,
  p_amount decimal DEFAULT NULL,
  p_method varchar DEFAULT NULL,
  p_reference_number varchar DEFAULT NULL,
  p_notes text DEFAULT NULL
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

  PERFORM check_capability(p_token, 'collections.update');

  UPDATE collections
  SET
    amount = COALESCE(p_amount, amount),
    method = COALESCE(p_method, method),
    reference_number = COALESCE(p_reference_number, reference_number),
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_collection IS 'تعديل تحصيل';

-- ============================================================================
-- PART G: ORDER ENHANCEMENT RPCs
-- ============================================================================

-- G1. get_order_timeline ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_order_timeline(
  p_token uuid,
  p_order_id uuid
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', osh.id,
      'from_status', osh.from_status,
      'to_status', osh.to_status,
      'changed_by_name', e.full_name,
      'reason', osh.reason,
      'changed_at', osh.changed_at
    ) ORDER BY osh.changed_at ASC
  ) INTO v_result
  FROM order_status_history osh
  LEFT JOIN employees e ON e.id = osh.changed_by
  WHERE osh.order_id = p_order_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_order_timeline IS 'التسلسل الزمني للطلب';

-- G2. Enhanced get_governed_orders with search/filter support ---------------

CREATE OR REPLACE FUNCTION public.get_governed_orders(
  p_token uuid,
  p_search text DEFAULT NULL,
  p_status varchar DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'customer_id', o.customer_id,
      'customer_name_snapshot', c.company_name,
      'owner_type', o.owner_type,
      'owner_id', o.owner_id,
      'status', o.status,
      'subtotal', o.subtotal,
      'discount_amount', o.discount_amount,
      'total_amount', o.total_amount,
      'notes', o.notes,
      'revision_number', o.revision_number,
      'created_by', o.created_by,
      'created_by_employee_id', o.created_by,
      'created_by_name_snapshot', e.full_name,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'approved_at', o.approved_at,
      'submitted_at', o.submitted_at,
      'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
    ) ORDER BY o.created_at DESC
  ) INTO v_result
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN employees e ON e.id = o.created_by
  WHERE (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%' OR c.company_name ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR o.status = p_status)
    AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
    AND (p_created_by IS NULL OR o.created_by = p_created_by)
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_orders IS 'الطلبات مع دعم البحث والتصفية';

-- ============================================================================
-- PART H: REPORTING RPCs
-- ============================================================================

-- H1. get_sales_by_rep -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_sales_by_rep(
  p_token uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'employee_id', e.id,
      'employee_name', e.full_name,
      'employee_code', e.code,
      'total_orders', COUNT(o.id),
      'total_amount', COALESCE(SUM(o.total_amount), 0),
      'customer_count', COUNT(DISTINCT o.customer_id)
    ) ORDER BY SUM(o.total_amount) DESC NULLS LAST
  ) INTO v_result
  FROM employees e
  JOIN orders o ON o.created_by = e.id
  WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    AND o.status NOT IN ('draft', 'cancelled')
  GROUP BY e.id, e.full_name, e.code;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_sales_by_rep IS 'تقرير المبيعات حسب المندوب';

-- H2. get_sales_by_manager ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_sales_by_manager(
  p_token uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'manager_id', m.id,
      'manager_name', m.full_name,
      'total_orders', COUNT(o.id),
      'total_amount', COALESCE(SUM(o.total_amount), 0),
      'rep_count', COUNT(DISTINCT e.id)
    ) ORDER BY SUM(o.total_amount) DESC NULLS LAST
  ) INTO v_result
  FROM employees m
  JOIN employees e ON e.manager_id = m.id
  JOIN orders o ON o.created_by = e.id
  WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    AND o.status NOT IN ('draft', 'cancelled')
  GROUP BY m.id, m.full_name;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_sales_by_manager IS 'تقرير المبيعات حسب المدير';

-- H3. get_sales_by_customer --------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_sales_by_customer(
  p_token uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'customer_id', c.id,
      'customer_name', c.company_name,
      'total_orders', COUNT(o.id),
      'total_amount', COALESCE(SUM(o.total_amount), 0)
    ) ORDER BY SUM(o.total_amount) DESC NULLS LAST
  ) INTO v_result
  FROM customers c
  JOIN orders o ON o.customer_id = c.id
  WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    AND o.status NOT IN ('draft', 'cancelled')
  GROUP BY c.id, c.company_name;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_sales_by_customer IS 'تقرير المبيعات حسب العميل';

-- H4. get_sales_by_product ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_sales_by_product(
  p_token uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', pr.id,
      'product_name', pr.product_name,
      'company_name', comp.company_name,
      'total_quantity', SUM(oi.piece_quantity),
      'total_amount', SUM(oi.total_price),
      'order_count', COUNT(DISTINCT oi.order_id)
    ) ORDER BY SUM(oi.total_price) DESC NULLS LAST
  ) INTO v_result
  FROM order_items oi
  JOIN products pr ON pr.id = oi.product_id
  JOIN companies comp ON comp.id = pr.company_id
  JOIN orders o ON o.id = oi.order_id
  WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    AND o.status NOT IN ('draft', 'cancelled')
  GROUP BY pr.id, pr.product_name, comp.company_name;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_sales_by_product IS 'تقرير المبيعات حسب المنتج';

-- H5. get_sales_by_company ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_sales_by_company(
  p_token uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'company_id', comp.id,
      'company_name', comp.company_name,
      'total_quantity', SUM(oi.piece_quantity),
      'total_amount', SUM(oi.total_price),
      'product_count', COUNT(DISTINCT oi.product_id),
      'order_count', COUNT(DISTINCT oi.order_id)
    ) ORDER BY SUM(oi.total_price) DESC NULLS LAST
  ) INTO v_result
  FROM order_items oi
  JOIN products pr ON pr.id = oi.product_id
  JOIN companies comp ON comp.id = pr.company_id
  JOIN orders o ON o.id = oi.order_id
  WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    AND o.status NOT IN ('draft', 'cancelled')
  GROUP BY comp.id, comp.company_name;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_sales_by_company IS 'تقرير المبيعات حسب الشركة';

-- H6. get_sales_by_time ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_sales_by_time(
  p_token uuid,
  p_grouping varchar DEFAULT 'day',
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
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

  IF p_grouping = 'month' THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'period', TO_CHAR(o.created_at, 'YYYY-MM'),
        'total_orders', COUNT(o.id),
        'total_amount', COALESCE(SUM(o.total_amount), 0)
      ) ORDER BY 1
    ) INTO v_result
    FROM orders o
    WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      AND o.status NOT IN ('draft', 'cancelled')
    GROUP BY TO_CHAR(o.created_at, 'YYYY-MM');
  ELSE
    SELECT jsonb_agg(
      jsonb_build_object(
        'period', o.created_at::date::text,
        'total_orders', COUNT(o.id),
        'total_amount', COALESCE(SUM(o.total_amount), 0)
      ) ORDER BY 1
    ) INTO v_result
    FROM orders o
    WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      AND o.status NOT IN ('draft', 'cancelled')
    GROUP BY o.created_at::date;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_sales_by_time IS 'تقرير المبيعات حسب الفترة الزمنية';

-- H7. get_order_report -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_order_report(
  p_token uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'status', o.status,
      'count', COUNT(o.id),
      'total_amount', COALESCE(SUM(o.total_amount), 0)
    ) ORDER BY o.status
  ) INTO v_result
  FROM orders o
  WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_order_report IS 'تقرير الطلبات حسب الحالة';

-- H8. get_collection_report --------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_collection_report(
  p_token uuid,
  p_grouping varchar DEFAULT 'day',
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
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

  IF p_grouping = 'month' THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'period', TO_CHAR(collected_at, 'YYYY-MM'),
        'count', COUNT(id),
        'total_amount', COALESCE(SUM(amount), 0)
      ) ORDER BY 1
    ) INTO v_result
    FROM collections
    WHERE status = 'approved'
      AND (p_date_from IS NULL OR collected_at >= p_date_from)
      AND (p_date_to IS NULL OR collected_at <= p_date_to)
    GROUP BY TO_CHAR(collected_at, 'YYYY-MM');
  ELSIF p_grouping = 'week' THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'period', TO_CHAR(collected_at, 'IYYY-"W"IW'),
        'count', COUNT(id),
        'total_amount', COALESCE(SUM(amount), 0)
      ) ORDER BY 1
    ) INTO v_result
    FROM collections
    WHERE status = 'approved'
      AND (p_date_from IS NULL OR collected_at >= p_date_from)
      AND (p_date_to IS NULL OR collected_at <= p_date_to)
    GROUP BY TO_CHAR(collected_at, 'IYYY-"W"IW');
  ELSE
    SELECT jsonb_agg(
      jsonb_build_object(
        'period', collected_at::date::text,
        'count', COUNT(id),
        'total_amount', COALESCE(SUM(amount), 0)
      ) ORDER BY 1
    ) INTO v_result
    FROM collections
    WHERE status = 'approved'
      AND (p_date_from IS NULL OR collected_at >= p_date_from)
      AND (p_date_to IS NULL OR collected_at <= p_date_to)
    GROUP BY collected_at::date;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_collection_report IS 'تقرير التحصيلات';

-- H9. get_visit_report -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_visit_report(
  p_token uuid,
  p_report_type varchar DEFAULT 'rep_activity',
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
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

  IF p_report_type = 'customer_coverage' THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'customer_id', c.id,
        'customer_name', c.company_name,
        'owner_name', e.full_name,
        'total_visits', COUNT(v.id),
        'last_visit', MAX(v.created_at)
      ) ORDER BY COUNT(v.id) DESC
    ) INTO v_result
    FROM customers c
    LEFT JOIN visits v ON v.customer_id = c.id
      AND (p_date_from IS NULL OR v.created_at >= p_date_from)
      AND (p_date_to IS NULL OR v.created_at <= p_date_to)
    LEFT JOIN employees e ON e.id = c.owner_id
    GROUP BY c.id, c.company_name, e.full_name;
  ELSE
    SELECT jsonb_agg(
      jsonb_build_object(
        'employee_id', e.id,
        'employee_name', e.full_name,
        'total_visits', COUNT(v.id),
        'completed_visits', COUNT(v.id) FILTER (WHERE v.status = 'completed'),
        'active_visits', COUNT(v.id) FILTER (WHERE v.status = 'active')
      ) ORDER BY COUNT(v.id) DESC
    ) INTO v_result
    FROM employees e
    LEFT JOIN visits v ON v.employee_id = e.id
      AND (p_date_from IS NULL OR v.created_at >= p_date_from)
      AND (p_date_to IS NULL OR v.created_at <= p_date_to)
    GROUP BY e.id, e.full_name;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_visit_report IS 'تقرير الزيارات';

-- ============================================================================
-- END OF RUNTIME SCREEN COMPLETION MIGRATION
-- ============================================================================
