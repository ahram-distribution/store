-- Phase 3b: Make carton_quantity and carton_price nullable
-- Products may have piece-only, piece+dozen, or piece+dozen+carton

ALTER TABLE products ALTER COLUMN carton_quantity DROP NOT NULL;
ALTER TABLE products ALTER COLUMN carton_price DROP NOT NULL;

COMMENT ON COLUMN products.carton_quantity IS 'Pieces per carton. NULL means no carton unit for this product.';
COMMENT ON COLUMN products.carton_price IS 'Price per carton. NULL/0 means price not yet set.';
