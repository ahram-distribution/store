-- ============================================================================
-- IDENTITY RULES — FINAL
-- 1. ثبت owner_id = السوبر أدمن للعملاء المسجلين من الواجهة
-- 2. ألغِ أي اعتماد على موظف الأهرام الافتراضي
-- 3. source واحد للمسؤول عن العميل: customers.owner_id
-- 4. source واحد لمرسل الطلب: orders.created_by
-- 5. بيانات الطلب الموحدة: العميل + المسؤول + مرسل الطلب (اسم + هاتف + عنوان)
-- ============================================================================

-- ============================================================================
-- 1. Ensure SUPER_ADMIN role exists (both English + Arabic)
-- ============================================================================

INSERT INTO public.roles (name, description, is_system)
SELECT 'SUPER_ADMIN', 'Super Admin — full system access', true
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'SUPER_ADMIN');

INSERT INTO public.roles (name, description, is_system)
SELECT 'سوبر أدمن', 'المدير العام — صلاحية كاملة', true
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'سوبر أدمن');

-- ============================================================================
-- 2. Assign SUPER_ADMIN to the most suitable existing employee
--    Priority: ADMIN-001, then first active employee
-- ============================================================================

DO $$
DECLARE
  v_super_role_id uuid;
  v_target_emp_id uuid;
BEGIN
  SELECT id INTO v_super_role_id FROM public.roles WHERE name = 'SUPER_ADMIN' LIMIT 1;
  IF v_super_role_id IS NULL THEN
    SELECT id INTO v_super_role_id FROM public.roles WHERE name = 'سوبر أدمن' LIMIT 1;
  END IF;

  IF v_super_role_id IS NOT NULL THEN
    SELECT id INTO v_target_emp_id FROM public.employees WHERE code = 'ADMIN-001' LIMIT 1;
    IF v_target_emp_id IS NULL THEN
      SELECT id INTO v_target_emp_id FROM public.employees WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_target_emp_id IS NOT NULL THEN
      INSERT INTO public.employee_roles (employee_id, role_id, assigned_by)
      VALUES (v_target_emp_id, v_super_role_id, v_target_emp_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END;
$$;

-- ============================================================================
-- 3. Replace register_customer — owner_id = super admin
-- ============================================================================

DROP FUNCTION IF EXISTS public.register_customer(p_phone varchar, p_password varchar, p_company_name varchar, p_responsible_name varchar, p_business_type business_type, p_latitude numeric, p_longitude numeric, p_accuracy_meters numeric, p_formatted_address text, p_email varchar);

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

  SELECT e.id INTO v_owner_id
  FROM employees e
  JOIN employee_roles er ON er.employee_id = e.id
  JOIN roles r ON r.id = er.role_id
  WHERE r.name IN ('SUPER_ADMIN', 'سوبر أدمن', 'سوبرادمن')
  ORDER BY e.created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    DELETE FROM identities WHERE id = v_identity_id;
    DELETE FROM unified_locations WHERE id = v_location_id;
    RETURN json_build_object('success', false, 'error', 'لا يوجد سوبر أدمن في النظام');
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

COMMENT ON FUNCTION public.register_customer IS 'تسجيل عميل جديد — owner_id = السوبر أدمن';

-- ============================================================================
-- 4. Update get_governed_orders — return owner + creator contact info
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_governed_orders(p_token uuid, p_search text, p_status varchar, p_customer_id uuid, p_created_by uuid, p_date_from timestamptz, p_date_to timestamptz);

CREATE OR REPLACE FUNCTION public.get_governed_orders(
  p_token uuid, p_search text DEFAULT NULL, p_status varchar DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL, p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'id', o.id, 'order_number', o.order_number,
    'customer_id', o.customer_id,
    'customer_name', c.company_name,
    'customer_phone', (SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1),
    'customer_address', (SELECT ul.formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
    'customer_maps_url', (SELECT ul.google_maps_url FROM unified_locations ul WHERE ul.id = c.location_id),
    'owner_type', o.owner_type, 'owner_id', o.owner_id,
    'owner_name', e_owner.full_name,
    'owner_phone', i_owner.phone,
    'owner_address', e_owner.address,
    'status', o.status, 'subtotal', o.subtotal,
    'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
    'notes', o.notes, 'revision_number', o.revision_number,
    'created_by', o.created_by,
    'created_by_name', COALESCE(e_creator.full_name, cu_creator.company_name),
    'created_by_phone', COALESCE(i_creator.phone, (SELECT phone FROM customer_contacts WHERE customer_id = cu_creator.id AND is_primary = true LIMIT 1)),
    'created_by_address', COALESCE(e_creator.address, (SELECT formatted_address FROM unified_locations ul WHERE ul.id = cu_creator.location_id)),
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
    'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
  ) ORDER BY o.created_at DESC) INTO v_result
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN employees e_owner ON e_owner.id = c.owner_id
  LEFT JOIN identities i_owner ON i_owner.id = e_owner.identity_id
  LEFT JOIN identities i_creator ON i_creator.id = o.created_by
  LEFT JOIN employees e_creator ON e_creator.identity_id = i_creator.id AND i_creator.identity_type = 'employee'
  LEFT JOIN customers cu_creator ON cu_creator.identity_id = i_creator.id AND i_creator.identity_type = 'customer'
  WHERE (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%' OR c.company_name ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR o.status = p_status)
    AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
    AND (p_created_by IS NULL OR o.created_by = p_created_by)
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to);
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 5. Update get_governed_employees — include identity_id for identity-based filtering
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_governed_employees(p_token uuid);

CREATE OR REPLACE FUNCTION public.get_governed_employees(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'identity_id', e.identity_id, 'code', e.code, 'full_name', e.full_name,
      'email', e.email, 'phone', i.phone, 'manager_id', e.manager_id,
      'is_active', e.is_active, 'address', e.address,
      'created_at', e.created_at,
      'roles', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name))
           FROM employee_roles er JOIN roles r ON r.id = er.role_id
           WHERE er.employee_id = e.id), '[]'::jsonb),
      'role_names', COALESCE((SELECT string_agg(r.name, ', ')
           FROM employee_roles er JOIN roles r ON r.id = er.role_id
           WHERE er.employee_id = e.id), ''),
      'direct_capabilities', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'grant_type', ec.grant_type))
           FROM employee_capabilities ec JOIN capabilities c ON c.id = ec.capability_id
           WHERE ec.employee_id = e.id), '[]'::jsonb)
    ) ORDER BY e.created_at DESC
  ) INTO v_result FROM employees e JOIN identities i ON i.id = e.identity_id;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 6. Helper: get_governed_identity — resolve name/phone/address by identity_id
--    Works for both employees and customers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_identity(
  p_token uuid,
  p_identity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_identity_type text;
  v_name text;
  v_phone text;
  v_address text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT i.identity_type INTO v_identity_type
  FROM identities i WHERE i.id = p_identity_id;

  IF v_identity_type = 'employee' THEN
    SELECT e.full_name, i2.phone, e.address
    INTO v_name, v_phone, v_address
    FROM employees e
    JOIN identities i2 ON i2.id = e.identity_id
    WHERE e.identity_id = p_identity_id;

    RETURN jsonb_build_object(
      'identity_type', 'employee',
      'name', v_name,
      'phone', COALESCE(v_phone, ''),
      'address', COALESCE(v_address, '')
    );

  ELSIF v_identity_type = 'customer' THEN
    SELECT c.company_name,
           (SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1),
           (SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id)
    INTO v_name, v_phone, v_address
    FROM customers c
    WHERE c.identity_id = p_identity_id;

    RETURN jsonb_build_object(
      'identity_type', 'customer',
      'name', v_name,
      'phone', COALESCE(v_phone, ''),
      'address', COALESCE(v_address, '')
    );

  ELSE
    RETURN jsonb_build_object('error', 'IDENTITY_NOT_FOUND');
  END IF;
END;
$$;

COMMENT ON FUNCTION public.get_governed_identity IS 'حل اسم/هاتف/عنوان أي هوية (موظف أو عميل)';

-- ============================================================================
-- 7. Replace get_governed_order (singular) — return enriched JSONB
--    so the frontend has customer/owner/creator name/phone/address directly.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_governed_order(p_token uuid, p_id uuid);

CREATE OR REPLACE FUNCTION public.get_governed_order(
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
  v_order public.orders;
  v_emp_id uuid;
  v_cust_name text;
  v_cust_phone text;
  v_cust_address text;
  v_cust_maps_url text;
  v_owner_name text;
  v_owner_phone text;
  v_owner_address text;
  v_creator_name text;
  v_creator_phone text;
  v_creator_address text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  -- Customer access
  IF v_session.identity_type = 'customer' THEN
    IF v_order.customer_id != v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  ELSE
    v_emp_id := v_session.employee_id;
    IF NOT app.has_capability('customers.read') THEN
      IF NOT EXISTS(SELECT 1 FROM public.orders o
                    JOIN public.customers c ON c.id = o.customer_id
                    WHERE o.id = p_id
                      AND c.owner_id = ANY(app.get_subtree_ids(v_emp_id))) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
  END IF;

  -- Enrich customer info
  SELECT c.company_name,
         (SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1),
         ul.formatted_address,
         ul.google_maps_url
  INTO v_cust_name, v_cust_phone, v_cust_address, v_cust_maps_url
  FROM customers c
  LEFT JOIN unified_locations ul ON ul.id = c.location_id
  WHERE c.id = v_order.customer_id;

  -- Enrich owner info
  SELECT e.full_name, i.phone, e.address
  INTO v_owner_name, v_owner_phone, v_owner_address
  FROM employees e
  LEFT JOIN identities i ON i.id = e.identity_id
  WHERE e.id = v_order.owner_id;

  -- Enrich creator info
  SELECT
    COALESCE(e_creator.full_name, cu_creator.company_name),
    COALESCE(i_creator.phone, (SELECT phone FROM customer_contacts WHERE customer_id = cu_creator.id AND is_primary = true LIMIT 1)),
    COALESCE(e_creator.address, (SELECT formatted_address FROM unified_locations ul WHERE ul.id = cu_creator.location_id))
  INTO v_creator_name, v_creator_phone, v_creator_address
  FROM identities i_creator
  LEFT JOIN employees e_creator ON e_creator.identity_id = i_creator.id AND i_creator.identity_type = 'employee'
  LEFT JOIN customers cu_creator ON cu_creator.identity_id = i_creator.id AND i_creator.identity_type = 'customer'
  WHERE i_creator.id = v_order.created_by;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'customer_id', v_order.customer_id,
    'customer_name', v_cust_name,
    'customer_phone', v_cust_phone,
    'customer_address', v_cust_address,
    'customer_maps_url', v_cust_maps_url,
    'owner_type', v_order.owner_type,
    'owner_id', v_order.owner_id,
    'owner_name', v_owner_name,
    'owner_phone', v_owner_phone,
    'owner_address', v_owner_address,
    'status', v_order.status,
    'subtotal', v_order.subtotal,
    'discount_amount', v_order.discount_amount,
    'total_amount', v_order.total_amount,
    'notes', v_order.notes,
    'revision_number', v_order.revision_number,
    'created_by', v_order.created_by,
    'created_by_name', v_creator_name,
    'created_by_phone', v_creator_phone,
    'created_by_address', v_creator_address,
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'approved_at', v_order.approved_at,
    'submitted_at', v_order.submitted_at,
    'execution_latitude', v_order.execution_latitude,
    'execution_longitude', v_order.execution_longitude,
    'execution_accuracy_meters', v_order.execution_accuracy_meters,
    'execution_captured_at', v_order.execution_captured_at,
    'execution_maps_url', CASE WHEN v_order.execution_latitude IS NOT NULL AND v_order.execution_longitude IS NOT NULL
      THEN 'https://maps.google.com/?q=' || v_order.execution_latitude || ',' || v_order.execution_longitude
      ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.get_governed_order IS 'طلب واحد مع بيانات العميل والمسؤول والمرسل';
