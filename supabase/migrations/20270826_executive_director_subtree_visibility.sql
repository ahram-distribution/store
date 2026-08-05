-- ============================================================================
-- MIGRATION: Executive Director Subtree Visibility (نطاق رؤية الرئيس التنفيذي)
-- DATE: 2026-08-05
-- DESCRIPTION:
--   Makes the Executive Director (الرئيس التنفيذي) subtree-scoped on ALL existing
--   governed data paths (employees, attendance, activity, tracking, orders,
--   customers, visits, targets, dashboards, reports).
--
--   ROOT CAUSE: the Executive Director role was granted ALL capabilities,
--   including scope-widening codes that governed RPCs use to switch from
--   subtree-scoped to company-wide data:
--     attendance.view_all   -> get_alerts, get_team_map, get_live_workday_overview,
--                              get_coverage_map, get_live_activity_center,
--                              get_completed_workdays_history, get_employee_day_map,
--                              get_employee_day_timeline, get_employee_detail (3-arg),
--                              get_daily_target_vs_actual, get_sales_reps_effort,
--                              get_stale_sessions
--     locations.view_all    -> get_governed_data_quality_report, get_governed_location(s)
--     targets.view_all      -> get_employee_weight_overrides,
--                              governed_upsert_employee_weight_override,
--                              deactivate_employee_weight_override
--     customers.read        -> get_governed_customers, get_customer_orders,
--                              get_employee_activity, get_sales_by_rep, get_sales_by_manager
--     data.deletion_center  -> governed_deletion_search_* / governed_deletion_execute_*
--
--   FIX: revoke ONLY these 5 widening codes from the Executive Director role.
--   Every governed RPC already contains a subtree branch (app.get_subtree_ids /
--   get_visible_employee_ids); once the widening codes are gone the Executive
--   Director automatically falls into the subtree branch, and company-wide admin
--   screens (stale sessions, data-quality report, deletion center) become FORBIDDEN.
--   Upper Management and every other role are unchanged (only the Executive
--   Director role's grants are modified). No RPC, capability definition or
--   hierarchy logic is touched; the backend remains the single source of truth.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_revoked int;
BEGIN
  DELETE FROM public.role_capabilities rc
  USING public.capabilities c, public.roles r
  WHERE rc.capability_id = c.id
    AND rc.role_id = r.id
    AND r.name = 'الرئيس التنفيذي'
    AND c.code IN (
      'attendance.view_all',
      'locations.view_all',
      'targets.view_all',
      'customers.read',
      'data.deletion_center'
    );
  GET DIAGNOSTICS v_revoked = ROW_COUNT;
  RAISE NOTICE 'Revoked % widening capabilities from Executive Director role', v_revoked;
END;
$$;

COMMIT;
