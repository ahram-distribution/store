-- Fix remaining p_token uuid → text for all functions called from frontend
-- Root cause: PG17 has no implicit text→uuid cast for function argument matching
-- So when fixed functions pass p_token text as argument to get_visible_employee_ids(uuid),
-- PG raises 42883: function get_visible_employee_ids(text) does not exist

-- ============================================================================
-- 1. get_visible_employee_ids — helper called by multiple RPCs
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_visible_employee_ids(uuid);

CREATE OR REPLACE FUNCTION public.get_visible_employee_ids(p_token text)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN '{}'::uuid[]; END IF;
  IF v_session.identity_type = 'customer' THEN RETURN '{}'::uuid[]; END IF;

  IF public.is_upper_management(v_session.employee_id) THEN
    SELECT array_agg(id) INTO v_result FROM employees;
    RETURN COALESCE(v_result, '{}'::uuid[]);
  END IF;

  WITH RECURSIVE subtree AS (
    SELECT id FROM employees WHERE id = v_session.employee_id
    UNION ALL
    SELECT e.id FROM employees e JOIN subtree s ON e.manager_id = s.id
  )
  SELECT array_agg(id) INTO v_result FROM subtree;

  RETURN COALESCE(v_result, '{}'::uuid[]);
END;
$function$;

-- ============================================================================
-- 2. get_unified_orders — قائمة الطلبات
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_unified_orders(uuid, text, varchar, uuid, uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_unified_orders(
  p_token text,
  p_search text DEFAULT NULL::text,
  p_status character varying DEFAULT NULL::character varying,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_created_by uuid DEFAULT NULL::uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_visible uuid[];
  v_is_super boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;

  IF v_session.identity_type = 'customer' THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'total_amount', o.total_amount,
        'revision_number', o.revision_number,
        'customer_id', o.customer_id,
        'customer_name', COALESCE(o.snapshot_customer_name, c.company_name),
        'customer_code', o.snapshot_customer_code,
        'customer_phone', COALESCE(o.snapshot_customer_phone, ci.phone),
        'created_by', o.created_by,
        'created_by_name', COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, ''),
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'notes', o.notes,
        'item_count', (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id),
        'current_delivery_status', (
          SELECT dt.status FROM public.delivery_tracking dt
          WHERE dt.order_id = o.id AND dt.is_active = true LIMIT 1
        ),
        'customer_owner_name', COALESCE(co_emp.full_name, ''),
        'customer_owner_role', COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = c.owner_id LIMIT 1), ''),
        'customer_owner_id', c.owner_id,
        'owner_name', COALESCE(o.snapshot_owner_name, e.full_name),
        'created_by_id', CASE
          WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
          WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
          ELSE NULL
        END,
        'created_by_type', oc_i.identity_type
      ) ORDER BY o.created_at DESC), '[]'::jsonb)
      FROM public.orders o
      JOIN public.customers c ON c.id = o.customer_id
      LEFT JOIN public.identities ci ON ci.id = c.identity_id
      LEFT JOIN public.employees co_emp ON co_emp.id = c.owner_id
      LEFT JOIN public.employees e ON e.id = o.owner_id
      LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
      LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
      LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
      WHERE o.customer_id = v_session.customer_id
        AND (p_status IS NULL OR o.status = p_status)
        AND (p_date_from IS NULL OR o.created_at >= p_date_from)
        AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    );
  END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'total_amount', o.total_amount,
        'revision_number', o.revision_number,
        'customer_id', o.customer_id,
        'customer_name', COALESCE(o.snapshot_customer_name, c.company_name),
        'customer_code', o.snapshot_customer_code,
        'customer_phone', COALESCE(o.snapshot_customer_phone, ci.phone),
        'owner_name', COALESCE(o.snapshot_owner_name, e.full_name),
        'created_by', o.created_by,
        'created_by_name', COALESCE(o.snapshot_sender_name, oc_emp.full_name, oc_cust.company_name, ''),
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'notes', o.notes,
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
        'created_by_type', oc_i.identity_type
      )
      ORDER BY o.created_at DESC
    ), '[]'::jsonb)
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.identities ci ON ci.id = c.identity_id
    LEFT JOIN public.employees co_emp ON co_emp.id = c.owner_id
    LEFT JOIN public.employees e ON e.id = o.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    WHERE (v_is_super OR c.owner_id = ANY(v_visible))
      AND (p_search IS NULL OR
           o.order_number ILIKE '%' || p_search || '%' OR
           c.company_name ILIKE '%' || p_search || '%' OR
           o.snapshot_customer_name ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to)
  );
END;
$function$;

-- ============================================================================
-- 3. get_live_workday_overview — لوحة الحضور المباشر
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_live_workday_overview(uuid);

CREATE OR REPLACE FUNCTION public.get_live_workday_overview(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_interval_seconds int;
    v_subtree_ids uuid[];
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;

    SELECT location_interval_seconds INTO v_interval_seconds FROM public.workday_settings LIMIT 1;
    v_interval_seconds := COALESCE(v_interval_seconds, 300);

    WITH active_sessions AS (
        SELECT wds.id, wds.employee_id, wds.start_time, wds.status,
            wds.last_seen_at, e.full_name AS employee_name
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
            AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
    ),
    session_activity AS (
        SELECT ws.employee_id, ws.last_seen_at AS activity_at,
            'heartbeat'::text AS activity_type
        FROM active_sessions ws
        WHERE ws.last_seen_at IS NOT NULL
    ),
    tracking_activity AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.recorded_at AS activity_at,
            'gps'::text AS activity_type
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    visit_activity AS (
        SELECT v.employee_id, MAX(v.check_in_at) AS activity_at,
            'visit'::text AS activity_type
        FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE
        GROUP BY v.employee_id
    ),
    order_activity AS (
        SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
            MAX(o.created_at) AS activity_at,
            'order'::text AS activity_type
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(o.owner_id)
    ),
    collection_activity AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            MAX(c.created_at) AS activity_at,
            'collection'::text AS activity_type
        FROM public.collections c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    combined_activity AS (
        SELECT employee_id, activity_at, activity_type FROM session_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM tracking_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM visit_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM order_activity
        UNION ALL
        SELECT employee_id, activity_at, activity_type FROM collection_activity
    ),
    last_activity AS (
        SELECT DISTINCT ON (employee_id)
            employee_id, activity_at AS last_activity_at,
            activity_type AS last_activity_type
        FROM combined_activity
        ORDER BY employee_id, activity_at DESC NULLS LAST
    ),
    last_location AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.latitude, tp.longitude,
            tp.recorded_at AS last_location_at, tp.accuracy_meters
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE
          AND tp.latitude IS NOT NULL AND tp.longitude IS NOT NULL
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id
        FROM public.workday_breaks wb WHERE wb.break_end IS NULL
    ),
    today_orders AS (
        SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
            COUNT(*)::int AS order_count,
            COALESCE(SUM(o.total_amount), 0) AS sales_value
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(o.owner_id)
    ),
    today_collections AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            COUNT(*)::int AS collection_count,
            COALESCE(SUM(c.amount), 0) AS collection_amount
        FROM public.collections c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    today_customers AS (
        SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
            COUNT(*)::int AS new_customer_count
        FROM public.customers c WHERE c.created_at::date = CURRENT_DATE
        GROUP BY public.resolve_employee_id(c.owner_id)
    ),
    today_visits AS (
        SELECT v.employee_id, COUNT(*)::int AS visit_count
        FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE GROUP BY v.employee_id
    ),
    employee_summary AS (
        SELECT
            as2.id AS session_id,
            as2.employee_id,
            as2.employee_name,
            as2.start_time,
            EXTRACT(EPOCH FROM (now() - as2.start_time)) / 60 AS duration_minutes,
            CASE WHEN ab.employee_id IS NOT NULL THEN 'on_break'
                 WHEN vl.employee_id IS NOT NULL THEN 'on_visit'
                 ELSE 'working'
            END AS work_status,
            ll.latitude, ll.longitude, ll.last_location_at,
            la.last_activity_at,
            la.last_activity_type,
            CASE
                WHEN la.last_activity_at IS NOT NULL AND ll.last_location_at IS NOT NULL
                    THEN GREATEST(la.last_activity_at, ll.last_location_at)
                WHEN la.last_activity_at IS NOT NULL THEN la.last_activity_at
                WHEN ll.last_location_at IS NOT NULL THEN ll.last_location_at
                ELSE NULL
            END AS last_seen_at,
            CASE
                WHEN la.last_activity_at IS NULL THEN 'no_data'
                WHEN la.last_activity_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                WHEN la.last_activity_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                ELSE 'lost'
            END AS connection_status,
            as2.status AS session_status,
            COALESCE(to2.order_count, 0) AS order_count,
            COALESCE(to2.sales_value, 0) AS sales_value,
            COALESCE(tc.collection_count, 0) AS collection_count,
            COALESCE(tc.collection_amount, 0) AS collection_amount,
            COALESCE(tcu.new_customer_count, 0) AS new_customer_count,
            COALESCE(tv.visit_count, 0) AS visit_count
        FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN LATERAL (
            SELECT v2.id, v2.employee_id FROM public.visits v2
            WHERE v2.employee_id = as2.employee_id AND v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL
            LIMIT 1
        ) vl ON true
        LEFT JOIN last_activity la ON la.employee_id = as2.employee_id
        LEFT JOIN last_location ll ON ll.employee_id = as2.employee_id
        LEFT JOIN today_orders to2 ON to2.employee_id = as2.employee_id
        LEFT JOIN today_collections tc ON tc.employee_id = as2.employee_id
        LEFT JOIN today_customers tcu ON tcu.employee_id = as2.employee_id
        LEFT JOIN today_visits tv ON tv.employee_id = as2.employee_id
    ),
    no_start AS (
        SELECT e.id AS employee_id, e.full_name AS employee_name
        FROM public.employees e
        WHERE (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        AND e.id NOT IN (SELECT employee_id FROM active_sessions)
        AND e.id NOT IN (
            SELECT employee_id FROM public.workday_sessions
            WHERE date = CURRENT_DATE AND status = 'completed'
        )
        AND e.is_active = true
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
    ),
    ended AS (
        SELECT wds.employee_id, e.full_name AS employee_name, wds.end_time,
            EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) / 60 AS duration_minutes,
            wds.visit_count,
            COALESCE(to2.order_count, 0) AS order_count,
            COALESCE(to2.sales_value, 0) AS sales_value,
            COALESCE(tc.collection_count, 0) AS collection_count,
            COALESCE(tc.collection_amount, 0) AS collection_amount,
            COALESCE(tcu.new_customer_count, 0) AS new_customer_count
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        LEFT JOIN today_orders to2 ON to2.employee_id = wds.employee_id
        LEFT JOIN today_collections tc ON tc.employee_id = wds.employee_id
        LEFT JOIN today_customers tcu ON tcu.employee_id = wds.employee_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'completed'
    )
    SELECT jsonb_build_object(
        'active_count', (SELECT COUNT(*) FROM employee_summary),
        'on_visit_count', (SELECT COUNT(*) FROM employee_summary WHERE work_status = 'on_visit'),
        'on_break_count', (SELECT COUNT(*) FROM employee_summary WHERE work_status = 'on_break'),
        'connection_loss_count', (SELECT COUNT(*) FROM employee_summary WHERE connection_status = 'lost'),
        'no_start_count', (SELECT COUNT(*) FROM no_start),
        'ended_count', (SELECT COUNT(*) FROM ended),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', es.employee_id,
            'name', es.employee_name,
            'status', es.work_status,
            'session_status', es.session_status,
            'started_at', es.start_time,
            'duration_minutes', es.duration_minutes::int,
            'latitude', es.latitude,
            'longitude', es.longitude,
            'last_seen_at', es.last_seen_at,
            'connection_status', es.connection_status,
            'last_activity_at', es.last_activity_at,
            'last_activity_type', es.last_activity_type,
            'last_location_at', es.last_location_at,
            'last_seen_label',
                CASE es.connection_status
                    WHEN 'connected' THEN 'متصل الآن'
                    WHEN 'delayed' THEN
                        'آخر نشاط منذ ' || EXTRACT(EPOCH FROM (now() - es.last_seen_at))::int / 60 || ' دقيقة'
                    WHEN 'lost' THEN 'مفقود الاتصال'
                    ELSE 'لا توجد بيانات كافية'
                END,
            'order_count', es.order_count,
            'sales_value', es.sales_value,
            'collection_count', es.collection_count,
            'collection_amount', es.collection_amount,
            'new_customer_count', es.new_customer_count,
            'visit_count', es.visit_count
        ) ORDER BY
            CASE es.work_status
                WHEN 'working' THEN 1
                WHEN 'on_visit' THEN 2
                WHEN 'on_break' THEN 3
                ELSE 4
            END
        ) FROM employee_summary es), '[]'::jsonb),
        'no_start_employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', ns.employee_id,
            'name', ns.employee_name
        )) FROM no_start ns), '[]'::jsonb),
        'ended_employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', ed.employee_id,
            'name', ed.employee_name,
            'ended_at', ed.end_time,
            'duration_minutes', ed.duration_minutes::int,
            'visit_count', ed.visit_count,
            'order_count', ed.order_count,
            'sales_value', ed.sales_value,
            'collection_count', ed.collection_count,
            'collection_amount', ed.collection_amount,
            'new_customer_count', ed.new_customer_count
        ) ORDER BY ed.end_time DESC) FROM ended ed), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

-- ============================================================================
-- Reload PostgREST schema cache
-- ============================================================================
NOTIFY pgrst, 'reload schema';
