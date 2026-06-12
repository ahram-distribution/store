-- ============================================================================
-- 20260608_get_governed_employee_address
-- Add address field to get_governed_employee (singular) RPC
-- Table employees.address already exists (added in 20260608_schema_alignment)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_employee(p_token uuid, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_emp public.employees;
  v_role text;
  v_phone text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'INVALID_SESSION');
  END IF;

  SELECT e.*, i.phone
  INTO v_emp.id, v_emp.identity_id, v_emp.code, v_emp.full_name, v_emp.email,
       v_emp.manager_id, v_emp.is_active, v_emp.created_at, v_emp.updated_at,
       v_emp.address, v_phone
  FROM public.employees e
  LEFT JOIN public.identities i ON i.id = e.identity_id
  WHERE e.id = p_employee_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'NOT_FOUND');
  END IF;

  SELECT r.name INTO v_role
  FROM public.employee_roles er
  JOIN public.roles r ON r.id = er.role_id
  WHERE er.employee_id = p_employee_id
  LIMIT 1;

  RETURN json_build_object(
    'id', v_emp.id,
    'full_name', v_emp.full_name,
    'phone', COALESCE(v_phone, ''),
    'code', v_emp.code,
    'role', COALESCE(v_role, ''),
    'address', COALESCE(v_emp.address, ''),
    'is_active', v_emp.is_active
  );
END;
$function$;
