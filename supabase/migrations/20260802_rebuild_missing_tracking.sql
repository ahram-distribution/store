-- ============================================================================
-- Rebuild Missing Tracking Points — Administrative Maintenance Tool
-- ============================================================================
-- Purpose: safely rebuild MISSING tracking points for a previous workday
-- from existing business events only. Intended for repairing historical
-- tracking data. NEVER creates fake periodic points and NEVER invents
-- timestamps, locations or movement.
--
-- Data sources (each reconstructed point comes from a real stored event):
--   * Start Workday            (workday_sessions.start_time + GPS)
--   * End Workday              (workday_sessions.end_time + GPS)
--   * Visit Check-in           (visits.check_in_at + GPS)
--   * Visit Check-out          (visits.check_out_at + GPS)
--   * Customer Created         (customers.created_at + unified_locations GPS)
--   * Customer Location Updated (unified_locations.captured_at + GPS)
--
-- Every reconstructed point:
--   * is marked point_type = 'reconstructed_from_business_events'
--     (so it is distinguishable from periodic/business/app points),
--   * preserves the ORIGINAL timestamp / latitude / longitude / accuracy,
--   * is inserted through the existing centralized deduplication helper
--     public.ensure_tracking_point() (no duplicates, idempotent),
--   * only if a workday session exists and no tracking point already covers
--     the same event (same session, within ~60s, within ~1m).
--
-- The tool is two RPCs: a read-only PREVIEW (writes nothing) and an EXECUTE
-- that requires explicit admin confirmation and records an audit entry.
-- It never modifies Attendance / Visits / Customers / Inventory / Orders /
-- Reservations. It only inserts tracking points.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Allow the new reconstruction marker in tracking_points.point_type
-- ----------------------------------------------------------------------------
-- point_type was varchar(20); 'reconstructed_from_business_events' is longer.
ALTER TABLE public.tracking_points
  ALTER COLUMN point_type TYPE varchar(40);

ALTER TABLE public.tracking_points
  DROP CONSTRAINT IF EXISTS tracking_points_point_type_check;

ALTER TABLE public.tracking_points
  ADD CONSTRAINT tracking_points_point_type_check
  CHECK (point_type IN (
    'periodic', 'start', 'end',
    'visit_checkin', 'visit_checkout',
    'long_stop', 'manual',
    'customer_created', 'customer_location_updated',
    'app_resume',
    'reconstructed_from_business_events'
  ));

-- ----------------------------------------------------------------------------
-- 2. Audit trail for every rebuild execution
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracking_rebuild_audits (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_employee_id         uuid NOT NULL,
  admin_identity_id         uuid,
  employee_id               uuid NOT NULL,
  workday_date              date NOT NULL,
  session_id                uuid,
  existing_tracking_points  int  NOT NULL DEFAULT 0,
  business_events           jsonb NOT NULL DEFAULT '{}',
  points_created            int  NOT NULL DEFAULT 0,
  points_skipped            int  NOT NULL DEFAULT 0,
  skips_breakdown           jsonb NOT NULL DEFAULT '{}',
  executed_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_rebuild_audits_emp_date
  ON public.tracking_rebuild_audits (employee_id, workday_date DESC);

-- ----------------------------------------------------------------------------
-- 3. Capability: attendance.rebuild (granted to upper management / supervisor)
-- ----------------------------------------------------------------------------
INSERT INTO public.capabilities (code, name, description, "group")
VALUES (
  'attendance.rebuild',
  'إعادة بناء نقاط التتبع',
  'إعادة إنشاء نقاط التتبع المفقودة من الأحداث التجارية لأيام سابقة',
  'attendance'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_capabilities (role_id, capability_id)
SELECT r.id, cap.id
FROM public.roles r
CROSS JOIN public.capabilities cap
WHERE r.name IN ('الإدارة العليا', 'مشرف تنفيذي')
  AND cap.code = 'attendance.rebuild'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_capabilities rc
    WHERE rc.role_id = r.id AND rc.capability_id = cap.id
  );

-- Direct grants for the historical upper-management employees
-- (same pattern as the attendance capabilities grant).
INSERT INTO public.employee_capabilities (employee_id, capability_id, grant_type, assigned_by)
SELECT e.id, cap.id, 'grant', e.id
FROM public.employees e
CROSS JOIN public.capabilities cap
WHERE e.code = ANY(ARRAY['ADMIN-001', 'WRQ1002', 'WRQ1003', 'WRQ1004'])
  AND cap.code = 'attendance.rebuild'
  AND NOT EXISTS (
    SELECT 1 FROM public.employee_capabilities ec
    WHERE ec.employee_id = e.id AND ec.capability_id = cap.id
  );

-- ----------------------------------------------------------------------------
-- 4. Internal helper: candidate business events for (employee, date)
--    Each row = one reconstructable event: session + source + ORIGINAL
--    timestamp + ORIGINAL coordinates. Never synthesizes anything.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rebuild_candidate_events(
  p_employee_id uuid,
  p_date date
)
RETURNS TABLE (
  session_id uuid,
  source text,
  event_time timestamptz,
  latitude numeric,
  longitude numeric,
  accuracy_meters numeric
)
LANGUAGE sql
STABLE
AS $function$
  WITH wds AS (
    SELECT id, start_time, end_time, last_seen_at,
           COALESCE(end_time, last_seen_at, start_time) AS window_end,
           start_latitude, start_longitude, end_latitude, end_longitude
    FROM public.workday_sessions
    WHERE employee_id = p_employee_id AND date = p_date
      AND status IN ('active', 'completed')
  )
  SELECT DISTINCT q.*
  FROM (
    -- Start Workday
    SELECT ws.id AS session_id, 'start_workday'::text AS source,
           ws.start_time AS event_time,
           ws.start_latitude::numeric AS latitude,
           ws.start_longitude::numeric AS longitude,
           NULL::numeric AS accuracy_meters
    FROM wds ws
    UNION ALL
    -- End Workday
    SELECT ws.id, 'end_workday'::text, ws.end_time,
           ws.end_latitude::numeric, ws.end_longitude::numeric, NULL::numeric
    FROM wds ws
    WHERE ws.end_time IS NOT NULL
    UNION ALL
    -- Visit Check-in
    SELECT w.id, 'visit_checkin'::text, v.check_in_at,
           v.check_in_latitude::numeric, v.check_in_longitude::numeric, NULL::numeric
    FROM public.visits v
    JOIN wds w ON v.employee_id = p_employee_id
              AND v.check_in_at >= w.start_time
              AND v.check_in_at <= w.window_end
    WHERE v.check_in_at::date = p_date
    UNION ALL
    -- Visit Check-out
    SELECT w.id, 'visit_checkout'::text, v.check_out_at,
           v.check_out_latitude::numeric, v.check_out_longitude::numeric, NULL::numeric
    FROM public.visits v
    JOIN wds w ON v.employee_id = p_employee_id
              AND v.check_out_at >= w.start_time
              AND v.check_out_at <= w.window_end
    WHERE v.check_out_at IS NOT NULL AND v.check_out_at::date = p_date
    UNION ALL
    -- Customer Created (with GPS)
    SELECT w.id, 'customer_created'::text, c.created_at,
           ul.latitude::numeric, ul.longitude::numeric, ul.accuracy_meters::numeric
    FROM public.customers c
    JOIN public.unified_locations ul ON ul.id = c.location_id
    JOIN wds w ON c.created_at >= w.start_time AND c.created_at <= w.window_end
    WHERE c.owner_type = 'employee' AND c.owner_id = p_employee_id
      AND c.created_at::date = p_date
      AND ul.latitude IS NOT NULL AND ul.longitude IS NOT NULL
    UNION ALL
    -- Customer Location Updated (captured_at inside the workday window,
    -- customer NOT created that same day — avoids double counting creation)
    SELECT w.id, 'customer_location_updated'::text, ul.captured_at,
           ul.latitude::numeric, ul.longitude::numeric, ul.accuracy_meters::numeric
    FROM public.customers c
    JOIN public.unified_locations ul ON ul.id = c.location_id
    JOIN wds w ON ul.captured_at >= w.start_time AND ul.captured_at <= w.window_end
    WHERE c.owner_type = 'employee' AND c.owner_id = p_employee_id
      AND c.created_at::date <> p_date
      AND ul.latitude IS NOT NULL AND ul.longitude IS NOT NULL
  ) q
$function$;

-- Private helper: only callable by the owning (definer) role — never exposed
-- to anon/authenticated through PostgREST (would leak employees' business events).
REVOKE ALL ON FUNCTION public._rebuild_candidate_events(uuid, date) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. PREVIEW — read only. Writes NOTHING.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_rebuild_missing_tracking(
  p_token uuid,
  p_employee_id uuid,
  p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_employee record;
  v_existing int := 0;
  v_events_found int := 0;
  v_to_create int := 0;
  v_missing_gps int := 0;
  v_already_tracked int := 0;
  v_business_events jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.is_upper_management(v_session.employee_id)
     AND NOT public.check_capability(p_token, 'attendance.rebuild') THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT full_name, code INTO v_employee FROM public.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'EMPLOYEE_NOT_FOUND'); END IF;

  -- Existing tracking points for the employee on that date (all sources).
  SELECT count(*) INTO v_existing
  FROM public.tracking_points tp
  JOIN public.workday_sessions ws ON ws.id = tp.session_id
  WHERE ws.employee_id = p_employee_id AND ws.date = p_date;

  -- Classify every candidate event.
  SELECT count(*),
         count(*) FILTER (WHERE status = 'to_create'),
         count(*) FILTER (WHERE status = 'missing_gps'),
         count(*) FILTER (WHERE status = 'already_tracked')
  INTO v_events_found, v_to_create, v_missing_gps, v_already_tracked
  FROM (
    WITH ev AS (
      SELECT e.* FROM public._rebuild_candidate_events(p_employee_id, p_date) e
    )
    SELECT e.source,
      CASE
        WHEN e.latitude IS NULL OR e.longitude IS NULL THEN 'missing_gps'
        WHEN EXISTS (
          SELECT 1 FROM public.tracking_points tp
          WHERE tp.session_id = e.session_id
            AND abs(EXTRACT(EPOCH FROM (tp.recorded_at - e.event_time))) < 60
            AND abs(tp.latitude - e.latitude) < 0.00001
            AND abs(tp.longitude - e.longitude) < 0.00001
        ) THEN 'already_tracked'
        ELSE 'to_create'
      END AS status
    FROM ev e
  ) classified;

  SELECT COALESCE(jsonb_object_agg(source, cnt), '{}'::jsonb) INTO v_business_events
  FROM (
    WITH ev AS (
      SELECT e.* FROM public._rebuild_candidate_events(p_employee_id, p_date) e
    )
    SELECT source, count(*) AS cnt FROM ev GROUP BY source
  ) g;

  RETURN jsonb_build_object(
    'employee_id', p_employee_id,
    'employee_name', v_employee.full_name,
    'employee_code', v_employee.code,
    'date', p_date,
    'existing_tracking_points', v_existing,
    'events_found', v_events_found,
    'business_events', v_business_events,
    'to_create', v_to_create,
    'skipped', v_missing_gps + v_already_tracked,
    'skips_breakdown', jsonb_build_object(
      'missing_gps', v_missing_gps,
      'already_tracked', v_already_tracked
    )
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6. EXECUTE — rebuild missing points + audit. Requires explicit confirmation
--    (client only calls this after the user confirms the preview).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rebuild_missing_tracking(
  p_token uuid,
  p_employee_id uuid,
  p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_employee record;
  v_existing int := 0;
  v_events_found int := 0;
  v_created int := 0;
  v_skipped_gps int := 0;
  v_skipped_tracked int := 0;
  v_skipped_dedup int := 0;
  v_business_events jsonb := '{}'::jsonb;
  v_event record;
  v_audit_id bigint;
  v_inserted boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.is_upper_management(v_session.employee_id)
     AND NOT public.check_capability(p_token, 'attendance.rebuild') THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT full_name, code INTO v_employee FROM public.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'EMPLOYEE_NOT_FOUND'); END IF;

  -- Existing tracking points before the rebuild.
  SELECT count(*) INTO v_existing
  FROM public.tracking_points tp
  JOIN public.workday_sessions ws ON ws.id = tp.session_id
  WHERE ws.employee_id = p_employee_id AND ws.date = p_date;

  FOR v_event IN
    SELECT * FROM public._rebuild_candidate_events(p_employee_id, p_date)
  LOOP
    v_events_found := v_events_found + 1;

    -- Events without GPS are skipped (never invented).
    IF v_event.latitude IS NULL OR v_event.longitude IS NULL THEN
      v_skipped_gps := v_skipped_gps + 1;
      CONTINUE;
    END IF;

    -- Do not duplicate an event that is already covered by ANY tracking point
    -- (periodic, business, or previously reconstructed).
    IF EXISTS (
      SELECT 1 FROM public.tracking_points tp
      WHERE tp.session_id = v_event.session_id
        AND abs(EXTRACT(EPOCH FROM (tp.recorded_at - v_event.event_time))) < 60
        AND abs(tp.latitude - v_event.latitude) < 0.00001
        AND abs(tp.longitude - v_event.longitude) < 0.00001
    ) THEN
      v_skipped_tracked := v_skipped_tracked + 1;
      CONTINUE;
    END IF;

    -- Insert through the centralized dedup helper (idempotent, never raises).
    v_inserted := public.ensure_tracking_point(
      p_employee_id   := p_employee_id,
      p_session_id    := v_event.session_id,
      p_latitude      := v_event.latitude,
      p_longitude     := v_event.longitude,
      p_accuracy_meters := v_event.accuracy_meters,
      p_altitude_meters := NULL,
      p_speed_mps     := NULL,
      p_heading_degrees := NULL,
      p_battery_pct   := NULL,
      p_recorded_at   := v_event.event_time,
      p_point_type    := 'reconstructed_from_business_events'
    );

    IF v_inserted THEN
      v_created := v_created + 1;
    ELSE
      v_skipped_dedup := v_skipped_dedup + 1;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(source, cnt), '{}'::jsonb) INTO v_business_events
  FROM (
    WITH ev AS (
      SELECT e.* FROM public._rebuild_candidate_events(p_employee_id, p_date) e
    )
    SELECT source, count(*) AS cnt FROM ev GROUP BY source
  ) g;

  INSERT INTO public.tracking_rebuild_audits (
    admin_employee_id, admin_identity_id, employee_id, workday_date, session_id,
    existing_tracking_points, business_events, points_created, points_skipped, skips_breakdown
  ) VALUES (
    v_session.employee_id,
    v_session.identity_id,
    p_employee_id,
    p_date,
    (SELECT id FROM public.workday_sessions
     WHERE employee_id = p_employee_id AND date = p_date
     ORDER BY start_time DESC LIMIT 1),
    v_existing,
    v_business_events,
    v_created,
    v_skipped_gps + v_skipped_tracked + v_skipped_dedup,
    jsonb_build_object(
      'missing_gps', v_skipped_gps,
      'already_tracked', v_skipped_tracked,
      'deduplicated', v_skipped_dedup
    )
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', p_employee_id,
    'employee_name', v_employee.full_name,
    'date', p_date,
    'existing_tracking_points', v_existing,
    'events_found', v_events_found,
    'business_events', v_business_events,
    'points_created', v_created,
    'points_skipped', v_skipped_gps + v_skipped_tracked + v_skipped_dedup,
    'skips_breakdown', jsonb_build_object(
      'missing_gps', v_skipped_gps,
      'already_tracked', v_skipped_tracked,
      'deduplicated', v_skipped_dedup
    ),
    'audit_id', v_audit_id
  );
END;
$function$;
