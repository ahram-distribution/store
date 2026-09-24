-- ----------------------------------------------------------------------------
-- QUOTA REDUCTION WS1/WS2/WS3 — SERVER-SIDE PAGINATION / COUNT / SEARCH
-- ----------------------------------------------------------------------------
-- get_governed_customers        server-side pagination + count + stats
-- get_governed_visits           server-side pagination + count + status /
--                               customer / governorate filters
-- get_governed_bonus_products   server-side pagination + search + count +
--                               company group-by + targeted ids
-- get_governed_visit_customer_summary   NEW lean per-customer visit summary
--                               (replaces full visits fetch on SalesRepWorkDay)
--
-- All new params are DEFAULT so existing callers keep resolving. Each function
-- MUST stay a single overload (PostgREST PGRST203 ambiguity), so every existing
-- overload is dropped first (same pattern as 20271125_get_governed_products).
-- get_governed_visits /
-- get_governed_bonus_products switch their leading token to `text` to match
-- get_governed_products / get_governed_customers and the frontend's string
-- tokens. The exact jsonb row shapes and permission semantics of the PREVIOUS
-- live definitions are preserved verbatim — only the split into scoped
-- single-branch queries + paging/count/stats has been added.
--
-- NOTE (PGRST-friendly boolean params): pass p_count_only / p_stats explicitly
-- as `true`/`false`; do NOT pass NULL (NULL in a `NOT (p_count_only)` guard
-- would silently exclude every row — the known bool-flag quirk).
--
-- Guideline for p_per_page: Web browsing screens pass p_page (1-based) +
-- p_per_page together. p_per_page defaults to 20 for get_governed_visits
-- (defensive: no visits caller may download the full dataset any more) and to
-- unlimited for customers/bonus (legacy full-list consumers stay working;
-- their screens are migrated to explicit paging).
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 0. Drop all existing overloads (each name keeps ONE canonical signature)
-- ============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'get_governed_visits',
      'get_governed_customers',
      'get_governed_bonus_products',
      'get_governed_visit_customer_summary'
    )
  LOOP
    EXECUTE format('DROP FUNCTION public.%s', r.sig);
  END LOOP;
END $$;

-- ============================================================================
-- 1. get_governed_visits — merged scope + paging + count + filters
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_governed_visits(
  p_token text,
  p_search text DEFAULT NULL::text,
  p_employee_id uuid DEFAULT NULL::uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_status text DEFAULT NULL::text,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_governorate_id uuid DEFAULT NULL::uuid,
  p_page integer DEFAULT NULL::integer,
  p_per_page integer DEFAULT NULL::integer,
  p_count_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_token uuid;
  v_visible uuid[];
  v_visit_cust uuid;
  v_um boolean;
  v_limit integer;
  v_offset integer;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Scope resolution (exact previous 3-branch semantics, single static predicate):
  --   customer session -> that customer's visits only
  --   upper management  -> every visit
  --   other employee    -> visits by the visible-employee subtree
  IF v_session.identity_type = 'customer' THEN
    v_visit_cust := v_session.customer_id;
    v_um := false;
    v_visible := '{}'::uuid[];
  ELSIF public.is_upper_management(v_session.employee_id) THEN
    v_visit_cust := NULL;
    v_um := true;
    v_visible := '{}'::uuid[];
  ELSE
    v_visit_cust := NULL;
    v_um := false;
    v_visible := COALESCE(public.get_visible_employee_ids(v_token), '{}'::uuid[]);
  END IF;

  v_limit := COALESCE(p_per_page, 20);
  v_offset := COALESCE((p_page - 1) * v_limit, 0);

  IF p_count_only THEN
    SELECT jsonb_build_object('count', COUNT(*)) INTO v_result
    FROM public.visits v
    LEFT JOIN customers c ON c.id = v.customer_id
    WHERE (
        (v_session.identity_type = 'customer' AND v.customer_id = v_visit_cust)
        OR (v_session.identity_type <> 'customer' AND v_um)
        OR (v_session.identity_type <> 'customer' AND NOT v_um AND v.employee_id = ANY(v_visible))
      )
      AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR v.code ILIKE '%' || p_search || '%')
      AND (p_employee_id IS NULL OR v.employee_id = p_employee_id)
      AND (p_date_from IS NULL OR v.check_in_at >= p_date_from)
      AND (p_date_to IS NULL OR v.check_in_at <= p_date_to)
      AND (p_status IS NULL OR v.status = p_status)
      AND (p_customer_id IS NULL OR v.customer_id = p_customer_id)
      AND (
        p_governorate_id IS NULL
        OR EXISTS (
          SELECT 1 FROM customer_addresses ca
          WHERE ca.customer_id = v.customer_id AND ca.is_default = true
            AND ca.governorate_id = p_governorate_id
        )
      );
    RETURN v_result;
  END IF;

  -- Per-visit customer context: name/phone/address live + creation + ACTUAL
  -- order metrics (is_order_in_statistics) + total visit count. Runs as a
  -- correlated lateral inside the batch query (no per-card network round trip).
  --
  -- NOTE on "created by": public.customers has no created_by column. The only
  -- provenance stored is owner_id (assigned to the creating employee at
  -- creation). We surface that as creator_name to match the existing customer
  -- card's owner semantics, since no separate creator field exists.
  SELECT jsonb_agg(sub.data) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', v.id, 'code', v.code, 'employee_id', v.employee_id,
      'customer_id', v.customer_id, 'customer_name', c.company_name,
      'employee_name', e.full_name,
      'status', v.status, 'visit_result', v.visit_result,
      'notes', v.notes, 'check_in_at', v.check_in_at,
      'check_out_at', v.check_out_at,
      'check_in_latitude', v.check_in_latitude, 'check_in_longitude', v.check_in_longitude,
      'check_out_latitude', v.check_out_latitude, 'check_out_longitude', v.check_out_longitude,
      'start_location_id', v.start_location_id, 'created_at', v.created_at,
      'customer_context', (
        SELECT jsonb_build_object(
          'id', c2.id,
          'company_name', c2.company_name,
          'phone', i2.phone,
          'registered_address', trim(both '- ' from concat_ws(' - ',
            NULLIF(TRIM(ca2.governorate), ''), NULLIF(TRIM(ca2.city), ''),
            NULLIF(TRIM(COALESCE(ca2.street_address, ca2.address_line1, '')), '')
          )),
          'created_at', c2.created_at,
          'creator_name', e2.full_name,
          'order_count', so.order_count,
          'orders_total', so.orders_total,
          'last_order_date', so.last_order_date,
          'visit_count', sv.visit_count,
          'last_visit_before', sv.last_visit_before
        )
        FROM public.customers c2
        LEFT JOIN public.identities i2 ON i2.id = c2.identity_id
        LEFT JOIN public.employees e2 ON e2.id = c2.owner_id
        LEFT JOIN LATERAL (
          SELECT ca2.* FROM public.customer_addresses ca2
          WHERE ca2.customer_id = c2.id AND ca2.is_default = true LIMIT 1
        ) ca2 ON true
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::bigint AS order_count,
            COALESCE(SUM(o3.total_amount), 0) AS orders_total,
            MAX(o3.created_at) AS last_order_date
          FROM public.orders o3
          WHERE o3.customer_id = c2.id AND public.is_order_in_statistics(o3.status)
        ) so ON true
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::bigint AS visit_count,
            MAX(v3.check_in_at) FILTER (WHERE v3.id <> v.id) AS last_visit_before
          FROM public.visits v3
          WHERE v3.customer_id = c2.id AND v3.check_in_at IS NOT NULL
        ) sv ON true
        WHERE c2.id = c.id
      )
    ) AS data
    FROM public.visits v
    LEFT JOIN customers c ON c.id = v.customer_id
    LEFT JOIN employees e ON e.id = v.employee_id
    WHERE (
        (v_session.identity_type = 'customer' AND v.customer_id = v_visit_cust)
        OR (v_session.identity_type <> 'customer' AND v_um)
        OR (v_session.identity_type <> 'customer' AND NOT v_um AND v.employee_id = ANY(v_visible))
      )
      AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR v.code ILIKE '%' || p_search || '%')
      AND (p_employee_id IS NULL OR v.employee_id = p_employee_id)
      AND (p_date_from IS NULL OR v.check_in_at >= p_date_from)
      AND (p_date_to IS NULL OR v.check_in_at <= p_date_to)
      AND (p_status IS NULL OR v.status = p_status)
      AND (p_customer_id IS NULL OR v.customer_id = p_customer_id)
      AND (
        p_governorate_id IS NULL
        OR EXISTS (
          SELECT 1 FROM customer_addresses ca
          WHERE ca.customer_id = v.customer_id AND ca.is_default = true
            AND ca.governorate_id = p_governorate_id
        )
      )
    ORDER BY v.created_at DESC, v.id
    LIMIT v_limit
    OFFSET v_offset
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 2. get_governed_customers — merged scope + paging + count + stats
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_governed_customers(
  p_token text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_employee_id uuid DEFAULT NULL::uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_no_orders boolean DEFAULT false,
  p_no_visits boolean DEFAULT false,
  p_no_location boolean DEFAULT false,
  p_governorate_id uuid DEFAULT NULL::uuid,
  p_needs_address_correction boolean DEFAULT NULL::boolean,
  p_page integer DEFAULT NULL::integer,
  p_per_page integer DEFAULT NULL::integer,
  p_count_only boolean DEFAULT false,
  p_stats boolean DEFAULT false
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
  v_all_scope boolean;
  v_subtree_ids uuid[];
  v_filter_no_orders boolean;
  v_filter_no_visits boolean;
  v_filter_no_location boolean;
  v_limit integer;
  v_offset integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  v_emp_id := app.current_employee_id();
  v_is_customer := (v_session.identity_type = 'customer');
  v_filter_no_orders := COALESCE(p_no_orders, false);
  v_filter_no_visits := COALESCE(p_no_visits, false);
  v_filter_no_location := COALESCE(p_no_location, false);

  -- Scope resolution (exact previous 3-branch semantics, single static predicate):
  --   customer session                 -> own identity record only
  --   employee with customers.read     -> every customer
  --   employee without customers.read  -> customers owned by subtree
  IF v_is_customer THEN
    v_all_scope := false;
    v_subtree_ids := '{}'::uuid[];
  ELSE
    v_all_scope := app.has_capability('customers.read');
    IF v_all_scope THEN
      v_subtree_ids := '{}'::uuid[];
    ELSE
      v_subtree_ids := COALESCE(app.get_subtree_ids(v_emp_id), '{}'::uuid[]);
    END IF;
  END IF;

  v_limit := COALESCE(p_per_page, 1000000);
  v_offset := COALESCE((p_page - 1) * v_limit, 0);

  IF p_stats THEN
    SELECT jsonb_build_object(
      'total', COUNT(*)::bigint,
      'no_orders', COUNT(*) FILTER (
        WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status))
      )::bigint,
      'no_visits', COUNT(*) FILTER (
        WHERE NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.customer_id = c.id)
      )::bigint,
      'no_location', COUNT(*) FILTER (WHERE c.location_id IS NULL)::bigint,
      'needs_correction', COUNT(*) FILTER (WHERE COALESCE(c.needs_address_correction, false))::bigint
    ) INTO v_result
    FROM customers c
    JOIN identities i ON i.id = c.identity_id
    WHERE (
        (v_is_customer AND c.identity_id = v_session.identity_id)
        OR (NOT v_is_customer AND (v_all_scope OR c.owner_id = ANY(v_subtree_ids)))
      )
      AND (v_is_customer OR p_employee_id IS NULL OR c.owner_id = p_employee_id)
      AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to)
      AND (NOT v_filter_no_orders OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)))
      AND (NOT v_filter_no_visits OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.customer_id = c.id))
      AND (NOT v_filter_no_location OR c.location_id IS NULL)
      AND (
        p_governorate_id IS NULL
        OR EXISTS (
          SELECT 1 FROM customer_addresses ca3
          WHERE ca3.customer_id = c.id AND ca3.is_default = true AND ca3.governorate_id = p_governorate_id
        )
      )
      AND (p_needs_address_correction IS NULL OR c.needs_address_correction = p_needs_address_correction);
    RETURN v_result;
  END IF;

  IF p_count_only THEN
    SELECT jsonb_build_object('count', COUNT(*)) INTO v_result
    FROM customers c
    JOIN identities i ON i.id = c.identity_id
    WHERE (
        (v_is_customer AND c.identity_id = v_session.identity_id)
        OR (NOT v_is_customer AND (v_all_scope OR c.owner_id = ANY(v_subtree_ids)))
      )
      AND (v_is_customer OR p_employee_id IS NULL OR c.owner_id = p_employee_id)
      AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to)
      AND (NOT v_filter_no_orders OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)))
      AND (NOT v_filter_no_visits OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.customer_id = c.id))
      AND (NOT v_filter_no_location OR c.location_id IS NULL)
      AND (
        p_governorate_id IS NULL
        OR EXISTS (
          SELECT 1 FROM customer_addresses ca3
          WHERE ca3.customer_id = c.id AND ca3.is_default = true AND ca3.governorate_id = p_governorate_id
        )
      )
      AND (p_needs_address_correction IS NULL OR c.needs_address_correction = p_needs_address_correction);
    RETURN v_result;
  END IF;

  SELECT jsonb_agg(sub.data) INTO v_result
  FROM (
    SELECT jsonb_build_object(
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
    ) AS data
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
        AND public.is_order_in_statistics(o2.status)
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
    WHERE (
        (v_is_customer AND c.identity_id = v_session.identity_id)
        OR (NOT v_is_customer AND (v_all_scope OR c.owner_id = ANY(v_subtree_ids)))
      )
      AND (v_is_customer OR p_employee_id IS NULL OR c.owner_id = p_employee_id)
      AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to)
      AND (NOT v_filter_no_orders OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)))
      AND (NOT v_filter_no_visits OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.customer_id = c.id))
      AND (NOT v_filter_no_location OR c.location_id IS NULL)
      AND (
        p_governorate_id IS NULL
        OR EXISTS (
          SELECT 1 FROM customer_addresses ca3
          WHERE ca3.customer_id = c.id AND ca3.is_default = true AND ca3.governorate_id = p_governorate_id
        )
      )
      AND (p_needs_address_correction IS NULL OR c.needs_address_correction = p_needs_address_correction)
    ORDER BY c.created_at DESC, c.id
    LIMIT v_limit
    OFFSET v_offset
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 3. get_governed_bonus_products — search + paging + count + group-by + ids
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_governed_bonus_products(
  p_token text,
  p_governorate_id uuid DEFAULT NULL::uuid,
  p_company_ids uuid[] DEFAULT NULL::uuid[],
  p_search text DEFAULT NULL::text,
  p_page integer DEFAULT NULL::integer,
  p_per_page integer DEFAULT NULL::integer,
  p_count_only boolean DEFAULT false,
  p_group_by_company boolean DEFAULT false,
  p_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_token uuid;
  v_limit integer;
  v_offset integer;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END;

  SELECT * INTO v_session
  FROM app.sessions
  WHERE token = v_token AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END IF;

  -- Level-1 company cards: id + name + available-product count. p_page/p_per_page/
  -- p_count_only/p_ids do not apply in this mode.
  IF p_group_by_company THEN
    SELECT jsonb_agg(x.row ORDER BY (x.row ->> 'company_name'))
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'company_id', comp.id,
        'company_name', comp.company_name,
        'count', COUNT(*)::bigint
      ) AS row
      FROM products p
      JOIN companies comp ON comp.id = p.company_id
      WHERE p.is_active = true
        AND p.is_visible = true
        AND (
          COALESCE(p.bonus_enabled, false)
          OR COALESCE(comp.bonus_enabled, false)
          OR comp.legacy_code = '7000'
        )
        AND (
          p_search IS NULL
          OR p.product_name ILIKE '%' || p_search || '%'
          OR p.legacy_code ILIKE '%' || p_search || '%'
          OR comp.company_name ILIKE '%' || p_search || '%'
        )
      GROUP BY comp.id, comp.company_name
    ) x;
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  IF p_count_only THEN
    SELECT jsonb_build_object('count', COUNT(*)) INTO v_result
    FROM products p
    JOIN companies comp ON comp.id = p.company_id
    WHERE p.is_active = true
      AND p.is_visible = true
      AND (
        COALESCE(p.bonus_enabled, false)
        OR COALESCE(comp.bonus_enabled, false)
        OR comp.legacy_code = '7000'
      )
      AND (p_company_ids IS NULL OR p.company_id = ANY(p_company_ids))
      AND (p_ids IS NULL OR p.id = ANY(p_ids))
      AND (
        p_search IS NULL
        OR p.product_name ILIKE '%' || p_search || '%'
        OR p.legacy_code ILIKE '%' || p_search || '%'
        OR comp.company_name ILIKE '%' || p_search || '%'
      );
    RETURN v_result;
  END IF;

  v_limit := COALESCE(p_per_page, 1000000);
  v_offset := COALESCE((p_page - 1) * v_limit, 0);

  SELECT jsonb_agg(sub.data) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'product_name', p.product_name,
      'legacy_code', p.legacy_code,
      'company_id', p.company_id,
      'company_name', comp.company_name,
      'company_legacy_code', comp.legacy_code,
      'is_active', p.is_active,
      'is_visible', p.is_visible,
      'is_out_of_stock', p.is_out_of_stock,
      'image_url', p.image_url,
      'carton_price', p.carton_price,
      'carton_quantity', p.carton_quantity,
      'piece_price', p.piece_price,
      'dozen_price', p.dozen_price,
      'bonus_enabled', p.bonus_enabled,
      'company_bonus_enabled', comp.bonus_enabled,
      'geo_adjustment_percent', CASE
        WHEN p_governorate_id IS NULL THEN NULL::numeric
        ELSE g.adjustment_percent
      END,
      'product_units', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', pu.id,
              'unit_type', pu.unit_type,
              'is_active', pu.is_active
            )
            ORDER BY pu.unit_type
          )
          FROM product_units pu
          WHERE pu.product_id = p.id
        ),
        '[]'::jsonb
      )
    ) AS data
    FROM products p
    JOIN companies comp ON comp.id = p.company_id
    LEFT JOIN LATERAL public.get_effective_geographic_adjustment(
      p_governorate_id,
      p.company_id,
      p.id
    ) g ON true
    WHERE p.is_active = true
      AND p.is_visible = true
      AND (
        COALESCE(p.bonus_enabled, false)
        OR COALESCE(comp.bonus_enabled, false)
        OR comp.legacy_code = '7000'
      )
      AND (p_company_ids IS NULL OR p.company_id = ANY(p_company_ids))
      AND (p_ids IS NULL OR p.id = ANY(p_ids))
      AND (
        p_search IS NULL
        OR p.product_name ILIKE '%' || p_search || '%'
        OR p.legacy_code ILIKE '%' || p_search || '%'
        OR comp.company_name ILIKE '%' || p_search || '%'
      )
    ORDER BY p.product_name
    LIMIT v_limit
    OFFSET v_offset
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 4. get_governed_visit_customer_summary — lean per-customer visit summary
-- ============================================================================
-- One lean row per governed customer (same scope as get_governed_customers):
-- company_name/created_at for the SalesRepWorkDay opportunity scan, plus the
-- last visit (id/at/result) and the count of visits created since p_from
-- (mirrors the client's "this Cairo month" aggregation — callers pass
-- month-start ISO). Replaces the SalesRepWorkDay full-visits download.
CREATE OR REPLACE FUNCTION public.get_governed_visit_customer_summary(
  p_token text,
  p_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_to timestamp with time zone DEFAULT NULL::timestamp with time zone
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
  v_all_scope boolean;
  v_subtree_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  v_emp_id := app.current_employee_id();
  v_is_customer := (v_session.identity_type = 'customer');

  IF v_is_customer THEN
    v_all_scope := false;
    v_subtree_ids := '{}'::uuid[];
  ELSE
    v_all_scope := app.has_capability('customers.read');
    IF v_all_scope THEN
      v_subtree_ids := '{}'::uuid[];
    ELSE
      v_subtree_ids := COALESCE(app.get_subtree_ids(v_emp_id), '{}'::uuid[]);
    END IF;
  END IF;

  SELECT jsonb_agg(sub.data) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'customer_id', c.id,
      'company_name', c.company_name,
      'created_at', c.created_at,
      'last_visit_id', lv.last_visit_id,
      'last_visit_at', lv.last_visit_at,
      'last_visit_result', lv.last_visit_result,
      'month_visit_count', mc.month_visit_count
    ) AS data
    FROM customers c
    LEFT JOIN LATERAL (
      SELECT
        v2.id AS last_visit_id,
        v2.created_at AS last_visit_at,
        v2.visit_result AS last_visit_result
      FROM public.visits v2
      WHERE v2.customer_id = c.id
      ORDER BY v2.created_at DESC, v2.id DESC
      LIMIT 1
    ) lv ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::bigint AS month_visit_count
      FROM public.visits v3
      WHERE v3.customer_id = c.id
        AND (p_from IS NULL OR v3.created_at >= p_from)
        AND (p_to IS NULL OR v3.created_at <= p_to)
    ) mc ON true
    WHERE (
        (v_is_customer AND c.identity_id = v_session.identity_id)
        OR (NOT v_is_customer AND (v_all_scope OR c.owner_id = ANY(v_subtree_ids)))
      )
    ORDER BY c.created_at DESC, c.id
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 5. Grants (fresh OIDs after the drop; keep EXECUTE parity with prior defs)
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.get_governed_visits(text, text, uuid, timestamp with time zone, timestamp with time zone, text, uuid, uuid, integer, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_governed_customers(text, text, uuid, timestamp with time zone, timestamp with time zone, boolean, boolean, boolean, uuid, boolean, integer, integer, boolean, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_governed_bonus_products(text, uuid, uuid[], text, integer, integer, boolean, boolean, uuid[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_governed_visit_customer_summary(text, timestamp with time zone, timestamp with time zone) TO anon, authenticated, service_role;

-- ============================================================================
-- 6. Comments
-- ============================================================================
COMMENT ON FUNCTION public.get_governed_visits(text, text, uuid, timestamp with time zone, timestamp with time zone, text, uuid, uuid, integer, integer, boolean) IS
  'زيارات محكومة — نطاق موحد (عميل / إدارة عليا / شجرة مرئية) مع ترقيم صفحات وخادم وعدد وفلاتر حالة وعميل ومحافظة.';
COMMENT ON FUNCTION public.get_governed_customers(text, text, uuid, timestamp with time zone, timestamp with time zone, boolean, boolean, boolean, uuid, boolean, integer, integer, boolean, boolean) IS
  'عملاء محكومون — نطاق موحد مع ترقيم صفحات وعدد وإحصاءات (بدون طلبات/زيارات/لوكيشن/تصحيح) من جهة السيرفر.';
COMMENT ON FUNCTION public.get_governed_bonus_products(text, uuid, uuid[], text, integer, integer, boolean, boolean, uuid[]) IS
  'منتجات البونص المؤهلة — بحث وترقيم صفحات وعدد وتجميع حسب الشركة واسترجاع موجه بالمعرفات.';
COMMENT ON FUNCTION public.get_governed_visit_customer_summary(text, timestamp with time zone, timestamp with time zone) IS
  'ملخص زيارات خفيف لكل عميل محكوم (آخر زيارة + عدد زيارات الشهر) بديلاً عن تحميل سجل الزيارات الكامل.';