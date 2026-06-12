-- ============================================================================
-- Monthly Targets System
-- Tables: company_monthly_targets, employee_monthly_targets
-- RPCs (6): CRUD + performance + dashboard update
-- ============================================================================

-- 1. company_monthly_targets --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_monthly_targets (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    target_month int NOT NULL,
    target_year int NOT NULL,
    sales_target numeric NOT NULL DEFAULT 0,
    visits_target numeric NOT NULL DEFAULT 0,
    orders_target numeric NOT NULL DEFAULT 0,
    sales_weight_percent numeric NOT NULL DEFAULT 60,
    visits_weight_percent numeric NOT NULL DEFAULT 20,
    orders_weight_percent numeric NOT NULL DEFAULT 20,
    is_locked boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT company_monthly_targets_pkey PRIMARY KEY (id),
    CONSTRAINT company_monthly_targets_month_year_key UNIQUE (target_month, target_year)
);

CREATE INDEX IF NOT EXISTS idx_company_monthly_targets_month_year
    ON public.company_monthly_targets (target_month, target_year);

COMMENT ON TABLE public.company_monthly_targets IS 'الأهداف الشهرية للشركة';
COMMENT ON COLUMN public.company_monthly_targets.is_locked IS 'يمنع التعديل بعد إغلاق الشهر';

-- 2. employee_monthly_targets -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_monthly_targets (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    target_month int NOT NULL,
    target_year int NOT NULL,
    sales_target numeric NOT NULL DEFAULT 0,
    visits_target numeric NOT NULL DEFAULT 0,
    orders_target numeric NOT NULL DEFAULT 0,
    is_locked boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT employee_monthly_targets_pkey PRIMARY KEY (id),
    CONSTRAINT employee_monthly_targets_emp_month_year_key UNIQUE (employee_id, target_month, target_year)
);

DO $$ BEGIN
    ALTER TABLE public.employee_monthly_targets
        ADD CONSTRAINT employee_monthly_targets_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_monthly_targets_employee
    ON public.employee_monthly_targets (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_monthly_targets_month_year
    ON public.employee_monthly_targets (target_month, target_year);

COMMENT ON TABLE public.employee_monthly_targets IS 'الأهداف الشهرية للموظفين';
COMMENT ON COLUMN public.employee_monthly_targets.is_locked IS 'يمنع التعديل بعد إغلاق الشهر';

-- 3. RPC: get_governed_company_monthly_target ---------------------------------
CREATE OR REPLACE FUNCTION public.get_governed_company_monthly_target(
    p_token uuid,
    p_month int DEFAULT NULL,
    p_year int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_is_upper boolean;
    v_target_month int;
    v_target_year int;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
    ) INTO v_is_upper;

    IF NOT v_is_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);

    SELECT jsonb_build_object(
        'id', t.id,
        'target_month', t.target_month,
        'target_year', t.target_year,
        'sales_target', t.sales_target,
        'visits_target', t.visits_target,
        'orders_target', t.orders_target,
        'sales_weight_percent', t.sales_weight_percent,
        'visits_weight_percent', t.visits_weight_percent,
        'orders_weight_percent', t.orders_weight_percent,
        'is_locked', t.is_locked
    ) INTO v_result
    FROM public.company_monthly_targets t
    WHERE t.target_month = v_target_month AND t.target_year = v_target_year;

    RETURN COALESCE(v_result, 'null'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_company_monthly_target IS 'الحصول على هدف الشركة الشهري';

-- 4. RPC: governed_upsert_company_monthly_target ------------------------------
CREATE OR REPLACE FUNCTION public.governed_upsert_company_monthly_target(
    p_token uuid,
    p_target_month int,
    p_target_year int,
    p_sales_target numeric DEFAULT 0,
    p_visits_target numeric DEFAULT 0,
    p_orders_target numeric DEFAULT 0,
    p_sales_weight_percent numeric DEFAULT 60,
    p_visits_weight_percent numeric DEFAULT 20,
    p_orders_weight_percent numeric DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_is_upper boolean;
    v_existing_locked boolean;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
    ) INTO v_is_upper;

    IF NOT v_is_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    -- Check if locked
    SELECT is_locked INTO v_existing_locked
    FROM public.company_monthly_targets
    WHERE target_month = p_target_month AND target_year = p_target_year;

    IF v_existing_locked THEN
        RETURN jsonb_build_object('error', 'LOCKED', 'detail', 'لا يمكن تعديل هدف شهر مغلق');
    END IF;

    INSERT INTO public.company_monthly_targets
        (target_month, target_year, sales_target, visits_target, orders_target,
         sales_weight_percent, visits_weight_percent, orders_weight_percent)
    VALUES
        (p_target_month, p_target_year, p_sales_target, p_visits_target, p_orders_target,
         p_sales_weight_percent, p_visits_weight_percent, p_orders_weight_percent)
    ON CONFLICT (target_month, target_year)
    DO UPDATE SET
        sales_target = EXCLUDED.sales_target,
        visits_target = EXCLUDED.visits_target,
        orders_target = EXCLUDED.orders_target,
        sales_weight_percent = EXCLUDED.sales_weight_percent,
        visits_weight_percent = EXCLUDED.visits_weight_percent,
        orders_weight_percent = EXCLUDED.orders_weight_percent,
        updated_at = now()
    RETURNING jsonb_build_object(
        'id', id,
        'target_month', target_month,
        'target_year', target_year,
        'sales_target', sales_target,
        'visits_target', visits_target,
        'orders_target', orders_target,
        'sales_weight_percent', sales_weight_percent,
        'visits_weight_percent', visits_weight_percent,
        'orders_weight_percent', orders_weight_percent,
        'is_locked', is_locked
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.governed_upsert_company_monthly_target IS 'إنشاء أو تحديث هدف الشركة الشهري';

-- 5. RPC: get_governed_employee_monthly_targets -------------------------------
CREATE OR REPLACE FUNCTION public.get_governed_employee_monthly_targets(
    p_token uuid,
    p_month int DEFAULT NULL,
    p_year int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_is_upper boolean;
    v_target_month int;
    v_target_year int;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
    ) INTO v_is_upper;

    IF NOT v_is_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);

    SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'employee_id', t.employee_id,
        'employee_code', e.code,
        'employee_name', e.full_name,
        'target_month', t.target_month,
        'target_year', t.target_year,
        'sales_target', t.sales_target,
        'visits_target', t.visits_target,
        'orders_target', t.orders_target,
        'is_locked', t.is_locked
    ) ORDER BY e.full_name) INTO v_result
    FROM public.employee_monthly_targets t
    JOIN public.employees e ON e.id = t.employee_id
    WHERE t.target_month = v_target_month AND t.target_year = v_target_year;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_employee_monthly_targets IS 'الحصول على أهداف الموظفين الشهرية';

-- 6. RPC: governed_upsert_employee_monthly_target -----------------------------
CREATE OR REPLACE FUNCTION public.governed_upsert_employee_monthly_target(
    p_token uuid,
    p_employee_id uuid,
    p_target_month int,
    p_target_year int,
    p_sales_target numeric DEFAULT 0,
    p_visits_target numeric DEFAULT 0,
    p_orders_target numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_is_upper boolean;
    v_existing_locked boolean;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
    ) INTO v_is_upper;

    IF NOT v_is_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    -- Check if locked
    SELECT is_locked INTO v_existing_locked
    FROM public.employee_monthly_targets
    WHERE employee_id = p_employee_id AND target_month = p_target_month AND target_year = p_target_year;

    IF v_existing_locked THEN
        RETURN jsonb_build_object('error', 'LOCKED', 'detail', 'لا يمكن تعديل هدف شهر مغلق');
    END IF;

    INSERT INTO public.employee_monthly_targets
        (employee_id, target_month, target_year, sales_target, visits_target, orders_target)
    VALUES
        (p_employee_id, p_target_month, p_target_year, p_sales_target, p_visits_target, p_orders_target)
    ON CONFLICT (employee_id, target_month, target_year)
    DO UPDATE SET
        sales_target = EXCLUDED.sales_target,
        visits_target = EXCLUDED.visits_target,
        orders_target = EXCLUDED.orders_target,
        updated_at = now()
    RETURNING jsonb_build_object(
        'id', id,
        'employee_id', employee_id,
        'target_month', target_month,
        'target_year', target_year,
        'sales_target', sales_target,
        'visits_target', visits_target,
        'orders_target', orders_target,
        'is_locked', is_locked
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.governed_upsert_employee_monthly_target IS 'إنشاء أو تحديث هدف موظف شهري';

-- 7. RPC: get_governed_target_performance -------------------------------------
CREATE OR REPLACE FUNCTION public.get_governed_target_performance(
    p_token uuid,
    p_month int DEFAULT NULL,
    p_year int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_is_upper boolean;
    v_target_month int;
    v_target_year int;
    v_company_target public.company_monthly_targets;
    v_sales_weight numeric;
    v_visits_weight numeric;
    v_orders_weight numeric;
    v_company_delivered_sales numeric;
    v_company_completed_visits int;
    v_company_delivered_orders int;
    v_company_return_deductions numeric;
    v_company_full_returns int;
    v_company_effective_sales numeric;
    v_company_effective_orders int;
    v_company_sales_pct numeric;
    v_company_visits_pct numeric;
    v_company_orders_pct numeric;
    v_company_overall numeric;
    v_employee_perf jsonb;
    v_best_employee jsonb;
    v_weakest_employee jsonb;
    v_company_info jsonb;
    v_month_start timestamptz;
    v_month_end timestamptz;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
    ) INTO v_is_upper;

    IF NOT v_is_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
    v_month_start := date_trunc('month', to_timestamp(v_target_year || '-' || v_target_month || '-01', 'YYYY-MM-DD'));
    v_month_end := v_month_start + INTERVAL '1 month';

    -- Get company target
    SELECT * INTO v_company_target
    FROM public.company_monthly_targets
    WHERE target_month = v_target_month AND target_year = v_target_year;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'has_target', false,
            'company', 'null'::jsonb,
            'employees', '[]'::jsonb,
            'best_employee', 'null'::jsonb,
            'weakest_employee', 'null'::jsonb
        );
    END IF;

    v_sales_weight := v_company_target.sales_weight_percent;
    v_visits_weight := v_company_target.visits_weight_percent;
    v_orders_weight := v_company_target.orders_weight_percent;

    -- Company delivered sales this month
    SELECT COALESCE(SUM(o.total_amount), 0)
    INTO v_company_delivered_sales
    FROM public.orders o
    WHERE o.status = 'delivered'
        AND o.delivered_at >= v_month_start
        AND o.delivered_at < v_month_end;

    -- Company completed visits this month
    SELECT COUNT(*)::int
    INTO v_company_completed_visits
    FROM public.visits v
    WHERE v.status = 'completed'
        AND v.check_out_at >= v_month_start
        AND v.check_out_at < v_month_end;

    -- Company delivered orders this month
    SELECT COUNT(*)::int
    INTO v_company_delivered_orders
    FROM public.orders o
    WHERE o.status = 'delivered'
        AND o.delivered_at >= v_month_start
        AND o.delivered_at < v_month_end;

    -- Company return deductions this month
    SELECT COALESCE(SUM(r.credit_note_amount), 0),
           COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int
    INTO v_company_return_deductions, v_company_full_returns
    FROM public.returns r
    LEFT JOIN (
        SELECT r2.order_id
        FROM public.returns r2
        JOIN public.return_items ri ON ri.return_id = r2.id
        JOIN public.products p ON p.id = ri.product_id
        JOIN (
            SELECT oi.order_id, SUM(oi.piece_quantity) AS total_pieces
            FROM public.order_items oi
            GROUP BY oi.order_id
        ) oi ON oi.order_id = r2.order_id
        WHERE r2.status = 'approved'
            AND r2.created_at >= v_month_start
            AND r2.created_at < v_month_end
        GROUP BY r2.order_id, oi.total_pieces
        HAVING SUM(
            CASE
                WHEN ri.unit_type = 'piece' THEN ri.quantity
                WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12
                WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity
            END
        ) >= oi.total_pieces
    ) fr ON fr.order_id = r.order_id
    WHERE r.status = 'approved'
        AND r.created_at >= v_month_start
        AND r.created_at < v_month_end;

    -- Effective company achievement
    v_company_effective_sales := GREATEST(v_company_delivered_sales - v_company_return_deductions, 0);
    v_company_effective_orders := GREATEST(v_company_delivered_orders - v_company_full_returns, 0);

    -- Company achievement percentages
    v_company_sales_pct := CASE WHEN v_company_target.sales_target > 0
        THEN ROUND((v_company_effective_sales / v_company_target.sales_target * 100)::numeric, 2)
        ELSE 0 END;
    v_company_visits_pct := CASE WHEN v_company_target.visits_target > 0
        THEN ROUND((v_company_completed_visits::numeric / v_company_target.visits_target * 100)::numeric, 2)
        ELSE 0 END;
    v_company_orders_pct := CASE WHEN v_company_target.orders_target > 0
        THEN ROUND((v_company_effective_orders::numeric / v_company_target.orders_target * 100)::numeric, 2)
        ELSE 0 END;

    v_company_overall := ROUND(
        (v_company_sales_pct * v_sales_weight / 100) +
        (v_company_visits_pct * v_visits_weight / 100) +
        (v_company_orders_pct * v_orders_weight / 100), 2
    );

    -- Build company info
    v_company_info := jsonb_build_object(
        'sales_target', v_company_target.sales_target,
        'visits_target', v_company_target.visits_target,
        'orders_target', v_company_target.orders_target,
        'sales_actual', v_company_effective_sales,
        'visits_actual', v_company_completed_visits,
        'orders_actual', v_company_effective_orders,
        'return_deductions', v_company_return_deductions,
        'full_returns', v_company_full_returns,
        'sales_weight_percent', v_sales_weight,
        'visits_weight_percent', v_visits_weight,
        'orders_weight_percent', v_orders_weight,
        'sales_achievement_pct', v_company_sales_pct,
        'visits_achievement_pct', v_company_visits_pct,
        'orders_achievement_pct', v_company_orders_pct,
        'overall_achievement_pct', v_company_overall,
        'is_locked', v_company_target.is_locked
    );

    -- Employee performance
    WITH employee_orders AS (
        SELECT
            COALESCE(emp.id, emp2.id) AS employee_id,
            o.total_amount,
            o.id AS order_id
        FROM public.orders o
        LEFT JOIN public.employees emp ON o.owner_id = emp.id
        LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
        WHERE o.status = 'delivered'
            AND o.delivered_at >= v_month_start
            AND o.delivered_at < v_month_end
    ),
    employee_sales AS (
        SELECT employee_id,
            COALESCE(SUM(total_amount), 0) AS sales_actual,
            COUNT(DISTINCT order_id)::int AS orders_actual
        FROM employee_orders
        GROUP BY employee_id
    ),
    employee_visits AS (
        SELECT v.employee_id,
            COUNT(*)::int AS visits_actual
        FROM public.visits v
        WHERE v.status = 'completed'
            AND v.check_out_at >= v_month_start
            AND v.check_out_at < v_month_end
        GROUP BY v.employee_id
    ),
    employee_returns AS (
        SELECT
            COALESCE(emp.id, emp2.id) AS employee_id,
            COALESCE(SUM(r.credit_note_amount), 0) AS return_deduction,
            COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int AS full_returns
        FROM public.returns r
        JOIN public.orders o ON o.id = r.order_id
        LEFT JOIN public.employees emp ON o.owner_id = emp.id
        LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
        LEFT JOIN (
            SELECT r3.order_id
            FROM public.returns r3
            JOIN public.return_items ri ON ri.return_id = r3.id
            JOIN public.products p ON p.id = ri.product_id
            JOIN (
                SELECT oi2.order_id, SUM(oi2.piece_quantity) AS total_pieces
                FROM public.order_items oi2
                GROUP BY oi2.order_id
            ) oi3 ON oi3.order_id = r3.order_id
            WHERE r3.status = 'approved'
                AND r3.created_at >= v_month_start
                AND r3.created_at < v_month_end
            GROUP BY r3.order_id, oi3.total_pieces
            HAVING SUM(
                CASE
                    WHEN ri.unit_type = 'piece' THEN ri.quantity
                    WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12
                    WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity
                END
            ) >= oi3.total_pieces
        ) fr ON fr.order_id = r.order_id
        WHERE r.status = 'approved'
            AND r.created_at >= v_month_start
            AND r.created_at < v_month_end
        GROUP BY COALESCE(emp.id, emp2.id)
    ),
    employee_calc AS (
        SELECT
            et.employee_id,
            e.code AS employee_code,
            e.full_name AS employee_name,
            et.sales_target,
            et.visits_target,
            et.orders_target,
            COALESCE(s.sales_actual, 0) AS gross_sales,
            COALESCE(v.visits_actual, 0) AS visits_actual,
            COALESCE(s.orders_actual, 0) AS gross_orders,
            COALESCE(rd.return_deduction, 0) AS return_deduction,
            COALESCE(rd.full_returns, 0) AS full_returns,
            GREATEST(COALESCE(s.sales_actual, 0) - COALESCE(rd.return_deduction, 0), 0) AS effective_sales,
            GREATEST(COALESCE(s.orders_actual, 0) - COALESCE(rd.full_returns, 0), 0) AS effective_orders,
            et.is_locked
        FROM public.employee_monthly_targets et
        JOIN public.employees e ON e.id = et.employee_id
        LEFT JOIN employee_sales s ON s.employee_id = et.employee_id
        LEFT JOIN employee_visits v ON v.employee_id = et.employee_id
        LEFT JOIN employee_returns rd ON rd.employee_id = et.employee_id
        WHERE et.target_month = v_target_month AND et.target_year = v_target_year
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'employee_id', ec.employee_id,
            'employee_code', ec.employee_code,
            'employee_name', ec.employee_name,
            'sales_target', ec.sales_target,
            'visits_target', ec.visits_target,
            'orders_target', ec.orders_target,
            'gross_sales', ec.gross_sales,
            'visits_actual', ec.visits_actual,
            'gross_orders', ec.gross_orders,
            'return_deduction', ec.return_deduction,
            'full_returns', ec.full_returns,
            'effective_sales', ec.effective_sales,
            'effective_orders', ec.effective_orders,
            'sales_achievement_pct', CASE WHEN ec.sales_target > 0
                THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2)
                ELSE 0 END,
            'visits_achievement_pct', CASE WHEN ec.visits_target > 0
                THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2)
                ELSE 0 END,
            'orders_achievement_pct', CASE WHEN ec.orders_target > 0
                THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2)
                ELSE 0 END,
            'overall_achievement_score', ROUND(
                (CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END * v_sales_weight / 100) +
                (CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END * v_visits_weight / 100) +
                (CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END * v_orders_weight / 100)
            , 2),
            'is_locked', ec.is_locked
        )
        ORDER BY
            (CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END * v_sales_weight / 100) +
            (CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END * v_visits_weight / 100) +
            (CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END * v_orders_weight / 100) DESC
    ) INTO v_employee_perf
    FROM employee_calc ec;

    -- Extract best (first) and weakest (last) from ordered array
    IF jsonb_array_length(v_employee_perf) > 0 THEN
        v_best_employee := v_employee_perf->0;
        v_weakest_employee := v_employee_perf->(jsonb_array_length(v_employee_perf) - 1);
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

COMMENT ON FUNCTION public.get_governed_target_performance IS 'أداء الأهداف الشهرية للموظفين والشركة';

-- 8. Update get_upper_management_dashboard with target KPIs -------------------
CREATE OR REPLACE FUNCTION public.get_upper_management_dashboard(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_is_upper boolean;
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
  -- Target variables
  v_company_target public.company_monthly_targets;
  v_target_month int;
  v_target_year int;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_delivered_sales numeric;
  v_completed_visits int;
  v_delivered_orders int;
  v_return_deductions numeric;
  v_full_returns int;
  v_effective_sales numeric;
  v_effective_orders int;
  v_sales_pct numeric;
  v_visits_pct numeric;
  v_orders_pct numeric;
  v_overall numeric;
  v_employee_perf jsonb;
  v_best_target_employee jsonb;
  v_weakest_target_employee jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = v_session.employee_id
    AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
  ) INTO v_is_upper;

  IF NOT v_is_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Upper management only'); END IF;

  -- Existing KPIs
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
  ORDER BY COALESCE(SUM(o.total_amount), 0) DESC
  LIMIT 1;

  SELECT jsonb_build_object('id', e.id, 'code', e.code, 'name', e.full_name, 'total_sales', COALESCE(SUM(o.total_amount), 0))
  INTO v_weakest_rep
  FROM public.employees e
  JOIN public.orders o ON o.owner_id IN (e.id, e.identity_id)
  WHERE o.status NOT IN ('draft', 'cancelled')
    AND o.submitted_at >= date_trunc('month', CURRENT_DATE)
  GROUP BY e.id, e.code, e.full_name
  ORDER BY COALESCE(SUM(o.total_amount), 0) ASC
  LIMIT 1;

  -- Target KPIs
  v_target_month := EXTRACT(MONTH FROM CURRENT_DATE)::int;
  v_target_year := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  v_month_start := date_trunc('month', CURRENT_DATE);
  v_month_end := v_month_start + INTERVAL '1 month';

  SELECT * INTO v_company_target
  FROM public.company_monthly_targets
  WHERE target_month = v_target_month AND target_year = v_target_year;

  IF FOUND THEN
    SELECT COALESCE(SUM(o.total_amount), 0) INTO v_delivered_sales
    FROM public.orders o
    WHERE o.status = 'delivered'
        AND o.delivered_at >= v_month_start
        AND o.delivered_at < v_month_end;

    SELECT COUNT(*)::int INTO v_completed_visits
    FROM public.visits v
    WHERE v.status = 'completed'
        AND v.check_out_at >= v_month_start
        AND v.check_out_at < v_month_end;

    SELECT COUNT(*)::int INTO v_delivered_orders
    FROM public.orders o
    WHERE o.status = 'delivered'
        AND o.delivered_at >= v_month_start
        AND o.delivered_at < v_month_end;

    SELECT COALESCE(SUM(r.credit_note_amount), 0),
           COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int
    INTO v_return_deductions, v_full_returns
    FROM public.returns r
    LEFT JOIN (
        SELECT r2.order_id
        FROM public.returns r2
        JOIN public.return_items ri ON ri.return_id = r2.id
        JOIN public.products p ON p.id = ri.product_id
        JOIN (SELECT oi.order_id, SUM(oi.piece_quantity) AS total_pieces FROM public.order_items oi GROUP BY oi.order_id) oi ON oi.order_id = r2.order_id
        WHERE r2.status = 'approved'
            AND r2.created_at >= v_month_start AND r2.created_at < v_month_end
        GROUP BY r2.order_id, oi.total_pieces
        HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi.total_pieces
    ) fr ON fr.order_id = r.order_id
    WHERE r.status = 'approved'
        AND r.created_at >= v_month_start AND r.created_at < v_month_end;

    v_effective_sales := GREATEST(v_delivered_sales - v_return_deductions, 0);
    v_effective_orders := GREATEST(v_delivered_orders - v_full_returns, 0);

    v_sales_pct := CASE WHEN v_company_target.sales_target > 0 THEN ROUND((v_effective_sales / v_company_target.sales_target * 100)::numeric, 2) ELSE 0 END;
    v_visits_pct := CASE WHEN v_company_target.visits_target > 0 THEN ROUND((v_completed_visits::numeric / v_company_target.visits_target * 100)::numeric, 2) ELSE 0 END;
    v_orders_pct := CASE WHEN v_company_target.orders_target > 0 THEN ROUND((v_effective_orders::numeric / v_company_target.orders_target * 100)::numeric, 2) ELSE 0 END;

    v_overall := ROUND(
        (v_sales_pct * v_company_target.sales_weight_percent / 100) +
        (v_visits_pct * v_company_target.visits_weight_percent / 100) +
        (v_orders_pct * v_company_target.orders_weight_percent / 100), 2
    );

    -- Employee performance for best/worst
    WITH employee_orders AS (
        SELECT COALESCE(emp.id, emp2.id) AS employee_id, o.total_amount, o.id AS order_id
        FROM public.orders o
        LEFT JOIN public.employees emp ON o.owner_id = emp.id
        LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
        WHERE o.status = 'delivered'
            AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end
    ),
    employee_sales AS (
        SELECT employee_id, COALESCE(SUM(total_amount), 0) AS sales_actual, COUNT(DISTINCT order_id)::int AS orders_actual
        FROM employee_orders GROUP BY employee_id
    ),
    employee_visits AS (
        SELECT v.employee_id, COUNT(*)::int AS visits_actual
        FROM public.visits v
        WHERE v.status = 'completed' AND v.check_out_at >= v_month_start AND v.check_out_at < v_month_end
        GROUP BY v.employee_id
    ),
    employee_returns AS (
        SELECT COALESCE(emp.id, emp2.id) AS employee_id,
            COALESCE(SUM(r.credit_note_amount), 0) AS return_deduction,
            COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int AS full_returns
        FROM public.returns r
        JOIN public.orders o ON o.id = r.order_id
        LEFT JOIN public.employees emp ON o.owner_id = emp.id
        LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
        LEFT JOIN (
            SELECT r3.order_id
            FROM public.returns r3
            JOIN public.return_items ri ON ri.return_id = r3.id
            JOIN public.products p ON p.id = ri.product_id
            JOIN (SELECT oi2.order_id, SUM(oi2.piece_quantity) AS total_pieces FROM public.order_items oi2 GROUP BY oi2.order_id) oi3 ON oi3.order_id = r3.order_id
            WHERE r3.status = 'approved'
                AND r3.created_at >= v_month_start AND r3.created_at < v_month_end
            GROUP BY r3.order_id, oi3.total_pieces
            HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi3.total_pieces
        ) fr ON fr.order_id = r.order_id
        WHERE r.status = 'approved' AND r.created_at >= v_month_start AND r.created_at < v_month_end
        GROUP BY COALESCE(emp.id, emp2.id)
    ),
    employee_calc AS (
        SELECT et.employee_id, e.code AS employee_code, e.full_name AS employee_name,
            et.sales_target, et.visits_target, et.orders_target,
            COALESCE(s.sales_actual, 0) - COALESCE(rd.return_deduction, 0) AS effective_sales,
            COALESCE(v.visits_actual, 0) AS visits_actual,
            COALESCE(s.orders_actual, 0) - COALESCE(rd.full_returns, 0) AS effective_orders
        FROM public.employee_monthly_targets et
        JOIN public.employees e ON e.id = et.employee_id
        LEFT JOIN employee_sales s ON s.employee_id = et.employee_id
        LEFT JOIN employee_visits v ON v.employee_id = et.employee_id
        LEFT JOIN employee_returns rd ON rd.employee_id = et.employee_id
        WHERE et.target_month = v_target_month AND et.target_year = v_target_year
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'employee_id', ec.employee_id,
            'employee_code', ec.employee_code,
            'employee_name', ec.employee_name,
            'overall_achievement_score', ROUND(
                (CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END * v_company_target.sales_weight_percent / 100) +
                (CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END * v_company_target.visits_weight_percent / 100) +
                (CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END * v_company_target.orders_weight_percent / 100)
            , 2)
        )
        ORDER BY
            (CASE WHEN ec.sales_target > 0 THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END * v_company_target.sales_weight_percent / 100) +
            (CASE WHEN ec.visits_target > 0 THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END * v_company_target.visits_weight_percent / 100) +
            (CASE WHEN ec.orders_target > 0 THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END * v_company_target.orders_weight_percent / 100) DESC
    ) INTO v_employee_perf
    FROM employee_calc ec;

    IF jsonb_array_length(v_employee_perf) > 0 THEN
        v_best_target_employee := v_employee_perf->0;
        v_weakest_target_employee := v_employee_perf->(jsonb_array_length(v_employee_perf) - 1);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'new_orders', COALESCE(v_new_orders, 0),
    'pending_orders', COALESCE(v_pending_orders, 0),
    'active_visits', COALESCE(v_active_visits, 0),
    'today_visits', COALESCE(v_today_visits, 0),
    'new_customers', COALESCE(v_new_customers, 0),
    'stagnant_customers', COALESCE(v_stagnant_customers, 0),
    'daily_sales', COALESCE(v_daily_sales, 0),
    'monthly_sales', COALESCE(v_monthly_sales, 0),
    'best_rep', COALESCE(v_best_rep, 'null'::jsonb),
    'weakest_rep', COALESCE(v_weakest_rep, 'null'::jsonb),
    'total_customers', COALESCE(v_total_customers, 0),
    'total_reps', COALESCE(v_total_reps, 0),
    -- Target KPIs
    'has_target', FOUND,
    'company_sales_target', COALESCE(v_company_target.sales_target, 0),
    'company_visits_target', COALESCE(v_company_target.visits_target, 0),
    'company_orders_target', COALESCE(v_company_target.orders_target, 0),
    'company_sales_actual', COALESCE(v_effective_sales, 0),
    'company_visits_actual', COALESCE(v_completed_visits, 0),
    'company_orders_actual', COALESCE(v_effective_orders, 0),
    'sales_weight_percent', COALESCE(v_company_target.sales_weight_percent, 0),
    'visits_weight_percent', COALESCE(v_company_target.visits_weight_percent, 0),
    'orders_weight_percent', COALESCE(v_company_target.orders_weight_percent, 0),
    'company_sales_achievement_pct', COALESCE(v_sales_pct, 0),
    'company_visits_achievement_pct', COALESCE(v_visits_pct, 0),
    'company_orders_achievement_pct', COALESCE(v_orders_pct, 0),
    'company_overall_achievement_pct', COALESCE(v_overall, 0),
    'best_target_employee', COALESCE(v_best_target_employee, 'null'::jsonb),
    'weakest_target_employee', COALESCE(v_weakest_target_employee, 'null'::jsonb)
  );
END;
$function$;

COMMENT ON FUNCTION public.get_upper_management_dashboard IS 'لوحة الإدارة العليا الموحدة — 12 KPI + مؤشرات الأهداف';
