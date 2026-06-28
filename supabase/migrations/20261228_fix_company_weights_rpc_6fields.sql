-- ============================================================================
-- Fix: governed_upsert_company_monthly_target & get_governed_company_monthly_target
-- to handle all 6 weight fields (sales, orders, visits, new_customers,
-- collections, attendance) instead of only 4.
--
-- The table company_monthly_targets has 6 weight columns, but the RPCs
-- from 20260720_unify_upper_management_role.sql only used 4, causing
-- collections_weight_percent and attendance_weight_percent to silently
-- fall back to DEFAULT values on every save/read cycle.
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
        'collections_weight_percent', t.collections_weight_percent,
        'attendance_weight_percent', t.attendance_weight_percent,
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
    p_sales_weight_percent numeric DEFAULT 35, p_visits_weight_percent numeric DEFAULT 15,
    p_orders_weight_percent numeric DEFAULT 7.5, p_new_customers_weight_percent numeric DEFAULT 15,
    p_collections_weight_percent numeric DEFAULT 20, p_attendance_weight_percent numeric DEFAULT 15
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
    v_session app.sessions; v_existing_locked boolean; v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    IF (p_sales_weight_percent + p_visits_weight_percent + p_orders_weight_percent + p_new_customers_weight_percent + p_collections_weight_percent + p_attendance_weight_percent) != 100 THEN
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
         sales_weight_percent, visits_weight_percent, orders_weight_percent, new_customers_weight_percent,
         collections_weight_percent, attendance_weight_percent)
    VALUES
        (p_target_month, p_target_year, p_sales_target, p_visits_target, p_orders_target, p_new_customers_target,
         p_sales_weight_percent, p_visits_weight_percent, p_orders_weight_percent, p_new_customers_weight_percent,
         p_collections_weight_percent, p_attendance_weight_percent)
    ON CONFLICT (target_month, target_year)
    DO UPDATE SET
        sales_target = EXCLUDED.sales_target, visits_target = EXCLUDED.visits_target,
        orders_target = EXCLUDED.orders_target, new_customers_target = EXCLUDED.new_customers_target,
        sales_weight_percent = EXCLUDED.sales_weight_percent, visits_weight_percent = EXCLUDED.visits_weight_percent,
        orders_weight_percent = EXCLUDED.orders_weight_percent, new_customers_weight_percent = EXCLUDED.new_customers_weight_percent,
        collections_weight_percent = EXCLUDED.collections_weight_percent,
        attendance_weight_percent = EXCLUDED.attendance_weight_percent,
        updated_at = now()
    RETURNING jsonb_build_object(
        'id', id, 'target_month', target_month, 'target_year', target_year,
        'sales_target', sales_target, 'visits_target', visits_target, 'orders_target', orders_target,
        'new_customers_target', new_customers_target,
        'sales_weight_percent', sales_weight_percent, 'visits_weight_percent', visits_weight_percent,
        'orders_weight_percent', orders_weight_percent, 'new_customers_weight_percent', new_customers_weight_percent,
        'collections_weight_percent', collections_weight_percent,
        'attendance_weight_percent', attendance_weight_percent,
        'is_locked', is_locked
    ) INTO v_result;
    RETURN v_result;
END;
$function$;
