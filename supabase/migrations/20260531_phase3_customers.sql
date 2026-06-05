-- ============================================================================
-- PHASE 3: Catalog & Inventory
-- Source of Truth: DATABASE_SCHEMA_V1_SQL_SPEC.md
-- Executed: 2026-05-31
-- ============================================================================

-- 1. companies ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name varchar(255) NOT NULL,
    legacy_code varchar(100) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_name ON companies (company_name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_legacy_code ON companies (legacy_code);

COMMENT ON TABLE companies IS 'Product manufacturers or brands.';
COMMENT ON COLUMN companies.legacy_code IS 'Immutable legacy company code from previous system';

-- 2. products -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL,
    product_name varchar(255) NOT NULL,
    legacy_code varchar(100) NOT NULL,
    description text,
    carton_quantity integer NOT NULL,
    carton_price decimal(12,2) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    image_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE products ADD CONSTRAINT fk_products_company
    FOREIGN KEY (company_id) REFERENCES companies (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_company_name ON products (company_id, product_name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_legacy_code ON products (legacy_code);

-- check constraints
ALTER TABLE products ADD CONSTRAINT ck_products_carton_quantity
    CHECK (carton_quantity > 0);
ALTER TABLE products ADD CONSTRAINT ck_products_carton_price
    CHECK (carton_price >= 0);

-- indexes
CREATE INDEX IF NOT EXISTS idx_products_company_id ON products (company_id);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products (is_active);

COMMENT ON TABLE products IS 'Individual products within a company catalog. Multi-unit sales supported.';
COMMENT ON COLUMN products.legacy_code IS 'Immutable legacy product code from previous system';
COMMENT ON COLUMN products.carton_quantity IS 'Pieces per carton. Must be > 0. Source of truth for carton piece-quantity.';
COMMENT ON COLUMN products.carton_price IS 'Price per carton. Piece and dozen prices computed in application.';

-- 3. product_units ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_units (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL,
    unit_type varchar(20) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE product_units ADD CONSTRAINT fk_product_units_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE;

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_units_type ON product_units (product_id, unit_type);

-- check constraints
ALTER TABLE product_units ADD CONSTRAINT ck_product_units_type
    CHECK (unit_type IN ('piece', 'dozen', 'carton'));

-- indexes
CREATE INDEX IF NOT EXISTS idx_product_units_product_id ON product_units (product_id);
CREATE INDEX IF NOT EXISTS idx_product_units_active ON product_units (product_id) WHERE is_active = true;

COMMENT ON TABLE products IS 'Supported sales units per product. Single source of truth for available units.';
COMMENT ON COLUMN product_units.unit_type IS 'piece, dozen, or carton. multiplier omitted — computed in application from products.carton_quantity.';
COMMENT ON COLUMN product_units.is_active IS 'Controls unit availability without deleting the record';

-- 4. inventory ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inventory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL,
    quantity integer NOT NULL DEFAULT 0,
    last_counted_at timestamptz,
    notes text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE inventory ADD CONSTRAINT fk_inventory_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE;

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_product_id ON inventory (product_id);

-- check constraints
ALTER TABLE inventory ADD CONSTRAINT ck_inventory_quantity
    CHECK (quantity >= 0);

COMMENT ON TABLE inventory IS 'Manual inventory tracking. One record per product (1:1). Quantity deducted at order approval.';
COMMENT ON COLUMN inventory.quantity IS 'Current stock in pieces. Must be >= 0.';
COMMENT ON COLUMN inventory.last_counted_at IS 'Timestamp of last physical count';

-- ============================================================================
-- END OF PHASE 3
-- ============================================================================
