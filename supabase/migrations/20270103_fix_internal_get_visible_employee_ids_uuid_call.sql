-- ============================================================================
-- Migration 20270103: إضافة wrapper لدالة get_visible_employee_ids الذي يستقبل uuid
-- ============================================================================

-- حذف أولاً ثم إعادة الإنشاء
DROP FUNCTION IF EXISTS public.get_visible_employee_ids(p_token uuid);

CREATE OR REPLACE FUNCTION public.get_visible_employee_ids(p_token uuid)
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT public.get_visible_employee_ids(p_token::text);
$$;

COMMENT ON FUNCTION public.get_visible_employee_ids IS 'Wrapper للتوافق العكسي — يحول uuid إلى text ويفوض إلى الدالة الأساسية';
