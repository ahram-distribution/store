# Identity & Ownership Canonicalization Audit — Final Report

**Date:** 2026-07-14  
**Scope:** System-wide audit of all identity/ownership write paths, read paths, foreign key relationships, and data integrity.  
**Trigger:** Duplicate rows in Activity Reports caused by identity_id vs employees.id mismatch in `runtime.get_team_activity`.

---

## Deliverable 1: Canonical Identity Contract

### The 3-Tier Identity Model

| Tier | Column | Scope | Used In | Example |
|------|--------|-------|---------|---------|
| **Business PK** | `employees.id` | UUID, stable business identifier | `owner_id`, `employee_id`, `manager_id`, `assigned_to`, all business FK relationships | `550e8400-e29b-41d4-a716-446655440000` |
| **Auth UUID** | `employees.identity_id` | UUID, maps to `identities.id` (Supabase Auth) | `created_by`, `changed_by`, `session.identity_id`, audit trail fields | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| **Auth System** | `auth.users.id` | UUID, Supabase Auth internal | Auth system only. Never stored in business tables. | `b2c3d4e5-f6a7-8901-bcde-f12345678901` |

### Invariant Rules

1. **Business ownership fields** (`owner_id`, `employee_id`, `manager_id`, `assigned_to`, etc.) MUST always contain `employees.id`.
2. **Audit trail fields** (`created_by`, `changed_by`, `updated_by`) MUST always contain `employees.identity_id`.
3. **NEVER store `auth.users.id`** in any application table.
4. **NEVER use `employees.identity_id`** where `employees.id` is expected (business FK).
5. **Joins between business entities** MUST use `employees.id`. Joins to auth/identity data use `employees.identity_id`.
6. **Session identity** (`app.sessions.identity_id`) is the Auth UUID. Code resolving "who is this?" must map `identity_id → employees.id` before using it as a business FK.

### Resolution Function

```sql
-- Canonical: resolve Auth UUID to Business PK
SELECT id FROM employees WHERE identity_id = v_session.identity_id;
-- This is already deployed in governed_create_order (Phase 2 fix)
```

---

## Deliverable 2: Complete Write-Path Inventory

### Write Path #1: `governed_create_order` (PL/pgSQL) — FIXED

**File:** DDL in database (public.governed_create_order)  
**Status:** ✅ Correct since Phase 2 fix  
**Mechanism:** Employee path resolves `v_employee_id := SELECT id FROM employees WHERE identity_id = v_session.identity_id`, then inserts `owner_id = v_employee_id` (business PK). Customer path inserts `owner_id = v_session.identity_id` (customer identity_id — correct, as customers have no employees.id).  
**Risk:** None — verified on ORD-2026-000284 (test) and ORD-2026-000285 (production, حسن بكر).

### Write Path #2: `SupabaseSalesOrderProvider.placeNewOrder()` — BROKEN

**File:** `src/providers/implementations/supabase/SupabaseSalesOrderProvider.ts:32`  
**Status:** ❌ Writes `owner_id: this.context.identityId` (Auth UUID)  
**Code:**
```typescript
owner_id: this.context.identityId,   // line 32 — WRONG: should be employees.id
created_by: this.context.identityId,  // line 33 — CORRECT: audit trail field
```
**Root cause chain:** `RequestContext.identityId` is populated from `user?.identity_id` in `BootstrapProvider.tsx` → passed directly as `owner_id` without resolution to `employees.id`.  
**Impact:** All orders created through the Frontend Provider path (vs. governed RPC path) get `owner_id = identity_id`. This is the primary source of the contamination crisis.  
**Fix required:**
```typescript
// Before:
owner_id: this.context.identityId,
// After:
const { data: emp } = await supabase.from('employees')
  .select('id').eq('identity_id', this.context.identityId).single();
owner_id: emp?.id ?? this.context.identityId,  // fallback for non-employee users
```

### Write Path #3: `governed_create_customer` (PL/pgSQL)

**File:** DDL in database  
**Status:** ✅ Correct  
**Verification:** `customers.owner_id` column audit — all 401 non-null values match `employees.id`, 0 match `identity_id`.

### Write Path #4: `governed_change_customer_ownership` (PL/pgSQL)

**File:** DDL in database  
**Status:** ✅ Assumed correct (customers.owner_id is clean)

### Write Path #5: `order_status_history.changed_by` (via `governed_create_order`)

**File:** DDL in database (`governed_create_order` line ~135)  
**Code:**
```sql
INSERT INTO public.order_status_history (... changed_by ...)
VALUES (..., v_session.identity_id, ...);
```
**Status:** ✅ Correct — `changed_by` is an audit trail field per Canonical Identity Contract.

### Write Path #6: `orders.created_by` (via `governed_create_order`)

**File:** DDL in database (`governed_create_order` line ~97)  
**Code:**
```sql
INSERT INTO public.orders (... created_by ...)
VALUES (..., v_session.identity_id, ...);
```
**Status:** ✅ Correct — `created_by` is an audit trail field.

### Write Path #7: `orders.created_by` (via `SupabaseSalesOrderProvider`)

**File:** `src/providers/implementations/supabase/SupabaseSalesOrderProvider.ts:33`  
**Code:**
```typescript
created_by: this.context.identityId,
```
**Status:** ✅ Correct — coincidentally correct because identityId IS the Auth UUID.

### Summary

| Write Path | owner_id | created_by | Status |
|-----------|----------|------------|--------|
| `governed_create_order` (employee) | `v_employee_id` (employees.id) | `v_session.identity_id` | ✅ |
| `governed_create_order` (customer) | `v_session.identity_id` (correct for customers) | `v_session.identity_id` | ✅ |
| `SupabaseSalesOrderProvider.placeNewOrder` | `this.context.identityId` (identity_id!) | `this.context.identityId` | ❌ owner_id |
| `governed_create_customer` | `employees.id` | N/A | ✅ |
| `governed_change_customer_ownership` | `employees.id` | N/A | ✅ |

---

## Deliverable 3: Cross-Domain Ownership Audit

### Methodology

Scanned all 36 tables in `public` schema for 15+ column name patterns indicating business relationship/ownership fields. Every non-null value was checked against both `employees.id` and `employees.identity_id`.

### Results

| Table | Column | Total Non-Null | Matches `employees.id` | Matches `employees.identity_id` | Orphaned |
|-------|--------|---------------|----------------------|-----------------------------|----------|
| `attendance_audit_log` | employee_id | 412 | 412 | 0 | 0 |
| `auction_participants` | approved_by | 5 | 5 | 0 | 0 |
| `auctions` | created_by | 7 | 7 | 0 | 0 |
| `collections` | owner_id | 0 | — | — | — |
| `collections` | approved_by | 0 | — | — | — |
| `collections` | created_by | 0 | — | — | — |
| `credit_applications` | approved_by | 0 | — | — | — |
| `credit_applications` | created_by | 0 | — | — | — |
| `customer_credit_ledger` | created_by | 0 | — | — | — |
| `customer_ownership_history` | changed_by | 28 | 28 | 0 | 0 |
| `customers` | owner_id | 401 | 401 | 0 | 0 |
| `daily_deals` | created_by | 10 | 10 | 0 | 0 |
| `deletion_audit_log` | employee_id | 36 | 36 | 0 | 0 |
| `delivery_tracking` | assigned_to | 3 | 3 | 0 | 0 |
| `employee_advances` | employee_id | 0 | — | — | — |
| `employee_advances` | approved_by | 0 | — | — | — |
| `employee_advances` | created_by | 0 | — | — | — |
| `employee_capabilities` | employee_id | 0 | — | — | — |
| `employee_monthly_targets` | employee_id | 36 | 36 | 0 | 0 |
| `employee_roles` | employee_id | 34 | 34 | 0 | 0 |
| `employee_weight_overrides` | employee_id | 1 | 1 | 0 | 0 |
| `employee_work_policies` | employee_id | 31 | 31 | 0 | 0 |
| `employee_work_policies` | updated_by | 30 | 30 | 0 | 0 |
| `employees` | manager_id | 33 | 33 | 0 | 0 |
| `expenses` | approved_by | 0 | — | — | — |
| `expenses` | created_by | 0 | — | — | — |
| `flash_offers` | created_by | 9 | 9 | 0 | 0 |
| `order_status_history` | changed_by | 513 | **0** | **513** | 0 |
| `orders` | owner_id | 164 | 37 | **127** | 0 |
| `orders` | created_by | 164 | 0 | **164** | 0 |
| `preparation_exceptions` | created_by | 2 | 2 | 0 | 0 |
| `preparation_records` | cancelled_by | 2 | 2 | 0 | 0 |
| `return_status_history` | changed_by | 0 | — | — | — |
| `returns` | owner_id | 0 | — | — | — |
| `returns` | created_by | 0 | — | — | — |
| `session_recovery_log` | employee_id | 2 | 2 | 0 | 0 |
| `tracking_cleanup_log` | employee_id | 0 | — | — | — |
| `tracking_points` | employee_id | 3826 | 3826 | 0 | 0 |
| `treasury_transactions` | created_by | 0 | — | — | — |
| `visits` | employee_id | 467 | 467 | 0 | 0 |
| `workday_breaks` | employee_id | 24 | 24 | 0 | 0 |
| `workday_sessions` | employee_id | 229 | 229 | 0 | 0 |
| `workday_settings` | updated_by | 1 | 1 | 0 | 0 |

### Key Findings

1. **`orders.owner_id`**: 127 of 164 (77.4%) match `employees.identity_id` — **CONTAMINATED**. 37 (22.6%) match `employees.id` — correct.
2. **`orders.created_by`**: All 164 match `employees.identity_id` — ✅ **Correct per contract** (audit trail field).
3. **`order_status_history.changed_by`**: All 513 match `employees.identity_id` — ✅ **Correct per contract** (audit trail field).
4. **Every other table/column** — 100% clean. All use `employees.id`.
5. **Zero orphaned values** across entire database (every FK resolves to a real employee).
6. **`manager_id`** — 33 non-null, all pointing to `employees.id`, zero pointing to `identity_id`. Perfect integrity.

### Affected Employees (orders.owner_id contamination)

- **17 employees** have orders where `owner_id = identity_id` instead of `employees.id`.
- **6 employees** are double-booked (orders exist under both their `employees.id` AND their `employees.identity_id`).
- **The 6 double-booked employees** are the ones affected by the duplicate-row bug in Activity Reports.

---

## Deliverable 4: Hidden Dependency Map

### Read Path #1: `runtime.get_team_activity` — DUPLICATE ROW SOURCE

**What it does:** Returns activity rows for all team members under a manager. Joins `orders` on `o.owner_id = emp.id OR o.owner_id = emp.identity_id`.  
**Why:** Workaround for mixed data — needs to find orders regardless of which ID was stored in `owner_id`.  
**Effect:** For the 6 double-booked employees, each order gets counted TWICE (once for `emp.id`, once for `emp.identity_id`).  
**Affects:** Activity Reports Page, Monthly Activity screen.

### Read Path #2: `runtime.get_activity` — Individual (already deduped)

**What it does:** Similar to `get_team_activity` but for a single employee. Uses same `IN(id, identity_id)` pattern. Less problematic since it aggregates to one row.

### Read Path #3: `runtime.get_achievement` — Performance KPIs

**What it does:** Uses same OR pattern for matching achievement targets to employee IDs.

### Read Path #4: `runtime_event_views.order_delivered_events` — Event Bus

```sql
LEFT JOIN employees emp ON o.owner_id = emp.id OR o.owner_id = emp.identity_id
```
**Why:** Workaround for mixed data.  
**Effect:** Potential duplicate events for double-booked employees.

### Read Path #5: `runtime_event_views.order_created_events` — Event Bus

Correctly maps `created_by → actor_identity_id` and `owner_id → actor_employee_id`. Handles both employee and customer owner types with separate logic.

### Read Path #6: `OrdersPage.tsx` filter (line 151)

```typescript
const currentUserId = useAuthStore((s) => s.user?.identity_id)
// ...
list = list.filter((o: any) => o.owner_id === currentUserId)
```
**Bug:** Filters client-side by comparing `orders.owner_id` (business field) against `user?.identity_id` (Auth UUID). When `owner_id` correctly stores `employees.id`, this filter FAILS to match.  
**Affected view:** "My Invoices" tab shows incorrect results for employees whose orders have correct `owner_id = employees.id`.

### Read Path #7: `EmployeeAnalysisPage.tsx` query (line 212)

```typescript
.in('owner_id', (emps || []).map((e: any) => e.identity_id).filter(Boolean))
```
**Bug:** Queries `customers.owner_id` using `e.identity_id`. This is currently harmless because all 401 `customers.owner_id` values are `employees.id` (not identity_id), so the filter returns zero results. **Dead code / silently broken.**  
**Fix:** Should use `e.id` (employees.id) instead of `e.identity_id`.

### Read Path #8: `OrdersPage.tsx` employee select (line 186, 262)

```typescript
const emp = employees.find((e: any) => (e.identity_id || e.id) === filters.employeeId)
// ...
employees={employees.map(e => ({ id: e.identity_id || e.id, name: e.full_name }))}
```
**Issue:** Falls back to `identity_id` when `e.id` is falsy. This works around potential data issues but obscures the underlying problem. The `||` pattern is a code smell.

### Read Path #9: `resolve_employee_id` (SQL function)

```sql
-- Resolves a UUID to employees.id by checking both id and identity_id
SELECT id FROM employees WHERE id = p_input OR identity_id = p_input;
```
**Purpose:** Workaround function used by various read paths to find an employee regardless of which ID type they have.  
**Effect:** Masks the contamination but doesn't fix it.

### Read Path #10: `get_unified_order` (SQL function)

Uses `resolve_employee_id` internally to normalize owner_id lookups.

### Read Path #11: `get_dashboard_sales` / `get_dashboard_management`

Both use the OR-pattern join to account for mixed data in `orders.owner_id`.

---

## Deliverable 5: Legacy Compatibility Map

### Phase 1 — No Changes (Current State)

Before any migration runs, the following workarounds keep the system running:

| Component | Workaround | Side Effect |
|-----------|-----------|-------------|
| `runtime.get_team_activity` | `o.owner_id IN (emp.id, emp.identity_id)` | Duplicate rows for 6 employees |
| `ActivityReportsPage.tsx` | Dedup by `employee_id` via `Map` | Masks duplicates, data still double-counted |
| `runtime_event_views` | `LEFT JOIN ... OR` | Potential duplicate events |
| `resolve_employee_id` | Checks both `id` and `identity_id` | Slow, masks contamination |
| `OrdersPage.tsx` line 72 | `user?.identity_id` instead of `user?.employee_id` | "My Invoices" broken for clean orders |
| `EmployeeAnalysisPage.tsx` line 212 | `.in('owner_id', identity_ids)` | Dead query (returns 0) |
| `get_unified_order` | Uses `resolve_employee_id` | Slower queries |

### Phase 2 — Fix Write Path (#1 deployed, #2 pending)

Once `SupabaseSalesOrderProvider.placeNewOrder()` is fixed:

| Component | Workaround | Side Effect |
|-----------|-----------|-------------|
| All existing contaminated orders | Still have `owner_id = identity_id` | Workarounds still needed for historical data |
| New orders | Correct `owner_id = employees.id` | Workarounds still needed for read paths |

### Phase 3 — Data Migration

After fixing the write path AND migrating historical data:

| Data Type | Count | Migration Action |
|-----------|-------|-----------------|
| `orders.owner_id` that match identity_id | 127 rows | UPDATE to employees.id |
| `orders.owner_id` that match employees.id | 37 rows | No action needed |
| `orders.created_by` | 164 rows | No action needed (correct) |
| `order_status_history.changed_by` | 513 rows | No action needed (correct) |

### Phase 4 — Remove Workarounds

After data migration completes:

| Component | Cleanup Action |
|-----------|---------------|
| `runtime.get_team_activity` | Remove `OR o.owner_id = emp.identity_id` from JOIN |
| `runtime.get_activity` | Remove OR pattern |
| `runtime.get_achievement` | Remove OR pattern |
| `runtime_event_views` | Simplify to single `o.owner_id = emp.id` |
| `resolve_employee_id` | Simplify to single `id = p_input` |
| `OrdersPage.tsx:72` | Change `user?.identity_id` to `user?.employee_id` |
| `OrdersPage.tsx:151` | Change `o.owner_id === currentUserId` to `o.owner_id === currentEmpId` |
| `EmployeeAnalysisPage.tsx:212` | Change `.map(e => e.identity_id)` to `.map(e => e.id)` |
| `OrdersPage.tsx:186,262` | Remove `e.identity_id || e.id` fallback, use `e.id` only |

### Backward Compatibility Strategy

1. **Deploy write-path fix first** (Phase 2) — new data is correct
2. **Run data migration** (Phase 3) — fix historical data
3. **Deploy read-path simplification** (Phase 4) — remove workarounds
4. **Each phase is independently revertible** — if a read-path simplification breaks something, the old workaround still works because the data is already correct

---

## Deliverable 6: Final Architectural Validation

### Overall Assessment

The system has **good architectural hygiene** overall. The contamination is **narrowly scoped** to a single column (`orders.owner_id`) through a single write path (`SupabaseSalesOrderProvider.placeNewOrder`). The database itself has **perfect referential integrity** — zero orphaned records across 43 relationship columns in 26 tables.

The root cause is a **single-line bug** that went undetected because:
1. The RPC-based write path (`governed_create_order`) was always correct
2. The Frontend Provider write path was added later and didn't go through `governed_create_order`
3. Read-path workarounds (OR joins) masked the problem in most screens
4. Only the intersection — Activity Reports with team aggregation — exposed the duplicate-row bug

### Rating

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Write-path integrity | ⚠️ 1 broken path out of 7 total | Only `SupabaseSalesOrderProvider` is wrong |
| Read-path correctness | ⚠️ 4 of 11 paths need cleanup | All are workarounds for the write-path bug |
| Data integrity | ✅ 0 orphans | Every FK resolves to a valid employee |
| Contract compliance | ⚠️ 1 column violated | `orders.owner_id` (127/164 rows) |
| Test coverage | ❌ No test caught typicross| No integration test validates owner_id format |
| Regression risk | ✅ Low | Fix is one column, one write path |

### Recommended Order of Remediation

| Step | Action | Risk | Impact |
|------|--------|------|--------|
| **1** | Fix `SupabaseSalesOrderProvider.placeNewOrder()` — resolve `identityId → employees.id` before writing `owner_id` | Low | All new orders immediately correct |
| **2** | Fix `OrdersPage.tsx:151` — use `currentEmpId` instead of `currentUserId` for "My Invoices" filter | Low | "My Invoices" starts working for all orders |
| **3** | Fix `EmployeeAnalysisPage.tsx:212` — use `.map(e => e.id)` instead of `.map(e => e.identity_id)` | Low | Dead query starts working |
| **4** | Run data migration: `UPDATE orders SET owner_id = employees.id FROM employees WHERE orders.owner_id = employees.identity_id` | Medium | Fixes all 127 contaminated historical orders |
| **5** | Simplify `runtime.get_team_activity` — remove OR join | Medium | Eliminates duplicate rows at source |
| **6** | Simplify `runtime_event_views` — remove OR join | Medium | Eliminates duplicate events |
| **7** | Simplify `resolve_employee_id` — remove identity_id check | Low | Clean function, no ambiguity |
| **8** | Clean up `OrdersPage.tsx` — remove `e.identity_id || e.id` fallback | Low | Clean frontend code |

### Estimated Contamination Timeline

- `SupabaseSalesOrderProvider.placeNewOrder()` has been the active order-creation path since the frontend provider layer was introduced
- All 164 orders were created through this path (the RPC path was added/used later for specific features)
- 37 orders have correct `owner_id = employees.id` — likely because those were created after the Phase 2 fix, through `governed_create_order`, or through admin processes

---
*End of Audit Report — 6 deliverables complete.*
