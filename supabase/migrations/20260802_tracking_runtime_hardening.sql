-- ============================================================================
-- Tracking Runtime Hardening
-- ============================================================================
-- Objective: an employee's real movement must never disappear from the
-- tracking timeline because the periodic tracking engine stopped.
--
-- Three independent tracking sources feed ONE timeline:
--   1. Periodic tracking (existing client engine)            -> point_type 'periodic'
--   2. Business GPS events (visits / customers / attendance) -> point_type
--      'start', 'end', 'visit_checkin', 'visit_checkout',
--      'customer_created', 'customer_location_updated'
--   3. Application activity recovery (app open / resume)     -> point_type 'app_resume'
--
-- Every tracking writer passes through ONE shared helper
-- public.ensure_tracking_point() which:
--   * resolves the active workday session (or accepts an explicit session),
--   * applies the centralized server-authoritative deduplication policy,
--   * logs an internal diagnostic when a point is skipped because no active
--     workday exists,
--   * never raises (tracking must never block a business operation).
--
-- Business workflows, Attendance, Visit, Customer and Timeline behavior are
-- unchanged. Tracking point creation is strictly additive.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extend tracking_points.point_type to support business/activity sources
-- ----------------------------------------------------------------------------
ALTER TABLE public.tracking_points
  DROP CONSTRAINT IF EXISTS tracking_points_point_type_check;

ALTER TABLE public.tracking_points
  ADD CONSTRAINT tracking_points_point_type_check
  CHECK (point_type IN (
    'periodic', 'start', 'end',
    'visit_checkin', 'visit_checkout',
    'long_stop', 'manual',
    'customer_created', 'customer_location_updated',
    'app_resume'
  ));

-- ----------------------------------------------------------------------------
-- 2. Internal diagnostics: tracking points skipped because no active workday
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracking_point_skips (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id      uuid NOT NULL,
  point_type       text NOT NULL,
  latitude         numeric,
  longitude        numeric,
  accuracy_meters  numeric,
  recorded_at      timestamptz NOT NULL,
  reason           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tp_skips_employee_rec
  ON public.tracking_point_skips (employee_id, recorded_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Shared tracking writer: resolve session, deduplicate, insert, never raise
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_tracking_point(
  p_employee_id uuid,
  p_session_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric DEFAULT NULL,
  p_altitude_meters numeric DEFAULT NULL,
  p_speed_mps numeric DEFAULT NULL,
  p_heading_degrees numeric DEFAULT NULL,
  p_battery_pct numeric DEFAULT NULL,
  p_recorded_at timestamptz DEFAULT now(),
  p_point_type text DEFAULT 'periodic'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session_id uuid;
BEGIN
  -- Tracking must never block / fail the calling business operation.
  BEGIN
    IF p_employee_id IS NULL OR p_latitude IS NULL OR p_longitude IS NULL THEN
      RETURN false;
    END IF;

    -- Resolve the workday session: explicit (client-provided) else the current
    -- active one. 'inactive_warning' is still the running workday.
    IF p_session_id IS NULL THEN
      SELECT id INTO v_session_id
      FROM public.workday_sessions
      WHERE employee_id = p_employee_id
        AND status IN ('active', 'inactive_warning')
      ORDER BY start_time DESC
      LIMIT 1;

      IF v_session_id IS NULL THEN
        -- Internal diagnostic: skipped because no active workday existed.
        INSERT INTO public.tracking_point_skips
          (employee_id, point_type, latitude, longitude, accuracy_meters, recorded_at, reason)
        VALUES
          (p_employee_id, p_point_type, p_latitude, p_longitude, p_accuracy_meters, p_recorded_at, 'no_active_workday');
        RETURN false;
      END IF;
    ELSE
      v_session_id := p_session_id;
    END IF;

    -- Centralized deduplication policy (server-authoritative).
    -- Points with different business meaning (point_type) are never
    -- considered duplicates. Only same session + same meaning + same location
    -- (± ~1m) + recorded within 60s are collapsed (covers retries/overlaps).
    IF EXISTS (
      SELECT 1 FROM public.tracking_points
      WHERE session_id = v_session_id
        AND point_type = p_point_type
        AND abs(EXTRACT(EPOCH FROM (recorded_at - p_recorded_at))) < 60
        AND abs(latitude - p_latitude) < 0.00001
        AND abs(longitude - p_longitude) < 0.00001
    ) THEN
      RETURN false;
    END IF;

    INSERT INTO public.tracking_points (
      session_id, employee_id, latitude, longitude,
      accuracy_meters, altitude_meters, speed_mps, heading_degrees,
      battery_pct, recorded_at, point_type
    ) VALUES (
      v_session_id, p_employee_id, p_latitude, p_longitude,
      p_accuracy_meters, p_altitude_meters, p_speed_mps, p_heading_degrees,
      p_battery_pct, p_recorded_at, p_point_type
    );
    RETURN true;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. sync_tracking_points — route every client point through the shared helper
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_tracking_points(
  p_token uuid,
  p_session_id uuid,
  p_points jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

    PERFORM public.touch_session_activity(p_session_id);

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
            -- Shared helper applies session/dedup policy (deduped points count
            -- as synced so clients never retry already-present points).
            PERFORM public.ensure_tracking_point(
                v_employee_id,
                p_session_id,
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

-- ----------------------------------------------------------------------------
-- 5. start_workday — 'start' point via shared helper
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_workday(
  p_token uuid,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_device_status jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_existing_id uuid;
    v_stale record;
    v_stale_count int := 0;
    v_settings record;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF v_session.identity_type != 'employee' THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
    v_employee_id := v_session.employee_id;

    -- Auto-recover stale sessions from previous days
    FOR v_stale IN
        SELECT id, date, start_time
        FROM public.workday_sessions
        WHERE employee_id = v_employee_id
          AND status = 'active'
          AND date < CURRENT_DATE
        ORDER BY date ASC
    LOOP
        UPDATE public.workday_sessions
        SET end_time = now(),
            status = 'completed',
            attendance_status = 'auto_closed',
            updated_at = now()
        WHERE id = v_stale.id;
        v_stale_count := v_stale_count + 1;
    END LOOP;

    -- Check no active session today
    SELECT id INTO v_existing_id FROM public.workday_sessions
    WHERE employee_id = v_employee_id AND date = CURRENT_DATE AND status = 'active';
    IF FOUND THEN
        RETURN jsonb_build_object(
            'error', 'ALREADY_ACTIVE',
            'session_id', v_existing_id,
            'recovered_stale_sessions', v_stale_count
        );
    END IF;

    INSERT INTO public.workday_sessions (employee_id, start_latitude, start_longitude, start_device_status)
    VALUES (v_employee_id, p_latitude, p_longitude, p_device_status)
    RETURNING id INTO v_existing_id;

    PERFORM public.ensure_tracking_point(
        v_employee_id, v_existing_id,
        p_latitude, p_longitude,
        NULL, NULL, NULL, NULL, NULL,
        now(), 'start'
    );

    RETURN jsonb_build_object(
        'session_id', v_existing_id,
        'started_at', now(),
        'recovered_stale_sessions', v_stale_count
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6. end_workday — 'end' point via shared helper
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.end_workday(
  p_token uuid,
  p_session_id uuid,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_device_status jsonb DEFAULT NULL,
  p_close_reason text DEFAULT 'manual_close'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
    v_workday record;
    v_open_breaks int := 0;
    v_break_id uuid;
    v_start_time time;
    v_end_time time;
    v_late_thresh int;
    v_early_thresh int;
    v_attendance_status text := 'unknown';
    v_late_min int := 0;
    v_early_min int := 0;
    v_distance integer;
    v_schedule_type text;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_workday FROM public.workday_sessions
    WHERE id = p_session_id AND employee_id = v_employee_id AND status IN ('active', 'inactive_warning');
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;

    -- Read schedule_type from the employee's work policy (snapshot via work_policy_id)
    SELECT ewp.schedule_type INTO v_schedule_type
    FROM public.employee_work_policies ewp
    WHERE ewp.id = v_workday.work_policy_id;
    -- Default to 'flexible' if no policy found (should not happen for new sessions)
    IF v_schedule_type IS NULL THEN v_schedule_type := 'flexible'; END IF;

    -- GPS optional for auto-close; required for manual close
    IF p_close_reason = 'manual_close' AND (p_latitude IS NULL OR p_longitude IS NULL) THEN
        RETURN jsonb_build_object('error', 'GPS_REQUIRED');
    END IF;

    -- Auto-close open breaks
    FOR v_break_id IN SELECT id FROM public.workday_breaks
        WHERE session_id = p_session_id AND break_end IS NULL
    LOOP
        UPDATE public.workday_breaks SET
            break_end = now(),
            duration_seconds = EXTRACT(EPOCH FROM (now() - break_start))::int,
            auto_closed = true
        WHERE id = v_break_id;
        v_open_breaks := v_open_breaks + 1;
    END LOOP;

    -- Calculate attendance status based on schedule_type
    IF p_close_reason = 'manual_close' THEN
        IF v_schedule_type = 'fixed_shift' THEN
            -- Fixed-shift: use global workday_settings for late/early calculation
            SELECT official_start_time, official_end_time, late_threshold_minutes, early_departure_threshold_minutes
            INTO v_start_time, v_end_time, v_late_thresh, v_early_thresh
            FROM public.workday_settings LIMIT 1;

            IF v_workday.start_time::time > v_start_time + COALESCE(v_late_thresh, 0) * interval '1 minute' THEN
                v_attendance_status := 'late';
                v_late_min := EXTRACT(EPOCH FROM (v_workday.start_time::time - v_start_time)) / 60;
            END IF;

            IF v_attendance_status = 'unknown' AND now()::time < v_end_time - COALESCE(v_early_thresh, 0) * interval '1 minute' THEN
                v_attendance_status := 'early_departure';
                v_early_min := EXTRACT(EPOCH FROM (v_end_time - now()::time)) / 60;
            END IF;

            IF v_attendance_status = 'unknown' THEN
                v_attendance_status := 'ontime';
            END IF;
        ELSE
            -- Flexible or hourly: always ontime, no late/early calculation
            v_attendance_status := 'ontime';
        END IF;
    ELSIF p_close_reason IN ('no_activity_timeout', 'day_rollover') THEN
        v_attendance_status := 'auto_closed';
    END IF;

    -- Calculate and persist distance
    v_distance := public.calculate_session_distance(p_session_id);

    UPDATE public.workday_sessions SET
        end_time = CASE WHEN p_close_reason = 'manual_close' THEN now()
                        ELSE COALESCE(last_seen_at, now()) END,
        end_latitude = COALESCE(p_latitude, v_workday.start_latitude),
        end_longitude = COALESCE(p_longitude, v_workday.start_longitude),
        end_device_status = p_device_status,
        status = 'completed',
        attendance_status = v_attendance_status,
        late_minutes = v_late_min,
        early_departure_minutes = v_early_min,
        close_reason = p_close_reason,
        total_distance_meters = v_distance,
        updated_at = now()
    WHERE id = p_session_id;

    IF p_latitude IS NOT NULL THEN
        PERFORM public.ensure_tracking_point(
            v_employee_id, p_session_id,
            p_latitude, p_longitude,
            NULL, NULL, NULL, NULL, NULL,
            now(), 'end'
        );
    END IF;

    RETURN jsonb_build_object(
        'ok', true, 'end_time', now(),
        'close_reason', p_close_reason,
        'open_breaks_closed', v_open_breaks,
        'attendance_status', v_attendance_status,
        'total_distance_meters', v_distance,
        'schedule_type', v_schedule_type
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 7. governed_checkin_visit — also record a 'visit_checkin' tracking point
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_checkin_visit(
  p_token uuid,
  p_customer_id uuid,
  p_start_location_id uuid DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_visit_id uuid;
  v_code varchar(30);
  v_year integer := EXTRACT(YEAR FROM now());
  v_seq integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Tracking point for the successful GPS acquisition (never blocks check-in).
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    PERFORM public.ensure_tracking_point(
      v_session.employee_id, NULL,
      p_latitude, p_longitude,
      NULL, NULL, NULL, NULL, NULL,
      now(), 'visit_checkin'
    );
  END IF;

  SELECT id INTO v_visit_id FROM visits
  WHERE employee_id = v_session.employee_id AND customer_id = p_customer_id AND status = 'active' LIMIT 1;
  IF v_visit_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'id', v_visit_id, 'existing', true);
  END IF;

  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('visit', v_year, 1)
  ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  v_code := 'VIS-' || v_year::text || '-' || LPAD(v_seq::text, 6, '0');

  INSERT INTO public.visits (code, employee_id, customer_id, status, check_in_at,
    start_location_id, check_in_latitude, check_in_longitude)
  VALUES (v_code, v_session.employee_id, p_customer_id, 'active', now(),
    p_start_location_id, p_latitude, p_longitude)
  RETURNING id INTO v_visit_id;

  RETURN jsonb_build_object('success', true, 'id', v_visit_id, 'code', v_code);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 8. governed_checkout_visit — also record a 'visit_checkout' tracking point
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_checkout_visit(
  p_token uuid,
  p_visit_id uuid,
  p_visit_result varchar DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_end_location_id uuid DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_visit_status varchar(20);
  v_customer_id uuid;
  v_formatted_address text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT status, customer_id INTO v_visit_status, v_customer_id FROM visits WHERE id = p_visit_id;
  IF v_visit_status IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_visit_status != 'active' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  -- Tracking point for the successful GPS acquisition (never blocks checkout).
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    PERFORM public.ensure_tracking_point(
      v_session.employee_id, NULL,
      p_latitude, p_longitude,
      NULL, NULL, NULL, NULL, NULL,
      now(), 'visit_checkout'
    );
  END IF;

  UPDATE public.visits
  SET
    status = 'completed',
    check_out_at = now(),
    end_location_id = COALESCE(p_end_location_id, end_location_id),
    check_out_latitude = COALESCE(p_latitude, check_out_latitude),
    check_out_longitude = COALESCE(p_longitude, check_out_longitude),
    visit_result = COALESCE(p_visit_result, visit_result),
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE id = p_visit_id;

  -- Enrich customer using shared service (best-effort, must never fail visit)
  BEGIN
    SELECT formatted_address INTO v_formatted_address
    FROM unified_locations WHERE id = p_end_location_id;

    PERFORM fn_enrich_customer_location(
      p_customer_id        := v_customer_id,
      p_latitude           := p_latitude,
      p_longitude          := p_longitude,
      p_formatted_address  := v_formatted_address,
      p_accuracy_level     := 'GPS'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'governed_checkout_visit: enrichment failed for visit % (customer %): %', p_visit_id, v_customer_id, SQLERRM;
  END;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 9. governed_create_customer — also record a 'customer_created' point
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_create_customer(
  p_token uuid,
  p_company_name varchar,
  p_phone varchar DEFAULT NULL,
  p_contact_name varchar DEFAULT NULL,
  p_contact_phone varchar DEFAULT NULL,
  p_address_line1 varchar DEFAULT NULL,
  p_city varchar DEFAULT 'القاهرة',
  p_region varchar DEFAULT NULL,
  p_business_type business_type DEFAULT NULL,
  p_responsible_name varchar DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_accuracy_meters numeric DEFAULT NULL,
  p_formatted_address text DEFAULT NULL,
  p_password varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL,
  p_credit_limit numeric DEFAULT NULL,
  p_credit_days integer DEFAULT NULL,
  p_governorate_id uuid DEFAULT NULL,
  p_city_id uuid DEFAULT NULL,
  p_street_address varchar DEFAULT NULL,
  p_landmark text DEFAULT NULL,
  p_address_source address_source_type DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_identity_id uuid;
  v_customer_id uuid;
  v_contact_id uuid;
  v_address_id uuid;
  v_location_id uuid;
  v_code varchar(20);
  v_year integer := EXTRACT(YEAR FROM now());
  v_seq integer;
  v_has_new_address boolean;
  v_gov_name varchar(200);
  v_city_name varchar(200);
  v_address_line1 varchar(255);
  v_auto_source address_source_type;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;
  PERFORM check_capability(p_token, 'customers.create');

  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('customer', v_year, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  v_code := 'CUS-' || v_year::text || '-' || LPAD(v_seq::text, 6, '0');
  v_identity_id := gen_random_uuid();
  v_customer_id := gen_random_uuid();

  -- Auto-detect address source based on GPS presence
  v_auto_source := CASE
    WHEN p_address_source IS NOT NULL THEN p_address_source
    WHEN p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN 'mixed'::address_source_type
    ELSE 'manual'::address_source_type
  END;

  -- Create unified_locations record
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    v_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
    VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, COALESCE(p_formatted_address, p_address_line1), now());
  ELSIF p_formatted_address IS NOT NULL THEN
    v_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, formatted_address, captured_at)
    VALUES (v_location_id, p_formatted_address, now());
  END IF;

  INSERT INTO public.identities (id, phone, password_hash, identity_type, is_active)
  VALUES (
    v_identity_id,
    COALESCE(p_phone, 'ext-' || v_customer_id::text || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
    CASE WHEN p_password IS NOT NULL THEN extensions.crypt(p_password::text, extensions.gen_salt('bf'))
         ELSE extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))
    END,
    'customer',
    true
  );

  INSERT INTO public.customers (id, identity_id, code, company_name, responsible_name, business_type, location_id, owner_type, owner_id, is_active, email, credit_limit, credit_days)
  VALUES (v_customer_id, v_identity_id, v_code, p_company_name, COALESCE(p_responsible_name, p_contact_name), p_business_type, v_location_id, 'employee', v_employee_id, true, p_email, COALESCE(p_credit_limit, 0), COALESCE(p_credit_days, 0));

  IF p_contact_phone IS NOT NULL OR p_contact_name IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, full_name, phone, is_primary)
    VALUES (v_customer_id, COALESCE(p_contact_name, p_company_name), COALESCE(p_contact_phone, '0000000000'), true)
    RETURNING id INTO v_contact_id;
  END IF;

  v_has_new_address := p_governorate_id IS NOT NULL OR p_city_id IS NOT NULL
    OR p_street_address IS NOT NULL OR p_landmark IS NOT NULL;

  IF v_has_new_address THEN
    v_gov_name := (SELECT name_ar FROM reference_governorates WHERE id = p_governorate_id);
    v_city_name := (SELECT name_ar FROM reference_cities WHERE id = p_city_id);
    v_address_line1 := TRIM(COALESCE(v_gov_name, '') || ' - ' || COALESCE(v_city_name, ''));
    IF p_street_address IS NOT NULL AND p_street_address != '' THEN
      v_address_line1 := v_address_line1 || ' - ' || p_street_address;
    END IF;
    IF p_landmark IS NOT NULL AND p_landmark != '' THEN
      v_address_line1 := v_address_line1 || ' - ' || p_landmark;
    END IF;

    INSERT INTO public.customer_addresses (
      customer_id, address_line1, city, governorate,
      governorate_id, city_id, street_address, landmark,
      address_source, address_updated_at, is_default
    ) VALUES (
      v_customer_id, v_address_line1, COALESCE(v_city_name, p_city), COALESCE(v_gov_name, ''),
      p_governorate_id, p_city_id, p_street_address, p_landmark,
      v_auto_source, now(), true
    )
    RETURNING id INTO v_address_id;
  ELSIF p_address_line1 IS NOT NULL THEN
    INSERT INTO public.customer_addresses (customer_id, address_line1, city, is_default)
    VALUES (v_customer_id, p_address_line1, p_city, true)
    RETURNING id INTO v_address_id;
  END IF;

  -- Tracking point for the successful GPS acquisition (never blocks creation).
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    PERFORM public.ensure_tracking_point(
      v_employee_id, NULL,
      p_latitude, p_longitude,
      p_accuracy_meters, NULL, NULL, NULL, NULL,
      now(), 'customer_created'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_customer_id, 'code', v_code, 'company_name', p_company_name);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 10. governed_update_customer — also record a 'customer_location_updated' point
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_update_customer(
  p_token uuid,
  p_id uuid,
  p_company_name varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL,
  p_credit_limit numeric DEFAULT NULL,
  p_credit_days integer DEFAULT NULL,
  p_business_type business_type DEFAULT NULL,
  p_responsible_name varchar DEFAULT NULL,
  p_password varchar DEFAULT NULL,
  p_phone varchar DEFAULT NULL,
  p_formatted_address text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_accuracy_meters numeric DEFAULT NULL,
  p_contact_name varchar DEFAULT NULL,
  p_contact_phone varchar DEFAULT NULL,
  p_governorate_id uuid DEFAULT NULL,
  p_city_id uuid DEFAULT NULL,
  p_city_name varchar DEFAULT NULL,
  p_street_address varchar DEFAULT NULL,
  p_landmark text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_identity_id uuid;
  v_location_id uuid;
  v_has_any_location_input boolean;
  v_has_any_contact_input boolean;
  v_has_any_address_input boolean;
  v_resolved_governorate_name text;
  v_resolved_city_name text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'customers.update');

  UPDATE public.customers
  SET
    company_name = COALESCE(p_company_name, company_name),
    email = COALESCE(p_email, email),
    credit_limit = COALESCE(p_credit_limit, credit_limit),
    credit_days = COALESCE(p_credit_days, credit_days),
    business_type = COALESCE(p_business_type, business_type),
    responsible_name = COALESCE(p_responsible_name, responsible_name),
    updated_at = now()
  WHERE id = p_id;

  IF p_phone IS NOT NULL THEN
    SELECT identity_id INTO v_identity_id FROM public.customers WHERE id = p_id;
    IF v_identity_id IS NOT NULL THEN
      UPDATE public.identities SET phone = p_phone WHERE id = v_identity_id;
    END IF;
  END IF;

  IF p_password IS NOT NULL THEN
    IF v_identity_id IS NULL THEN
      SELECT identity_id INTO v_identity_id FROM public.customers WHERE id = p_id;
    END IF;
    IF v_identity_id IS NOT NULL THEN
      UPDATE public.identities SET password_hash = extensions.crypt(p_password::text, extensions.gen_salt('bf')) WHERE id = v_identity_id;
    END IF;
  END IF;

  -- Location updates (GPS) — independent from manual address
  v_has_any_location_input := p_formatted_address IS NOT NULL
    OR p_latitude IS NOT NULL
    OR p_longitude IS NOT NULL
    OR p_accuracy_meters IS NOT NULL;

  IF v_has_any_location_input THEN
    SELECT location_id INTO v_location_id FROM public.customers WHERE id = p_id;

    IF v_location_id IS NOT NULL THEN
      UPDATE public.unified_locations
      SET
        formatted_address = COALESCE(p_formatted_address, formatted_address),
        latitude = COALESCE(p_latitude, latitude),
        longitude = COALESCE(p_longitude, longitude),
        accuracy_meters = COALESCE(p_accuracy_meters, accuracy_meters)
      WHERE id = v_location_id;
    ELSIF p_formatted_address IS NOT NULL OR p_latitude IS NOT NULL THEN
      v_location_id := gen_random_uuid();
      IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
        INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
        VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());
      ELSE
        INSERT INTO unified_locations (id, formatted_address, captured_at)
        VALUES (v_location_id, COALESCE(p_formatted_address, ''), now());
      END IF;
      UPDATE public.customers SET location_id = v_location_id, updated_at = now() WHERE id = p_id;
    END IF;
  END IF;

  v_has_any_contact_input := p_contact_name IS NOT NULL OR p_contact_phone IS NOT NULL;

  IF v_has_any_contact_input THEN
    IF EXISTS (SELECT 1 FROM public.customer_contacts WHERE customer_id = p_id AND is_primary = true) THEN
      UPDATE public.customer_contacts
      SET
        full_name = COALESCE(p_contact_name, full_name),
        phone = COALESCE(p_contact_phone, phone)
      WHERE customer_id = p_id AND is_primary = true;
    ELSE
      INSERT INTO public.customer_contacts (customer_id, full_name, phone, is_primary)
      VALUES (p_id, COALESCE(p_contact_name, ''), COALESCE(p_contact_phone, ''), true);
    END IF;
  END IF;

  -- Manual address updates — independent from GPS/location
  v_has_any_address_input := p_governorate_id IS NOT NULL
    OR p_city_id IS NOT NULL
    OR p_city_name IS NOT NULL
    OR p_street_address IS NOT NULL
    OR p_landmark IS NOT NULL;

  IF v_has_any_address_input THEN
    -- Resolve governorate name from ID
    v_resolved_governorate_name := COALESCE(
      (SELECT name_ar FROM reference_governorates WHERE id = p_governorate_id),
      (SELECT governorate FROM customer_addresses WHERE customer_id = p_id AND is_default = true),
      ''
    );

    -- Resolve city name: prefer explicit city_name, then city_id lookup, then existing
    v_resolved_city_name := COALESCE(
      p_city_name,
      (SELECT name_ar FROM reference_cities WHERE id = p_city_id),
      (SELECT city FROM customer_addresses WHERE customer_id = p_id AND is_default = true),
      ''
    );

    INSERT INTO customer_addresses (customer_id, address_line1, city, governorate, city_id, governorate_id, street_address, landmark, address_source, address_updated_at, is_default)
    VALUES (
      p_id,
      COALESCE(p_street_address, (SELECT address_line1 FROM customer_addresses WHERE customer_id = p_id AND is_default = true), ''),
      v_resolved_city_name,
      v_resolved_governorate_name,
      p_city_id,
      p_governorate_id,
      p_street_address,
      p_landmark,
      'manual',
      now(),
      true
    )
    ON CONFLICT (customer_id) WHERE is_default = true
    DO UPDATE SET
      governorate        = CASE WHEN p_governorate_id IS NOT NULL THEN v_resolved_governorate_name
                               WHEN p_city_name IS NOT NULL OR p_street_address IS NOT NULL OR p_landmark IS NOT NULL
                               THEN COALESCE(NULLIF(customer_addresses.governorate, ''), v_resolved_governorate_name)
                               ELSE customer_addresses.governorate END,
      governorate_id     = COALESCE(p_governorate_id, customer_addresses.governorate_id),
      city               = CASE WHEN p_city_name IS NOT NULL THEN v_resolved_city_name
                               WHEN p_governorate_id IS NOT NULL OR p_street_address IS NOT NULL OR p_landmark IS NOT NULL
                               THEN COALESCE(NULLIF(customer_addresses.city, ''), v_resolved_city_name)
                               ELSE customer_addresses.city END,
      city_id            = COALESCE(p_city_id, customer_addresses.city_id),
      street_address     = COALESCE(p_street_address, customer_addresses.street_address),
      landmark           = COALESCE(p_landmark, customer_addresses.landmark),
      address_source     = COALESCE(customer_addresses.address_source, 'manual'),
      address_updated_at = now();

    -- Update needs_address_correction: if governorate_id is now set, clear the flag
    IF p_governorate_id IS NOT NULL THEN
      UPDATE customers SET needs_address_correction = false WHERE id = p_id;
    END IF;
  END IF;

  -- Enrich location if GPS data provided
  PERFORM fn_enrich_customer_location(
    p_customer_id        := p_id,
    p_latitude           := p_latitude,
    p_longitude          := p_longitude,
    p_accuracy_meters    := p_accuracy_meters,
    p_formatted_address  := p_formatted_address,
    p_accuracy_level     := (CASE WHEN p_latitude IS NOT NULL THEN 'GPS' ELSE 'GEOCODED' END)::location_accuracy_level
  );

  -- Tracking point for the successful GPS acquisition (never blocks update).
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    PERFORM public.ensure_tracking_point(
      v_session.employee_id, NULL,
      p_latitude, p_longitude,
      p_accuracy_meters, NULL, NULL, NULL, NULL,
      now(), 'customer_location_updated'
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;
