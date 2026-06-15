-- ============================================================================
-- MIGRATION: Unify Upper Management into a Single Role
-- DATE: 2026-07-20
-- DESCRIPTION:
--   Creates unified 'الإدارة العليا' role with ALL capabilities.
--   Transfers ياسر, محمد, علي, محمود to the new role.
--   Eliminates ALL hardcoded employee codes and old role name checks.
--   Single source of truth: public.is_upper_management() checks only the
--   new role name. All ~68 affected functions updated to use it.
-- ============================================================================

-- ============================================================================
-- STEP 1: Create the unified role and grant ALL capabilities
-- ============================================================================
DO $$
DECLARE
  v_role_id uuid;
BEGIN
  INSERT INTO public.roles (name, description, is_system)
  SELECT 'الإدارة العليا', 'أعلى سلطة في النظام — جميع الصلاحيات الحالية والمستقبلية', true
  WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'الإدارة العليا')
  RETURNING id INTO v_role_id;

  IF v_role_id IS NULL THEN
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'الإدارة العليا';
  END IF;

  INSERT INTO public.role_capabilities (role_id, capability_id)
  SELECT v_role_id, id FROM public.capabilities
  ON CONFLICT DO NOTHING;
END;
$$;

-- ============================================================================
-- STEP 2: Transfer employees to the new role
-- ============================================================================
DO $$
DECLARE
  v_role_id uuid;
  v_emp_ids uuid[];
BEGIN
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'الإدارة العليا';

  SELECT array_agg(e.id) INTO v_emp_ids
  FROM public.employees e
  WHERE e.code IN ('WRQ1002', 'WRQ1003', 'WRQ1004', 'WRQ1006', 'ADMIN-001');

  UPDATE public.employee_roles
  SET role_id = v_role_id
  WHERE employee_id = ANY(v_emp_ids);
END;
$$;

-- ============================================================================
-- STEP 3: Delete employee_capabilities for transferred employees
--          (no longer needed — the role grants ALL capabilities)
-- ============================================================================
DELETE FROM public.employee_capabilities
WHERE employee_id IN (
  SELECT id FROM public.employees
  WHERE code IN ('WRQ1002', 'WRQ1003', 'WRQ1004', 'WRQ1006', 'ADMIN-001')
);

-- ============================================================================
-- STEP 4: Rewrite is_upper_management — checks ONLY the unified role name
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_upper_management(p_employee_id UUID DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_employee_id UUID;
BEGIN
  IF p_employee_id IS NOT NULL THEN
    v_employee_id := p_employee_id;
  ELSE
    SELECT id INTO v_employee_id FROM employees WHERE identity_id = auth.uid();
    IF v_employee_id IS NULL THEN RETURN false; END IF;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM employee_roles er
    JOIN roles r ON r.id = er.role_id
    WHERE er.employee_id = v_employee_id
    AND r.name = 'الإدارة العليا'
  );
END;
$$;

COMMENT ON FUNCTION public.is_upper_management IS 'التحقق مما إذا كان الموظف من الإدارة العليا — بالاعتماد فقط على دور الإدارة العليا';

-- Drop the old hardcoded-code function
DROP FUNCTION IF EXISTS public.is_upper_management_by_code;

-- session_is_upper_management stays the same (defers to is_upper_management)
CREATE OR REPLACE FUNCTION public.session_is_upper_management()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT public.is_upper_management();
$$;

-- ============================================================================
-- STEP 5: Rewrite get_visible_employee_ids — remove WRQ1002/WRQ1004 fallback
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_visible_employee_ids(p_token uuid)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN '{}'::uuid[]; END IF;
  IF v_session.identity_type = 'customer' THEN RETURN '{}'::uuid[]; END IF;

  IF public.is_upper_management(v_session.employee_id) THEN
    SELECT array_agg(id) INTO v_result FROM employees;
    RETURN COALESCE(v_result, '{}'::uuid[]);
  END IF;

  WITH RECURSIVE subtree AS (
    SELECT id FROM employees WHERE id = v_session.employee_id
    UNION ALL
    SELECT e.id FROM employees e JOIN subtree s ON e.manager_id = s.id
  )
  SELECT array_agg(id) INTO v_result FROM subtree;

  RETURN COALESCE(v_result, '{}'::uuid[]);
END;
$$;

-- ============================================================================
-- STEP 6: Rewrite app.get_visibility_ids — remove hardcoded names
-- ============================================================================
CREATE OR REPLACE FUNCTION app.get_visibility_ids()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
AS $$
  DECLARE v_emp_id uuid := app.current_employee_id();
  BEGIN
    IF public.is_upper_management(v_emp_id) THEN
      RETURN app.get_subtree_ids(NULL);
    END IF;
    RETURN app.get_subtree_ids();
  END;
  $$;

-- ============================================================================
-- STEP 7: DASHBOARD MODULE
-- ============================================================================

-- 7a: get_upper_management_dashboard — use is_upper_management instead of AR role check
CREATE OR REPLACE FUNCTION public.get_upper_management_dashboard(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_new_orders int;
  v_pending_orders int;
  v_active_visits int;
  v_today_visits int;
  v_new_customers int;
  v_stagnant_customers int;
  v_daily_sales numeric;
  v_monthly_sales numeric;
  v_best_rep jsonb;
  v_weakest_rep jsonb;
  v_total_customers int;
  v_total_reps int;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only');
  END IF;

  SELECT COUNT(*) INTO v_new_orders FROM public.orders WHERE created_at >= CURRENT_DATE;
  SELECT COUNT(*) INTO v_pending_orders FROM public.orders WHERE status IN ('draft', 'reviewing', 'submitted');
  SELECT COUNT(*) INTO v_active_visits FROM public.visits WHERE status = 'active';
  SELECT COUNT(*) INTO v_today_visits FROM public.visits WHERE created_at >= CURRENT_DATE;
  SELECT COUNT(*) INTO v_new_customers FROM public.customers WHERE created_at >= date_trunc('month', CURRENT_DATE);
  SELECT COUNT(*) INTO v_stagnant_customers FROM public.customers WHERE is_active = true AND NOT EXISTS (SELECT 1 FROM public.orders WHERE customer_id = customers.id AND created_at >= CURRENT_DATE - INTERVAL '90 days');
  SELECT COALESCE(SUM(total_amount), 0) INTO v_daily_sales FROM public.orders WHERE status NOT IN ('draft', 'cancelled') AND submitted_at >= CURRENT_DATE;
  SELECT COALESCE(SUM(total_amount), 0) INTO v_monthly_sales FROM public.orders WHERE status NOT IN ('draft', 'cancelled') AND submitted_at >= date_trunc('month', CURRENT_DATE);
  SELECT COUNT(*) INTO v_total_customers FROM public.customers;
  SELECT COUNT(*) INTO v_total_reps FROM public.employees;

  SELECT jsonb_build_object('id', e.id, 'code', e.code, 'name', e.full_name, 'total_sales', COALESCE(SUM(o.total_amount), 0))
  INTO v_best_rep
  FROM public.employees e
  JOIN public.orders o ON o.owner_id IN (e.id, e.identity_id)
  WHERE o.status NOT IN ('draft', 'cancelled')
    AND o.submitted_at >= date_trunc('month', CURRENT_DATE)
  GROUP BY e.id, e.code, e.full_name
  ORDER BY COALESCE(SUM(o.total_amount), 0) DESC LIMIT 1;

  SELECT jsonb_build_object('id', e.id, 'code', e.code, 'name', e.full_name, 'total_sales', COALESCE(SUM(o.total_amount), 0))
  INTO v_weakest_rep
  FROM public.employees e
  JOIN public.orders o ON o.owner_id IN (e.id, e.identity_id)
  WHERE o.status NOT IN ('draft', 'cancelled')
    AND o.submitted_at >= date_trunc('month', CURRENT_DATE)
  GROUP BY e.id, e.code, e.full_name
  ORDER BY COALESCE(SUM(o.total_amount), 0) ASC LIMIT 1;

  RETURN jsonb_build_object(
    'new_orders', COALESCE(v_new_orders, 0),
    'pending_orders', COALESCE(v_pending_orders, 0),
    'active_visits', COALESCE(v_active_visits, 0),
    'today_visits', COALESCE(v_today_visits, 0),
    'new_customers', COALESCE(v_new_customers, 0),
    'stagnant_customers', COALESCE(v_stagnant_customers, 0),
    'daily_sales', COALESCE(v_daily_sales, 0),
    'monthly_sales', COALESCE(v_monthly_sales, 0),
    'best_rep', v_best_rep,
    'weakest_rep', v_weakest_rep,
    'total_customers', COALESCE(v_total_customers, 0),
    'total_reps', COALESCE(v_total_reps, 0)
  );
END;
$function$;

-- 7b: get_dashboard_management — use is_upper_management + get_visible_employee_ids
CREATE OR REPLACE FUNCTION public.get_dashboard_management(p_token uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session app.sessions; v_visible uuid[];
  v_total_orders int; v_pending_orders int; v_approved_orders int;
  v_total_customers int; v_active_visits int; v_pending_collections int;
  v_pending_returns int; v_today_orders int; v_today_visits int;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type = 'customer' THEN
    SELECT count(*) INTO v_total_orders FROM public.orders WHERE customer_id = v_session.customer_id;
    SELECT count(*) INTO v_pending_orders FROM public.orders WHERE customer_id = v_session.customer_id AND status IN ('draft','reviewing','submitted');
    SELECT count(*) INTO v_approved_orders FROM public.orders WHERE customer_id = v_session.customer_id AND status = 'approved';
    SELECT count(*) INTO v_total_customers FROM public.customers WHERE id = v_session.customer_id;
    SELECT count(*) INTO v_active_visits FROM public.visits WHERE customer_id = v_session.customer_id AND status = 'active';
    SELECT count(*) INTO v_pending_collections FROM public.collections WHERE customer_id = v_session.customer_id AND status = 'pending';
    SELECT count(*) INTO v_pending_returns FROM public.returns WHERE customer_id = v_session.customer_id AND status = 'pending';
    SELECT count(*) INTO v_today_orders FROM public.orders WHERE customer_id = v_session.customer_id AND created_at >= CURRENT_DATE;
    SELECT count(*) INTO v_today_visits FROM public.visits WHERE customer_id = v_session.customer_id AND created_at >= CURRENT_DATE;
  ELSE
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
    SELECT count(*) INTO v_total_orders FROM public.orders WHERE owner_id = ANY(v_visible);
    SELECT count(*) INTO v_pending_orders FROM public.orders WHERE owner_id = ANY(v_visible) AND status IN ('draft','reviewing','submitted');
    SELECT count(*) INTO v_approved_orders FROM public.orders WHERE owner_id = ANY(v_visible) AND status = 'approved';
    SELECT count(*) INTO v_total_customers FROM public.customers WHERE owner_id = ANY(v_visible);
    SELECT count(*) INTO v_active_visits FROM public.visits WHERE employee_id = ANY(v_visible) AND status = 'active';
    SELECT count(*) INTO v_pending_collections FROM public.collections WHERE created_by = ANY(v_visible) AND status = 'pending';
    SELECT count(*) INTO v_pending_returns FROM public.returns WHERE created_by = ANY(v_visible) AND status = 'pending';
    SELECT count(*) INTO v_today_orders FROM public.orders WHERE owner_id = ANY(v_visible) AND created_at >= CURRENT_DATE;
    SELECT count(*) INTO v_today_visits FROM public.visits WHERE employee_id = ANY(v_visible) AND created_at >= CURRENT_DATE;
  END IF;
  RETURN json_build_object('total_orders', COALESCE(v_total_orders, 0), 'pending_orders', COALESCE(v_pending_orders, 0), 'approved_orders', COALESCE(v_approved_orders, 0), 'total_customers', COALESCE(v_total_customers, 0), 'active_visits', COALESCE(v_active_visits, 0), 'pending_collections', COALESCE(v_pending_collections, 0), 'pending_returns', COALESCE(v_pending_returns, 0), 'today_orders', COALESCE(v_today_orders, 0), 'today_visits', COALESCE(v_today_visits, 0));
END;
$function$;

-- 7c: get_dashboard_transport
CREATE OR REPLACE FUNCTION public.get_dashboard_transport(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[]; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error','INVALID_SESSION'); END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN jsonb_build_object('ready_delivery',0,'out_delivery',0,'delivery_queue',0,'collection_queue',0,'delivered_today',0,'failed',0,'pending_collections',0,'overdue_collections',0);
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  SELECT jsonb_build_object(
    'ready_delivery', (SELECT count(*) FROM public.orders WHERE status = 'approved' AND owner_id = ANY(v_visible) AND NOT EXISTS (SELECT 1 FROM delivery_tracking WHERE order_id = orders.id)),
    'out_delivery', (SELECT count(*) FROM public.delivery_tracking WHERE status IN ('assigned','out_for_delivery')),
    'delivery_queue', (SELECT count(*) FROM public.delivery_tracking WHERE status NOT IN ('delivered','failed','returned')),
    'collection_queue', (SELECT count(*) FROM public.collections WHERE status = 'pending' AND owner_id = ANY(v_visible)),
    'delivered_today', (SELECT count(*) FROM public.delivery_tracking WHERE status = 'delivered' AND completed_at >= CURRENT_DATE),
    'failed', (SELECT count(*) FROM public.delivery_tracking WHERE status IN ('failed','returned')),
    'pending_collections', (SELECT count(*) FROM public.collections c JOIN public.customers cu ON cu.id = c.customer_id WHERE c.status = 'pending' AND cu.owner_id = ANY(v_visible)),
    'overdue_collections', (SELECT count(*) FROM public.collections c JOIN public.customers cu ON cu.id = c.customer_id WHERE c.status = 'pending' AND c.created_at < now() - interval '30 days' AND cu.owner_id = ANY(v_visible))
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- 7d: get_dashboard_warehouse
CREATE OR REPLACE FUNCTION public.get_dashboard_warehouse(p_token uuid)
 RETURNS TABLE(counter text, value bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, app, extensions, pg_catalog
AS $function$
DECLARE v_session app.sessions; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_session.employee_id IS NULL THEN RETURN; END IF;
  IF public.is_upper_management(v_session.employee_id) THEN
    RETURN QUERY
      SELECT 'waiting_preparation'::text, COUNT(*)::bigint FROM public.orders o WHERE o.status = 'approved' AND NOT EXISTS (SELECT 1 FROM public.preparation_records pr WHERE pr.order_id = o.id)
      UNION ALL SELECT 'in_preparation'::text, COUNT(*)::bigint FROM public.preparation_records WHERE status = 'in_progress'
      UNION ALL SELECT 'ready_for_delivery'::text, COUNT(*)::bigint FROM public.preparation_records WHERE status = 'reviewed'
      UNION ALL SELECT 'prepared_today'::text, COUNT(*)::bigint FROM public.preparation_records WHERE completed_at >= CURRENT_DATE
      UNION ALL SELECT 'delayed_preps'::text, COUNT(*)::bigint FROM public.preparation_records WHERE status = 'in_progress' AND started_at < now() - interval '24 hours';
    RETURN;
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  RETURN QUERY
    SELECT 'waiting_preparation'::text, COUNT(*)::bigint FROM public.orders o WHERE o.status = 'approved' AND o.owner_id = ANY(v_visible) AND NOT EXISTS (SELECT 1 FROM public.preparation_records pr WHERE pr.order_id = o.id)
    UNION ALL SELECT 'in_preparation'::text, COUNT(*)::bigint FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id WHERE pr.status = 'in_progress' AND o.owner_id = ANY(v_visible)
    UNION ALL SELECT 'ready_for_delivery'::text, COUNT(*)::bigint FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id WHERE pr.status = 'reviewed' AND o.owner_id = ANY(v_visible)
    UNION ALL SELECT 'prepared_today'::text, COUNT(*)::bigint FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id WHERE pr.completed_at >= CURRENT_DATE AND o.owner_id = ANY(v_visible)
    UNION ALL SELECT 'delayed_preps'::text, COUNT(*)::bigint FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id WHERE pr.status = 'in_progress' AND pr.started_at < now() - interval '24 hours' AND o.owner_id = ANY(v_visible);
END;
$function$;

-- 7e: get_delivery_dashboard_stats
CREATE OR REPLACE FUNCTION public.get_delivery_dashboard_stats(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[]; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error','INVALID_SESSION'); END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN jsonb_build_object('ready_delivery',0,'assigned',0,'out_for_delivery',0,'delivered_today',0,'failed',0,'pending_collections',0,'overdue_collections',0);
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  SELECT jsonb_build_object(
    'ready_delivery', (SELECT count(*) FROM public.orders WHERE status = 'approved' AND owner_id = ANY(v_visible) AND NOT EXISTS (SELECT 1 FROM delivery_tracking WHERE order_id = orders.id)),
    'assigned', (SELECT count(*) FROM public.delivery_tracking WHERE status = 'assigned'),
    'out_for_delivery', (SELECT count(*) FROM public.delivery_tracking WHERE status = 'out_for_delivery'),
    'delivered_today', (SELECT count(*) FROM public.delivery_tracking WHERE status = 'delivered' AND completed_at >= CURRENT_DATE),
    'failed', (SELECT count(*) FROM public.delivery_tracking WHERE status IN ('failed','returned')),
    'pending_collections', (SELECT count(*) FROM public.collections WHERE status = 'pending' AND owner_id = ANY(v_visible)),
    'overdue_collections', (SELECT count(*) FROM public.collections WHERE status = 'pending' AND created_at < now() - interval '30 days')
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- 7f: get_credit_dashboard_stats
CREATE OR REPLACE FUNCTION public.get_credit_dashboard_stats(p_token uuid)
 RETURNS TABLE(new_apps bigint, under_review bigint, docs_pending bigint, approved bigint, rejected bigint, suspended bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN QUERY SELECT COUNT(*) FILTER(WHERE a.status = 'submitted'), COUNT(*) FILTER(WHERE a.status = 'under_review'), COUNT(*) FILTER(WHERE a.status IN ('submitted','under_review') AND a.doc_confirmed_by IS NULL), COUNT(*) FILTER(WHERE a.status = 'approved'), COUNT(*) FILTER(WHERE a.status = 'rejected'), COUNT(*) FILTER(WHERE a.status = 'suspended') FROM public.credit_applications a WHERE a.customer_id = v_session.customer_id;
    RETURN;
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  IF public.is_upper_management(v_session.employee_id) THEN
    RETURN QUERY SELECT COUNT(*) FILTER(WHERE a.status = 'submitted'), COUNT(*) FILTER(WHERE a.status = 'under_review'), COUNT(*) FILTER(WHERE a.status IN ('submitted','under_review') AND a.doc_confirmed_by IS NULL), COUNT(*) FILTER(WHERE a.status = 'approved'), COUNT(*) FILTER(WHERE a.status = 'rejected'), COUNT(*) FILTER(WHERE a.status = 'suspended') FROM public.credit_applications a;
  ELSE
    RETURN QUERY SELECT COUNT(*) FILTER(WHERE a.status = 'submitted'), COUNT(*) FILTER(WHERE a.status = 'under_review'), COUNT(*) FILTER(WHERE a.status IN ('submitted','under_review') AND a.doc_confirmed_by IS NULL), COUNT(*) FILTER(WHERE a.status = 'approved'), COUNT(*) FILTER(WHERE a.status = 'rejected'), COUNT(*) FILTER(WHERE a.status = 'suspended') FROM public.credit_applications a JOIN public.customers c ON c.id = a.customer_id WHERE c.owner_id = ANY(v_visible);
  END IF;
END;
$function$;

-- 7g: get_customer_sales_ranking
CREATE OR REPLACE FUNCTION public.get_customer_sales_ranking(p_token uuid)
 RETURNS TABLE(customer_id uuid, code character varying, company_name character varying, total_purchases numeric, order_count bigint, customer_ranking bigint, rep_customer_ranking bigint, owner_id uuid, followup_priority_score numeric, potential_revenue_score numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_identity_type text; v_identity_id uuid; v_employee_id uuid; v_visible uuid[];
BEGIN
  SELECT s.identity_type, s.identity_id, s.employee_id INTO v_identity_type, v_identity_id, v_employee_id FROM app.sessions s WHERE s.token = p_token AND s.expires_at > now(); IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  RETURN QUERY WITH visible_customers AS (
    SELECT c.id, c.code, c.company_name, c.owner_id FROM public.customers c
    WHERE (v_identity_type = 'customer' AND c.identity_id = v_identity_id) OR (c.owner_id = ANY(v_visible))
  ), intervals AS (
    SELECT subq.customer_id, AVG(subq.days)::numeric AS avg_interval FROM (
      SELECT o2.customer_id, EXTRACT(DAY FROM (o2.submitted_at - LAG(o2.submitted_at) OVER (PARTITION BY o2.customer_id ORDER BY o2.submitted_at)))::numeric AS days FROM public.orders o2
      WHERE o2.status IN ('submitted','approved') AND o2.submitted_at IS NOT NULL
    ) subq WHERE subq.days IS NOT NULL AND subq.days > 0 GROUP BY subq.customer_id
  ), order_stats AS (
    SELECT o.customer_id, COALESCE(SUM(o.total_amount), 0) AS total_purchases, COUNT(*)::bigint AS order_count, MAX(o.submitted_at) AS last_order_date FROM public.orders o
    WHERE o.status IN ('submitted','approved') GROUP BY o.customer_id
  ), ranked AS (
    SELECT vc.*, COALESCE(s.total_purchases, 0) AS tp, COALESCE(s.order_count, 0) AS oc, s.last_order_date, i.avg_interval,
      ROW_NUMBER() OVER (ORDER BY COALESCE(s.total_purchases, 0) DESC) AS customer_rank,
      ROW_NUMBER() OVER (PARTITION BY vc.owner_id ORDER BY COALESCE(s.total_purchases, 0) DESC) AS rep_rank
    FROM visible_customers vc
    LEFT JOIN order_stats s ON s.customer_id = vc.id
    LEFT JOIN intervals i ON i.customer_id = vc.id
  )
  SELECT r.id, r.code, r.company_name, r.tp, r.oc, r.customer_rank, r.rep_rank, r.owner_id,
    ROUND(COALESCE(CASE WHEN r.last_order_date IS NOT NULL THEN (EXTRACT(DAY FROM now() - r.last_order_date) * 1.0) + (30.0 / NULLIF(r.oc::numeric, 0)) + (r.tp / 1000.0) ELSE 999 END, 0), 2),
    ROUND(CASE WHEN r.last_order_date IS NOT NULL AND COALESCE(r.avg_interval, 0) > 0 THEN r.tp * GREATEST(0, EXTRACT(DAY FROM now() - r.last_order_date) / r.avg_interval) ELSE r.tp * 0.5 END, 2)
  FROM ranked r ORDER BY r.customer_rank;
END;
$function$;

-- ============================================================================
-- STEP 8: COLLECTIONS & RETURNS MODULE
-- ============================================================================

-- 8a: get_collection_followup_queue
CREATE OR REPLACE FUNCTION public.get_collection_followup_queue(p_token uuid)
 RETURNS TABLE(id uuid, customer_name character varying, amount numeric, method character varying, status character varying, collected_at timestamp with time zone, created_at timestamp with time zone, owner_name character varying, days_since_creation bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN QUERY SELECT c.id, cu.company_name, c.amount, c.method, c.status, c.collected_at, c.created_at, NULL::varchar, EXTRACT(DAY FROM now() - c.created_at)::bigint FROM public.collections c JOIN public.customers cu ON cu.id = c.customer_id WHERE c.customer_id = v_session.customer_id ORDER BY c.created_at DESC;
    RETURN;
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  RETURN QUERY SELECT c.id, cu.company_name, c.amount, c.method, c.status, c.collected_at, c.created_at, e.code, EXTRACT(DAY FROM now() - c.created_at)::bigint FROM public.collections c JOIN public.customers cu ON cu.id = c.customer_id LEFT JOIN public.employees e ON e.id = cu.owner_id WHERE cu.owner_id = ANY(v_visible) ORDER BY c.created_at DESC;
END;
$function$;

-- 8b: get_governed_collections
CREATE OR REPLACE FUNCTION public.get_governed_collections(p_token uuid, p_page int DEFAULT 1, p_page_size int DEFAULT 50)
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

-- 8c: governed_approve_return
CREATE OR REPLACE FUNCTION public.governed_approve_return(p_token uuid, p_return_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  IF NOT public.is_upper_management(v_session.employee_id) AND NOT EXISTS (SELECT 1 FROM public.returns r JOIN public.customers c ON c.id = r.customer_id WHERE r.id = p_return_id AND c.owner_id = ANY(v_visible)) THEN
    RETURN json_build_object('error', 'FORBIDDEN');
  END IF;
  UPDATE public.returns SET status = 'approved' WHERE id = p_return_id;
  RETURN json_build_object('success', true);
END;
$function$;

-- ============================================================================
-- STEP 9: CUSTOMER ANALYTICS MODULE
-- ============================================================================

-- 9a: get_customer_analytics_list
CREATE OR REPLACE FUNCTION public.get_customer_analytics_list(p_token uuid)
 RETURNS TABLE(customer_id uuid, code character varying, company_name character varying, is_active boolean, total_purchases numeric, order_count bigint, avg_order_value numeric, last_order_date timestamp with time zone, days_since_last_order integer, inactive_risk boolean, lost_customer_risk boolean, expected_next_order_date timestamp with time zone, potential_revenue_score numeric, ranking bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_identity_type text; v_identity_id uuid; v_employee_id uuid; v_visible uuid[];
BEGIN
  SELECT s.identity_type, s.identity_id, s.employee_id INTO v_identity_type, v_identity_id, v_employee_id FROM app.sessions s WHERE s.token = p_token AND s.expires_at > now(); IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  RETURN QUERY WITH visible_customers AS (
    SELECT c.id, c.code, c.company_name, c.is_active FROM public.customers c
    WHERE (v_identity_type = 'customer' AND c.identity_id = v_identity_id) OR (c.owner_id = ANY(v_visible))
  ), order_stats AS (
    SELECT o.customer_id, COALESCE(SUM(o.total_amount), 0) AS total_purchases, COUNT(*)::bigint AS order_count, MAX(o.submitted_at) AS last_order_date, MIN(o.submitted_at) AS first_order_date FROM public.orders o WHERE o.status IN ('submitted','approved') GROUP BY o.customer_id
  ), intervals AS (
    SELECT subq.customer_id, AVG(subq.days)::numeric AS avg_interval FROM (
      SELECT o2.customer_id, EXTRACT(DAY FROM (o2.submitted_at - LAG(o2.submitted_at) OVER (PARTITION BY o2.customer_id ORDER BY o2.submitted_at)))::numeric AS days FROM public.orders o2
      WHERE o2.status IN ('submitted','approved') AND o2.submitted_at IS NOT NULL
    ) subq WHERE subq.days IS NOT NULL AND subq.days > 0 GROUP BY subq.customer_id
  )
  SELECT vc.id, vc.code, vc.company_name, vc.is_active,
    COALESCE(os.total_purchases, 0), COALESCE(os.order_count, 0),
    CASE WHEN os.order_count > 0 THEN os.total_purchases / os.order_count ELSE 0 END,
    os.last_order_date,
    CASE WHEN os.last_order_date IS NOT NULL THEN EXTRACT(DAY FROM now() - os.last_order_date)::int ELSE NULL END,
    CASE WHEN os.last_order_date IS NOT NULL AND EXTRACT(DAY FROM now() - os.last_order_date) > 30 AND EXTRACT(DAY FROM now() - os.last_order_date) < 90 THEN true ELSE false END,
    CASE WHEN os.last_order_date IS NOT NULL AND EXTRACT(DAY FROM now() - os.last_order_date) >= 90 THEN true ELSE false END,
    CASE WHEN os.last_order_date IS NOT NULL AND COALESCE(i.avg_interval, 0) > 0 THEN os.last_order_date + (i.avg_interval || ' days')::interval ELSE NULL END,
    CASE WHEN os.last_order_date IS NOT NULL AND COALESCE(i.avg_interval, 0) > 0 THEN COALESCE(os.total_purchases, 0) * GREATEST(0, EXTRACT(DAY FROM now() - os.last_order_date) / i.avg_interval) ELSE COALESCE(os.total_purchases, 0) * 0.5 END,
    ROW_NUMBER() OVER (ORDER BY COALESCE(os.total_purchases, 0) DESC)
  FROM visible_customers vc
  LEFT JOIN order_stats os ON os.customer_id = vc.id
  LEFT JOIN intervals i ON i.customer_id = vc.id
  ORDER BY ranking;
END;
$function$;

-- 9b: get_customer_brands
CREATE OR REPLACE FUNCTION public.get_customer_brands(p_token uuid, p_customer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_identity_type text; v_identity_id uuid; v_employee_id uuid; v_visible uuid[]; v_cust public.customers; v_total numeric; v_brands json;
BEGIN
  SELECT s.identity_type, s.identity_id, s.employee_id INTO v_identity_type, v_identity_id, v_employee_id FROM app.sessions s WHERE s.token = p_token AND s.expires_at > now(); IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_cust FROM public.customers WHERE id = p_customer_id; IF NOT FOUND THEN RETURN NULL; END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  IF v_identity_type = 'customer' THEN IF v_cust.identity_id != v_identity_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  ELSIF v_cust.owner_id IS NOT NULL AND NOT (v_cust.owner_id = ANY(v_visible)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT COALESCE(SUM(oi.total_price), 0) INTO v_total FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved');
  SELECT json_agg(subq ORDER BY subq.total_spent DESC) INTO v_brands FROM (
    SELECT c.id AS company_id, c.company_name, SUM(oi.total_price) AS total_spent,
      CASE WHEN v_total > 0 THEN ROUND(SUM(oi.total_price) / v_total * 100, 1) ELSE 0 END AS share_pct,
      ROUND(((COALESCE(SUM(oi.total_price) FILTER (WHERE o.submitted_at >= CURRENT_DATE - INTERVAL '90 days'), 0) - COALESCE(SUM(oi.total_price) FILTER (WHERE o.submitted_at >= CURRENT_DATE - INTERVAL '180 days' AND o.submitted_at < CURRENT_DATE - INTERVAL '90 days'), 0)) / NULLIF(COALESCE(SUM(oi.total_price) FILTER (WHERE o.submitted_at >= CURRENT_DATE - INTERVAL '180 days' AND o.submitted_at < CURRENT_DATE - INTERVAL '90 days'), 0), 0)) * 100, 1) AS trend_pct
    FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id JOIN public.products p ON p.id = oi.product_id JOIN public.companies c ON c.id = p.company_id
    WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved')
    GROUP BY c.id, c.company_name ORDER BY total_spent DESC LIMIT 10
  ) subq;
  RETURN json_build_object('total_spent', v_total, 'brands', COALESCE(v_brands, '[]'::json));
END;
$function$;

-- 9c: get_customer_card
CREATE OR REPLACE FUNCTION public.get_customer_card(p_token uuid, p_customer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_identity_type text; v_identity_id uuid; v_employee_id uuid; v_visible uuid[];
  v_cust public.customers; v_total_purchases numeric; v_order_count int; v_avg_value numeric;
  v_last_order timestamptz; v_last_visit timestamptz; v_cash_amt numeric; v_total_coll numeric;
  v_visit_count int; v_reorder_interval numeric; v_first_order timestamptz;
  v_growth numeric; v_prior_total numeric; v_expected_next timestamptz; v_potential_revenue numeric;
  v_balance numeric; v_total_ordered numeric;
BEGIN
  SELECT s.identity_type, s.identity_id, s.employee_id INTO v_identity_type, v_identity_id, v_employee_id FROM app.sessions s WHERE s.token = p_token AND s.expires_at > now(); IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_cust FROM public.customers WHERE id = p_customer_id; IF NOT FOUND THEN RETURN NULL; END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  IF v_identity_type = 'customer' THEN IF v_cust.identity_id != v_identity_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  ELSIF v_cust.owner_id IS NOT NULL AND NOT (v_cust.owner_id = ANY(v_visible)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT COALESCE(SUM(o.total_amount), 0), COUNT(*), MAX(o.submitted_at), MIN(o.submitted_at), COALESCE(SUM(o.total_amount), 0) INTO v_total_purchases, v_order_count, v_last_order, v_first_order, v_total_ordered FROM public.orders o WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved');
  v_avg_value := CASE WHEN v_order_count > 0 THEN v_total_purchases / v_order_count ELSE 0 END;
  SELECT MAX(v.check_in_at), COUNT(*) INTO v_last_visit, v_visit_count FROM public.visits v WHERE v.customer_id = p_customer_id;
  SELECT COALESCE(SUM(c.amount) FILTER (WHERE c.method = 'cash'), 0), COALESCE(SUM(c.amount), 0) INTO v_cash_amt, v_total_coll FROM public.collections c WHERE c.customer_id = p_customer_id;
  v_balance := v_total_ordered - v_total_coll;
  SELECT COALESCE(AVG(subq.days), 0) INTO v_reorder_interval FROM (
    SELECT EXTRACT(DAY FROM (o2.submitted_at - LAG(o2.submitted_at) OVER (ORDER BY o2.submitted_at)))::numeric AS days FROM public.orders o2
    WHERE o2.customer_id = p_customer_id AND o2.status IN ('submitted','approved') AND o2.submitted_at IS NOT NULL
  ) subq WHERE subq.days IS NOT NULL AND subq.days > 0;
  SELECT COALESCE(SUM(o3.total_amount), 0) INTO v_prior_total FROM public.orders o3 WHERE o3.customer_id = p_customer_id AND o3.status IN ('submitted','approved') AND o3.submitted_at >= CURRENT_DATE - INTERVAL '180 days' AND o3.submitted_at < CURRENT_DATE - INTERVAL '90 days';
  SELECT COALESCE(SUM(o4.total_amount), 0) INTO v_growth FROM public.orders o4 WHERE o4.customer_id = p_customer_id AND o4.status IN ('submitted','approved') AND o4.submitted_at >= CURRENT_DATE - INTERVAL '90 days';
  v_growth := CASE WHEN v_prior_total > 0 THEN ((v_growth - v_prior_total) / v_prior_total) * 100 ELSE 0 END;
  IF v_last_order IS NOT NULL AND v_reorder_interval > 0 THEN v_expected_next := v_last_order + (v_reorder_interval || ' days')::interval; END IF;
  IF v_last_order IS NOT NULL AND v_reorder_interval > 0 THEN v_potential_revenue := v_total_purchases * GREATEST(0, EXTRACT(DAY FROM now() - v_last_order) / v_reorder_interval); ELSE v_potential_revenue := v_total_purchases * 0.5; END IF;
  RETURN json_build_object('customer_id', v_cust.id, 'code', v_cust.code, 'company_name', v_cust.company_name, 'is_active', v_cust.is_active,
    'purchase_summary', json_build_object('total_purchases', v_total_purchases, 'order_count', v_order_count, 'avg_order_value', v_avg_value, 'last_order_date', v_last_order, 'first_order_date', v_first_order),
    'visit_summary', json_build_object('last_visit_date', v_last_visit, 'days_since_last_visit', CASE WHEN v_last_visit IS NOT NULL THEN EXTRACT(DAY FROM now() - v_last_visit)::int ELSE NULL END, 'total_visits', v_visit_count),
    'credit_status', json_build_object('current_balance', v_balance, 'credit_limit', v_cust.credit_limit, 'credit_utilization_pct', CASE WHEN v_cust.credit_limit > 0 THEN ROUND((v_balance / v_cust.credit_limit) * 100, 1) ELSE 0 END, 'cash_vs_credit_ratio', CASE WHEN v_total_coll > 0 THEN ROUND(v_cash_amt / v_total_coll, 2) ELSE 0 END),
    'risk_indicators', json_build_object('days_since_last_order', CASE WHEN v_last_order IS NOT NULL THEN EXTRACT(DAY FROM now() - v_last_order)::int ELSE NULL END, 'inactive_risk', CASE WHEN v_last_order IS NOT NULL AND EXTRACT(DAY FROM now() - v_last_order) > 30 AND EXTRACT(DAY FROM now() - v_last_order) < 90 THEN true ELSE false END, 'lost_customer_risk', CASE WHEN v_last_order IS NOT NULL AND EXTRACT(DAY FROM now() - v_last_order) >= 90 THEN true ELSE false END),
    'behavior', json_build_object('avg_reorder_interval_days', v_reorder_interval, 'growth_trend_pct', ROUND(v_growth, 1), 'decline_trend_pct', ROUND(LEAST(v_growth, 0), 1)),
    'expected_next_order_date', v_expected_next, 'potential_revenue_score', ROUND(v_potential_revenue, 2));
END;
$function$;

-- ============================================================================
-- STEP 10: RECOVERY FILE — REMAINING FUNCTIONS
-- ============================================================================

-- 10a: get_customer_products (Pattern A — replace visibility block)
CREATE OR REPLACE FUNCTION public.get_customer_products(p_token uuid, p_customer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_identity_type text; v_identity_id uuid; v_employee_id uuid; v_visible uuid[];
  v_cust public.customers; v_top json; v_repeated json; v_stopped json;
BEGIN
  SELECT s.identity_type, s.identity_id, s.employee_id INTO v_identity_type, v_identity_id, v_employee_id FROM app.sessions s WHERE s.token = p_token AND s.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_cust FROM public.customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  IF v_identity_type = 'customer' THEN IF v_cust.identity_id != v_identity_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  ELSIF v_cust.owner_id IS NOT NULL AND NOT (v_cust.owner_id = ANY(v_visible)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT json_agg(subq ORDER BY subq.total_spent DESC) INTO v_top FROM (
    SELECT p.id AS product_id, p.product_name, co.company_name, oi.unit_type, SUM(oi.total_price) AS total_spent, COUNT(*)::int AS order_count
    FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id JOIN public.products p ON p.id = oi.product_id JOIN public.companies co ON co.id = p.company_id
    WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved')
    GROUP BY p.id, p.product_name, co.company_name, oi.unit_type ORDER BY total_spent DESC LIMIT 10
  ) subq;
  SELECT json_agg(subq ORDER BY subq.repeat_count DESC) INTO v_repeated FROM (
    SELECT p.id AS product_id, p.product_name, COUNT(*)::int AS repeat_count
    FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id JOIN public.products p ON p.id = oi.product_id
    WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved')
    GROUP BY p.id, p.product_name HAVING COUNT(*) > 1 ORDER BY repeat_count DESC LIMIT 10
  ) subq;
  SELECT COALESCE(json_agg(subq ORDER BY subq.last_order_date DESC NULLS LAST), '[]'::json) INTO v_stopped FROM (
    SELECT DISTINCT p.id AS product_id, p.product_name, MAX(o.submitted_at) AS last_order_date
    FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id JOIN public.products p ON p.id = oi.product_id
    WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved')
    GROUP BY p.id, p.product_name HAVING MAX(o.submitted_at) < CURRENT_DATE - INTERVAL '90 days' LIMIT 10
  ) subq;
  RETURN json_build_object('top_products', v_top, 'repeated_products', v_repeated, 'stopped_products', v_stopped);
END;
$function$;

-- 10b: get_dashboard_sales (Pattern A — replace visibility block)
CREATE OR REPLACE FUNCTION public.get_dashboard_sales(p_token uuid, p_inactive_days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[];
  v_today_orders int; v_pending_followup int;
  v_inactive_customers int; v_today_visits int; v_today_collections int;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type = 'customer' THEN
    SELECT count(*) INTO v_today_orders FROM public.orders WHERE customer_id = v_session.customer_id AND created_at >= CURRENT_DATE;
    SELECT count(*) INTO v_pending_followup FROM public.orders WHERE customer_id = v_session.customer_id AND status IN ('draft','reviewing','submitted');
    SELECT count(*) INTO v_inactive_customers FROM public.customers WHERE id = v_session.customer_id AND COALESCE(updated_at, created_at) < CURRENT_DATE - p_inactive_days;
    SELECT count(*) INTO v_today_visits FROM public.visits WHERE customer_id = v_session.customer_id AND created_at >= CURRENT_DATE;
    SELECT count(*) INTO v_today_collections FROM public.collections WHERE customer_id = v_session.customer_id AND created_at >= CURRENT_DATE;
  ELSE
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
    SELECT count(*) INTO v_today_orders FROM public.orders WHERE owner_id = ANY(v_visible) AND created_at >= CURRENT_DATE;
    SELECT count(*) INTO v_pending_followup FROM public.orders WHERE owner_id = ANY(v_visible) AND status IN ('draft','reviewing','submitted');
    SELECT count(*) INTO v_inactive_customers FROM public.customers WHERE owner_id = ANY(v_visible) AND COALESCE(updated_at, created_at) < CURRENT_DATE - p_inactive_days;
    SELECT count(*) INTO v_today_visits FROM public.visits WHERE employee_id = ANY(v_visible) AND created_at >= CURRENT_DATE;
    SELECT count(*) INTO v_today_collections FROM public.collections WHERE created_by = ANY(v_visible) AND created_at >= CURRENT_DATE;
  END IF;
  RETURN json_build_object('today_orders', COALESCE(v_today_orders, 0), 'pending_followup', COALESCE(v_pending_followup, 0), 'inactive_customers', COALESCE(v_inactive_customers, 0), 'today_visits', COALESCE(v_today_visits, 0), 'today_collections', COALESCE(v_today_collections, 0));
END;
$function$;

-- 10c: get_governed_credit_application (Pattern B — replace inline role check with is_upper_management)
CREATE OR REPLACE FUNCTION public.get_governed_credit_application(p_token uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('application', row_to_json(a)::jsonb, 'customer', row_to_json(c)::jsonb, 'program', row_to_json(p)::jsonb, 'contract', (SELECT row_to_json(cc)::jsonb FROM public.credit_contracts cc WHERE cc.application_id = a.id LIMIT 1)) INTO v_result
  FROM public.credit_applications a JOIN public.customers c ON c.id = a.customer_id JOIN public.credit_programs p ON p.id = a.program_id
  WHERE a.id = p_id AND (
    v_session.identity_type = 'customer' AND a.customer_id = v_session.customer_id
    OR v_session.identity_type = 'employee' AND (public.is_upper_management(v_session.employee_id) OR c.owner_id = ANY(public.get_visible_employee_ids(p_token)))
  );
  RETURN v_result;
END;
$function$;

-- 10d: get_governed_credit_applications (Pattern A — replace visibility block)
CREATE OR REPLACE FUNCTION public.get_governed_credit_applications(p_token uuid)
 RETURNS TABLE(id uuid, customer_id uuid, customer_name character varying, program_name character varying, credit_limit numeric, credit_days integer, status credit_application_status, doc_confirmed boolean, submitted_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN QUERY SELECT a.id, a.customer_id, c.company_name, p.name, p.credit_limit, p.credit_days, a.status, (a.doc_confirmed_by IS NOT NULL), a.submitted_at, a.created_at, a.updated_at
    FROM public.credit_applications a JOIN public.customers c ON c.id = a.customer_id JOIN public.credit_programs p ON p.id = a.program_id
    WHERE a.customer_id = v_session.customer_id ORDER BY a.created_at DESC;
    RETURN;
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  IF public.is_upper_management(v_session.employee_id) THEN
    RETURN QUERY SELECT a.id, a.customer_id, c.company_name, p.name, p.credit_limit, p.credit_days, a.status, (a.doc_confirmed_by IS NOT NULL), a.submitted_at, a.created_at, a.updated_at
    FROM public.credit_applications a JOIN public.customers c ON c.id = a.customer_id JOIN public.credit_programs p ON p.id = a.program_id ORDER BY a.created_at DESC;
  ELSE
    RETURN QUERY SELECT a.id, a.customer_id, c.company_name, p.name, p.credit_limit, p.credit_days, a.status, (a.doc_confirmed_by IS NOT NULL), a.submitted_at, a.created_at, a.updated_at
    FROM public.credit_applications a JOIN public.customers c ON c.id = a.customer_id JOIN public.credit_programs p ON p.id = a.program_id
    WHERE c.owner_id = ANY(v_visible) ORDER BY a.created_at DESC;
  END IF;
END;
$function$;

-- 10e: get_governed_deliveries (Pattern A — replace visibility block)
CREATE OR REPLACE FUNCTION public.get_governed_deliveries(p_token uuid, p_status_filter character varying DEFAULT NULL::character varying)
 RETURNS TABLE(id uuid, order_id uuid, order_number character varying, customer_name character varying, status character varying, assigned_to_name character varying, assigned_at timestamp with time zone, started_at timestamp with time zone, completed_at timestamp with time zone, failure_reason character varying, notes text, total_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[]; v_is_super boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  v_is_super := public.is_upper_management(v_session.employee_id);
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  RETURN QUERY
  SELECT dt.id, o.id, o.order_number, c.company_name, dt.status, ast.code, dt.assigned_at, dt.started_at, dt.completed_at, dt.failure_reason, dt.notes, o.total_amount
  FROM public.delivery_tracking dt JOIN public.orders o ON o.id = dt.order_id
  JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
  WHERE (v_is_super OR o.owner_id = ANY(v_visible))
    AND (p_status_filter IS NULL OR dt.status = p_status_filter)
  ORDER BY dt.created_at DESC;
END;
$function$;

-- 10f: get_governed_order (Pattern A — replace visibility block)
CREATE OR REPLACE FUNCTION public.get_governed_order(p_token uuid, p_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_order public.orders; v_subtree_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_session.identity_type = 'customer' THEN
    IF v_order.customer_id != v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN v_order;
  END IF;
  IF public.is_upper_management(v_session.employee_id) THEN RETURN v_order; END IF;
  v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
  IF EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_order.customer_id AND c.owner_id = ANY(v_subtree_ids)) THEN RETURN v_order; END IF;
  RAISE EXCEPTION 'FORBIDDEN';
END;
$function$;

-- 10g: get_governed_preparation_queue (Pattern B — replace role check)
CREATE OR REPLACE FUNCTION public.get_governed_preparation_queue(p_token uuid, p_status_filter text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, order_id uuid, order_code text, customer_name text, status text, started_by uuid, started_at timestamp with time zone, completed_by uuid, completed_at timestamp with time zone, reviewed_by uuid, reviewed_at timestamp with time zone, notes text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, app, extensions, pg_catalog
AS $function$
DECLARE v_session app.sessions; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_session.employee_id IS NULL THEN RETURN; END IF;
  IF public.is_upper_management(v_session.employee_id) THEN
    RETURN QUERY
      SELECT pr.id, pr.order_id, o.order_number::text, cust.company_name::text, pr.status::text,
             pr.started_by, pr.started_at, pr.completed_by, pr.completed_at,
             pr.reviewed_by, pr.reviewed_at, pr.notes::text
      FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id
      JOIN public.customers cust ON cust.id = o.customer_id
      WHERE (p_status_filter IS NULL OR pr.status::text = p_status_filter)
      ORDER BY pr.created_at DESC;
    RETURN;
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  RETURN QUERY
    SELECT pr.id, pr.order_id, o.order_number::text, cust.company_name::text, pr.status::text,
           pr.started_by, pr.started_at, pr.completed_by, pr.completed_at,
           pr.reviewed_by, pr.reviewed_at, pr.notes::text
    FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id
    JOIN public.customers cust ON cust.id = o.customer_id
    WHERE o.owner_id = ANY(v_visible)
      AND (p_status_filter IS NULL OR pr.status::text = p_status_filter)
    ORDER BY pr.created_at DESC;
END;
$function$;

-- 10h: get_governed_return (Pattern A — replace visibility block)
CREATE OR REPLACE FUNCTION public.get_governed_return(p_token uuid, p_id uuid)
 RETURNS returns
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_return public.returns; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_return FROM public.returns WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_session.identity_type = 'customer' THEN
    IF v_return.customer_id != v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN v_return;
  END IF;
  IF public.is_upper_management(v_session.employee_id) THEN RETURN v_return; END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  IF v_return.created_by = ANY(v_visible) THEN RETURN v_return; END IF;
  RAISE EXCEPTION 'FORBIDDEN';
END;
$function$;

-- 10i: get_governed_return_items (Pattern A — replace visibility block)
CREATE OR REPLACE FUNCTION public.get_governed_return_items(p_token uuid, p_return_id uuid)
 RETURNS SETOF return_items
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_return public.returns; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_return FROM public.returns WHERE id = p_return_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN
    IF v_return.customer_id != v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN QUERY SELECT ri.* FROM public.return_items ri WHERE ri.return_id = p_return_id; RETURN;
  END IF;
  IF public.is_upper_management(v_session.employee_id) THEN
    RETURN QUERY SELECT ri.* FROM public.return_items ri WHERE ri.return_id = p_return_id; RETURN;
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  IF v_return.created_by = ANY(v_visible) THEN
    RETURN QUERY SELECT ri.* FROM public.return_items ri WHERE ri.return_id = p_return_id;
  END IF;
END;
$function$;

-- 10j: get_governed_returns (Pattern A — replace visibility block)
CREATE OR REPLACE FUNCTION public.get_governed_returns(p_token uuid)
 RETURNS SETOF returns
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN QUERY SELECT r.* FROM public.returns r WHERE r.customer_id = v_session.customer_id; RETURN;
  END IF;
  IF public.is_upper_management(v_session.employee_id) THEN
    RETURN QUERY SELECT r.* FROM public.returns r ORDER BY r.created_at DESC; RETURN;
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  RETURN QUERY SELECT r.* FROM public.returns r WHERE r.created_by = ANY(v_visible) ORDER BY r.created_at DESC;
END;
$function$;

-- 10k: get_governed_visit (Pattern A — replace visibility block)
CREATE OR REPLACE FUNCTION public.get_governed_visit(p_token uuid, p_id uuid)
 RETURNS visits
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visit public.visits; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_visit FROM public.visits WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_session.identity_type = 'customer' THEN
    IF v_visit.customer_id != v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN v_visit;
  END IF;
  IF public.is_upper_management(v_session.employee_id) THEN RETURN v_visit; END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  IF v_visit.employee_id = ANY(v_visible) THEN RETURN v_visit; END IF;
  RAISE EXCEPTION 'FORBIDDEN';
END;
$function$;

-- 10l: get_governed_visits (Pattern A — replace visibility block)
CREATE OR REPLACE FUNCTION public.get_governed_visits(p_token uuid)
 RETURNS SETOF visits
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN QUERY SELECT v.* FROM public.visits v WHERE v.customer_id = v_session.customer_id; RETURN;
  END IF;
  IF public.is_upper_management(v_session.employee_id) THEN
    RETURN QUERY SELECT v.* FROM public.visits v ORDER BY v.created_at DESC; RETURN;
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  RETURN QUERY SELECT v.* FROM public.visits v WHERE v.employee_id = ANY(v_visible) ORDER BY v.created_at DESC;
END;
$function$;

-- 10m: get_governed_waiting_preparations (Pattern B — replace role check)
CREATE OR REPLACE FUNCTION public.get_governed_waiting_preparations(p_token uuid)
 RETURNS TABLE(id uuid, code text, customer_name text, total numeric, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, app, extensions, pg_catalog
AS $function$
DECLARE v_session app.sessions; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_session.employee_id IS NULL THEN RETURN; END IF;
  IF public.is_upper_management(v_session.employee_id) THEN
    RETURN QUERY
      SELECT o.id, o.order_number::text, cust.company_name::text, o.total_amount, o.created_at
      FROM public.orders o JOIN public.customers cust ON cust.id = o.customer_id
      WHERE o.status = 'approved' AND NOT EXISTS (SELECT 1 FROM public.preparation_records pr WHERE pr.order_id = o.id)
      ORDER BY o.created_at ASC;
    RETURN;
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  RETURN QUERY
    SELECT o.id, o.order_number::text, cust.company_name::text, o.total_amount, o.created_at
    FROM public.orders o JOIN public.customers cust ON cust.id = o.customer_id
    WHERE o.status = 'approved' AND o.owner_id = ANY(v_visible)
      AND NOT EXISTS (SELECT 1 FROM public.preparation_records pr WHERE pr.order_id = o.id)
    ORDER BY o.created_at ASC;
END;
$function$;

-- 10n: get_visible_customer_ids (Pattern A — replace visibility block)
CREATE OR REPLACE FUNCTION public.get_visible_customer_ids(p_token uuid)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN QUERY SELECT c.id FROM public.customers c WHERE c.identity_id = v_session.identity_id; RETURN;
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  RETURN QUERY SELECT DISTINCT c.id FROM public.customers c WHERE c.owner_id = ANY(v_visible);
END;
$function$;

-- 10o: get_visible_employees (Pattern A — replace hardcoded name checks)
CREATE OR REPLACE FUNCTION public.get_visible_employees(p_token uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, app, extensions, pg_catalog
AS $function$
DECLARE v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN ARRAY[]::uuid[]; END IF;
  IF v_session.identity_type = 'customer' THEN RETURN ARRAY[]::uuid[]; END IF;
  RETURN COALESCE(public.get_visible_employee_ids(p_token), ARRAY[]::uuid[]);
END;
$function$;

-- 10p: get_warehouse_analytics (Pattern B — replace role check with is_upper_management)
CREATE OR REPLACE FUNCTION public.get_warehouse_analytics(p_token uuid)
 RETURNS TABLE(metric text, value text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, app, extensions, pg_catalog
AS $function$
DECLARE v_session app.sessions; v_visible uuid[]; v_avg_interval interval;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_session.employee_id IS NULL THEN RETURN; END IF;
  IF public.is_upper_management(v_session.employee_id) THEN
    SELECT avg(pr.completed_at - pr.started_at) INTO v_avg_interval FROM public.preparation_records pr WHERE pr.completed_at IS NOT NULL;
    RETURN QUERY
      SELECT 'prepared_today'::text, COUNT(*)::text FROM public.preparation_records WHERE completed_at >= CURRENT_DATE
      UNION ALL SELECT 'avg_prep_time'::text, COALESCE(EXTRACT(EPOCH FROM v_avg_interval)::text, '0')
      UNION ALL SELECT 'queue_size'::text, COUNT(*)::text FROM public.preparation_records WHERE status IN ('in_progress', 'completed');
    RETURN;
  END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  SELECT avg(pr.completed_at - pr.started_at) INTO v_avg_interval
  FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id
  WHERE pr.completed_at IS NOT NULL AND o.owner_id = ANY(v_visible);
  RETURN QUERY
    SELECT 'prepared_today'::text, COUNT(*)::text FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id
    WHERE pr.completed_at >= CURRENT_DATE AND o.owner_id = ANY(v_visible)
    UNION ALL SELECT 'avg_prep_time'::text, COALESCE(EXTRACT(EPOCH FROM v_avg_interval)::text, '0')
    UNION ALL SELECT 'queue_size'::text, COUNT(*)::text FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id
    WHERE pr.status IN ('in_progress', 'completed') AND o.owner_id = ANY(v_visible);
END;
$function$;

-- ============================================================================
-- STEP 11: ORDER DISPATCH & SPECIAL FUNCTIONS (Pattern C/E)
-- ============================================================================

-- 11a: governed_dispatch_decision (Pattern C — remove EXECUTIVE_MANAGER/Sales Manager role check + dead v_emp_code)
DROP FUNCTION IF EXISTS public.governed_dispatch_decision(p_token uuid, p_id uuid, p_action text, p_assigned_to uuid, p_reason text, p_follow_up_date timestamptz);

CREATE OR REPLACE FUNCTION public.governed_dispatch_decision(p_token uuid, p_id uuid, p_action text, p_assigned_to uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_follow_up_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_order public.orders; v_authorized boolean; v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  v_authorized := public.is_upper_management(v_session.employee_id);
  IF NOT v_authorized THEN RETURN json_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only'); END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'NOT_FOUND'); END IF;
  IF v_order.status != 'ready_for_dispatch' THEN RETURN json_build_object('error', 'INVALID_STATE', 'detail', 'Order must be in ready_for_dispatch status'); END IF;
  IF p_action = 'send' THEN
    IF p_assigned_to IS NULL THEN RETURN json_build_object('error', 'MISSING_ASSIGNEE', 'detail', 'A delivery employee must be assigned'); END IF;
    UPDATE public.orders SET status = 'sent_to_delivery', updated_at = now() WHERE id = p_id;
    INSERT INTO public.delivery_tracking (order_id, status, assigned_to, assigned_by, assigned_at) VALUES (p_id, 'assigned', p_assigned_to, v_session.employee_id, now()) RETURNING * INTO v_dt;
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, 'ready_for_dispatch', 'sent_to_delivery', v_session.identity_id, COALESCE(p_reason, 'Sent to delivery'));
    RETURN json_build_object('action', 'sent_to_delivery', 'order_status', 'sent_to_delivery', 'delivery_id', v_dt.id);
  ELSIF p_action = 'defer' THEN
    IF p_follow_up_date IS NULL THEN RETURN json_build_object('error', 'MISSING_FOLLOW_UP', 'detail', 'Follow-up date is required for deferral'); END IF;
    UPDATE public.orders SET status = 'deferred', deferred_until = p_follow_up_date, defer_reason = p_reason, updated_at = now() WHERE id = p_id;
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, 'ready_for_dispatch', 'deferred', v_session.identity_id, COALESCE(p_reason, 'Order deferred'));
    RETURN json_build_object('action', 'deferred', 'order_status', 'deferred', 'deferred_until', p_follow_up_date);
  ELSIF p_action = 'cancel' THEN
    IF p_reason IS NULL THEN RETURN json_build_object('error', 'MISSING_REASON', 'detail', 'Cancellation reason is required'); END IF;
    UPDATE public.orders SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, updated_at = now() WHERE id = p_id;
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, 'ready_for_dispatch', 'cancelled', v_session.identity_id, p_reason);
    RETURN json_build_object('action', 'cancelled', 'order_status', 'cancelled', 'cancelled_at', now());
  ELSE
    RETURN json_build_object('error', 'INVALID_ACTION', 'detail', 'Action must be send, defer, or cancel');
  END IF;
END;
$function$;

-- 11b: governed_reopen_cancelled (Pattern C — remove EXECUTIVE_MANAGER/Sales Manager role check + dead v_emp_code)
DROP FUNCTION IF EXISTS public.governed_reopen_cancelled(p_token uuid, p_order_id uuid, p_reason text);

CREATE OR REPLACE FUNCTION public.governed_reopen_cancelled(p_token uuid, p_order_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_authorized boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  v_authorized := public.is_upper_management(v_session.employee_id);
  IF NOT v_authorized THEN RETURN json_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND status = 'cancelled') THEN
    RETURN json_build_object('error', 'INVALID_STATE', 'detail', 'Only cancelled orders can be reopened');
  END IF;
  UPDATE public.orders SET status = 'ready_for_dispatch', cancelled_at = NULL, cancel_reason = NULL, updated_at = now() WHERE id = p_order_id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_order_id, 'cancelled', 'ready_for_dispatch', v_session.identity_id, COALESCE(p_reason, 'Order reopened for dispatch'));
  RETURN json_build_object('action', 'reopened', 'order_status', 'ready_for_dispatch');
END;
$function$;

-- 11c: governed_return_to_preparation (Pattern E — remove role check + hardcoded employee codes)
CREATE OR REPLACE FUNCTION public.governed_return_to_preparation(p_token uuid, p_preparation_id uuid, p_notes text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, app, extensions, pg_catalog
AS $function$
DECLARE v_session app.sessions; v_prep_status text; v_authorized boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_session.employee_id IS NULL THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  v_authorized := public.is_upper_management(v_session.employee_id);
  IF NOT v_authorized THEN RETURN json_build_object('error', 'FORBIDDEN'); END IF;
  SELECT status::text INTO v_prep_status FROM public.preparation_records WHERE id = p_preparation_id;
  IF v_prep_status IS NULL THEN RETURN json_build_object('error', 'PREPARATION_NOT_FOUND'); END IF;
  IF v_prep_status != 'completed' THEN RETURN json_build_object('error', 'INVALID_STATUS', 'current_status', v_prep_status); END IF;
  IF p_notes IS NULL OR trim(p_notes) = '' THEN
    RETURN json_build_object('error', 'REASON_REQUIRED', 'detail', 'A reason for returning to preparation is required');
  END IF;
  UPDATE public.preparation_records
  SET status = 'in_progress'::preparation_status,
      completed_by = NULL, completed_at = NULL,
      notes = COALESCE(notes, '') || E'\nReturned to preparation: ' || p_notes,
      updated_at = now()
  WHERE id = p_preparation_id;
  RETURN json_build_object('id', p_preparation_id, 'status', 'in_progress', 'returned_by', v_session.employee_id, 'returned_at', now(), 'reason', p_notes);
END;
$function$;

-- ============================================================================
-- STEP 12: COMMAND CENTER FUNCTIONS (Pattern D — Arabic role name checks)
-- ============================================================================

-- 12a: get_command_center
CREATE OR REPLACE FUNCTION public.get_command_center(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_modules jsonb; v_decisions jsonb; v_requests jsonb; v_summary jsonb;
  v_production_ready int; v_total_modules int; v_healthy int; v_degraded int; v_down int; v_broken int;
  v_total_decisions int; v_verified_decisions int;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only');
  END IF;
  SELECT COALESCE(jsonb_agg(m ORDER BY CASE WHEN m.status = 'broken' THEN 0 WHEN m.health_status = 'down' THEN 1 WHEN m.health_status = 'degraded' THEN 2 ELSE 3 END, m.readiness_score DESC), '[]'::jsonb) FROM (
    SELECT id, module_key, display_name, description, icon, status, implementation_level, validated_at, broken_since, deprecated_at, owner_approved, routes, core_rpcs, core_tables, services, page_dirs, pipeline_steps, pipeline_health_pct, last_health_check, health_status, readiness_score, business_priority, kb_file, decisions_total, decisions_verified, decisions_pct, depends_on, created_at, updated_at FROM public.system_modules
  ) m INTO v_modules;
  SELECT COALESCE(jsonb_agg(d ORDER BY d.module_key, d.created_at), '[]'::jsonb) FROM (
    SELECT id, module_key, decision_text, rationale, category, source_file, source_line, verifiable, verification_method, verified, verified_at, failure_reason, decided_at, tags, created_at FROM public.owner_decisions
  ) d INTO v_decisions;
  SELECT COALESCE(jsonb_agg(r ORDER BY CASE WHEN r.priority = 'critical' THEN 0 WHEN r.priority = 'high' THEN 1 WHEN r.priority = 'medium' THEN 2 WHEN r.priority = 'low' THEN 3 ELSE 4 END, r.approved_at DESC), '[]'::jsonb) FROM (
    SELECT id, title, description, status, priority, module_key, source_file, source_line, approved_at, depends_on, notes, tags, created_at, updated_at FROM public.owner_requests
  ) r INTO v_requests;
  SELECT COUNT(*) INTO v_total_modules FROM public.system_modules;
  SELECT COUNT(*) INTO v_healthy FROM public.system_modules WHERE health_status = 'healthy';
  SELECT COUNT(*) INTO v_degraded FROM public.system_modules WHERE health_status = 'degraded';
  SELECT COUNT(*) INTO v_down FROM public.system_modules WHERE health_status = 'down';
  SELECT COUNT(*) INTO v_broken FROM public.system_modules WHERE status = 'broken';
  SELECT COUNT(*) INTO v_production_ready FROM public.system_modules WHERE readiness_score >= 90 AND owner_approved = true AND pipeline_health_pct = 100 AND health_status = 'healthy';
  SELECT COUNT(*) INTO v_total_decisions FROM public.owner_decisions WHERE verifiable = true;
  SELECT COUNT(*) INTO v_verified_decisions FROM public.owner_decisions WHERE verifiable = true AND verified = true;
  v_summary := jsonb_build_object('total_modules', v_total_modules, 'healthy', v_healthy, 'degraded', v_degraded, 'down', v_down, 'broken', v_broken, 'production_ready', v_production_ready, 'total_verifiable_decisions', v_total_decisions, 'verified_decisions', v_verified_decisions, 'decisions_pct', CASE WHEN v_total_decisions > 0 THEN (v_verified_decisions * 100 / v_total_decisions) ELSE 0 END);
  RETURN jsonb_build_object('modules', v_modules, 'decisions', v_decisions, 'requests', v_requests, 'summary', v_summary);
END;
$function$;

-- 12b: get_command_center_v2
CREATE OR REPLACE FUNCTION public.get_command_center_v2(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_modules jsonb; v_decisions jsonb; v_requests jsonb; v_summary jsonb;
  v_required_actions jsonb; v_module_counts jsonb;
  v_production_ready int; v_total_modules int; v_healthy int; v_degraded int; v_down int; v_broken int;
  v_total_decisions int; v_verified_decisions int;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only');
  END IF;
  SELECT COALESCE(jsonb_agg(m ORDER BY CASE WHEN m.status = 'broken' THEN 0 WHEN m.health_status = 'down' THEN 1 WHEN m.health_status = 'degraded' THEN 2 ELSE 3 END, m.readiness_score DESC), '[]'::jsonb) FROM (
    SELECT id, module_key, display_name, description, icon, status, implementation_level, validated_at, broken_since, deprecated_at, owner_approved, routes, core_rpcs, core_tables, services, page_dirs, pipeline_steps, pipeline_health_pct, last_health_check, health_status, readiness_score, business_priority, kb_file, decisions_total, decisions_verified, decisions_pct, depends_on, created_at, updated_at FROM public.system_modules
  ) m INTO v_modules;
  SELECT COALESCE(jsonb_agg(d ORDER BY d.module_key, d.created_at), '[]'::jsonb) FROM (
    SELECT id, module_key, decision_text, rationale, category, source_file, source_line, verifiable, verification_method, verified, verified_at, failure_reason, decided_at, tags, created_at FROM public.owner_decisions
  ) d INTO v_decisions;
  SELECT COALESCE(jsonb_agg(r ORDER BY CASE WHEN r.priority = 'critical' THEN 0 WHEN r.priority = 'high' THEN 1 WHEN r.priority = 'medium' THEN 2 WHEN r.priority = 'low' THEN 3 ELSE 4 END, r.approved_at DESC), '[]'::jsonb) FROM (
    SELECT id, title, description, status, priority, module_key, source_file, source_line, approved_at, depends_on, notes, tags, created_at, updated_at FROM public.owner_requests
  ) r INTO v_requests;
  v_required_actions := jsonb_build_array(
    jsonb_build_object('label', 'طلبات تنتظر الاعتماد', 'count', (SELECT COUNT(*) FROM public.orders WHERE status IN ('submitted', 'reviewing')), 'link', '/orders/approval-queue'),
    jsonb_build_object('label', 'عملاء تجاوزوا الحد الائتماني', 'count', (SELECT COUNT(*) FROM public.customer_credit_accounts WHERE outstanding_credit + reserved_credit > credit_limit AND credit_status = 'active'), 'link', '/credit'),
    jsonb_build_object('label', 'مرتجعات تنتظر القرار', 'count', (SELECT COUNT(*) FROM public.returns WHERE status IN ('pending', 'inspecting')), 'link', '/returns'),
    jsonb_build_object('label', 'زيارات لم يتم إنهاؤها', 'count', (SELECT COUNT(*) FROM public.visits WHERE status = 'active' AND check_out_at IS NULL), 'link', '/visits'),
    jsonb_build_object('label', 'مندوبين بلا زيارات اليوم', 'count', (SELECT COUNT(*) FROM public.employees e WHERE is_active = true AND NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.employee_id = e.id AND v.created_at >= CURRENT_DATE)), 'link', '/supervisor')
  );
  v_module_counts := jsonb_build_object(
    'orders_new', (SELECT COUNT(*) FROM public.orders WHERE created_at >= CURRENT_DATE),
    'customers_active', (SELECT COUNT(*) FROM public.customers WHERE is_active = true),
    'visits_active', (SELECT COUNT(*) FROM public.visits WHERE status = 'active'),
    'credit_due', (SELECT COUNT(*) FROM public.credit_invoices WHERE status = 'overdue'),
    'employees_active', (SELECT COUNT(*) FROM public.employees WHERE is_active = true)
  );
  SELECT COUNT(*) INTO v_total_modules FROM public.system_modules;
  SELECT COUNT(*) INTO v_healthy FROM public.system_modules WHERE health_status = 'healthy';
  SELECT COUNT(*) INTO v_degraded FROM public.system_modules WHERE health_status = 'degraded';
  SELECT COUNT(*) INTO v_down FROM public.system_modules WHERE health_status = 'down';
  SELECT COUNT(*) INTO v_broken FROM public.system_modules WHERE status = 'broken';
  SELECT COUNT(*) INTO v_production_ready FROM public.system_modules WHERE readiness_score >= 90 AND owner_approved = true AND pipeline_health_pct = 100 AND health_status = 'healthy';
  SELECT COUNT(*) INTO v_total_decisions FROM public.owner_decisions WHERE verifiable = true;
  SELECT COUNT(*) INTO v_verified_decisions FROM public.owner_decisions WHERE verifiable = true AND verified = true;
  v_summary := jsonb_build_object('total_modules', v_total_modules, 'healthy', v_healthy, 'degraded', v_degraded, 'down', v_down, 'broken', v_broken, 'production_ready', v_production_ready, 'total_verifiable_decisions', v_total_decisions, 'verified_decisions', v_verified_decisions, 'decisions_pct', CASE WHEN v_total_decisions > 0 THEN (v_verified_decisions * 100 / v_total_decisions) ELSE 0 END);
  RETURN jsonb_build_object('modules', v_modules, 'decisions', v_decisions, 'requests', v_requests, 'summary', v_summary, 'required_actions', v_required_actions, 'module_counts', v_module_counts);
END;
$function$;

-- 12c: get_module_detail
CREATE OR REPLACE FUNCTION public.get_module_detail(p_token uuid, p_module_key varchar)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_module jsonb; v_decisions jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only');
  END IF;
  SELECT row_to_json(m)::jsonb FROM (
    SELECT id, module_key, display_name, description, icon, status, implementation_level, validated_at, broken_since, deprecated_at, owner_approved, routes, core_rpcs, core_tables, services, page_dirs, pipeline_steps, pipeline_health_pct, last_health_check, health_status, readiness_score, business_priority, kb_file, decisions_total, decisions_verified, decisions_pct, depends_on, created_at, updated_at
    FROM public.system_modules WHERE module_key = p_module_key
  ) m INTO v_module;
  IF v_module IS NULL THEN RETURN jsonb_build_object('error', 'MODULE_NOT_FOUND', 'module_key', p_module_key); END IF;
  SELECT COALESCE(jsonb_agg(d ORDER BY d.created_at), '[]'::jsonb) FROM (
    SELECT id, decision_text, rationale, category, source_file, source_line, verifiable, verification_method, verified, verified_at, failure_reason, decided_at, tags, created_at
    FROM public.owner_decisions WHERE module_key = p_module_key
  ) d INTO v_decisions;
  RETURN jsonb_build_object('module', v_module, 'decisions', v_decisions);
END;
$function$;

-- 12d: update_module_owner_field
CREATE OR REPLACE FUNCTION public.update_module_owner_field(p_token uuid, p_module_key varchar, p_field varchar, p_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only');
  END IF;
  IF p_field NOT IN ('owner_approved', 'business_priority', 'status') THEN
    RETURN jsonb_build_object('error', 'FIELD_NOT_EDITABLE', 'field', p_field, 'detail', 'Only owner_approved, business_priority, and status can be edited by owner.');
  END IF;
  IF p_field = 'owner_approved' THEN
    IF p_value NOT IN ('true', 'false') THEN RETURN jsonb_build_object('error', 'INVALID_BOOLEAN'); END IF;
    UPDATE public.system_modules SET owner_approved = p_value::boolean WHERE module_key = p_module_key;
  ELSIF p_field = 'status' THEN
    IF p_value NOT IN ('planned','partial','implemented','validated','broken','deprecated') THEN RETURN jsonb_build_object('error', 'INVALID_STATUS'); END IF;
    UPDATE public.system_modules SET status = p_value WHERE module_key = p_module_key;
  ELSIF p_field = 'business_priority' THEN
    IF p_value NOT IN ('critical','high','medium','low','icebox') THEN RETURN jsonb_build_object('error', 'INVALID_PRIORITY'); END IF;
    UPDATE public.system_modules SET business_priority = p_value WHERE module_key = p_module_key;
  END IF;
  RETURN jsonb_build_object('success', true, 'module_key', p_module_key, 'field', p_field, 'value', p_value);
END;
$function$;

-- 12e: delete_module
CREATE OR REPLACE FUNCTION public.delete_module(p_token uuid, p_module_key varchar)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_status varchar;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only');
  END IF;
  SELECT status INTO v_status FROM public.system_modules WHERE module_key = p_module_key;
  IF v_status IS NULL THEN RETURN jsonb_build_object('error', 'MODULE_NOT_FOUND'); END IF;
  IF v_status != 'deprecated' THEN RETURN jsonb_build_object('error', 'CANNOT_DELETE', 'detail', 'Only deprecated modules can be deleted.'); END IF;
  DELETE FROM public.system_modules WHERE module_key = p_module_key;
  RETURN jsonb_build_object('success', true, 'module_key', p_module_key);
END;
$function$;

-- ============================================================================
-- STEP 13: GOVERNANCE FUNCTIONS (Pattern B — English role name checks)
-- ============================================================================

-- 13a: get_governed_customer_contacts
CREATE OR REPLACE FUNCTION public.get_governed_customer_contacts(p_token uuid, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type = 'customer' THEN
    IF p_customer_id IS NOT NULL AND p_customer_id != v_session.customer_id THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    SELECT jsonb_agg(jsonb_build_object('id', cc.id, 'customer_id', cc.customer_id, 'phone', cc.phone, 'full_name', cc.full_name, 'is_primary', cc.is_primary, 'email', cc.email, 'role', cc.role) ORDER BY cc.is_primary DESC NULLS LAST) INTO v_result
    FROM customer_contacts cc WHERE cc.customer_id = COALESCE(p_customer_id, v_session.customer_id);
  ELSE
    WITH v_visible_customers AS (
      SELECT c.id FROM customers c
      WHERE (p_customer_id IS NULL OR c.id = p_customer_id)
        AND (public.is_upper_management(v_session.employee_id) OR c.owner_id = v_session.employee_id OR c.owner_id = ANY(public.get_visible_employee_ids(p_token)))
    )
    SELECT jsonb_agg(jsonb_build_object('id', cc.id, 'customer_id', cc.customer_id, 'phone', cc.phone, 'full_name', cc.full_name, 'is_primary', cc.is_primary, 'email', cc.email, 'role', cc.role) ORDER BY cc.is_primary DESC NULLS LAST) INTO v_result
    FROM customer_contacts cc WHERE cc.customer_id IN (SELECT id FROM v_visible_customers);
    IF v_result IS NULL AND p_customer_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id) THEN RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND'); END IF;
    END IF;
  END IF;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- 13b: get_governed_customer_addresses
CREATE OR REPLACE FUNCTION public.get_governed_customer_addresses(p_token uuid, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type = 'customer' THEN
    IF p_customer_id IS NOT NULL AND p_customer_id != v_session.customer_id THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    SELECT jsonb_agg(jsonb_build_object('id', ca.id, 'customer_id', ca.customer_id, 'label', ca.label, 'address_line1', ca.address_line1, 'address_line2', ca.address_line2, 'city', ca.city, 'governorate', ca.governorate, 'postal_code', ca.postal_code, 'latitude', ca.latitude, 'longitude', ca.longitude, 'is_default', ca.is_default) ORDER BY ca.is_default DESC) INTO v_result
    FROM customer_addresses ca WHERE ca.customer_id = COALESCE(p_customer_id, v_session.customer_id);
  ELSE
    WITH v_visible_customers AS (
      SELECT c.id FROM customers c
      WHERE (p_customer_id IS NULL OR c.id = p_customer_id)
        AND (public.is_upper_management(v_session.employee_id) OR c.owner_id = v_session.employee_id OR c.owner_id = ANY(public.get_visible_employee_ids(p_token)))
    )
    SELECT jsonb_agg(jsonb_build_object('id', ca.id, 'customer_id', ca.customer_id, 'label', ca.label, 'address_line1', ca.address_line1, 'address_line2', ca.address_line2, 'city', ca.city, 'governorate', ca.governorate, 'postal_code', ca.postal_code, 'latitude', ca.latitude, 'longitude', ca.longitude, 'is_default', ca.is_default) ORDER BY ca.is_default DESC) INTO v_result
    FROM customer_addresses ca WHERE ca.customer_id IN (SELECT id FROM v_visible_customers);
    IF v_result IS NULL AND p_customer_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id) THEN RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND'); END IF;
    END IF;
  END IF;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- 13c: governed_global_search
CREATE OR REPLACE FUNCTION public.governed_global_search(p_token uuid, p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_result jsonb; v_ql text; v_emp_id uuid; v_is_super boolean; v_sub_ids uuid[];
  v_orders jsonb; v_companies jsonb; v_collections jsonb; v_visits jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  v_ql := '%' || p_query || '%';
  v_emp_id := v_session.employee_id;
  v_is_super := public.is_upper_management(v_emp_id);
  WITH RECURSIVE sub AS (
    SELECT e.id FROM employees e WHERE e.manager_id = v_emp_id
    UNION ALL SELECT e.id FROM employees e JOIN sub s ON e.manager_id = s.id
  )
  SELECT COALESCE(ARRAY_AGG(id), '{}'::uuid[]) INTO v_sub_ids FROM sub;
  SELECT jsonb_agg(jsonb_build_object('type','order','id',o.id,'label',o.order_number,'sublabel',COALESCE(cust.company_name,'')||' | '||COALESCE(o.total_amount::text,'0'),'path','/orders/'||o.id)) INTO v_orders
  FROM orders o LEFT JOIN customers cust ON cust.id = o.customer_id
  WHERE o.order_number ILIKE v_ql OR cust.company_name ILIKE v_ql LIMIT 5;
  SELECT jsonb_agg(jsonb_build_object('type','company','id',comp.id,'label',comp.company_name,'sublabel',COALESCE(comp.legacy_code,''),'path','/storefront/products?company='||comp.id)) INTO v_companies
  FROM companies comp WHERE comp.company_name ILIKE v_ql OR comp.legacy_code ILIKE v_ql LIMIT 5;
  SELECT jsonb_agg(jsonb_build_object('type','collection','id',col.id,'label',col.code,'sublabel',COALESCE(cust2.company_name,'')||' | '||COALESCE(col.amount::text,'0'),'path','/collections')) INTO v_collections
  FROM collections col LEFT JOIN customers cust2 ON cust2.id = col.customer_id
  WHERE (col.code ILIKE v_ql OR cust2.company_name ILIKE v_ql) AND (v_is_super OR col.created_by = v_emp_id) LIMIT 5;
  SELECT jsonb_agg(jsonb_build_object('type','visit','id',v.id,'label',COALESCE(cust3.company_name,''),'sublabel',COALESCE(v.status,''),'path','/visits/'||v.id)) INTO v_visits
  FROM visits v LEFT JOIN customers cust3 ON cust3.id = v.customer_id
  WHERE cust3.company_name ILIKE v_ql AND (v_is_super OR v.employee_id = v_emp_id OR v.employee_id = ANY(v_sub_ids)) LIMIT 5;
  v_result := COALESCE(v_orders, '[]'::jsonb) || COALESCE(v_companies, '[]'::jsonb) || COALESCE(v_collections, '[]'::jsonb) || COALESCE(v_visits, '[]'::jsonb);
  RETURN v_result;
END;
$function$;

-- ============================================================================
-- STEP 14: WORK POLICIES FUNCTION (Pattern D — Arabic role name check)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_work_policies_report(p_token uuid, p_from date, p_to date, p_employee_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'total_work_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND status = 'completed' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
      'ontime_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'ontime' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
      'late_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'late' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
      'total_late_minutes', (SELECT COALESCE(SUM(late_minutes), 0) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'late' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
      'early_departure_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'early_departure' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
      'total_early_departure_minutes', (SELECT COALESCE(SUM(early_departure_minutes), 0) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'early_departure' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
      'absent_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'absent' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids)))
    ),
    'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'employee_id', sub.employee_id, 'name', sub.employee_name,
      'work_days', sub.work_days, 'ontime_days', sub.ontime_days, 'late_days', sub.late_days,
      'late_minutes', sub.late_minutes, 'early_departure_days', sub.early_departure_days,
      'early_departure_minutes', sub.early_departure_minutes, 'absent_days', sub.absent_days,
      'compliance_rate', CASE WHEN sub.work_days > 0 THEN ROUND((sub.ontime_days::numeric / sub.work_days) * 100, 1) ELSE 0 END
    ) ORDER BY sub.compliance_rate DESC)), '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT wds.employee_id, e.full_name AS employee_name,
      COUNT(*) AS work_days,
      COUNT(*) FILTER (WHERE wds.attendance_status = 'ontime') AS ontime_days,
      COUNT(*) FILTER (WHERE wds.attendance_status = 'late') AS late_days,
      COALESCE(SUM(wds.late_minutes) FILTER (WHERE wds.attendance_status = 'late'), 0) AS late_minutes,
      COUNT(*) FILTER (WHERE wds.attendance_status = 'early_departure') AS early_departure_days,
      COALESCE(SUM(wds.early_departure_minutes) FILTER (WHERE wds.attendance_status = 'early_departure'), 0) AS early_departure_minutes,
      COUNT(*) FILTER (WHERE wds.attendance_status IN ('absent', 'unknown')) AS absent_days
    FROM public.workday_sessions wds JOIN public.employees e ON e.id = wds.employee_id
      AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
    WHERE wds.date >= p_from AND wds.date <= p_to AND wds.status = 'completed'
      AND (p_employee_ids IS NULL OR wds.employee_id = ANY(p_employee_ids))
    GROUP BY wds.employee_id, e.full_name
  ) sub;
  RETURN v_result;
END;
$function$;

-- ============================================================================
-- STEP 15: ACTIVE EMPLOYEES FUNCTION (Pattern D — update role classification + exclusion)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_active_employees(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  SELECT jsonb_agg(
    jsonb_build_object(
      'employee_id', e.id, 'employee_code', e.code, 'employee_name', e.full_name,
      'employee_manager_id', e.manager_id,
      'role_type', CASE
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = e.id AND r.name = 'الإدارة العليا') THEN 'مدير'
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = e.id AND r.name IN ('مدير البيع', 'مدير تنفيذي')) THEN 'مدير البيع'
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = e.id AND r.name IN ('مشرف مبيعات', 'مشرف تنفيذي')) THEN 'سوبر فايزر'
        ELSE 'مندوب'
      END,
      'has_team', EXISTS (SELECT 1 FROM public.employees sub WHERE sub.manager_id = e.id)
    ) ORDER BY e.full_name
  ) INTO v_result
  FROM public.employees e
  WHERE e.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id
      WHERE er.employee_id = e.id AND r.name = 'الإدارة العليا'
    );
  RETURN COALESCE(v_result, jsonb_build_array());
END;
$function$;

-- ============================================================================
-- STEP 16: MONTHLY TARGETS — NEW CUSTOMERS (guard-pattern: سوبر أدمن → is_upper_management)
-- Source: supabase/migrations/20260612_monthly_targets_new_customers.sql
-- 6 functions: get_governed_company_monthly_target, governed_upsert_company_monthly_target,
--   get_governed_employee_monthly_targets, governed_upsert_employee_monthly_target,
--   get_governed_target_performance, get_upper_management_dashboard
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_company_monthly_target(
    p_token uuid, p_month int DEFAULT NULL, p_year int DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
    v_session app.sessions;
    v_target_month int; v_target_year int; v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
    SELECT jsonb_build_object(
        'id', t.id, 'target_month', t.target_month, 'target_year', t.target_year,
        'sales_target', t.sales_target, 'visits_target', t.visits_target, 'orders_target', t.orders_target,
        'new_customers_target', t.new_customers_target,
        'sales_weight_percent', t.sales_weight_percent, 'visits_weight_percent', t.visits_weight_percent,
        'orders_weight_percent', t.orders_weight_percent, 'new_customers_weight_percent', t.new_customers_weight_percent,
        'is_locked', t.is_locked
    ) INTO v_result
    FROM public.company_monthly_targets t
    WHERE t.target_month = v_target_month AND t.target_year = v_target_year;
    RETURN COALESCE(v_result, 'null'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.governed_upsert_company_monthly_target(
    p_token uuid, p_target_month int, p_target_year int,
    p_sales_target numeric DEFAULT 0, p_visits_target numeric DEFAULT 0, p_orders_target numeric DEFAULT 0,
    p_new_customers_target numeric DEFAULT 0,
    p_sales_weight_percent numeric DEFAULT 40, p_visits_weight_percent numeric DEFAULT 20,
    p_orders_weight_percent numeric DEFAULT 20, p_new_customers_weight_percent numeric DEFAULT 20
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
    v_session app.sessions; v_existing_locked boolean; v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    IF (p_sales_weight_percent + p_visits_weight_percent + p_orders_weight_percent + p_new_customers_weight_percent) != 100 THEN
        RETURN jsonb_build_object('error', 'INVALID_WEIGHTS', 'detail', 'مجموع النسب يجب أن يساوي 100%');
    END IF;
    SELECT is_locked INTO v_existing_locked
    FROM public.company_monthly_targets
    WHERE target_month = p_target_month AND target_year = p_target_year;
    IF v_existing_locked THEN
        RETURN jsonb_build_object('error', 'LOCKED', 'detail', 'لا يمكن تعديل هدف شهر مغلق');
    END IF;
    INSERT INTO public.company_monthly_targets
        (target_month, target_year, sales_target, visits_target, orders_target, new_customers_target,
         sales_weight_percent, visits_weight_percent, orders_weight_percent, new_customers_weight_percent)
    VALUES
        (p_target_month, p_target_year, p_sales_target, p_visits_target, p_orders_target, p_new_customers_target,
         p_sales_weight_percent, p_visits_weight_percent, p_orders_weight_percent, p_new_customers_weight_percent)
    ON CONFLICT (target_month, target_year)
    DO UPDATE SET
        sales_target = EXCLUDED.sales_target, visits_target = EXCLUDED.visits_target,
        orders_target = EXCLUDED.orders_target, new_customers_target = EXCLUDED.new_customers_target,
        sales_weight_percent = EXCLUDED.sales_weight_percent, visits_weight_percent = EXCLUDED.visits_weight_percent,
        orders_weight_percent = EXCLUDED.orders_weight_percent, new_customers_weight_percent = EXCLUDED.new_customers_weight_percent,
        updated_at = now()
    RETURNING jsonb_build_object(
        'id', id, 'target_month', target_month, 'target_year', target_year,
        'sales_target', sales_target, 'visits_target', visits_target, 'orders_target', orders_target,
        'new_customers_target', new_customers_target,
        'sales_weight_percent', sales_weight_percent, 'visits_weight_percent', visits_weight_percent,
        'orders_weight_percent', orders_weight_percent, 'new_customers_weight_percent', new_customers_weight_percent,
        'is_locked', is_locked
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_governed_employee_monthly_targets(
    p_token uuid, p_month int DEFAULT NULL, p_year int DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
    v_session app.sessions; v_target_month int; v_target_year int; v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
    SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'employee_id', t.employee_id, 'employee_code', e.code, 'employee_name', e.full_name,
        'target_month', t.target_month, 'target_year', t.target_year,
        'sales_target', t.sales_target, 'visits_target', t.visits_target, 'orders_target', t.orders_target,
        'new_customers_target', t.new_customers_target, 'is_locked', t.is_locked
    ) ORDER BY e.full_name) INTO v_result
    FROM public.employee_monthly_targets t
    JOIN public.employees e ON e.id = t.employee_id
    WHERE t.target_month = v_target_month AND t.target_year = v_target_year;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.governed_upsert_employee_monthly_target(
    p_token uuid, p_employee_id uuid, p_target_month int, p_target_year int,
    p_sales_target numeric DEFAULT 0, p_visits_target numeric DEFAULT 0,
    p_orders_target numeric DEFAULT 0, p_new_customers_target numeric DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
    v_session app.sessions; v_existing_locked boolean; v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    SELECT is_locked INTO v_existing_locked
    FROM public.employee_monthly_targets
    WHERE employee_id = p_employee_id AND target_month = p_target_month AND target_year = p_target_year;
    IF v_existing_locked THEN
        RETURN jsonb_build_object('error', 'LOCKED', 'detail', 'لا يمكن تعديل هدف شهر مغلق');
    END IF;
    INSERT INTO public.employee_monthly_targets
        (employee_id, target_month, target_year, sales_target, visits_target, orders_target, new_customers_target)
    VALUES
        (p_employee_id, p_target_month, p_target_year, p_sales_target, p_visits_target, p_orders_target, p_new_customers_target)
    ON CONFLICT (employee_id, target_month, target_year)
    DO UPDATE SET
        sales_target = EXCLUDED.sales_target, visits_target = EXCLUDED.visits_target,
        orders_target = EXCLUDED.orders_target, new_customers_target = EXCLUDED.new_customers_target,
        updated_at = now()
    RETURNING jsonb_build_object(
        'id', id, 'employee_id', employee_id, 'target_month', target_month, 'target_year', target_year,
        'sales_target', sales_target, 'visits_target', visits_target, 'orders_target', orders_target,
        'new_customers_target', new_customers_target, 'is_locked', is_locked
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_governed_target_performance(
    p_token uuid, p_month int DEFAULT NULL, p_year int DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
    v_session app.sessions;
    v_target_month int; v_target_year int; v_company_target record;
    v_sales_weight numeric; v_visits_weight numeric; v_orders_weight numeric; v_new_customers_weight numeric;
    v_company_delivered_sales numeric; v_company_completed_visits int;
    v_company_delivered_orders int; v_company_new_customers int;
    v_company_return_deductions numeric; v_company_full_returns int;
    v_company_effective_sales numeric; v_company_effective_orders int;
    v_company_sales_pct numeric; v_company_visits_pct numeric;
    v_company_orders_pct numeric; v_company_new_customers_pct numeric;
    v_company_overall numeric;
    v_employee_perf jsonb; v_best_employee jsonb; v_weakest_employee jsonb;
    v_company_info jsonb;
    v_month_start timestamptz; v_month_end timestamptz;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
    v_month_start := date_trunc('month', to_timestamp(v_target_year || '-' || v_target_month || '-01', 'YYYY-MM-DD'));
    v_month_end := v_month_start + INTERVAL '1 month';
    SELECT * INTO v_company_target FROM public.company_monthly_targets
    WHERE target_month = v_target_month AND target_year = v_target_year;
    IF NOT FOUND THEN RETURN jsonb_build_object('has_target', false, 'company', 'null'::jsonb, 'employees', '[]'::jsonb, 'best_employee', 'null'::jsonb, 'weakest_employee', 'null'::jsonb); END IF;
    v_sales_weight := v_company_target.sales_weight_percent;
    v_visits_weight := v_company_target.visits_weight_percent;
    v_orders_weight := v_company_target.orders_weight_percent;
    v_new_customers_weight := v_company_target.new_customers_weight_percent;
    SELECT COALESCE(SUM(o.total_amount), 0) INTO v_company_delivered_sales
    FROM public.orders o WHERE o.status = 'delivered' AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end;
    SELECT COUNT(*)::int INTO v_company_completed_visits
    FROM public.visits v WHERE v.status = 'completed' AND v.check_out_at >= v_month_start AND v.check_out_at < v_month_end;
    SELECT COUNT(*)::int INTO v_company_delivered_orders
    FROM public.orders o WHERE o.status = 'delivered' AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end;
    SELECT COUNT(*)::int INTO v_company_new_customers
    FROM public.customers c WHERE EXISTS (
        SELECT 1 FROM public.orders o WHERE o.customer_id = c.id AND o.status = 'delivered'
        AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end
        AND o.delivered_at = (SELECT MIN(o2.delivered_at) FROM public.orders o2 WHERE o2.customer_id = c.id AND o2.status = 'delivered'));
    SELECT COALESCE(SUM(r.credit_note_amount), 0), COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int
    INTO v_company_return_deductions, v_company_full_returns
    FROM public.returns r LEFT JOIN (
        SELECT r2.order_id FROM public.returns r2 JOIN public.return_items ri ON ri.return_id = r2.id
        JOIN public.products p ON p.id = ri.product_id
        JOIN (SELECT oi.order_id, SUM(oi.piece_quantity) AS total_pieces FROM public.order_items oi GROUP BY oi.order_id) oi ON oi.order_id = r2.order_id
        WHERE r2.status = 'approved' AND r2.created_at >= v_month_start AND r2.created_at < v_month_end
        GROUP BY r2.order_id, oi.total_pieces
        HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi.total_pieces
    ) fr ON fr.order_id = r.order_id
    WHERE r.status = 'approved' AND r.created_at >= v_month_start AND r.created_at < v_month_end;
    v_company_effective_sales := GREATEST(v_company_delivered_sales - v_company_return_deductions, 0);
    v_company_effective_orders := GREATEST(v_company_delivered_orders - v_company_full_returns, 0);
    v_company_sales_pct := CASE WHEN v_company_target.sales_target > 0 THEN ROUND((v_company_effective_sales / v_company_target.sales_target * 100)::numeric, 2) ELSE 0 END;
    v_company_visits_pct := CASE WHEN v_company_target.visits_target > 0 THEN ROUND((v_company_completed_visits::numeric / v_company_target.visits_target * 100)::numeric, 2) ELSE 0 END;
    v_company_orders_pct := CASE WHEN v_company_target.orders_target > 0 THEN ROUND((v_company_effective_orders::numeric / v_company_target.orders_target * 100)::numeric, 2) ELSE 0 END;
    v_company_new_customers_pct := CASE WHEN v_company_target.new_customers_target > 0 THEN ROUND((v_company_new_customers::numeric / v_company_target.new_customers_target * 100)::numeric, 2) ELSE 0 END;
    v_company_overall := ROUND((v_company_sales_pct * v_sales_weight / 100) + (v_company_visits_pct * v_visits_weight / 100) + (v_company_orders_pct * v_orders_weight / 100) + (v_company_new_customers_pct * v_new_customers_weight / 100), 2);
    v_company_info := jsonb_build_object(
        'sales_target', v_company_target.sales_target, 'visits_target', v_company_target.visits_target,
        'orders_target', v_company_target.orders_target, 'new_customers_target', v_company_target.new_customers_target,
        'sales_actual', v_company_effective_sales, 'visits_actual', v_company_completed_visits,
        'orders_actual', v_company_effective_orders, 'new_customers_actual', v_company_new_customers,
        'return_deductions', v_company_return_deductions, 'full_returns', v_company_full_returns,
        'sales_weight_percent', v_sales_weight, 'visits_weight_percent', v_visits_weight,
        'orders_weight_percent', v_orders_weight, 'new_customers_weight_percent', v_new_customers_weight,
        'sales_achievement_pct', v_company_sales_pct, 'visits_achievement_pct', v_company_visits_pct,
        'orders_achievement_pct', v_company_orders_pct, 'new_customers_achievement_pct', v_company_new_customers_pct,
        'overall_achievement_pct', v_company_overall, 'is_locked', v_company_target.is_locked
    );
    WITH employee_orders AS (
        SELECT COALESCE(emp.id, emp2.id) AS employee_id, o.total_amount, o.id AS order_id, o.customer_id, o.delivered_at
        FROM public.orders o LEFT JOIN public.employees emp ON o.owner_id = emp.id LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
        WHERE o.status = 'delivered' AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end
    ), employee_sales AS (
        SELECT employee_id, COALESCE(SUM(total_amount), 0) AS sales_actual, COUNT(DISTINCT order_id)::int AS orders_actual
        FROM employee_orders GROUP BY employee_id
    ), employee_visits AS (
        SELECT v.employee_id, COUNT(*)::int AS visits_actual FROM public.visits v
        WHERE v.status = 'completed' AND v.check_out_at >= v_month_start AND v.check_out_at < v_month_end GROUP BY v.employee_id
    ), employee_new_customers AS (
        SELECT eo.employee_id, COUNT(DISTINCT eo.customer_id)::int AS new_customers_actual
        FROM employee_orders eo WHERE eo.delivered_at = (SELECT MIN(o2.delivered_at) FROM public.orders o2 WHERE o2.customer_id = eo.customer_id AND o2.status = 'delivered')
        GROUP BY eo.employee_id
    ), employee_returns AS (
        SELECT COALESCE(emp.id, emp2.id) AS employee_id,
            COALESCE(SUM(r.credit_note_amount), 0) AS return_deduction,
            COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int AS full_returns
        FROM public.returns r JOIN public.orders o ON o.id = r.order_id
        LEFT JOIN public.employees emp ON o.owner_id = emp.id LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
        LEFT JOIN (
            SELECT r3.order_id FROM public.returns r3 JOIN public.return_items ri ON ri.return_id = r3.id
            JOIN public.products p ON p.id = ri.product_id
            JOIN (SELECT oi2.order_id, SUM(oi2.piece_quantity) AS total_pieces FROM public.order_items oi2 GROUP BY oi2.order_id) oi3 ON oi3.order_id = r3.order_id
            WHERE r3.status = 'approved' AND r3.created_at >= v_month_start AND r3.created_at < v_month_end
            GROUP BY r3.order_id, oi3.total_pieces
            HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi3.total_pieces
        ) fr ON fr.order_id = r.order_id
        WHERE r.status = 'approved' AND r.created_at >= v_month_start AND r.created_at < v_month_end
        GROUP BY COALESCE(emp.id, emp2.id)
    ), employee_calc AS (
        SELECT et.employee_id, e.code AS employee_code, e.full_name AS employee_name,
            et.sales_target, et.visits_target, et.orders_target, et.new_customers_target,
            COALESCE(s.sales_actual, 0) AS gross_sales, COALESCE(v.visits_actual, 0) AS visits_actual,
            COALESCE(s.orders_actual, 0) AS gross_orders, COALESCE(nc.new_customers_actual, 0) AS new_customers_actual,
            COALESCE(rd.return_deduction, 0) AS return_deduction, COALESCE(rd.full_returns, 0) AS full_returns,
            GREATEST(COALESCE(s.sales_actual, 0) - COALESCE(rd.return_deduction, 0), 0) AS effective_sales,
            GREATEST(COALESCE(s.orders_actual, 0) - COALESCE(rd.full_returns, 0), 0) AS effective_orders,
            et.is_locked
        FROM public.employee_monthly_targets et JOIN public.employees e ON e.id = et.employee_id
        LEFT JOIN employee_sales s ON s.employee_id = et.employee_id
        LEFT JOIN employee_visits v ON v.employee_id = et.employee_id
        LEFT JOIN employee_new_customers nc ON nc.employee_id = et.employee_id
        LEFT JOIN employee_returns rd ON rd.employee_id = et.employee_id
        WHERE et.target_month = v_target_month AND et.target_year = v_target_year
    )
    SELECT jsonb_agg(jsonb_build_object(
        'employee_id', ec.employee_id, 'employee_code', ec.employee_code, 'employee_name', ec.employee_name,
        'sales_target', ec.sales_target, 'visits_target', ec.visits_target, 'orders_target', ec.orders_target, 'new_customers_target', ec.new_customers_target,
        'gross_sales', ec.gross_sales, 'visits_actual', ec.visits_actual, 'gross_orders', ec.gross_orders,
        'new_customers_actual', ec.new_customers_actual, 'return_deduction', ec.return_deduction, 'full_returns', ec.full_returns,
        'effective_sales', ec.effective_sales, 'effective_orders', ec.effective_orders,
        'sales_achievement_pct', CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END,
        'visits_achievement_pct', CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END,
        'orders_achievement_pct', CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END,
        'new_customers_achievement_pct', CASE WHEN ec.new_customers_target > 0 THEN ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2) ELSE 0 END,
        'overall_achievement_score', ROUND(
            (CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END * v_sales_weight / 100) +
            (CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END * v_visits_weight / 100) +
            (CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END * v_orders_weight / 100) +
            (CASE WHEN ec.new_customers_target > 0 THEN ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2) ELSE 0 END * v_new_customers_weight / 100), 2),
        'is_locked', ec.is_locked
    ) ORDER BY
        (CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END * v_sales_weight / 100) +
        (CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END * v_visits_weight / 100) +
        (CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END * v_orders_weight / 100) +
        (CASE WHEN ec.new_customers_target > 0 THEN ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2) ELSE 0 END * v_new_customers_weight / 100) DESC
    ) INTO v_employee_perf FROM employee_calc ec;
    IF jsonb_array_length(v_employee_perf) > 0 THEN
        v_best_employee := v_employee_perf->0;
        v_weakest_employee := v_employee_perf->(jsonb_array_length(v_employee_perf) - 1);
    END IF;
    RETURN jsonb_build_object('has_target', true, 'company', v_company_info, 'employees', COALESCE(v_employee_perf, '[]'::jsonb), 'best_employee', v_best_employee, 'weakest_employee', v_weakest_employee);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_upper_management_dashboard(p_token uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_new_orders int; v_pending_orders int; v_active_visits int; v_today_visits int;
  v_new_customers int; v_stagnant_customers int; v_daily_sales numeric; v_monthly_sales numeric;
  v_best_rep jsonb; v_weakest_rep jsonb; v_total_customers int; v_total_reps int;
  v_company_target public.company_monthly_targets; v_target_month int; v_target_year int;
  v_month_start timestamptz; v_month_end timestamptz;
  v_delivered_sales numeric; v_completed_visits int; v_delivered_orders int;
  v_new_customers_achieved int; v_return_deductions numeric; v_full_returns int;
  v_effective_sales numeric; v_effective_orders int;
  v_sales_pct numeric; v_visits_pct numeric; v_orders_pct numeric; v_new_customers_pct numeric;
  v_overall numeric; v_employee_perf jsonb; v_best_target_employee jsonb; v_weakest_target_employee jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only'); END IF;
  SELECT COUNT(*) INTO v_new_orders FROM public.orders WHERE created_at >= CURRENT_DATE;
  SELECT COUNT(*) INTO v_pending_orders FROM public.orders WHERE status IN ('draft', 'reviewing', 'submitted');
  SELECT COUNT(*) INTO v_active_visits FROM public.visits WHERE status = 'active';
  SELECT COUNT(*) INTO v_today_visits FROM public.visits WHERE created_at >= CURRENT_DATE;
  SELECT COUNT(*) INTO v_new_customers FROM public.customers WHERE created_at >= date_trunc('month', CURRENT_DATE);
  SELECT COUNT(*) INTO v_stagnant_customers FROM public.customers WHERE is_active = true AND NOT EXISTS (SELECT 1 FROM public.orders WHERE customer_id = customers.id AND created_at >= CURRENT_DATE - INTERVAL '90 days');
  SELECT COALESCE(SUM(total_amount), 0) INTO v_daily_sales FROM public.orders WHERE status NOT IN ('draft', 'cancelled') AND submitted_at >= CURRENT_DATE;
  SELECT COALESCE(SUM(total_amount), 0) INTO v_monthly_sales FROM public.orders WHERE status NOT IN ('draft', 'cancelled') AND submitted_at >= date_trunc('month', CURRENT_DATE);
  SELECT COUNT(*) INTO v_total_customers FROM public.customers;
  SELECT COUNT(*) INTO v_total_reps FROM public.employees;
  SELECT jsonb_build_object('id', e.id, 'code', e.code, 'name', e.full_name, 'total_sales', COALESCE(SUM(o.total_amount), 0)) INTO v_best_rep
  FROM public.employees e JOIN public.orders o ON o.owner_id IN (e.id, e.identity_id)
  WHERE o.status NOT IN ('draft', 'cancelled') AND o.submitted_at >= date_trunc('month', CURRENT_DATE)
  GROUP BY e.id, e.code, e.full_name ORDER BY COALESCE(SUM(o.total_amount), 0) DESC LIMIT 1;
  SELECT jsonb_build_object('id', e.id, 'code', e.code, 'name', e.full_name, 'total_sales', COALESCE(SUM(o.total_amount), 0)) INTO v_weakest_rep
  FROM public.employees e JOIN public.orders o ON o.owner_id IN (e.id, e.identity_id)
  WHERE o.status NOT IN ('draft', 'cancelled') AND o.submitted_at >= date_trunc('month', CURRENT_DATE)
  GROUP BY e.id, e.code, e.full_name ORDER BY COALESCE(SUM(o.total_amount), 0) ASC LIMIT 1;
  v_target_month := EXTRACT(MONTH FROM CURRENT_DATE)::int;
  v_target_year := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  v_month_start := date_trunc('month', CURRENT_DATE);
  v_month_end := v_month_start + INTERVAL '1 month';
  SELECT * INTO v_company_target FROM public.company_monthly_targets WHERE target_month = v_target_month AND target_year = v_target_year;
  IF FOUND THEN
    SELECT COALESCE(SUM(o.total_amount), 0) INTO v_delivered_sales FROM public.orders o WHERE o.status = 'delivered' AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end;
    SELECT COUNT(*)::int INTO v_completed_visits FROM public.visits v WHERE v.status = 'completed' AND v.check_out_at >= v_month_start AND v.check_out_at < v_month_end;
    SELECT COUNT(*)::int INTO v_delivered_orders FROM public.orders o WHERE o.status = 'delivered' AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end;
    SELECT COUNT(*)::int INTO v_new_customers_achieved FROM public.customers c WHERE EXISTS (
        SELECT 1 FROM public.orders o WHERE o.customer_id = c.id AND o.status = 'delivered'
        AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end
        AND o.delivered_at = (SELECT MIN(o2.delivered_at) FROM public.orders o2 WHERE o2.customer_id = c.id AND o2.status = 'delivered'));
    SELECT COALESCE(SUM(r.credit_note_amount), 0), COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int
    INTO v_return_deductions, v_full_returns
    FROM public.returns r LEFT JOIN (
        SELECT r2.order_id FROM public.returns r2 JOIN public.return_items ri ON ri.return_id = r2.id
        JOIN public.products p ON p.id = ri.product_id
        JOIN (SELECT oi.order_id, SUM(oi.piece_quantity) AS total_pieces FROM public.order_items oi GROUP BY oi.order_id) oi ON oi.order_id = r2.order_id
        WHERE r2.status = 'approved' AND r2.created_at >= v_month_start AND r2.created_at < v_month_end
        GROUP BY r2.order_id, oi.total_pieces
        HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi.total_pieces
    ) fr ON fr.order_id = r.order_id
    WHERE r.status = 'approved' AND r.created_at >= v_month_start AND r.created_at < v_month_end;
    v_effective_sales := GREATEST(v_delivered_sales - v_return_deductions, 0);
    v_effective_orders := GREATEST(v_delivered_orders - v_full_returns, 0);
    v_sales_pct := CASE WHEN v_company_target.sales_target > 0 THEN ROUND((v_effective_sales / v_company_target.sales_target * 100)::numeric, 2) ELSE 0 END;
    v_visits_pct := CASE WHEN v_company_target.visits_target > 0 THEN ROUND((v_completed_visits::numeric / v_company_target.visits_target * 100)::numeric, 2) ELSE 0 END;
    v_orders_pct := CASE WHEN v_company_target.orders_target > 0 THEN ROUND((v_effective_orders::numeric / v_company_target.orders_target * 100)::numeric, 2) ELSE 0 END;
    v_new_customers_pct := CASE WHEN v_company_target.new_customers_target > 0 THEN ROUND((v_new_customers_achieved::numeric / v_company_target.new_customers_target * 100)::numeric, 2) ELSE 0 END;
    v_overall := ROUND((v_sales_pct * v_company_target.sales_weight_percent / 100) + (v_visits_pct * v_company_target.visits_weight_percent / 100) + (v_orders_pct * v_company_target.orders_weight_percent / 100) + (v_new_customers_pct * v_company_target.new_customers_weight_percent / 100), 2);
    WITH employee_orders AS (
        SELECT COALESCE(emp.id, emp2.id) AS employee_id, o.total_amount, o.id AS order_id, o.customer_id, o.delivered_at
        FROM public.orders o LEFT JOIN public.employees emp ON o.owner_id = emp.id LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
        WHERE o.status = 'delivered' AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end
    ), employee_sales AS (
        SELECT employee_id, COALESCE(SUM(total_amount), 0) AS sales_actual, COUNT(DISTINCT order_id)::int AS orders_actual
        FROM employee_orders GROUP BY employee_id
    ), employee_visits AS (
        SELECT v.employee_id, COUNT(*)::int AS visits_actual FROM public.visits v
        WHERE v.status = 'completed' AND v.check_out_at >= v_month_start AND v.check_out_at < v_month_end GROUP BY v.employee_id
    ), employee_new_customers AS (
        SELECT eo.employee_id, COUNT(DISTINCT eo.customer_id)::int AS new_customers_actual
        FROM employee_orders eo WHERE eo.delivered_at = (SELECT MIN(o2.delivered_at) FROM public.orders o2 WHERE o2.customer_id = eo.customer_id AND o2.status = 'delivered')
        GROUP BY eo.employee_id
    ), employee_returns AS (
        SELECT COALESCE(emp.id, emp2.id) AS employee_id, COALESCE(SUM(r.credit_note_amount), 0) AS return_deduction,
            COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int AS full_returns
        FROM public.returns r JOIN public.orders o ON o.id = r.order_id
        LEFT JOIN public.employees emp ON o.owner_id = emp.id LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
        LEFT JOIN (
            SELECT r3.order_id FROM public.returns r3 JOIN public.return_items ri ON ri.return_id = r3.id
            JOIN public.products p ON p.id = ri.product_id
            JOIN (SELECT oi2.order_id, SUM(oi2.piece_quantity) AS total_pieces FROM public.order_items oi2 GROUP BY oi2.order_id) oi3 ON oi3.order_id = r3.order_id
            WHERE r3.status = 'approved' AND r3.created_at >= v_month_start AND r3.created_at < v_month_end
            GROUP BY r3.order_id, oi3.total_pieces
            HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi3.total_pieces
        ) fr ON fr.order_id = r.order_id
        WHERE r.status = 'approved' AND r.created_at >= v_month_start AND r.created_at < v_month_end
        GROUP BY COALESCE(emp.id, emp2.id)
    ), employee_calc AS (
        SELECT et.employee_id, e.code AS employee_code, e.full_name AS employee_name,
            et.sales_target, et.visits_target, et.orders_target, et.new_customers_target,
            COALESCE(s.sales_actual, 0) - COALESCE(rd.return_deduction, 0) AS effective_sales,
            COALESCE(v.visits_actual, 0) AS visits_actual,
            COALESCE(s.orders_actual, 0) - COALESCE(rd.full_returns, 0) AS effective_orders,
            COALESCE(nc.new_customers_actual, 0) AS new_customers_actual
        FROM public.employee_monthly_targets et JOIN public.employees e ON e.id = et.employee_id
        LEFT JOIN employee_sales s ON s.employee_id = et.employee_id LEFT JOIN employee_visits v ON v.employee_id = et.employee_id
        LEFT JOIN employee_new_customers nc ON nc.employee_id = et.employee_id LEFT JOIN employee_returns rd ON rd.employee_id = et.employee_id
        WHERE et.target_month = v_target_month AND et.target_year = v_target_year
    )
    SELECT jsonb_agg(jsonb_build_object(
        'employee_id', ec.employee_id, 'employee_code', ec.employee_code, 'employee_name', ec.employee_name,
        'overall_achievement_score', ROUND(
            (CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END * v_company_target.sales_weight_percent / 100) +
            (CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END * v_company_target.visits_weight_percent / 100) +
            (CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END * v_company_target.orders_weight_percent / 100) +
            (CASE WHEN ec.new_customers_target > 0 THEN ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2) ELSE 0 END * v_company_target.new_customers_weight_percent / 100), 2)
    ) ORDER BY
        (CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END * v_company_target.sales_weight_percent / 100) +
        (CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END * v_company_target.visits_weight_percent / 100) +
        (CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END * v_company_target.orders_weight_percent / 100) +
        (CASE WHEN ec.new_customers_target > 0 THEN ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2) ELSE 0 END * v_company_target.new_customers_weight_percent / 100) DESC
    ) INTO v_employee_perf FROM employee_calc ec;
    IF jsonb_array_length(v_employee_perf) > 0 THEN
        v_best_target_employee := v_employee_perf->0;
        v_weakest_target_employee := v_employee_perf->(jsonb_array_length(v_employee_perf) - 1);
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'new_orders', COALESCE(v_new_orders, 0), 'pending_orders', COALESCE(v_pending_orders, 0),
    'active_visits', COALESCE(v_active_visits, 0), 'today_visits', COALESCE(v_today_visits, 0),
    'new_customers', COALESCE(v_new_customers, 0), 'stagnant_customers', COALESCE(v_stagnant_customers, 0),
    'daily_sales', COALESCE(v_daily_sales, 0), 'monthly_sales', COALESCE(v_monthly_sales, 0),
    'best_rep', COALESCE(v_best_rep, 'null'::jsonb), 'weakest_rep', COALESCE(v_weakest_rep, 'null'::jsonb),
    'total_customers', COALESCE(v_total_customers, 0), 'total_reps', COALESCE(v_total_reps, 0),
    'has_target', FOUND,
    'company_sales_target', COALESCE(v_company_target.sales_target, 0),
    'company_visits_target', COALESCE(v_company_target.visits_target, 0),
    'company_orders_target', COALESCE(v_company_target.orders_target, 0),
    'company_new_customers_target', COALESCE(v_company_target.new_customers_target, 0),
    'company_sales_actual', COALESCE(v_effective_sales, 0),
    'company_visits_actual', COALESCE(v_completed_visits, 0),
    'company_orders_actual', COALESCE(v_effective_orders, 0),
    'company_new_customers_actual', COALESCE(v_new_customers_achieved, 0),
    'sales_weight_percent', COALESCE(v_company_target.sales_weight_percent, 0),
    'visits_weight_percent', COALESCE(v_company_target.visits_weight_percent, 0),
    'orders_weight_percent', COALESCE(v_company_target.orders_weight_percent, 0),
    'new_customers_weight_percent', COALESCE(v_company_target.new_customers_weight_percent, 0),
    'company_sales_achievement_pct', COALESCE(v_sales_pct, 0),
    'company_visits_achievement_pct', COALESCE(v_visits_pct, 0),
    'company_orders_achievement_pct', COALESCE(v_orders_pct, 0),
    'company_new_customers_achievement_pct', COALESCE(v_new_customers_pct, 0),
    'company_overall_achievement_pct', COALESCE(v_overall, 0),
    'best_target_employee', COALESCE(v_best_target_employee, 'null'::jsonb),
    'weakest_target_employee', COALESCE(v_weakest_target_employee, 'null'::jsonb)
  );
END;
$function$;

-- ============================================================================
-- STEP 17: DRILLDOWN PERFORMANCE RPCS
-- Source: supabase/migrations/20260612_drilldown_performance_rpcs.sql
-- 4 functions: guard-pattern سوبر أدمن → is_upper_management
-- NOTE: get_kpi_contributors also excludes الإدارة العليا from contributor list
-- NOTE: get_kpi_contributors role_type classification query unchanged (مدير المبيعات/مدير تنفيذي still exist as roles)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kpi_contributors(
  p_token uuid, p_kpi_type text, p_month int DEFAULT NULL, p_year int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_target_month int; v_target_year int;
  v_month_start timestamptz; v_month_end timestamptz;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
  v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
  v_month_end := v_month_start + INTERVAL '1 month';
  WITH RECURSIVE ancestor_map AS (
    SELECT id AS descendant_id, id AS ancestor_id FROM public.employees WHERE is_active = true
    UNION ALL
    SELECT am.descendant_id, e.manager_id FROM ancestor_map am
    JOIN public.employees e ON e.id = am.ancestor_id WHERE e.manager_id IS NOT NULL
  ), delivered_orders AS (
    SELECT o.*, COALESCE(emp.id, emp2.id) AS resolved_employee_id
    FROM public.orders o LEFT JOIN public.employees emp ON o.owner_id = emp.id LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
    WHERE o.status = 'delivered' AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end
  ), completed_visits AS (
    SELECT * FROM public.visits v WHERE v.status = 'completed' AND v.check_out_at >= v_month_start AND v.check_out_at < v_month_end
  ), emp_orders AS (
    SELECT resolved_employee_id AS employee_id, COUNT(DISTINCT id)::int AS order_count, COALESCE(SUM(total_amount), 0) AS sales_amount
    FROM delivered_orders GROUP BY resolved_employee_id
  ), emp_visits AS (
    SELECT employee_id, COUNT(*)::int AS visit_count FROM completed_visits GROUP BY employee_id
  ), emp_new_customers AS (
    SELECT resolved_employee_id AS employee_id, COUNT(DISTINCT customer_id)::int AS new_customer_count
    FROM delivered_orders do2 WHERE do2.delivered_at = (SELECT MIN(o3.delivered_at) FROM public.orders o3 WHERE o3.customer_id = do2.customer_id AND o3.status = 'delivered')
    GROUP BY resolved_employee_id
  ), approved_returns AS (
    SELECT r.*, o.resolved_employee_id FROM public.returns r JOIN delivered_orders o ON o.id = r.order_id
    WHERE r.status = 'approved' AND r.created_at >= v_month_start AND r.created_at < v_month_end
  ), emp_returns AS (
    SELECT resolved_employee_id AS employee_id, COALESCE(SUM(credit_note_amount), 0) AS return_deduction,
      COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int AS full_returns
    FROM approved_returns r LEFT JOIN (
      SELECT r2.order_id FROM public.returns r2 JOIN public.return_items ri ON ri.return_id = r2.id JOIN public.products p ON p.id = ri.product_id
      JOIN (SELECT oi2.order_id, SUM(oi2.piece_quantity) AS total_pieces FROM public.order_items oi2 GROUP BY oi2.order_id) oi3 ON oi3.order_id = r2.order_id
      WHERE r2.status = 'approved' AND r2.created_at >= v_month_start AND r2.created_at < v_month_end
      GROUP BY r2.order_id, oi3.total_pieces
      HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi3.total_pieces
    ) fr ON fr.order_id = r.order_id
    GROUP BY resolved_employee_id
  ), personal_kpis AS (
    SELECT e.id AS employee_id, e.code, e.full_name, e.manager_id,
      COALESCE(emt.sales_target, 0) AS sales_target, COALESCE(emt.visits_target, 0) AS visits_target,
      COALESCE(emt.orders_target, 0) AS orders_target, COALESCE(emt.new_customers_target, 0) AS new_customers_target,
      GREATEST(COALESCE(eo.sales_amount, 0) - COALESCE(er.return_deduction, 0), 0) AS personal_sales,
      COALESCE(ev.visit_count, 0) AS personal_visits,
      GREATEST(COALESCE(eo.order_count, 0) - COALESCE(er.full_returns, 0), 0) AS personal_orders,
      COALESCE(enc.new_customer_count, 0) AS personal_new_customers,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er2 JOIN public.roles r2 ON r2.id = er2.role_id WHERE er2.employee_id = e.id AND r2.name IN ('مدير المبيعات', 'مدير تنفيذي')) THEN 'مدير مبيعات'
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er2 JOIN public.roles r2 ON r2.id = er2.role_id WHERE er2.employee_id = e.id AND r2.name IN ('مشرف مبيعات', 'مشرف تنفيذي')) THEN 'سوبر فايزر'
        ELSE 'مندوب'
      END AS role_type,
      EXISTS (SELECT 1 FROM public.employees sub WHERE sub.manager_id = e.id AND sub.is_active = true) AS has_team
    FROM public.employees e
    LEFT JOIN public.employee_monthly_targets emt ON emt.employee_id = e.id AND emt.target_month = v_target_month AND emt.target_year = v_target_year
    LEFT JOIN emp_orders eo ON eo.employee_id = e.id LEFT JOIN emp_visits ev ON ev.employee_id = e.id
    LEFT JOIN emp_new_customers enc ON enc.employee_id = e.id LEFT JOIN emp_returns er ON er.employee_id = e.id
    WHERE e.is_active = true AND e.code NOT IN ('SYS-OWNER', 'ADMIN-001')
      AND NOT EXISTS (
        SELECT 1 FROM public.employee_roles er2 JOIN public.roles r2 ON r2.id = er2.role_id
        WHERE er2.employee_id = e.id AND r2.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'الإدارة العليا'))
      AND (emt.id IS NOT NULL OR COALESCE(eo.sales_amount, 0) > 0 OR COALESCE(ev.visit_count, 0) > 0 OR COALESCE(enc.new_customer_count, 0) > 0 OR COALESCE(eo.order_count, 0) > 0)
  ), team_kpis AS (
    SELECT am.ancestor_id, SUM(pk.sales_target) AS team_sales_target, SUM(pk.visits_target) AS team_visits_target,
      SUM(pk.orders_target) AS team_orders_target, SUM(pk.new_customers_target) AS team_new_customers_target,
      SUM(pk.personal_sales) AS team_sales, SUM(pk.personal_visits) AS team_visits,
      SUM(pk.personal_orders) AS team_orders, SUM(pk.personal_new_customers) AS team_new_customers
    FROM ancestor_map am JOIN personal_kpis pk ON pk.employee_id = am.descendant_id GROUP BY am.ancestor_id
  ), final_data AS (
    SELECT pk.employee_id, pk.code, pk.full_name, pk.role_type, pk.has_team,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_sales_target, 0) ELSE pk.sales_target END AS disp_sales_target,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_sales, 0) ELSE pk.personal_sales END AS disp_sales,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_visits_target, 0) ELSE pk.visits_target END AS disp_visits_target,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_visits, 0) ELSE pk.personal_visits END AS disp_visits,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_orders_target, 0) ELSE pk.orders_target END AS disp_orders_target,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_orders, 0) ELSE pk.personal_orders END AS disp_orders,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_new_customers_target, 0) ELSE pk.new_customers_target END AS disp_nc_target,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_new_customers, 0) ELSE pk.personal_new_customers END AS disp_nc
    FROM personal_kpis pk LEFT JOIN team_kpis tk ON tk.ancestor_id = pk.employee_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'employee_id', fd.employee_id, 'employee_code', fd.code, 'employee_name', fd.full_name,
    'role_type', fd.role_type, 'has_team', fd.has_team,
    'actual', CASE p_kpi_type WHEN 'sales' THEN fd.disp_sales WHEN 'orders' THEN fd.disp_orders WHEN 'visits' THEN fd.disp_visits WHEN 'new_customers' THEN fd.disp_nc ELSE 0 END,
    'target', CASE p_kpi_type WHEN 'sales' THEN fd.disp_sales_target WHEN 'orders' THEN fd.disp_orders_target WHEN 'visits' THEN fd.disp_visits_target WHEN 'new_customers' THEN fd.disp_nc_target ELSE 0 END,
    'achievement_pct', ROUND(CASE WHEN CASE p_kpi_type WHEN 'sales' THEN fd.disp_sales_target WHEN 'orders' THEN fd.disp_orders_target WHEN 'visits' THEN fd.disp_visits_target WHEN 'new_customers' THEN fd.disp_nc_target ELSE 0 END > 0
      THEN (CASE p_kpi_type WHEN 'sales' THEN fd.disp_sales WHEN 'orders' THEN fd.disp_orders WHEN 'visits' THEN fd.disp_visits WHEN 'new_customers' THEN fd.disp_nc ELSE 0 END::numeric / CASE p_kpi_type WHEN 'sales' THEN fd.disp_sales_target WHEN 'orders' THEN fd.disp_orders_target WHEN 'visits' THEN fd.disp_visits_target WHEN 'new_customers' THEN fd.disp_nc_target ELSE 1 END::numeric * 100) ELSE 0 END, 2)
  ) ORDER BY fd.role_type, fd.full_name) INTO v_result
  FROM final_data fd;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_team_members_kpis(
  p_token uuid, p_manager_id uuid, p_kpi_type text, p_month int DEFAULT NULL, p_year int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_target_month int; v_target_year int;
  v_month_start timestamptz; v_month_end timestamptz;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
  v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
  v_month_end := v_month_start + INTERVAL '1 month';
  WITH delivered_orders AS (
    SELECT o.*, COALESCE(emp.id, emp2.id) AS resolved_employee_id
    FROM public.orders o LEFT JOIN public.employees emp ON o.owner_id = emp.id LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
    WHERE o.status = 'delivered' AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end
  ), completed_visits AS (
    SELECT * FROM public.visits v WHERE v.status = 'completed' AND v.check_out_at >= v_month_start AND v.check_out_at < v_month_end
  ), emp_orders AS (
    SELECT resolved_employee_id AS employee_id, COUNT(DISTINCT id)::int AS order_count, COALESCE(SUM(total_amount), 0) AS sales_amount
    FROM delivered_orders GROUP BY resolved_employee_id
  ), emp_visits AS (
    SELECT employee_id, COUNT(*)::int AS visit_count FROM completed_visits GROUP BY employee_id
  ), emp_new_customers AS (
    SELECT resolved_employee_id AS employee_id, COUNT(DISTINCT customer_id)::int AS new_customer_count
    FROM delivered_orders do2 WHERE do2.delivered_at = (SELECT MIN(o3.delivered_at) FROM public.orders o3 WHERE o3.customer_id = do2.customer_id AND o3.status = 'delivered')
    GROUP BY resolved_employee_id
  ), approved_returns AS (
    SELECT r.*, o.resolved_employee_id FROM public.returns r JOIN delivered_orders o ON o.id = r.order_id
    WHERE r.status = 'approved' AND r.created_at >= v_month_start AND r.created_at < v_month_end
  ), emp_returns AS (
    SELECT resolved_employee_id AS employee_id, COALESCE(SUM(credit_note_amount), 0) AS return_deduction,
      COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int AS full_returns
    FROM approved_returns r LEFT JOIN (
      SELECT r2.order_id FROM public.returns r2 JOIN public.return_items ri ON ri.return_id = r2.id JOIN public.products p ON p.id = ri.product_id
      JOIN (SELECT oi2.order_id, SUM(oi2.piece_quantity) AS total_pieces FROM public.order_items oi2 GROUP BY oi2.order_id) oi3 ON oi3.order_id = r2.order_id
      WHERE r2.status = 'approved' AND r2.created_at >= v_month_start AND r2.created_at < v_month_end
      GROUP BY r2.order_id, oi3.total_pieces
      HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi3.total_pieces
    ) fr ON fr.order_id = r.order_id
    GROUP BY resolved_employee_id
  ), personal_kpis AS (
    SELECT e.id AS employee_id, e.code, e.full_name,
      COALESCE(emt.sales_target, 0) AS sales_target, COALESCE(emt.visits_target, 0) AS visits_target,
      COALESCE(emt.orders_target, 0) AS orders_target, COALESCE(emt.new_customers_target, 0) AS new_customers_target,
      GREATEST(COALESCE(eo.sales_amount, 0) - COALESCE(er.return_deduction, 0), 0) AS personal_sales,
      COALESCE(ev.visit_count, 0) AS personal_visits,
      GREATEST(COALESCE(eo.order_count, 0) - COALESCE(er.full_returns, 0), 0) AS personal_orders,
      COALESCE(enc.new_customer_count, 0) AS personal_new_customers,
      EXISTS (SELECT 1 FROM public.employees sub WHERE sub.manager_id = e.id AND sub.is_active = true) AS has_team
    FROM public.employees e
    LEFT JOIN public.employee_monthly_targets emt ON emt.employee_id = e.id AND emt.target_month = v_target_month AND emt.target_year = v_target_year
    LEFT JOIN emp_orders eo ON eo.employee_id = e.id LEFT JOIN emp_visits ev ON ev.employee_id = e.id
    LEFT JOIN emp_new_customers enc ON enc.employee_id = e.id LEFT JOIN emp_returns er ON er.employee_id = e.id
    WHERE e.is_active = true AND e.manager_id = p_manager_id AND (emt.id IS NOT NULL OR COALESCE(eo.sales_amount, 0) > 0 OR COALESCE(ev.visit_count, 0) > 0 OR COALESCE(enc.new_customer_count, 0) > 0 OR COALESCE(eo.order_count, 0) > 0)
  )
  SELECT jsonb_agg(jsonb_build_object(
    'employee_id', pk.employee_id, 'employee_code', pk.code, 'employee_name', pk.full_name, 'has_team', pk.has_team,
    'actual', CASE p_kpi_type WHEN 'sales' THEN pk.personal_sales WHEN 'orders' THEN pk.personal_orders WHEN 'visits' THEN pk.personal_visits WHEN 'new_customers' THEN pk.personal_new_customers ELSE 0 END,
    'target', CASE p_kpi_type WHEN 'sales' THEN pk.sales_target WHEN 'orders' THEN pk.orders_target WHEN 'visits' THEN pk.visits_target WHEN 'new_customers' THEN pk.new_customers_target ELSE 0 END,
    'achievement_pct', ROUND(CASE WHEN CASE p_kpi_type WHEN 'sales' THEN pk.sales_target WHEN 'orders' THEN pk.orders_target WHEN 'visits' THEN pk.visits_target WHEN 'new_customers' THEN pk.new_customers_target ELSE 0 END > 0
      THEN (CASE p_kpi_type WHEN 'sales' THEN pk.personal_sales WHEN 'orders' THEN pk.personal_orders WHEN 'visits' THEN pk.personal_visits WHEN 'new_customers' THEN pk.personal_new_customers ELSE 0 END::numeric / CASE p_kpi_type WHEN 'sales' THEN pk.sales_target WHEN 'orders' THEN pk.orders_target WHEN 'visits' THEN pk.visits_target WHEN 'new_customers' THEN pk.new_customers_target ELSE 1 END::numeric * 100) ELSE 0 END, 2)
  ) ORDER BY pk.full_name) INTO v_result
  FROM personal_kpis pk;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_rep_customer_kpis(
  p_token uuid, p_employee_id uuid, p_month int DEFAULT NULL, p_year int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_target_month int; v_target_year int;
  v_month_start timestamptz; v_month_end timestamptz;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
  v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
  v_month_end := v_month_start + INTERVAL '1 month';
  WITH customer_delivered_orders AS (
    SELECT o.customer_id, o.id AS order_id, o.total_amount, o.delivered_at
    FROM public.orders o JOIN public.customers c ON c.id = o.customer_id
    WHERE o.status = 'delivered' AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end
      AND (c.owner_id = p_employee_id OR c.id IN (SELECT c2.id FROM public.customers c2 JOIN public.employees e ON e.identity_id = c2.owner_id WHERE e.id = p_employee_id))
  ), customer_visits AS (
    SELECT v.customer_id, COUNT(*)::int AS visit_count FROM public.visits v
    WHERE v.status = 'completed' AND v.check_out_at >= v_month_start AND v.check_out_at < v_month_end
      AND v.employee_id = p_employee_id GROUP BY v.customer_id
  ), customer_agg AS (
    SELECT c.id AS customer_id, c.company_name AS customer_name,
      COALESCE(SUM(cdo.total_amount), 0) AS total_sales, COUNT(DISTINCT cdo.order_id)::int AS total_orders,
      COALESCE(cv.visit_count, 0) AS total_visits,
      EXISTS (SELECT 1 FROM public.orders o2 WHERE o2.customer_id = c.id AND o2.status = 'delivered'
        AND o2.delivered_at = (SELECT MIN(o3.delivered_at) FROM public.orders o3 WHERE o3.customer_id = c.id AND o3.status = 'delivered')
        AND o2.delivered_at >= v_month_start AND o2.delivered_at < v_month_end) AS is_new_customer
    FROM public.customers c LEFT JOIN customer_delivered_orders cdo ON cdo.customer_id = c.id
    LEFT JOIN customer_visits cv ON cv.customer_id = c.id
    WHERE (c.owner_id = p_employee_id OR c.owner_id IN (SELECT identity_id FROM public.employees WHERE id = p_employee_id))
      AND c.is_active = true
    GROUP BY c.id, c.company_name, cv.visit_count
  )
  SELECT jsonb_agg(jsonb_build_object(
    'customer_id', ca.customer_id, 'customer_name', ca.customer_name,
    'total_sales', ca.total_sales, 'total_orders', ca.total_orders, 'total_visits', ca.total_visits,
    'is_new_customer', ca.is_new_customer
  ) ORDER BY ca.total_sales DESC) INTO v_result
  FROM customer_agg ca WHERE ca.total_sales > 0 OR ca.total_visits > 0 OR ca.is_new_customer = true;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_delivered_orders(
  p_token uuid, p_customer_id uuid, p_month int DEFAULT NULL, p_year int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_target_month int; v_target_year int;
  v_month_start timestamptz; v_month_end timestamptz;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
  v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
  v_month_end := v_month_start + INTERVAL '1 month';
  SELECT jsonb_agg(jsonb_build_object(
    'order_id', o.id, 'order_code', o.order_number, 'total_amount', o.total_amount,
    'delivered_at', o.delivered_at, 'status', o.status
  ) ORDER BY o.delivered_at DESC) INTO v_result
  FROM public.orders o WHERE o.customer_id = p_customer_id AND o.status = 'delivered'
    AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- ============================================================================
-- STEP 18: ATTENDANCE MODULE (guard-pattern: سوبر أدمن → is_upper_management)
-- Source: supabase/migrations/20260610_attendance_module.sql
-- 9 functions with guard changes. 4 with مدير مبيعات/مشرف use is_upper_management + visibility.
-- (get_live_workday_overview, get_team_map, get_workday_report, get_alerts: no role check needed)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_workday_settings(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_settings record;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    SELECT row_to_json(s)::jsonb INTO v_settings FROM (SELECT * FROM public.workday_settings LIMIT 1) s;
    RETURN COALESCE(v_settings, '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_workday_settings(p_token uuid, p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_setting_id uuid;
    v_sql text := 'UPDATE public.workday_settings SET ';
    v_updates text[] := '{}'; v_key text; v_val text;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    SELECT id INTO v_setting_id FROM public.workday_settings LIMIT 1;
    IF NOT FOUND THEN INSERT INTO public.workday_settings (updated_by) VALUES (v_session.employee_id) RETURNING id INTO v_setting_id; END IF;
    FOR v_key, v_val IN SELECT * FROM jsonb_each_text(p_fields) LOOP
        IF v_key IN ('tracking_mode', 'location_interval_seconds', 'official_start_time', 'official_end_time',
                     'late_threshold_minutes', 'early_departure_threshold_minutes', 'retention_days',
                     'auto_cleanup_enabled', 'cleanup_frequency') THEN
            v_updates := array_append(v_updates, format('%I = %L', v_key,
                CASE WHEN v_val ~ '^\d+(\.\d+)?$' THEN v_val WHEN v_val IN ('true', 'false') THEN v_val ELSE quote_literal(v_val) END));
        END IF;
    END LOOP;
    v_updates := array_append(v_updates, format('updated_by = %L', v_session.employee_id));
    v_updates := array_append(v_updates, 'updated_at = now()');
    IF array_length(v_updates, 1) > 2 THEN
        EXECUTE v_sql || array_to_string(v_updates, ', ') || format(' WHERE id = %L', v_setting_id);
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_workday_cleanup_log(p_token uuid, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_logs jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.executed_at DESC), '[]'::jsonb) INTO v_logs
    FROM (SELECT * FROM public.tracking_cleanup_log ORDER BY executed_at DESC LIMIT p_limit) t;
    RETURN jsonb_build_object('logs', v_logs);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_employee_day_timeline(
    p_token uuid, p_employee_id uuid, p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_session_record record;
    v_points jsonb; v_breaks jsonb; v_visit_links jsonb; v_distribution jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      IF NOT EXISTS (SELECT 1 FROM public.get_visible_employee_ids(p_token) AS eid WHERE eid = p_employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
    SELECT * INTO v_session_record FROM public.workday_sessions
    WHERE employee_id = p_employee_id AND date = p_date ORDER BY start_time DESC LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_SESSION'); END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(tp) ORDER BY tp.recorded_at), '[]'::jsonb) INTO v_points
    FROM (SELECT id, latitude, longitude, recorded_at, point_type FROM public.tracking_points WHERE session_id = v_session_record.id ORDER BY recorded_at) tp;
    SELECT COALESCE(jsonb_agg(to_jsonb(wb) ORDER BY wb.break_start), '[]'::jsonb) INTO v_breaks
    FROM (SELECT id, break_start, break_end, duration_seconds, break_reason, auto_closed FROM public.workday_breaks WHERE session_id = v_session_record.id ORDER BY break_start) wb;
    SELECT COALESCE(jsonb_agg(to_jsonb(vl) ORDER BY vl.checkin_at), '[]'::jsonb) INTO v_visit_links
    FROM (SELECT id, visit_id, checkin_at, checkout_at FROM public.visit_links WHERE session_id = v_session_record.id ORDER BY checkin_at) vl;
    SELECT jsonb_build_object(
        'net_work_seconds', EXTRACT(EPOCH FROM (COALESCE(v_session_record.end_time, now()) - v_session_record.start_time)) - COALESCE((SELECT SUM(COALESCE(duration_seconds, 0)) FROM public.workday_breaks WHERE session_id = v_session_record.id), 0),
        'visit_seconds', COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(checkout_at, now()) - checkin_at))) FROM public.visit_links WHERE session_id = v_session_record.id), 0),
        'travel_seconds', COALESCE((SELECT EXTRACT(EPOCH FROM (COALESCE(v_session_record.end_time, now()) - v_session_record.start_time)) - SUM(EXTRACT(EPOCH FROM (COALESCE(checkout_at, now()) - checkin_at))) - COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0) FROM public.visit_links vl2 LEFT JOIN public.workday_breaks wb ON wb.session_id = vl2.session_id AND wb.break_end IS NOT NULL WHERE vl2.session_id = v_session_record.id), 0),
        'break_seconds', COALESCE((SELECT SUM(COALESCE(duration_seconds, 0)) FROM public.workday_breaks WHERE session_id = v_session_record.id), 0)
    ) INTO v_distribution;
    RETURN jsonb_build_object('session', row_to_json(v_session_record), 'points', v_points, 'breaks', v_breaks, 'visit_links', v_visit_links, 'time_distribution', v_distribution, 'attendance_status', v_session_record.attendance_status, 'late_minutes', v_session_record.late_minutes, 'early_departure_minutes', v_session_record.early_departure_minutes);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_employee_day_map(
    p_token uuid, p_employee_id uuid, p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_session_record record;
    v_start_point jsonb; v_end_point jsonb; v_route jsonb; v_visit_locations jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      IF NOT EXISTS (SELECT 1 FROM public.get_visible_employee_ids(p_token) AS eid WHERE eid = p_employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
    SELECT * INTO v_session_record FROM public.workday_sessions
    WHERE employee_id = p_employee_id AND date = p_date ORDER BY start_time DESC LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_SESSION'); END IF;
    SELECT jsonb_build_object('latitude', latitude, 'longitude', longitude, 'recorded_at', recorded_at) INTO v_start_point
    FROM public.tracking_points WHERE session_id = v_session_record.id AND point_type = 'start' ORDER BY recorded_at LIMIT 1;
    SELECT jsonb_build_object('latitude', latitude, 'longitude', longitude, 'recorded_at', recorded_at) INTO v_end_point
    FROM public.tracking_points WHERE session_id = v_session_record.id AND point_type = 'end' ORDER BY recorded_at DESC LIMIT 1;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('latitude', latitude, 'longitude', longitude) ORDER BY recorded_at), '[]'::jsonb) INTO v_route
    FROM public.tracking_points WHERE session_id = v_session_record.id AND point_type IN ('periodic', 'start', 'end') ORDER BY recorded_at;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('visit_id', vl.visit_id, 'latitude', tp.latitude, 'longitude', tp.longitude, 'checkin_at', vl.checkin_at, 'checkout_at', vl.checkout_at) ORDER BY vl.checkin_at), '[]'::jsonb) INTO v_visit_locations
    FROM public.visit_links vl JOIN public.tracking_points tp ON tp.id = vl.checkin_tracking_point_id WHERE vl.session_id = v_session_record.id;
    RETURN jsonb_build_object('start_point', v_start_point, 'end_point', v_end_point, 'route_polyline', v_route, 'visit_locations', v_visit_locations, 'session', jsonb_build_object('employee_id', v_session_record.employee_id, 'date', v_session_record.date, 'start_time', v_session_record.start_time, 'end_time', v_session_record.end_time, 'attendance_status', v_session_record.attendance_status));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_employee_workday_history(
    p_token uuid, p_employee_id uuid, p_from date, p_to date
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      IF NOT EXISTS (SELECT 1 FROM public.get_visible_employee_ids(p_token) AS eid WHERE eid = p_employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date DESC), '[]'::jsonb) INTO v_result
    FROM (SELECT wds.id, wds.date, wds.start_time, wds.end_time, wds.status,
        EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) / 60 AS duration_minutes,
        wds.total_distance_meters AS distance_meters, wds.visit_count,
        wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
        (SELECT COUNT(*) FROM public.workday_breaks wb WHERE wb.session_id = wds.id) AS break_count,
        (SELECT COALESCE(SUM(duration_seconds), 0) FROM public.workday_breaks wb WHERE wb.session_id = wds.id) AS break_seconds
        FROM public.workday_sessions wds WHERE wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to ORDER BY wds.date DESC) t;
    RETURN jsonb_build_object('sessions', v_result, 'summary', jsonb_build_object(
        'total_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to AND status = 'completed'),
        'late_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to AND attendance_status = 'late'),
        'early_departure_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to AND attendance_status = 'early_departure'),
        'ontime_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to AND attendance_status = 'ontime')));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_attendance_analysis(
    p_token uuid, p_from date, p_to date, p_employee_ids uuid[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    SELECT jsonb_build_object(
        'summary', jsonb_build_object(
            'total_work_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND status = 'completed' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'ontime_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'ontime' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'late_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'late' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'total_late_minutes', (SELECT COALESCE(SUM(late_minutes), 0) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'late' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'early_departure_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'early_departure' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'total_early_departure_minutes', (SELECT COALESCE(SUM(early_departure_minutes), 0) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'early_departure' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'absent_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND attendance_status = 'absent' AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids)))),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', sub.employee_id, 'name', sub.employee_name,
            'work_days', sub.work_days, 'ontime_days', sub.ontime_days, 'late_days', sub.late_days,
            'late_minutes', sub.late_minutes, 'early_departure_days', sub.early_departure_days,
            'early_departure_minutes', sub.early_departure_minutes, 'absent_days', sub.absent_days,
            'compliance_rate', CASE WHEN sub.work_days > 0 THEN ROUND((sub.ontime_days::numeric / sub.work_days) * 100, 1) ELSE 0 END
        ) ORDER BY sub.compliance_rate DESC)), '[]'::jsonb)
    ) INTO v_result
    FROM (SELECT wds.employee_id, e.name AS employee_name, COUNT(*) AS work_days,
        COUNT(*) FILTER (WHERE wds.attendance_status = 'ontime') AS ontime_days,
        COUNT(*) FILTER (WHERE wds.attendance_status = 'late') AS late_days,
        COALESCE(SUM(wds.late_minutes) FILTER (WHERE wds.attendance_status = 'late'), 0) AS late_minutes,
        COUNT(*) FILTER (WHERE wds.attendance_status = 'early_departure') AS early_departure_days,
        COALESCE(SUM(wds.early_departure_minutes) FILTER (WHERE wds.attendance_status = 'early_departure'), 0) AS early_departure_minutes,
        COUNT(*) FILTER (WHERE wds.attendance_status IN ('absent', 'unknown')) AS absent_days
        FROM public.workday_sessions wds JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date >= p_from AND wds.date <= p_to AND wds.status = 'completed'
        AND (p_employee_ids IS NULL OR wds.employee_id = ANY(p_employee_ids))
        GROUP BY wds.employee_id, e.name) sub;
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_employee_current_location(p_token uuid, p_employee_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      IF NOT EXISTS (SELECT 1 FROM public.get_visible_employee_ids(p_token) AS eid WHERE eid = p_employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
    SELECT jsonb_build_object('employee_id', e.id, 'name', e.name, 'latitude', tp.latitude, 'longitude', tp.longitude,
        'address', COALESCE(ea.address, ''), 'status', COALESCE(wds.status, 'inactive'),
        'attendance_status', wds.attendance_status, 'last_updated_at', tp.recorded_at,
        'last_seen_label', CASE WHEN tp.recorded_at > now() - interval '5 minutes' THEN 'متصل الآن'
            WHEN tp.recorded_at > now() - interval '30 minutes' THEN 'آخر ظهور منذ ' || round(EXTRACT(EPOCH FROM (now() - tp.recorded_at)) / 60) || ' دقيقة'
            ELSE 'لا توجد بيانات حديثة' END)
    INTO v_result
    FROM public.employees e
    LEFT JOIN LATERAL (SELECT latitude, longitude, recorded_at FROM public.tracking_points WHERE employee_id = p_employee_id ORDER BY recorded_at DESC LIMIT 1) tp ON true
    LEFT JOIN LATERAL (SELECT * FROM public.workday_sessions WHERE employee_id = p_employee_id AND date = CURRENT_DATE ORDER BY start_time DESC LIMIT 1) wds ON true
    LEFT JOIN public.employee_addresses ea ON ea.employee_id = e.id AND ea.is_primary = true
    WHERE e.id = p_employee_id;
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_tracking_data(
    p_token uuid, p_mode varchar, p_employee_id uuid DEFAULT NULL,
    p_from date DEFAULT NULL, p_to date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_deleted_sessions int := 0; v_deleted_points int := 0;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    IF p_mode = 'all' THEN
        DELETE FROM public.tracking_points; GET DIAGNOSTICS v_deleted_points = ROW_COUNT;
        DELETE FROM public.workday_sessions WHERE status != 'active'; GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    ELSIF p_mode = 'employee' AND p_employee_id IS NOT NULL THEN
        DELETE FROM public.tracking_points WHERE employee_id = p_employee_id; GET DIAGNOSTICS v_deleted_points = ROW_COUNT;
        DELETE FROM public.workday_sessions WHERE employee_id = p_employee_id AND status != 'active'; GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    ELSIF p_mode = 'range' AND p_from IS NOT NULL AND p_to IS NOT NULL THEN
        DELETE FROM public.tracking_points WHERE recorded_at::date >= p_from AND recorded_at::date <= p_to; GET DIAGNOSTICS v_deleted_points = ROW_COUNT;
        DELETE FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND status != 'active'; GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    ELSIF p_mode = 'day' AND p_from IS NOT NULL THEN
        DELETE FROM public.tracking_points WHERE recorded_at::date = p_from; GET DIAGNOSTICS v_deleted_points = ROW_COUNT;
        DELETE FROM public.workday_sessions WHERE date = p_from AND status != 'active'; GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    END IF;
    INSERT INTO public.tracking_cleanup_log (action_type, deleted_sessions, deleted_points, cutoff_date, employee_id, reason, executed_by)
    VALUES ('manual_cleanup', v_deleted_sessions, v_deleted_points, CASE WHEN p_mode IN ('range', 'day') THEN p_from::timestamptz ELSE now() END, p_employee_id, 'Manual cleanup by management', v_session.employee_id);
    RETURN jsonb_build_object('deleted_sessions', v_deleted_sessions, 'deleted_points', v_deleted_points);
END;
$function$;

-- ============================================================================
-- STEP 19: CUSTOMER CODE SNAPSHOT — get_governed_orders (IF-branching pattern)
-- Source: supabase/migrations/20260714_customer_code_snapshot.sql line 386
-- Replaces English role check SUPER_ADMIN/CHAIRMAN/ADMIN → is_upper_management
-- Removes hardcoded WRQ1002/WRQ1004 employee code fallback
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_orders(
  p_token uuid, p_search text DEFAULT NULL, p_status varchar DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL, p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_session app.sessions; v_result jsonb;
  v_subtree_ids uuid[]; v_identity_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  -- Customer: own orders only
  IF v_session.identity_type = 'customer' THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_number', o.order_number,
      'customer_id', o.customer_id, 'customer_code', COALESCE(o.snapshot_customer_code, ''),
      'customer_name', COALESCE(o.snapshot_customer_name, ''),
      'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
      'customer_address', COALESCE(o.snapshot_customer_address, ''),
      'customer_maps_url', '', 'owner_type', o.owner_type, 'owner_id', o.owner_id,
      'owner_name', COALESCE(o.snapshot_owner_name, ''),
      'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
      'owner_address', COALESCE(o.snapshot_owner_address, ''),
      'status', o.status, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
      'total_amount', o.total_amount, 'notes', o.notes, 'revision_number', o.revision_number,
      'created_by', o.created_by, 'created_by_name', COALESCE(o.snapshot_sender_name, ''),
      'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
      'created_by_address', COALESCE(o.snapshot_sender_address, ''),
      'created_at', o.created_at, 'updated_at', o.updated_at,
      'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
      'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
    ) ORDER BY o.created_at DESC) INTO v_result
    FROM orders o
    WHERE o.created_by = v_session.identity_id
      AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;
  -- Upper management: all orders
  IF public.is_upper_management(v_session.employee_id) THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_number', o.order_number,
      'customer_id', o.customer_id, 'customer_code', COALESCE(o.snapshot_customer_code, ''),
      'customer_name', COALESCE(o.snapshot_customer_name, ''),
      'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
      'customer_address', COALESCE(o.snapshot_customer_address, ''),
      'customer_maps_url', '', 'owner_type', o.owner_type, 'owner_id', o.owner_id,
      'owner_name', COALESCE(o.snapshot_owner_name, ''),
      'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
      'owner_address', COALESCE(o.snapshot_owner_address, ''),
      'status', o.status, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
      'total_amount', o.total_amount, 'notes', o.notes, 'revision_number', o.revision_number,
      'created_by', o.created_by, 'created_by_name', COALESCE(o.snapshot_sender_name, ''),
      'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
      'created_by_address', COALESCE(o.snapshot_sender_address, ''),
      'created_at', o.created_at, 'updated_at', o.updated_at,
      'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
      'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
    ) ORDER BY o.created_at DESC) INTO v_result
    FROM orders o
    WHERE (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;
  -- Others: tree-scoped orders
  v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
  SELECT COALESCE(array_agg(identity_id), '{}'::uuid[]) INTO v_identity_ids
  FROM public.employees WHERE id = ANY(v_subtree_ids);
  SELECT jsonb_agg(jsonb_build_object(
    'id', o.id, 'order_number', o.order_number,
    'customer_id', o.customer_id, 'customer_code', COALESCE(o.snapshot_customer_code, ''),
    'customer_name', COALESCE(o.snapshot_customer_name, ''),
    'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
    'customer_address', COALESCE(o.snapshot_customer_address, ''),
    'customer_maps_url', '', 'owner_type', o.owner_type, 'owner_id', o.owner_id,
    'owner_name', COALESCE(o.snapshot_owner_name, ''),
    'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
    'owner_address', COALESCE(o.snapshot_owner_address, ''),
    'status', o.status, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
    'total_amount', o.total_amount, 'notes', o.notes, 'revision_number', o.revision_number,
    'created_by', o.created_by, 'created_by_name', COALESCE(o.snapshot_sender_name, ''),
    'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
    'created_by_address', COALESCE(o.snapshot_sender_address, ''),
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
    'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
  ) ORDER BY o.created_at DESC) INTO v_result
  FROM orders o
  WHERE (o.created_by = ANY(v_identity_ids) OR o.customer_id IN (SELECT c2.id FROM customers c2 WHERE c2.owner_id = ANY(v_subtree_ids)))
    AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR o.status = p_status)
    AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
    AND (p_created_by IS NULL OR o.created_by = p_created_by)
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to);
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
