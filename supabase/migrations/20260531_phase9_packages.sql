-- ============================================================================
-- PHASE 9: Packages (Daily Deals & Flash Offers)
-- Source of Truth: DATABASE_SCHEMA_V1_SQL_SPEC.md
-- Executed: 2026-05-31
-- ============================================================================

-- 1. packages -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS packages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    package_type varchar(20) NOT NULL,
    name varchar(255) NOT NULL,
    description text,
    price decimal(12,2) NOT NULL,
    available_quantity integer NOT NULL DEFAULT 0,
    original_quantity integer NOT NULL DEFAULT 0,
    start_time timestamptz,
    end_time timestamptz,
    status varchar(20) NOT NULL DEFAULT 'active',
    is_manual_stop boolean NOT NULL DEFAULT false,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE packages ADD CONSTRAINT fk_packages_created_by
    FOREIGN KEY (created_by) REFERENCES employees (id);

-- check constraints
ALTER TABLE packages ADD CONSTRAINT ck_packages_type
    CHECK (package_type IN ('daily_deal', 'flash_offer'));
ALTER TABLE packages ADD CONSTRAINT ck_packages_status
    CHECK (status IN ('active', 'paused', 'expired', 'ended', 'cancelled'));
ALTER TABLE packages ADD CONSTRAINT ck_packages_price
    CHECK (price >= 0);
ALTER TABLE packages ADD CONSTRAINT ck_packages_quantity
    CHECK (available_quantity >= 0 AND original_quantity >= 0);
ALTER TABLE packages ADD CONSTRAINT ck_packages_time
    CHECK (start_time IS NULL OR end_time IS NULL OR start_time < end_time);

-- indexes
CREATE INDEX IF NOT EXISTS idx_packages_status ON packages (status);
CREATE INDEX IF NOT EXISTS idx_packages_type ON packages (package_type);

COMMENT ON TABLE packages IS 'Commercial packages for Daily Deals and Flash Offers. Independent inventory.';
COMMENT ON COLUMN packages.package_type IS 'daily_deal or flash_offer';
COMMENT ON COLUMN packages.available_quantity IS 'Current available inventory';
COMMENT ON COLUMN packages.original_quantity IS 'Initial quantity';
COMMENT ON COLUMN packages.is_manual_stop IS 'Administrator stopped the package';

-- 2. package_items ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS package_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id uuid NOT NULL,
    product_id uuid NOT NULL,
    unit_type varchar(20) NOT NULL,
    quantity integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE package_items ADD CONSTRAINT fk_package_items_package
    FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE;
ALTER TABLE package_items ADD CONSTRAINT fk_package_items_product
    FOREIGN KEY (product_id) REFERENCES products (id);

-- indexes
CREATE INDEX IF NOT EXISTS idx_package_items_package_id ON package_items (package_id);

COMMENT ON TABLE package_items IS 'Products included in a package.';

-- 3. package_orders -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS package_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id uuid NOT NULL,
    order_id uuid NOT NULL,
    quantity integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE package_orders ADD CONSTRAINT fk_package_orders_package
    FOREIGN KEY (package_id) REFERENCES packages (id);
ALTER TABLE package_orders ADD CONSTRAINT fk_package_orders_order
    FOREIGN KEY (order_id) REFERENCES orders (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_package_orders ON package_orders (package_id, order_id);

-- check constraints
ALTER TABLE package_orders ADD CONSTRAINT ck_package_orders_quantity
    CHECK (quantity > 0);

-- indexes
CREATE INDEX IF NOT EXISTS idx_package_orders_package_id ON package_orders (package_id);
CREATE INDEX IF NOT EXISTS idx_package_orders_order_id ON package_orders (order_id);

COMMENT ON TABLE package_orders IS 'Links packages to orders. Tracks deduction and restoration of package inventory.';

-- ============================================================================
-- END OF PHASE 9
-- ============================================================================
