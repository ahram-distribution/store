-- ============================================================================
-- Fix check_capability(text, text) / (uuid, text) mismatch
-- 
-- المشكلة: PostgREST يُرسل الباراميترات كنصوص (text, text)
-- بينما الدالة معرفة بـ (p_token uuid, p_code text)
-- والحل: تغيير الدالة لتستقبل (text, text) مع cast داخلي
-- ============================================================================

-- 1. حذف كلا الإصدارين لتجنب التضارب
DROP FUNCTION IF EXISTS public.check_capability(p_token uuid, p_code text);
DROP FUNCTION IF EXISTS public.check_capability(p_token text, p_code text);

-- 2. إعادة تعريف check_capability بقبول (text, text) فقط
-- مع التعامل مع UUID داخلياً
CREATE OR REPLACE FUNCTION public.check_capability(p_token text, p_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_token uuid;
  v_session app.sessions;
  v_cap_id uuid;
  v_role_ids uuid[];
BEGIN
  -- Cast text to uuid
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN false; END IF;

  -- Upper management bypass
  IF public.is_upper_management(v_session.employee_id) THEN
    RETURN true;
  END IF;

  SELECT id INTO v_cap_id FROM capabilities WHERE code = p_code;
  IF v_cap_id IS NULL THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM employee_capabilities
    WHERE employee_id = v_session.employee_id AND capability_id = v_cap_id AND grant_type = 'grant'
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM employee_capabilities
    WHERE employee_id = v_session.employee_id AND capability_id = v_cap_id AND grant_type = 'deny'
  ) THEN RETURN false; END IF;

  SELECT array_agg(role_id) INTO v_role_ids FROM employee_roles WHERE employee_id = v_session.employee_id;
  IF v_role_ids IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM role_capabilities WHERE role_id = ANY(v_role_ids) AND capability_id = v_cap_id
  );
END;
$function$;

COMMENT ON FUNCTION public.check_capability(text, text) IS 'التحقق من صلاحية الموظف بناءً على الجلسة والكود (تقبل نص)';

-- 3. Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
