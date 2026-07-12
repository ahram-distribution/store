-- ============================================================================
-- ADD order_type TO orders
-- Visual classification only — no impact on workflow, approvals, or logic.
-- ============================================================================

-- Add order_type column with CHECK constraint
DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN order_type varchar(20) NOT NULL DEFAULT 'cash';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add CHECK constraint
DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT ck_orders_order_type
    CHECK (order_type IN ('cash', 'credit'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.orders.order_type IS 'نوع الطلب: cash (نقدي) أو credit (آجل) — تصنيف بصري فقط';
