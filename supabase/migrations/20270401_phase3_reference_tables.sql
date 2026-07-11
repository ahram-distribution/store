-- ============================================================================
-- PHASE 3: Reference Tables — Governorates & Cities
-- Creates reusable reference tables for the entire system (customers,
-- suppliers, employees, warehouses, branches, etc.)
--
-- Design principles:
--   1. General-purpose: not tied to any specific module
--   2. Reusable: same tables for all address-requiring entities
--   3. Extensible: supports adding districts later without schema changes
--   4. Idempotent: safe to run multiple times (CREATE IF NOT EXISTS)
-- ============================================================================

-- 1. Governorates -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS reference_governorates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          varchar(20) UNIQUE NOT NULL,
  name_ar       varchar(200) NOT NULL,
  name_en       varchar(200),
  is_active     boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  reference_governorates IS 'المحافظات المصرية — مرجع عام للنظام';
COMMENT ON COLUMN reference_governorates.code IS 'الرمز الثابت للمحافظة (CAI, GIZ, ALX, ...)';

CREATE INDEX IF NOT EXISTS idx_reference_governorates_code
  ON reference_governorates (code);

CREATE INDEX IF NOT EXISTS idx_reference_governorates_display_order
  ON reference_governorates (display_order);

-- 2. Cities ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reference_cities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  governorate_id  uuid NOT NULL REFERENCES reference_governorates (id),
  code            varchar(20) UNIQUE NOT NULL,
  name_ar         varchar(200) NOT NULL,
  name_en         varchar(200),
  is_active       boolean NOT NULL DEFAULT true,
  display_order   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  reference_cities IS 'المدن التابعة للمحافظات — مرجع عام للنظام';
COMMENT ON COLUMN reference_cities.code IS 'الرمز الثابت للمدينة (CAI-NSR, CAI-MADI, GIZ-DOKKI, ...)';
COMMENT ON COLUMN reference_cities.governorate_id IS 'المحافظة التابعة لها';

CREATE INDEX IF NOT EXISTS idx_reference_cities_governorate_id
  ON reference_cities (governorate_id);

CREATE INDEX IF NOT EXISTS idx_reference_cities_code
  ON reference_cities (code);

CREATE INDEX IF NOT EXISTS idx_reference_cities_display_order
  ON reference_cities (governorate_id, display_order);

-- ============================================================================
-- END OF PHASE 3 — Reference Tables
-- ============================================================================
