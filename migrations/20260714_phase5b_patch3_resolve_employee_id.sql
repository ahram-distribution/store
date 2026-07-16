-- ============================================================================
-- PATCH 3 of 4: resolve_employee_id — Remove identity_id fallback
--
-- Why necessary:   This function still checks both employees.id AND
--                  employees.identity_id. The identity_id fallback was
--                  introduced when owner_id contained mixed values. With
--                  zero contaminated rows and all callers updated (Patches
--                  1, 2, 4), the second subquery is unreachable dead code.
--
-- What it fixes:   Removes the last identity-masking function. If any caller
--                  passes an identity_id instead of employees.id in the
--                  future, the function will return NULL instead of silently
--                  resolving — making the bug immediately visible.
--
-- Depends on:      Patches 1, 2, 4 complete and verified. No remaining
--                  production function calls resolve_employee_id with an
--                  owner_id value (all now use direct owner_id references).
--                  CI validation script in place (validate-rpc-contract.sql).
--
-- Risk level:      LOW. CREATE OR REPLACE FUNCTION. The simplified version
--                  returns identical results for all current callers.
--                  With clean data, resolve_employee_id(owner_id) = owner_id.
--
-- Rollback:        Re-run migration 20260724_identity_integration_layer.sql
--                  which contains the original dual-lookup definition.
--
-- Regression:      Before:  Verify all callers of resolve_employee_id
--                  After:   Run regression suite — all features must work
--                           node scripts/verify_identity_integrity.mjs
--                           node scripts/full_regression_suite.mjs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_employee_id(target_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  -- Simplified: single lookup. identity_id fallback removed.
  -- All owner_id values are now employees.id.
  SELECT e.id FROM public.employees e WHERE e.id = target_id;
$$;

COMMENT ON FUNCTION public.resolve_employee_id IS
  'Canonical employee ID resolution. Identity fallback removed on 2026-07-14 (Phase 5B Patch 3). Pass employees.id only.';
