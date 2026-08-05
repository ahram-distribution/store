-- ============================================================================
-- RENAME ORDER TYPE VALUE: credit_extended -> ittiman
-- Reconciliation for environments that already applied
-- 20270829_add_credit_extended_order_type.sql (constraint currently allows
-- 'credit_extended'). Migrates existing rows, then drops and re-creates the
-- constraint with the business-approved value 'ittiman'. Idempotent.
-- ============================================================================

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS ck_orders_order_type;

UPDATE public.orders SET order_type = 'ittiman' WHERE order_type = 'credit_extended';

DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT ck_orders_order_type
    CHECK (order_type IN ('cash', 'credit', 'ittiman'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.orders.order_type IS 'نوع الطلب: cash (نقدي) أو credit (آجل) أو ittiman (ائتمان) — تصنيف بصري فقط';
