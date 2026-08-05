-- ============================================================================
-- MIGRATION: Create Executive Director Role (الرئيس التنفيذي)
-- DATE: 2026-08-05
-- DESCRIPTION:
--   Creates new role 'الرئيس التنفيذي' (role key: executive_director) with the
--   SAME capabilities as 'الإدارة العليا' by granting ALL existing capabilities
--   to it via role_capabilities (reuses the existing capability system — no
--   duplicate capability definitions or bypasses).
--
--   VISIBILITY: The role is intentionally NOT added to is_upper_management().
--   Therefore get_visible_employee_ids() / get_governed_employees() /
--   get_dashboard_management() etc. automatically restrict this role to its own
--   hierarchy subtree — the ONLY difference from الإدارة العليا.
--
--   require_hierarchy_scope() is extended so this role may perform hierarchy
--   operations (create/update employees, change roles/managers, change customer
--   ownership) inside its own subtree, same rule as 'مدير البيع'.
-- ============================================================================

-- STEP 1: Create the role and grant ALL capabilities
DO $$
DECLARE
  v_role_id uuid;
BEGIN
  INSERT INTO public.roles (name, description, is_system)
  SELECT 'الرئيس التنفيذي', 'نفس صلاحيات الإدارة العليا مع نطاق رؤية الشجرة التنظيمية الفرعية فقط', true
  WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'الرئيس التنفيذي')
  RETURNING id INTO v_role_id;

  IF v_role_id IS NULL THEN
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'الرئيس التنفيذي';
  END IF;

  INSERT INTO public.role_capabilities (role_id, capability_id)
  SELECT v_role_id, id FROM public.capabilities
  ON CONFLICT DO NOTHING;
END;
$$;

-- STEP 2: Extend require_hierarchy_scope to allow Executive Director
--         to operate inside its own subtree (same rule as Sales Manager).
CREATE OR REPLACE FUNCTION public.require_hierarchy_scope(
  p_actor_id uuid,
  p_target_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_visible_ids uuid[];
  v_in_scope boolean;
BEGIN
  -- Upper Management: unrestricted
  IF public.is_upper_management(p_actor_id) THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Check role: Sales Manager (مدير البيع) or Executive Director (الرئيس التنفيذي)
  -- may operate on hierarchy
  IF NOT EXISTS (
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = p_actor_id AND r.name IN ('مدير البيع', 'الرئيس التنفيذي')
  ) THEN
    RETURN jsonb_build_object('error', 'HIERARCHY_ACCESS_DENIED');
  END IF;

  -- Non-UM roles: target must not be NULL (e.g. creating top-level employee, which requires UM)
  IF p_target_id IS NULL THEN
    RETURN jsonb_build_object('error', 'HIERARCHY_SCOPE_VIOLATION');
  END IF;

  -- Non-UM roles: verify target is inside own subtree
  WITH RECURSIVE subtree AS (
    SELECT id FROM public.employees WHERE id = p_actor_id
    UNION ALL
    SELECT e.id FROM public.employees e JOIN subtree s ON e.manager_id = s.id
  )
  SELECT p_target_id = ANY(array_agg(id)) INTO v_in_scope FROM subtree;

  IF NOT COALESCE(v_in_scope, false) THEN
    RETURN jsonb_build_object('error', 'HIERARCHY_SCOPE_VIOLATION');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.require_hierarchy_scope IS 'Hierarchy authorization: UM unrestricted; Sales Manager / Executive Director operate inside own subtree; others denied';
