-- Executive attendance follow-up: detailed tracking points.
-- Business dates are evaluated in Cairo inside the function; the database-wide
-- timezone remains unchanged.

CREATE OR REPLACE FUNCTION public.get_executive_tracking_points(
    p_token uuid,
    p_employee_id uuid,
    p_date date DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
SET timezone TO 'Africa/Cairo'
AS $fn$
DECLARE
    v_session app.sessions;
    v_visible uuid[];
BEGIN
    SELECT * INTO v_session
    FROM app.sessions
    WHERE token = p_token AND expires_at > now();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'INVALID_SESSION');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.employee_roles er
        JOIN public.roles r ON r.id = er.role_id
        WHERE er.employee_id = v_session.employee_id
          AND r.name = 'الإدارة العليا'
    ) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    v_visible := public.get_visible_employee_ids(v_session.token::text);
    IF v_visible IS NULL OR array_length(v_visible, 1) IS NULL THEN
        RETURN jsonb_build_object('error', 'NO_VISIBLE_EMPLOYEES');
    END IF;

    IF NOT (p_employee_id = ANY(v_visible))
       OR public.executive_followup_classification(p_employee_id) <> 'workforce' THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    RETURN jsonb_build_object(
        'error', NULL,
        'date', p_date,
        'employee_id', p_employee_id,
        'points', COALESCE((
            WITH day_points AS (
                SELECT tp.*,
                       ROW_NUMBER() OVER (ORDER BY tp.recorded_at DESC) = 1 AS is_last_seen
                FROM public.tracking_points tp
                WHERE tp.employee_id = p_employee_id
                  AND (tp.recorded_at AT TIME ZONE 'Africa/Cairo')::date = p_date
                  AND tp.latitude IS NOT NULL
                  AND tp.longitude IS NOT NULL
            )
            SELECT jsonb_agg(jsonb_build_object(
                'id', tp.id,
                'recorded_at', tp.recorded_at,
                'point_type', tp.point_type,
                'event_type', CASE
                    WHEN vl.visit_id IS NOT NULL AND vl.checkin_tracking_point_id = tp.id THEN 'visit_checkin'
                    WHEN vl.visit_id IS NOT NULL AND vl.checkout_tracking_point_id = tp.id THEN 'visit_checkout'
                    WHEN tp.point_type IN ('periodic', 'heartbeat', 'app_resume', 'app_open') THEN 'last_seen'
                    WHEN tp.point_type = 'start' THEN 'workday_start'
                    WHEN tp.point_type = 'end' THEN 'workday_end'
                    WHEN tp.point_type = 'long_stop' THEN 'long_stop'
                    WHEN tp.point_type = 'manual' THEN 'manual'
                    ELSE tp.point_type
                END,
                'event_label', CASE
                    WHEN vl.visit_id IS NOT NULL AND vl.checkin_tracking_point_id = tp.id THEN 'دخول زيارة'
                    WHEN vl.visit_id IS NOT NULL AND vl.checkout_tracking_point_id = tp.id THEN 'خروج من زيارة'
                    WHEN tp.point_type IN ('periodic', 'heartbeat', 'app_resume', 'app_open') THEN 'آخر ظهور'
                    WHEN tp.point_type = 'start' THEN 'بداية يوم العمل'
                    WHEN tp.point_type = 'end' THEN 'نهاية يوم العمل'
                    WHEN tp.point_type = 'long_stop' THEN 'توقف طويل'
                    WHEN tp.point_type = 'manual' THEN 'تسجيل موقع يدوي'
                    ELSE COALESCE(tp.point_type, 'نقطة تتبع')
                END,
                'event_name', CASE WHEN vl.visit_id IS NOT NULL
                    THEN COALESCE(NULLIF(c.company_name, ''), c.code) ELSE NULL END,
                'event_details', CASE WHEN vl.visit_id IS NOT NULL THEN concat_ws(' - ',
                    NULLIF(v.code, ''), NULLIF(v.status, ''), NULLIF(v.visit_result, '')) ELSE NULL END,
                'is_last_seen', tp.is_last_seen,
                'latitude', tp.latitude,
                'longitude', tp.longitude,
                'accuracy_meters', tp.accuracy_meters,
                'speed_mps', tp.speed_mps,
                'heading_degrees', tp.heading_degrees
            ) ORDER BY tp.recorded_at DESC)
            FROM day_points tp
            LEFT JOIN public.visit_links vl
              ON vl.checkin_tracking_point_id = tp.id OR vl.checkout_tracking_point_id = tp.id
            LEFT JOIN public.visits v ON v.id = vl.visit_id
            LEFT JOIN public.customers c ON c.id = v.customer_id
        ), '[]'::jsonb)
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_executive_tracking_points TO authenticated;

NOTIFY pgrst, 'reload schema';
