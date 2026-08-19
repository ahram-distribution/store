-- ============================================================================
-- Migration: _is_deduction_eligible → canonical execution_status_group
--
-- The canonical business rule:
--   Deduction zone = execution_status_group() = {approved, reviewing, preparing,
--                                                prepared, delivered}
--   An order is eligible for deduction iff its status is inside that zone.
--
-- This REPLACES the old implementation that relied on the
-- inventory_deduction_status setting + stale status arrays (which contained
-- ready_for_dispatch, sent_to_delivery, dispatched, sales_manager_approved,
-- deferred, stock_review and did NOT include reviewing).
--
-- The setting is retained for UI compatibility but no longer controls the
-- deduction boundary — the canonical execution group is authoritative.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._is_deduction_eligible(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT COALESCE(p_status::text = ANY(public.execution_status_group()), false);
$$;

COMMENT ON FUNCTION public._is_deduction_eligible IS
  'Canonical deduction-zone check: true iff status is inside execution_status_group() = {approved, reviewing, preparing, prepared, delivered}.';

NOTIFY pgrst, 'reload schema';
