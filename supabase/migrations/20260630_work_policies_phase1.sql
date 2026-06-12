-- Migration: Work Policies Foundation (Phase 1)
-- Phase 1: employee_work_policies table + work_policy_id column
--          + RPCs + Seed Classification + modified start_workday
--
-- Order:
--   1. employee_work_policies table
--   2. work_policy_id on workday_sessions
--   3. RPCs: get_employee_work_policy, upsert_employee_work_policy,
--            batch_upsert_work_policies, get_my_work_policy
--   4. Modify start_workday to store work_policy_id
--   5. Seed Classification
--   6. Permissions

-- ================================================================
-- 1. employee_work_policies
-- ================================================================

CREATE TABLE IF NOT EXISTS public.employee_work_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    work_location varchar(10) NOT NULL DEFAULT 'field'
        CHECK (work_location IN ('field', 'office')),
    schedule_type varchar(20) NOT NULL DEFAULT 'flexible'
        CHECK (schedule_type IN ('fixed_shift', 'flexible', 'hourly')),
    tracking_required boolean NOT NULL DEFAULT true,
    attendance_enabled boolean NOT NULL DEFAULT true,
    required_daily_hours decimal(4,1) DEFAULT 8,
    shift_start_time time,
    shift_end_time time,
    late_threshold_minutes integer,
    early_departure_threshold_minutes integer,
    updated_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_work_policies ADD CONSTRAINT fk_ewp_employee
    FOREIGN KEY (employee_id) REFERENCES public.employees (id) ON DELETE CASCADE;
ALTER TABLE public.employee_work_policies ADD CONSTRAINT fk_ewp_updated_by
    FOREIGN KEY (updated_by) REFERENCES public.employees (id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ewp_employee_id
    ON public.employee_work_policies (employee_id);

COMMENT ON TABLE public.employee_work_policies IS
  'Per-employee work policy configuration. One row per employee enforced by unique index.';
COMMENT ON COLUMN public.employee_work_policies.work_location IS
  'ميداني = field, مكتبي = office';
COMMENT ON COLUMN public.employee_work_policies.schedule_type IS
  'fixed_shift = دوام ثابت, flexible = دوام مرن, hourly = بالساعة';
COMMENT ON COLUMN public.employee_work_policies.tracking_required IS
  'هل يجب تتبع GPS لهذا الموظف';
COMMENT ON COLUMN public.employee_work_policies.attendance_enabled IS
  'false = معفي من الحضور. لا يظهر في التنبيهات، التقارير، التحليلات، Needs Review، تقييم ساعات العمل. لكن يمكنه بدء/إنهاء يوم العمل.';
COMMENT ON COLUMN public.employee_work_policies.required_daily_hours IS
  'ساعات العمل المطلوبة يومياً (للمرن والساعي)';
COMMENT ON COLUMN public.employee_work_policies.shift_start_time IS
  'وقت بدء الوردية (للثابت فقط). إذا كان null يستخدم official_start_time من الإعدادات العامة.';
COMMENT ON COLUMN public.employee_work_policies.shift_end_time IS
  'وقت نهاية الوردية (للثابت فقط). إذا كان null يستخدم official_end_time من الإعدادات العامة.';
COMMENT ON COLUMN public.employee_work_policies.late_threshold_minutes IS
  'سماحية التأخير (للثابت فقط). إذا كان null يستخدم late_threshold_minutes من الإعدادات العامة.';
COMMENT ON COLUMN public.employee_work_policies.early_departure_threshold_minutes IS
  'سماحية الانصراف المبكر (للثابت فقط). إذا كان null يستخدم early_departure_threshold_minutes من الإعدادات العامة.';

-- ================================================================
-- 2. work_policy_id on workday_sessions
-- ================================================================

ALTER TABLE public.workday_sessions
    ADD COLUMN IF NOT EXISTS work_policy_id uuid;

ALTER TABLE public.workday_sessions ADD CONSTRAINT fk_wds_work_policy
    FOREIGN KEY (work_policy_id) REFERENCES public.employee_work_policies (id);

CREATE INDEX IF NOT EXISTS idx_wds_work_policy_id
    ON public.workday_sessions (work_policy_id);

COMMENT ON COLUMN public.workday_sessions.work_policy_id IS
  'Work policy in effect when session started. Allows historical reports to use the policy at that time, not the current one.';

-- ================================================================
-- 3. RPCs
-- ================================================================

-- 3a. get_employee_work_policy (admin: any identity with employee_id)
CREATE OR REPLACE FUNCTION public.get_employee_work_policy(
    p_token uuid,
    p_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_policy record;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT * INTO v_policy FROM public.employee_work_policies
    WHERE employee_id = p_employee_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('employee_id', p_employee_id, 'has_policy', false);
    END IF;

    RETURN jsonb_build_object(
        'id', v_policy.id,
        'employee_id', v_policy.employee_id,
        'work_location', v_policy.work_location,
        'schedule_type', v_policy.schedule_type,
        'tracking_required', v_policy.tracking_required,
        'required_daily_hours', v_policy.required_daily_hours,
        'shift_start_time', v_policy.shift_start_time,
        'shift_end_time', v_policy.shift_end_time,
        'late_threshold_minutes', v_policy.late_threshold_minutes,
        'early_departure_threshold_minutes', v_policy.early_departure_threshold_minutes,
        'updated_at', v_policy.updated_at,
        'has_policy', true
    );
END;
$function$;

-- 3b. get_my_work_policy (employee: returns caller's own policy)
CREATE OR REPLACE FUNCTION public.get_my_work_policy(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_policy record;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF v_session.identity_type != 'employee' THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_policy FROM public.employee_work_policies
    WHERE employee_id = v_employee_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('employee_id', v_employee_id, 'has_policy', false);
    END IF;

    RETURN jsonb_build_object(
        'id', v_policy.id,
        'work_location', v_policy.work_location,
        'schedule_type', v_policy.schedule_type,
        'tracking_required', v_policy.tracking_required,
        'required_daily_hours', v_policy.required_daily_hours,
        'shift_start_time', v_policy.shift_start_time,
        'shift_end_time', v_policy.shift_end_time,
        'has_policy', true
    );
END;
$function$;

-- 3c. upsert_employee_work_policy (admin: create or update one employee's policy)
CREATE OR REPLACE FUNCTION public.upsert_employee_work_policy(
    p_token uuid,
    p_employee_id uuid,
    p_work_location varchar DEFAULT NULL,
    p_schedule_type varchar DEFAULT NULL,
    p_tracking_required boolean DEFAULT NULL,
    p_attendance_enabled boolean DEFAULT NULL,
    p_required_daily_hours decimal DEFAULT NULL,
    p_shift_start_time time DEFAULT NULL,
    p_shift_end_time time DEFAULT NULL,
    p_late_threshold_minutes integer DEFAULT NULL,
    p_early_departure_threshold_minutes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_admin_id uuid;
    v_policy_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_admin_id := v_session.employee_id;

    INSERT INTO public.employee_work_policies (
        employee_id, work_location, schedule_type, tracking_required,
        attendance_enabled, required_daily_hours, shift_start_time, shift_end_time,
        late_threshold_minutes, early_departure_threshold_minutes,
        updated_by
    ) VALUES (
        p_employee_id,
        COALESCE(p_work_location, 'field'),
        COALESCE(p_schedule_type, 'flexible'),
        COALESCE(p_tracking_required, true),
        COALESCE(p_attendance_enabled, true),
        p_required_daily_hours,
        p_shift_start_time,
        p_shift_end_time,
        p_late_threshold_minutes,
        p_early_departure_threshold_minutes,
        v_admin_id
    )
    ON CONFLICT (employee_id) DO UPDATE SET
        work_location = COALESCE(p_work_location, employee_work_policies.work_location),
        schedule_type = COALESCE(p_schedule_type, employee_work_policies.schedule_type),
        tracking_required = COALESCE(p_tracking_required, employee_work_policies.tracking_required),
        attendance_enabled = COALESCE(p_attendance_enabled, employee_work_policies.attendance_enabled),
        required_daily_hours = COALESCE(p_required_daily_hours, employee_work_policies.required_daily_hours),
        shift_start_time = COALESCE(p_shift_start_time, employee_work_policies.shift_start_time),
        shift_end_time = COALESCE(p_shift_end_time, employee_work_policies.shift_end_time),
        late_threshold_minutes = COALESCE(p_late_threshold_minutes, employee_work_policies.late_threshold_minutes),
        early_departure_threshold_minutes = COALESCE(p_early_departure_threshold_minutes, employee_work_policies.early_departure_threshold_minutes),
        updated_by = v_admin_id,
        updated_at = now()
    RETURNING id INTO v_policy_id;

    RETURN jsonb_build_object('success', true, 'policy_id', v_policy_id);
END;
$function$;

-- 3d. batch_upsert_work_policies (admin: bulk assign/update)
CREATE OR REPLACE FUNCTION public.batch_upsert_work_policies(
    p_token uuid,
    p_policies jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_admin_id uuid;
    v_policy jsonb;
    v_updated int := 0;
    v_errors jsonb := '[]'::jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_admin_id := v_session.employee_id;

    FOR v_policy IN SELECT * FROM jsonb_array_elements(p_policies)
    LOOP
        BEGIN
            INSERT INTO public.employee_work_policies (
                employee_id, work_location, schedule_type, tracking_required,
                attendance_enabled, required_daily_hours, shift_start_time, shift_end_time,
                late_threshold_minutes, early_departure_threshold_minutes,
                updated_by
            ) VALUES (
                (v_policy->>'employee_id')::uuid,
                COALESCE(v_policy->>'work_location', 'field'),
                COALESCE(v_policy->>'schedule_type', 'flexible'),
                COALESCE((v_policy->>'tracking_required')::boolean, true),
                COALESCE((v_policy->>'attendance_enabled')::boolean, true),
                (v_policy->>'required_daily_hours')::decimal,
                (v_policy->>'shift_start_time')::time,
                (v_policy->>'shift_end_time')::time,
                (v_policy->>'late_threshold_minutes')::integer,
                (v_policy->>'early_departure_threshold_minutes')::integer,
                v_admin_id
            )
            ON CONFLICT (employee_id) DO UPDATE SET
                work_location = COALESCE((v_policy->>'work_location'), employee_work_policies.work_location),
                schedule_type = COALESCE((v_policy->>'schedule_type'), employee_work_policies.schedule_type),
                tracking_required = COALESCE((v_policy->>'tracking_required')::boolean, employee_work_policies.tracking_required),
                attendance_enabled = COALESCE((v_policy->>'attendance_enabled')::boolean, employee_work_policies.attendance_enabled),
                required_daily_hours = COALESCE((v_policy->>'required_daily_hours')::decimal, employee_work_policies.required_daily_hours),
                shift_start_time = COALESCE((v_policy->>'shift_start_time')::time, employee_work_policies.shift_start_time),
                shift_end_time = COALESCE((v_policy->>'shift_end_time')::time, employee_work_policies.shift_end_time),
                late_threshold_minutes = COALESCE((v_policy->>'late_threshold_minutes')::integer, employee_work_policies.late_threshold_minutes),
                early_departure_threshold_minutes = COALESCE((v_policy->>'early_departure_threshold_minutes')::integer, employee_work_policies.early_departure_threshold_minutes),
                updated_by = v_admin_id,
                updated_at = now();
            v_updated := v_updated + 1;
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors || jsonb_build_object(
                'employee_id', v_policy->>'employee_id',
                'error', SQLERRM
            );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'updated', v_updated,
        'errors', v_errors
    );
END;
$function$;

-- 3e. list_work_policies (admin: list all policies with employee info)
CREATE OR REPLACE FUNCTION public.list_work_policies(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'policy_id', ewp.id,
            'employee_id', ewp.employee_id,
            'employee_code', e.code,
            'employee_name', e.full_name,
            'is_active', e.is_active,
            'work_location', ewp.work_location,
            'schedule_type', ewp.schedule_type,
            'tracking_required', ewp.tracking_required,
            'attendance_enabled', ewp.attendance_enabled,
            'required_daily_hours', ewp.required_daily_hours,
            'shift_start_time', ewp.shift_start_time,
            'shift_end_time', ewp.shift_end_time,
            'late_threshold_minutes', ewp.late_threshold_minutes,
            'early_departure_threshold_minutes', ewp.early_departure_threshold_minutes,
            'updated_at', ewp.updated_at
        ) ORDER BY e.full_name
    ) INTO v_result
    FROM public.employee_work_policies ewp
    JOIN public.employees e ON e.id = ewp.employee_id;

    RETURN jsonb_build_object('policies', COALESCE(v_result, '[]'::jsonb));
END;
$function$;

-- 3f. list_employees_without_policies (admin: for unassigned employee management)
CREATE OR REPLACE FUNCTION public.list_employees_without_policies(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'employee_id', e.id,
            'employee_code', e.code,
            'employee_name', e.full_name,
            'is_active', e.is_active
        ) ORDER BY e.full_name
    ) INTO v_result
    FROM public.employees e
    WHERE NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id);

    RETURN jsonb_build_object('employees', COALESCE(v_result, '[]'::jsonb));
END;
$function$;

-- ================================================================
-- 4. Modify start_workday to store work_policy_id
-- ================================================================

CREATE OR REPLACE FUNCTION public.start_workday(
    p_token uuid,
    p_latitude decimal DEFAULT NULL,
    p_longitude decimal DEFAULT NULL,
    p_device_status jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_existing_id uuid;
    v_policy_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF v_session.identity_type != 'employee' THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
    v_employee_id := v_session.employee_id;

    -- Check no active session today
    SELECT id INTO v_existing_id FROM public.workday_sessions
    WHERE employee_id = v_employee_id AND date = CURRENT_DATE AND status = 'active';
    IF FOUND THEN
        RETURN jsonb_build_object('error', 'ALREADY_ACTIVE', 'session_id', v_existing_id);
    END IF;

    -- Read employee's work policy
    SELECT id INTO v_policy_id FROM public.employee_work_policies
    WHERE employee_id = v_employee_id;

    INSERT INTO public.workday_sessions (
        employee_id, start_latitude, start_longitude, start_device_status,
        work_policy_id
    )
    VALUES (
        v_employee_id, p_latitude, p_longitude, p_device_status,
        v_policy_id
    )
    RETURNING id INTO v_existing_id;

    -- Insert start tracking point
    INSERT INTO public.tracking_points (session_id, employee_id, latitude, longitude, recorded_at, point_type)
    VALUES (v_existing_id, v_employee_id, p_latitude, p_longitude, now(), 'start');

    RETURN jsonb_build_object('session_id', v_existing_id, 'started_at', now());
END;
$function$;

-- ================================================================
-- 5. Seed Classification
-- ================================================================

-- classify_employee_work_policies: classifies all employees based on
-- their activity in the last 30 days and inserts work policies.
CREATE OR REPLACE FUNCTION public.classify_employee_work_policies()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_stats jsonb;
    v_field_count int := 0;
    v_office_count int := 0;
    v_unclassified_count int := 0;
    v_errors jsonb := '[]'::jsonb;
BEGIN
    -- Classify: field employees (visits or orders in last 30 days)
    WITH field_employees AS (
        SELECT DISTINCT e.id AS employee_id
        FROM public.employees e
        WHERE e.is_active = true
        AND (
            EXISTS (SELECT 1 FROM public.visits v WHERE v.employee_id = e.id AND v.check_in_at >= now() - interval '30 days')
            OR
            EXISTS (SELECT 1 FROM public.orders o WHERE o.owner_type = 'employee' AND o.owner_id = e.id AND o.created_at >= now() - interval '30 days')
        )
    ),
    -- Office: active employees with no recent activity, but have some history
    office_employees AS (
        SELECT DISTINCT e.id AS employee_id
        FROM public.employees e
        WHERE e.is_active = true
        AND e.id NOT IN (SELECT employee_id FROM field_employees)
        AND (
            EXISTS (SELECT 1 FROM public.visits v WHERE v.employee_id = e.id)
            OR
            EXISTS (SELECT 1 FROM public.orders o WHERE o.owner_type = 'employee' AND o.owner_id = e.id)
        )
    ),
    -- Unclassified: active employees with no visits or orders at all
    unclassified_employees AS (
        SELECT e.id AS employee_id
        FROM public.employees e
        WHERE e.is_active = true
        AND e.id NOT IN (SELECT employee_id FROM field_employees)
        AND e.id NOT IN (SELECT employee_id FROM office_employees)
    )
    -- Insert field employees
    INSERT INTO public.employee_work_policies (
        employee_id, work_location, schedule_type, tracking_required,
        required_daily_hours, updated_by
    )
    SELECT employee_id, 'field', 'flexible', true, 8, NULL
    FROM field_employees
    ON CONFLICT (employee_id) DO UPDATE SET
        work_location = 'field',
        schedule_type = 'flexible',
        tracking_required = true,
        required_daily_hours = 8,
        updated_at = now();
    GET DIAGNOSTICS v_field_count = ROW_COUNT;

    -- Insert office employees
    INSERT INTO public.employee_work_policies (
        employee_id, work_location, schedule_type, tracking_required,
        required_daily_hours, updated_by
    )
    SELECT employee_id, 'office', 'fixed_shift', false, 8, NULL
    FROM office_employees
    ON CONFLICT (employee_id) DO UPDATE SET
        work_location = 'office',
        schedule_type = 'fixed_shift',
        tracking_required = false,
        required_daily_hours = 8,
        updated_at = now();
    GET DIAGNOSTICS v_office_count = ROW_COUNT;

    -- Needs Review: count unclassified employees but do NOT insert a policy.
    -- These employees appear in list_employees_without_policies() for admin review.
    SELECT COUNT(*) INTO v_unclassified_count FROM unclassified_employees;

    RETURN jsonb_build_object(
        'success', true,
        'field_employees', v_field_count,
        'office_employees', v_office_count,
        'needs_review', v_unclassified_count
    );
END;
$function$;

-- Run seed classification immediately
DO $$
DECLARE
    v_result jsonb;
    v_field int;
    v_office int;
    v_unclass int;
BEGIN
    v_result := public.classify_employee_work_policies();
    v_field := (v_result->>'field_employees')::int;
    v_office := (v_result->>'office_employees')::int;
    v_unclass := (v_result->>'needs_review')::int;
    RAISE NOTICE 'Seed Classification complete: % field, % office, % needs_review',
        v_field, v_office, v_unclass;
END;
$$;

-- ================================================================
-- 6. Override existing RPCs with exempt employee filtering
--    attendance_enabled=false employees are excluded from:
--      - Alerts
--      - Live Overview
--      - Workday Report
--      - Attendance Analysis
--      - Team Map
--    They can still use start_workday/end_workday and their data
--    can still be viewed per-employee (history, timeline, map).
-- ================================================================

-- 6a. get_alerts — exclude exempt employees from all alert types
CREATE OR REPLACE FUNCTION public.get_alerts(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_settings record;
    v_interval_seconds int;
    v_start_time time;
    v_end_time time;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT official_start_time, official_end_time, location_interval_seconds
    INTO v_start_time, v_end_time, v_interval_seconds
    FROM public.workday_settings LIMIT 1;
    v_interval_seconds := COALESCE(v_interval_seconds, 300);

    WITH
    not_started AS (
        SELECT 'not_started' AS alert_type, e.id AS employee_id, e.name AS employee_name,
            'لم يبدأ يوم العمل بعد موعد الدوام' AS title,
            'الساعة الآن ' || to_char(now()::time, 'HH:MI') || ' — وقت البدء الرسمي ' || to_char(v_start_time, 'HH:MI') AS description,
            now() AS detected_at
        FROM public.employees e
        WHERE e.active = true
        AND NOT EXISTS (SELECT 1 FROM public.workday_sessions wds WHERE wds.employee_id = e.id AND wds.date = CURRENT_DATE)
        AND CURRENT_TIME > v_start_time + interval '30 minutes'
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
    ),
    open_yesterday AS (
        SELECT 'open_yesterday' AS alert_type, wds.employee_id AS employee_id, e.name AS employee_name,
            'يوم عمل مفتوح من اليوم السابق' AS title,
            'بدأ يوم ' || wds.date || ' الساعة ' || to_char(wds.start_time, 'HH:MI') || ' — لم ينته بعد' AS description,
            now() AS detected_at
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date < CURRENT_DATE AND wds.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = wds.employee_id AND ewp.attendance_enabled = false)
    ),
    long_break AS (
        SELECT 'long_break' AS alert_type, wb.employee_id, e.name AS employee_name,
            'استراحة طويلة بشكل غير طبيعي' AS title,
            'في استراحة منذ ' || round(EXTRACT(EPOCH FROM (now() - wb.break_start)) / 60) || ' دقيقة' AS description,
            wb.break_start AS detected_at
        FROM public.workday_breaks wb
        JOIN public.employees e ON e.id = wb.employee_id
        WHERE wb.break_end IS NULL
        AND EXTRACT(EPOCH FROM (now() - wb.break_start)) > 7200
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = wb.employee_id AND ewp.attendance_enabled = false)
    ),
    no_updates AS (
        SELECT 'no_updates' AS alert_type, wds.employee_id, e.name AS employee_name,
            'لا توجد تحديثات حديثة' AS title,
            'آخر تحديث منذ ' || round(EXTRACT(EPOCH FROM (now() - tp.recorded_at)) / 60) || ' دقيقة' AS description,
            tp.recorded_at AS detected_at
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        JOIN LATERAL (
            SELECT recorded_at FROM public.tracking_points
            WHERE employee_id = wds.employee_id AND recorded_at >= CURRENT_DATE
            ORDER BY recorded_at DESC LIMIT 1
        ) tp ON true
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
        AND tp.recorded_at < now() - ((v_interval_seconds * 5) || ' seconds')::interval
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = wds.employee_id AND ewp.attendance_enabled = false)
    ),
    no_visits AS (
        SELECT 'no_visits' AS alert_type, wds.employee_id, e.name AS employee_name,
            'لا توجد زيارات اليوم' AS title,
            'بدأ اليوم ' || to_char(wds.start_time, 'HH:MI') || ' — 0 زيارات حتى الآن' AS description,
            now() AS detected_at
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
        AND wds.start_time < CURRENT_DATE + v_start_time + interval '4 hours'
        AND NOT EXISTS (SELECT 1 FROM public.visit_links vl WHERE vl.session_id = wds.id)
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = wds.employee_id AND ewp.attendance_enabled = false)
    )
    SELECT jsonb_build_object(
        'active_alerts', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.detected_at DESC) FROM (
            SELECT * FROM not_started UNION ALL
            SELECT * FROM open_yesterday UNION ALL
            SELECT * FROM long_break UNION ALL
            SELECT * FROM no_updates UNION ALL
            SELECT * FROM no_visits
        ) t), '[]'::jsonb),
        'resolved_alerts', '[]'::jsonb
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

-- 6b. get_live_workday_overview — exclude exempt employees
CREATE OR REPLACE FUNCTION public.get_live_workday_overview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_settings record;
    v_interval_seconds int;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT location_interval_seconds INTO v_interval_seconds FROM public.workday_settings LIMIT 1;
    v_interval_seconds := COALESCE(v_interval_seconds, 300);

    WITH active_sessions AS (
        SELECT wds.id, wds.employee_id, wds.start_time, wds.status,
            e.name AS employee_name
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
    ),
    last_points AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.latitude, tp.longitude, tp.recorded_at
        FROM public.tracking_points tp
        WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id
        FROM public.workday_breaks wb
        WHERE wb.break_end IS NULL
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
            lp.latitude, lp.longitude, lp.recorded_at AS last_seen_at,
            CASE
                WHEN lp.recorded_at IS NULL THEN 'no_data'
                WHEN lp.recorded_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                WHEN lp.recorded_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                ELSE 'lost'
            END AS connection_status,
            as2.status AS session_status
        FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN LATERAL (
            SELECT vl2.session_id, vl2.employee_id FROM public.visit_links vl2
            WHERE vl2.session_id = as2.id AND vl2.checkout_at IS NULL
            LIMIT 1
        ) vl ON true
        LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
    ),
    no_start AS (
        SELECT e.id AS employee_id, e.name AS employee_name
        FROM public.employees e
        WHERE e.id NOT IN (SELECT employee_id FROM active_sessions)
        AND e.id NOT IN (
            SELECT employee_id FROM public.workday_sessions
            WHERE date = CURRENT_DATE AND status = 'completed'
        )
        AND e.active = true
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
    ),
    ended AS (
        SELECT wds.employee_id, e.name AS employee_name, wds.end_time,
            EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) / 60 AS duration_minutes,
            wds.visit_count
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
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
            'last_seen_label',
                CASE es.connection_status
                    WHEN 'connected' THEN 'متصل الآن'
                    WHEN 'delayed' THEN
                        'آخر ظهور منذ ' || EXTRACT(EPOCH FROM (now() - es.last_seen_at))::int / 60 || ' دقيقة'
                    WHEN 'lost' THEN 'انقطاع متابعة'
                    ELSE 'لا توجد بيانات حديثة'
                END
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
            'visit_count', ed.visit_count
        ) ORDER BY ed.end_time DESC) FROM ended ed), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

-- 6c. get_workday_report — exclude exempt employees
CREATE OR REPLACE FUNCTION public.get_workday_report(
    p_token uuid,
    p_from date,
    p_to date,
    p_employee_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT jsonb_build_object(
        'summary', jsonb_build_object(
            'total_sessions', COUNT(*),
            'total_net_hours', COALESCE(SUM(
                EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 -
                COALESCE((SELECT SUM(COALESCE(duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = wds.id)::numeric / 3600, 0)
            ), 0),
            'total_visits', COALESCE(SUM(visit_count), 0),
            'total_distance_km', COALESCE(SUM(total_distance_meters), 0) / 1000,
            'late_days', COUNT(*) FILTER (WHERE attendance_status = 'late'),
            'total_late_minutes', COALESCE(SUM(late_minutes), 0),
            'early_departure_days', COUNT(*) FILTER (WHERE attendance_status = 'early_departure'),
            'total_early_departure_minutes', COALESCE(SUM(early_departure_minutes), 0),
            'ontime_days', COUNT(*) FILTER (WHERE attendance_status = 'ontime'),
            'absent_days', COUNT(*) FILTER (WHERE attendance_status = 'absent')
        ),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', sub.employee_id,
            'name', sub.employee_name,
            'sessions', sub.session_count,
            'net_hours', sub.net_hours,
            'total_visits', sub.total_visits,
            'late_days', sub.late_days,
            'late_minutes', sub.late_minutes,
            'early_departure_days', sub.early_departure_days,
            'early_departure_minutes', sub.early_departure_minutes,
            'ontime_days', sub.ontime_days
        ) ORDER BY sub.session_count DESC)), '[]'::jsonb)
    ) INTO v_result
    FROM (
        SELECT
            wds.employee_id, e.name AS employee_name,
            COUNT(*) AS session_count,
            ROUND(COALESCE(SUM(
                EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) / 3600 -
                COALESCE((SELECT SUM(COALESCE(wb2.duration_seconds, 0)) FROM public.workday_breaks wb2 WHERE wb2.session_id = wds.id)::numeric / 3600, 0)
            ), 0)::numeric, 2) AS net_hours,
            SUM(wds.visit_count) AS total_visits,
            COUNT(*) FILTER (WHERE wds.attendance_status = 'late') AS late_days,
            SUM(wds.late_minutes) AS late_minutes,
            COUNT(*) FILTER (WHERE wds.attendance_status = 'early_departure') AS early_departure_days,
            SUM(wds.early_departure_minutes) AS early_departure_minutes,
            COUNT(*) FILTER (WHERE wds.attendance_status = 'ontime') AS ontime_days
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
        WHERE wds.date >= p_from AND wds.date <= p_to AND wds.status = 'completed'
        AND (p_employee_ids IS NULL OR wds.employee_id = ANY(p_employee_ids))
        GROUP BY wds.employee_id, e.name
    ) sub;

    RETURN v_result;
END;
$function$;

-- 6d. get_attendance_analysis — exclude exempt employees
CREATE OR REPLACE FUNCTION public.get_attendance_analysis(
    p_token uuid,
    p_from date,
    p_to date,
    p_employee_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_is_management boolean;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
    ) INTO v_is_management;

    IF NOT v_is_management THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    SELECT jsonb_build_object(
        'summary', jsonb_build_object(
            'total_work_days', (SELECT COUNT(*) FROM public.workday_sessions
                WHERE date >= p_from AND date <= p_to AND status = 'completed'
                AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'ontime_days', (SELECT COUNT(*) FROM public.workday_sessions
                WHERE date >= p_from AND date <= p_to AND attendance_status = 'ontime'
                AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'late_days', (SELECT COUNT(*) FROM public.workday_sessions
                WHERE date >= p_from AND date <= p_to AND attendance_status = 'late'
                AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'total_late_minutes', (SELECT COALESCE(SUM(late_minutes), 0) FROM public.workday_sessions
                WHERE date >= p_from AND date <= p_to AND attendance_status = 'late'
                AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'early_departure_days', (SELECT COUNT(*) FROM public.workday_sessions
                WHERE date >= p_from AND date <= p_to AND attendance_status = 'early_departure'
                AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'total_early_departure_minutes', (SELECT COALESCE(SUM(early_departure_minutes), 0) FROM public.workday_sessions
                WHERE date >= p_from AND date <= p_to AND attendance_status = 'early_departure'
                AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids))),
            'absent_days', (SELECT COUNT(*) FROM public.workday_sessions
                WHERE date >= p_from AND date <= p_to AND attendance_status = 'absent'
                AND (p_employee_ids IS NULL OR employee_id = ANY(p_employee_ids)))
        ),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', sub.employee_id,
            'name', sub.employee_name,
            'work_days', sub.work_days,
            'ontime_days', sub.ontime_days,
            'late_days', sub.late_days,
            'late_minutes', sub.late_minutes,
            'early_departure_days', sub.early_departure_days,
            'early_departure_minutes', sub.early_departure_minutes,
            'absent_days', sub.absent_days,
            'compliance_rate', CASE WHEN sub.work_days > 0
                THEN ROUND((sub.ontime_days::numeric / sub.work_days) * 100, 1)
                ELSE 0 END
        ) ORDER BY sub.compliance_rate DESC)), '[]'::jsonb)
    ) INTO v_result
    FROM (
        SELECT
            wds.employee_id, e.name AS employee_name,
            COUNT(*) AS work_days,
            COUNT(*) FILTER (WHERE wds.attendance_status = 'ontime') AS ontime_days,
            COUNT(*) FILTER (WHERE wds.attendance_status = 'late') AS late_days,
            COALESCE(SUM(wds.late_minutes) FILTER (WHERE wds.attendance_status = 'late'), 0) AS late_minutes,
            COUNT(*) FILTER (WHERE wds.attendance_status = 'early_departure') AS early_departure_days,
            COALESCE(SUM(wds.early_departure_minutes) FILTER (WHERE wds.attendance_status = 'early_departure'), 0) AS early_departure_minutes,
            COUNT(*) FILTER (WHERE wds.attendance_status IN ('absent', 'unknown')) AS absent_days
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
            AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
        WHERE wds.date >= p_from AND wds.date <= p_to AND wds.status = 'completed'
        AND (p_employee_ids IS NULL OR wds.employee_id = ANY(p_employee_ids))
        GROUP BY wds.employee_id, e.name
    ) sub;

    RETURN v_result;
END;
$function$;

-- 6e. get_team_map — exclude exempt employees
CREATE OR REPLACE FUNCTION public.get_team_map(p_token uuid)
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
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'attendance.view_team_map') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;
    SELECT location_interval_seconds INTO v_interval_seconds FROM public.workday_settings LIMIT 1;
    v_interval_seconds := COALESCE(v_interval_seconds, 300);

    WITH filtered_employees AS (
        SELECT e.id FROM public.employees e WHERE e.is_active = true
        AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
        AND NOT EXISTS (SELECT 1 FROM public.employee_work_policies ewp WHERE ewp.employee_id = e.id AND ewp.attendance_enabled = false)
    ),
    active_sessions AS (
        SELECT wds.id, wds.employee_id, wds.start_time, wds.status,
            e.full_name AS employee_name
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
        AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
    ),
    last_points AS (
        SELECT DISTINCT ON (tp.employee_id)
            tp.employee_id, tp.latitude, tp.longitude, tp.recorded_at
        FROM public.tracking_points tp WHERE tp.recorded_at >= CURRENT_DATE
        ORDER BY tp.employee_id, tp.recorded_at DESC
    ),
    active_breaks AS (
        SELECT wb.session_id, wb.employee_id FROM public.workday_breaks wb WHERE wb.break_end IS NULL
    ),
    today_orders AS (
        SELECT o.owner_id AS employee_id, COUNT(*)::int AS order_count,
            COALESCE(SUM(o.total_amount), 0) AS sales_value
        FROM public.orders o WHERE o.created_at::date = CURRENT_DATE GROUP BY o.owner_id
    ),
    today_collections AS (
        SELECT c.owner_id AS employee_id, COUNT(*)::int AS collection_count,
            COALESCE(SUM(c.amount), 0) AS collection_amount
        FROM public.collections c WHERE c.created_at::date = CURRENT_DATE GROUP BY c.owner_id
    ),
    today_customers AS (
        SELECT c.owner_id AS employee_id, COUNT(*)::int AS new_customer_count
        FROM public.customers c WHERE c.created_at::date = CURRENT_DATE GROUP BY c.owner_id
    ),
    today_visits AS (
        SELECT v.employee_id, COUNT(*)::int AS visit_count
        FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE GROUP BY v.employee_id
    )
    SELECT jsonb_build_object(
        'counters', jsonb_build_object(
            'active', (SELECT COUNT(*) FROM active_sessions),
            'on_break', (SELECT COUNT(DISTINCT ab.employee_id) FROM active_sessions as2 JOIN active_breaks ab ON ab.session_id = as2.id),
            'on_visit', (SELECT COUNT(*) FROM active_sessions as2 WHERE EXISTS (SELECT 1 FROM public.visits v2 WHERE v2.employee_id = as2.employee_id AND v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL)),
            'not_started', (SELECT COUNT(*) FROM filtered_employees fe WHERE fe.id NOT IN (SELECT employee_id FROM active_sessions) AND fe.id NOT IN (SELECT employee_id FROM public.workday_sessions WHERE date = CURRENT_DATE AND status = 'completed')),
            'connection_lost', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id WHERE lp.recorded_at IS NULL OR lp.recorded_at < now() - ((v_interval_seconds * 5) || ' seconds')::interval),
            'zero_visits_today', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN today_visits tv2 ON tv2.employee_id = as2.employee_id WHERE COALESCE(tv2.visit_count, 0) = 0),
            'zero_orders_today', (SELECT COUNT(*) FROM active_sessions as2 LEFT JOIN today_orders too2 ON too2.employee_id = as2.employee_id WHERE COALESCE(too2.order_count, 0) = 0),
            'inactive_over_2h', (SELECT COUNT(*) FROM active_sessions as2 WHERE EXTRACT(EPOCH FROM (now() - as2.start_time)) / 3600 > 2 AND NOT EXISTS (SELECT 1 FROM last_points lp2 WHERE lp2.employee_id = as2.employee_id AND lp2.recorded_at > now() - interval '30 minutes'))
        ),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', as2.employee_id, 'name', as2.employee_name,
            'role_name', COALESCE(role_info.name, ''),
            'status', CASE WHEN ab.employee_id IS NOT NULL THEN 'on_break'
                           WHEN vl.employee_id IS NOT NULL THEN 'on_visit'
                           ELSE 'working' END,
            'connection_status', CASE WHEN lp.recorded_at IS NULL THEN 'no_data'
                 WHEN lp.recorded_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                 WHEN lp.recorded_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                 ELSE 'lost' END,
            'latitude', lp.latitude, 'longitude', lp.longitude, 'last_seen_at', lp.recorded_at,
            'duration_minutes', EXTRACT(EPOCH FROM (now() - as2.start_time)) / 60,
            'order_count', COALESCE(too.order_count, 0), 'sales_value', COALESCE(too.sales_value, 0),
            'collection_count', COALESCE(tco.collection_count, 0), 'collection_amount', COALESCE(tco.collection_amount, 0),
            'new_customer_count', COALESCE(tc.new_customer_count, 0),
            'visit_count', COALESCE(tv.visit_count, 0)
        )) FROM active_sessions as2
        LEFT JOIN active_breaks ab ON ab.session_id = as2.id
        LEFT JOIN LATERAL (SELECT v2.id, v2.employee_id FROM public.visits v2 WHERE v2.employee_id = as2.employee_id AND v2.check_in_at::date = CURRENT_DATE AND v2.check_out_at IS NULL LIMIT 1) vl ON true
        LEFT JOIN last_points lp ON lp.employee_id = as2.employee_id
        LEFT JOIN today_orders too ON too.employee_id = as2.employee_id
        LEFT JOIN today_collections tco ON tco.employee_id = as2.employee_id
        LEFT JOIN today_customers tc ON tc.employee_id = as2.employee_id
        LEFT JOIN today_visits tv ON tv.employee_id = as2.employee_id
        LEFT JOIN LATERAL (
            SELECT r.name FROM public.employee_roles er
            JOIN public.roles r ON r.id = er.role_id
            WHERE er.employee_id = as2.employee_id LIMIT 1
        ) role_info ON true), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

-- ================================================================
-- 7. Permissions
-- ================================================================

-- Table permissions
GRANT SELECT, INSERT, UPDATE ON public.employee_work_policies TO authenticated;

-- RPC permissions
GRANT EXECUTE ON FUNCTION public.get_employee_work_policy TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_work_policy TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_employee_work_policy TO authenticated;
GRANT EXECUTE ON FUNCTION public.batch_upsert_work_policies TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_work_policies TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_employees_without_policies TO authenticated;
GRANT EXECUTE ON FUNCTION public.classify_employee_work_policies TO authenticated;
