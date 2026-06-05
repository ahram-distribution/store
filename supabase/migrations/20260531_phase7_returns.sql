-- ============================================================================
-- PHASE 7: Returns
-- Source of Truth: DATABASE_SCHEMA_V1_SQL_SPEC.md
-- Executed: 2026-05-31
-- ============================================================================

-- 1. returns ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS returns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(30) NOT NULL,
    order_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    owner_type varchar(20) NOT NULL DEFAULT 'employee',
    owner_id uuid NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    credit_note_number varchar(30),
    credit_note_amount decimal(12,2),
    notes text,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE returns ADD CONSTRAINT fk_returns_order
    FOREIGN KEY (order_id) REFERENCES orders (id);
ALTER TABLE returns ADD CONSTRAINT fk_returns_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id);
ALTER TABLE returns ADD CONSTRAINT fk_returns_created_by
    FOREIGN KEY (created_by) REFERENCES employees (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_returns_code ON returns (code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_returns_credit_note_number ON returns (credit_note_number);

-- check constraints
ALTER TABLE returns ADD CONSTRAINT ck_returns_status
    CHECK (status IN ('pending', 'inspecting', 'approved', 'rejected'));
ALTER TABLE returns ADD CONSTRAINT ck_returns_owner_type
    CHECK (owner_type = 'employee');
ALTER TABLE returns ADD CONSTRAINT ck_returns_credit_note
    CHECK ((status = 'approved' AND credit_note_number IS NOT NULL AND credit_note_amount IS NOT NULL) OR (status != 'approved' AND credit_note_number IS NULL));

-- indexes
CREATE INDEX IF NOT EXISTS idx_returns_order_id ON returns (order_id);
CREATE INDEX IF NOT EXISTS idx_returns_customer_id ON returns (customer_id);
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns (status);

COMMENT ON TABLE returns IS 'Sales returns initiated against delivered orders. Credit note generated on approval.';
COMMENT ON COLUMN returns.code IS 'e.g., RET-YYYY-NNNNNN';
COMMENT ON COLUMN returns.status IS 'pending → inspecting → approved/rejected';
COMMENT ON COLUMN returns.credit_note_number IS 'CN-YYYY-NNNNNN. Generated on approval.';
COMMENT ON COLUMN returns.credit_note_amount IS 'Generated on approval.';

-- 2. return_items -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS return_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id uuid NOT NULL,
    product_id uuid NOT NULL,
    unit_type varchar(20) NOT NULL,
    quantity integer NOT NULL,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE return_items ADD CONSTRAINT fk_return_items_return
    FOREIGN KEY (return_id) REFERENCES returns (id) ON DELETE CASCADE;
ALTER TABLE return_items ADD CONSTRAINT fk_return_items_product
    FOREIGN KEY (product_id) REFERENCES products (id);

-- check constraints
ALTER TABLE return_items ADD CONSTRAINT ck_return_items_unit_type
    CHECK (unit_type IN ('piece', 'dozen', 'carton'));
ALTER TABLE return_items ADD CONSTRAINT ck_return_items_quantity
    CHECK (quantity > 0);

-- indexes
CREATE INDEX IF NOT EXISTS idx_return_items_return_id ON return_items (return_id);

COMMENT ON TABLE return_items IS 'Line items within a return.';
COMMENT ON COLUMN return_items.unit_type IS 'Original unit type';
COMMENT ON COLUMN return_items.quantity IS 'Units being returned';

-- 3. return_inspection --------------------------------------------------------

CREATE TABLE IF NOT EXISTS return_inspection (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_item_id uuid NOT NULL,
    condition varchar(20) NOT NULL,
    inspected_by uuid NOT NULL,
    notes text,
    inspected_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE return_inspection ADD CONSTRAINT fk_return_inspection_item
    FOREIGN KEY (return_item_id) REFERENCES return_items (id) ON DELETE CASCADE;
ALTER TABLE return_inspection ADD CONSTRAINT fk_return_inspection_inspected_by
    FOREIGN KEY (inspected_by) REFERENCES employees (id);

-- check constraints
ALTER TABLE return_inspection ADD CONSTRAINT ck_return_inspection_condition
    CHECK (condition IN ('saleable', 'damaged', 'expired', 'unsaleable'));

-- indexes
CREATE INDEX IF NOT EXISTS idx_return_inspection_item_id ON return_inspection (return_item_id);

COMMENT ON TABLE return_inspection IS 'Inspection results for each returned item. Determines inventory reentry.';
COMMENT ON COLUMN return_inspection.condition IS 'saleable = return to inventory, others = write off';

-- ============================================================================
-- END OF PHASE 7
-- ============================================================================
