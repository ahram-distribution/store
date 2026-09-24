-- ----------------------------------------------------------------------------
-- ORDERS WS2 — get_unified_orders SERVER-SIDE PAGINATION / COUNT / SUMMARY /
--              SERVER-SIDE MULTI-FILTERS
-- ----------------------------------------------------------------------------
-- get_unified_orders gains:
--   * multi-option filters (statuses / order types / tiers / governorates /
--     created-by employees) that were previously applied CLIENT-SIDE on the
--     full list — all now server-side, BEFORE pagination;
--   * p_owner_id (my_invoices tab: o.owner_id = p_owner_id);
--   * p_page + p_per_page (1-based; when both NULL the legacy full-list
--     behaviour is preserved for the 10 other callers);
--   * p_count_only  -> {"count": N}            (same WHERE as the page)
--   * p_summary     -> {"count": N, "total_value": V, "status_counts": {...}}
--                      over the FULLY-FILTERED set (feeds ResultsSummary total +
--                      totalValue + StatusKpiBar without fetching the dataset);
--   * tier_id + snapshot_tier_name added to each order row (were missing, so
--     the OrdersPage tier filter had no options; additive, harmless to callers).
--
-- All new params are DEFAULT NULL/false so existing callers keep resolving.
-- Function MUST stay a single overload (PostgREST PGRST203), so every existing
-- overload is dropped first (same pattern as 20271126 / 20271125).
--
-- NOTE (PGRST-friendly boolean params): pass p_count_only / p_summary
-- explicitly as true/false; do NOT pass NULL.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 0. Drop all existing overloads (this name keeps ONE canonical signature)
-- ============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_unified_orders'
  LOOP
    EXECUTE format('DROP FUNCTION public.%s', r.sig);
  END LOOP;
END $$;

-- ============================================================================
-- 1. get_unified_orders — pagination + count + summary + server-side filters
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_unified_orders(
  p_token uuid,
  p_search text DEFAULT NULL::text,
  p_status character varying DEFAULT NULL::character varying,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_created_by uuid DEFAULT NULL::uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_governorate_id uuid DEFAULT NULL::uuid,
  p_include_strict_previous boolean DEFAULT false,
  p_date_source text DEFAULT 'created'::text,
  p_statuses text[] DEFAULT NULL::text[],
  p_order_types text[] DEFAULT NULL::text[],
  p_tier_ids uuid[] DEFAULT NULL::uuid[],
  p_governorate_ids uuid[] DEFAULT NULL::uuid[],
  p_created_by_ids uuid[] DEFAULT NULL::uuid[],
  p_owner_id uuid DEFAULT NULL::uuid,
  p_page integer DEFAULT NULL::integer,
  p_per_page integer DEFAULT NULL::integer,
  p_count_only boolean DEFAULT false,
  p_summary boolean DEFAULT false
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
  v_view_all boolean;
  v_limit integer;
  v_offset integer;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_view_all := (v_session.identity_type = 'employee') AND app.has_capability('orders.view_all');
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

  v_limit := COALESCE(p_per_page, 1000000);
  v_offset := COALESCE((p_page - 1) * v_limit, 0);

  -- --------------------------------------------------------------------------
  -- 1a. SUMMARY: count + total_value + per-status counts over the SAME fully
  --     filtered WHERE as the paged rows (single lightweight scan, no laterals).
  -- --------------------------------------------------------------------------
  IF p_summary THEN
    SELECT jsonb_build_object(
      'count', COUNT(*)::bigint,
      'total_value', COALESCE(SUM(o.total_amount), 0),
      'status_counts', (
        SELECT COALESCE(jsonb_object_agg(s.status, s.cnt), '{}'::jsonb)
        FROM (
          SELECT o2.status AS status, COUNT(*)::bigint AS cnt
          FROM public.orders o2
          JOIN public.customers c2 ON c2.id = o2.customer_id
          LEFT JOIN public.identities ci2 ON ci2.id = c2.identity_id
          LEFT JOIN public.customer_addresses ca2 ON ca2.customer_id = c2.id AND ca2.is_default = true
          LEFT JOIN public.identities oc_i2 ON oc_i2.id = o2.created_by
          LEFT JOIN public.employees oc_emp2 ON oc_emp2.identity_id = oc_i2.id AND oc_i2.identity_type = 'employee'
          WHERE (
            (v_session.identity_type = 'customer' AND o2.customer_id = v_session.customer_id)
            OR (v_session.identity_type = 'employee' AND (v_is_super OR v_view_all OR c2.owner_id = ANY(v_visible)))
          )
            AND (p_search IS NULL OR
                 o2.order_number ILIKE '%' || p_search || '%' OR
                 o2.reference_number ILIKE '%' || p_search || '%' OR
                 c2.company_name ILIKE '%' || p_search || '%' OR
                 o2.snapshot_customer_name ILIKE '%' || p_search || '%' OR
                 COALESCE(o2.snapshot_customer_phone, ci2.phone) ILIKE '%' || p_search || '%')
            AND (p_status IS NULL OR o2.status = p_status)
            AND (p_statuses IS NULL OR o2.status = ANY(p_statuses))
            AND (p_customer_id IS NULL OR o2.customer_id = p_customer_id)
            AND (p_created_by IS NULL OR o2.created_by = p_created_by)
            AND (p_created_by_ids IS NULL OR o2.created_by = ANY(p_created_by_ids) OR oc_emp2.id = ANY(p_created_by_ids))
            AND (p_owner_id IS NULL OR o2.owner_id = p_owner_id)
            AND (p_date_from IS NULL OR
                 CASE WHEN p_date_source = 'event' THEN o2.updated_at ELSE o2.created_at END >= p_date_from)
            AND (p_date_to IS NULL OR
                 CASE WHEN p_date_source = 'event' THEN o2.updated_at ELSE o2.created_at END <= p_date_to)
            AND (p_governorate_id IS NULL OR ca2.governorate_id = p_governorate_id)
            AND (p_governorate_ids IS NULL OR ca2.governorate_id = ANY(p_governorate_ids))
            AND (p_tier_ids IS NULL OR o2.tier_id = ANY(p_tier_ids))
            AND (p_order_types IS NULL OR COALESCE(o2.order_type, 'cash') = ANY(p_order_types))
          GROUP BY o2.status
        ) s
      )
    ) INTO v_result
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.identities ci ON ci.id = c.identity_id
    LEFT JOIN public.customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = true
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    WHERE (
      (v_session.identity_type = 'customer' AND o.customer_id = v_session.customer_id)
      OR (v_session.identity_type = 'employee' AND (v_is_super OR v_view_all OR c.owner_id = ANY(v_visible)))
    )
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           o.reference_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%' OR
           COALESCE(o.snapshot_customer_phone, ci.phone) ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_statuses IS NULL OR o.status = ANY(p_statuses))
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_created_by_ids IS NULL OR o.created_by = ANY(p_created_by_ids) OR oc_emp.id = ANY(p_created_by_ids))
      AND (p_owner_id IS NULL OR o.owner_id = p_owner_id)
      AND (p_date_from IS NULL OR
           CASE WHEN p_date_source = 'event' THEN o.updated_at ELSE o.created_at END >= p_date_from)
      AND (p_date_to IS NULL OR
           CASE WHEN p_date_source = 'event' THEN o.updated_at ELSE o.created_at END <= p_date_to)
      AND (p_governorate_id IS NULL OR ca.governorate_id = p_governorate_id)
      AND (p_governorate_ids IS NULL OR ca.governorate_id = ANY(p_governorate_ids))
      AND (p_tier_ids IS NULL OR o.tier_id = ANY(p_tier_ids))
      AND (p_order_types IS NULL OR COALESCE(o.order_type, 'cash') = ANY(p_order_types));
    RETURN v_result;
  END IF;

  -- --------------------------------------------------------------------------
  -- 1b. COUNT ONLY: same fully filtered WHERE, no laterals.
  -- --------------------------------------------------------------------------
  IF p_count_only THEN
    SELECT jsonb_build_object('count', COUNT(*)) INTO v_result
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.identities ci ON ci.id = c.identity_id
    LEFT JOIN public.customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = true
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    WHERE (
      (v_session.identity_type = 'customer' AND o.customer_id = v_session.customer_id)
      OR (v_session.identity_type = 'employee' AND (v_is_super OR v_view_all OR c.owner_id = ANY(v_visible)))
    )
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           o.reference_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%' OR
           COALESCE(o.snapshot_customer_phone, ci.phone) ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_statuses IS NULL OR o.status = ANY(p_statuses))
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_created_by_ids IS NULL OR o.created_by = ANY(p_created_by_ids) OR oc_emp.id = ANY(p_created_by_ids))
      AND (p_owner_id IS NULL OR o.owner_id = p_owner_id)
      AND (p_date_from IS NULL OR
           CASE WHEN p_date_source = 'event' THEN o.updated_at ELSE o.created_at END >= p_date_from)
      AND (p_date_to IS NULL OR
           CASE WHEN p_date_source = 'event' THEN o.updated_at ELSE o.created_at END <= p_date_to)
      AND (p_governorate_id IS NULL OR ca.governorate_id = p_governorate_id)
      AND (p_governorate_ids IS NULL OR ca.governorate_id = ANY(p_governorate_ids))
      AND (p_tier_ids IS NULL OR o.tier_id = ANY(p_tier_ids))
      AND (p_order_types IS NULL OR COALESCE(o.order_type, 'cash') = ANY(p_order_types));
    RETURN v_result;
  END IF;

  -- --------------------------------------------------------------------------
  -- 1c. PAGED ROWS: full existing row shape (+ tier_id / snapshot_tier_name)
  --     with the same WHERE, deterministic ORDER BY and LIMIT/OFFSET.
  -- --------------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(sub.data), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'status', o.status,
      'delivery_mode', o.delivery_mode,
      'payment_method', o.payment_method,
      'order_type', o.order_type,
      'tier_id', o.tier_id,
      'snapshot_tier_name', o.snapshot_tier_name,
      'total_amount', o.total_amount,
      'revision_number', o.revision_number,
      'reference_number', o.reference_number,
      'customer_id', o.customer_id,
      'customer_name', COALESCE(c.company_name, o.snapshot_customer_name),
      'customer_code', o.snapshot_customer_code,
      'customer_phone', COALESCE(ci.phone, o.snapshot_customer_phone),
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
      'previous_order_total', ps.last_order_total,
      'strict_previous_order_count', sps.order_count,
      'strict_previous_orders_total', sps.orders_total,
      'strict_previous_order_total', sps.last_order_total,
      'strict_previous_order_date', sps.last_order_date
    ) AS data
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
    LEFT JOIN LATERAL (
      SELECT
        count(*)::bigint AS order_count,
        COALESCE(sum(total_amount), 0) AS orders_total,
        (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total,
        max(created_at) AS last_order_date
      FROM public.orders o3
      WHERE o3.customer_id = o.customer_id AND o3.created_at < o.created_at
    ) sps ON p_include_strict_previous
    WHERE (
      -- Customer: see only own orders by customer_id
      (v_session.identity_type = 'customer' AND o.customer_id = v_session.customer_id)
      OR
      -- Employee: use existing visibility rules
      (v_session.identity_type = 'employee' AND (v_is_super OR v_view_all OR c.owner_id = ANY(v_visible)))
    )
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           o.reference_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%' OR
           COALESCE(o.snapshot_customer_phone, ci.phone) ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_statuses IS NULL OR o.status = ANY(p_statuses))
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_created_by_ids IS NULL OR o.created_by = ANY(p_created_by_ids) OR oc_emp.id = ANY(p_created_by_ids))
      AND (p_owner_id IS NULL OR o.owner_id = p_owner_id)
      AND (p_date_from IS NULL OR
           CASE WHEN p_date_source = 'event' THEN o.updated_at ELSE o.created_at END >= p_date_from)
      AND (p_date_to IS NULL OR
           CASE WHEN p_date_source = 'event' THEN o.updated_at ELSE o.created_at END <= p_date_to)
      AND (p_governorate_id IS NULL OR ca.governorate_id = p_governorate_id)
      AND (p_governorate_ids IS NULL OR ca.governorate_id = ANY(p_governorate_ids))
      AND (p_tier_ids IS NULL OR o.tier_id = ANY(p_tier_ids))
      AND (p_order_types IS NULL OR COALESCE(o.order_type, 'cash') = ANY(p_order_types))
    ORDER BY
      CASE WHEN p_date_source = 'event' THEN o.updated_at ELSE o.created_at END DESC NULLS LAST,
      o.created_at DESC,
      o.id
    LIMIT v_limit
    OFFSET v_offset
  ) sub;

  RETURN v_result;
END;
$function$;

-- ============================================================================
-- 2. Grants (fresh OID after the drop; EXECUTE parity with the prior def)
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.get_unified_orders(uuid, text, character varying, uuid, uuid, timestamp with time zone, timestamp with time zone, uuid, boolean, text, text[], text[], uuid[], uuid[], uuid[], uuid, integer, integer, boolean, boolean) TO anon, authenticated, service_role;

-- ============================================================================
-- 3. Comment
-- ============================================================================
COMMENT ON FUNCTION public.get_unified_orders(uuid, text, character varying, uuid, uuid, timestamp with time zone, timestamp with time zone, uuid, boolean, text, text[], text[], uuid[], uuid[], uuid[], uuid, integer, integer, boolean, boolean) IS
  'الطلبات الموحدة — ترقيم صفحات وعدد وملخص وفلاتر متعددة (حالة/نوع/شريحة/محافظة/مسؤول) من جهة السيرفر مع نفس نطاق الرؤية الأمني.';