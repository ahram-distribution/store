-- ============================================================================
-- DROP SAHL MODULE (سهل)
-- ============================================================================
-- Removes every Sahl database object (tables, views, functions, triggers,
-- policies, grants, capabilities, grants, code and capability entries) that was
-- created by the 20260822–20260830 sahl_* migrations.
--
-- NOTE: this is an additive migration. The original sahl_* migration files are
-- left in place (they are part of the migration ledger history and must not be
-- replayed / deleted retroactively); this migration neutralizes their objects
-- in every environment, so downstream behavior is fully Sahl-free.
--
-- The approved catalog egress/optimization objects (get_governed_product,
-- sahl-independent catalog RPCs from 20271118) are NOT touched.
-- ============================================================================

-- 1) Tear-down order: policies → triggers → functions (dependents first) → tables.

-- 1a. Drop RLS policies on SLACK-managed sahl tables ---------------------------------
-- Supabase auto-generates policies; drop any that reference sahl_* tables.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename LIKE 'sahl\_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END
$$;

-- 1b. Drop triggers that fire Sahl functions ------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.tgname, c.relname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND (c.relname LIKE 'sahl\_%' OR p.proname LIKE 'sahl\_%')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.tgname, r.relname);
  END LOOP;
END
$$;

-- 1c. Drop every public.sahl_* function (name may be exactly 'sahl_\w+' or the
--     '_sahl_*' internal helpers). ------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'sahl\_%' OR p.proname LIKE '\_sahl\_%')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s)', r.proname, r.args);
  END LOOP;
END
$$;

-- 1d. Drop sahl_* sequences -----------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND c.relname LIKE 'sahl\_%'
  LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS public.%I', r.relname);
  END LOOP;
END
$$;

-- 1e. Drop sahl_* types / enums --------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname LIKE 'sahl\_%'
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I', r.typname);
  END LOOP;
END
$$;

-- 1f. Drop sahl_* tables ------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname LIKE 'sahl\_%'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname);
  END LOOP;
END
$$;

-- 1g. Drop any remaining sahl_* views -----------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('v', 'm')
      AND c.relname LIKE 'sahl\_%'
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS public.%I', r.relname);
  END LOOP;
END
$$;

-- 2) Capabilities ---------------------------------------------------------------
-- Remove the sahl.* capability catalog entries and every role mapping to them.
DELETE FROM public.role_capabilities
WHERE capability_id IN (SELECT id FROM public.capabilities WHERE code LIKE 'sahl.%');

DELETE FROM public.capabilities
WHERE code LIKE 'sahl.%';

-- 2b. Clean up any remaining grant mappings pointing at sahl capabilities
--     (capability_grants / user_capability_grants if such tables exist).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='capability_grants') THEN
    DELETE FROM public.capability_grants WHERE capability_code LIKE 'sahl.%';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_capability_grants') THEN
    DELETE FROM public.user_capability_grants WHERE capability_code LIKE 'sahl.%';
  END IF;
END
$$;
