-- ============================================================================
-- PHASE 4b: Tier Attribute Columns
-- Source of Truth: DATABASE_SCHEMA_V1_SQL_SPEC.md (Phase 4 correction)
-- Business Rule: Tiers are pricing entities, not classification records
-- ============================================================================

-- 1. Add pricing and display columns to tiers ---------------------------------

ALTER TABLE tiers ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS minimum_order_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS icon_url text;
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS color varchar(7);
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true;
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS starts_at timestamptz;
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS ends_at timestamptz;
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2. Check constraints --------------------------------------------------------

ALTER TABLE tiers ADD CONSTRAINT ck_tiers_discount_percent
    CHECK (discount_percent >= 0 AND discount_percent <= 100);

ALTER TABLE tiers ADD CONSTRAINT ck_tiers_minimum_amount
    CHECK (minimum_order_amount >= 0);

ALTER TABLE tiers ADD CONSTRAINT ck_tiers_dates
    CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at);

ALTER TABLE tiers ADD CONSTRAINT ck_tiers_color_format
    CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');

-- 3. Indexes ------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_tiers_active_visible
    ON tiers (sort_order) WHERE is_active = true AND is_visible = true;

-- 4. Comments -----------------------------------------------------------------

COMMENT ON COLUMN tiers.discount_percent IS 'Percentage discount applied to base pricing. 0 = no discount. Range: 0-100';
COMMENT ON COLUMN tiers.minimum_order_amount IS 'Minimum order total (in EGP) required to use this tier. 0 = no minimum';
COMMENT ON COLUMN tiers.icon_url IS 'URL to tier icon or logo for UI display purposes';
COMMENT ON COLUMN tiers.color IS 'Hex color code for UI accent display (e.g. #FFD700 for gold). NULL = use default';
COMMENT ON COLUMN tiers.is_visible IS 'Controls customer-facing display independently from is_active. A tier can be active but hidden';
COMMENT ON COLUMN tiers.starts_at IS 'Tier availability start timestamp. NULL = no start restriction. Used for seasonal/limited tiers';
COMMENT ON COLUMN tiers.ends_at IS 'Tier availability end timestamp. NULL = no end restriction. Must be after starts_at if both set';
COMMENT ON COLUMN tiers.updated_at IS 'Timestamp of last modification. Managed by application';

-- ============================================================================
-- END OF PHASE 4b
-- ============================================================================
