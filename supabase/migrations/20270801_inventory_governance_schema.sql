-- ============================================================================
-- INVENTORY GOVERNANCE — PHASE 1: Schema Changes
-- Adds product-level inventory config, per-order policy snapshots,
-- Stock Review status, and removes inventory quantity floor.
--
-- Baseline: Negative Selling ALLOWED (default true)
--           Inventory Deduction Status = 'approved' (default)
--           All existing products preserved exactly as-is.
-- ============================================================================

-- 1. Product-level inventory configuration
-- ---------------------------------------------------------------------------

-- Negative Selling policy per product
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS negative_selling_allowed boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.products.negative_selling_allowed IS
  'When true: inventory may go negative. When false: deduction cannot exceed available stock. Default true for backward compatibility.';

-- Configurable inventory deduction status per product
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS inventory_deduction_status varchar(30) NOT NULL DEFAULT 'approved';

COMMENT ON COLUMN public.products.inventory_deduction_status IS
  'Canonical order status at which inventory is deducted for this product. Default approved.';

-- OOS source: NULL = manual/legacy, ''inventory'' = automatic from inventory rules
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS oos_source varchar(20) DEFAULT NULL;

COMMENT ON COLUMN public.products.oos_source IS
  'NULL = manual/legacy OOS (never auto-cleared). ''inventory'' = automatic OOS from inventory rules (may auto-clear on replenishment).';

-- 2. Per-order policy snapshots
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_negative_selling_allowed boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.orders.order_negative_selling_allowed IS
  'Snapshot of product negative_selling_allowed at order creation time. Preserves policy for that order.';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_inventory_deduction_status varchar(30) NOT NULL DEFAULT 'approved';

COMMENT ON COLUMN public.orders.order_inventory_deduction_status IS
  'Snapshot of product inventory_deduction_status at order creation time.';

-- 3. Exactly-once inventory deduction tracking
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS inventory_deducted_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.orders.inventory_deducted_at IS
  'Timestamp when inventory was first deducted for this order. NULL = not yet deducted. Used for exactly-once guard.';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS inventory_deducted_items jsonb DEFAULT NULL;

COMMENT ON COLUMN public.orders.inventory_deducted_items IS
  'JSONB snapshot of deducted items: [{product_id, piece_quantity}]. Used for full restoration.';

-- 4. Stock Review status
-- ---------------------------------------------------------------------------

-- Drop the old CHECK constraint on orders.status
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS ck_orders_status;

-- Add new CHECK constraint with stock_review included
ALTER TABLE public.orders
  ADD CONSTRAINT ck_orders_status
  CHECK (status IN (
    'draft', 'submitted', 'reviewing', 'returned_for_revision',
    'approved', 'preparing', 'prepared', 'ready_for_dispatch',
    'sent_to_delivery', 'dispatched', 'deferred', 'cancelled',
    'delivered', 'stock_review'
  ));

-- Update order_status_history CHECK constraints to include stock_review
ALTER TABLE public.order_status_history
  DROP CONSTRAINT IF EXISTS ck_order_status_from;

ALTER TABLE public.order_status_history
  ADD CONSTRAINT ck_order_status_from
  CHECK (from_status IN (
    'draft', 'submitted', 'reviewing', 'returned_for_revision',
    'approved', 'preparing', 'prepared', 'ready_for_dispatch',
    'sent_to_delivery', 'dispatched', 'deferred', 'cancelled',
    'delivered', 'stock_review'
  ) OR from_status IS NULL);

ALTER TABLE public.order_status_history
  DROP CONSTRAINT IF EXISTS ck_order_status_to;

ALTER TABLE public.order_status_history
  ADD CONSTRAINT ck_order_status_to
  CHECK (to_status IN (
    'draft', 'submitted', 'reviewing', 'returned_for_revision',
    'approved', 'preparing', 'prepared', 'ready_for_dispatch',
    'sent_to_delivery', 'dispatched', 'deferred', 'cancelled',
    'delivered', 'stock_review'
  ));

-- 5. Remove inventory quantity floor to allow negative balances
-- ---------------------------------------------------------------------------

-- When negative_selling_allowed = false, the application enforces the floor.
-- When negative_selling_allowed = true, inventory may go negative.
ALTER TABLE public.inventory
  DROP CONSTRAINT IF EXISTS ck_inventory_quantity;

-- No replacement constraint — the floor is enforced at the application/RPC level
-- based on the product's negative_selling_allowed setting.

-- ============================================================================
-- END OF PHASE 1
-- ============================================================================
