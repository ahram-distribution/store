-- Create is_upper_management function
CREATE OR REPLACE FUNCTION public.is_upper_management(p_employee_id UUID DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $_$
DECLARE
  v_employee_id UUID;
  v_emp_code text;
BEGIN
  IF p_employee_id IS NOT NULL THEN
    v_employee_id := p_employee_id;
  ELSE
    SELECT id INTO v_employee_id FROM employees WHERE identity_id = auth.uid();
    IF v_employee_id IS NULL THEN RETURN false; END IF;
  END IF;
  SELECT code INTO v_emp_code FROM employees WHERE id = v_employee_id;
  IF v_emp_code IN ('ADMIN-001', 'WRQ1006', 'WRQ1003', 'WRQ1002', 'WRQ1004') THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM employee_roles er
    JOIN roles r ON r.id = er.role_id
    WHERE er.employee_id = v_employee_id
    AND r.name IN ('SUPER_ADMIN', 'ADMIN', 'CHAIRMAN', 'EXECUTIVE_MANAGER')
  );
END;
$_$;

-- Create session_is_upper_management for RLS/RPC use
CREATE OR REPLACE FUNCTION public.session_is_upper_management()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $_$
  SELECT public.is_upper_management();
$_$;

-- Update check_capability to allow UM bypass
CREATE OR REPLACE FUNCTION public.check_capability(p_token uuid, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $_$
DECLARE
  v_session app.sessions;
  v_cap_id uuid;
  v_role_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN false; END IF;

  IF public.is_upper_management(v_session.employee_id) THEN
    RETURN true;
  END IF;

  SELECT id INTO v_cap_id FROM capabilities WHERE code = p_code;
  IF v_cap_id IS NULL THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM employee_capabilities
    WHERE employee_id = v_session.employee_id AND capability_id = v_cap_id AND grant_type = 'grant'
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM employee_capabilities
    WHERE employee_id = v_session.employee_id AND capability_id = v_cap_id AND grant_type = 'deny'
  ) THEN RETURN false; END IF;

  SELECT array_agg(role_id) INTO v_role_ids FROM employee_roles WHERE employee_id = v_session.employee_id;
  IF v_role_ids IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM role_capabilities WHERE role_id = ANY(v_role_ids) AND capability_id = v_cap_id
  );
END;
$_$;
