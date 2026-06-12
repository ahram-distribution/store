-- Migration: Attendance Module (الحضور والانصراف)
-- Phase 1: Schema + Tables + RPCs + Permissions + Retention
-- Based on: docs/DESIGN_WORKDAY_TRACKING.md (Operational Rules 1-19)
--
-- Order:
--   1. workday_settings (attendance policy config)
--   2. workday_sessions (employee workday records)
--   3. workday_breaks (break records)
--   4. tracking_points (GPS breadcrumbs)
--   5. visit_links (timeline-to-visit associations)
--   6. tracking_cleanup_log (audit trail)
--   7. RPCs (employee-facing + management + internal)
--   8. Permissions
--   9. Retention system

-- ================================================================
-- 1. workday_settings
-- ================================================================

CREATE TABLE IF NOT EXISTS public.workday_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tracking_mode varchar(30) NOT NULL DEFAULT 'OFF'
        CHECK (tracking_mode IN ('OFF', 'VISITS_ONLY', 'WORKDAY', 'WORKDAY_PLUS_VISITS')),
    location_interval_seconds integer NOT NULL DEFAULT 300
        CHECK (location_interval_seconds IN (120, 300, 600, 900, 1800, 3600)),
    official_start_time time NOT NULL DEFAULT '09:00',
    official_end_time time NOT NULL DEFAULT '17:00',
    late_threshold_minutes integer NOT NULL DEFAULT 0,
    early_departure_threshold_minutes integer NOT NULL DEFAULT 0,
    retention_days integer NOT NULL DEFAULT 90
        CHECK (retention_days IN (7, 30, 90, 180, 365)),
    auto_cleanup_enabled boolean NOT NULL DEFAULT false,
    cleanup_frequency varchar(10) NOT NULL DEFAULT 'daily'
        CHECK (cleanup_frequency IN ('daily', 'weekly', 'monthly')),
    last_cleanup_at timestamptz,
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workday_settings_singleton
    ON public.workday_settings ((true));

COMMENT ON TABLE public.workday_settings IS
  'Upper Management tracking configuration. Single row enforced by unique index on (true).';
COMMENT ON COLUMN public.workday_settings.tracking_mode IS
  'OFF=متوقف, VISITS_ONLY=أثناء الزيارة فقط, WORKDAY=يوم العمل, WORKDAY_PLUS_VISITS=يوم العمل + الزيارات';
COMMENT ON COLUMN public.workday_settings.location_interval_seconds IS
  '120=كل دقيقتين, 300=كل 5 دقائق, 600=كل 10 دقائق, 900=كل 15 دقيقة, 1800=كل 30 دقيقة, 3600=كل ساعة';
COMMENT ON COLUMN public.workday_settings.official_start_time IS
  'بداية الدوام الرسمي. مثلاً 08:00 أو 09:00. تستخدم لحساب التأخير.';
COMMENT ON COLUMN public.workday_settings.official_end_time IS
  'نهاية الدوام الرسمي. مثلاً 17:00 أو 18:00. تستخدم لحساب الانصراف المبكر.';
COMMENT ON COLUMN public.workday_settings.late_threshold_minutes IS
  'الدقائق المسموح بها بعد بداية الدوام قبل اعتبار الموظف متأخراً. 0 = أي تأخير يُحتسب.';
COMMENT ON COLUMN public.workday_settings.early_departure_threshold_minutes IS
  'الدقائق المسموح بها قبل نهاية الدوام قبل اعتبار الموظف منصرفاً مبكراً. 0 = أي انصراف مبكر يُحتسب.';
COMMENT ON COLUMN public.workday_settings.retention_days IS
  '7=7 أيام, 30=30 يوماً, 90=90 يوماً, 180=180 يوماً, 365=سنة (أو بدون حذف)';

-- ================================================================
-- 2. workday_sessions
-- ================================================================

CREATE TABLE IF NOT EXISTS public.workday_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    date date NOT NULL DEFAULT CURRENT_DATE,
    start_time timestamptz NOT NULL DEFAULT now(),
    end_time timestamptz,
    start_latitude decimal(10,7),
    start_longitude decimal(10,7),
    end_latitude decimal(10,7),
    end_longitude decimal(10,7),
    start_device_status jsonb,
    end_device_status jsonb,
    status varchar(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'cancelled')),
    sync_status varchar(20) NOT NULL DEFAULT 'synced'
        CHECK (sync_status IN ('synced', 'pending', 'conflict')),
    total_distance_meters decimal(12,2) DEFAULT 0,
    visit_count integer DEFAULT 0,
    attendance_status varchar(20) DEFAULT 'unknown'
        CHECK (attendance_status IN ('ontime', 'late', 'early_departure', 'absent', 'unknown')),
    late_minutes integer DEFAULT 0,
    early_departure_minutes integer DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workday_sessions ADD CONSTRAINT fk_wds_employee
    FOREIGN KEY (employee_id) REFERENCES public.employees (id);

CREATE INDEX IF NOT EXISTS idx_wds_employee_id ON public.workday_sessions (employee_id);
CREATE INDEX IF NOT EXISTS idx_wds_date ON public.workday_sessions (date);
CREATE INDEX IF NOT EXISTS idx_wds_status ON public.workday_sessions (status);
CREATE INDEX IF NOT EXISTS idx_wds_employee_date ON public.workday_sessions (employee_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wds_active_per_day
    ON public.workday_sessions (employee_id, date) WHERE status = 'active';

COMMENT ON TABLE public.workday_sessions IS
  'Each row = one workday session for one employee. Active sessions must be unique per employee per day.';
COMMENT ON COLUMN public.workday_sessions.start_device_status IS
  'Snapshot of device state at start.';
COMMENT ON COLUMN public.workday_sessions.sync_status IS
  'synced = confirmed on server, pending = created offline, conflict = needs resolution';
COMMENT ON COLUMN public.workday_sessions.attendance_status IS
  'تحليل الالتزام: ontime=في الموعد, late=متأخر, early_departure=انصرف مبكراً, absent=غياب';
COMMENT ON COLUMN public.workday_sessions.late_minutes IS
  'دقائق التأخير عند بدء يوم العمل';
COMMENT ON COLUMN public.workday_sessions.early_departure_minutes IS
  'دقائق الانصراف المبكر عند إنهاء يوم العمل';

-- ================================================================
-- 3. workday_breaks
-- ================================================================

CREATE TABLE IF NOT EXISTS public.workday_breaks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    break_start timestamptz NOT NULL DEFAULT now(),
    break_end timestamptz,
    duration_seconds integer,
    break_reason varchar(30),
    auto_closed boolean NOT NULL DEFAULT false,
    latitude decimal(10,7),
    longitude decimal(10,7),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workday_breaks ADD CONSTRAINT fk_wb_session
    FOREIGN KEY (session_id) REFERENCES public.workday_sessions (id) ON DELETE CASCADE;
ALTER TABLE public.workday_breaks ADD CONSTRAINT fk_wb_employee
    FOREIGN KEY (employee_id) REFERENCES public.employees (id);

CREATE INDEX IF NOT EXISTS idx_wb_session_id ON public.workday_breaks (session_id);
CREATE INDEX IF NOT EXISTS idx_wb_employee_id ON public.workday_breaks (employee_id);

COMMENT ON TABLE public.workday_breaks IS
  'سجل الاستراحات. كل استراحة تنتمي ليوم عمل واحد ولا تنهي يوم العمل.';
COMMENT ON COLUMN public.workday_breaks.duration_seconds IS
  'تحتسب عند إنهاء الاستراحة. الفرق بين break_end و break_start بالثواني.';
COMMENT ON COLUMN public.workday_breaks.break_reason IS
  'اختياري: short_break, prayer, meal, other';
COMMENT ON COLUMN public.workday_breaks.auto_closed IS
  'true = أغلقت تلقائياً عند إنهاء يوم العمل';

-- ================================================================
-- 4. tracking_points
-- ================================================================

CREATE TABLE IF NOT EXISTS public.tracking_points (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    latitude decimal(10,7) NOT NULL,
    longitude decimal(10,7) NOT NULL,
    accuracy_meters decimal(8,2),
    altitude_meters decimal(8,2),
    speed_mps decimal(6,2),
    heading_degrees decimal(5,1),
    battery_pct decimal(4,1),
    recorded_at timestamptz NOT NULL,
    synced_at timestamptz NOT NULL DEFAULT now(),
    point_type varchar(20) NOT NULL DEFAULT 'periodic'
        CHECK (point_type IN ('periodic', 'start', 'end', 'visit_checkin', 'visit_checkout', 'long_stop', 'manual'))
);

ALTER TABLE public.tracking_points ADD CONSTRAINT fk_tp_session
    FOREIGN KEY (session_id) REFERENCES public.workday_sessions (id) ON DELETE CASCADE;
ALTER TABLE public.tracking_points ADD CONSTRAINT fk_tp_employee
    FOREIGN KEY (employee_id) REFERENCES public.employees (id);

CREATE INDEX IF NOT EXISTS idx_tp_session_id ON public.tracking_points (session_id);
CREATE INDEX IF NOT EXISTS idx_tp_employee_id ON public.tracking_points (employee_id);
CREATE INDEX IF NOT EXISTS idx_tp_recorded_at ON public.tracking_points (recorded_at);
CREATE INDEX IF NOT EXISTS idx_tp_recorded_at_brin
    ON public.tracking_points USING BRIN (recorded_at) WITH (pages_per_range = 32);

COMMENT ON TABLE public.tracking_points IS
  'GPS breadcrumbs. Heavily write-optimised. BRIN index on recorded_at for time-range scans.';
COMMENT ON COLUMN public.tracking_points.point_type IS
  'periodic=scheduled, start=workday start, end=workday end, visit_checkin/out=linked to visit, long_stop=idle detection, manual=on-demand';

-- ================================================================
-- 5. visit_links
-- ================================================================

CREATE TABLE IF NOT EXISTS public.visit_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    visit_id uuid NOT NULL,
    checkin_tracking_point_id uuid,
    checkout_tracking_point_id uuid,
    checkin_at timestamptz NOT NULL,
    checkout_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.visit_links ADD CONSTRAINT fk_vl_session
    FOREIGN KEY (session_id) REFERENCES public.workday_sessions (id) ON DELETE CASCADE;
ALTER TABLE public.visit_links ADD CONSTRAINT fk_vl_visit
    FOREIGN KEY (visit_id) REFERENCES public.visits (id);

CREATE INDEX IF NOT EXISTS idx_vl_session_id ON public.visit_links (session_id);
CREATE INDEX IF NOT EXISTS idx_vl_visit_id ON public.visit_links (visit_id);

COMMENT ON TABLE public.visit_links IS
  'Links workday timeline to visit events. Only populated in WORKDAY_PLUS_VISITS mode.';

-- ================================================================
-- 6. tracking_cleanup_log
-- ================================================================

CREATE TABLE IF NOT EXISTS public.tracking_cleanup_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type varchar(20) NOT NULL
        CHECK (action_type IN ('auto_cleanup', 'manual_cleanup', 'manual_delete')),
    deleted_sessions int NOT NULL DEFAULT 0,
    deleted_points int NOT NULL DEFAULT 0,
    cutoff_date timestamptz,
    employee_id uuid,
    reason text,
    executed_by uuid NOT NULL,
    executed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tracking_cleanup_log ADD CONSTRAINT fk_tcl_executed_by
    FOREIGN KEY (executed_by) REFERENCES public.employees (id);

COMMENT ON TABLE public.tracking_cleanup_log IS
  'سجل عمليات التنظيف. يحتفظ بسجل لجميع عمليات حذف بيانات التتبع.';

-- ================================================================
-- 7. RPCs
-- ================================================================

-- 7.1 Employee-facing RPCs

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
    v_settings record;
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

    INSERT INTO public.workday_sessions (employee_id, start_latitude, start_longitude, start_device_status)
    VALUES (v_employee_id, p_latitude, p_longitude, p_device_status)
    RETURNING id INTO v_existing_id;

    -- Insert start tracking point
    INSERT INTO public.tracking_points (session_id, employee_id, latitude, longitude, recorded_at, point_type)
    VALUES (v_existing_id, v_employee_id, p_latitude, p_longitude, now(), 'start');

    RETURN jsonb_build_object('session_id', v_existing_id, 'started_at', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.end_workday(
    p_token uuid,
    p_session_id uuid,
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
    v_workday record;
    v_break_id uuid;
    v_open_breaks int := 0;
    v_start_time time;
    v_end_time time;
    v_late_thresh int;
    v_early_thresh int;
    v_attendance_status varchar(20) := 'ontime';
    v_late_min int := 0;
    v_early_min int := 0;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_workday FROM public.workday_sessions
    WHERE id = p_session_id AND employee_id = v_employee_id AND status = 'active';
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;

    -- Auto-close any open breaks (Rule 3)
    FOR v_break_id IN
        SELECT id FROM public.workday_breaks
        WHERE session_id = p_session_id AND break_end IS NULL
    LOOP
        UPDATE public.workday_breaks
        SET break_end = now(),
            duration_seconds = EXTRACT(EPOCH FROM (now() - break_start))::integer,
            auto_closed = true
        WHERE id = v_break_id;
        v_open_breaks := v_open_breaks + 1;
    END LOOP;

    -- Read official hours settings for attendance analysis (Rule 18)
    SELECT official_start_time, official_end_time, late_threshold_minutes, early_departure_threshold_minutes
    INTO v_start_time, v_end_time, v_late_thresh, v_early_thresh
    FROM public.workday_settings LIMIT 1;

    -- Calculate lateness
    IF v_workday.start_time::time > v_start_time + (v_late_thresh || ' minutes')::interval THEN
        v_attendance_status := 'late';
        v_late_min := EXTRACT(EPOCH FROM (v_workday.start_time::time - v_start_time)) / 60;
    END IF;

    -- Calculate early departure (only if not already late)
    IF v_attendance_status = 'ontime'
       AND now()::time < v_end_time - (v_early_thresh || ' minutes')::interval
    THEN
        v_attendance_status := 'early_departure';
        v_early_min := EXTRACT(EPOCH FROM (v_end_time - now()::time)) / 60;
    END IF;

    UPDATE public.workday_sessions
    SET end_time = now(),
        end_latitude = p_latitude,
        end_longitude = p_longitude,
        end_device_status = p_device_status,
        status = 'completed',
        attendance_status = v_attendance_status,
        late_minutes = v_late_min,
        early_departure_minutes = v_early_min,
        updated_at = now()
    WHERE id = p_session_id;

    -- Insert end tracking point
    INSERT INTO public.tracking_points (session_id, employee_id, latitude, longitude, recorded_at, point_type)
    VALUES (p_session_id, v_employee_id, p_latitude, p_longitude, now(), 'end');

    RETURN jsonb_build_object(
        'session_id', p_session_id,
        'ended_at', now(),
        'auto_closed_breaks', v_open_breaks,
        'attendance_status', v_attendance_status,
        'late_minutes', v_late_min,
        'early_departure_minutes', v_early_min
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_break(
    p_token uuid,
    p_session_id uuid,
    p_latitude decimal DEFAULT NULL,
    p_longitude decimal DEFAULT NULL,
    p_reason varchar DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_break_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    IF NOT EXISTS (SELECT 1 FROM public.workday_sessions
        WHERE id = p_session_id AND employee_id = v_employee_id AND status = 'active') THEN
        RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
    END IF;

    INSERT INTO public.workday_breaks (session_id, employee_id, break_reason, latitude, longitude)
    VALUES (p_session_id, v_employee_id, p_reason, p_latitude, p_longitude)
    RETURNING id INTO v_break_id;

    RETURN jsonb_build_object('break_id', v_break_id, 'break_start', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.end_break(
    p_token uuid,
    p_session_id uuid,
    p_break_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_break record;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_break FROM public.workday_breaks
    WHERE id = p_break_id AND session_id = p_session_id AND employee_id = v_employee_id AND break_end IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'BREAK_NOT_FOUND'); END IF;

    UPDATE public.workday_breaks
    SET break_end = now(),
        duration_seconds = EXTRACT(EPOCH FROM (now() - break_start))::integer
    WHERE id = p_break_id;

    RETURN jsonb_build_object('break_id', p_break_id, 'break_end', now(), 'duration_seconds',
        EXTRACT(EPOCH FROM (now() - v_break.break_start))::integer);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_workday_status(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_workday record;
    v_break_count int;
    v_break_total_seconds int := 0;
    v_visit_count int;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_workday FROM public.workday_sessions
    WHERE employee_id = v_employee_id AND date = CURRENT_DATE AND status = 'active';
    IF NOT FOUND THEN
        SELECT * INTO v_workday FROM public.workday_sessions
        WHERE employee_id = v_employee_id AND date = CURRENT_DATE AND status = 'completed'
        ORDER BY end_time DESC LIMIT 1;
        IF NOT FOUND THEN RETURN NULL; END IF;
        RETURN jsonb_build_object(
            'status', 'completed',
            'session_id', v_workday.id,
            'started_at', v_workday.start_time,
            'ended_at', v_workday.end_time,
            'duration_minutes', EXTRACT(EPOCH FROM (v_workday.end_time - v_workday.start_time)) / 60
        );
    END IF;

    SELECT COUNT(*) INTO v_visit_count FROM public.visit_links
    WHERE session_id = v_workday.id;

    SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) INTO v_break_count, v_break_total_seconds
    FROM public.workday_breaks WHERE session_id = v_workday.id;

    RETURN jsonb_build_object(
        'status', 'active',
        'session_id', v_workday.id,
        'started_at', v_workday.start_time,
        'duration_minutes', EXTRACT(EPOCH FROM (now() - v_workday.start_time)) / 60,
        'break_count', v_break_count,
        'break_minutes', v_break_total_seconds / 60,
        'visit_count', v_visit_count,
        'net_work_minutes', (EXTRACT(EPOCH FROM (now() - v_workday.start_time)) - v_break_total_seconds) / 60
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_tracking_points(
    p_token uuid,
    p_session_id uuid,
    p_points jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_point jsonb;
    v_synced int := 0;
    v_rejected int := 0;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    IF NOT EXISTS (SELECT 1 FROM public.workday_sessions
        WHERE id = p_session_id AND employee_id = v_employee_id) THEN
        RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
    END IF;

    FOR v_point IN SELECT * FROM jsonb_array_elements(p_points)
    LOOP
        BEGIN
            INSERT INTO public.tracking_points (
                session_id, employee_id, latitude, longitude,
                accuracy_meters, altitude_meters, speed_mps, heading_degrees,
                battery_pct, recorded_at, point_type
            ) VALUES (
                p_session_id, v_employee_id,
                (v_point->>'latitude')::decimal,
                (v_point->>'longitude')::decimal,
                (v_point->>'accuracy_meters')::decimal,
                (v_point->>'altitude_meters')::decimal,
                (v_point->>'speed_mps')::decimal,
                (v_point->>'heading_degrees')::decimal,
                (v_point->>'battery_pct')::decimal,
                (v_point->>'recorded_at')::timestamptz,
                COALESCE(v_point->>'point_type', 'periodic')
            );
            v_synced := v_synced + 1;
        EXCEPTION WHEN OTHERS THEN
            v_rejected := v_rejected + 1;
        END;
    END LOOP;

    RETURN jsonb_build_object('synced', v_synced, 'rejected', v_rejected);
END;
$function$;

-- 7.2 Upper Management — Configuration RPCs

CREATE OR REPLACE FUNCTION public.get_workday_settings(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_settings record;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
    ) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    SELECT row_to_json(s)::jsonb INTO v_settings FROM (
        SELECT * FROM public.workday_settings LIMIT 1
    ) s;

    RETURN COALESCE(v_settings, '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_workday_settings(
    p_token uuid,
    p_fields jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_setting_id uuid;
    v_sql text := 'UPDATE public.workday_settings SET ';
    v_updates text[] := '{}';
    v_key text;
    v_val text;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
    ) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    SELECT id INTO v_setting_id FROM public.workday_settings LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO public.workday_settings (updated_by) VALUES (v_session.employee_id)
        RETURNING id INTO v_setting_id;
    END IF;

    FOR v_key, v_val IN SELECT * FROM jsonb_each_text(p_fields)
    LOOP
        IF v_key IN ('tracking_mode', 'location_interval_seconds', 'official_start_time',
                     'official_end_time', 'late_threshold_minutes', 'early_departure_threshold_minutes',
                     'retention_days', 'auto_cleanup_enabled', 'cleanup_frequency') THEN
            v_updates := array_append(v_updates, format('%I = %L', v_key,
                CASE
                    WHEN v_val ~ '^\d+(\.\d+)?$' THEN v_val
                    WHEN v_val IN ('true', 'false') THEN v_val
                    ELSE quote_literal(v_val)
                END
            ));
        END IF;
    END LOOP;

    v_updates := array_append(v_updates, format('updated_by = %L', v_session.employee_id));
    v_updates := array_append(v_updates, 'updated_at = now()');

    IF array_length(v_updates, 1) > 2 THEN
        EXECUTE v_sql || array_to_string(v_updates, ', ') || format(' WHERE id = %L', v_setting_id);
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_workday_cleanup_log(
    p_token uuid,
    p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_logs jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
    ) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.executed_at DESC), '[]'::jsonb) INTO v_logs
    FROM (
        SELECT * FROM public.tracking_cleanup_log
        ORDER BY executed_at DESC
        LIMIT p_limit
    ) t;

    RETURN jsonb_build_object('logs', v_logs);
END;
$function$;

-- 7.3 Upper Management — Operations RPCs

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

CREATE OR REPLACE FUNCTION public.get_employee_day_timeline(
    p_token uuid,
    p_employee_id uuid,
    p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_is_management boolean;
    v_session_record record;
    v_points jsonb;
    v_breaks jsonb;
    v_visit_links jsonb;
    v_distribution jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن', 'مدير مبيعات', 'مشرف')
    ) INTO v_is_management;

    IF NOT v_is_management THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT * INTO v_session_record FROM public.workday_sessions
    WHERE employee_id = p_employee_id AND date = p_date
    ORDER BY start_time DESC LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_SESSION'); END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(tp) ORDER BY tp.recorded_at), '[]'::jsonb) INTO v_points
    FROM (
        SELECT id, latitude, longitude, recorded_at, point_type
        FROM public.tracking_points
        WHERE session_id = v_session_record.id
        ORDER BY recorded_at
    ) tp;

    SELECT COALESCE(jsonb_agg(to_jsonb(wb) ORDER BY wb.break_start), '[]'::jsonb) INTO v_breaks
    FROM (
        SELECT id, break_start, break_end, duration_seconds, break_reason, auto_closed
        FROM public.workday_breaks
        WHERE session_id = v_session_record.id
        ORDER BY break_start
    ) wb;

    SELECT COALESCE(jsonb_agg(to_jsonb(vl) ORDER BY vl.checkin_at), '[]'::jsonb) INTO v_visit_links
    FROM (
        SELECT id, visit_id, checkin_at, checkout_at
        FROM public.visit_links
        WHERE session_id = v_session_record.id
        ORDER BY checkin_at
    ) vl;

    SELECT jsonb_build_object(
        'net_work_seconds',
            EXTRACT(EPOCH FROM (COALESCE(v_session_record.end_time, now()) - v_session_record.start_time)) -
            COALESCE((SELECT SUM(COALESCE(duration_seconds, 0)) FROM public.workday_breaks
                      WHERE session_id = v_session_record.id), 0),
        'visit_seconds', COALESCE((
            SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(checkout_at, now()) - checkin_at)))
            FROM public.visit_links WHERE session_id = v_session_record.id
        ), 0),
        'travel_seconds', COALESCE((
            SELECT EXTRACT(EPOCH FROM (COALESCE(v_session_record.end_time, now()) - v_session_record.start_time))
            - SUM(EXTRACT(EPOCH FROM (COALESCE(checkout_at, now()) - checkin_at)))
            - COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0)
            FROM public.visit_links vl2
            LEFT JOIN public.workday_breaks wb ON wb.session_id = vl2.session_id AND wb.break_end IS NOT NULL
            WHERE vl2.session_id = v_session_record.id
        ), 0),
        'break_seconds', COALESCE((
            SELECT SUM(COALESCE(duration_seconds, 0))
            FROM public.workday_breaks WHERE session_id = v_session_record.id
        ), 0)
    ) INTO v_distribution;

    RETURN jsonb_build_object(
        'session', row_to_json(v_session_record),
        'points', v_points,
        'breaks', v_breaks,
        'visit_links', v_visit_links,
        'time_distribution', v_distribution,
        'attendance_status', v_session_record.attendance_status,
        'late_minutes', v_session_record.late_minutes,
        'early_departure_minutes', v_session_record.early_departure_minutes
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_employee_day_map(
    p_token uuid,
    p_employee_id uuid,
    p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_is_management boolean;
    v_session_record record;
    v_start_point jsonb;
    v_end_point jsonb;
    v_route jsonb;
    v_visit_locations jsonb;
    v_stop_locations jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن', 'مدير مبيعات', 'مشرف')
    ) INTO v_is_management;

    IF NOT v_is_management THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    SELECT * INTO v_session_record FROM public.workday_sessions
    WHERE employee_id = p_employee_id AND date = p_date
    ORDER BY start_time DESC LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_SESSION'); END IF;

    SELECT jsonb_build_object('latitude', latitude, 'longitude', longitude, 'recorded_at', recorded_at)
    INTO v_start_point
    FROM public.tracking_points
    WHERE session_id = v_session_record.id AND point_type = 'start'
    ORDER BY recorded_at LIMIT 1;

    SELECT jsonb_build_object('latitude', latitude, 'longitude', longitude, 'recorded_at', recorded_at)
    INTO v_end_point
    FROM public.tracking_points
    WHERE session_id = v_session_record.id AND point_type = 'end'
    ORDER BY recorded_at DESC LIMIT 1;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('latitude', latitude, 'longitude', longitude) ORDER BY recorded_at), '[]'::jsonb)
    INTO v_route
    FROM public.tracking_points
    WHERE session_id = v_session_record.id AND point_type IN ('periodic', 'start', 'end')
    ORDER BY recorded_at;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'visit_id', vl.visit_id,
        'latitude', tp.latitude,
        'longitude', tp.longitude,
        'checkin_at', vl.checkin_at,
        'checkout_at', vl.checkout_at
    ) ORDER BY vl.checkin_at), '[]'::jsonb) INTO v_visit_locations
    FROM public.visit_links vl
    JOIN public.tracking_points tp ON tp.id = vl.checkin_tracking_point_id
    WHERE vl.session_id = v_session_record.id;

    RETURN jsonb_build_object(
        'start_point', v_start_point,
        'end_point', v_end_point,
        'route_polyline', v_route,
        'visit_locations', v_visit_locations,
        'session', jsonb_build_object(
            'employee_id', v_session_record.employee_id,
            'date', v_session_record.date,
            'start_time', v_session_record.start_time,
            'end_time', v_session_record.end_time,
            'attendance_status', v_session_record.attendance_status
        )
    );
END;
$function$;

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
    v_is_management boolean;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن', 'مدير مبيعات', 'مشرف')
    ) INTO v_is_management;

    IF NOT v_is_management THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date DESC), '[]'::jsonb) INTO v_result
    FROM (
        SELECT
            wds.id, wds.date, wds.start_time, wds.end_time, wds.status,
            EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) / 60 AS duration_minutes,
            wds.total_distance_meters AS distance_meters,
            wds.visit_count,
            wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
            (SELECT COUNT(*) FROM public.workday_breaks wb WHERE wb.session_id = wds.id) AS break_count,
            (SELECT COALESCE(SUM(duration_seconds), 0) FROM public.workday_breaks wb WHERE wb.session_id = wds.id) AS break_seconds
        FROM public.workday_sessions wds
        WHERE wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to
        ORDER BY wds.date DESC
    ) t;

    RETURN jsonb_build_object(
        'sessions', v_result,
        'summary', jsonb_build_object(
            'total_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to AND status = 'completed'),
            'late_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to AND attendance_status = 'late'),
            'early_departure_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to AND attendance_status = 'early_departure'),
            'ontime_days', (SELECT COUNT(*) FROM public.workday_sessions WHERE employee_id = p_employee_id AND date >= p_from AND date <= p_to AND attendance_status = 'ontime')
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_team_map(p_token uuid)
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

    WITH active_status AS (
        SELECT
            wds.employee_id, e.name AS employee_name,
            wds.start_time, wds.id AS session_id,
            tp.latitude, tp.longitude, tp.recorded_at,
            CASE
                WHEN wb.id IS NOT NULL THEN 'on_break'
                WHEN vl.id IS NOT NULL THEN 'on_visit'
                WHEN tp.recorded_at IS NOT NULL AND tp.recorded_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'working'
                WHEN tp.recorded_at IS NOT NULL THEN 'connection_lost'
                ELSE 'working'
            END AS status,
            CASE
                WHEN tp.recorded_at IS NULL THEN 'no_data'
                WHEN tp.recorded_at > now() - (v_interval_seconds || ' seconds')::interval THEN 'connected'
                WHEN tp.recorded_at > now() - ((v_interval_seconds * 5) || ' seconds')::interval THEN 'delayed'
                ELSE 'lost'
            END AS connection_status
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        LEFT JOIN LATERAL (
            SELECT id FROM public.workday_breaks
            WHERE session_id = wds.id AND break_end IS NULL
            LIMIT 1
        ) wb ON true
        LEFT JOIN LATERAL (
            SELECT id FROM public.visit_links
            WHERE session_id = wds.id AND checkout_at IS NULL
            LIMIT 1
        ) vl ON true
        LEFT JOIN LATERAL (
            SELECT latitude, longitude, recorded_at FROM public.tracking_points
            WHERE employee_id = wds.employee_id AND recorded_at >= CURRENT_DATE
            ORDER BY recorded_at DESC LIMIT 1
        ) tp ON true
        WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
    )
    SELECT jsonb_build_object(
        'counters', jsonb_build_object(
            'active', (SELECT COUNT(*) FROM active_status WHERE status IN ('working', 'connection_lost')),
            'on_visit', (SELECT COUNT(*) FROM active_status WHERE status = 'on_visit'),
            'on_break', (SELECT COUNT(*) FROM active_status WHERE status = 'on_break'),
            'connection_lost', (SELECT COUNT(*) FROM active_status WHERE status = 'connection_lost'),
            'not_started', (SELECT COUNT(*) FROM public.employees e WHERE e.active = true AND e.id NOT IN (
                SELECT employee_id FROM public.workday_sessions WHERE date = CURRENT_DATE AND status IN ('active', 'completed')
            ))
        ),
        'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employee_id', a.employee_id,
            'name', a.employee_name,
            'status', a.status,
            'connection_status', a.connection_status,
            'latitude', a.latitude,
            'longitude', a.longitude,
            'last_seen_at', a.recorded_at,
            'last_seen_label',
                CASE a.connection_status
                    WHEN 'connected' THEN 'متصل الآن'
                    WHEN 'delayed' THEN
                        'آخر ظهور منذ ' || EXTRACT(EPOCH FROM (now() - a.recorded_at))::int / 60 || ' دقيقة'
                    WHEN 'lost' THEN 'انقطاع متابعة'
                    ELSE 'لا توجد بيانات حديثة'
                END
        ) ORDER BY
            CASE a.status
                WHEN 'working' THEN 1
                WHEN 'on_visit' THEN 2
                WHEN 'on_break' THEN 3
                WHEN 'connection_lost' THEN 4
                ELSE 5
            END
        ) FROM active_status a), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

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
        ) ORDER BY sub.session_count DESC), '[]'::jsonb)
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
        WHERE wds.date >= p_from AND wds.date <= p_to AND wds.status = 'completed'
        AND (p_employee_ids IS NULL OR wds.employee_id = ANY(p_employee_ids))
        GROUP BY wds.employee_id, e.name
    ) sub;

    RETURN v_result;
END;
$function$;

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
        ) ORDER BY sub.compliance_rate DESC), '[]'::jsonb)
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
        WHERE wds.date >= p_from AND wds.date <= p_to AND wds.status = 'completed'
        AND (p_employee_ids IS NULL OR wds.employee_id = ANY(p_employee_ids))
        GROUP BY wds.employee_id, e.name
    ) sub;

    RETURN v_result;
END;
$function$;

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
    v_active_alerts jsonb;
    v_resolved_alerts jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT official_start_time, official_end_time, location_interval_seconds
    INTO v_start_time, v_end_time, v_interval_seconds
    FROM public.workday_settings LIMIT 1;
    v_interval_seconds := COALESCE(v_interval_seconds, 300);

    WITH
    -- Alert: لم يبدأ اليوم بعد موعد الدوام + 30 دقيقة
    not_started AS (
        SELECT 'not_started' AS alert_type, e.id AS employee_id, e.name AS employee_name,
            'لم يبدأ يوم العمل بعد موعد الدوام' AS title,
            'الساعة الآن ' || to_char(now()::time, 'HH:MI') || ' — وقت البدء الرسمي ' || to_char(v_start_time, 'HH:MI') AS description,
            now() AS detected_at
        FROM public.employees e
        WHERE e.active = true
        AND NOT EXISTS (SELECT 1 FROM public.workday_sessions wds WHERE wds.employee_id = e.id AND wds.date = CURRENT_DATE)
        AND CURRENT_TIME > v_start_time + interval '30 minutes'
    ),
    -- Alert: يوم مفتوح من اليوم السابق
    open_yesterday AS (
        SELECT 'open_yesterday' AS alert_type, wds.employee_id AS employee_id, e.name AS employee_name,
            'يوم عمل مفتوح من اليوم السابق' AS title,
            'بدأ يوم ' || wds.date || ' الساعة ' || to_char(wds.start_time, 'HH:MI') || ' — لم ينته بعد' AS description,
            now() AS detected_at
        FROM public.workday_sessions wds
        JOIN public.employees e ON e.id = wds.employee_id
        WHERE wds.date < CURRENT_DATE AND wds.status = 'active'
    ),
    -- Alert: استراحة طويلة (> 2 hours)
    long_break AS (
        SELECT 'long_break' AS alert_type, wb.employee_id, e.name AS employee_name,
            'استراحة طويلة بشكل غير طبيعي' AS title,
            'في استراحة منذ ' || round(EXTRACT(EPOCH FROM (now() - wb.break_start)) / 60) || ' دقيقة' AS description,
            wb.break_start AS detected_at
        FROM public.workday_breaks wb
        JOIN public.employees e ON e.id = wb.employee_id
        WHERE wb.break_end IS NULL
        AND EXTRACT(EPOCH FROM (now() - wb.break_start)) > 7200  -- 2 hours
    ),
    -- Alert: لا توجد تحديثات حديثة
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
    ),
    -- Alert: لا توجد زيارات طوال اليوم
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

CREATE OR REPLACE FUNCTION public.get_employee_current_location(
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
    v_is_management boolean;
    v_result jsonb;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن', 'مدير مبيعات', 'مشرف')
    ) INTO v_is_management;

    IF NOT v_is_management THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    SELECT jsonb_build_object(
        'employee_id', e.id,
        'name', e.name,
        'latitude', tp.latitude,
        'longitude', tp.longitude,
        'address', COALESCE(ea.address, ''),
        'status', COALESCE(wds.status, 'inactive'),
        'attendance_status', wds.attendance_status,
        'last_updated_at', tp.recorded_at,
        'last_seen_label',
            CASE
                WHEN tp.recorded_at > now() - interval '5 minutes' THEN 'متصل الآن'
                WHEN tp.recorded_at > now() - interval '30 minutes' THEN 'آخر ظهور منذ ' || round(EXTRACT(EPOCH FROM (now() - tp.recorded_at)) / 60) || ' دقيقة'
                ELSE 'لا توجد بيانات حديثة'
            END
    ) INTO v_result
    FROM public.employees e
    LEFT JOIN LATERAL (
        SELECT latitude, longitude, recorded_at FROM public.tracking_points
        WHERE employee_id = p_employee_id
        ORDER BY recorded_at DESC LIMIT 1
    ) tp ON true
    LEFT JOIN LATERAL (
        SELECT * FROM public.workday_sessions
        WHERE employee_id = p_employee_id AND date = CURRENT_DATE
        ORDER BY start_time DESC LIMIT 1
    ) wds ON true
    LEFT JOIN public.employee_addresses ea ON ea.employee_id = e.id AND ea.is_primary = true
    WHERE e.id = p_employee_id;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_tracking_data(
    p_token uuid,
    p_mode varchar,
    p_employee_id uuid DEFAULT NULL,
    p_from date DEFAULT NULL,
    p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_deleted_sessions int := 0;
    v_deleted_points int := 0;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
    ) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

    IF p_mode = 'all' THEN
        DELETE FROM public.tracking_points;
        GET DIAGNOSTICS v_deleted_points = ROW_COUNT;
        DELETE FROM public.workday_sessions WHERE status != 'active';
        GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    ELSIF p_mode = 'employee' AND p_employee_id IS NOT NULL THEN
        DELETE FROM public.tracking_points WHERE employee_id = p_employee_id;
        GET DIAGNOSTICS v_deleted_points = ROW_COUNT;
        DELETE FROM public.workday_sessions WHERE employee_id = p_employee_id AND status != 'active';
        GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    ELSIF p_mode = 'range' AND p_from IS NOT NULL AND p_to IS NOT NULL THEN
        DELETE FROM public.tracking_points WHERE recorded_at::date >= p_from AND recorded_at::date <= p_to;
        GET DIAGNOSTICS v_deleted_points = ROW_COUNT;
        DELETE FROM public.workday_sessions WHERE date >= p_from AND date <= p_to AND status != 'active';
        GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    ELSIF p_mode = 'day' AND p_from IS NOT NULL THEN
        DELETE FROM public.tracking_points WHERE recorded_at::date = p_from;
        GET DIAGNOSTICS v_deleted_points = ROW_COUNT;
        DELETE FROM public.workday_sessions WHERE date = p_from AND status != 'active';
        GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    END IF;

    INSERT INTO public.tracking_cleanup_log (action_type, deleted_sessions, deleted_points, cutoff_date, employee_id, reason, executed_by)
    VALUES (
        'manual_cleanup', v_deleted_sessions, v_deleted_points,
        CASE WHEN p_mode IN ('range', 'day') THEN p_from::timestamptz ELSE now() END,
        p_employee_id, 'Manual cleanup by management', v_session.employee_id
    );

    RETURN jsonb_build_object('deleted_sessions', v_deleted_sessions, 'deleted_points', v_deleted_points);
END;
$function$;

-- 7.4 Internal / Scheduled RPCs

CREATE OR REPLACE FUNCTION public.auto_cleanup_tracking_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_retention_days int;
    v_auto_cleanup boolean;
    v_cutoff_date timestamptz;
    v_deleted_points int := 0;
    v_deleted_sessions int := 0;
    v_system_employee_id uuid;
BEGIN
    SELECT retention_days, auto_cleanup_enabled INTO v_retention_days, v_auto_cleanup
    FROM public.workday_settings LIMIT 1;

    IF NOT v_auto_cleanup THEN
        RETURN jsonb_build_object('skipped', true, 'reason', 'auto_cleanup_disabled');
    END IF;

    v_cutoff_date := CURRENT_DATE - v_retention_days;

    DELETE FROM public.tracking_points WHERE recorded_at < v_cutoff_date;
    GET DIAGNOSTICS v_deleted_points = ROW_COUNT;

    DELETE FROM public.workday_sessions
    WHERE end_time < v_cutoff_date AND status = 'completed';
    GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;

    SELECT id INTO v_system_employee_id FROM public.employees ORDER BY created_at LIMIT 1;

    INSERT INTO public.tracking_cleanup_log
        (action_type, deleted_sessions, deleted_points, cutoff_date, executed_by)
    VALUES ('auto_cleanup', v_deleted_sessions, v_deleted_points, v_cutoff_date, v_system_employee_id);

    UPDATE public.workday_settings SET last_cleanup_at = now()
    WHERE id = (SELECT id FROM public.workday_settings LIMIT 1);

    RETURN jsonb_build_object('deleted_points', v_deleted_points, 'deleted_sessions', v_deleted_sessions, 'cutoff_date', v_cutoff_date);
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_long_stops(
    p_token uuid,
    p_session_id uuid,
    p_threshold_minutes int DEFAULT 15
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

    WITH ordered_points AS (
        SELECT
            recorded_at, latitude, longitude,
            LAG(recorded_at) OVER (ORDER BY recorded_at) AS prev_time,
            LAG(latitude) OVER (ORDER BY recorded_at) AS prev_lat,
            LAG(longitude) OVER (ORDER BY recorded_at) AS prev_lng,
            EXTRACT(EPOCH FROM (recorded_at - LAG(recorded_at) OVER (ORDER BY recorded_at))) / 60 AS gap_minutes
        FROM public.tracking_points
        WHERE session_id = p_session_id
        ORDER BY recorded_at
    ),
    stops AS (
        SELECT
            prev_time AS stop_start,
            recorded_at AS stop_end,
            gap_minutes,
            prev_lat AS latitude,
            prev_lng AS longitude
        FROM ordered_points
        WHERE gap_minutes >= p_threshold_minutes
    )
    SELECT jsonb_build_object(
        'stops', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.stop_start) FROM stops s), '[]'::jsonb),
        'total_stops', (SELECT COUNT(*) FROM stops)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

-- ================================================================
-- 8. Permissions
-- ================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA public TO authenticated;

-- Employee-facing tables: employees can insert tracking_points + workday_breaks
GRANT INSERT ON public.workday_sessions TO authenticated;
GRANT SELECT, UPDATE ON public.workday_sessions TO authenticated;
GRANT INSERT ON public.workday_breaks TO authenticated;
GRANT SELECT, UPDATE ON public.workday_breaks TO authenticated;
GRANT INSERT ON public.tracking_points TO authenticated;
GRANT SELECT ON public.tracking_points TO authenticated;

-- Management tables: restricted via RPCs (SECURITY DEFINER)
GRANT SELECT, INSERT, UPDATE ON public.workday_settings TO authenticated;
GRANT SELECT ON public.workday_sessions TO authenticated;
GRANT SELECT ON public.workday_breaks TO authenticated;
GRANT SELECT ON public.tracking_points TO authenticated;
GRANT SELECT ON public.visit_links TO authenticated;
GRANT SELECT, INSERT ON public.tracking_cleanup_log TO authenticated;

-- RPC permissions (GRANT EXECUTE to authenticated for specific RPCs)
GRANT EXECUTE ON FUNCTION public.start_workday TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_workday TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_break TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_break TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_workday_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_tracking_points TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_workday_settings TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_workday_settings TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workday_cleanup_log TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_live_workday_overview TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_day_timeline TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_day_map TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_workday_history TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_map TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workday_report TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_attendance_analysis TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_alerts TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_current_location TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_tracking_data TO authenticated;

GRANT EXECUTE ON FUNCTION public.detect_long_stops TO authenticated;

-- ================================================================
-- 9. Seed default workday_settings row (singleton)
-- ================================================================

INSERT INTO public.workday_settings (updated_by)
SELECT id FROM public.employees
WHERE NOT EXISTS (SELECT 1 FROM public.workday_settings)
ORDER BY created_at LIMIT 1;
