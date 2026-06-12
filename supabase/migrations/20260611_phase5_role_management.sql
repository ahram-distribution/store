-- Phase 5: Role Management RPCs
-- Adds governed RPCs for creating, updating, deleting roles and managing role capabilities

-- 1. governed_create_role
CREATE OR REPLACE FUNCTION public.governed_create_role(
  p_token text,
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_role_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token::text = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'employees.manage') THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  INSERT INTO public.roles (name, description, is_system)
  VALUES (p_name, p_description, false)
  RETURNING id INTO v_role_id;
  RETURN jsonb_build_object('id', v_role_id, 'name', p_name);
END;
$function$;

-- 2. governed_update_role
CREATE OR REPLACE FUNCTION public.governed_update_role(
  p_token text,
  p_role_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token::text = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'employees.manage') THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  IF p_name IS NOT NULL THEN
    UPDATE public.roles SET name = p_name WHERE id = p_role_id;
  END IF;
  IF p_description IS NOT NULL THEN
    UPDATE public.roles SET description = p_description WHERE id = p_role_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'role_id', p_role_id);
END;
$function$;

-- 3. governed_delete_role
CREATE OR REPLACE FUNCTION public.governed_delete_role(
  p_token text,
  p_role_id uuid
)
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
  SELECT * INTO v_session FROM app.sessions WHERE token::text = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'employees.manage') THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  SELECT is_system INTO v_is_system FROM public.roles WHERE id = p_role_id;
  IF v_is_system THEN
    RETURN jsonb_build_object('error', 'لا يمكن حذف دور نظام');
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

-- 4. governed_update_role_capabilities
CREATE OR REPLACE FUNCTION public.governed_update_role_capabilities(
  p_token text,
  p_role_id uuid,
  p_capability_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_cap_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token::text = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'employees.manage') THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  DELETE FROM public.role_capabilities WHERE role_id = p_role_id;
  FOREACH v_cap_id IN ARRAY p_capability_ids
  LOOP
    INSERT INTO public.role_capabilities (role_id, capability_id)
    VALUES (p_role_id, v_cap_id);
  END LOOP;
  RETURN jsonb_build_object('success', true, 'role_id', p_role_id, 'capabilities_count', array_length(p_capability_ids, 1));
END;
$function$;

-- 5. get_role_capabilities (returns all capabilities with grant status for a role)
CREATE OR REPLACE FUNCTION public.get_role_capabilities(
  p_token text,
  p_role_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token::text = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_array(); END IF;
  SELECT jsonb_agg(
    jsonb_build_object(
      'capability_id', c.id,
      'code', c.code,
      'name', c.name,
      'group', c.group,
      'is_granted', CASE WHEN rc.id IS NOT NULL THEN true ELSE false END
    )
    ORDER BY c.group, c.name
  ) INTO v_result
  FROM public.capabilities c
  LEFT JOIN public.role_capabilities rc ON rc.capability_id = c.id AND rc.role_id = p_role_id;
  RETURN COALESCE(v_result, jsonb_build_array());
END;
$function$;

-- Grant execution to anon role
GRANT EXECUTE ON FUNCTION public.governed_create_role TO anon;
GRANT EXECUTE ON FUNCTION public.governed_update_role TO anon;
GRANT EXECUTE ON FUNCTION public.governed_delete_role TO anon;
GRANT EXECUTE ON FUNCTION public.governed_update_role_capabilities TO anon;
GRANT EXECUTE ON FUNCTION public.get_role_capabilities TO anon;
