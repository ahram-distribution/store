-- Fix 3 functions that still used old role name checks or hardcoded employee codes
-- instead of public.is_upper_management()

-- 1. get_governed_employees: was checking r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')
--    Now uses public.is_upper_management()
CREATE OR REPLACE FUNCTION public.get_governed_employees(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
  v_is_super_admin boolean; v_subtree_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  SELECT public.is_upper_management(v_session.employee_id) INTO v_is_super_admin;
  IF v_is_super_admin THEN
    SELECT jsonb_agg(jsonb_build_object('id', e.id, 'identity_id', e.identity_id, 'code', e.code, 'full_name', e.full_name, 'email', e.email, 'phone', i.phone, 'manager_id', e.manager_id, 'is_active', e.is_active, 'address', e.address, 'created_at', e.created_at, 'roles', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name)) FROM employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = e.id), '[]'::jsonb), 'role_names', COALESCE((SELECT string_agg(r.name, ', ') FROM employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = e.id), ''), 'direct_capabilities', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'grant_type', ec.grant_type)) FROM employee_capabilities ec JOIN capabilities c ON c.id = ec.capability_id WHERE ec.employee_id = e.id), '[]'::jsonb)) ORDER BY e.created_at DESC) INTO v_result FROM employees e JOIN identities i ON i.id = e.identity_id;
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;
  v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
  SELECT jsonb_agg(jsonb_build_object('id', e.id, 'identity_id', e.identity_id, 'code', e.code, 'full_name', e.full_name, 'email', e.email, 'phone', i.phone, 'manager_id', e.manager_id, 'is_active', e.is_active, 'address', e.address, 'created_at', e.created_at, 'roles', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name)) FROM employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = e.id), '[]'::jsonb), 'role_names', COALESCE((SELECT string_agg(r.name, ', ') FROM employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = e.id), ''), 'direct_capabilities', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'grant_type', ec.grant_type)) FROM employee_capabilities ec JOIN capabilities c ON c.id = ec.capability_id WHERE ec.employee_id = e.id), '[]'::jsonb)) ORDER BY e.created_at DESC) INTO v_result FROM employees e JOIN identities i ON i.id = e.identity_id WHERE e.id = ANY(v_subtree_ids);
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- 2. get_governed_collections (1-param): was checking r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')
--    and had hardcoded WRQ1002/WRQ1004 codes
--    Now uses public.is_upper_management() with clean subtree recursion
CREATE OR REPLACE FUNCTION public.get_governed_collections(p_token uuid)
 RETURNS SETOF public.collections
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN QUERY SELECT c.* FROM public.collections c WHERE c.customer_id = v_session.customer_id;
    RETURN;
  END IF;
  IF public.is_upper_management(v_session.employee_id) THEN
    RETURN QUERY SELECT c.* FROM public.collections c ORDER BY c.created_at DESC;
    RETURN;
  END IF;
  RETURN QUERY SELECT c.* FROM public.collections c
    WHERE c.created_by IN (
      WITH RECURSIVE sub AS (
        SELECT id FROM public.employees WHERE id = v_session.employee_id
        UNION ALL
        SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id
      )
      SELECT id FROM sub
    )
    ORDER BY c.created_at DESC;
END;
$function$;

-- 3. get_governed_collections (3-param): remove DEFAULT values to avoid overload ambiguity
DROP FUNCTION IF EXISTS public.get_governed_collections(p_token uuid, p_page integer, p_page_size integer) CASCADE;
CREATE OR REPLACE FUNCTION public.get_governed_collections(p_token uuid, p_page int, p_page_size int)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[]; v_total bigint; v_offset int;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  v_offset := (p_page - 1) * p_page_size;
  IF v_session.identity_type = 'customer' THEN
    SELECT count(*) INTO v_total FROM public.collections WHERE customer_id = v_session.customer_id;
    RETURN json_build_object('total', v_total, 'data', (SELECT json_agg(row_to_json(c)) FROM (SELECT * FROM public.collections WHERE customer_id = v_session.customer_id ORDER BY created_at DESC LIMIT p_page_size OFFSET v_offset) c));
  END IF;
  SELECT count(*) INTO v_total FROM public.collections co JOIN public.customers cu ON cu.id = co.customer_id WHERE cu.owner_id = ANY(v_visible);
  RETURN json_build_object('total', v_total, 'data', (SELECT json_agg(row_to_json(sub)) FROM (SELECT co.* FROM public.collections co JOIN public.customers cu ON cu.id = co.customer_id WHERE cu.owner_id = ANY(v_visible) ORDER BY co.created_at DESC LIMIT p_page_size OFFSET v_offset) sub));
END;
$function$;

-- 4. governed_review_preparation: was checking r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN','WAREHOUSE_MANAGER')
--    and had hardcoded REP-001, WRQ1002-1006 codes
--    Now uses public.is_upper_management() with WAREHOUSE_MANAGER fallback
CREATE OR REPLACE FUNCTION public.governed_review_preparation(
  p_token uuid, p_preparation_id uuid, p_notes text DEFAULT NULL::text
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_employee_id uuid; v_rec public.preparation_records; v_authorized boolean; v_order_id uuid;
BEGIN
  SELECT employee_id INTO v_employee_id FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_employee_id IS NULL THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  v_authorized := public.is_upper_management(v_employee_id)
    OR EXISTS (SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id
      WHERE er.employee_id = v_employee_id AND r.name = 'WAREHOUSE_MANAGER');
  IF NOT v_authorized THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  SELECT * INTO v_rec FROM public.preparation_records WHERE id = p_preparation_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PREPARATION_NOT_FOUND'); END IF;
  IF v_rec.status != 'completed' THEN RETURN jsonb_build_object('error', 'INVALID_STATUS'); END IF;
  SELECT order_id INTO v_order_id FROM public.preparation_records WHERE id = p_preparation_id;
  UPDATE public.preparation_records
    SET status = 'reviewed', reviewed_by = v_employee_id, reviewed_at = now(),
        notes = COALESCE(p_notes, notes), updated_at = now()
    WHERE id = p_preparation_id;
  UPDATE public.orders SET status = 'ready_for_dispatch', updated_at = now() WHERE id = v_order_id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
    VALUES (v_order_id, 'prepared', 'ready_for_dispatch', v_employee_id, COALESCE(p_notes, 'Preparation reviewed'));
  RETURN jsonb_build_object('id', p_preparation_id, 'status', 'reviewed', 'reviewed_by', v_employee_id,
    'reviewed_at', now(), 'order_status', 'ready_for_dispatch');
END;
$function$;
