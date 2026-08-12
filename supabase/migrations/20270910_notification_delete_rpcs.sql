-- Notification delete RPCs (clear all / multi-select delete)
-- Follows the same SECURITY DEFINER + session-token pattern as 20270805_notification_system_v1.sql

-- Delete selected notifications (multi-delete)
CREATE OR REPLACE FUNCTION public.delete_my_notifications(
  p_token uuid,
  p_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session app.sessions;
  v_deleted integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  DELETE FROM public.notifications
  WHERE recipient_employee_id = v_session.employee_id AND id = ANY(p_ids);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'deleted', v_deleted);
END;
$$;


-- Delete all my notifications
CREATE OR REPLACE FUNCTION public.delete_all_my_notifications(
  p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session app.sessions;
  v_deleted integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  DELETE FROM public.notifications
  WHERE recipient_employee_id = v_session.employee_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'deleted', v_deleted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_my_notifications TO anon;
GRANT EXECUTE ON FUNCTION public.delete_all_my_notifications TO anon;
