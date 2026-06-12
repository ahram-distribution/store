-- ============================================================================
-- COMMAND CENTER — Phase 1: Registry & Sync Tables
-- Creates the projection tables for the self-maintaining Upper Management
-- Command Center. These are DISPOSABLE — can be dropped and rebuilt from
-- OWNER_KNOWLEDGE_BASE + runtime code + database entities at any time.
--
-- Tables:
--   1. system_modules     — Module registry (projection, never source of truth)
--   2. owner_decisions    — Extracted business rules & decisions from KB
--   3. owner_requests     — Approved-but-not-built features from KB
-- ============================================================================

-- ============================================================================
-- 1. system_modules
--    PROJECTION. Not source of truth. Sync-script writes discovery fields.
--    Owner may only edit: status (override), owner_approved, business_priority.
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_modules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module_key   varchar(100) UNIQUE NOT NULL,

    display_name jsonb NOT NULL,
    description  jsonb,
    icon         varchar(50) DEFAULT 'package',

    status varchar(20) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned','partial','implemented','validated','broken','deprecated')),

    implementation_level integer DEFAULT 0,
    validated_at    timestamptz,
    broken_since    timestamptz,
    deprecated_at   timestamptz,
    owner_approved  boolean DEFAULT false,

    routes       jsonb DEFAULT '[]'::jsonb,
    core_rpcs    jsonb DEFAULT '[]'::jsonb,
    core_tables  jsonb DEFAULT '[]'::jsonb,
    services     jsonb DEFAULT '[]'::jsonb,
    page_dirs    jsonb DEFAULT '[]'::jsonb,

    pipeline_steps jsonb DEFAULT '[]'::jsonb,
    pipeline_health_pct integer DEFAULT 0,

    last_health_check timestamptz,
    health_status varchar(20) DEFAULT 'unknown'
        CHECK (health_status IN ('healthy','degraded','down','unknown')),

    readiness_score   integer DEFAULT 0,
    business_priority varchar(20) DEFAULT 'medium'
        CHECK (business_priority IN ('critical','high','medium','low','icebox')),

    kb_file varchar(255),

    decisions_total    integer DEFAULT 0,
    decisions_verified integer DEFAULT 0,
    decisions_pct      integer DEFAULT 0,

    depends_on varchar(100)[] DEFAULT '{}',

    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE system_modules IS
'PROJECTION. Not source of truth. Can be dropped and rebuilt from KB + code + DB.';
COMMENT ON COLUMN system_modules.routes IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.core_rpcs IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.core_tables IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.services IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.page_dirs IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.pipeline_steps IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.pipeline_health_pct IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.last_health_check IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.health_status IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.readiness_score IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.implementation_level IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.kb_file IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.decisions_total IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.decisions_verified IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.decisions_pct IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.depends_on IS 'SYNC-ONLY. Do not edit manually.';

-- ============================================================================
-- 2. owner_decisions
--    Extracted from OWNER_KNOWLEDGE_BASE markdown files by sync script.
--    Each row is one business rule, financial rule, or architectural decision.
-- ============================================================================

CREATE TABLE IF NOT EXISTS owner_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module_key varchar(100) NOT NULL,

    decision_text text NOT NULL,
    rationale text,
    category varchar(50) DEFAULT 'business_rule'
        CHECK (category IN ('business_rule','financial_rule','authorization_rule',
                            'architectural_decision','workflow_rule')),

    source_file varchar(255),
    source_line integer,

    verifiable boolean DEFAULT true,
    verification_method varchar(50) DEFAULT 'rpc_check'
        CHECK (verification_method IN ('rpc_check','table_check','capability_check',
                                       'code_search','enum_check','manual_only')),
    verification_query text,
    verified boolean DEFAULT false,
    verified_at timestamptz,
    failure_reason text,

    decided_at timestamptz,
    superseded_by uuid REFERENCES owner_decisions(id),
    tags varchar(50)[] DEFAULT '{}',

    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_decisions_module_key ON owner_decisions (module_key);
CREATE INDEX IF NOT EXISTS idx_owner_decisions_verified ON owner_decisions (verified);

-- ============================================================================
-- 3. owner_requests
--    Approved-but-not-yet-built features extracted from KB.
--    Owner tracks what was approved and its current status.
-- ============================================================================

CREATE TABLE IF NOT EXISTS owner_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    description text,
    status varchar(30) NOT NULL DEFAULT 'approved'
        CHECK (status IN ('approved','deferred','planned','future','in_progress','cancelled')),
    priority varchar(20) DEFAULT 'medium'
        CHECK (priority IN ('critical','high','medium','low','icebox')),
    module_key varchar(100),

    source_file varchar(255),
    source_line integer,
    approved_at timestamptz,

    depends_on varchar(100)[] DEFAULT '{}',

    notes text,
    tags varchar(50)[] DEFAULT '{}',

    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_requests_status ON owner_requests (status);
CREATE INDEX IF NOT EXISTS idx_owner_requests_priority ON owner_requests (priority);

-- ============================================================================
-- 4. Module icon mapping (sync helper table)
--    Maps module_key → Lucide icon name for consistent iconography.
--    Seeded with known modules; sync script extends as needed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS module_icon_defaults (
    module_key varchar(100) PRIMARY KEY,
    icon varchar(50) NOT NULL
);

INSERT INTO module_icon_defaults (module_key, icon) VALUES
    ('orders', 'shopping-cart'),
    ('returns', 'rotate-3d'),
    ('customers', 'users'),
    ('credit', 'credit-card'),
    ('visits', 'map-pin'),
    ('collections', 'wallet'),
    ('inventory', 'package'),
    ('products', 'box'),
    ('delivery', 'truck'),
    ('warehouse', 'warehouse'),
    ('employees', 'user-check'),
    ('companies', 'building'),
    ('reports', 'file-text'),
    ('activity', 'activity'),
    ('auctions', 'hammer'),
    ('deals', 'tag'),
    ('daily-deals', 'zap'),
    ('flash-offers', 'clock'),
    ('tiers', 'layers'),
    ('targets', 'target'),
    ('analytics', 'bar-chart'),
    ('supervisor', 'eye'),
    ('settings', 'settings'),
    ('account', 'user-circle'),
    ('storefront', 'store'),
    ('auth', 'log-in'),
    ('checkout', 'credit-card'),
    ('dashboard', 'layout-dashboard')
ON CONFLICT (module_key) DO NOTHING;
