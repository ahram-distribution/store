-- ================================================================
-- P1-01: Add id (UUID) fields to get_employee_detail_data output
-- so drill-down navigation can pass UUIDs to detail page RPCs.
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_employee_detail_data(
    p_token uuid,
    p_employee_id uuid,
    p_from date,
    p_to date
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

    IF NOT public.is_upper_management(v_session.employee_id) THEN
        IF NOT (p_employee_id = ANY(public.get_visible_employee_ids(p_token))) THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN');
        END IF;
    END IF;

    WITH
    order_detail AS (
        SELECT jsonb_agg(jsonb_build_object(
            'id', o.id,
            'order_number', o.order_number,
            'total_amount', o.total_amount,
            'status', o.status,
            'submitted_at', o.submitted_at,
            'customer_name', COALESCE(o.snapshot_customer_name, ''),
            'customer_phone', COALESCE(o.snapshot_customer_phone, '')
        ) ORDER BY o.submitted_at DESC)
        FROM public.orders o
        WHERE public.resolve_employee_id(o.owner_id) = p_employee_id
          AND o.submitted_at::date >= p_from AND o.submitted_at::date <= p_to
          AND o.status NOT IN ('draft', 'cancelled')
    ),
    customer_detail AS (
        SELECT jsonb_agg(jsonb_build_object(
            'id', c.id,
            'code', c.code,
            'company_name', c.company_name,
            'created_at', c.created_at,
            'responsible_name', COALESCE(c.responsible_name, '')
        ) ORDER BY c.created_at DESC)
        FROM public.customers c
        WHERE public.resolve_employee_id(c.owner_id) = p_employee_id
          AND c.created_at::date >= p_from AND c.created_at::date <= p_to
    ),
    visit_detail AS (
        SELECT jsonb_agg(jsonb_build_object(
            'id', v.id,
            'code', v.code,
            'customer_name', COALESCE(c.company_name, ''),
            'check_in_at', v.check_in_at,
            'check_out_at', v.check_out_at,
            'status', v.status,
            'visit_result', COALESCE(v.visit_result, ''),
            'latitude', v.check_in_latitude,
            'longitude', v.check_in_longitude
        ) ORDER BY v.check_in_at DESC)
        FROM public.visits v
        LEFT JOIN public.customers c ON c.id = v.customer_id
        WHERE v.employee_id = p_employee_id
          AND v.check_in_at::date >= p_from AND v.check_in_at::date <= p_to
    ),
    collection_detail AS (
        SELECT jsonb_agg(jsonb_build_object(
            'id', col.id,
            'code', col.code,
            'amount', col.amount,
            'status', col.status,
            'created_at', col.created_at,
            'collected_at', col.collected_at,
            'customer_name', COALESCE(c.company_name, ''),
            'reference_number', COALESCE(col.reference_number, '')
        ) ORDER BY col.created_at DESC)
        FROM public.collections col
        LEFT JOIN public.customers c ON c.id = col.customer_id
        WHERE public.resolve_employee_id(col.owner_id) = p_employee_id
          AND col.created_at::date >= p_from AND col.created_at::date <= p_to
    )
    SELECT jsonb_build_object(
        'orders', COALESCE((SELECT * FROM order_detail), '[]'::jsonb),
        'customers', COALESCE((SELECT * FROM customer_detail), '[]'::jsonb),
        'visits', COALESCE((SELECT * FROM visit_detail), '[]'::jsonb),
        'collections', COALESCE((SELECT * FROM collection_detail), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_employee_detail_data TO authenticated;

COMMENT ON FUNCTION public.get_employee_detail_data IS 'السجلات الخام التي كوّنت كل KPI — طلبات، عملاء، زيارات، تحصيل';
