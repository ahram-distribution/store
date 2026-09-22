-- ============================================================================
-- DROP SAHL MODULE (سهل) — DESKTOP (0028)
-- ============================================================================
-- Neutralizes every sahl_* database object that schema.sql would otherwise
-- (re)create and that earlier installs may already hold.
--
-- All statements are intentionally guard-safe (catalog-driven DO loops +
-- IF EXISTS). They make NO assumption about the existence of any capability /
-- role mapping table, so this runs cleanly on every desktop DB (fresh or
-- upgraded). It does NOT touch the approved catalog egress optimization
-- (0027_get_governed_product_rpc.sql / get_governed_product).
-- ============================================================================

-- 1. Drop sahl_* triggers ------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.tgname, c.relname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal
      AND (c.relname LIKE 'sahl\_%' OR t.tgfoid IN (
            SELECT oid FROM pg_proc p WHERE p.proname LIKE 'sahl\_%' OR p.proname LIKE '\_sahl\_%'))
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.tgname, r.relname);
  END LOOP;
END
$$;

-- 2. Drop sahl_* functions -----------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'sahl\_%' OR p.proname LIKE '\_sahl\_%')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s)', r.proname, r.args);
  END LOOP;
END
$$;

-- 3. Drop sahl_* sequences -----------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname LIKE 'sahl\_%'
  LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS public.%I', r.relname);
  END LOOP;
END
$$;

-- 4. Drop sahl_* types / enums ------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname LIKE 'sahl\_%'
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I', r.typname);
  END LOOP;
END
$$;

-- 5. Drop sahl_* tables --------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'sahl\_%'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname);
  END LOOP;
END
$$;

-- 6. Drop sahl_* views ---------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v','m') AND c.relname LIKE 'sahl\_%'
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS public.%I', r.relname);
  END LOOP;
END
$$;

-- 7. Clean sahl.* capability/grant rows only IF the catalog tables exist --------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'capabilities') THEN
    EXECUTE 'DELETE FROM public.role_capabilities
               WHERE capability_id IN (SELECT id FROM public.capabilities WHERE code LIKE ''sahl.%'')';
    EXECUTE 'DELETE FROM public.capabilities WHERE code LIKE ''sahl.%''';
  END IF dogs;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'capability_grants') THEN
    EXECUTE 'DELETE FROM public.capability_grants WHERE capability_code LIKE ''sahl.%''';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'user_capability_grants') THEN
    EXECUTE 'DELETE FROM public.user_capability_grants WHERE capability_code LIKE ''sahl.%''';
  END IF;
END
$$;
