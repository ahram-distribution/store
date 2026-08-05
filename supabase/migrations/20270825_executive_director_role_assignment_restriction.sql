-- ============================================================================
-- MIGRATION: Executive Director Role Assignment Restriction
-- DATE: 2026-08-05
-- DESCRIPTION:
--   The Executive Director (الرئيس التنفيذي) may assign ONLY roles below his own.
--   He must NOT:
--     - assign the Executive Director role (الرئيس التنفيذي)     [equal to his own]
--     - assign the Upper Management role (الإدارة العليا)         [higher than his own]
--     - create / promote an employee to الإدارة العليا
--   Enforced on both role-assignment paths:
--     governed_change_employee_role, governed_create_employee
-- ============================================================================

-- STEP 1: Helper - verify the actor may assign the given role.
-- Non-Executive-Director actors keep existing behavior (unrestricted).
CREATE OR REPLACE FUNCTION public.require_assignable_role(
  p_actor_id uuid,
  p_role_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  -- Only Executive Director is restricted
  IF NOT EXISTS (
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = p_actor_id AND r.name = 'الرئيس التنفيذي'
  ) THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Executive Director may not assign a role equal to or higher than his own
  IF EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.id = p_role_id
      AND r.name IN ('الرئيس التنفيذي', 'الإدارة العليا')
  ) THEN
    RETURN jsonb_build_object('error', 'ROLE_ASSIGNMENT_DENIED');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.require_assignable_role IS 'Role assignment authorization: Executive Director may only assign roles below Executive Director (not Executive Director itself, not Upper Management)';

-- STEP 2: Enforce in governed_change_employee_role
CREATE OR REPLACE FUNCTION public.governed_change_employee_role(p_token uuid, p_id uuid, p_role_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_auth jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Rule 2: Hierarchy Authorization
  v_auth := public.require_hierarchy_scope(v_session.employee_id, p_id);
  IF v_auth ? 'error' THEN RETURN v_auth; END IF;

  PERFORM check_capability(p_token, 'employees.manage');

  -- Rule 3: Role Assignment Restriction (Executive Director may only assign lower roles)
  v_auth := public.require_assignable_role(v_session.employee_id, p_role_id);
  IF v_auth ? 'error' THEN RETURN v_auth; END IF;

  -- Remove existing roles
  DELETE FROM public.employee_roles WHERE employee_id = p_id;

  -- Assign new role
  INSERT INTO public.employee_roles (employee_id, role_id, assigned_by)
  VALUES (p_id, p_role_id, v_session.employee_id);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- STEP 3: Enforce in governed_create_employee
CREATE OR REPLACE FUNCTION public.governed_create_employee(p_token uuid, p_full_name character varying, p_phone character varying, p_password character varying DEFAULT NULL::character varying, p_email character varying DEFAULT NULL::character varying, p_role_id uuid DEFAULT NULL::uuid, p_manager_id uuid DEFAULT NULL::uuid, p_address text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_auth jsonb;
  v_employee_id uuid;
  v_identity_id uuid;
  v_code varchar(20);
  v_year integer := EXTRACT(YEAR FROM now());
  v_seq integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Rule 2: Hierarchy Authorization (check proposed manager is in scope)
  v_auth := public.require_hierarchy_scope(v_session.employee_id, p_manager_id);
  IF v_auth ? 'error' THEN RETURN v_auth; END IF;

  PERFORM check_capability(p_token, 'employees.manage');

  -- Rule 3: Role Assignment Restriction (Executive Director may only assign lower roles)
  IF p_role_id IS NOT NULL THEN
    v_auth := public.require_assignable_role(v_session.employee_id, p_role_id);
    IF v_auth ? 'error' THEN RETURN v_auth; END IF;
  END IF;

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

  INSERT INTO public.employees (id, identity_id, code, full_name, email, manager_id, address, is_active)
  VALUES (v_employee_id, v_identity_id, v_code, p_full_name, p_email, p_manager_id, p_address, true);

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
$function$;
