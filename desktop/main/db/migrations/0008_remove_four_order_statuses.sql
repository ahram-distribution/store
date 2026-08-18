-- ============================================================================
-- Migration 0008: Remove four order statuses
-- sales_manager_approved, ready_for_dispatch, sent_to_delivery, stock_review
--
-- New workflow: submitted → reviewing → approved → preparing → prepared → dispatched → delivered
-- ============================================================================

-- No schema changes needed (status is varchar(30), no CHECK constraint).
-- Any existing orders with removed statuses should be migrated to 'submitted'
-- for review, but we verified there are 0 live orders using these statuses.

-- This migration exists for documentation and to keep the manifest in sync
-- with the Supabase migration 20270922_remove_four_order_statuses.sql.
