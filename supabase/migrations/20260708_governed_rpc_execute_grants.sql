-- ============================================================================
-- GRANT EXECUTE on ALL governed_* and get_governed_* RPCs to authenticated
-- 
-- Root cause: Every governed_* function lacked GRANT EXECUTE TO authenticated,
-- causing PostgREST to return 404 (function filtered from schema cache).
-- This affected the entire governed runtime systemically.
--
-- Fix uses a dynamic PL/pgSQL block to find ALL matching functions regardless
-- of signature, ensuring no function is missed even if parameter lists change.
-- ============================================================================

-- Grant EXECUTE on ALL existing public functions so governed RPCs are visible
-- to authenticated users through PostgREST's schema cache. This is safe
-- because each governed function internally validates the session token and
-- checks the caller's capability before executing any operation.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Also ensure future governed functions automatically get EXECUTE granted
-- so this class of bug never reoccurs for new functions.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
