-- ============================================================================
-- Auto-close workday on 60-minute inactivity (business rule)
-- ============================================================================
-- When an employee starts a workday, a 60-minute inactivity timer begins.
-- Qualifying activities reset the timer:
--   - Tracking Point captured
--   - Visit Check-in / Check-out
--   - Order Created
--   - Customer Created
-- If 60 minutes pass with no qualifying activity, the workday is
-- automatically closed with close_reason = 'auto_closed_inactivity'.
--
-- Changes:
--   1. Add 'auto_closed_inactivity' to close_reason CHECK
--   2. Stop heartbeat from resetting the inactivity timer
--   3. Create touch_qualifying_activity() for governed functions
--   4. Modify check_session_timeout: 60min → direct auto-close
--   5. Modify auto_close_stale_sessions: 60min
--   6. Modify end_workday: handle auto_closed_inactivity
--   7. Update audit trigger for new close_reason
--   8. Add touch_qualifying_activity calls to governed functions
-- ============================================================================

-- ================================================================
-- 1. Add 'auto_closed_inactivity' to close_reason CHECK
-- ================================================================
ALTER TABLE public.workday_sessions
DROP CONSTRAINT IF EXISTS workday_sessions_close_reason_check;

ALTER TABLE public.workday_sessions
ADD CONSTRAINT workday_sessions_close_reason_check
CHECK (close_reason IN ('manual_close', 'no_activity_timeout', 'auto_closed_inactivity', 'day_rollover', 'admin_closed'));

-- ================================================================
-- 2. Stop heartbeat from resetting the inactivity timer
--    Heartbeats now only confirm the session is alive; they do NOT
--    reset the 60-minute qualifying-activity timer.
-- ================================================================
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

    -- Heartbeat confirms the session is alive but does NOT reset the
    -- qualifying-activity timer. Only touch_qualifying_activity does.
    IF NOT EXISTS (SELECT 1 FROM public.workday_sessions WHERE id = p_session_id AND employee_id = v_employee_id) THEN
        RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ================================================================
-- 3. touch_qualifying_activity — called by governed functions
--    Resolves the active session from employee_id and resets the
--    inactivity timer (last_seen_at + clears warning).
-- ================================================================
CREATE OR REPLACE FUNCTION public.touch_qualifying_activity(
    p_employee_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session_id uuid;
BEGIN
    SELECT id INTO v_session_id
    FROM public.workday_sessions
    WHERE employee_id = p_employee_id
      AND status IN ('active', 'inactive_warning')
    ORDER BY start_time DESC
    LIMIT 1;

    IF v_session_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.workday_sessions
    SET last_seen_at = now(),
        status = CASE
            WHEN status = 'inactive_warning' THEN 'active'
            ELSE status
        END,
        warning_cleared_at = CASE
            WHEN status = 'inactive_warning' THEN now()
            ELSE warning_cleared_at
        END,
        updated_at = now()
    WHERE id = v_session_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.touch_qualifying_activity TO authenticated;

-- ================================================================
-- 4. Modify check_session_timeout: 60 minutes → direct auto-close
--    No warning phase. 60 minutes of inactivity = auto-close.
-- ================================================================
CREATE OR REPLACE FUNCTION public.check_session_timeout(
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
    v_ws record;
    v_inactive_seconds numeric;
    v_last_activity timestamptz;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_ws FROM public.workday_sessions
    WHERE id = p_session_id AND employee_id = v_employee_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;

    -- Skip completed sessions
    IF v_ws.status = 'completed' THEN
        RETURN jsonb_build_object('action', 'completed');
    END IF;

    -- ============================================================
    -- Case 1: Midnight rollover (00:00–00:05) — close stale sessions
    -- ============================================================
    IF v_ws.status IN ('active', 'inactive_warning') AND v_ws.date < CURRENT_DATE
       AND EXTRACT(HOUR FROM now()) = 0 AND EXTRACT(MINUTE FROM now()) <= 5 THEN
        PERFORM public.end_workday(p_token, p_session_id,
            p_latitude => v_ws.end_latitude,
            p_longitude => v_ws.end_longitude,
            p_close_reason => 'day_rollover'
        );
        RETURN jsonb_build_object(
            'action', 'auto_closed',
            'reason', 'day_rollover',
            'message', 'تم إنهاء يوم العمل تلقائياً لانتهاء اليوم وعدم تسجيل خروج.'
        );
    END IF;

    -- ============================================================
    -- Determine last qualifying activity time
    -- Source of truth: last_seen_at (updated only by qualifying
    -- activities) OR last tracking point OR start_time
    -- ============================================================
    SELECT COALESCE(
        v_ws.last_seen_at,
        (SELECT MAX(recorded_at) FROM public.tracking_points WHERE session_id = p_session_id),
        v_ws.start_time
    ) INTO v_last_activity;

    v_inactive_seconds := EXTRACT(EPOCH FROM (now() - v_last_activity));

    -- ============================================================
    -- Case 2: In inactive_warning — check grace period (legacy)
    -- ============================================================
    IF v_ws.status = 'inactive_warning' THEN
        -- Activity during warning → clear it
        IF v_inactive_seconds < 300 THEN
            UPDATE public.workday_sessions
            SET status = 'active', warning_cleared_at = now(), updated_at = now()
            WHERE id = p_session_id;

            RETURN jsonb_build_object(
                'action', 'warning_cleared',
                'message', 'تم تسجيل نشاط جديد. تم إلغاء تحذير الخمول.'
            );
        END IF;

        -- 5 min grace passed → auto-close
        PERFORM public.end_workday(p_token, p_session_id,
            p_latitude => v_ws.end_latitude,
            p_longitude => v_ws.end_longitude,
            p_close_reason => 'auto_closed_inactivity'
        );
        RETURN jsonb_build_object(
            'action', 'auto_closed',
            'reason', 'auto_closed_inactivity',
            'message', 'تم إنهاء يوم العمل تلقائياً لعدم وجود نشاط منذ 60 دقيقة.'
        );
    END IF;

    -- ============================================================
    -- Case 3: Active but 60+ min inactivity → auto-close directly
    -- ============================================================
    IF v_ws.status = 'active' AND v_inactive_seconds >= 3600 THEN
        PERFORM public.end_workday(p_token, p_session_id,
            p_latitude => v_ws.end_latitude,
            p_longitude => v_ws.end_longitude,
            p_close_reason => 'auto_closed_inactivity'
        );
        RETURN jsonb_build_object(
            'action', 'auto_closed',
            'reason', 'auto_closed_inactivity',
            'message', 'تم إنهاء يوم العمل تلقائياً لعدم وجود نشاط منذ 60 دقيقة.'
        );
    END IF;

    -- ============================================================
    -- Case 4: Active and within timeout — no action
    -- ============================================================
    RETURN jsonb_build_object(
        'action', 'ok',
        'inactive_minutes', (v_inactive_seconds / 60)::int
    );
END;
$function$;

-- ================================================================
-- 5. Modify auto_close_stale_sessions: 60 minutes
-- ================================================================
CREATE OR REPLACE FUNCTION public.auto_close_stale_sessions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_closed int := 0;
    v_warned int := 0;
    v_ws record;
    v_inactive_seconds numeric;
    v_last_activity timestamptz;
    v_is_midnight boolean;
BEGIN
    v_is_midnight := EXTRACT(HOUR FROM now()) = 0 AND EXTRACT(MINUTE FROM now()) <= 5;

    FOR v_ws IN
        SELECT * FROM public.workday_sessions
        WHERE status IN ('active', 'inactive_warning')
    LOOP
        SELECT COALESCE(
            v_ws.last_seen_at,
            (SELECT MAX(recorded_at) FROM public.tracking_points WHERE session_id = v_ws.id),
            v_ws.start_time
        ) INTO v_last_activity;

        v_inactive_seconds := EXTRACT(EPOCH FROM (now() - v_last_activity));

        -- Midnight rollover
        IF v_is_midnight AND v_ws.date < CURRENT_DATE THEN
            UPDATE public.workday_sessions
            SET end_time = COALESCE(v_ws.last_seen_at, now()),
                status = 'completed',
                close_reason = 'day_rollover',
                attendance_status = 'auto_closed',
                updated_at = now()
            WHERE id = v_ws.id;
            v_closed := v_closed + 1;

        -- 60+ min inactive → auto-close
        ELSIF v_inactive_seconds >= 3600 THEN
            UPDATE public.workday_sessions
            SET end_time = COALESCE(v_ws.last_seen_at, now()),
                status = 'completed',
                close_reason = 'auto_closed_inactivity',
                attendance_status = 'auto_closed',
                updated_at = now()
            WHERE id = v_ws.id;
            v_closed := v_closed + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('closed', v_closed, 'warned', v_warned);
END;
$function$;

-- ================================================================
-- 6. Modify end_workday: handle auto_closed_inactivity as auto-close
-- ================================================================
CREATE OR REPLACE FUNCTION public.end_workday(
    p_token uuid,
    p_session_id uuid,
    p_latitude decimal DEFAULT NULL,
    p_longitude decimal DEFAULT NULL,
    p_device_status jsonb DEFAULT NULL,
    p_close_reason text DEFAULT 'manual_close'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    v_employee_id := v_session.employee_id;

    SELECT * INTO v_workday FROM public.workday_sessions
    WHERE id = p_session_id AND employee_id = v_employee_id AND status IN ('active', 'inactive_warning');
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;

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

    -- Calculate attendance status
    IF p_close_reason = 'manual_close' THEN
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
    ELSIF p_close_reason IN ('no_activity_timeout', 'auto_closed_inactivity', 'day_rollover') THEN
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
        INSERT INTO public.tracking_points (session_id, employee_id, latitude, longitude, recorded_at, point_type)
        VALUES (p_session_id, v_employee_id, p_latitude, p_longitude, now(), 'end');
    END IF;

    RETURN jsonb_build_object(
        'ok', true, 'end_time', now(),
        'close_reason', p_close_reason,
        'open_breaks_closed', v_open_breaks,
        'attendance_status', v_attendance_status,
        'total_distance_meters', v_distance
    );
END;
$function$;

-- ================================================================
-- 7. Update audit trigger to handle auto_closed_inactivity
-- ================================================================
CREATE OR REPLACE FUNCTION public.log_session_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_event_type text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_type := 'workday_start';
    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        v_event_type := CASE
            WHEN NEW.status = 'completed' AND NEW.close_reason = 'manual_close' THEN 'manual_close'
            WHEN NEW.status = 'completed' AND NEW.close_reason = 'no_activity_timeout' THEN 'auto_closed'
            WHEN NEW.status = 'completed' AND NEW.close_reason = 'auto_closed_inactivity' THEN 'auto_closed'
            WHEN NEW.status = 'completed' AND NEW.close_reason = 'day_rollover' THEN 'day_rollover'
            WHEN NEW.status = 'completed' AND NEW.close_reason = 'admin_closed' THEN 'admin_closed'
            WHEN NEW.status = 'inactive_warning' THEN 'warning_sent'
            WHEN OLD.status = 'inactive_warning' AND NEW.status = 'active' THEN 'warning_cleared'
            WHEN NEW.status = 'cancelled' THEN 'cancelled'
            ELSE 'status_change'
        END;
    ELSE
        RETURN NEW;
    END IF;

    INSERT INTO public.attendance_audit_log
        (employee_id, session_id, event_type, old_status, new_status, close_reason, attendance_status)
    VALUES (
        NEW.employee_id, NEW.id, v_event_type,
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
        NEW.status, NEW.close_reason, NEW.attendance_status
    );

    RETURN NEW;
END;
$function$;

-- ================================================================
-- 8. Add touch_qualifying_activity to governed functions
-- ================================================================

-- 8a. governed_checkin_visit
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

  -- Reset inactivity timer (visit check-in is a qualifying activity)
  PERFORM public.touch_qualifying_activity(v_session.employee_id);

  RETURN jsonb_build_object('success', true, 'id', v_visit_id, 'code', v_code);
END;
$function$;

-- 8b. governed_checkout_visit
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
      p_accuracy_meters    := NULL,
      p_accuracy_level     := 'GPS'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'governed_checkout_visit: enrichment failed for visit % (customer %): %', p_visit_id, v_customer_id, SQLERRM;
  END;

  -- Reset inactivity timer (visit check-out is a qualifying activity)
  PERFORM public.touch_qualifying_activity(v_session.employee_id);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 8c. governed_create_order
CREATE OR REPLACE FUNCTION public.governed_create_order(
  p_token uuid, p_customer_id uuid,
  p_tier_id uuid DEFAULT NULL, p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]',
  p_execution_location_id uuid DEFAULT NULL,
  p_execution_latitude numeric DEFAULT NULL,
  p_execution_longitude numeric DEFAULT NULL,
  p_execution_accuracy_meters numeric DEFAULT NULL,
  p_execution_captured_at timestamptz DEFAULT NULL,
  p_order_type varchar DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_order_number text;
  v_seq int;
  v_order_item jsonb;
  v_product record;
  v_calculated_unit_price numeric;
  v_calculated_total_price numeric;
  v_exec_location_id uuid;

  -- Snapshot variables
  v_cust_name text;
  v_cust_phone text;
  v_cust_address text;
  v_owner_name text;
  v_owner_phone text;
  v_owner_address text;
  v_sender_name text;
  v_sender_phone text;
  v_sender_address text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.create') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: orders.create'; END IF;
  ELSE
    IF v_session.customer_id IS NULL OR p_customer_id IS DISTINCT FROM v_session.customer_id THEN
      RAISE EXCEPTION 'FORBIDDEN: customers can only create orders for themselves';
    END IF;
  END IF;

  IF p_tier_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE id = p_tier_id AND is_active = true) THEN
      RAISE EXCEPTION 'TIER_NOT_FOUND_OR_INACTIVE';
    END IF;
  END IF;

  -- Validate no out_of_stock products in the order
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS vi
    JOIN public.products p ON p.id = (vi->>'product_id')::uuid
    WHERE p.is_out_of_stock = true AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'ORDER_CONTAINS_OUT_OF_STOCK_PRODUCTS';
  END IF;

  v_exec_location_id := p_execution_location_id;
  IF v_exec_location_id IS NULL AND p_execution_latitude IS NOT NULL AND p_execution_longitude IS NOT NULL THEN
    v_exec_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, captured_at)
    VALUES (v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, COALESCE(p_execution_captured_at, now()));
  END IF;

  -- Customer snapshot
  SELECT
    c.company_name,
    COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
    COALESCE(
      (SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
      (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1),
      ''
    )
  INTO v_cust_name, v_cust_phone, v_cust_address
  FROM customers c
  WHERE c.id = p_customer_id;

  -- Owner snapshot
  SELECT
    COALESCE(e.full_name, ''),
    COALESCE(i.phone, ''),
    COALESCE(e.address, '')
  INTO v_owner_name, v_owner_phone, v_owner_address
  FROM customers c
  LEFT JOIN employees e ON e.id = c.owner_id
  LEFT JOIN identities i ON i.id = e.identity_id
  WHERE c.id = p_customer_id;

  -- Sender snapshot
  IF v_session.identity_type = 'employee' THEN
    SELECT
      COALESCE(e.full_name, ''),
      COALESCE(i.phone, ''),
      COALESCE(e.address, '')
    INTO v_sender_name, v_sender_phone, v_sender_address
    FROM employees e
    LEFT JOIN identities i ON i.id = e.identity_id
    WHERE e.identity_id = v_session.identity_id;
  ELSE
    SELECT
      COALESCE(c.company_name, ''),
      COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
      COALESCE(
        (SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
        (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1),
        ''
      )
    INTO v_sender_name, v_sender_phone, v_sender_address
    FROM customers c
    WHERE c.identity_id = v_session.identity_id;
  END IF;

  -- Generate order number
  SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
  IF NOT FOUND THEN v_seq := 1; END IF;
  v_order_number := 'ORD-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

  -- Insert order with snapshot
  IF v_session.identity_type = 'employee' THEN
    INSERT INTO public.orders (
      order_number, customer_id, owner_type, owner_id, created_by,
      notes, tier_id, order_type,
      execution_location_id, execution_latitude, execution_longitude,
      execution_accuracy_meters, execution_captured_at,
      snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
      snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
      snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address
    ) VALUES (
      v_order_number, p_customer_id, 'employee', v_session.identity_id, v_session.identity_id,
      p_notes, p_tier_id, p_order_type,
      v_exec_location_id, p_execution_latitude, p_execution_longitude,
      p_execution_accuracy_meters, p_execution_captured_at,
      v_cust_name, v_cust_phone, v_cust_address,
      v_owner_name, v_owner_phone, v_owner_address,
      v_sender_name, v_sender_phone, v_sender_address
    )
    RETURNING * INTO v_order;
  ELSE
    INSERT INTO public.orders (
      order_number, customer_id, owner_type, owner_id, created_by,
      notes, tier_id, order_type,
      execution_location_id, execution_latitude, execution_longitude,
      execution_accuracy_meters, execution_captured_at,
      snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
      snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
      snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address
    ) VALUES (
      v_order_number, p_customer_id, 'customer', v_session.identity_id, v_session.identity_id,
      p_notes, p_tier_id, p_order_type,
      v_exec_location_id, p_execution_latitude, p_execution_longitude,
      p_execution_accuracy_meters, p_execution_captured_at,
      v_cust_name, v_cust_phone, v_cust_address,
      v_owner_name, v_owner_phone, v_owner_address,
      v_sender_name, v_sender_phone, v_sender_address
    )
    RETURNING * INTO v_order;
  END IF;

  -- Insert order items (only real columns from schema)
  FOR v_order_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, product_name, legacy_code AS product_code, carton_price, carton_quantity
    INTO v_product
    FROM public.products
    WHERE id = (v_order_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %', (v_order_item->>'product_id')::uuid;
    END IF;

    v_calculated_unit_price := (v_order_item->>'unit_price')::numeric;

    v_calculated_total_price := ROUND(
      (v_calculated_unit_price * (v_order_item->>'unit_quantity')::numeric)::numeric, 2
    );

    INSERT INTO public.order_items (
      order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price
    ) VALUES (
      v_order.id, v_product.id,
      COALESCE(v_order_item->>'unit_type', 'piece'),
      GREATEST(COALESCE((v_order_item->>'unit_quantity')::integer, 1), 1),
      GREATEST(COALESCE((v_order_item->>'piece_quantity')::integer, 0), 1),
      v_calculated_unit_price, v_calculated_total_price
    );
  END LOOP;

  -- Update order totals
  UPDATE public.orders SET
    subtotal = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id),
    total_amount = (SELECT COALESCE(SUM(total_price), 0) FROM public.order_items WHERE order_id = v_order.id)
  WHERE id = v_order.id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (v_order.id, NULL, 'draft', v_session.identity_id, 'Order created');

  UPDATE public.code_sequences
  SET last_sequence = v_seq
  WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int;

  -- Enrich customer from order execution location (best-effort)
  BEGIN
    PERFORM fn_enrich_customer_location(
      p_customer_id        := p_customer_id,
      p_latitude           := p_execution_latitude,
      p_longitude          := p_execution_longitude,
      p_accuracy_meters    := p_execution_accuracy_meters,
      p_accuracy_level     := 'GEOCODED'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'governed_create_order: enrichment failed for order % (customer %): %', v_order.id, p_customer_id, SQLERRM;
  END;

  PERFORM pg_notify('order_created', jsonb_build_object('order_id', v_order.id, 'number', v_order.order_number)::text);

  -- Reset inactivity timer (order creation is a qualifying activity)
  IF v_session.identity_type = 'employee' THEN
    PERFORM public.touch_qualifying_activity(v_session.employee_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_order.id,
    'order_number', v_order.order_number
  );
END;
$$;

-- 8d. governed_create_customer
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

  -- Reset inactivity timer (customer creation is a qualifying activity)
  PERFORM public.touch_qualifying_activity(v_employee_id);

  RETURN jsonb_build_object('success', true, 'id', v_customer_id, 'code', v_code, 'company_name', p_company_name);
END;
$function$;

-- ================================================================
-- 9. Ensure sync_tracking_points also resets the inactivity timer
-- ================================================================
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
            -- ensure_tracking_point returns true only if a new point was
            -- actually inserted (not deduped). Reset the inactivity timer
            -- only when a valid tracking point is recorded.
            IF public.ensure_tracking_point(
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
            ) THEN
                v_synced := v_synced + 1;
                PERFORM public.touch_qualifying_activity(v_employee_id);
            ELSE
                v_rejected := v_rejected + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_rejected := v_rejected + 1;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'synced', v_synced,
        'rejected', v_rejected,
        'total', jsonb_array_length(v_points_arr)
    );
END;
$function$;

-- ================================================================
-- 10. Grants
-- ================================================================
GRANT EXECUTE ON FUNCTION public.touch_qualifying_activity TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_session_timeout TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_heartbeat TO authenticated;
