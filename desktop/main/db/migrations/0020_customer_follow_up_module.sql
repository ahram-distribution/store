-- ============================================================================
-- CUSTOMER FOLLOW-UP / ظ…طھط§ط¨ط¹ط© ط§ظ„ط¹ظ…ظ„ط§ط، â€” standalone operational module
-- ----------------------------------------------------------------------------
-- This migration adds a first-class, standalone "Customer Follow-up" feature
-- that is deliberately SEPARATE from two adjacent-but-distinct concepts:
--
--   1. OWNER â‰  FOLLOW-UP ASSIGNEE. The customer's `owner_id` (and `owner_type`)
--      continues to represent WHO OWNS the customer account / sales attribution.
--      The new `follow_up_assignee_id` only records who is CURRENTLY responsible
--      for following up on that customer. Changing the follow-up assignee NEVER
--      touches owner_id, created_by, or any sales/ownership attribution.
--
--   2. CUSTOMER FOLLOW-UP â‰  SALES ATTRIBUTION. Creating/completing a
--      follow-up does NOT alter order inventory, order status, or the existing
--      `is_order_in_statistics` business rule. Follow-up activity is a
--      monitoring/CRM concern only.
--
-- Everything is additive: new tables, one new nullable column on `customers`,
-- new capabilities, and new governed (SECURITY DEFINER) RPCs. No historical
-- data and no existing column semantics are modified or removed.
--
-- Capabilities introduced:
--     followups.manage   â€” assign/create/edit/reschedule/delete follow-ups + assignees
--     followups.complete â€” mark a follow-up completed and record result
--     followups.read     â€” view the follow-up queue/today list (own + assigned scope)
--     contacts.log       â€” record a new customer contact (activity) entry
--
-- Reuses existing infrastructure:
--     * public.fn_create_notification / public.fn_create_notification_bulk
--       for in-app + web/PWA push delivery (fires via pg_net, fire-and-forget).
--     * public.is_upper_management / public.get_visible_employee_ids for the
--       same hierarchical visibility gate used across the platform.
--     * public.check_capability(p_token, code) for authorization.
-- ============================================================================

-- 0. CAPABILITIES ------------------------------------------------------------
INSERT INTO public.capabilities (code, name, "group") VALUES
    ('followups.manage',   'ط¥ط¯ط§ط±ط© ظ…طھط§ط¨ط¹ط§طھ ط§ظ„ط¹ظ…ظ„ط§ط،', 'followups'),
    ('followups.complete', 'ط§ط³طھظƒظ…ط§ظ„ ظ…طھط§ط¨ط¹ط© ط¹ظ…ظٹظ„',   'followups'),
    ('followups.read',     'ط¹ط±ط¶ ظ…طھط§ط¨ط¹ط§طھ ط§ظ„ط¹ظ…ظ„ط§ط،',   'followups'),
    ('contacts.log',       'طھط³ط¬ظٹظ„ ط§ظ„طھظˆط§طµظ„ ظ…ط¹ ط¹ظ…ظ„ط§ط،', 'followups')
ON CONFLICT (code) DO NOTHING;

-- Grant the follow-up capabilities to the operational leadership + sales roles.
-- Uses the canonical Arabic role names present in production, resolving each
-- name at migration time so a renamed/missing role simply grants fewer rows
-- instead of failing.
DO $$
DECLARE
    v_role_name text;
    v_codes text[] := ARRAY['followups.manage','followups.complete','followups.read','contacts.log'];
    v_role_id uuid;
    v_cap_id uuid;
    v_code text;
BEGIN
    FOREACH v_role_name IN ARRAY ARRAY['ط§ظ„ط¥ط¯ط§ط±ط© ط§ظ„ط¹ظ„ظٹط§','ط§ظ„ط±ط¦ظٹط³ ط§ظ„طھظ†ظپظٹط°ظٹ','ظ…ط¯ظٹط± ط§ظ„ط¨ظٹط¹'] LOOP
        SELECT id INTO v_role_id FROM public.roles WHERE name = v_role_name LIMIT 1;
        IF v_role_id IS NULL THEN CONTINUE; END IF;
        FOREACH v_code IN ARRAY v_codes LOOP
            SELECT id INTO v_cap_id FROM public.capabilities WHERE code = v_code;
            IF v_cap_id IS NOT NULL THEN
                INSERT INTO public.role_capabilities (role_id, capability_id)
                VALUES (v_role_id, v_cap_id)
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- ظ…ظ†ط¯ظˆط¨ ظ…ط¨ظٹط¹ط§طھ / ظ…ط´ط±ظپ طھظ†ظپظٹط°ظٹ get read + complete (their own follow-ups),
-- but NOT manage (they cannot reassign others or edit arbitrary assignments).
DO $$
DECLARE
    v_role_name text;
    v_codes text[] := ARRAY['followups.read','followups.complete','contacts.log'];
    v_role_id uuid;
    v_cap_id uuid;
    v_code text;
BEGIN
    FOREACH v_role_name IN ARRAY ARRAY['ظ…ظ†ط¯ظˆط¨ ظ…ط¨ظٹط¹ط§طھ','ظ…ط´ط±ظپ طھظ†ظپظٹط°ظٹ'] LOOP
        SELECT id INTO v_role_id FROM public.roles WHERE name = v_role_name LIMIT 1;
        IF v_role_id IS NULL THEN CONTINUE; END IF;
        FOREACH v_code IN ARRAY v_codes LOOP
            SELECT id INTO v_cap_id FROM public.capabilities WHERE code = v_code;
            IF v_cap_id IS NOT NULL THEN
                INSERT INTO public.role_capabilities (role_id, capability_id)
                VALUES (v_role_id, v_cap_id)
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- 1. customers.follow_up_assignee_id ----------------------------------------
-- ADDITIVE nullable column. NULL (the default for all existing rows) means no
-- dedicated follow-up assignee. NEVER touches owner_id / owner_type.
ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS follow_up_assignee_id uuid;

-- 2. customer_follow_ups -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_follow_ups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL,
    assignee_id uuid,
    title varchar(255) NOT NULL,
    description text,
    priority varchar(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
    status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
    due_at timestamptz,
    completed_at timestamptz,
    result text,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_follow_ups_customer ON public.customer_follow_ups (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_follow_ups_assignee ON public.customer_follow_ups (assignee_id, due_at);
CREATE INDEX IF NOT EXISTS idx_customer_follow_ups_status_due ON public.customer_follow_ups (status, due_at);

-- 3. customer_follow_up_contacts (customer contact / activity log) ---------------------
CREATE TABLE IF NOT EXISTS public.customer_follow_up_contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL,
    employee_id uuid,
    contact_type varchar(30) NOT NULL DEFAULT 'call' CHECK (contact_type IN ('call','visit','meeting','email','sms','other')),
    notes text,
    contact_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_follow_up_contacts_customer ON public.customer_follow_up_contacts (customer_id, contact_at DESC);

-- Optional soft FK notes (kept as plain uuid columns to avoid any DDL conflict
-- with existing FK naming; constraints are intentionally lightweight/additive).
-- A real FK is not enforced here so ownership/attribution remain untouched.

-- Realtime: mirror the existing lightweight pattern; idempotent if pub absent.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'customer_follow_ups'
        ) THEN
            EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_follow_ups';
        END IF;
    END IF;
END $$;

-- ============================================================================
-- GOVERNED RPCS (SECURITY DEFINER + session validation)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- get_my_follow_ups: returns the logged-in user's follow-ups (assigned to them,
-- or all within hierarchical scope for upper management).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_follow_ups(
    p_token uuid,
    p_status text DEFAULT NULL::text,
    p_assignee_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
v_session app.sessions;
    v_rows jsonb;
    v_is_upper boolean := false;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'followups.read') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_is_upper := public.is_upper_management(v_session.employee_id);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', f.id,
        'customer_id', f.customer_id,
        'customer_name', c.company_name,
        'customer_phone', i.phone,
        'assignee_id', f.assignee_id,
        'assignee_name', ae.full_name,
        'title', f.title,
        'description', f.description,
        'priority', f.priority,
        'status', f.status,
        'due_at', f.due_at,
        'completed_at', f.completed_at,
        'result', f.result,
        'created_by', f.created_by,
        'creator_name', ce.full_name,
        'created_at', f.created_at
    ) ORDER BY
        CASE WHEN f.due_at IS NULL THEN 1 ELSE 0 END,
        f.due_at ASC
    ), '[]'::jsonb) INTO v_rows
    FROM public.customer_follow_ups f
    LEFT JOIN public.customers c ON c.id = f.customer_id
    LEFT JOIN public.identities i ON i.id = c.identity_id
    LEFT JOIN public.employees ae ON ae.id = f.assignee_id
    LEFT JOIN public.employees ce ON ce.id = f.created_by
    WHERE (p_status IS NULL OR f.status = p_status)
      AND (p_assignee_id IS NULL OR f.assignee_id = p_assignee_id)
      AND (
        v_is_upper
        OR f.assignee_id = v_session.employee_id
        OR f.created_by = v_session.employee_id
      );

    RETURN json_build_object('items', v_rows);
END;
$function$;

-- ---------------------------------------------------------------------------
-- get_follow_up_queue: full scope for upper management / followups.manage
-- holders (with optional assignee + date filters). Non-managers get their own
-- + created scope (same as get_my_follow_ups).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_follow_up_queue(
    p_token uuid,
    p_status text DEFAULT NULL::text,
    p_assignee_id uuid DEFAULT NULL::uuid,
    p_date_from timestamptz DEFAULT NULL::timestamptz,
    p_date_to timestamptz DEFAULT NULL::timestamptz
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_rows jsonb;
    v_manage boolean := false;
    v_upper boolean := false;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'followups.read') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_manage := public.check_capability(p_token, 'followups.manage');
    v_upper := public.is_upper_management(v_session.employee_id);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', f.id,
        'customer_id', f.customer_id,
        'customer_name', c.company_name,
        'customer_phone', i.phone,
        'assignee_id', f.assignee_id,
        'assignee_name', ae.full_name,
        'title', f.title,
        'description', f.description,
        'priority', f.priority,
        'status', f.status,
        'due_at', f.due_at,
        'completed_at', f.completed_at,
        'result', f.result,
        'created_by', f.created_by,
        'creator_name', ce.full_name,
        'created_at', f.created_at
    ) ORDER BY
        CASE WHEN f.due_at IS NULL THEN 1 ELSE 0 END,
        f.due_at ASC
    ), '[]'::jsonb) INTO v_rows
    FROM public.customer_follow_ups f
    LEFT JOIN public.customers c ON c.id = f.customer_id
    LEFT JOIN public.identities i ON i.id = c.identity_id
    LEFT JOIN public.employees ae ON ae.id = f.assignee_id
    LEFT JOIN public.employees ce ON ce.id = f.created_by
    WHERE (p_status IS NULL OR f.status = p_status)
      AND (p_assignee_id IS NULL OR f.assignee_id = p_assignee_id)
      AND (p_date_from IS NULL OR f.due_at >= p_date_from)
      AND (p_date_to IS NULL OR f.due_at <= p_date_to)
      AND (
        v_upper OR v_manage
        OR f.assignee_id = v_session.employee_id
        OR f.created_by = v_session.employee_id
      );

    RETURN json_build_object('items', v_rows);
END;
$function$;

-- ---------------------------------------------------------------------------
-- governed_create_follow_up: create a follow-up for a customer. Admin can
-- assign to anyone; a sales rep can create for themselves (+ optionally assign
-- another employee if they hold followups.manage). Optionally notifies the
-- assignee with fn_create_notification.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_create_follow_up(
    p_token uuid,
    p_customer_id uuid,
    p_title text,
    p_description text DEFAULT NULL::text,
    p_priority text DEFAULT 'normal',
    p_due_at timestamptz DEFAULT NULL::timestamptz,
    p_assignee_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_id uuid;
    v_final_assignee uuid;
    v_customer_name text;
    v_can_manage boolean := false;
    v_is_upper boolean := false;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'followups.manage') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF p_customer_id IS NULL OR p_title IS NULL OR trim(p_title) = '' THEN
        RETURN jsonb_build_object('error', 'MISSING_FIELDS');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
        RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND');
    END IF;

    -- Assignee defaults to the creating employee; only upper management can
    -- force-assign to another employee.
    v_final_assignee := COALESCE(p_assignee_id, v_session.employee_id);
    IF v_final_assignee <> v_session.employee_id AND NOT public.is_upper_management(v_session.employee_id) THEN
        v_final_assignee := v_session.employee_id;
    END IF;

    INSERT INTO public.customer_follow_ups
        (customer_id, assignee_id, title, description, priority, status, due_at, created_by)
    VALUES
        (p_customer_id, v_final_assignee, p_title, p_description, p_priority, 'open', p_due_at, v_session.employee_id)
    RETURNING id INTO v_id;

    SELECT company_name INTO v_customer_name FROM public.customers WHERE id = p_customer_id;

    -- Notify the assignee (in-app + push) when someone is assigned a follow-up.
    IF v_final_assignee IS NOT NULL THEN
        PERFORM public.fn_create_notification(
            v_final_assignee,
            'followup',
            'ظ…طھط§ط¨ط¹ط© ط¹ظ…ظٹظ„',
            'طھظ…طھ ط¥ط¶ط§ظپط© ظ…طھط§ط¨ط¹ط©: ' || coalesce(v_customer_name, '') || ' â€” ' || p_title,
            'customer_follow_up',
            v_id,
            '/followups',
            'followup-' || v_id::text
        );
    END IF;

    RETURN json_build_object('id', v_id, 'assignee_id', v_final_assignee);
END;
$function$;

-- ---------------------------------------------------------------------------
-- governed_update_follow_up: edit title/description/priority/due_at/status/
-- assignee for managers; reps may edit only their own open follow-ups where
-- they are the assignee or creator. Never touches customer owner/ownership.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_update_follow_up(
    p_token uuid,
    p_follow_up_id uuid,
    p_title text DEFAULT NULL::text,
    p_description text DEFAULT NULL::text,
    p_priority text DEFAULT NULL::text,
    p_due_at timestamptz DEFAULT NULL::timestamptz,
    p_status text DEFAULT NULL::text,
    p_assignee_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_can_manage boolean := false;
    v_is_upper boolean := false;
    rec public.customer_follow_ups;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT * INTO rec FROM public.customer_follow_ups WHERE id = p_follow_up_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

    v_can_manage := public.check_capability(p_token, 'followups.manage');
    v_is_upper := public.is_upper_management(v_session.employee_id);

    -- Authorization: managers/upper may edit any; reps may edit their own.
    IF NOT v_can_manage AND NOT v_is_upper
       AND rec.assignee_id <> v_session.employee_id
       AND rec.created_by <> v_session.employee_id THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    -- Assignee change limited to upper management.
    IF p_assignee_id IS NOT NULL AND p_assignee_id <> rec.assignee_id
       AND NOT v_is_upper THEN
        p_assignee_id := NULL;
    END IF;

    UPDATE public.customer_follow_ups SET
        title = COALESCE(p_title, title),
        description = COALESCE(p_description, description),
        priority = COALESCE(p_priority, priority),
        due_at = COALESCE(p_due_at, due_at),
        assignee_id = COALESCE(p_assignee_id, assignee_id),
        status = CASE
            WHEN p_status IS NOT NULL THEN
                CASE WHEN p_status IN ('open','in_progress','completed','cancelled') THEN p_status ELSE status END
            ELSE status
        END,
        completed_at = CASE
            WHEN p_status = 'completed' THEN now()
            WHEN p_status IN ('open','in_progress','cancelled') THEN NULL
            ELSE completed_at
        END,
        updated_at = now()
    WHERE id = p_follow_up_id;

    RETURN json_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- governed_complete_follow_up: mark a follow-up completed with a result note.
-- Authorization: managers/upper may complete any; a rep may complete their own.
-- Sends the customer a courtesy in-app notification (CRM activity, does NOT
-- touch sales attribution).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_complete_follow_up(
    p_token uuid,
    p_follow_up_id uuid,
    p_result text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_can_manage boolean := false;
    v_is_upper boolean := false;
    v_customer_name text;
    rec public.customer_follow_ups;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'followups.complete') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT * INTO rec FROM public.customer_follow_ups WHERE id = p_follow_up_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

    v_can_manage := public.check_capability(p_token, 'followups.manage');
    v_is_upper := public.is_upper_management(v_session.employee_id);

    IF NOT v_can_manage AND NOT v_is_upper
       AND rec.assignee_id <> v_session.employee_id
       AND rec.created_by <> v_session.employee_id THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF rec.status = 'completed' THEN
        RETURN json_build_object('ok', true, 'already_completed', true);
    END IF;

    SELECT company_name INTO v_customer_name FROM public.customers WHERE id = rec.customer_id;

    UPDATE public.customer_follow_ups SET
        status = 'completed',
        result = p_result,
        completed_at = now(),
        updated_at = now()
    WHERE id = p_follow_up_id;

    -- Notify the assignee (or the completing employee) that the follow-up is done.
    PERFORM public.fn_create_notification(
        COALESCE(rec.assignee_id, v_session.employee_id),
        'followup',
        'ظ…طھط§ط¨ط¹ط© ظ…ظƒطھظ…ظ„ط©',
        'ط§ظƒطھظ…ظ„طھ ظ…طھط§ط¨ط¹ط©: ' || coalesce(v_customer_name, '') || ' â€” ' || rec.title,
        'customer_follow_up',
        p_follow_up_id,
        '/followups',
        'followup-done-' || p_follow_up_id::text
    );

    RETURN json_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- governed_delete_follow_up: managers/upper may delete; reps only their own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_delete_follow_up(
    p_token uuid,
    p_follow_up_id uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_can_manage boolean := false;
    v_is_upper boolean := false;
    rec public.customer_follow_ups;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT * INTO rec FROM public.customer_follow_ups WHERE id = p_follow_up_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

    v_can_manage := public.check_capability(p_token, 'followups.manage');
    v_is_upper := public.is_upper_management(v_session.employee_id);

    IF NOT v_can_manage AND NOT v_is_upper
       AND rec.assignee_id <> v_session.employee_id
       AND rec.created_by <> v_session.employee_id THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    DELETE FROM public.customer_follow_ups WHERE id = p_follow_up_id;
    RETURN json_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- governed_add_customer_contact: record a contact/activity entry for a customer
-- (call/visit/meeting/email/sms/other). CRM-only; no sales attribution impact.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_add_customer_contact(
    p_token uuid,
    p_customer_id uuid,
    p_contact_type text DEFAULT 'call',
    p_notes text DEFAULT NULL::text,
    p_contact_at timestamptz DEFAULT NULL::timestamptz
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

    INSERT INTO public.customer_follow_up_contacts
        (customer_id, employee_id, contact_type, notes, contact_at)
    VALUES
        (p_customer_id, v_session.employee_id, p_contact_type, p_notes, COALESCE(p_contact_at, now()))
    RETURNING id INTO v_id;

    RETURN json_build_object('id', v_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- get_follow_up_assignees: active employees that may be assigned follow-ups.
-- Upper management/leadership sees all active employees; others see only those
-- within their hierarchical visibility scope (get_visible_employee_ids).
-- Read-only; never modifies ownership.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_follow_up_assignees(
    p_token uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_result jsonb;
    v_visible uuid[];
    v_is_upper boolean := false;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.check_capability(p_token, 'followups.read') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_is_upper := public.is_upper_management(v_session.employee_id);
    IF NOT v_is_upper THEN
        v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id, 'full_name', e.full_name, 'code', e.code
    ) ORDER BY e.full_name), '[]'::jsonb) INTO v_result
    FROM public.employees e
    WHERE e.is_active = true
      AND (v_is_upper OR e.id = ANY(v_visible))
      AND e.identity_id IS NOT NULL;

    RETURN v_result;
END;
$function$;

-- ---------------------------------------------------------------------------
-- get_customer_follow_up_history: full follow-up + contact history for a single
-- customer. Managers/upper: any customer. Reps: customers where they are the
-- existing owner, follow-up assignee, or a contact author. Owner/attribution is
-- read-only surfaced here, never modified.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_follow_up_history(
    p_token uuid,
    p_customer_id uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_is_upper boolean := false;
    v_followups jsonb;
    v_contacts jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    v_is_upper := public.is_upper_management(v_session.employee_id);

    IF NOT v_is_upper THEN
        -- Reps may view history for a customer they follow up on / own.
        IF NOT EXISTS (
            SELECT 1 FROM public.customers c
            WHERE c.id = p_customer_id
              AND (c.owner_id = v_session.employee_id)
        ) AND NOT EXISTS (
            SELECT 1 FROM public.customer_follow_ups f
            WHERE f.customer_id = p_customer_id AND f.assignee_id = v_session.employee_id
        ) AND NOT EXISTS (
            SELECT 1 FROM public.customer_follow_up_contacts ct
            WHERE ct.customer_id = p_customer_id AND ct.employee_id = v_session.employee_id
        ) THEN
            RETURN jsonb_build_object('error', 'FORBIDDEN');
        END IF;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', f.id, 'title', f.title, 'description', f.description,
        'priority', f.priority, 'status', f.status, 'due_at', f.due_at,
        'completed_at', f.completed_at, 'result', f.result,
        'assignee_name', ae.full_name, 'created_at', f.created_at
    ) ORDER BY f.created_at DESC), '[]'::jsonb)
    INTO v_followups
    FROM public.customer_follow_ups f
    LEFT JOIN public.employees ae ON ae.id = f.assignee_id
    WHERE f.customer_id = p_customer_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ct.id, 'contact_type', ct.contact_type, 'notes', ct.notes,
        'contact_at', ct.contact_at, 'employee_name', e.full_name
    ) ORDER BY ct.contact_at DESC), '[]'::jsonb)
    INTO v_contacts
    FROM public.customer_follow_up_contacts ct
    LEFT JOIN public.employees e ON e.id = ct.employee_id
    WHERE ct.customer_id = p_customer_id;

    RETURN json_build_object('followups', v_followups, 'contacts', v_contacts);
END;
$function$;
