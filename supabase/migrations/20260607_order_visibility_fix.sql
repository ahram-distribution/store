-- ============================================================
-- Fix order visibility: scope orders by customer.owner_id
-- Business rule (approved): users see orders for customers they
-- own (via get_subtree_ids), unless they have customers.read cap
-- ============================================================

-- Fix 1: get_governed_orders — scope by customer ownership
CREATE OR REPLACE FUNCTION public.get_governed_orders(
    p_token uuid,
    p_search text DEFAULT NULL::text,
    p_status character varying DEFAULT NULL::character varying,
    p_customer_id uuid DEFAULT NULL::uuid,
    p_created_by uuid DEFAULT NULL::uuid,
    p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_result jsonb;
    v_emp_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

    IF v_session.identity_type = 'customer' THEN
        SELECT jsonb_agg(jsonb_build_object(
            'id', o.id, 'order_number', o.order_number,
            'customer_id', o.customer_id, 'customer_name_snapshot', c.company_name,
            'owner_type', o.owner_type, 'owner_id', o.owner_id,
            'status', o.status, 'subtotal', o.subtotal,
            'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
            'notes', o.notes, 'revision_number', o.revision_number,
            'created_by', o.created_by, 'created_by_employee_id', o.created_by,
            'created_by_name_snapshot', COALESCE(e.full_name, cu.company_name),
            'created_at', o.created_at, 'updated_at', o.updated_at,
            'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
            'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
        ) ORDER BY o.created_at DESC) INTO v_result
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN identities i ON i.id = o.created_by
        LEFT JOIN employees e ON e.identity_id = i.id AND i.identity_type = 'employee'
        LEFT JOIN customers cu ON cu.identity_id = i.id AND i.identity_type = 'customer'
        WHERE o.customer_id = v_session.customer_id
          AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%' OR c.company_name ILIKE '%' || p_search || '%')
          AND (p_status IS NULL OR o.status = p_status)
          AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
          AND (p_created_by IS NULL OR o.created_by = p_created_by)
          AND (p_date_from IS NULL OR o.created_at >= p_date_from)
          AND (p_date_to IS NULL OR o.created_at <= p_date_to);
        RETURN COALESCE(v_result, '[]'::jsonb);
    END IF;

    v_emp_id := v_session.employee_id;

    WITH available_customers AS (
        SELECT id FROM customers c
        WHERE app.has_capability('customers.read')
           OR c.owner_id = ANY(app.get_subtree_ids(v_emp_id))
    )
    SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_number', o.order_number,
        'customer_id', o.customer_id, 'customer_name_snapshot', c.company_name,
        'owner_type', o.owner_type, 'owner_id', o.owner_id,
        'status', o.status, 'subtotal', o.subtotal,
        'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
        'notes', o.notes, 'revision_number', o.revision_number,
        'created_by', o.created_by, 'created_by_employee_id', o.created_by,
        'created_by_name_snapshot', COALESCE(e.full_name, cu.company_name),
        'created_at', o.created_at, 'updated_at', o.updated_at,
        'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
        'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
    ) ORDER BY o.created_at DESC) INTO v_result
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN identities i ON i.id = o.created_by
    LEFT JOIN employees e ON e.identity_id = i.id AND i.identity_type = 'employee'
    LEFT JOIN customers cu ON cu.identity_id = i.id AND i.identity_type = 'customer'
    WHERE c.id IN (SELECT id FROM available_customers)
      AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%' OR c.company_name ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;


-- Fix 2: get_governed_order — replace hardcoded employee-tree logic with customer-ownership scoping
CREATE OR REPLACE FUNCTION public.get_governed_order(p_token uuid, p_id uuid)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_session app.sessions;
    v_order public.orders;
    v_emp_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

    PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

    SELECT * INTO v_order FROM public.orders WHERE id = p_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    IF v_session.identity_type = 'customer' THEN
        IF v_order.customer_id != v_session.customer_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
        RETURN v_order;
    END IF;

    v_emp_id := v_session.employee_id;

    IF app.has_capability('customers.read') THEN
        RETURN v_order;
    END IF;

    IF EXISTS(SELECT 1 FROM public.orders o
              JOIN public.customers c ON c.id = o.customer_id
              WHERE o.id = p_id
                AND c.owner_id = ANY(app.get_subtree_ids(v_emp_id))) THEN
        RETURN v_order;
    END IF;

    RAISE EXCEPTION 'FORBIDDEN';
END;
$function$;


-- Fix 3: get_customer_orders — add customer access check (defense-in-depth)
CREATE OR REPLACE FUNCTION public.get_customer_orders(
    p_token uuid,
    p_customer_id uuid,
    p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_result jsonb;
    v_emp_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

    IF v_session.identity_type = 'customer' THEN
        IF p_customer_id != v_session.customer_id THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN');
        END IF;
    ELSE
        v_emp_id := v_session.employee_id;
        IF NOT app.has_capability('customers.read')
           AND NOT EXISTS(SELECT 1 FROM customers c
                          WHERE c.id = p_customer_id
                            AND c.owner_id = ANY(app.get_subtree_ids(v_emp_id))) THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN');
        END IF;
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_number', o.order_number,
        'status', o.status, 'total_amount', o.total_amount,
        'created_at', o.created_at,
        'created_by_name', COALESCE(e.full_name, cu.company_name)
    ) ORDER BY o.created_at DESC) INTO v_result
    FROM orders o
    LEFT JOIN identities i ON i.id = o.created_by
    LEFT JOIN employees e ON e.identity_id = i.id AND i.identity_type = 'employee'
    LEFT JOIN customers cu ON cu.identity_id = i.id AND i.identity_type = 'customer'
    WHERE o.customer_id = p_customer_id
    LIMIT p_limit;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;
