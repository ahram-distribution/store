-- Visit Cards + Visit Details — live customer context.
--
-- 1) get_governed_visits: add a per-visit "customer_context" jsonb object so the
--    Visits list can render a compact customer summary without issuing one
--    query per card. Context is batched inside the single list query:
--      - current customer name/phone/address (live, not snapshot)
--      - customer creation date + creating/owning employee name
--      - ACTUAL order metrics (count / total / latest date) using the
--        application's authoritative business rule public.is_order_in_statistics
--        (excludes draft/submitted/reviewing/returned_for_revision/cancelled)
--      - total customer visit count
--
-- 2) get_customer_visit_context: dedicated fetch for the Visit Details screen
--    returning the same live customer record + summary, plus a "previous visits"
--    history list for that customer that EXCLUDES the current visit. Reuses the
--    same hierarchical-visibility gate as get_governed_visits.
--
-- Additive only: existing fields/columns are unchanged, no historical
-- visit/order data is modified.

CREATE OR REPLACE FUNCTION public.get_governed_visits(p_token uuid, p_search text DEFAULT NULL::text, p_employee_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$

DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Per-visit customer context: name/phone/address live + creation + ACTUAL
  -- order metrics (is_order_in_statistics) + total visit count. Runs as a
  -- correlated lateral inside the batch query (no per-card network round trip).
  --
  -- NOTE on "created by": public.customers has no created_by column. The only
  -- provenance stored is owner_id (assigned to the creating employee at
  -- creation). We surface that as creator_name to match the existing customer
  -- card's owner semantics, since no separate creator field exists.

  IF v_session.identity_type = 'customer' THEN
    SELECT jsonb_agg(jsonb_build_object(
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
    ) ORDER BY v.created_at DESC) INTO v_result
    FROM public.visits v
    LEFT JOIN customers c ON c.id = v.customer_id
    LEFT JOIN employees e ON e.id = v.employee_id
    WHERE v.customer_id = v_session.customer_id
      AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR v.code ILIKE '%' || p_search || '%')
      AND (p_employee_id IS NULL OR v.employee_id = p_employee_id)
      AND (p_date_from IS NULL OR v.check_in_at >= p_date_from)
      AND (p_date_to IS NULL OR v.check_in_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  IF public.is_upper_management(v_session.employee_id) THEN
    SELECT jsonb_agg(jsonb_build_object(
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
    ) ORDER BY v.created_at DESC) INTO v_result
    FROM public.visits v
    LEFT JOIN customers c ON c.id = v.customer_id
    LEFT JOIN employees e ON e.id = v.employee_id
    WHERE (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR v.code ILIKE '%' || p_search || '%')
      AND (p_employee_id IS NULL OR v.employee_id = p_employee_id)
      AND (p_date_from IS NULL OR v.check_in_at >= p_date_from)
      AND (p_date_to IS NULL OR v.check_in_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  SELECT jsonb_agg(jsonb_build_object(
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
  ) ORDER BY v.created_at DESC) INTO v_result
  FROM public.visits v
  LEFT JOIN customers c ON c.id = v.customer_id
  LEFT JOIN employees e ON e.id = v.employee_id
  WHERE v.employee_id = ANY(v_visible)
    AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR v.code ILIKE '%' || p_search || '%')
    AND (p_employee_id IS NULL OR v.employee_id = p_employee_id)
    AND (p_date_from IS NULL OR v.check_in_at >= p_date_from)
    AND (p_date_to IS NULL OR v.check_in_at <= p_date_to);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;

$function$;

CREATE OR REPLACE FUNCTION public.get_customer_visit_context(p_token uuid, p_visit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$

DECLARE
  v_session app.sessions;
  v_visit public.visits;
  v_visible uuid[];
  v_context jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_visit FROM public.visits WHERE id = p_visit_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'VISIT_NOT_FOUND'); END IF;

  -- Same visibility gate as get_governed_visit / get_governed_visits
  IF v_session.identity_type = 'customer' THEN
    IF v_visit.customer_id != v_session.customer_id THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    SELECT jsonb_build_object(
      'customer', (
        SELECT jsonb_build_object(
          'id', c.id, 'company_name', c.company_name, 'phone', i.phone,
          'registered_address', trim(both '- ' from concat_ws(' - ',
            NULLIF(TRIM(ca.governorate), ''), NULLIF(TRIM(ca.city), ''),
            NULLIF(TRIM(COALESCE(ca.street_address, ca.address_line1, '')), '')
          )),
          'created_at', c.created_at,
          'creator_name', e.full_name
        )
        FROM public.customers c
        LEFT JOIN public.identities i ON i.id = c.identity_id
        LEFT JOIN public.employees e ON e.id = c.owner_id
        LEFT JOIN LATERAL (
          SELECT ca.* FROM public.customer_addresses ca
          WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1
        ) ca ON true
        WHERE c.id = v_visit.customer_id
      ),
      'summary', (
        SELECT jsonb_build_object(
          'order_count', COUNT(*)::bigint,
          'orders_total', COALESCE(SUM(total_amount), 0),
          'last_order_date', MAX(created_at)
        ) FROM public.orders o WHERE o.customer_id = v_visit.customer_id AND public.is_order_in_statistics(o.status)
      ),
      'visit_count', (
        SELECT COUNT(*)::bigint FROM public.visits v2
        WHERE v2.customer_id = v_visit.customer_id AND v2.check_in_at IS NOT NULL
      ),
      'previous_visits', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', v.id, 'code', v.code, 'employee_id', v.employee_id,
          'customer_id', v.customer_id, 'employee_name', e.full_name,
          'status', v.status, 'visit_result', v.visit_result,
          'notes', v.notes, 'check_in_at', v.check_in_at,
          'check_out_at', v.check_out_at,
          'check_in_latitude', v.check_in_latitude, 'check_in_longitude', v.check_in_longitude,
          'check_out_latitude', v.check_out_latitude, 'check_out_longitude', v.check_out_longitude
        ) ORDER BY v.check_in_at DESC)
        FROM public.visits v
        LEFT JOIN public.employees e ON e.id = v.employee_id
        WHERE v.customer_id = v_visit.customer_id
          AND v.id <> p_visit_id
          AND v.check_in_at IS NOT NULL
      )
    ) INTO v_context;
    RETURN COALESCE(v_context, jsonb_build_object('customer', NULL, 'summary', NULL, 'visit_count', 0, 'previous_visits', '[]'::jsonb));
  END IF;

  IF NOT public.is_upper_management(v_session.employee_id) THEN
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
    IF v_visit.employee_id != ALL(v_visible) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  END IF;

  SELECT jsonb_build_object(
    'customer', (
      SELECT jsonb_build_object(
        'id', c.id, 'company_name', c.company_name, 'phone', i.phone,
        'registered_address', trim(both '- ' from concat_ws(' - ',
          NULLIF(TRIM(ca.governorate), ''), NULLIF(TRIM(ca.city), ''),
          NULLIF(TRIM(COALESCE(ca.street_address, ca.address_line1, '')), '')
        )),
        'created_at', c.created_at,
        'creator_name', e.full_name
      )
      FROM public.customers c
      LEFT JOIN public.identities i ON i.id = c.identity_id
      LEFT JOIN public.employees e ON e.id = c.owner_id
      LEFT JOIN LATERAL (
        SELECT ca.* FROM public.customer_addresses ca
        WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1
      ) ca ON true
      WHERE c.id = v_visit.customer_id
    ),
    'summary', (
      SELECT jsonb_build_object(
        'order_count', COUNT(*)::bigint,
        'orders_total', COALESCE(SUM(total_amount), 0),
        'last_order_date', MAX(created_at)
      ) FROM public.orders o WHERE o.customer_id = v_visit.customer_id AND public.is_order_in_statistics(o.status)
    ),
    'visit_count', (
      SELECT COUNT(*)::bigint FROM public.visits v2
      WHERE v2.customer_id = v_visit.customer_id AND v2.check_in_at IS NOT NULL
    ),
    'previous_visits', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', v.id, 'code', v.code, 'employee_id', v.employee_id,
        'customer_id', v.customer_id, 'employee_name', e.full_name,
        'status', v.status, 'visit_result', v.visit_result,
        'notes', v.notes, 'check_in_at', v.check_in_at,
        'check_out_at', v.check_out_at,
        'check_in_latitude', v.check_in_latitude, 'check_in_longitude', v.check_in_longitude,
        'check_out_latitude', v.check_out_latitude, 'check_out_longitude', v.check_out_longitude
      ) ORDER BY v.check_in_at DESC)
      FROM public.visits v
      LEFT JOIN public.employees e ON e.id = v.employee_id
      WHERE v.customer_id = v_visit.customer_id
        AND v.id <> p_visit_id
        AND v.check_in_at IS NOT NULL
        AND (v_visible IS NULL OR v.employee_id = ANY(v_visible) OR employee_id IS NULL)
    )
  ) INTO v_context;

  RETURN COALESCE(v_context, jsonb_build_object('customer', NULL, 'summary', NULL, 'visit_count', 0, 'previous_visits', '[]'::jsonb));
END;

$function$;
