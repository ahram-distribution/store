-- ============================================================================
-- PHASE 8: Visits
-- Source of Truth: DATABASE_SCHEMA_V1_SQL_SPEC.md
-- Executed: 2026-05-31
-- ============================================================================

-- 1. visits -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS visits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(30) NOT NULL,
    employee_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    check_in_at timestamptz NOT NULL DEFAULT now(),
    check_out_at timestamptz,
    check_in_latitude decimal(10,7),
    check_in_longitude decimal(10,7),
    check_out_latitude decimal(10,7),
    check_out_longitude decimal(10,7),
    google_maps_link text,
    visit_result varchar(30),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE visits ADD CONSTRAINT fk_visits_employee
    FOREIGN KEY (employee_id) REFERENCES employees (id);
ALTER TABLE visits ADD CONSTRAINT fk_visits_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_visits_code ON visits (code);

-- check constraints
ALTER TABLE visits ADD CONSTRAINT ck_visits_status
    CHECK (status IN ('active', 'completed', 'cancelled'));
ALTER TABLE visits ADD CONSTRAINT ck_visits_result
    CHECK (visit_result IN ('order_taken', 'collection_taken', 'order_and_collection', 'follow_up', 'customer_closed', 'no_responsible_person', 'order_rejected', 'postponed', 'other') OR visit_result IS NULL);
ALTER TABLE visits ADD CONSTRAINT ck_visits_coords_in
    CHECK ((check_in_latitude IS NULL AND check_in_longitude IS NULL) OR (check_in_latitude IS NOT NULL AND check_in_longitude IS NOT NULL));
ALTER TABLE visits ADD CONSTRAINT ck_visits_coords_out
    CHECK ((check_out_latitude IS NULL AND check_out_longitude IS NULL) OR (check_out_latitude IS NOT NULL AND check_out_longitude IS NOT NULL));

-- indexes
CREATE INDEX IF NOT EXISTS idx_visits_employee_id ON visits (employee_id);
CREATE INDEX IF NOT EXISTS idx_visits_customer_id ON visits (customer_id);
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits (status);
CREATE INDEX IF NOT EXISTS idx_visits_check_in_at ON visits (check_in_at);

COMMENT ON TABLE visits IS 'Sales Representative visits to customers with GPS check-in/out and results.';
COMMENT ON COLUMN visits.code IS 'e.g., VIS-YYYY-NNNNNN';
COMMENT ON COLUMN visits.status IS 'active → completed/cancelled';
COMMENT ON COLUMN visits.visit_result IS 'Required at check-out';
COMMENT ON COLUMN visits.google_maps_link IS 'Link to the location';

-- ============================================================================
-- END OF PHASE 8
-- ============================================================================
