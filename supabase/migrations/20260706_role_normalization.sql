-- ============================================================================
-- PHASE: Organizational Model Unification (Owner-defined 7-role model)
-- DESCRIPTION:
--   1. Creates is_upper_management() — single source of truth for UM checks
--   2. Creates role_normalization table — old→target role mapping
--   3. Inserts the new 'سيلز داخلي' (Internal Sales) role
--   4. Updates check_capability with upper management bypass
--   5. Updates get_visible_employee_ids to use is_upper_management()
--   6. Seeds role_normalization mapping data
--   7. DML GRANTs + RLS policies for 14 tables + unified_locations
--   8. GRANT USAGE ON SCHEMA app TO authenticated (fix "permission denied")
--   9. GRANT USAGE ON SCHEMA public TO anon (storefront access)
-- COMPATIBILITY: Backward compatible — no breaking changes, no data loss
-- ============================================================================

-- 1. is_upper_management — centralized UM role check -------------------------
--     Checks by employee code OR by role name for the 4 designated Upper
--     Management members:
--       ياسر توفيق (ADMIN-001 / WRQ1006)
--       محمد سعيد  (WRQ1003)
--       علي سعيد   (WRQ1002)
--       محمود سعيد (WRQ1004)
--
--     Handles two calling contexts:
--       a. RPC calls: p_employee_id = employees.id (passed from sessions table)
--       b. RLS policies: p_employee_id = NULL → resolves auth.uid() via
--          employees.identity_id (since auth.uid() returns auth.users UUID,
--          NOT employees.id)

CREATE OR REPLACE FUNCTION public.is_upper_management(p_employee_id UUID DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_employee_id UUID;
  v_emp_code text;
BEGIN
  -- Resolve the actual employee UUID
  IF p_employee_id IS NOT NULL THEN
    v_employee_id := p_employee_id;
  ELSE
    -- Called from RLS — auth.uid() returns auth.users UUID, map via identity_id
    SELECT id INTO v_employee_id FROM employees WHERE identity_id = auth.uid();
    IF v_employee_id IS NULL THEN RETURN false; END IF;
  END IF;

  -- Check by hardcoded employee code
  SELECT code INTO v_emp_code FROM employees WHERE id = v_employee_id;
  IF v_emp_code IN ('ADMIN-001', 'WRQ1006', 'WRQ1003', 'WRQ1002', 'WRQ1004') THEN
    RETURN true;
  END IF;

  -- Check by role name (existing upper management role assignments)
  RETURN EXISTS (
    SELECT 1 FROM employee_roles er
    JOIN roles r ON r.id = er.role_id
    WHERE er.employee_id = v_employee_id
    AND r.name IN ('SUPER_ADMIN', 'ADMIN', 'CHAIRMAN', 'EXECUTIVE_MANAGER')
  );
END;
$$;

COMMENT ON FUNCTION public.is_upper_management IS 'التحقق مما إذا كان الموظف من الإدارة العليا (بكود الموظف أو اسم الدور، مع دعم RLS عبر identity_id)';

-- 2. role_normalization — old → target role mapping table --------------------

CREATE TABLE IF NOT EXISTS public.role_normalization (
  old_role_name TEXT PRIMARY KEY,
  target_role_name TEXT,
  status TEXT NOT NULL DEFAULT 'mapped'
    CHECK (status IN ('mapped', 'retired_absorbed', 'deprecated_frozen', 'new')),
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.role_normalization IS 'جدول يربط أسماء الأدوار القديمة بالأدوار المستهدفة في النموذج التنظيمي الجديد';

-- 3. Insert the new 'سيلز داخلي' (Internal Sales) role -----------------------

INSERT INTO public.roles (name, description, is_system)
SELECT 'سيلز داخلي', 'Internal Sales - phone/office orders', true
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'سيلز داخلي');

-- 4. Seed role_normalization mapping data ------------------------------------

INSERT INTO public.role_normalization (old_role_name, target_role_name, status) VALUES
  -- Upper Management (الإدارة العليا) — 4 roles unified into one concept
  ('SUPER_ADMIN',         'الإدارة العليا', 'mapped'),
  ('ADMIN',               'الإدارة العليا', 'mapped'),
  ('CHAIRMAN',            'الإدارة العليا', 'mapped'),
  ('EXECUTIVE_MANAGER',   'الإدارة العليا', 'mapped'),

  -- Sales Manager (مدير بيع)
  ('مدير البيع',          'مدير بيع', 'mapped'),
  ('Sales Manager',       'مدير بيع', 'mapped'),
  ('مدير مبيعات',         'مدير بيع', 'retired_absorbed'),

  -- Sales Rep (مندوب مبيعات)
  ('مندوب مبيعات',        'مندوب مبيعات', 'mapped'),
  ('sales_rep',           'مندوب مبيعات', 'mapped'),

  -- General Supervisor (مشرف عام)
  ('مشرف تنفيذي',         'مشرف عام', 'mapped'),
  ('general_supervisor',  'مشرف عام', 'mapped'),

  -- Warehouse Manager (مدير مخزن)
  ('warehouse_manager',   'مدير مخزن', 'mapped'),
  ('مدير مستودع',         'مدير مخزن', 'mapped'),

  -- New role
  ('سيلز داخلي',          'سيلز داخلي', 'new'),

  -- Retired → absorbed into مدير بيع
  ('supervisor',          'مدير بيع', 'retired_absorbed'),
  ('مشرف مبيعات',         'مدير بيع', 'retired_absorbed'),
  ('سوبر فايزر',          'مدير بيع', 'retired_absorbed'),

  -- Deprecated — frozen (no active routing, no new assignments)
  ('warehouse',           'مدير مخزن', 'deprecated_frozen'),
  ('delivery',            NULL,        'deprecated_frozen'),
  ('collector',           NULL,        'deprecated_frozen'),
  ('accountant',          NULL,        'deprecated_frozen'),
  ('purchasing_manager',  NULL,        'deprecated_frozen'),
  ('secretary',           NULL,        'deprecated_frozen'),
  ('security',            NULL,        'deprecated_frozen'),
  ('buffet',              NULL,        'deprecated_frozen'),
  ('data_entry',          NULL,        'deprecated_frozen')
ON CONFLICT (old_role_name) DO UPDATE SET
  target_role_name = EXCLUDED.target_role_name,
  status = EXCLUDED.status;

-- 5. Update check_capability — add upper management bypass -------------------

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

  -- Upper management bypass: الإدارة العليا has ALL capabilities
  IF public.is_upper_management(v_session.employee_id) THEN
    RETURN true;
  END IF;

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

COMMENT ON FUNCTION public.check_capability IS 'التحقق من صلاحية الموظف بناءً على الجلسة والكود (مع تجاوز الإدارة العليا)';

-- 6. Update get_visible_employee_ids to use is_upper_management --------------
--     Preserves hardcoded employee code bypasses (WRQ1002, WRQ1004) for
--     backward compatibility with existing user assignments.

CREATE OR REPLACE FUNCTION public.get_visible_employee_ids(p_token uuid)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_ali_id uuid;
  v_mahmoud_id uuid;
  v_root_id uuid;
  v_result uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN '{}'::uuid[]; END IF;
  IF v_session.identity_type = 'customer' THEN RETURN '{}'::uuid[]; END IF;

  -- Upper management sees ALL employees
  IF public.is_upper_management(v_session.employee_id) THEN
    SELECT array_agg(id) INTO v_result FROM employees;
    RETURN COALESCE(v_result, '{}'::uuid[]);
  END IF;

  -- Legacy hardcoded bypass: Ali Said (WRQ1002) and Mahmoud Said (WRQ1004)
  -- see the full subtree of their common manager
  SELECT id INTO v_ali_id FROM employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    SELECT manager_id INTO v_root_id FROM employees WHERE id = v_ali_id;
    WITH RECURSIVE subtree AS (
      SELECT id FROM employees WHERE manager_id = v_root_id
      UNION ALL
      SELECT e.id FROM employees e JOIN subtree s ON e.manager_id = s.id
    )
    SELECT array_agg(id) INTO v_result FROM subtree;
  ELSE
    -- Regular employees: self + subordinates via hierarchy
    WITH RECURSIVE subtree AS (
      SELECT id FROM employees WHERE id = v_session.employee_id
      UNION ALL
      SELECT e.id FROM employees e JOIN subtree s ON e.manager_id = s.id
    )
    SELECT array_agg(id) INTO v_result FROM subtree;
  END IF;

  RETURN COALESCE(v_result, '{}'::uuid[]);
END;
$$;

COMMENT ON FUNCTION public.get_visible_employee_ids IS 'إرجاع معرفات الموظفين المرئيين للمستخدم (مع تجاوز الإدارة العليا)';

-- 7. RLS Policies — allow Upper Management full CRUD on all main tables ------
--     These policies let the 4 designated members bypass RLS entirely.
--     All other users are governed by existing RLS policies (if any).
--
--     IMPORTANT: Must GRANT DML to authenticated first, otherwise PostgREST
--     returns 401 before RLS is even evaluated. RLS then restricts which
--     authenticated users can actually perform the operation.
--
--     Also grants USAGE ON SCHEMA app to fix "permission denied for schema app"
--     errors that occur when the RLS policy function stack touches any app schema
--     object under SECURITY INVOKER context.

GRANT USAGE ON SCHEMA app TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

GRANT INSERT, UPDATE, DELETE ON companies TO authenticated;
GRANT INSERT, UPDATE, DELETE ON orders TO authenticated;
GRANT INSERT, UPDATE, DELETE ON customers TO authenticated;
GRANT INSERT, UPDATE, DELETE ON products TO authenticated;
GRANT INSERT, UPDATE, DELETE ON employees TO authenticated;
GRANT INSERT, UPDATE, DELETE ON collections TO authenticated;
GRANT INSERT, UPDATE, DELETE ON returns TO authenticated;
GRANT INSERT, UPDATE, DELETE ON visits TO authenticated;
GRANT INSERT, UPDATE, DELETE ON order_items TO authenticated;
GRANT INSERT, UPDATE, DELETE ON credit_applications TO authenticated;
GRANT INSERT, UPDATE, DELETE ON credit_contracts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON credit_programs TO authenticated;
GRANT INSERT, UPDATE, DELETE ON delivery_tracking TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON unified_locations TO authenticated;

-- Enable Row-Level Security on tables that have UM policies.
-- companies was enabled in 20260627_fix_storefront_companies_and_salesrep_governance.sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_tracking ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_upper_management_by_code(p_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p_code IN ('ADMIN-001', 'WRQ1006', 'WRQ1003', 'WRQ1002', 'WRQ1004');
$$;

COMMENT ON FUNCTION public.is_upper_management_by_code IS 'التحقق من كود الموظف هل هو من الإدارة العليا';

-- Helper function for RLS policies: checks current session employee
-- Uses is_upper_management() without arguments, which resolves auth.uid()
-- through employees.identity_id internally.
CREATE OR REPLACE FUNCTION public.session_is_upper_management()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT public.is_upper_management();
$$;

COMMENT ON FUNCTION public.session_is_upper_management IS 'التحقق مما إذا كان الموظف الحالي من الإدارة العليا لاستخدامه في RLS policies';

-- Companies: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_companies" ON companies;
CREATE POLICY "upper_management_all_companies"
  ON companies
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- Orders: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_orders" ON orders;
CREATE POLICY "upper_management_all_orders"
  ON orders
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- Customers: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_customers" ON customers;
CREATE POLICY "upper_management_all_customers"
  ON customers
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- Products: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_products" ON products;
CREATE POLICY "upper_management_all_products"
  ON products
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- Employees: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_employees" ON employees;
CREATE POLICY "upper_management_all_employees"
  ON employees
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- Collections: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_collections" ON collections;
CREATE POLICY "upper_management_all_collections"
  ON collections
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- Returns: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_returns" ON returns;
CREATE POLICY "upper_management_all_returns"
  ON returns
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- Visits: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_visits" ON visits;
CREATE POLICY "upper_management_all_visits"
  ON visits
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- Order Items: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_order_items" ON order_items;
CREATE POLICY "upper_management_all_order_items"
  ON order_items
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- Credit applications: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_credit_applications" ON credit_applications;
CREATE POLICY "upper_management_all_credit_applications"
  ON credit_applications
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- Credit contracts: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_credit_contracts" ON credit_contracts;
CREATE POLICY "upper_management_all_credit_contracts"
  ON credit_contracts
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- Credit programs: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_credit_programs" ON credit_programs;
CREATE POLICY "upper_management_all_credit_programs"
  ON credit_programs
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- Delivery tracking: allow UM full access
DROP POLICY IF EXISTS "upper_management_all_delivery_tracking" ON delivery_tracking;
CREATE POLICY "upper_management_all_delivery_tracking"
  ON delivery_tracking
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- unified_locations: allow UM full access (table has RLS enabled but no policies)
DROP POLICY IF EXISTS "upper_management_all_unified_locations" ON unified_locations;
CREATE POLICY "upper_management_all_unified_locations"
  ON unified_locations
  USING (public.session_is_upper_management())
  WITH CHECK (public.session_is_upper_management());

-- unified_locations: allow all authenticated users to read
DROP POLICY IF EXISTS "unified_locations_read_all" ON unified_locations;
CREATE POLICY "unified_locations_read_all"
  ON unified_locations
  FOR SELECT
  USING (true);
