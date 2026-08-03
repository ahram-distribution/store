-- ============================================================================
-- Skip guard for automatic tracking-point reconstruction
-- ============================================================================
-- Prevents running the (read-only but non-trivial) preview classification scan
-- on every page open. Once a workday has been reconstructed, an audit row
-- exists in tracking_rebuild_audits for (employee_id, workday_date), so the
-- client can skip preview + rebuild entirely for all future opens.
--
-- The rebuild flow therefore executes at most once per employee workday:
--   1. has_tracking_rebuild  -> audit exists? skip. Otherwise:
--   2. preview_rebuild_missing_tracking -> if to_create > 0:
--   3. rebuild_missing_tracking          -> writes the audit row.

CREATE OR REPLACE FUNCTION public.has_tracking_rebuild(
  p_token uuid,
  p_employee_id uuid,
  p_date date
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SESSION' USING errcode = 'P0001';
  END IF;

  IF NOT public.is_upper_management(v_session.employee_id)
     AND NOT public.check_capability(p_token, 'attendance.rebuild') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING errcode = 'P0001';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.tracking_rebuild_audits
    WHERE employee_id = p_employee_id
      AND workday_date = p_date
  );
END;
$function$;
