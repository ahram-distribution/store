-- Global Benefit Mode (spec §24): immediate live switch between "خصم مباشر على
-- المنتجات" and "بونص شرائح" across every connected storefront without reload.
--
-- Signal path: governed_set_bonus_mode() appends a row to the append-only
-- public.bonus_mode_audit table. Publishing that table on the realtime
-- publication lets every client observe the INSERT and re-read the governed
-- mode via get_governed_bonus_config() (same mechanism as geographic rules).
-- The in-app broadcast channel covers the case where this publication is not
-- applied yet (the admin announces the change explicitly).

-- Realtime: mirror the geographic-pricing live-refresh pattern.
-- Idempotent and safe when the publication does not exist (desktop mirror).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bonus_mode_audit'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.bonus_mode_audit';
    END IF;
END $$;