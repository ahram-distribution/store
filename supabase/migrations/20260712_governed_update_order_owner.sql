-- ============================================================================
-- governed_update_order_owner — نقل ملكية الطلب إلى موظف آخر (للمستخدمين من الإدارة العليا فقط)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_update_order_owner(
  p_token text,
  p_order_id uuid,
  p_new_owner_id uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_SESSION');
  END IF;

  IF NOT is_upper_management(v_session.employee_id) THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_new_owner_id) THEN
    RETURN json_build_object('success', false, 'error', 'الموظف غير موجود');
  END IF;

  UPDATE orders SET owner_id = p_new_owner_id WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'الطلب غير موجود');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;
