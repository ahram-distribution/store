-- ============================================================================
-- Customer Report — additive fields for get_governed_customers
--
-- Adds two read-only fields used by the customer report (PDF / Excel / print):
--   - last_order_total  : total_amount of the most recent order (same ordering
--                         as last_order_number / last_order_date).
--   - delivered_total   : SUM(total_amount) over orders whose current status is
--                         'delivered' (منفذ فعليًا). Kept fully separate from
--                         previous_orders_total.
--
-- No existing column, meaning, or filter is changed:
--   - previous_order_count / previous_orders_total / last_order_date /
--     last_visit_date / visit_count remain byte-for-byte identical.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_governed_customers(text, text, uuid, timestamptz, timestamptz, boolean, boolean, boolean, uuid, boolean);

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
      'last_order_total', ps.last_order_total,
      'delivered_total', ps.delivered_total,
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
        max(created_at) AS last_order_date,
        (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total,
        COALESCE(sum(total_amount) FILTER (WHERE o2.status = 'delivered'), 0) AS delivered_total
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
      'last_order_total', ps.last_order_total,
      'delivered_total', ps.delivered_total,
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
        max(created_at) AS last_order_date,
        (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total,
        COALESCE(sum(total_amount) FILTER (WHERE o2.status = 'delivered'), 0) AS delivered_total
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
    'last_order_total', ps.last_order_total,
    'delivered_total', ps.delivered_total,
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
      max(created_at) AS last_order_date,
      (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total,
      COALESCE(sum(total_amount) FILTER (WHERE o2.status = 'delivered'), 0) AS delivered_total
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

COMMENT ON FUNCTION public.get_governed_customers IS 'قائمة العملاء مع دعم البحث والنطاق الهرمي والفلاتر الزمنية + حقول تقرير العملاء (قيمة آخر طلب وإجمالي المنفذ فعليًا)';
