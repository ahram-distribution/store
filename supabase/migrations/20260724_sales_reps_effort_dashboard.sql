-- ===============================================================
-- Sales Representatives Effort Dashboard
-- Aggregated performance data per employee for a given time range.
-- Uses resolve_employee_id() for identity resolution.
-- ===============================================================

CREATE OR REPLACE FUNCTION public.get_sales_reps_effort(
    p_token uuid,
    p_from date,
    p_to date,
    p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_ids uuid[];
    v_total_days int;
    v_result jsonb;
    v_employee record;
    v_emp_data jsonb;
    v_emp_list jsonb;
    v_summary jsonb;
    v_top jsonb;
    v_worst jsonb;
    v_avg_score numeric;
    v_total_sales numeric;
    v_total_orders int;
    v_total_visits int;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF public.check_capability(p_token, 'attendance.view_all') THEN
        SELECT array_agg(e.id) INTO v_employee_ids FROM public.employees e WHERE e.is_active = true;
    ELSE
        v_employee_ids := public.get_visible_employee_ids(p_token);
    END IF;

    IF v_employee_ids IS NULL OR array_length(v_employee_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('employees', '[]'::jsonb, 'summary', jsonb_build_object(
            'total_employees', 0, 'total_sales', 0, 'total_orders', 0, 'total_visits', 0,
            'avg_performance_score', 0
        ));
    END IF;

    v_total_days := (p_to - p_from) + 1;

    WITH employee_sessions AS (
        SELECT wds.employee_id,
            COUNT(DISTINCT wds.date)::int AS active_days,
            MAX(wds.start_time) AS last_activity,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60), 0)::int AS total_minutes,
            COALESCE(SUM(wds.total_distance_meters), 0)::int AS total_distance
        FROM public.workday_sessions wds
        WHERE wds.employee_id = ANY(v_employee_ids)
          AND wds.date >= p_from AND wds.date <= p_to
          AND wds.status = 'completed'
        GROUP BY wds.employee_id
    ),
    emp_sales AS (
        SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
            COUNT(*)::int AS order_count,
            COALESCE(SUM(o.total_amount), 0) AS sales_value,
            COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled_count
        FROM public.orders o
        WHERE public.resolve_employee_id(o.owner_id) = ANY(v_employee_ids)
          AND o.created_at::date >= p_from AND o.created_at::date <= p_to
        GROUP BY public.resolve_employee_id(o.owner_id)
    ),
    emp_customers AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            COUNT(*)::int AS new_customers
        FROM public.customers c
        WHERE public.resolve_employee_id(c.owner_id) = ANY(v_employee_ids)
          AND c.created_at::date >= p_from AND c.created_at::date <= p_to
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    emp_total_customers AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            COUNT(*)::int AS total_customers
        FROM public.customers c
        WHERE public.resolve_employee_id(c.owner_id) = ANY(v_employee_ids)
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    emp_visits AS (
        SELECT v.employee_id,
            COUNT(*)::int AS total_visits,
            COUNT(*) FILTER (WHERE v.status = 'completed')::int AS successful_visits,
            COUNT(*) FILTER (WHERE v.status != 'completed')::int AS incomplete_visits
        FROM public.visits v
        WHERE v.employee_id = ANY(v_employee_ids)
          AND v.check_in_at::date >= p_from AND v.check_in_at::date <= p_to
        GROUP BY v.employee_id
    ),
    emp_targets AS (
        SELECT emt.employee_id,
            COALESCE(SUM(emt.sales_target), 0) AS sales_target,
            COALESCE(SUM(emt.orders_target), 0) AS orders_target
        FROM public.employee_monthly_targets emt
        WHERE emt.employee_id = ANY(v_employee_ids)
          AND (emt.target_year * 100 + emt.target_month) BETWEEN (EXTRACT(YEAR FROM p_from) * 100 + EXTRACT(MONTH FROM p_from))
          AND (EXTRACT(YEAR FROM p_to) * 100 + EXTRACT(MONTH FROM p_to))
        GROUP BY emt.employee_id
    )
    SELECT jsonb_agg(jsonb_build_object(
        'employee_id', e.id,
        'name', e.full_name,
        'code', e.code,
        'role_name', (SELECT r.name FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = e.id LIMIT 1),
        'active_days', COALESCE(es.active_days, 0),
        'total_days_in_range', v_total_days,
        'last_activity', es.last_activity,
        'status', CASE WHEN es.last_activity IS NOT NULL AND es.last_activity >= now() - interval '7 days' THEN 'active' ELSE 'idle' END,
        'total_minutes', COALESCE(es.total_minutes, 0),
        'total_distance', COALESCE(es.total_distance, 0),
        'sales', jsonb_build_object(
            'total_value', COALESCE(s.sales_value, 0),
            'order_count', COALESCE(s.order_count, 0),
            'avg_order_value', CASE WHEN COALESCE(s.order_count, 0) > 0 THEN ROUND((COALESCE(s.sales_value, 0) / s.order_count)::numeric, 2) ELSE 0 END
        ),
        'orders', jsonb_build_object(
            'total', COALESCE(s.order_count, 0),
            'completed', GREATEST(COALESCE(s.order_count, 0) - COALESCE(s.cancelled_count, 0), 0),
            'cancelled', COALESCE(s.cancelled_count, 0)
        ),
        'customers', jsonb_build_object(
            'new_count', COALESCE(ec.new_customers, 0),
            'total_linked', COALESCE(etc.total_customers, 0)
        ),
        'visits', jsonb_build_object(
            'total', COALESCE(ev.total_visits, 0),
            'successful', COALESCE(ev.successful_visits, 0),
            'incomplete', COALESCE(ev.incomplete_visits, 0),
            'success_rate', CASE WHEN COALESCE(ev.total_visits, 0) > 0 THEN ROUND((COALESCE(ev.successful_visits, 0)::numeric / ev.total_visits) * 100, 1) ELSE 0 END
        ),
        'targets', jsonb_build_object(
            'sales_target', COALESCE(t.sales_target, 0),
            'sales_actual', COALESCE(s.sales_value, 0),
            'achievement_pct', CASE WHEN COALESCE(t.sales_target, 0) > 0 THEN ROUND((COALESCE(s.sales_value, 0) / t.sales_target * 100)::numeric, 1) ELSE 0 END,
            'orders_target', COALESCE(t.orders_target, 0),
            'orders_actual', COALESCE(s.order_count, 0)
        ),
        'performance_score', ROUND((
            CASE WHEN COALESCE(es.active_days, 0) > 0 THEN LEAST((es.active_days::numeric / v_total_days) * 40, 40) ELSE 0 END +
            CASE WHEN COALESCE(t.sales_target, 0) > 0 THEN LEAST((COALESCE(s.sales_value, 0) / t.sales_target) * 30, 30) ELSE 0 END +
            CASE WHEN COALESCE(ev.total_visits, 0) > 0 THEN LEAST((COALESCE(ev.successful_visits, 0)::numeric / ev.total_visits) * 20, 20) ELSE 0 END +
            CASE WHEN COALESCE(ec.new_customers, 0) > 0 THEN LEAST(ec.new_customers::numeric * 5, 10) ELSE 0 END
        )::numeric, 1)
    ) ORDER BY
        CASE WHEN es.last_activity IS NOT NULL AND es.last_activity >= now() - interval '7 days' THEN 0 ELSE 1 END,
        COALESCE(s.sales_value, 0) DESC
    ) INTO v_emp_list
    FROM public.employees e
    LEFT JOIN employee_sessions es ON es.employee_id = e.id
    LEFT JOIN emp_sales s ON s.employee_id = e.id
    LEFT JOIN emp_customers ec ON ec.employee_id = e.id
    LEFT JOIN emp_total_customers etc ON etc.employee_id = e.id
    LEFT JOIN emp_visits ev ON ev.employee_id = e.id
    LEFT JOIN emp_targets t ON t.employee_id = e.id
    WHERE e.id = ANY(v_employee_ids)
      AND (p_search IS NULL OR p_search = '' OR e.full_name ILIKE '%' || p_search || '%' OR e.code ILIKE '%' || p_search || '%');

    -- Summary stats
    SELECT
        ROUND(AVG(score)::numeric, 1),
        COALESCE(SUM((d->'sales'->>'total_value')::numeric), 0),
        COALESCE(SUM((d->'orders'->>'total')::int), 0),
        COALESCE(SUM((d->'visits'->>'total')::int), 0)
    INTO v_avg_score, v_total_sales, v_total_orders, v_total_visits
    FROM jsonb_array_elements(COALESCE(v_emp_list, '[]'::jsonb)) AS d,
    LATERAL (
        SELECT (
            CASE WHEN (d->>'active_days')::int > 0 THEN LEAST(((d->>'active_days')::numeric / v_total_days) * 40, 40) ELSE 0 END +
            CASE WHEN ((d->'targets'->>'sales_target')::numeric) > 0 THEN LEAST(((d->'targets'->>'sales_actual')::numeric / NULLIF((d->'targets'->>'sales_target')::numeric, 0)) * 30, 30) ELSE 0 END +
            CASE WHEN ((d->'visits'->>'total')::int) > 0 THEN LEAST(((d->'visits'->>'successful')::numeric / NULLIF((d->'visits'->>'total')::numeric, 0)) * 20, 20) ELSE 0 END +
            CASE WHEN ((d->'customers'->>'new_count')::int) > 0 THEN LEAST(((d->'customers'->>'new_count')::int * 5)::numeric, 10) ELSE 0 END
        ) AS score
    ) AS scores;

    -- Top performer
    SELECT jsonb_build_object('employee_id', d->>'employee_id', 'name', d->>'name', 'score', (d->>'performance_score')::numeric)
    INTO v_top
    FROM jsonb_array_elements(COALESCE(v_emp_list, '[]'::jsonb)) AS d
    ORDER BY (d->>'performance_score')::numeric DESC LIMIT 1;

    -- Worst performer
    SELECT jsonb_build_object('employee_id', d->>'employee_id', 'name', d->>'name', 'score', (d->>'performance_score')::numeric)
    INTO v_worst
    FROM jsonb_array_elements(COALESCE(v_emp_list, '[]'::jsonb)) AS d
    ORDER BY (d->>'performance_score')::numeric ASC LIMIT 1;

    v_summary := jsonb_build_object(
        'total_employees', COALESCE(jsonb_array_length(v_emp_list), 0),
        'total_sales', v_total_sales,
        'total_orders', v_total_orders,
        'total_visits', v_total_visits,
        'avg_performance_score', COALESCE(v_avg_score, 0),
        'top_performer', v_top,
        'worst_performer', COALESCE(v_worst, jsonb_build_object('score', 0))
    );

    RETURN jsonb_build_object('employees', COALESCE(v_emp_list, '[]'::jsonb), 'summary', v_summary);
END;
$function$;
