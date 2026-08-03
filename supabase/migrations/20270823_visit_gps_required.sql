-- ============================================================================
-- Visit GPS Requirement (business rule)
-- ============================================================================
-- From now on, a Visit cannot start or end without obtaining a valid GPS
-- location. The client enforces a strict acquisition window (~10–15s) before
-- calling these RPCs; this migration enforces the same rule at the database
-- boundary so no client (or future caller) can insert a visit with NULL
-- coordinates or complete a checkout without an end location.
--
-- This file is intentionally the LAST migration in the chain (timestamp
-- 20270823 > 20270822) so a fresh replay ends with the GPS guard intact —
-- the 20270701/20270702/20270706 chain redefined governed_checkout_visit
-- after the original 20260804 guard file would have been applied.
--
-- Behavior:
--   * governed_checkin_visit  -> rejects when lat/lng are missing or invalid.
--   * governed_checkout_visit -> same; the visit stays active (no partial write).
--
-- Returns a jsonb business error (matching the existing INVALID_SESSION /
-- NOT_FOUND / INVALID_STATE pattern) instead of raising, so callers receive a
-- structured message.

-- ----------------------------------------------------------------------------
-- 1. governed_checkin_visit — valid GPS required to start a visit
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

  SELECT id INTO v_visit_id FROM visits
  WHERE employee_id = v_session.employee_id AND customer_id = p_customer_id AND status = 'active' LIMIT 1;
  IF v_visit_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'id', v_visit_id, 'existing', true);
  END IF;

  -- Business rule: a visit cannot start without a valid GPS location.
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude < -90 OR p_latitude > 90
     OR p_longitude < -180 OR p_longitude > 180 THEN
    RETURN jsonb_build_object('error', 'LOCATION_REQUIRED');
  END IF;

  -- Tracking point for the successful GPS acquisition.
  PERFORM public.ensure_tracking_point(
    v_session.employee_id, NULL,
    p_latitude, p_longitude,
    NULL, NULL, NULL, NULL, NULL,
    now(), 'visit_checkin'
  );

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
-- 2. governed_checkout_visit — valid GPS required to end a visit
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

  -- Business rule: a visit cannot end without a valid GPS location.
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude < -90 OR p_latitude > 90
     OR p_longitude < -180 OR p_longitude > 180 THEN
    RETURN jsonb_build_object('error', 'LOCATION_REQUIRED');
  END IF;

  -- Tracking point for the successful GPS acquisition.
  PERFORM public.ensure_tracking_point(
    v_session.employee_id, NULL,
    p_latitude, p_longitude,
    NULL, NULL, NULL, NULL, NULL,
    now(), 'visit_checkout'
  );

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
