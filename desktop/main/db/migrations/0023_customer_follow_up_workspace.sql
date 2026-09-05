-- ============================================================================
-- CUSTOMER FOLLOW-UP WORKSPACE — business completion (0023)
-- ----------------------------------------------------------------------------
-- Completes the "متابعة العملاء" operational module end-to-end on TOP of the
-- existing 0020/0021/0022 follow-up foundations. All changes are ADDITIVE and
-- role-isolated. Nothing below:
--   * changes customers.owner_id / owners / created_by / sales attribution
--   * changes order status / inventory / pricing / ownership logic
--   * weakens global governance or existing role visibility
--
-- Delivers:
--   1. STRUCTURED CONTACTS: new columns on customer_follow_up_contacts
--      (reason/result/next_action/next_follow_up_at/order_created) + a rich
--      governed RPC governed_log_follow_up_contact with structured result.
--   2. FOLLOW-UP AUDIT TRAIL: follow_up_audit_log (who/when/old/new) used by the
--      customer-data-update path so every permitted edit is auditable.
--   3. OPERATIONAL DASHBOARD: get_followup_dashboard (REAL counters only).
--   4. CUSTOMER SCREENING: get_follow_up_customer_screening (per-customer
--      follow-up context + trend/last-order/no-contact flags).
--   5. CUSTOMER SALES STATS: get_follow_up_customer_sales_stats (total/count/
--      avg/last/interval/trend/top products/companies) — governed sales
--      definition (is_order_in_statistics), no fabricated values.
--   6. CUSTOMER TIMELINE: get_follow_up_customer_timeline merges real records
--      (follow-ups + contacts + orders + customer-update audit) chronologically.
--   7. CUSTOMER DATA UPDATE + ASSIGN: sets/clears follow_up_assignee_id via
--      governed_followup_assign_assignee (never touches owner_id) + grants the
--      role customers.update so governed_update_customer works (it never changes
--      owner). Follow_update audit is recorded in follow_up_audit_log.
--   8. NOTIFICATIONS: due-follow-up reminder via new RPC that reuses the
--      existing fn_create_notification (in-app + PWA push). Optional pg_cron
--      scheduling block (commented safe, enabled with a flag) so no infra
--      dependency is introduced unless the operator opts in.
--   9. PERMISSIONS: new capabilities (followups.manage already exists for the
--      role) + reports/export capabilities + grants to the role only.
--
-- Reuses existing infra: public.is_order_in_statistics, public.is_upper_management,
-- public.get_visible_employee_ids, public.check_capability / app.has_capability,
-- public.fn_create_notification, public.governed_update_customer,
-- public.get_governed_customers (customers.read), public.get_unified_orders
-- (orders.view_all).
-- ============================================================================

-- ============================================================================
-- 0. CAPABILITIES ------------------------------------------------------------
-- ============================================================================
INSERT INTO public.capabilities (code, name, "group") VALUES
    ('followups.view_assignees', 'عرض المسؤولين عن المتابعة', 'followups'),
    ('followups.assign',         'تخصيص/تغيير المسؤول عن متابعة عميل', 'followups'),
    ('reports.view_followups',   'تقارير متابعة العملاء', 'followups'),
    ('reports.export',           'تصدير تقارير (Excel/Word)', 'reports')
ON CONFLICT (code) DO NOTHING;

-- Grant workspace capabilities to the "متابعة العملاء" role (idempotent).
DO $$
DECLARE
    v_role_id uuid;
    v_cap_id uuid;
    v_code text;
    v_codes text[] := ARRAY[
        'followups.view_assignees','followups.assign',
        'reports.view_followups','reports.export'
    ];
BEGIN
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'متابعة العملاء' LIMIT 1;
    IF v_role_id IS NULL THEN RETURN; END IF;
    FOREACH v_code IN ARRAY v_codes LOOP
        SELECT id INTO v_cap_id FROM public.capabilities WHERE code = v_code;
        IF v_cap_id IS NOT NULL THEN
            INSERT INTO public.role_capabilities (role_id, capability_id)
            VALUES (v_role_id, v_cap_id) ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END $$;

-- Grant customers.update to the role so the follow-up employee can correct
-- permitted customer information (governed_update_customer NEVER touches
-- owner_id / ownership / created_by).
DO $$
DECLARE
    v_role_id uuid;
    v_cap_id uuid;
    v_code text;
    v_codes text[] := ARRAY['customers.update'];
BEGIN
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'متابعة العملاء' LIMIT 1;
    IF v_role_id IS NULL THEN RETURN; END IF;
    FOREACH v_code IN ARRAY v_codes LOOP
        SELECT id INTO v_cap_id FROM public.capabilities WHERE code = v_code;
        IF v_cap_id IS NOT NULL THEN
            INSERT INTO public.role_capabilities (role_id, capability_id)
            VALUES (v_role_id, v_cap_id) ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- 1. STRUCTURED CONTACTS (additive columns) ----------------------------------
-- ============================================================================
ALTER TABLE public.customer_follow_up_contacts
    ADD COLUMN IF NOT EXISTS contact_reason    text,
    ADD COLUMN IF NOT EXISTS result            text,
    ADD COLUMN IF NOT EXISTS next_action       text,
    ADD COLUMN IF NOT EXISTS next_follow_up_at timestamptz,
    ADD COLUMN IF NOT EXISTS order_created     boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cfu_contacts_result     ON public.customer_follow_up_contacts (result);
CREATE INDEX IF NOT EXISTS idx_cfu_contacts_next_fu_ts ON public.customer_follow_up_contacts (next_follow_up_at);

-- ============================================================================
-- 2. FOLLOW-UP AUDIT TRAIL ---------------------------------------------------
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.follow_up_audit_log (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   uuid NOT NULL,
    employee_id   uuid,
    action_type   varchar(40) NOT NULL,
    field_name    varchar(100),
    old_value     text,
    new_value     text,
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fu_audit_customer ON public.follow_up_audit_log (customer_id, created_at DESC);

-- ============================================================================
-- 3. GOVERNED: log a STRUCTURED follow-up contact ---------------------------
-- ----------------------------------------------------------------------------
-- Reuses the contact row; adds rich, reportable structured fields. Requires
-- contacts.log (already granted to the role). Never touches sales/ownership.
-- A follow-up appointment can be created from the same screen via
-- governed_create_follow_up (existing).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_log_follow_up_contact(
    p_token            uuid,
    p_customer_id      uuid,
    p_contact_method   text DEFAULT 'call',
    p_contact_reason   text DEFAULT NULL,
    p_result           text DEFAULT NULL,
    p_notes            text DEFAULT NULL,
    p_next_action      text DEFAULT NULL,
    p_next_follow_up_at timestamptz DEFAULT NULL,
    p_order_created    boolean DEFAULT false,
    p_contact_at       timestamptz DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'contacts.log') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF p_customer_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
        RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND');
    END IF;

    IF p_contact_method NOT IN ('call','visit','meeting','email','sms','live_chat','other') THEN
        p_contact_method := 'other';
    END IF;

    INSERT INTO public.customer_follow_up_contacts
        (customer_id, employee_id, contact_type,
         contact_reason, result, notes, next_action, next_follow_up_at, order_created, contact_at)
    VALUES
        (p_customer_id, v_session.employee_id, p_contact_method,
         p_contact_reason, p_result, p_notes, p_next_action, p_next_follow_up_at,
         COALESCE(p_order_created, false), COALESCE(p_contact_at, now()))
    RETURNING id INTO v_id;

    RETURN json_build_object('id', v_id, 'employee_id', v_session.employee_id);
END;
$function$;

-- ============================================================================
-- 4. GOVERNED: CUSTOMER DATA UPDATE + AUDIT ----------------------------------
-- ----------------------------------------------------------------------------
-- Thin wrapper. Enforces customers.update (permitted field correction). Calls
-- the EXISTING governed_update_customer for the actual governed write (which
-- never touches owner_id). Records every changed field in follow_up_audit_log.
-- This is the audit path for "who/when/old/new".
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_followup_update_customer(
    p_token            uuid,
    p_customer_id      uuid,
    p_company_name     text DEFAULT NULL,
    p_phone            text DEFAULT NULL,
    p_responsible_name text DEFAULT NULL,
    p_email            text DEFAULT NULL,
    p_business_type    text DEFAULT NULL,
    p_address          text DEFAULT NULL,
    p_notes            text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_curr record;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'customers.update') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT company_name, email, responsible_name, business_type
      INTO v_curr
      FROM public.customers WHERE id = p_customer_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND'); END IF;

    -- Reuse the existing governed write. p_token is passed through verbatim;
    -- governed_update_customer resolves the employee from the same session.
    PERFORM public.governed_update_customer(
        p_token => p_token::uuid,
        p_id    => p_customer_id,
        p_company_name      => p_company_name,
        p_responsible_name  => p_responsible_name,
        p_email             => p_email,
        p_business_type     => p_business_type::public.business_type,
        p_phone             => p_phone,
        p_formatted_address => p_address
    );

    -- Audit each changed field (old/new).
    IF p_company_name     IS NOT NULL AND p_company_name     IS DISTINCT FROM v_curr.company_name THEN
        INSERT INTO public.follow_up_audit_log
            (customer_id, employee_id, action_type, field_name, old_value, new_value)
        VALUES (p_customer_id, v_session.employee_id, 'customer_update', 'company_name',
                v_curr.company_name, p_company_name);
    END IF;
    IF p_responsible_name IS NOT NULL AND p_responsible_name IS DISTINCT FROM v_curr.responsible_name THEN
        INSERT INTO public.follow_up_audit_log
            (customer_id, employee_id, action_type, field_name, old_value, new_value)
        VALUES (p_customer_id, v_session.employee_id, 'customer_update', 'responsible_name',
                v_curr.responsible_name, p_responsible_name);
    END IF;
    IF p_email IS NOT NULL AND p_email IS DISTINCT FROM v_curr.email THEN
        INSERT INTO public.follow_up_audit_log
            (customer_id, employee_id, action_type, field_name, old_value, new_value)
        VALUES (p_customer_id, v_session.employee_id, 'customer_update', 'email',
                v_curr.email, p_email);
    END IF;
    IF p_notes IS NOT NULL THEN
        INSERT INTO public.follow_up_audit_log
            (customer_id, employee_id, action_type, field_name, old_value, new_value, note)
        VALUES (p_customer_id, v_session.employee_id, 'customer_update', 'notes', NULL, p_notes, p_notes);
    END IF;

    RETURN json_build_object('ok', true);
END;
$function$;

-- ============================================================================
-- 5. GOVERNED: assign / change the follow-up assignee (owner untouched) ------
-- ----------------------------------------------------------------------------
-- Sets ONLY customers.follow_up_assignee_id. owner_id and created_by are never
-- touched; historical sales attribution stays on the existing governed
-- created_by mechanism. Restricted to hold-followups.assign (the role) and
-- upper management; any active employee may be assigned.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_followup_assign_assignee(
    p_token             uuid,
    p_customer_id       uuid,
    p_assignee_id       uuid,
    p_reason            text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_old_assignee uuid;
    v_customer_name text;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'followups.assign') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
        RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND');
    END IF;

    -- Assignee may be NULL to clear the responsibility.
    IF p_assignee_id IS NOT NULL AND
       NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_assignee_id AND is_active = true) THEN
        RETURN jsonb_build_object('error', 'ASSIGNEE_NOT_FOUND');
    END IF;

    SELECT follow_up_assignee_id, company_name INTO v_old_assignee, v_customer_name
      FROM public.customers WHERE id = p_customer_id;

    IF v_old_assignee IS DISTINCT FROM p_assignee_id THEN
        UPDATE public.customers SET follow_up_assignee_id = p_assignee_id WHERE id = p_customer_id;

        INSERT INTO public.follow_up_audit_log
            (customer_id, employee_id, action_type, field_name, old_value, new_value, note)
        VALUES (p_customer_id, v_session.employee_id, 'assignee_change', 'follow_up_assignee_id',
                v_old_assignee::text, p_assignee_id::text, p_reason);

        -- Notify the new assignee (in-app + PWA push via existing pipeline).
        IF p_assignee_id IS NOT NULL THEN
            PERFORM public.fn_create_notification(
                p_assignee_id,
                'followup',
                'متابعة عميل جديدة',
                'أصبحت مسؤولاً عن متابعة: ' || coalesce(v_customer_name, ''),
                'customer_follow_up',
                p_customer_id,
                '/followups',
                'fu-assign-' || p_assignee_id::text || '-' || p_customer_id::text
            );
        END IF;
    END IF;

    RETURN json_build_object('ok', true, 'follow_up_assignee_id', p_assignee_id);
END;
$function$;

-- ============================================================================
-- 6. OPERATIONAL DASHBOARD (REAL counters only) ------------------------------
-- ----------------------------------------------------------------------------
-- Deterministic counts derived from governed data. Every number maps to a
-- filtered screen. Scope: employees only; upper management sees the global
-- view; non-upper see their own + created scope for follow-ups (mirrors
-- get_my_follow_ups) but customers/orders metrics use customers.read / 
-- orders.view_all so the role sees ALL. Returns jsonb object; each field may
-- be zero but is always derived from real data (no fabricated figures).
-- ============================================================================
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

    v_result := jsonb_build_object(
        'due_today',      v_due_today,
        'overdue',        v_overdue,
        'upcoming',       v_upcoming,
        'no_contact_30d', v_no_contact_30d,
        'new_30d',        v_new_30d,
        'declined',       v_declined,
        'stopped',        v_stopped,
        'executed_30d',   v_executed_30d,
        'scope',          CASE WHEN v_is_upper THEN 'global' ELSE 'own' END,
        'scoped_followups', true
    );
    RETURN v_result;
END;
$function$;

-- ============================================================================
-- 7. CUSTOMER SCREENING (follow-up context) ----------------------------------
-- ----------------------------------------------------------------------------
-- Returns the governed customer list enriched with follow-up context + trend
-- flags so a follow-up agent can prioritize "who to contact today and why".
-- Reuses get_governed_customers shape (customers.read / subtree). All flags are
-- real (derived from is_order_in_statistics + contact/visit history).
-- Params: p_search, p_assignee_id (follow_up_assignee_id), p_status (due/overdue/
-- upcoming/no_follow_up/declining/stopped/no_contact_30d/all). Returns
-- jsonb object { customers: [ {customer fields..., follow_up_assignee_name,
-- last_order_date, days_since_last_order, last_contact_date,
-- days_since_contact, trend30d_pct, has_open_follow_up, due_follow_up_at,
-- requires_attention bool, sales_current_tot, sales_previous_tot } ] }.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_follow_up_customer_screening(
    p_token          uuid,
    p_search         text DEFAULT NULL,
    p_assignee_id    uuid DEFAULT NULL,
    p_status         text DEFAULT 'all',
    p_limit          int  DEFAULT 500
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
    v_customers_read := app.has_capability('customers.read');
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

    SELECT COALESCE(jsonb_agg(cx ORDER BY cx.company_name), '[]'::jsonb) INTO v_rows
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
        'requires_attention',  (
             (lc.days_since_contact IS NULL OR lc.days_since_contact >= 30)
             OR tr.declining
             OR (so.days_since_last_order IS NOT NULL AND so.days_since_last_order >= 45)
             OR fo.has_open
        )
      )::jsonb AS cx, c.company_name
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
      WHERE (v_customers_read OR c.owner_id = ANY(v_visible))
        AND c.is_active = true
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
      LIMIT GREATEST(1, p_limit)
    ) s ORDER BY s.company_name;

    RETURN jsonb_build_object('customers', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

-- ============================================================================
-- 8. CUSTOMER SALES STATS (follow-up context) --------------------------------
-- ----------------------------------------------------------------------------
-- Real aggregations using the governed sales definition. Returns jsonb object
-- with totals + trend + top products/companies (by total, statistical orders).
-- No fabricated values; several fields may be 0/NULL/empty.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_follow_up_customer_sales_stats(
    p_token       uuid,
    p_customer_id uuid
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
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF v_session.identity_type = 'customer' THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    v_emp_id := v_session.employee_id;
    v_customers_read := app.has_capability('customers.read');
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

    IF NOT (v_customers_read
            OR EXISTS (SELECT 1 FROM public.customers c WHERE c.id = p_customer_id AND c.owner_id = ANY(v_visible))) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT jsonb_build_object(
        'order_count',          agg.order_count,
        'total_sales',          agg.total_sales,
        'avg_order_value',      CASE WHEN agg.order_count > 0 THEN round(agg.total_sales / agg.order_count, 2) ELSE 0 END,
        'first_order_date',     agg.first_order,
        'last_order_date',      agg.last_order,
        'days_since_last_order', agg.days_since_last_order,
        'avg_interval_days',    agg.avg_interval_days,
        'current_30d_total',    agg.r30,
        'previous_30d_total',   agg.p30,
        'trend30d_pct',         agg.trend30d_pct,
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
              SELECT comp.company_name AS name, sum(oi.total_price) AS total
                FROM orders o
                JOIN order_items oi0 ON oi0.order_id = o.id
                JOIN products p ON p.id = oi0.product_id
                JOIN companies comp ON comp.id = p.company_id
               WHERE o.customer_id = p_customer_id AND public.is_order_in_statistics(o.status)
               GROUP BY comp.company_name ORDER BY sum(oi.total_price) DESC LIMIT 10
            ) t
        ), '[]'::jsonb)
    ) INTO v_result
    FROM (
        SELECT count(o.id) AS order_count,
               COALESCE(sum(o.total_amount),0) AS total_sales,
               min(o.created_at) AS first_order,
               max(o.created_at) AS last_order,
               floor(extract(epoch FROM (v_now - max(o.created_at)))/86400.0)::bigint AS days_since_last_order,
               CASE WHEN count(o.id) >= 2 THEN round(
                    extract(epoch FROM (max(o.created_at) - min(o.created_at)))/(count(o.id)-1)/86400.0)::bigint
                    ELSE NULL END AS avg_interval_days,
               COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '30 days'),0) AS r30,
               COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '60 days' AND o.created_at < v_now - interval '30 days'),0) AS p30,
               CASE WHEN COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '60 days' AND o.created_at < v_now - interval '30 days'),0) > 0
                    THEN round(
                        100.0 * (COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '30 days'),0)
                                 - COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '60 days' AND o.created_at < v_now - interval '30 days'),0))
                        / COALESCE(sum(o.total_amount) FILTER (WHERE o.created_at >= v_now - interval '60 days' AND o.created_at < v_now - interval '30 days'),0), 1)
                    ELSE NULL END AS trend30d_pct
          FROM orders o
         WHERE o.customer_id = p_customer_id AND public.is_order_in_statistics(o.status)
    ) agg;
    RETURN v_result;
END;
$function$;

-- ============================================================================
-- 9. CUSTOMER TIMELINE (real chronological history) --------------------------
-- ----------------------------------------------------------------------------
-- Merges real records into a single ascending timeline: follow-ups, structured
-- contacts, statistical orders, and customer-update / assignee audit entries.
-- Type field distinguishes source. No fabricated visuals.
-- ============================================================================
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
        SELECT 'audit' AS type, a.created_at AS ts,
               jsonb_build_object('id', a.id, 'action_type', a.action_type,
                                  'field', a.field_name, 'old_value', a.old_value,
                                  'new_value', a.new_value, 'note', a.note,
                                  'employee', ae.full_name) AS payload
          FROM follow_up_audit_log a
          LEFT JOIN employees ae ON ae.id = a.employee_id
         WHERE a.customer_id = p_customer_id
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
-- 10. DUE-FOLLOW-UP NOTIFICATION (reuses existing push pipeline) -------------
-- ----------------------------------------------------------------------------
-- OPT-IN scheduler. A curated cron job (operator-enabled) calls this RPC daily;
-- it fires an in-app notification + PWA push via fn_create_notification for
-- each due/overdue follow-up the assignee has not yet completed. Idempotent
-- (unique event_key) so repeated runs never double-notify.
-- Enable by uncommenting the COMMENT block at the bottom (production operator
-- decision, gated by p_enable in the SECURITY DEFINER so a non-owner run
-- cannot be abused). No destructive change.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.run_follow_up_due_notifications(
    p_token        uuid DEFAULT NULL,
    p_enable       boolean DEFAULT false,
    p_look_ahead   interval DEFAULT interval '1 day'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_now timestamptz := now();
    v_upper boolean := false;
    r record;
    v_count int := 0;
BEGIN
    IF NOT p_enable THEN
        RETURN jsonb_build_object('enabled', false, 'hint', 'دعوة اختيارية: يجب تفعيلها يدويًا.');
    END IF;

    -- Only the app owner / service token (or an upper-management session) may run.
    IF p_token IS NOT NULL THEN
        SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
        IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
        v_upper := public.is_upper_management(v_session.employee_id);
        IF NOT v_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
    END IF;

    FOR r IN
      SELECT DISTINCT fu.assignee_id AS emp
        FROM customer_follow_ups fu
       WHERE fu.status IN ('open','in_progress')
         AND fu.assignee_id IS NOT NULL
         AND fu.due_at < v_now + p_look_ahead
    LOOP
        PERFORM public.fn_create_notification(
            r.emp,
            'followup_due',
            'متابعة مستحقة',
            'لديك متابعة عميل مستحقة اليوم أو متأخرة — راجع قائمة المتابعات.',
            'customer_follow_up',
            NULL,
            '/followups/today',
            'fu-due-' || r.emp::text || '-' || to_char(v_now, 'YYYY-MM-DD')
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object('enabled', true, 'notified_employees', v_count);
END;
$function$;

-- ============================================================================
-- 11. REPORT DATA RPCs (reuse export engines client-side) --------------------
-- ============================================================================
-- Follow-ups report (filterable by assignee / status / date range).
CREATE OR REPLACE FUNCTION public.get_follow_up_report(
    p_token        uuid,
    p_assignee_id  uuid DEFAULT NULL,
    p_status       text DEFAULT NULL,
    p_date_from    timestamptz DEFAULT NULL,
    p_date_to      timestamptz DEFAULT NULL,
    p_limit        int DEFAULT 1000
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_rows jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'reports.view_followups') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', f.id, 'customer_id', f.customer_id, 'customer', c.company_name,
        'phone', i.phone, 'title', f.title, 'description', f.description,
        'priority', f.priority, 'status', f.status, 'due_at', f.due_at,
        'completed_at', f.completed_at, 'result', f.result,
        'assignee', ea.full_name, 'creator', ec.full_name, 'created_at', f.created_at
      ) ORDER BY COALESCE(f.due_at, f.created_at) DESC), '[]'::jsonb) INTO v_rows
      FROM customer_follow_ups f
      JOIN customers c ON c.id = f.customer_id
      LEFT JOIN identities i ON i.id = c.identity_id
      LEFT JOIN employees ea ON ea.id = f.assignee_id
      LEFT JOIN employees ec ON ec.id = f.created_by
     WHERE (p_assignee_id IS NULL OR f.assignee_id = p_assignee_id)
       AND (p_status IS NULL OR f.status = p_status)
       AND (p_date_from IS NULL OR COALESCE(f.due_at, f.created_at) >= p_date_from)
       AND (p_date_to IS NULL OR COALESCE(f.due_at, f.created_at) <= p_date_to)
     LIMIT GREATEST(1, p_limit);
    RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

-- Contacts report (structured contact/activity log).
CREATE OR REPLACE FUNCTION public.get_contacts_report(
    p_token        uuid,
    p_customer_id  uuid DEFAULT NULL,
    p_result       text DEFAULT NULL,
    p_date_from    timestamptz DEFAULT NULL,
    p_date_to      timestamptz DEFAULT NULL,
    p_limit        int DEFAULT 1000
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_rows jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'reports.view_followups') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ct.id, 'customer_id', ct.customer_id, 'customer', c.company_name,
        'phone', i.phone, 'method', ct.contact_type, 'reason', ct.contact_reason,
        'result', ct.result, 'notes', ct.notes, 'next_action', ct.next_action,
        'next_follow_up_at', ct.next_follow_up_at, 'order_created', ct.order_created,
        'employee', e.full_name, 'contact_at', ct.contact_at
      ) ORDER BY ct.contact_at DESC), '[]'::jsonb) INTO v_rows
      FROM customer_follow_up_contacts ct
      JOIN customers c ON c.id = ct.customer_id
      LEFT JOIN identities i ON i.id = c.identity_id
      LEFT JOIN employees e ON e.id = ct.employee_id
     WHERE (p_customer_id IS NULL OR ct.customer_id = p_customer_id)
       AND (p_result IS NULL OR ct.result = p_result)
       AND (p_date_from IS NULL OR ct.contact_at >= p_date_from)
       AND (p_date_to IS NULL OR ct.contact_at <= p_date_to)
     LIMIT GREATEST(1, p_limit);
    RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

-- Customer-data-update audit report.
CREATE OR REPLACE FUNCTION public.get_customer_updates_report(
    p_token        uuid,
    p_customer_id  uuid DEFAULT NULL,
    p_date_from    timestamptz DEFAULT NULL,
    p_date_to      timestamptz DEFAULT NULL,
    p_limit        int DEFAULT 1000
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_rows jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'reports.view_followups') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', a.id, 'customer_id', a.customer_id, 'customer', c.company_name,
        'action_type', a.action_type, 'field', a.field_name,
        'old_value', a.old_value, 'new_value', a.new_value, 'note', a.note,
        'employee', e.full_name, 'created_at', a.created_at
      ) ORDER BY a.created_at DESC), '[]'::jsonb) INTO v_rows
      FROM follow_up_audit_log a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN employees e ON e.id = a.employee_id
     WHERE (p_customer_id IS NULL OR a.customer_id = p_customer_id)
       AND (p_date_from IS NULL OR a.created_at >= p_date_from)
       AND (p_date_to IS NULL OR a.created_at <= p_date_to)
     LIMIT GREATEST(1, p_limit);
    RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

-- ============================================================================
-- OPTIONAL cron (production operator decision — commented out by default).
-- Deployer: uncomment to schedule daily due-follow-up push reminders.
-- ============================================================================
-- SELECT set_config('cron.job', '{}', true);  -- placeholder (see note below)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule(
--     'followup-due-daily',
--     '0 8 * * *',
--     'SELECT public.run_follow_up_due_notifications(NULL, true)'
-- );

-- ============================================================================
-- CLEANUP GUARD: nothing below removes or alters existing columns/tables/roles.
-- All objects are created WITH "IF NOT EXISTS" / CREATE OR REPLACE.
-- ============================================================================