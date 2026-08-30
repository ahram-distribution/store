-- ============================================================================
-- شاشة الحضور والمتابعة — Executive Attendance & Follow-up (NEW screen)
-- الجزء 1: التأسيس (صلاحية / إعداد / تدقيق / المطبِّقان)
-- ============================================================================
-- طبقة تنفيذية (الإدارة العليا) للمتابعة والتحليل — إضافية تماماً ADDITIVE.
--
-- القاعدة (غير قابلة للتفاوض):
--   لا تُعدَّل أي شاشة /attendance/operations القديمة ولا عقود بياناتها.
--   جميع RPCs الجديدة ببادئة get_executive_* / set_executive_* (لا تعارض).
--
-- التغيير الوحيد على RPCs قائمة (مُحافِظ على السلوك الافتراضي 100%):
--   كانت check_session_timeout / auto_close_stale_sessions تقرآن حدّاً مكتوباً
--   (3600 ثانية). الآن تقرآن inactivity_timeout_minutes من workday_settings
--   والافتراضي 60 دقيقة = نفس السلوك تماماً. لا يتغير شيء ما لم تغيِّر الإدارة
--   القيمة عبر set_executive_policy (إجراء مُدقَّق ومُسجَّل).
--
-- مكونات هذا الجزء:
--   1. صلاحية جديدة attendance.executive + منحها للإدارة العليا فقط
--      (الشاشة للإدارة العليا حصراً — لا تُمنح لمشرف تنفيذي)
--   2. workday_settings.inactivity_timeout_minutes (افتراضي 60) + جدول تدقيق
--   3. تعديل المُطبِّقَين لقراءة الإعداد (افتراضي 60 دقيقة = سلوك مطابق)
-- ============================================================================

-- ============================================================================
-- 1. صلاحية جديدة: attendance.executive
-- ============================================================================

INSERT INTO public.capabilities (code, name, description, "group")
VALUES
  ('attendance.executive', 'شاشة الحضور والمتابعة', 'الاطلاع على شاشة الحضور والمتابعة التنفيذية وتقاريرها الكاملة', 'attendance')
ON CONFLICT (code) DO NOTHING;

DO $grant$
DECLARE
  v_cap uuid;
BEGIN
  SELECT id INTO v_cap FROM public.capabilities WHERE code = 'attendance.executive';
  IF v_cap IS NULL THEN RETURN; END IF;

  INSERT INTO public.employee_capabilities (employee_id, capability_id, grant_type, assigned_by)
  SELECT DISTINCT er.employee_id, v_cap, 'grant'::public.grant_type, er.employee_id
  FROM public.employee_roles er
  JOIN public.roles r ON r.id = er.role_id
  WHERE r.name = 'الإدارة العليا'
  ON CONFLICT (employee_id, capability_id) DO NOTHING;

  -- تسوية أثر الإصدارات السابقة (إن وُجدت): سحب الصلاحية من كل موظف ليس
  -- من الإدارة العليا (مثال: حملة قديمة لمشرف تنفيذي عبر تعميم سابق).
  DELETE FROM public.employee_capabilities ec
  USING public.capabilities c
  WHERE c.code = 'attendance.executive' AND ec.capability_id = c.id
    AND NOT EXISTS (
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = ec.employee_id AND r.name = 'الإدارة العليا'
    );
END
$grant$;

-- ============================================================================
-- 2. إعداد مهلة الإغلاق التلقائي (قابل للتهيئة، افتراضي 60 دقيقة بدون تغيير)
--    + جدول تدقيق لكل تغيير (من/إلى/بواسطة/متى/سبب)
-- ============================================================================

ALTER TABLE public.workday_settings
ADD COLUMN IF NOT EXISTS inactivity_timeout_minutes integer NOT NULL DEFAULT 60
  CHECK (inactivity_timeout_minutes BETWEEN 5 AND 1440);

COMMENT ON COLUMN public.workday_settings.inactivity_timeout_minutes IS
  'مهلة عدم النشاط قبل الإغلاق التلقائي ليوم العمل بالدقائق (افتراضي 60). أي تغيير عبر set_executive_policy يُسجَّل في executive_policy_changes.';

CREATE TABLE IF NOT EXISTS public.executive_policy_changes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_key text NOT NULL DEFAULT 'inactivity_timeout_minutes',
    old_value integer,
    new_value integer NOT NULL,
    changed_by uuid NOT NULL,
    reason text,
    changed_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_epc_changed_by'
      AND conrelid = 'public.executive_policy_changes'::regclass
  ) THEN
    ALTER TABLE public.executive_policy_changes ADD CONSTRAINT fk_epc_changed_by
      FOREIGN KEY (changed_by) REFERENCES public.employees (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_epc_changed_at
    ON public.executive_policy_changes (changed_at DESC);

COMMENT ON TABLE public.executive_policy_changes IS
  'سجل تدقيق تغييرات إعدادات شاشة الحضور والمتابعة (القيمة القديمة/الجديدة/مَن/متى/السبب).';

-- ============================================================================
-- 3. تعديل المُطبِّقَين لقراءة الإعداد بدلاً من الرقم الثابت (افتراضي مطابق)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_close_stale_sessions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_closed int := 0;
    v_warned int := 0;
    v_ws record;
    v_inactive_seconds numeric;
    v_last_activity timestamptz;
    v_timeout_seconds numeric;
    v_is_midnight boolean;
BEGIN
    v_is_midnight := EXTRACT(HOUR FROM now()) = 0 AND EXTRACT(MINUTE FROM now()) <= 5;
    SELECT COALESCE(inactivity_timeout_minutes, 60)::numeric * 60 INTO v_timeout_seconds
    FROM public.workday_settings LIMIT 1;

    FOR v_ws IN
        SELECT * FROM public.workday_sessions
        WHERE status IN ('active', 'inactive_warning')
    LOOP
        SELECT COALESCE(
            v_ws.last_seen_at,
            (SELECT MAX(recorded_at) FROM public.tracking_points WHERE session_id = v_ws.id),
            v_ws.start_time
        ) INTO v_last_activity;

        v_inactive_seconds := EXTRACT(EPOCH FROM (now() - v_last_activity));

        IF v_is_midnight AND v_ws.date < CURRENT_DATE THEN
            UPDATE public.workday_sessions
            SET end_time = COALESCE(v_ws.last_seen_at, now()),
                status = 'completed',
                close_reason = 'day_rollover',
                attendance_status = 'auto_closed',
                updated_at = now()
            WHERE id = v_ws.id;
            v_closed := v_closed + 1;

        ELSIF v_inactive_seconds >= v_timeout_seconds THEN
            UPDATE public.workday_sessions
            SET end_time = COALESCE(v_ws.last_seen_at, now()),
                status = 'completed',
                close_reason = 'auto_closed_inactivity',
                attendance_status = 'auto_closed',
                updated_at = now()
            WHERE id = v_ws.id;
            v_closed := v_closed + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('closed', v_closed, 'warned', v_warned);
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_session_timeout(
    p_token uuid,
    p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_ws record;
    v_inactive_seconds numeric;
    v_last_activity timestamptz;
    v_timeout_seconds numeric;
    v_timeout_minutes integer;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_ws FROM public.workday_sessions
    WHERE id = p_session_id AND employee_id = v_employee_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;

    IF v_ws.status = 'completed' THEN
        RETURN jsonb_build_object('action', 'completed');
    END IF;

    SELECT COALESCE(inactivity_timeout_minutes, 60)::int INTO v_timeout_minutes
    FROM public.workday_settings LIMIT 1;
    v_timeout_seconds := v_timeout_minutes::numeric * 60;

    -- Case 1: Midnight rollover (00:00–00:05)
    IF v_ws.status IN ('active', 'inactive_warning') AND v_ws.date < CURRENT_DATE
       AND EXTRACT(HOUR FROM now()) = 0 AND EXTRACT(MINUTE FROM now()) <= 5 THEN
        PERFORM public.end_workday(p_token, p_session_id,
            p_latitude => v_ws.end_latitude,
            p_longitude => v_ws.end_longitude,
            p_close_reason => 'day_rollover'
        );
        RETURN jsonb_build_object(
            'action', 'auto_closed',
            'reason', 'day_rollover',
            'message', 'تم إنهاء يوم العمل تلقائياً لانتهاء اليوم وعدم تسجيل خروج.'
        );
    END IF;

    -- آخر نشاط مؤهِّل (مصدر الحقيقة): last_seen_at (لا تحدِّثه النبضات)
    -- أو آخر نقطة تتبع، أو بداية يوم العمل كاحتياط أخير.
    SELECT COALESCE(
        v_ws.last_seen_at,
        (SELECT MAX(recorded_at) FROM public.tracking_points WHERE session_id = p_session_id),
        v_ws.start_time
    ) INTO v_last_activity;

    v_inactive_seconds := EXTRACT(EPOCH FROM (now() - v_last_activity));

    -- Case 2: inactive_warning — مهلة سماح 5 دقائق (حالة قديمة)
    IF v_ws.status = 'inactive_warning' THEN
        IF v_inactive_seconds < 300 THEN
            UPDATE public.workday_sessions
            SET status = 'active', warning_cleared_at = now(), updated_at = now()
            WHERE id = p_session_id;
            RETURN jsonb_build_object(
                'action', 'warning_cleared',
                'message', 'تم تسجيل نشاط جديد. تم إلغاء تحذير الخمول.'
            );
        END IF;

        PERFORM public.end_workday(p_token, p_session_id,
            p_latitude => v_ws.end_latitude,
            p_longitude => v_ws.end_longitude,
            p_close_reason => 'auto_closed_inactivity'
        );
        RETURN jsonb_build_object(
            'action', 'auto_closed',
            'reason', 'auto_closed_inactivity',
            'message', 'تم إنهاء يوم العمل تلقائياً لعدم وجود نشاط منذ ' || v_timeout_minutes || ' دقيقة.'
        );
    END IF;

    -- Case 3: نشط + تجاوز المهلة → إغلاق تلقائي مباشر
    IF v_ws.status = 'active' AND v_inactive_seconds >= v_timeout_seconds THEN
        PERFORM public.end_workday(p_token, p_session_id,
            p_latitude => v_ws.end_latitude,
            p_longitude => v_ws.end_longitude,
            p_close_reason => 'auto_closed_inactivity'
        );
        RETURN jsonb_build_object(
            'action', 'auto_closed',
            'reason', 'auto_closed_inactivity',
            'message', 'تم إنهاء يوم العمل تلقائياً لعدم وجود نشاط منذ ' || v_timeout_minutes || ' دقيقة.'
        );
    END IF;

    RETURN jsonb_build_object(
        'action', 'ok',
        'inactive_minutes', (v_inactive_seconds / 60)::int,
        'timeout_minutes', v_timeout_minutes
    );
END;
$function$;