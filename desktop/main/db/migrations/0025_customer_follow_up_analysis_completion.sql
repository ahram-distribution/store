-- ============================================================================
-- 0025 — CUSTOMER FOLLOW-UP ANALYSIS COMPLETION (ORDER TYPE / INTERVALS)
-- ============================================================================
-- Local-only additive migration. Requires 0024 (builds on its RPCs).
--
-- Extends the EXISTING 0024 RPCs (same names, same signatures, exactly one
-- signature per RPC — DROP + CREATE OR REPLACE):
--   1. get_follow_up_customer_screening(uuid, text, uuid, text, int, uuid, timestamptz, timestamptz)
--        + previous_order_date, previous_visit_date
--        + order_types        (lifetime distribution of governed order types)
--        + range_order_types  (selected-period distribution)
--   2. get_follow_up_customer_sales_stats(uuid, uuid, timestamptz, timestamptz)
--        + order_types          (lifetime distribution)
--        + period.order_types   (selected-period distribution)
--   3. get_follow_up_customer_timeline(uuid, uuid, int)
--        order events: + order_type, delta_days (consecutive interval from the
--                      chronological sequence of statistical orders; NULL = first)
--        visit events: + delta_days  (consecutive interval between governed
--                      visit timestamps; NULL = first)
--
-- NO INSERT/UPDATE/DELETE on business data. Analysis only.
-- ============================================================================


-- ============================================================================
-- 1. CUSTOMER SCREENING (list / profile / report rows)
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_follow_up_customer_screening(uuid, text, uuid, text, integer);
DROP FUNCTION IF EXISTS public.get_follow_up_customer_screening(uuid, text, uuid, text, integer, uuid, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION public.get_follow_up_customer_screening(
    p_token          uuid,
    p_search         text DEFAULT NULL,
    p_assignee_id    uuid DEFAULT NULL,
    p_status         text DEFAULT 'all',
    p_limit          int  DEFAULT 500,
    p_customer_id    uuid DEFAULT NULL,
    p_from           timestamptz DEFAULT NULL,
    p_to             timestamptz DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_emp_id uuid;
    v_visible uuid[];
    v_customers_read boolean;
    v_now timestamptz := now();
    v_to timestamptz;
    v_rows jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF v_session.identity_type = 'customer' THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
    IF NOT public.check_capability(p_token, 'followups.read') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_emp_id := v_session.employee_id;
    PERFORM set_config('app.identity_id', v_session.identity_id::text, true);
    v_customers_read := app.has_capability('customers.read');
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
    v_to := COALESCE(p_to, v_now);

    SELECT COALESCE(jsonb_agg(cx), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT (
        jsonb_build_object(
        'id',                  c.id,
        'code',                c.code,
        'company_name',        c.company_name,
        'responsible_name',    c.responsible_name,
        'phone',               i.phone,
        'owner_id',            c.owner_id,
        'owner_name',          eo.full_name,
        'follow_up_assignee_id',   c.follow_up_assignee_id,
        'follow_up_assignee_name', ea.full_name,
        'created_at',          c.created_at,
        'last_order_date',     so.last_order_date,
        'days_since_last_order', so.days_since_last_order,
        'last_contact_date',   lc.last_contact,
        'days_since_contact',  lc.days_since_contact,
        'trend30d_pct',        tr.trend30d_pct,
        'current_30d_total',   tr.r30,
        'previous_30d_total',  tr.p30,
        'has_open_follow_up',  fo.has_open,
        'due_follow_up_at',    fo.due_at,
        'open_follow_up_status', fo.fu_status,
        'no_orders_ever',      (so.last_order_date IS NULL),
        'customer_age_days',   GREATEST(floor(extract(epoch FROM (v_now - c.created_at))/86400.0)::bigint, 0),
        'total_orders',        ord.total_orders,
        'total_sales',         ord.total_sales,
        'first_order_date',    ord.first_order_date,
        'avg_interval_days',   ord.avg_interval_days,
        'total_visits',        vis.total_visits,
        'first_visit_date',    vis.first_visit_date,
        'last_visit_date',     vis.last_visit_date,
        'days_since_last_visit', CASE WHEN vis.last_visit_date IS NOT NULL
                                  THEN GREATEST(floor(extract(epoch FROM (v_now - vis.last_visit_date))/86400.0)::bigint, 0)
                                  ELSE NULL END,
        'total_contacts',      ct.total_contacts,
        'first_contact_date',  ct.first_contact_date,
        'last_contact_result', ct.last_contact_result,
        'total_follow_ups',    fu.total_follow_ups,
        'completed_follow_ups', fu.completed_follow_ups,
        'first_follow_up_date', fu.first_follow_up_date
        )
        ||
        jsonb_build_object(
        'range_order_count',       ordr.range_order_count,
        'range_total_sales',       ordr.range_total_sales,
        'range_first_order_date',  ordr.range_first_order_date,
        'range_last_order_date',   ordr.range_last_order_date,
        'range_avg_interval_days', ordr.range_avg_interval_days,
        'range_visit_count',       visr.range_visit_count,
        'range_last_visit_date',   visr.range_last_visit_date,
        'range_contact_count',     ctr.range_contact_count,
        'range_follow_up_count',   fur.range_follow_up_count,
        'range_completed_follow_ups', fur.range_completed_follow_ups,
        'previous_order_date',   soq.previous_order_date,
        'previous_visit_date',   visq.previous_visit_date,
        'order_types',           ott.dist,
        'range_order_types',     otr.dist,
        'requires_attention',  (
             (lc.days_since_contact IS NULL OR lc.days_since_contact >= 30)
             OR tr.declining
             OR (so.days_since_last_order IS NOT NULL AND so.days_since_last_order >= 45)
             OR fo.has_open
        )
        )
      )::jsonb AS cx
      FROM public.customers c
      JOIN public.identities i ON i.id = c.identity_id
      LEFT JOIN public.employees eo ON eo.id = c.owner_id
      LEFT JOIN public.employees ea ON ea.id = c.follow_up_assignee_id
      LEFT JOIN LATERAL (
        SELECT max(o.created_at) AS last_order_date,
               floor(extract(epoch FROM (v_now - max(o.created_at)))/86400.0)::bigint AS days_since_last_order
          FROM public.orders o
         WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)
      ) so ON true
      LEFT JOIN LATERAL (
        SELECT GREATEST(
                 COALESCE((SELECT max(contact_at) FROM public.customer_follow_up_contacts WHERE customer_id = c.id), '-infinity'::timestamptz),
                 COALESCE((SELECT max(check_in_at) FROM public.visits WHERE customer_id = c.id AND check_in_at IS NOT NULL), '-infinity'::timestamptz)
               ) AS last_contact,
               CASE WHEN EXISTS (
                    SELECT 1 FROM public.customer_follow_up_contacts WHERE customer_id = c.id
                    UNION ALL SELECT 1 FROM public.visits WHERE customer_id = c.id AND check_in_at IS NOT NULL
               ) THEN floor(extract(epoch FROM (v_now - GREATEST(
                    COALESCE((SELECT max(contact_at) FROM public.customer_follow_up_contacts WHERE customer_id = c.id),'-infinity'::timestamptz),
                    COALESCE((SELECT max(check_in_at) FROM public.visits WHERE customer_id = c.id AND check_in_at IS NOT NULL),'-infinity'::timestamptz))))
                    /86400.0)::bigint ELSE NULL END AS days_since_contact
      ) lc ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '30 days'),0) r30,
               COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '60 days' AND o.created_at < v_now - interval '30 days'),0) p30,
               CASE WHEN COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '60 days' AND o.created_at < v_now - interval '30 days'),0) > 0
                    THEN round(
                         100.0 * (COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '30 days'),0)
                                  - COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '60 days' AND o.created_at < v_now - interval '30 days'),0))
                         / COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '60 days' AND o.created_at < v_now - interval '30 days'),0), 1)
                    ELSE NULL END AS trend30d_pct,
               (COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '30 days'),0)
                < COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '60 days' AND o.created_at < v_now - interval '30 days'),0) * 0.6)
                AS declining
          FROM public.orders o
         WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)
      ) tr ON true
      LEFT JOIN LATERAL (
        SELECT EXISTS(SELECT 1 FROM public.customer_follow_ups
                       WHERE customer_id = c.id AND status IN ('open','in_progress')) AS has_open,
               (SELECT due_at FROM public.customer_follow_ups
                 WHERE customer_id = c.id AND status IN ('open','in_progress')
                 ORDER BY due_at NULLS LAST LIMIT 1) AS due_at,
               (SELECT status FROM public.customer_follow_ups
                 WHERE customer_id = c.id AND status IN ('open','in_progress')
                 ORDER BY due_at NULLS LAST LIMIT 1) AS fu_status
      ) fo ON true
      LEFT JOIN LATERAL (
        SELECT count(o.id)::bigint AS total_orders,
               COALESCE(sum(o.total_amount),0) AS total_sales,
               min(o.created_at) AS first_order_date,
               CASE WHEN count(o.id) >= 2 THEN round(
                    extract(epoch FROM (max(o.created_at) - min(o.created_at)))/(count(o.id)-1)/86400.0)::bigint
                    ELSE NULL END AS avg_interval_days
          FROM public.orders o
         WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)
      ) ord ON true
      LEFT JOIN LATERAL (
        SELECT count(o.id)::bigint AS range_order_count,
               COALESCE(sum(o.total_amount),0) AS range_total_sales,
               min(o.created_at) AS range_first_order_date,
               max(o.created_at) AS range_last_order_date,
               CASE WHEN count(o.id) >= 2 THEN round(
                    extract(epoch FROM (max(o.created_at) - min(o.created_at)))/(count(o.id)-1)/86400.0)::bigint
                    ELSE NULL END AS range_avg_interval_days
          FROM public.orders o
         WHERE o.customer_id = c.id
           AND public.is_order_in_statistics(o.status)
           AND o.created_at >= COALESCE(p_from, c.created_at)
           AND o.created_at <= v_to
      ) ordr ON true
      LEFT JOIN LATERAL (
        SELECT count(v.id)::bigint AS total_visits,
               min(v.check_in_at) AS first_visit_date,
               max(v.check_in_at) AS last_visit_date
          FROM public.visits v
         WHERE v.customer_id = c.id AND v.check_in_at IS NOT NULL
      ) vis ON true
      LEFT JOIN LATERAL (
        SELECT count(v.id)::bigint AS range_visit_count,
               max(v.check_in_at) AS range_last_visit_date
          FROM public.visits v
         WHERE v.customer_id = c.id AND v.check_in_at IS NOT NULL
           AND v.check_in_at >= COALESCE(p_from, c.created_at)
           AND v.check_in_at <= v_to
      ) visr ON true
      LEFT JOIN LATERAL (
        SELECT count(ct.id)::bigint AS total_contacts,
               min(ct.contact_at) AS first_contact_date,
               (SELECT ct2.result FROM public.customer_follow_up_contacts ct2
                 WHERE ct2.customer_id = c.id ORDER BY ct2.contact_at DESC NULLS LAST LIMIT 1) AS last_contact_result
          FROM public.customer_follow_up_contacts ct
         WHERE ct.customer_id = c.id
      ) ct ON true
      LEFT JOIN LATERAL (
        SELECT count(ct.id)::bigint AS range_contact_count
          FROM public.customer_follow_up_contacts ct
         WHERE ct.customer_id = c.id
           AND ct.contact_at >= COALESCE(p_from, c.created_at)
           AND ct.contact_at <= v_to
      ) ctr ON true
      LEFT JOIN LATERAL (
        SELECT count(f.id)::bigint AS total_follow_ups,
               count(f.id) FILTER (WHERE f.status = 'completed')::bigint AS completed_follow_ups,
               min(f.created_at) AS first_follow_up_date
          FROM public.customer_follow_ups f
         WHERE f.customer_id = c.id
      ) fu ON true
      LEFT JOIN LATERAL (
        SELECT count(f.id)::bigint AS range_follow_up_count,
               count(f.id) FILTER (WHERE f.status = 'completed')::bigint AS range_completed_follow_ups
          FROM public.customer_follow_ups f
         WHERE f.customer_id = c.id
           AND f.created_at >= COALESCE(p_from, c.created_at)
           AND f.created_at <= v_to
      ) fur ON true
      LEFT JOIN LATERAL (
        SELECT o.created_at AS previous_order_date
          FROM public.orders o
         WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)
         ORDER BY o.created_at DESC NULLS LAST
         LIMIT 1 OFFSET 1
      ) soq ON true
      LEFT JOIN LATERAL (
        SELECT v.check_in_at AS previous_visit_date
          FROM public.visits v
         WHERE v.customer_id = c.id AND v.check_in_at IS NOT NULL
         ORDER BY v.check_in_at DESC NULLS LAST
         LIMIT 1 OFFSET 1
      ) visq ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('order_type', ot.order_type, 'count', ot.cnt)
                                 ORDER BY ot.cnt DESC, ot.order_type), '[]'::jsonb) AS dist
          FROM (
            SELECT o.order_type AS order_type, count(*)::bigint AS cnt
              FROM public.orders o
             WHERE o.customer_id = c.id
               AND public.is_order_in_statistics(o.status)
               AND o.order_type IS NOT NULL
             GROUP BY o.order_type
          ) ot
      ) ott ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('order_type', ot.order_type, 'count', ot.cnt)
                                 ORDER BY ot.cnt DESC, ot.order_type), '[]'::jsonb) AS dist
          FROM (
            SELECT o.order_type AS order_type, count(*)::bigint AS cnt
              FROM public.orders o
             WHERE o.customer_id = c.id
               AND public.is_order_in_statistics(o.status)
               AND o.order_type IS NOT NULL
               AND o.created_at >= COALESCE(p_from, c.created_at)
               AND o.created_at <= v_to
             GROUP BY o.order_type
          ) ot
      ) otr ON true
      WHERE (v_customers_read OR c.owner_id = ANY(v_visible))
        AND c.is_active = true
        AND (p_customer_id IS NULL OR c.id = p_customer_id)
        AND (p_search IS NULL OR
             c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%')
        AND (p_assignee_id IS NULL OR c.follow_up_assignee_id = p_assignee_id)
        AND (p_status = 'all'
             OR (p_status = 'due_today'   AND fo.due_at >= date_trunc('day', v_now) AND fo.due_at < date_trunc('day', v_now) + interval '1 day')
             OR (p_status = 'overdue'     AND fo.has_open AND fo.due_at < v_now)
             OR (p_status = 'upcoming'    AND (fo.due_at >= date_trunc('day', v_now) + interval '1 day'))
             OR (p_status = 'no_follow_up' AND NOT fo.has_open)
             OR (p_status = 'declining'    AND tr.declining)
             OR (p_status = 'stopped'      AND so.last_order_date IS NOT NULL AND so.days_since_last_order >= 45)
             OR (p_status = 'no_contact_30d' AND (lc.days_since_contact IS NULL OR lc.days_since_contact >= 30))
             OR (p_status = 'new_30d'      AND c.created_at >= v_now - interval '30 days'))
      ORDER BY c.company_name
      LIMIT GREATEST(1, p_limit)
    ) s;

    RETURN jsonb_build_object(
        'customers',      COALESCE(v_rows, '[]'::jsonb),
        'analysis_from',  p_from,
        'analysis_to',    v_to
    );
END;
$function$;


-- ============================================================================
-- 2. CUSTOMER SALES STATS + BEHAVIOR (period + lifetime)
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_follow_up_customer_sales_stats(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_follow_up_customer_sales_stats(uuid, uuid, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION public.get_follow_up_customer_sales_stats(
    p_token       uuid,
    p_customer_id uuid,
    p_from        timestamptz DEFAULT NULL,
    p_to          timestamptz DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_emp_id uuid;
    v_visible uuid[];
    v_customers_read boolean;
    v_now timestamptz := now();
    v_to timestamptz;
    v_created_at timestamptz;
    v_order_count bigint;
    v_total_sales numeric;
    v_first_order timestamptz;
    v_last_order timestamptz;
    v_days_since_last_order bigint;
    v_avg_interval bigint;
    v_r30 numeric;
    v_p30 numeric;
    v_trend numeric;
    r_order_count bigint;
    r_total_sales numeric;
    r_first_order timestamptz;
    r_last_order timestamptz;
    r_avg_interval bigint;
    r_days_since_last_order bigint;
    v_total_visits bigint;
    v_first_visit timestamptz;
    v_last_visit timestamptz;
    r_total_visits bigint;
    r_last_visit timestamptz;
    v_total_contacts bigint;
    v_first_contact timestamptz;
    v_last_contact timestamptz;
    v_last_contact_result text;
    r_total_contacts bigint;
    v_total_fu bigint;
    v_completed_fu bigint;
    v_first_fu timestamptz;
    r_total_fu bigint;
    r_completed_fu bigint;
    v_order_types jsonb;
    r_order_types jsonb;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF v_session.identity_type = 'customer' THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    v_emp_id := v_session.employee_id;
    PERFORM set_config('app.identity_id', v_session.identity_id::text, true);
    v_customers_read := app.has_capability('customers.read');
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

    IF NOT (v_customers_read
            OR EXISTS (SELECT 1 FROM public.customers c WHERE c.id = p_customer_id AND c.owner_id = ANY(v_visible))) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_to := COALESCE(p_to, v_now);
    SELECT c.created_at INTO v_created_at
      FROM public.customers c
     WHERE c.id = p_customer_id;

    SELECT count(o.id), COALESCE(sum(o.total_amount),0), min(o.created_at), max(o.created_at),
           floor(extract(epoch FROM (v_now - max(o.created_at)))/86400.0)::bigint,
           CASE WHEN count(o.id) >= 2 THEN round(
                extract(epoch FROM (max(o.created_at) - min(o.created_at)))/(count(o.id)-1)/86400.0)::bigint
                ELSE NULL END,
           COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '30 days'),0),
           COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '60 days' AND o.created_at < v_now - interval '30 days'),0)
      INTO v_order_count, v_total_sales, v_first_order, v_last_order,
           v_days_since_last_order, v_avg_interval, v_r30, v_p30
      FROM public.orders o
     WHERE o.customer_id = p_customer_id AND public.is_order_in_statistics(o.status);

    v_trend := CASE WHEN v_p30 > 0 THEN round(100.0 * (v_r30 - v_p30) / v_p30, 1) ELSE NULL END;

    SELECT count(o.id), COALESCE(sum(o.total_amount),0), min(o.created_at), max(o.created_at),
           CASE WHEN count(o.id) >= 2 THEN round(
                extract(epoch FROM (max(o.created_at) - min(o.created_at)))/(count(o.id)-1)/86400.0)::bigint
                ELSE NULL END,
           floor(extract(epoch FROM (v_now - max(o.created_at)))/86400.0)::bigint
      INTO r_order_count, r_total_sales, r_first_order, r_last_order, r_avg_interval, r_days_since_last_order
      FROM public.orders o
     WHERE o.customer_id = p_customer_id
       AND public.is_order_in_statistics(o.status)
       AND o.created_at >= COALESCE(p_from, v_created_at, '-infinity'::timestamptz)
       AND o.created_at <= v_to;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('order_type', t.order_type, 'count', t.cnt)
                             ORDER BY t.cnt DESC, t.order_type), '[]'::jsonb)
      INTO v_order_types
      FROM (
        SELECT o.order_type AS order_type, count(*)::bigint AS cnt
          FROM public.orders o
         WHERE o.customer_id = p_customer_id
           AND public.is_order_in_statistics(o.status)
           AND o.order_type IS NOT NULL
         GROUP BY o.order_type
      ) t;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('order_type', t.order_type, 'count', t.cnt)
                             ORDER BY t.cnt DESC, t.order_type), '[]'::jsonb)
      INTO r_order_types
      FROM (
        SELECT o.order_type AS order_type, count(*)::bigint AS cnt
          FROM public.orders o
         WHERE o.customer_id = p_customer_id
           AND public.is_order_in_statistics(o.status)
           AND o.order_type IS NOT NULL
           AND o.created_at >= COALESCE(p_from, v_created_at, '-infinity'::timestamptz)
           AND o.created_at <= v_to
         GROUP BY o.order_type
      ) t;

    SELECT count(v.id), min(v.check_in_at), max(v.check_in_at)
      INTO v_total_visits, v_first_visit, v_last_visit
      FROM public.visits v
     WHERE v.customer_id = p_customer_id AND v.check_in_at IS NOT NULL;

    SELECT count(v.id), max(v.check_in_at)
      INTO r_total_visits, r_last_visit
      FROM public.visits v
     WHERE v.customer_id = p_customer_id AND v.check_in_at IS NOT NULL
       AND v.check_in_at >= COALESCE(p_from, v_created_at, '-infinity'::timestamptz)
       AND v.check_in_at <= v_to;

    SELECT count(ct.id), min(ct.contact_at), max(ct.contact_at)
      INTO v_total_contacts, v_first_contact, v_last_contact
      FROM public.customer_follow_up_contacts ct
     WHERE ct.customer_id = p_customer_id;

    SELECT ct.result INTO v_last_contact_result
      FROM public.customer_follow_up_contacts ct
     WHERE ct.customer_id = p_customer_id
     ORDER BY ct.contact_at DESC NULLS LAST
     LIMIT 1;

    SELECT count(ct.id)
      INTO r_total_contacts
      FROM public.customer_follow_up_contacts ct
     WHERE ct.customer_id = p_customer_id
       AND ct.contact_at >= COALESCE(p_from, v_created_at, '-infinity'::timestamptz)
       AND ct.contact_at <= v_to;

    SELECT count(f.id),
           count(f.id) FILTER (WHERE f.status = 'completed'),
           min(f.created_at)
      INTO v_total_fu, v_completed_fu, v_first_fu
      FROM public.customer_follow_ups f
     WHERE f.customer_id = p_customer_id;

    SELECT count(f.id),
           count(f.id) FILTER (WHERE f.status = 'completed')
      INTO r_total_fu, r_completed_fu
      FROM public.customer_follow_ups f
     WHERE f.customer_id = p_customer_id
       AND f.created_at >= COALESCE(p_from, v_created_at, '-infinity'::timestamptz)
       AND f.created_at <= v_to;

    SELECT jsonb_build_object(
        'order_count',          v_order_count,
        'total_sales',          v_total_sales,
        'avg_order_value',      CASE WHEN v_order_count > 0 THEN round(v_total_sales / v_order_count, 2) ELSE 0 END,
        'first_order_date',     v_first_order,
        'last_order_date',      v_last_order,
        'days_since_last_order', v_days_since_last_order,
        'avg_interval_days',    v_avg_interval,
        'current_30d_total',    v_r30,
        'previous_30d_total',   v_p30,
        'trend30d_pct',         v_trend,
        'order_types',          v_order_types,
        'customer',             jsonb_build_object(
                                    'created_at', v_created_at,
                                    'customer_age_days',
                                    CASE WHEN v_created_at IS NULL THEN NULL
                                         ELSE GREATEST(floor(extract(epoch FROM (v_now - v_created_at))/86400.0)::bigint, 0) END
                                 ),
        'period',               jsonb_build_object(
                                    'from', p_from,
                                    'to', v_to,
                                    'order_count', r_order_count,
                                    'total_sales', r_total_sales,
                                    'first_order_date', r_first_order,
                                    'last_order_date', r_last_order,
                                    'days_since_last_order', r_days_since_last_order,
                                    'avg_interval_days', r_avg_interval,
                                    'order_types', r_order_types
                                 ),
        'visits',               jsonb_build_object(
                                    'total', v_total_visits,
                                    'first_date', v_first_visit,
                                    'last_date', v_last_visit,
                                    'range_count', r_total_visits,
                                    'range_last_date', r_last_visit
                                 ),
        'contacts',             jsonb_build_object(
                                    'total', v_total_contacts,
                                    'first_date', v_first_contact,
                                    'last_date', v_last_contact,
                                    'last_result', v_last_contact_result,
                                    'range_count', r_total_contacts
                                 ),
        'follow_ups',           jsonb_build_object(
                                    'total', v_total_fu,
                                    'completed', v_completed_fu,
                                    'first_date', v_first_fu,
                                    'range_count', r_total_fu,
                                    'range_completed', r_completed_fu
                                 ),
        'top_products',         COALESCE((
            SELECT jsonb_agg(t ORDER BY t.qty DESC)
            FROM (
              SELECT oi.product_name AS name, sum(oi.piece_quantity)::bigint AS qty, sum(oi.total_price) AS total
                FROM orders o JOIN (
                  SELECT oi0.order_id, p.product_name,
                         oi0.piece_quantity, oi0.total_price
                    FROM order_items oi0 JOIN products p ON p.id = oi0.product_id
                ) oi ON oi.order_id = o.id
               WHERE o.customer_id = p_customer_id AND public.is_order_in_statistics(o.status)
               GROUP BY oi.product_name ORDER BY sum(oi.total_price) DESC LIMIT 10
            ) t
        ), '[]'::jsonb),
        'top_companies',        COALESCE((
            SELECT jsonb_agg(t ORDER BY t.total DESC)
            FROM (
              SELECT comp.company_name AS name, sum(oi0.total_price) AS total
                FROM orders o
                JOIN order_items oi0 ON oi0.order_id = o.id
                JOIN products p ON p.id = oi0.product_id
                JOIN companies comp ON comp.id = p.company_id
               WHERE o.customer_id = p_customer_id AND public.is_order_in_statistics(o.status)
               GROUP BY comp.company_name ORDER BY sum(oi0.total_price) DESC LIMIT 10
            ) t
        ), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;


-- ============================================================================
-- 3. CUSTOMER TIMELINE + VISITS + CREATION EVENT
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_follow_up_customer_timeline(uuid, uuid, integer);
CREATE OR REPLACE FUNCTION public.get_follow_up_customer_timeline(
    p_token       uuid,
    p_customer_id uuid,
    p_limit        int DEFAULT 120
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_emp_id uuid;
    v_visible uuid[];
    v_customers_read boolean;
    v_rows jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF v_session.identity_type = 'customer' THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    v_emp_id := v_session.employee_id;
    PERFORM set_config('app.identity_id', v_session.identity_id::text, true);
    v_customers_read := app.has_capability('customers.read');
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

    IF NOT (v_customers_read
            OR EXISTS (SELECT 1 FROM public.customers c WHERE c.id = p_customer_id AND c.owner_id = ANY(v_visible))) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    WITH merged AS (
        SELECT 'followup' AS type, fu.created_at AS ts,
               jsonb_build_object('id', fu.id, 'title', fu.title, 'status', fu.status,
                                  'priority', fu.priority, 'due_at', fu.due_at,
                                  'completed_at', fu.completed_at, 'result', fu.result,
                                  'creator', ec.full_name, 'assignee', ea.full_name) AS payload
          FROM customer_follow_ups fu
          LEFT JOIN employees ec ON ec.id = fu.created_by
          LEFT JOIN employees ea ON ea.id = fu.assignee_id
         WHERE fu.customer_id = p_customer_id
        UNION ALL
        SELECT 'contact' AS type, ct.contact_at AS ts,
               jsonb_build_object('id', ct.id, 'method', ct.contact_type,
                                  'reason', ct.contact_reason, 'result', ct.result,
                                  'notes', ct.notes, 'next_action', ct.next_action,
                                  'next_follow_up_at', ct.next_follow_up_at,
                                  'order_created', ct.order_created,
                                  'employee', e.full_name) AS payload
          FROM customer_follow_up_contacts ct
          LEFT JOIN employees e ON e.id = ct.employee_id
         WHERE ct.customer_id = p_customer_id
        UNION ALL
        SELECT 'order' AS type, ot.ts,
               jsonb_build_object('id', ot.id, 'order_number', ot.order_number,
                                  'status', ot.status, 'order_type', ot.order_type,
                                  'total_amount', ot.total_amount,
                                  'is_statistical', true,
                                  'sender', ot.sender,
                                  'delta_days', ot.delta_days) AS payload
          FROM (
            SELECT o.id, o.order_number, o.status, o.order_type, o.total_amount,
                   COALESCE(o.snapshot_sender_name, '') AS sender,
                   o.created_at AS ts,
                   CASE WHEN lag(o.created_at) OVER (ORDER BY o.created_at) IS NULL THEN NULL
                        ELSE round(extract(epoch FROM (o.created_at - lag(o.created_at) OVER (ORDER BY o.created_at)))/86400.0)::bigint
                        END AS delta_days
              FROM orders o
             WHERE o.customer_id = p_customer_id AND public.is_order_in_statistics(o.status)
          ) ot
        UNION ALL
        SELECT 'visit' AS type, vt.ts,
               jsonb_build_object('id', vt.id, 'code', vt.code, 'status', vt.status,
                                  'visit_result', vt.visit_result, 'check_in_at', vt.check_in_at,
                                  'check_out_at', vt.check_out_at,
                                  'duration_minutes', vt.duration_minutes,
                                  'notes', vt.notes, 'employee', vt.employee,
                                  'delta_days', vt.delta_days) AS payload
          FROM (
            SELECT v.id, v.code, v.status, v.visit_result, v.check_in_at, v.check_out_at,
                   v.notes, ve.full_name AS employee,
                   COALESCE(v.check_in_at, v.created_at) AS ts,
                   CASE WHEN lag(COALESCE(v.check_in_at, v.created_at)) OVER (ORDER BY COALESCE(v.check_in_at, v.created_at)) IS NULL THEN NULL
                        ELSE round(extract(epoch FROM (COALESCE(v.check_in_at, v.created_at) - lag(COALESCE(v.check_in_at, v.created_at)) OVER (ORDER BY COALESCE(v.check_in_at, v.created_at))))/86400.0)::bigint
                        END AS delta_days,
                   CASE WHEN v.check_out_at IS NOT NULL AND v.check_in_at IS NOT NULL AND v.check_out_at > v.check_in_at
                        THEN round(extract(epoch FROM (v.check_out_at - v.check_in_at))/60.0)::bigint ELSE NULL END AS duration_minutes
              FROM visits v
              LEFT JOIN employees ve ON ve.id = v.employee_id
             WHERE v.customer_id = p_customer_id
               AND COALESCE(v.check_in_at, v.created_at) IS NOT NULL
          ) vt
        UNION ALL
        SELECT 'audit' AS type, a.created_at AS ts,
               jsonb_build_object('id', a.id, 'action_type', a.action_type,
                                  'field', a.field_name, 'old_value', a.old_value,
                                  'new_value', a.new_value, 'note', a.note,
                                  'employee', ae.full_name) AS payload
          FROM follow_up_audit_log a
          LEFT JOIN employees ae ON ae.id = a.employee_id
         WHERE a.customer_id = p_customer_id
        UNION ALL
        SELECT 'creation' AS type, c.created_at AS ts,
               jsonb_build_object('id', c.id, 'created_at', c.created_at) AS payload
          FROM public.customers c
         WHERE c.id = p_customer_id
           AND c.created_at IS NOT NULL
    )
    SELECT COALESCE(jsonb_agg(x ORDER BY x.ts DESC, x.type), '[]'::jsonb) INTO v_rows
    FROM (SELECT type, ts, payload
            FROM merged
           ORDER BY ts DESC, type
           LIMIT GREATEST(1, p_limit)) x;

    RETURN jsonb_build_object('timeline', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;