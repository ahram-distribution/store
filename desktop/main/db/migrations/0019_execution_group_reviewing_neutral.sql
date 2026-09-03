-- ============================================================================
-- 0019 - Execution group: reviewing is inventory-neutral (IDEMPOTENT)
-- ============================================================================
-- Root-cause fix for the double inventory deduction incident on ORD-2026-000272.
--
-- Business rule (intended, confirmed in source):
--   NON-DEDUCTING / PRE-EXECUTION : submitted (ط·ظ„ط¨ ط´ط±ط§ط،), reviewing (طھظ… ط§ظ„ظ‚ظٹط¯ ط¨ط§ظ„ط³ظٹط³طھظ…)
--   EXECUTION / DEDUCTING         : approved (ظ…ط¹طھظ…ط¯), preparing (ظ‚ظٹط¯ ط§ظ„طھط¬ظ‡ظٹط²),
--                                   prepared (طھظ… ط§ظ„طھط¬ظ‡ظٹط²), delivered (طھظ… ط§ظ„طھط³ظ„ظٹظ…)
--
-- The live database's `execution_status_group()` wrongly included `reviewing`,
-- making the AFTER-UPDATE trigger deduct on re-entry into `reviewing`. All
-- consumers already resolve execution eligibility through this centralized
-- function (and `_is_deduction_eligible()`), so correcting ONLY the set fixes
-- every deduction/restore path without introducing an independent array.
--
-- Failed expected-array literal is the exact single-point correction.
-- `CREATE OR REPLACE` makes this idempotent and safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.execution_status_group()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT ARRAY['approved','preparing','prepared','delivered']::text[];
$function$
;
