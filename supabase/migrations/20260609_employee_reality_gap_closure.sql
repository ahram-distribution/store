-- ============================================================================
-- EMPLOYEE REALITY GAP CLOSURE
-- ============================================================================

-- ============================================================================
-- 1. Update governed_update_employee — accept p_password
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_update_employee(p_token uuid, p_id uuid, p_full_name varchar, p_email varchar, p_phone varchar, p_address text);

CREATE OR REPLACE FUNCTION public.governed_update_employee(
  p_token uuid,
  p_id uuid,
  p_full_name varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL,
  p_phone varchar DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_password varchar DEFAULT NULL
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

  SELECT identity_id INTO v_identity_id FROM public.employees WHERE id = p_id;
  IF v_identity_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF p_phone IS NOT NULL THEN
    UPDATE public.identities SET phone = p_phone WHERE id = v_identity_id;
  END IF;

  IF p_password IS NOT NULL THEN
    UPDATE public.identities SET password_hash = extensions.crypt(p_password, extensions.gen_salt('bf')) WHERE id = v_identity_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 2. Create get_all_capabilities RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_all_capabilities(p_token uuid)
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
    jsonb_build_object('id', id, 'code', code, 'name', name, 'description', description, 'group', "group")
    ORDER BY "group", name
  ) INTO v_result FROM capabilities;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 3. Create get_employee_capabilities RPC — effective capabilities for employee
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_employee_capabilities(p_token uuid, p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_role_id uuid;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT role_id INTO v_role_id FROM public.employee_roles WHERE employee_id = p_employee_id LIMIT 1;

  WITH role_caps AS (
    SELECT c.id FROM role_capabilities rc JOIN capabilities c ON c.id = rc.capability_id
    WHERE rc.role_id = v_role_id
  ),
  direct_caps AS (
    SELECT c.id, ec.grant_type FROM employee_capabilities ec JOIN capabilities c ON c.id = ec.capability_id
    WHERE ec.employee_id = p_employee_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'code', c.code,
      'name', c.name,
      'group', c."group",
      'from_role', COALESCE(rc.id IS NOT NULL, false),
      'grant_type',
        CASE
          WHEN dc.grant_type IS NOT NULL THEN dc.grant_type::text
          WHEN rc.id IS NOT NULL THEN 'grant'
          ELSE NULL
        END
    )
    ORDER BY c."group", c.name
  ) INTO v_result
  FROM capabilities c
  LEFT JOIN role_caps rc ON rc.id = c.id
  LEFT JOIN direct_caps dc ON dc.id = c.id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 4. Fix governed_update_employee_capabilities — add ::grant_type cast
-- ============================================================================

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

  DELETE FROM public.employee_capabilities WHERE employee_id = p_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_capabilities)
  LOOP
    INSERT INTO public.employee_capabilities (employee_id, capability_id, grant_type, assigned_by)
    VALUES (p_id, (v_item->>'capability_id')::uuid, COALESCE(v_item->>'grant_type', 'grant')::grant_type, v_session.employee_id);
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;
