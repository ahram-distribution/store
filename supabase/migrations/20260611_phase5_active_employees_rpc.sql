-- Phase 5: RPC to fetch active employees (replaces direct REST API access)
CREATE OR REPLACE FUNCTION public.get_governed_active_employees(
  p_token uuid
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
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'employee_id', e.id,
      'employee_code', e.code,
      'employee_name', e.full_name,
      'employee_manager_id', e.manager_id,
      'role_type', CASE
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er
                      JOIN public.roles r ON r.id = er.role_id
                      WHERE er.employee_id = e.id AND r.name IN ('مدير البيع', 'مدير تنفيذي'))
          THEN 'مدير البيع'
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er
                      JOIN public.roles r ON r.id = er.role_id
                      WHERE er.employee_id = e.id AND r.name IN ('مشرف مبيعات', 'مشرف تنفيذي'))
          THEN 'سوبر فايزر'
        ELSE 'مندوب'
      END,
      'has_team', EXISTS (SELECT 1 FROM public.employees sub WHERE sub.manager_id = e.id)
    )
    ORDER BY e.full_name
  ) INTO v_result
  FROM public.employees e
  WHERE e.is_active = true
    AND e.code NOT IN ('SYS-OWNER', 'ADMIN-001')
    AND NOT EXISTS (
      SELECT 1 FROM public.employee_roles er
      JOIN public.roles r ON r.id = er.role_id
      WHERE er.employee_id = e.id AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة')
    );
  RETURN COALESCE(v_result, jsonb_build_array());
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_governed_active_employees TO anon;
