-- ============================================================
-- Migration: 20270715d_governance_rule2_hierarchy_authorization
-- ============================================================
-- Rule 2: Hierarchy Authorization
--
-- Before ANY hierarchy operation is executed, verify that the
-- requested operation is inside the caller's allowed hierarchy.
--
-- Upper Management (الإدارة العليا): unrestricted
-- Sales Manager (مدير البيع):       operate only inside own subtree
-- All other roles:                  no hierarchy operations
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. Helper function: require_hierarchy_scope
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.require_hierarchy_scope(
  p_actor_id uuid,
  p_target_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_visible_ids uuid[];
  v_in_scope boolean;
BEGIN
  -- Upper Management: unrestricted
  IF public.is_upper_management(p_actor_id) THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Check role: only Sales Manager (مدير البيع) may operate on hierarchy
  IF NOT EXISTS (
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = p_actor_id AND r.name = 'مدير البيع'
  ) THEN
    RETURN jsonb_build_object('error', 'HIERARCHY_ACCESS_DENIED');
  END IF;

  -- Sales Manager: target must not be NULL (e.g. creating top-level employee, which requires UM)
  IF p_target_id IS NULL THEN
    RETURN jsonb_build_object('error', 'HIERARCHY_SCOPE_VIOLATION');
  END IF;

  -- Sales Manager: verify target is inside own subtree
  WITH RECURSIVE subtree AS (
    SELECT id FROM public.employees WHERE id = p_actor_id
    UNION ALL
    SELECT e.id FROM public.employees e JOIN subtree s ON e.manager_id = s.id
  )
  SELECT p_target_id = ANY(array_agg(id)) INTO v_in_scope FROM subtree;

  IF NOT COALESCE(v_in_scope, false) THEN
    RETURN jsonb_build_object('error', 'HIERARCHY_SCOPE_VIOLATION');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 2. governed_change_employee_manager
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.governed_change_employee_manager(
  p_token uuid,
  p_id uuid,
  p_manager_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
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

  -- Prevent self-manager
  IF p_id = p_manager_id THEN RETURN jsonb_build_object('error', 'SELF_MANAGER'); END IF;

  UPDATE public.employees SET manager_id = p_manager_id, updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 3. governed_change_employee_role
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.governed_change_employee_role(
  p_token uuid,
  p_id uuid,
  p_role_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
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

  -- Remove existing roles
  DELETE FROM public.employee_roles WHERE employee_id = p_id;

  -- Assign new role
  INSERT INTO public.employee_roles (employee_id, role_id, assigned_by)
  VALUES (p_id, p_role_id, v_session.employee_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 4. governed_create_employee
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.governed_create_employee(
  p_token uuid,
  p_full_name character varying,
  p_phone character varying,
  p_password character varying DEFAULT NULL::character varying,
  p_email character varying DEFAULT NULL::character varying,
  p_role_id uuid DEFAULT NULL::uuid,
  p_manager_id uuid DEFAULT NULL::uuid,
  p_address text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
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
$$;

-- ──────────────────────────────────────────────────────────────
-- 5. governed_update_employee_capabilities
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.governed_update_employee_capabilities(
  p_token uuid,
  p_id uuid,
  p_capabilities jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_auth jsonb;
  v_item jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Rule 2: Hierarchy Authorization
  v_auth := public.require_hierarchy_scope(v_session.employee_id, p_id);
  IF v_auth ? 'error' THEN RETURN v_auth; END IF;

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

-- ──────────────────────────────────────────────────────────────
-- 6. governed_change_customer_ownership
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.governed_change_customer_ownership(
  p_token uuid,
  p_customer_id uuid,
  p_new_owner_id uuid,
  p_reason text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_auth jsonb;
  v_prev_owner_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT owner_id INTO v_prev_owner_id FROM public.customers WHERE id = p_customer_id;
  IF v_prev_owner_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  -- Rule 2: Hierarchy Authorization (both owners must be in scope)
  v_auth := public.require_hierarchy_scope(v_session.employee_id, v_prev_owner_id);
  IF v_auth ? 'error' THEN RETURN v_auth; END IF;
  v_auth := public.require_hierarchy_scope(v_session.employee_id, p_new_owner_id);
  IF v_auth ? 'error' THEN RETURN v_auth; END IF;

  PERFORM check_capability(p_token, 'customers.manage');

  -- Record ownership history
  INSERT INTO public.customer_ownership_history (customer_id, previous_owner_id, new_owner_id, changed_by, reason)
  VALUES (p_customer_id, v_prev_owner_id, p_new_owner_id, v_session.employee_id, p_reason);

  -- Update ownership
  UPDATE public.customers SET owner_id = p_new_owner_id, updated_at = now() WHERE id = p_customer_id;

  RETURN jsonb_build_object('success', true, 'previous_owner_id', v_prev_owner_id);
END;
$$;
