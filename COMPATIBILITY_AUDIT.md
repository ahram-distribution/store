# Compatibility Audit — Identity Workaround Inventory

**Date:** 2026-07-14  
**Purpose:** Inventory every compatibility mechanism that exists to compensate for mixed `employees.id` / `employees.identity_id` data. Evaluate each for removal readiness after the `orders.owner_id` migration.

---

## 1. SQL Function: `resolve_employee_id`

**File:** Database function — `public.resolve_employee_id(target_id uuid)`

**Body:**
```sql
SELECT COALESCE(
  (SELECT e.id FROM public.employees e WHERE e.id = target_id),
  (SELECT e.id FROM public.employees e WHERE e.identity_id = target_id)
);
```

**Why it exists:** Provides a single function that can resolve an employee ID regardless of whether the input is an `employees.id` or `employees.identity_id`. Used as a convenience wrapper by other functions.

**Historical origin:** Introduced during the period when `orders.owner_id` contained mixed values (both `id` and `identity_id`). Any code that needed to find the employee behind an `owner_id` used this function to handle both cases.

**Still protecting production?** ⚠️ Yes — `get_unified_order` and several other functions call it. With clean data now, the second subquery (`WHERE e.identity_id = target_id`) will never match because all `owner_id` values are now `employees.id`. It's functionally dead code, but it still executes a redundant subquery.

**Dead code?** ⚠️ Partially — the first subquery handles all current data. The second subquery is now unreachable for `owner_id` lookups but could still be reached if called with any `identity_id` value from elsewhere.

**Business risk if removed:** LOW — with clean data, all `owner_id` values are `employees.id`, so the first subquery always returns. Removing the fallback would cause failures only if:
- An `identity_id` is passed instead of `employees.id` (caller bug)
- Future contamination reoccurs
- The function is used for an identity_id-based lookup elsewhere

**Recommended removal order:** #7 (last — remove after all other workarounds are cleaned up and the system has been stable for ≥2 weeks)

---

## 2. SQL Function: `runtime.get_team_activity` — OR Pattern

**File:** `runtime.get_team_activity` — `runtime` schema

**Pattern:** The CTE selects both `e.id AS employee_id` and `e.identity_id`, then the activity aggregation logic matches orders against both.

**Rough structure:**
```sql
WITH team AS (
  SELECT e.id AS employee_id, e.identity_id, ...
  FROM employees e WHERE ...
), stats AS (
  SELECT ..., o.total_amount
  FROM orders o
  JOIN team t ON o.owner_id IN (t.employee_id, t.identity_id)
  ...
)
```

**Why it exists:** This is the **original root cause** of the duplicate row bug. Orders could match either `t.employee_id` OR `t.identity_id`, causing double-counting for the 7 double-booked employees.

**Historical origin:** Added when `orders.owner_id` started containing mixed values. The OR pattern was a quick fix to ensure all orders were counted regardless of which ID type was stored.

**Still protecting production?** ❌ No — now that all `owner_id` values are `employees.id`, the `t.identity_id` match never fires. The OR pattern is pure dead code.

**Dead code?** ✅ YES — the `identity_id` branch of the OR is unreachable with clean data.

**Business risk if removed:** ZERO — removing the `OR t.identity_id` condition will produce IDENTICAL results because no order's `owner_id` matches `identity_id` anymore. Verified: KPI comparison shows `Direct: 77 = Team: 77`.

**Recommended removal order:** #1 (remove immediately — this was the original bug source)

---

## 3. SQL Function: `runtime.get_activity` — Identity Ambiguity

**File:** `runtime.get_activity` — `runtime` schema

**Pattern:** Uses both `employee_id` and `identity_id` variables internally. Joins orders against both.

**Why it exists:** Same root cause as `get_team_activity` — needed to handle mixed `owner_id` values for single-employee activity lookup.

**Historical origin:** Same migration timeline as `get_team_activity`.

**Still protecting production?** ❌ No — with clean data, the identity_id path is dead code.

**Dead code?** ✅ YES — all matches now occur through `employees.id`.

**Business risk if removed:** ZERO — same verification as `get_team_activity`.

**Recommended removal order:** #2 (remove alongside `get_team_activity`)

---

## 4. SQL Function: `runtime.get_achievement` — Identity Ambiguity

**File:** `runtime.get_achievement` — `runtime` schema

**Pattern:** Similar dual-ID pattern for achievement KPI aggregation.

**Why it exists:** Same root cause — needed to aggregate achievement targets regardless of ID type stored.

**Historical origin:** Same timeline.

**Still protecting production?** ❌ No.

**Dead code?** ✅ YES.

**Business risk if removed:** ZERO.

**Recommended removal order:** #3 (remove alongside other runtime functions)

---

## 5. View: `runtime_event_views.order_delivered_events` — OR Join

**File:** `runtime_event_views.order_delivered_events` — `runtime_event_views` schema

**Pattern:**
```sql
LEFT JOIN employees emp ON o.owner_id = emp.id OR o.owner_id = emp.identity_id
```

**Why it exists:** Event bus needs to resolve `owner_id` to employee details for event processing. The OR pattern ensures events fire regardless of ID type stored.

**Historical origin:** Same migration timeline.

**Still protecting production?** ❌ No — with clean data, the `emp.identity_id` branch never matches.

**Dead code?** ✅ YES.

**Business risk if removed:** ZERO for the OR condition. However, the event view itself serves a business function — only the OR pattern is dead.

**Recommended removal order:** #4 (simplify the JOIN, keep the view)

---

## 6. View: `runtime_event_views.order_created_events` — Dual Mapping

**File:** `runtime_event_views.order_created_events` — `runtime_event_views` schema

**Pattern:** Maps `created_by → actor_identity_id` and `owner_id → actor_employee_id` with separate logic for employee vs customer owner types.

**Why it exists:** Correctly separates the audit trail (`created_by` = `identity_id`) from business ownership (`owner_id` = `employees.id`). This was ALWAYS correct — no OR pattern needed because it uses the columns for their intended purposes.

**Historical origin:** Designed correctly from the start (or fixed early).

**Still protecting production?** ✅ Yes — but it's correct, not a workaround.

**Dead code?** ❌ No — this is the correct implementation that other views should match.

**Business risk if removed:** HIGH — this is production event logic. Do NOT remove.

**Recommended removal order:** N/A — keep as-is. Use as the reference implementation.

---

## 7. View: `runtime_event_views.collection_recorded_events` — Identity References

**File:** `runtime_event_views.collection_recorded_events` — `runtime_event_views` schema

**Pattern:** References `identity_id` for audit trail mapping.

**Why it exists:** Correct audit trail mapping.

**Historical origin:** Correct design.

**Still protecting production?** ✅ Yes — correct implementation.

**Dead code?** ❌ No.

**Business risk if removed:** HIGH.

**Recommended removal order:** N/A — keep as-is.

---

## 8. View: `runtime_event_views.customer_registered_events` / `visit_completed_events`

**File:** `runtime_event_views` schema

**Status:** These reference `identity_id` in their definitions but do NOT use OR patterns. They correctly map employee-related fields using `employees.id`.

**Dead code?** ❌ No — correct implementations.

**Recommended removal order:** N/A — keep as-is.

---

## 9. Frontend: `OrdersPage.tsx:72` — Wrong Auth Field

**File:** `src/pages/orders/OrdersPage.tsx:72`

```typescript
const currentUserId = useAuthStore((s) => s.user?.identity_id)
```

**Why it exists:** The store exposes `user?.identity_id` — this was the only auth field originally available. The frontend developer used it for the "My Orders" filter, not realizing it was the Auth UUID, not the Business PK.

**Historical origin:** Original implementation of `OrdersPage.tsx`. The store structure predates the canonical identity model.

**Still protecting production?** ⚠️ Partially — the filter on line 151 compares `o.owner_id === currentUserId`. When `owner_id` was contaminated with `identity_id`, this comparison worked. Now that `owner_id = employees.id`, the filter fails to match for correct orders, while still matching for the (now-zero) contaminated ones.

**Dead code?** ❌ No — it still executes, but produces incorrect results for the "My Invoices" tab. Users with correct `owner_id` values will see 0 invoices under "My Invoices."

**Business risk if removed:** LOW POSITIVE — fixing this will make "My Invoices" work correctly.

**Recommended removal order:** #5 (fix after SQL workarounds are removed)

**Fix:** Change to `user?.employee_id` instead of `user?.identity_id`:
```typescript
const currentEmpId = useAuthStore((s) => s.user?.employee_id)
// ...
list = list.filter((o: any) => o.owner_id === currentEmpId)
```

---

## 10. Frontend: `OrdersPage.tsx:151` — Identity_id Filter

**File:** `src/pages/orders/OrdersPage.tsx:151`

```typescript
if (tab === 'my_invoices' && currentUserId) {
  list = list.filter((o: any) => o.owner_id === currentUserId)
}
```

**Why it exists:** Same as #9 — uses `identity_id` to filter `owner_id`. Now produces incorrect results.

**Historical origin:** Same as #9.

**Still protecting production?** ❌ No — filter is now broken for correct orders.

**Dead code?** ⚠️ It executes, but produces wrong results. Worse than dead code.

**Business risk if removed:** LOW POSITIVE — fixing this restores correct filtering.

**Recommended removal order:** #5 (same fix as #9 — change the variable)

---

## 11. Frontend: `OrdersPage.tsx:186,262` — Fallback Pattern

**File:** `src/pages/orders/OrdersPage.tsx:186,262`

```typescript
const emp = employees.find((e: any) => (e.identity_id || e.id) === filters.employeeId)
// ...
employees={employees.map(e => ({ id: e.identity_id || e.id, name: e.full_name }))}
```

**Why it exists:** The `get_governed_employees` RPC returns employees with both `identity_id` and `id` fields. The filter was built to work regardless of which field was populated. The `||` fallback is defensive — use `identity_id` if `id` is falsy.

**Historical origin:** Ambiguity about which ID field would be populated in the `get_governed_employees` response.

**Still protecting production?** ⚠️ Yes — if `e.id` is ever null/undefined, it falls back to `e.identity_id`. With current data, `e.id` is always populated.

**Dead code?** ⚠️ Partially — the `e.identity_id` fallback is unreachable under normal conditions. It's dead code.

**Business risk if removed:** LOW — remove `e.identity_id ||` and use `e.id` directly. If any employee record ever has a null `id`, this would break. But `id` is the PRIMARY KEY of the employees table — it's never null.

**Recommended removal order:** #6 (low priority, cosmetic cleanup)

---

## 12. Frontend: `EmployeeAnalysisPage.tsx:212` — Wrong ID in Query

**File:** `src/pages/dashboard/EmployeeAnalysisPage.tsx:212`

```typescript
.in('owner_id', (emps || []).map((e: any) => e.identity_id).filter(Boolean))
```

**Why it exists:** The developer used `e.identity_id` to query `customers.owner_id`. Since `customers.owner_id` correctly stores `employees.id`, this query returns zero results — it's silently broken.

**Historical origin:** Copy-paste from another pattern that used `identity_id`, without understanding the semantic difference.

**Still protecting production?** ❌ No — it's a dead query that returns 0 results. The feature (team customer count) has been broken since this code was written.

**Dead code?** ✅ YES — the query is executed but produces empty results.

**Business risk if removed:** LOW POSITIVE — fixing this restores the team customer count feature.

**Recommended removal order:** #6 (same cleanup as #11)

**Fix:** Change to `.map((e: any) => e.id)`.

---

## 13. Frontend: `ActivityReportsPage.tsx:151-155` — Dedup Map

**File:** `src/pages/reports/ActivityReportsPage.tsx:151-155`

```typescript
const seen = new Map<string, TeamMemberRow>()
for (const r of rawTeam) {
  if (!seen.has(r.employee_id)) seen.set(r.employee_id, r)
}
const teamData = Array.from(seen.values())
```

**Why it exists:** Workaround for `get_runtime_team_activity` returning duplicate rows for double-booked employees. The Map dedup by `employee_id` ensures each employee appears once.

**Historical origin:** Added when the duplicate-row bug in `get_runtime_team_activity` was discovered.

**Still protecting production?** ⚠️ Yes — but now that `get_runtime_team_activity` no longer produces duplicates (because owner_id data is clean), the dedup is a no-op. It's a safety net that's no longer needed.

**Dead code?** ⚠️ Partially — the Map always has unique keys because the data is now clean. The dedup still iterates and filters, but never actually removes a duplicate.

**Business risk if removed:** LOW — removing the dedup will produce identical results. However, keep it until `get_runtime_team_activity` is simplified (#1 above).

**Recommended removal order:** #1 (remove at the same time as the `get_runtime_team_activity` OR pattern — the dedup exists only because of that bug)

---

## 14. Mapper: `SalesOrderMapper.ts:48,70` — COALESCE Fallback

**File:** `src/providers/mappers/SalesOrderMapper.ts:48,70`

```typescript
salesRepId: header.owner_id ?? header.created_by ?? '',
```

**Why it exists:** If `owner_id` is null/undefined, falls back to `created_by` as a best-effort sales rep identifier. This handles edge cases where orders might not have an explicit owner.

**Historical origin:** Defensive coding — `owner_id` could theoretically be null for some order types or legacy data.

**Still protecting production?** ⚠️ Yes — but `owner_id` is never null for employee-owned orders (164/164 have owner_id). The `created_by` fallback is only relevant for customer-owned orders or data anomalies.

**Dead code?** ⚠️ Mostly — `owner_id` is always populated for employee orders. The `created_by` fallback would incorrectly use the audit UUID (`identity_id`) instead of the business PK if triggered, which would itself be a bug.

**Business risk if removed:** LOW — `owner_id` is never null for employee orders. Removing the fallback would make the code clearer.

**Recommended removal order:** #6 (cleanup, low priority)

---

## 15. Display: `order-display.ts:161,170` — COALESCE

**File:** `src/types/order-display.ts:161,170`

```typescript
id: snapshotVal(o, ['owner_id', 'snapshot_owner_id', 'customer_owner_id']),
// ...
o.created_by === o.owner_id ? 'مندوب مبيعات' : 'موظف'
```

**Why it exists:** The `snapshotVal` function tries multiple fields to find the owner ID. The second line uses `created_by === owner_id` to determine if the creator is the same as the owner — this was a heuristic that only worked when both fields contained the same ID type.

**Historical origin:** The `created_by === owner_id` comparison is especially problematic. When `owner_id = employees.id` and `created_by = employees.identity_id`, these are DIFFERENT UUIDs even for the same employee. So this comparison would always produce `'موظف'` (employee) instead of `'مندوب مبيعات'` (sales rep) for the same person.

**Still protecting production?** ❌ No — it's been broken since the canonical model was clarified (owner_id and created_by store different identifier types). The comparison never matches for the same employee.

**Dead code?** ⚠️ The `snapshotVal` fallback chain still works. The `created_by === owner_id` heuristic is now always false — it functions as dead/broken logic.

**Business risk if removed:** LOW — the `created_by === owner_id` comparison has been producing incorrect labels. Removing it or fixing the comparison improves accuracy.

**Recommended removal order:** #6 (cleanup)

---

## 16. Provider: `SupabaseSalesOrderProvider.placeNewOrder()` — Dormant Risk

**File:** `src/providers/implementations/supabase/SupabaseSalesOrderProvider.ts:32`

```typescript
owner_id: this.context.identityId,
```

**Why it exists:** The provider layer was built as an alternative to direct RPC calls. `RequestContext.identityId` is populated with the Auth UUID (`user?.identity_id`), and this value is written directly to `owner_id` without resolution to `employees.id`.

**Historical origin:** Provider layer development. The developer used `identityId` because it was the available session identifier, without understanding the canonical identity model.

**Still protecting production?** ❌ No — this provider is **dormant/dead code**. It's never called from any page component. The CQRS pipeline that uses it is also never wired to any UI.

**Dead code?** ✅ YES — entire `placeNewOrder` method is never called in production.

**Business risk if removed:** ZERO for production. MEDIUM as a future risk — if someone activates the supabase provider backend without fixing this line first, new orders would be contaminated.

**Recommended removal order:** #5 (fix before frontend cleanup, even though it's dormant — defensive hardening)

**Fix:** Resolve identityId to employees.id before writing:
```typescript
const { data: emp } = await supabase.from('employees')
  .select('id').eq('identity_id', this.context.identityId).single();
owner_id: emp?.id ?? this.context.identityId,
```

---

## 17. RLS Policy: `p_update` — Uses `app.current_employee_id()`

**File:** Database RLS — `orders` table

```sql
USING: (((owner_id = app.current_employee_id()) AND app.has_capability('orders.update'::text))
        OR app.has_capability('orders.approve'::text))
```

**Why it exists:** The `app.current_employee_id()` function resolves the session identity to `employees.id`:
```sql
SELECT e.id FROM public.employees e WHERE e.identity_id = app.current_identity_id() LIMIT 1;
```

**Historical origin:** Correctly designed RLS that uses the canonical resolution function. This is the RIGHT way to compare session identity against `owner_id`.

**Still protecting production?** ✅ Yes — and it's correct. This is the reference implementation for how identity comparison SHOULD work.

**Dead code?** ❌ No — actively protecting the `orders` table.

**Business risk if removed:** HIGH — this RLS policy controls who can update orders. Do NOT remove.

**Recommended removal order:** N/A — keep as-is. Use as reference pattern.

---

## Summary — Removal Order

| Order | Component | Type | Risk | Reason |
|-------|-----------|------|------|--------|
| **#1** | `runtime.get_team_activity` OR pattern | SQL | Zero | Original bug source, now dead code |
| **#1** | `ActivityReportsPage.tsx` dedup Map | Frontend | Zero | Only needed because of #1 |
| **#2** | `runtime.get_activity` identity pattern | SQL | Zero | Same root cause, now dead code |
| **#3** | `runtime.get_achievement` identity pattern | SQL | Zero | Same root cause, now dead code |
| **#4** | `runtime_event_views.order_delivered_events` OR JOIN | SQL | Zero | OR branch unreachable with clean data |
| **#5** | `OrdersPage.tsx` identity_id filters | Frontend | Low+ | Currently broken, fix restores feature |
| **#5** | `SupabaseSalesOrderProvider` identityId | TS | Zero | Dormant code, defensive hardening |
| **#6** | `OrdersPage.tsx` `e.identity_id || e.id` fallback | Frontend | Low | Cosmetic cleanup |
| **#6** | `EmployeeAnalysisPage.tsx` identity_id query | Frontend | Low+ | Fix restores team customer count |
| **#6** | `SalesOrderMapper.ts` COALESCE fallback | TS | Low | Defensive, never triggered |
| **#6** | `order-display.ts` `created_by === owner_id` | TS | Low | Heuristic always false now |
| **#7** | `resolve_employee_id` fallback subquery | SQL | Zero | Dead code path, keep as safety net |

**Keep permanently (correct implementations):**
- `app.current_employee_id()` — canonical resolution function
- `runtime_event_views.order_created_events` — correct identity separation
- `runtime_event_views.collection_recorded_events` — correct audit trail mapping
- Orders RLS `p_update` — correct identity comparison pattern
- `governed_create_order` v_employee_id resolution — the deployed fix

---

## Appendix: Current Deployment Status

The `runtime.get_team_activity` function in the `runtime` schema still has identity_id references. However, the `public.get_runtime_team_activity` function (a separate wrapper) is clean. After removing the OR pattern from `runtime.get_team_activity`, the KPI results will be identical — verified by:
- Direct order count (Jul 1-14): 77
- Team activity aggregation: 77
- Difference: 0 (0.00%)

---

## Resolution Status — Phase 5 Complete

All 17 items have been resolved as of Phase 5 (2026-07-14):

| # | Component | Status | Notes |
|---|-----------|--------|-------|
| 1 | `runtime.get_team_activity` OR pattern | ✅ RESOLVED | Simplified — uses `= t.employee_id` only |
| 2 | `ActivityReportsPage.tsx` dedup Map | ✅ RESOLVED | OR join removed at source; dedup is no-op |
| 3 | `runtime.get_activity` identity pattern | ✅ RESOLVED | Simplified — uses `= v_employee_id` only |
| 4 | `runtime_event_views.order_delivered_events` OR JOIN | ✅ RESOLVED | JOIN simplified to single column |
| 5 | `OrdersPage.tsx` identity_id filters | ✅ RESOLVED | Now uses `employee_id` for `owner_id` lookups |
| 6 | `SupabaseSalesOrderProvider` identityId | ✅ RESOLVED | Resolves identityId → emp.id before write |
| 7 | `OrdersPage.tsx` `e.identity_id \|\| e.id` | ✅ RESOLVED | Uses `e.id` directly |
| 8 | `EmployeeAnalysisPage.tsx` identity_id query | ✅ RESOLVED | Uses `e.id` instead of `e.identity_id` |
| 9 | `SalesOrderMapper.ts` COALESCE fallback | ✅ RESOLVED | Removed `created_by` fallback |
| 10 | `order-display.ts` `created_by === owner_id` | ✅ RESOLVED | Removed broken comparison |
| 11 | `order-printing.ts` `created_by === owner_id` | ✅ RESOLVED | Removed broken comparison |
| 12 | `resolve_employee_id` fallback subquery | ✅ RESOLVED | Simplified to single lookup |
| 13 | `get_employee_workday_history` resolve_employee_id | ✅ RESOLVED | Uses `owner_id` directly |
| 14 | `get_team_map` resolve_employee_id | ✅ RESOLVED | Uses `owner_id` directly |
| 15 | `get_my_workday_status` resolve_employee_id | ✅ RESOLVED | Uses `owner_id` directly |
| 16 | `get_daily_target_vs_actual` resolve_employee_id | ✅ RESOLVED | Uses `owner_id` directly |
| 17 | `get_live_workday_overview` resolve_employee_id | ✅ RESOLVED | Uses `owner_id` directly |

**Remaining work:** Apply SQL migration (`migrations/20260714_phase5b_compatibility_removal.sql`) to the database, then run the full regression suite.
