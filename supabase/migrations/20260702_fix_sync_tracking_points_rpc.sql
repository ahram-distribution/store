-- Fix sync_tracking_points RPC to handle both jsonb array and jsonb string inputs
-- When p_points is a JSON string (double-encoded), parse it first before iterating

CREATE OR REPLACE FUNCTION public.sync_tracking_points(
    p_token uuid,
    p_session_id uuid,
    p_points jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_points_arr jsonb;
    v_point jsonb;
    v_synced int := 0;
    v_rejected int := 0;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    IF NOT EXISTS (SELECT 1 FROM public.workday_sessions
        WHERE id = p_session_id AND employee_id = v_employee_id) THEN
        RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
    END IF;

    -- Handle both native jsonb array and double-encoded JSON string
    IF jsonb_typeof(p_points) = 'string' THEN
        v_points_arr := p_points::jsonb;
    ELSE
        v_points_arr := p_points;
    END IF;

    FOR v_point IN SELECT * FROM jsonb_array_elements(v_points_arr)
    LOOP
        BEGIN
            IF v_point->>'latitude' IS NULL OR v_point->>'longitude' IS NULL
               OR (v_point->>'latitude')::decimal IS NULL
               OR (v_point->>'longitude')::decimal IS NULL THEN
                v_rejected := v_rejected + 1;
                CONTINUE;
            END IF;
            INSERT INTO public.tracking_points (
                session_id, employee_id, latitude, longitude,
                accuracy_meters, altitude_meters, speed_mps, heading_degrees,
                battery_pct, recorded_at, point_type
            ) VALUES (
                p_session_id, v_employee_id,
                (v_point->>'latitude')::decimal,
                (v_point->>'longitude')::decimal,
                (v_point->>'accuracy_meters')::decimal,
                (v_point->>'altitude_meters')::decimal,
                (v_point->>'speed_mps')::decimal,
                (v_point->>'heading_degrees')::decimal,
                (v_point->>'battery_pct')::decimal,
                (v_point->>'recorded_at')::timestamptz,
                COALESCE(v_point->>'point_type', 'periodic')
            );
            v_synced := v_synced + 1;
        EXCEPTION WHEN OTHERS THEN
            v_rejected := v_rejected + 1;
        END;
    END LOOP;

    RETURN jsonb_build_object('synced', v_synced, 'rejected', v_rejected);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sync_tracking_points TO authenticated;
