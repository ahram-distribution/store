-- Reference data RPCs for the structured address system
-- These allow the frontend to populate governorate/city selectors

-- ============================================================
-- get_reference_governorates — load all governorates
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_reference_governorates(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $FUNC$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    RETURN COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
            'id', id, 'code', code, 'name_ar', name_ar, 'latitude', latitude, 'longitude', longitude
        ) ORDER BY name_ar) FROM reference_governorates),
        '[]'::jsonb
    );
END;
$FUNC$;

GRANT EXECUTE ON FUNCTION public.get_reference_governorates TO anon;
GRANT EXECUTE ON FUNCTION public.get_reference_governorates TO authenticated;

-- ============================================================
-- get_reference_cities — load cities for a given governorate
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_reference_cities(p_token uuid, p_governorate_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $FUNC$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    RETURN COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
            'id', id, 'code', code, 'name_ar', name_ar, 'governorate_id', governorate_id, 'latitude', latitude, 'longitude', longitude
        ) ORDER BY name_ar)
        FROM reference_cities
        WHERE p_governorate_id IS NULL OR governorate_id = p_governorate_id),
        '[]'::jsonb
    );
END;
$FUNC$;

GRANT EXECUTE ON FUNCTION public.get_reference_cities TO anon;
GRANT EXECUTE ON FUNCTION public.get_reference_cities TO authenticated;
