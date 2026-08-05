-- ============================================================================
-- ADD ORDER TYPE: ittiman (ائتمان)
-- Visual classification only — no impact on workflow, approvals, or logic.
-- Same treatment as cash (كاش) and credit (آجل) from 20270716_add_order_type.sql.
-- Enum value approved by the business owner.
-- ============================================================================

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS ck_orders_order_type;

DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT ck_orders_order_type
    CHECK (order_type IN ('cash', 'credit', 'ittiman'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.orders.order_type IS 'نوع الطلب: cash (نقدي) أو credit (آجل) أو ittiman (ائتمان) — تصنيف بصري فقط';
