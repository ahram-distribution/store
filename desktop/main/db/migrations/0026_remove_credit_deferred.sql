-- ============================================================================
-- 0026 — REMOVE CREDIT / DEFERRED-PAYMENT SYSTEM
-- ============================================================================
-- Owner-executed removal of the Credit portfolio (آجل/ائتمان) from Ahram ERP.
--
-- SCOPE
--   * Drops 8 credit tables: credit_programs, credit_applications,
--     credit_contracts, credit_contract_templates, credit_invoices,
--     credit_invoice_cheques, credit_collection_invoices,
--     credit_collection_requests.
--   * Drops 3 credit enum types: cheque_status, credit_application_status,
--     credit_invoice_status (credit_account_status + ledger_transaction_type
--     are KEPT — still used by the SAHL credit-account surface).
--   * Drops 39 RPCs (32 credit-named + 7 non-credit-named workflow RPCs).
--   * Drops customers.credit_limit / customers.credit_days / 
--     customer_credit_accounts.credit_program_id.
--   * Deletes the "معتمد ائتماني" role, the credit system-module row, and the
--     credit owner-decisions.
--
-- PRESERVED
--   * Historical orders: payment_method/order_type 'credit' are normalized to
--     'cash' so total amounts, item-level data, status history, collections
--     and treasury references stay intact. NO historical row is deleted.
--   * orders.defer_reason / orders.deferred_until (returns / deferral labels).
--   * returns.credit_note_number / returns.credit_note_amount +
--     generate_credit_note_number() (returns-domain credit notes only).
--   * customer_credit_accounts (columns except credit_program_id) and
--     customer_credit_ledger, supplier_credit_accounts, supplier_credit_ledger
--     — full SAHL surface stays.
--   * generate_cheque_number() (reads only code_sequences; cash/SAHL domain).
--   * capabilities registry rows (kept inert; only the credit role is removed).
--
-- CASH-ONLY ENFORCEMENT (new orders)
--   * ck_orders_order_type is rewritten to ('cash','ittiman') so historical
--     ittiman rows remain updateable while credit can no longer be selected.
--   * A BEFORE INSERT trigger on orders rejects any new row whose
--     payment_method or order_type is not 'cash'. INSERT-only so historical
--     rows are never touched (matching 0019's execution-group neutrality).
--   * PostgREST cannot bypass INSERT triggers; InitialSync disables triggers
--     locally when pulling the historical baseline.
--
-- DEPLOY ORDER (must be followed):
--   1. Push frontend (no UI path creates credit / ittiman orders).
--   2. Wait for Pages deploy.
--   3. Apply this migration.
-- ============================================================================


-- ============================================================================
-- 1. DATA NORMALIZATION (historical rows preserved — value-only rewrite)
-- ============================================================================
-- 19 rows: payment_method 'credit' but order_type 'cash'  -> cash.
--  8 rows: order_type 'credit' (all delivered/cancelled)  -> cash.
-- ittiman rows (12) are left untouched.

UPDATE public.orders
   SET payment_method = 'cash'
 WHERE payment_method = 'credit';

UPDATE public.orders
   SET order_type = 'cash'
 WHERE order_type = 'credit';


-- ============================================================================
-- 2. FUNCTION REWRITES (DROP + CREATE OR REPLACE, identical signatures)
-- 21 kept functions that referenced dropped columns / tables are rewritten
-- first so the column/type/table drops below do not leave dangling bodies.
-- Any pre-existing overload of get_follow_up_customer_screening (0024 legacy
-- signature) is irrelevant here; these 21 are the only kept credit refs.
-- ============================================================================


-- 2.1 _sahl_recalc_customer_outstanding — drop credit_program_id column ref
DROP FUNCTION IF EXISTS public._sahl_recalc_customer_outstanding(uuid, uuid);
CREATE OR REPLACE FUNCTION public._sahl_recalc_customer_outstanding(p_customer_id uuid, p_activated_by uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_balance numeric(12,2);
  v_stored  numeric(12,2);
  v_by      uuid;
BEGIN
  -- Serialize concurrent writers on the same account row when it exists.
  BEGIN
    PERFORM 1 FROM public.customer_credit_accounts
     WHERE customer_id = p_customer_id FOR UPDATE;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  v_balance := GREATEST(public.sahl_customer_current_balance(p_customer_id), 0);

  IF p_activated_by IS NULL THEN
    SELECT created_by INTO v_by FROM public.collections
     WHERE customer_id = p_customer_id ORDER BY created_at DESC LIMIT 1;
    IF v_by IS NULL THEN
      SELECT owner_id INTO v_by FROM public.orders
       WHERE customer_id = p_customer_id ORDER BY created_at DESC LIMIT 1;
    END IF;
    IF v_by IS NULL THEN
      SELECT id INTO v_by FROM public.employees ORDER BY created_at ASC LIMIT 1;
    END IF;
  ELSE
    v_by := p_activated_by;
  END IF;

  INSERT INTO public.customer_credit_accounts AS cca
    (customer_id, credit_limit, payment_term_days,
     outstanding_credit, activated_by)
  VALUES (p_customer_id, 0, 0, v_balance, v_by)
  ON CONFLICT (customer_id) DO UPDATE
    SET outstanding_credit = EXCLUDED.outstanding_credit,
        updated_at = now()
  RETURNING outstanding_credit INTO v_stored;

  RETURN COALESCE(v_stored, v_balance);
END;
$function$;


-- 2.2 get_command_center_v2 — remove over-limit required action + credit_due count
DROP FUNCTION IF EXISTS public.get_command_center_v2(uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.get_command_center_v2(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
    jsonb_build_object('label', 'مرتجعات تنتظر القرار', 'count', (SELECT COUNT(*) FROM public.returns WHERE status IN ('pending', 'inspecting')), 'link', '/returns'),
    jsonb_build_object('label', 'زيارات لم يتم إنهاؤها', 'count', (SELECT COUNT(*) FROM public.visits WHERE status = 'active' AND check_out_at IS NULL), 'link', '/visits'),
    jsonb_build_object('label', 'مندوبين بلا زيارات اليوم', 'count', (SELECT COUNT(*) FROM public.employees e WHERE is_active = true AND NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.employee_id = e.id AND v.created_at >= CURRENT_DATE)), 'link', '/supervisor')
  );
  v_module_counts := jsonb_build_object(
    'orders_new', (SELECT COUNT(*) FROM public.orders WHERE created_at >= CURRENT_DATE),
    'customers_active', (SELECT COUNT(*) FROM public.customers WHERE is_active = true),
    'visits_active', (SELECT COUNT(*) FROM public.visits WHERE status = 'active'),
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


-- 2.3 get_customer_card — remove credit_status + its computation
DROP FUNCTION IF EXISTS public.get_customer_card(uuid, uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.get_customer_card(p_token uuid, p_customer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_identity_type text; v_identity_id uuid; v_employee_id uuid; v_visible uuid[];
  v_cust public.customers; v_total_purchases numeric; v_order_count int; v_avg_value numeric;
  v_last_order timestamptz; v_last_visit timestamptz;
  v_visit_count int; v_reorder_interval numeric; v_first_order timestamptz;
  v_growth numeric; v_prior_total numeric; v_expected_next timestamptz; v_potential_revenue numeric;
BEGIN
  SELECT s.identity_type, s.identity_id, s.employee_id INTO v_identity_type, v_identity_id, v_employee_id FROM app.sessions s WHERE s.token = p_token AND s.expires_at > now(); IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  SELECT * INTO v_cust FROM public.customers WHERE id = p_customer_id; IF NOT FOUND THEN RETURN NULL; END IF;
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  IF v_identity_type = 'customer' THEN IF v_cust.identity_id != v_identity_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  ELSIF v_cust.owner_id IS NOT NULL AND NOT (v_cust.owner_id = ANY(v_visible)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT COALESCE(SUM(o.total_amount), 0), COUNT(*), MAX(o.submitted_at), MIN(o.submitted_at) INTO v_total_purchases, v_order_count, v_last_order, v_first_order FROM public.orders o WHERE o.customer_id = p_customer_id AND o.status IN ('submitted','approved');
  v_avg_value := CASE WHEN v_order_count > 0 THEN v_total_purchases / v_order_count ELSE 0 END;
  SELECT MAX(v.check_in_at), COUNT(*) INTO v_last_visit, v_visit_count FROM public.visits v WHERE v.customer_id = p_customer_id;
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
    'risk_indicators', json_build_object('days_since_last_order', CASE WHEN v_last_order IS NOT NULL THEN EXTRACT(DAY FROM now() - v_last_order)::int ELSE NULL END, 'inactive_risk', CASE WHEN v_last_order IS NOT NULL AND EXTRACT(DAY FROM now() - v_last_order) > 30 AND EXTRACT(DAY FROM now() - v_last_order) < 90 THEN true ELSE false END, 'lost_customer_risk', CASE WHEN v_last_order IS NOT NULL AND EXTRACT(DAY FROM now() - v_last_order) >= 90 THEN true ELSE false END),
    'behavior', json_build_object('avg_reorder_interval_days', v_reorder_interval, 'growth_trend_pct', ROUND(v_growth, 1), 'decline_trend_pct', ROUND(LEAST(v_growth, 0), 1)),
    'expected_next_order_date', v_expected_next, 'potential_revenue_score', ROUND(v_potential_revenue, 2));
END;
$function$;


-- 2.4 get_customer_full_profile — remove credit_limit/credit_days keys
DROP FUNCTION IF EXISTS public.get_customer_full_profile(uuid, uuid, date, date) CASCADE;
CREATE OR REPLACE FUNCTION public.get_customer_full_profile(p_token uuid, p_customer_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_customer_info jsonb;
    v_stats jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF p_from IS NULL THEN p_from := CURRENT_DATE - INTERVAL '12 months'; END IF;
    IF p_to IS NULL THEN p_to := CURRENT_DATE; END IF;

    -- Customer base info
    SELECT jsonb_build_object(
        'id', c.id,
        'code', COALESCE(c.code, 'غير متوفر'),
        'company_name', COALESCE(c.company_name, 'غير متوفر'),
        'email', COALESCE(c.email, 'غير متوفر'),
        'phone', COALESCE(i.phone, 'غير متوفر'),
        'business_type', COALESCE(c.business_type::text, 'غير متوفر'),
        'responsible_name', COALESCE(c.responsible_name, 'غير متوفر'),
        'is_active', COALESCE(c.is_active, false),
        'registered_at', c.registered_at,
        'created_at', c.created_at,
        'owner_name', COALESCE(e.full_name, 'غير متوفر'),
        'tier_name', COALESCE(
            (SELECT t.name FROM tiers t
             JOIN orders o ON o.tier_id = t.id
             WHERE o.customer_id = p_customer_id AND o.tier_id IS NOT NULL
             ORDER BY o.created_at DESC LIMIT 1),
            'غير متوفر'
        )
    ) INTO v_customer_info
    FROM customers c
    LEFT JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id
    WHERE c.id = p_customer_id;

    -- Aggregated stats
    WITH ord_stats AS (
        SELECT
            COUNT(*)::int AS total_orders,
            COALESCE(SUM(o.total_amount), 0) AS total_sales,
            CASE WHEN COUNT(*) > 0 THEN ROUND(COALESCE(SUM(o.total_amount), 0) / COUNT(*)::numeric, 2) ELSE 0 END AS avg_order_value,
            MAX(o.created_at) AS last_order_date,
            MIN(o.created_at) AS first_order_date,
            COUNT(DISTINCT o.created_at::date)::int AS active_days
        FROM orders o
        WHERE o.customer_id = p_customer_id
          AND public.is_order_in_statistics(o.status)
          AND o.created_at::date >= p_from
          AND o.created_at::date <= p_to
    ),
    vis_stats AS (
        SELECT
            COUNT(*)::int AS visit_count,
            COUNT(*) FILTER (WHERE v.status = 'completed')::int AS successful_visits,
            MAX(v.check_in_at) AS last_visit_date
        FROM visits v
        WHERE v.customer_id = p_customer_id
          AND v.check_in_at::date >= p_from
          AND v.check_in_at::date <= p_to
    )
    SELECT jsonb_build_object(
        'total_orders', COALESCE(ord_stats.total_orders, 0),
        'total_sales', COALESCE(ord_stats.total_sales, 0),
        'avg_order_value', COALESCE(ord_stats.avg_order_value, 0),
        'last_order_date', ord_stats.last_order_date,
        'first_order_date', ord_stats.first_order_date,
        'active_days', COALESCE(ord_stats.active_days, 0),
        'visit_count', COALESCE(vis_stats.visit_count, 0),
        'successful_visits', COALESCE(vis_stats.successful_visits, 0),
        'last_visit_date', vis_stats.last_visit_date
    ) INTO v_stats
    FROM ord_stats, vis_stats;

    RETURN jsonb_build_object(
        'customer', COALESCE(v_customer_info, jsonb_build_object()),
        'stats', COALESCE(v_stats, jsonb_build_object(
            'total_orders', 0, 'total_sales', 0, 'avg_order_value', 0,
            'active_days', 0, 'visit_count', 0, 'successful_visits', 0
        ))
    );
END;
$function$;


-- 2.5 get_governed_customer — remove credit_limit/credit_days keys
DROP FUNCTION IF EXISTS public.get_governed_customer(uuid, uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.get_governed_customer(p_token uuid, p_id uuid)
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

  SELECT jsonb_build_object(
    'id', c.id,
    'code', c.code,
    'company_name', c.company_name,
    'responsible_name', c.responsible_name,
    'business_type', c.business_type,
    'email', c.email,
    'phone', i.phone,
    'owner_id', c.owner_id,
    'owner_name', e.full_name,
    'owner_code', e.code,
    'is_active', c.is_active,
    'location_id', c.location_id,
    'registered_at', c.registered_at,
    'created_at', c.created_at,
    'governorate_id', addr.governorate_id,
    'city_id', addr.city_id,
    'street_address', addr.street_address,
    'landmark', addr.landmark,
    'location_accuracy', addr.location_accuracy,
    'governorate_name', COALESCE(addr.governorate, (SELECT rg.name_ar FROM reference_governorates rg WHERE rg.id = addr.governorate_id)),
    'city_name', COALESCE(addr.city, (SELECT rc.name_ar FROM reference_cities rc WHERE rc.id = addr.city_id)),
    'registered_address', addr.address_line1
  ) INTO v_result
  FROM customers c
  JOIN identities i ON i.id = c.identity_id
  LEFT JOIN employees e ON e.id = c.owner_id
  LEFT JOIN LATERAL fn_customer_default_address(c.id) addr ON true
  WHERE c.id = p_id;

  RETURN v_result;
END;
$function$;


-- 2.6 get_governed_customers — remove credit_limit/credit_days keys (3 blocks)
DROP FUNCTION IF EXISTS public.get_governed_customers(text, text, uuid, timestamp with time zone, timestamp with time zone, boolean, boolean, boolean, uuid, boolean) CASCADE;
CREATE OR REPLACE FUNCTION public.get_governed_customers(p_token text, p_search text DEFAULT NULL::text, p_employee_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_no_orders boolean DEFAULT false, p_no_visits boolean DEFAULT false, p_no_location boolean DEFAULT false, p_governorate_id uuid DEFAULT NULL::uuid, p_needs_address_correction boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_emp_id uuid;
  v_is_customer boolean;
  v_filter_no_orders boolean;
  v_filter_no_visits boolean;
  v_filter_no_location boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  v_emp_id := app.current_employee_id();
  v_is_customer := (v_session.identity_type = 'customer');
  v_filter_no_orders := COALESCE(p_no_orders, false);
  v_filter_no_visits := COALESCE(p_no_visits, false);
  v_filter_no_location := COALESCE(p_no_location, false);

  -- Customer sessions: show only their own customer record
  IF v_is_customer THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'company_name', c.company_name,
      'responsible_name', c.responsible_name, 'business_type', c.business_type,
      'email', c.email, 'phone', i.phone,
      'owner_id', c.owner_id, 'owner_name', e.full_name,
      'is_active', c.is_active, 'location_id', c.location_id,
      'registered_address', addr.registered_address,
      'location_address', loc.formatted_address,
      'needs_address_correction', COALESCE(c.needs_address_correction, false),
      'manual_governorate_id', addr.manual_governorate_id,
      'registered_at', c.registered_at, 'created_at', c.created_at,
      'previous_order_count', ps.order_count,
      'previous_orders_total', ps.orders_total,
      'last_order_number', ps.last_order_number,
      'last_order_date', ps.last_order_date,
      'last_order_total', ps.last_order_total,
      'delivered_total', ps.delivered_total,
      'last_visit_date', vs.last_visit_date,
      'visit_count', vs.visit_count,
      'current_balance', public.sahl_customer_current_balance(c.id)
    )) INTO v_result
    FROM customers c
    JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id
    LEFT JOIN LATERAL (
      SELECT
        trim(both '- ' from concat_ws(' - ',
          NULLIF(TRIM(ca3.governorate), ''),
          NULLIF(TRIM(ca3.city), ''),
          NULLIF(TRIM(COALESCE(ca3.street_address, ca3.address_line1, '')), '')
        )) AS registered_address,
        ca3.governorate_id AS manual_governorate_id
      FROM customer_addresses ca3
      WHERE ca3.customer_id = c.id AND ca3.is_default = true
      LIMIT 1
    ) addr ON true
    LEFT JOIN LATERAL (
      SELECT formatted_address
      FROM public.unified_locations ul
      WHERE ul.id = c.location_id
      LIMIT 1
    ) loc ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*)::bigint AS order_count,
        COALESCE(sum(total_amount), 0) AS orders_total,
        (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
        max(created_at) AS last_order_date,
        (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total,
        COALESCE(sum(total_amount) FILTER (WHERE o2.status = 'delivered'), 0) AS delivered_total
      FROM public.orders o2
      WHERE o2.customer_id = c.id
        AND public.is_order_in_statistics(o2.status)
    ) ps ON true
    LEFT JOIN LATERAL (
      SELECT
        MAX(v.check_in_at) AS last_visit_date,
        COUNT(*)::bigint AS visit_count
      FROM public.visits v
      WHERE v.customer_id = c.id AND v.check_in_at IS NOT NULL
    ) vs ON true
    WHERE c.identity_id = v_session.identity_id
      AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to)
      AND (NOT v_filter_no_orders OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)))
      AND (NOT v_filter_no_visits OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.customer_id = c.id))
      AND (NOT v_filter_no_location OR c.location_id IS NULL)
      AND (p_governorate_id IS NULL OR addr.manual_governorate_id = p_governorate_id)
      AND (p_needs_address_correction IS NULL OR c.needs_address_correction = p_needs_address_correction);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Employees with customers.read capability: all customers
  IF app.has_capability('customers.read') THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'company_name', c.company_name,
      'responsible_name', c.responsible_name, 'business_type', c.business_type,
      'email', c.email, 'phone', i.phone,
      'owner_id', c.owner_id, 'owner_name', e.full_name,
      'is_active', c.is_active, 'location_id', c.location_id,
      'registered_address', addr.registered_address,
      'location_address', loc.formatted_address,
      'needs_address_correction', COALESCE(c.needs_address_correction, false),
      'manual_governorate_id', addr.manual_governorate_id,
      'registered_at', c.registered_at, 'created_at', c.created_at,
      'previous_order_count', ps.order_count,
      'previous_orders_total', ps.orders_total,
      'last_order_number', ps.last_order_number,
      'last_order_date', ps.last_order_date,
      'last_order_total', ps.last_order_total,
      'delivered_total', ps.delivered_total,
      'last_visit_date', vs.last_visit_date,
      'visit_count', vs.visit_count,
      'current_balance', public.sahl_customer_current_balance(c.id)
    )) INTO v_result
    FROM customers c
    JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id
    LEFT JOIN LATERAL (
      SELECT
        trim(both '- ' from concat_ws(' - ',
          NULLIF(TRIM(ca3.governorate), ''),
          NULLIF(TRIM(ca3.city), ''),
          NULLIF(TRIM(COALESCE(ca3.street_address, ca3.address_line1, '')), '')
        )) AS registered_address,
        ca3.governorate_id AS manual_governorate_id
      FROM customer_addresses ca3
      WHERE ca3.customer_id = c.id AND ca3.is_default = true
      LIMIT 1
    ) addr ON true
    LEFT JOIN LATERAL (
      SELECT formatted_address
      FROM public.unified_locations ul
      WHERE ul.id = c.location_id
      LIMIT 1
    ) loc ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*)::bigint AS order_count,
        COALESCE(sum(total_amount), 0) AS orders_total,
        (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
        max(created_at) AS last_order_date,
        (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total,
        COALESCE(sum(total_amount) FILTER (WHERE o2.status = 'delivered'), 0) AS delivered_total
      FROM public.orders o2
      WHERE o2.customer_id = c.id
        AND public.is_order_in_statistics(o2.status)
    ) ps ON true
    LEFT JOIN LATERAL (
      SELECT
        MAX(v.check_in_at) AS last_visit_date,
        COUNT(*)::bigint AS visit_count
      FROM public.visits v
      WHERE v.customer_id = c.id AND v.check_in_at IS NOT NULL
    ) vs ON true
    WHERE (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
      AND (p_employee_id IS NULL OR c.owner_id = p_employee_id)
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to)
      AND (NOT v_filter_no_orders OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)))
      AND (NOT v_filter_no_visits OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.customer_id = c.id))
      AND (NOT v_filter_no_location OR c.location_id IS NULL)
      AND (p_governorate_id IS NULL OR addr.manual_governorate_id = p_governorate_id)
      AND (p_needs_address_correction IS NULL OR c.needs_address_correction = p_needs_address_correction);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Employees without customers.read: own + reports' customers
  SELECT jsonb_agg(jsonb_build_object(
    'id', c.id, 'code', c.code, 'company_name', c.company_name,
    'responsible_name', c.responsible_name, 'business_type', c.business_type,
    'email', c.email, 'phone', i.phone,
    'owner_id', c.owner_id, 'owner_name', e.full_name,
    'is_active', c.is_active, 'location_id', c.location_id,
    'registered_address', addr.registered_address,
    'location_address', loc.formatted_address,
    'needs_address_correction', COALESCE(c.needs_address_correction, false),
    'manual_governorate_id', addr.manual_governorate_id,
    'registered_at', c.registered_at, 'created_at', c.created_at,
    'previous_order_count', ps.order_count,
    'previous_orders_total', ps.orders_total,
    'last_order_number', ps.last_order_number,
    'last_order_date', ps.last_order_date,
    'last_order_total', ps.last_order_total,
    'delivered_total', ps.delivered_total,
    'last_visit_date', vs.last_visit_date,
    'visit_count', vs.visit_count,
    'current_balance', public.sahl_customer_current_balance(c.id)
  )) INTO v_result
  FROM customers c
  JOIN identities i ON i.id = c.identity_id
  LEFT JOIN employees e ON e.id = c.owner_id
  LEFT JOIN LATERAL (
    SELECT
      trim(both '- ' from concat_ws(' - ',
        NULLIF(TRIM(ca3.governorate), ''),
        NULLIF(TRIM(ca3.city), ''),
        NULLIF(TRIM(COALESCE(ca3.street_address, ca3.address_line1, '')), '')
      )) AS registered_address,
      ca3.governorate_id AS manual_governorate_id
    FROM customer_addresses ca3
    WHERE ca3.customer_id = c.id AND ca3.is_default = true
    LIMIT 1
  ) addr ON true
  LEFT JOIN LATERAL (
    SELECT formatted_address
    FROM public.unified_locations ul
    WHERE ul.id = c.location_id
    LIMIT 1
  ) loc ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*)::bigint AS order_count,
      COALESCE(sum(total_amount), 0) AS orders_total,
      (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
      max(created_at) AS last_order_date,
      (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total,
      COALESCE(sum(total_amount) FILTER (WHERE o2.status = 'delivered'), 0) AS delivered_total
    FROM public.orders o2
    WHERE o2.customer_id = c.id
      AND public.is_order_in_statistics(o2.status)
  ) ps ON true
  LEFT JOIN LATERAL (
    SELECT
      MAX(v.check_in_at) AS last_visit_date,
      COUNT(*)::bigint AS visit_count
    FROM public.visits v
    WHERE v.customer_id = c.id AND v.check_in_at IS NOT NULL
  ) vs ON true
  WHERE c.owner_id = ANY(app.get_subtree_ids(v_emp_id))
    AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
    AND (p_employee_id IS NULL OR c.owner_id = p_employee_id)
    AND (p_date_from IS NULL OR c.created_at >= p_date_from)
    AND (p_date_to IS NULL OR c.created_at <= p_date_to)
    AND (NOT v_filter_no_orders OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)))
    AND (NOT v_filter_no_visits OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.customer_id = c.id))
    AND (NOT v_filter_no_location OR c.location_id IS NULL)
    AND (p_governorate_id IS NULL OR addr.manual_governorate_id = p_governorate_id)
    AND (p_needs_address_correction IS NULL OR c.needs_address_correction = p_needs_address_correction);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;


-- 2.7 governed_cancel_order — remove credit reservation-release branch
DROP FUNCTION IF EXISTS public.governed_cancel_order(text, uuid, text) CASCADE;
CREATE OR REPLACE FUNCTION public.governed_cancel_order(p_token text, p_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_restore_result jsonb;
  v_req_row record;
  v_reserved integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.identity_id;

  PERFORM check_capability(p_token, 'orders.cancel');

  SELECT status
  INTO v_old_status
  FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status IN ('cancelled', 'delivered', 'collected') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;

  -- تحرير الحجز عند الخروج من submitted (قبل الاستلام/تغيير الحالة).
  IF v_old_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_id
    LOOP
      v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_id);
      IF v_reserved > 0 THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_id, -v_reserved, 'RESERVATION_RELEASE',
          'تم إلغاء الفاتورة وتم تحرير حجز الكمية.',
          v_reserved, 0, v_session.identity_id
        );
      END IF;
    END LOOP;
  END IF;

  v_restore_result := public.governed_inventory_restore(p_id);

  UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'cancelled', v_employee_id, p_reason, now());

  RETURN jsonb_build_object('success', true);
END;
$function$;


-- 2.8 governed_complete_delivery — remove credit-invoice/ledger creation
DROP FUNCTION IF EXISTS public.governed_complete_delivery(text, uuid, text) CASCADE;
CREATE OR REPLACE FUNCTION public.governed_complete_delivery(p_token text, p_delivery_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session app.sessions;
  v_dt public.delivery_tracking;
  v_order public.orders;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;

  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_dt.status NOT IN ('out_for_delivery','assigned') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.delivery_tracking SET status = 'delivered', completed_at = now(), notes = COALESCE(p_notes, notes), updated_at = now() WHERE id = p_delivery_id RETURNING * INTO v_dt;
  UPDATE public.orders SET status = 'delivered', delivered_at = now(), updated_at = now() WHERE id = v_dt.order_id RETURNING * INTO v_order;

  RETURN jsonb_build_object('delivery_status', 'delivered', 'order_status', v_order.status, 'delivered_at', v_order.delivered_at);
END;
$function$;


-- 2.9 governed_create_customer — remove credit_limit/credit_days writes
--     (p_credit_limit / p_credit_days params are KEPT as inert no-ops so any
--     stale deployed client passing them still resolves the RPC.)
DROP FUNCTION IF EXISTS public.governed_create_customer(uuid, character varying, character varying, character varying, character varying, character varying, character varying, character varying, business_type, character varying, numeric, numeric, numeric, text, character varying, character varying, numeric, integer, uuid, uuid, character varying, text, address_source_type) CASCADE;
CREATE OR REPLACE FUNCTION public.governed_create_customer(p_token uuid, p_company_name character varying, p_phone character varying DEFAULT NULL::character varying, p_contact_name character varying DEFAULT NULL::character varying, p_contact_phone character varying DEFAULT NULL::character varying, p_address_line1 character varying DEFAULT NULL::character varying, p_city character varying DEFAULT 'القاهرة'::character varying, p_region character varying DEFAULT NULL::character varying, p_business_type business_type DEFAULT NULL::business_type, p_responsible_name character varying DEFAULT NULL::character varying, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric, p_accuracy_meters numeric DEFAULT NULL::numeric, p_formatted_address text DEFAULT NULL::text, p_password character varying DEFAULT NULL::character varying, p_email character varying DEFAULT NULL::character varying, p_credit_limit numeric DEFAULT NULL::numeric, p_credit_days integer DEFAULT NULL::integer, p_governorate_id uuid DEFAULT NULL::uuid, p_city_id uuid DEFAULT NULL::uuid, p_street_address character varying DEFAULT NULL::character varying, p_landmark text DEFAULT NULL::text, p_address_source address_source_type DEFAULT NULL::address_source_type)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_identity_id uuid;
  v_customer_id uuid;
  v_contact_id uuid;
  v_address_id uuid;
  v_location_id uuid;
  v_code varchar(20);
  v_year integer := EXTRACT(YEAR FROM now());
  v_seq integer;
  v_has_new_address boolean;
  v_gov_name varchar(200);
  v_city_name varchar(200);
  v_address_line1 varchar(255);
  v_auto_source address_source_type;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;
  PERFORM check_capability(p_token, 'customers.create');

  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('customer', v_year, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  v_code := 'CUS-' || v_year::text || '-' || LPAD(v_seq::text, 6, '0');
  v_identity_id := gen_random_uuid();
  v_customer_id := gen_random_uuid();

  -- Auto-detect address source based on GPS presence
  v_auto_source := CASE
    WHEN p_address_source IS NOT NULL THEN p_address_source
    WHEN p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN 'mixed'::address_source_type
    ELSE 'manual'::address_source_type
  END;

  -- Create unified_locations record
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    v_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
    VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, COALESCE(p_formatted_address, p_address_line1), now());
  ELSIF p_formatted_address IS NOT NULL THEN
    v_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, formatted_address, captured_at)
    VALUES (v_location_id, p_formatted_address, now());
  END IF;

  INSERT INTO public.identities (id, phone, password_hash, identity_type, is_active)
  VALUES (
    v_identity_id,
    COALESCE(p_phone, 'ext-' || v_customer_id::text || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
    CASE WHEN p_password IS NOT NULL THEN extensions.crypt(p_password::text, extensions.gen_salt('bf'))
         ELSE extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))
    END,
    'customer',
    true
  );

  INSERT INTO public.customers (id, identity_id, code, company_name, responsible_name, business_type, location_id, owner_type, owner_id, is_active, email)
  VALUES (v_customer_id, v_identity_id, v_code, p_company_name, COALESCE(p_responsible_name, p_contact_name), p_business_type, v_location_id, 'employee', v_employee_id, true, p_email);

  IF p_contact_phone IS NOT NULL OR p_contact_name IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, full_name, phone, is_primary)
    VALUES (v_customer_id, COALESCE(p_contact_name, p_company_name), COALESCE(p_contact_phone, '0000000000'), true)
    RETURNING id INTO v_contact_id;
  END IF;

  v_has_new_address := p_governorate_id IS NOT NULL OR p_city_id IS NOT NULL
    OR p_street_address IS NOT NULL OR p_landmark IS NOT NULL;

  IF v_has_new_address THEN
    v_gov_name := (SELECT name_ar FROM reference_governorates WHERE id = p_governorate_id);
    v_city_name := (SELECT name_ar FROM reference_cities WHERE id = p_city_id);
    v_address_line1 := TRIM(COALESCE(v_gov_name, '') || ' - ' || COALESCE(v_city_name, ''));
    IF p_street_address IS NOT NULL AND p_street_address != '' THEN
      v_address_line1 := v_address_line1 || ' - ' || p_street_address;
    END IF;
    IF p_landmark IS NOT NULL AND p_landmark != '' THEN
      v_address_line1 := v_address_line1 || ' - ' || p_landmark;
    END IF;

    INSERT INTO public.customer_addresses (
      customer_id, address_line1, city, governorate,
      governorate_id, city_id, street_address, landmark,
      address_source, address_updated_at, is_default
    ) VALUES (
      v_customer_id, v_address_line1, COALESCE(v_city_name, p_city), COALESCE(v_gov_name, ''),
      p_governorate_id, p_city_id, p_street_address, p_landmark,
      v_auto_source, now(), true
    )
    RETURNING id INTO v_address_id;
  ELSIF p_address_line1 IS NOT NULL THEN
    INSERT INTO public.customer_addresses (customer_id, address_line1, city, is_default)
    VALUES (v_customer_id, p_address_line1, p_city, true)
    RETURNING id INTO v_address_id;
  END IF;

  -- Tracking point for the successful GPS acquisition (never blocks creation).
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    PERFORM public.ensure_tracking_point(
      v_employee_id, NULL,
      p_latitude, p_longitude,
      p_accuracy_meters, NULL, NULL, NULL, NULL,
      now(), 'customer_created'
    );
  END IF;

  -- Reset inactivity timer (customer creation is a qualifying activity)
  PERFORM public.touch_qualifying_activity(v_employee_id);

  RETURN jsonb_build_object('success', true, 'id', v_customer_id, 'code', v_code, 'company_name', p_company_name);
END;
$function$;


-- 2.10 governed_update_customer — remove credit_limit/credit_days writes
--      (p_credit_limit / p_credit_days params are KEPT as inert no-ops.)
DROP FUNCTION IF EXISTS public.governed_update_customer(uuid, uuid, character varying, character varying, numeric, integer, business_type, character varying, character varying, character varying, text, numeric, numeric, numeric, character varying, character varying, uuid, uuid, character varying, character varying, text) CASCADE;
CREATE OR REPLACE FUNCTION public.governed_update_customer(p_token uuid, p_id uuid, p_company_name character varying DEFAULT NULL::character varying, p_email character varying DEFAULT NULL::character varying, p_credit_limit numeric DEFAULT NULL::numeric, p_credit_days integer DEFAULT NULL::integer, p_business_type business_type DEFAULT NULL::business_type, p_responsible_name character varying DEFAULT NULL::character varying, p_password character varying DEFAULT NULL::character varying, p_phone character varying DEFAULT NULL::character varying, p_formatted_address text DEFAULT NULL::text, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric, p_accuracy_meters numeric DEFAULT NULL::numeric, p_contact_name character varying DEFAULT NULL::character varying, p_contact_phone character varying DEFAULT NULL::character varying, p_governorate_id uuid DEFAULT NULL::uuid, p_city_id uuid DEFAULT NULL::uuid, p_city_name character varying DEFAULT NULL::character varying, p_street_address character varying DEFAULT NULL::character varying, p_landmark text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_identity_id uuid;
  v_location_id uuid;
  v_has_any_location_input boolean;
  v_has_any_contact_input boolean;
  v_has_any_address_input boolean;
  v_resolved_governorate_name text;
  v_resolved_city_name text;
  v_normalized_phone varchar;
  v_current_identity uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'customers.update');

  -- Phone format/authority: identities.phone is the single authoritative source.
  -- Normalize exactly as registration/UI does (English digits, ^01[0-9]{9}$).
  -- Balanced Arabic-Indic (10) + Eastern (10) -> ASCII digits; ASCII digits
  -- including '0' are preserved unchanged. Non-digits are stripped below.
  IF p_phone IS NOT NULL THEN
    v_normalized_phone := regexp_replace(translate(p_phone,
      '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
      '[^0-9]', '', 'g');

    IF v_normalized_phone !~ '^01[0-9]{9}$' THEN
      RETURN jsonb_build_object('error', 'رقم الهاتف غير صالح');
    END IF;

    SELECT identity_id INTO v_current_identity FROM public.customers WHERE id = p_id;

    -- HARD RULE: no two CURRENT (active) customer accounts may share a phone.
    -- Reject if a DIFFERENT active identity already owns this phone.
    IF v_current_identity IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.identities i
      WHERE i.phone = v_normalized_phone
        AND i.is_active = true
        AND i.id <> v_current_identity
    ) THEN
      RETURN jsonb_build_object('error', 'رقم الهاتف موجود بالفعل');
    END IF;

    p_phone := v_normalized_phone;
  END IF;

  UPDATE public.customers
  SET
    company_name = COALESCE(p_company_name, company_name),
    email = COALESCE(p_email, email),
    business_type = COALESCE(p_business_type, business_type),
    responsible_name = COALESCE(p_responsible_name, responsible_name),
    updated_at = now()
  WHERE id = p_id;

  IF p_phone IS NOT NULL THEN
    SELECT identity_id INTO v_identity_id FROM public.customers WHERE id = p_id;
    IF v_identity_id IS NOT NULL THEN
      UPDATE public.identities SET phone = p_phone WHERE id = v_identity_id;
    END IF;
  END IF;

  IF p_password IS NOT NULL THEN
    IF v_identity_id IS NULL THEN
      SELECT identity_id INTO v_identity_id FROM public.customers WHERE id = p_id;
    END IF;
    IF v_identity_id IS NOT NULL THEN
      UPDATE public.identities SET password_hash = extensions.crypt(p_password::text, extensions.gen_salt('bf')) WHERE id = v_identity_id;
    END IF;
  END IF;

  -- Location updates (GPS) – independent from manual address
  v_has_any_location_input := p_formatted_address IS NOT NULL
    OR p_latitude IS NOT NULL
    OR p_longitude IS NOT NULL
    OR p_accuracy_meters IS NOT NULL;

  IF v_has_any_location_input THEN
    SELECT location_id INTO v_location_id FROM public.customers WHERE id = p_id;

    IF v_location_id IS NOT NULL THEN
      UPDATE public.unified_locations
      SET
        formatted_address = COALESCE(p_formatted_address, formatted_address),
        latitude = COALESCE(p_latitude, latitude),
        longitude = COALESCE(p_longitude, longitude),
        accuracy_meters = COALESCE(p_accuracy_meters, accuracy_meters)
      WHERE id = v_location_id;
    ELSIF p_formatted_address IS NOT NULL OR p_latitude IS NOT NULL THEN
      v_location_id := gen_random_uuid();
      IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
        INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
        VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());
      ELSE
        INSERT INTO unified_locations (id, formatted_address, captured_at)
        VALUES (v_location_id, COALESCE(p_formatted_address, ''), now());
      END IF;
      UPDATE public.customers SET location_id = v_location_id, updated_at = now() WHERE id = p_id;
    END IF;
  END IF;

  v_has_any_contact_input := p_contact_name IS NOT NULL OR p_contact_phone IS NOT NULL;

  IF v_has_any_contact_input THEN
    IF EXISTS (SELECT 1 FROM public.customer_contacts WHERE customer_id = p_id AND is_primary = true) THEN
      UPDATE public.customer_contacts
      SET
        full_name = COALESCE(p_contact_name, full_name),
        phone = COALESCE(p_contact_phone, phone)
      WHERE customer_id = p_id AND is_primary = true;
    ELSE
      INSERT INTO public.customer_contacts (customer_id, full_name, phone, is_primary)
      VALUES (p_id, COALESCE(p_contact_name, ''), COALESCE(p_contact_phone, ''), true);
    END IF;
  END IF;

  -- Manual address updates – independent from GPS/location
  v_has_any_address_input := p_governorate_id IS NOT NULL
    OR p_city_id IS NOT NULL
    OR p_city_name IS NOT NULL
    OR p_street_address IS NOT NULL
    OR p_landmark IS NOT NULL;

  IF v_has_any_address_input THEN
    v_resolved_governorate_name := COALESCE(
      (SELECT name_ar FROM reference_governorates WHERE id = p_governorate_id),
      (SELECT governorate FROM customer_addresses WHERE customer_id = p_id AND is_default = true),
      ''
    );

    v_resolved_city_name := COALESCE(
      p_city_name,
      (SELECT name_ar FROM reference_cities WHERE id = p_city_id),
      (SELECT city FROM customer_addresses WHERE customer_id = p_id AND is_default = true),
      ''
    );

    INSERT INTO customer_addresses (customer_id, address_line1, city, governorate, city_id, governorate_id, street_address, landmark, address_source, address_updated_at, is_default)
    VALUES (
      p_id,
      COALESCE(p_street_address, (SELECT address_line1 FROM customer_addresses WHERE customer_id = p_id AND is_default = true), ''),
      v_resolved_city_name,
      v_resolved_governorate_name,
      p_city_id,
      p_governorate_id,
      p_street_address,
      p_landmark,
      'manual',
      now(),
      true
    )
    ON CONFLICT (customer_id) WHERE is_default = true
    DO UPDATE SET
      governorate        = CASE WHEN p_governorate_id IS NOT NULL THEN v_resolved_governorate_name
                               WHEN p_city_name IS NOT NULL OR p_street_address IS NOT NULL OR p_landmark IS NOT NULL
                               THEN COALESCE(NULLIF(customer_addresses.governorate, ''), v_resolved_governorate_name)
                               ELSE customer_addresses.governorate END,
      governorate_id     = COALESCE(p_governorate_id, customer_addresses.governorate_id),
      city               = CASE WHEN p_city_name IS NOT NULL THEN v_resolved_city_name
                               WHEN p_governorate_id IS NOT NULL OR p_street_address IS NOT NULL OR p_landmark IS NOT NULL
                               THEN COALESCE(NULLIF(customer_addresses.city, ''), v_resolved_city_name)
                               ELSE customer_addresses.city END,
      city_id            = COALESCE(p_city_id, customer_addresses.city_id),
      street_address     = COALESCE(p_street_address, customer_addresses.street_address),
      landmark           = COALESCE(p_landmark, customer_addresses.landmark),
      address_source     = COALESCE(customer_addresses.address_source, 'manual'),
      address_updated_at = now();

    IF p_governorate_id IS NOT NULL THEN
      UPDATE customers SET needs_address_correction = false WHERE id = p_id;
    END IF;
  END IF;

  PERFORM fn_enrich_customer_location(
    p_customer_id        := p_id,
    p_latitude           := p_latitude,
    p_longitude          := p_longitude,
    p_accuracy_meters    := p_accuracy_meters,
    p_formatted_address  := p_formatted_address,
    p_accuracy_level     := (CASE WHEN p_latitude IS NOT NULL THEN 'GPS' ELSE 'GEOCODED' END)::location_accuracy_level
  );

  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    PERFORM public.ensure_tracking_point(
      v_session.employee_id, NULL,
      p_latitude, p_longitude,
      p_accuracy_meters, NULL, NULL, NULL, NULL,
      now(), 'customer_location_updated'
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;


-- 2.11 sahl_sync_pull — remove credit_limit/credit_days from customer payload
DROP FUNCTION IF EXISTS public.sahl_sync_pull(text, jsonb) CASCADE;
CREATE OR REPLACE FUNCTION public.sahl_sync_pull(p_token text, p_cursors jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_cur text;
  v_new text;
  v_out jsonb := '{}';
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  v_cur := COALESCE(p_cursors->>'customers', '1970-01-01');
  v_out := v_out || jsonb_build_object('customers', jsonb_build_object(
    'cursor', COALESCE((SELECT max(c.updated_at)::text FROM
        (SELECT * FROM public.customers WHERE updated_at > v_cur::timestamptz ORDER BY updated_at LIMIT 500) c),
      v_cur),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'company_name', c.company_name, 'email', c.email,
        'phone', i.phone,
        'business_type', c.business_type, 'responsible_name', c.responsible_name,
        'is_active', c.is_active, 'updated_at', c.updated_at) ORDER BY c.updated_at)
      FROM (SELECT * FROM public.customers WHERE updated_at > v_cur::timestamptz ORDER BY updated_at LIMIT 500) c
      LEFT JOIN public.identities i ON i.id = c.identity_id
    ), '[]'::jsonb)));

  v_cur := COALESCE(p_cursors->>'products', '1970-01-01');
  v_out := v_out || jsonb_build_object('products', jsonb_build_object(
    'cursor', COALESCE((SELECT max(p.updated_at)::text FROM
        (SELECT * FROM public.products WHERE updated_at > v_cur::timestamptz ORDER BY updated_at LIMIT 500) p),
      v_cur),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'product_name', p.product_name, 'legacy_code', p.legacy_code,
        'piece_price', p.piece_price, 'dozen_price', p.dozen_price,
        'carton_price', p.carton_price, 'carton_quantity', p.carton_quantity,
        'avg_cost', p.avg_cost, 'is_active', p.is_active,
        'negative_selling_allowed', p.negative_selling_allowed,
        'inventory_deduction_status', p.inventory_deduction_status,
        'updated_at', p.updated_at) ORDER BY p.updated_at)
      FROM (SELECT * FROM public.products WHERE updated_at > v_cur::timestamptz ORDER BY updated_at LIMIT 500) p
    ), '[]'::jsonb)));

  v_cur := COALESCE(p_cursors->>'inventory', '1970-01-01');
  v_out := v_out || jsonb_build_object('inventory', jsonb_build_object(
    'cursor', COALESCE((SELECT max(x.updated_at)::text FROM
        (SELECT product_id, quantity, updated_at FROM public.inventory
         WHERE updated_at > v_cur::timestamptz ORDER BY updated_at LIMIT 1000) x),
      v_cur),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', x.product_id, 'qty', x.quantity, 'updated_at', x.updated_at) ORDER BY x.updated_at)
      FROM (SELECT product_id, quantity, updated_at FROM public.inventory
            WHERE updated_at > v_cur::timestamptz ORDER BY updated_at LIMIT 1000) x
    ), '[]'::jsonb)));

  v_cur := COALESCE(p_cursors->>'suppliers', '1970-01-01');
  v_out := v_out || jsonb_build_object('suppliers', jsonb_build_object(
    'cursor', COALESCE((SELECT max(s.updated_at)::text FROM
        (SELECT * FROM public.suppliers WHERE updated_at > v_cur::timestamptz ORDER BY updated_at LIMIT 500) s),
      v_cur),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'code', s.code, 'supplier_name', s.supplier_name, 'phone', s.phone,
        'address', s.address, 'notes', s.notes, 'is_active', s.is_active,
        'updated_at', s.updated_at) ORDER BY s.updated_at)
      FROM (SELECT * FROM public.suppliers WHERE updated_at > v_cur::timestamptz ORDER BY updated_at LIMIT 500) s
    ), '[]'::jsonb)));

  v_out := v_out || jsonb_build_object('stores', jsonb_build_object('rows',
    COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.sahl_stores t), '[]'::jsonb)));
  v_out := v_out || jsonb_build_object('treasuries', jsonb_build_object('rows',
    COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.sahl_treasuries t), '[]'::jsonb)));
  v_out := v_out || jsonb_build_object('settings', jsonb_build_object('rows',
    COALESCE((SELECT jsonb_agg(jsonb_build_object('key', key, 'value', value)) FROM public.sahl_settings), '[]'::jsonb)));

  RETURN jsonb_build_object('now', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'tables', v_out);
END;
$function$;


-- 2.12 unified_search — customers branch: remove credit_limit/credit_days
DROP FUNCTION IF EXISTS public.unified_search(uuid, text, text, jsonb, integer, integer, text) CASCADE;
CREATE OR REPLACE FUNCTION public.unified_search(p_token uuid, p_entity text, p_query text DEFAULT NULL::text, p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_per_page integer DEFAULT 20, p_order_by text DEFAULT 'relevance'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_identity_id uuid;
  v_employee_id uuid;
  v_identity_type text;
  v_visible uuid[];
  v_is_super boolean;
  v_tokens text[];
  v_token text;
  v_sql text;
  v_count_sql text;
  v_where text := '';
  v_token_where text := '';
  v_order text := '';
  v_offset int;
  v_result jsonb;
  v_total bigint;
  v_searchable_cols text[];
  v_col text;
  v_sim_args text := '';
  v_fallback_order text := '';
  v_base_select text;
  v_base_from text;
  v_base_where text := '';
  v_auth_where text := '';
  v_filter_where text := '';
  v_has_query boolean;
BEGIN
  SELECT * INTO v_session
  FROM app.sessions
  WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION', 'data', '[]'::jsonb, 'total', 0, 'page', p_page, 'per_page', p_per_page);
  END IF;

  v_identity_id := v_session.identity_id;
  v_employee_id := v_session.employee_id;
  v_identity_type := v_session.identity_type;
  v_offset := (p_page - 1) * p_per_page;

  v_has_query := p_query IS NOT NULL AND trim(p_query) != '';
  IF v_has_query THEN
    v_tokens := regexp_split_to_array(trim(p_query), '\s+');
  ELSE
    v_tokens := '{}'::text[];
  END IF;

  IF v_identity_type = 'employee' THEN
    v_is_super := public.is_upper_management(v_employee_id);
    IF v_is_super THEN
      SELECT array_agg(id) INTO v_visible FROM employees;
    ELSE
      v_visible := COALESCE(app.get_subtree_ids(v_employee_id), '{}'::uuid[]);
    END IF;
  END IF;

  CASE p_entity
    WHEN 'products' THEN
      v_searchable_cols := ARRAY['p.product_name', 'p.legacy_code', 'comp.company_name'];
      v_base_select := '
        p.id, p.product_name, p.legacy_code, p.description,
        p.company_id, comp.company_name,
        p.is_active, p.is_visible, p.is_out_of_stock,
        p.image_url, p.carton_price, p.carton_quantity, p.created_at,
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(''id'', pu.id, ''unit_type'', pu.unit_type, ''is_active'', pu.is_active)
             ORDER BY pu.unit_type)
           FROM product_units pu WHERE pu.product_id = p.id),
          ''[]''::jsonb
        ) AS product_units,
        (SELECT jsonb_build_object(''quantity'', inv.quantity)
         FROM inventory inv WHERE inv.product_id = p.id LIMIT 1) AS inventory';
      v_base_from := 'FROM products p JOIN companies comp ON comp.id = p.company_id';
      v_auth_where := 'TRUE';
      IF (p_filters ? 'company_id') AND (p_filters->>'company_id') IS NOT NULL AND (p_filters->>'company_id') != '' THEN
        v_filter_where := v_filter_where || format(' AND p.company_id = %L', p_filters->>'company_id');
      END IF;
      IF (p_filters ? 'active_only') AND (p_filters->>'active_only')::boolean THEN
        v_filter_where := v_filter_where || ' AND p.is_active = true';
      END IF;
      IF (p_filters ? 'visible_only') AND (p_filters->>'visible_only')::boolean THEN
        v_filter_where := v_filter_where || ' AND p.is_visible = true';
      END IF;
      IF (p_filters ? 'status') AND (p_filters->>'status') IS NOT NULL AND (p_filters->>'status') != '' THEN
        CASE p_filters->>'status'
          WHEN 'active' THEN v_filter_where := v_filter_where || ' AND p.is_active = true AND p.is_out_of_stock = false';
          WHEN 'out_of_stock' THEN v_filter_where := v_filter_where || ' AND p.is_active = true AND p.is_out_of_stock = true';
          WHEN 'inactive' THEN v_filter_where := v_filter_where || ' AND p.is_active = false';
          ELSE NULL;
        END CASE;
      END IF;
      v_fallback_order := 'p.product_name';
      v_sim_args := format('similarity(p.product_name, %L), similarity(p.legacy_code, %L), similarity(comp.company_name, %L)', COALESCE(p_query, ''), COALESCE(p_query, ''), COALESCE(p_query, ''));

    WHEN 'customers' THEN
      v_searchable_cols := ARRAY['c.company_name', 'c.code', 'i.phone',
        'ca_addr.address_line1', 'ca_addr.city', 'ca_addr.governorate'];
      v_base_select := '
        c.id, c.code, c.company_name, c.email,
        c.owner_id,
        c.is_active, c.business_type, c.responsible_name,
        c.created_at, i.phone,
        ca_addr.address_line1, ca_addr.city, ca_addr.governorate';
      v_base_from := '
        FROM customers c
        JOIN identities i ON i.id = c.identity_id
        LEFT JOIN LATERAL (
          SELECT address_line1, city, governorate
          FROM customer_addresses
          WHERE customer_id = c.id AND is_default = true
          LIMIT 1
        ) ca_addr ON true';
      IF v_identity_type = 'customer' THEN
        v_auth_where := format('c.identity_id = %L', v_identity_id);
      ELSIF v_identity_type = 'employee' THEN
        IF v_visible IS NOT NULL AND array_length(v_visible, 1) > 0 THEN
          v_auth_where := format('c.owner_id = ANY(%L)', v_visible);
        ELSE
          v_auth_where := 'FALSE';
        END IF;
      ELSE
        v_auth_where := 'FALSE';
      END IF;
      IF (p_filters ? 'is_active') AND (p_filters->>'is_active') IS NOT NULL THEN
        v_filter_where := v_filter_where || format(' AND c.is_active = %L', (p_filters->>'is_active')::boolean);
      END IF;
      IF (p_filters ? 'business_type') AND (p_filters->>'business_type') IS NOT NULL AND (p_filters->>'business_type') != '' THEN
        v_filter_where := v_filter_where || format(' AND c.business_type = %L', p_filters->>'business_type');
      END IF;
      v_fallback_order := 'c.company_name';
      v_sim_args := format(
        'similarity(c.company_name, %L), similarity(c.code, %L), similarity(i.phone, %L)',
        COALESCE(p_query, ''), COALESCE(p_query, ''), COALESCE(p_query, '')
      );

    WHEN 'employees' THEN
      v_searchable_cols := ARRAY['e.full_name', 'e.code'];
      v_base_select := 'e.id, e.identity_id, e.code, e.full_name, e.email, e.manager_id, e.is_active, e.address, e.created_at';
      v_base_from := 'FROM employees e';
      IF v_identity_type = 'employee' THEN
        IF v_is_super THEN
          v_auth_where := 'TRUE';
        ELSIF v_visible IS NOT NULL AND array_length(v_visible, 1) > 0 THEN
          v_auth_where := format('e.id = ANY(%L)', v_visible);
        ELSE
          v_auth_where := format('e.id = %L', v_employee_id);
        END IF;
      ELSE
        v_auth_where := 'FALSE';
      END IF;
      IF (p_filters ? 'is_active') AND (p_filters->>'is_active') IS NOT NULL THEN
        v_filter_where := v_filter_where || format(' AND e.is_active = %L', (p_filters->>'is_active')::boolean);
      END IF;
      v_fallback_order := 'e.full_name';
      v_sim_args := format('similarity(e.full_name, %L), similarity(e.code, %L)', COALESCE(p_query, ''), COALESCE(p_query, ''));

    WHEN 'orders' THEN
      v_searchable_cols := ARRAY['o.order_number', 'COALESCE(o.snapshot_customer_name, c.company_name)'];
      v_base_select := '
        o.id, o.order_number, o.status, o.delivery_mode, o.payment_method,
        o.total_amount, o.revision_number,
        o.customer_id, COALESCE(o.snapshot_customer_name, c.company_name) AS customer_name,
        o.snapshot_customer_code AS customer_code,
        o.snapshot_customer_phone AS customer_phone,
        o.created_by, o.created_at, o.submitted_at, o.approved_at, o.notes,
        COALESCE(o.snapshot_owner_name, e.full_name) AS owner_name,
        COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, '''') AS created_by_name';
      v_base_from := '
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN employees e ON e.id = o.owner_id
        LEFT JOIN identities oc_i ON oc_i.id = o.created_by
        LEFT JOIN employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = ''employee''
        LEFT JOIN customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = ''customer''';
      IF v_identity_type = 'customer' THEN
        v_auth_where := format('o.customer_id = %L', (SELECT customer_id FROM customers WHERE identity_id = v_identity_id LIMIT 1));
      ELSIF v_identity_type = 'employee' THEN
        IF v_is_super THEN
          v_auth_where := 'TRUE';
        ELSIF v_visible IS NOT NULL AND array_length(v_visible, 1) > 0 THEN
          v_auth_where := format('c.owner_id = ANY(%L)', v_visible);
        ELSE
          v_auth_where := format('o.created_by = %L', v_identity_id);
        END IF;
      ELSE
        v_auth_where := 'FALSE';
      END IF;
      IF (p_filters ? 'status') AND (p_filters->>'status') IS NOT NULL AND (p_filters->>'status') != '' THEN
        v_filter_where := v_filter_where || format(' AND o.status = %L', p_filters->>'status');
      END IF;
      IF (p_filters ? 'customer_id') AND (p_filters->>'customer_id') IS NOT NULL AND (p_filters->>'customer_id') != '' THEN
        v_filter_where := v_filter_where || format(' AND o.customer_id = %L', p_filters->>'customer_id');
      END IF;
      IF (p_filters ? 'date_from') AND (p_filters->>'date_from') IS NOT NULL AND (p_filters->>'date_from') != '' THEN
        v_filter_where := v_filter_where || format(' AND o.created_at >= %L', (p_filters->>'date_from')::timestamptz);
      END IF;
      IF (p_filters ? 'date_to') AND (p_filters->>'date_to') IS NOT NULL AND (p_filters->>'date_to') != '' THEN
        v_filter_where := v_filter_where || format(' AND o.created_at <= %L', (p_filters->>'date_to')::timestamptz);
      END IF;
      v_fallback_order := 'o.created_at DESC';
      v_sim_args := format(
        'similarity(o.order_number, %L), similarity(COALESCE(o.snapshot_customer_name, c.company_name), %L)',
        COALESCE(p_query, ''), COALESCE(p_query, '')
      );

    WHEN 'visits' THEN
      v_searchable_cols := ARRAY['v.code', 'c.company_name'];
      v_base_select := 'v.id, v.code, v.employee_id, v.customer_id, c.company_name AS customer_name, v.status, v.check_in_at, v.check_out_at, v.visit_result, v.notes, v.created_at';
      v_base_from := 'FROM visits v JOIN customers c ON c.id = v.customer_id';
      IF v_identity_type = 'customer' THEN
        v_auth_where := format('v.customer_id = %L', (SELECT customer_id FROM customers WHERE identity_id = v_identity_id LIMIT 1));
      ELSIF v_identity_type = 'employee' THEN
        IF v_is_super THEN
          v_auth_where := 'TRUE';
        ELSIF v_visible IS NOT NULL AND array_length(v_visible, 1) > 0 THEN
          v_auth_where := format('v.employee_id = ANY(%L)', v_visible);
        ELSE
          v_auth_where := format('v.employee_id = %L', v_employee_id);
        END IF;
      ELSE
        v_auth_where := 'FALSE';
      END IF;
      IF (p_filters ? 'status') AND (p_filters->>'status') IS NOT NULL AND (p_filters->>'status') != '' THEN
        v_filter_where := v_filter_where || format(' AND v.status = %L', p_filters->>'status');
      END IF;
      IF (p_filters ? 'customer_id') AND (p_filters->>'customer_id') IS NOT NULL AND (p_filters->>'customer_id') != '' THEN
        v_filter_where := v_filter_where || format(' AND v.customer_id = %L', p_filters->>'customer_id');
      END IF;
      IF (p_filters ? 'date_from') AND (p_filters->>'date_from') IS NOT NULL AND (p_filters->>'date_from') != '' THEN
        v_filter_where := v_filter_where || format(' AND v.check_in_at >= %L', (p_filters->>'date_from')::timestamptz);
      END IF;
      IF (p_filters ? 'date_to') AND (p_filters->>'date_to') IS NOT NULL AND (p_filters->>'date_to') != '' THEN
        v_filter_where := v_filter_where || format(' AND v.check_in_at <= %L', (p_filters->>'date_to')::timestamptz);
      END IF;
      v_fallback_order := 'v.check_in_at DESC';
      v_sim_args := format('similarity(v.code, %L), similarity(c.company_name, %L)', COALESCE(p_query, ''), COALESCE(p_query, ''));

    WHEN 'collections' THEN
      v_searchable_cols := ARRAY['cl.code', 'c.company_name', 'cl.reference_number'];
      v_base_select := 'cl.id, cl.code, cl.customer_id, c.company_name AS customer_name, cl.method, cl.amount, cl.reference_number, cl.status, cl.notes, cl.collected_at, cl.created_by, cl.created_at, cl.order_id';
      v_base_from := 'FROM collections cl JOIN customers c ON c.id = cl.customer_id';
      IF v_identity_type = 'customer' THEN
        v_auth_where := format('cl.customer_id = %L', (SELECT customer_id FROM customers WHERE identity_id = v_identity_id LIMIT 1));
      ELSIF v_identity_type = 'employee' THEN
        IF v_is_super THEN
          v_auth_where := 'TRUE';
        ELSIF v_visible IS NOT NULL AND array_length(v_visible, 1) > 0 THEN
          v_auth_where := format('c.owner_id = ANY(%L)', v_visible);
        ELSE
          v_auth_where := 'FALSE';
        END IF;
      ELSE
        v_auth_where := 'FALSE';
      END IF;
      IF (p_filters ? 'status') AND (p_filters->>'status') IS NOT NULL AND (p_filters->>'status') != '' THEN
        v_filter_where := v_filter_where || format(' AND cl.status = %L', p_filters->>'status');
      END IF;
      IF (p_filters ? 'method') AND (p_filters->>'method') IS NOT NULL AND (p_filters->>'method') != '' THEN
        v_filter_where := v_filter_where || format(' AND cl.method = %L', p_filters->>'method');
      END IF;
      IF (p_filters ? 'customer_id') AND (p_filters->>'customer_id') IS NOT NULL AND (p_filters->>'customer_id') != '' THEN
        v_filter_where := v_filter_where || format(' AND cl.customer_id = %L', p_filters->>'customer_id');
      END IF;
      IF (p_filters ? 'date_from') AND (p_filters->>'date_from') IS NOT NULL AND (p_filters->>'date_from') != '' THEN
        v_filter_where := v_filter_where || format(' AND cl.collected_at >= %L', (p_filters->>'date_from')::timestamptz);
      END IF;
      IF (p_filters ? 'date_to') AND (p_filters->>'date_to') IS NOT NULL AND (p_filters->>'date_to') != '' THEN
        v_filter_where := v_filter_where || format(' AND cl.collected_at <= %L', (p_filters->>'date_to')::timestamptz);
      END IF;
      v_fallback_order := 'cl.created_at DESC';
      v_sim_args := format('similarity(cl.code, %L), similarity(c.company_name, %L), similarity(cl.reference_number, %L)', COALESCE(p_query, ''), COALESCE(p_query, ''), COALESCE(p_query, ''));

    ELSE
      RETURN jsonb_build_object('error', 'UNKNOWN_ENTITY: ' || p_entity, 'data', '[]'::jsonb, 'total', 0, 'page', p_page, 'per_page', p_per_page);
  END CASE;

  -- Build token WHERE conditions
  IF v_has_query AND array_length(v_tokens, 1) > 0 THEN
    FOREACH v_token IN ARRAY v_tokens LOOP
      IF v_token = '' THEN CONTINUE; END IF;
      v_token_where := v_token_where || ' AND (';
      FOR i IN 1 .. array_length(v_searchable_cols, 1) LOOP
        v_col := v_searchable_cols[i];
        IF i > 1 THEN v_token_where := v_token_where || ' OR '; END IF;
        IF v_col LIKE '%COALESCE(%' THEN
          v_token_where := v_token_where || format('%s ILIKE %L', v_col, '%' || v_token || '%');
        ELSE
          v_token_where := v_token_where || format('%s ILIKE %L', v_col, '%' || v_token || '%');
        END IF;
      END LOOP;
      v_token_where := v_token_where || ')';
    END LOOP;
  END IF;

  -- Build ORDER BY
  IF v_has_query THEN
    v_order := format(' ORDER BY GREATEST(%s) DESC', v_sim_args);
  ELSE
    v_order := ' ORDER BY ' || v_fallback_order;
  END IF;

  -- Combine WHERE clauses
  v_where := 'WHERE (' || v_auth_where || ')' || v_filter_where || v_token_where;

  -- Count query
  v_count_sql := 'SELECT COUNT(*) FROM (SELECT 1 ' || v_base_from || ' ' || v_where || ' LIMIT 10000) cnt';
  EXECUTE v_count_sql INTO v_total;

  -- Data query
  v_sql := format(
    'SELECT jsonb_build_object(''data'', COALESCE(jsonb_agg(subq), ''[]''::jsonb), ''total'', %L, ''page'', %L, ''per_page'', %L, ''query'', %L) FROM (SELECT %s %s %s %s %s) subq',
    v_total, p_page, p_per_page, COALESCE(p_query, ''),
    v_base_select, v_base_from, v_where, v_order,
    format('LIMIT %L OFFSET %L', p_per_page, v_offset)
  );

  EXECUTE v_sql INTO v_result;
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'error', SQLERRM,
    'detail', SQLSTATE,
    'data', '[]'::jsonb,
    'total', 0,
    'page', p_page,
    'per_page', p_per_page
  );
END;
$function$;


-- 2.13 governed_delete_order — remove credit reservation + credit deletes
DROP FUNCTION IF EXISTS public.governed_delete_order(uuid, uuid) CASCADE;
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

  SELECT * INTO v_order FROM public.orders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF v_session.identity_type <> 'employee' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_visible := public.get_visible_employee_ids(p_token);
  IF NOT (v_order.owner_id = ANY(v_visible)) THEN RAISE EXCEPTION 'FORBIDDEN: order not in visibility scope'; END IF;

  PERFORM public.governed_inventory_restore(
    p_id,
    'ORDER_DELETION_RESTORE',
    'تمت إعادة الكمية قبل حذف الطلب.'
  );

  DELETE FROM public.treasury_transactions
  WHERE reference_type = 'collection'
    AND reference_id IN (SELECT id FROM public.collections WHERE order_id = p_id);
  DELETE FROM public.collections WHERE order_id = p_id;

  DELETE FROM public.return_items
  WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = p_id);
  DELETE FROM public.returns WHERE order_id = p_id;

  DELETE FROM public.preparation_exceptions
  WHERE preparation_id IN (SELECT id FROM public.preparation_records WHERE order_id = p_id);
  DELETE FROM public.preparation_records WHERE order_id = p_id;

  DELETE FROM public.delivery_actions
  WHERE delivery_tracking_id IN (SELECT id FROM public.delivery_tracking WHERE order_id = p_id);
  DELETE FROM public.delivery_tracking WHERE order_id = p_id;

  -- Journey membership: journey_orders.order_id has no ON DELETE CASCADE.
  -- Removes only this order's membership; the journey itself stays intact.
  DELETE FROM public.journey_orders WHERE order_id = p_id;

  DELETE FROM public.auction_awards WHERE order_id = p_id;
  DELETE FROM public.order_daily_deals WHERE order_id = p_id;
  DELETE FROM public.order_flash_offers WHERE order_id = p_id;
  DELETE FROM public.inventory_movements WHERE order_id = p_id;
  DELETE FROM public.order_deletion_inventory_audit WHERE order_id = p_id;
  DELETE FROM public.order_items WHERE order_id = p_id;
  DELETE FROM public.order_status_history WHERE order_id = p_id;
  DELETE FROM public.order_modification_history WHERE order_id = p_id;
  DELETE FROM public.orders WHERE id = p_id;
  RETURN true;
END;
$function$;


-- 2.14 governed_supreme_delete_cancelled_order — remove credit reservation + credit deletes
DROP FUNCTION IF EXISTS public.governed_supreme_delete_cancelled_order(text, uuid, text) CASCADE;
CREATE OR REPLACE FUNCTION public.governed_supreme_delete_cancelled_order(p_token text, p_order_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_is_super boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_is_super := public.is_supreme_management(v_session.employee_id)
    OR EXISTS (
      SELECT 1 FROM public.employee_roles er
      JOIN public.roles r ON r.id = er.role_id
      WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('الرئيس التنفيذي', 'executive_director')
    );
  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Only Supreme Management can delete cancelled orders');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_order.status != 'cancelled' THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE', 'detail', 'Only cancelled orders can be deleted');
  END IF;

  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, modified_by, reason, modified_at
  )
  VALUES (
    p_order_id,
    v_order.revision_number,
    'supreme_delete',
    jsonb_build_object(
      'status', v_order.status,
      'total_amount', v_order.total_amount,
      'order_number', v_order.order_number
    )::text,
    jsonb_build_object('deleted', true)::text,
    (SELECT jsonb_agg(row_to_json(oi.*)) FROM public.order_items oi WHERE oi.order_id = p_order_id),
    v_session.identity_id,
    COALESCE(p_reason, 'Deleted by Supreme Management'),
    now()
  );

  PERFORM public.governed_inventory_restore(
    p_order_id,
    'ORDER_DELETION_RESTORE',
    'تمت إعادة الكمية قبل حذف الطلب.'
  );

  DELETE FROM public.treasury_transactions
  WHERE reference_type = 'collection'
    AND reference_id IN (SELECT id FROM public.collections WHERE order_id = p_order_id);

  DELETE FROM public.collections WHERE order_id = p_order_id;

  DELETE FROM public.preparation_exceptions
  WHERE preparation_id IN (SELECT id FROM public.preparation_records WHERE order_id = p_order_id);

  DELETE FROM public.preparation_records WHERE order_id = p_order_id;

  DELETE FROM public.delivery_actions
  WHERE delivery_tracking_id IN (SELECT id FROM public.delivery_tracking WHERE order_id = p_order_id);

  DELETE FROM public.delivery_tracking WHERE order_id = p_order_id;

  -- Journey membership: journey_orders.order_id has no ON DELETE CASCADE.
  DELETE FROM public.journey_orders WHERE order_id = p_order_id;

  DELETE FROM public.return_items
  WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = p_order_id);

  DELETE FROM public.returns WHERE order_id = p_order_id;

  DELETE FROM public.auction_awards WHERE order_id = p_order_id;

  DELETE FROM public.order_daily_deals WHERE order_id = p_order_id;
  DELETE FROM public.order_flash_offers WHERE order_id = p_order_id;

  DELETE FROM public.inventory_movements WHERE order_id = p_order_id;

  DELETE FROM public.order_deletion_inventory_audit WHERE order_id = p_order_id;

  DELETE FROM public.order_items WHERE order_id = p_order_id;
  DELETE FROM public.order_status_history WHERE order_id = p_order_id;
  DELETE FROM public.order_modification_history WHERE order_id = p_order_id;

  DELETE FROM public.orders WHERE id = p_order_id;

  INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count)
  VALUES (v_session.employee_id, 'order', ARRAY[p_order_id], 1);

  RETURN jsonb_build_object('success', true, 'action', 'deleted', 'order_id', p_order_id);
END;
$function$;


-- 2.15 governed_delete_employee_with_transfer — drop credit null-outs
--      (customer_credit_accounts / customer_credit_ledger null-outs KEPT)
DROP FUNCTION IF EXISTS public.governed_delete_employee_with_transfer(uuid, uuid, text) CASCADE;
CREATE OR REPLACE FUNCTION public.governed_delete_employee_with_transfer(p_token uuid, p_employee_id uuid, p_target_code text DEFAULT 'EMP-2026-000037'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_target_id uuid;
  v_target_code text;
  v_target_name text;
  v_source_code text;
  v_source_name text;
  v_source_identity_id uuid;
  v_count int;
  v_remaining int;
  v_customers int := 0;
  v_orders int := 0;
  v_visits int := 0;
  v_collections int := 0;
  v_returns int := 0;
  v_delivery int := 0;
  v_drivers int := 0;
  v_subordinates int := 0;
  v_sessions_deleted int := 0;
BEGIN
  -- Skip the sync_outbox capture trigger during this internal governed
  -- operation: it would fail on tables without an id column (e.g.
  -- employee_baselines) and must not replicate the bulk transfer/delete
  -- row-by-row. Local to this transaction.
  PERFORM set_config('app.sync_in_progress', 'true', true);

  -- 1. Session validation
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_SESSION'); END IF;

  -- 2. Existing capability authorization (both الإدارة العليا and الرئيس التنذي hold employees.manage)
  IF NOT public.check_capability(p_token, 'employees.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  -- 3. Source employee
  SELECT e.code, e.full_name, e.identity_id
    INTO v_source_code, v_source_name, v_source_identity_id
  FROM public.employees e WHERE e.id = p_employee_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  -- Guard: an admin must never delete their own account
  IF v_session.employee_id = p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_DELETE_SELF');
  END IF;

  -- 4. Fixed destination employee
  SELECT e.id, e.code, e.full_name INTO v_target_id, v_target_code, v_target_name
  FROM public.employees e WHERE e.code = p_target_code AND e.is_active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TARGET_NOT_FOUND'); END IF;
  IF v_target_id = p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_IS_SOURCE');
  END IF;

  -- ===================== 5. TRANSFER CURRENT OWNERSHIP =====================
  -- 5.1 customers (with ownership-history audit, mirroring governed_change_customer_ownership)
  SELECT COUNT(*) INTO v_customers FROM public.customers WHERE owner_id = p_employee_id;
  IF v_customers > 0 THEN
    INSERT INTO public.customer_ownership_history (customer_id, previous_owner_id, new_owner_id, changed_by, reason)
    SELECT id, owner_id, v_target_id, v_session.employee_id,
           'تحويل ملكية العميل عند حذف حساب ' || v_source_code || ' إلى ' || v_target_name
    FROM public.customers WHERE owner_id = p_employee_id;
    UPDATE public.customers SET owner_id = v_target_id WHERE owner_id = p_employee_id;
  END IF;

  -- 5.2 orders
  SELECT COUNT(*) INTO v_orders FROM public.orders WHERE owner_id = p_employee_id AND owner_type = 'employee';
  IF v_orders > 0 THEN
    UPDATE public.orders SET owner_id = v_target_id WHERE owner_id = p_employee_id AND owner_type = 'employee';
  END IF;

  -- 5.3 visits
  SELECT COUNT(*) INTO v_visits FROM public.visits WHERE employee_id = p_employee_id;
  IF v_visits > 0 THEN
    UPDATE public.visits SET employee_id = v_target_id WHERE employee_id = p_employee_id;
  END IF;

  -- 5.4 collections
  SELECT COUNT(*) INTO v_collections FROM public.collections WHERE owner_id = p_employee_id AND owner_type = 'employee';
  IF v_collections > 0 THEN
    UPDATE public.collections SET owner_id = v_target_id WHERE owner_id = p_employee_id AND owner_type = 'employee';
  END IF;

  -- 5.5 returns
  SELECT COUNT(*) INTO v_returns FROM public.returns WHERE owner_id = p_employee_id AND owner_type = 'employee';
  IF v_returns > 0 THEN
    UPDATE public.returns SET owner_id = v_target_id WHERE owner_id = p_employee_id AND owner_type = 'employee';
  END IF;

  -- 5.6 delivery assignments (assigned_to) and driver assignments (driver_id)
  SELECT COUNT(*) INTO v_delivery FROM public.delivery_tracking WHERE assigned_to = p_employee_id;
  IF v_delivery > 0 THEN
    UPDATE public.delivery_tracking SET assigned_to = v_target_id WHERE assigned_to = p_employee_id;
  END IF;
  SELECT COUNT(*) INTO v_drivers FROM public.delivery_tracking WHERE driver_id = p_employee_id;
  IF v_drivers > 0 THEN
    UPDATE public.delivery_tracking SET driver_id = v_target_id WHERE driver_id = p_employee_id;
  END IF;

  -- 5.7 subordinates (employees.manager_id) so the team is not orphaned
  SELECT COUNT(*) INTO v_subordinates FROM public.employees WHERE manager_id = p_employee_id;
  IF v_subordinates > 0 THEN
    UPDATE public.employees SET manager_id = v_target_id WHERE manager_id = p_employee_id;
  END IF;

  -- ===================== 6. VERIFY NO CURRENT OWNERSHIP REMAINS =============
  SELECT
    (SELECT COUNT(*) FROM public.customers WHERE owner_id = p_employee_id)
    + (SELECT COUNT(*) FROM public.orders WHERE owner_id = p_employee_id AND owner_type = 'employee')
    + (SELECT COUNT(*) FROM public.visits WHERE employee_id = p_employee_id)
    + (SELECT COUNT(*) FROM public.collections WHERE owner_id = p_employee_id AND owner_type = 'employee')
    + (SELECT COUNT(*) FROM public.returns WHERE owner_id = p_employee_id AND owner_type = 'employee')
    + (SELECT COUNT(*) FROM public.delivery_tracking WHERE assigned_to = p_employee_id OR driver_id = p_employee_id)
    + (SELECT COUNT(*) FROM public.employees WHERE manager_id = p_employee_id)
  INTO v_remaining;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'TRANSFER_INCOMPLETE: % records still owned by the source employee', v_remaining;
  END IF;

  -- ============= 7. NULL HISTORICAL / AUDIT EMPLOYEE REFERENCES =============
  -- Business/history rows are PRESERVED; only the FK reference is cleared
  -- (existing nullable FK behavior). Never re-pointed to the target.
  -- Customer ownership history
  UPDATE public.customer_ownership_history SET previous_owner_id = NULL WHERE previous_owner_id = p_employee_id;
  UPDATE public.customer_ownership_history SET new_owner_id = NULL WHERE new_owner_id = p_employee_id;
  UPDATE public.customer_ownership_history SET changed_by = NULL WHERE changed_by = p_employee_id;
  -- Auctions
  UPDATE public.auctions SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.auction_awards SET awarded_by = NULL WHERE awarded_by = p_employee_id;
  UPDATE public.auction_participants SET approved_by = NULL WHERE approved_by = p_employee_id;
  -- Collections / returns
  UPDATE public.collections SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.collections SET approved_by = NULL WHERE approved_by = p_employee_id;
  UPDATE public.returns SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.customer_credit_accounts SET activated_by = NULL WHERE activated_by = p_employee_id;
  UPDATE public.customer_credit_ledger SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.tier_exceptions SET assigned_by = NULL WHERE assigned_by = p_employee_id;
  -- Products & deals
  UPDATE public.daily_deals SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.flash_offers SET created_by = NULL WHERE created_by = p_employee_id;
  -- Field work actors
  UPDATE public.delivery_tracking SET assigned_by = NULL WHERE assigned_by = p_employee_id;
  UPDATE public.preparation_records SET started_by = NULL WHERE started_by = p_employee_id;
  UPDATE public.preparation_records SET completed_by = NULL WHERE completed_by = p_employee_id;
  UPDATE public.preparation_records SET cancelled_by = NULL WHERE cancelled_by = p_employee_id;
  UPDATE public.preparation_records SET reviewed_by = NULL WHERE reviewed_by = p_employee_id;
  UPDATE public.return_inspection SET inspected_by = NULL WHERE inspected_by = p_employee_id;
  UPDATE public.tracking_cleanup_log SET executed_by = NULL WHERE executed_by = p_employee_id;
  -- Financial actors
  UPDATE public.treasury_transactions SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.expenses SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.expenses SET approved_by = NULL WHERE approved_by = p_employee_id;
  -- Employee config actors (rows themselves are deleted below)
  UPDATE public.employee_roles SET assigned_by = NULL WHERE assigned_by = p_employee_id;
  UPDATE public.employee_capabilities SET assigned_by = NULL WHERE assigned_by = p_employee_id;
  UPDATE public.employee_work_policies SET updated_by = NULL WHERE updated_by = p_employee_id;
  UPDATE public.employee_advances SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.employee_advances SET approved_by = NULL WHERE approved_by = p_employee_id;
  -- Deletion audit log (historical rows that list the source as subject)
  UPDATE public.deletion_audit_log SET employee_id = NULL WHERE employee_id = p_employee_id;

  -- ============= 8. DELETE ACCOUNT-SPECIFIC RECORDS =========================
  DELETE FROM public.workday_breaks WHERE employee_id = p_employee_id;
  DELETE FROM public.tracking_points WHERE employee_id = p_employee_id;
  DELETE FROM public.workday_sessions WHERE employee_id = p_employee_id; -- cascades visit_links + session tracking_points
  DELETE FROM public.employee_work_policies WHERE employee_id = p_employee_id; -- after sessions (referenced by work_policy_id)
  DELETE FROM public.employee_baselines WHERE employee_id = p_employee_id;
  DELETE FROM public.employee_entity_views WHERE employee_id = p_employee_id;
  DELETE FROM public.push_subscriptions WHERE employee_id = p_employee_id;
  DELETE FROM public.employee_monthly_targets WHERE employee_id = p_employee_id;
  DELETE FROM public.employee_weight_overrides WHERE employee_id = p_employee_id;
  DELETE FROM public.employee_roles WHERE employee_id = p_employee_id;
  DELETE FROM public.employee_capabilities WHERE employee_id = p_employee_id;
  DELETE FROM public.employee_advances WHERE employee_id = p_employee_id;
  DELETE FROM public.attendance_audit_log WHERE employee_id = p_employee_id;
  DELETE FROM public.session_recovery_log WHERE employee_id = p_employee_id;
  DELETE FROM public.notifications WHERE recipient_employee_id = p_employee_id;

  -- 9. Delete sessions, deactivate identity (kept so historical created_by
  --    references on orders/history/contracts stay valid), delete the employee
  DELETE FROM app.sessions WHERE identity_id = v_source_identity_id OR employee_id = p_employee_id;
  GET DIAGNOSTICS v_sessions_deleted = ROW_COUNT;
  UPDATE public.identities SET is_active = false WHERE id = v_source_identity_id;
  DELETE FROM public.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_DELETE_FAILED'; END IF;

  -- 10. Audit trail for this operation (references the admin, not the deleted employee)
  INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
  VALUES (
    v_session.employee_id,
    'employee_account_transfer_delete',
    ARRAY[p_employee_id],
    1,
    jsonb_build_object(
      'employee_code', v_source_code,
      'transferred', jsonb_build_object(
        'customers', v_customers,
        'orders', v_orders,
        'visits', v_visits,
        'collections', v_collections,
        'returns', v_returns,
        'delivery_assignments', v_delivery,
        'delivery_drivers', v_drivers,
        'subordinates', v_subordinates
      ),
      'target', jsonb_build_object('id', v_target_id, 'code', v_target_code)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'employee_id', p_employee_id,
    'employee_code', v_source_code,
    'employee_name', v_source_name,
    'target_code', v_target_code,
    'target_name', v_target_name,
    'transferred', jsonb_build_object(
      'customers', v_customers,
      'orders', v_orders,
      'visits', v_visits,
      'collections', v_collections,
      'returns', v_returns,
      'delivery_assignments', v_delivery,
      'delivery_drivers', v_drivers,
      'subordinates', v_subordinates
    ),
    'sessions_deleted', v_sessions_deleted,
    'account_deleted', true,
    'identity_deactivated', true
  );
END;
$function$;


-- 2.16 sync_get_table_allowlist — remove the 6 credit tables from the sync list
--      (customer_credit_accounts + customer_credit_ledger stay: SAHL surface).
DROP FUNCTION IF EXISTS public.sync_get_table_allowlist();
CREATE OR REPLACE FUNCTION public.sync_get_table_allowlist()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
SELECT ARRAY[
  'identities','employees','roles','capabilities','employee_roles',
  'role_capabilities','employee_capabilities','code_sequences',
  'customers','customer_addresses','customer_contacts',
  'customer_credit_accounts','customer_ownership_history',
  'products','product_units','companies',
  'orders','order_items','order_status_history',
  'order_modification_history','order_daily_deals','order_flash_offers',
  'visits','visit_links','unified_locations','location_overrides',
  'collections',
  'returns','return_items','return_inspection','return_status_history',
  'inventory',
  'workday_sessions','workday_breaks','workday_settings','attendance_audit_log',
  'employee_work_policies',
  'notifications','push_subscriptions',
  'employee_entity_views','employee_baselines','employee_weight_overrides',
  'employee_advances',
  'employee_monthly_targets','company_monthly_targets','performance_weights_config',
  'customer_credit_ledger',
  'treasury_transactions',
  'reference_governorates','reference_cities',
  'expenses','external_carriers',
  'system_modules','owner_decisions',
  'daily_deals','daily_deal_items',
  'flash_offers','flash_offer_items',
  'tiers','tier_company_exceptions','tier_product_exceptions','tier_exceptions',
  'auctions','auction_items','auction_bids',
  'preparation_records','preparation_exceptions',
  'delivery_tracking','tracking_points','tracking_cleanup_log',
  'session_recovery_log',
  'deletion_audit_log','gps_test_points'
]
$function$;


-- 2.17 governed_deletion_execute_customers — remove credit_invoices/_cheques refs
DROP FUNCTION IF EXISTS public.governed_deletion_execute_customers(uuid, uuid[], boolean) CASCADE;
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_customers(p_token uuid, p_ids uuid[], p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_related jsonb;
    v_deleted_count int := 0;
    v_audit_id uuid;
    v_cust_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT jsonb_build_object(
        'orders', (SELECT COUNT(*)::int FROM public.orders o WHERE o.customer_id = ANY(p_ids)),
        'visits', (SELECT COUNT(*)::int FROM public.visits v WHERE v.customer_id = ANY(p_ids)),
        'collections', (SELECT COUNT(*)::int FROM public.collections cl WHERE cl.customer_id = ANY(p_ids)),
        'returns', (SELECT COUNT(*)::int FROM public.returns r WHERE r.customer_id = ANY(p_ids)),
        'addresses', (SELECT COUNT(*)::int FROM public.customer_addresses ca WHERE ca.customer_id = ANY(p_ids)),
        'contacts', (SELECT COUNT(*)::int FROM public.customer_contacts cc WHERE cc.customer_id = ANY(p_ids)),
        'credit_ledger', (SELECT COUNT(*)::int FROM public.customer_credit_ledger ccl WHERE ccl.customer_id = ANY(p_ids)),
        'credit_accounts', (SELECT COUNT(*)::int FROM public.customer_credit_accounts cca WHERE cca.customer_id = ANY(p_ids)),
        'app_sessions', (SELECT COUNT(*)::int FROM app.sessions s WHERE s.customer_id = ANY(p_ids)),
        'tier_exceptions', (SELECT COUNT(*)::int FROM public.tier_exceptions te WHERE te.customer_id = ANY(p_ids))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    IF (v_related->>'orders')::int > 0 THEN
        RETURN jsonb_build_object('error', 'HAS_ORDERS', 'related', v_related);
    END IF;

    DELETE FROM app.sessions WHERE customer_id = ANY(p_ids);
    DELETE FROM public.customer_credit_accounts WHERE customer_id = ANY(p_ids);
    DELETE FROM public.customer_credit_ledger WHERE customer_id = ANY(p_ids);
    DELETE FROM public.tier_exceptions WHERE customer_id = ANY(p_ids);
    DELETE FROM public.visit_links WHERE visit_id IN (SELECT id FROM public.visits WHERE customer_id = ANY(p_ids));
    DELETE FROM public.visits WHERE customer_id = ANY(p_ids);
    DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE customer_id = ANY(p_ids));
    DELETE FROM public.returns WHERE customer_id = ANY(p_ids);
    DELETE FROM public.treasury_transactions WHERE reference_type = 'collection' AND reference_id IN (SELECT id FROM public.collections WHERE customer_id = ANY(p_ids));
    DELETE FROM public.collections WHERE customer_id = ANY(p_ids);
    DELETE FROM public.customer_ownership_history WHERE customer_id = ANY(p_ids);
    DELETE FROM public.customer_addresses WHERE customer_id = ANY(p_ids);
    DELETE FROM public.customer_contacts WHERE customer_id = ANY(p_ids);

    v_deleted_count := 0;
    FOREACH v_cust_id IN ARRAY p_ids LOOP
        DELETE FROM public.customers WHERE id = v_cust_id;
        IF FOUND THEN v_deleted_count := v_deleted_count + 1; END IF;
    END LOOP;

    INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
    VALUES (v_session.employee_id, 'customers', p_ids, v_deleted_count, v_related)
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object('preview', false, 'deleted_count', v_deleted_count, 'audit_id', v_audit_id);
END;
$function$;


-- 2.18 governed_deletion_execute_employees — remove credit-apps/contracts/refs
DROP FUNCTION IF EXISTS public.governed_deletion_execute_employees(uuid, uuid[], boolean) CASCADE;
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_employees(p_token uuid, p_ids uuid[], p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_related jsonb;
    v_deleted_count int := 0;
    v_audit_id uuid;
    v_emp_id uuid;
    v_order_ids uuid[];
    v_customer_ids uuid[];
    v_error_msg text;
    v_constraint text;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    -- Only Upper Management may delete employees (remove nodes from the hierarchy)
    IF NOT public.is_upper_management(v_session.employee_id) THEN
        RETURN jsonb_build_object('error', 'UPPER_MANAGEMENT_ONLY');
    END IF;

    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    -- Get order and customer IDs for transitive cascade
    v_order_ids := public._emp_cascade_order_ids(p_ids);
    v_customer_ids := public._emp_cascade_customer_ids(p_ids);

    -- Build comprehensive related counts for preview
    SELECT jsonb_build_object(
        'employee_roles', (SELECT COUNT(*)::int FROM public.employee_roles x WHERE x.employee_id = ANY(p_ids) OR x.assigned_by = ANY(p_ids)),
        'employee_capabilities', (SELECT COUNT(*)::int FROM public.employee_capabilities x WHERE x.employee_id = ANY(p_ids) OR x.assigned_by = ANY(p_ids)),
        'employee_monthly_targets', (SELECT COUNT(*)::int FROM public.employee_monthly_targets x WHERE x.employee_id = ANY(p_ids)),
        'employee_weight_overrides', (SELECT COUNT(*)::int FROM public.employee_weight_overrides x WHERE x.employee_id = ANY(p_ids)),
        'employee_work_policies', (SELECT COUNT(*)::int FROM public.employee_work_policies x WHERE x.employee_id = ANY(p_ids) OR x.updated_by = ANY(p_ids)),
        'employee_advances', (SELECT COUNT(*)::int FROM public.employee_advances x WHERE x.employee_id = ANY(p_ids) OR x.created_by = ANY(p_ids) OR x.approved_by = ANY(p_ids)),
        'app_sessions', (SELECT COUNT(*)::int FROM app.sessions x WHERE x.employee_id = ANY(p_ids)),
        'tracking_points', (SELECT COUNT(*)::int FROM public.tracking_points x WHERE x.employee_id = ANY(p_ids)),
        'workday_breaks', (SELECT COUNT(*)::int FROM public.workday_breaks x WHERE x.employee_id = ANY(p_ids)),
        'workday_sessions', (SELECT COUNT(*)::int FROM public.workday_sessions x WHERE x.employee_id = ANY(p_ids)),
        'attendance_audit_log', (SELECT COUNT(*)::int FROM public.attendance_audit_log x WHERE x.employee_id = ANY(p_ids)),
        'session_recovery_log', (SELECT COUNT(*)::int FROM public.session_recovery_log x WHERE x.employee_id = ANY(p_ids)),
        'tracking_cleanup_log', (SELECT COUNT(*)::int FROM public.tracking_cleanup_log x WHERE x.executed_by = ANY(p_ids)),
        'visits', (SELECT COUNT(*)::int FROM public.visits x WHERE x.employee_id = ANY(p_ids)),
        'visit_links', (SELECT COUNT(*)::int FROM public.visit_links x WHERE x.visit_id IN (SELECT id FROM public.visits WHERE employee_id = ANY(p_ids)) OR x.session_id IN (SELECT id FROM public.workday_sessions WHERE employee_id = ANY(p_ids))),
        'delivery_tracking', (SELECT COUNT(*)::int FROM public.delivery_tracking x WHERE x.assigned_to = ANY(p_ids) OR x.assigned_by = ANY(p_ids) OR x.order_id = ANY(v_order_ids)),
        'preparation_records', (SELECT COUNT(*)::int FROM public.preparation_records x WHERE x.started_by = ANY(p_ids) OR x.completed_by = ANY(p_ids) OR x.cancelled_by = ANY(p_ids) OR x.reviewed_by = ANY(p_ids) OR x.order_id = ANY(v_order_ids)),
        'treasury_transactions', (SELECT COUNT(*)::int FROM public.treasury_transactions x WHERE x.created_by = ANY(p_ids) OR (x.reference_type = 'collection' AND x.reference_id IN (SELECT id FROM public.collections WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids) OR order_id = ANY(v_order_ids)))),
        'collections', (SELECT COUNT(*)::int FROM public.collections x WHERE x.created_by = ANY(p_ids) OR x.approved_by = ANY(p_ids) OR x.order_id = ANY(v_order_ids) OR x.customer_id = ANY(v_customer_ids)),
        'expenses', (SELECT COUNT(*)::int FROM public.expenses x WHERE x.created_by = ANY(p_ids) OR x.approved_by = ANY(p_ids)),
        'returns', (SELECT COUNT(*)::int FROM public.returns x WHERE x.created_by = ANY(p_ids) OR x.order_id = ANY(v_order_ids) OR x.customer_id = ANY(v_customer_ids)),
        'return_items', (SELECT COUNT(*)::int FROM public.return_items x WHERE x.return_id IN (SELECT id FROM public.returns WHERE created_by = ANY(p_ids) OR order_id = ANY(v_order_ids) OR customer_id = ANY(v_customer_ids))),
        'return_inspection', (SELECT COUNT(*)::int FROM public.return_inspection x WHERE x.inspected_by = ANY(p_ids)),
        'orders', (SELECT COUNT(*)::int FROM public.orders x WHERE x.created_by = ANY(p_ids) OR x.customer_id = ANY(v_customer_ids)),
        'order_items', (SELECT COUNT(*)::int FROM public.order_items x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'order_status_history', (SELECT COUNT(*)::int FROM public.order_status_history x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'order_modification_history', (SELECT COUNT(*)::int FROM public.order_modification_history x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'order_daily_deals', (SELECT COUNT(*)::int FROM public.order_daily_deals x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'order_flash_offers', (SELECT COUNT(*)::int FROM public.order_flash_offers x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'customers', (SELECT COUNT(*)::int FROM public.customers x WHERE x.owner_id = ANY(p_ids) OR (x.id = ANY(v_customer_ids))),
        'customer_addresses', (SELECT COUNT(*)::int FROM public.customer_addresses x WHERE x.customer_id = ANY(v_customer_ids)),
        'customer_contacts', (SELECT COUNT(*)::int FROM public.customer_contacts x WHERE x.customer_id = ANY(v_customer_ids)),
        'customer_ownership_history', (SELECT COUNT(*)::int FROM public.customer_ownership_history x WHERE x.customer_id = ANY(v_customer_ids) OR x.previous_owner_id = ANY(p_ids) OR x.new_owner_id = ANY(p_ids) OR x.changed_by = ANY(p_ids)),
        'customer_credit_ledger', (SELECT COUNT(*)::int FROM public.customer_credit_ledger x WHERE x.created_by = ANY(p_ids) OR x.customer_id = ANY(v_customer_ids)),
        'customer_credit_accounts', (SELECT COUNT(*)::int FROM public.customer_credit_accounts x WHERE x.activated_by = ANY(p_ids) OR x.customer_id = ANY(v_customer_ids)),
        'tier_exceptions', (SELECT COUNT(*)::int FROM public.tier_exceptions x WHERE x.assigned_by = ANY(p_ids) OR x.customer_id = ANY(v_customer_ids)),
        'daily_deals', (SELECT COUNT(*)::int FROM public.daily_deals x WHERE x.created_by = ANY(p_ids)),
        'flash_offers', (SELECT COUNT(*)::int FROM public.flash_offers x WHERE x.created_by = ANY(p_ids)),
        'packages', 0,
        'auctions', (SELECT COUNT(*)::int FROM public.auctions x WHERE x.created_by = ANY(p_ids)),
        'auction_participants', (SELECT COUNT(*)::int FROM public.auction_participants x WHERE x.approved_by = ANY(p_ids)),
        'auction_awards', (SELECT COUNT(*)::int FROM public.auction_awards x WHERE x.awarded_by = ANY(p_ids)),
        'deletion_audit_log', (SELECT COUNT(*)::int FROM public.deletion_audit_log x WHERE x.employee_id = ANY(p_ids)),
        'managed_employees', (SELECT COUNT(*)::int FROM public.employees x WHERE x.manager_id = ANY(p_ids)),
        'identities', (SELECT COUNT(*)::int FROM public.identities x WHERE x.id IN (SELECT identity_id FROM public.employees WHERE id = ANY(p_ids)))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    -- ========== EXECUTE CASCADE DELETE ==========
    BEGIN
        DELETE FROM public.employee_roles WHERE employee_id = ANY(p_ids) OR assigned_by = ANY(p_ids);
        DELETE FROM public.employee_capabilities WHERE employee_id = ANY(p_ids) OR assigned_by = ANY(p_ids);
        DELETE FROM public.employee_monthly_targets WHERE employee_id = ANY(p_ids);
        DELETE FROM public.employee_weight_overrides WHERE employee_id = ANY(p_ids);
        DELETE FROM public.employee_work_policies WHERE employee_id = ANY(p_ids) OR updated_by = ANY(p_ids);
        DELETE FROM public.employee_advances WHERE employee_id = ANY(p_ids) OR created_by = ANY(p_ids) OR approved_by = ANY(p_ids);
        DELETE FROM public.tracking_points WHERE employee_id = ANY(p_ids);
        DELETE FROM public.workday_breaks WHERE employee_id = ANY(p_ids);
        DELETE FROM public.attendance_audit_log WHERE employee_id = ANY(p_ids);
        DELETE FROM public.session_recovery_log WHERE employee_id = ANY(p_ids);
        DELETE FROM public.tracking_cleanup_log WHERE executed_by = ANY(p_ids);
        DELETE FROM public.deletion_audit_log WHERE employee_id = ANY(p_ids);
        DELETE FROM app.sessions WHERE employee_id = ANY(p_ids);
        DELETE FROM public.tier_exceptions WHERE assigned_by = ANY(p_ids);
        DELETE FROM public.daily_deals WHERE created_by = ANY(p_ids);
        DELETE FROM public.flash_offers WHERE created_by = ANY(p_ids);
        -- packages table skipped — not deployed in production
        DELETE FROM public.customer_credit_ledger WHERE created_by = ANY(p_ids);
        DELETE FROM public.customer_credit_accounts WHERE activated_by = ANY(p_ids);
        DELETE FROM public.expenses WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids);
        DELETE FROM public.treasury_transactions WHERE created_by = ANY(p_ids);
        DELETE FROM public.return_inspection WHERE inspected_by = ANY(p_ids);
        DELETE FROM public.visit_links WHERE visit_id IN (SELECT id FROM public.visits WHERE employee_id = ANY(p_ids));
        DELETE FROM public.visits WHERE employee_id = ANY(p_ids);

        DELETE FROM public.visit_links WHERE session_id IN (SELECT id FROM public.workday_sessions WHERE employee_id = ANY(p_ids));
        DELETE FROM public.workday_sessions WHERE employee_id = ANY(p_ids);

        DELETE FROM public.delivery_tracking WHERE assigned_to = ANY(p_ids) OR assigned_by = ANY(p_ids);

        DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE created_by = ANY(p_ids));
        DELETE FROM public.returns WHERE created_by = ANY(p_ids);

        DELETE FROM public.treasury_transactions
        WHERE reference_type = 'collection'
          AND reference_id IN (SELECT id FROM public.collections WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids));
        DELETE FROM public.collections WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids);

        DELETE FROM public.customer_ownership_history WHERE previous_owner_id = ANY(p_ids) OR new_owner_id = ANY(p_ids) OR changed_by = ANY(p_ids);

        DELETE FROM public.auction_awards WHERE awarded_by = ANY(p_ids);
        DELETE FROM public.auction_participants WHERE approved_by = ANY(p_ids);
        DELETE FROM public.auctions WHERE created_by = ANY(p_ids);

        IF array_length(v_order_ids, 1) > 0 THEN
            DELETE FROM public.order_daily_deals WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.order_flash_offers WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.order_items WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.order_status_history WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.order_modification_history WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.delivery_tracking WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.preparation_records WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = ANY(v_order_ids));
            DELETE FROM public.returns WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.treasury_transactions
            WHERE reference_type = 'collection'
              AND reference_id IN (SELECT id FROM public.collections WHERE order_id = ANY(v_order_ids));
            DELETE FROM public.collections WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.orders WHERE id = ANY(v_order_ids);
        END IF;

        IF array_length(v_customer_ids, 1) > 0 THEN
            DELETE FROM public.order_daily_deals WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.order_flash_offers WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.order_status_history WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.order_modification_history WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.delivery_tracking WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.preparation_records WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE customer_id = ANY(v_customer_ids));
            DELETE FROM public.returns WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.treasury_transactions WHERE reference_type = 'collection' AND reference_id IN (SELECT id FROM public.collections WHERE customer_id = ANY(v_customer_ids));
            DELETE FROM public.collections WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids);
            DELETE FROM public.customer_addresses WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customer_contacts WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customer_credit_accounts WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customer_credit_ledger WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.tier_exceptions WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customer_ownership_history WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customers WHERE id = ANY(v_customer_ids);
        END IF;

        -- Clear manager_id for subordinates of deleted employees
        UPDATE public.employees SET manager_id = NULL WHERE manager_id = ANY(p_ids);

        v_deleted_count := 0;
        FOREACH v_emp_id IN ARRAY p_ids LOOP
            DELETE FROM public.identities WHERE id = (SELECT identity_id FROM public.employees WHERE id = v_emp_id);
            DELETE FROM public.employees WHERE id = v_emp_id;
            IF FOUND THEN v_deleted_count := v_deleted_count + 1; END IF;
        END LOOP;

        INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
        VALUES (v_session.employee_id, 'employees', p_ids, v_deleted_count, v_related)
        RETURNING id INTO v_audit_id;

        RETURN jsonb_build_object('preview', false, 'deleted_count', v_deleted_count, 'audit_id', v_audit_id);

    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        v_error_msg := SQLERRM;
        RETURN jsonb_build_object(
            'error', 'FK_CONSTRAINT',
            'detail', CASE WHEN v_constraint IS NOT NULL THEN 'القيود المانعة: ' || v_constraint ELSE v_error_msg END,
            'constraint', v_constraint,
            'message', v_error_msg
        );
    END;
END;
$function$;


-- 2.19 governed_deletion_execute_orders — remove credit-invoice/collection refs
DROP FUNCTION IF EXISTS public.governed_deletion_execute_orders(uuid, uuid[], boolean) CASCADE;
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_orders(p_token uuid, p_ids uuid[], p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_related jsonb;
    v_deleted_count int := 0;
    v_audit_id uuid;
    v_order_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT jsonb_build_object(
        'order_items', (SELECT COUNT(*)::int FROM public.order_items oi WHERE oi.order_id = ANY(p_ids)),
        'order_status_history', (SELECT COUNT(*)::int FROM public.order_status_history osh WHERE osh.order_id = ANY(p_ids)),
        'order_modification_history', (SELECT COUNT(*)::int FROM public.order_modification_history omh WHERE omh.order_id = ANY(p_ids)),
        'delivery_tracking', (SELECT COUNT(*)::int FROM public.delivery_tracking dt WHERE dt.order_id = ANY(p_ids)),
        'delivery_actions', (SELECT COUNT(*)::int FROM public.delivery_actions da WHERE da.order_id = ANY(p_ids)),
        'journey_orders', (SELECT COUNT(*)::int FROM public.journey_orders jo WHERE jo.order_id = ANY(p_ids)),
        'preparation_records', (SELECT COUNT(*)::int FROM public.preparation_records pr WHERE pr.order_id = ANY(p_ids)),
        'returns', (SELECT COUNT(*)::int FROM public.returns r WHERE r.order_id = ANY(p_ids)),
        'collections', (SELECT COUNT(*)::int FROM public.collections cl WHERE cl.order_id = ANY(p_ids)),
        'order_daily_deals', (SELECT COUNT(*)::int FROM public.order_daily_deals odd WHERE odd.order_id = ANY(p_ids)),
        'order_flash_offers', (SELECT COUNT(*)::int FROM public.order_flash_offers ofo WHERE ofo.order_id = ANY(p_ids)),
        'auction_awards', (SELECT COUNT(*)::int FROM public.auction_awards aa WHERE aa.order_id = ANY(p_ids)),
        'inventory_movements', (SELECT COUNT(*)::int FROM public.inventory_movements im WHERE im.order_id = ANY(p_ids))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    PERFORM public.governed_inventory_restore(
      oid,
      'ORDER_DELETION_RESTORE',
      'تمت إعادة الكمية قبل حذف الطلب.'
    )
    FROM unnest(p_ids) AS oid
    JOIN public.orders o ON o.id = oid
    WHERE o.status = ANY(public.execution_status_group())
      AND o.inventory_deducted_at IS NOT NULL;

    DELETE FROM public.inventory_movements WHERE order_id = ANY(p_ids);

    DELETE FROM public.order_deletion_inventory_audit WHERE order_id = ANY(p_ids);

    DELETE FROM public.delivery_actions
    WHERE delivery_tracking_id IN (SELECT id FROM public.delivery_tracking WHERE order_id = ANY(p_ids));
    DELETE FROM public.order_flash_offers WHERE order_id = ANY(p_ids);
    DELETE FROM public.order_daily_deals WHERE order_id = ANY(p_ids);
    DELETE FROM public.treasury_transactions WHERE reference_type = 'collection' AND reference_id IN (SELECT id FROM public.collections WHERE order_id = ANY(p_ids));
    DELETE FROM public.collections WHERE order_id = ANY(p_ids);
    DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = ANY(p_ids));
    DELETE FROM public.returns WHERE order_id = ANY(p_ids);
    DELETE FROM public.preparation_exceptions WHERE preparation_id IN (SELECT id FROM public.preparation_records WHERE order_id = ANY(p_ids));
    DELETE FROM public.preparation_records WHERE order_id = ANY(p_ids);
    DELETE FROM public.delivery_tracking WHERE order_id = ANY(p_ids);
    -- Journey membership: journey_orders.order_id has no ON DELETE CASCADE.
    DELETE FROM public.journey_orders WHERE order_id = ANY(p_ids);
    DELETE FROM public.auction_awards WHERE order_id = ANY(p_ids);
    DELETE FROM public.order_modification_history WHERE order_id = ANY(p_ids);
    DELETE FROM public.order_status_history WHERE order_id = ANY(p_ids);
    DELETE FROM public.order_items WHERE order_id = ANY(p_ids);

    v_deleted_count := 0;
    FOREACH v_order_id IN ARRAY p_ids LOOP
        DELETE FROM public.orders WHERE id = v_order_id;
        IF FOUND THEN v_deleted_count := v_deleted_count + 1; END IF;
    END LOOP;

    INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
    VALUES (v_session.employee_id, 'orders', p_ids, v_deleted_count, v_related)
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object('preview', false, 'deleted_count', v_deleted_count, 'audit_id', v_audit_id);
END;
$function$;


-- 2.20 governed_deletion_search_employees — remove credit-application/contract/
--      cheque related counts (kept: customer_credit_accounts + _ledger)
DROP FUNCTION IF EXISTS public.governed_deletion_search_employees(uuid, text, text, date, date) CASCADE;
CREATE OR REPLACE FUNCTION public.governed_deletion_search_employees(p_token uuid, p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_data jsonb;
    v_total int;
    v_oid uuid[];
    v_cid uuid[];
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id,
        'name', e.full_name,
        'code', e.code,
        'status', CASE WHEN e.is_active THEN 'active' ELSE 'inactive' END,
        'created_at', e.created_at,
        'related_counts', jsonb_build_object(
            -- Employee-specific tables
            'employee_roles', (SELECT COUNT(*)::int FROM public.employee_roles x WHERE x.employee_id = e.id),
            'employee_capabilities', (SELECT COUNT(*)::int FROM public.employee_capabilities x WHERE x.employee_id = e.id),
            'employee_monthly_targets', (SELECT COUNT(*)::int FROM public.employee_monthly_targets x WHERE x.employee_id = e.id),
            'employee_weight_overrides', (SELECT COUNT(*)::int FROM public.employee_weight_overrides x WHERE x.employee_id = e.id),
            'employee_work_policies', (SELECT COUNT(*)::int FROM public.employee_work_policies x WHERE x.employee_id = e.id),
            'employee_advances', (SELECT COUNT(*)::int FROM public.employee_advances x WHERE x.employee_id = e.id OR x.created_by = e.id OR x.approved_by = e.id),
            -- Attendance & tracking
            'workday_sessions', (SELECT COUNT(*)::int FROM public.workday_sessions x WHERE x.employee_id = e.id),
            'workday_breaks', (SELECT COUNT(*)::int FROM public.workday_breaks x WHERE x.employee_id = e.id),
            'tracking_points', (SELECT COUNT(*)::int FROM public.tracking_points x WHERE x.employee_id = e.id),
            'attendance_audit_log', (SELECT COUNT(*)::int FROM public.attendance_audit_log x WHERE x.employee_id = e.id),
            'session_recovery_log', (SELECT COUNT(*)::int FROM public.session_recovery_log x WHERE x.employee_id = e.id),
            'tracking_cleanup_log', (SELECT COUNT(*)::int FROM public.tracking_cleanup_log x WHERE x.executed_by = e.id),
            -- Field work
            'visits', (SELECT COUNT(*)::int FROM public.visits x WHERE x.employee_id = e.id),
            'delivery_tracking_assigned_to', (SELECT COUNT(*)::int FROM public.delivery_tracking x WHERE x.assigned_to = e.id),
            'delivery_tracking_assigned_by', (SELECT COUNT(*)::int FROM public.delivery_tracking x WHERE x.assigned_by = e.id),
            'preparation_records', (SELECT COUNT(*)::int FROM public.preparation_records x WHERE x.started_by = e.id OR x.completed_by = e.id OR x.cancelled_by = e.id OR x.reviewed_by = e.id),
            'return_inspection', (SELECT COUNT(*)::int FROM public.return_inspection x WHERE x.inspected_by = e.id),
            -- Financial
            'collections_created_by', (SELECT COUNT(*)::int FROM public.collections x WHERE x.created_by = e.id),
            'collections_approved_by', (SELECT COUNT(*)::int FROM public.collections x WHERE x.approved_by = e.id),
            'treasury_transactions', (SELECT COUNT(*)::int FROM public.treasury_transactions x WHERE x.created_by = e.id),
            'expenses', (SELECT COUNT(*)::int FROM public.expenses x WHERE x.created_by = e.id OR x.approved_by = e.id),
            'returns', (SELECT COUNT(*)::int FROM public.returns x WHERE x.created_by = e.id),
            -- Credit
            'customer_credit_ledger', (SELECT COUNT(*)::int FROM public.customer_credit_ledger x WHERE x.created_by = e.id),
            'customer_credit_accounts', (SELECT COUNT(*)::int FROM public.customer_credit_accounts x WHERE x.activated_by = e.id),
            'tier_exceptions', (SELECT COUNT(*)::int FROM public.tier_exceptions x WHERE x.assigned_by = e.id),
            -- Products & deals
            'daily_deals', (SELECT COUNT(*)::int FROM public.daily_deals x WHERE x.created_by = e.id),
            'flash_offers', (SELECT COUNT(*)::int FROM public.flash_offers x WHERE x.created_by = e.id),
            'packages', (SELECT COUNT(*)::int FROM public.packages x WHERE x.created_by = e.id),
            -- Auctions
            'auctions', (SELECT COUNT(*)::int FROM public.auctions x WHERE x.created_by = e.id),
            'auction_participants', (SELECT COUNT(*)::int FROM public.auction_participants x WHERE x.approved_by = e.id),
            'auction_awards', (SELECT COUNT(*)::int FROM public.auction_awards x WHERE x.awarded_by = e.id),
            -- Ownership & customers
            'customer_ownership_history', (SELECT COUNT(*)::int FROM public.customer_ownership_history x WHERE x.previous_owner_id = e.id OR x.new_owner_id = e.id OR x.changed_by = e.id),
            'customers_owner', (SELECT COUNT(*)::int FROM public.customers x WHERE x.owner_id = e.id),
            -- Orders
            'orders', (SELECT COUNT(*)::int FROM public.orders x WHERE x.created_by = e.id),
            -- App sessions
            'app_sessions', (SELECT COUNT(*)::int FROM app.sessions x WHERE x.employee_id = e.id),
            -- Self
            'managed_employees', (SELECT COUNT(*)::int FROM public.employees x WHERE x.manager_id = e.id)
        )
    ) ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_data
    FROM public.employees e
    WHERE (p_search IS NULL OR e.full_name ILIKE '%' || p_search || '%' OR e.code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR (CASE WHEN p_status = 'active' THEN e.is_active = true ELSE e.is_active = false END))
      AND (p_date_from IS NULL OR e.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR e.created_at < (p_date_to + 1)::timestamptz);

    SELECT COUNT(*)::int INTO v_total
    FROM public.employees e
    WHERE (p_search IS NULL OR e.full_name ILIKE '%' || p_search || '%' OR e.code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR (CASE WHEN p_status = 'active' THEN e.is_active = true ELSE e.is_active = false END))
      AND (p_date_from IS NULL OR e.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR e.created_at < (p_date_to + 1)::timestamptz);

    RETURN jsonb_build_object('data', v_data, 'total', v_total);
END;
$function$;


-- 2.21 governed_deletion_search_orders — remove credit_invoices related count
DROP FUNCTION IF EXISTS public.governed_deletion_search_orders(uuid, text, text, date, date, uuid, uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.governed_deletion_search_orders(p_token uuid, p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_customer_id uuid DEFAULT NULL::uuid, p_rep_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_data jsonb;
    v_total int;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'name', o.order_number,
        'code', o.order_number,
        'status', o.status,
        'created_at', o.created_at,
        'customer_name', COALESCE(o.snapshot_customer_name, (SELECT cu.company_name FROM public.customers cu WHERE cu.id = o.customer_id)),
        'owner_name', COALESCE(o.snapshot_owner_name, (SELECT e.full_name FROM public.employees e WHERE e.id = o.owner_id)),
        'total_amount', o.total_amount,
        'related_counts', jsonb_build_object(
            'order_items', (SELECT COUNT(*)::int FROM public.order_items oi WHERE oi.order_id = o.id),
            'delivery_tracking', (SELECT COUNT(*)::int FROM public.delivery_tracking dt WHERE dt.order_id = o.id),
            'returns', (SELECT COUNT(*)::int FROM public.returns r WHERE r.order_id = o.id),
            'collections', (SELECT COUNT(*)::int FROM public.collections cl WHERE cl.order_id = o.id),
            'preparation_records', (SELECT COUNT(*)::int FROM public.preparation_records pr WHERE pr.order_id = o.id)
        )
    ) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_data
    FROM public.orders o
    WHERE (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR o.created_at < (p_date_to + 1)::timestamptz)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_rep_id IS NULL OR o.owner_id = p_rep_id);

    SELECT COUNT(*)::int INTO v_total
    FROM public.orders o
    WHERE (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR o.created_at < (p_date_to + 1)::timestamptz)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_rep_id IS NULL OR o.owner_id = p_rep_id);

    RETURN jsonb_build_object('data', v_data, 'total', v_total);
END;
$function$;


-- ============================================================================
-- 3. DROP FUNCTION — 39 RPCs (32 credit-named + 7 non-credit-named workflow)
-- ============================================================================
-- generate_credit_note_number() and generate_cheque_number() are KEPT (they
-- read only code_sequences and serve the returns / cash-SAHL domains).
DROP FUNCTION IF EXISTS public.decide_credit_collection_request(p_token text, p_request_id uuid, p_decision text, p_notes text);
DROP FUNCTION IF EXISTS public.get_credit_collection_history(p_token text, p_order_id uuid);
DROP FUNCTION IF EXISTS public.get_credit_collection_invoices(p_token text);
DROP FUNCTION IF EXISTS public.get_credit_dashboard_stats(p_token uuid);
DROP FUNCTION IF EXISTS public.get_credit_invoices_management(p_token text);
DROP FUNCTION IF EXISTS public.get_governed_credit_application(p_token uuid, p_id uuid);
DROP FUNCTION IF EXISTS public.get_governed_credit_applications(p_token uuid);
DROP FUNCTION IF EXISTS public.get_governed_credit_dashboard(p_token uuid);
DROP FUNCTION IF EXISTS public.get_governed_credit_invoice_detail(p_token uuid, p_invoice_id uuid);
DROP FUNCTION IF EXISTS public.get_governed_credit_invoices(p_token uuid, p_customer_id uuid);
DROP FUNCTION IF EXISTS public.get_governed_customer_credit_account(p_token uuid);
DROP FUNCTION IF EXISTS public.governed_activate_credit_account(p_token uuid, p_customer_id uuid, p_program_id uuid, p_guarantee_cheque_amount numeric);
DROP FUNCTION IF EXISTS public.governed_approve_credit(p_token uuid, p_id uuid);
DROP FUNCTION IF EXISTS public.governed_auto_suspend_overdue_accounts();
DROP FUNCTION IF EXISTS public.governed_confirm_documents(p_token uuid, p_id uuid, p_doc_commercial_reg boolean, p_doc_tax_card boolean, p_doc_national_id boolean, p_doc_cheques boolean, p_doc_contract_signed boolean);
DROP FUNCTION IF EXISTS public.governed_convert_credit_reservation_to_outstanding(p_token uuid, p_order_id uuid);
DROP FUNCTION IF EXISTS public.governed_create_credit_application(p_token uuid, p_customer_id uuid, p_program_id uuid);
DROP FUNCTION IF EXISTS public.governed_create_credit_program(p_token uuid, p_name character varying, p_credit_limit numeric, p_credit_days integer, p_terms text);
DROP FUNCTION IF EXISTS public.governed_get_contract_by_application(p_token uuid, p_application_id uuid);
DROP FUNCTION IF EXISTS public.governed_get_contract_template(p_token uuid);
DROP FUNCTION IF EXISTS public.governed_get_credit_programs(p_token uuid, p_include_inactive boolean);
DROP FUNCTION IF EXISTS public.governed_reactivate_credit(p_token uuid, p_id uuid);
DROP FUNCTION IF EXISTS public.governed_reactivate_credit_account(p_token uuid, p_customer_id uuid);
DROP FUNCTION IF EXISTS public.governed_record_cheque(p_token uuid, p_invoice_id uuid, p_cheque_number character varying, p_bank_name character varying, p_amount numeric, p_due_date date);
DROP FUNCTION IF EXISTS public.governed_record_credit_payment(p_token uuid, p_invoice_id uuid, p_payment_method character varying);
DROP FUNCTION IF EXISTS public.governed_reject_credit(p_token uuid, p_id uuid, p_reason text);
DROP FUNCTION IF EXISTS public.governed_release_credit_reservation(p_token uuid, p_order_id uuid);
DROP FUNCTION IF EXISTS public.governed_reserve_credit_for_order(p_token uuid, p_order_id uuid);
DROP FUNCTION IF EXISTS public.governed_review_credit(p_token uuid, p_id uuid);
DROP FUNCTION IF EXISTS public.governed_sign_contract(p_token uuid, p_application_id uuid);
DROP FUNCTION IF EXISTS public.governed_submit_credit_application(p_token uuid, p_id uuid);
DROP FUNCTION IF EXISTS public.governed_suspend_credit(p_token uuid, p_id uuid, p_reason text);
DROP FUNCTION IF EXISTS public.governed_suspend_credit_account(p_token uuid, p_customer_id uuid, p_reason text);
DROP FUNCTION IF EXISTS public.governed_toggle_credit_program(p_token uuid, p_id uuid, p_is_active boolean);
DROP FUNCTION IF EXISTS public.governed_update_contract_template(p_token uuid, p_id uuid, p_template_text text);
DROP FUNCTION IF EXISTS public.governed_update_credit_program(p_token uuid, p_id uuid, p_name character varying, p_credit_limit numeric, p_credit_days integer, p_terms text);
DROP FUNCTION IF EXISTS public.is_credit_collector_employee(p_employee_id uuid);
DROP FUNCTION IF EXISTS public.save_credit_invoice_info(p_token text, p_order_id uuid, p_due_date date, p_check_number character varying, p_bank_name character varying, p_check_holder character varying, p_notes text);
DROP FUNCTION IF EXISTS public.submit_credit_collection_request(p_token text, p_invoice_id uuid, p_amount numeric, p_latitude numeric, p_longitude numeric, p_notes text);


-- ============================================================================
-- 4. COLUMN DROPS
-- ============================================================================
ALTER TABLE public.customers DROP COLUMN IF EXISTS credit_limit;
ALTER TABLE public.customers DROP COLUMN IF EXISTS credit_days;
ALTER TABLE public.customer_credit_accounts DROP COLUMN IF EXISTS credit_program_id; -- auto-drops fk_cca_program


-- ============================================================================
-- 5. DROP TABLES (child-first for FK resolution)
-- ============================================================================
DROP TABLE IF EXISTS public.credit_collection_requests;
DROP TABLE IF EXISTS public.credit_collection_invoices;
DROP TABLE IF EXISTS public.credit_invoice_cheques;
DROP TABLE IF EXISTS public.credit_invoices;
DROP TABLE IF EXISTS public.credit_contracts;
DROP TABLE IF EXISTS public.credit_applications;
DROP TABLE IF EXISTS public.credit_contract_templates;
DROP TABLE IF EXISTS public.credit_programs;
-- _test_backup schema holds a stale duplicate of credit_invoices that uses
-- credit_invoice_status; drop it so the enum type can be dropped below.
DROP TABLE IF EXISTS _test_backup.credit_invoices;


-- ============================================================================
-- 6. DROP ENUM TYPES (kept: credit_account_status, ledger_transaction_type)
-- ============================================================================
DROP TYPE IF EXISTS public.cheque_status;
DROP TYPE IF EXISTS public.credit_application_status;
DROP TYPE IF EXISTS public.credit_invoice_status;


-- ============================================================================
-- 7. METADATA CLEANUP — credit role, system module, owner decisions
-- ============================================================================
-- معتمد ائتماني role (no employees hold it) + its capability grants.
DELETE FROM public.role_capabilities
 WHERE role_id = '4df04fe8-e74c-415d-9757-82759721f9ad';
DELETE FROM public.roles
 WHERE id = '4df04fe8-e74c-415d-9757-82759721f9ad';

DELETE FROM public.owner_decisions WHERE module_key = 'credit';
DELETE FROM public.system_modules WHERE module_key = 'credit';