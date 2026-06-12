-- Phase 2: Sales Hierarchy Cleanup
-- 1. Create مدير البيع role (single approved title)
-- 2. Assign خالد سعيد (REP001) to مدير البيع
-- 3. Update all RPC references: مدير المبيعات/مدير مبيعات → مدير البيع
-- 4. Fix get_employee_current_location (e.name → e.full_name)

-- ============================================================================
-- 1. Create مدير البيع role (if not exists)
-- ============================================================================

INSERT INTO public.roles (name, description, is_system)
SELECT 'مدير البيع', 'مدير البيع — Sales Manager', true
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'مدير البيع');

-- ============================================================================
-- 2. Assign REP001 (خالد سعيد) to مدير البيع
-- ============================================================================

DO $$
DECLARE
  v_role_id uuid;
  v_emp_id uuid;
  v_assigner_id uuid;
BEGIN
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'مدير البيع' LIMIT 1;
  SELECT id INTO v_emp_id FROM public.employees WHERE code = 'REP001' LIMIT 1;
  SELECT id INTO v_assigner_id FROM public.employees WHERE code = 'WRQ1006' LIMIT 1;

  IF v_role_id IS NOT NULL AND v_emp_id IS NOT NULL THEN
    DELETE FROM public.employee_roles WHERE employee_id = v_emp_id;
    INSERT INTO public.employee_roles (employee_id, role_id, assigned_by)
    VALUES (v_emp_id, v_role_id, COALESCE(v_assigner_id, v_emp_id));
  END IF;
END;
$$;

-- ============================================================================
-- 3. Update RPC references by extracting, replacing, and recreating
-- ============================================================================

DO $$
DECLARE
  v_func_def text;
  v_new_def text;
  v_func_names text[] := ARRAY[
    'get_employee_day_timeline',
    'get_employee_day_map',
    'get_employee_workday_history',
    'get_employee_current_location',
    'get_kpi_contributors'
  ];
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY v_func_names
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_func_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;

    IF v_func_def IS NULL THEN
      RAISE WARNING 'Function % not found — skipping', v_name;
      CONTINUE;
    END IF;

    v_new_def := v_func_def;

    -- Replace duplicate role names with the single approved title
    v_new_def := replace(v_new_def, 'مدير مبيعات', 'مدير البيع');
    v_new_def := replace(v_new_def, 'مدير المبيعات', 'مدير البيع');

    -- Fix get_employee_current_location: e.name → e.full_name
    IF v_name = 'get_employee_current_location' THEN
      v_new_def := replace(v_new_def, 'e.name', 'e.full_name');
    END IF;

    -- Ensure CREATE OR REPLACE (pg_get_functiondef outputs CREATE FUNCTION)
    v_new_def := replace(v_new_def, 'CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');

    EXECUTE v_new_def;

    RAISE NOTICE 'Updated function: public.%', v_name;
  END LOOP;
END;
$$;
