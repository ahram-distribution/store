-- ============================================================================
-- Migration: Fix orders.owner_id — Business FK Must Use employees.id
-- 
-- Design: Idempotent — safe to run multiple times, same result each time.
-- Scope:   Only modifies contaminated rows (owner_id = employees.identity_id)
--           Never touches already-correct rows (owner_id = employees.id)
--           Never touches customer-owned rows (owner_type = 'customer')
-- 
-- Invariant checks built in: pre-flight, post-flight, and consistency validation.
-- Rollback: Full rollback from snapshot table.
-- 
-- Pre-requisites:
--   1. governed_create_order fix is deployed (Phase 2)
--   2. Verification: new orders write employees.id
--   3. Read-path workarounds remain in place (Phase 4 will remove them)
-- ============================================================================

BEGIN;

-- ============================================================================
-- PHASE 1: Pre-flight verification
-- ============================================================================

-- Verify the migration is needed
DO $$
DECLARE
  contaminated_count INT;
  already_correct_count INT;
  customer_owned_count INT;
BEGIN
  SELECT COUNT(*) INTO contaminated_count
  FROM orders o
  WHERE o.owner_type = 'employee'
    AND o.owner_id IN (SELECT e.identity_id FROM employees e)
    AND o.owner_id != ALL (SELECT e.id FROM employees e WHERE e.identity_id = o.owner_id);

  SELECT COUNT(*) INTO already_correct_count
  FROM orders o
  WHERE o.owner_type = 'employee'
    AND o.owner_id IN (SELECT e.id FROM employees e);

  SELECT COUNT(*) INTO customer_owned_count
  FROM orders o
  WHERE o.owner_type = 'customer';

  RAISE NOTICE 'Pre-flight: % contaminated, % already correct, % customer-owned',
    contaminated_count, already_correct_count, customer_owned_count;

  IF contaminated_count = 0 THEN
    RAISE NOTICE 'No contaminated orders found. Migration is a no-op.';
  END IF;
END $$;

-- ============================================================================
-- PHASE 2: Create rollback snapshot (idempotent — IF NOT EXISTS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS _migration_rollback_orders_owner_id (
  id UUID PRIMARY KEY,
  owner_id_before UUID NOT NULL,
  migrated_at TIMESTAMPTZ DEFAULT now(),
  -- Prevent duplicate entries if run multiple times
  CONSTRAINT _unique_migration UNIQUE (id)
);

-- Insert contaminated rows into snapshot (skips already-snapshotted rows)
INSERT INTO _migration_rollback_orders_owner_id (id, owner_id_before)
SELECT o.id, o.owner_id
FROM orders o
WHERE o.owner_type = 'employee'
  AND o.owner_id IN (SELECT e.identity_id FROM employees e)
  AND o.owner_id != ALL (SELECT e.id FROM employees e WHERE e.identity_id = o.owner_id)
  AND NOT EXISTS (SELECT 1 FROM _migration_rollback_orders_owner_id s WHERE s.id = o.id);

-- ============================================================================
-- PHASE 3: Perform the migration (idempotent UPDATE)
-- ============================================================================

UPDATE orders o
SET owner_id = e.id
FROM employees e
WHERE o.owner_type = 'employee'
  AND o.owner_id = e.identity_id
  AND o.owner_id != e.id;  -- Safety: skip if somehow already equal

-- ============================================================================
-- PHASE 4: Post-flight verification
-- ============================================================================

DO $$
DECLARE
  remaining_contaminated INT;
  migrated_count INT;
  correct_count INT;
  customer_owned_count INT;
  total_count INT;
BEGIN
  -- Count remaining contaminated rows
  SELECT COUNT(*) INTO remaining_contaminated
  FROM orders o
  WHERE o.owner_type = 'employee'
    AND o.owner_id IN (SELECT e.identity_id FROM employees e)
    AND o.owner_id != ALL (SELECT e.id FROM employees e WHERE e.identity_id = o.owner_id);

  -- Count successfully migrated rows
  SELECT COUNT(*) INTO migrated_count
  FROM _migration_rollback_orders_owner_id;

  -- Count correct employee-owned orders
  SELECT COUNT(*) INTO correct_count
  FROM orders o
  WHERE o.owner_type = 'employee'
    AND o.owner_id IN (SELECT e.id FROM employees e);

  SELECT COUNT(*) INTO customer_owned_count
  FROM orders o
  WHERE o.owner_type = 'customer';

  SELECT COUNT(*) INTO total_count FROM orders;

  RAISE NOTICE 'Post-flight: % remaining contaminated, % total orders (employee: % + customer: %)',
    remaining_contaminated, total_count, correct_count, customer_owned_count;

  -- FAIL if any contaminated rows remain
  IF remaining_contaminated > 0 THEN
    RAISE EXCEPTION 'MIGRATION_INCOMPLETE: % orders still have owner_id = identity_id', remaining_contaminated;
  END IF;
END $$;

-- ============================================================================
-- PHASE 5: Consistency validation
-- ============================================================================

DO $$
DECLARE
  orphaned INT;
  dup_employee INT;
BEGIN
  -- Check for orphaned owner_ids (should be 0)
  SELECT COUNT(*) INTO orphaned
  FROM orders o
  WHERE o.owner_type = 'employee'
    AND o.owner_id NOT IN (SELECT id FROM employees)
    AND o.owner_id NOT IN (SELECT identity_id FROM employees);

  -- Check for duplicate owner_ids across employees (should be 0)
  SELECT COUNT(*) INTO dup_employee
  FROM (
    SELECT o.owner_id
    FROM orders o
    JOIN employees e ON o.owner_id = e.id
    GROUP BY o.owner_id
    HAVING COUNT(*) > 0
  ) sub
  WHERE EXISTS (
    SELECT 1 FROM employees e2
    WHERE e2.identity_id = sub.owner_id
  );

  RAISE NOTICE 'Consistency: % orphaned, % duplicate-employee conflicts', orphaned, dup_employee;

  IF orphaned > 0 THEN
    RAISE WARNING 'CONSISTENCY_WARNING: % orphaned owner_id values', orphaned;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK (run separately if needed)
-- ============================================================================
-- /*
-- BEGIN;
-- UPDATE orders o
-- SET owner_id = s.owner_id_before
-- FROM _migration_rollback_orders_owner_id s
-- WHERE o.id = s.id;
-- DROP TABLE IF EXISTS _migration_rollback_orders_owner_id;
-- COMMIT;
-- */
