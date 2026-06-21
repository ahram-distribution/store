-- ============================================================================
-- CLEANUP: TEST DATA REMOVAL
-- Target periods: 2026-05-29 → 2026-06-15 (inclusive) + 2026-06-20
-- ============================================================================
-- HOW TO RUN:
--   1. Open https://supabase.com/dashboard/project/gbcbejejgpvltuhbztbx/sql
--   2. Paste this entire script
--   3. Run
--
-- BACKUP: All affected records are saved to _test_backup.* tables
-- RESTORE (if needed): INSERT INTO public.<table> SELECT * FROM _test_backup.<table>;
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. BACKUP — Snapshot all affected records
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS _test_backup;

-- Helper: create backup table and insert
DO $$
DECLARE
  v_sql text;
BEGIN
  -- Orders
  CREATE TABLE _test_backup.orders AS SELECT * FROM public.orders
    WHERE created_at >= '2026-05-29'::timestamptz AND created_at <= '2026-06-15'::timestamptz
       OR (created_at >= '2026-06-20'::timestamptz AND created_at < '2026-06-21'::timestamptz);

  CREATE TABLE _test_backup.order_items AS SELECT * FROM public.order_items
    WHERE order_id IN (SELECT id FROM _test_backup.orders);

  CREATE TABLE _test_backup.order_status_history AS SELECT * FROM public.order_status_history
    WHERE order_id IN (SELECT id FROM _test_backup.orders);

  CREATE TABLE _test_backup.order_modification_history AS SELECT * FROM public.order_modification_history
    WHERE order_id IN (SELECT id FROM _test_backup.orders);

  -- Delivery
  CREATE TABLE _test_backup.delivery_tracking AS SELECT * FROM public.delivery_tracking
    WHERE order_id IN (SELECT id FROM _test_backup.orders);

  CREATE TABLE _test_backup.preparation_records AS SELECT * FROM public.preparation_records
    WHERE order_id IN (SELECT id FROM _test_backup.orders);

  CREATE TABLE _test_backup.preparation_exceptions AS SELECT * FROM public.preparation_exceptions
    WHERE preparation_id IN (SELECT id FROM _test_backup.preparation_records);

  -- Returns
  CREATE TABLE _test_backup.returns AS SELECT * FROM public.returns
    WHERE created_at >= '2026-05-29'::timestamptz AND created_at <= '2026-06-15'::timestamptz
       OR (created_at >= '2026-06-20'::timestamptz AND created_at < '2026-06-21'::timestamptz);

  CREATE TABLE _test_backup.return_items AS SELECT * FROM public.return_items
    WHERE return_id IN (SELECT id FROM _test_backup.returns);

  CREATE TABLE _test_backup.return_inspection AS SELECT * FROM public.return_inspection
    WHERE return_item_id IN (SELECT id FROM _test_backup.return_items);

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'return_status_history') THEN
    CREATE TABLE _test_backup.return_status_history AS SELECT * FROM public.return_status_history
      WHERE return_id IN (SELECT id FROM _test_backup.returns);
  END IF;

  -- Customers
  CREATE TABLE _test_backup.customers AS SELECT * FROM public.customers
    WHERE created_at >= '2026-05-29'::timestamptz AND created_at <= '2026-06-15'::timestamptz
       OR (created_at >= '2026-06-20'::timestamptz AND created_at < '2026-06-21'::timestamptz);

  CREATE TABLE _test_backup.customer_addresses AS SELECT * FROM public.customer_addresses
    WHERE customer_id IN (SELECT id FROM _test_backup.customers);

  CREATE TABLE _test_backup.customer_contacts AS SELECT * FROM public.customer_contacts
    WHERE customer_id IN (SELECT id FROM _test_backup.customers);

  CREATE TABLE _test_backup.customer_ownership_history AS SELECT * FROM public.customer_ownership_history
    WHERE customer_id IN (SELECT id FROM _test_backup.customers);

  CREATE TABLE _test_backup.customer_credit_ledger AS SELECT * FROM public.customer_credit_ledger
    WHERE customer_id IN (SELECT id FROM _test_backup.customers);

  CREATE TABLE _test_backup.credit_invoices AS SELECT * FROM public.credit_invoices
    WHERE order_id IN (SELECT id FROM _test_backup.orders);

  CREATE TABLE _test_backup.customer_credit_accounts AS SELECT * FROM public.customer_credit_accounts
    WHERE customer_id IN (SELECT id FROM _test_backup.customers);

  -- Collections
  CREATE TABLE _test_backup.collections AS SELECT * FROM public.collections
    WHERE created_at >= '2026-05-29'::timestamptz AND created_at <= '2026-06-15'::timestamptz
       OR (created_at >= '2026-06-20'::timestamptz AND created_at < '2026-06-21'::timestamptz);

  CREATE TABLE _test_backup.treasury_transactions AS SELECT * FROM public.treasury_transactions
    WHERE reference_type = 'collection' AND reference_id IN (SELECT id FROM _test_backup.collections);

  -- Visits
  CREATE TABLE _test_backup.visits AS SELECT * FROM public.visits
    WHERE created_at >= '2026-05-29'::timestamptz AND created_at <= '2026-06-15'::timestamptz
       OR (created_at >= '2026-06-20'::timestamptz AND created_at < '2026-06-21'::timestamptz);

  -- Workday + tracking
  CREATE TABLE _test_backup.workday_sessions AS SELECT * FROM public.workday_sessions
    WHERE date >= '2026-05-29'::date AND date <= '2026-06-15'::date
       OR date = '2026-06-20'::date;

  CREATE TABLE _test_backup.workday_breaks AS SELECT * FROM public.workday_breaks
    WHERE session_id IN (SELECT id FROM _test_backup.workday_sessions);

  CREATE TABLE _test_backup.tracking_points AS SELECT * FROM public.tracking_points
    WHERE session_id IN (SELECT id FROM _test_backup.workday_sessions);

  CREATE TABLE _test_backup.visit_links AS SELECT * FROM public.visit_links
    WHERE session_id IN (SELECT id FROM _test_backup.workday_sessions)
       OR visit_id IN (SELECT id FROM _test_backup.visits);

  -- Employees created in test period (will verify before deletion)
  CREATE TABLE _test_backup.employees AS SELECT * FROM public.employees
    WHERE created_at >= '2026-05-29'::timestamptz AND created_at <= '2026-06-15'::timestamptz
       OR (created_at >= '2026-06-20'::timestamptz AND created_at < '2026-06-21'::timestamptz);

  CREATE TABLE _test_backup.identities AS SELECT * FROM public.identities
    WHERE id IN (SELECT identity_id FROM _test_backup.employees);

  CREATE TABLE _test_backup.employee_roles AS SELECT * FROM public.employee_roles
    WHERE employee_id IN (SELECT id FROM _test_backup.employees);

  CREATE TABLE _test_backup.employee_capabilities AS SELECT * FROM public.employee_capabilities
    WHERE employee_id IN (SELECT id FROM _test_backup.employees);

  -- Package/Deal bridges
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_flash_offers') THEN
    CREATE TABLE _test_backup.order_flash_offers AS SELECT * FROM public.order_flash_offers
      WHERE order_id IN (SELECT id FROM _test_backup.orders);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_daily_deals') THEN
    CREATE TABLE _test_backup.order_daily_deals AS SELECT * FROM public.order_daily_deals
      WHERE order_id IN (SELECT id FROM _test_backup.orders);
  END IF;
END $$;

-- ============================================================================
-- 2. REPORT — Records to delete
-- ============================================================================
SELECT '=== BACKUP COMPLETE — RECORDS COUNT ===' AS stage;

SELECT 'orders' AS tbl, COUNT(*) AS cnt FROM _test_backup.orders
UNION ALL SELECT 'order_items', COUNT(*) FROM _test_backup.order_items
UNION ALL SELECT 'order_status_history', COUNT(*) FROM _test_backup.order_status_history
UNION ALL SELECT 'order_modification_history', COUNT(*) FROM _test_backup.order_modification_history
UNION ALL SELECT 'delivery_tracking', COUNT(*) FROM _test_backup.delivery_tracking
UNION ALL SELECT 'preparation_records', COUNT(*) FROM _test_backup.preparation_records
UNION ALL SELECT 'preparation_exceptions', COUNT(*) FROM _test_backup.preparation_exceptions
UNION ALL SELECT 'returns', COUNT(*) FROM _test_backup.returns
UNION ALL SELECT 'return_items', COUNT(*) FROM _test_backup.return_items
UNION ALL SELECT 'return_inspection', COUNT(*) FROM _test_backup.return_inspection
UNION ALL SELECT 'customers', COUNT(*) FROM _test_backup.customers
UNION ALL SELECT 'customer_addresses', COUNT(*) FROM _test_backup.customer_addresses
UNION ALL SELECT 'customer_contacts', COUNT(*) FROM _test_backup.customer_contacts
UNION ALL SELECT 'customer_ownership_history', COUNT(*) FROM _test_backup.customer_ownership_history
UNION ALL SELECT 'customer_credit_ledger', COUNT(*) FROM _test_backup.customer_credit_ledger
UNION ALL SELECT 'credit_invoices', COUNT(*) FROM _test_backup.credit_invoices
UNION ALL SELECT 'customer_credit_accounts', COUNT(*) FROM _test_backup.customer_credit_accounts
UNION ALL SELECT 'collections', COUNT(*) FROM _test_backup.collections
UNION ALL SELECT 'treasury_transactions', COUNT(*) FROM _test_backup.treasury_transactions
UNION ALL SELECT 'visits', COUNT(*) FROM _test_backup.visits
UNION ALL SELECT 'workday_sessions', COUNT(*) FROM _test_backup.workday_sessions
UNION ALL SELECT 'workday_breaks', COUNT(*) FROM _test_backup.workday_breaks
UNION ALL SELECT 'tracking_points', COUNT(*) FROM _test_backup.tracking_points
UNION ALL SELECT 'visit_links', COUNT(*) FROM _test_backup.visit_links
UNION ALL SELECT 'employees (test)', COUNT(*) FROM _test_backup.employees
UNION ALL SELECT 'identities (test)', COUNT(*) FROM _test_backup.identities
ORDER BY tbl;

-- ============================================================================
-- 3. DELETE — FK-safe order (leaf tables first)
-- ============================================================================
SELECT '=== STARTING DELETION ===' AS stage;

-- 3a. Tracking data (FK: workday_sessions)
DELETE FROM public.tracking_points
WHERE session_id IN (SELECT id FROM _test_backup.workday_sessions);

DELETE FROM public.workday_breaks
WHERE session_id IN (SELECT id FROM _test_backup.workday_sessions);

DELETE FROM public.visit_links
WHERE session_id IN (SELECT id FROM _test_backup.workday_sessions);

-- 3b. Workday sessions
DELETE FROM public.workday_sessions
WHERE id IN (SELECT id FROM _test_backup.workday_sessions);

-- 3c. Visits
DELETE FROM public.visit_links
WHERE visit_id IN (SELECT id FROM _test_backup.visits);
DELETE FROM public.visits
WHERE id IN (SELECT id FROM _test_backup.visits);

-- 3d. Treasury (FK: collections)
DELETE FROM public.treasury_transactions
WHERE id IN (SELECT id FROM _test_backup.treasury_transactions);

-- 3e. Collections
DELETE FROM public.collections
WHERE id IN (SELECT id FROM _test_backup.collections);

-- 3f. Customer credit ledger (FK: customers)
DELETE FROM public.customer_credit_ledger
WHERE id IN (SELECT id FROM _test_backup.customer_credit_ledger);

-- 3g. Customer ownership history
DELETE FROM public.customer_ownership_history
WHERE id IN (SELECT id FROM _test_backup.customer_ownership_history);

-- 3h. Customer credit accounts (FK: customers)
DELETE FROM public.customer_credit_accounts
WHERE id IN (SELECT id FROM _test_backup.customer_credit_accounts);

-- 3i. Returns (CASCADE handles return_items, return_inspection)
DELETE FROM public.returns
WHERE id IN (SELECT id FROM _test_backup.returns);

-- 3j. Preparation exceptions → preparation records
DELETE FROM public.preparation_exceptions
WHERE id IN (SELECT id FROM _test_backup.preparation_exceptions);
DELETE FROM public.preparation_records
WHERE id IN (SELECT id FROM _test_backup.preparation_records);

-- 3k. Delivery tracking
DELETE FROM public.delivery_tracking
WHERE id IN (SELECT id FROM _test_backup.delivery_tracking);

-- 3l. Flash offer / daily deal bridges
DELETE FROM public.order_flash_offers
WHERE order_id IN (SELECT id FROM _test_backup.orders);
DELETE FROM public.order_daily_deals
WHERE order_id IN (SELECT id FROM _test_backup.orders);

-- 3m. Credit invoices (FK: orders, customers)
DELETE FROM public.credit_invoices
WHERE id IN (SELECT id FROM _test_backup.credit_invoices);

-- 3n. Orders (CASCADE → order_items, status_history, mod_history)
DELETE FROM public.orders
WHERE id IN (SELECT id FROM _test_backup.orders);

-- 3o. Customer addresses / contacts (CASCADE from customers)
-- 3p. Customers
DELETE FROM public.customers
WHERE id IN (SELECT id FROM _test_backup.customers);

-- 3q. Employee capabilities & roles
DELETE FROM public.employee_capabilities
WHERE employee_id IN (SELECT id FROM _test_backup.employees);
DELETE FROM public.employee_roles
WHERE employee_id IN (SELECT id FROM _test_backup.employees);

-- 3r. Employees (test)
DELETE FROM public.employees
WHERE id IN (SELECT id FROM _test_backup.employees);

DELETE FROM public.identities
WHERE id IN (SELECT id FROM _test_backup.identities);

-- ============================================================================
-- 4. VERIFY — Zero remaining
-- ============================================================================
SELECT '=== VERIFICATION — EXPECT ALL ZERO ===' AS stage;

SELECT 'orders' AS check_name, COUNT(*) AS remaining FROM public.orders
  WHERE id IN (SELECT id FROM _test_backup.orders)
UNION ALL SELECT 'credit_invoices', COUNT(*) FROM public.credit_invoices
  WHERE id IN (SELECT id FROM _test_backup.credit_invoices)
UNION ALL SELECT 'customer_credit_accounts', COUNT(*) FROM public.customer_credit_accounts
  WHERE id IN (SELECT id FROM _test_backup.customer_credit_accounts)
UNION ALL SELECT 'customers', COUNT(*) FROM public.customers
  WHERE id IN (SELECT id FROM _test_backup.customers)
UNION ALL SELECT 'visits', COUNT(*) FROM public.visits
  WHERE id IN (SELECT id FROM _test_backup.visits)
UNION ALL SELECT 'workday_sessions', COUNT(*) FROM public.workday_sessions
  WHERE id IN (SELECT id FROM _test_backup.workday_sessions)
UNION ALL SELECT 'employees (test)', COUNT(*) FROM public.employees
  WHERE id IN (SELECT id FROM _test_backup.employees);

SELECT '=== CLEANUP COMPLETE ===' AS stage;

COMMIT;

-- ============================================================================
-- RESTORE (if needed):
-- BEGIN;
-- INSERT INTO public.orders SELECT * FROM _test_backup.orders;
-- INSERT INTO public.order_items SELECT * FROM _test_backup.order_items;
-- ... (repeat for all backup tables)
-- COMMIT;
-- ============================================================================
