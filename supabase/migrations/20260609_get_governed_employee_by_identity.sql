-- ============================================================================
-- 20260609_get_governed_employee_by_identity
-- Lookup employee by identity_id (for orders where created_by/owner_id store
-- identities.id after the 20260605 migration)
--
-- Does NOT change the existing get_governed_employee(p_employee_id) RPC.
-- Does NOT alter any schema.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_employee_by_identity(
    p_token uuid,
    p_identity_id uuid
)
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
  WHERE e.identity_id = p_identity_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'NOT_FOUND');
  END IF;

  SELECT r.name INTO v_role
  FROM public.employee_roles er
  JOIN public.roles r ON r.id = er.role_id
  WHERE er.employee_id = v_emp.id
  LIMIT 1;

  RETURN json_build_object(
    'id', v_emp.id,
    'identity_id', v_emp.identity_id,
    'full_name', v_emp.full_name,
    'phone', COALESCE(v_phone, ''),
    'code', v_emp.code,
    'role', COALESCE(v_role, ''),
    'address', COALESCE(v_emp.address, ''),
    'is_active', v_emp.is_active
  );
END;
$function$;
