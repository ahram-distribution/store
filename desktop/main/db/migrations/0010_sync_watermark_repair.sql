-- ============================================================================
-- Migration 0010: Synchronization watermark/delete repair (FIX5)
--
-- FIX5 changes the sync engine so that:
--   1. Deletions recorded in deletion_audit_log are propagated to the local
--      mirror (FK-safe, idempotent).
--   2. The sync watermark advances only to the boundary actually processed
--      (max updated_at), never to the clock at completion.
--   3. Order item sets are reconciled per order so replaced items (supreme
--      edits) no longer linger locally.
--
-- Historical installs may carry a watermark that is already past remote
-- updates that were never applied (e.g. rows skipped by the old insert-only
-- initial sync). This migration sets the full-refresh gate so the next
-- startup runs a full pull with the corrected engine, converging the local
-- mirror to the published state before offline READY is granted.
--
-- The gate is also set by the app's post-migration path; this SQL makes the
-- intent explicit and idempotent.
-- ============================================================================

INSERT INTO app.app_settings (key, value, description, created_at, updated_at)
VALUES (
  'sync_requires_full_refresh',
  'true'::jsonb,
  'FIX5 sync repair — full sync required before offline READY',
  now(),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, description = EXCLUDED.description, updated_at = now();

DELETE FROM app.app_settings WHERE key = 'offline_ready';