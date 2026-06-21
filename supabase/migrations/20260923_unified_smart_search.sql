-- =============================================================================
-- Unified Smart Search Engine
-- pg_trgm + GIN indexes + Token AND Search
-- Supports: products, customers, employees, orders, visits, collections
-- =============================================================================

-- 1. Enable pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- 2. GIN Trigram Indexes
-- =============================================================================

-- Products
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_name_trgm
  ON products USING GIN (product_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_code_trgm
  ON products USING GIN (legacy_code gin_trgm_ops);

-- Customers
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_name_trgm
  ON customers USING GIN (company_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_code_trgm
  ON customers USING GIN (code gin_trgm_ops);

-- Employees
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_name_trgm
  ON employees USING GIN (full_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_code_trgm
  ON employees USING GIN (code gin_trgm_ops);

-- Orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_number_trgm
  ON orders USING GIN (order_number gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_snapshot_customer_trgm
  ON orders USING GIN (snapshot_customer_name gin_trgm_ops);

-- Visits
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_code_trgm
  ON visits USING GIN (code gin_trgm_ops);

-- Collections
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collections_code_trgm
  ON collections USING GIN (code gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collections_reference_trgm
  ON collections USING GIN (reference_number gin_trgm_ops);

-- =============================================================================
-- 3. unified_search RPC
-- =============================================================================

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
  v_join_sql text := '';
  v_has_query boolean;
BEGIN
  -- 1. Validate session
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

  -- 2. Tokenize query
  v_has_query := p_query IS NOT NULL AND trim(p_query) != '';
  IF v_has_query THEN
    v_tokens := regexp_split_to_array(trim(p_query), '\s+');
  ELSE
    v_tokens := '{}'::text[];
  END IF;

  -- 3. Resolve visibility (only for employee-scoped entities)
  IF v_identity_type = 'employee' THEN
    v_is_super := public.is_upper_management(v_employee_id);
    IF v_is_super THEN
      SELECT array_agg(id) INTO v_visible FROM employees;
    ELSE
      v_visible := COALESCE(app.get_subtree_ids(v_employee_id), '{}'::uuid[]);
    END IF;
  END IF;

  -- 4. Build per-entity query
  CASE p_entity
    WHEN 'products' THEN
      v_searchable_cols := ARRAY['p.product_name', 'p.legacy_code'];
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
      -- Auth: products are org-wide, no employee scoping
      v_auth_where := 'TRUE';
      -- Filters
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
      v_sim_args := format('similarity(p.product_name, %L), similarity(p.legacy_code, %L)', COALESCE(p_query, ''), COALESCE(p_query, ''));

    WHEN 'customers' THEN
      v_searchable_cols := ARRAY['c.company_name', 'c.code'];
      v_base_select := 'c.id, c.code, c.company_name, c.email, c.credit_limit, c.credit_days, c.owner_id, c.is_active, c.business_type, c.responsible_name, c.created_at';
      v_base_from := 'FROM customers c';
      -- Auth: scoped by employee tree via customer owner
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
      -- Filters
      IF (p_filters ? 'is_active') AND (p_filters->>'is_active') IS NOT NULL THEN
        v_filter_where := v_filter_where || format(' AND c.is_active = %L', (p_filters->>'is_active')::boolean);
      END IF;
      IF (p_filters ? 'business_type') AND (p_filters->>'business_type') IS NOT NULL AND (p_filters->>'business_type') != '' THEN
        v_filter_where := v_filter_where || format(' AND c.business_type = %L', p_filters->>'business_type');
      END IF;
      v_fallback_order := 'c.company_name';
      v_sim_args := format('similarity(c.company_name, %L), similarity(c.code, %L)', COALESCE(p_query, ''), COALESCE(p_query, ''));

    WHEN 'employees' THEN
      v_searchable_cols := ARRAY['e.full_name', 'e.code'];
      v_base_select := 'e.id, e.identity_id, e.code, e.full_name, e.email, e.manager_id, e.is_active, e.address, e.created_at';
      v_base_from := 'FROM employees e';
      -- Auth: subtree scoping (employees see their subtree)
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
      -- Filters
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
      -- Auth
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
      -- Filters
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
      -- Auth
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
      -- Filters
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
      -- Auth
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
      -- Filters
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

  -- 5. Build token WHERE conditions
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

  -- 6. Build ORDER BY
  IF v_has_query THEN
    v_order := format(' ORDER BY GREATEST(%s) DESC', v_sim_args);
  ELSE
    v_order := ' ORDER BY ' || v_fallback_order;
  END IF;

  -- 7. Combine WHERE clauses
  v_where := 'WHERE (' || v_auth_where || ')' || v_filter_where || v_token_where;

  -- 8. Count query
  v_count_sql := 'SELECT COUNT(*) FROM (SELECT 1 ' || v_base_from || ' ' || v_where || ' LIMIT 10000) cnt';
  EXECUTE v_count_sql INTO v_total;

  -- 9. Data query (returns JSON directly)
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

COMMENT ON FUNCTION public.unified_search IS 'محرك البحث الذكي الموحد — يدعم المنتجات، العملاء، الموظفين، الطلبات، الزيارات، التحصيلات';
