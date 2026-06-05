-- ============================================================================
-- RECOVERY MIGRATION: Missing Functions/RPCs
-- Source: Phase 3 Database Recovery (2026-06-05)
-- Purpose: Creates database functions that exist on live Supabase but were
--          missing from all migration files
--
-- These functions were created outside the migration system on the live DB.
-- Uses CREATE OR REPLACE FUNCTION for idempotent application.
-- WARNING: Some functions contain hardcoded employee codes (e.g., WRQ1002, WRQ1004)
--          preserved as-is from live DB.
-- ============================================================================

-- ============================================================================
-- SECTION 1: app Schema Functions (SECURITY INVOKER, used by RLS policies)
-- ============================================================================

CREATE OR REPLACE FUNCTION app.can_view_employee_data(p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ SELECT p_employee_id = ANY(app.get_subtree_ids(app.current_employee_id())); $function$


CREATE OR REPLACE FUNCTION app.current_customer_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$ SELECT c.id FROM public.customers c WHERE c.identity_id = app.current_identity_id() LIMIT 1; $function$


CREATE OR REPLACE FUNCTION app.current_employee_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$ SELECT e.id FROM public.employees e WHERE e.identity_id = app.current_identity_id() LIMIT 1; $function$


CREATE OR REPLACE FUNCTION app.current_identity_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$ SELECT NULLIF(current_setting('app.identity_id', true), '')::uuid; $function$


CREATE OR REPLACE FUNCTION app.get_subtree_ids(p_manager_id uuid DEFAULT app.current_employee_id())
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
AS $function$ WITH RECURSIVE subtree AS (
      SELECT id FROM public.employees WHERE id = p_manager_id
      UNION ALL
      SELECT e.id FROM public.employees e JOIN subtree s ON e.manager_id = s.id
    ) SELECT array_agg(id) FROM subtree; $function$


CREATE OR REPLACE FUNCTION app.get_visibility_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE
AS $function$
    DECLARE
      v_emp_id uuid := app.current_employee_id();
      v_ali_id uuid;
      v_mahmoud_id uuid;
    BEGIN
      SELECT id INTO v_ali_id FROM public.employees WHERE full_name = 'علي سعيد' LIMIT 1;
      SELECT id INTO v_mahmoud_id FROM public.employees WHERE full_name = 'محمود سعيد' LIMIT 1;
      IF v_emp_id IN (v_ali_id, v_mahmoud_id) THEN
        -- Both report to محمود سعيد; share the full subtree under محمود سعيد's manager
        RETURN app.get_subtree_ids(
          (SELECT manager_id FROM public.employees WHERE id = v_ali_id)
        );
      END IF;
      RETURN app.get_subtree_ids();
    END;
    $function$


CREATE OR REPLACE FUNCTION app.has_capability(p_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ SELECT EXISTS (
      SELECT 1 FROM public.employee_roles er
      JOIN public.role_capabilities rc ON rc.role_id = er.role_id
      JOIN public.capabilities cap ON cap.id = rc.capability_id AND cap.code = p_code
      WHERE er.employee_id = app.current_employee_id()
      UNION
      SELECT 1 FROM public.employee_capabilities ec
      JOIN public.capabilities cap ON cap.id = ec.capability_id AND cap.code = p_code
      WHERE ec.employee_id = app.current_employee_id() AND ec.grant_type = 'grant'
      EXCEPT
      SELECT 1 FROM public.employee_capabilities ec
      JOIN public.capabilities cap ON cap.id = ec.capability_id AND cap.code = p_code
      WHERE ec.employee_id = app.current_employee_id() AND ec.grant_type = 'deny'
    ); $function$


CREATE OR REPLACE FUNCTION app.has_role(p_role_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ SELECT EXISTS (
      SELECT 1 FROM public.employee_roles er
      JOIN public.roles r ON r.id = er.role_id AND r.name = p_role_name
      WHERE er.employee_id = app.current_employee_id()
    ); $function$


CREATE OR REPLACE FUNCTION app.requires_auth()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ SELECT NULLIF(current_setting('app.identity_id', true), '') IS NOT NULL; $function$





-- ============================================================================
-- SECTION 2: public Schema Read Functions
-- ============================================================================

-- [1/83] Function: get_collection_followup_queue
CREATE OR REPLACE FUNCTION public.get_collection_followup_queue(p_token uuid)
 RETURNS TABLE(id uuid, customer_name character varying, amount numeric, method character varying, status character varying, collected_at timestamp with time zone, created_at timestamp with time zone, owner_name character varying, days_since_creation bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[]; v_is_super boolean; v_ali_id uuid; v_mahmoud_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN QUERY SELECT c.id, cu.company_name, c.amount, c.method, c.status, c.collected_at, c.created_at, NULL::varchar, EXTRACT(DAY FROM now() - c.created_at)::bigint FROM public.collections c JOIN public.customers cu ON cu.id = c.customer_id WHERE c.customer_id = v_session.customer_id ORDER BY c.created_at DESC;
    RETURN;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super;
  SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_is_super THEN
    RETURN QUERY SELECT c.id, cu.company_name, c.amount, c.method, c.status, c.collected_at, c.created_at, e.code, EXTRACT(DAY FROM now() - c.created_at)::bigint FROM public.collections c JOIN public.customers cu ON cu.id = c.customer_id LEFT JOIN public.employees e ON e.id = cu.owner_id ORDER BY c.created_at DESC;
  ELSE
    IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
      SELECT array_agg(e.id) INTO v_visible FROM (WITH RECURSIVE sub AS (SELECT e2.id FROM public.employees e2 WHERE e2.manager_id = (SELECT e3.manager_id FROM public.employees e3 WHERE e3.id = v_ali_id) UNION ALL SELECT e4.id FROM public.employees e4 JOIN sub s ON e4.manager_id = s.id) SELECT s.id FROM sub s) t;
    ELSE
      SELECT array_agg(e.id) INTO v_visible FROM (WITH RECURSIVE sub AS (SELECT e2.id FROM public.employees e2 WHERE e2.id = v_session.employee_id UNION ALL SELECT e4.id FROM public.employees e4 JOIN sub s ON e4.manager_id = s.id) SELECT s.id FROM sub s) t;
    END IF;
    RETURN QUERY SELECT c.id, cu.company_name, c.amount, c.method, c.status, c.collected_at, c.created_at, e.code, EXTRACT(DAY FROM now() - c.created_at)::bigint FROM public.collections c JOIN public.customers cu ON cu.id = c.customer_id LEFT JOIN public.employees e ON e.id = cu.owner_id WHERE cu.owner_id = ANY(COALESCE(v_visible,'{}'::uuid[])) ORDER BY c.created_at DESC;
  END IF;
END;
$function$


-- [2/83] Function: get_company_profile
CREATE OR REPLACE FUNCTION public.get_company_profile(p_token uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_row public.company_profile;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_row FROM public.company_profile WHERE id = 1;
  IF v_row.id IS NULL THEN RETURN json_build_object('error', 'NOT_FOUND'); END IF;

  RETURN json_build_object(
    'success', true,
    'data', json_build_object(
      'company_name', v_row.company_name,
      'company_banner_url', v_row.company_banner_url,
      'facebook_url', v_row.facebook_url,
      'sales_phone_1', v_row.sales_phone_1,
      'sales_phone_2', v_row.sales_phone_2,
      'sales_whatsapp_1', v_row.sales_whatsapp_1,
      'sales_whatsapp_2', v_row.sales_whatsapp_2,
      'technical_support_phone', v_row.technical_support_phone,
      'is_active', v_row.is_active,
      'updated_at', v_row.updated_at
    )
  );
END;
$function$


-- [3/83] Function: get_credit_dashboard_stats
CREATE OR REPLACE FUNCTION public.get_credit_dashboard_stats(p_token uuid)
 RETURNS TABLE(new_apps bigint, under_review bigint, docs_pending bigint, approved bigint, rejected bigint, suspended bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[]; v_is_super boolean; v_ali_id uuid; v_mahmoud_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN QUERY SELECT COUNT(*) FILTER(WHERE a.status = 'submitted'), COUNT(*) FILTER(WHERE a.status = 'under_review'), COUNT(*) FILTER(WHERE a.status IN ('submitted','under_review') AND a.doc_confirmed_by IS NULL), COUNT(*) FILTER(WHERE a.status = 'approved'), COUNT(*) FILTER(WHERE a.status = 'rejected'), COUNT(*) FILTER(WHERE a.status = 'suspended') FROM public.credit_applications a WHERE a.customer_id = v_session.customer_id;
    RETURN;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super;
  SELECT e.id INTO v_ali_id FROM public.employees e WHERE e.code = 'WRQ1002' LIMIT 1;
  SELECT e.id INTO v_mahmoud_id FROM public.employees e WHERE e.code = 'WRQ1004' LIMIT 1;
  IF v_is_super THEN
    RETURN QUERY SELECT COUNT(*) FILTER(WHERE a.status = 'submitted'), COUNT(*) FILTER(WHERE a.status = 'under_review'), COUNT(*) FILTER(WHERE a.status IN ('submitted','under_review') AND a.doc_confirmed_by IS NULL), COUNT(*) FILTER(WHERE a.status = 'approved'), COUNT(*) FILTER(WHERE a.status = 'rejected'), COUNT(*) FILTER(WHERE a.status = 'suspended') FROM public.credit_applications a;
  ELSE
    IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
      SELECT array_agg(e.id) INTO v_visible FROM (WITH RECURSIVE sub AS (SELECT e2.id FROM public.employees e2 WHERE e2.manager_id = (SELECT e3.manager_id FROM public.employees e3 WHERE e3.id = v_ali_id) UNION ALL SELECT e4.id FROM public.employees e4 JOIN sub s ON e4.manager_id = s.id) SELECT s.id FROM sub s) t;
    ELSE
      SELECT array_agg(e.id) INTO v_visible FROM (WITH RECURSIVE sub AS (SELECT e2.id FROM public.employees e2 WHERE e2.id = v_session.employee_id UNION ALL SELECT e4.id FROM public.employees e4 JOIN sub s ON e4.manager_id = s.id) SELECT s.id FROM sub s) t;
    END IF;
    RETURN QUERY SELECT COUNT(*) FILTER(WHERE a.status = 'submitted'), COUNT(*) FILTER(WHERE a.status = 'under_review'), COUNT(*) FILTER(WHERE a.status IN ('submitted','under_review') AND a.doc_confirmed_by IS NULL), COUNT(*) FILTER(WHERE a.status = 'approved'), COUNT(*) FILTER(WHERE a.status = 'rejected'), COUNT(*) FILTER(WHERE a.status = 'suspended') FROM public.credit_applications a JOIN public.customers c ON c.id = a.customer_id WHERE c.owner_id = ANY(COALESCE(v_visible, '{}'::uuid[]));
  END IF;
END;
$function$


-- [4/83] Function: get_customer_analytics_list
CREATE OR REPLACE FUNCTION public.get_customer_analytics_list(p_token uuid)
 RETURNS TABLE(customer_id uuid, code character varying, company_name character varying, is_active boolean, total_purchases numeric, order_count bigint, avg_order_value numeric, last_order_date timestamp with time zone, days_since_last_order integer, inactive_risk boolean, lost_customer_risk boolean, expected_next_order_date timestamp with time zone, potential_revenue_score numeric, ranking bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ DECLARE  v_identity_type text; v_identity_id uuid; v_employee_id uuid;  v_is_super_admin boolean; v_visible uuid[]; v_ali uuid; v_mah uuid; BEGIN SELECT s.identity_type, s.identity_id, s.employee_id INTO v_identity_type, v_identity_id, v_employee_id FROM app.sessions s WHERE s.token = p_token AND s.expires_at > now(); IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF; SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin; IF v_is_super_admin THEN SELECT array_agg(e2.id) INTO v_visible FROM public.employees e2; ELSE SELECT e3.id INTO v_ali FROM public.employees e3 WHERE e3.code = 'WRQ1002' LIMIT 1; SELECT e4.id INTO v_mah FROM public.employees e4 WHERE e4.code = 'WRQ1004' LIMIT 1; IF v_employee_id IN (v_ali, v_mah) THEN WITH RECURSIVE sub AS (SELECT e5.id FROM public.employees e5 WHERE e5.manager_id = (SELECT e6.manager_id FROM public.employees e6 WHERE e6.id = v_ali) UNION ALL SELECT e7.id FROM public.employees e7 JOIN sub s ON e7.manager_id = s.id) SELECT array_agg(s2.id) INTO v_visible FROM sub s2; ELSE WITH RECURSIVE sub AS (SELECT e8.id FROM public.employees e8 WHERE e8.id = v_employee_id UNION ALL SELECT e9.id FROM public.employees e9 JOIN sub s ON e9.manager_id = s.id) SELECT array_agg(s3.id) INTO v_visible FROM sub s3; END IF; END IF;RETURN QUERY WITH visible_customers AS (SELECT c.id, c.code, c.company_name, c.is_active FROM public.customers c WHERE (v_identity_type = 'customer' AND c.identity_id = v_identity_id) OR (c.owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])))), order_stats AS (SELECT o.customer_id, COALESCE(SUM(o.total_amount), 0) AS total_purchases, COUNT(*)::bigint AS order_count, MAX(o.submitted_at) AS last_order_date, MIN(o.submitted_at) AS first_order_date FROM public.orders o WHERE o.status IN ('submitted','approved') GROUP BY o.customer_id), intervals AS (SELECT subq.customer_id, AVG(subq.days)::numeric AS avg_interval FROM (SELECT o2.customer_id, EXTRACT(DAY FROM (o2.submitted_at - LAG(o2.submitted_at) OVER (PARTITION BY o2.customer_id ORDER BY o2.submitted_at)))::numeric AS days FROM public.orders o2 WHERE o2.status IN ('submitted','approved') AND o2.submitted_at IS NOT NULL) subq WHERE subq.days IS NOT NULL AND subq.days > 0 GROUP BY subq.customer_id) SELECT vc.id, vc.code, vc.company_name, vc.is_active, COALESCE(os.total_purchases, 0), COALESCE(os.order_count, 0), CASE WHEN os.order_count > 0 THEN os.total_purchases / os.order_count ELSE 0 END, os.last_order_date, CASE WHEN os.last_order_date IS NOT NULL THEN EXTRACT(DAY FROM now() - os.last_order_date)::int ELSE NULL END, CASE WHEN os.last_order_date IS NOT NULL AND EXTRACT(DAY FROM now() - os.last_order_date) > 30 AND EXTRACT(DAY FROM now() - os.last_order_date) < 90 THEN true ELSE false END, CASE WHEN os.last_order_date IS NOT NULL AND EXTRACT(DAY FROM now() - os.last_order_date) >= 90 THEN true ELSE false END, CASE WHEN os.last_order_date IS NOT NULL AND COALESCE(i.avg_interval, 0) > 0 THEN os.last_order_date + (i.avg_interval || ' days')::interval ELSE NULL END, CASE WHEN os.last_order_date IS NOT NULL AND COALESCE(i.avg_interval, 0) > 0 THEN COALESCE(os.total_purchases, 0) * GREATEST(0, EXTRACT(DAY FROM now() - os.last_order_date) / i.avg_interval) ELSE COALESCE(os.total_purchases, 0) * 0.5 END, ROW_NUMBER() OVER (ORDER BY COALESCE(os.total_purchases, 0) DESC) FROM visible_customers vc LEFT JOIN order_stats os ON os.customer_id = vc.id LEFT JOIN intervals i ON i.customer_id = vc.id ORDER BY ranking; END; $function$


-- [5/83] Function: get_customer_brands
CREATE OR REPLACE FUNCTION public.get_customer_brands(p_token uuid, p_customer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ DECLARE  v_identity_type text; v_identity_id uuid; v_employee_id uuid;  v_is_super_admin boolean; v_visible uuid[]; v_ali uuid; v_mah uuid;  v_cust public.customers; v_total numeric; v_brands json; BEGIN SELECT s.identity_type, s.identity_id, s.employee_id INTO v_identity_type, v_identity_id, v_employee_id FROM app.sessions s WHERE s.token = p_token AND s.expires_at > now(); IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF; SELECT * INTO v_cust FROM public.customers WHERE id = p_customer_id; IF NOT FOUND THEN RETURN NULL; END IF; SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin; IF v_is_super_admin THEN SELECT array_agg(e2.id) INTO v_visible FROM public.employees e2; ELSE SELECT e3.id INTO v_ali FROM public.employees e3 WHERE e3.code = 'WRQ1002' LIMIT 1; SELECT e4.id INTO v_mah FROM public.employees e4 WHERE e4.code = 'WRQ1004' LIMIT 1; IF v_employee_id IN (v_ali, v_mah) THEN WITH RECURSIVE sub AS (SELECT e5.id FROM public.employees e5 WHERE e5.manager_id = (SELECT e6.manager_id FROM public.employees e6 WHERE e6.id = v_ali) UNION ALL SELECT e7.id FROM public.employees e7 JOIN sub s ON e7.manager_id = s.id) SELECT array_agg(s2.id) INTO v_visible FROM sub s2; ELSE WITH RECURSIVE sub AS (SELECT e8.id FROM public.employees e8 WHERE e8.id = v_employee_id UNION ALL SELECT e9.id FROM public.employees e9 JOIN sub s ON e9.manager_id = s.id) SELECT array_agg(s3.id) INTO v_visible FROM sub s3; END IF; END IF; IF v_identity_type = 'customer' THEN IF v_cust.identity_id != v_identity_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;  ELSIF v_cust.owner_id IS NOT NULL AND NOT (v_cust.owner_id = ANY(COALESCE(v_visible, '{}'::uuid[]))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF; SELECT COALESCE(SUM(oi.total_price), 0) INTO v_total FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved'); SELECT json_agg(subq ORDER BY subq.total_spent DESC) INTO v_brands FROM (SELECT c.id AS company_id, c.company_name, SUM(oi.total_price) AS total_spent, CASE WHEN v_total > 0 THEN ROUND(SUM(oi.total_price) / v_total * 100, 1) ELSE 0 END AS share_pct, ROUND(((COALESCE(SUM(oi.total_price) FILTER (WHERE o.submitted_at >= CURRENT_DATE - INTERVAL '90 days'), 0) - COALESCE(SUM(oi.total_price) FILTER (WHERE o.submitted_at >= CURRENT_DATE - INTERVAL '180 days' AND o.submitted_at < CURRENT_DATE - INTERVAL '90 days'), 0)) / NULLIF(COALESCE(SUM(oi.total_price) FILTER (WHERE o.submitted_at >= CURRENT_DATE - INTERVAL '180 days' AND o.submitted_at < CURRENT_DATE - INTERVAL '90 days'), 0), 0)) * 100, 1) AS trend_pct FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id JOIN public.products p ON p.id = oi.product_id JOIN public.companies c ON c.id = p.company_id WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved') GROUP BY c.id, c.company_name ORDER BY total_spent DESC LIMIT 10) subq; RETURN json_build_object('total_spent', v_total, 'brands', COALESCE(v_brands, '[]'::json)); END; $function$


-- [6/83] Function: get_customer_card
CREATE OR REPLACE FUNCTION public.get_customer_card(p_token uuid, p_customer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ DECLARE  v_identity_type text; v_identity_id uuid; v_employee_id uuid;  v_is_super_admin boolean; v_visible uuid[]; v_ali uuid; v_mah uuid;  v_cust public.customers; v_total_purchases numeric; v_order_count int; v_avg_value numeric;  v_last_order timestamptz; v_last_visit timestamptz; v_cash_amt numeric; v_total_coll numeric;  v_visit_count int; v_reorder_interval numeric; v_first_order timestamptz;  v_growth numeric; v_prior_total numeric; v_expected_next timestamptz; v_potential_revenue numeric;  v_balance numeric; v_total_ordered numeric; BEGIN SELECT s.identity_type, s.identity_id, s.employee_id INTO v_identity_type, v_identity_id, v_employee_id FROM app.sessions s WHERE s.token = p_token AND s.expires_at > now(); IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF; SELECT * INTO v_cust FROM public.customers WHERE id = p_customer_id; IF NOT FOUND THEN RETURN NULL; END IF; SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin; IF v_is_super_admin THEN SELECT array_agg(e2.id) INTO v_visible FROM public.employees e2; ELSE SELECT e3.id INTO v_ali FROM public.employees e3 WHERE e3.code = 'WRQ1002' LIMIT 1; SELECT e4.id INTO v_mah FROM public.employees e4 WHERE e4.code = 'WRQ1004' LIMIT 1; IF v_employee_id IN (v_ali, v_mah) THEN WITH RECURSIVE sub AS (SELECT e5.id FROM public.employees e5 WHERE e5.manager_id = (SELECT e6.manager_id FROM public.employees e6 WHERE e6.id = v_ali) UNION ALL SELECT e7.id FROM public.employees e7 JOIN sub s ON e7.manager_id = s.id) SELECT array_agg(s2.id) INTO v_visible FROM sub s2; ELSE WITH RECURSIVE sub AS (SELECT e8.id FROM public.employees e8 WHERE e8.id = v_employee_id UNION ALL SELECT e9.id FROM public.employees e9 JOIN sub s ON e9.manager_id = s.id) SELECT array_agg(s3.id) INTO v_visible FROM sub s3; END IF; END IF; IF v_identity_type = 'customer' THEN IF v_cust.identity_id != v_identity_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;  ELSIF v_cust.owner_id IS NOT NULL AND NOT (v_cust.owner_id = ANY(COALESCE(v_visible, '{}'::uuid[]))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF; SELECT COALESCE(SUM(o.total_amount), 0), COUNT(*), MAX(o.submitted_at), MIN(o.submitted_at), COALESCE(SUM(o.total_amount), 0) INTO v_total_purchases, v_order_count, v_last_order, v_first_order, v_total_ordered FROM public.orders o WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved'); v_avg_value := CASE WHEN v_order_count > 0 THEN v_total_purchases / v_order_count ELSE 0 END; SELECT MAX(v.check_in_at), COUNT(*) INTO v_last_visit, v_visit_count FROM public.visits v WHERE v.customer_id = p_customer_id; SELECT COALESCE(SUM(c.amount) FILTER (WHERE c.method = 'cash'), 0), COALESCE(SUM(c.amount), 0) INTO v_cash_amt, v_total_coll FROM public.collections c WHERE c.customer_id = p_customer_id; v_balance := v_total_ordered - v_total_coll; SELECT COALESCE(AVG(subq.days), 0) INTO v_reorder_interval FROM (SELECT EXTRACT(DAY FROM (o2.submitted_at - LAG(o2.submitted_at) OVER (ORDER BY o2.submitted_at)))::numeric AS days FROM public.orders o2 WHERE o2.customer_id = p_customer_id AND o2.status IN ('submitted','approved') AND o2.submitted_at IS NOT NULL) subq WHERE subq.days IS NOT NULL AND subq.days > 0; SELECT COALESCE(SUM(o3.total_amount), 0) INTO v_prior_total FROM public.orders o3 WHERE o3.customer_id = p_customer_id AND o3.status IN ('submitted','approved') AND o3.submitted_at >= CURRENT_DATE - INTERVAL '180 days' AND o3.submitted_at < CURRENT_DATE - INTERVAL '90 days'; SELECT COALESCE(SUM(o4.total_amount), 0) INTO v_growth FROM public.orders o4 WHERE o4.customer_id = p_customer_id AND o4.status IN ('submitted','approved') AND o4.submitted_at >= CURRENT_DATE - INTERVAL '90 days'; v_growth := CASE WHEN v_prior_total > 0 THEN ((v_growth - v_prior_total) / v_prior_total) * 100 ELSE 0 END; IF v_last_order IS NOT NULL AND v_reorder_interval > 0 THEN v_expected_next := v_last_order + (v_reorder_interval || ' days')::interval; END IF; IF v_last_order IS NOT NULL AND v_reorder_interval > 0 THEN v_potential_revenue := v_total_purchases * GREATEST(0, EXTRACT(DAY FROM now() - v_last_order) / v_reorder_interval); ELSE v_potential_revenue := v_total_purchases * 0.5; END IF; RETURN json_build_object('customer_id', v_cust.id, 'code', v_cust.code, 'company_name', v_cust.company_name, 'is_active', v_cust.is_active, 'purchase_summary', json_build_object('total_purchases', v_total_purchases, 'order_count', v_order_count, 'avg_order_value', v_avg_value, 'last_order_date', v_last_order, 'first_order_date', v_first_order), 'visit_summary', json_build_object('last_visit_date', v_last_visit, 'days_since_last_visit', CASE WHEN v_last_visit IS NOT NULL THEN EXTRACT(DAY FROM now() - v_last_visit)::int ELSE NULL END, 'total_visits', v_visit_count), 'credit_status', json_build_object('current_balance', v_balance, 'credit_limit', v_cust.credit_limit, 'credit_utilization_pct', CASE WHEN v_cust.credit_limit > 0 THEN ROUND((v_balance / v_cust.credit_limit) * 100, 1) ELSE 0 END, 'cash_vs_credit_ratio', CASE WHEN v_total_coll > 0 THEN ROUND(v_cash_amt / v_total_coll, 2) ELSE 0 END), 'risk_indicators', json_build_object('days_since_last_order', CASE WHEN v_last_order IS NOT NULL THEN EXTRACT(DAY FROM now() - v_last_order)::int ELSE NULL END, 'inactive_risk', CASE WHEN v_last_order IS NOT NULL AND EXTRACT(DAY FROM now() - v_last_order) > 30 AND EXTRACT(DAY FROM now() - v_last_order) < 90 THEN true ELSE false END, 'lost_customer_risk', CASE WHEN v_last_order IS NOT NULL AND EXTRACT(DAY FROM now() - v_last_order) >= 90 THEN true ELSE false END), 'behavior', json_build_object('avg_reorder_interval_days', v_reorder_interval, 'growth_trend_pct', ROUND(v_growth, 1), 'decline_trend_pct', ROUND(LEAST(v_growth, 0), 1)), 'expected_next_order_date', v_expected_next, 'potential_revenue_score', ROUND(v_potential_revenue, 2)); END; $function$


-- [7/83] Function: get_customer_products
CREATE OR REPLACE FUNCTION public.get_customer_products(p_token uuid, p_customer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ DECLARE  v_identity_type text; v_identity_id uuid; v_employee_id uuid;  v_is_super_admin boolean; v_visible uuid[]; v_ali uuid; v_mah uuid;  v_cust public.customers; v_top json; v_repeated json; v_stopped json; BEGIN SELECT s.identity_type, s.identity_id, s.employee_id INTO v_identity_type, v_identity_id, v_employee_id FROM app.sessions s WHERE s.token = p_token AND s.expires_at > now(); IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF; SELECT * INTO v_cust FROM public.customers WHERE id = p_customer_id; IF NOT FOUND THEN RETURN NULL; END IF; SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin; IF v_is_super_admin THEN SELECT array_agg(e2.id) INTO v_visible FROM public.employees e2; ELSE SELECT e3.id INTO v_ali FROM public.employees e3 WHERE e3.code = 'WRQ1002' LIMIT 1; SELECT e4.id INTO v_mah FROM public.employees e4 WHERE e4.code = 'WRQ1004' LIMIT 1; IF v_employee_id IN (v_ali, v_mah) THEN WITH RECURSIVE sub AS (SELECT e5.id FROM public.employees e5 WHERE e5.manager_id = (SELECT e6.manager_id FROM public.employees e6 WHERE e6.id = v_ali) UNION ALL SELECT e7.id FROM public.employees e7 JOIN sub s ON e7.manager_id = s.id) SELECT array_agg(s2.id) INTO v_visible FROM sub s2; ELSE WITH RECURSIVE sub AS (SELECT e8.id FROM public.employees e8 WHERE e8.id = v_employee_id UNION ALL SELECT e9.id FROM public.employees e9 JOIN sub s ON e9.manager_id = s.id) SELECT array_agg(s3.id) INTO v_visible FROM sub s3; END IF; END IF; IF v_identity_type = 'customer' THEN IF v_cust.identity_id != v_identity_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;  ELSIF v_cust.owner_id IS NOT NULL AND NOT (v_cust.owner_id = ANY(COALESCE(v_visible, '{}'::uuid[]))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF; SELECT json_agg(subq ORDER BY subq.total_spent DESC) INTO v_top FROM (SELECT p.id AS product_id, p.product_name, co.company_name, SUM(oi.total_price) AS total_spent, SUM(oi.piece_quantity) AS total_quantity, MAX(o.submitted_at) AS last_purchase_date FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id JOIN public.products p ON p.id = oi.product_id LEFT JOIN public.companies co ON co.id = p.company_id WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved') GROUP BY p.id, p.product_name, co.company_name ORDER BY total_spent DESC LIMIT 10) subq; SELECT json_agg(subq) INTO v_repeated FROM (SELECT p.id AS product_id, p.product_name, COUNT(*)::int AS times_ordered, SUM(oi.total_price) AS total_spent FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id JOIN public.products p ON p.id = oi.product_id WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved') GROUP BY p.id, p.product_name HAVING COUNT(*) >= 2 ORDER BY times_ordered DESC LIMIT 10) subq; SELECT json_agg(subq) INTO v_stopped FROM (SELECT p_id, p_name, last_date, spent FROM (SELECT p.id AS p_id, p.product_name AS p_name, MAX(o.submitted_at) AS last_date, SUM(oi.total_price) AS spent FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id JOIN public.products p ON p.id = oi.product_id WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved') GROUP BY p.id, p.product_name) sub2 WHERE last_date < CURRENT_DATE - INTERVAL '90 days' ORDER BY last_date DESC LIMIT 10) subq; RETURN json_build_object('top_products', COALESCE(v_top, '[]'::json), 'repeated_products', COALESCE(v_repeated, '[]'::json), 'stopped_products', COALESCE(v_stopped, '[]'::json)); END; $function$


-- [8/83] Function: get_customer_sales_ranking
CREATE OR REPLACE FUNCTION public.get_customer_sales_ranking(p_token uuid)
 RETURNS TABLE(customer_id uuid, code character varying, company_name character varying, total_purchases numeric, order_count bigint, customer_ranking bigint, rep_customer_ranking bigint, owner_id uuid, followup_priority_score numeric, potential_revenue_score numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ DECLARE  v_identity_type text; v_identity_id uuid; v_employee_id uuid;  v_is_super_admin boolean; v_visible uuid[]; v_ali uuid; v_mah uuid; BEGIN SELECT s.identity_type, s.identity_id, s.employee_id INTO v_identity_type, v_identity_id, v_employee_id FROM app.sessions s WHERE s.token = p_token AND s.expires_at > now(); IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF; SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin; IF v_is_super_admin THEN SELECT array_agg(e2.id) INTO v_visible FROM public.employees e2; ELSE SELECT e3.id INTO v_ali FROM public.employees e3 WHERE e3.code = 'WRQ1002' LIMIT 1; SELECT e4.id INTO v_mah FROM public.employees e4 WHERE e4.code = 'WRQ1004' LIMIT 1; IF v_employee_id IN (v_ali, v_mah) THEN WITH RECURSIVE sub AS (SELECT e5.id FROM public.employees e5 WHERE e5.manager_id = (SELECT e6.manager_id FROM public.employees e6 WHERE e6.id = v_ali) UNION ALL SELECT e7.id FROM public.employees e7 JOIN sub s ON e7.manager_id = s.id) SELECT array_agg(s2.id) INTO v_visible FROM sub s2; ELSE WITH RECURSIVE sub AS (SELECT e8.id FROM public.employees e8 WHERE e8.id = v_employee_id UNION ALL SELECT e9.id FROM public.employees e9 JOIN sub s ON e9.manager_id = s.id) SELECT array_agg(s3.id) INTO v_visible FROM sub s3; END IF; END IF;RETURN QUERY WITH visible_customers AS (SELECT c.id, c.code, c.company_name, c.owner_id FROM public.customers c WHERE (v_identity_type = 'customer' AND c.identity_id = v_identity_id) OR (c.owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])))), intervals AS (SELECT subq.customer_id, AVG(subq.days)::numeric AS avg_interval FROM (SELECT o2.customer_id, EXTRACT(DAY FROM (o2.submitted_at - LAG(o2.submitted_at) OVER (PARTITION BY o2.customer_id ORDER BY o2.submitted_at)))::numeric AS days FROM public.orders o2 WHERE o2.status IN ('submitted','approved') AND o2.submitted_at IS NOT NULL) subq WHERE subq.days IS NOT NULL AND subq.days > 0 GROUP BY subq.customer_id), order_stats AS (SELECT o.customer_id, COALESCE(SUM(o.total_amount), 0) AS total_purchases, COUNT(*)::bigint AS order_count, MAX(o.submitted_at) AS last_order_date FROM public.orders o WHERE o.status IN ('submitted','approved') GROUP BY o.customer_id), ranked AS (SELECT vc.*, COALESCE(s.total_purchases, 0) AS tp, COALESCE(s.order_count, 0) AS oc, s.last_order_date, i.avg_interval, ROW_NUMBER() OVER (ORDER BY COALESCE(s.total_purchases, 0) DESC) AS customer_rank, ROW_NUMBER() OVER (PARTITION BY vc.owner_id ORDER BY COALESCE(s.total_purchases, 0) DESC) AS rep_rank FROM visible_customers vc LEFT JOIN order_stats s ON s.customer_id = vc.id LEFT JOIN intervals i ON i.customer_id = vc.id) SELECT r.id, r.code, r.company_name, r.tp, r.oc, r.customer_rank, r.rep_rank, r.owner_id, ROUND(COALESCE(CASE WHEN r.last_order_date IS NOT NULL THEN (EXTRACT(DAY FROM now() - r.last_order_date) * 1.0) + (30.0 / NULLIF(r.oc::numeric, 0)) + (r.tp / 1000.0) ELSE 999 END, 0), 2), ROUND(CASE WHEN r.last_order_date IS NOT NULL AND COALESCE(r.avg_interval, 0) > 0 THEN r.tp * GREATEST(0, EXTRACT(DAY FROM now() - r.last_order_date) / r.avg_interval) ELSE r.tp * 0.5 END, 2) FROM ranked r ORDER BY r.customer_rank; END; $function$


-- [9/83] Function: get_dashboard_management
CREATE OR REPLACE FUNCTION public.get_dashboard_management(p_token uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session app.sessions; v_is_super_admin boolean;
  v_visible uuid[]; v_ali_id uuid; v_mahmoud_id uuid;
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
    SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin;
    IF v_is_super_admin THEN SELECT array_agg(id) INTO v_visible FROM public.employees;
    ELSE
      SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
      SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
      IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
        WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
      ELSE
        WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
      END IF;
    END IF;
    SELECT count(*) INTO v_total_orders FROM public.orders WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[]));
    SELECT count(*) INTO v_pending_orders FROM public.orders WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND status IN ('draft','reviewing','submitted');
    SELECT count(*) INTO v_approved_orders FROM public.orders WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND status = 'approved';
    SELECT count(*) INTO v_total_customers FROM public.customers WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[]));
    SELECT count(*) INTO v_active_visits FROM public.visits WHERE employee_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND status = 'active';
    SELECT count(*) INTO v_pending_collections FROM public.collections WHERE created_by = ANY(COALESCE(v_visible, '{}'::uuid[])) AND status = 'pending';
    SELECT count(*) INTO v_pending_returns FROM public.returns WHERE created_by = ANY(COALESCE(v_visible, '{}'::uuid[])) AND status = 'pending';
    SELECT count(*) INTO v_today_orders FROM public.orders WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND created_at >= CURRENT_DATE;
    SELECT count(*) INTO v_today_visits FROM public.visits WHERE employee_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND created_at >= CURRENT_DATE;
  END IF;
  RETURN json_build_object('total_orders', COALESCE(v_total_orders, 0), 'pending_orders', COALESCE(v_pending_orders, 0), 'approved_orders', COALESCE(v_approved_orders, 0), 'total_customers', COALESCE(v_total_customers, 0), 'active_visits', COALESCE(v_active_visits, 0), 'pending_collections', COALESCE(v_pending_collections, 0), 'pending_returns', COALESCE(v_pending_returns, 0), 'today_orders', COALESCE(v_today_orders, 0), 'today_visits', COALESCE(v_today_visits, 0));
END;
$function$


-- [10/83] Function: get_dashboard_sales
CREATE OR REPLACE FUNCTION public.get_dashboard_sales(p_token uuid, p_inactive_days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session app.sessions; v_is_super_admin boolean;
  v_visible uuid[]; v_ali_id uuid; v_mahmoud_id uuid;
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
    SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin;
    IF v_is_super_admin THEN SELECT array_agg(id) INTO v_visible FROM public.employees;
    ELSE
      SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
      SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
      IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
        WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
      ELSE
        WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
      END IF;
    END IF;
    SELECT count(*) INTO v_today_orders FROM public.orders WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND created_at >= CURRENT_DATE;
    SELECT count(*) INTO v_pending_followup FROM public.orders WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND status IN ('draft','reviewing','submitted');
    SELECT count(*) INTO v_inactive_customers FROM public.customers WHERE owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND COALESCE(updated_at, created_at) < CURRENT_DATE - p_inactive_days;
    SELECT count(*) INTO v_today_visits FROM public.visits WHERE employee_id = ANY(COALESCE(v_visible, '{}'::uuid[])) AND created_at >= CURRENT_DATE;
    SELECT count(*) INTO v_today_collections FROM public.collections WHERE created_by = ANY(COALESCE(v_visible, '{}'::uuid[])) AND created_at >= CURRENT_DATE;
  END IF;
  RETURN json_build_object('today_orders', COALESCE(v_today_orders, 0), 'pending_followup', COALESCE(v_pending_followup, 0), 'inactive_customers', COALESCE(v_inactive_customers, 0), 'today_visits', COALESCE(v_today_visits, 0), 'today_collections', COALESCE(v_today_collections, 0));
END;
$function$


-- [11/83] Function: get_dashboard_transport
CREATE OR REPLACE FUNCTION public.get_dashboard_transport(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[]; v_is_super boolean; v_ali_id uuid; v_mahmoud_id uuid; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error','INVALID_SESSION'); END IF;
  IF v_session.identity_type = 'customer' THEN RETURN jsonb_build_object('ready_delivery',0,'out_delivery',0,'delivery_queue',0,'collection_queue',0,'delivered_today',0,'failed',0,'pending_collections',0,'overdue_collections',0); END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super;
  SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_is_super THEN SELECT array_agg(id) INTO v_visible FROM public.employees;
  ELSIF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
  ELSE
    WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
  END IF;
  SELECT jsonb_build_object('ready_delivery', (SELECT count(*) FROM public.orders WHERE status = 'approved' AND owner_id = ANY(COALESCE(v_visible,'{}'::uuid[])) AND NOT EXISTS (SELECT 1 FROM delivery_tracking WHERE order_id = orders.id)), 'out_delivery', (SELECT count(*) FROM public.delivery_tracking WHERE status IN ('assigned','out_for_delivery')), 'delivery_queue', (SELECT count(*) FROM public.delivery_tracking WHERE status NOT IN ('delivered','failed','returned')), 'collection_queue', (SELECT count(*) FROM public.collections WHERE status = 'pending' AND owner_id = ANY(COALESCE(v_visible,'{}'::uuid[]))), 'delivered_today', (SELECT count(*) FROM public.delivery_tracking WHERE status = 'delivered' AND completed_at >= CURRENT_DATE), 'failed', (SELECT count(*) FROM public.delivery_tracking WHERE status IN ('failed','returned')), 'pending_collections', (SELECT count(*) FROM public.collections c JOIN public.customers cu ON cu.id = c.customer_id WHERE c.status = 'pending' AND cu.owner_id = ANY(COALESCE(v_visible,'{}'::uuid[]))), 'overdue_collections', (SELECT count(*) FROM public.collections c JOIN public.customers cu ON cu.id = c.customer_id WHERE c.status = 'pending' AND c.created_at < now() - interval '30 days' AND cu.owner_id = ANY(COALESCE(v_visible,'{}'::uuid[])))) INTO v_result;
  RETURN v_result;
END;
$function$


-- [12/83] Function: get_dashboard_warehouse
CREATE OR REPLACE FUNCTION public.get_dashboard_warehouse(p_token uuid)
 RETURNS TABLE(counter text, value bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_employee_id uuid;
  v_visible_employees uuid[];
BEGIN
  SELECT employee_id INTO v_employee_id FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_employee_id IS NULL THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = v_employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) THEN
    RETURN QUERY
      SELECT 'waiting_preparation'::text, COUNT(*)::bigint FROM public.orders o WHERE o.status = 'approved' AND NOT EXISTS (SELECT 1 FROM public.preparation_records pr WHERE pr.order_id = o.id)
      UNION ALL SELECT 'in_preparation'::text, COUNT(*)::bigint FROM public.preparation_records WHERE status = 'in_progress'
      UNION ALL SELECT 'ready_for_delivery'::text, COUNT(*)::bigint FROM public.preparation_records WHERE status = 'reviewed'
      UNION ALL SELECT 'prepared_today'::text, COUNT(*)::bigint FROM public.preparation_records WHERE completed_at >= CURRENT_DATE
      UNION ALL SELECT 'delayed_preps'::text, COUNT(*)::bigint FROM public.preparation_records WHERE status = 'in_progress' AND started_at < now() - interval '24 hours';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT e.id) INTO v_visible_employees FROM public.employees e WHERE e.id = v_employee_id OR e.manager_id = v_employee_id OR e.id IN (SELECT sub.id FROM public.employees sub WHERE sub.manager_id IN (SELECT m.id FROM public.employees m WHERE m.manager_id = v_employee_id));

  RETURN QUERY
    SELECT 'waiting_preparation'::text, COUNT(*)::bigint FROM public.orders o WHERE o.status = 'approved' AND o.owner_id = ANY(v_visible_employees) AND NOT EXISTS (SELECT 1 FROM public.preparation_records pr WHERE pr.order_id = o.id)
    UNION ALL SELECT 'in_preparation'::text, COUNT(*)::bigint FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id WHERE pr.status = 'in_progress' AND o.owner_id = ANY(v_visible_employees)
    UNION ALL SELECT 'ready_for_delivery'::text, COUNT(*)::bigint FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id WHERE pr.status = 'reviewed' AND o.owner_id = ANY(v_visible_employees)
    UNION ALL SELECT 'prepared_today'::text, COUNT(*)::bigint FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id WHERE pr.completed_at >= CURRENT_DATE AND o.owner_id = ANY(v_visible_employees)
    UNION ALL SELECT 'delayed_preps'::text, COUNT(*)::bigint FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id WHERE pr.status = 'in_progress' AND pr.started_at < now() - interval '24 hours' AND o.owner_id = ANY(v_visible_employees);
END;
$function$


-- [13/83] Function: get_delivery_dashboard_stats
CREATE OR REPLACE FUNCTION public.get_delivery_dashboard_stats(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[]; v_is_super boolean; v_ali_id uuid; v_mahmoud_id uuid; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error','INVALID_SESSION'); END IF;
  IF v_session.identity_type = 'customer' THEN RETURN jsonb_build_object('ready_delivery',0,'assigned',0,'out_for_delivery',0,'delivered_today',0,'failed',0,'pending_collections',0,'overdue_collections',0); END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super;
  SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_is_super THEN SELECT array_agg(id) INTO v_visible FROM public.employees;
  ELSIF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
  ELSE
    WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
  END IF;
  SELECT jsonb_build_object('ready_delivery', (SELECT count(*) FROM public.orders WHERE status = 'approved' AND owner_id = ANY(COALESCE(v_visible,'{}'::uuid[])) AND NOT EXISTS (SELECT 1 FROM delivery_tracking WHERE order_id = orders.id)), 'assigned', (SELECT count(*) FROM public.delivery_tracking WHERE status = 'assigned'), 'out_for_delivery', (SELECT count(*) FROM public.delivery_tracking WHERE status = 'out_for_delivery'), 'delivered_today', (SELECT count(*) FROM public.delivery_tracking WHERE status = 'delivered' AND completed_at >= CURRENT_DATE), 'failed', (SELECT count(*) FROM public.delivery_tracking WHERE status IN ('failed','returned')), 'pending_collections', (SELECT count(*) FROM public.collections WHERE status = 'pending' AND owner_id = ANY(COALESCE(v_visible,'{}'::uuid[]))), 'overdue_collections', (SELECT count(*) FROM public.collections WHERE status = 'pending' AND created_at < now() - interval '30 days')) INTO v_result;
  RETURN v_result;
END;
$function$


-- [14/83] Function: get_governed_collections
CREATE OR REPLACE FUNCTION public.get_governed_collections(p_token uuid)
 RETURNS SETOF collections
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_is_super_admin boolean; v_ali_id uuid; v_mahmoud_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN RETURN QUERY SELECT c.* FROM public.collections c WHERE c.customer_id = v_session.customer_id; RETURN; END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin;
  IF v_is_super_admin THEN RETURN QUERY SELECT c.* FROM public.collections c ORDER BY c.created_at DESC; RETURN; END IF;
  SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    RETURN QUERY SELECT c.* FROM public.collections c WHERE c.created_by IN (WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT id FROM sub) ORDER BY c.created_at DESC;
  ELSE
    RETURN QUERY SELECT c.* FROM public.collections c WHERE c.created_by IN (WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT id FROM sub) ORDER BY c.created_at DESC;
  END IF;
END;
$function$


-- [15/83] Function: get_governed_credit_application
CREATE OR REPLACE FUNCTION public.get_governed_credit_application(p_token uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('application', row_to_json(a)::jsonb, 'customer', row_to_json(c)::jsonb, 'program', row_to_json(p)::jsonb, 'contract', (SELECT row_to_json(cc)::jsonb FROM public.credit_contracts cc WHERE cc.application_id = a.id LIMIT 1)) INTO v_result FROM public.credit_applications a JOIN public.customers c ON c.id = a.customer_id JOIN public.credit_programs p ON p.id = a.program_id WHERE a.id = p_id AND (v_session.identity_type = 'customer' AND a.customer_id = v_session.customer_id OR v_session.identity_type = 'employee' AND (EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) OR c.owner_id = ANY(public.get_visible_employee_ids(p_token))));
  RETURN v_result;
END;
$function$


-- [16/83] Function: get_governed_credit_applications
CREATE OR REPLACE FUNCTION public.get_governed_credit_applications(p_token uuid)
 RETURNS TABLE(id uuid, customer_id uuid, customer_name character varying, program_name character varying, credit_limit numeric, credit_days integer, status credit_application_status, doc_confirmed boolean, submitted_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[]; v_is_super boolean; v_ali_id uuid; v_mahmoud_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN
    RETURN QUERY SELECT a.id, a.customer_id, c.company_name, p.name, p.credit_limit, p.credit_days, a.status, (a.doc_confirmed_by IS NOT NULL), a.submitted_at, a.created_at, a.updated_at FROM public.credit_applications a JOIN public.customers c ON c.id = a.customer_id JOIN public.credit_programs p ON p.id = a.program_id WHERE a.customer_id = v_session.customer_id ORDER BY a.created_at DESC;
    RETURN;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super;
  SELECT e.id INTO v_ali_id FROM public.employees e WHERE e.code = 'WRQ1002' LIMIT 1;
  SELECT e.id INTO v_mahmoud_id FROM public.employees e WHERE e.code = 'WRQ1004' LIMIT 1;
  IF v_is_super THEN
    RETURN QUERY SELECT a.id, a.customer_id, c.company_name, p.name, p.credit_limit, p.credit_days, a.status, (a.doc_confirmed_by IS NOT NULL), a.submitted_at, a.created_at, a.updated_at FROM public.credit_applications a JOIN public.customers c ON c.id = a.customer_id JOIN public.credit_programs p ON p.id = a.program_id ORDER BY a.created_at DESC;
  ELSE
    IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
      SELECT array_agg(e.id) INTO v_visible FROM (WITH RECURSIVE sub AS (SELECT e2.id FROM public.employees e2 WHERE e2.manager_id = (SELECT e3.manager_id FROM public.employees e3 WHERE e3.id = v_ali_id) UNION ALL SELECT e4.id FROM public.employees e4 JOIN sub s ON e4.manager_id = s.id) SELECT id FROM sub) t;
    ELSE
      SELECT array_agg(e.id) INTO v_visible FROM (WITH RECURSIVE sub AS (SELECT e2.id FROM public.employees e2 WHERE e2.id = v_session.employee_id UNION ALL SELECT e4.id FROM public.employees e4 JOIN sub s ON e4.manager_id = s.id) SELECT id FROM sub) t;
    END IF;
    RETURN QUERY SELECT a.id, a.customer_id, c.company_name, p.name, p.credit_limit, p.credit_days, a.status, (a.doc_confirmed_by IS NOT NULL), a.submitted_at, a.created_at, a.updated_at FROM public.credit_applications a JOIN public.customers c ON c.id = a.customer_id JOIN public.credit_programs p ON p.id = a.program_id WHERE c.owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])) ORDER BY a.created_at DESC;
  END IF;
END;
$function$


-- [17/83] Function: get_governed_deliveries
CREATE OR REPLACE FUNCTION public.get_governed_deliveries(p_token uuid, p_status_filter character varying DEFAULT NULL::character varying)
 RETURNS TABLE(id uuid, order_id uuid, order_number character varying, customer_name character varying, status character varying, assigned_to_name character varying, assigned_at timestamp with time zone, started_at timestamp with time zone, completed_at timestamp with time zone, failure_reason character varying, notes text, total_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_visible uuid[]; v_is_super boolean; v_ali_id uuid; v_mahmoud_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super;
  SELECT e.id INTO v_ali_id FROM public.employees e WHERE e.code = 'WRQ1002' LIMIT 1;
  SELECT e.id INTO v_mahmoud_id FROM public.employees e WHERE e.code = 'WRQ1004' LIMIT 1;
  IF v_is_super THEN v_visible := '{}'::uuid[];
  ELSIF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    SELECT array_agg(e.id) INTO v_visible FROM (WITH RECURSIVE sub AS (SELECT e2.id FROM public.employees e2 WHERE e2.manager_id = (SELECT e3.manager_id FROM public.employees e3 WHERE e3.id = v_ali_id) UNION ALL SELECT e4.id FROM public.employees e4 JOIN sub s ON e4.manager_id = s.id) SELECT s.id FROM sub s) t;
  ELSE
    SELECT array_agg(e.id) INTO v_visible FROM (WITH RECURSIVE sub AS (SELECT e2.id FROM public.employees e2 WHERE e2.id = v_session.employee_id UNION ALL SELECT e4.id FROM public.employees e4 JOIN sub s ON e4.manager_id = s.id) SELECT s.id FROM sub s) t;
  END IF;
  RETURN QUERY SELECT dt.id, o.id, o.order_number, c.company_name, dt.status, ast.code, dt.assigned_at, dt.started_at, dt.completed_at, dt.failure_reason, dt.notes, o.total_amount FROM public.delivery_tracking dt JOIN public.orders o ON o.id = dt.order_id JOIN public.customers c ON c.id = o.customer_id LEFT JOIN public.employees ast ON ast.id = dt.assigned_to WHERE (v_is_super OR o.owner_id = ANY(COALESCE(v_visible, '{}'::uuid[]))) AND (p_status_filter IS NULL OR dt.status = p_status_filter) ORDER BY dt.created_at DESC;
END;
$function$


-- [18/83] Function: get_governed_employee
CREATE OR REPLACE FUNCTION public.get_governed_employee(p_token uuid, p_employee_id uuid)
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
       v_phone
  FROM public.employees e
  LEFT JOIN public.identities i ON i.id = e.identity_id
  WHERE e.id = p_employee_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'NOT_FOUND');
  END IF;

  SELECT r.name INTO v_role
  FROM public.employee_roles er
  JOIN public.roles r ON r.id = er.role_id
  WHERE er.employee_id = p_employee_id
  LIMIT 1;

  RETURN json_build_object(
    'id', v_emp.id,
    'full_name', v_emp.full_name,
    'phone', COALESCE(v_phone, ''),
    'code', v_emp.code,
    'role', COALESCE(v_role, ''),
    'is_active', v_emp.is_active
  );
END;
$function$


-- [19/83] Function: get_governed_order
CREATE OR REPLACE FUNCTION public.get_governed_order(p_token uuid, p_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_is_super_admin boolean; v_ali_id uuid; v_mahmoud_id uuid; v_order public.orders; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_session.identity_type = 'customer' THEN IF v_order.customer_id != v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF; RETURN v_order; END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin;
  IF v_is_super_admin THEN RETURN v_order; END IF;
  SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
  ELSE
    WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
  END IF;
  IF v_order.owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])) THEN RETURN v_order; END IF;
  RAISE EXCEPTION 'FORBIDDEN';
END;
$function$


-- [20/83] Function: get_governed_preparation_queue
CREATE OR REPLACE FUNCTION public.get_governed_preparation_queue(p_token uuid, p_status_filter text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, order_id uuid, order_code text, customer_name text, status text, started_by uuid, started_at timestamp with time zone, completed_by uuid, completed_at timestamp with time zone, reviewed_by uuid, reviewed_at timestamp with time zone, notes text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_employee_id uuid;
  v_visible_employees uuid[];
BEGIN
  SELECT employee_id INTO v_employee_id FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_employee_id IS NULL THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = v_employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) THEN
    RETURN QUERY
      SELECT pr.id, pr.order_id, o.order_number::text, cust.company_name::text, pr.status::text,
             pr.started_by, pr.started_at, pr.completed_by, pr.completed_at,
             pr.reviewed_by, pr.reviewed_at, pr.notes::text
      FROM public.preparation_records pr
      JOIN public.orders o ON o.id = pr.order_id
      JOIN public.customers cust ON cust.id = o.customer_id
      WHERE (p_status_filter IS NULL OR pr.status::text = p_status_filter)
      ORDER BY pr.created_at DESC;
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT e.id) INTO v_visible_employees FROM public.employees e WHERE e.id = v_employee_id OR e.manager_id = v_employee_id OR e.id IN (SELECT sub.id FROM public.employees sub WHERE sub.manager_id IN (SELECT m.id FROM public.employees m WHERE m.manager_id = v_employee_id));

  RETURN QUERY
    SELECT pr.id, pr.order_id, o.order_number::text, cust.company_name::text, pr.status::text,
           pr.started_by, pr.started_at, pr.completed_by, pr.completed_at,
           pr.reviewed_by, pr.reviewed_at, pr.notes::text
    FROM public.preparation_records pr
    JOIN public.orders o ON o.id = pr.order_id
    JOIN public.customers cust ON cust.id = o.customer_id
    WHERE o.owner_id = ANY(v_visible_employees)
      AND (p_status_filter IS NULL OR pr.status::text = p_status_filter)
    ORDER BY pr.created_at DESC;
END;
$function$


-- [21/83] Function: get_governed_return
CREATE OR REPLACE FUNCTION public.get_governed_return(p_token uuid, p_id uuid)
 RETURNS returns
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_is_super_admin boolean; v_ali_id uuid; v_mahmoud_id uuid; v_return public.returns; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_return FROM public.returns WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_session.identity_type = 'customer' THEN IF v_return.customer_id != v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF; RETURN v_return; END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin;
  IF v_is_super_admin THEN RETURN v_return; END IF;
  SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
  ELSE
    WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
  END IF;
  IF v_return.created_by = ANY(COALESCE(v_visible, '{}'::uuid[])) THEN RETURN v_return; END IF;
  RAISE EXCEPTION 'FORBIDDEN';
END;
$function$


-- [22/83] Function: get_governed_return_items
CREATE OR REPLACE FUNCTION public.get_governed_return_items(p_token uuid, p_return_id uuid)
 RETURNS SETOF return_items
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_is_super_admin boolean; v_ali_id uuid; v_mahmoud_id uuid; v_return public.returns; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_return FROM public.returns WHERE id = p_return_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN IF v_return.customer_id != v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF; RETURN QUERY SELECT ri.* FROM public.return_items ri WHERE ri.return_id = p_return_id; RETURN; END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin;
  IF v_is_super_admin THEN RETURN QUERY SELECT ri.* FROM public.return_items ri WHERE ri.return_id = p_return_id; RETURN; END IF;
  SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
  ELSE
    WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
  END IF;
  IF v_return.created_by = ANY(COALESCE(v_visible, '{}'::uuid[])) THEN RETURN QUERY SELECT ri.* FROM public.return_items ri WHERE ri.return_id = p_return_id; END IF;
END;
$function$


-- [23/83] Function: get_governed_returns
CREATE OR REPLACE FUNCTION public.get_governed_returns(p_token uuid)
 RETURNS SETOF returns
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_is_super_admin boolean; v_ali_id uuid; v_mahmoud_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN RETURN QUERY SELECT r.* FROM public.returns r WHERE r.customer_id = v_session.customer_id; RETURN; END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin;
  IF v_is_super_admin THEN RETURN QUERY SELECT r.* FROM public.returns r ORDER BY r.created_at DESC; RETURN; END IF;
  SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    RETURN QUERY SELECT r.* FROM public.returns r WHERE r.created_by IN (WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT id FROM sub) ORDER BY r.created_at DESC;
  ELSE
    RETURN QUERY SELECT r.* FROM public.returns r WHERE r.created_by IN (WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT id FROM sub) ORDER BY r.created_at DESC;
  END IF;
END;
$function$


-- [24/83] Function: get_governed_visit
CREATE OR REPLACE FUNCTION public.get_governed_visit(p_token uuid, p_id uuid)
 RETURNS visits
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_is_super_admin boolean; v_ali_id uuid; v_mahmoud_id uuid; v_visit public.visits; v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_visit FROM public.visits WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_session.identity_type = 'customer' THEN IF v_visit.customer_id != v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF; RETURN v_visit; END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin;
  IF v_is_super_admin THEN RETURN v_visit; END IF;
  SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
  ELSE
    WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub;
  END IF;
  IF v_visit.employee_id = ANY(COALESCE(v_visible, '{}'::uuid[])) THEN RETURN v_visit; END IF;
  RAISE EXCEPTION 'FORBIDDEN';
END;
$function$


-- [25/83] Function: get_governed_visits
CREATE OR REPLACE FUNCTION public.get_governed_visits(p_token uuid)
 RETURNS SETOF visits
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_is_super_admin boolean; v_ali_id uuid; v_mahmoud_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' THEN RETURN QUERY SELECT v.* FROM public.visits v WHERE v.customer_id = v_session.customer_id; RETURN; END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin;
  IF v_is_super_admin THEN RETURN QUERY SELECT v.* FROM public.visits v ORDER BY v.created_at DESC; RETURN; END IF;
  SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    RETURN QUERY SELECT v.* FROM public.visits v WHERE v.employee_id IN (WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT id FROM sub) ORDER BY v.created_at DESC;
  ELSE
    RETURN QUERY SELECT v.* FROM public.visits v WHERE v.employee_id IN (WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT id FROM sub) ORDER BY v.created_at DESC;
  END IF;
END;
$function$


-- [26/83] Function: get_governed_waiting_preparations
CREATE OR REPLACE FUNCTION public.get_governed_waiting_preparations(p_token uuid)
 RETURNS TABLE(id uuid, code text, customer_name text, total numeric, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_employee_id uuid;
  v_visible_employees uuid[];
BEGIN
  SELECT employee_id INTO v_employee_id FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_employee_id IS NULL THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = v_employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) THEN
    RETURN QUERY
      SELECT o.id, o.order_number::text, cust.company_name::text, o.total_amount, o.created_at
      FROM public.orders o
      JOIN public.customers cust ON cust.id = o.customer_id
      WHERE o.status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM public.preparation_records pr WHERE pr.order_id = o.id)
      ORDER BY o.created_at ASC;
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT e.id) INTO v_visible_employees FROM public.employees e WHERE e.id = v_employee_id OR e.manager_id = v_employee_id OR e.id IN (SELECT sub.id FROM public.employees sub WHERE sub.manager_id IN (SELECT m.id FROM public.employees m WHERE m.manager_id = v_employee_id));

  RETURN QUERY
    SELECT o.id, o.order_number::text, cust.company_name::text, o.total_amount, o.created_at
    FROM public.orders o
    JOIN public.customers cust ON cust.id = o.customer_id
    WHERE o.status = 'approved'
      AND o.owner_id = ANY(v_visible_employees)
      AND NOT EXISTS (SELECT 1 FROM public.preparation_records pr WHERE pr.order_id = o.id)
    ORDER BY o.created_at ASC;
END;
$function$


-- [27/83] Function: get_order_status_counts
CREATE OR REPLACE FUNCTION public.get_order_status_counts(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    DECLARE
      v_session app.sessions;
      statuses text[] := ARRAY['draft','submitted','reviewing','returned_for_revision','approved','preparing','prepared','ready_for_dispatch','sent_to_delivery','dispatched','deferred','cancelled','delivered'];
      result json;
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
      IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;

      WITH counts AS (
        SELECT status::text, COUNT(*)::int AS count
        FROM orders
        GROUP BY status::text
      ),
      all_statuses AS (
        SELECT unnest(statuses) AS status
      )
      SELECT json_agg(json_build_object('status', a.status, 'count', COALESCE(c.count, 0))
        ORDER BY array_position(statuses, a.status))
      INTO result
      FROM all_statuses a
      LEFT JOIN counts c ON c.status = a.status;

      RETURN COALESCE(result, '[]'::json);
    END;
    $function$


-- [28/83] Function: get_visible_customer_ids
CREATE OR REPLACE FUNCTION public.get_visible_customer_ids(p_token uuid)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ DECLARE v_session app.sessions; v_is_super_admin boolean; v_visible uuid[]; v_ali uuid; v_mah uuid; BEGIN SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now(); IF NOT FOUND THEN RETURN; END IF; IF v_session.identity_type = 'customer' THEN RETURN QUERY SELECT c.id FROM public.customers c WHERE c.identity_id = v_session.identity_id; RETURN; END IF; SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now(); IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF; SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin; IF v_is_super_admin THEN SELECT array_agg(id) INTO v_visible FROM public.employees; ELSE SELECT id INTO v_ali FROM public.employees WHERE code = 'WRQ1002' LIMIT 1; SELECT id INTO v_mah FROM public.employees WHERE code = 'WRQ1004' LIMIT 1; IF v_session.employee_id IN (v_ali, v_mah) THEN WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali) UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub; ELSE WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT array_agg(id) INTO v_visible FROM sub; END IF; END IF; RETURN QUERY SELECT DISTINCT c.id FROM public.customers c WHERE c.owner_id = ANY(COALESCE(v_visible, '{}'::uuid[])); END; $function$


-- [29/83] Function: get_visible_employee_ids
CREATE OR REPLACE FUNCTION public.get_visible_employee_ids(p_token uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session app.sessions;
  v_is_super_admin boolean;
  v_ali_id uuid; v_mahmoud_id uuid;
  v_root_id uuid; v_result uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN '{}'::uuid[]; END IF;
  IF v_session.identity_type = 'customer' THEN RETURN '{}'::uuid[]; END IF;
  SELECT EXISTS(SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) INTO v_is_super_admin;
  IF v_is_super_admin THEN SELECT array_agg(id) INTO v_result FROM public.employees; RETURN COALESCE(v_result, '{}'::uuid[]); END IF;
  SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    SELECT manager_id INTO v_root_id FROM public.employees WHERE id = v_ali_id;
    SELECT array_agg(id) INTO v_result FROM (WITH RECURSIVE sub AS (SELECT e.id FROM public.employees e WHERE e.manager_id = v_root_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT id FROM sub) t;
  ELSE
    SELECT array_agg(id) INTO v_result FROM (WITH RECURSIVE sub AS (SELECT id FROM public.employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id) SELECT id FROM sub) t;
  END IF;
  RETURN COALESCE(v_result, '{}'::uuid[]);
END;
$function$


-- [30/83] Function: get_visible_employees
CREATE OR REPLACE FUNCTION public.get_visible_employees(p_token uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_emp_id uuid;
      v_ali_id uuid;
      v_mahmoud_id uuid;
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RETURN ARRAY[]::uuid[]; END IF;
      IF v_session.identity_type = 'customer' THEN
        RETURN ARRAY[]::uuid[];
      END IF;
      v_emp_id := v_session.employee_id;

      -- Shared visibility: Ali Said and Mahmoud Said see the full محمود سعيد subtree
      SELECT id INTO v_ali_id FROM public.employees WHERE full_name = 'علي سعيد' LIMIT 1;
      SELECT id INTO v_mahmoud_id FROM public.employees WHERE full_name = 'محمود سعيد' LIMIT 1;
      IF v_emp_id IN (v_ali_id, v_mahmoud_id) THEN
        WITH RECURSIVE subtree AS (
          SELECT id FROM public.employees WHERE manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id)
          UNION ALL
          SELECT e.id FROM public.employees e JOIN subtree s ON e.manager_id = s.id
        )
        SELECT array_agg(id) INTO STRICT v_emp_id FROM subtree;
        RETURN v_emp_id;
      END IF;

      -- Normal hierarchy
      WITH RECURSIVE subtree AS (
        SELECT id FROM public.employees WHERE id = v_emp_id
        UNION ALL
        SELECT e.id FROM public.employees e JOIN subtree s ON e.manager_id = s.id
      )
      SELECT array_agg(id) INTO STRICT v_emp_id FROM subtree;
      RETURN v_emp_id;
    END;
    $function$


-- [31/83] Function: get_warehouse_analytics
CREATE OR REPLACE FUNCTION public.get_warehouse_analytics(p_token uuid)
 RETURNS TABLE(metric text, value text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_employee_id uuid;
  v_visible_employees uuid[];
  v_avg_interval interval;
BEGIN
  SELECT employee_id INTO v_employee_id FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_employee_id IS NULL THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = v_employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')) THEN
    SELECT avg(pr.completed_at - pr.started_at) INTO v_avg_interval FROM public.preparation_records pr WHERE pr.completed_at IS NOT NULL;
    RETURN QUERY
      SELECT 'prepared_today'::text, COUNT(*)::text FROM public.preparation_records WHERE completed_at >= CURRENT_DATE
      UNION ALL SELECT 'avg_prep_time'::text, COALESCE(EXTRACT(EPOCH FROM v_avg_interval)::text, '0')
      UNION ALL SELECT 'queue_size'::text, COUNT(*)::text FROM public.preparation_records WHERE status IN ('in_progress', 'completed');
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT e.id) INTO v_visible_employees FROM public.employees e WHERE e.id = v_employee_id OR e.manager_id = v_employee_id OR e.id IN (SELECT sub.id FROM public.employees sub WHERE sub.manager_id IN (SELECT m.id FROM public.employees m WHERE m.manager_id = v_employee_id));

  SELECT avg(pr.completed_at - pr.started_at) INTO v_avg_interval FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id WHERE pr.completed_at IS NOT NULL AND o.owner_id = ANY(v_visible_employees);

  RETURN QUERY
    SELECT 'prepared_today'::text, COUNT(*)::text FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id WHERE pr.completed_at >= CURRENT_DATE AND o.owner_id = ANY(v_visible_employees)
    UNION ALL SELECT 'avg_prep_time'::text, COALESCE(EXTRACT(EPOCH FROM v_avg_interval)::text, '0')
    UNION ALL SELECT 'queue_size'::text, COUNT(*)::text FROM public.preparation_records pr JOIN public.orders o ON o.id = pr.order_id WHERE pr.status IN ('in_progress', 'completed') AND o.owner_id = ANY(v_visible_employees);
END;
$function$


-- [32/83] Function: governed_approve_credit
CREATE OR REPLACE FUNCTION public.governed_approve_credit(p_token uuid, p_id uuid)
 RETURNS credit_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_app public.credit_applications; v_prog public.credit_programs; v_template public.credit_contract_templates;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'credit.approve') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_app FROM public.credit_applications WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_app.status NOT IN ('documents_received','under_review') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  SELECT * INTO v_prog FROM public.credit_programs WHERE id = v_app.program_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROGRAM_NOT_FOUND'; END IF;
  UPDATE public.customers SET credit_limit = v_prog.credit_limit, credit_days = v_prog.credit_days, updated_at = now() WHERE id = v_app.customer_id;
  UPDATE public.credit_applications SET status = 'approved', approved_by = v_session.employee_id, approved_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO v_app;
  SELECT * INTO v_template FROM public.credit_contract_templates WHERE is_active = true LIMIT 1;
  INSERT INTO public.credit_contracts (application_id, customer_id, program_snapshot, terms_text) VALUES (p_id, v_app.customer_id, row_to_json(v_prog)::jsonb, COALESCE(v_template.template_text, ''));
  RETURN v_app;
END;
$function$


-- [33/83] Function: governed_approve_return
CREATE OR REPLACE FUNCTION public.governed_approve_return(p_token uuid, p_id uuid, p_credit_note_number text DEFAULT NULL::text, p_credit_note_amount numeric DEFAULT NULL::numeric)
 RETURNS returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_return public.returns;
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
      IF v_session.identity_type = 'customer' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      IF NOT public.check_capability(p_token, 'returns.approve') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: returns.approve'; END IF;

      SELECT * INTO v_return FROM public.returns WHERE id = p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF v_return.status IN ('approved', 'rejected') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

      UPDATE public.returns SET
        status = 'approved',
        credit_note_number = COALESCE(p_credit_note_number, credit_note_number),
        credit_note_amount = COALESCE(p_credit_note_amount, credit_note_amount),
        updated_at = now()
      WHERE id = p_id
      RETURNING * INTO v_return;

      RETURN v_return;
    END;
    $function$


-- [34/83] Function: governed_assign_delivery
CREATE OR REPLACE FUNCTION public.governed_assign_delivery(p_token uuid, p_delivery_id uuid, p_employee_id uuid)
 RETURNS delivery_tracking
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'delivery.dispatch') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  UPDATE public.delivery_tracking SET assigned_to = p_employee_id, assigned_by = v_session.employee_id, assigned_at = now(), updated_at = now() WHERE id = p_delivery_id RETURNING * INTO v_dt;
  RETURN v_dt;
END;
$function$


-- [35/83] Function: governed_cancel_preparation
CREATE OR REPLACE FUNCTION public.governed_cancel_preparation(p_token uuid, p_preparation_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_employee_id uuid;
  v_rec public.preparation_records;
BEGIN
  SELECT employee_id INTO v_employee_id FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_employee_id IS NULL THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'warehouse.prepare') THEN
    RETURN json_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT INTO v_rec FROM public.preparation_records WHERE id = p_preparation_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'PREPARATION_NOT_FOUND'); END IF;
  IF v_rec.status IN ('reviewed', 'failed') THEN RETURN json_build_object('error', 'INVALID_STATUS'); END IF;

  UPDATE public.preparation_records
  SET status = 'failed', cancelled_by = v_employee_id, cancelled_at = now(),
      notes = COALESCE(p_notes, notes), updated_at = now()
  WHERE id = p_preparation_id;

  RETURN json_build_object('id', p_preparation_id, 'status', 'failed', 'cancelled_by', v_employee_id, 'cancelled_at', now());
END;
$function$


-- [36/83] Function: governed_change_order_status
CREATE OR REPLACE FUNCTION public.governed_change_order_status(p_token text, p_order_id uuid, p_new_status text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_current_status text;
  v_from_idx int;
  v_to_idx int;
  v_required_capability text;
  v_has_capability boolean;
  v_is_exceptional boolean;
  statuses text[] := ARRAY['draft','submitted','reviewing','returned_for_revision','approved','preparing','prepared','ready_for_dispatch','sent_to_delivery','dispatched','deferred','cancelled','delivered'];
BEGIN
  -- 1. Authenticate
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_SESSION');
  END IF;

  -- 2. Validate p_new_status
  IF NOT (p_new_status = ANY(statuses)) THEN
    RETURN json_build_object('success', false, 'error', 'حالة غير صالحة');
  END IF;

  -- 3. Read current order status
  SELECT status::text INTO v_current_status FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'الطلب غير موجود');
  END IF;

  IF v_current_status = p_new_status THEN
    RETURN json_build_object('success', false, 'error', 'الطلب بنفس الحالة');
  END IF;

  -- 4. Determine required capability (check orders.manage first â?? it's the catch-all)
  v_from_idx := array_position(statuses, v_current_status);
  v_to_idx := array_position(statuses, p_new_status);

  SELECT check_capability(p_token::uuid, 'orders.manage') INTO v_has_capability;
  IF v_has_capability THEN
    v_required_capability := 'orders.manage';
  ELSE
    IF v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN
      v_required_capability := 'orders.review';
    ELSIF v_current_status = 'approved' AND p_new_status = 'preparing' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF v_current_status = 'preparing' AND p_new_status = 'prepared' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF (v_current_status = 'prepared' OR v_current_status = 'ready_for_dispatch') AND p_new_status = 'sent_to_delivery' THEN
      v_required_capability := 'transportation.send_to_delivery';
    ELSE
      v_required_capability := 'orders.manage';
    END IF;
  END IF;

  -- 5. Validate capability
  SELECT check_capability(p_token::uuid, v_required_capability) INTO v_has_capability;
  IF NOT v_has_capability THEN
    RETURN json_build_object('success', false, 'error', 'U??§ ??UU?U? ?§U??µU??§?­U??© U?U??°?§ ?§U?????U?U??±');
  END IF;

  -- 6. Determine if exceptional
  v_is_exceptional := false;
  IF v_current_status = 'cancelled' OR p_new_status = 'cancelled' THEN
    v_is_exceptional := true;
  ELSIF v_current_status = 'deferred' OR p_new_status = 'deferred' THEN
    v_is_exceptional := true;
  ELSIF v_to_idx < v_from_idx THEN
    v_is_exceptional := true;
  ELSIF v_to_idx > v_from_idx + 1 THEN
    v_is_exceptional := true;
  END IF;

  -- 7. If exceptional, reason is required
  IF v_is_exceptional AND (p_reason IS NULL OR trim(p_reason) = '') THEN
    RETURN json_build_object('success', false, 'error', '?§U??±?¬?§?? ?¥?¯?®?§U? ?³?¨?¨ ?§U?????U?U??± ?§U??§?³???«U??§?¦U?');
  END IF;

  -- 8. Update order
  UPDATE orders SET status = p_new_status, updated_at = now() WHERE id = p_order_id;

  -- 9. Record history
  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_order_id, v_current_status, p_new_status, v_session.employee_id, p_reason, now());

  -- 10. Return success
  RETURN json_build_object('success', true, 'from_status', v_current_status, 'to_status', p_new_status);
END;
$function$


-- [37/83] Function: governed_complete_delivery
CREATE OR REPLACE FUNCTION public.governed_complete_delivery(p_token uuid, p_delivery_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_dt public.delivery_tracking; v_order public.orders;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_dt.status NOT IN ('out_for_delivery','assigned') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.delivery_tracking SET status = 'delivered', completed_at = now(), notes = COALESCE(p_notes, notes), updated_at = now() WHERE id = p_delivery_id RETURNING * INTO v_dt;
  UPDATE public.orders SET status = 'delivered', delivered_at = now(), updated_at = now() WHERE id = v_dt.order_id RETURNING * INTO v_order;
  RETURN jsonb_build_object('delivery_status', 'delivered', 'order_status', v_order.status, 'delivered_at', v_order.delivered_at);
END;
$function$


-- [38/83] Function: governed_complete_preparation
CREATE OR REPLACE FUNCTION public.governed_complete_preparation(p_token uuid, p_preparation_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_employee_id uuid; v_rec public.preparation_records; v_order_id uuid;
BEGIN
  SELECT employee_id INTO v_employee_id FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_employee_id IS NULL THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'warehouse.prepare') THEN RETURN json_build_object('error', 'FORBIDDEN'); END IF;
  SELECT INTO v_rec FROM public.preparation_records WHERE id = p_preparation_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'PREPARATION_NOT_FOUND'); END IF;
  IF v_rec.status != 'in_progress' THEN RETURN json_build_object('error', 'INVALID_STATUS'); END IF;
  SELECT order_id INTO v_order_id FROM public.preparation_records WHERE id = p_preparation_id;
  UPDATE public.preparation_records
  SET status = 'completed', completed_by = v_employee_id, completed_at = now(),
      notes = COALESCE(p_notes, notes), updated_at = now()
  WHERE id = p_preparation_id;
  UPDATE public.orders SET status = 'prepared', updated_at = now() WHERE id = v_order_id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (v_order_id, 'preparing', 'prepared', v_employee_id, COALESCE(p_notes, 'Preparation completed'));
  RETURN json_build_object('id', p_preparation_id, 'status', 'completed', 'completed_by', v_employee_id, 'completed_at', now(), 'order_status', 'prepared');
END;
$function$


-- [39/83] Function: governed_confirm_documents
CREATE OR REPLACE FUNCTION public.governed_confirm_documents(p_token uuid, p_id uuid, p_doc_commercial_reg boolean, p_doc_tax_card boolean, p_doc_national_id boolean, p_doc_cheques boolean, p_doc_contract_signed boolean)
 RETURNS credit_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_app public.credit_applications;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'credit.confirm_documents') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_app FROM public.credit_applications WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_app.status NOT IN ('submitted','under_review') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF p_doc_commercial_reg AND p_doc_tax_card AND p_doc_national_id AND p_doc_cheques AND p_doc_contract_signed THEN
    UPDATE public.credit_applications SET doc_commercial_reg = p_doc_commercial_reg, doc_tax_card = p_doc_tax_card, doc_national_id = p_doc_national_id, doc_cheques = p_doc_cheques, doc_contract_signed = p_doc_contract_signed, doc_confirmed_by = v_session.employee_id, doc_confirmed_at = now(), status = 'documents_received', updated_at = now() WHERE id = p_id RETURNING * INTO v_app;
  ELSE
    UPDATE public.credit_applications SET doc_commercial_reg = p_doc_commercial_reg, doc_tax_card = p_doc_tax_card, doc_national_id = p_doc_national_id, doc_cheques = p_doc_cheques, doc_contract_signed = p_doc_contract_signed, doc_confirmed_by = v_session.employee_id, doc_confirmed_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO v_app;
  END IF;
  RETURN v_app;
END;
$function$


-- [40/83] Function: governed_create_credit_application
CREATE OR REPLACE FUNCTION public.governed_create_credit_application(p_token uuid, p_customer_id uuid, p_program_id uuid)
 RETURNS credit_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_app public.credit_applications; v_prog public.credit_programs;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'credit.create') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_prog FROM public.credit_programs WHERE id = p_program_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PROGRAM'; END IF;
  IF v_session.identity_type = 'customer' THEN
    IF v_session.customer_id IS DISTINCT FROM p_customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    INSERT INTO public.credit_applications (customer_id, program_id, created_by) VALUES (p_customer_id, p_program_id, v_session.customer_id) RETURNING * INTO v_app;
  ELSE
    INSERT INTO public.credit_applications (customer_id, program_id, created_by) VALUES (p_customer_id, p_program_id, v_session.employee_id) RETURNING * INTO v_app;
  END IF;
  RETURN v_app;
END;
$function$


-- [41/83] Function: governed_create_credit_program
CREATE OR REPLACE FUNCTION public.governed_create_credit_program(p_token uuid, p_name character varying, p_credit_limit numeric, p_credit_days integer, p_terms text DEFAULT NULL::text)
 RETURNS credit_programs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_prog public.credit_programs;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'credit.manage_programs') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  INSERT INTO public.credit_programs (name, credit_limit, credit_days, terms) VALUES (p_name, p_credit_limit, p_credit_days, p_terms) RETURNING * INTO v_prog;
  RETURN v_prog;
END;
$function$


-- [42/83] Function: governed_create_return
CREATE OR REPLACE FUNCTION public.governed_create_return(p_token uuid, p_order_id uuid, p_customer_id uuid, p_notes text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_return public.returns;
      v_code text;
      v_seq int;
      v_item jsonb;
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
      IF v_session.identity_type = 'customer' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      IF NOT public.check_capability(p_token, 'returns.create') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: returns.create'; END IF;

      SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences WHERE code_type = 'return' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
      IF NOT FOUND THEN v_seq := 1; END IF;
      v_code := 'RET-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

      INSERT INTO public.returns (code, order_id, customer_id, owner_type, owner_id, created_by, notes)
      VALUES (v_code, p_order_id, p_customer_id, 'employee', v_session.employee_id, v_session.employee_id, p_notes)
      RETURNING * INTO v_return;

      INSERT INTO public.code_sequences (code_type, year, last_sequence)
      VALUES ('return', EXTRACT(year FROM now())::int, v_seq)
      ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_seq;

      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        INSERT INTO public.return_items (return_id, product_id, unit_type, quantity, reason)
        VALUES (
          v_return.id,
          (v_item->>'product_id')::uuid,
          v_item->>'unit_type',
          (v_item->>'quantity')::int,
          v_item->>'reason'
        );
      END LOOP;

      RETURN v_return;
    END;
    $function$


-- [43/83] Function: governed_create_visit
CREATE OR REPLACE FUNCTION public.governed_create_visit(p_token uuid, p_customer_id uuid, p_check_in_latitude numeric DEFAULT NULL::numeric, p_check_in_longitude numeric DEFAULT NULL::numeric, p_google_maps_link text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_visit public.visits;
      v_code text;
      v_seq int;
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
      IF v_session.identity_type = 'customer' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      IF NOT public.check_capability(p_token, 'visits.create') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: visits.create'; END IF;

      SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences WHERE code_type = 'visit' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
      IF NOT FOUND THEN v_seq := 1; END IF;
      v_code := 'VIS-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

      INSERT INTO public.visits (code, employee_id, customer_id, check_in_latitude, check_in_longitude, google_maps_link, notes)
      VALUES (v_code, v_session.employee_id, p_customer_id, p_check_in_latitude, p_check_in_longitude, p_google_maps_link, p_notes)
      RETURNING * INTO v_visit;

      INSERT INTO public.code_sequences (code_type, year, last_sequence)
      VALUES ('visit', EXTRACT(year FROM now())::int, v_seq)
      ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_seq;

      RETURN v_visit;
    END;
    $function$


-- [44/83] Function: governed_delete_collection
CREATE OR REPLACE FUNCTION public.governed_delete_collection(p_token uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_collection public.collections;
      v_visible uuid[];
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
      IF NOT public.check_capability(p_token, 'collections.delete') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: collections.delete'; END IF;

      SELECT * INTO v_collection FROM public.collections WHERE id = p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

      IF v_session.identity_type = 'employee' THEN
        v_visible := public.get_visible_employee_ids(p_token);
        IF NOT (v_collection.created_by = ANY(v_visible)) THEN RAISE EXCEPTION 'FORBIDDEN: collection not in visibility scope'; END IF;
      ELSE
        RAISE EXCEPTION 'FORBIDDEN';
      END IF;

      DELETE FROM public.collections WHERE id = p_id;
      RETURN true;
    END;
    $function$


-- [45/83] Function: governed_delete_customer
CREATE OR REPLACE FUNCTION public.governed_delete_customer(p_token uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_customer public.customers;
      v_visible uuid[];
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
      IF NOT public.check_capability(p_token, 'customers.delete') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: customers.delete'; END IF;

      SELECT * INTO v_customer FROM public.customers WHERE id = p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

      IF v_session.identity_type = 'employee' THEN
        v_visible := public.get_visible_employee_ids(p_token);
        IF NOT (v_customer.owner_id = ANY(v_visible)) THEN RAISE EXCEPTION 'FORBIDDEN: customer not in visibility scope'; END IF;
      ELSE
        IF v_customer.identity_id IS DISTINCT FROM v_session.identity_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      END IF;

      DELETE FROM public.customers WHERE id = p_id;
      RETURN true;
    END;
    $function$


-- [46/83] Function: governed_delete_order
CREATE OR REPLACE FUNCTION public.governed_delete_order(p_token uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_order public.orders;
      v_visible uuid[];
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
      IF NOT public.check_capability(p_token, 'orders.delete') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: orders.delete'; END IF;

      SELECT * INTO v_order FROM public.orders WHERE id = p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

      IF v_session.identity_type = 'employee' THEN
        v_visible := public.get_visible_employee_ids(p_token);
        IF NOT (v_order.owner_id = ANY(v_visible)) THEN RAISE EXCEPTION 'FORBIDDEN: order not in visibility scope'; END IF;
      ELSE
        RAISE EXCEPTION 'FORBIDDEN';
      END IF;

      DELETE FROM public.order_items WHERE order_id = p_id;
      DELETE FROM public.order_status_history WHERE order_id = p_id;
      DELETE FROM public.order_modification_history WHERE order_id = p_id;
      DELETE FROM public.orders WHERE id = p_id;
      RETURN true;
    END;
    $function$


-- [47/83] Function: governed_dispatch_decision
CREATE OR REPLACE FUNCTION public.governed_dispatch_decision(p_token uuid, p_id uuid, p_action text, p_assigned_to uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_follow_up_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_session app.sessions; v_order public.orders; v_employee_id uuid; v_emp_code text; v_authorized boolean; v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  v_employee_id := v_session.employee_id;
  SELECT code INTO v_emp_code FROM public.employees WHERE id = v_employee_id;
  v_authorized := EXISTS (SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN','EXECUTIVE_MANAGER','Sales Manager'));
  IF NOT v_authorized THEN RETURN json_build_object('error', 'FORBIDDEN', 'detail', 'Only Sales Manager and higher can make dispatch decisions'); END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'NOT_FOUND'); END IF;
  IF v_order.status != 'ready_for_dispatch' THEN RETURN json_build_object('error', 'INVALID_STATE', 'detail', 'Order must be in ready_for_dispatch status'); END IF;
  IF p_action = 'send' THEN
    IF p_assigned_to IS NULL THEN RETURN json_build_object('error', 'MISSING_ASSIGNEE', 'detail', 'A delivery employee must be assigned'); END IF;
    UPDATE public.orders SET status = 'sent_to_delivery', updated_at = now() WHERE id = p_id;
    INSERT INTO public.delivery_tracking (order_id, status, assigned_to, assigned_by, assigned_at) VALUES (p_id, 'assigned', p_assigned_to, v_employee_id, now()) RETURNING * INTO v_dt;
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, 'ready_for_dispatch', 'sent_to_delivery', v_employee_id, COALESCE(p_reason, 'Sent to delivery'));
    RETURN json_build_object('action', 'sent_to_delivery', 'order_status', 'sent_to_delivery', 'delivery_id', v_dt.id);
  ELSIF p_action = 'defer' THEN
    IF p_follow_up_date IS NULL THEN RETURN json_build_object('error', 'MISSING_FOLLOW_UP', 'detail', 'Follow-up date is required for deferral'); END IF;
    UPDATE public.orders SET status = 'deferred', deferred_until = p_follow_up_date, defer_reason = p_reason, updated_at = now() WHERE id = p_id;
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, 'ready_for_dispatch', 'deferred', v_employee_id, COALESCE(p_reason, 'Order deferred'));
    RETURN json_build_object('action', 'deferred', 'order_status', 'deferred', 'deferred_until', p_follow_up_date);
  ELSIF p_action = 'cancel' THEN
    IF p_reason IS NULL THEN RETURN json_build_object('error', 'MISSING_REASON', 'detail', 'Cancellation reason is required'); END IF;
    UPDATE public.orders SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, updated_at = now() WHERE id = p_id;
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, 'ready_for_dispatch', 'cancelled', v_employee_id, p_reason);
    RETURN json_build_object('action', 'cancelled', 'order_status', 'cancelled', 'cancelled_at', now());
  ELSE
    RETURN json_build_object('error', 'INVALID_ACTION', 'detail', 'Action must be send, defer, or cancel');
  END IF;
END;
$function$


-- [48/83] Function: governed_fail_delivery
CREATE OR REPLACE FUNCTION public.governed_fail_delivery(p_token uuid, p_delivery_id uuid, p_reason character varying, p_notes text DEFAULT NULL::text)
 RETURNS delivery_tracking
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_dt.status NOT IN ('out_for_delivery','assigned') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.delivery_tracking SET status = 'failed', failure_reason = p_reason, failure_notes = p_notes, completed_at = now(), updated_at = now() WHERE id = p_delivery_id RETURNING * INTO v_dt;
  RETURN v_dt;
END;
$function$


-- [49/83] Function: governed_fail_preparation
CREATE OR REPLACE FUNCTION public.governed_fail_preparation(p_token uuid, p_preparation_id uuid, p_failure_reason text, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_employee_id uuid;
  v_prep_status text;
  v_order_id uuid;
  v_order_status text;
BEGIN
  SELECT employee_id INTO v_employee_id FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_employee_id IS NULL THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'warehouse.prepare') THEN
    RETURN json_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT status::text, order_id INTO v_prep_status, v_order_id
  FROM public.preparation_records WHERE id = p_preparation_id;
  IF v_order_id IS NULL THEN RETURN json_build_object('error', 'PREPARATION_NOT_FOUND'); END IF;
  IF v_prep_status NOT IN ('in_progress', 'completed') THEN
    RETURN json_build_object('error', 'INVALID_STATUS', 'detail', 'Can only fail in_progress or completed preparations');
  END IF;

  SELECT status::text INTO v_order_status FROM public.orders WHERE id = v_order_id;

  UPDATE public.preparation_records
  SET status = 'failed'::preparation_status,
      cancelled_by = v_employee_id,
      cancelled_at = now(),
      notes = COALESCE(p_notes, notes) || E'\nFailure reason: ' || p_failure_reason,
      updated_at = now()
  WHERE id = p_preparation_id;

  UPDATE public.orders SET status = 'approved', updated_at = now() WHERE id = v_order_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (v_order_id, v_order_status, 'approved', v_employee_id, 'Preparation failed: ' || p_failure_reason, now());

  RETURN json_build_object(
    'id', p_preparation_id,
    'order_id', v_order_id,
    'status', 'failed',
    'failure_reason', p_failure_reason,
    'cancelled_by', v_employee_id,
    'cancelled_at', now()
  );
END;
$function$


-- [50/83] Function: governed_get_contract_by_application
CREATE OR REPLACE FUNCTION public.governed_get_contract_by_application(p_token uuid, p_application_id uuid)
 RETURNS SETOF credit_contracts
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_app public.credit_applications;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_app FROM public.credit_applications WHERE id = p_application_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' AND v_app.customer_id IS DISTINCT FROM v_session.customer_id THEN RETURN; END IF;
  RETURN QUERY SELECT cc.* FROM public.credit_contracts cc WHERE cc.application_id = p_application_id LIMIT 1;
END;
$function$


-- [51/83] Function: governed_get_contract_template
CREATE OR REPLACE FUNCTION public.governed_get_contract_template(p_token uuid)
 RETURNS SETOF credit_contract_templates
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.credit_contract_templates WHERE is_active = true ORDER BY updated_at DESC LIMIT 1;
END;
$function$


-- [52/83] Function: governed_get_credit_programs
CREATE OR REPLACE FUNCTION public.governed_get_credit_programs(p_token uuid, p_include_inactive boolean DEFAULT false)
 RETURNS SETOF credit_programs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_is_admin boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session.identity_type = 'customer' OR NOT p_include_inactive THEN
    RETURN QUERY SELECT * FROM public.credit_programs WHERE is_active = true ORDER BY credit_limit;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.check_capability(p_token, 'credit.manage_programs')) INTO v_is_admin;
    IF v_is_admin THEN
      RETURN QUERY SELECT * FROM public.credit_programs ORDER BY is_active DESC, credit_limit;
    ELSE
      RETURN QUERY SELECT * FROM public.credit_programs WHERE is_active = true ORDER BY credit_limit;
    END IF;
  END IF;
END;
$function$


-- [53/83] Function: governed_get_delivery
CREATE OR REPLACE FUNCTION public.governed_get_delivery(p_token uuid, p_delivery_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('delivery', row_to_json(dt)::jsonb, 'order', row_to_json(o)::jsonb, 'customer', row_to_json(c)::jsonb, 'assigned_employee', (SELECT row_to_json(e)::jsonb FROM employees e WHERE e.id = dt.assigned_to)) INTO v_result FROM public.delivery_tracking dt JOIN public.orders o ON o.id = dt.order_id JOIN public.customers c ON c.id = o.customer_id WHERE dt.id = p_delivery_id AND (v_session.identity_type != 'customer' OR o.customer_id = v_session.customer_id);
  RETURN v_result;
END;
$function$


-- [54/83] Function: governed_reactivate_credit
CREATE OR REPLACE FUNCTION public.governed_reactivate_credit(p_token uuid, p_id uuid)
 RETURNS credit_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_app public.credit_applications;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'credit.suspend') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_app FROM public.credit_applications WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_app.status != 'suspended' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.credit_applications SET status = 'approved', updated_at = now() WHERE id = p_id RETURNING * INTO v_app;
  RETURN v_app;
END;
$function$


-- [55/83] Function: governed_record_exception
CREATE OR REPLACE FUNCTION public.governed_record_exception(p_token uuid, p_preparation_id uuid, p_exception_type text, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_employee_id uuid;
  v_prep_status text;
  v_exc_id uuid;
BEGIN
  SELECT employee_id INTO v_employee_id FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_employee_id IS NULL THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'warehouse.prepare') THEN
    RETURN json_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT status::text INTO v_prep_status FROM public.preparation_records WHERE id = p_preparation_id;
  IF v_prep_status IS NULL THEN RETURN json_build_object('error', 'PREPARATION_NOT_FOUND'); END IF;
  IF v_prep_status NOT IN ('in_progress', 'completed') THEN
    RETURN json_build_object('error', 'INVALID_STATUS', 'detail', 'Can only record exceptions on active or completed preparations');
  END IF;

  INSERT INTO public.preparation_exceptions (preparation_id, exception_type, notes, created_by)
  VALUES (p_preparation_id, p_exception_type::public.preparation_exception_type, p_notes, v_employee_id)
  RETURNING id INTO v_exc_id;

  RETURN json_build_object('id', v_exc_id, 'preparation_id', p_preparation_id, 'exception_type', p_exception_type, 'created_by', v_employee_id, 'created_at', now());
END;
$function$


-- [56/83] Function: governed_reject_credit
CREATE OR REPLACE FUNCTION public.governed_reject_credit(p_token uuid, p_id uuid, p_reason text)
 RETURNS credit_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_app public.credit_applications;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'credit.approve') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_app FROM public.credit_applications WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_app.status NOT IN ('documents_received','under_review','submitted') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.credit_applications SET status = 'rejected', approved_by = v_session.employee_id, approved_at = now(), rejection_reason = p_reason, updated_at = now() WHERE id = p_id RETURNING * INTO v_app;
  RETURN v_app;
END;
$function$


-- [57/83] Function: governed_reject_order
CREATE OR REPLACE FUNCTION public.governed_reject_order(p_token uuid, p_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_order public.orders;
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
      IF NOT public.check_capability(p_token, 'orders.approve') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: orders.approve'; END IF;

      SELECT * INTO v_order FROM public.orders WHERE id = p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF v_order.status IN ('delivered', 'cancelled') THEN RAISE EXCEPTION 'INVALID_STATE: order cannot be rejected'; END IF;

      UPDATE public.orders SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO v_order;

      INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
      VALUES (p_id, v_order.status, 'cancelled', v_session.employee_id, COALESCE(p_reason, 'Order rejected'));

      RETURN v_order;
    END;
    $function$


-- [58/83] Function: governed_reject_return
CREATE OR REPLACE FUNCTION public.governed_reject_return(p_token uuid, p_id uuid)
 RETURNS returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_return public.returns;
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
      IF v_session.identity_type = 'customer' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      IF NOT public.check_capability(p_token, 'returns.approve') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: returns.approve'; END IF;

      SELECT * INTO v_return FROM public.returns WHERE id = p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF v_return.status IN ('approved', 'rejected') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

      UPDATE public.returns SET status = 'rejected', updated_at = now() WHERE id = p_id RETURNING * INTO v_return;

      RETURN v_return;
    END;
    $function$


-- [59/83] Function: governed_reopen_cancelled
CREATE OR REPLACE FUNCTION public.governed_reopen_cancelled(p_token uuid, p_order_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_employee_id uuid; v_authorized boolean; v_emp_code text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;
  v_employee_id := v_session.employee_id;
  SELECT code INTO v_emp_code FROM public.employees WHERE id = v_employee_id;
  v_authorized := EXISTS (SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = v_employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN','EXECUTIVE_MANAGER','Sales Manager'));
  IF NOT v_authorized THEN RETURN json_build_object('error', 'FORBIDDEN', 'detail', 'Only Sales Manager and higher can reopen cancelled orders'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND status = 'cancelled') THEN
    RETURN json_build_object('error', 'INVALID_STATE', 'detail', 'Only cancelled orders can be reopened');
  END IF;
  UPDATE public.orders SET status = 'ready_for_dispatch', cancelled_at = NULL, cancel_reason = NULL, updated_at = now() WHERE id = p_order_id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_order_id, 'cancelled', 'ready_for_dispatch', v_employee_id, COALESCE(p_reason, 'Order reopened for dispatch'));
  RETURN json_build_object('action', 'reopened', 'order_status', 'ready_for_dispatch');
END;
$function$


-- [60/83] Function: governed_return_deferred
CREATE OR REPLACE FUNCTION public.governed_return_deferred(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_order public.orders;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'NOT_FOUND'); END IF;
  IF v_order.status != 'deferred' THEN RETURN json_build_object('error', 'INVALID_STATE', 'detail', 'Order must be deferred'); END IF;
  IF v_order.deferred_until IS NULL OR v_order.deferred_until > now() THEN
    RETURN json_build_object('error', 'TOO_EARLY', 'detail', 'Follow-up date has not been reached yet');
  END IF;
  UPDATE public.orders SET status = 'ready_for_dispatch', deferred_until = NULL, updated_at = now() WHERE id = p_order_id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_order_id, 'deferred', 'ready_for_dispatch', v_order.created_by, 'Automatic return: follow-up date reached');
  RETURN json_build_object('action', 'returned_from_deferred', 'order_status', 'ready_for_dispatch');
END;
$function$


-- [61/83] Function: governed_return_delivery
CREATE OR REPLACE FUNCTION public.governed_return_delivery(p_token uuid, p_delivery_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_dt.status NOT IN ('out_for_delivery','assigned') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.delivery_tracking SET status = 'returned', failure_reason = 'returned_to_warehouse', failure_notes = p_notes, returned_at = now(), updated_at = now() WHERE id = p_delivery_id RETURNING * INTO v_dt;
  UPDATE public.orders SET status = 'approved', updated_at = now() WHERE id = v_dt.order_id;
  RETURN jsonb_build_object('delivery_status', 'returned', 'order_status', 'approved');
END;
$function$


-- [62/83] Function: governed_return_to_preparation
CREATE OR REPLACE FUNCTION public.governed_return_to_preparation(p_token uuid, p_preparation_id uuid, p_notes text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_employee_id uuid;
  v_emp_code text;
  v_prep_status text;
  v_authorized boolean;
BEGIN
  SELECT employee_id INTO v_employee_id FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF v_employee_id IS NULL THEN RETURN json_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT code INTO v_emp_code FROM public.employees WHERE id = v_employee_id;

  v_authorized := EXISTS (SELECT 1 FROM public.employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = v_employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN'));
  IF NOT v_authorized THEN v_authorized := v_emp_code IN ('REP-001', 'WRQ1005', 'WRQ1002', 'WRQ1004', 'WRQ1003', 'WRQ1006'); END IF;
  IF NOT v_authorized THEN RETURN json_build_object('error', 'FORBIDDEN'); END IF;

  SELECT status::text INTO v_prep_status FROM public.preparation_records WHERE id = p_preparation_id;
  IF v_prep_status IS NULL THEN RETURN json_build_object('error', 'PREPARATION_NOT_FOUND'); END IF;
  IF v_prep_status != 'completed' THEN RETURN json_build_object('error', 'INVALID_STATUS', 'current_status', v_prep_status); END IF;

  IF p_notes IS NULL OR trim(p_notes) = '' THEN
    RETURN json_build_object('error', 'REASON_REQUIRED', 'detail', 'A reason for returning to preparation is required');
  END IF;

  UPDATE public.preparation_records
  SET status = 'in_progress'::preparation_status,
      completed_by = NULL,
      completed_at = NULL,
      notes = COALESCE(notes, '') || E'\nReturned to preparation: ' || p_notes,
      updated_at = now()
  WHERE id = p_preparation_id;

  RETURN json_build_object('id', p_preparation_id, 'status', 'in_progress', 'returned_by', v_employee_id, 'returned_at', now(), 'reason', p_notes);
END;
$function$


-- [63/83] Function: governed_review_credit
CREATE OR REPLACE FUNCTION public.governed_review_credit(p_token uuid, p_id uuid)
 RETURNS credit_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_app public.credit_applications;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'credit.review') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_app FROM public.credit_applications WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_app.status != 'submitted' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.credit_applications SET status = 'under_review', reviewed_by = v_session.employee_id, reviewed_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO v_app;
  RETURN v_app;
END;
$function$


-- [64/83] Function: governed_sign_contract
CREATE OR REPLACE FUNCTION public.governed_sign_contract(p_token uuid, p_application_id uuid)
 RETURNS credit_contracts
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_contract public.credit_contracts; v_app public.credit_applications;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_app FROM public.credit_applications WHERE id = p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_session.identity_type = 'customer' AND v_app.customer_id IS DISTINCT FROM v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.credit_contracts SET signed_at = now(), signed_by = v_session.identity_id WHERE application_id = p_application_id AND signed_at IS NULL RETURNING * INTO v_contract;
  IF NOT FOUND THEN RAISE EXCEPTION 'ALREADY_SIGNED_OR_NOT_FOUND'; END IF;
  RETURN v_contract;
END;
$function$


-- [65/83] Function: governed_start_delivery
CREATE OR REPLACE FUNCTION public.governed_start_delivery(p_token uuid, p_delivery_id uuid)
 RETURNS delivery_tracking
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_dt.status != 'assigned' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.delivery_tracking SET status = 'out_for_delivery', started_at = now(), updated_at = now() WHERE id = p_delivery_id RETURNING * INTO v_dt;
  RETURN v_dt;
END;
$function$


-- [66/83] Function: governed_start_preparation
CREATE OR REPLACE FUNCTION public.governed_start_preparation(p_token uuid, p_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_session app.sessions; v_order public.orders; v_prep public.preparation_records;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  PERFORM check_capability(p_token, 'orders.prepare');
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_order.status NOT IN ('approved', 'ready_for_dispatch') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;
  IF EXISTS (SELECT 1 FROM public.preparation_records WHERE order_id = p_id AND status = 'in_progress') THEN RETURN jsonb_build_object('error', 'ALREADY_IN_PREPARATION'); END IF;
  INSERT INTO public.preparation_records (order_id, started_by, status, notes) VALUES (p_id, v_session.employee_id, 'in_progress', p_notes) RETURNING * INTO v_prep;
  UPDATE public.orders SET status = 'preparing', updated_at = now() WHERE id = p_id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason) VALUES (p_id, v_order.status, 'preparing', v_session.employee_id, 'Preparation started');
  RETURN jsonb_build_object('success', true, 'preparation_id', v_prep.id);
END;
$function$


-- [67/83] Function: governed_submit_credit_application
CREATE OR REPLACE FUNCTION public.governed_submit_credit_application(p_token uuid, p_id uuid)
 RETURNS credit_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_app public.credit_applications;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'credit.submit') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_app FROM public.credit_applications WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_app.status != 'draft' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF v_session.identity_type = 'customer' AND v_app.customer_id IS DISTINCT FROM v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.credit_applications SET status = 'submitted', submitted_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO v_app;
  RETURN v_app;
END;
$function$


-- [68/83] Function: governed_suspend_credit
CREATE OR REPLACE FUNCTION public.governed_suspend_credit(p_token uuid, p_id uuid, p_reason text)
 RETURNS credit_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_app public.credit_applications;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'credit.suspend') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  SELECT * INTO v_app FROM public.credit_applications WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_app.status != 'approved' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.credit_applications SET status = 'suspended', suspended_by = v_session.employee_id, suspended_at = now(), suspension_reason = p_reason, updated_at = now() WHERE id = p_id RETURNING * INTO v_app;
  RETURN v_app;
END;
$function$


-- [69/83] Function: governed_toggle_credit_program
CREATE OR REPLACE FUNCTION public.governed_toggle_credit_program(p_token uuid, p_id uuid, p_is_active boolean)
 RETURNS credit_programs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_prog public.credit_programs;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'credit.manage_programs') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  UPDATE public.credit_programs SET is_active = p_is_active, updated_at = now() WHERE id = p_id RETURNING * INTO v_prog;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN v_prog;
END;
$function$


-- [70/83] Function: governed_update_company_profile
CREATE OR REPLACE FUNCTION public.governed_update_company_profile(p_token uuid, p_company_name text DEFAULT NULL::text, p_company_banner_url text DEFAULT NULL::text, p_facebook_url text DEFAULT NULL::text, p_sales_phone_1 text DEFAULT NULL::text, p_sales_phone_2 text DEFAULT NULL::text, p_sales_whatsapp_1 text DEFAULT NULL::text, p_sales_whatsapp_2 text DEFAULT NULL::text, p_technical_support_phone text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'INVALID_SESSION'); END IF;

  -- Sales Manager and above check
  IF NOT check_capability(p_token, 'orders.manage') THEN
    RETURN json_build_object('success', false, 'error', 'U??§ ??UU?U? ?§U??µU??§?­U??©');
  END IF;

  UPDATE public.company_profile
  SET
    company_name         = COALESCE(p_company_name, company_name),
    company_banner_url   = COALESCE(p_company_banner_url, company_banner_url),
    facebook_url         = COALESCE(p_facebook_url, facebook_url),
    sales_phone_1        = COALESCE(p_sales_phone_1, sales_phone_1),
    sales_phone_2        = COALESCE(p_sales_phone_2, sales_phone_2),
    sales_whatsapp_1     = COALESCE(p_sales_whatsapp_1, sales_whatsapp_1),
    sales_whatsapp_2     = COALESCE(p_sales_whatsapp_2, sales_whatsapp_2),
    technical_support_phone = COALESCE(p_technical_support_phone, technical_support_phone),
    updated_at           = now()
  WHERE id = 1;

  RETURN json_build_object('success', true);
END;
$function$


-- [71/83] Function: governed_update_contract_template
CREATE OR REPLACE FUNCTION public.governed_update_contract_template(p_token uuid, p_id uuid, p_template_text text)
 RETURNS credit_contract_templates
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_tpl public.credit_contract_templates;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'credit.manage_contracts') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  UPDATE public.credit_contract_templates SET template_text = p_template_text, updated_at = now() WHERE id = p_id RETURNING * INTO v_tpl;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN v_tpl;
END;
$function$


-- [72/83] Function: governed_update_credit_program
CREATE OR REPLACE FUNCTION public.governed_update_credit_program(p_token uuid, p_id uuid, p_name character varying, p_credit_limit numeric, p_credit_days integer, p_terms text DEFAULT NULL::text)
 RETURNS credit_programs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_session app.sessions; v_prog public.credit_programs;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'credit.manage_programs') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;
  UPDATE public.credit_programs SET name = p_name, credit_limit = p_credit_limit, credit_days = p_credit_days, terms = COALESCE(p_terms, terms), updated_at = now() WHERE id = p_id RETURNING * INTO v_prog;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN v_prog;
END;
$function$


-- [73/83] Function: governed_update_return
CREATE OR REPLACE FUNCTION public.governed_update_return(p_token uuid, p_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_return public.returns;
      v_old public.returns;
      v_visible uuid[];
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
      IF NOT public.check_capability(p_token, 'returns.update') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: returns.update'; END IF;

      SELECT * INTO v_old FROM public.returns WHERE id = p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

      IF v_session.identity_type = 'employee' THEN
        v_visible := public.get_visible_employee_ids(p_token);
        IF NOT (v_old.created_by = ANY(v_visible)) THEN RAISE EXCEPTION 'FORBIDDEN: return not in visibility scope'; END IF;
      ELSE
        IF v_old.customer_id IS DISTINCT FROM v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      END IF;

      UPDATE public.returns SET
        notes = COALESCE(p_notes, notes),
        updated_at = now()
      WHERE id = p_id
      RETURNING * INTO v_return;

      RETURN v_return;
    END;
    $function$


-- [74/83] Function: login
CREATE OR REPLACE FUNCTION public.login(p_phone text, p_password text)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
AS $function$ SELECT api.login(p_phone, p_password); $function$


-- [75/83] Function: logout
CREATE OR REPLACE FUNCTION public.logout(p_token uuid)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
AS $function$ SELECT api.logout(p_token); $function$


-- [76/83] Function: multiline_test
CREATE OR REPLACE FUNCTION public.multiline_test()
 RETURNS json
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN json_build_object('ok', true);
END;
$function$


-- [77/83] Function: ping
CREATE OR REPLACE FUNCTION public.ping()
 RETURNS json
 LANGUAGE plpgsql
AS $function$ BEGIN RETURN json_build_object('ok', true); END; $function$


-- [78/83] Function: test_func
CREATE OR REPLACE FUNCTION public.test_func(x integer)
 RETURNS integer
 LANGUAGE sql
AS $function$ SELECT x * 2; $function$


-- [79/83] Function: test_ping2
CREATE OR REPLACE FUNCTION public.test_ping2()
 RETURNS json
 LANGUAGE plpgsql
AS $function$ BEGIN RETURN json_build_object('ok', true); END; $function$


-- [80/83] Function: test_ping3
CREATE OR REPLACE FUNCTION public.test_ping3()
 RETURNS json
 LANGUAGE plpgsql
AS $function$ BEGIN RETURN json_build_object('ok', true); END; $function$


-- [81/83] Function: test_rpc
CREATE OR REPLACE FUNCTION public.test_rpc(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$ DECLARE v_session app.sessions; BEGIN SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now(); IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF; RETURN jsonb_build_object('ok', true); END; $function$


-- [82/83] Function: test_setof
CREATE OR REPLACE FUNCTION public.test_setof()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
AS $function$ BEGIN RETURN QUERY SELECT '00000000-0000-0000-0000-000000000001'::uuid; END; $function$


-- [83/83] Function: validate_session
CREATE OR REPLACE FUNCTION public.validate_session(p_token uuid)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
AS $function$ SELECT api.validate_session(p_token); $function$


