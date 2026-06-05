-- ============================================================================
-- PHASE 2: Customer Profile & Credit Management
-- Source of Truth: DATABASE_SCHEMA_V1_SQL_SPEC.md
-- Executed: 2026-05-31
-- ============================================================================

-- 1. ENUMs -------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE ledger_transaction_type AS ENUM ('debit', 'credit');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. customers ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id uuid NOT NULL,
    code varchar(20) NOT NULL,
    company_name varchar(255) NOT NULL,
    email varchar(255),
    credit_limit decimal(12,2) NOT NULL DEFAULT 0,
    credit_days integer NOT NULL DEFAULT 0,
    owner_type varchar(20) NOT NULL DEFAULT 'employee',
    owner_id uuid NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    registered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE customers ADD CONSTRAINT fk_customers_identity
    FOREIGN KEY (identity_id) REFERENCES identities (id);
ALTER TABLE customers ADD CONSTRAINT fk_customers_owner
    FOREIGN KEY (owner_id) REFERENCES employees (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_code ON customers (code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_identity_id ON customers (identity_id);

-- check constraints
ALTER TABLE customers ADD CONSTRAINT ck_customers_credit_limit
    CHECK (credit_limit >= 0);
ALTER TABLE customers ADD CONSTRAINT ck_customers_credit_days
    CHECK (credit_days >= 0);
ALTER TABLE customers ADD CONSTRAINT ck_customers_owner_type
    CHECK (owner_type = 'employee');

-- indexes
CREATE INDEX IF NOT EXISTS idx_customers_owner_id ON customers (owner_id);
CREATE INDEX IF NOT EXISTS idx_customers_identity_id ON customers (identity_id);

COMMENT ON TABLE customers IS 'Registered business entities that place orders. Owned by Sales Representatives.';
COMMENT ON COLUMN customers.identity_id IS 'FK to identities.id. One-to-one with identity.';
COMMENT ON COLUMN customers.code IS 'Human-readable code (e.g., CUS-000001)';
COMMENT ON COLUMN customers.credit_limit IS 'Maximum outstanding balance allowed';
COMMENT ON COLUMN customers.credit_days IS 'Payment term in days';
COMMENT ON COLUMN customers.owner_type IS 'Always employee';
COMMENT ON COLUMN customers.owner_id IS 'FK to employees.id — the owning Sales Representative';
COMMENT ON COLUMN customers.is_active IS 'Active immediately on creation';
COMMENT ON COLUMN customers.registered_at IS 'Null if created by rep instead of self-registration';

-- 3. customer_addresses ------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer_addresses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL,
    label varchar(100),
    address_line1 varchar(255) NOT NULL,
    address_line2 varchar(255),
    city varchar(100) NOT NULL,
    governorate varchar(100),
    postal_code varchar(20),
    latitude decimal(10,7),
    longitude decimal(10,7),
    is_default boolean NOT NULL DEFAULT false
);

-- foreign keys
ALTER TABLE customer_addresses ADD CONSTRAINT fk_customer_addresses_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE;

-- check constraints
ALTER TABLE customer_addresses ADD CONSTRAINT ck_customer_addresses_coords
    CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL));

-- indexes
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_id ON customer_addresses (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_addresses_default ON customer_addresses (customer_id) WHERE is_default = true;

COMMENT ON TABLE customer_addresses IS 'Multiple addresses per customer for shipping, billing, and other purposes.';
COMMENT ON COLUMN customer_addresses.label IS 'e.g., Warehouse, Office';
COMMENT ON COLUMN customer_addresses.is_default IS 'One default per customer (enforced by partial unique index)';

-- 4. customer_contacts -------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer_contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL,
    full_name varchar(255) NOT NULL,
    phone varchar(20) NOT NULL,
    email varchar(255),
    role varchar(100),
    is_primary boolean NOT NULL DEFAULT false
);

-- foreign keys
ALTER TABLE customer_contacts ADD CONSTRAINT fk_customer_contacts_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE;

-- indexes
CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer_id ON customer_contacts (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_contacts_primary ON customer_contacts (customer_id) WHERE is_primary = true;

COMMENT ON TABLE customer_contacts IS 'Multiple contacts per customer with names, phones, and roles.';
COMMENT ON COLUMN customer_contacts.is_primary IS 'One primary per customer (enforced by partial unique index)';

-- 5. customer_ownership_history ----------------------------------------------

CREATE TABLE IF NOT EXISTS customer_ownership_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL,
    previous_owner_id uuid,
    new_owner_id uuid NOT NULL,
    changed_by uuid NOT NULL,
    reason text,
    changed_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE customer_ownership_history ADD CONSTRAINT fk_cust_own_hist_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id);
ALTER TABLE customer_ownership_history ADD CONSTRAINT fk_cust_own_hist_prev_owner
    FOREIGN KEY (previous_owner_id) REFERENCES employees (id);
ALTER TABLE customer_ownership_history ADD CONSTRAINT fk_cust_own_hist_new_owner
    FOREIGN KEY (new_owner_id) REFERENCES employees (id);
ALTER TABLE customer_ownership_history ADD CONSTRAINT fk_cust_own_hist_changed_by
    FOREIGN KEY (changed_by) REFERENCES employees (id);

-- indexes
CREATE INDEX IF NOT EXISTS idx_cust_own_hist_customer_id ON customer_ownership_history (customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_own_hist_changed_at ON customer_ownership_history (changed_at);

COMMENT ON TABLE customer_ownership_history IS 'Audit trail of customer ownership changes. INSERT-only — no UPDATE or DELETE.';
COMMENT ON COLUMN customer_ownership_history.previous_owner_id IS 'Null for initial assignment';
COMMENT ON COLUMN customer_ownership_history.reason IS 'Reason for ownership change';

-- 6. customer_credit_ledger --------------------------------------------------

CREATE TABLE IF NOT EXISTS customer_credit_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL,
    transaction_type ledger_transaction_type NOT NULL,
    amount decimal(12,2) NOT NULL,
    running_balance decimal(12,2) NOT NULL,
    reference_type varchar(50),
    reference_id uuid,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE customer_credit_ledger ADD CONSTRAINT fk_credit_ledger_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id);
ALTER TABLE customer_credit_ledger ADD CONSTRAINT fk_credit_ledger_created_by
    FOREIGN KEY (created_by) REFERENCES employees (id);

-- check constraints
ALTER TABLE customer_credit_ledger ADD CONSTRAINT ck_credit_ledger_type
    CHECK (transaction_type IN ('debit', 'credit'));
ALTER TABLE customer_credit_ledger ADD CONSTRAINT ck_credit_ledger_amount
    CHECK (amount > 0);
ALTER TABLE customer_credit_ledger ADD CONSTRAINT ck_credit_ledger_reference
    CHECK ((reference_type IS NULL AND reference_id IS NULL) OR (reference_type IS NOT NULL AND reference_id IS NOT NULL));

-- indexes
CREATE INDEX IF NOT EXISTS idx_credit_ledger_customer_id ON customer_credit_ledger (customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_created_at ON customer_credit_ledger (created_at);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_reference ON customer_credit_ledger (reference_type, reference_id);

COMMENT ON TABLE customer_credit_ledger IS 'Running credit balance for each customer. INSERT-only — no UPDATE or DELETE allowed.';
COMMENT ON COLUMN customer_credit_ledger.transaction_type IS 'debit increases balance, credit decreases balance';
COMMENT ON COLUMN customer_credit_ledger.running_balance IS 'Balance after this transaction';
COMMENT ON COLUMN customer_credit_ledger.reference_type IS 'order, collection, credit_note';
COMMENT ON COLUMN customer_credit_ledger.reference_id IS 'Polymorphic reference to source entity';

-- ============================================================================
-- END OF PHASE 2
-- ============================================================================
