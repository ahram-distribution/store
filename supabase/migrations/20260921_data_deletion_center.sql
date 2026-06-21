-- ============================================================================
-- Data Deletion Center
-- Hard-delete module for upper management + Super Admin only
-- ============================================================================

-- 0. Capability --------------------------------------------------------------

INSERT INTO public.capabilities (code, name, description, "group")
SELECT 'data.deletion_center', 'مركز الحذف', 'Hard-delete records from any entity', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'data.deletion_center');

-- 1. Audit log table ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.deletion_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.employees(id),
    entity_type text NOT NULL,
    entity_ids uuid[] NOT NULL,
    record_count int NOT NULL,
    related_tables jsonb,
    deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dal_employee_id ON public.deletion_audit_log (employee_id);
CREATE INDEX IF NOT EXISTS idx_dal_entity_type ON public.deletion_audit_log (entity_type);
CREATE INDEX IF NOT EXISTS idx_dal_deleted_at ON public.deletion_audit_log (deleted_at);

COMMENT ON TABLE public.deletion_audit_log IS 'Audit trail for all hard deletions via Data Deletion Center';

-- 2. Search RPCs -------------------------------------------------------------

-- 2a. Search employees
CREATE OR REPLACE FUNCTION public.governed_deletion_search_employees(
    p_token uuid,
    p_search text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL
)
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
        'id', e.id,
        'name', e.full_name,
        'code', e.code,
        'status', CASE WHEN e.is_active THEN 'active' ELSE 'inactive' END,
        'created_at', e.created_at,
        'related_counts', jsonb_build_object(
            'orders', (SELECT COUNT(*)::int FROM public.orders o WHERE o.owner_id = e.id OR o.created_by = e.id),
            'customers', (SELECT COUNT(*)::int FROM public.customers c WHERE c.owner_id = e.id),
            'visits', (SELECT COUNT(*)::int FROM public.visits v WHERE v.employee_id = e.id),
            'workday_sessions', (SELECT COUNT(*)::int FROM public.workday_sessions ws WHERE ws.employee_id = e.id),
            'tracking_points', (SELECT COUNT(*)::int FROM public.tracking_points tp WHERE tp.employee_id = e.id),
            'collections', (SELECT COUNT(*)::int FROM public.collections cl WHERE cl.owner_id = e.id OR cl.created_by = e.id),
            'delivery_tracking', (SELECT COUNT(*)::int FROM public.delivery_tracking dt WHERE dt.assigned_to = e.id)
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

-- 2b. Search customers
CREATE OR REPLACE FUNCTION public.governed_deletion_search_customers(
    p_token uuid,
    p_search text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL,
    p_gov text DEFAULT NULL,
    p_company_id uuid DEFAULT NULL,
    p_rep_id uuid DEFAULT NULL
)
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
        'id', c.id,
        'name', c.company_name,
        'code', c.code,
        'status', CASE WHEN c.is_active THEN 'active' ELSE 'inactive' END,
        'created_at', c.created_at,
        'owner_name', (SELECT e.full_name FROM public.employees e WHERE e.id = c.owner_id),
        'governorate', (SELECT ca.governorate FROM public.customer_addresses ca WHERE ca.customer_id = c.id LIMIT 1),
        'related_counts', jsonb_build_object(
            'orders', (SELECT COUNT(*)::int FROM public.orders o WHERE o.customer_id = c.id),
            'visits', (SELECT COUNT(*)::int FROM public.visits v WHERE v.customer_id = c.id),
            'collections', (SELECT COUNT(*)::int FROM public.collections cl WHERE cl.customer_id = c.id),
            'returns', (SELECT COUNT(*)::int FROM public.returns r WHERE r.customer_id = c.id),
            'addresses', (SELECT COUNT(*)::int FROM public.customer_addresses ca WHERE ca.customer_id = c.id),
            'contacts', (SELECT COUNT(*)::int FROM public.customer_contacts cc WHERE cc.customer_id = c.id),
            'credit_accounts', (SELECT COUNT(*)::int FROM public.customer_credit_accounts cca WHERE cca.customer_id = c.id)
        )
    ) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_data
    FROM public.customers c
    WHERE (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR (CASE WHEN p_status = 'active' THEN c.is_active = true ELSE c.is_active = false END))
      AND (p_date_from IS NULL OR c.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR c.created_at < (p_date_to + 1)::timestamptz)
      AND (p_gov IS NULL OR EXISTS (SELECT 1 FROM public.customer_addresses ca WHERE ca.customer_id = c.id AND ca.governorate = p_gov))
      AND (p_rep_id IS NULL OR c.owner_id = p_rep_id);

    SELECT COUNT(*)::int INTO v_total
    FROM public.customers c
    WHERE (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR (CASE WHEN p_status = 'active' THEN c.is_active = true ELSE c.is_active = false END))
      AND (p_date_from IS NULL OR c.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR c.created_at < (p_date_to + 1)::timestamptz)
      AND (p_gov IS NULL OR EXISTS (SELECT 1 FROM public.customer_addresses ca WHERE ca.customer_id = c.id AND ca.governorate = p_gov))
      AND (p_rep_id IS NULL OR c.owner_id = p_rep_id);

    RETURN jsonb_build_object('data', v_data, 'total', v_total);
END;
$function$;

-- 2c. Search products
CREATE OR REPLACE FUNCTION public.governed_deletion_search_products(
    p_token uuid,
    p_search text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL,
    p_company_id uuid DEFAULT NULL
)
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
        'id', p.id,
        'name', p.product_name,
        'code', p.legacy_code,
        'status', CASE WHEN p.is_active THEN 'active' ELSE 'inactive' END,
        'created_at', p.created_at,
        'company_name', (SELECT cp.company_name FROM public.companies cp WHERE cp.id = p.company_id),
        'related_counts', jsonb_build_object(
            'order_items', (SELECT COUNT(*)::int FROM public.order_items oi WHERE oi.product_id = p.id),
            'inventory', (SELECT COUNT(*)::int FROM public.inventory i WHERE i.product_id = p.id),
            'product_units', (SELECT COUNT(*)::int FROM public.product_units pu WHERE pu.product_id = p.id),
            'return_items', (SELECT COUNT(*)::int FROM public.return_items ri WHERE ri.product_id = p.id),
            'daily_deal_items', (SELECT COUNT(*)::int FROM public.daily_deal_items ddi WHERE ddi.product_id = p.id),
            'flash_offer_items', (SELECT COUNT(*)::int FROM public.flash_offer_items foi WHERE foi.product_id = p.id),
            'auction_items', (SELECT COUNT(*)::int FROM public.auction_items ai WHERE ai.product_id = p.id)
        )
    ) ORDER BY p.created_at DESC), '[]'::jsonb)
    INTO v_data
    FROM public.products p
    WHERE (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR (CASE WHEN p_status = 'active' THEN p.is_active = true ELSE p.is_active = false END))
      AND (p_date_from IS NULL OR p.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR p.created_at < (p_date_to + 1)::timestamptz)
      AND (p_company_id IS NULL OR p.company_id = p_company_id);

    SELECT COUNT(*)::int INTO v_total
    FROM public.products p
    WHERE (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR (CASE WHEN p_status = 'active' THEN p.is_active = true ELSE p.is_active = false END))
      AND (p_date_from IS NULL OR p.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR p.created_at < (p_date_to + 1)::timestamptz)
      AND (p_company_id IS NULL OR p.company_id = p_company_id);

    RETURN jsonb_build_object('data', v_data, 'total', v_total);
END;
$function$;

-- 2d. Search companies
CREATE OR REPLACE FUNCTION public.governed_deletion_search_companies(
    p_token uuid,
    p_search text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL
)
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
        'id', c.id,
        'name', c.company_name,
        'code', c.legacy_code,
        'status', CASE WHEN c.is_active THEN 'active' ELSE 'inactive' END,
        'created_at', c.created_at,
        'related_counts', jsonb_build_object(
            'products', (SELECT COUNT(*)::int FROM public.products p WHERE p.company_id = c.id),
            'customers', (SELECT COUNT(*)::int FROM public.customers cu WHERE cu.owner_id = c.id OR cu.location_id IN (SELECT id FROM public.locations l WHERE l.company_id = c.id))
        )
    ) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_data
    FROM public.companies c
    WHERE (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.legacy_code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR (CASE WHEN p_status = 'active' THEN c.is_active = true ELSE c.is_active = false END))
      AND (p_date_from IS NULL OR c.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR c.created_at < (p_date_to + 1)::timestamptz);

    SELECT COUNT(*)::int INTO v_total
    FROM public.companies c
    WHERE (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.legacy_code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR (CASE WHEN p_status = 'active' THEN c.is_active = true ELSE c.is_active = false END))
      AND (p_date_from IS NULL OR c.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR c.created_at < (p_date_to + 1)::timestamptz);

    RETURN jsonb_build_object('data', v_data, 'total', v_total);
END;
$function$;

-- 2e. Search orders
CREATE OR REPLACE FUNCTION public.governed_deletion_search_orders(
    p_token uuid,
    p_search text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL,
    p_customer_id uuid DEFAULT NULL,
    p_rep_id uuid DEFAULT NULL
)
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
            'preparation_records', (SELECT COUNT(*)::int FROM public.preparation_records pr WHERE pr.order_id = o.id),
            'credit_invoices', (SELECT COUNT(*)::int FROM public.credit_invoices ci WHERE ci.order_id = o.id)
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

-- 2f. Search collections
CREATE OR REPLACE FUNCTION public.governed_deletion_search_collections(
    p_token uuid,
    p_search text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL,
    p_customer_id uuid DEFAULT NULL
)
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
        'id', cl.id,
        'name', cl.code,
        'code', cl.code,
        'status', cl.status,
        'created_at', cl.created_at,
        'customer_name', (SELECT cu.company_name FROM public.customers cu WHERE cu.id = cl.customer_id),
        'amount', cl.amount,
        'related_counts', jsonb_build_object(
            'treasury_transactions', (SELECT COUNT(*)::int FROM public.treasury_transactions tt WHERE tt.reference_type = 'collection' AND tt.reference_id = cl.id)
        )
    ) ORDER BY cl.created_at DESC), '[]'::jsonb)
    INTO v_data
    FROM public.collections cl
    WHERE (p_search IS NULL OR cl.code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR cl.status = p_status)
      AND (p_date_from IS NULL OR cl.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR cl.created_at < (p_date_to + 1)::timestamptz)
      AND (p_customer_id IS NULL OR cl.customer_id = p_customer_id);

    SELECT COUNT(*)::int INTO v_total
    FROM public.collections cl
    WHERE (p_search IS NULL OR cl.code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR cl.status = p_status)
      AND (p_date_from IS NULL OR cl.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR cl.created_at < (p_date_to + 1)::timestamptz)
      AND (p_customer_id IS NULL OR cl.customer_id = p_customer_id);

    RETURN jsonb_build_object('data', v_data, 'total', v_total);
END;
$function$;

-- 2g. Search visits
CREATE OR REPLACE FUNCTION public.governed_deletion_search_visits(
    p_token uuid,
    p_search text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL,
    p_rep_id uuid DEFAULT NULL,
    p_customer_id uuid DEFAULT NULL
)
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
        'id', v.id,
        'name', v.code,
        'code', v.code,
        'status', v.status,
        'created_at', v.created_at,
        'employee_name', (SELECT e.full_name FROM public.employees e WHERE e.id = v.employee_id),
        'customer_name', (SELECT cu.company_name FROM public.customers cu WHERE cu.id = v.customer_id),
        'related_counts', jsonb_build_object(
            'visit_links', (SELECT COUNT(*)::int FROM public.visit_links vl WHERE vl.visit_id = v.id)
        )
    ) ORDER BY v.created_at DESC), '[]'::jsonb)
    INTO v_data
    FROM public.visits v
    WHERE (p_search IS NULL OR v.code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR v.status = p_status)
      AND (p_date_from IS NULL OR v.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR v.created_at < (p_date_to + 1)::timestamptz)
      AND (p_rep_id IS NULL OR v.employee_id = p_rep_id)
      AND (p_customer_id IS NULL OR v.customer_id = p_customer_id);

    SELECT COUNT(*)::int INTO v_total
    FROM public.visits v
    WHERE (p_search IS NULL OR v.code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR v.status = p_status)
      AND (p_date_from IS NULL OR v.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR v.created_at < (p_date_to + 1)::timestamptz)
      AND (p_rep_id IS NULL OR v.employee_id = p_rep_id)
      AND (p_customer_id IS NULL OR v.customer_id = p_customer_id);

    RETURN jsonb_build_object('data', v_data, 'total', v_total);
END;
$function$;

-- 2h. Search workday sessions
CREATE OR REPLACE FUNCTION public.governed_deletion_search_workdays(
    p_token uuid,
    p_search text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL,
    p_rep_id uuid DEFAULT NULL
)
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
        'id', ws.id,
        'name', ws.date::text || ' - ' || COALESCE((SELECT e.full_name FROM public.employees e WHERE e.id = ws.employee_id), ''),
        'code', ws.date::text,
        'status', ws.status,
        'created_at', ws.created_at,
        'employee_name', (SELECT e.full_name FROM public.employees e WHERE e.id = ws.employee_id),
        'date', ws.date,
        'related_counts', jsonb_build_object(
            'tracking_points', (SELECT COUNT(*)::int FROM public.tracking_points tp WHERE tp.session_id = ws.id),
            'workday_breaks', (SELECT COUNT(*)::int FROM public.workday_breaks wb WHERE wb.session_id = ws.id),
            'visit_links', (SELECT COUNT(*)::int FROM public.visit_links vl WHERE vl.session_id = ws.id)
        )
    ) ORDER BY ws.date DESC), '[]'::jsonb)
    INTO v_data
    FROM public.workday_sessions ws
    WHERE (p_search IS NULL OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = ws.employee_id AND e.full_name ILIKE '%' || p_search || '%'))
      AND (p_status IS NULL OR ws.status = p_status)
      AND (p_date_from IS NULL OR ws.date >= p_date_from::date)
      AND (p_date_to IS NULL OR ws.date <= p_date_to::date)
      AND (p_rep_id IS NULL OR ws.employee_id = p_rep_id);

    SELECT COUNT(*)::int INTO v_total
    FROM public.workday_sessions ws
    WHERE (p_search IS NULL OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = ws.employee_id AND e.full_name ILIKE '%' || p_search || '%'))
      AND (p_status IS NULL OR ws.status = p_status)
      AND (p_date_from IS NULL OR ws.date >= p_date_from::date)
      AND (p_date_to IS NULL OR ws.date <= p_date_to::date)
      AND (p_rep_id IS NULL OR ws.employee_id = p_rep_id);

    RETURN jsonb_build_object('data', v_data, 'total', v_total);
END;
$function$;

-- 2i. Search tracking points
CREATE OR REPLACE FUNCTION public.governed_deletion_search_tracking(
    p_token uuid,
    p_search text DEFAULT NULL,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL,
    p_rep_id uuid DEFAULT NULL
)
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

    SELECT COALESCE(jsonb_agg(subq ORDER BY subq.recorded_at DESC), '[]'::jsonb)
    INTO v_data
    FROM (
        SELECT jsonb_build_object(
            'id', tp.id,
            'name', tp.recorded_at::text,
            'code', tp.id::text,
            'status', tp.point_type,
            'created_at', tp.recorded_at,
            'employee_name', (SELECT e.full_name FROM public.employees e WHERE e.id = tp.employee_id),
            'recorded_at', tp.recorded_at,
            'session_date', (SELECT ws.date::text FROM public.workday_sessions ws WHERE ws.id = tp.session_id),
            'related_counts', '{}'::jsonb
        ) AS row_data,
        tp.recorded_at
        FROM public.tracking_points tp
        WHERE (p_search IS NULL OR tp.id::text ILIKE '%' || p_search || '%')
          AND (p_date_from IS NULL OR tp.recorded_at >= p_date_from::timestamptz)
          AND (p_date_to IS NULL OR tp.recorded_at < (p_date_to + 1)::timestamptz)
          AND (p_rep_id IS NULL OR tp.employee_id = p_rep_id)
        ORDER BY tp.recorded_at DESC
        LIMIT 1000
    ) subq;

    SELECT COUNT(*)::int INTO v_total
    FROM public.tracking_points tp
    WHERE (p_search IS NULL OR tp.id::text ILIKE '%' || p_search || '%')
      AND (p_date_from IS NULL OR tp.recorded_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR tp.recorded_at < (p_date_to + 1)::timestamptz)
      AND (p_rep_id IS NULL OR tp.employee_id = p_rep_id);

    RETURN jsonb_build_object('data', v_data, 'total', v_total);
END;
$function$;

-- 3. Execute RPCs ------------------------------------------------------------

-- 3a. Execute delete employees
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_employees(
    p_token uuid,
    p_ids uuid[],
    p_dry_run boolean DEFAULT true
)
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
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT jsonb_build_object(
        'app_sessions', (SELECT COUNT(*)::int FROM app.sessions s WHERE s.employee_id = ANY(p_ids)),
        'employee_roles', (SELECT COUNT(*)::int FROM public.employee_roles er WHERE er.employee_id = ANY(p_ids)),
        'employee_capabilities', (SELECT COUNT(*)::int FROM public.employee_capabilities ec WHERE ec.employee_id = ANY(p_ids)),
        'employee_monthly_targets', (SELECT COUNT(*)::int FROM public.employee_monthly_targets emt WHERE emt.employee_id = ANY(p_ids)),
        'employee_weight_overrides', (SELECT COUNT(*)::int FROM public.employee_weight_overrides ewo WHERE ewo.employee_id = ANY(p_ids)),
        'employee_work_policies', (SELECT COUNT(*)::int FROM public.employee_work_policies ewp WHERE ewp.employee_id = ANY(p_ids)),
        'employee_advances', (SELECT COUNT(*)::int FROM public.employee_advances ea WHERE ea.employee_id = ANY(p_ids) OR ea.created_by = ANY(p_ids) OR ea.approved_by = ANY(p_ids)),
        'tracking_points', (SELECT COUNT(*)::int FROM public.tracking_points tp WHERE tp.employee_id = ANY(p_ids)),
        'workday_sessions', (SELECT COUNT(*)::int FROM public.workday_sessions ws WHERE ws.employee_id = ANY(p_ids)),
        'workday_breaks', (SELECT COUNT(*)::int FROM public.workday_breaks wb WHERE wb.employee_id = ANY(p_ids)),
        'visits', (SELECT COUNT(*)::int FROM public.visits v WHERE v.employee_id = ANY(p_ids)),
        'attendance_audit_log', (SELECT COUNT(*)::int FROM public.attendance_audit_log aal WHERE aal.employee_id = ANY(p_ids)),
        'session_recovery_log', (SELECT COUNT(*)::int FROM public.session_recovery_log srl WHERE srl.employee_id = ANY(p_ids)),
        'delivery_tracking_assigned_to', (SELECT COUNT(*)::int FROM public.delivery_tracking dt WHERE dt.assigned_to = ANY(p_ids)),
        'delivery_tracking_assigned_by', (SELECT COUNT(*)::int FROM public.delivery_tracking dt WHERE dt.assigned_by = ANY(p_ids)),
        'collections_created_by', (SELECT COUNT(*)::int FROM public.collections cl WHERE cl.created_by = ANY(p_ids)),
        'collections_approved_by', (SELECT COUNT(*)::int FROM public.collections cl WHERE cl.approved_by = ANY(p_ids)),
        'customer_credit_accounts', (SELECT COUNT(*)::int FROM public.customer_credit_accounts cca WHERE cca.activated_by = ANY(p_ids)),
        'customer_credit_ledger', (SELECT COUNT(*)::int FROM public.customer_credit_ledger ccl WHERE ccl.created_by = ANY(p_ids)),
        'customers_owner', (SELECT COUNT(*)::int FROM public.customers c WHERE c.owner_id = ANY(p_ids)),
        'orders', (SELECT COUNT(*)::int FROM public.orders o WHERE o.owner_id = ANY(p_ids) OR o.created_by = ANY(p_ids)),
        'preparation_records', (SELECT COUNT(*)::int FROM public.preparation_records pr WHERE pr.started_by = ANY(p_ids) OR pr.completed_by = ANY(p_ids) OR pr.cancelled_by = ANY(p_ids) OR pr.reviewed_by = ANY(p_ids)),
        'returns', (SELECT COUNT(*)::int FROM public.returns r WHERE r.created_by = ANY(p_ids)),
        'return_inspection', (SELECT COUNT(*)::int FROM public.return_inspection ri WHERE ri.inspected_by = ANY(p_ids)),
        'treasury_transactions', (SELECT COUNT(*)::int FROM public.treasury_transactions tt WHERE tt.created_by = ANY(p_ids)),
        'expenses', (SELECT COUNT(*)::int FROM public.expenses ex WHERE ex.created_by = ANY(p_ids) OR ex.approved_by = ANY(p_ids))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    -- Check if any critical records would block deletion
    IF (v_related->>'orders')::int > 0 OR (v_related->>'customers_owner')::int > 0 OR (v_related->>'collections_created_by')::int > 0 THEN
        RETURN jsonb_build_object('error', 'HAS_CRITICAL_RELATIONS', 'related', v_related);
    END IF;

    -- Delete in FK order
    DELETE FROM app.sessions WHERE employee_id = ANY(p_ids);
    DELETE FROM public.session_recovery_log WHERE employee_id = ANY(p_ids);
    DELETE FROM public.attendance_audit_log WHERE employee_id = ANY(p_ids);
    DELETE FROM public.tracking_points WHERE employee_id = ANY(p_ids);
    DELETE FROM public.workday_breaks WHERE employee_id = ANY(p_ids);
    DELETE FROM public.visit_links WHERE session_id IN (SELECT id FROM public.workday_sessions WHERE employee_id = ANY(p_ids));
    DELETE FROM public.visits WHERE employee_id = ANY(p_ids);
    DELETE FROM public.workday_sessions WHERE employee_id = ANY(p_ids);
    DELETE FROM public.delivery_tracking WHERE assigned_to = ANY(p_ids) OR assigned_by = ANY(p_ids);
    DELETE FROM public.preparation_records WHERE started_by = ANY(p_ids) OR completed_by = ANY(p_ids) OR cancelled_by = ANY(p_ids) OR reviewed_by = ANY(p_ids);
    DELETE FROM public.return_inspection WHERE inspected_by = ANY(p_ids);
    DELETE FROM public.returns WHERE created_by = ANY(p_ids);
    DELETE FROM public.treasury_transactions WHERE created_by = ANY(p_ids);
    DELETE FROM public.collections WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids);
    DELETE FROM public.customer_credit_ledger WHERE created_by = ANY(p_ids);
    DELETE FROM public.customer_credit_accounts WHERE activated_by = ANY(p_ids);
    DELETE FROM public.expenses WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids);
    DELETE FROM public.employee_monthly_targets WHERE employee_id = ANY(p_ids);
    DELETE FROM public.employee_weight_overrides WHERE employee_id = ANY(p_ids);
    DELETE FROM public.employee_work_policies WHERE employee_id = ANY(p_ids);
    DELETE FROM public.employee_advances WHERE employee_id = ANY(p_ids) OR created_by = ANY(p_ids) OR approved_by = ANY(p_ids);
    DELETE FROM public.employee_capabilities WHERE employee_id = ANY(p_ids);
    DELETE FROM public.employee_roles WHERE employee_id = ANY(p_ids);

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
END;
$function$;

-- 3b. Execute delete customers
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_customers(
    p_token uuid,
    p_ids uuid[],
    p_dry_run boolean DEFAULT true
)
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
        'credit_invoices', (SELECT COUNT(*)::int FROM public.credit_invoices ci WHERE ci.customer_id = ANY(p_ids)),
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
    DELETE FROM public.credit_invoice_cheques WHERE invoice_id IN (SELECT id FROM public.credit_invoices WHERE customer_id = ANY(p_ids));
    DELETE FROM public.credit_invoices WHERE customer_id = ANY(p_ids);
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

-- 3c. Execute delete products
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_products(
    p_token uuid,
    p_ids uuid[],
    p_dry_run boolean DEFAULT true
)
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
    v_prod_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT jsonb_build_object(
        'order_items', (SELECT COUNT(*)::int FROM public.order_items oi WHERE oi.product_id = ANY(p_ids)),
        'inventory', (SELECT COUNT(*)::int FROM public.inventory i WHERE i.product_id = ANY(p_ids)),
        'product_units', (SELECT COUNT(*)::int FROM public.product_units pu WHERE pu.product_id = ANY(p_ids)),
        'return_items', (SELECT COUNT(*)::int FROM public.return_items ri WHERE ri.product_id = ANY(p_ids)),
        'daily_deal_items', (SELECT COUNT(*)::int FROM public.daily_deal_items ddi WHERE ddi.product_id = ANY(p_ids)),
        'flash_offer_items', (SELECT COUNT(*)::int FROM public.flash_offer_items foi WHERE foi.product_id = ANY(p_ids)),
        'auction_items', (SELECT COUNT(*)::int FROM public.auction_items ai WHERE ai.product_id = ANY(p_ids))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    IF (v_related->>'order_items')::int > 0 THEN
        RETURN jsonb_build_object('error', 'HAS_ORDER_ITEMS', 'related', v_related);
    END IF;

    DELETE FROM public.inventory WHERE product_id = ANY(p_ids);
    DELETE FROM public.product_units WHERE product_id = ANY(p_ids);
    DELETE FROM public.daily_deal_items WHERE product_id = ANY(p_ids);
    DELETE FROM public.flash_offer_items WHERE product_id = ANY(p_ids);
    DELETE FROM public.auction_items WHERE product_id = ANY(p_ids);

    v_deleted_count := 0;
    FOREACH v_prod_id IN ARRAY p_ids LOOP
        DELETE FROM public.products WHERE id = v_prod_id;
        IF FOUND THEN v_deleted_count := v_deleted_count + 1; END IF;
    END LOOP;

    INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
    VALUES (v_session.employee_id, 'products', p_ids, v_deleted_count, v_related)
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object('preview', false, 'deleted_count', v_deleted_count, 'audit_id', v_audit_id);
END;
$function$;

-- 3d. Execute delete companies
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_companies(
    p_token uuid,
    p_ids uuid[],
    p_dry_run boolean DEFAULT true
)
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
    v_comp_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT jsonb_build_object(
        'products', (SELECT COUNT(*)::int FROM public.products p WHERE p.company_id = ANY(p_ids))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    IF (v_related->>'products')::int > 0 THEN
        RETURN jsonb_build_object('error', 'HAS_PRODUCTS', 'related', v_related);
    END IF;

    v_deleted_count := 0;
    FOREACH v_comp_id IN ARRAY p_ids LOOP
        DELETE FROM public.companies WHERE id = v_comp_id;
        IF FOUND THEN v_deleted_count := v_deleted_count + 1; END IF;
    END LOOP;

    INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
    VALUES (v_session.employee_id, 'companies', p_ids, v_deleted_count, v_related)
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object('preview', false, 'deleted_count', v_deleted_count, 'audit_id', v_audit_id);
END;
$function$;

-- 3e. Execute delete orders
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_orders(
    p_token uuid,
    p_ids uuid[],
    p_dry_run boolean DEFAULT true
)
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
        'preparation_records', (SELECT COUNT(*)::int FROM public.preparation_records pr WHERE pr.order_id = ANY(p_ids)),
        'returns', (SELECT COUNT(*)::int FROM public.returns r WHERE r.order_id = ANY(p_ids)),
        'collections', (SELECT COUNT(*)::int FROM public.collections cl WHERE cl.order_id = ANY(p_ids)),
        'credit_invoices', (SELECT COUNT(*)::int FROM public.credit_invoices ci WHERE ci.order_id = ANY(p_ids)),
        'order_daily_deals', (SELECT COUNT(*)::int FROM public.order_daily_deals odd WHERE odd.order_id = ANY(p_ids)),
        'order_flash_offers', (SELECT COUNT(*)::int FROM public.order_flash_offers ofo WHERE ofo.order_id = ANY(p_ids))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    -- Delete all related in FK order
    DELETE FROM public.order_flash_offers WHERE order_id = ANY(p_ids);
    DELETE FROM public.order_daily_deals WHERE order_id = ANY(p_ids);
    DELETE FROM public.credit_invoice_cheques WHERE invoice_id IN (SELECT id FROM public.credit_invoices WHERE order_id = ANY(p_ids));
    DELETE FROM public.credit_invoices WHERE order_id = ANY(p_ids);
    DELETE FROM public.treasury_transactions WHERE reference_type = 'collection' AND reference_id IN (SELECT id FROM public.collections WHERE order_id = ANY(p_ids));
    DELETE FROM public.collections WHERE order_id = ANY(p_ids);
    DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = ANY(p_ids));
    DELETE FROM public.returns WHERE order_id = ANY(p_ids);
    DELETE FROM public.preparation_exceptions WHERE preparation_id IN (SELECT id FROM public.preparation_records WHERE order_id = ANY(p_ids));
    DELETE FROM public.preparation_records WHERE order_id = ANY(p_ids);
    DELETE FROM public.delivery_tracking WHERE order_id = ANY(p_ids);
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

-- 3f. Execute delete collections
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_collections(
    p_token uuid,
    p_ids uuid[],
    p_dry_run boolean DEFAULT true
)
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
    v_coll_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT jsonb_build_object(
        'treasury_transactions', (SELECT COUNT(*)::int FROM public.treasury_transactions tt WHERE tt.reference_type = 'collection' AND tt.reference_id = ANY(p_ids))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    DELETE FROM public.treasury_transactions WHERE reference_type = 'collection' AND reference_id = ANY(p_ids);

    v_deleted_count := 0;
    FOREACH v_coll_id IN ARRAY p_ids LOOP
        DELETE FROM public.collections WHERE id = v_coll_id;
        IF FOUND THEN v_deleted_count := v_deleted_count + 1; END IF;
    END LOOP;

    INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
    VALUES (v_session.employee_id, 'collections', p_ids, v_deleted_count, v_related)
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object('preview', false, 'deleted_count', v_deleted_count, 'audit_id', v_audit_id);
END;
$function$;

-- 3g. Execute delete visits
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_visits(
    p_token uuid,
    p_ids uuid[],
    p_dry_run boolean DEFAULT true
)
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
    v_visit_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT jsonb_build_object(
        'visit_links', (SELECT COUNT(*)::int FROM public.visit_links vl WHERE vl.visit_id = ANY(p_ids))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    DELETE FROM public.visit_links WHERE visit_id = ANY(p_ids);

    v_deleted_count := 0;
    FOREACH v_visit_id IN ARRAY p_ids LOOP
        DELETE FROM public.visits WHERE id = v_visit_id;
        IF FOUND THEN v_deleted_count := v_deleted_count + 1; END IF;
    END LOOP;

    INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
    VALUES (v_session.employee_id, 'visits', p_ids, v_deleted_count, v_related)
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object('preview', false, 'deleted_count', v_deleted_count, 'audit_id', v_audit_id);
END;
$function$;

-- 3h. Execute delete workday sessions
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_workdays(
    p_token uuid,
    p_ids uuid[],
    p_dry_run boolean DEFAULT true
)
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
    v_ws_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT jsonb_build_object(
        'tracking_points', (SELECT COUNT(*)::int FROM public.tracking_points tp WHERE tp.session_id = ANY(p_ids)),
        'workday_breaks', (SELECT COUNT(*)::int FROM public.workday_breaks wb WHERE wb.session_id = ANY(p_ids)),
        'visit_links', (SELECT COUNT(*)::int FROM public.visit_links vl WHERE vl.session_id = ANY(p_ids)),
        'attendance_audit_log', (SELECT COUNT(*)::int FROM public.attendance_audit_log aal WHERE aal.session_id = ANY(p_ids))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    DELETE FROM public.tracking_points WHERE session_id = ANY(p_ids);
    DELETE FROM public.workday_breaks WHERE session_id = ANY(p_ids);
    DELETE FROM public.visit_links WHERE session_id = ANY(p_ids);
    DELETE FROM public.attendance_audit_log WHERE session_id = ANY(p_ids);
    DELETE FROM public.session_recovery_log WHERE session_id = ANY(p_ids);

    v_deleted_count := 0;
    FOREACH v_ws_id IN ARRAY p_ids LOOP
        DELETE FROM public.workday_sessions WHERE id = v_ws_id;
        IF FOUND THEN v_deleted_count := v_deleted_count + 1; END IF;
    END LOOP;

    INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
    VALUES (v_session.employee_id, 'workday_sessions', p_ids, v_deleted_count, v_related)
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object('preview', false, 'deleted_count', v_deleted_count, 'audit_id', v_audit_id);
END;
$function$;

-- 3i. Execute delete tracking points
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_tracking(
    p_token uuid,
    p_ids uuid[],
    p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_deleted_count int := 0;
    v_audit_id uuid;
    v_tp_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', '{}'::jsonb);
    END IF;

    v_deleted_count := 0;
    FOREACH v_tp_id IN ARRAY p_ids LOOP
        DELETE FROM public.tracking_points WHERE id = v_tp_id;
        IF FOUND THEN v_deleted_count := v_deleted_count + 1; END IF;
    END LOOP;

    INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
    VALUES (v_session.employee_id, 'tracking_points', p_ids, v_deleted_count, '{}'::jsonb)
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object('preview', false, 'deleted_count', v_deleted_count, 'audit_id', v_audit_id);
END;
$function$;

-- 4. Grant execute permissions ------------------------------------------------

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_search_employees(uuid,text,text,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_search_customers(uuid,text,text,date,date,text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_search_products(uuid,text,text,date,date,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_search_companies(uuid,text,text,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_search_orders(uuid,text,text,date,date,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_search_collections(uuid,text,text,date,date,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_search_visits(uuid,text,text,date,date,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_search_workdays(uuid,text,text,date,date,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_search_tracking(uuid,text,date,date,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_execute_employees(uuid,uuid[],boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_execute_customers(uuid,uuid[],boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_execute_products(uuid,uuid[],boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_execute_companies(uuid,uuid[],boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_execute_orders(uuid,uuid[],boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_execute_collections(uuid,uuid[],boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_execute_visits(uuid,uuid[],boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_execute_workdays(uuid,uuid[],boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.governed_deletion_execute_tracking(uuid,uuid[],boolean) TO authenticated;
