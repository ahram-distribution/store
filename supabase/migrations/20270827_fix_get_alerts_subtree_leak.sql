-- ============================================================================
-- MIGRATION: Fix get_alerts subtree visibility leak (تنبيهات نطاق الرؤية)
-- DATE: 2026-08-05
-- DESCRIPTION:
--   In get_alerts(), the 'open_yesterday' and 'long_break' alert CTEs were
--   missing the subtree filter (v_subtree_ids). Every other alert type
--   (not_started, no_updates, zero_visits, zero_orders) is filtered through
--   active_sessions / all_employees which apply
--   (v_subtree_ids IS NULL OR ... = ANY(v_subtree_ids)).
--
--   Because of this omission, any role WITHOUT attendance.view_all (e.g. the
--   Executive Director after the subtree-visibility migration, and every
--   non-upper-management role holding attendance.view_alerts) could still see
--   company-wide open-yesterday / long-break alerts for employees outside its
--   subtree. This is the ONLY data path in get_alerts that bypassed subtree
--   visibility; it is fixed by adding the same filter the other CTEs already use.
--
--   Upper Management behaviour is unchanged (v_subtree_ids IS NULL => no filter).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_alerts(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_subtree_ids uuid[];
  v_settings record;
  v_interval_seconds int;
  v_start_time time;
  v_end_time time;
  v_active_alerts jsonb;
  v_resolved_alerts jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'attendance.view_alerts') THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  IF public.check_capability(p_token, 'attendance.view_all') THEN
    v_subtree_ids := NULL;
  ELSE
    v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
  END IF;

  SELECT official_start_time, official_end_time, location_interval_seconds
  INTO v_start_time, v_end_time, v_interval_seconds
  FROM public.workday_settings LIMIT 1;
  v_interval_seconds := COALESCE(v_interval_seconds, 300);

  WITH active_sessions AS (
    SELECT wds.id, wds.employee_id, wds.start_time, e.full_name AS employee_name
    FROM public.workday_sessions wds
    JOIN public.employees e ON e.id = wds.employee_id
    WHERE wds.date = CURRENT_DATE AND wds.status = 'active'
      AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
  ),
  all_employees AS (
    SELECT e.id, e.full_name
    FROM public.employees e
    WHERE e.is_active = true
      AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
  ),
  not_started AS (
    SELECT 'not_started' AS alert_type, ae.id AS employee_id, ae.full_name AS employee_name,
           'لم يبدأ يوم العمل' AS title,
           'الساعة الآن ' || to_char(now()::time, 'HH:MI') || ' — وقت البدء الرسمي ' || to_char(v_start_time, 'HH:MI') AS description,
           now() AS detected_at
    FROM all_employees ae
    WHERE NOT EXISTS (SELECT 1 FROM public.workday_sessions wds
                      WHERE wds.employee_id = ae.id AND wds.date = CURRENT_DATE)
      AND CURRENT_TIME > v_start_time + interval '30 minutes'
  ),
  open_yesterday AS (
    SELECT 'open_yesterday' AS alert_type, wds.employee_id, e.full_name AS employee_name,
           'يوم عمل مفتوح من اليوم السابق' AS title,
           'بدأ يوم ' || wds.date || ' الساعة ' || to_char(wds.start_time, 'HH:MI') AS description,
           now() AS detected_at
    FROM public.workday_sessions wds
    JOIN public.employees e ON e.id = wds.employee_id
    WHERE wds.date < CURRENT_DATE AND wds.status = 'active'
      AND (v_subtree_ids IS NULL OR wds.employee_id = ANY(v_subtree_ids))
  ),
  long_break AS (
    SELECT 'long_break' AS alert_type, wb.employee_id, e.full_name AS employee_name,
           'استراحة طويلة' AS title,
           'في استراحة منذ ' || round(EXTRACT(EPOCH FROM (now() - wb.break_start)) / 60) || ' دقيقة' AS description,
           wb.break_start AS detected_at
    FROM public.workday_breaks wb
    JOIN public.employees e ON e.id = wb.employee_id
    WHERE wb.break_end IS NULL AND EXTRACT(EPOCH FROM (now() - wb.break_start)) > 3600
      AND (v_subtree_ids IS NULL OR wb.employee_id = ANY(v_subtree_ids))
  ),
  no_updates AS (
    SELECT 'no_updates' AS alert_type, as2.employee_id, as2.employee_name,
           'انقطاع متابعة' AS title,
           'آخر تحديث منذ أكثر من ' || (v_interval_seconds * 5 / 60) || ' دقيقة' AS description,
           COALESCE(tp.recorded_at, now()) AS detected_at
    FROM active_sessions as2
    LEFT JOIN LATERAL (
      SELECT recorded_at FROM public.tracking_points
      WHERE employee_id = as2.employee_id AND recorded_at >= CURRENT_DATE
      ORDER BY recorded_at DESC LIMIT 1
    ) tp ON true
    WHERE tp.recorded_at IS NULL OR tp.recorded_at < now() - ((v_interval_seconds * 5) || ' seconds')::interval
  ),
  zero_visits AS (
    SELECT 'zero_visits' AS alert_type, as2.employee_id, as2.employee_name,
           'لا توجد زيارات اليوم' AS title,
           'بدأ اليوم ' || to_char(as2.start_time, 'HH:MI') || ' — 0 زيارات حتى الآن' AS description,
           now() AS detected_at
    FROM active_sessions as2
    WHERE NOT EXISTS (SELECT 1 FROM public.visits v
                      WHERE v.employee_id = as2.employee_id AND v.check_in_at::date = CURRENT_DATE)
  ),
  zero_orders AS (
    SELECT 'zero_orders' AS alert_type, as2.employee_id, as2.employee_name,
           'لا توجد طلبات اليوم' AS title,
           'بدأ اليوم ' || to_char(as2.start_time, 'HH:MI') || ' — 0 طلبات بعد 4 ساعات من العمل' AS description,
           now() AS detected_at
    FROM active_sessions as2
    WHERE as2.start_time < now() - interval '4 hours'
      AND NOT EXISTS (SELECT 1 FROM public.orders o
                      WHERE o.owner_id = as2.employee_id AND o.created_at::date = CURRENT_DATE)
  )
  SELECT jsonb_build_object(
    'active_alerts',
    COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.detected_at DESC)
              FROM (SELECT * FROM not_started
                    UNION ALL SELECT * FROM open_yesterday
                    UNION ALL SELECT * FROM long_break
                    UNION ALL SELECT * FROM no_updates
                    UNION ALL SELECT * FROM zero_visits
                    UNION ALL SELECT * FROM zero_orders) t), '[]'::jsonb),
    'resolved_alerts', '[]'::jsonb
  ) INTO v_active_alerts;

  RETURN jsonb_build_object('active_alerts', COALESCE(v_active_alerts->'active_alerts', '[]'::jsonb),
                            'resolved_alerts', '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_alerts(uuid) IS 'Attendance alerts scoped to the caller''s visible subtree; upper management sees company-wide (v_subtree_ids IS NULL)';
