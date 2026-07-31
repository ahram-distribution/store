-- ============================================================================
-- REMOVE: Erroneous get_governed_products uuid overload
--
-- Root cause: Migration 20270802_inventory_governance_phase4.sql used
-- CREATE OR REPLACE FUNCTION with p_token uuid, which did NOT replace the
-- canonical text-param function (p_token text) but instead created a
-- second overload. This caused PostgREST PGRST203 ambiguity.
--
-- Prior fix attempt (20270802_fix_get_governed_products_overload.sql) had
-- the same timestamp and ran BEFORE phase4 alphabetically, so the DROP
-- targeted a function that did not yet exist.
--
-- This migration is idempotent:
--   - If uuid overload exists → removes it
--   - If already clean → no-op
-- ============================================================================

-- 1. Remove the uuid overload (idempotent)
DROP FUNCTION IF EXISTS public.get_governed_products(
  uuid, boolean, boolean, text, uuid, boolean
);

-- 2. Reload PostgREST schema cache so it sees only one canonical signature
NOTIFY pgrst, 'reload schema';

-- 3. Verify only one canonical signature remains
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_governed_products'
    AND p.prokind = 'f';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'CRITICAL: get_governed_products not found after migration';
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'CRITICAL: get_governed_products still has % overloads after migration', v_count;
  END IF;
END;
$$;
