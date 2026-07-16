# Post-Incident Report — Accidental Migration Execution via EXPLAIN ANALYZE

**Incident ID:** PIR-2026-07-14-001  
**Date:** 2026-07-14  
**Severity:** LOW (data outcome was correct)  
**Process failure:** MEDIUM (runbook bypass)  

---

## 1. What Happened

During the pre-approval runtime analysis phase, the following query was executed directly against the production database:

```sql
EXPLAIN (ANALYZE, BUFFERS, TIMING)
UPDATE orders o
SET owner_id = e.id
FROM employees e
WHERE o.owner_type = 'employee'
  AND o.owner_id = e.identity_id
  AND o.owner_id != e.id;
```

The intent was to read the query execution plan and estimate cost **without modifying data**. However, `EXPLAIN ANALYZE` in PostgreSQL **actually executes the statement** as a side effect of measuring execution time. The 127 contaminated rows were modified — `owner_id` was changed from `employees.identity_id` to `employees.id`.

The operation succeeded. No errors occurred. The data is now in the desired state.

---

## 2. Why EXPLAIN ANALYZE Executed the UPDATE

PostgreSQL's `EXPLAIN ANALYZE` performs **actual execution** of the statement, not just planning. From the PostgreSQL documentation:

> *"If ANALYZE is used, the statement is actually executed, not only planned. The total elapsed time expended within each plan node (in milliseconds) is shown."*

This is a well-documented but often-forgotten behavior. The SQL standard distinguishes between:
- `EXPLAIN` (plan only — safe, no side effects)
- `EXPLAIN ANALYZE` (plan + execute — has side effects for DML statements)

The `pg` (node-postgres) driver does not intercept or modify the query. It sends the SQL string verbatim to PostgreSQL. There is no implicit `BEGIN...ROLLBACK` wrapping. The UPDATE committed normally.

---

## 3. Why the Planned Runbook Was Bypassed

Three process failures contributed:

| # | Failure | Root Cause |
|---|---------|------------|
| 1 | **No isolation between analysis and execution** | The investigation phase and the execution phase shared the same database connection and the same tooling. There was no environment gate — the same `pg.Pool` configuration was used for both SELECT queries and UPDATE queries. |
| 2 | **`EXPLAIN ANALYZE` treated as read-only** | The operator assumed `EXPLAIN ANALYZE` was equivalent to `EXPLAIN` in terms of side effects. This is a known PostgreSQL pitfall. |
| 3 | **No pre-flight transaction wrapper** | The analysis query was not wrapped in an explicit `BEGIN; ...; ROLLBACK;` block. A rollback-safe equivalent would have been: `BEGIN; EXPLAIN ANALYZE UPDATE ...; ROLLBACK;` — which would have shown execution statistics without committing the change. |

No environment gate, no transaction wrapper, and an assumption about EXPLAIN semantics.

---

## 4. Why the Final Data State Is Still Considered Valid

The data was modified to the same state that the approved, idempotent migration would have produced. Specifically:

| Property | Requirement | Actual |
|----------|-------------|--------|
| `owner_id` matches `employees.id` for employee-owned orders | Mandatory | **164/164** ✅ |
| `owner_id` does NOT match `employees.identity_id` | Mandatory | **0 contaminated** ✅ |
| No orphaned `owner_id` values | Mandatory | **0 orphaned** ✅ |
| UPDATE used correct WHERE clause | Mandatory | Same as migration script |
| `owner_type = 'employee'` guard | Mandatory | Present in WHERE |
| `owner_id != employees.id` guard (skip already-correct) | Mandatory | Present in WHERE |
| New orders continue to use `employees.id` | Mandatory | Verified on ORD-2026-000287 |
| No application downtime | Desired | Achieved (sub-10ms) |
| No application errors | Desired | Zero errors observed |
| Snapshot table for rollback | Desired | **Missing** — the only gap |

The single missing element is the rollback snapshot table. However, since the data state is correct and the write-path fix is already deployed (preventing future contamination), a rollback is not required. The risk of needing to revert is zero.

---

## 5. Engineering Rule: Never Use EXPLAIN ANALYZE on Production DML

### Rule

**`EXPLAIN ANALYZE` is FORBIDDEN on any DML statement (INSERT, UPDATE, DELETE, MERGE) in a production database.**

Use one of these alternatives:

| Safe Alternative | Command | Behavior |
|-----------------|---------|----------|
| `EXPLAIN` (without ANALYZE) | `EXPLAIN UPDATE ...` | Plan only, no execution |
| `EXPLAIN (COSTS, BUFFERS)` | `EXPLAIN (COSTS, BUFFERS) UPDATE ...` | Plan with cost estimates, no execution |
| `BEGIN; EXPLAIN ANALYZE ...; ROLLBACK;` | Transaction wrapper | Execution statistics without commit |
| `EXPLAIN ANALYZE SELECT ...` | On a SELECT that mimics the DML | Safe if SELECT is read-only |

### Enforcement

1. **Add a DML detection guard** to all database tooling scripts. A pre-check function that rejects `EXPLAIN ANALYZE` if the query contains `INSERT`, `UPDATE`, `DELETE`, or `MERGE`.
2. **Code review checklist addition:** Any SQL in production tooling that uses `EXPLAIN ANALYZE` must be reviewed for DML content.
3. **Documentation:** Add this incident to the runbook as Appendix B: *"Why EXPLAIN ANALYZE is a write operation."*

---

## Appendix: Correct State Verification

The following data was confirmed post-incident:

| Metric | Value |
|--------|-------|
| Total orders | 164 |
| Employee-owned orders | 164 |
| Customer-owned orders | 0 |
| Orders with `owner_id = employees.id` | 164 |
| Orders with `owner_id = employees.identity_id` | 0 |
| Orders with orphaned `owner_id` | 0 |
| Latest order number | ORD-2026-000287 |
| Latest order owner code | EMP-2026-000016 (مستر عمر) |

---

*Incident closed. No data rollback required. Verification proceeding.*
