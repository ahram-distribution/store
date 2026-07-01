# Phase 5: Manager Verification — Team Hierarchy Integrity

**Date:** 2026-06-30
**Status:** Source-code analysis complete. Full verification requires DB queries.

---

## 1. Hierarchy Source of Truth

The `manager_id` column in the `employees` table is the **single source of truth**:
- `NULL` = top level (reports to company)
- Non-NULL = reports to that manager's employee ID
- Self-referencing FK constraint (`fk_employees_manager`)

**Index:** `idx_employees_manager_id` exists on this column.

**Verified from code:** ✅ Schema is clean and simple.

## 2. Server-Side Hierarchy (get_governed_target_performance)

The RPC builds hierarchy with these CTEs:

```sql
team_managers → SELECT DISTINCT employee_id FROM employees WHERE id IN (SELECT manager_id FROM employees)
team_raw → team_managers + their members
team_agg → aggregated KPIs per manager, ordered by team_overall_pct DESC
hierarchy_data → { manager_count, unassigned_count, managers: [...], unassigned: [...] }
```

**Rules:**
- An employee is a "manager" when `EXISTS (SELECT 1 FROM employees WHERE manager_id = e.id)`
- Self-grouping: the manager appears first in their own `members[]` array with `is_manager: true`
- Unassigned: employees where `manager_id IS NULL` OR manager is not in the employee set
- Ordering: managers by `team_overall_pct DESC`, members by `overall_achievement_score DESC`

**Verified from code:** ✅ Logic is correct and deterministic.

## 3. Client-Side Grouping (ActivityScreen.tsx)

ActivityScreen builds groups from the flat array returned by `get_runtime_team_activity`:

```typescript
const mgrMap: Record<string, string> = {};
const mgrNameMap: Record<string, string> = {};
members.forEach(m => { mgrMap[m.employee_id] = m.manager_id; mgrNameMap[m.employee_id] = m.manager_name; });
// Then: members.filter(m => m.manager_id === selectedManagerId)
```

**Issues:**
- ⚠️ Groups are built from `members[].manager_id` on EACH row — relies on every member row having correct `manager_id`
- ⚠️ No explicit unassigned group — members with `manager_id = null` may be silently excluded

## 4. Dual Grouping Discrepancy

**TargetRuntimePage.tsx** builds groups from `get_governed_active_employees` (flat array with `employee_manager_id`), NOT from the hierarchy key.

**Potential divergence:**
- `get_governed_target_performance` hierarchy: uses `team_managers` CTE (any employee with subordinates is a manager)
- `TargetRuntimePage.tsx`: uses `employee_manager_id` from `get_governed_active_employees` — this may not match if `get_governed_active_employees` filters differently (e.g., only active employees)

**Impact:** Manager count and lineup could differ between TargetRuntimePage and HierarchyTargetPage within the same app.

**Status:** ⚠️ Cannot verify without DB comparison.

## 5. Missing RPC: get_runtime_team

The `get_runtime_team` RPC (missing from migrations) likely provides the team hierarchy structure for the team achievement screens. Without its definition, we cannot verify whether it matches the hierarchy structure from `get_governed_target_performance`.

**Status:** ❌ Unknown — definition needed.

## 6. Hierarchy Integrity Checks Needed (DB Required)

| Check | SQL Query | Expected | Status |
|-------|----------|----------|--------|
| No orphan manager_ids | `SELECT * FROM employees WHERE manager_id IS NOT NULL AND manager_id NOT IN (SELECT id FROM employees)` | 0 rows | ⚠️ Needs DB |
| No circular references | Recursive CTE checking for cycles | No cycles | ⚠️ Needs DB |
| Single root (top-level) | `SELECT * FROM employees WHERE manager_id IS NULL` | >= 1 row | ⚠️ Needs DB |
| No manager with deleted subordinates | Subordinates with active=0 should be excluded | Depends on business rules | ⚠️ Needs DB |
| Team depth | `WITH RECURSIVE depth AS (...)` | Reasonable max | ⚠️ Needs DB |
