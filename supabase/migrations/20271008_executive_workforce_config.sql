-- ============================================================================
-- شاشة الحضور والمتابعة — الجزء 8: إعداد القوى العاملة (Workforce Configuration)
--   يضيف على نظام التحكم (الجزء 6/7):
--     1) نطاق شاشة صريح لكل موظف: show_in_screen (نعم/لا) — استبعاد من القائمة
--        والمؤشرات والتقارير وسجل القوى العاملة، دون مساس بأي طبقة قديمة ولا
--        بتفعيل الموظف (نطاق عرض فقط على مستوى شاشة الإدارة العليا).
--     2) نوع العمل الصريح: مكتبي = الدوام الثابت (fixed) / ميداني = المرن
--        (flexible). العمل الفعَّال هو مسند العرض: الميداني لا يُصنَّف أبداً
--        تأخير/انصراف مبكر مهما كانت مفاتيح الحساب مفعّلة (نوع العمل أبعد من
--        المفردات — موثّق للتسوية الرسمية).
--     3) بداية/نهاية الدوام الرسمية لكل موظف (توقيت القاهرة) بترتيب الأولوية:
--        تجاوز فردي ← افتراضي الدور ← عمل اليوم (workday_settings).
--     4) قسم إدارة القوى العاملة في الإعدادات + مرشّحات القائمة
--        (الكل / مكتبي / ميداني / مشمول / غير مشمول).
--   القاعدة: لا تُغيَّر نطاقات قاعدة البيانات الزمنية ولا نظام الحضور القديم
--   ولا employee_work_policies ولا workday_settings (بيانات قابلة للتعديل).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) توسعة جداول نظام التحكم بضوابط إعداد القوى العاملة
-- ---------------------------------------------------------------------------
ALTER TABLE public.executive_role_default_policy
    ADD COLUMN IF NOT EXISTS show_in_screen boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS official_start_time time,
    ADD COLUMN IF NOT EXISTS official_end_time time;

ALTER TABLE public.executive_employee_schedule_override
    ADD COLUMN IF NOT EXISTS show_in_screen boolean,
    ADD COLUMN IF NOT EXISTS official_start_time time,
    ADD COLUMN IF NOT EXISTS official_end_time time;

COMMENT ON COLUMN public.executive_role_default_policy.show_in_screen IS
    'الظهور الافتراضي في شاشة الحضور والمتابعة (نعم/لا) على مستوى الدور. نطاق عرض فقط — لا يفعّل/يلغي الموظف.';
COMMENT ON COLUMN public.executive_role_default_policy.official_start_time IS
    'بداية الدوام الرسمية (توقيت القاهرة) الافتراضية للدور. NULL = قيمة نظام العمل.';
COMMENT ON COLUMN public.executive_role_default_policy.official_end_time IS
    'نهاية الدوام الرسمية (توقيت القاهرة) الافتراضية للدور. NULL = قيمة نظام العمل.';
COMMENT ON COLUMN public.executive_employee_schedule_override.show_in_screen IS
    'الظهور في الشاشة كتجاوز فردي. NULL = وراثة افتراضي الدور. نطاق عرض فقط.';
COMMENT ON COLUMN public.executive_employee_schedule_override.official_start_time IS
    'بداية الدوام الرسمية الفردية (توقيت القاهرة). NULL = وراثة افتراضي الدور.';
COMMENT ON COLUMN public.executive_employee_schedule_override.official_end_time IS
    'نهاية الدوام الرسمية الفردية (توقيت القاهرة). NULL = وراثة افتراضي الدور.';

-- ---------------------------------------------------------------------------
-- 1b) الإدارة العليا حاكمة لا خاضعة (القاعدة الكنسية):
--   سكان القوى العاملة = الموظفون − (الإدارة العليا + الرئيس التنفيذي) − المشرف
--   التنفيذي − المستبعدون بوضوح.
--   إزالة أي افتراضيات أدوار متبقية لتلك الأدوار، والتوكيد أن أفرادها لا يظهرون
--   ولا يُضافون في أي مكان من شاشة الحضور والمتابعة.
--   ملاحظة: لا يُعدَّل public.is_upper_management() هنا (يغيّر صلاحيات النظام
--   كافة). نعتمد تصنيفاً محلياً للشاشة يطابق خريطة الدور الكنسية في الواجهة
--   (roleNormalization: الإدارة العليا/الرئيس التنفيذي/executive_director ←
--   إدارة عليا، مشرف تنفيذي ← مشرف عام ≠ إدارة عليا).
-- ---------------------------------------------------------------------------
DELETE FROM public.executive_role_default_policy
WHERE role_id IN (
    SELECT r.id FROM public.roles r
    WHERE r.name IN ('الإدارة العليا', 'الرئيس التنفيذي', 'executive_director', 'مشرف تنفيذي')
);

-- تصنيف موظف بالنسبة لشاشة الحضور والمتابعة فقط (لا يمس أي طبقة أخرى):
--   'management'  = إدارة عليا (يملك الشاشة: وصول/تحكم/مراقبة)
--   'supervisor'  = مشرف تنفيذي (خارج الشاشة تماماً)
--   'workforce'   = مرشح للقوى العاملة (يُحتسب عند إشراكه صراحةً)
CREATE OR REPLACE FUNCTION public.executive_followup_classification(p_employee_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN EXISTS (
            SELECT 1 FROM public.employee_roles er
            JOIN public.roles r ON r.id = er.role_id
            WHERE er.employee_id = p_employee_id
              AND r.name IN ('الإدارة العليا', 'الرئيس التنفيذي', 'executive_director')
        ) THEN 'management'
        WHEN EXISTS (
            SELECT 1 FROM public.employee_roles er
            JOIN public.roles r ON r.id = er.role_id
            WHERE er.employee_id = p_employee_id
              AND r.name = 'مشرف تنفيذي'
        ) THEN 'supervisor'
        ELSE 'workforce'
    END;
$$;

COMMENT ON FUNCTION public.executive_followup_classification(uuid) IS
    'تصنيف موظف لشاشة الحضور والمتابعة حصراً: management = الإدارة العليا (حاكمة لا خاضعة)، supervisor = مشرف تنفيذي (خارج الشاشة)، workforce = داخل نطاق القوى العاملة المحتمل. لا يغيّر is_upper_management ولا الأدوار.';

-- وصول الشاشة: الإدارة العليا فقط (نفس مسند requireUpperManagement في الواجهة).
CREATE OR REPLACE FUNCTION public.executive_followup_can_access(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT public.executive_followup_classification(p_employee_id) = 'management';
$$;

COMMENT ON FUNCTION public.executive_followup_can_access(uuid) IS
    'يسمح الوصول لشاشة الحضور والمتابعة للإدارة العليا فقط (بدون المشرف التنفيذي)، مطابقاً لمسند الواجهة requireUpperManagement.';

-- ---------------------------------------------------------------------------
-- 2) السياسة الفعّالة بمعايير إعداد القوى العاملة + فرض نوع العمل على التأخير/المبكر
--    (الميداني = مرن لا يُصنَّف تأخير/مبكر؛ المكتبي = ثابت يُحسب عند الفعل)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_executive_effective_policy(p_employee_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_build_object(
        'attendance_enabled',         COALESCE(o.attendance_enabled, r.attendance_enabled, true),
        'follow_up_enabled',          COALESCE(o.follow_up_enabled, r.follow_up_enabled, false),
        'schedule_type',              COALESCE(o.schedule_type, r.schedule_type, 'flexible'),
        'late_calculation_enabled',   CASE WHEN COALESCE(o.schedule_type, r.schedule_type, 'flexible') = 'fixed'
                                           THEN COALESCE(o.late_calculation_enabled, r.late_calculation_enabled, true)
                                           ELSE false END,
        'early_calculation_enabled',  CASE WHEN COALESCE(o.schedule_type, r.schedule_type, 'flexible') = 'fixed'
                                           THEN COALESCE(o.early_calculation_enabled, r.early_calculation_enabled, true)
                                           ELSE false END,
        'show_in_screen',             COALESCE(o.show_in_screen, r.show_in_screen, true),
        'official_start_time',        COALESCE(
            o.official_start_time, r.official_start_time,
            (SELECT ds.official_start_time FROM public.workday_settings ds LIMIT 1))::text,
        'official_end_time',          COALESCE(
            o.official_end_time, r.official_end_time,
            (SELECT ds.official_end_time FROM public.workday_settings ds LIMIT 1))::text,
        'source', CASE
                      WHEN o.employee_id IS NOT NULL THEN 'employee_override'
                      WHEN r.role_id IS NOT NULL THEN 'role_default'
                      ELSE 'system_default'
                  END
    )
    FROM public.employees e
    LEFT JOIN public.executive_employee_schedule_override o ON o.employee_id = e.id
    LEFT JOIN public.executive_role_default_policy r
           ON r.role_id = (SELECT er.role_id FROM public.employee_roles er
                           WHERE er.employee_id = e.id ORDER BY er.assigned_at ASC, er.id ASC LIMIT 1)
    WHERE e.id = p_employee_id;
$$;

COMMENT ON FUNCTION public.get_executive_effective_policy(uuid) IS
    'السياسة الفعّالة = تجاوز فردي ∪ افتراضي الدور ∪ نظامي. نوع العمل أبعد من مفاتيح الحساب: الميداني (flexible) لا يُصنَّف تأخير/مبكر أبداً.';

-- ---------------------------------------------------------------------------
-- 3) قراءة إعداد القوى العاملة (الإعدادات): افتراضيات الدور + الفعّال + التدقيق
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_executive_control_policy(
    p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
SET timezone TO 'Africa/Cairo'
AS $fn$
DECLARE
    v_session app.sessions;
    v_visible uuid[];
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    -- وصول الشاشة: الإدارة العليا فقط (تشمل الرئيس التنفيذي بحسب خريطة الأدوار الكنسية، دون المشرف التنفيذي)
    IF NOT public.executive_followup_can_access(v_session.employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_visible := public.get_visible_employee_ids(v_session.token::text);
    IF v_visible IS NULL OR array_length(v_visible, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_VISIBLE_EMPLOYEES');
    END IF;

    RETURN (
        WITH rd AS (
            SELECT r.id AS role_id, r.name AS role_name,
                   d.attendance_enabled, d.follow_up_enabled, d.schedule_type,
                   d.late_calculation_enabled, d.early_calculation_enabled,
                   d.show_in_screen, d.official_start_time, d.official_end_time,
                   (SELECT COUNT(*)::int FROM public.employees e
                    WHERE public.get_executive_effective_policy(e.id) IS NOT NULL
                      AND (SELECT er.role_id FROM public.employee_roles er
                           WHERE er.employee_id = e.id ORDER BY er.assigned_at ASC, er.id ASC LIMIT 1) = r.id
                      AND COALESCE(NULLIF(e.full_name, ''), e.code) IS NOT NULL) AS employee_count
            FROM public.roles r
            LEFT JOIN public.executive_role_default_policy d ON d.role_id = r.id
            WHERE r.name NOT IN ('الإدارة العليا', 'الرئيس التنفيذي', 'executive_director', 'مشرف تنفيذي') -- حاكمة لا خاضعة: خارج إعدادات القوى العاملة
            ORDER BY CASE WHEN r.name IN ('مندوب مبيعات', 'مدير البيع', 'موظف مبيعات') THEN 0 ELSE 1 END, r.name
        ),
        emp AS (
            SELECT e.id AS employee_id, e.code, COALESCE(NULLIF(e.full_name, ''), e.code) AS name,
                   COALESCE((SELECT r.name FROM public.employee_roles er2
                             JOIN public.roles r ON r.id = er2.role_id
                             WHERE er2.employee_id = e.id ORDER BY er2.assigned_at ASC, er2.id ASC LIMIT 1), '') AS role_name,
                   CASE WHEN o.employee_id IS NOT NULL THEN jsonb_build_object(
                       'attendance_enabled', o.attendance_enabled,
                       'follow_up_enabled', o.follow_up_enabled,
                       'schedule_type', o.schedule_type,
                       'late_calculation_enabled', o.late_calculation_enabled,
                       'early_calculation_enabled', o.early_calculation_enabled,
                       'show_in_screen', o.show_in_screen,
                       'official_start_time', o.official_start_time::text,
                       'official_end_time', o.official_end_time::text
                   ) ELSE NULL END AS override,
                   o.updated_at AS override_changed_at,
                   public.get_executive_effective_policy(e.id) AS effective
            FROM public.employees e
            LEFT JOIN public.executive_employee_schedule_override o ON o.employee_id = e.id
            WHERE e.id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce' -- الإدارة العليا/المشرف التنفيذي خارج القوى العاملة
        )
        SELECT jsonb_build_object(
            'error', NULL,
            'stats', jsonb_build_object(
                'roles_with_default', (SELECT COUNT(*)::int FROM public.executive_role_default_policy),
                'employee_overrides', (SELECT COUNT(*)::int FROM public.executive_employee_schedule_override),
                'shown_total', (SELECT COUNT(*)::int FROM emp WHERE (emp.effective->>'show_in_screen')::boolean),
                'hidden_total', (SELECT COUNT(*)::int FROM emp WHERE NOT (emp.effective->>'show_in_screen')::boolean),
                'attendance_monitored', (SELECT COUNT(*)::int FROM emp WHERE (emp.effective->>'attendance_enabled')::boolean AND (emp.effective->>'show_in_screen')::boolean),
                'follow_up_monitored', (SELECT COUNT(*)::int FROM emp WHERE (emp.effective->>'follow_up_enabled')::boolean AND (emp.effective->>'show_in_screen')::boolean),
                'flexible', (SELECT COUNT(*)::int FROM emp WHERE emp.effective->>'schedule_type' = 'flexible' AND (emp.effective->>'show_in_screen')::boolean),
                'fixed', (SELECT COUNT(*)::int FROM emp WHERE emp.effective->>'schedule_type' = 'fixed' AND (emp.effective->>'show_in_screen')::boolean)
            ),
            'role_defaults', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'role_id', role_id, 'role_name', role_name,
                    'attendance_enabled', attendance_enabled, 'follow_up_enabled', follow_up_enabled,
                    'schedule_type', schedule_type,
                    'late_calculation_enabled', late_calculation_enabled,
                    'early_calculation_enabled', early_calculation_enabled,
                    'show_in_screen', show_in_screen,
                    'official_start_time', official_start_time::text,
                    'official_end_time', official_end_time::text,
                    'employee_count', employee_count
                ) ORDER BY CASE WHEN role_name IN ('مندوب مبيعات', 'مدير البيع', 'موظف مبيعات') THEN 0 ELSE 1 END, role_name)
                FROM rd
            ), '[]'::jsonb),
            'employees', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'employee_id', employee_id, 'code', code, 'name', name, 'role_name', role_name,
                    'override', override,
                    'attendance_enabled', (effective->>'attendance_enabled')::boolean,
                    'follow_up_enabled', (effective->>'follow_up_enabled')::boolean,
                    'schedule_type', effective->>'schedule_type',
                    'work_type', effective->>'schedule_type',
                    'late_calculation_enabled', (effective->>'late_calculation_enabled')::boolean,
                    'early_calculation_enabled', (effective->>'early_calculation_enabled')::boolean,
                    'show_in_screen', (effective->>'show_in_screen')::boolean,
                    'official_start_time', effective->>'official_start_time',
                    'official_end_time', effective->>'official_end_time',
                    'last_changed_at', override_changed_at,
                    'source', effective->>'source'
                ) ORDER BY name, code)
                FROM emp
            ), '[]'::jsonb),
            'audit', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id', c.id, 'entity_type', c.entity_type, 'entity_id', c.entity_id,
                    'entity_label', COALESCE(
                        (SELECT COALESCE(NULLIF(e.full_name, ''), e.code) FROM public.employees e WHERE e.id = c.entity_id),
                        (SELECT r.name FROM public.roles r WHERE r.id = c.entity_id),
                        ''),
                    'policy_key', c.policy_key, 'old_value', c.old_value, 'new_value', c.new_value,
                    'reason', c.reason, 'changed_at', c.changed_at,
                    'changed_by_name', (SELECT COALESCE(NULLIF(e.full_name, ''), e.code) FROM public.employees e WHERE e.id = c.changed_by)
                ) ORDER BY c.changed_at DESC)
                FROM (SELECT * FROM public.executive_control_changes c ORDER BY c.changed_at DESC LIMIT 200) c
            ), '[]'::jsonb)
        ) LIMIT 1
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_control_policy TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) تعديل افتراضي الدور (مع تدقيق لكل ضابط تغيّر، بضوابط إعداد القوى العاملة)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_executive_role_default(uuid, uuid, boolean, boolean, text, boolean, boolean, text);

CREATE OR REPLACE FUNCTION public.set_executive_role_default(
    p_token uuid,
    p_role_id uuid,
    p_attendance_enabled boolean,
    p_follow_up_enabled boolean,
    p_schedule_type text,
    p_late_calculation_enabled boolean,
    p_early_calculation_enabled boolean,
    p_show_in_screen boolean DEFAULT true,
    p_official_start_time time DEFAULT NULL,
    p_official_end_time time DEFAULT NULL,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
SET timezone TO 'Africa/Cairo'
AS $fn$
DECLARE
    v_session app.sessions;
    v_old public.executive_role_default_policy;
    v_role_name text;
    v_wds_start time;
    v_wds_end time;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.executive_followup_can_access(v_session.employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF p_schedule_type NOT IN ('fixed', 'flexible') THEN
        RETURN jsonb_build_object('error', 'INVALID_SCHEDULE_TYPE', 'message', 'نوع الدوام يجب أن يكون fixed أو flexible.');
    END IF;

    SELECT r.name INTO v_role_name FROM public.roles r WHERE r.id = p_role_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ROLE_NOT_FOUND'); END IF;

    -- الإدارة العليا حاكمة لا خاضعة: خارج نطاق القوى العاملة نهائياً
    IF v_role_name IN ('الإدارة العليا', 'الرئيس التنفيذي', 'executive_director', 'مشرف تنفيذي') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN', 'message', 'الإدارة العليا/المشرف التنفيذي خارج نطاق القوى العاملة ولا يُعدَّلان من إعدادها.');
    END IF;

    SELECT * INTO v_old FROM public.executive_role_default_policy WHERE role_id = p_role_id;
    SELECT COALESCE(official_start_time, '09:00'::time), COALESCE(official_end_time, '17:00'::time)
    INTO v_wds_start, v_wds_end
    FROM public.workday_settings LIMIT 1;

    INSERT INTO public.executive_role_default_policy AS t
        (role_id, attendance_enabled, follow_up_enabled, schedule_type, late_calculation_enabled, early_calculation_enabled,
         show_in_screen, official_start_time, official_end_time, updated_by, updated_at)
    VALUES
        (p_role_id, p_attendance_enabled, p_follow_up_enabled, p_schedule_type, p_late_calculation_enabled, p_early_calculation_enabled,
         p_show_in_screen, p_official_start_time, p_official_end_time, v_session.employee_id, now())
    ON CONFLICT (role_id) DO UPDATE SET
        attendance_enabled = EXCLUDED.attendance_enabled,
        follow_up_enabled = EXCLUDED.follow_up_enabled,
        schedule_type = EXCLUDED.schedule_type,
        late_calculation_enabled = EXCLUDED.late_calculation_enabled,
        early_calculation_enabled = EXCLUDED.early_calculation_enabled,
        show_in_screen = EXCLUDED.show_in_screen,
        official_start_time = EXCLUDED.official_start_time,
        official_end_time = EXCLUDED.official_end_time,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

    -- تدقيق لكل ضابط تغيّر (القيمة القديمة = الافتراضي السابق)
    IF v_old.attendance_enabled IS DISTINCT FROM p_attendance_enabled THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('role', p_role_id, 'attendance_enabled', COALESCE(v_old.attendance_enabled, true)::text, p_attendance_enabled::text, v_session.employee_id, COALESCE(p_reason, 'تعديل افتراضي الدور - ' || v_role_name));
    END IF;
    IF v_old.follow_up_enabled IS DISTINCT FROM p_follow_up_enabled THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('role', p_role_id, 'follow_up_enabled', COALESCE(v_old.follow_up_enabled, false)::text, p_follow_up_enabled::text, v_session.employee_id, COALESCE(p_reason, 'تعديل افتراضي الدور - ' || v_role_name));
    END IF;
    IF COALESCE(v_old.schedule_type, 'fixed') IS DISTINCT FROM p_schedule_type THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('role', p_role_id, 'schedule_type', COALESCE(v_old.schedule_type, 'fixed'), p_schedule_type, v_session.employee_id, COALESCE(p_reason, 'تعديل افتراضي الدور - ' || v_role_name));
    END IF;
    IF v_old.late_calculation_enabled IS DISTINCT FROM p_late_calculation_enabled THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('role', p_role_id, 'late_calculation_enabled', COALESCE(v_old.late_calculation_enabled, true)::text, p_late_calculation_enabled::text, v_session.employee_id, COALESCE(p_reason, 'تعديل افتراضي الدور - ' || v_role_name));
    END IF;
    IF v_old.early_calculation_enabled IS DISTINCT FROM p_early_calculation_enabled THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('role', p_role_id, 'early_calculation_enabled', COALESCE(v_old.early_calculation_enabled, true)::text, p_early_calculation_enabled::text, v_session.employee_id, COALESCE(p_reason, 'تعديل افتراضي الدور - ' || v_role_name));
    END IF;
    IF COALESCE(v_old.show_in_screen, true) IS DISTINCT FROM p_show_in_screen THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('role', p_role_id, 'show_in_screen', COALESCE(v_old.show_in_screen, true)::text, p_show_in_screen::text, v_session.employee_id, COALESCE(p_reason, 'إعداد القوى العاملة - ' || v_role_name));
    END IF;
    IF COALESCE(v_old.official_start_time, v_wds_start) IS DISTINCT FROM COALESCE(p_official_start_time, v_wds_start) THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('role', p_role_id, 'official_start_time', COALESCE(v_old.official_start_time, v_wds_start)::text, COALESCE(p_official_start_time, v_wds_start)::text, v_session.employee_id, COALESCE(p_reason, 'إعداد القوى العاملة - ' || v_role_name));
    END IF;
    IF COALESCE(v_old.official_end_time, v_wds_end) IS DISTINCT FROM COALESCE(p_official_end_time, v_wds_end) THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('role', p_role_id, 'official_end_time', COALESCE(v_old.official_end_time, v_wds_end)::text, COALESCE(p_official_end_time, v_wds_end)::text, v_session.employee_id, COALESCE(p_reason, 'إعداد القوى العاملة - ' || v_role_name));
    END IF;

    RETURN jsonb_build_object(
        'error', NULL,
        'role_id', p_role_id, 'role_name', v_role_name,
        'changed_at', now(), 'changed_by', v_session.employee_id,
        'audit_rows', (SELECT COUNT(*)::int FROM public.executive_control_changes
                       WHERE entity_type = 'role' AND entity_id = p_role_id
                         AND changed_at >= now() - interval '1 minute')
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.set_executive_role_default TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) تعديل/مسح تجاوز فردي (مع تدقيق على الفعّال قبل التغيير، بضوابط القوى العاملة)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_executive_employee_override(uuid, uuid, boolean, boolean, text, boolean, boolean, boolean, text);

CREATE OR REPLACE FUNCTION public.set_executive_employee_override(
    p_token uuid,
    p_employee_id uuid,
    p_attendance_enabled boolean,
    p_follow_up_enabled boolean,
    p_schedule_type text,
    p_late_calculation_enabled boolean,
    p_early_calculation_enabled boolean,
    p_show_in_screen boolean DEFAULT true,
    p_official_start_time time DEFAULT NULL,
    p_official_end_time time DEFAULT NULL,
    p_clear_override boolean DEFAULT false,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
SET timezone TO 'Africa/Cairo'
AS $fn$
DECLARE
    v_session app.sessions;
    v_visible uuid[];
    v_before jsonb;
    v_emp_name text;
    v_audit_rows int := 0;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT public.executive_followup_can_access(v_session.employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF p_schedule_type NOT IN ('fixed', 'flexible') THEN
        RETURN jsonb_build_object('error', 'INVALID_SCHEDULE_TYPE', 'message', 'نوع الدوام يجب أن يكون fixed أو flexible.');
    END IF;

    v_visible := public.get_visible_employee_ids(v_session.token::text);
    IF v_visible IS NULL OR array_length(v_visible, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_VISIBLE_EMPLOYEES');
    END IF;
    IF NOT (p_employee_id = ANY(v_visible)) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    -- الإدارة العليا/المشرف التنفيذي حاكمة لا خاضعة: لا تُضاف للقوى العاملة إطلاقاً
    IF public.executive_followup_classification(p_employee_id) <> 'workforce' THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN', 'message', 'الإدارة العليا والرئيس التنفيذي والمشرف التنفيذي خارج نطاق القوى العاملة ولا تُضاف من إعدادها.');
    END IF;

    SELECT COALESCE(NULLIF(e.full_name, ''), e.code) INTO v_emp_name FROM public.employees e WHERE e.id = p_employee_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'EMPLOYEE_NOT_FOUND'); END IF;

    v_before := public.get_executive_effective_policy(p_employee_id);

    IF p_clear_override THEN
        DELETE FROM public.executive_employee_schedule_override WHERE employee_id = p_employee_id;
        IF (v_before->>'source') = 'employee_override' THEN
            INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
            SELECT 'employee', p_employee_id, k, v, NULL, v_session.employee_id, COALESCE(p_reason, 'مسح التجاوز الفردي - ' || v_emp_name)
            FROM jsonb_each_text(jsonb_build_object(
                'attendance_enabled', v_before->>'attendance_enabled',
                'follow_up_enabled', v_before->>'follow_up_enabled',
                'schedule_type', v_before->>'schedule_type',
                'late_calculation_enabled', v_before->>'late_calculation_enabled',
                'early_calculation_enabled', v_before->>'early_calculation_enabled',
                'show_in_screen', v_before->>'show_in_screen',
                'official_start_time', v_before->>'official_start_time',
                'official_end_time', v_before->>'official_end_time'
            )) AS kv(k, v);
            GET DIAGNOSTICS v_audit_rows = ROW_COUNT;
        END IF;
        RETURN jsonb_build_object(
            'error', NULL, 'employee_id', p_employee_id, 'employee_name', v_emp_name,
            'cleared', true, 'changed_at', now(), 'changed_by', v_session.employee_id,
            'audit_rows', v_audit_rows
        );
    END IF;

    INSERT INTO public.executive_employee_schedule_override AS t
        (employee_id, attendance_enabled, follow_up_enabled, schedule_type, late_calculation_enabled, early_calculation_enabled,
         show_in_screen, official_start_time, official_end_time, updated_by, updated_at)
    VALUES
        (p_employee_id, p_attendance_enabled, p_follow_up_enabled, p_schedule_type, p_late_calculation_enabled, p_early_calculation_enabled,
         p_show_in_screen, p_official_start_time, p_official_end_time, v_session.employee_id, now())
    ON CONFLICT (employee_id) DO UPDATE SET
        attendance_enabled = EXCLUDED.attendance_enabled,
        follow_up_enabled = EXCLUDED.follow_up_enabled,
        schedule_type = EXCLUDED.schedule_type,
        late_calculation_enabled = EXCLUDED.late_calculation_enabled,
        early_calculation_enabled = EXCLUDED.early_calculation_enabled,
        show_in_screen = EXCLUDED.show_in_screen,
        official_start_time = EXCLUDED.official_start_time,
        official_end_time = EXCLUDED.official_end_time,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

    -- تدقيق فقط للضوابط التي تغيّرت فعلّياً (القيمة القديمة = الفعّال قبل التغيير)
    IF (v_before->>'attendance_enabled')::boolean IS DISTINCT FROM p_attendance_enabled THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('employee', p_employee_id, 'attendance_enabled', v_before->>'attendance_enabled', p_attendance_enabled::text, v_session.employee_id, COALESCE(p_reason, 'تجاوز فردي - ' || v_emp_name));
        v_audit_rows := v_audit_rows + 1;
    END IF;
    IF (v_before->>'follow_up_enabled')::boolean IS DISTINCT FROM p_follow_up_enabled THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('employee', p_employee_id, 'follow_up_enabled', v_before->>'follow_up_enabled', p_follow_up_enabled::text, v_session.employee_id, COALESCE(p_reason, 'تجاوز فردي - ' || v_emp_name));
        v_audit_rows := v_audit_rows + 1;
    END IF;
    IF v_before->>'schedule_type' IS DISTINCT FROM p_schedule_type THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('employee', p_employee_id, 'schedule_type', v_before->>'schedule_type', p_schedule_type, v_session.employee_id, COALESCE(p_reason, 'تجاوز فردي - ' || v_emp_name));
        v_audit_rows := v_audit_rows + 1;
    END IF;
    IF (v_before->>'late_calculation_enabled')::boolean IS DISTINCT FROM p_late_calculation_enabled THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('employee', p_employee_id, 'late_calculation_enabled', v_before->>'late_calculation_enabled', p_late_calculation_enabled::text, v_session.employee_id, COALESCE(p_reason, 'تجاوز فردي - ' || v_emp_name));
        v_audit_rows := v_audit_rows + 1;
    END IF;
    IF (v_before->>'early_calculation_enabled')::boolean IS DISTINCT FROM p_early_calculation_enabled THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('employee', p_employee_id, 'early_calculation_enabled', v_before->>'early_calculation_enabled', p_early_calculation_enabled::text, v_session.employee_id, COALESCE(p_reason, 'تجاوز فردي - ' || v_emp_name));
        v_audit_rows := v_audit_rows + 1;
    END IF;
    IF (v_before->>'show_in_screen')::boolean IS DISTINCT FROM p_show_in_screen THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('employee', p_employee_id, 'show_in_screen', v_before->>'show_in_screen', p_show_in_screen::text, v_session.employee_id, COALESCE(p_reason, 'إعداد القوى العاملة - ' || v_emp_name));
        v_audit_rows := v_audit_rows + 1;
    END IF;
    IF v_before->>'official_start_time' IS DISTINCT FROM p_official_start_time::text THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('employee', p_employee_id, 'official_start_time', v_before->>'official_start_time', p_official_start_time::text, v_session.employee_id, COALESCE(p_reason, 'إعداد القوى العاملة - ' || v_emp_name));
        v_audit_rows := v_audit_rows + 1;
    END IF;
    IF v_before->>'official_end_time' IS DISTINCT FROM p_official_end_time::text THEN
        INSERT INTO public.executive_control_changes (entity_type, entity_id, policy_key, old_value, new_value, changed_by, reason)
        VALUES ('employee', p_employee_id, 'official_end_time', v_before->>'official_end_time', p_official_end_time::text, v_session.employee_id, COALESCE(p_reason, 'إعداد القوى العاملة - ' || v_emp_name));
        v_audit_rows := v_audit_rows + 1;
    END IF;

    RETURN jsonb_build_object(
        'error', NULL, 'employee_id', p_employee_id, 'employee_name', v_emp_name,
        'cleared', false, 'changed_at', now(), 'changed_by', v_session.employee_id,
        'audit_rows', v_audit_rows
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.set_executive_employee_override TO authenticated;

-- ============================================================================
-- 6) get_executive_followup_list — القائمة + مرشّحات إعداد القوى العاملة
--    مرشّحات جديدة: p_work_type (''|maktabi|midani) و p_shown (''|included|excluded)
--    النطاق: القائمة تشمل القوى العاملة فقط (دون الإدارة العليا) ودون المستبعدين
--    (تظل رؤية المستبعد متاحة من تبويب إعداد القوى العاملة، وليس من قائمة العرض).
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_executive_followup_list(uuid, date, date, boolean, text, text, text, integer, integer, text);

CREATE OR REPLACE FUNCTION public.get_executive_followup_list(
    p_token uuid,
    p_from date DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date,
    p_to date DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date,
    p_include_inactive boolean DEFAULT true,
    p_search text DEFAULT NULL,
    p_connection text DEFAULT NULL,
    p_attendance text DEFAULT NULL,
    p_page integer DEFAULT 0,
    p_page_size integer DEFAULT 100,
    p_sort text DEFAULT 'name',
    p_work_type text DEFAULT NULL,
    p_shown text DEFAULT 'included'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
SET timezone TO 'Africa/Cairo'
AS $fn$
DECLARE
    v_session app.sessions;
    v_visible uuid[];
    v_include_live boolean;
    v_timeout_minutes integer;
    v_interval_seconds numeric;
    v_off_start text;
    v_off_end text;
    v_sort text;
    v_page_size int;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    -- وصول الشاشة: الإدارة العليا فقط (تشمل الرئيس التنفيذي، دون المشرف التنفيذي)
    IF NOT public.executive_followup_can_access(v_session.employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_visible := public.get_visible_employee_ids(v_session.token::text);
    IF v_visible IS NULL OR array_length(v_visible, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_VISIBLE_EMPLOYEES');
    END IF;

    IF p_work_type IS NOT NULL AND p_work_type NOT IN ('', 'maktabi', 'midani') THEN
        RETURN jsonb_build_object('error', 'INVALID_WORK_TYPE', 'message', 'نوع العمل يجب أن يكون maktabi أو midani.');
    END IF;
    IF p_shown IS NOT NULL AND p_shown NOT IN ('', 'included', 'excluded') THEN
        RETURN jsonb_build_object('error', 'INVALID_SHOWN', 'message', 'المرشح يجب أن يكون included أو excluded.');
    END IF;

    v_include_live := (p_from <= CURRENT_DATE AND p_to >= CURRENT_DATE);

    SELECT COALESCE(inactivity_timeout_minutes, 60)::int INTO v_timeout_minutes
    FROM public.workday_settings LIMIT 1;
    SELECT COALESCE(location_interval_seconds, 300)::numeric INTO v_interval_seconds
    FROM public.workday_settings LIMIT 1;
    SELECT COALESCE(official_start_time::text, '09:00') INTO v_off_start FROM public.workday_settings LIMIT 1;
    SELECT COALESCE(official_end_time::text, '17:00') INTO v_off_end FROM public.workday_settings LIMIT 1;

    v_sort := COALESCE(NULLIF(p_sort, ''), 'name');
    v_page_size := LEAST(GREATEST(COALESCE(p_page_size, 100), 1), 500);

    RETURN (
        WITH ve AS (
            SELECT e.id AS employee_id, e.code, COALESCE(NULLIF(e.full_name, ''), e.code) AS full_name,
                   COALESCE((SELECT r.name FROM public.employee_roles er2
                             JOIN public.roles r ON r.id = er2.role_id
                             WHERE er2.employee_id = e.id LIMIT 1), '') AS role_name,
                   e.is_active, e.manager_id,
                   ewp.work_location, ewp.required_daily_hours,
                   ewp.shift_start_time, ewp.shift_end_time
            FROM public.employees e
            LEFT JOIN public.employee_work_policies ewp ON ewp.employee_id = e.id
            WHERE e.id = ANY(v_visible)
              AND (p_include_inactive OR e.is_active)
              AND public.executive_followup_classification(e.id) = 'workforce'
        ),
        pol AS (
            SELECT e.id AS employee_id,
                   COALESCE(o.attendance_enabled, r.attendance_enabled, true) AS attendance_enabled,
                   COALESCE(o.follow_up_enabled, r.follow_up_enabled, false) AS follow_up_enabled,
                   COALESCE(o.schedule_type, r.schedule_type, 'flexible') AS schedule_type,
                   CASE WHEN COALESCE(o.schedule_type, r.schedule_type, 'flexible') = 'fixed'
                        THEN COALESCE(o.late_calculation_enabled, r.late_calculation_enabled, true) ELSE false END AS late_calculation_enabled,
                   CASE WHEN COALESCE(o.schedule_type, r.schedule_type, 'flexible') = 'fixed'
                        THEN COALESCE(o.early_calculation_enabled, r.early_calculation_enabled, true) ELSE false END AS early_calculation_enabled,
                   COALESCE(o.show_in_screen, r.show_in_screen, true) AS show_in_screen,
                   COALESCE(o.official_start_time, r.official_start_time,
                            (SELECT ds.official_start_time FROM public.workday_settings ds LIMIT 1)) AS official_start_time,
                   COALESCE(o.official_end_time, r.official_end_time,
                            (SELECT ds.official_end_time FROM public.workday_settings ds LIMIT 1)) AS official_end_time,
                   CASE WHEN o.employee_id IS NOT NULL THEN 'employee_override'
                        WHEN r.role_id IS NOT NULL THEN 'role_default'
                        ELSE 'system_default' END AS source
            FROM public.employees e
            LEFT JOIN public.executive_employee_schedule_override o ON o.employee_id = e.id
            LEFT JOIN public.executive_role_default_policy r
                   ON r.role_id = (SELECT er.role_id FROM public.employee_roles er
                                   WHERE er.employee_id = e.id ORDER BY er.assigned_at ASC, er.id ASC LIMIT 1)
            WHERE e.id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
        ),
        ss AS (
            SELECT wds.id AS session_id, wds.employee_id, wds.date, wds.start_time, wds.end_time,
                   wds.status, wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
                   wds.close_reason, wds.visit_count, COALESCE(wds.total_distance_meters, 0) AS distance_meters,
                   wds.start_latitude, wds.start_longitude, wds.end_latitude, wds.end_longitude,
                   wds.last_seen_at
            FROM public.workday_sessions wds
            JOIN public.employees e ON e.id = wds.employee_id
            WHERE wds.employee_id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
              AND wds.date >= p_from AND wds.date <= p_to
        ),
        br AS (
            SELECT wb.session_id,
                   COUNT(*)::int AS break_count,
                   COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0) AS break_seconds,
                   COUNT(*) FILTER (WHERE wb.break_end IS NULL)::int AS active_break_count
            FROM public.workday_breaks wb
            JOIN public.workday_sessions w2 ON w2.id = wb.session_id
            JOIN public.employees e ON e.id = w2.employee_id
            WHERE w2.employee_id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
              AND w2.date >= p_from AND w2.date <= p_to
            GROUP BY wb.session_id
        ),
        od AS (
            SELECT public.resolve_employee_id(o.owner_id) AS eid,
                   COUNT(*)::int AS order_count,
                   COALESCE(SUM(o.total_amount), 0) AS sales_value
            FROM public.orders o
            WHERE o.status NOT IN ('draft', 'cancelled')
              AND o.created_at::date >= p_from AND o.created_at::date <= p_to
              AND public.resolve_employee_id(o.owner_id) = ANY(v_visible)
              AND public.executive_followup_classification(public.resolve_employee_id(o.owner_id)) = 'workforce'
            GROUP BY public.resolve_employee_id(o.owner_id)
        ),
        cd AS (
            SELECT public.resolve_employee_id(c.owner_id) AS eid,
                   COUNT(*)::int AS collection_count,
                   COALESCE(SUM(c.amount), 0) AS collection_amount
            FROM public.collections c
            WHERE c.created_at::date >= p_from AND c.created_at::date <= p_to
              AND public.resolve_employee_id(c.owner_id) = ANY(v_visible)
              AND public.executive_followup_classification(public.resolve_employee_id(c.owner_id)) = 'workforce'
            GROUP BY public.resolve_employee_id(c.owner_id)
        ),
        nd AS (
            SELECT public.resolve_employee_id(c2.owner_id) AS eid, COUNT(*)::int AS new_customer_count
            FROM public.customers c2
            WHERE c2.created_at::date >= p_from AND c2.created_at::date <= p_to
              AND public.resolve_employee_id(c2.owner_id) = ANY(v_visible)
              AND public.executive_followup_classification(public.resolve_employee_id(c2.owner_id)) = 'workforce'
            GROUP BY public.resolve_employee_id(c2.owner_id)
        ),
        vs AS (
            SELECT v.employee_id,
                   COUNT(*)::int AS visit_count,
                   COUNT(*) FILTER (WHERE v.status = 'active' AND v.check_out_at IS NULL)::int AS open_visit_count,
                   MAX(v.check_in_at) AS last_visit_at
            FROM public.visits v
            JOIN public.employees e ON e.id = v.employee_id
            WHERE v.employee_id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
              AND v.check_in_at::date >= p_from AND v.check_in_at::date <= p_to
            GROUP BY v.employee_id
        ),
        live_sessions AS (
            SELECT DISTINCT ON (wds.employee_id)
                wds.id AS session_id, wds.employee_id, wds.start_time, wds.end_time, wds.status,
                wds.attendance_status, wds.late_minutes, wds.early_departure_minutes, wds.close_reason,
                wds.last_seen_at, COALESCE(wds.total_distance_meters, 0) AS distance_meters
            FROM public.workday_sessions wds
            JOIN public.employees e ON e.id = wds.employee_id
            WHERE wds.employee_id = ANY(v_visible) AND wds.date = CURRENT_DATE
              AND public.executive_followup_classification(e.id) = 'workforce'
            ORDER BY wds.employee_id, wds.start_time DESC NULLS LAST
        ),
        today_breaks AS (
            SELECT wb.session_id,
                   COUNT(*) FILTER (WHERE wb.break_end IS NULL)::int AS active_break_count,
                   COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0) AS live_break_seconds
            FROM public.workday_breaks wb
            JOIN live_sessions l ON l.session_id = wb.session_id
            GROUP BY wb.session_id
        ),
        last_activity AS (
            SELECT DISTINCT ON (employee_id)
                employee_id, activity_at AS last_activity_at, activity_type AS last_activity_type
            FROM (
                SELECT l.employee_id, l.last_seen_at AS activity_at, 'heartbeat' AS activity_type
                FROM live_sessions l WHERE l.last_seen_at IS NOT NULL
                UNION ALL
                SELECT tp.employee_id, tp.recorded_at, 'gps'
                FROM public.tracking_points tp
                JOIN public.employees e ON e.id = tp.employee_id
                WHERE tp.employee_id = ANY(v_visible) AND tp.recorded_at > now() - interval '24 hours'
                  AND public.executive_followup_classification(e.id) = 'workforce'
                UNION ALL
                SELECT v.employee_id, v.check_in_at, 'visit'
                FROM public.visits v
                JOIN public.employees e ON e.id = v.employee_id
                WHERE v.employee_id = ANY(v_visible) AND v.check_in_at > now() - interval '24 hours'
                  AND public.executive_followup_classification(e.id) = 'workforce'
                UNION ALL
                SELECT public.resolve_employee_id(o.owner_id), o.created_at, 'order'
                FROM public.orders o
                WHERE public.resolve_employee_id(o.owner_id) = ANY(v_visible)
                  AND public.executive_followup_classification(public.resolve_employee_id(o.owner_id)) = 'workforce'
                  AND o.created_at > now() - interval '24 hours'
                UNION ALL
                SELECT public.resolve_employee_id(c.owner_id), c.created_at, 'collection'
                FROM public.collections c
                WHERE public.resolve_employee_id(c.owner_id) = ANY(v_visible)
                  AND public.executive_followup_classification(public.resolve_employee_id(c.owner_id)) = 'workforce'
                  AND c.created_at > now() - interval '24 hours'
            ) ca
            ORDER BY employee_id, activity_at DESC NULLS LAST
        ),
        last_loc AS (
            SELECT DISTINCT ON (tp.employee_id)
                tp.employee_id, tp.latitude, tp.longitude, tp.recorded_at AS at
            FROM public.tracking_points tp
            JOIN public.employees e ON e.id = tp.employee_id
            WHERE tp.employee_id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
              AND tp.recorded_at > now() - interval '30 days'
            ORDER BY tp.employee_id, tp.recorded_at DESC
        ),
        staff AS (
            SELECT
                ve.employee_id, ve.code, ve.full_name, ve.role_name, ve.is_active, ve.manager_id,
                ve.work_location, ve.required_daily_hours,
                ve.shift_start_time, ve.shift_end_time,
                p.attendance_enabled, p.follow_up_enabled, p.schedule_type,
                p.late_calculation_enabled, p.early_calculation_enabled, p.source AS policy_source,
                p.show_in_screen, p.official_start_time, p.official_end_time,
                COUNT(DISTINCT ss.date)::int AS worked_days,
                COALESCE(SUM(
                    CASE WHEN ss.date IS NULL THEN 0
                         WHEN COALESCE(p.schedule_type, 'fixed') = 'fixed'
                         THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(ss.end_time, now()) - ss.start_time)) / 60
                                       - COALESCE(br.break_seconds, 0)::numeric / 60, 0)
                         ELSE EXTRACT(EPOCH FROM (COALESCE(ss.end_time, now()) - ss.start_time)) / 60
                    END
                ), 0)::int AS present_minutes,
                COALESCE(SUM(COALESCE(br.break_count, 0)), 0)::int AS break_count,
                COALESCE(SUM(COALESCE(br.break_seconds, 0)), 0)::int AS break_seconds,
                COUNT(DISTINCT ss.date) FILTER (WHERE COALESCE(p.schedule_type, 'fixed') = 'fixed'
                    AND COALESCE(p.late_calculation_enabled, false) AND ss.attendance_status = 'late')::int AS late_days,
                COALESCE(SUM(CASE WHEN COALESCE(p.schedule_type, 'fixed') = 'fixed' AND COALESCE(p.late_calculation_enabled, false)
                             THEN COALESCE(ss.late_minutes, 0) ELSE 0 END), 0)::int AS late_minutes_total,
                COUNT(DISTINCT ss.date) FILTER (WHERE COALESCE(p.schedule_type, 'fixed') = 'fixed'
                    AND COALESCE(p.early_calculation_enabled, false)
                    AND (ss.attendance_status = 'early_departure' OR ss.early_departure_minutes > 0))::int AS early_days,
                COALESCE(SUM(CASE WHEN COALESCE(p.schedule_type, 'fixed') = 'fixed' AND COALESCE(p.early_calculation_enabled, false)
                             THEN COALESCE(ss.early_departure_minutes, 0) ELSE 0 END), 0)::int AS early_minutes_total,
                COUNT(DISTINCT ss.date) FILTER (WHERE ss.close_reason IN ('auto_closed_inactivity', 'no_activity_timeout'))::int AS auto_closed_days,
                COALESCE(SUM(ss.distance_meters), 0)::numeric AS distance_meters,
                COALESCE(od.order_count, 0)::int AS order_count,
                COALESCE(od.sales_value, 0)::numeric AS sales_value,
                COALESCE(cd.collection_count, 0)::int AS collection_count,
                COALESCE(cd.collection_amount, 0)::numeric AS collection_amount,
                COALESCE(nd.new_customer_count, 0)::int AS new_customer_count,
                COALESCE(vs.visit_count, 0)::int AS visit_count,
                COALESCE(vs.open_visit_count, 0)::int AS open_visit_count,
                MIN(ss.start_time) AS first_activity_at,
                MAX(COALESCE(ss.end_time, ss.last_seen_at, ss.start_time)) AS last_activity_at,
                ls.session_id AS live_session_id, ls.start_time AS live_start_time, ls.end_time AS live_end_time,
                ls.status AS live_session_status, ls.attendance_status AS live_attendance_status,
                ls.late_minutes AS live_late_minutes, ls.early_departure_minutes AS live_early_minutes,
                ls.close_reason AS live_close_reason, ls.last_seen_at AS live_last_seen_at,
                ls.distance_meters AS live_distance_meters,
                COALESCE(tb.active_break_count, 0) AS active_break_count_now,
                COALESCE(tb.live_break_seconds, 0) AS live_break_seconds,
                la.last_activity_at AS last_event_at, la.last_activity_type,
                CASE
                    WHEN la.last_activity_at IS NULL THEN 'no_data'
                    WHEN la.last_activity_at > now() - (v_interval_seconds::text || ' seconds')::interval THEN 'connected'
                    WHEN la.last_activity_at > now() - ((v_interval_seconds * 5)::text || ' seconds')::interval THEN 'delayed'
                    ELSE 'lost'
                END AS connection_status,
                ll.latitude, ll.longitude, ll.at AS last_loc_at
            FROM ve
            LEFT JOIN pol p ON p.employee_id = ve.employee_id
            LEFT JOIN ss ON ss.employee_id = ve.employee_id
            LEFT JOIN br ON br.session_id = ss.session_id
            LEFT JOIN od ON od.eid = ve.employee_id
            LEFT JOIN cd ON cd.eid = ve.employee_id
            LEFT JOIN nd ON nd.eid = ve.employee_id
            LEFT JOIN vs ON vs.employee_id = ve.employee_id
            LEFT JOIN live_sessions ls ON ls.employee_id = ve.employee_id
            LEFT JOIN today_breaks tb ON tb.session_id = ls.session_id
            LEFT JOIN last_activity la ON la.employee_id = ve.employee_id
            LEFT JOIN last_loc ll ON ll.employee_id = ve.employee_id
            GROUP BY ve.employee_id, ve.code, ve.full_name, ve.role_name, ve.is_active, ve.manager_id,
                     ve.work_location, ve.required_daily_hours,
                     ve.shift_start_time, ve.shift_end_time,
                     p.attendance_enabled, p.follow_up_enabled, p.schedule_type,
                     p.late_calculation_enabled, p.early_calculation_enabled, p.source,
                     p.show_in_screen, p.official_start_time, p.official_end_time,
                     ls.session_id, ls.start_time, ls.end_time, ls.status,
                     ls.attendance_status, ls.late_minutes, ls.early_departure_minutes,
                     ls.close_reason, ls.last_seen_at, ls.distance_meters,
                     tb.active_break_count, tb.live_break_seconds, la.last_activity_at, la.last_activity_type,
                     ll.latitude, ll.longitude, ll.at,
                     od.order_count, od.sales_value,
                     cd.collection_count, cd.collection_amount,
                     nd.new_customer_count,
                     vs.visit_count, vs.open_visit_count
        ),
        live_status AS (
            SELECT s.employee_id,
                   CASE
                       WHEN NOT v_include_live THEN NULL
                       WHEN s.live_session_id IS NULL THEN 'no_start'
                       WHEN s.live_session_status = 'completed' THEN
                           CASE WHEN COALESCE(s.live_close_reason, '') IN ('auto_closed_inactivity', 'no_activity_timeout', 'day_rollover')
                                THEN 'auto_closed' ELSE 'ended' END
                       WHEN s.open_visit_count > 0 THEN 'on_visit'
                       WHEN s.active_break_count_now > 0 THEN 'on_break'
                       ELSE 'working'
                   END AS status,
                   CASE WHEN s.live_session_id IS NOT NULL
                        THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(s.live_end_time, now()) - s.live_start_time)) / 60, 0)::int
                        ELSE NULL END AS elapsed_minutes,
                   CASE WHEN s.live_session_id IS NOT NULL
                        THEN CASE WHEN COALESCE(s.schedule_type, 'fixed') = 'fixed'
                                  THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(s.live_end_time, now()) - s.live_start_time)) / 60
                                                - COALESCE(s.live_break_seconds, 0)::numeric / 60, 0)::int
                                  ELSE EXTRACT(EPOCH FROM (COALESCE(s.live_end_time, now()) - s.live_start_time)) / 60::int
                             END
                        ELSE NULL END AS live_net_minutes
           FROM staff s
        ),
        filtered AS (
            SELECT st.*, lv.status AS disp_status, lv.elapsed_minutes, lv.live_net_minutes
            FROM staff st
            LEFT JOIN live_status lv ON lv.employee_id = st.employee_id
            WHERE (p_search IS NULL OR p_search = ''
                   OR st.full_name ILIKE '%' || p_search || '%'
                   OR st.code ILIKE '%' || p_search || '%')
              AND (p_connection IS NULL OR p_connection = ''
                   OR st.connection_status = p_connection)
              AND (p_shown IS NULL OR p_shown = ''
                   OR (p_shown = 'included' AND st.show_in_screen)
                   OR (p_shown = 'excluded' AND NOT st.show_in_screen))
              AND (p_work_type IS NULL OR p_work_type = ''
                   OR (p_work_type = 'maktabi' AND st.schedule_type = 'fixed')
                   OR (p_work_type = 'midani' AND st.schedule_type = 'flexible'))
              AND (
                   p_attendance IS NULL OR p_attendance = ''
                   OR (v_include_live AND lv.status = p_attendance)
                   OR (v_include_live AND p_attendance = 'late' AND COALESCE(st.schedule_type, 'fixed') = 'fixed'
                       AND COALESCE(st.late_calculation_enabled, false) AND st.live_attendance_status = 'late')
                   OR (v_include_live AND p_attendance = 'early' AND COALESCE(st.schedule_type, 'fixed') = 'fixed'
                       AND COALESCE(st.early_calculation_enabled, false)
                       AND (st.live_attendance_status = 'early_departure' OR st.live_early_minutes > 0))
                   OR (NOT v_include_live AND p_attendance = 'late'
                       AND COALESCE(st.schedule_type, 'fixed') = 'fixed' AND COALESCE(st.late_calculation_enabled, false)
                       AND st.late_days > 0)
                   OR (NOT v_include_live AND p_attendance = 'early'
                       AND COALESCE(st.schedule_type, 'fixed') = 'fixed' AND COALESCE(st.early_calculation_enabled, false)
                       AND st.early_days > 0)
                   OR (NOT v_include_live AND p_attendance = 'auto_closed' AND st.auto_closed_days > 0)
                   OR (NOT v_include_live AND p_attendance = 'absent' AND st.is_active AND st.worked_days = 0)
              )
        )
        SELECT jsonb_build_object(
            'error', NULL,
            'live_mode', v_include_live,
            'total', (SELECT COUNT(*)::int FROM filtered),
            'period', jsonb_build_object('from', p_from, 'to', p_to),
            'policy', jsonb_build_object(
                'inactivity_timeout_minutes', v_timeout_minutes,
                'location_interval_seconds', v_interval_seconds
            ),
            'employees', COALESCE((
                SELECT jsonb_agg(pj.row_json) FROM (
                    SELECT jsonb_build_object(
                        'employee_id', f.employee_id, 'code', f.code, 'name', f.full_name,
                        'role_name', f.role_name, 'is_active', f.is_active, 'manager_id', f.manager_id,
                        'work_location', f.work_location, 'required_daily_hours', f.required_daily_hours,
                        'official_start_time', f.official_start_time::text,
                        'official_end_time', f.official_end_time::text,
                        'policy', jsonb_build_object(
                            'attendance_enabled', f.attendance_enabled,
                            'follow_up_enabled', f.follow_up_enabled,
                            'schedule_type', f.schedule_type,
                            'work_type', f.schedule_type,
                            'show_in_screen', f.show_in_screen,
                            'late_calculation_enabled', f.late_calculation_enabled,
                            'early_calculation_enabled', f.early_calculation_enabled,
                            'official_start_time', f.official_start_time::text,
                            'official_end_time', f.official_end_time::text,
                            'source', f.policy_source
                        ),
                        'period', jsonb_build_object(
                            'worked_days', f.worked_days, 'present_minutes', f.present_minutes,
                            'break_count', f.break_count, 'break_minutes', (f.break_seconds / 60)::int,
                            'late_days', f.late_days, 'late_minutes_total', f.late_minutes_total,
                            'early_days', f.early_days, 'early_minutes_total', f.early_minutes_total,
                            'auto_closed_days', f.auto_closed_days,
                            'orders', f.order_count, 'sales', f.sales_value,
                            'visits', f.visit_count, 'collections', f.collection_count,
                            'collection_amount', f.collection_amount,
                            'new_customers', f.new_customer_count,
                            'distance_meters', ROUND(f.distance_meters, 1)
                        ),
                        'first_activity_at', f.first_activity_at,
                        'last_activity_at', f.last_activity_at,
                        'connection_status', f.connection_status,
                        'last_activity_at', f.last_event_at,
                        'last_activity_type', f.last_activity_type,
                        'live', CASE WHEN v_include_live THEN jsonb_build_object(
                            'session_id', f.live_session_id,
                            'status', f.disp_status,
                            'attendance_status', CASE WHEN COALESCE(f.schedule_type, 'fixed') = 'fixed'
                                THEN f.live_attendance_status ELSE NULL END,
                            'late_minutes', CASE WHEN COALESCE(f.schedule_type, 'fixed') = 'fixed' AND COALESCE(f.late_calculation_enabled, false)
                                THEN f.live_late_minutes ELSE NULL END,
                            'early_departure_minutes', CASE WHEN COALESCE(f.schedule_type, 'fixed') = 'fixed' AND COALESCE(f.early_calculation_enabled, false)
                                THEN f.live_early_minutes ELSE NULL END,
                            'close_reason', f.live_close_reason,
                            'start_time', f.live_start_time, 'end_time', f.live_end_time,
                            'elapsed_minutes', f.elapsed_minutes,
                            'net_minutes', f.live_net_minutes,
                            'on_visit', f.open_visit_count > 0,
                            'on_break', f.active_break_count_now > 0,
                            'active_break_count', f.active_break_count_now,
                            'last_seen_at', f.live_last_seen_at,
                            'distance_meters', ROUND(f.live_distance_meters, 1),
                            'progress_pct', CASE WHEN COALESCE(f.required_daily_hours, 8) > 0 AND f.live_net_minutes IS NOT NULL THEN
                                LEAST(ROUND((f.live_net_minutes / (COALESCE(f.required_daily_hours, 8) * 60)) * 100)::numeric, 999) ELSE NULL END,
                            'last_location', jsonb_build_object(
                                'latitude', CASE WHEN COALESCE(f.follow_up_enabled, false) THEN f.latitude ELSE NULL END,
                                'longitude', CASE WHEN COALESCE(f.follow_up_enabled, false) THEN f.longitude ELSE NULL END,
                                'at', CASE WHEN COALESCE(f.follow_up_enabled, false) THEN f.last_loc_at ELSE NULL END,
                                'source', CASE WHEN COALESCE(f.follow_up_enabled, false) AND f.latitude IS NOT NULL THEN 'tracking' ELSE 'none' END,
                                'has_location', COALESCE(f.follow_up_enabled, false) AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL,
                                'enabled', COALESCE(f.follow_up_enabled, false),
                                'freshness', CASE
                                    WHEN NOT COALESCE(f.follow_up_enabled, false) OR f.last_loc_at IS NULL THEN 'none'
                                    WHEN f.last_loc_at > now() - (v_interval_seconds::text || ' seconds')::interval THEN 'live'
                                    WHEN f.last_loc_at > now() - ((v_interval_seconds * 5)::text || ' seconds')::interval THEN 'fresh'
                                    ELSE 'stale'
                                END,
                                'age_seconds', CASE WHEN COALESCE(f.follow_up_enabled, false) AND f.last_loc_at IS NOT NULL
                                    THEN EXTRACT(EPOCH FROM (now() - f.last_loc_at))::int ELSE NULL END
                            ),
                            'last_event', jsonb_build_object(
                                'type', f.last_activity_type, 'at', f.last_event_at,
                                'has_event', f.last_event_at IS NOT NULL
                            )
                        ) ELSE NULL END
                    ) AS row_json
                    FROM filtered f
                    ORDER BY
                        CASE v_sort WHEN 'name' THEN f.full_name END ASC NULLS LAST,
                        CASE v_sort WHEN 'sales' THEN f.sales_value END DESC NULLS LAST,
                        CASE v_sort WHEN 'present' THEN f.present_minutes END DESC NULLS LAST,
                        CASE v_sort WHEN 'days' THEN f.worked_days END DESC NULLS LAST,
                        CASE v_sort WHEN 'connection' THEN
                            (CASE f.connection_status WHEN 'lost' THEN 0 WHEN 'delayed' THEN 1 WHEN 'connected' THEN 2 ELSE 3 END)
                        END ASC NULLS LAST
                    LIMIT v_page_size OFFSET (GREATEST(p_page, 0) * v_page_size)
                ) pj
            ), '[]'::jsonb)
        ) LIMIT 1
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_followup_list TO authenticated;

-- ============================================================================
-- 7) get_executive_overview_kpis — مؤشرات القوى العاملة (المشمولون فقط،
--    دون الإدارة العليا/المشرف التنفيذي، ودون المستبعدين)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_executive_overview_kpis(
    p_token uuid,
    p_from date DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date,
    p_to date DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date,
    p_include_inactive boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
SET timezone TO 'Africa/Cairo'
AS $fn$
DECLARE
    v_session app.sessions;
    v_visible uuid[];
    v_include_live boolean;
    v_interval_seconds numeric;
    v_timeout_minutes integer;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    -- وصول الشاشة: الإدارة العليا فقط
    IF NOT public.executive_followup_can_access(v_session.employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_visible := public.get_visible_employee_ids(v_session.token::text);
    IF v_visible IS NULL OR array_length(v_visible, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_VISIBLE_EMPLOYEES');
    END IF;

    v_include_live := (p_from <= CURRENT_DATE AND p_to >= CURRENT_DATE);
    SELECT COALESCE(location_interval_seconds, 300)::numeric INTO v_interval_seconds
    FROM public.workday_settings LIMIT 1;
    SELECT COALESCE(inactivity_timeout_minutes, 60)::int INTO v_timeout_minutes
    FROM public.workday_settings LIMIT 1;

    RETURN (
        WITH ve AS (
            SELECT e.id AS employee_id, e.code, COALESCE(NULLIF(e.full_name, ''), e.code) AS full_name,
                   e.is_active,
                   COALESCE((public.get_executive_effective_policy(e.id)->>'show_in_screen')::boolean, true) AS show_in_screen
            FROM public.employees e
            WHERE e.id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
              AND (p_include_inactive OR e.is_active)
        ),
        pol AS (
            SELECT e.id AS employee_id,
                   COALESCE(o.attendance_enabled, r.attendance_enabled, true) AS attendance_enabled,
                   COALESCE(o.follow_up_enabled, r.follow_up_enabled, false) AS follow_up_enabled,
                   COALESCE(o.schedule_type, r.schedule_type, 'flexible') AS schedule_type,
                   CASE WHEN COALESCE(o.schedule_type, r.schedule_type, 'flexible') = 'fixed'
                        THEN COALESCE(o.late_calculation_enabled, r.late_calculation_enabled, true) ELSE false END AS late_calculation_enabled,
                   CASE WHEN COALESCE(o.schedule_type, r.schedule_type, 'flexible') = 'fixed'
                        THEN COALESCE(o.early_calculation_enabled, r.early_calculation_enabled, true) ELSE false END AS early_calculation_enabled,
                   COALESCE(o.show_in_screen, r.show_in_screen, true) AS show_in_screen
            FROM public.employees e
            LEFT JOIN public.executive_employee_schedule_override o ON o.employee_id = e.id
            LEFT JOIN public.executive_role_default_policy r
                   ON r.role_id = (SELECT er.role_id FROM public.employee_roles er
                                   WHERE er.employee_id = e.id ORDER BY er.assigned_at ASC, er.id ASC LIMIT 1)
            WHERE e.id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
        ),
        ss AS (
            SELECT wds.id AS session_id, wds.employee_id, wds.date, wds.start_time, wds.end_time,
                   wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
                   wds.close_reason, wds.status
            FROM public.workday_sessions wds
            JOIN public.employees e ON e.id = wds.employee_id
            WHERE wds.employee_id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
              AND wds.date >= p_from AND wds.date <= p_to
        ),
        br AS (
            SELECT wb.session_id, COUNT(*)::int AS break_count,
                   COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0) AS break_seconds
            FROM public.workday_breaks wb
            JOIN public.workday_sessions w2 ON w2.id = wb.session_id
            JOIN public.employees e ON e.id = w2.employee_id
            WHERE w2.employee_id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
              AND w2.date >= p_from AND w2.date <= p_to
            GROUP BY wb.session_id
        ),
        od AS (
            SELECT public.resolve_employee_id(o.owner_id) AS eid,
                   COUNT(*)::int AS order_count,
                   COALESCE(SUM(o.total_amount), 0) AS sales_value
            FROM public.orders o
            WHERE o.status NOT IN ('draft', 'cancelled')
              AND o.created_at::date >= p_from AND o.created_at::date <= p_to
              AND public.resolve_employee_id(o.owner_id) = ANY(v_visible)
              AND public.executive_followup_classification(public.resolve_employee_id(o.owner_id)) = 'workforce'
            GROUP BY public.resolve_employee_id(o.owner_id)
        ),
        cd AS (
            SELECT public.resolve_employee_id(c.owner_id) AS eid,
                   COUNT(*)::int AS collection_count,
                   COALESCE(SUM(c.amount), 0) AS collection_amount
            FROM public.collections c
            WHERE c.created_at::date >= p_from AND c.created_at::date <= p_to
              AND public.resolve_employee_id(c.owner_id) = ANY(v_visible)
              AND public.executive_followup_classification(public.resolve_employee_id(c.owner_id)) = 'workforce'
            GROUP BY public.resolve_employee_id(c.owner_id)
        ),
        nd AS (
            SELECT public.resolve_employee_id(c2.owner_id) AS eid, COUNT(*)::int AS new_customer_count
            FROM public.customers c2
            WHERE c2.created_at::date >= p_from AND c2.created_at::date <= p_to
              AND public.resolve_employee_id(c2.owner_id) = ANY(v_visible)
              AND public.executive_followup_classification(public.resolve_employee_id(c2.owner_id)) = 'workforce'
            GROUP BY public.resolve_employee_id(c2.owner_id)
        ),
        vs AS (
            SELECT v.employee_id,
                   COUNT(*)::int AS visit_count,
                   COUNT(*) FILTER (WHERE v.status = 'active' AND v.check_out_at IS NULL)::int AS open_visit_count,
                   MAX(v.check_in_at) AS last_visit_at
            FROM public.visits v
            JOIN public.employees e ON e.id = v.employee_id
            WHERE v.employee_id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
              AND v.check_in_at::date >= p_from AND v.check_in_at::date <= p_to
            GROUP BY v.employee_id
        ),
        live_sessions AS (
            SELECT DISTINCT ON (wds.employee_id)
                wds.id AS session_id, wds.employee_id, wds.start_time, wds.end_time, wds.status,
                wds.attendance_status, wds.late_minutes, wds.early_departure_minutes, wds.close_reason,
                wds.last_seen_at, COALESCE(wds.total_distance_meters, 0) AS distance_meters
            FROM public.workday_sessions wds
            JOIN public.employees e ON e.id = wds.employee_id
            WHERE wds.employee_id = ANY(v_visible) AND wds.date = CURRENT_DATE
              AND public.executive_followup_classification(e.id) = 'workforce'
            ORDER BY wds.employee_id, wds.start_time DESC NULLS LAST
        ),
        today_breaks AS (
            SELECT wb.session_id,
                   COUNT(*) FILTER (WHERE wb.break_end IS NULL)::int AS active_break_count,
                   COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0) AS live_break_seconds
            FROM public.workday_breaks wb
            JOIN live_sessions l ON l.session_id = wb.session_id
            GROUP BY wb.session_id
        ),
        last_activity AS (
            SELECT DISTINCT ON (employee_id)
                employee_id, activity_at AS last_activity_at, activity_type AS last_activity_type
            FROM (
                SELECT l.employee_id, l.last_seen_at AS activity_at, 'heartbeat' AS activity_type
                FROM live_sessions l WHERE l.last_seen_at IS NOT NULL
                UNION ALL
                SELECT tp.employee_id, tp.recorded_at, 'gps'
                FROM public.tracking_points tp
                JOIN public.employees e ON e.id = tp.employee_id
                WHERE tp.employee_id = ANY(v_visible) AND tp.recorded_at > now() - interval '24 hours'
                  AND public.executive_followup_classification(e.id) = 'workforce'
                UNION ALL
                SELECT v.employee_id, v.check_in_at, 'visit'
                FROM public.visits v
                JOIN public.employees e ON e.id = v.employee_id
                WHERE v.employee_id = ANY(v_visible) AND v.check_in_at > now() - interval '24 hours'
                  AND public.executive_followup_classification(e.id) = 'workforce'
                UNION ALL
                SELECT public.resolve_employee_id(o.owner_id), o.created_at, 'order'
                FROM public.orders o
                WHERE public.resolve_employee_id(o.owner_id) = ANY(v_visible)
                  AND public.executive_followup_classification(public.resolve_employee_id(o.owner_id)) = 'workforce'
                  AND o.created_at > now() - interval '24 hours'
                UNION ALL
                SELECT public.resolve_employee_id(c.owner_id), c.created_at, 'collection'
                FROM public.collections c
                WHERE public.resolve_employee_id(c.owner_id) = ANY(v_visible)
                  AND public.executive_followup_classification(public.resolve_employee_id(c.owner_id)) = 'workforce'
                  AND c.created_at > now() - interval '24 hours'
            ) ca
            ORDER BY employee_id, activity_at DESC NULLS LAST
        ),
        staff AS (
            SELECT
                ve.employee_id, ve.code, ve.full_name, ve.is_active, ve.show_in_screen,
                p.attendance_enabled, p.follow_up_enabled, p.schedule_type,
                p.late_calculation_enabled, p.early_calculation_enabled,
                COUNT(DISTINCT ss.date)::int AS worked_days,
                COALESCE(SUM(
                    CASE WHEN ss.date IS NULL THEN 0
                         WHEN COALESCE(p.schedule_type, 'fixed') = 'fixed'
                         THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(ss.end_time, now()) - ss.start_time)) / 60
                                       - COALESCE(br.break_seconds, 0)::numeric / 60, 0)
                         ELSE EXTRACT(EPOCH FROM (COALESCE(ss.end_time, now()) - ss.start_time)) / 60
                    END
                ), 0)::int AS present_minutes,
                COUNT(DISTINCT ss.date) FILTER (WHERE COALESCE(p.schedule_type, 'fixed') = 'fixed'
                    AND COALESCE(p.late_calculation_enabled, false) AND ss.attendance_status = 'late')::int AS late_days,
                COALESCE(SUM(CASE WHEN COALESCE(p.schedule_type, 'fixed') = 'fixed' AND COALESCE(p.late_calculation_enabled, false)
                             THEN COALESCE(ss.late_minutes, 0) ELSE 0 END), 0)::int AS late_minutes_total,
                COUNT(DISTINCT ss.date) FILTER (WHERE COALESCE(p.schedule_type, 'fixed') = 'fixed'
                    AND COALESCE(p.early_calculation_enabled, false)
                    AND (ss.attendance_status = 'early_departure' OR ss.early_departure_minutes > 0))::int AS early_days,
                COUNT(DISTINCT ss.date) FILTER (WHERE ss.close_reason IN ('auto_closed_inactivity', 'no_activity_timeout'))::int AS auto_closed_days,
                COALESCE(SUM(br.break_count), 0)::int AS break_count,
                COALESCE(od.order_count, 0)::int AS order_count,
                COALESCE(od.sales_value, 0)::numeric AS sales_value,
                COALESCE(cd.collection_count, 0)::int AS collection_count,
                COALESCE(cd.collection_amount, 0)::numeric AS collection_amount,
                COALESCE(nd.new_customer_count, 0)::int AS new_customer_count,
                COALESCE(vs.visit_count, 0)::int AS visit_count,
                COALESCE(vs.open_visit_count, 0)::int AS open_visit_count,
                ls.session_id AS live_session_id, ls.status AS live_status,
                ls.attendance_status AS live_attendance_status, ls.close_reason AS live_close_reason,
                ls.end_time AS live_end_time, ls.start_time AS live_start_time,
                COALESCE(tb.active_break_count, 0) AS live_active_breaks,
                la.last_activity_at,
                CASE
                    WHEN la.last_activity_at IS NULL THEN 'no_data'
                    WHEN la.last_activity_at > now() - (v_interval_seconds::text || ' seconds')::interval THEN 'connected'
                    WHEN la.last_activity_at > now() - ((v_interval_seconds * 5)::text || ' seconds')::interval THEN 'delayed'
                    ELSE 'lost'
                END AS connection_status
            FROM ve
            LEFT JOIN pol p ON p.employee_id = ve.employee_id
            LEFT JOIN ss ON ss.employee_id = ve.employee_id
            LEFT JOIN br ON br.session_id = ss.session_id
            LEFT JOIN od ON od.eid = ve.employee_id
            LEFT JOIN cd ON cd.eid = ve.employee_id
            LEFT JOIN nd ON nd.eid = ve.employee_id
            LEFT JOIN vs ON vs.employee_id = ve.employee_id
            LEFT JOIN live_sessions ls ON ls.employee_id = ve.employee_id
            LEFT JOIN today_breaks tb ON tb.session_id = ls.session_id
            LEFT JOIN last_activity la ON la.employee_id = ve.employee_id
            GROUP BY ve.employee_id, ve.code, ve.full_name, ve.is_active, ve.show_in_screen,
                     p.attendance_enabled, p.follow_up_enabled, p.schedule_type,
                     p.late_calculation_enabled, p.early_calculation_enabled,
                     od.order_count, od.sales_value,
                     cd.collection_count, cd.collection_amount,
                     nd.new_customer_count, vs.visit_count, vs.open_visit_count,
                     ls.session_id, ls.status, ls.attendance_status, ls.close_reason,
                     ls.end_time, ls.start_time, tb.active_break_count,
                     la.last_activity_at
        ),
        scoped AS (SELECT * FROM staff WHERE show_in_screen),
        att_staff AS (SELECT * FROM scoped WHERE attendance_enabled),
        comp_staff AS (SELECT * FROM scoped WHERE attendance_enabled AND schedule_type = 'fixed'),
        att_present AS (SELECT * FROM att_staff WHERE worked_days > 0)
        SELECT jsonb_build_object(
            'error', NULL,
            'live_mode', v_include_live,
            'period', jsonb_build_object('from', p_from, 'to', p_to),
            'policy', jsonb_build_object(
                'inactivity_timeout_minutes', v_timeout_minutes,
                'location_interval_seconds', v_interval_seconds
            ),
            'control', jsonb_build_object(
                'shown_total', (SELECT COUNT(*)::int FROM scoped),
                'hidden_total', (SELECT COUNT(*)::int FROM staff WHERE NOT show_in_screen),
                'attendance_monitored', (SELECT COUNT(*)::int FROM att_staff),
                'follow_up_monitored', (SELECT COUNT(*)::int FROM scoped WHERE follow_up_enabled),
                'flexible', (SELECT COUNT(*)::int FROM scoped WHERE schedule_type = 'flexible'),
                'fixed', (SELECT COUNT(*)::int FROM scoped WHERE schedule_type = 'fixed')
            ),
            'definition_note', 'أقسام التحكم: الحضور للمشمولين ضمن نطاق الحضور، الالتزام للمكتبي (ثابت) فقط (تأخير/مبكر/غياب/إغلاق تلقائي)، الميداني (مرن) يُظهر ساعات العمل الفعلية ولا يُصنَّف تأخير/مبكر. الإدارة العليا والمشرف التنفيذي خارج القوى العاملة. مؤشر الأداء = صافي المبيعات لكل ساعة حضور فعلية.',
            'kpis', jsonb_build_object(
                'workforce', (SELECT COUNT(*)::int FROM scoped),
                'attendance_monitored', (SELECT COUNT(*)::int FROM att_staff),
                'follow_up_monitored', (SELECT COUNT(*)::int FROM scoped WHERE follow_up_enabled),
                'flexible_count', (SELECT COUNT(*)::int FROM scoped WHERE schedule_type = 'flexible'),
                'fixed_count', (SELECT COUNT(*)::int FROM scoped WHERE schedule_type = 'fixed'),
                'present_employees', (SELECT COUNT(*)::int FROM att_present),
                'not_started', (SELECT COUNT(*)::int FROM att_staff WHERE is_active AND worked_days = 0),
                'worked_days_total', (SELECT COALESCE(SUM(worked_days), 0)::int FROM att_staff),
                'presence_hours_total', ROUND((SELECT COALESCE(SUM(present_minutes), 0)::numeric FROM att_staff) / 60, 1),
                'avg_daily_presence_minutes', COALESCE(ROUND((SELECT AVG(present_minutes)::numeric FROM att_present), 0), 0)::int,
                'avg_worked_hours', ROUND(COALESCE((SELECT AVG(present_minutes::numeric / 60) FROM att_present), 0), 1),
                'sales_per_worked_hour', ROUND(
                    (SELECT COALESCE(SUM(sales_value), 0)::numeric FROM att_staff)
                    / NULLIF((SELECT COALESCE(SUM(present_minutes), 0)::numeric FROM att_staff) / 60, 0), 2),
                'late_days_total', (SELECT COALESCE(SUM(late_days), 0)::int FROM comp_staff),
                'late_minutes_total', (SELECT COALESCE(SUM(late_minutes_total), 0)::int FROM comp_staff),
                'early_days_total', (SELECT COALESCE(SUM(early_days), 0)::int FROM comp_staff),
                'absence_days', (SELECT COUNT(*)::int FROM comp_staff WHERE is_active AND worked_days = 0),
                'auto_closed_days_total', (SELECT COALESCE(SUM(auto_closed_days), 0)::int FROM comp_staff),
                'total_orders', (SELECT COALESCE(SUM(order_count), 0)::int FROM att_staff),
                'total_sales', (SELECT COALESCE(SUM(sales_value), 0)::numeric FROM att_staff),
                'total_visits', (SELECT COALESCE(SUM(visit_count), 0)::int FROM att_staff),
                'total_collections', (SELECT COALESCE(SUM(collection_amount), 0)::numeric FROM att_staff),
                'total_new_customers', (SELECT COALESCE(SUM(new_customer_count), 0)::int FROM att_staff),
                'best_performer', (SELECT jsonb_build_object(
                    'employee_id', employee_id, 'name', full_name, 'code', code,
                    'sales', sales_value, 'orders', order_count,
                    'presence_hours', ROUND(present_minutes::numeric / 60, 1),
                    'sales_per_hour', CASE WHEN present_minutes > 0 THEN ROUND(sales_value / (present_minutes::numeric / 60), 2) ELSE 0 END
                ) FROM att_staff WHERE present_minutes > 0 ORDER BY sales_value / NULLIF(present_minutes::numeric / 60, 0) DESC LIMIT 1),
                'worst_performer', (SELECT jsonb_build_object(
                    'employee_id', employee_id, 'name', full_name, 'code', code,
                    'sales', sales_value, 'orders', order_count,
                    'presence_hours', ROUND(present_minutes::numeric / 60, 1),
                    'sales_per_hour', CASE WHEN present_minutes > 0 THEN ROUND(sales_value / (present_minutes::numeric / 60), 2) ELSE 0 END
                ) FROM att_staff WHERE present_minutes > 0 ORDER BY sales_value / NULLIF(present_minutes::numeric / 60, 0) ASC LIMIT 1),
                'live', CASE WHEN v_include_live THEN jsonb_build_object(
                    'active_today', (SELECT COUNT(*)::int FROM att_staff WHERE live_session_id IS NOT NULL AND live_status IN ('active', 'inactive_warning')),
                    'on_visit_today', (SELECT COUNT(*)::int FROM att_staff WHERE live_session_id IS NOT NULL AND live_status IN ('active', 'inactive_warning') AND open_visit_count > 0),
                    'on_break_today', (SELECT COUNT(*)::int FROM att_staff WHERE live_session_id IS NOT NULL AND live_status IN ('active', 'inactive_warning') AND live_active_breaks > 0),
                    'connected_today', (SELECT COUNT(*)::int FROM att_staff WHERE connection_status = 'connected'),
                    'delayed_today', (SELECT COUNT(*)::int FROM att_staff WHERE connection_status = 'delayed'),
                    'lost_today', (SELECT COUNT(*)::int FROM att_staff WHERE connection_status = 'lost'),
                    'no_data_today', (SELECT COUNT(*)::int FROM att_staff WHERE connection_status = 'no_data'),
                    'no_start_today', (SELECT COUNT(*)::int FROM att_staff WHERE live_session_id IS NULL),
                    'ended_today', (SELECT COUNT(*)::int FROM att_staff WHERE live_session_id IS NOT NULL AND live_status = 'completed' AND COALESCE(live_close_reason, '') NOT IN ('auto_closed_inactivity', 'no_activity_timeout', 'day_rollover')),
                    'auto_closed_today', (SELECT COUNT(*)::int FROM att_staff WHERE live_session_id IS NOT NULL AND live_status = 'completed' AND COALESCE(live_close_reason, '') IN ('auto_closed_inactivity', 'no_activity_timeout', 'day_rollover')),
                    'late_today', (SELECT COUNT(*)::int FROM comp_staff WHERE live_attendance_status = 'late' AND COALESCE(late_calculation_enabled, false))
                ) ELSE NULL END
            )
        ) LIMIT 1
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_overview_kpis TO authenticated;

-- ============================================================================
-- 8) get_executive_employee_day_detail — تفاصيل يوم موظف من القوى العاملة فقط
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_executive_employee_day_detail(
    p_token uuid,
    p_employee_id uuid,
    p_date date DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
SET timezone TO 'Africa/Cairo'
AS $fn$
DECLARE
    v_session app.sessions;
    v_visible uuid[];
    v_timeout_minutes integer;
    v_has_view_all boolean;
    v_employee record;
    v_policy record;
    v_control jsonb;
    v_session_id uuid := NULL;
    v_sdate date := NULL;
    v_start timestamptz := NULL;
    v_end timestamptz := NULL;
    v_status text := NULL;
    v_attendance text := NULL;
    v_late int := NULL;
    v_early int := NULL;
    v_close text := NULL;
    v_visit_count int := NULL;
    v_distance numeric := NULL;
    v_last_seen timestamptz := NULL;
    v_start_lat numeric := NULL;
    v_start_lng numeric := NULL;
    v_end_lat numeric := NULL;
    v_end_lng numeric := NULL;
    v_net_minutes int;
    v_break_minutes int;
    v_break_count int;
    v_prev_day jsonb;
    v_row record;
    v_activity_first timestamptz := NULL;
    v_activity_last timestamptz := NULL;
    v_official_start time;
    v_official_end time;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    -- وصول الشاشة: الإدارة العليا فقط
    IF NOT public.executive_followup_can_access(v_session.employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_visible := public.get_visible_employee_ids(v_session.token::text);
    IF v_visible IS NULL OR array_length(v_visible, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_VISIBLE_EMPLOYEES');
    END IF;

    IF NOT (p_employee_id = ANY(v_visible)) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    -- الإدارة العليا/المشرف التنفيذي خارج القوى العاملة: لا يُعرض يومهم هنا
    IF public.executive_followup_classification(p_employee_id) <> 'workforce' THEN
        RETURN jsonb_build_object('error', 'EMPLOYEE_EXCLUDED', 'message', 'الإدارة العليا والمشرف التنفيذي خارج نطاق القوى العاملة.');
    END IF;

    v_has_view_all := public.check_capability(v_session.employee_id, 'attendance.view_all');
    SELECT COALESCE(inactivity_timeout_minutes, 60)::int INTO v_timeout_minutes
    FROM public.workday_settings LIMIT 1;
    SELECT COALESCE(official_start_time, '09:00'::time), COALESCE(official_end_time, '17:00'::time)
    INTO v_official_start, v_official_end
    FROM public.workday_settings LIMIT 1;

    v_control := public.get_executive_effective_policy(p_employee_id);

    -- استبعاد بوضوح من إعداد القوى العاملة: لا يُعرض يومه في الشاشة
    IF NOT COALESCE((v_control->>'show_in_screen')::boolean, true) THEN
        RETURN jsonb_build_object('error', 'EMPLOYEE_EXCLUDED', 'message', 'الموظف خارج نطاق شاشة الحضور والمتابعة في إعداد القوى العاملة.');
    END IF;

    -- بداية/نهاية الدوام الرسمية من الإعدادات الفعّالة (توقيت القاهرة)
    v_official_start := COALESCE(NULLIF(v_control->>'official_start_time', '')::time, v_official_start);
    v_official_end := COALESCE(NULLIF(v_control->>'official_end_time', '')::time, v_official_end);

    SELECT e.*,
           COALESCE((SELECT r.name FROM public.employee_roles er2
                     JOIN public.roles r ON r.id = er2.role_id
                     WHERE er2.employee_id = e.id LIMIT 1), '') AS role_name
    INTO v_employee
    FROM public.employees e
    WHERE e.id = p_employee_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'EMPLOYEE_NOT_FOUND'); END IF;

    SELECT * INTO v_policy FROM public.employee_work_policies WHERE employee_id = p_employee_id;

    SELECT * INTO v_row
    FROM public.workday_sessions
    WHERE employee_id = p_employee_id AND date = p_date
    ORDER BY start_time NULLS LAST
    LIMIT 1;

    IF FOUND THEN
        v_session_id := v_row.id;
        v_sdate := v_row.date;
        v_start := v_row.start_time;
        v_end := v_row.end_time;
        v_status := v_row.status;
        v_attendance := v_row.attendance_status;
        v_late := v_row.late_minutes;
        v_early := v_row.early_departure_minutes;
        v_close := v_row.close_reason;
        v_visit_count := v_row.visit_count;
        v_distance := COALESCE(v_row.total_distance_meters, 0);
        v_last_seen := v_row.last_seen_at;
        v_start_lat := v_row.start_latitude;
        v_start_lng := v_row.start_longitude;
        v_end_lat := v_row.end_latitude;
        v_end_lng := v_row.end_longitude;

        IF COALESCE(v_control->>'schedule_type', 'flexible') = 'fixed' THEN
            v_net_minutes := GREATEST(
                EXTRACT(EPOCH FROM (COALESCE(v_end, now()) - v_start)) / 60
                    - COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = v_session_id), 0)::numeric / 60, 0)::int;
        ELSE
            v_net_minutes := EXTRACT(EPOCH FROM (COALESCE(v_end, now()) - v_start)) / 60::int;
        END IF;
        SELECT COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) / 60 FROM public.workday_breaks wb WHERE wb.session_id = v_session_id), 0)::int,
               (SELECT COUNT(*) FROM public.workday_breaks wb WHERE wb.session_id = v_session_id)
        INTO v_break_minutes, v_break_count;
    END IF;

    -- أول/آخر نشاط لليوم (ساعة العمل الفعلية للمرن)
    SELECT MIN(ac.at), MAX(ac.at) INTO v_activity_first, v_activity_last
    FROM (
        SELECT wds.start_time AS at FROM public.workday_sessions wds WHERE wds.employee_id = p_employee_id AND wds.date = p_date AND wds.start_time IS NOT NULL
        UNION ALL
        SELECT wds.last_seen_at FROM public.workday_sessions wds WHERE wds.employee_id = p_employee_id AND wds.date = p_date AND wds.last_seen_at IS NOT NULL
        UNION ALL
        SELECT tp.recorded_at FROM public.tracking_points tp JOIN public.workday_sessions w3 ON w3.id = tp.session_id WHERE w3.employee_id = p_employee_id AND w3.date = p_date AND tp.recorded_at IS NOT NULL
        UNION ALL
        SELECT v.check_in_at FROM public.visits v WHERE v.employee_id = p_employee_id AND v.check_in_at::date = p_date AND v.check_in_at IS NOT NULL
        UNION ALL
        SELECT v.check_out_at FROM public.visits v WHERE v.employee_id = p_employee_id AND v.check_in_at::date = p_date AND v.check_out_at IS NOT NULL
        UNION ALL
        SELECT o.created_at FROM public.orders o WHERE public.resolve_employee_id(o.owner_id) = p_employee_id AND o.created_at::date = p_date AND o.status NOT IN ('draft', 'cancelled') AND o.created_at IS NOT NULL
        UNION ALL
        SELECT c.created_at FROM public.collections c WHERE public.resolve_employee_id(c.owner_id) = p_employee_id AND c.created_at::date = p_date AND c.created_at IS NOT NULL
    ) ac;

    -- مقارنة مع اليوم السابق (نفس التعريفات الموثقة)
    SELECT jsonb_build_object(
        'date', sp.date,
        'net_minutes', CASE WHEN sp.id IS NOT NULL
            THEN CASE WHEN COALESCE(v_control->>'schedule_type', 'flexible') = 'fixed'
                 THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(sp.end_time, now()) - sp.start_time)) / 60
                               - COALESCE((SELECT SUM(COALESCE(wb.duration_seconds, 0)) FROM public.workday_breaks wb WHERE wb.session_id = sp.id), 0)::numeric / 60, 0)::int
                 ELSE EXTRACT(EPOCH FROM (COALESCE(sp.end_time, now()) - sp.start_time)) / 60::int END
            ELSE NULL END,
        'orders', COALESCE((SELECT COUNT(*) FROM public.orders o
            WHERE public.resolve_employee_id(o.owner_id) = p_employee_id AND o.created_at::date = sp.date AND o.status NOT IN ('draft', 'cancelled')), 0)::int,
        'sales', COALESCE((SELECT SUM(o.total_amount) FROM public.orders o
            WHERE public.resolve_employee_id(o.owner_id) = p_employee_id AND o.created_at::date = sp.date AND o.status NOT IN ('draft', 'cancelled')), 0)::numeric,
        'visits', COALESCE((SELECT COUNT(*) FROM public.visits v WHERE v.employee_id = p_employee_id AND v.check_in_at::date = sp.date), 0)::int,
        'collections', COALESCE((SELECT SUM(c.amount) FROM public.collections c
            WHERE public.resolve_employee_id(c.owner_id) = p_employee_id AND c.created_at::date = sp.date), 0)::numeric
    ) INTO v_prev_day
    FROM public.workday_sessions sp WHERE sp.employee_id = p_employee_id AND sp.date = p_date - 1 LIMIT 1;

    IF v_prev_day IS NULL THEN
        v_prev_day := jsonb_build_object('date', p_date - 1, 'net_minutes', NULL, 'orders', 0, 'sales', 0, 'visits', 0, 'collections', 0);
    END IF;

    RETURN jsonb_build_object(
        'error', NULL,
        'employee', jsonb_build_object(
            'employee_id', v_employee.id, 'code', v_employee.code,
            'name', COALESCE(v_employee.full_name, v_employee.code),
            'role_name', v_employee.role_name, 'is_active', v_employee.is_active,
            'work_location', v_policy.work_location, 'schedule_type', v_policy.schedule_type,
            'required_daily_hours', v_policy.required_daily_hours,
            'shift_start_time', v_policy.shift_start_time::text, 'shift_end_time', v_policy.shift_end_time::text
        ),
        'policy', jsonb_build_object(
            'inactivity_timeout_minutes', v_timeout_minutes,
            'official_start_time', v_official_start::text,
            'official_end_time', v_official_end::text
        ),
        'control', v_control,
        'can_view_all', v_has_view_all,
        'permission_note', CASE WHEN NOT v_employee.is_active AND NOT v_has_view_all
            THEN 'الموظف غير نشط. يُعرض فقط للإدارة العليا/من بصلاحية رؤية كاملة.' ELSE NULL END,
        'activity_window', jsonb_build_object(
            'first_activity_at', v_activity_first,
            'last_activity_at', v_activity_last
        ),
        'session', CASE WHEN v_session_id IS NOT NULL THEN jsonb_build_object(
            'session_id', v_session_id, 'date', v_sdate,
            'start_time', v_start, 'end_time', v_end,
            'status', v_status,
            'attendance_status', CASE WHEN COALESCE(v_control->>'schedule_type', 'flexible') = 'fixed'
                    AND (COALESCE((v_control->>'late_calculation_enabled')::boolean, false) OR COALESCE((v_control->>'early_calculation_enabled')::boolean, false))
                THEN v_attendance ELSE NULL END,
            'late_minutes', CASE WHEN COALESCE(v_control->>'schedule_type', 'flexible') = 'fixed' AND COALESCE((v_control->>'late_calculation_enabled')::boolean, false)
                THEN v_late ELSE NULL END,
            'early_departure_minutes', CASE WHEN COALESCE(v_control->>'schedule_type', 'flexible') = 'fixed' AND COALESCE((v_control->>'early_calculation_enabled')::boolean, false)
                THEN v_early ELSE NULL END,
            'arrival_time', v_start,
            'official_start_time', v_official_start::text,
            'official_end_time', v_official_end::text,
            'close_reason', v_close,
            'visit_count', v_visit_count,
            'distance_meters', ROUND(v_distance, 1),
            'elapsed_minutes', EXTRACT(EPOCH FROM (COALESCE(v_end, now()) - v_start)) / 60::int,
            'net_minutes', v_net_minutes,
            'last_seen_at', v_last_seen
        ) ELSE NULL END,
        'working_time', CASE WHEN v_session_id IS NOT NULL THEN jsonb_build_object(
            'start', v_start, 'end', v_end,
            'elapsed_minutes', EXTRACT(EPOCH FROM (COALESCE(v_end, now()) - v_start)) / 60::int,
            'net_minutes', v_net_minutes,
            'break_minutes', v_break_minutes,
            'break_count', v_break_count
        ) ELSE NULL END,
        'breaks', CASE WHEN v_session_id IS NOT NULL THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', wb.id, 'break_start', wb.break_start, 'break_end', wb.break_end,
                'duration_seconds', wb.duration_seconds, 'break_reason', wb.break_reason,
                'auto_closed', wb.auto_closed, 'latitude', wb.latitude, 'longitude', wb.longitude
            ) ORDER BY wb.break_start)
            FROM public.workday_breaks wb WHERE wb.session_id = v_session_id
        ), '[]'::jsonb) ELSE '[]'::jsonb END,
        'visits', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'visit_id', v.id, 'code', v.code, 'customer_id', v.customer_id,
                'status', v.status, 'check_in_at', v.check_in_at, 'check_out_at', v.check_out_at,
                'check_in_latitude', v.check_in_latitude, 'check_in_longitude', v.check_in_longitude,
                'check_out_latitude', v.check_out_latitude, 'check_out_longitude', v.check_out_longitude,
                'visit_result', v.visit_result, 'notes', v.notes,
                'customer_name', COALESCE(NULLIF(c.company_name, ''), c.code)
            ) ORDER BY v.check_in_at)
            FROM public.visits v
            LEFT JOIN public.customers c ON c.id = v.customer_id
            WHERE v.employee_id = p_employee_id AND v.check_in_at::date = p_date
        ), '[]'::jsonb),
        'orders', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'order_id', o.id, 'code', o.order_number, 'customer_id', o.customer_id,
                'status', o.status, 'total_amount', o.total_amount,
                'created_at', o.created_at, 'submitted_at', o.submitted_at,
                'customer_name', COALESCE(NULLIF(c.company_name, ''), c.code)
            ) ORDER BY o.created_at)
            FROM public.orders o
            LEFT JOIN public.customers c ON c.id = o.customer_id
            WHERE public.resolve_employee_id(o.owner_id) = p_employee_id
              AND o.created_at::date = p_date
              AND o.status NOT IN ('draft', 'cancelled')
        ), '[]'::jsonb),
        'collections', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'collection_id', col.id, 'code', col.code, 'customer_id', col.customer_id,
                'amount', col.amount, 'method', col.method, 'created_at', col.created_at,
                'customer_name', COALESCE(NULLIF(c.company_name, ''), c.code)
            ) ORDER BY col.created_at)
            FROM public.collections col
            LEFT JOIN public.customers c ON c.id = col.customer_id
            WHERE public.resolve_employee_id(col.owner_id) = p_employee_id
              AND col.created_at::date = p_date
        ), '[]'::jsonb),
        'new_customers', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'customer_id', c2.id, 'code', c2.code,
                'name', COALESCE(NULLIF(c2.company_name, ''), c2.code),
                'created_at', c2.created_at
            ) ORDER BY c2.created_at)
            FROM public.customers c2
            WHERE public.resolve_employee_id(c2.owner_id) = p_employee_id
              AND c2.created_at::date = p_date
        ), '[]'::jsonb),
        'connection_status', (
            SELECT CASE
                WHEN la.last_activity_at IS NULL THEN 'no_data'
                WHEN la.last_activity_at > now() - interval '5 minutes' THEN 'connected'
                WHEN la.last_activity_at > now() - interval '25 minutes' THEN 'delayed'
                ELSE 'lost' END
            FROM (
                SELECT DISTINCT ON (activity_at) activity_at AS last_activity_at
                FROM (
                    SELECT wds.last_seen_at AS activity_at FROM public.workday_sessions wds
                    WHERE wds.employee_id = p_employee_id AND wds.last_seen_at IS NOT NULL
                      AND wds.last_seen_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT tp.recorded_at FROM public.tracking_points tp
                    WHERE tp.employee_id = p_employee_id AND tp.recorded_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT v.check_in_at FROM public.visits v
                    WHERE v.employee_id = p_employee_id AND v.check_in_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT o.created_at FROM public.orders o
                    WHERE public.resolve_employee_id(o.owner_id) = p_employee_id
                      AND o.created_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT c.created_at FROM public.collections c
                    WHERE public.resolve_employee_id(c.owner_id) = p_employee_id
                      AND c.created_at > now() - interval '24 hours'
                ) ca ORDER BY activity_at DESC NULLS LAST
            ) la LIMIT 1
        ),
        'day_location', CASE WHEN v_session_id IS NOT NULL AND COALESCE((v_control->>'follow_up_enabled')::boolean, false) THEN (
            SELECT jsonb_build_object(
                'latitude', COALESCE((SELECT tp.latitude FROM public.tracking_points tp
                    WHERE tp.session_id = v_session_id ORDER BY tp.recorded_at DESC LIMIT 1),
                    v_end_lat, v_start_lat),
                'longitude', COALESCE((SELECT tp.longitude FROM public.tracking_points tp
                    WHERE tp.session_id = v_session_id ORDER BY tp.recorded_at DESC LIMIT 1),
                    v_end_lng, v_start_lng),
                'at', COALESCE((SELECT tp.recorded_at FROM public.tracking_points tp
                    WHERE tp.session_id = v_session_id ORDER BY tp.recorded_at DESC LIMIT 1),
                    COALESCE(v_end, v_start)),
                'source', CASE WHEN EXISTS (SELECT 1 FROM public.tracking_points tp
                        WHERE tp.session_id = v_session_id) THEN 'tracking'
                    WHEN v_end_lat IS NOT NULL THEN 'workday_end'
                    WHEN v_start_lat IS NOT NULL THEN 'workday_start'
                    ELSE 'none' END,
                'has_location', COALESCE((SELECT tp.latitude FROM public.tracking_points tp
                    WHERE tp.session_id = v_session_id ORDER BY tp.recorded_at DESC LIMIT 1),
                    v_end_lat, v_start_lat) IS NOT NULL,
                'enabled', true
            )
        ) ELSE NULL END,
        'last_event', (
            SELECT jsonb_build_object(
                'type', la.activity_type, 'at', la.activity_at, 'has_event', la.activity_at IS NOT NULL
            )
            FROM (
                SELECT DISTINCT ON (activity_at) activity_at, activity_type
                FROM (
                    SELECT wds.last_seen_at AS activity_at, 'heartbeat' AS activity_type
                    FROM public.workday_sessions wds
                    WHERE wds.employee_id = p_employee_id AND wds.last_seen_at IS NOT NULL
                    UNION ALL
                    SELECT tp.recorded_at, 'gps' FROM public.tracking_points tp
                    WHERE tp.employee_id = p_employee_id AND tp.recorded_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT v.check_in_at, 'visit' FROM public.visits v
                    WHERE v.employee_id = p_employee_id AND v.check_in_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT o.created_at, 'order' FROM public.orders o
                    WHERE public.resolve_employee_id(o.owner_id) = p_employee_id
                      AND o.created_at > now() - interval '24 hours'
                    UNION ALL
                    SELECT c.created_at, 'collection' FROM public.collections c
                    WHERE public.resolve_employee_id(c.owner_id) = p_employee_id
                      AND c.created_at > now() - interval '24 hours'
                ) ca ORDER BY activity_at DESC NULLS LAST
            ) la LIMIT 1
        ),
        'auto_close', CASE WHEN v_session_id IS NOT NULL
             AND v_close IN ('auto_closed_inactivity', 'no_activity_timeout', 'day_rollover') THEN jsonb_build_object(
                'reason', v_close,
                'reason_label', CASE v_close
                    WHEN 'auto_closed_inactivity' THEN 'إغلاق تلقائي لعدم النشاط'
                    WHEN 'no_activity_timeout' THEN 'انتهاء مهلة النشاط'
                    WHEN 'day_rollover' THEN 'انتقال يومي (منتصف الليل)' END,
                'policy_minutes', v_timeout_minutes
            ) ELSE NULL END,
        'comparison', jsonb_build_object('prev_day', v_prev_day)
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_employee_day_detail TO authenticated;

-- ============================================================================
-- 9) get_executive_day_timeline — خط زمني لموظف من القوى العاملة فقط
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_executive_day_timeline(
    p_token uuid,
    p_employee_id uuid,
    p_date date DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
SET timezone TO 'Africa/Cairo'
AS $fn$
DECLARE
    v_session app.sessions;
    v_visible uuid[];
    v_session_id uuid := NULL;
    v_session_start timestamptz := NULL;
    v_session_end timestamptz := NULL;
    v_session_status text := NULL;
    v_session_close text := NULL;
    v_row record;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    -- وصول الشاشة: الإدارة العليا فقط
    IF NOT public.executive_followup_can_access(v_session.employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_visible := public.get_visible_employee_ids(v_session.token::text);
    IF v_visible IS NULL OR array_length(v_visible, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_VISIBLE_EMPLOYEES');
    END IF;
    IF NOT (p_employee_id = ANY(v_visible)) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    -- الإدارة العليا/المشرف التنفيذي خارج القوى العاملة
    IF public.executive_followup_classification(p_employee_id) <> 'workforce' THEN
        RETURN jsonb_build_object('error', 'EMPLOYEE_EXCLUDED', 'message', 'الإدارة العليا والمشرف التنفيذي خارج نطاق القوى العاملة.');
    END IF;
    -- مستبعد من إعداد القوى العاملة
    IF NOT COALESCE((public.get_executive_effective_policy(p_employee_id)->>'show_in_screen')::boolean, true) THEN
        RETURN jsonb_build_object('error', 'EMPLOYEE_EXCLUDED', 'message', 'الموظف خارج نطاق شاشة الحضور والمتابعة في إعداد القوى العاملة.');
    END IF;

    SELECT * INTO v_row
    FROM public.workday_sessions
    WHERE employee_id = p_employee_id AND date = p_date
    ORDER BY start_time NULLS LAST
    LIMIT 1;

    IF FOUND THEN
        v_session_id := v_row.id;
        v_session_start := v_row.start_time;
        v_session_end := v_row.end_time;
        v_session_status := v_row.status;
        v_session_close := v_row.close_reason;
    END IF;

    RETURN (
        WITH breaks AS (
            SELECT wb.id, wb.break_start, wb.break_end
            FROM public.workday_breaks wb
            WHERE wb.session_id = v_session_id
        ),
        ev AS (
            SELECT e.t, e.type, e.label, e.detail, e.latitude, e.longitude, e.location_source
            FROM (
                SELECT wds.start_time AS t, 'workday_start'::text AS type, 'بدء يوم العمل'::text AS label,
                       ''::text AS detail, wds.start_latitude AS latitude, wds.start_longitude AS longitude,
                       CASE WHEN wds.start_latitude IS NOT NULL THEN 'workday_start'::text ELSE NULL END AS location_source
                FROM public.workday_sessions wds WHERE wds.id = v_session_id AND wds.start_time IS NOT NULL
                UNION ALL
                SELECT wb.break_start, 'break_start', 'بدء استراحة',
                       COALESCE(wb.break_reason, ''), wb.latitude, wb.longitude,
                       CASE WHEN wb.latitude IS NOT NULL THEN 'break' END
                FROM public.workday_breaks wb WHERE wb.session_id = v_session_id AND wb.break_start IS NOT NULL
                UNION ALL
                SELECT wb.break_end, 'break_end', 'نهاية استراحة',
                       COALESCE(wb.break_reason, ''), wb.latitude, wb.longitude,
                       CASE WHEN wb.latitude IS NOT NULL THEN 'break' END
                FROM public.workday_breaks wb WHERE wb.session_id = v_session_id AND wb.break_end IS NOT NULL
                UNION ALL
                SELECT v.check_in_at, 'visit_checkin', 'تسجيل حضور زيارة',
                       COALESCE(v.code, '') || COALESCE(' — ' || COALESCE(NULLIF(c.company_name, ''), c.code), ''),
                       v.check_in_latitude, v.check_in_longitude,
                       CASE WHEN v.check_in_latitude IS NOT NULL THEN 'visit' END
                FROM public.visits v LEFT JOIN public.customers c ON c.id = v.customer_id
                WHERE v.employee_id = p_employee_id AND v.check_in_at::date = p_date AND v.check_in_at IS NOT NULL
                UNION ALL
                SELECT v.check_out_at, 'visit_checkout', 'تسجيل خروج زيارة',
                       COALESCE(v.code, '') || COALESCE(' — ' || COALESCE(NULLIF(c.company_name, ''), c.code), ''),
                       v.check_out_latitude, v.check_out_longitude,
                       CASE WHEN v.check_out_latitude IS NOT NULL THEN 'visit' END
                FROM public.visits v LEFT JOIN public.customers c ON c.id = v.customer_id
                WHERE v.employee_id = p_employee_id AND v.check_in_at::date = p_date AND v.check_out_at IS NOT NULL
                UNION ALL
                SELECT o.created_at, 'order', 'طلب',
                       COALESCE(o.order_number, '') || COALESCE(' — ' || o.total_amount::text, ''),
                       NULL, NULL, NULL
                FROM public.orders o
                WHERE public.resolve_employee_id(o.owner_id) = p_employee_id
                  AND o.created_at::date = p_date AND o.status NOT IN ('draft', 'cancelled')
                  AND o.created_at IS NOT NULL
                UNION ALL
                SELECT col.created_at, 'collection', 'تحصيل',
                       COALESCE(col.code, '') || COALESCE(' — ' || col.amount::text, ''),
                       NULL, NULL, NULL
                FROM public.collections col
                WHERE public.resolve_employee_id(col.owner_id) = p_employee_id
                  AND col.created_at::date = p_date AND col.created_at IS NOT NULL
                UNION ALL
                SELECT c2.created_at, 'customer', 'عميل جديد',
                       COALESCE(c2.code, '') || COALESCE(' — ' || COALESCE(NULLIF(c2.company_name, ''), c2.code), ''),
                       NULL, NULL, NULL
                FROM public.customers c2
                WHERE public.resolve_employee_id(c2.owner_id) = p_employee_id
                  AND c2.created_at::date = p_date AND c2.created_at IS NOT NULL
                UNION ALL
                SELECT tp.recorded_at, 'tracking'::text, 'نقطة تتبع',
                       tp.point_type::text, tp.latitude, tp.longitude, 'tracking'::text
                FROM public.tracking_points tp
                WHERE tp.session_id = v_session_id AND tp.recorded_at IS NOT NULL
                UNION ALL
                SELECT wds.end_time, 'workday_end', 'إنهاء يوم العمل', COALESCE(wds.close_reason, ''),
                       wds.end_latitude, wds.end_longitude,
                       CASE WHEN wds.end_latitude IS NOT NULL THEN 'workday_end' END
                FROM public.workday_sessions wds WHERE wds.id = v_session_id AND wds.end_time IS NOT NULL
            ) e
            WHERE e.t IS NOT NULL
        ),
        ord AS (
            SELECT e.t, e.type, e.label, e.detail, e.latitude, e.longitude, e.location_source,
                   LAG(e.t) OVER (ORDER BY e.t) AS prev_t
            FROM ev e
        ),
        with_gaps AS (
            SELECT o.*,
                   CASE WHEN o.prev_t IS NOT NULL
                        AND EXTRACT(EPOCH FROM (o.t - o.prev_t)) / 60 >= 10
                        AND NOT EXISTS (
                            SELECT 1 FROM breaks b
                            WHERE b.break_start <= o.t AND COALESCE(b.break_end, o.t) > o.prev_t
                        )
                        AND (v_session_start IS NULL OR v_session_start <= o.t)
                   THEN (EXTRACT(EPOCH FROM (o.t - o.prev_t)) / 60)::int
                   ELSE 0 END AS gap_minutes
            FROM ord o
        )
        SELECT jsonb_build_object(
            'error', NULL,
            'date', p_date,
            'employee_id', p_employee_id,
            'session', CASE WHEN v_session_id IS NOT NULL THEN jsonb_build_object(
                'session_id', v_session_id, 'start_time', v_session_start,
                'end_time', v_session_end, 'status', v_session_status,
                'close_reason', v_session_close
            ) ELSE NULL END,
            'summary', jsonb_build_object(
                'event_count', (SELECT COUNT(*)::int FROM ev),
                'tracking_count', (SELECT COUNT(*)::int FROM ev WHERE type = 'tracking'),
                'visit_count', (SELECT COUNT(*)::int FROM ev WHERE type IN ('visit_checkin', 'visit_checkout')),
                'order_count', (SELECT COUNT(*)::int FROM ev WHERE type = 'order'),
                'collection_count', (SELECT COUNT(*)::int FROM ev WHERE type = 'collection'),
                'break_count', (SELECT COUNT(*)::int FROM ev WHERE type IN ('break_start', 'break_end')),
                'idle_minutes', (SELECT COALESCE(SUM(gap_minutes), 0)::int FROM with_gaps),
                'truncated', (SELECT COUNT(*)::int FROM ev) > 1000
            ),
            'events', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    't', wg.t, 'type', wg.type, 'label', wg.label, 'detail', wg.detail,
                    'has_location', wg.latitude IS NOT NULL AND wg.longitude IS NOT NULL,
                    'latitude', wg.latitude, 'longitude', wg.longitude,
                    'location_source', wg.location_source,
                    'gap_minutes', wg.gap_minutes
                ) ORDER BY wg.t DESC)
                FROM (SELECT * FROM with_gaps ORDER BY t DESC LIMIT 1000) wg
            ), '[]'::jsonb)
        ) LIMIT 1
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_day_timeline TO authenticated;

-- ============================================================================
-- 10) get_executive_auto_close_report — تقرير الإغلاق التلقائي للقوى العاملة فقط
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_executive_auto_close_report(
    p_token uuid,
    p_from date DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date,
    p_to date DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
SET timezone TO 'Africa/Cairo'
AS $fn$
DECLARE
    v_session app.sessions;
    v_visible uuid[];
    v_timeout_minutes integer;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    -- وصول الشاشة: الإدارة العليا فقط
    IF NOT public.executive_followup_can_access(v_session.employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_visible := public.get_visible_employee_ids(v_session.token::text);
    IF v_visible IS NULL OR array_length(v_visible, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_VISIBLE_EMPLOYEES');
    END IF;

    SELECT COALESCE(inactivity_timeout_minutes, 60)::int INTO v_timeout_minutes
    FROM public.workday_settings LIMIT 1;

    RETURN (
        WITH st AS (
            SELECT wds.id, wds.employee_id, wds.date, wds.start_time, wds.end_time,
                   wds.close_reason, wds.attendance_status,
                   wds.last_seen_at, wds.status
            FROM public.workday_sessions wds
            JOIN public.employees e ON e.id = wds.employee_id
            WHERE wds.employee_id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
              AND COALESCE((public.get_executive_effective_policy(wds.employee_id)->>'show_in_screen')::boolean, true)
              AND wds.date >= p_from AND wds.date <= p_to
              AND wds.close_reason IN ('auto_closed_inactivity', 'no_activity_timeout', 'day_rollover')
        )
        SELECT jsonb_build_object(
            'error', NULL,
            'period', jsonb_build_object('from', p_from, 'to', p_to),
            'policy', jsonb_build_object('inactivity_timeout_minutes', v_timeout_minutes),
            'by_reason', jsonb_build_object(
                'auto_closed_inactivity', (SELECT COUNT(*)::int FROM st WHERE close_reason = 'auto_closed_inactivity'),
                'no_activity_timeout', (SELECT COUNT(*)::int FROM st WHERE close_reason = 'no_activity_timeout'),
                'day_rollover', (SELECT COUNT(*)::int FROM st WHERE close_reason = 'day_rollover'),
                'total', (SELECT COUNT(*)::int FROM st)
            ),
            'sessions', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'session_id', st.id,
                    'employee_id', st.employee_id,
                    'employee_name', COALESCE(NULLIF(e.full_name, ''), e.code),
                    'code', e.code,
                    'date', st.date,
                    'start_time', st.start_time, 'end_time', st.end_time,
                    'close_reason', st.close_reason,
                    'attendance_status', st.attendance_status,
                    'last_activity_at', st.last_seen_at,
                    'inactive_minutes', CASE WHEN st.last_seen_at IS NOT NULL AND st.end_time > st.last_seen_at
                        THEN (EXTRACT(EPOCH FROM (st.end_time - st.last_seen_at)) / 60)::int
                        ELSE NULL END
                ) ORDER BY st.date DESC, st.end_time DESC)
                FROM public.employees e
                JOIN st ON st.employee_id = e.id
            ), '[]'::jsonb)
        ) LIMIT 1
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_auto_close_report TO authenticated;

-- ============================================================================
-- 11) get_executive_workforce_history — سجل القوى العاملة (المشمولون فقط)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_executive_workforce_history(
    p_token uuid,
    p_from date DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date - 6,
    p_to date DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date,
    p_include_inactive boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
SET timezone TO 'Africa/Cairo'
AS $fn$
DECLARE
    v_session app.sessions;
    v_visible uuid[];
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    -- وصول الشاشة: الإدارة العليا فقط
    IF NOT public.executive_followup_can_access(v_session.employee_id) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_visible := public.get_visible_employee_ids(v_session.token::text);
    IF v_visible IS NULL OR array_length(v_visible, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_VISIBLE_EMPLOYEES');
    END IF;

    RETURN (
        WITH ss AS (
            SELECT wds.employee_id, wds.date, wds.start_time, wds.end_time, wds.status,
                   wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
                   wds.close_reason, wds.visit_count, wds.total_distance_meters
            FROM public.workday_sessions wds
            JOIN public.employees e ON e.id = wds.employee_id
            WHERE wds.employee_id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
              AND wds.date >= p_from AND wds.date <= p_to
        ),
        br AS (
            SELECT w2.employee_id, w2.date,
                   COUNT(*)::int AS break_count,
                   COALESCE(SUM(COALESCE(wb.duration_seconds, 0)), 0) AS break_seconds
            FROM public.workday_breaks wb
            JOIN public.workday_sessions w2 ON w2.id = wb.session_id
            JOIN public.employees e ON e.id = w2.employee_id
            WHERE w2.employee_id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
              AND w2.date >= p_from AND w2.date <= p_to
            GROUP BY w2.employee_id, w2.date
        ),
        pol AS (
            SELECT e.id AS employee_id,
                   COALESCE(o.schedule_type, r.schedule_type, 'flexible') AS schedule_type,
                   COALESCE(o.late_calculation_enabled, r.late_calculation_enabled, true) AS late_calculation_enabled,
                   COALESCE(o.early_calculation_enabled, r.early_calculation_enabled, true) AS early_calculation_enabled
            FROM public.employees e
            LEFT JOIN public.executive_employee_schedule_override o ON o.employee_id = e.id
            LEFT JOIN public.executive_role_default_policy r
                   ON r.role_id = (SELECT er.role_id FROM public.employee_roles er
                                   WHERE er.employee_id = e.id ORDER BY er.assigned_at ASC, er.id ASC LIMIT 1)
            WHERE e.id = ANY(v_visible)
              AND public.executive_followup_classification(e.id) = 'workforce'
        ),
        mat AS (
            SELECT
                ve.employee_id, ve.code, MAX(COALESCE(NULLIF(ve.full_name, ''), ve.code)) AS full_name,
                MAX(ve.role_name) AS role_name, BOOL_OR(ve.is_active) AS is_active,
                MAX(ve.work_location) AS work_location, pp.schedule_type AS sched_ctl,
                pp.late_calculation_enabled AS late_calculation_enabled,
                pp.early_calculation_enabled AS early_calculation_enabled,
                MAX(ve.required_daily_hours) AS required_daily_hours,
                MAX(ve.shift_start_time) AS shift_start_time, MAX(ve.shift_end_time) AS shift_end_time,
                ss.date,
                COUNT(ss.employee_id) AS present_days,
                MIN(ss.start_time) AS start_time,
                MAX(ss.end_time) AS end_time,
                MAX(ss.status) AS status,
                MAX(ss.attendance_status) AS attendance_status,
                SUM(CASE WHEN pp.schedule_type = 'fixed' AND pp.late_calculation_enabled THEN COALESCE(ss.late_minutes, 0) ELSE 0 END)::int AS late_minutes,
                SUM(CASE WHEN pp.schedule_type = 'fixed' AND pp.early_calculation_enabled THEN COALESCE(ss.early_departure_minutes, 0) ELSE 0 END)::int AS early_minutes,
                MAX(ss.close_reason) AS close_reason,
                CASE WHEN pp.schedule_type = 'flexible'
                     THEN COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ss.end_time, ss.start_time) - ss.start_time)) / 60), 0)::int
                ELSE GREATEST(COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ss.end_time, ss.start_time) - ss.start_time)) / 60), 0)
                              - COALESCE(SUM(COALESCE(br.break_seconds, 0)), 0)::numeric / 60, 0)::int END AS net_minutes,
                COALESCE(SUM(COALESCE(br.break_count, 0)), 0)::int AS break_count,
                COALESCE(SUM(COALESCE(br.break_seconds, 0)), 0)::int AS break_seconds,
                COALESCE(MAX(ss.visit_count), 0)::int AS visit_count,
                COALESCE(SUM(o.order_count), 0)::int AS order_count,
                COALESCE(SUM(o.sales_value), 0)::numeric AS sales_value,
                COALESCE(SUM(col.collection_count), 0)::int AS collection_count,
                COALESCE(SUM(col.collection_amount), 0)::numeric AS collection_amount,
                COALESCE(SUM(nc.new_customer_count), 0)::int AS new_customer_count
            FROM (
                SELECT e.id AS employee_id, e.code, e.full_name,
                       COALESCE((SELECT r.name FROM public.employee_roles er2
                                 JOIN public.roles r ON r.id = er2.role_id
                                 WHERE er2.employee_id = e.id LIMIT 1), '') AS role_name,
                       e.is_active,
                       ewp.work_location, ewp.required_daily_hours,
                       ewp.shift_start_time, ewp.shift_end_time
                FROM public.employees e
                LEFT JOIN public.employee_work_policies ewp ON ewp.employee_id = e.id
                WHERE e.id = ANY(v_visible)
                  AND (p_include_inactive OR e.is_active)
                  AND public.executive_followup_classification(e.id) = 'workforce'
                  AND COALESCE((public.get_executive_effective_policy(e.id)->>'show_in_screen')::boolean, true)
            ) ve
            LEFT JOIN pol p ON p.employee_id = ve.employee_id
            CROSS JOIN LATERAL (SELECT COALESCE(p.schedule_type, 'flexible') AS schedule_type,
                                       COALESCE(p.late_calculation_enabled, true) AS late_calculation_enabled,
                                       COALESCE(p.early_calculation_enabled, true) AS early_calculation_enabled) pp
            LEFT JOIN ss ON ss.employee_id = ve.employee_id
            LEFT JOIN br ON br.employee_id = ve.employee_id AND br.date = ss.date
            LEFT JOIN (
                SELECT public.resolve_employee_id(o.owner_id) AS eid, o.created_at::date AS d,
                       COUNT(*)::int AS order_count, SUM(o.total_amount) AS sales_value
                FROM public.orders o
                WHERE o.status NOT IN ('draft', 'cancelled')
                  AND o.created_at::date >= p_from AND o.created_at::date <= p_to
                  AND public.resolve_employee_id(o.owner_id) = ANY(v_visible)
                GROUP BY 1, 2
            ) o ON o.eid = ve.employee_id AND o.d = ss.date
            LEFT JOIN (
                SELECT public.resolve_employee_id(c.owner_id) AS eid, c.created_at::date AS d,
                       COUNT(*)::int AS collection_count, SUM(c.amount) AS collection_amount
                FROM public.collections c
                WHERE c.created_at::date >= p_from AND c.created_at::date <= p_to
                  AND public.resolve_employee_id(c.owner_id) = ANY(v_visible)
                GROUP BY 1, 2
            ) col ON col.eid = ve.employee_id AND col.d = ss.date
            LEFT JOIN (
                SELECT public.resolve_employee_id(c2.owner_id) AS eid, c2.created_at::date AS d,
                       COUNT(*)::int AS new_customer_count
                FROM public.customers c2
                WHERE c2.created_at::date >= p_from AND c2.created_at::date <= p_to
                  AND public.resolve_employee_id(c2.owner_id) = ANY(v_visible)
                GROUP BY 1, 2
            ) nc ON nc.eid = ve.employee_id AND nc.d = ss.date
            GROUP BY ve.employee_id, ve.code, ss.date,
                     pp.schedule_type, pp.late_calculation_enabled, pp.early_calculation_enabled
        )
        SELECT jsonb_build_object(
            'error', NULL,
            'period', jsonb_build_object('from', p_from, 'to', p_to),
            'totals', jsonb_build_object(
                'present_days', (SELECT COUNT(*)::int FROM mat WHERE present_days > 0),
                'presence_hours_total', ROUND(COALESCE((SELECT SUM(net_minutes) FROM mat), 0)::numeric / 60, 1),
                'avg_daily_presence_hours', ROUND(COALESCE((SELECT AVG(net_minutes) FROM mat WHERE present_days > 0), 0)::numeric / 60, 1),
                'late_days', (SELECT COUNT(*)::int FROM mat WHERE attendance_status = 'late' AND sched_ctl = 'fixed' AND late_calculation_enabled),
                'early_days', (SELECT COUNT(*)::int FROM mat WHERE (attendance_status = 'early_departure' OR early_minutes > 0) AND sched_ctl = 'fixed' AND early_calculation_enabled),
                'auto_closed_days', (SELECT COUNT(*)::int FROM mat WHERE close_reason IN ('auto_closed_inactivity', 'no_activity_timeout', 'day_rollover')),
                'orders', (SELECT COALESCE(SUM(order_count), 0)::int FROM mat),
                'sales', (SELECT COALESCE(SUM(sales_value), 0)::numeric FROM mat),
                'visits', (SELECT COALESCE(SUM(visit_count), 0)::int FROM mat),
                'collections', (SELECT COALESCE(SUM(collection_count), 0)::int FROM mat),
                'collection_amount', (SELECT COALESCE(SUM(collection_amount), 0)::numeric FROM mat),
                'new_customers', (SELECT COALESCE(SUM(new_customer_count), 0)::int FROM mat)
            ),
            'employees', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'employee_id', m.employee_id, 'code', m.code, 'name', m.full_name,
                    'role_name', m.role_name, 'is_active', m.is_active,
                    'work_location', m.work_location, 'schedule_type', m.sched_ctl,
                    'required_daily_hours', m.required_daily_hours,
                    'shift_start_time', m.shift_start_time::text, 'shift_end_time', m.shift_end_time::text,
                    'policy', jsonb_build_object(
                        'schedule_type', m.sched_ctl,
                        'late_calculation_enabled', m.late_calculation_enabled,
                        'early_calculation_enabled', m.early_calculation_enabled
                    ),
                    'days', (SELECT jsonb_agg(jsonb_build_object(
                                'date', d2.date,
                                'start_time', d2.start_time, 'end_time', d2.end_time,
                                'status', d2.status, 'attendance_status', d2.attendance_status,
                                'late_minutes', d2.late_minutes, 'early_minutes', d2.early_minutes,
                                'close_reason', d2.close_reason,
                                'net_minutes', d2.net_minutes,
                                'break_count', d2.break_count, 'break_minutes', (d2.break_seconds / 60)::int,
                                'visit_count', d2.visit_count,
                                'orders', d2.order_count, 'sales', d2.sales_value,
                                'collections', d2.collection_count, 'collection_amount', d2.collection_amount,
                                'new_customers', d2.new_customer_count
                            ) ORDER BY d2.date)
                            FROM mat d2 WHERE d2.employee_id = m.employee_id AND d2.present_days > 0
                    )
                ) ORDER BY m.full_name, m.code)
                FROM (SELECT DISTINCT employee_id, code, full_name, role_name, is_active, work_location,
                                     sched_ctl, required_daily_hours, shift_start_time, shift_end_time,
                                     late_calculation_enabled, early_calculation_enabled
                      FROM mat) m
            ), '[]'::jsonb),
            'matrix', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'date', m.date, 'employee_id', m.employee_id, 'code', m.code,
                    'name', m.full_name, 'present', m.present_days > 0,
                    'net_minutes', m.net_minutes, 'status', m.status,
                    'attendance_status', CASE WHEN m.sched_ctl = 'fixed'
                        THEN CASE WHEN m.attendance_status = 'late' AND m.late_calculation_enabled THEN m.attendance_status
                                  WHEN m.attendance_status = 'early_departure' AND m.early_calculation_enabled THEN m.attendance_status
                                  ELSE 'ontime' END
                        ELSE NULL END,
                    'schedule_type', m.sched_ctl,
                    'close_reason', m.close_reason
                ) ORDER BY m.date DESC, m.full_name)
                FROM mat m WHERE m.present_days > 0
            ), '[]'::jsonb)
        ) LIMIT 1
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_workforce_history TO authenticated;

NOTIFY pgrst, 'reload schema';