-- ============================================================================
-- Migration: Fix Weights Canonical Source
-- Date: 2026-12-31
--
-- THE PROBLEM:
--   governed_upsert_company_monthly_target  writes weights to company_monthly_targets
--   get_governed_target_performance         reads  weights from performance_weights_config
--   get_effective_weights                   reads  weights from performance_weights_config
--
--   Result: the user modifies weights in the UI, but the canonical engine
--   ignores those modifications because it reads from a different table.
--
-- THE FIX:
--   Both functions now read weights from company_monthly_targets — the same
--   table that WeightsTab writes to via governed_upsert_company_monthly_target.
--
--   No dual-write. No writes to performance_weights_config. One source of truth.
-- ============================================================================
-- ============================================================================
-- STEP 0: Mark performance_weights_config as LEGACY (no writes remain)
-- ============================================================================

COMMENT ON TABLE public.performance_weights_config IS
  'LEGACY TABLE — DO NOT USE in new development. '
  'This table was the original year-level weights config. '
  'As of 2026-12-31, weights are read from company_monthly_targets '
  '(the single canonical source). '
  'This table is preserved for audit/historical reference only. '
  'No application code writes to this table.';

COMMENT ON COLUMN public.performance_weights_config.sales_weight_percent IS 'LEGACY — use company_monthly_targets.sales_weight_percent';
COMMENT ON COLUMN public.performance_weights_config.collections_weight_percent IS 'LEGACY — use company_monthly_targets.collections_weight_percent';
COMMENT ON COLUMN public.performance_weights_config.visits_weight_percent IS 'LEGACY — use company_monthly_targets.visits_weight_percent';
COMMENT ON COLUMN public.performance_weights_config.new_customers_weight_percent IS 'LEGACY — use company_monthly_targets.new_customers_weight_percent';
COMMENT ON COLUMN public.performance_weights_config.attendance_weight_percent IS 'LEGACY — use company_monthly_targets.attendance_weight_percent';
COMMENT ON COLUMN public.performance_weights_config.orders_weight_percent IS 'LEGACY — use company_monthly_targets.orders_weight_percent';

-- ============================================================================
-- STEP 1: Update get_effective_weights — read from company_monthly_targets
--         instead of performance_weights_config
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_effective_weights(
    p_employee_id uuid,
    p_target_month int,
    p_target_year int
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_monthly_targets public.company_monthly_targets;
    v_override public.employee_weight_overrides;
    v_result jsonb;
    v_orders_default numeric := 7.5;
BEGIN
    -- First check for an active override
    SELECT * INTO v_override
    FROM public.employee_weight_overrides
    WHERE employee_id = p_employee_id
        AND target_month = p_target_month
        AND target_year = p_target_year
        AND is_active = true;

    IF FOUND THEN
        v_result := jsonb_build_object(
            'source', 'override',
            'sales_weight_percent', COALESCE(v_override.sales_weight_percent, 35),
            'collections_weight_percent', COALESCE(v_override.collections_weight_percent, 20),
            'visits_weight_percent', COALESCE(v_override.visits_weight_percent, 15),
            'orders_weight_percent', COALESCE(v_override.orders_weight_percent, v_orders_default),
            'new_customers_weight_percent', COALESCE(v_override.new_customers_weight_percent, 15),
            'attendance_weight_percent', COALESCE(v_override.attendance_weight_percent, 15)
        );
        RETURN v_result;
    END IF;

    -- Fall back to company monthly weights (Canonical Source: company_monthly_targets)
    SELECT * INTO v_monthly_targets
    FROM public.company_monthly_targets
    WHERE target_month = p_target_month
      AND target_year = p_target_year;

    IF FOUND THEN
        v_result := jsonb_build_object(
            'source', 'config',
            'sales_weight_percent', v_monthly_targets.sales_weight_percent,
            'collections_weight_percent', v_monthly_targets.collections_weight_percent,
            'visits_weight_percent', v_monthly_targets.visits_weight_percent,
            'orders_weight_percent', COALESCE(v_monthly_targets.orders_weight_percent, v_orders_default),
            'new_customers_weight_percent', v_monthly_targets.new_customers_weight_percent,
            'attendance_weight_percent', v_monthly_targets.attendance_weight_percent
        );
        RETURN v_result;
    END IF;

    -- Hardcoded defaults (no company target row found for this month/year)
    RETURN jsonb_build_object(
        'source', 'default',
        'sales_weight_percent', 35,
        'collections_weight_percent', 20,
        'visits_weight_percent', 15,
        'orders_weight_percent', v_orders_default,
        'new_customers_weight_percent', 15,
        'attendance_weight_percent', 15
    );
END;
$function$;

COMMENT ON FUNCTION public.get_effective_weights
  IS 'Returns effective weights for an employee: override → company_monthly_targets → defaults. Canonical source: company_monthly_targets.';

-- ============================================================================
-- STEP 2: Update get_governed_target_performance — read company weights from
--         company_monthly_targets instead of performance_weights_config
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_target_performance(
    p_token uuid, p_month int DEFAULT NULL, p_year int DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
    v_session app.sessions;
    v_target_month int; v_target_year int;
    v_comp_sales_weight numeric := 75;
    v_comp_visits_weight numeric := 7.5;
    v_comp_orders_weight numeric := 7.5;
    v_comp_new_customers_weight numeric := 10;
    v_comp_collections_weight numeric := 0;
    v_comp_attendance_weight numeric := 0;
    v_company_sales_target numeric;
    v_company_visits_target int;
    v_company_orders_target int;
    v_company_new_customers_target int;
    v_company_delivered_sales numeric; v_company_completed_visits int;
    v_company_delivered_orders int; v_company_new_customers int;
    v_company_return_deductions numeric; v_company_full_returns int;
    v_company_effective_sales numeric; v_company_effective_orders int;
    v_company_sales_pct numeric; v_company_visits_pct numeric;
    v_company_orders_pct numeric; v_company_new_customers_pct numeric;
    v_company_overall numeric;
    v_employee_perf jsonb; v_best_employee jsonb; v_weakest_employee jsonb;
    v_company_info jsonb;
    v_hierarchy jsonb;
    v_month_start timestamptz; v_month_end timestamptz;
    v_visible_ids uuid[];
    v_has_target boolean;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_visible_ids := public.get_visible_employee_ids(p_token);
    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
    v_month_start := date_trunc('month', to_timestamp(v_target_year || '-' || v_target_month || '-01', 'YYYY-MM-DD'));
    v_month_end := v_month_start + INTERVAL '1 month';

    -- Read company-level weights from company_monthly_targets (Canonical Source)
    -- The row existence is verified below; if absent we return early.
    SELECT
        COALESCE(sales_weight_percent, 75),
        COALESCE(visits_weight_percent, 7.5),
        COALESCE(orders_weight_percent, 7.5),
        COALESCE(new_customers_weight_percent, 10),
        COALESCE(collections_weight_percent, 0),
        COALESCE(attendance_weight_percent, 0)
    INTO v_comp_sales_weight, v_comp_visits_weight, v_comp_orders_weight,
         v_comp_new_customers_weight, v_comp_collections_weight, v_comp_attendance_weight
    FROM public.company_monthly_targets
    WHERE target_month = v_target_month
      AND target_year = v_target_year;

    -- Company targets = read from company_monthly_targets (not SUM of employees)
    SELECT
        sales_target,
        visits_target::int,
        orders_target::int,
        new_customers_target::int
    INTO v_company_sales_target, v_company_visits_target, v_company_orders_target, v_company_new_customers_target
    FROM public.company_monthly_targets
    WHERE target_month = v_target_month
      AND target_year = v_target_year;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('has_target', false, 'company', 'null'::jsonb, 'employees', '[]'::jsonb, 'best_employee', 'null'::jsonb, 'weakest_employee', 'null'::jsonb, 'hierarchy', 'null'::jsonb);
    END IF;

    v_has_target := (v_company_sales_target > 0 OR v_company_visits_target > 0 OR v_company_orders_target > 0 OR v_company_new_customers_target > 0);
    IF NOT v_has_target THEN
        RETURN jsonb_build_object('has_target', false, 'company', 'null'::jsonb, 'employees', '[]'::jsonb, 'best_employee', 'null'::jsonb, 'weakest_employee', 'null'::jsonb, 'hierarchy', 'null'::jsonb);
    END IF;

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

    -- Achievement percentages with LEAST cap at 100%
    v_company_sales_pct := CASE WHEN v_company_sales_target > 0
        THEN LEAST(ROUND((v_company_effective_sales / v_company_sales_target * 100)::numeric, 2), 100)
        ELSE 0 END;
    v_company_visits_pct := CASE WHEN v_company_visits_target > 0
        THEN LEAST(ROUND((v_company_completed_visits::numeric / v_company_visits_target * 100)::numeric, 2), 100)
        ELSE 0 END;
    v_company_orders_pct := CASE WHEN v_company_orders_target > 0
        THEN LEAST(ROUND((v_company_effective_orders::numeric / v_company_orders_target * 100)::numeric, 2), 100)
        ELSE 0 END;
    v_company_new_customers_pct := CASE WHEN v_company_new_customers_target > 0
        THEN LEAST(ROUND((v_company_new_customers::numeric / v_company_new_customers_target * 100)::numeric, 2), 100)
        ELSE 0 END;

    -- Company overall weighted score (from company_monthly_targets weights)
    v_company_overall := ROUND(
        (v_company_sales_pct * v_comp_sales_weight / 100) +
        (v_company_visits_pct * v_comp_visits_weight / 100) +
        (v_company_orders_pct * v_comp_orders_weight / 100) +
        (v_company_new_customers_pct * v_comp_new_customers_weight / 100), 2);

    v_company_info := jsonb_build_object(
        'sales_target', v_company_sales_target, 'visits_target', v_company_visits_target,
        'orders_target', v_company_orders_target, 'new_customers_target', v_company_new_customers_target,
        'sales_actual', v_company_effective_sales, 'visits_actual', v_company_completed_visits,
        'orders_actual', v_company_effective_orders, 'new_customers_actual', v_company_new_customers,
        'return_deductions', v_company_return_deductions, 'full_returns', v_company_full_returns,
        'sales_weight_percent', v_comp_sales_weight, 'visits_weight_percent', v_comp_visits_weight,
        'orders_weight_percent', v_comp_orders_weight, 'new_customers_weight_percent', v_comp_new_customers_weight,
        'collections_weight_percent', v_comp_collections_weight, 'attendance_weight_percent', v_comp_attendance_weight,
        'sales_achievement_pct', v_company_sales_pct, 'visits_achievement_pct', v_company_visits_pct,
        'orders_achievement_pct', v_company_orders_pct, 'new_customers_achievement_pct', v_company_new_customers_pct,
        'overall_achievement_pct', v_company_overall
    );

    -- --------------------------------------------------------------------------
    -- Employee performance with dynamic weights per employee
    -- --------------------------------------------------------------------------
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
    ), employee_collections AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            COALESCE(SUM(c.amount), 0) AS collections_actual
        FROM public.collections c
        WHERE c.created_at >= v_month_start AND c.created_at < v_month_end
        GROUP BY public.resolve_employee_id(c.owner_id)
    ), employee_calc AS (
        SELECT e.id AS employee_id, e.code AS employee_code, e.full_name AS employee_name,
            e.manager_id,
            m.full_name AS manager_name,
            COALESCE(et.sales_target, 0) AS sales_target,
            COALESCE(et.visits_target, 0) AS visits_target,
            COALESCE(et.orders_target, 0) AS orders_target,
            COALESCE(et.new_customers_target, 0) AS new_customers_target,
            COALESCE(et.collections_target, 0) AS collections_target,
            COALESCE(s.sales_actual, 0) AS gross_sales,
            COALESCE(v.visits_actual, 0) AS visits_actual,
            COALESCE(s.orders_actual, 0) AS gross_orders,
            COALESCE(nc.new_customers_actual, 0) AS new_customers_actual,
            COALESCE(rd.return_deduction, 0) AS return_deduction,
            COALESCE(rd.full_returns, 0) AS full_returns,
            COALESCE(cl.collections_actual, 0) AS collections_actual,
            GREATEST(COALESCE(s.sales_actual, 0) - COALESCE(rd.return_deduction, 0), 0) AS effective_sales,
            GREATEST(COALESCE(s.orders_actual, 0) - COALESCE(rd.full_returns, 0), 0) AS effective_orders,
            CASE WHEN et.id IS NOT NULL THEN et.is_locked ELSE NULL END AS is_locked,
            et.id IS NOT NULL AS has_target,
            (COALESCE(s.sales_actual, 0) > 0 OR COALESCE(v.visits_actual, 0) > 0
             OR COALESCE(s.orders_actual, 0) > 0 OR COALESCE(nc.new_customers_actual, 0) > 0) AS has_activity,
            public.get_effective_weights(e.id, v_target_month, v_target_year) AS emp_weights
        FROM public.employees e
        LEFT JOIN public.employees m ON m.id = e.manager_id
        LEFT JOIN public.employee_monthly_targets et
            ON et.employee_id = e.id AND et.target_month = v_target_month AND et.target_year = v_target_year
        LEFT JOIN employee_sales s ON s.employee_id = e.id
        LEFT JOIN employee_visits v ON v.employee_id = e.id
        LEFT JOIN employee_new_customers nc ON nc.employee_id = e.id
        LEFT JOIN employee_returns rd ON rd.employee_id = e.id
        LEFT JOIN employee_collections cl ON cl.employee_id = e.id
        WHERE e.is_active = true AND e.id = ANY(v_visible_ids)
    ), employee_with_kpis AS (
        SELECT ec.*,
            0 AS attendance_target,
            0 AS attendance_actual,
            CASE WHEN ec.sales_target > 0
                THEN LEAST(ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2), 100)
                ELSE NULL END AS sales_achievement_pct,
            CASE WHEN ec.visits_target > 0
                THEN LEAST(ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2), 100)
                ELSE NULL END AS visits_achievement_pct,
            CASE WHEN ec.orders_target > 0
                THEN LEAST(ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2), 100)
                ELSE NULL END AS orders_achievement_pct,
            CASE WHEN ec.new_customers_target > 0
                THEN LEAST(ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2), 100)
                ELSE NULL END AS new_customers_achievement_pct,
            CASE WHEN ec.collections_target > 0
                THEN LEAST(ROUND((ec.collections_actual::numeric / ec.collections_target * 100)::numeric, 2), 100)
                ELSE NULL END AS collections_achievement_pct,
            NULL::numeric AS attendance_achievement_pct,
            CASE WHEN ec.has_target AND (ec.sales_target > 0 OR ec.visits_target > 0 OR ec.orders_target > 0 OR ec.new_customers_target > 0)
                THEN ROUND(
                    (CASE WHEN ec.sales_target > 0 THEN LEAST(ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2), 100) ELSE 0 END *
                        COALESCE((ec.emp_weights->>'sales_weight_percent')::numeric, 75) / 100) +
                    (CASE WHEN ec.visits_target > 0 THEN LEAST(ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2), 100) ELSE 0 END *
                        COALESCE((ec.emp_weights->>'visits_weight_percent')::numeric, 7.5) / 100) +
                    (CASE WHEN ec.orders_target > 0 THEN LEAST(ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2), 100) ELSE 0 END *
                        COALESCE((ec.emp_weights->>'orders_weight_percent')::numeric, 7.5) / 100) +
                    (CASE WHEN ec.new_customers_target > 0 THEN LEAST(ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2), 100) ELSE 0 END *
                        COALESCE((ec.emp_weights->>'new_customers_weight_percent')::numeric, 10) / 100), 2)
                ELSE NULL END AS overall_achievement_score
        FROM employee_calc ec
    ), kpi_json AS (
        SELECT ewk.employee_id,
            jsonb_build_object(
                'sales', jsonb_build_object('target', ewk.sales_target, 'actual', ewk.effective_sales, 'pct', ewk.sales_achievement_pct),
                'visits', jsonb_build_object('target', ewk.visits_target, 'actual', ewk.visits_actual, 'pct', ewk.visits_achievement_pct),
                'orders', jsonb_build_object('target', ewk.orders_target, 'actual', ewk.effective_orders, 'pct', ewk.orders_achievement_pct),
                'new_customers', jsonb_build_object('target', ewk.new_customers_target, 'actual', ewk.new_customers_actual, 'pct', ewk.new_customers_achievement_pct),
                'collections', jsonb_build_object('target', ewk.collections_target, 'actual', ewk.collections_actual, 'pct', ewk.collections_achievement_pct),
                'attendance', jsonb_build_object('target', ewk.attendance_target, 'actual', ewk.attendance_actual, 'pct', ewk.attendance_achievement_pct)
            ) AS kpis
        FROM employee_with_kpis ewk
    ), team_managers AS (
        SELECT DISTINCT ewk.employee_id, ewk.employee_code, ewk.employee_name,
            ewk.overall_achievement_score
        FROM employee_with_kpis ewk
        WHERE EXISTS (
            SELECT 1 FROM employee_with_kpis sub
            WHERE sub.manager_id = ewk.employee_id
        )
    ), team_raw AS (
        SELECT
            tm.employee_id AS mgr_id, tm.employee_code AS mgr_code, tm.employee_name AS mgr_name,
            tm.overall_achievement_score AS mgr_overall,
            ewk.employee_id, ewk.employee_code, ewk.employee_name, ewk.manager_id,
            ewk.sales_target, ewk.visits_target, ewk.orders_target, ewk.new_customers_target,
            ewk.collections_target, ewk.attendance_target,
            ewk.effective_sales, ewk.visits_actual, ewk.effective_orders, ewk.new_customers_actual,
            ewk.collections_actual, ewk.attendance_actual,
            ewk.sales_achievement_pct, ewk.visits_achievement_pct, ewk.orders_achievement_pct,
            ewk.new_customers_achievement_pct, ewk.collections_achievement_pct, ewk.attendance_achievement_pct,
            ewk.overall_achievement_score,
            ewk.has_target, ewk.has_activity, ewk.is_locked, ewk.emp_weights,
            kj.kpis
        FROM team_managers tm
        JOIN employee_with_kpis ewk ON ewk.employee_id = tm.employee_id
        JOIN kpi_json kj ON kj.employee_id = ewk.employee_id
        UNION ALL
        SELECT
            tm.employee_id AS mgr_id, tm.employee_code AS mgr_code, tm.employee_name AS mgr_name,
            tm.overall_achievement_score AS mgr_overall,
            ewk.employee_id, ewk.employee_code, ewk.employee_name, ewk.manager_id,
            ewk.sales_target, ewk.visits_target, ewk.orders_target, ewk.new_customers_target,
            ewk.collections_target, ewk.attendance_target,
            ewk.effective_sales, ewk.visits_actual, ewk.effective_orders, ewk.new_customers_actual,
            ewk.collections_actual, ewk.attendance_actual,
            ewk.sales_achievement_pct, ewk.visits_achievement_pct, ewk.orders_achievement_pct,
            ewk.new_customers_achievement_pct, ewk.collections_achievement_pct, ewk.attendance_achievement_pct,
            ewk.overall_achievement_score,
            ewk.has_target, ewk.has_activity, ewk.is_locked, ewk.emp_weights,
            kj.kpis
        FROM team_managers tm
        JOIN employee_with_kpis ewk ON ewk.manager_id = tm.employee_id AND ewk.employee_id != tm.employee_id
        JOIN kpi_json kj ON kj.employee_id = ewk.employee_id
    ), team_agg AS (
        SELECT
            mgr_id, mgr_code, mgr_name, mgr_overall,
            COUNT(*) AS member_count,
            SUM(sales_target) AS sum_sales_target, SUM(visits_target) AS sum_visits_target,
            SUM(orders_target) AS sum_orders_target, SUM(new_customers_target) AS sum_new_cust_target,
            SUM(collections_target) AS sum_coll_target, SUM(attendance_target) AS sum_attend_target,
            SUM(effective_sales) AS sum_sales_actual, SUM(visits_actual) AS sum_visits_actual,
            SUM(effective_orders) AS sum_orders_actual, SUM(new_customers_actual) AS sum_new_cust_actual,
            SUM(collections_actual) AS sum_coll_actual, SUM(attendance_actual) AS sum_attend_actual,
            jsonb_agg(
                jsonb_build_object(
                    'employee_id', employee_id, 'employee_code', employee_code, 'employee_name', employee_name,
                    'is_manager', employee_id = mgr_id,
                    'has_target', has_target, 'has_activity', has_activity, 'is_locked', is_locked,
                    'overall_achievement_score', overall_achievement_score,
                    'weights', emp_weights,
                    'kpis', kpis
                ) ORDER BY (CASE WHEN employee_id = mgr_id THEN 0 ELSE 1 END), overall_achievement_score DESC NULLS LAST, employee_name ASC
            ) AS members
        FROM team_raw
        GROUP BY mgr_id, mgr_code, mgr_name, mgr_overall
    ), hierarchy_data AS (
        SELECT jsonb_build_object(
            'manager_count', (SELECT COUNT(*) FROM team_managers),
            'managers', COALESCE(
                (SELECT jsonb_agg(
                    jsonb_build_object(
                        'manager_id', ta.mgr_id,
                        'manager_code', ta.mgr_code,
                        'manager_name', ta.mgr_name,
                        'own_overall_score', ta.mgr_overall,
                        'own_kpis', (SELECT kj.kpis FROM kpi_json kj WHERE kj.employee_id = ta.mgr_id),
                        'team_summary', jsonb_build_object(
                            'team_target', jsonb_build_object(
                                'sales', ta.sum_sales_target, 'visits', ta.sum_visits_target,
                                'orders', ta.sum_orders_target, 'new_customers', ta.sum_new_cust_target,
                                'collections', ta.sum_coll_target, 'attendance', ta.sum_attend_target
                            ),
                            'team_actual', jsonb_build_object(
                                'sales', ta.sum_sales_actual, 'visits', ta.sum_visits_actual,
                                'orders', ta.sum_orders_actual, 'new_customers', ta.sum_new_cust_actual,
                                'collections', ta.sum_coll_actual, 'attendance', ta.sum_attend_actual
                            ),
                            'team_achievement_pct', jsonb_build_object(
                                'sales', CASE WHEN ta.sum_sales_target > 0 THEN LEAST(ROUND((ta.sum_sales_actual / ta.sum_sales_target * 100)::numeric, 2), 100) ELSE NULL END,
                                'visits', CASE WHEN ta.sum_visits_target > 0 THEN LEAST(ROUND((ta.sum_visits_actual::numeric / ta.sum_visits_target * 100)::numeric, 2), 100) ELSE NULL END,
                                'orders', CASE WHEN ta.sum_orders_target > 0 THEN LEAST(ROUND((ta.sum_orders_actual::numeric / ta.sum_orders_target * 100)::numeric, 2), 100) ELSE NULL END,
                                'new_customers', CASE WHEN ta.sum_new_cust_target > 0 THEN LEAST(ROUND((ta.sum_new_cust_actual::numeric / ta.sum_new_cust_target * 100)::numeric, 2), 100) ELSE NULL END,
                                'collections', CASE WHEN ta.sum_coll_target > 0 THEN LEAST(ROUND((ta.sum_coll_actual / ta.sum_coll_target * 100)::numeric, 2), 100) ELSE NULL END,
                                'attendance', NULL::numeric
                            ),
                            'team_overall_pct', ROUND(
                                COALESCE(CASE WHEN ta.sum_sales_target > 0 THEN LEAST(ROUND((ta.sum_sales_actual / ta.sum_sales_target * 100)::numeric, 2), 100) ELSE 0 END * v_comp_sales_weight / 100, 0) +
                                COALESCE(CASE WHEN ta.sum_visits_target > 0 THEN LEAST(ROUND((ta.sum_visits_actual::numeric / ta.sum_visits_target * 100)::numeric, 2), 100) ELSE 0 END * v_comp_visits_weight / 100, 0) +
                                COALESCE(CASE WHEN ta.sum_orders_target > 0 THEN LEAST(ROUND((ta.sum_orders_actual::numeric / ta.sum_orders_target * 100)::numeric, 2), 100) ELSE 0 END * v_comp_orders_weight / 100, 0) +
                                COALESCE(CASE WHEN ta.sum_new_cust_target > 0 THEN LEAST(ROUND((ta.sum_new_cust_actual::numeric / ta.sum_new_cust_target * 100)::numeric, 2), 100) ELSE 0 END * v_comp_new_customers_weight / 100, 0),
                            2),
                            'team_member_count', ta.member_count
                        ),
                        'members', ta.members
                    ) ORDER BY ROUND(
                        COALESCE(CASE WHEN ta.sum_sales_target > 0 THEN LEAST(ROUND((ta.sum_sales_actual / ta.sum_sales_target * 100)::numeric, 2), 100) ELSE 0 END * v_comp_sales_weight / 100, 0) +
                        COALESCE(CASE WHEN ta.sum_visits_target > 0 THEN LEAST(ROUND((ta.sum_visits_actual::numeric / ta.sum_visits_target * 100)::numeric, 2), 100) ELSE 0 END * v_comp_visits_weight / 100, 0) +
                        COALESCE(CASE WHEN ta.sum_orders_target > 0 THEN LEAST(ROUND((ta.sum_orders_actual::numeric / ta.sum_orders_target * 100)::numeric, 2), 100) ELSE 0 END * v_comp_orders_weight / 100, 0) +
                        COALESCE(CASE WHEN ta.sum_new_cust_target > 0 THEN LEAST(ROUND((ta.sum_new_cust_actual::numeric / ta.sum_new_cust_target * 100)::numeric, 2), 100) ELSE 0 END * v_comp_new_customers_weight / 100, 0),
                    2) DESC NULLS LAST, ta.mgr_name ASC
                ) FROM team_agg ta),
                '[]'::jsonb
            ),
            'unassigned_count', (SELECT COUNT(*) FROM employee_with_kpis ewk
                WHERE ewk.manager_id IS NULL
                   OR NOT EXISTS (SELECT 1 FROM employee_with_kpis sub WHERE sub.employee_id = ewk.manager_id)
            ),
            'unassigned', COALESCE(
                (SELECT jsonb_agg(
                    jsonb_build_object(
                        'employee_id', ewk.employee_id, 'employee_code', ewk.employee_code, 'employee_name', ewk.employee_name,
                        'is_manager', false,
                        'has_target', ewk.has_target, 'has_activity', ewk.has_activity, 'is_locked', ewk.is_locked,
                        'overall_achievement_score', ewk.overall_achievement_score,
                        'weights', ewk.emp_weights,
                        'kpis', kj.kpis
                    ) ORDER BY ewk.overall_achievement_score DESC NULLS LAST, ewk.employee_name ASC
                ) FROM employee_with_kpis ewk
                JOIN kpi_json kj ON kj.employee_id = ewk.employee_id
                WHERE ewk.manager_id IS NULL
                   OR NOT EXISTS (SELECT 1 FROM employee_with_kpis sub WHERE sub.employee_id = ewk.manager_id)),
                '[]'::jsonb
            )
            ) AS h_json
    ), final_result AS (
        SELECT
            COALESCE(
                (SELECT jsonb_agg(jsonb_build_object(
                    'employee_id', ec.employee_id, 'employee_code', ec.employee_code, 'employee_name', ec.employee_name,
                    'sales_target', ec.sales_target, 'visits_target', ec.visits_target, 'orders_target', ec.orders_target,
                    'new_customers_target', ec.new_customers_target,
                    'gross_sales', ec.gross_sales, 'visits_actual', ec.visits_actual, 'gross_orders', ec.gross_orders,
                    'new_customers_actual', ec.new_customers_actual,
                    'return_deduction', ec.return_deduction, 'full_returns', ec.full_returns,
                    'effective_sales', ec.effective_sales, 'effective_orders', ec.effective_orders,
                    'has_target', ec.has_target, 'has_activity', ec.has_activity,
                    'sales_achievement_pct', CASE WHEN ec.sales_target > 0
                        THEN LEAST(ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2), 100) ELSE NULL END,
                    'visits_achievement_pct', CASE WHEN ec.visits_target > 0
                        THEN LEAST(ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2), 100) ELSE NULL END,
                    'orders_achievement_pct', CASE WHEN ec.orders_target > 0
                        THEN LEAST(ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2), 100) ELSE NULL END,
                    'new_customers_achievement_pct', CASE WHEN ec.new_customers_target > 0
                        THEN LEAST(ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2), 100) ELSE NULL END,
                    'overall_achievement_score', CASE WHEN ec.has_target AND (ec.sales_target > 0 OR ec.visits_target > 0 OR ec.orders_target > 0 OR ec.new_customers_target > 0)
                        THEN ROUND(
                            (LEAST(CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END, 100) *
                                COALESCE((ec.emp_weights->>'sales_weight_percent')::numeric, 75) / 100) +
                            (LEAST(CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END, 100) *
                                COALESCE((ec.emp_weights->>'visits_weight_percent')::numeric, 7.5) / 100) +
                            (LEAST(CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END, 100) *
                                COALESCE((ec.emp_weights->>'orders_weight_percent')::numeric, 7.5) / 100) +
                            (LEAST(CASE WHEN ec.new_customers_target > 0 THEN ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2) ELSE 0 END, 100) *
                                COALESCE((ec.emp_weights->>'new_customers_weight_percent')::numeric, 10) / 100), 2)
                        ELSE NULL END,
                    'weights', ec.emp_weights,
                    'is_locked', ec.is_locked
                ) ORDER BY
                    CASE WHEN ec.has_target AND (ec.sales_target > 0 OR ec.visits_target > 0 OR ec.orders_target > 0 OR ec.new_customers_target > 0)
                        THEN (LEAST(CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END, 100) *
                                COALESCE((ec.emp_weights->>'sales_weight_percent')::numeric, 75) / 100) +
                             (LEAST(CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END, 100) *
                                COALESCE((ec.emp_weights->>'visits_weight_percent')::numeric, 7.5) / 100) +
                             (LEAST(CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END, 100) *
                                COALESCE((ec.emp_weights->>'orders_weight_percent')::numeric, 7.5) / 100) +
                             (LEAST(CASE WHEN ec.new_customers_target > 0 THEN ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2) ELSE 0 END, 100) *
                                COALESCE((ec.emp_weights->>'new_customers_weight_percent')::numeric, 10) / 100)
                        ELSE NULL
                    END DESC NULLS LAST,
                    ec.employee_name ASC
                ) FROM employee_calc ec),
                '[]'::jsonb
            ) AS emp_perf,
            (SELECT h_json FROM hierarchy_data) AS h_json
    )
    SELECT emp_perf, h_json INTO v_employee_perf, v_hierarchy FROM final_result;

    -- Compute best/worst from jsonb
    IF v_employee_perf IS NOT NULL AND jsonb_array_length(v_employee_perf) > 0 THEN
        SELECT value INTO v_best_employee
        FROM jsonb_array_elements(v_employee_perf) elem
        WHERE (elem->>'overall_achievement_score')::numeric IS NOT NULL
        ORDER BY (elem->>'overall_achievement_score')::numeric DESC
        LIMIT 1;

        SELECT value INTO v_weakest_employee
        FROM jsonb_array_elements(v_employee_perf) elem
        WHERE (elem->>'overall_achievement_score')::numeric IS NOT NULL
        ORDER BY (elem->>'overall_achievement_score')::numeric ASC
        LIMIT 1;
    END IF;

    RETURN jsonb_build_object(
        'has_target', true,
        'company', v_company_info,
        'employees', COALESCE(v_employee_perf, '[]'::jsonb),
        'best_employee', v_best_employee,
        'weakest_employee', v_weakest_employee,
        'hierarchy', COALESCE(v_hierarchy, 'null'::jsonb)
    );
END;
$function$;
