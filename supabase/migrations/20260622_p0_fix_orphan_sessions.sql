-- ===============================================================
-- P0 Fix: Orphan Sessions + Ambiguous Functions + History/Ledger
-- تاريخ: 22 يونيو 2026
--
-- P0-1: إصلاح الجلسات المعلقة (أورفان)
-- P0-2: إصلاح Ambiguous Function في get_daily_target_vs_actual
-- P0-3: إصلاح تناقض History vs Ledger
-- ===============================================================

-- =============================================================
-- P0-1: ORPHAN SESSION FIX
-- =============================================================
-- المشكلة: جلسة عمر محسن (REP003) من 2026-06-21 معلقة (22h+)
--          لا يوجد Auto-Close في النظام الحالي
--          start_workday لا يستعيد الجلسات القديمة
--
-- الحل:
--   1. إغلاق الجلسات المعلقة من الأيام السابقة
--   2. إضافة recovery إلى start_workday
--   3. إنشاء دالة batch للكشف والإغلاق
-- =============================================================

-- 0. إضافة last_seen_at column و auto_closed إلى CHECK constraint
-- last_seen_at: مطلوب لـ auto-close (موجودة في 20260727 ولكن غير منشورة)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'workday_sessions' AND column_name = 'last_seen_at'
    ) THEN
        ALTER TABLE public.workday_sessions ADD COLUMN last_seen_at timestamptz;
        COMMENT ON COLUMN public.workday_sessions.last_seen_at IS 'آخر نشاط معروف للمستخدم (تحديث يدوي)';
    END IF;
END $$;

ALTER TABLE public.workday_sessions
  DROP CONSTRAINT IF EXISTS workday_sessions_attendance_status_check;
ALTER TABLE public.workday_sessions
  ADD CONSTRAINT workday_sessions_attendance_status_check
  CHECK (attendance_status IN ('ontime', 'late', 'early_departure', 'absent', 'unknown', 'auto_closed'));

-- 1. إغلاق جلسات الأمس المعلقة (لجميع الموظفين)
UPDATE public.workday_sessions
SET end_time = COALESCE(last_seen_at, start_time + interval '12 hours'),
    status = 'completed',
    attendance_status = 'auto_closed',
    updated_at = now()
WHERE status = 'active'
  AND date < CURRENT_DATE;

-- 2. إضافة Recovery Logic إلى start_workday
-- إغلاق أي جلسة قديمة (من أيام سابقة) تلقائياً عند بدء يوم جديد
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
    v_stale record;
    v_stale_count int := 0;
    v_settings record;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF v_session.identity_type != 'employee' THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
    v_employee_id := v_session.employee_id;

    -- Auto-recover stale sessions from previous days
    FOR v_stale IN
        SELECT id, date, start_time
        FROM public.workday_sessions
        WHERE employee_id = v_employee_id
          AND status = 'active'
          AND date < CURRENT_DATE
        ORDER BY date ASC
    LOOP
        UPDATE public.workday_sessions
        SET end_time = now(),
            status = 'completed',
            attendance_status = 'auto_closed',
            updated_at = now()
        WHERE id = v_stale.id;
        v_stale_count := v_stale_count + 1;
    END LOOP;

    -- Check no active session today
    SELECT id INTO v_existing_id FROM public.workday_sessions
    WHERE employee_id = v_employee_id AND date = CURRENT_DATE AND status = 'active';
    IF FOUND THEN
        RETURN jsonb_build_object(
            'error', 'ALREADY_ACTIVE',
            'session_id', v_existing_id,
            'recovered_stale_sessions', v_stale_count
        );
    END IF;

    INSERT INTO public.workday_sessions (employee_id, start_latitude, start_longitude, start_device_status)
    VALUES (v_employee_id, p_latitude, p_longitude, p_device_status)
    RETURNING id INTO v_existing_id;

    INSERT INTO public.tracking_points (session_id, employee_id, latitude, longitude, recorded_at, point_type)
    VALUES (v_existing_id, v_employee_id, p_latitude, p_longitude, now(), 'start');

    RETURN jsonb_build_object(
        'session_id', v_existing_id,
        'started_at', now(),
        'recovered_stale_sessions', v_stale_count
    );
END;
$function$;

-- 3. دالة للكشف عن الجلسات المعلقة (للمديرين)
-- يمكن استدعاؤها يدوياً أو عبر Edge Function/Cron
CREATE OR REPLACE FUNCTION public.get_stale_sessions(
    p_token uuid,
    p_min_hours int DEFAULT 16
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

    IF NOT public.check_capability(p_token, 'attendance.view_all') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'session_id', wds.id,
        'employee_id', e.id,
        'employee_name', e.full_name,
        'employee_code', e.code,
        'date', wds.date,
        'start_time', wds.start_time,
        'hours_open', ROUND(EXTRACT(EPOCH FROM (now() - wds.start_time)) / 3600, 1),
        'status', wds.status
    ) ORDER BY wds.start_time DESC)
    INTO v_result
    FROM public.workday_sessions wds
    JOIN public.employees e ON e.id = wds.employee_id
    WHERE wds.status = 'active'
      AND EXTRACT(EPOCH FROM (now() - wds.start_time)) / 3600 > p_min_hours;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_stale_sessions TO authenticated;

-- =============================================================
-- P0-2: FIX AMBIGUOUS FUNCTION
-- =============================================================
-- المشكلة: يوجد overload قديم get_daily_target_vs_actual(text,text,text)
--          بالإضافة إلى overload الجديد (uuid,uuid,date)
--          يسبب Ambiguous Function عند الاستدعاء
--
-- الحل: حذف الـ overload القديم
-- =============================================================

-- حذف الـ overload النصي القديم (إن وجد)
DROP FUNCTION IF EXISTS public.get_daily_target_vs_actual(text, text, text) CASCADE;

-- حذف أي overload قديم للـ get_tracking_session_stats
DROP FUNCTION IF EXISTS public.get_tracking_session_stats(text, uuid, date) CASCADE;
DROP FUNCTION IF EXISTS public.get_tracking_session_stats(text, text, text) CASCADE;

-- =============================================================
-- P0-3: FIX HISTORY vs LEDGER DISCREPANCY
-- =============================================================
-- المشكلة الأصلية: get_employee_workday_history يستخدم
--   ROW_NUMBER() PARTITION BY employee_id, date ... WHERE rn = 1
-- مما يحدد جلسة واحدة فقط لكل يوم. هذا يخفي الجلسة الثانية
-- في 06-18 (يظهر 119 دقيقة بدلاً من 594 دقيقة).
--
-- التحقيق (2026-06-22):
--   History 06-18: جلسة واحدة = 119 دقيقة
--   Ledger 06-18: جلستان = 594 دقيقة (9.9 ساعة)
--   الفرق = 475 دقيقة (جلسة ثانية مخفية)
--
-- الحل: إزالة rn = 1 filter ليعرض كل الجلسات لكل يوم
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_employee_workday_history(
    p_token uuid,
    p_employee_id uuid,
    p_from date,
    p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_result jsonb;
    v_policy record;
    v_use_net_calc boolean := true;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.is_upper_management(v_session.employee_id) THEN
      IF NOT (p_employee_id = ANY(public.get_visible_employee_ids(p_token))) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;

    SELECT * INTO v_policy FROM public.employee_work_policies WHERE employee_id = p_employee_id;
    v_use_net_calc := COALESCE((v_policy.schedule_type = 'fixed_shift'), false);

    WITH session_data AS (
        SELECT
            wds.id, wds.date, wds.start_time, wds.end_time, wds.status,
            EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60 AS duration_minutes,
            COALESCE(wb.break_seconds, 0) / 60 AS break_minutes,
            COALESCE(wb.break_count, 0) AS break_count,
            wds.visit_count,
            wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
            COALESCE(wds.total_distance_meters, 0) AS distance_meters,
            COALESCE(od.order_count, 0) AS order_count,
            COALESCE(od.sales_value, 0) AS sales_value,
            COALESCE(cd.collection_count, 0) AS collection_count,
            COALESCE(cd.collection_amount, 0) AS collection_amount,
            COALESCE(nd.new_customer_count, 0) AS new_customer_count
        FROM public.workday_sessions wds
        LEFT JOIN (
            SELECT session_id,
                COUNT(*) AS break_count,
                COALESCE(SUM(duration_seconds), 0) AS break_seconds
            FROM public.workday_breaks GROUP BY session_id
        ) wb ON wb.session_id = wds.id
        LEFT JOIN (
            SELECT o.owner_id, o.created_at::date AS d,
                COUNT(*)::int AS order_count,
                COALESCE(SUM(o.total_amount), 0) AS sales_value
            FROM public.orders o GROUP BY o.owner_id, o.created_at::date
        ) od ON od.owner_id = wds.employee_id AND od.d = wds.date
        LEFT JOIN (
            SELECT c.owner_id, c.created_at::date AS d,
                COUNT(*)::int AS collection_count,
                COALESCE(SUM(c.amount), 0) AS collection_amount
            FROM public.collections c GROUP BY c.owner_id, c.created_at::date
        ) cd ON cd.owner_id = wds.employee_id AND cd.d = wds.date
        LEFT JOIN (
            SELECT c2.owner_id, c2.created_at::date AS d,
                COUNT(*)::int AS new_customer_count
            FROM public.customers c2 GROUP BY c2.owner_id, c2.created_at::date
        ) nd ON nd.owner_id = wds.employee_id AND nd.d = wds.date
        WHERE wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to
    )
    SELECT jsonb_build_object(
        'sessions', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                'id', sd.id, 'date', sd.date, 'start_time', sd.start_time, 'end_time', sd.end_time,
                'status', sd.status,
                'duration_minutes', GREATEST(COALESCE(sd.duration_minutes, 0), 0)::int,
                'break_minutes', sd.break_minutes::int,
                'net_minutes', CASE WHEN v_use_net_calc
                    THEN GREATEST(COALESCE(sd.duration_minutes, 0) - COALESCE(sd.break_minutes, 0), 0)::int
                    ELSE GREATEST(COALESCE(sd.duration_minutes, 0), 0)::int
                END,
                'break_count', sd.break_count,
                'visit_count', sd.visit_count,
                'order_count', sd.order_count,
                'sales_value', sd.sales_value,
                'collection_count', sd.collection_count,
                'collection_amount', sd.collection_amount,
                'new_customer_count', sd.new_customer_count,
                'distance_meters', sd.distance_meters::int,
                'attendance_status', sd.attendance_status,
                'late_minutes', sd.late_minutes,
                'early_departure_minutes', sd.early_departure_minutes
            ) ORDER BY sd.date DESC, sd.start_time ASC)
            FROM session_data sd),
        '[]'::jsonb),
        'summary', (SELECT jsonb_build_object(
            'total_days', COUNT(DISTINCT date),
            'total_duration_minutes', COALESCE(SUM(duration_minutes)::int, 0),
            'total_break_minutes', COALESCE(SUM(break_minutes)::int, 0),
            'total_net_minutes', COALESCE(SUM(CASE WHEN v_use_net_calc
                THEN GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0)
                ELSE GREATEST(COALESCE(duration_minutes, 0), 0) END)::int, 0),
            'avg_net_minutes', COALESCE(AVG(CASE WHEN v_use_net_calc
                THEN GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0)
                ELSE GREATEST(COALESCE(duration_minutes, 0), 0) END)::int, 0),
            'max_net_day', COALESCE(MAX(CASE WHEN v_use_net_calc
                THEN GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0)
                ELSE GREATEST(COALESCE(duration_minutes, 0), 0) END)::int, 0),
            'min_net_day', COALESCE(MIN(CASE WHEN v_use_net_calc
                THEN GREATEST(COALESCE(duration_minutes, 0) - COALESCE(break_minutes, 0), 0)
                ELSE GREATEST(COALESCE(duration_minutes, 0), 0) END)::int, 0),
            'total_sales_value', COALESCE(SUM(sales_value)::int, 0),
            'total_orders', COALESCE(SUM(order_count)::int, 0),
            'total_visits', COALESCE(SUM(visit_count)::int, 0),
            'total_collections', COALESCE(SUM(collection_count)::int, 0),
            'total_collections_amount', COALESCE(SUM(collection_amount)::int, 0),
            'total_new_customers', COALESCE(SUM(new_customer_count)::int, 0),
            'late_days', COUNT(*) FILTER (WHERE attendance_status = 'late'),
            'early_departure_days', COUNT(*) FILTER (WHERE attendance_status = 'early_departure'),
            'ontime_days', COUNT(*) FILTER (WHERE attendance_status = 'ontime')
        ) FROM session_data)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_employee_workday_history TO authenticated;
