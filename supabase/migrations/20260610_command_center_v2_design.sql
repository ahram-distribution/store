-- ============================================================================
-- COMMAND CENTER - Phase 2: Required Actions & Module Counts
-- Enhances get_command_center RPC to return required_actions and
-- module_counts for the new design:
--   1. required_actions — Live alert counts (الإجراءات المطلوبة)
--   2. module_counts   — Operational KPI counts for primary module cards
-- ============================================================================

-- ============================================================================
-- Add description to system_modules if not present
-- ============================================================================

-- ============================================================================
-- Enhanced get_command_center RPC
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
  v_required_actions jsonb;
  v_module_counts jsonb;
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

  -- Required actions (live counts for الإجراءات المطلوبة)
  v_required_actions := jsonb_build_array(
    jsonb_build_object(
      'label', 'طلبات تنتظر الاعتماد',
      'count', (SELECT COUNT(*) FROM public.orders WHERE status IN ('submitted', 'reviewing')),
      'link', '/orders/approval-queue'
    ),
    jsonb_build_object(
      'label', 'عملاء تجاوزوا الحد الائتماني',
      'count', (SELECT COUNT(*) FROM public.customer_credit_accounts WHERE outstanding_credit + reserved_credit > credit_limit AND credit_status = 'active'),
      'link', '/credit'
    ),
    jsonb_build_object(
      'label', 'مرتجعات تنتظر القرار',
      'count', (SELECT COUNT(*) FROM public.returns WHERE status IN ('pending', 'inspecting')),
      'link', '/returns'
    ),
    jsonb_build_object(
      'label', 'زيارات لم يتم إنهاؤها',
      'count', (SELECT COUNT(*) FROM public.visits WHERE status = 'active' AND check_out_at IS NULL),
      'link', '/visits'
    ),
    jsonb_build_object(
      'label', 'مندوبين بلا زيارات اليوم',
      'count', (SELECT COUNT(*) FROM public.employees e WHERE is_active = true AND NOT EXISTS (
        SELECT 1 FROM public.visits v WHERE v.employee_id = e.id AND v.created_at >= CURRENT_DATE
      )),
      'link', '/supervisor'
    )
  );

  -- Module operational counts (for primary KPI cards)
  v_module_counts := jsonb_build_object(
    'orders_new',          (SELECT COUNT(*) FROM public.orders WHERE created_at >= CURRENT_DATE),
    'customers_active',    (SELECT COUNT(*) FROM public.customers WHERE is_active = true),
    'visits_active',       (SELECT COUNT(*) FROM public.visits WHERE status = 'active'),
    'credit_due',          (SELECT COUNT(*) FROM public.credit_invoices WHERE status = 'overdue'),
    'employees_active',    (SELECT COUNT(*) FROM public.employees WHERE is_active = true)
  );

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
    'summary', v_summary,
    'required_actions', v_required_actions,
    'module_counts', v_module_counts
  );
END;
$function$;
