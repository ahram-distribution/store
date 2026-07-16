# Production Release Runbook — orders.owner_id Migration

**Date:** 2026-07-14  
**Operation:** Fix 127 contaminated `orders.owner_id` rows (identity_id → employees.id)  
**Risk:** MEDIUM — data migration on live production system  
**Duration:** ~5 minutes (migration) + 48 hours (observation)  
**Runbook owner:** Platform Engineering  

---

## 1. Preconditions

### 1.1 Write-Path Fix Must Be Deployed

The active write path (`governed_create_order`) MUST already use `v_employee_id` resolution. Verify:

```sql
-- Run on production database
SELECT prosrc FROM pg_proc
WHERE proname = 'governed_create_order'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
```

**Expected:** The function body contains `SELECT id INTO v_employee_id FROM employees WHERE identity_id = v_session.identity_id;` and the INSERT uses `v_employee_id` for `owner_id`.

**If NOT deployed:** Abort. Deploy the write-path fix first. Wait 48 hours to confirm new orders have correct `owner_id`.

### 1.2 Pre-Migration Health Check

```sql
-- Run 1: Contamination count (must be > 0 — if 0, migration is a no-op)
SELECT COUNT(*) AS contaminated
FROM orders o
WHERE o.owner_type = 'employee'
  AND o.owner_id IN (SELECT e.identity_id FROM employees e)
  AND o.owner_id != ALL (SELECT e.id FROM employees e WHERE e.identity_id = o.owner_id);

-- Run 2: Total orders invariant
SELECT COUNT(*) AS total,
  COUNT(*) FILTER (WHERE owner_type = 'employee') AS employee_owned,
  COUNT(*) FILTER (WHERE owner_type = 'customer') AS customer_owned,
  COUNT(*) FILTER (WHERE owner_id IN (SELECT id FROM employees)) AS by_emp_id,
  COUNT(*) FILTER (WHERE owner_id IN (SELECT identity_id FROM employees)) AS by_identity_id
FROM orders;

-- Run 3: Database connection pool (must have available connections)
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
```

**Decision gate:** Contaminated count > 0 AND total orders match expected count AND connection pool has capacity.

### 1.3 Downtime Decision

- The migration runs within a transaction and completes in < 1 second (127 rows, indexed lookup)
- **No application downtime required**
- Recommended: execute during low-traffic period (e.g., 2:00 AM local time)

### 1.4 Required Access

| Resource | Access | Owner |
|----------|--------|-------|
| Production database (direct SQL) | Superuser or write access | DBA |
| Supabase dashboard (read-only) | Monitor query performance | Platform |
| Application monitoring | Watch error rates | SRE |

---

## 2. Snapshot

### 2.1 Database-Level Snapshot

The migration itself creates a snapshot table:

```sql
CREATE TABLE IF NOT EXISTS _migration_rollback_orders_owner_id (
  id UUID PRIMARY KEY,
  owner_id_before UUID NOT NULL,
  migrated_at TIMESTAMPTZ DEFAULT now()
);
```

This table persists after the migration completes and contains the exact prior state of every modified row.

### 2.2 Full Database Backup (Recommended)

Take a pg_dump of the `orders` and `_migration_rollback_orders_owner_id` tables before proceeding:

```bash
pg_dump --host=aws-0-eu-west-1.pooler.supabase.com \
  --port=6543 \
  --dbname=postgres \
  --username=postgres.gbcbejejgpvltuhbztbx \
  --table=public.orders \
  --table=public.order_items \
  --table=public.order_status_history \
  --data-only \
  --file=pre_migration_orders_backup_$(date +%Y%m%d_%H%M%S).sql
```

**Store this backup in secure, immutable storage** (S3 bucket with object lock or equivalent).

### 2.3 Application State Snapshot

- Record current deployed version: `git rev-parse HEAD`
- Record current migration state: `SELECT version FROM _schema_migrations ORDER BY version DESC LIMIT 1;`
- Record current monitoring baseline (error rate, P95 latency)

---

## 3. Execution Order

### Step 1 — Execute Migration

```bash
# Connect to production database
psql -h aws-0-eu-west-1.pooler.supabase.com -p 6543 \
  -U postgres.gbcbejejgpvltuhbztbx -d postgres \
  -f migrations/20260714_fix_orders_owner_id.sql
```

**Expected output:**
```
NOTICE:  Pre-flight: 127 contaminated, 37 already correct, 0 customer-owned
INSERT 0 127
UPDATE 127
NOTICE:  Post-flight: 0 remaining contaminated, 164 total orders (employee: 164 + customer: 0)
COMMIT
```

**If output differs:** Abort. Do not proceed. Investigate.

### Step 2 — Verify Migration Affected Rows

```sql
-- Must return exactly 127 (the number of previously contaminated rows)
SELECT COUNT(*) AS migrated_count FROM _migration_rollback_orders_owner_id;

-- Must return 0
SELECT COUNT(*) AS remaining_contaminated
FROM orders o
WHERE o.owner_type = 'employee'
  AND o.owner_id IN (SELECT e.identity_id FROM employees e)
  AND o.owner_id != ALL (SELECT e.id FROM employees e WHERE e.identity_id = o.owner_id);
```

### Step 3 — Verify Invariants

```sql
-- All employee-owned orders resolve to employees.id (must equal total orders)
SELECT COUNT(*) AS employee_owned
FROM orders
WHERE owner_type = 'employee'
  AND owner_id IN (SELECT id FROM employees);

-- Zero orphaned
SELECT COUNT(*) AS orphaned
FROM orders
WHERE owner_type = 'employee'
  AND owner_id NOT IN (SELECT id FROM employees)
  AND owner_id NOT IN (SELECT identity_id FROM employees);
```

### Step 4 — Functional Verification (Manual Smoke Tests)

| Test | Procedure | Expected |
|------|-----------|----------|
| Order list page | Open `/orders` | All orders visible, no errors |
| Order detail | Click any order | Full detail renders correctly |
| My Orders filter | Click "طلباتي" tab | Shows correct subset |
| Order creation | Create new order via `/storefront` | Order created successfully |
| Status change | Advance order through workflow | Status updates correctly |

---

## 4. Verification Order

### Phase A — Immediate (within 5 minutes of migration)

- [ ] Run `scripts/verify_identity_integrity.mjs` — Test 1 (zero contaminated)
- [ ] Run `scripts/verify_identity_integrity.mjs` — Test 2 (all employee orders use employees.id)
- [ ] Check application error logs — no new errors
- [ ] Check database error logs — no constraint violations or deadlocks
- [ ] Verify snapshot table exists with 127 rows

### Phase B — Extended (within 1 hour)

- [ ] Run the full `verify_identity_integrity.mjs` suite with a session token
- [ ] Smoke test all KPI dashboards (Activity Reports, Monthly Activity, Executive Dashboard, Sales Manager Dashboard) — compare totals for a known period
- [ ] Create a test order, verify its `owner_id`
- [ ] Export Excel from Activity Reports — verify file downloads correctly
- [ ] Export PDF from Activity Reports — verify file downloads correctly

### Phase C — Observation (48 hours)

- [ ] Every 6 hours: run `verify_identity_integrity.mjs` — confirm zero regression
- [ ] Monitor new order creation — verify all new orders have `owner_id = employees.id`
- [ ] Compare KPI totals for each daily period against expected ranges
- [ ] Verify no duplicate rows appear in Activity Reports for previously double-booked employees

---

## 5. Failure Handling

### Failure Mode: Migration UPDATE returns 0 rows

**Cause:** Either the pre-flight check was wrong, or the WHERE condition didn't match any rows.

**Action:**
1. Re-run pre-flight check manually
2. If contaminated count = 0: migration is a no-op, proceed to verification
3. If contaminated count > 0: investigate WHERE clause, check for data type mismatches

### Failure Mode: Migration UPDATE returns wrong row count

**Cause:** Race condition with concurrent order creation during migration.

**Action:**
1. Re-run post-flight check
2. If newly created orders have correct `owner_id`: migration is complete, new orders were already correct
3. If newly created orders have contaminated `owner_id`: ROLLBACK, investigate write path

### Failure Mode: Post-flight verification fails (remaining_contaminated > 0)

**Cause:** Some contaminated rows didn't match the UPDATE WHERE clause (unlikely if pre-flight passed).

**Action:**
1. Rollback immediately (see §6)
2. Investigate which rows remain and why
3. Fix WHERE clause, re-test on staging, re-deploy

### Failure Mode: Transaction timeout

**Cause:** Long-running transaction blocking the migration.

**Action:**
1. Check `pg_stat_activity` for blocking sessions
2. If blocking session is idle: `pg_terminate_backend()`
3. Re-execute migration
4. If blocking session is active: reschedule migration

### Failure Mode: Database connection failure

**Cause:** Network issue, pool exhaustion, or authentication failure.

**Action:**
1. Verify credentials and network connectivity
2. Check pool utilization: `SELECT count(*) FROM pg_stat_activity;`
3. If pool exhausted: wait for connections to free, retry
4. If credentials invalid: abort, rotate credentials, reschedule

---

## 6. Rollback Decision Point

### When to Rollback

Execute rollback if ANY of these conditions occur:

| Condition | Threshold | Action |
|-----------|-----------|--------|
| New order creation fails | Any failure after migration | Rollback |
| Dashboard KPI totals diverge | > 1% difference from pre-migration baseline | Rollback |
| Contaminated rows remain | > 0 after post-flight | Rollback |
| Application error rate spikes | > 2x baseline | Rollback |
| Data integrity violation | Orphaned owner_id values found | Rollback |
| Rollback requested by stakeholder | Per verbal/written approval | Rollback |

### Rollback Procedure

```sql
BEGIN;
UPDATE orders o
SET owner_id = s.owner_id_before
FROM _migration_rollback_orders_owner_id s
WHERE o.id = s.id;
DROP TABLE IF EXISTS _migration_rollback_orders_owner_id;
COMMIT;
```

**Post-rollback verification:**
```sql
SELECT COUNT(*) AS restored_count
FROM orders o
WHERE o.owner_id IN (SELECT e.identity_id FROM employees e);
-- Should match the original contaminated count (127)
```

**After rollback:**
1. Confirm application functions normally
2. Document the failure reason
3. Schedule RCA within 24 hours
4. Do NOT re-attempt until root cause is resolved

### Rollback Time Target

- **Execution:** < 1 second (single UPDATE)
- **Verification:** < 1 minute
- **Total rollback window:** < 5 minutes from decision

---

## 7. Roll-Forward Decision Point

### When to Roll-Forward

Proceed with cleanup (Phase 4 — remove read-path workarounds) after ALL of:

| # | Condition | Verification |
|---|-----------|-------------|
| 1 | Migration completed successfully | 0 contaminated rows |
| 2 | No regression in any dashboard | KPI comparison matches baseline |
| 3 | 48 hours of observation with zero incidents | Monitoring dashboard shows flat line |
| 4 | New orders all have employees.id | Spot-check 20+ new orders |
| 5 | Double-booked employees no longer produce duplicates | Activity Reports shows correct counts |
| 6 | All verification suite tests pass | `npm run verify:identity` exit code 0 |
| 7 | Stakeholder sign-off | Written approval in ticket/PR |

### Roll-Forward Sequence (Phase 4)

1. Simplify `runtime.get_team_activity` — remove `OR o.owner_id = emp.identity_id`
2. Simplify `runtime_event_views.order_delivered_events` — remove OR join
3. Simplify `resolve_employee_id` — remove `OR identity_id = p_input`
4. Fix `OrdersPage.tsx:151` — change `user?.identity_id` to `user?.employee_id`
5. Fix `EmployeeAnalysisPage.tsx:212` — change `.map(e => e.identity_id)` to `.map(e => e.id)`
6. Fix `SupabaseSalesOrderProvider.ts:32` — resolve identityId to employees.id
7. Run full regression suite
8. Add FK trigger constraint (Phase 5)

### Go/No-Go Decision

A Go/No-Go meeting occurs at 48 hours post-migration with:
- Platform Engineering (runbook owner)
- QA (verification results)
- Product Owner (business impact)
- SRE (production monitoring)

All three phases (A, B, C) verification results are presented. Only unanimous approval triggers roll-forward.

---

## 8. Observation Period

### Duration: 48 hours from migration execution

### Monitoring Queries (run every 6 hours)

```sql
-- Query 1: No new contamination
SELECT COUNT(*)
FROM orders o
WHERE o.created_at > now() - interval '6 hours'
  AND o.owner_type = 'employee'
  AND o.owner_id IN (SELECT e.identity_id FROM employees e)
  AND o.owner_id != ALL (SELECT e.id FROM employees e WHERE e.identity_id = o.owner_id);

-- Query 2: All new orders have valid owner_id
SELECT COUNT(*) AS new_orders,
  COUNT(*) FILTER (WHERE owner_id IN (SELECT id FROM employees)) AS valid_owner
FROM orders
WHERE created_at > now() - interval '6 hours';

-- Query 3: Snapshot integrity (snapshot still exists, rows unchanged)
SELECT COUNT(*) AS snapshot_rows FROM _migration_rollback_orders_owner_id;
```

### Application Monitoring

- **Error rate:** Should remain at pre-migration baseline
- **P95 latency:** Should remain at pre-migration baseline (migration does not touch indexes)
- **Dashboard load time:** Should remain at pre-migration baseline
- **Report generation time:** Should REMAIN THE SAME or IMPROVE (no more OR joins needed)

### Rollback Timer

The rollback timer starts at migration execution and expires at 48 hours. After 48 hours:
- Rollback becomes a **revert** (see Phase 4) rather than a simple restore
- Full data integrity is validated
- Application stability is confirmed
- Decision moves from "rollback possible" to "roll-forward cleanup"

---

## 9. Completion Criteria

All criteria MUST be met for the migration to be declared COMPLETE:

| # | Criterion | Verification Method | Status |
|---|-----------|-------------------|--------|
| 1 | Zero contaminated `owner_id` rows | `SELECT COUNT(*) FROM orders WHERE owner_id IN (SELECT identity_id FROM employees) AND owner_id != ALL (SELECT id FROM employees WHERE identity_id = owner_id)` | [ ] |
| 2 | All employee-owned orders have `owner_id = employees.id` | `SELECT COUNT(*) = 0 FROM orders WHERE owner_type = 'employee' AND owner_id NOT IN (SELECT id FROM employees)` | [ ] |
| 3 | Snapshot table exists with correct row count | `SELECT COUNT(*) = previous_contaminated_count FROM _migration_rollback_orders_owner_id` | [ ] |
| 4 | All dashboards produce identical KPI totals | `verify_identity_integrity.mjs` Test 4 — full pass | [ ] |
| 5 | Activity Reports shows no duplicate rows | Manual check for previously double-booked employees (حسن بكر, محمد حافظ, عمر محسن, نور صبحى, مستر عمر, ياسر توفيق, خالد سعيد) | [ ] |
| 6 | New orders use `employees.id` exclusively | Spot-check of 20+ new orders created after migration | [ ] |
| 7 | 48-hour observation period elapsed | Timestamp check | [ ] |
| 8 | Zero application errors related to orders | Monitoring dashboard | [ ] |
| 9 | Stakeholder sign-off received | Written approval | [ ] |
| 10 | Verification suite passes (exit 0) | `node scripts/verify_identity_integrity.mjs` | [ ] |

### Completion Declaration

Once all criteria are met, the migration is declared **COMPLETE** and the platform moves to Phase 4 (read-path workarounds removal).

---

## Appendix A: Quick Reference Commands

### Pre-migration check
```bash
psql -h aws-0-eu-west-1.pooler.supabase.com -p 6543 \
  -U postgres.gbcbejejgpvltuhbztbx -d postgres \
  -c "SELECT COUNT(*) AS contaminated FROM orders o WHERE o.owner_type = 'employee' AND o.owner_id IN (SELECT e.identity_id FROM employees e) AND o.owner_id != ALL (SELECT e.id FROM employees e WHERE e.identity_id = o.owner_id);"
```

### Execute migration
```bash
psql -h aws-0-eu-west-1.pooler.supabase.com -p 6543 \
  -U postgres.gbcbejejgpvltuhbztbx -d postgres \
  -f migrations/20260714_fix_orders_owner_id.sql
```

### Rollback
```bash
psql -h aws-0-eu-west-1.pooler.supabase.com -p 6543 \
  -U postgres.gbcbejejgpvltuhbztbx -d postgres \
  -c "UPDATE orders o SET owner_id = s.owner_id_before FROM _migration_rollback_orders_owner_id s WHERE o.id = s.id; DROP TABLE IF EXISTS _migration_rollback_orders_owner_id;"
```

### Verify
```bash
node scripts/verify_identity_integrity.mjs \
  --period-start=2026-07-01 \
  --period-end=2026-07-14
```
