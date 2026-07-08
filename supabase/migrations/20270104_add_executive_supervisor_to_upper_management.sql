-- ============================================================================
-- Migration 20270104: إضافة Executive Supervisor إلى is_upper_management
-- ============================================================================
-- المشكلة:
--   دور "مشرف تنفيذي" (Executive Supervisor) غير معترف به في is_upper_management
--   مما يؤدي إلى FORBIDDEN عند محاولة فتح تفاصيل الطلب
--
-- الحل:
--   إضافة الدورين "مشرف تنفيذي" و "الإدارة العليا" إلى شرط التحقق
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_upper_management(p_employee_id UUID DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_employee_id UUID;
BEGIN
  IF p_employee_id IS NOT NULL THEN
    v_employee_id := p_employee_id;
  ELSE
    SELECT id INTO v_employee_id FROM employees WHERE identity_id = auth.uid();
    IF v_employee_id IS NULL THEN RETURN false; END IF;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM employee_roles er
    JOIN roles r ON r.id = er.role_id
    WHERE er.employee_id = v_employee_id
    AND (r.name = 'الإدارة العليا' OR r.name = 'مشرف تنفيذي')
  );
END;
$$;

COMMENT ON FUNCTION public.is_upper_management IS 'التحقق مما إذا كان الموظف من الإدارة العليا أو مشرف تنفيذي';
