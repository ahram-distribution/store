-- ============================================================================
-- PHASE 4: Tiers & Tier Exceptions
-- Source of Truth: DATABASE_SCHEMA_V1_SQL_SPEC.md
-- Executed: 2026-05-31
-- ============================================================================

-- 1. tiers -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tiers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(100) NOT NULL,
    description text,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_tiers_name ON tiers (name);

COMMENT ON TABLE tiers IS 'Pricing tiers for differentiated customer pricing.';
COMMENT ON COLUMN tiers.sort_order IS 'Lower = higher tier';
COMMENT ON COLUMN tiers.is_active IS 'Soft deactivation preserves historical references';

-- 2. tier_exceptions ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS tier_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tier_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    assigned_by uuid NOT NULL,
    reason text,
    expires_at timestamptz,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE tier_exceptions ADD CONSTRAINT fk_tier_exceptions_tier
    FOREIGN KEY (tier_id) REFERENCES tiers (id);
ALTER TABLE tier_exceptions ADD CONSTRAINT fk_tier_exceptions_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id);
ALTER TABLE tier_exceptions ADD CONSTRAINT fk_tier_exceptions_assigned_by
    FOREIGN KEY (assigned_by) REFERENCES employees (id);

-- check constraints
ALTER TABLE tier_exceptions ADD CONSTRAINT ck_tier_exceptions_expires
    CHECK (expires_at IS NULL OR expires_at > created_at);

-- indexes
CREATE INDEX IF NOT EXISTS idx_tier_exceptions_customer_active
    ON tier_exceptions (customer_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_tier_exceptions_customer
    ON tier_exceptions (customer_id);

COMMENT ON TABLE tier_exceptions IS 'Override default tier for specific customers. Historical records retained. R9: no unique constraint on (tier_id, customer_id).';
COMMENT ON COLUMN tier_exceptions.is_active IS 'Application enforces single active per customer';
COMMENT ON COLUMN tier_exceptions.expires_at IS 'Null = no expiry. Application checks expiry at order time.';

-- ============================================================================
-- END OF PHASE 4
-- ============================================================================
