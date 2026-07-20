-- Phase 1: Stored Product Prices
-- Add piece_price and dozen_price columns to products.
-- These are GENERATED values computed from carton_price / carton_quantity.
-- Only governed_create_product and governed_update_product_pricing may write them.
-- All other consumers read them as read-only.

-- 1. Add columns (nullable initially for safe backfill)
ALTER TABLE products ADD COLUMN piece_price decimal(12,2);
ALTER TABLE products ADD COLUMN dozen_price decimal(12,2);

-- 2. Backfill existing products from carton_price / carton_quantity
UPDATE products
SET
  piece_price = CASE
    WHEN carton_price IS NOT NULL AND carton_price > 0
         AND carton_quantity IS NOT NULL AND carton_quantity > 0
    THEN ROUND((carton_price / carton_quantity)::numeric, 2)
    ELSE 0
  END,
  dozen_price = CASE
    WHEN carton_price IS NOT NULL AND carton_price > 0
         AND carton_quantity IS NOT NULL AND carton_quantity > 0
    THEN ROUND((carton_price / carton_quantity * 12)::numeric, 2)
    ELSE 0
  END;

-- 3. Enforce NOT NULL after backfill
ALTER TABLE products ALTER COLUMN piece_price SET NOT NULL;
ALTER TABLE products ALTER COLUMN dozen_price SET NOT NULL;
ALTER TABLE products ALTER COLUMN piece_price SET DEFAULT 0;
ALTER TABLE products ALTER COLUMN dozen_price SET DEFAULT 0;
