-- ============================================================================
-- Phase 4: Targets & Performance Weights with Governance
-- 1. Adds collections_target to employee_monthly_targets
-- 2. Creates performance_weights_config (year-level default weights)
-- 3. Creates employee_weight_overrides (per-employee weight overrides)
-- 4. Adds capabilities: targets.view_all, targets.manage, targets.access
-- 5. Refactors all 10 RPCs to use check_capability + get_subtree_ids
-- 6. Performance calc uses 5 KPIs: Sales, Orders, Visits, Collections, New Customers
-- ============================================================================

-- ============================================================================
-- PART 1: Schema Changes
-- ============================================================================

-- 1a. Add collections_target to employee_monthly_targets
ALTER TABLE IF EXISTS public.employee_monthly_targets
    ADD COLUMN IF NOT EXISTS collections_target numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.employee_monthly_targets.collections_target IS 'هدف التحصيل الشهري';

-- 1b. Performance weights config (one row per year, default weights)
CREATE TABLE IF NOT EXISTS public.performance_weights_config (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    target_year int NOT NULL,
    sales_weight_percent numeric NOT NULL DEFAULT 35,
    collections_weight_percent numeric NOT NULL DEFAULT 20,
    visits_weight_percent numeric NOT NULL DEFAULT 15,
    new_customers_weight_percent numeric NOT NULL DEFAULT 15,
    attendance_weight_percent numeric NOT NULL DEFAULT 15,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT uq_performance_weights_year UNIQUE (target_year),
    CONSTRAINT ck_weights_sum CHECK (
        sales_weight_percent + collections_weight_percent +
        visits_weight_percent + new_customers_weight_percent +
        attendance_weight_percent = 100
    )
);

COMMENT ON TABLE public.performance_weights_config IS 'الأوزان الافتراضية للتقييم (سنوي)';
COMMENT ON COLUMN public.performance_weights_config.attendance_weight_percent IS 'وزن الحضور والانضباط';

-- 1c. Employee weight overrides (per-employee-month optional overrides)
CREATE TABLE IF NOT EXISTS public.employee_weight_overrides (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    target_month int NOT NULL,
    target_year int NOT NULL,
    sales_weight_percent numeric,
    collections_weight_percent numeric,
    visits_weight_percent numeric,
    new_customers_weight_percent numeric,
    attendance_weight_percent numeric,
    override_reason text,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT uq_employee_weight_override UNIQUE (employee_id, target_month, target_year)
);

COMMENT ON TABLE public.employee_weight_overrides IS 'تجاوز الأوزان لكل موظف (اختياري)';
COMMENT ON COLUMN public.employee_weight_overrides.override_reason IS 'سبب التجاوز (مثال: موظف جديد، تدريب، منطقة جديدة)';

CREATE INDEX IF NOT EXISTS idx_employee_weight_overrides_employee
    ON public.employee_weight_overrides (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_weight_overrides_month_year
    ON public.employee_weight_overrides (target_month, target_year);

-- 1d. Add collections_weight_percent and attendance_weight_percent to company_monthly_targets
--     (keeping for backward compat, but new RPCs use performance_weights_config)
ALTER TABLE IF EXISTS public.company_monthly_targets
    ADD COLUMN IF NOT EXISTS collections_weight_percent numeric NOT NULL DEFAULT 20;
ALTER TABLE IF EXISTS public.company_monthly_targets
    ADD COLUMN IF NOT EXISTS attendance_weight_percent numeric NOT NULL DEFAULT 15;

COMMENT ON COLUMN public.company_monthly_targets.collections_weight_percent IS 'وزن التحصيل في التقييم';
COMMENT ON COLUMN public.company_monthly_targets.attendance_weight_percent IS 'وزن الحضور والانضباط';

-- ============================================================================
-- PART 2: Capabilities
-- ============================================================================

INSERT INTO public.capabilities (code, name, description, "group")
VALUES
    ('targets.view_all', 'رؤية كل الأهداف', 'تجاوز النطاق ومشاهدة أهداف كل الموظفين', 'targets'),
    ('targets.manage', 'إدارة الأهداف', 'إنشاء وتعديل أهداف وأوزان الموظفين', 'targets'),
    ('targets.access', 'الدخول للأهداف', 'الوصول إلى شاشات الأهداف والأداء (ضمن النطاق)', 'targets')
ON CONFLICT (code) DO NOTHING;

-- Grant targets.view_all and targets.manage to all 4 upper management employees
DO $$
DECLARE
    v_emp_record RECORD;
    v_cap_record RECORD;
    v_cap_codes text[] := ARRAY['targets.view_all', 'targets.manage', 'targets.access'];
    v_upper_mgmt_codes text[] := ARRAY['ADMIN-001', 'WRQ1003', 'WRQ1002', 'WRQ1004'];
BEGIN
    FOR v_emp_record IN SELECT id FROM public.employees WHERE code = ANY(v_upper_mgmt_codes)
    LOOP
        FOR v_cap_record IN SELECT id FROM public.capabilities WHERE code = ANY(v_cap_codes)
        LOOP
            INSERT INTO public.employee_capabilities (employee_id, capability_id, grant_type, assigned_by)
            VALUES (v_emp_record.id, v_cap_record.id, 'grant', v_emp_record.id)
            ON CONFLICT (employee_id, capability_id) DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;

-- Grant targets.manage and targets.access to مدير البيع role via role_capabilities
DO $$
DECLARE
    v_role_id uuid;
    v_cap_ids uuid[];
BEGIN
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'مدير البيع' LIMIT 1;
    IF v_role_id IS NOT NULL THEN
        SELECT array_agg(id) INTO v_cap_ids FROM public.capabilities WHERE code IN ('targets.manage', 'targets.access');
        IF v_cap_ids IS NOT NULL THEN
            INSERT INTO public.role_capabilities (role_id, capability_id)
            SELECT v_role_id, unnest(v_cap_ids)
            ON CONFLICT (role_id, capability_id) DO NOTHING;
        END IF;
    END IF;
END;
$$;

-- Grant targets.access to supervisory and rep roles via role_capabilities
DO $$
DECLARE
    v_cap_id uuid;
    v_role_names text[] := ARRAY['مشرف مبيعات', 'مشرف تنفيذي', 'مندوب مبيعات'];
    v_role_record RECORD;
BEGIN
    SELECT id INTO v_cap_id FROM public.capabilities WHERE code = 'targets.access' LIMIT 1;
    IF v_cap_id IS NOT NULL THEN
        FOR v_role_record IN SELECT id FROM public.roles WHERE name = ANY(v_role_names)
        LOOP
            INSERT INTO public.role_capabilities (role_id, capability_id)
            VALUES (v_role_record.id, v_cap_id)
            ON CONFLICT (role_id, capability_id) DO NOTHING;
        END LOOP;
    END IF;
END;
$$;

-- ============================================================================
-- PART 3: Drop Old RPCs (all 10)
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_governed_company_monthly_target CASCADE;
DROP FUNCTION IF EXISTS public.governed_upsert_company_monthly_target CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_employee_monthly_targets CASCADE;
DROP FUNCTION IF EXISTS public.governed_upsert_employee_monthly_target CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_target_performance CASCADE;
DROP FUNCTION IF EXISTS public.get_kpi_contributors CASCADE;
DROP FUNCTION IF EXISTS public.get_team_members_kpis CASCADE;
DROP FUNCTION IF EXISTS public.get_rep_customer_kpis CASCADE;
DROP FUNCTION IF EXISTS public.get_customer_delivered_orders CASCADE;

-- ============================================================================
-- PART 4: New RPCs with Governance
-- ============================================================================

-- ### Helper: Get effective weights for an employee in a given month ##########
-- Resolves: employee override > year-level config defaults > hardcoded defaults
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
    v_config public.performance_weights_config;
    v_override public.employee_weight_overrides;
    v_result jsonb;
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
            'new_customers_weight_percent', COALESCE(v_override.new_customers_weight_percent, 15),
            'attendance_weight_percent', COALESCE(v_override.attendance_weight_percent, 15)
        );
        RETURN v_result;
    END IF;

    -- Fall back to year-level config
    SELECT * INTO v_config
    FROM public.performance_weights_config
    WHERE target_year = p_target_year;

    IF FOUND THEN
        v_result := jsonb_build_object(
            'source', 'config',
            'sales_weight_percent', v_config.sales_weight_percent,
            'collections_weight_percent', v_config.collections_weight_percent,
            'visits_weight_percent', v_config.visits_weight_percent,
            'new_customers_weight_percent', v_config.new_customers_weight_percent,
            'attendance_weight_percent', v_config.attendance_weight_percent
        );
        RETURN v_result;
    END IF;

    -- Hardcoded defaults
    RETURN jsonb_build_object(
        'source', 'default',
        'sales_weight_percent', 35,
        'collections_weight_percent', 20,
        'visits_weight_percent', 15,
        'new_customers_weight_percent', 15,
        'attendance_weight_percent', 15
    );
END;
$function$;

COMMENT ON FUNCTION public.get_effective_weights IS 'حساب الأوزان الفعلية للموظف (تجاوز > الإعدادات الافتراضية)';

-- ############################################################################
-- RPC 1: get_governed_company_monthly_target (kept for UI compat, returns weights)
-- ############################################################################
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
    v_target_month int;
    v_target_year int;
    v_config public.performance_weights_config;
    v_company_target public.company_monthly_targets;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'targets.access') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);

    -- Try performance_weights_config first (new), fall back to company_monthly_targets (legacy)
    SELECT * INTO v_config
    FROM public.performance_weights_config
    WHERE target_year = v_target_year;

    -- Also try legacy company target for compat
    SELECT * INTO v_company_target
    FROM public.company_monthly_targets
    WHERE target_month = v_target_month AND target_year = v_target_year;

    v_result := jsonb_build_object(
        'id', COALESCE(v_config.id::text, v_company_target.id::text),
        'target_month', v_target_month,
        'target_year', v_target_year,
        'sales_target', COALESCE(v_company_target.sales_target, 0),
        'visits_target', COALESCE(v_company_target.visits_target, 0),
        'orders_target', COALESCE(v_company_target.orders_target, 0),
        'new_customers_target', COALESCE(v_company_target.new_customers_target, 0),
        'sales_weight_percent', COALESCE(v_config.sales_weight_percent, v_company_target.sales_weight_percent, 35),
        'collections_weight_percent', COALESCE(v_config.collections_weight_percent, v_company_target.collections_weight_percent, 20),
        'visits_weight_percent', COALESCE(v_config.visits_weight_percent, v_company_target.visits_weight_percent, 15),
        'new_customers_weight_percent', COALESCE(v_config.new_customers_weight_percent, v_company_target.new_customers_weight_percent, 15),
        'attendance_weight_percent', COALESCE(v_config.attendance_weight_percent, v_company_target.attendance_weight_percent, 15),
        'is_locked', COALESCE(v_company_target.is_locked, false)
    );

    RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_governed_company_monthly_target IS 'الحصول على الأوزان الافتراضية (متوافق مع الإصدارات السابقة)';

-- ############################################################################
-- RPC 2: governed_upsert_company_monthly_target (deprecated — upserts config instead)
-- ############################################################################
CREATE OR REPLACE FUNCTION public.governed_upsert_company_monthly_target(
    p_token uuid,
    p_target_month int,
    p_target_year int,
    p_sales_target numeric DEFAULT 0,
    p_visits_target numeric DEFAULT 0,
    p_orders_target numeric DEFAULT 0,
    p_new_customers_target numeric DEFAULT 0,
    p_sales_weight_percent numeric DEFAULT 35,
    p_visits_weight_percent numeric DEFAULT 15,
    p_orders_weight_percent numeric DEFAULT 15,
    p_new_customers_weight_percent numeric DEFAULT 15,
    p_collections_weight_percent numeric DEFAULT 20,
    p_attendance_weight_percent numeric DEFAULT 15
)
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

    IF NOT public.check_capability(p_token, 'targets.manage') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    -- Upsert into performance_weights_config (year-level)
    INSERT INTO public.performance_weights_config
        (target_year, sales_weight_percent, collections_weight_percent,
         visits_weight_percent, new_customers_weight_percent, attendance_weight_percent)
    VALUES
        (p_target_year, p_sales_weight_percent, p_collections_weight_percent,
         p_visits_weight_percent, p_new_customers_weight_percent, p_attendance_weight_percent)
    ON CONFLICT (target_year)
    DO UPDATE SET
        sales_weight_percent = EXCLUDED.sales_weight_percent,
        collections_weight_percent = EXCLUDED.collections_weight_percent,
        visits_weight_percent = EXCLUDED.visits_weight_percent,
        new_customers_weight_percent = EXCLUDED.new_customers_weight_percent,
        attendance_weight_percent = EXCLUDED.attendance_weight_percent,
        updated_at = now()
    RETURNING jsonb_build_object(
        'id', id,
        'target_year', target_year,
        'sales_weight_percent', sales_weight_percent,
        'collections_weight_percent', collections_weight_percent,
        'visits_weight_percent', visits_weight_percent,
        'new_customers_weight_percent', new_customers_weight_percent,
        'attendance_weight_percent', attendance_weight_percent
    ) INTO v_result;

    -- Also upsert into legacy company_monthly_targets for backward compat
    INSERT INTO public.company_monthly_targets
        (target_month, target_year, sales_target, visits_target, orders_target, new_customers_target,
         sales_weight_percent, visits_weight_percent, orders_weight_percent, new_customers_weight_percent,
         collections_weight_percent, attendance_weight_percent)
    VALUES
        (p_target_month, p_target_year, p_sales_target, p_visits_target, p_orders_target, p_new_customers_target,
         p_sales_weight_percent, p_visits_weight_percent, p_orders_weight_percent, p_new_customers_weight_percent,
         p_collections_weight_percent, p_attendance_weight_percent)
    ON CONFLICT (target_month, target_year)
    DO UPDATE SET
        sales_weight_percent = EXCLUDED.sales_weight_percent,
        visits_weight_percent = EXCLUDED.visits_weight_percent,
        orders_weight_percent = EXCLUDED.orders_weight_percent,
        new_customers_weight_percent = EXCLUDED.new_customers_weight_percent,
        collections_weight_percent = EXCLUDED.collections_weight_percent,
        attendance_weight_percent = EXCLUDED.attendance_weight_percent,
        updated_at = now();

    RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.governed_upsert_company_monthly_target IS 'حفظ الأوزان الافتراضية (سنوي)';

-- ############################################################################
-- RPC 3: get_governed_employee_monthly_targets (with governance)
-- ############################################################################
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
    v_target_month int;
    v_target_year int;
    v_subtree_ids uuid[];
    v_has_view_all boolean;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'targets.access') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_has_view_all := public.check_capability(p_token, 'targets.view_all');
    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);

    IF NOT v_has_view_all THEN
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;

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
        'new_customers_target', t.new_customers_target,
        'collections_target', t.collections_target,
        'is_locked', t.is_locked
    ) ORDER BY e.full_name) INTO v_result
    FROM public.employee_monthly_targets t
    JOIN public.employees e ON e.id = t.employee_id
    WHERE t.target_month = v_target_month
        AND t.target_year = v_target_year
        AND (v_has_view_all OR t.employee_id = ANY(v_subtree_ids) OR t.employee_id = v_session.employee_id);

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_employee_monthly_targets IS 'الحصول على أهداف الموظفين (ضمن النطاق)';

-- ############################################################################
-- RPC 4: governed_upsert_employee_monthly_target (with governance)
-- ############################################################################
CREATE OR REPLACE FUNCTION public.governed_upsert_employee_monthly_target(
    p_token uuid,
    p_employee_id uuid,
    p_target_month int,
    p_target_year int,
    p_sales_target numeric DEFAULT 0,
    p_visits_target numeric DEFAULT 0,
    p_orders_target numeric DEFAULT 0,
    p_new_customers_target numeric DEFAULT 0,
    p_collections_target numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_has_view_all boolean;
    v_existing_locked boolean;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'targets.manage') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    -- Check scope: view_all can edit any, otherwise must be in subtree
    v_has_view_all := public.check_capability(p_token, 'targets.view_all');
    IF NOT v_has_view_all THEN
        IF p_employee_id != ALL(app.get_subtree_ids(v_session.employee_id)) THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'لا يمكن تعديل هدف موظف خارج نطاقك');
        END IF;
    END IF;

    -- Check if locked
    SELECT is_locked INTO v_existing_locked
    FROM public.employee_monthly_targets
    WHERE employee_id = p_employee_id AND target_month = p_target_month AND target_year = p_target_year;

    IF v_existing_locked THEN
        RETURN jsonb_build_object('error', 'LOCKED', 'detail', 'لا يمكن تعديل هدف شهر مغلق');
    END IF;

    INSERT INTO public.employee_monthly_targets
        (employee_id, target_month, target_year, sales_target, visits_target, orders_target,
         new_customers_target, collections_target)
    VALUES
        (p_employee_id, p_target_month, p_target_year, p_sales_target, p_visits_target, p_orders_target,
         p_new_customers_target, p_collections_target)
    ON CONFLICT (employee_id, target_month, target_year)
    DO UPDATE SET
        sales_target = EXCLUDED.sales_target,
        visits_target = EXCLUDED.visits_target,
        orders_target = EXCLUDED.orders_target,
        new_customers_target = EXCLUDED.new_customers_target,
        collections_target = EXCLUDED.collections_target,
        updated_at = now()
    RETURNING jsonb_build_object(
        'id', id,
        'employee_id', employee_id,
        'target_month', target_month,
        'target_year', target_year,
        'sales_target', sales_target,
        'visits_target', visits_target,
        'orders_target', orders_target,
        'new_customers_target', new_customers_target,
        'collections_target', collections_target,
        'is_locked', is_locked
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.governed_upsert_employee_monthly_target IS 'إنشاء أو تحديث هدف موظف (ضمن النطاق)';

-- ############################################################################
-- RPC 5: get_governed_target_performance (with governance + 5 KPIs + weights)
-- ############################################################################
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
    v_has_view_all boolean;
    v_target_month int;
    v_target_year int;
    v_month_start timestamptz;
    v_month_end timestamptz;
    v_employee_perf jsonb;
    v_best_employee jsonb;
    v_weakest_employee jsonb;
    v_subtree_ids uuid[];
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'targets.access') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_has_view_all := public.check_capability(p_token, 'targets.view_all');
    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
    v_month_start := date_trunc('month', to_timestamp(v_target_year || '-' || v_target_month || '-01', 'YYYY-MM-DD'));
    v_month_end := v_month_start + INTERVAL '1 month';

    IF NOT v_has_view_all THEN
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;

    WITH employee_orders AS (
        SELECT
            COALESCE(emp.id, emp2.id) AS employee_id,
            o.total_amount,
            o.id AS order_id,
            o.customer_id,
            o.delivered_at
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
    employee_new_customers AS (
        SELECT eo.employee_id,
            COUNT(DISTINCT eo.customer_id)::int AS new_customers_actual
        FROM employee_orders eo
        WHERE eo.delivered_at = (
            SELECT MIN(o2.delivered_at)
            FROM public.orders o2
            WHERE o2.customer_id = eo.customer_id
                AND o2.status = 'delivered'
        )
        GROUP BY eo.employee_id
    ),
    employee_collections AS (
        SELECT c.created_by AS employee_id,
            COALESCE(SUM(c.amount), 0) AS collections_actual
        FROM public.collections c
        WHERE c.status = 'approved'
            AND c.collected_at >= v_month_start
            AND c.collected_at < v_month_end
        GROUP BY c.created_by
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
                AND r3.created_at >= v_month_start AND r3.created_at < v_month_end
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
            AND r.created_at >= v_month_start AND r.created_at < v_month_end
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
            et.new_customers_target,
            et.collections_target,
            COALESCE(s.sales_actual, 0) AS gross_sales,
            COALESCE(v.visits_actual, 0) AS visits_actual,
            COALESCE(s.orders_actual, 0) AS gross_orders,
            COALESCE(nc.new_customers_actual, 0) AS new_customers_actual,
            COALESCE(cl.collections_actual, 0) AS collections_actual,
            COALESCE(rd.return_deduction, 0) AS return_deduction,
            COALESCE(rd.full_returns, 0) AS full_returns,
            GREATEST(COALESCE(s.sales_actual, 0) - COALESCE(rd.return_deduction, 0), 0) AS effective_sales,
            GREATEST(COALESCE(s.orders_actual, 0) - COALESCE(rd.full_returns, 0), 0) AS effective_orders,
            et.is_locked
        FROM public.employee_monthly_targets et
        JOIN public.employees e ON e.id = et.employee_id
        LEFT JOIN employee_sales s ON s.employee_id = et.employee_id
        LEFT JOIN employee_visits v ON v.employee_id = et.employee_id
        LEFT JOIN employee_new_customers nc ON nc.employee_id = et.employee_id
        LEFT JOIN employee_collections cl ON cl.employee_id = et.employee_id
        LEFT JOIN employee_returns rd ON rd.employee_id = et.employee_id
        WHERE et.target_month = v_target_month AND et.target_year = v_target_year
            AND (v_has_view_all OR et.employee_id = ANY(v_subtree_ids) OR et.employee_id = v_session.employee_id)
    ),
    employee_scored AS (
        SELECT
            ec.*,
            CASE WHEN ec.sales_target > 0
                THEN ROUND((ec.effective_sales / ec.sales_target * 100)::numeric, 2) ELSE 0 END AS sales_achievement_pct,
            CASE WHEN ec.visits_target > 0
                THEN ROUND((ec.visits_actual::numeric / ec.visits_target * 100)::numeric, 2) ELSE 0 END AS visits_achievement_pct,
            CASE WHEN ec.orders_target > 0
                THEN ROUND((ec.effective_orders::numeric / ec.orders_target * 100)::numeric, 2) ELSE 0 END AS orders_achievement_pct,
            CASE WHEN ec.new_customers_target > 0
                THEN ROUND((ec.new_customers_actual::numeric / ec.new_customers_target * 100)::numeric, 2) ELSE 0 END AS new_customers_achievement_pct,
            CASE WHEN ec.collections_target > 0
                THEN ROUND((ec.collections_actual::numeric / ec.collections_target * 100)::numeric, 2) ELSE 0 END AS collections_achievement_pct,
            jsonb_build_object(
                'sales_weight_percent', (get_effective_weights(ec.employee_id, v_target_month, v_target_year)->>'sales_weight_percent')::numeric,
                'collections_weight_percent', (get_effective_weights(ec.employee_id, v_target_month, v_target_year)->>'collections_weight_percent')::numeric,
                'visits_weight_percent', (get_effective_weights(ec.employee_id, v_target_month, v_target_year)->>'visits_weight_percent')::numeric,
                'new_customers_weight_percent', (get_effective_weights(ec.employee_id, v_target_month, v_target_year)->>'new_customers_weight_percent')::numeric,
                'attendance_weight_percent', (get_effective_weights(ec.employee_id, v_target_month, v_target_year)->>'attendance_weight_percent')::numeric,
                'source', get_effective_weights(ec.employee_id, v_target_month, v_target_year)->>'source'
            ) AS weights
        FROM employee_calc ec
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'employee_id', es.employee_id,
            'employee_code', es.employee_code,
            'employee_name', es.employee_name,
            'sales_target', es.sales_target,
            'visits_target', es.visits_target,
            'orders_target', es.orders_target,
            'new_customers_target', es.new_customers_target,
            'collections_target', es.collections_target,
            'gross_sales', es.gross_sales,
            'visits_actual', es.visits_actual,
            'gross_orders', es.gross_orders,
            'new_customers_actual', es.new_customers_actual,
            'collections_actual', es.collections_actual,
            'return_deduction', es.return_deduction,
            'full_returns', es.full_returns,
            'effective_sales', es.effective_sales,
            'effective_orders', es.effective_orders,
            'sales_achievement_pct', es.sales_achievement_pct,
            'visits_achievement_pct', es.visits_achievement_pct,
            'orders_achievement_pct', es.orders_achievement_pct,
            'new_customers_achievement_pct', es.new_customers_achievement_pct,
            'collections_achievement_pct', es.collections_achievement_pct,
            'weights', es.weights,
            'overall_achievement_score', ROUND(
                (es.sales_achievement_pct * (es.weights->>'sales_weight_percent')::numeric / 100) +
                (es.visits_achievement_pct * (es.weights->>'visits_weight_percent')::numeric / 100) +
                (es.orders_achievement_pct * (es.weights->>'orders_weight_percent')::numeric / 100) +
                (es.new_customers_achievement_pct * (es.weights->>'new_customers_weight_percent')::numeric / 100) +
                (es.collections_achievement_pct * (es.weights->>'collections_weight_percent')::numeric / 100)
            , 2),
            'is_locked', es.is_locked
        )
        ORDER BY es.sales_achievement_pct DESC
    ) INTO v_employee_perf
    FROM employee_scored es;

    IF jsonb_array_length(v_employee_perf) > 0 THEN
        v_best_employee := v_employee_perf->0;
        v_weakest_employee := v_employee_perf->(jsonb_array_length(v_employee_perf) - 1);
    END IF;

    RETURN jsonb_build_object(
        'employees', COALESCE(v_employee_perf, '[]'::jsonb),
        'best_employee', v_best_employee,
        'weakest_employee', v_weakest_employee
    );
END;
$function$;

COMMENT ON FUNCTION public.get_governed_target_performance IS 'أداء الأهداف الشهرية للموظفين (ضمن النطاق)';

-- ############################################################################
-- RPC 6: get_kpi_contributors (Level 2 drill-down, with governance)
-- ############################################################################
CREATE OR REPLACE FUNCTION public.get_kpi_contributors(
    p_token uuid,
    p_kpi_type text,
    p_month int DEFAULT NULL,
    p_year int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_has_view_all boolean;
    v_target_month int;
    v_target_year int;
    v_month_start timestamptz;
    v_month_end timestamptz;
    v_subtree_ids uuid[];
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'targets.access') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_has_view_all := public.check_capability(p_token, 'targets.view_all');
    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
    v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
    v_month_end := v_month_start + INTERVAL '1 month';

    IF NOT v_has_view_all THEN
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;

    WITH RECURSIVE ancestor_map AS (
        SELECT id AS descendant_id, id AS ancestor_id
        FROM public.employees WHERE is_active = true
        UNION ALL
        SELECT am.descendant_id, e.manager_id
        FROM ancestor_map am
        JOIN public.employees e ON e.id = am.ancestor_id
        WHERE e.manager_id IS NOT NULL
    ),
    delivered_orders AS (
        SELECT o.*, COALESCE(emp.id, emp2.id) AS resolved_employee_id
        FROM public.orders o
        LEFT JOIN public.employees emp ON o.owner_id = emp.id
        LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
        WHERE o.status = 'delivered'
            AND o.delivered_at >= v_month_start
            AND o.delivered_at < v_month_end
    ),
    completed_visits AS (
        SELECT v.*
        FROM public.visits v
        WHERE v.status = 'completed'
            AND v.check_out_at >= v_month_start
            AND v.check_out_at < v_month_end
    ),
    approved_collections AS (
        SELECT c.*
        FROM public.collections c
        WHERE c.status = 'approved'
            AND c.collected_at >= v_month_start
            AND c.collected_at < v_month_end
    ),
    emp_orders AS (
        SELECT resolved_employee_id AS employee_id,
            COUNT(DISTINCT id)::int AS order_count,
            COALESCE(SUM(total_amount), 0) AS sales_amount
        FROM delivered_orders
        GROUP BY resolved_employee_id
    ),
    emp_visits AS (
        SELECT employee_id, COUNT(*)::int AS visit_count
        FROM completed_visits
        GROUP BY employee_id
    ),
    emp_collections AS (
        SELECT created_by AS employee_id,
            COALESCE(SUM(amount), 0) AS collection_amount
        FROM approved_collections
        GROUP BY created_by
    ),
    emp_new_customers AS (
        SELECT resolved_employee_id AS employee_id,
            COUNT(DISTINCT customer_id)::int AS new_customer_count
        FROM delivered_orders do2
        WHERE do2.delivered_at = (
            SELECT MIN(o3.delivered_at)
            FROM public.orders o3
            WHERE o3.customer_id = do2.customer_id
                AND o3.status = 'delivered'
        )
        GROUP BY resolved_employee_id
    ),
    approved_returns AS (
        SELECT r.*, o.resolved_employee_id
        FROM public.returns r
        JOIN delivered_orders o ON o.id = r.order_id
        WHERE r.status = 'approved'
            AND r.created_at >= v_month_start
            AND r.created_at < v_month_end
    ),
    emp_returns AS (
        SELECT resolved_employee_id AS employee_id,
            COALESCE(SUM(credit_note_amount), 0) AS return_deduction,
            COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int AS full_returns
        FROM approved_returns r
        LEFT JOIN (
            SELECT r2.order_id FROM public.returns r2
            JOIN public.return_items ri ON ri.return_id = r2.id
            JOIN public.products p ON p.id = ri.product_id
            JOIN (SELECT oi2.order_id, SUM(oi2.piece_quantity) AS total_pieces FROM public.order_items oi2 GROUP BY oi2.order_id) oi3 ON oi3.order_id = r2.order_id
            WHERE r2.status = 'approved'
                AND r2.created_at >= v_month_start AND r2.created_at < v_month_end
            GROUP BY r2.order_id, oi3.total_pieces
            HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi3.total_pieces
        ) fr ON fr.order_id = r.order_id
        GROUP BY resolved_employee_id
    ),
    personal_kpis AS (
        SELECT
            e.id AS employee_id, e.code, e.full_name, e.manager_id,
            COALESCE(emt.sales_target, 0) AS sales_target,
            COALESCE(emt.visits_target, 0) AS visits_target,
            COALESCE(emt.orders_target, 0) AS orders_target,
            COALESCE(emt.new_customers_target, 0) AS new_customers_target,
            COALESCE(emt.collections_target, 0) AS collections_target,
            GREATEST(COALESCE(eo.sales_amount, 0) - COALESCE(er.return_deduction, 0), 0) AS personal_sales,
            COALESCE(ev.visit_count, 0) AS personal_visits,
            GREATEST(COALESCE(eo.order_count, 0) - COALESCE(er.full_returns, 0), 0) AS personal_orders,
            COALESCE(enc.new_customer_count, 0) AS personal_new_customers,
            COALESCE(ecol.collection_amount, 0) AS personal_collections,
            CASE
                WHEN EXISTS (SELECT 1 FROM public.employee_roles er2 JOIN public.roles r2 ON r2.id = er2.role_id WHERE er2.employee_id = e.id AND r2.name IN ('مدير البيع', 'مدير تنفيذي')) THEN 'مدير البيع'
                WHEN EXISTS (SELECT 1 FROM public.employee_roles er2 JOIN public.roles r2 ON r2.id = er2.role_id WHERE er2.employee_id = e.id AND r2.name IN ('مشرف مبيعات', 'مشرف تنفيذي')) THEN 'سوبر فايزر'
                ELSE 'مندوب'
            END AS role_type,
            EXISTS (SELECT 1 FROM public.employees sub WHERE sub.manager_id = e.id AND sub.is_active = true) AS has_team
        FROM public.employees e
        LEFT JOIN public.employee_monthly_targets emt ON emt.employee_id = e.id AND emt.target_month = v_target_month AND emt.target_year = v_target_year
        LEFT JOIN emp_orders eo ON eo.employee_id = e.id
        LEFT JOIN emp_visits ev ON ev.employee_id = e.id
        LEFT JOIN emp_new_customers enc ON enc.employee_id = e.id
        LEFT JOIN emp_collections ecol ON ecol.employee_id = e.id
        LEFT JOIN emp_returns er ON er.employee_id = e.id
        WHERE e.is_active = true
            AND e.code NOT IN ('SYS-OWNER', 'ADMIN-001')
            AND NOT EXISTS (
                SELECT 1 FROM public.employee_roles er2 JOIN public.roles r2 ON r2.id = er2.role_id
                WHERE er2.employee_id = e.id AND r2.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة')
            )
            AND (v_has_view_all OR e.id = ANY(v_subtree_ids) OR e.id = v_session.employee_id)
    ),
    team_kpis AS (
        SELECT am.ancestor_id,
            SUM(pk.sales_target) AS team_sales_target,
            SUM(pk.visits_target) AS team_visits_target,
            SUM(pk.orders_target) AS team_orders_target,
            SUM(pk.new_customers_target) AS team_new_customers_target,
            SUM(pk.collections_target) AS team_collections_target,
            SUM(pk.personal_sales) AS team_sales,
            SUM(pk.personal_visits) AS team_visits,
            SUM(pk.personal_orders) AS team_orders,
            SUM(pk.personal_new_customers) AS team_new_customers,
            SUM(pk.personal_collections) AS team_collections
        FROM ancestor_map am
        JOIN personal_kpis pk ON pk.employee_id = am.descendant_id
        GROUP BY am.ancestor_id
    ),
    final_data AS (
        SELECT pk.employee_id, pk.code, pk.full_name, pk.role_type, pk.has_team,
            CASE WHEN pk.has_team THEN COALESCE(tk.team_sales_target, 0) ELSE pk.sales_target END AS disp_sales_target,
            CASE WHEN pk.has_team THEN COALESCE(tk.team_sales, 0) ELSE pk.personal_sales END AS disp_sales,
            CASE WHEN pk.has_team THEN COALESCE(tk.team_visits_target, 0) ELSE pk.visits_target END AS disp_visits_target,
            CASE WHEN pk.has_team THEN COALESCE(tk.team_visits, 0) ELSE pk.personal_visits END AS disp_visits,
            CASE WHEN pk.has_team THEN COALESCE(tk.team_orders_target, 0) ELSE pk.orders_target END AS disp_orders_target,
            CASE WHEN pk.has_team THEN COALESCE(tk.team_orders, 0) ELSE pk.personal_orders END AS disp_orders,
            CASE WHEN pk.has_team THEN COALESCE(tk.team_new_customers_target, 0) ELSE pk.new_customers_target END AS disp_nc_target,
            CASE WHEN pk.has_team THEN COALESCE(tk.team_new_customers, 0) ELSE pk.personal_new_customers END AS disp_nc,
            CASE WHEN pk.has_team THEN COALESCE(tk.team_collections_target, 0) ELSE pk.collections_target END AS disp_coll_target,
            CASE WHEN pk.has_team THEN COALESCE(tk.team_collections, 0) ELSE pk.personal_collections END AS disp_coll
        FROM personal_kpis pk
        LEFT JOIN team_kpis tk ON tk.ancestor_id = pk.employee_id
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'employee_id', fd.employee_id,
            'employee_code', fd.code,
            'employee_name', fd.full_name,
            'role_type', fd.role_type,
            'has_team', fd.has_team,
            'actual', CASE p_kpi_type
                WHEN 'sales' THEN fd.disp_sales
                WHEN 'orders' THEN fd.disp_orders
                WHEN 'visits' THEN fd.disp_visits
                WHEN 'new_customers' THEN fd.disp_nc
                WHEN 'collections' THEN fd.disp_coll
                ELSE 0
            END,
            'target', CASE p_kpi_type
                WHEN 'sales' THEN fd.disp_sales_target
                WHEN 'orders' THEN fd.disp_orders_target
                WHEN 'visits' THEN fd.disp_visits_target
                WHEN 'new_customers' THEN fd.disp_nc_target
                WHEN 'collections' THEN fd.disp_coll_target
                ELSE 0
            END,
            'achievement_pct', ROUND(
                CASE
                    WHEN CASE p_kpi_type
                        WHEN 'sales' THEN fd.disp_sales_target
                        WHEN 'orders' THEN fd.disp_orders_target
                        WHEN 'visits' THEN fd.disp_visits_target
                        WHEN 'new_customers' THEN fd.disp_nc_target
                        WHEN 'collections' THEN fd.disp_coll_target
                        ELSE 0
                    END > 0
                    THEN (
                        CASE p_kpi_type
                            WHEN 'sales' THEN fd.disp_sales
                            WHEN 'orders' THEN fd.disp_orders
                            WHEN 'visits' THEN fd.disp_visits
                            WHEN 'new_customers' THEN fd.disp_nc
                            WHEN 'collections' THEN fd.disp_coll
                            ELSE 0
                        END::numeric /
                        CASE p_kpi_type
                            WHEN 'sales' THEN fd.disp_sales_target
                            WHEN 'orders' THEN fd.disp_orders_target
                            WHEN 'visits' THEN fd.disp_visits_target
                            WHEN 'new_customers' THEN fd.disp_nc_target
                            WHEN 'collections' THEN fd.disp_coll_target
                            ELSE 1
                        END::numeric * 100
                    )
                    ELSE 0
                END, 2
            )
        )
    ) INTO v_result
    FROM final_data fd;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_kpi_contributors IS 'L2 drill-down: KPI contributors with governance';

-- ############################################################################
-- RPC 7: get_team_members_kpis (Level 3 drill-down, with governance)
-- ############################################################################
CREATE OR REPLACE FUNCTION public.get_team_members_kpis(
    p_token uuid,
    p_manager_id uuid,
    p_kpi_type text,
    p_month int DEFAULT NULL,
    p_year int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_has_view_all boolean;
    v_target_month int;
    v_target_year int;
    v_month_start timestamptz;
    v_month_end timestamptz;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'targets.access') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_has_view_all := public.check_capability(p_token, 'targets.view_all');

    -- Verify the manager is visible (in subtree or view_all)
    IF NOT v_has_view_all THEN
        IF p_manager_id != ALL(app.get_subtree_ids(v_session.employee_id)) THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN');
        END IF;
    END IF;

    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
    v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
    v_month_end := v_month_start + INTERVAL '1 month';

    WITH delivered_orders AS (
        SELECT o.*, COALESCE(emp.id, emp2.id) AS resolved_employee_id
        FROM public.orders o
        LEFT JOIN public.employees emp ON o.owner_id = emp.id
        LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
        WHERE o.status = 'delivered'
            AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end
    ),
    completed_visits AS (
        SELECT * FROM public.visits v
        WHERE v.status = 'completed' AND v.check_out_at >= v_month_start AND v.check_out_at < v_month_end
    ),
    approved_collections AS (
        SELECT * FROM public.collections c
        WHERE c.status = 'approved' AND c.collected_at >= v_month_start AND c.collected_at < v_month_end
    ),
    emp_orders AS (
        SELECT resolved_employee_id AS employee_id, COUNT(DISTINCT id)::int AS order_count, COALESCE(SUM(total_amount), 0) AS sales_amount
        FROM delivered_orders GROUP BY resolved_employee_id
    ),
    emp_visits AS (
        SELECT employee_id, COUNT(*)::int AS visit_count FROM completed_visits GROUP BY employee_id
    ),
    emp_collections AS (
        SELECT created_by AS employee_id, COALESCE(SUM(amount), 0) AS collection_amount
        FROM approved_collections GROUP BY created_by
    ),
    emp_new_customers AS (
        SELECT resolved_employee_id AS employee_id, COUNT(DISTINCT customer_id)::int AS new_customer_count
        FROM delivered_orders do2
        WHERE do2.delivered_at = (SELECT MIN(o3.delivered_at) FROM public.orders o3 WHERE o3.customer_id = do2.customer_id AND o3.status = 'delivered')
        GROUP BY resolved_employee_id
    ),
    approved_returns AS (
        SELECT r.*, o.resolved_employee_id FROM public.returns r JOIN delivered_orders o ON o.id = r.order_id
        WHERE r.status = 'approved' AND r.created_at >= v_month_start AND r.created_at < v_month_end
    ),
    emp_returns AS (
        SELECT resolved_employee_id AS employee_id,
            COALESCE(SUM(credit_note_amount), 0) AS return_deduction,
            COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int AS full_returns
        FROM approved_returns r
        LEFT JOIN (
            SELECT r2.order_id FROM public.returns r2
            JOIN public.return_items ri ON ri.return_id = r2.id
            JOIN public.products p ON p.id = ri.product_id
            JOIN (SELECT oi2.order_id, SUM(oi2.piece_quantity) AS total_pieces FROM public.order_items oi2 GROUP BY oi2.order_id) oi3 ON oi3.order_id = r2.order_id
            WHERE r2.status = 'approved' AND r2.created_at >= v_month_start AND r2.created_at < v_month_end
            GROUP BY r2.order_id, oi3.total_pieces
            HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi3.total_pieces
        ) fr ON fr.order_id = r.order_id
        GROUP BY resolved_employee_id
    ),
    personal_kpis AS (
        SELECT e.id AS employee_id, e.code, e.full_name,
            COALESCE(emt.sales_target, 0) AS sales_target,
            COALESCE(emt.visits_target, 0) AS visits_target,
            COALESCE(emt.orders_target, 0) AS orders_target,
            COALESCE(emt.new_customers_target, 0) AS new_customers_target,
            COALESCE(emt.collections_target, 0) AS collections_target,
            GREATEST(COALESCE(eo.sales_amount, 0) - COALESCE(er.return_deduction, 0), 0) AS personal_sales,
            COALESCE(ev.visit_count, 0) AS personal_visits,
            GREATEST(COALESCE(eo.order_count, 0) - COALESCE(er.full_returns, 0), 0) AS personal_orders,
            COALESCE(enc.new_customer_count, 0) AS personal_new_customers,
            COALESCE(ecol.collection_amount, 0) AS personal_collections,
            EXISTS (SELECT 1 FROM public.employees sub WHERE sub.manager_id = e.id AND sub.is_active = true) AS has_team
        FROM public.employees e
        LEFT JOIN public.employee_monthly_targets emt ON emt.employee_id = e.id AND emt.target_month = v_target_month AND emt.target_year = v_target_year
        LEFT JOIN emp_orders eo ON eo.employee_id = e.id
        LEFT JOIN emp_visits ev ON ev.employee_id = e.id
        LEFT JOIN emp_new_customers enc ON enc.employee_id = e.id
        LEFT JOIN emp_collections ecol ON ecol.employee_id = e.id
        LEFT JOIN emp_returns er ON er.employee_id = e.id
        WHERE e.is_active = true AND e.manager_id = p_manager_id
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'employee_id', pk.employee_id,
            'employee_code', pk.code,
            'employee_name', pk.full_name,
            'has_team', pk.has_team,
            'actual', CASE p_kpi_type
                WHEN 'sales' THEN pk.personal_sales
                WHEN 'orders' THEN pk.personal_orders
                WHEN 'visits' THEN pk.personal_visits
                WHEN 'new_customers' THEN pk.personal_new_customers
                WHEN 'collections' THEN pk.personal_collections
                ELSE 0
            END,
            'target', CASE p_kpi_type
                WHEN 'sales' THEN pk.sales_target
                WHEN 'orders' THEN pk.orders_target
                WHEN 'visits' THEN pk.visits_target
                WHEN 'new_customers' THEN pk.new_customers_target
                WHEN 'collections' THEN pk.collections_target
                ELSE 0
            END,
            'achievement_pct', ROUND(
                CASE
                    WHEN CASE p_kpi_type
                        WHEN 'sales' THEN pk.sales_target
                        WHEN 'orders' THEN pk.orders_target
                        WHEN 'visits' THEN pk.visits_target
                        WHEN 'new_customers' THEN pk.new_customers_target
                        WHEN 'collections' THEN pk.collections_target
                        ELSE 0
                    END > 0
                    THEN (
                        CASE p_kpi_type
                            WHEN 'sales' THEN pk.personal_sales
                            WHEN 'orders' THEN pk.personal_orders
                            WHEN 'visits' THEN pk.personal_visits
                            WHEN 'new_customers' THEN pk.personal_new_customers
                            WHEN 'collections' THEN pk.personal_collections
                            ELSE 0
                        END::numeric /
                        CASE p_kpi_type
                            WHEN 'sales' THEN pk.sales_target
                            WHEN 'orders' THEN pk.orders_target
                            WHEN 'visits' THEN pk.visits_target
                            WHEN 'new_customers' THEN pk.new_customers_target
                            WHEN 'collections' THEN pk.collections_target
                            ELSE 1
                        END::numeric * 100
                    )
                    ELSE 0
                END, 2
            )
        )
        ORDER BY pk.full_name
    ) INTO v_result
    FROM personal_kpis pk;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_team_members_kpis IS 'L3 drill-down: team members with governance';

-- ############################################################################
-- RPC 8: get_rep_customer_kpis (Level 4 drill-down, with governance)
-- ############################################################################
CREATE OR REPLACE FUNCTION public.get_rep_customer_kpis(
    p_token uuid,
    p_employee_id uuid,
    p_month int DEFAULT NULL,
    p_year int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_has_view_all boolean;
    v_target_month int;
    v_target_year int;
    v_month_start timestamptz;
    v_month_end timestamptz;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'targets.access') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_has_view_all := public.check_capability(p_token, 'targets.view_all');

    -- Verify the employee is visible
    IF NOT v_has_view_all THEN
        IF p_employee_id != ALL(app.get_subtree_ids(v_session.employee_id)) AND p_employee_id != v_session.employee_id THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN');
        END IF;
    END IF;

    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
    v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
    v_month_end := v_month_start + INTERVAL '1 month';

    WITH customer_delivered_orders AS (
        SELECT o.customer_id, o.id AS order_id, o.total_amount, o.delivered_at
        FROM public.orders o
        JOIN public.customers c ON c.id = o.customer_id
        WHERE o.status = 'delivered'
            AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end
            AND (c.owner_id = p_employee_id OR c.id IN (
                SELECT c2.id FROM public.customers c2
                JOIN public.employees e ON e.identity_id = c2.owner_id
                WHERE e.id = p_employee_id
            ))
    ),
    customer_visits AS (
        SELECT v.customer_id, COUNT(*)::int AS visit_count
        FROM public.visits v
        WHERE v.status = 'completed'
            AND v.check_out_at >= v_month_start AND v.check_out_at < v_month_end
            AND v.employee_id = p_employee_id
        GROUP BY v.customer_id
    ),
    customer_agg AS (
        SELECT
            c.id AS customer_id,
            c.company_name AS customer_name,
            COALESCE(SUM(cdo.total_amount), 0) AS total_sales,
            COUNT(DISTINCT cdo.order_id)::int AS total_orders,
            COALESCE(cv.visit_count, 0) AS total_visits,
            EXISTS (
                SELECT 1 FROM public.orders o2
                WHERE o2.customer_id = c.id
                    AND o2.status = 'delivered'
                    AND o2.delivered_at = (
                        SELECT MIN(o3.delivered_at)
                        FROM public.orders o3 WHERE o3.customer_id = c.id AND o3.status = 'delivered'
                    )
                    AND o2.delivered_at >= v_month_start AND o2.delivered_at < v_month_end
            ) AS is_new_customer
        FROM public.customers c
        LEFT JOIN customer_delivered_orders cdo ON cdo.customer_id = c.id
        LEFT JOIN customer_visits cv ON cv.customer_id = c.id
        WHERE (c.owner_id = p_employee_id OR c.owner_id IN (SELECT identity_id FROM public.employees WHERE id = p_employee_id))
            AND c.is_active = true
        GROUP BY c.id, c.company_name, cv.visit_count
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'customer_id', ca.customer_id,
            'customer_name', ca.customer_name,
            'total_sales', ca.total_sales,
            'total_orders', ca.total_orders,
            'total_visits', ca.total_visits,
            'is_new_customer', ca.is_new_customer
        )
        ORDER BY ca.total_sales DESC
    ) INTO v_result
    FROM customer_agg ca
    WHERE ca.total_sales > 0 OR ca.total_visits > 0 OR ca.is_new_customer = true;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_rep_customer_kpis IS 'L4 drill-down: customer KPIs with governance';

-- ############################################################################
-- RPC 9: get_customer_delivered_orders (Level 5 drill-down, with governance)
-- ############################################################################
CREATE OR REPLACE FUNCTION public.get_customer_delivered_orders(
    p_token uuid,
    p_customer_id uuid,
    p_month int DEFAULT NULL,
    p_year int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_target_month int;
    v_target_year int;
    v_month_start timestamptz;
    v_month_end timestamptz;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'targets.access') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
    v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
    v_month_end := v_month_start + INTERVAL '1 month';

    SELECT jsonb_agg(
        jsonb_build_object(
            'order_id', o.id,
            'order_code', o.order_number,
            'total_amount', o.total_amount,
            'delivered_at', o.delivered_at,
            'status', o.status
        )
        ORDER BY o.delivered_at DESC
    ) INTO v_result
    FROM public.orders o
    WHERE o.customer_id = p_customer_id
        AND o.status = 'delivered'
        AND o.delivered_at >= v_month_start
        AND o.delivered_at < v_month_end;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_customer_delivered_orders IS 'L5 drill-down: delivered orders with governance';

-- ############################################################################
-- RPC 10: governed_upsert_employee_weight_override (new)
-- ############################################################################
CREATE OR REPLACE FUNCTION public.governed_upsert_employee_weight_override(
    p_token uuid,
    p_employee_id uuid,
    p_target_month int,
    p_target_year int,
    p_sales_weight_percent numeric DEFAULT NULL,
    p_collections_weight_percent numeric DEFAULT NULL,
    p_visits_weight_percent numeric DEFAULT NULL,
    p_new_customers_weight_percent numeric DEFAULT NULL,
    p_attendance_weight_percent numeric DEFAULT NULL,
    p_override_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_has_view_all boolean;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'targets.manage') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    -- Scope check
    v_has_view_all := public.check_capability(p_token, 'targets.view_all');
    IF NOT v_has_view_all THEN
        IF p_employee_id != ALL(app.get_subtree_ids(v_session.employee_id)) THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'لا يمكن تعديل أوزان موظف خارج نطاقك');
        END IF;
    END IF;

    INSERT INTO public.employee_weight_overrides
        (employee_id, target_month, target_year, sales_weight_percent,
         collections_weight_percent, visits_weight_percent,
         new_customers_weight_percent, attendance_weight_percent,
         override_reason)
    VALUES
        (p_employee_id, p_target_month, p_target_year, p_sales_weight_percent,
         p_collections_weight_percent, p_visits_weight_percent,
         p_new_customers_weight_percent, p_attendance_weight_percent,
         p_override_reason)
    ON CONFLICT (employee_id, target_month, target_year)
    DO UPDATE SET
        sales_weight_percent = COALESCE(EXCLUDED.sales_weight_percent, employee_weight_overrides.sales_weight_percent),
        collections_weight_percent = COALESCE(EXCLUDED.collections_weight_percent, employee_weight_overrides.collections_weight_percent),
        visits_weight_percent = COALESCE(EXCLUDED.visits_weight_percent, employee_weight_overrides.visits_weight_percent),
        new_customers_weight_percent = COALESCE(EXCLUDED.new_customers_weight_percent, employee_weight_overrides.new_customers_weight_percent),
        attendance_weight_percent = COALESCE(EXCLUDED.attendance_weight_percent, employee_weight_overrides.attendance_weight_percent),
        override_reason = COALESCE(EXCLUDED.override_reason, employee_weight_overrides.override_reason),
        is_active = true,
        updated_at = now()
    RETURNING jsonb_build_object(
        'id', id,
        'employee_id', employee_id,
        'target_month', target_month,
        'target_year', target_year,
        'sales_weight_percent', sales_weight_percent,
        'collections_weight_percent', collections_weight_percent,
        'visits_weight_percent', visits_weight_percent,
        'new_customers_weight_percent', new_customers_weight_percent,
        'attendance_weight_percent', attendance_weight_percent,
        'override_reason', override_reason,
        'is_active', is_active
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.governed_upsert_employee_weight_override IS 'إنشاء أو تحديث تجاوز أوزان موظف';

-- ############################################################################
-- RPC 11: deactivate_employee_weight_override (new)
-- ############################################################################
CREATE OR REPLACE FUNCTION public.deactivate_employee_weight_override(
    p_token uuid,
    p_override_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_override public.employee_weight_overrides;
    v_has_view_all boolean;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'targets.manage') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT * INTO v_override FROM public.employee_weight_overrides WHERE id = p_override_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

    v_has_view_all := public.check_capability(p_token, 'targets.view_all');
    IF NOT v_has_view_all THEN
        IF v_override.employee_id != ALL(app.get_subtree_ids(v_session.employee_id)) THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'لا يمكن تعديل أوزان موظف خارج نطاقك');
        END IF;
    END IF;

    UPDATE public.employee_weight_overrides
    SET is_active = false, updated_at = now()
    WHERE id = p_override_id;

    RETURN jsonb_build_object('success', true);
END;
$function$;

COMMENT ON FUNCTION public.deactivate_employee_weight_override IS 'إلغاء تجاوز أوزان الموظف';

-- ############################################################################
-- RPC 12: get_employee_weight_overrides (new — view overrides with governance)
-- ############################################################################
CREATE OR REPLACE FUNCTION public.get_employee_weight_overrides(
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
    v_has_view_all boolean;
    v_target_month int;
    v_target_year int;
    v_subtree_ids uuid[];
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'targets.access') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_has_view_all := public.check_capability(p_token, 'targets.view_all');
    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);

    IF NOT v_has_view_all THEN
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', wo.id,
            'employee_id', wo.employee_id,
            'employee_code', e.code,
            'employee_name', e.full_name,
            'target_month', wo.target_month,
            'target_year', wo.target_year,
            'sales_weight_percent', wo.sales_weight_percent,
            'collections_weight_percent', wo.collections_weight_percent,
            'visits_weight_percent', wo.visits_weight_percent,
            'new_customers_weight_percent', wo.new_customers_weight_percent,
            'attendance_weight_percent', wo.attendance_weight_percent,
            'override_reason', wo.override_reason,
            'is_active', wo.is_active
        )
        ORDER BY e.full_name
    ) INTO v_result
    FROM public.employee_weight_overrides wo
    JOIN public.employees e ON e.id = wo.employee_id
    WHERE wo.target_month = v_target_month
        AND wo.target_year = v_target_year
        AND (v_has_view_all OR wo.employee_id = ANY(v_subtree_ids) OR wo.employee_id = v_session.employee_id);

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_employee_weight_overrides IS 'الحصول على تجاوزات الأوزان (ضمن النطاق)';
