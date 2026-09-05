-- ============================================================================
-- 0024 CUSTOMER FOLLOW-UP — COMPLETE CUSTOMER HISTORY & BEHAVIORAL ANALYSIS
-- ----------------------------------------------------------------------------
-- CLOSES THE GAP between "Follow-up management" and "Complete customer
-- follow-up history and behavioral analysis from customer creation until
-- today", WITHOUT changing: role architecture, owner_id/owner_type/created_by
-- semantics, sales attribution, order ownership, inventory, pricing, order
-- status model, visit ownership, or any existing role permission.
--
-- What this migration does (all additive, all backward compatible):
--   1. get_follow_up_customer_screening
--        + p_customer_id (return a single customer row when provided)
--        + p_from / p_to (analysis window; NULL lower bound = customer's own
--          created_at -> "since creation" per customer; NULL upper = now)
--        + per-row LIFETIME aggregates (orders, sales, visits, structured
--          contacts, follow-ups, first dates, avg order interval, age)
--        + per-row RANGE aggregates (same families within [from,to])
--        + analysis_from/analysis_to meta keys at the object root
--      All existing keys and status filters are preserved unchanged.
--   2. get_follow_up_customer_sales_stats
--        + p_from / p_to
--        + customer meta (created_at, customer_age_days)
--        + period object (orders/sales in range)
--        + visits / contacts / follow_ups object (lifetime + range)
--      All existing keys (order_count ... top_companies) preserved.
--   3. get_follow_up_customer_timeline
--        + 'visit' events (from public.visits for the customer)
--        + 'creation' event (customer.created_at - the start of the story)
--      Existing event families (followup/contact/order/audit) preserved.
--   4. get_followup_dashboard
--        + all_customers counter (governed active customer population)
--      All existing counters preserved unchanged.
--
-- NO schema / table / permission / data changes. CREATE OR REPLACE only, so
-- every statement in this file is idempotent and rollback-safe. Intended to be
-- reviewed, committed, and applied with the rest of a follow-up deploy; it was
-- NOT applied during the local gap-closure pass.
-- ============================================================================

-- ============================================================================
-- 1. CUSTOMER SCREENING + HISTORY/BEHAVIOR COLUMNS
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_follow_up_customer_screening(uuid, text, uuid, text, integer);
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
      SELECT jsonb_build_object(
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
        'first_follow_up_date', fu.first_follow_up_date,
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
        'requires_attention',  (
             (lc.days_since_contact IS NULL OR lc.days_since_contact >= 30)
             OR tr.declining
             OR (so.days_since_last_order IS NOT NULL AND so.days_since_last_order >= 45)
             OR fo.has_open
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
                                    'avg_interval_days', r_avg_interval
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
        SELECT 'order' AS type, o.created_at AS ts,
               jsonb_build_object('id', o.id, 'order_number', o.order_number,
                                  'status', o.status, 'total_amount', o.total_amount,
                                  'is_statistical', public.is_order_in_statistics(o.status),
                                  'sender', COALESCE(o.snapshot_sender_name, '')) AS payload
          FROM orders o
         WHERE o.customer_id = p_customer_id AND public.is_order_in_statistics(o.status)
        UNION ALL
        SELECT 'visit' AS type, COALESCE(v.check_in_at, v.created_at) AS ts,
               jsonb_build_object('id', v.id, 'code', v.code, 'status', v.status,
                                  'visit_result', v.visit_result, 'check_in_at', v.check_in_at,
                                  'check_out_at', v.check_out_at,
                                  'duration_minutes', CASE WHEN v.check_out_at IS NOT NULL AND v.check_in_at IS NOT NULL AND v.check_out_at > v.check_in_at
                                                      THEN round(extract(epoch FROM (v.check_out_at - v.check_in_at))/60.0)::bigint ELSE NULL END,
                                  'notes', v.notes, 'employee', ve.full_name) AS payload
          FROM visits v
          LEFT JOIN employees ve ON ve.id = v.employee_id
         WHERE v.customer_id = p_customer_id
           AND COALESCE(v.check_in_at, v.created_at) IS NOT NULL
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

-- ============================================================================
-- 4. DASHBOARD + TOTAL CUSTOMER POPULATION COUNTER
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_followup_dashboard(uuid);
CREATE OR REPLACE FUNCTION public.get_followup_dashboard(
    p_token uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_now timestamptz := now();
    v_day_start timestamptz := date_trunc('day', v_now);
    v_is_upper boolean := false;
    v_emp_id uuid;
    v_customers_read boolean := false;
    v_visible uuid[];
    v_result jsonb;
    v_due_today    bigint;
    v_overdue      bigint;
    v_upcoming     bigint;
    v_no_contact_30d bigint;
    v_new_30d      bigint;
    v_declined     bigint;
    v_stopped      bigint;
    v_executed_30d bigint;
    v_all_customers bigint;
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
    v_is_upper := public.is_upper_management(v_emp_id);
    PERFORM set_config('app.identity_id', v_session.identity_id::text, true);
    v_customers_read := app.has_capability('customers.read');
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

    -- Follow-up scope: upper/global else own+created.
    -- 1) due today (open/in_progress, due today)
    SELECT count(*) INTO v_due_today
      FROM public.customer_follow_ups f
     WHERE f.status IN ('open','in_progress')
       AND f.due_at >= v_day_start AND f.due_at < v_day_start + interval '1 day'
       AND (v_is_upper OR f.assignee_id = v_emp_id OR f.created_by = v_emp_id);
    -- 2) overdue
    SELECT count(*) INTO v_overdue
      FROM public.customer_follow_ups f
     WHERE f.status IN ('open','in_progress') AND f.due_at < v_now
       AND (v_is_upper OR f.assignee_id = v_emp_id OR f.created_by = v_emp_id);
    -- 3) upcoming
    SELECT count(*) INTO v_upcoming
      FROM public.customer_follow_ups f
     WHERE f.status IN ('open','in_progress') AND (f.due_at >= v_day_start + interval '1 day' OR f.due_at IS NULL)
       AND (v_is_upper OR f.assignee_id = v_emp_id OR f.created_by = v_emp_id);

    -- Customer scope: everything gated by customers.read (this role has it -> ALL).
    -- 4) customers with NO contact in the last 30 days (from system visits - a
    --    real contact source - plus follow-up contacts)
    SELECT count(*) INTO v_no_contact_30d
      FROM public.customers c
     WHERE (v_customers_read OR c.owner_id = ANY(v_visible))
       AND c.is_active = true
       AND NOT EXISTS (
             SELECT 1 FROM public.customer_follow_up_contacts ct
             WHERE ct.customer_id = c.id AND ct.contact_at >= v_now - interval '30 days')
       AND NOT EXISTS (
             SELECT 1 FROM public.visits v
             WHERE v.customer_id = c.id AND v.check_in_at >= v_now - interval '30 days');
    -- 5) new customers in last 30 days
    SELECT count(*) INTO v_new_30d
      FROM public.customers c
     WHERE (v_customers_read OR c.owner_id = ANY(v_visible))
       AND c.created_at >= v_now - interval '30 days';
    -- 6) declined: recent 30d sales total > 0 and < 60% of previous 30d
    SELECT count(*) INTO v_declined
      FROM public.customers c
     WHERE (v_customers_read OR c.owner_id = ANY(v_visible))
       AND c.is_active = true
       AND EXISTS (
        SELECT 1
          FROM (SELECT COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '30 days'),0) AS r30,
                       COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '60 days' AND o.created_at < v_now - interval '30 days'),0) AS p30
                FROM public.orders o WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)) s
        WHERE s.p30 > 0 AND s.r30 < s.p30 * 0.6);
    -- 7) stopped: had statistical orders in prior year but none in last 45 days
    SELECT count(*) INTO v_stopped
      FROM public.customers c
     WHERE (v_customers_read OR c.owner_id = ANY(v_visible))
       AND c.is_active = true
       AND EXISTS (SELECT 1 FROM public.orders o
                    WHERE o.customer_id = c.id
                      AND public.is_order_in_statistics(o.status)
                      AND o.created_at >= v_now - interval '12 months')
       AND NOT EXISTS (SELECT 1 FROM public.orders o
                        WHERE o.customer_id = c.id
                          AND public.is_order_in_statistics(o.status)
                          AND o.created_at >= v_now - interval '45 days');
    -- 8) executed (completed follow-ups) in last 30 days
    SELECT count(*) INTO v_executed_30d
      FROM public.customer_follow_ups f
     WHERE f.status = 'completed' AND f.completed_at >= v_now - interval '30 days'
       AND (v_is_upper OR f.assignee_id = v_emp_id OR f.created_by = v_emp_id);
    -- 9) total governed active customers (the follow-up population) --
    --    joins identities so the count matches the screening list exactly.
    SELECT count(*) INTO v_all_customers
      FROM public.customers c
      JOIN public.identities i ON i.id = c.identity_id
     WHERE (v_customers_read OR c.owner_id = ANY(v_visible))
       AND c.is_active = true;

    v_result := jsonb_build_object(
        'due_today',      v_due_today,
        'overdue',        v_overdue,
        'upcoming',       v_upcoming,
        'no_contact_30d', v_no_contact_30d,
        'new_30d',        v_new_30d,
        'declined',       v_declined,
        'stopped',        v_stopped,
        'executed_30d',   v_executed_30d,
        'all_customers',  v_all_customers,
        'scope',          CASE WHEN v_is_upper THEN 'global' ELSE 'own' END,
        'scoped_followups', true
    );
    RETURN v_result;
END;
$function$;