-- GPS diagnostic test table — no attendance/order data, diagnostics only
CREATE TABLE IF NOT EXISTS public.gps_test_points (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    latitude decimal(10,7) NOT NULL,
    longitude decimal(10,7) NOT NULL,
    accuracy_meters decimal(8,2),
    altitude_meters decimal(8,2),
    speed_mps decimal(6,2),
    heading_degrees decimal(5,1),
    device_info jsonb,
    captured_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gps_test_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY gps_test_points_insert ON public.gps_test_points
    FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY gps_test_points_select ON public.gps_test_points
    FOR SELECT TO authenticated
    USING (true);

GRANT INSERT, SELECT ON public.gps_test_points TO authenticated;

-- Simple RPC for inserting a test point from the diagnostic page
CREATE OR REPLACE FUNCTION public.insert_gps_test_point(
    p_latitude decimal,
    p_longitude decimal,
    p_accuracy decimal DEFAULT NULL,
    p_altitude decimal DEFAULT NULL,
    p_speed decimal DEFAULT NULL,
    p_heading decimal DEFAULT NULL,
    p_device_info jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO public.gps_test_points (
        latitude, longitude, accuracy_meters, altitude_meters,
        speed_mps, heading_degrees, device_info
    ) VALUES (
        p_latitude, p_longitude, p_accuracy, p_altitude,
        p_speed, p_heading, p_device_info
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'success', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.insert_gps_test_point TO authenticated;

NOTIFY pgrst, 'reload schema';
