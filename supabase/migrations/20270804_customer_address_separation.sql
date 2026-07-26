-- ============================================================================
-- Customer Manual Address Separation, Cleanup & Governorate Filtering
-- ============================================================================
-- Goals:
-- 1. Add needs_address_correction flag to customers
-- 2. Safe deterministic data correction (governorate text → governorate_id)
-- 3. Fix registered_address to use clean formatting
-- 4. Add governorate + correction filters to get_governed_customers
-- 5. Add governorate filter to get_unified_orders
-- 6. Fix governed_update_customer to accept p_city_name and properly update
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Add needs_address_correction column
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS needs_address_correction boolean DEFAULT false;

COMMENT ON COLUMN public.customers.needs_address_correction IS
  'True when the customer manual address requires correction (missing/invalid governorate)';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Safe data correction
--    Step A: Match governorate text against reference_governorates to set governorate_id
--    Step B: Mark customers as needing correction where governorate is still unresolved
-- ──────────────────────────────────────────────────────────────────────────────

-- Step A: Resolve governorate_id from governorate text where missing
UPDATE customer_addresses ca
SET governorate_id = rg.id
FROM reference_governorates rg
WHERE ca.is_default = true
  AND ca.governorate_id IS NULL
  AND ca.governorate IS NOT NULL
  AND TRIM(ca.governorate) != ''
  AND rg.name_ar = TRIM(ca.governorate);

-- Step B: Mark customers needing correction
-- A customer needs correction when:
--   - No default address exists, OR
--   - governorate_id IS NULL (governorate text couldn't be resolved)
UPDATE customers c
SET needs_address_correction = true
WHERE NOT EXISTS (
  SELECT 1 FROM customer_addresses ca
  WHERE ca.customer_id = c.id AND ca.is_default = true
    AND ca.governorate_id IS NOT NULL
);

-- Customers that have a valid governorate_id are fine
UPDATE customers c
SET needs_address_correction = false
WHERE EXISTS (
  SELECT 1 FROM customer_addresses ca
  WHERE ca.customer_id = c.id AND ca.is_default = true
    AND ca.governorate_id IS NOT NULL
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Updated get_governed_customers
--    - Add p_governorate_id, p_needs_address_correction params
--    - Fix registered_address to use clean formatting with street_address priority
--    - Return needs_address_correction + manual_governorate_id
--    - Add filter conditions
-- ──────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_governed_customers(text, text, uuid, timestamptz, timestamptz, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.get_governed_customers(
  p_token text,
  p_search text DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_no_orders boolean DEFAULT false,
  p_no_visits boolean DEFAULT false,
  p_no_location boolean DEFAULT false,
  p_governorate_id uuid DEFAULT NULL,
  p_needs_address_correction boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
      'credit_limit', c.credit_limit, 'credit_days', c.credit_days,
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
      'last_visit_date', vs.last_visit_date,
      'visit_count', vs.visit_count,
      'current_balance', (COALESCE(ps.orders_total, 0) - COALESCE(col.total_collected, 0))
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
        max(created_at) AS last_order_date
      FROM public.orders o2
      WHERE o2.customer_id = c.id
    ) ps ON true
    LEFT JOIN LATERAL (
      SELECT
        MAX(v.check_in_at) AS last_visit_date,
        COUNT(*)::bigint AS visit_count
      FROM public.visits v
      WHERE v.customer_id = c.id AND v.check_in_at IS NOT NULL
    ) vs ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(cl.amount), 0) AS total_collected
      FROM public.collections cl
      WHERE cl.customer_id = c.id AND (cl.status IS NULL OR cl.status = 'approved')
    ) col ON true
    WHERE c.identity_id = v_session.identity_id
      AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to)
      AND (NOT v_filter_no_orders OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id))
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
      'credit_limit', c.credit_limit, 'credit_days', c.credit_days,
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
      'last_visit_date', vs.last_visit_date,
      'visit_count', vs.visit_count,
      'current_balance', (COALESCE(ps.orders_total, 0) - COALESCE(col.total_collected, 0))
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
        max(created_at) AS last_order_date
      FROM public.orders o2
      WHERE o2.customer_id = c.id
    ) ps ON true
    LEFT JOIN LATERAL (
      SELECT
        MAX(v.check_in_at) AS last_visit_date,
        COUNT(*)::bigint AS visit_count
      FROM public.visits v
      WHERE v.customer_id = c.id AND v.check_in_at IS NOT NULL
    ) vs ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(cl.amount), 0) AS total_collected
      FROM public.collections cl
      WHERE cl.customer_id = c.id AND (cl.status IS NULL OR cl.status = 'approved')
    ) col ON true
    WHERE (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
      AND (p_employee_id IS NULL OR c.owner_id = p_employee_id)
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to)
      AND (NOT v_filter_no_orders OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id))
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
    'credit_limit', c.credit_limit, 'credit_days', c.credit_days,
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
    'last_visit_date', vs.last_visit_date,
    'visit_count', vs.visit_count,
    'current_balance', (COALESCE(ps.orders_total, 0) - COALESCE(col.total_collected, 0))
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
      max(created_at) AS last_order_date
    FROM public.orders o2
    WHERE o2.customer_id = c.id
  ) ps ON true
  LEFT JOIN LATERAL (
    SELECT
      MAX(v.check_in_at) AS last_visit_date,
      COUNT(*)::bigint AS visit_count
    FROM public.visits v
    WHERE v.customer_id = c.id AND v.check_in_at IS NOT NULL
  ) vs ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(cl.amount), 0) AS total_collected
    FROM public.collections cl
    WHERE cl.customer_id = c.id AND (cl.status IS NULL OR cl.status = 'approved')
  ) col ON true
  WHERE c.owner_id = ANY(app.get_subtree_ids(v_emp_id))
    AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
    AND (p_employee_id IS NULL OR c.owner_id = p_employee_id)
    AND (p_date_from IS NULL OR c.created_at >= p_date_from)
    AND (p_date_to IS NULL OR c.created_at <= p_date_to)
    AND (NOT v_filter_no_orders OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id))
    AND (NOT v_filter_no_visits OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.customer_id = c.id))
    AND (NOT v_filter_no_location OR c.location_id IS NULL)
    AND (p_governorate_id IS NULL OR addr.manual_governorate_id = p_governorate_id)
    AND (p_needs_address_correction IS NULL OR c.needs_address_correction = p_needs_address_correction);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Updated get_unified_orders — add governorate filter
-- ──────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_unified_orders(uuid, text, varchar, uuid, uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_unified_orders(
  p_token uuid,
  p_search text DEFAULT NULL,
  p_status varchar DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_governorate_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_is_super boolean;
  v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'order_type', o.order_type,
        'total_amount', o.total_amount,
        'revision_number', o.revision_number,
        'reference_number', o.reference_number,
        'customer_id', o.customer_id,
        'customer_name', COALESCE(o.snapshot_customer_name, c.company_name),
        'customer_code', o.snapshot_customer_code,
        'customer_phone', COALESCE(o.snapshot_customer_phone, ci.phone),
        'owner_name', e.full_name,
        'owner_id', o.owner_id,
        'created_by', o.created_by,
        'created_by_name', COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, ''),
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'submitted_at', o.submitted_at,
        'item_count', (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id),
        'current_delivery_status', (
          SELECT dt.status FROM public.delivery_tracking dt
          WHERE dt.order_id = o.id AND dt.is_active = true LIMIT 1
        ),
        'has_collections', EXISTS(
          SELECT 1 FROM public.collections col
          WHERE col.customer_id = o.customer_id
        ),
        'customer_owner_name', COALESCE(co_emp.full_name, ''),
        'customer_owner_role', COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = c.owner_id LIMIT 1), ''),
        'customer_owner_id', c.owner_id,
        'created_by_id', CASE
          WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
          WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
          ELSE NULL
        END,
        'customer_display_address',
          COALESCE(
            NULLIF(concat_ws(' - ',
              NULLIF(TRIM(ca.governorate), ''),
              NULLIF(TRIM(ca.city), ''),
              NULLIF(TRIM(COALESCE(ca.street_address, ca.address_line1, '')), '')
            ), ''),
            o.snapshot_customer_address
          ),
        'customer_governorate_id', ca.governorate_id,
        'previous_order_count', ps.order_count,
        'previous_orders_total', ps.orders_total,
        'previous_order_number', ps.last_order_number,
        'previous_order_date', ps.last_order_date,
        'previous_order_total', ps.last_order_total
      )
      ORDER BY o.created_at DESC
    ), '[]'::jsonb)
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.identities ci ON ci.id = c.identity_id
    LEFT JOIN public.employees co_emp ON co_emp.id = c.owner_id
    LEFT JOIN public.employees e ON e.id = o.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    LEFT JOIN public.customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = true
    LEFT JOIN LATERAL (
      SELECT
        count(*)::bigint AS order_count,
        COALESCE(sum(total_amount), 0) AS orders_total,
        (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
        max(created_at) AS last_order_date,
        (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total
      FROM public.orders o2
      WHERE o2.customer_id = o.customer_id AND o2.id <> o.id
    ) ps ON true
    WHERE (v_is_super OR c.owner_id = ANY(v_visible))
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           o.reference_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%' OR
           COALESCE(o.snapshot_customer_phone, ci.phone) ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      AND (p_governorate_id IS NULL OR ca.governorate_id = p_governorate_id)
  );
END;
$function$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. Updated governed_update_customer — add p_city_name, fix address update
-- ──────────────────────────────────────────────────────────────────────────────

-- Drop old overload (from 20270713) that lacks p_city_name to prevent PostgREST ambiguity
DROP FUNCTION IF EXISTS public.governed_update_customer(
  p_token uuid, p_id uuid,
  p_company_name character varying, p_email character varying,
  p_credit_limit numeric, p_credit_days integer,
  p_business_type business_type, p_responsible_name character varying,
  p_password character varying, p_phone character varying,
  p_formatted_address text, p_latitude numeric, p_longitude numeric,
  p_accuracy_meters numeric,
  p_contact_name character varying, p_contact_phone character varying,
  p_governorate_id uuid, p_city_id uuid,
  p_street_address character varying, p_landmark text
);

CREATE OR REPLACE FUNCTION public.governed_update_customer(
  p_token uuid,
  p_id uuid,
  p_company_name character varying DEFAULT NULL::character varying,
  p_email character varying DEFAULT NULL::character varying,
  p_credit_limit numeric DEFAULT NULL::numeric,
  p_credit_days integer DEFAULT NULL::integer,
  p_business_type business_type DEFAULT NULL::business_type,
  p_responsible_name character varying DEFAULT NULL::character varying,
  p_password character varying DEFAULT NULL::character varying,
  p_phone character varying DEFAULT NULL::character varying,
  p_formatted_address text DEFAULT NULL::text,
  p_latitude numeric DEFAULT NULL::numeric,
  p_longitude numeric DEFAULT NULL::numeric,
  p_accuracy_meters numeric DEFAULT NULL::numeric,
  p_contact_name character varying DEFAULT NULL::character varying,
  p_contact_phone character varying DEFAULT NULL::character varying,
  p_governorate_id uuid DEFAULT NULL::uuid,
  p_city_id uuid DEFAULT NULL::uuid,
  p_city_name character varying DEFAULT NULL::character varying,
  p_street_address character varying DEFAULT NULL::character varying,
  p_landmark text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_identity_id uuid;
  v_location_id uuid;
  v_has_any_location_input boolean;
  v_has_any_contact_input boolean;
  v_has_any_address_input boolean;
  v_resolved_governorate_name text;
  v_resolved_city_name text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'customers.update');

  UPDATE public.customers
  SET
    company_name = COALESCE(p_company_name, company_name),
    email = COALESCE(p_email, email),
    credit_limit = COALESCE(p_credit_limit, credit_limit),
    credit_days = COALESCE(p_credit_days, credit_days),
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

  -- Location updates (GPS) — independent from manual address
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

  -- Manual address updates — independent from GPS/location
  v_has_any_address_input := p_governorate_id IS NOT NULL
    OR p_city_id IS NOT NULL
    OR p_city_name IS NOT NULL
    OR p_street_address IS NOT NULL
    OR p_landmark IS NOT NULL;

  IF v_has_any_address_input THEN
    -- Resolve governorate name from ID
    v_resolved_governorate_name := COALESCE(
      (SELECT name_ar FROM reference_governorates WHERE id = p_governorate_id),
      (SELECT governorate FROM customer_addresses WHERE customer_id = p_id AND is_default = true),
      ''
    );

    -- Resolve city name: prefer explicit city_name, then city_id lookup, then existing
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

    -- Update needs_address_correction: if governorate_id is now set, clear the flag
    IF p_governorate_id IS NOT NULL THEN
      UPDATE customers SET needs_address_correction = false WHERE id = p_id;
    END IF;
  END IF;

  -- Enrich location if GPS data provided
  PERFORM fn_enrich_customer_location(
    p_customer_id        := p_id,
    p_latitude           := p_latitude,
    p_longitude          := p_longitude,
    p_accuracy_meters    := p_accuracy_meters,
    p_formatted_address  := p_formatted_address,
    p_accuracy_level     := (CASE WHEN p_latitude IS NOT NULL THEN 'GPS' ELSE 'GEOCODED' END)::location_accuracy_level
  );

  RETURN jsonb_build_object('success', true);
END;
$$;
