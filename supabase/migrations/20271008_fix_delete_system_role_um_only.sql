-- Allow deleting a system role (دور نظام) ONLY by Upper Management (الإدارة العليا).
-- Previously system roles could never be deleted. Now they can be deleted, but
-- the caller must themselves hold the 'الإدارة العليا' role.

CREATE OR REPLACE FUNCTION public.governed_delete_role(p_token uuid, p_role_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$

DECLARE
  v_session app.sessions;
  v_emp_count integer;
  v_is_system boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'employees.manage') THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  SELECT is_system INTO v_is_system FROM public.roles WHERE id = p_role_id;
  IF v_is_system THEN
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      RETURN jsonb_build_object('error', 'فقط الإدارة العليا يمكنها حذف دور نظام');
    END IF;
  END IF;
  SELECT COUNT(*) INTO v_emp_count FROM public.employee_roles WHERE role_id = p_role_id;
  IF v_emp_count > 0 THEN
    RETURN jsonb_build_object('error', 'لا يمكن حذف الدور، يوجد ' || v_emp_count || ' موظف يستخدمونه');
  END IF;
  DELETE FROM public.role_capabilities WHERE role_id = p_role_id;
  DELETE FROM public.roles WHERE id = p_role_id;
  RETURN jsonb_build_object('success', true, 'deleted_role_id', p_role_id);
END;

$function$;
