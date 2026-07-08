-- =============================================================================
-- Governed Search Enhancements
-- Adds phone + address search to get_governed_customers
-- Adds company_name to product search in unified_search
-- Adds phone + address search to unified_search for customers
-- =============================================================================

-- =============================================================================
-- 0. GIN Trigram Indexes for new search columns
-- =============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_identities_phone_trgm
  ON identities USING GIN (phone gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_addresses_line1_trgm
  ON customer_addresses USING GIN (address_line1 gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_addresses_city_trgm
  ON customer_addresses USING GIN (city gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_addresses_gov_trgm
  ON customer_addresses USING GIN (governorate gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_name_trgm
  ON companies USING GIN (company_name gin_trgm_ops);

-- =============================================================================
-- 1. get_governed_customers — add phone + address search, add area to output
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_governed_customers(p_token text);

CREATE OR REPLACE FUNCTION public.get_governed_customers(
  p_token text,
  p_search text DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  v_emp_id := app.current_employee_id();
  v_is_customer := (v_session.identity_type = 'customer');

  -- Customer sessions: show only their own customer record
  IF v_is_customer THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'company_name', c.company_name,
      'responsible_name', c.responsible_name, 'business_type', c.business_type,
      'email', c.email, 'phone', i.phone,
      'credit_limit', c.credit_limit, 'credit_days', c.credit_days,
      'owner_id', c.owner_id, 'owner_name', e.full_name,
      'is_active', c.is_active, 'location_id', c.location_id,
      'area', (SELECT TRIM(COALESCE(ca3.city, '') || ' ' || COALESCE(ca3.governorate, '')) FROM customer_addresses ca3 WHERE ca3.customer_id = c.id AND ca3.is_default = true LIMIT 1),
      'registered_at', c.registered_at, 'created_at', c.created_at
    )) INTO v_result
    FROM customers c
    JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id
    WHERE c.identity_id = v_session.identity_id
      AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to);
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
      'area', (SELECT TRIM(COALESCE(ca3.city, '') || ' ' || COALESCE(ca3.governorate, '')) FROM customer_addresses ca3 WHERE ca3.customer_id = c.id AND ca3.is_default = true LIMIT 1),
      'registered_at', c.registered_at, 'created_at', c.created_at
    )) INTO v_result
    FROM customers c
    JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id
    WHERE (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
      AND (p_employee_id IS NULL OR c.owner_id = p_employee_id)
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to);
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
    'area', (SELECT TRIM(COALESCE(ca3.city, '') || ' ' || COALESCE(ca3.governorate, '')) FROM customer_addresses ca3 WHERE ca3.customer_id = c.id AND ca3.is_default = true LIMIT 1),
    'registered_at', c.registered_at, 'created_at', c.created_at
  )) INTO v_result
  FROM customers c
  JOIN identities i ON i.id = c.identity_id
  LEFT JOIN employees e ON e.id = c.owner_id
  WHERE c.owner_id = ANY(app.get_subtree_ids(v_emp_id))
    AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
    AND (p_employee_id IS NULL OR c.owner_id = p_employee_id)
    AND (p_date_from IS NULL OR c.created_at >= p_date_from)
    AND (p_date_to IS NULL OR c.created_at <= p_date_to);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_customers IS 'قائمة العملاء مع دعم البحث بالاسم والكود والهاتف والعنوان والنطاق الهرمي والفلاتر الزمنية';

-- =============================================================================
-- 2. unified_search — add company_name to product search,
--    add phone + address to customer search
-- =============================================================================

DROP FUNCTION IF EXISTS public.unified_search(uuid, text, text, jsonb, int, int, text);

CREATE OR REPLACE FUNCTION public.unified_search(
  p_token uuid,
  p_entity text,
  p_query text DEFAULT NULL,
  p_filters jsonb DEFAULT '{}',
  p_page int DEFAULT 1,
  p_per_page int DEFAULT 20,
  p_order_by text DEFAULT 'relevance'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_identity_id uuid;
  v_employee_id uuid;
  v_identity_type text;
  v_visible uuid[];
  v_is_super boolean;
  v_tokens text[];
  v_token text;
  v_sql text;
  v_count_sql text;
  v_where text := '';
  v_token_where text := '';
  v_order text := '';
  v_offset int;
  v_result jsonb;
  v_total bigint;
  v_searchable_cols text[];
  v_col text;
  v_sim_args text := '';
  v_fallback_order text := '';
  v_base_select text;
  v_base_from text;
  v_base_where text := '';
  v_auth_where text := '';
  v_filter_where text := '';
  v_has_query boolean;
BEGIN
  SELECT * INTO v_session
  FROM app.sessions
  WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION', 'data', '[]'::jsonb, 'total', 0, 'page', p_page, 'per_page', p_per_page);
  END IF;

  v_identity_id := v_session.identity_id;
  v_employee_id := v_session.employee_id;
  v_identity_type := v_session.identity_type;
  v_offset := (p_page - 1) * p_per_page;

  v_has_query := p_query IS NOT NULL AND trim(p_query) != '';
  IF v_has_query THEN
    v_tokens := regexp_split_to_array(trim(p_query), '\s+');
  ELSE
    v_tokens := '{}'::text[];
  END IF;

  IF v_identity_type = 'employee' THEN
    v_is_super := public.is_upper_management(v_employee_id);
    IF v_is_super THEN
      SELECT array_agg(id) INTO v_visible FROM employees;
    ELSE
      v_visible := COALESCE(app.get_subtree_ids(v_employee_id), '{}'::uuid[]);
    END IF;
  END IF;

  CASE p_entity
    WHEN 'products' THEN
      v_searchable_cols := ARRAY['p.product_name', 'p.legacy_code', 'comp.company_name'];
      v_base_select := '
        p.id, p.product_name, p.legacy_code, p.description,
        p.company_id, comp.company_name,
        p.is_active, p.is_visible, p.is_out_of_stock,
        p.image_url, p.carton_price, p.carton_quantity, p.created_at,
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(''id'', pu.id, ''unit_type'', pu.unit_type, ''is_active'', pu.is_active)
             ORDER BY pu.unit_type)
           FROM product_units pu WHERE pu.product_id = p.id),
          ''[]''::jsonb
        ) AS product_units,
        (SELECT jsonb_build_object(''quantity'', inv.quantity)
         FROM inventory inv WHERE inv.product_id = p.id LIMIT 1) AS inventory';
      v_base_from := 'FROM products p JOIN companies comp ON comp.id = p.company_id';
      v_auth_where := 'TRUE';
      IF (p_filters ? 'company_id') AND (p_filters->>'company_id') IS NOT NULL AND (p_filters->>'company_id') != '' THEN
        v_filter_where := v_filter_where || format(' AND p.company_id = %L', p_filters->>'company_id');
      END IF;
      IF (p_filters ? 'active_only') AND (p_filters->>'active_only')::boolean THEN
        v_filter_where := v_filter_where || ' AND p.is_active = true';
      END IF;
      IF (p_filters ? 'visible_only') AND (p_filters->>'visible_only')::boolean THEN
        v_filter_where := v_filter_where || ' AND p.is_visible = true';
      END IF;
      IF (p_filters ? 'status') AND (p_filters->>'status') IS NOT NULL AND (p_filters->>'status') != '' THEN
        CASE p_filters->>'status'
          WHEN 'active' THEN v_filter_where := v_filter_where || ' AND p.is_active = true AND p.is_out_of_stock = false';
          WHEN 'out_of_stock' THEN v_filter_where := v_filter_where || ' AND p.is_active = true AND p.is_out_of_stock = true';
          WHEN 'inactive' THEN v_filter_where := v_filter_where || ' AND p.is_active = false';
          ELSE NULL;
        END CASE;
      END IF;
      v_fallback_order := 'p.product_name';
      v_sim_args := format('similarity(p.product_name, %L), similarity(p.legacy_code, %L), similarity(comp.company_name, %L)', COALESCE(p_query, ''), COALESCE(p_query, ''), COALESCE(p_query, ''));

    WHEN 'customers' THEN
      v_searchable_cols := ARRAY['c.company_name', 'c.code', 'i.phone',
        'ca_addr.address_line1', 'ca_addr.city', 'ca_addr.governorate'];
      v_base_select := '
        c.id, c.code, c.company_name, c.email,
        c.credit_limit, c.credit_days, c.owner_id,
        c.is_active, c.business_type, c.responsible_name,
        c.created_at, i.phone,
        ca_addr.address_line1, ca_addr.city, ca_addr.governorate';
      v_base_from := '
        FROM customers c
        JOIN identities i ON i.id = c.identity_id
        LEFT JOIN LATERAL (
          SELECT address_line1, city, governorate
          FROM customer_addresses
          WHERE customer_id = c.id AND is_default = true
          LIMIT 1
        ) ca_addr ON true';
      IF v_identity_type = 'customer' THEN
        v_auth_where := format('c.identity_id = %L', v_identity_id);
      ELSIF v_identity_type = 'employee' THEN
        IF v_visible IS NOT NULL AND array_length(v_visible, 1) > 0 THEN
          v_auth_where := format('c.owner_id = ANY(%L)', v_visible);
        ELSE
          v_auth_where := 'FALSE';
        END IF;
      ELSE
        v_auth_where := 'FALSE';
      END IF;
      IF (p_filters ? 'is_active') AND (p_filters->>'is_active') IS NOT NULL THEN
        v_filter_where := v_filter_where || format(' AND c.is_active = %L', (p_filters->>'is_active')::boolean);
      END IF;
      IF (p_filters ? 'business_type') AND (p_filters->>'business_type') IS NOT NULL AND (p_filters->>'business_type') != '' THEN
        v_filter_where := v_filter_where || format(' AND c.business_type = %L', p_filters->>'business_type');
      END IF;
      v_fallback_order := 'c.company_name';
      v_sim_args := format(
        'similarity(c.company_name, %L), similarity(c.code, %L), similarity(i.phone, %L)',
        COALESCE(p_query, ''), COALESCE(p_query, ''), COALESCE(p_query, '')
      );

    WHEN 'employees' THEN
      v_searchable_cols := ARRAY['e.full_name', 'e.code'];
      v_base_select := 'e.id, e.identity_id, e.code, e.full_name, e.email, e.manager_id, e.is_active, e.address, e.created_at';
      v_base_from := 'FROM employees e';
      IF v_identity_type = 'employee' THEN
        IF v_is_super THEN
          v_auth_where := 'TRUE';
        ELSIF v_visible IS NOT NULL AND array_length(v_visible, 1) > 0 THEN
          v_auth_where := format('e.id = ANY(%L)', v_visible);
        ELSE
          v_auth_where := format('e.id = %L', v_employee_id);
        END IF;
      ELSE
        v_auth_where := 'FALSE';
      END IF;
      IF (p_filters ? 'is_active') AND (p_filters->>'is_active') IS NOT NULL THEN
        v_filter_where := v_filter_where || format(' AND e.is_active = %L', (p_filters->>'is_active')::boolean);
      END IF;
      v_fallback_order := 'e.full_name';
      v_sim_args := format('similarity(e.full_name, %L), similarity(e.code, %L)', COALESCE(p_query, ''), COALESCE(p_query, ''));

    WHEN 'orders' THEN
      v_searchable_cols := ARRAY['o.order_number', 'COALESCE(o.snapshot_customer_name, c.company_name)'];
      v_base_select := '
        o.id, o.order_number, o.status, o.delivery_mode, o.payment_method,
        o.total_amount, o.revision_number,
        o.customer_id, COALESCE(o.snapshot_customer_name, c.company_name) AS customer_name,
        o.snapshot_customer_code AS customer_code,
        o.snapshot_customer_phone AS customer_phone,
        o.created_by, o.created_at, o.submitted_at, o.approved_at, o.notes,
        COALESCE(o.snapshot_owner_name, e.full_name) AS owner_name,
        COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, '''') AS created_by_name';
      v_base_from := '
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN employees e ON e.id = o.owner_id
        LEFT JOIN identities oc_i ON oc_i.id = o.created_by
        LEFT JOIN employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = ''employee''
        LEFT JOIN customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = ''customer''';
      IF v_identity_type = 'customer' THEN
        v_auth_where := format('o.customer_id = %L', (SELECT customer_id FROM customers WHERE identity_id = v_identity_id LIMIT 1));
      ELSIF v_identity_type = 'employee' THEN
        IF v_is_super THEN
          v_auth_where := 'TRUE';
        ELSIF v_visible IS NOT NULL AND array_length(v_visible, 1) > 0 THEN
          v_auth_where := format('c.owner_id = ANY(%L)', v_visible);
        ELSE
          v_auth_where := format('o.created_by = %L', v_identity_id);
        END IF;
      ELSE
        v_auth_where := 'FALSE';
      END IF;
      IF (p_filters ? 'status') AND (p_filters->>'status') IS NOT NULL AND (p_filters->>'status') != '' THEN
        v_filter_where := v_filter_where || format(' AND o.status = %L', p_filters->>'status');
      END IF;
      IF (p_filters ? 'customer_id') AND (p_filters->>'customer_id') IS NOT NULL AND (p_filters->>'customer_id') != '' THEN
        v_filter_where := v_filter_where || format(' AND o.customer_id = %L', p_filters->>'customer_id');
      END IF;
      IF (p_filters ? 'date_from') AND (p_filters->>'date_from') IS NOT NULL AND (p_filters->>'date_from') != '' THEN
        v_filter_where := v_filter_where || format(' AND o.created_at >= %L', (p_filters->>'date_from')::timestamptz);
      END IF;
      IF (p_filters ? 'date_to') AND (p_filters->>'date_to') IS NOT NULL AND (p_filters->>'date_to') != '' THEN
        v_filter_where := v_filter_where || format(' AND o.created_at <= %L', (p_filters->>'date_to')::timestamptz);
      END IF;
      v_fallback_order := 'o.created_at DESC';
      v_sim_args := format(
        'similarity(o.order_number, %L), similarity(COALESCE(o.snapshot_customer_name, c.company_name), %L)',
        COALESCE(p_query, ''), COALESCE(p_query, '')
      );

    WHEN 'visits' THEN
      v_searchable_cols := ARRAY['v.code', 'c.company_name'];
      v_base_select := 'v.id, v.code, v.employee_id, v.customer_id, c.company_name AS customer_name, v.status, v.check_in_at, v.check_out_at, v.visit_result, v.notes, v.created_at';
      v_base_from := 'FROM visits v JOIN customers c ON c.id = v.customer_id';
      IF v_identity_type = 'customer' THEN
        v_auth_where := format('v.customer_id = %L', (SELECT customer_id FROM customers WHERE identity_id = v_identity_id LIMIT 1));
      ELSIF v_identity_type = 'employee' THEN
        IF v_is_super THEN
          v_auth_where := 'TRUE';
        ELSIF v_visible IS NOT NULL AND array_length(v_visible, 1) > 0 THEN
          v_auth_where := format('v.employee_id = ANY(%L)', v_visible);
        ELSE
          v_auth_where := format('v.employee_id = %L', v_employee_id);
        END IF;
      ELSE
        v_auth_where := 'FALSE';
      END IF;
      IF (p_filters ? 'status') AND (p_filters->>'status') IS NOT NULL AND (p_filters->>'status') != '' THEN
        v_filter_where := v_filter_where || format(' AND v.status = %L', p_filters->>'status');
      END IF;
      IF (p_filters ? 'customer_id') AND (p_filters->>'customer_id') IS NOT NULL AND (p_filters->>'customer_id') != '' THEN
        v_filter_where := v_filter_where || format(' AND v.customer_id = %L', p_filters->>'customer_id');
      END IF;
      IF (p_filters ? 'date_from') AND (p_filters->>'date_from') IS NOT NULL AND (p_filters->>'date_from') != '' THEN
        v_filter_where := v_filter_where || format(' AND v.check_in_at >= %L', (p_filters->>'date_from')::timestamptz);
      END IF;
      IF (p_filters ? 'date_to') AND (p_filters->>'date_to') IS NOT NULL AND (p_filters->>'date_to') != '' THEN
        v_filter_where := v_filter_where || format(' AND v.check_in_at <= %L', (p_filters->>'date_to')::timestamptz);
      END IF;
      v_fallback_order := 'v.check_in_at DESC';
      v_sim_args := format('similarity(v.code, %L), similarity(c.company_name, %L)', COALESCE(p_query, ''), COALESCE(p_query, ''));

    WHEN 'collections' THEN
      v_searchable_cols := ARRAY['cl.code', 'c.company_name', 'cl.reference_number'];
      v_base_select := 'cl.id, cl.code, cl.customer_id, c.company_name AS customer_name, cl.method, cl.amount, cl.reference_number, cl.status, cl.notes, cl.collected_at, cl.created_by, cl.created_at, cl.order_id';
      v_base_from := 'FROM collections cl JOIN customers c ON c.id = cl.customer_id';
      IF v_identity_type = 'customer' THEN
        v_auth_where := format('cl.customer_id = %L', (SELECT customer_id FROM customers WHERE identity_id = v_identity_id LIMIT 1));
      ELSIF v_identity_type = 'employee' THEN
        IF v_is_super THEN
          v_auth_where := 'TRUE';
        ELSIF v_visible IS NOT NULL AND array_length(v_visible, 1) > 0 THEN
          v_auth_where := format('c.owner_id = ANY(%L)', v_visible);
        ELSE
          v_auth_where := 'FALSE';
        END IF;
      ELSE
        v_auth_where := 'FALSE';
      END IF;
      IF (p_filters ? 'status') AND (p_filters->>'status') IS NOT NULL AND (p_filters->>'status') != '' THEN
        v_filter_where := v_filter_where || format(' AND cl.status = %L', p_filters->>'status');
      END IF;
      IF (p_filters ? 'method') AND (p_filters->>'method') IS NOT NULL AND (p_filters->>'method') != '' THEN
        v_filter_where := v_filter_where || format(' AND cl.method = %L', p_filters->>'method');
      END IF;
      IF (p_filters ? 'customer_id') AND (p_filters->>'customer_id') IS NOT NULL AND (p_filters->>'customer_id') != '' THEN
        v_filter_where := v_filter_where || format(' AND cl.customer_id = %L', p_filters->>'customer_id');
      END IF;
      IF (p_filters ? 'date_from') AND (p_filters->>'date_from') IS NOT NULL AND (p_filters->>'date_from') != '' THEN
        v_filter_where := v_filter_where || format(' AND cl.collected_at >= %L', (p_filters->>'date_from')::timestamptz);
      END IF;
      IF (p_filters ? 'date_to') AND (p_filters->>'date_to') IS NOT NULL AND (p_filters->>'date_to') != '' THEN
        v_filter_where := v_filter_where || format(' AND cl.collected_at <= %L', (p_filters->>'date_to')::timestamptz);
      END IF;
      v_fallback_order := 'cl.created_at DESC';
      v_sim_args := format('similarity(cl.code, %L), similarity(c.company_name, %L), similarity(cl.reference_number, %L)', COALESCE(p_query, ''), COALESCE(p_query, ''), COALESCE(p_query, ''));

    ELSE
      RETURN jsonb_build_object('error', 'UNKNOWN_ENTITY: ' || p_entity, 'data', '[]'::jsonb, 'total', 0, 'page', p_page, 'per_page', p_per_page);
  END CASE;

  -- Build token WHERE conditions
  IF v_has_query AND array_length(v_tokens, 1) > 0 THEN
    FOREACH v_token IN ARRAY v_tokens LOOP
      IF v_token = '' THEN CONTINUE; END IF;
      v_token_where := v_token_where || ' AND (';
      FOR i IN 1 .. array_length(v_searchable_cols, 1) LOOP
        v_col := v_searchable_cols[i];
        IF i > 1 THEN v_token_where := v_token_where || ' OR '; END IF;
        IF v_col LIKE '%COALESCE(%' THEN
          v_token_where := v_token_where || format('%s ILIKE %L', v_col, '%' || v_token || '%');
        ELSE
          v_token_where := v_token_where || format('%s ILIKE %L', v_col, '%' || v_token || '%');
        END IF;
      END LOOP;
      v_token_where := v_token_where || ')';
    END LOOP;
  END IF;

  -- Build ORDER BY
  IF v_has_query THEN
    v_order := format(' ORDER BY GREATEST(%s) DESC', v_sim_args);
  ELSE
    v_order := ' ORDER BY ' || v_fallback_order;
  END IF;

  -- Combine WHERE clauses
  v_where := 'WHERE (' || v_auth_where || ')' || v_filter_where || v_token_where;

  -- Count query
  v_count_sql := 'SELECT COUNT(*) FROM (SELECT 1 ' || v_base_from || ' ' || v_where || ' LIMIT 10000) cnt';
  EXECUTE v_count_sql INTO v_total;

  -- Data query
  v_sql := format(
    'SELECT jsonb_build_object(''data'', COALESCE(jsonb_agg(subq), ''[]''::jsonb), ''total'', %L, ''page'', %L, ''per_page'', %L, ''query'', %L) FROM (SELECT %s %s %s %s %s) subq',
    v_total, p_page, p_per_page, COALESCE(p_query, ''),
    v_base_select, v_base_from, v_where, v_order,
    format('LIMIT %L OFFSET %L', p_per_page, v_offset)
  );

  EXECUTE v_sql INTO v_result;
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'error', SQLERRM,
    'detail', SQLSTATE,
    'data', '[]'::jsonb,
    'total', 0,
    'page', p_page,
    'per_page', p_per_page
  );
END;
$$;

COMMENT ON FUNCTION public.unified_search IS 'محرك البحث الذكي الموحد — يدعم المنتجات (بالاسم والكود والشركة)، العملاء (بالاسم والكود والهاتف والعنوان)، الموظفين، الطلبات، الزيارات، التحصيلات';
