-- ============================================================================
-- شاشة الحضور والمتابعة — الجزء 6: نظام التحكم الإداري
--   نطاق الحضور / نطاق المتابعة (الموقع) / نوع الدوام (ثابت/مرن) /
--   حساب التأخير / حساب الانصراف المبكر.
--   سياسة افتراضية على مستوى الدور + تجاوز فردي على مستوى الموظف +
--   إشارة واضحة للمصدر (افتراض الدور أم تجاوز فردي) + سجل تدقيق كامل.
--   ملاحظة: لا يُعدَّل نظام الحضور القديم ولا employee_work_policies ولا
--   workday_settings ولا الأدوار — هذه طبقة إدارة قراءة/كتابة مستقلة لها.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) سياسة افتراضية لكل دور
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.executive_role_default_policy (
    role_id uuid PRIMARY KEY REFERENCES public.roles(id) ON DELETE CASCADE,
    attendance_enabled boolean NOT NULL DEFAULT true,
    follow_up_enabled boolean NOT NULL DEFAULT false,
    schedule_type varchar(20) NOT NULL DEFAULT 'fixed'
        CHECK (schedule_type IN ('fixed', 'flexible')),
    late_calculation_enabled boolean NOT NULL DEFAULT true,
    early_calculation_enabled boolean NOT NULL DEFAULT true,
    updated_by uuid REFERENCES public.employees(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.executive_role_default_policy IS
    'سياسة التحكم الافتراضية لكل دور في شاشة الحضور والمتابعة (نطاقات/نوع الدوام/حساب التأخير والمبكر).';

-- ---------------------------------------------------------------------------
-- 2) تجاوز فردي للموظف (وجود صف = تجاوز؛ حذفه = الرجوع لافتراضي الدور)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.executive_employee_schedule_override (
    employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
    attendance_enabled boolean NOT NULL DEFAULT true,
    follow_up_enabled boolean NOT NULL DEFAULT false,
    schedule_type varchar(20) NOT NULL DEFAULT 'fixed'
        CHECK (schedule_type IN ('fixed', 'flexible')),
    late_calculation_enabled boolean NOT NULL DEFAULT true,
    early_calculation_enabled boolean NOT NULL DEFAULT true,
    updated_by uuid REFERENCES public.employees(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.executive_employee_schedule_override IS
    'تجاوز فردي لسياسة التحكم على مستوى الموظف. وجود السجل = التجاوز مفعّل؛ حذف السجل = العودة لافتراضي الدور.';

-- سجل التدقيق (كل تغيير في أي ضابط: الدور/الموظف، القيمة القديمة/الجديدة، مَن غيّر ومتى + سبب اختياري)
CREATE TABLE IF NOT EXISTS public.executive_control_changes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type varchar(10) NOT NULL CHECK (entity_type IN ('role', 'employee')),
    entity_id uuid NOT NULL,
    policy_key varchar(40) NOT NULL,
    old_value text,
    new_value text,
    changed_by uuid REFERENCES public.employees(id),
    reason text,
    changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_control_changes_entity
    ON public.executive_control_changes (entity_type, entity_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_control_changes_at
    ON public.executive_control_changes (changed_at DESC);

COMMENT ON TABLE public.executive_control_changes IS
    'سجل تدقيق لكل تغيير يطبَّق من نظام التحكم في شاشة الحضور والمتابعة (دور أو موظف).';

-- ---------------------------------------------------------------------------
-- 3) السياسة الفعّالة لكل موظف = override ∪ افتراضي الدور ∪ قيمة افتراضية نظامية
--    المصدر: employee_override | role_default | system_default
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
        'late_calculation_enabled',   COALESCE(o.late_calculation_enabled, r.late_calculation_enabled, true),
        'early_calculation_enabled',  COALESCE(o.early_calculation_enabled, r.early_calculation_enabled, true),
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
    'السياسة الفعّالة لموظف = التجاوز الفردي إن وُجد، وإلا افتراضي الدور، وإلا القيمة النظامية؛ مع إشارة المصدر.';

-- ---------------------------------------------------------------------------
-- 4) بذر الافتراضيات الموصى بها (بيانات قابلة للتعديل من الشاشة — ليست ترميزاً)
--    مندوب/مدير مبيعات: حضور ON، متابعة ON، مرن، بدون حساب تأخير/مبكر.
--    بقية الأدوار (مكتبية): حضور ON، متابعة OFF، ثابت، تأخير ON، مبكر ON.
-- ---------------------------------------------------------------------------
INSERT INTO public.executive_role_default_policy
    (role_id, attendance_enabled, follow_up_enabled, schedule_type, late_calculation_enabled, early_calculation_enabled, updated_by)
SELECT r.id, true, true, 'flexible', false, false, NULL
FROM public.roles r
WHERE r.name IN ('مندوب مبيعات', 'مدير البيع', 'موظف مبيعات')
ON CONFLICT (role_id) DO NOTHING;

INSERT INTO public.executive_role_default_policy
    (role_id, attendance_enabled, follow_up_enabled, schedule_type, late_calculation_enabled, early_calculation_enabled, updated_by)
SELECT r.id, true, false, 'fixed', true, true, NULL
FROM public.roles r
WHERE r.name NOT IN ('مندوب مبيعات', 'مدير البيع', 'موظف مبيعات')
ON CONFLICT (role_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5) قراءة سياسة التحكم (الإعدادات): الافتراضيات + الفعّال لكل موظف + التدقيق
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

    -- هذه الشاشة للإدارة العليا فقط (نفس المسند الكنسي دون استثناء المشرف التنفيذي).
    IF NOT EXISTS (
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id AND r.name = 'الإدارة العليا'
    ) THEN
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
                   (SELECT COUNT(*)::int FROM public.employees e
                    WHERE public.get_executive_effective_policy(e.id) IS NOT NULL
                      AND (SELECT er.role_id FROM public.employee_roles er
                           WHERE er.employee_id = e.id ORDER BY er.assigned_at ASC, er.id ASC LIMIT 1) = r.id
                      AND COALESCE(NULLIF(e.full_name, ''), e.code) IS NOT NULL) AS employee_count
            FROM public.roles r
            LEFT JOIN public.executive_role_default_policy d ON d.role_id = r.id
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
                       'early_calculation_enabled', o.early_calculation_enabled
                   ) ELSE NULL END AS override,
                   public.get_executive_effective_policy(e.id) AS effective
            FROM public.employees e
            LEFT JOIN public.executive_employee_schedule_override o ON o.employee_id = e.id
            WHERE e.id = ANY(v_visible)
        )
        SELECT jsonb_build_object(
            'error', NULL,
            'stats', jsonb_build_object(
                'roles_with_default', (SELECT COUNT(*)::int FROM public.executive_role_default_policy),
                'employee_overrides', (SELECT COUNT(*)::int FROM public.executive_employee_schedule_override),
                'attendance_monitored', (SELECT COUNT(*)::int FROM emp WHERE (emp.effective->>'attendance_enabled')::boolean),
                'follow_up_monitored', (SELECT COUNT(*)::int FROM emp WHERE (emp.effective->>'follow_up_enabled')::boolean),
                'flexible', (SELECT COUNT(*)::int FROM emp WHERE emp.effective->>'schedule_type' = 'flexible'),
                'fixed', (SELECT COUNT(*)::int FROM emp WHERE emp.effective->>'schedule_type' = 'fixed')
            ),
            'role_defaults', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'role_id', role_id, 'role_name', role_name,
                    'attendance_enabled', attendance_enabled, 'follow_up_enabled', follow_up_enabled,
                    'schedule_type', schedule_type,
                    'late_calculation_enabled', late_calculation_enabled,
                    'early_calculation_enabled', early_calculation_enabled,
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
                    'late_calculation_enabled', (effective->>'late_calculation_enabled')::boolean,
                    'early_calculation_enabled', (effective->>'early_calculation_enabled')::boolean,
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
-- 6) تعديل افتراضي الدور (مع تدقيق لكل ضابط تغيّر)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_executive_role_default(
    p_token uuid,
    p_role_id uuid,
    p_attendance_enabled boolean,
    p_follow_up_enabled boolean,
    p_schedule_type text,
    p_late_calculation_enabled boolean,
    p_early_calculation_enabled boolean,
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
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id AND r.name = 'الإدارة العليا'
    ) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF p_schedule_type NOT IN ('fixed', 'flexible') THEN
        RETURN jsonb_build_object('error', 'INVALID_SCHEDULE_TYPE', 'message', 'نوع الدوام يجب أن يكون fixed أو flexible.');
    END IF;

    SELECT r.name INTO v_role_name FROM public.roles r WHERE r.id = p_role_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ROLE_NOT_FOUND'); END IF;

    SELECT * INTO v_old FROM public.executive_role_default_policy WHERE role_id = p_role_id;

    INSERT INTO public.executive_role_default_policy AS t
        (role_id, attendance_enabled, follow_up_enabled, schedule_type, late_calculation_enabled, early_calculation_enabled, updated_by, updated_at)
    VALUES
        (p_role_id, p_attendance_enabled, p_follow_up_enabled, p_schedule_type, p_late_calculation_enabled, p_early_calculation_enabled, v_session.employee_id, now())
    ON CONFLICT (role_id) DO UPDATE SET
        attendance_enabled = EXCLUDED.attendance_enabled,
        follow_up_enabled = EXCLUDED.follow_up_enabled,
        schedule_type = EXCLUDED.schedule_type,
        late_calculation_enabled = EXCLUDED.late_calculation_enabled,
        early_calculation_enabled = EXCLUDED.early_calculation_enabled,
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
-- 7) تعديل/مسح تجاوز فردي للموظف (مع تدقيق على الفعّال قبل التغيير)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_executive_employee_override(
    p_token uuid,
    p_employee_id uuid,
    p_attendance_enabled boolean,
    p_follow_up_enabled boolean,
    p_schedule_type text,
    p_late_calculation_enabled boolean,
    p_early_calculation_enabled boolean,
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

    IF NOT EXISTS (
        SELECT 1 FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id AND r.name = 'الإدارة العليا'
    ) THEN
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
                'early_calculation_enabled', v_before->>'early_calculation_enabled'
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
        (employee_id, attendance_enabled, follow_up_enabled, schedule_type, late_calculation_enabled, early_calculation_enabled, updated_by, updated_at)
    VALUES
        (p_employee_id, p_attendance_enabled, p_follow_up_enabled, p_schedule_type, p_late_calculation_enabled, p_early_calculation_enabled, v_session.employee_id, now())
    ON CONFLICT (employee_id) DO UPDATE SET
        attendance_enabled = EXCLUDED.attendance_enabled,
        follow_up_enabled = EXCLUDED.follow_up_enabled,
        schedule_type = EXCLUDED.schedule_type,
        late_calculation_enabled = EXCLUDED.late_calculation_enabled,
        early_calculation_enabled = EXCLUDED.early_calculation_enabled,
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

    RETURN jsonb_build_object(
        'error', NULL, 'employee_id', p_employee_id, 'employee_name', v_emp_name,
        'cleared', false, 'changed_at', now(), 'changed_by', v_session.employee_id,
        'audit_rows', v_audit_rows
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.set_executive_employee_override TO authenticated;

-- إعادة تحميل مخطط PostgREST لرؤية الوظائف الجديدة فوراً
NOTIFY pgrst, 'reload schema';