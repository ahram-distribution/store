-- ============================================================================
-- PHASE 6: Collections & Treasury
-- Source of Truth: DATABASE_SCHEMA_V1_SQL_SPEC.md
-- Executed: 2026-05-31
-- ============================================================================

-- 1. collections --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS collections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(30) NOT NULL,
    customer_id uuid NOT NULL,
    owner_type varchar(20) NOT NULL DEFAULT 'employee',
    owner_id uuid NOT NULL,
    method varchar(20) NOT NULL,
    amount decimal(12,2) NOT NULL,
    reference_number varchar(100),
    status varchar(30) NOT NULL DEFAULT 'pending',
    notes text,
    collected_at timestamptz,
    approved_by uuid,
    approved_at timestamptz,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE collections ADD CONSTRAINT fk_collections_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id);
ALTER TABLE collections ADD CONSTRAINT fk_collections_created_by
    FOREIGN KEY (created_by) REFERENCES employees (id);
ALTER TABLE collections ADD CONSTRAINT fk_collections_approved_by
    FOREIGN KEY (approved_by) REFERENCES employees (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_collections_code ON collections (code);

-- check constraints
ALTER TABLE collections ADD CONSTRAINT ck_collections_owner_type
    CHECK (owner_type = 'employee');
ALTER TABLE collections ADD CONSTRAINT ck_collections_method
    CHECK (method IN ('cash', 'bank_transfer', 'cheque', 'deposit'));
ALTER TABLE collections ADD CONSTRAINT ck_collections_status
    CHECK (status IN ('pending', 'approved', 'treasury_posted'));
ALTER TABLE collections ADD CONSTRAINT ck_collections_amount
    CHECK (amount > 0);

-- indexes
CREATE INDEX IF NOT EXISTS idx_collections_customer_id ON collections (customer_id);
CREATE INDEX IF NOT EXISTS idx_collections_status ON collections (status);
CREATE INDEX IF NOT EXISTS idx_collections_owner_id ON collections (owner_id);

COMMENT ON TABLE collections IS 'Payment collections from customers. Affects customer ledger balance.';
COMMENT ON COLUMN collections.code IS 'e.g., COL-YYYY-NNNNNN';
COMMENT ON COLUMN collections.method IS 'Collection method: cash, bank_transfer, cheque, deposit';
COMMENT ON COLUMN collections.reference_number IS 'Cheque number, transfer ref, etc.';
COMMENT ON COLUMN collections.status IS 'pending → approved → treasury_posted';

-- 2. treasury_transactions ----------------------------------------------------

CREATE TABLE IF NOT EXISTS treasury_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type varchar(10) NOT NULL,
    amount decimal(12,2) NOT NULL,
    reference_type varchar(50) NOT NULL,
    reference_id uuid NOT NULL,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE treasury_transactions ADD CONSTRAINT fk_treasury_created_by
    FOREIGN KEY (created_by) REFERENCES employees (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_reference ON treasury_transactions (reference_type, reference_id);

-- check constraints
ALTER TABLE treasury_transactions ADD CONSTRAINT ck_treasury_type
    CHECK (transaction_type IN ('inflow', 'outflow'));
ALTER TABLE treasury_transactions ADD CONSTRAINT ck_treasury_amount
    CHECK (amount > 0);
ALTER TABLE treasury_transactions ADD CONSTRAINT ck_treasury_reference_type
    CHECK (reference_type IN ('collection', 'expense', 'employee_advance'));

-- indexes
CREATE INDEX IF NOT EXISTS idx_treasury_created_at ON treasury_transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_treasury_reference ON treasury_transactions (reference_type, reference_id);

COMMENT ON TABLE treasury_transactions IS 'Records every fund movement in or out of the single treasury.';
COMMENT ON COLUMN treasury_transactions.transaction_type IS 'inflow or outflow';
COMMENT ON COLUMN treasury_transactions.reference_type IS 'collection, expense, or employee_advance';
COMMENT ON COLUMN treasury_transactions.reference_id IS 'FK to the source entity';

-- 3. expenses -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS expenses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(30) NOT NULL,
    expense_type varchar(50) NOT NULL,
    amount decimal(12,2) NOT NULL,
    description text,
    receipt_url text,
    approved_by uuid,
    approved_at timestamptz,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE expenses ADD CONSTRAINT fk_expenses_created_by
    FOREIGN KEY (created_by) REFERENCES employees (id);
ALTER TABLE expenses ADD CONSTRAINT fk_expenses_approved_by
    FOREIGN KEY (approved_by) REFERENCES employees (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_code ON expenses (code);

-- check constraints
ALTER TABLE expenses ADD CONSTRAINT ck_expenses_type
    CHECK (expense_type IN ('transportation', 'fuel', 'shipping', 'salaries', 'bonuses', 'employee_advances', 'hospitality', 'maintenance', 'rent', 'utilities', 'other'));
ALTER TABLE expenses ADD CONSTRAINT ck_expenses_amount
    CHECK (amount > 0);

-- indexes
CREATE INDEX IF NOT EXISTS idx_expenses_type ON expenses (expense_type);
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses (created_at);

COMMENT ON TABLE expenses IS 'Operational expenditures against the single treasury.';
COMMENT ON COLUMN expenses.code IS 'e.g., EXP-YYYY-NNNNNN';

-- 4. employee_advances --------------------------------------------------------

CREATE TABLE IF NOT EXISTS employee_advances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    amount decimal(12,2) NOT NULL,
    outstanding_amount decimal(12,2) NOT NULL,
    reason text,
    is_settled boolean NOT NULL DEFAULT false,
    approved_by uuid,
    approved_at timestamptz,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE employee_advances ADD CONSTRAINT fk_advances_employee
    FOREIGN KEY (employee_id) REFERENCES employees (id);
ALTER TABLE employee_advances ADD CONSTRAINT fk_advances_approved_by
    FOREIGN KEY (approved_by) REFERENCES employees (id);
ALTER TABLE employee_advances ADD CONSTRAINT fk_advances_created_by
    FOREIGN KEY (created_by) REFERENCES employees (id);

-- check constraints
ALTER TABLE employee_advances ADD CONSTRAINT ck_advances_amount
    CHECK (amount > 0 AND outstanding_amount >= 0 AND outstanding_amount <= amount);
ALTER TABLE employee_advances ADD CONSTRAINT ck_advances_settled
    CHECK ((is_settled = true AND outstanding_amount = 0) OR (is_settled = false AND outstanding_amount > 0));

-- indexes
CREATE INDEX IF NOT EXISTS idx_advances_employee_id ON employee_advances (employee_id);
CREATE INDEX IF NOT EXISTS idx_advances_is_settled ON employee_advances (is_settled);

COMMENT ON TABLE employee_advances IS 'Advances paid to employees. Creates an employee liability.';
COMMENT ON COLUMN employee_advances.outstanding_amount IS 'Remaining to be repaid';
COMMENT ON COLUMN employee_advances.is_settled IS 'True when outstanding = 0';

-- ============================================================================
-- END OF PHASE 6
-- ============================================================================
