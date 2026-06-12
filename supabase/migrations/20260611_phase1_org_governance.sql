-- Phase 1: Organizational Structure, Visibility, and Governance
-- Freeze the approved hierarchy. Register attendance capability codes.
-- Grant equivalent capabilities to all 4 upper management employees.
-- All belong to الإدارة العليا — same screens, same visibility, same permissions.

-- ============================================================================
-- 1. Register attendance capability codes
-- ============================================================================

INSERT INTO public.capabilities (code, name, description, "group")
VALUES
  ('attendance.configure', 'إعدادات الحضور', 'تعديل إعدادات الحضور والانصراف', 'attendance'),
  ('attendance.live_monitor', 'المتابعة الحية', 'مشاهدة المتابعة الحية للموظفين', 'attendance'),
  ('attendance.view_timeline', 'عرض خريطة اليوم', 'مشاهدة الجدول الزمني والمسار للموظف', 'attendance'),
  ('attendance.view_history', 'سجل الأيام', 'مشاهدة سجل أيام العمل', 'attendance'),
  ('attendance.view_reports', 'التقارير', 'مشاهدة تقارير الحضور والانصراف', 'attendance'),
  ('attendance.view_alerts', 'التنبيهات', 'مشاهدة تنبيهات الحضور', 'attendance'),
  ('attendance.view_team_map', 'خريطة الفريق', 'مشاهدة خريطة الفريق', 'attendance'),
  ('attendance.view_all', 'رؤية كاملة', 'تجاوز نطاق الملكية ومشاهدة كل الموظفين', 'attendance'),
  ('attendance.cleanup', 'تنظيف البيانات', 'حذف بيانات التتبع القديمة', 'attendance')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 2. Grant all attendance capabilities to upper management employees
--    ياسر توفيق (ADMIN-001 / WRQ1006) — سوبر أدمن
--    محمد سعيد (WRQ1003) — رئيس مجلس الإدارة
--    علي سعيد (WRQ1002) — مدير تنفيذي
--    محمود سعيد (WRQ1004) — مدير تنفيذي
--    All four belong to الإدارة العليا — identical capabilities
-- ============================================================================

DO $$
DECLARE
  v_emp_record RECORD;
  v_cap_record RECORD;
  v_attendance_cap_codes text[] := ARRAY[
    'attendance.configure',
    'attendance.live_monitor',
    'attendance.view_timeline',
    'attendance.view_history',
    'attendance.view_reports',
    'attendance.view_alerts',
    'attendance.view_team_map',
    'attendance.view_all',
    'attendance.cleanup'
  ];
  v_upper_mgmt_codes text[] := ARRAY['ADMIN-001', 'WRQ1003', 'WRQ1002', 'WRQ1004'];
BEGIN
  FOR v_emp_record IN SELECT id FROM public.employees WHERE code = ANY(v_upper_mgmt_codes)
  LOOP
    FOR v_cap_record IN SELECT id FROM public.capabilities WHERE code = ANY(v_attendance_cap_codes)
    LOOP
      INSERT INTO public.employee_capabilities (employee_id, capability_id, grant_type, assigned_by)
      VALUES (v_emp_record.id, v_cap_record.id, 'grant', v_emp_record.id)
      ON CONFLICT (employee_id, capability_id) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;
