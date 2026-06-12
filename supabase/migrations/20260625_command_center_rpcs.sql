-- ============================================================================
-- COMMAND CENTER — Phase 1: RPCs
-- RPCs for the self-maintaining Upper Management Command Center.
--
-- RPCs:
--   1. get_command_center  — Returns all projection data for the C2 screen
--   2. get_module_detail   — Returns detail for a single module
--   3. update_module_owner_field — Owner sets approved/priority/status
--   4. delete_module       — Only allowed for deprecated modules
-- ============================================================================

-- ============================================================================
-- 1. get_command_center
--    Returns everything the Command Center UI needs in one call.
--    Sections: modules, decisions, requests, summary stats
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_command_center(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_is_upper boolean;
  v_modules jsonb;
  v_decisions jsonb;
  v_requests jsonb;
  v_summary jsonb;
  v_production_ready int;
  v_total_modules int;
  v_healthy int;
  v_degraded int;
  v_down int;
  v_broken int;
  v_total_decisions int;
  v_verified_decisions int;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = v_session.employee_id
    AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
  ) INTO v_is_upper;

  IF NOT v_is_upper THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only');
  END IF;

  -- Modules
  SELECT COALESCE(jsonb_agg(m ORDER BY
    CASE WHEN m.status = 'broken' THEN 0
         WHEN m.health_status = 'down' THEN 1
         WHEN m.health_status = 'degraded' THEN 2
         ELSE 3 END,
    m.readiness_score DESC
  ), '[]'::jsonb)
  FROM (
    SELECT id, module_key, display_name, description, icon, status,
           implementation_level, validated_at, broken_since, deprecated_at,
           owner_approved, routes, core_rpcs, core_tables, services, page_dirs,
           pipeline_steps, pipeline_health_pct, last_health_check, health_status,
           readiness_score, business_priority, kb_file,
           decisions_total, decisions_verified, decisions_pct, depends_on,
           created_at, updated_at
    FROM public.system_modules
  ) m
  INTO v_modules;

  -- Decisions
  SELECT COALESCE(jsonb_agg(d ORDER BY d.module_key, d.created_at), '[]'::jsonb)
  FROM (
    SELECT id, module_key, decision_text, rationale, category,
           source_file, source_line, verifiable, verification_method,
           verified, verified_at, failure_reason, decided_at, tags, created_at
    FROM public.owner_decisions
  ) d
  INTO v_decisions;

  -- Requests
  SELECT COALESCE(jsonb_agg(r ORDER BY
    CASE WHEN r.priority = 'critical' THEN 0
         WHEN r.priority = 'high' THEN 1
         WHEN r.priority = 'medium' THEN 2
         WHEN r.priority = 'low' THEN 3
         ELSE 4 END,
    r.approved_at DESC
  ), '[]'::jsonb)
  FROM (
    SELECT id, title, description, status, priority, module_key,
           source_file, source_line, approved_at, depends_on, notes, tags,
           created_at, updated_at
    FROM public.owner_requests
  ) r
  INTO v_requests;

  -- Summary statistics
  SELECT COUNT(*) INTO v_total_modules FROM public.system_modules;

  SELECT COUNT(*) INTO v_healthy
  FROM public.system_modules WHERE health_status = 'healthy';

  SELECT COUNT(*) INTO v_degraded
  FROM public.system_modules WHERE health_status = 'degraded';

  SELECT COUNT(*) INTO v_down
  FROM public.system_modules WHERE health_status = 'down';

  SELECT COUNT(*) INTO v_broken
  FROM public.system_modules WHERE status = 'broken';

  SELECT COUNT(*) INTO v_production_ready
  FROM public.system_modules
  WHERE readiness_score >= 90
    AND owner_approved = true
    AND pipeline_health_pct = 100
    AND health_status = 'healthy';

  SELECT COUNT(*) INTO v_total_decisions FROM public.owner_decisions WHERE verifiable = true;
  SELECT COUNT(*) INTO v_verified_decisions FROM public.owner_decisions WHERE verifiable = true AND verified = true;

  v_summary := jsonb_build_object(
    'total_modules', v_total_modules,
    'healthy', v_healthy,
    'degraded', v_degraded,
    'down', v_down,
    'broken', v_broken,
    'production_ready', v_production_ready,
    'total_verifiable_decisions', v_total_decisions,
    'verified_decisions', v_verified_decisions,
    'decisions_pct', CASE WHEN v_total_decisions > 0
      THEN (v_verified_decisions * 100 / v_total_decisions)
      ELSE 0 END
  );

  RETURN jsonb_build_object(
    'modules', v_modules,
    'decisions', v_decisions,
    'requests', v_requests,
    'summary', v_summary
  );
END;
$function$;

-- ============================================================================
-- 2. get_module_detail
--    Returns all detail for a single module card drill-down.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_module_detail(p_token uuid, p_module_key varchar)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_is_upper boolean;
  v_module jsonb;
  v_decisions jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = v_session.employee_id
    AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
  ) INTO v_is_upper;

  IF NOT v_is_upper THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only');
  END IF;

  -- Module row
  SELECT row_to_json(m)::jsonb FROM (
    SELECT id, module_key, display_name, description, icon, status,
           implementation_level, validated_at, broken_since, deprecated_at,
           owner_approved, routes, core_rpcs, core_tables, services, page_dirs,
           pipeline_steps, pipeline_health_pct, last_health_check, health_status,
           readiness_score, business_priority, kb_file,
           decisions_total, decisions_verified, decisions_pct, depends_on,
           created_at, updated_at
    FROM public.system_modules
    WHERE module_key = p_module_key
  ) m
  INTO v_module;

  IF v_module IS NULL THEN
    RETURN jsonb_build_object('error', 'MODULE_NOT_FOUND', 'module_key', p_module_key);
  END IF;

  -- Decisions for this module
  SELECT COALESCE(jsonb_agg(d ORDER BY d.created_at), '[]'::jsonb)
  FROM (
    SELECT id, decision_text, rationale, category,
           source_file, source_line, verifiable, verification_method,
           verified, verified_at, failure_reason, decided_at, tags, created_at
    FROM public.owner_decisions
    WHERE module_key = p_module_key
  ) d
  INTO v_decisions;

  RETURN jsonb_build_object(
    'module', v_module,
    'decisions', v_decisions
  );
END;
$function$;

-- ============================================================================
-- 3. update_module_owner_field
--    Allows owner to set: owner_approved, business_priority, status override.
--    All other fields are SYNC-ONLY and cannot be changed through this RPC.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_module_owner_field(
    p_token uuid,
    p_module_key varchar,
    p_field varchar,
    p_value text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_is_upper boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = v_session.employee_id
    AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
  ) INTO v_is_upper;

  IF NOT v_is_upper THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only');
  END IF;

  -- Only allow owner-editable fields
  IF p_field NOT IN ('owner_approved', 'business_priority', 'status') THEN
    RETURN jsonb_build_object('error', 'FIELD_NOT_EDITABLE', 'field', p_field,
      'detail', 'Only owner_approved, business_priority, and status can be edited by owner.');
  END IF;

  -- Validate and update with type-safe casting
  IF p_field = 'owner_approved' THEN
    IF p_value NOT IN ('true', 'false') THEN
      RETURN jsonb_build_object('error', 'INVALID_BOOLEAN');
    END IF;
    UPDATE public.system_modules
    SET owner_approved = p_value::boolean
    WHERE module_key = p_module_key;

  ELSIF p_field = 'status' THEN
    IF p_value NOT IN ('planned','partial','implemented','validated','broken','deprecated') THEN
      RETURN jsonb_build_object('error', 'INVALID_STATUS');
    END IF;
    UPDATE public.system_modules
    SET status = p_value
    WHERE module_key = p_module_key;

  ELSIF p_field = 'business_priority' THEN
    IF p_value NOT IN ('critical','high','medium','low','icebox') THEN
      RETURN jsonb_build_object('error', 'INVALID_PRIORITY');
    END IF;
    UPDATE public.system_modules
    SET business_priority = p_value
    WHERE module_key = p_module_key;
  END IF;

  RETURN jsonb_build_object('success', true, 'module_key', p_module_key, 'field', p_field, 'value', p_value);
END;
$function$;

-- ============================================================================
-- 4. delete_module
--    Only allows deleting deprecated modules. This is a safety measure to
--    prevent accidental removal of active modules.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_module(p_token uuid, p_module_key varchar)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_is_upper boolean;
  v_status varchar;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = v_session.employee_id
    AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
  ) INTO v_is_upper;

  IF NOT v_is_upper THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only');
  END IF;

  SELECT status INTO v_status FROM public.system_modules WHERE module_key = p_module_key;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('error', 'MODULE_NOT_FOUND');
  END IF;

  IF v_status != 'deprecated' THEN
    RETURN jsonb_build_object('error', 'CANNOT_DELETE', 'detail', 'Only deprecated modules can be deleted.');
  END IF;

  DELETE FROM public.system_modules WHERE module_key = p_module_key;

  RETURN jsonb_build_object('success', true, 'module_key', p_module_key);
END;
$function$;
