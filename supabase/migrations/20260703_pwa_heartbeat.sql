-- PWA Heartbeat: lightweight function that updates last_seen_at in workday_sessions
-- without inserting a tracking_point row. Used by heartbeatService.ts and SW background sync.
-- This runs every 60s while the workday session is active.

CREATE OR REPLACE FUNCTION public.record_heartbeat(
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
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    UPDATE public.workday_sessions
    SET last_seen_at = now()
    WHERE id = p_session_id AND employee_id = v_employee_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_heartbeat TO authenticated;
