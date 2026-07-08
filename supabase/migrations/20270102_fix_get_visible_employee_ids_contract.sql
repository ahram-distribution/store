-- ============================================================================
-- Migration 20270102: توحيد عقد get_visible_employee_ids — إزالة جميع الـ overloads
-- ============================================================================
-- PUBLIC RPC CONTRACT RULE (مستمر من 20270101)
--
-- أي RPC يستقبل من PostgREST يستخدم p_token text فقط.
-- التحويل إلى uuid يتم مرة واحدة داخل الدالة.
--
-- السبب:
--   PostgREST يُرسل جميع الباراميترات كنصوص (JSON → text)
--   وجود overloads متعددة يسبب PGRST203 (ambiguous function)
--
-- الإصلاح:
--   1. حذف جميع overloads القديمة
--   2. إنشاء تعريف واحد: get_visible_employee_ids(p_token text)
--   3. تحويل p_token::uuid عند البوابة
-- ============================================================================

-- ============================================================================
-- 1. حذف جميع overloads الحالية
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_visible_employee_ids(p_token text);
DROP FUNCTION IF EXISTS public.get_visible_employee_ids(p_token uuid);

-- ============================================================================
-- 2. الإنشاء الموحد — Signature واحد فقط (text)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_visible_employee_ids(p_token text)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token uuid := p_token::uuid;
  v_session app.sessions;
  v_result uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
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
$$;

COMMENT ON FUNCTION public.get_visible_employee_ids IS 'مصدر الحقيقة للأقسام المرئية — Signature واحد: (p_token text)';
