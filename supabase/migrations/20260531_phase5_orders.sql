-- ============================================================================
-- PHASE 5: Orders
-- Source of Truth: DATABASE_SCHEMA_V1_SQL_SPEC.md
-- Executed: 2026-05-31
-- ============================================================================

-- 1. orders -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number varchar(30) NOT NULL,
    customer_id uuid NOT NULL,
    owner_type varchar(20) NOT NULL DEFAULT 'employee',
    owner_id uuid NOT NULL,
    status varchar(30) NOT NULL DEFAULT 'draft',
    subtotal decimal(12,2) NOT NULL DEFAULT 0,
    discount_amount decimal(12,2) NOT NULL DEFAULT 0,
    tax_amount decimal(12,2) NOT NULL DEFAULT 0,
    total_amount decimal(12,2) NOT NULL DEFAULT 0,
    notes text,
    revision_number integer NOT NULL DEFAULT 1,
    submitted_at timestamptz,
    approved_at timestamptz,
    delivered_at timestamptz,
    cancelled_at timestamptz,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE orders ADD CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id);
ALTER TABLE orders ADD CONSTRAINT fk_orders_created_by
    FOREIGN KEY (created_by) REFERENCES employees (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_order_number ON orders (order_number);

-- check constraints
ALTER TABLE orders ADD CONSTRAINT ck_orders_owner_type
    CHECK (owner_type = 'employee');
ALTER TABLE orders ADD CONSTRAINT ck_orders_status
    CHECK (status IN ('draft', 'submitted', 'reviewing', 'returned_for_revision', 'approved', 'preparing', 'dispatched', 'delivered'));
ALTER TABLE orders ADD CONSTRAINT ck_orders_amounts
    CHECK (subtotal >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0);
ALTER TABLE orders ADD CONSTRAINT ck_orders_revision
    CHECK (revision_number >= 1);

-- indexes
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_owner_id ON orders (owner_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders (order_number);

COMMENT ON TABLE orders IS 'Customer orders with full lifecycle tracking.';
COMMENT ON COLUMN orders.order_number IS 'AHR-YYYY-NNNNNN. Never changes across revisions.';
COMMENT ON COLUMN orders.owner_type IS 'Always employee';
COMMENT ON COLUMN orders.owner_id IS 'FK to employees.id — the Sales Representative who owns the order';
COMMENT ON COLUMN orders.status IS 'Order lifecycle: draft → submitted → reviewing → returned_for_revision/approved → preparing → dispatched → delivered';
COMMENT ON COLUMN orders.total_amount IS 'subtotal - discount + tax';
COMMENT ON COLUMN orders.revision_number IS 'Incremented on each revision';

-- 2. order_items --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    unit_type varchar(20) NOT NULL,
    unit_quantity integer NOT NULL,
    piece_quantity integer NOT NULL,
    unit_price decimal(12,2) NOT NULL,
    total_price decimal(12,2) NOT NULL
);

-- foreign keys
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE;
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_product
    FOREIGN KEY (product_id) REFERENCES products (id);

-- check constraints
ALTER TABLE order_items ADD CONSTRAINT ck_order_items_unit_type
    CHECK (unit_type IN ('piece', 'dozen', 'carton'));
ALTER TABLE order_items ADD CONSTRAINT ck_order_items_quantity
    CHECK (unit_quantity > 0 AND piece_quantity > 0);
ALTER TABLE order_items ADD CONSTRAINT ck_order_items_price
    CHECK (unit_price >= 0 AND total_price >= 0);

-- indexes
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items (product_id);

COMMENT ON TABLE order_items IS 'Line items within an order. Prices captured at order time.';
COMMENT ON COLUMN order_items.unit_type IS 'At time of order: piece, dozen, or carton';
COMMENT ON COLUMN order_items.unit_quantity IS 'Number of units ordered';
COMMENT ON COLUMN order_items.piece_quantity IS 'Total pieces: unit_quantity × computed_piece_multiplier';
COMMENT ON COLUMN order_items.unit_price IS 'Price per unit at order time';
COMMENT ON COLUMN order_items.total_price IS 'unit_quantity × unit_price';

-- 3. order_status_history -----------------------------------------------------

CREATE TABLE IF NOT EXISTS order_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    from_status varchar(30),
    to_status varchar(30) NOT NULL,
    changed_by uuid NOT NULL,
    reason text,
    changed_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE order_status_history ADD CONSTRAINT fk_order_status_history_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE;
ALTER TABLE order_status_history ADD CONSTRAINT fk_order_status_history_changed_by
    FOREIGN KEY (changed_by) REFERENCES employees (id);

-- check constraints
ALTER TABLE order_status_history ADD CONSTRAINT ck_order_status_from
    CHECK (from_status IN ('draft', 'submitted', 'reviewing', 'returned_for_revision', 'approved', 'preparing', 'dispatched', 'delivered') OR from_status IS NULL);
ALTER TABLE order_status_history ADD CONSTRAINT ck_order_status_to
    CHECK (to_status IN ('draft', 'submitted', 'reviewing', 'returned_for_revision', 'approved', 'preparing', 'dispatched', 'delivered'));

-- indexes
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON order_status_history (order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_changed_at ON order_status_history (changed_at);

COMMENT ON TABLE order_status_history IS 'Complete audit trail of every status change in an order lifecycle.';
COMMENT ON COLUMN order_status_history.from_status IS 'Null for initial creation';

-- 4. order_modification_history ----------------------------------------------

CREATE TABLE IF NOT EXISTS order_modification_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    revision_number integer NOT NULL,
    field_name varchar(100) NOT NULL,
    old_value text,
    new_value text,
    modified_by uuid NOT NULL,
    reason text NOT NULL,
    modified_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE order_modification_history ADD CONSTRAINT fk_order_mod_history_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE;
ALTER TABLE order_modification_history ADD CONSTRAINT fk_order_mod_history_modified_by
    FOREIGN KEY (modified_by) REFERENCES employees (id);

-- check constraints
ALTER TABLE order_modification_history ADD CONSTRAINT ck_order_mod_revision
    CHECK (revision_number >= 1);

-- indexes
CREATE INDEX IF NOT EXISTS idx_order_mod_history_order_id ON order_modification_history (order_id);
CREATE INDEX IF NOT EXISTS idx_order_mod_history_modified_at ON order_modification_history (modified_at);

COMMENT ON TABLE order_modification_history IS 'Audit trail of modifications made to orders after submission.';
COMMENT ON COLUMN order_modification_history.reason IS 'Required for all modifications';

-- ============================================================================
-- END OF PHASE 5
-- ============================================================================
