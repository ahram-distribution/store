-- ============================================================================
-- PHASE 1: Identity & Governance
-- Source of Truth: DATABASE_SCHEMA_V1_SQL_SPEC.md
-- Executed: 2026-05-31
-- ============================================================================

-- 1. ENUMs -------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE identity_type AS ENUM ('employee', 'customer');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE grant_type AS ENUM ('grant', 'deny');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. identities --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone varchar(20) NOT NULL,
    password_hash varchar(255) NOT NULL,
    identity_type identity_type NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_identities_phone ON identities (phone);

-- check constraints
ALTER TABLE identities ADD CONSTRAINT ck_identities_identity_type
    CHECK (identity_type IN ('employee', 'customer'));

-- indexes
CREATE INDEX IF NOT EXISTS idx_identities_phone ON identities (phone);
CREATE INDEX IF NOT EXISTS idx_identities_identity_type ON identities (identity_type);

COMMENT ON TABLE identities IS 'Single source of truth for authentication and phone uniqueness across employees and customers';
COMMENT ON COLUMN identities.id IS 'Primary key';
COMMENT ON COLUMN identities.phone IS 'Globally unique phone number across all identities';
COMMENT ON COLUMN identities.password_hash IS 'Hashed authentication password';
COMMENT ON COLUMN identities.identity_type IS 'employee or customer';
COMMENT ON COLUMN identities.is_active IS 'Soft disable without data loss';

-- 3. employees ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employees (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id uuid NOT NULL,
    code varchar(20) NOT NULL,
    full_name varchar(255) NOT NULL,
    email varchar(255),
    manager_id uuid,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE employees ADD CONSTRAINT fk_employees_identity
    FOREIGN KEY (identity_id) REFERENCES identities (id);
ALTER TABLE employees ADD CONSTRAINT fk_employees_manager
    FOREIGN KEY (manager_id) REFERENCES employees (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_code ON employees (code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_identity_id ON employees (identity_id);

-- indexes
CREATE INDEX IF NOT EXISTS idx_employees_manager_id ON employees (manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_identity_id ON employees (identity_id);

COMMENT ON TABLE employees IS 'Employee personnel records. Each employee has a manager in the sales hierarchy.';
COMMENT ON COLUMN employees.identity_id IS 'FK to identities.id. One-to-one with identity.';
COMMENT ON COLUMN employees.code IS 'Human-readable code (e.g., REP-00001)';
COMMENT ON COLUMN employees.manager_id IS 'Direct manager. Null for top of hierarchy.';

-- 4. roles -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(100) NOT NULL,
    description text,
    is_system boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_name ON roles (name);

COMMENT ON TABLE roles IS 'Dynamic role definitions. Roles are stored as data, not hardcoded.';
COMMENT ON COLUMN roles.is_system IS 'System roles cannot be deleted';

-- 5. capabilities ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS capabilities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(100) NOT NULL,
    name varchar(255) NOT NULL,
    description text,
    "group" varchar(100),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_capabilities_code ON capabilities (code);

-- indexes
CREATE INDEX IF NOT EXISTS idx_capabilities_group ON capabilities ("group");

COMMENT ON TABLE capabilities IS 'Granular permission definitions. Each capability represents a single action.';
COMMENT ON COLUMN capabilities.code IS 'e.g., order.create, customer.view';
COMMENT ON COLUMN capabilities."group" IS 'Grouping category for related capabilities';

-- 6. employee_roles ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS employee_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    role_id uuid NOT NULL,
    assigned_by uuid NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE employee_roles ADD CONSTRAINT fk_employee_roles_employee
    FOREIGN KEY (employee_id) REFERENCES employees (id);
ALTER TABLE employee_roles ADD CONSTRAINT fk_employee_roles_role
    FOREIGN KEY (role_id) REFERENCES roles (id);
ALTER TABLE employee_roles ADD CONSTRAINT fk_employee_roles_assigned_by
    FOREIGN KEY (assigned_by) REFERENCES employees (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_roles ON employee_roles (employee_id, role_id);

-- indexes
CREATE INDEX IF NOT EXISTS idx_employee_roles_employee_id ON employee_roles (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_roles_role_id ON employee_roles (role_id);

COMMENT ON TABLE employee_roles IS 'Junction table linking employees to roles. Supports multiple roles per employee.';

-- 7. role_capabilities -------------------------------------------------------

CREATE TABLE IF NOT EXISTS role_capabilities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id uuid NOT NULL,
    capability_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE role_capabilities ADD CONSTRAINT fk_role_capabilities_role
    FOREIGN KEY (role_id) REFERENCES roles (id);
ALTER TABLE role_capabilities ADD CONSTRAINT fk_role_capabilities_capability
    FOREIGN KEY (capability_id) REFERENCES capabilities (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_capabilities ON role_capabilities (role_id, capability_id);

-- indexes
CREATE INDEX IF NOT EXISTS idx_role_capabilities_role_id ON role_capabilities (role_id);
CREATE INDEX IF NOT EXISTS idx_role_capabilities_capability_id ON role_capabilities (capability_id);

COMMENT ON TABLE role_capabilities IS 'Junction table linking roles to capabilities. Defines what each role can do.';

-- 8. employee_capabilities ---------------------------------------------------

CREATE TABLE IF NOT EXISTS employee_capabilities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    capability_id uuid NOT NULL,
    grant_type grant_type NOT NULL,
    assigned_by uuid NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE employee_capabilities ADD CONSTRAINT fk_employee_capabilities_employee
    FOREIGN KEY (employee_id) REFERENCES employees (id);
ALTER TABLE employee_capabilities ADD CONSTRAINT fk_employee_capabilities_capability
    FOREIGN KEY (capability_id) REFERENCES capabilities (id);
ALTER TABLE employee_capabilities ADD CONSTRAINT fk_employee_capabilities_assigned_by
    FOREIGN KEY (assigned_by) REFERENCES employees (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_capabilities ON employee_capabilities (employee_id, capability_id);

-- check constraints
ALTER TABLE employee_capabilities ADD CONSTRAINT ck_employee_capabilities_grant_type
    CHECK (grant_type IN ('grant', 'deny'));

-- indexes
CREATE INDEX IF NOT EXISTS idx_employee_capabilities_employee_id ON employee_capabilities (employee_id);

COMMENT ON TABLE employee_capabilities IS 'Direct capability assignments to specific employees, overriding role-based capabilities.';

-- 9. code_sequences ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS code_sequences (
    code_type varchar(30) NOT NULL,
    year integer NOT NULL,
    last_sequence integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (code_type, year)
);

-- check constraints
ALTER TABLE code_sequences ADD CONSTRAINT ck_code_sequences_year
    CHECK (year >= 2026);
ALTER TABLE code_sequences ADD CONSTRAINT ck_code_sequences_last_seq
    CHECK (last_sequence >= 0);

COMMENT ON TABLE code_sequences IS 'Atomic sequence counters for generating human-readable business codes. One row per (code_type, year).';
COMMENT ON COLUMN code_sequences.code_type IS 'e.g., order, customer, visit, credit_note';
COMMENT ON COLUMN code_sequences.year IS 'Calendar year';
COMMENT ON COLUMN code_sequences.last_sequence IS 'Last used sequence number';

-- ============================================================================
-- END OF PHASE 1
-- ============================================================================
