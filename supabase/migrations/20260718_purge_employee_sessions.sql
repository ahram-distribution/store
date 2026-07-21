-- Helper: Delete app.sessions for given employee IDs (bypasses PostgREST schema limitation)
CREATE OR REPLACE FUNCTION public._admin_purge_emp_sessions(p_emp_ids uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app', 'public'
AS $function$
DECLARE v_deleted int;
BEGIN
  DELETE FROM app.sessions WHERE employee_id = ANY(p_emp_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

-- Also recreate the cascade delete function with sessions cleanup included
CREATE OR REPLACE FUNCTION public._admin_hard_delete_employees(p_emp_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app', 'public'
AS $function$
DECLARE
  v_emp_id uuid;
  v_identity_id uuid;
  v_deleted int := 0;
  v_results jsonb[] := '{}';
BEGIN
  -- Clear manager references
  UPDATE public.employees SET manager_id = NULL WHERE manager_id = ANY(p_emp_ids);

  FOREACH v_emp_id IN ARRAY p_emp_ids LOOP
    BEGIN
      -- Delete app.sessions first (blocks employee delete)
      DELETE FROM app.sessions WHERE employee_id = v_emp_id;

      -- Delete employee-specific records already cleaned by REST API
      -- Just delete identity and employee
      SELECT identity_id INTO v_identity_id FROM public.employees WHERE id = v_emp_id;
      DELETE FROM public.identities WHERE id = v_identity_id;
      DELETE FROM public.employees WHERE id = v_emp_id;
      v_deleted := v_deleted + 1;
      v_results := array_append(v_results, jsonb_build_object('id', v_emp_id, 'status', 'deleted'));
    EXCEPTION WHEN OTHERS THEN
      v_results := array_append(v_results, jsonb_build_object('id', v_emp_id, 'status', 'error', 'error', SQLERRM));
    END;
  END LOOP;

  RETURN jsonb_build_object('deleted', v_deleted, 'details', to_jsonb(v_results));
END;
$function$;
