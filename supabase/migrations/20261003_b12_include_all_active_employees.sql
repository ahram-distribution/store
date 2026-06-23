-- ============================================================================
-- B12: INCLUDE ALL ACTIVE EMPLOYEES IN PERFORMANCE RUNTIME
-- DATE: 2026-10-03 (v2: 2026-10-03 - Targets V1: company targets from SUM of
--       employee targets, hard-coded weights, LEAST cap at 100%, no collections)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_target_performance(
    p_token uuid, p_month int DEFAULT NULL, p_year int DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
    v_session app.sessions;
    v_target_month int; v_target_year int;
    v_sales_weight numeric := 75;
    v_visits_weight numeric := 7.5;
    v_orders_weight numeric := 7.5;
    v_new_customers_weight numeric := 10;
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

    -- Company targets = SUM of all active employees' targets (not from company_monthly_targets)
    SELECT
        COALESCE(SUM(et.sales_target), 0),
        COALESCE(SUM(et.visits_target), 0)::int,
        COALESCE(SUM(et.orders_target), 0)::int,
        COALESCE(SUM(et.new_customers_target), 0)::int
    INTO v_company_sales_target, v_company_visits_target, v_company_orders_target, v_company_new_customers_target
    FROM public.employee_monthly_targets et
    JOIN public.employees e ON e.id = et.employee_id
    WHERE e.is_active = true
      AND et.target_month = v_target_month
      AND et.target_year = v_target_year;

    v_has_target := (v_company_sales_target > 0 OR v_company_visits_target > 0 OR v_company_orders_target > 0 OR v_company_new_customers_target > 0);
    IF NOT v_has_target THEN
        RETURN jsonb_build_object('has_target', false, 'company', 'null'::jsonb, 'employees', '[]'::jsonb, 'best_employee', 'null'::jsonb, 'weakest_employee', 'null'::jsonb);
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

    -- Overall weighted score (cap already applied per KPI)
    v_company_overall := ROUND((v_company_sales_pct * v_sales_weight / 100) + (v_company_visits_pct * v_visits_weight / 100) + (v_company_orders_pct * v_orders_weight / 100) + (v_company_new_customers_pct * v_new_customers_weight / 100), 2);

    v_company_info := jsonb_build_object(
        'sales_target', v_company_sales_target, 'visits_target', v_company_visits_target,
        'orders_target', v_company_orders_target, 'new_customers_target', v_company_new_customers_target,
        'sales_actual', v_company_effective_sales, 'visits_actual', v_company_completed_visits,
        'orders_actual', v_company_effective_orders, 'new_customers_actual', v_company_new_customers,
        'return_deductions', v_company_return_deductions, 'full_returns', v_company_full_returns,
        'sales_weight_percent', v_sales_weight, 'visits_weight_percent', v_visits_weight,
        'orders_weight_percent', v_orders_weight, 'new_customers_weight_percent', v_new_customers_weight,
        'sales_achievement_pct', v_company_sales_pct, 'visits_achievement_pct', v_company_visits_pct,
        'orders_achievement_pct', v_company_orders_pct, 'new_customers_achievement_pct', v_company_new_customers_pct,
        'overall_achievement_pct', v_company_overall
    );

    -- --------------------------------------------------------------------------
    -- Employee performance: ALL active employees with LEFT JOIN to targets
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
    ), employee_calc AS (
        SELECT e.id AS employee_id, e.code AS employee_code, e.full_name AS employee_name,
            COALESCE(et.sales_target, 0) AS sales_target,
            COALESCE(et.visits_target, 0) AS visits_target,
            COALESCE(et.orders_target, 0) AS orders_target,
            COALESCE(et.new_customers_target, 0) AS new_customers_target,
            COALESCE(s.sales_actual, 0) AS gross_sales,
            COALESCE(v.visits_actual, 0) AS visits_actual,
            COALESCE(s.orders_actual, 0) AS gross_orders,
            COALESCE(nc.new_customers_actual, 0) AS new_customers_actual,
            COALESCE(rd.return_deduction, 0) AS return_deduction,
            COALESCE(rd.full_returns, 0) AS full_returns,
            GREATEST(COALESCE(s.sales_actual, 0) - COALESCE(rd.return_deduction, 0), 0) AS effective_sales,
            GREATEST(COALESCE(s.orders_actual, 0) - COALESCE(rd.full_returns, 0), 0) AS effective_orders,
            CASE WHEN et.id IS NOT NULL THEN et.is_locked ELSE NULL END AS is_locked,
            et.id IS NOT NULL AS has_target,
            (COALESCE(s.sales_actual, 0) > 0 OR COALESCE(v.visits_actual, 0) > 0
             OR COALESCE(s.orders_actual, 0) > 0 OR COALESCE(nc.new_customers_actual, 0) > 0) AS has_activity
        FROM public.employees e
        LEFT JOIN public.employee_monthly_targets et
            ON et.employee_id = e.id AND et.target_month = v_target_month AND et.target_year = v_target_year
        LEFT JOIN employee_sales s ON s.employee_id = e.id
        LEFT JOIN employee_visits v ON v.employee_id = e.id
        LEFT JOIN employee_new_customers nc ON nc.employee_id = e.id
        LEFT JOIN employee_returns rd ON rd.employee_id = e.id
        WHERE e.is_active = true AND e.id = ANY(v_visible_ids)
    )
    SELECT jsonb_agg(jsonb_build_object(
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
                (LEAST(CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END, 100) * v_sales_weight / 100) +
                (LEAST(CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END, 100) * v_visits_weight / 100) +
                (LEAST(CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END, 100) * v_orders_weight / 100) +
                (LEAST(CASE WHEN ec.new_customers_target > 0 THEN ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2) ELSE 0 END, 100) * v_new_customers_weight / 100), 2)
            ELSE NULL END,
        'weights', jsonb_build_object(
            'sales_weight_percent', v_sales_weight, 'visits_weight_percent', v_visits_weight,
            'orders_weight_percent', v_orders_weight, 'new_customers_weight_percent', v_new_customers_weight,
            'source', 'hardcoded_v1'
        ),
        'is_locked', ec.is_locked
    ) ORDER BY
        CASE WHEN ec.has_target AND (ec.sales_target > 0 OR ec.visits_target > 0 OR ec.orders_target > 0 OR ec.new_customers_target > 0)
            THEN (LEAST(CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END, 100) * v_sales_weight / 100) +
                 (LEAST(CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END, 100) * v_visits_weight / 100) +
                 (LEAST(CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END, 100) * v_orders_weight / 100) +
                 (LEAST(CASE WHEN ec.new_customers_target > 0 THEN ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2) ELSE 0 END, 100) * v_new_customers_weight / 100)
            ELSE NULL
        END DESC NULLS LAST,
        ec.employee_name ASC
    ) INTO v_employee_perf FROM employee_calc ec;

    -- Compute best/worst from jsonb (filters out NULL-score employees without targets)
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
        'weakest_employee', v_weakest_employee
    );
END;
$function$;
