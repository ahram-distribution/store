CREATE OR REPLACE FUNCTION get_tracking_session_stats(
    p_token uuid,
    p_employee_id uuid DEFAULT NULL,
    p_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    employee_id uuid,
    employee_code text,
    employee_name text,
    session_id uuid,
    session_date date,
    start_time timestamptz,
    end_time timestamptz,
    duration_minutes int,
    expected_points int,
    captured_points int,
    capture_rate numeric
)
LANGUAGE plpgsql SECURITY DEFINER
AS $FUNC$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.sessions WHERE token = p_token AND expires_at > now()) THEN
        RAISE EXCEPTION 'invalid_token';
    END IF;

    RETURN QUERY
    SELECT
        e.id,
        e.code::text,
        e.full_name::text,
        ws.id,
        ws.date,
        ws.start_time,
        COALESCE(ws.end_time, now()),
        GREATEST(ROUND(EXTRACT(EPOCH FROM (COALESCE(ws.end_time, now()) - ws.start_time)) / 60)::int, 0),
        GREATEST(ROUND(EXTRACT(EPOCH FROM (COALESCE(ws.end_time, now()) - ws.start_time)) / 300)::int, 0),
        COALESCE(tp.cnt, 0)::int,
        CASE
            WHEN GREATEST(ROUND(EXTRACT(EPOCH FROM (COALESCE(ws.end_time, now()) - ws.start_time)) / 300)::int, 0) > 0
            THEN LEAST(ROUND(COALESCE(tp.cnt, 0)::numeric / GREATEST(ROUND(EXTRACT(EPOCH FROM (COALESCE(ws.end_time, now()) - ws.start_time)) / 300)::int, 1) * 100, 1), 100)::numeric
            ELSE 0::numeric
        END
    FROM workday_sessions ws
    JOIN employees e ON e.id = ws.employee_id
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS cnt
        FROM tracking_points tp
        WHERE tp.session_id = ws.id
    ) tp ON true
    WHERE (p_employee_id IS NULL OR ws.employee_id = p_employee_id)
      AND ws.date = p_date
    ORDER BY ws.start_time;
END;
$FUNC$;
