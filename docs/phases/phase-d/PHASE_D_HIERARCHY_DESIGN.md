# Phase D — Hierarchy Performance Design

**Status:** Approved ✅  
**Date:** 2026-12-27  
**Owner:** System Architect  
**Based on:** Phase C2 (Dynamic Weights — closed), Phase 1 Architecture (Section 8B — Validation Report)

---

## 1. Objective

Add a 3-level hierarchical performance view to the existing `get_governed_target_performance` RPC output, enabling drill-down from Company → Manager Team → Individual KPI cards.

### Constraints
- Zero existing field deletion or rename — additive JSON keys only.
- Zero score change — all existing consumers return identical data.
- Flat `employees` array and `company` object remain **unchanged**.
- New `hierarchy` key is the only addition to the top-level JSON.

---

## 2. JSON Contract — Additive Change

### Before (current v2 — Phase C2)
```jsonc
{
  "has_target": true,
  "company": { /* CompanyInfo — 20 fields */ },
  "employees": [ /* EmployeePerfRow[] — 23 fields each */ ],
  "best_employee": { /* EmployeePerfRow */ },
  "weakest_employee": { /* EmployeePerfRow */ }
}
```

### After (Phase D)
```jsonc
{
  "has_target": true,                    // UNCHANGED
  "company": { /* CompanyInfo */ },       // UNCHANGED
  "employees": [ /* EmployeePerfRow */ ], // UNCHANGED (4 KPIs)
  "best_employee": { /* EmployeePerfRow */ },    // UNCHANGED
  "weakest_employee": { /* EmployeePerfRow */ }, // UNCHANGED
  
  // NEW — additive, ignored by existing consumers
  "hierarchy": {
    "manager_count": 3,
    "managers": [ { /* HierarchyManager */ } ],
    "unassigned": [ /* HierarchyMember */ ]
  }
}
```

---

## 3. Key Structures

### 3.1 `hierarchy` (top-level)

| Field | Type | Description |
|-------|------|-------------|
| `manager_count` | int | Number of manager groups |
| `managers` | HierarchyManager[] | Ordered by team_overall_pct DESC (see §3.2.3) |
| `unassigned_count` | int | Count of employees with no manager_id |
| `unassigned` | HierarchyMember[] | Employees with no manager_id (if any visible) |

### 3.2 `HierarchyManager`

Represents one sales manager and their team.

**Display purpose:** Level 1 (manager row in company view) + Level 2 (team view header).

| Field | Type | Source | Level |
|-------|------|--------|-------|
| `manager_id` | uuid | `employees.id` | L1 |
| `manager_code` | text | `employees.code` | L1 |
| `manager_name` | text | `employees.full_name` | L1 |
| **Manager's own scores** | | | |
| `own_overall_score` | numeric(5,2) or null | Weighted score from emp_weights | L1 |
| `own_kpis` | object | Same employee's 6 KPI objects | L1 |
| **Team summary** | | | |
| `team_summary` | object | Aggregated team data (see below) | L2 |
| **Members** | | | |
| `members` | HierarchyMember[] | Includes manager as first member with `is_manager: true` | L2 |

#### 3.2.1 `team_summary` object

```jsonc
{
  "team_target":        { "sales": 460000, "visits": 300, "orders": 300, "new_customers": 35, "collections": 0, "attendance": 0 },
  "team_actual":        { "sales": 260000, "visits": 0, "orders": 31, "new_customers": 5, "collections": 0, "attendance": 0 },
  "team_achievement_pct":   { "sales": 56.52, "visits": 0, "orders": 10.33, "new_customers": 14.29, "collections": null, "attendance": null },
  "team_overall_pct":  45.23,
  "team_member_count": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `team_target` | object | SUM of all member targets (all 6 KPIs) |
| `team_actual` | object | SUM of all member actuals (all 6 KPIs) |
| `team_achievement_pct` | object | Computed per-KPI percentage from team sums |
| `team_overall_pct` | numeric(5,2) | Weighted overall from company-level weights |
| `team_member_count` | int | Total members including manager |

#### 3.2.2 `own_kpis` object

Same `kpis` shape as HierarchyMember (see §3.3) — the manager's own performance.

#### 3.2.3 Manager ordering

The `managers[]` array is ordered by **`team_overall_pct` DESC** (highest team performance first). Ties broken by `manager_name ASC`.

This is the default server-side sort. The frontend can re-order independently.

> Note: `collections` and `attendance` values are included but will be 0/null until activated in Phase F.

### 3.3 `HierarchyMember`

Represents one team member (could be the manager themselves or a rep).

**Display purpose:** Row in Level 2 table + data source for Level 3 KPI cards.

| Field | Type | Notes |
|-------|------|-------|
| `employee_id` | uuid | |
| `employee_code` | text | |
| `employee_name` | text | |
| `is_manager` | boolean | true if this member IS the manager of this team |
| `has_target` | boolean | |
| `has_activity` | boolean | |
| `is_locked` | boolean or null | |
| `overall_achievement_score` | numeric(5,2) or null | |
| `weights` | jsonb | From `get_effective_weights` |
| `kpis` | object | All 6 KPI objects — for Level 3 cards |

**`kpis` object:**
```jsonc
{
  "sales":          { "target": 100000, "actual": 75000, "pct": 75.00 },
  "visits":         { "target": 50, "actual": 30, "pct": 60.00 },
  "orders":         { "target": 40, "actual": 20, "pct": 50.00 },
  "new_customers":  { "target": 10, "actual": 8, "pct": 80.00 },
  "collections":    { "target": 0, "actual": 0, "pct": null },
  "attendance":     { "target": 0, "actual": 0, "pct": null }
}
```

Each KPI object:
| Field | Type | Description |
|-------|------|-------------|
| `target` | numeric | Monthly target (0 if no target set) |
| `actual` | numeric | Actual achievement |
| `pct` | numeric(5,2) or null | `LEAST(actual/target * 100, 100)`; null if target = 0 |

> Design rationale: The `kpis` sub-object makes the Level 3 card renderer trivial — just iterate over the 6 keys. No need for a separate RPC call.

### 3.4 `unassigned` (in hierarchy)

- `unassigned_count` (int at top-level hierarchy) — number of employees with no manager.
- `unassigned` (`HierarchyMember[]`) — the actual member rows.

Visible employees whose `manager_id IS NULL` are placed here. These employees also appear in the flat `employees` array but are not under any manager group. Order: by `overall_achievement_score DESC`.

---

## 4. RPC Changes Required

### 4.1 Add `manager_id` AND `manager_name` to `employee_calc` CTE

In the current RPC (Phase C2), `employee_calc` CTE (line 222–247) selects from `public.employees e`. We add:

```sql
e.manager_id,
m.full_name AS manager_name  -- self-join on employees for manager name
```

This is additive to the CTE output. Existing flat `employees` array still does NOT include these fields (the flat array contract is unchanged), but the hierarchy CTE uses them.

### 4.2 Add `collections_target`, `collections_actual`, `attendance_target`, `attendance_actual`

Extend `employee_calc` CTE:

```sql
-- collections target already in employee_monthly_targets
COALESCE(et.collections_target, 0) AS collections_target,
-- collections actual from collections table (LEFT JOIN)
COALESCE(cl.collections_actual, 0) AS collections_actual,
-- attendance: 0 until Phase F
0 AS attendance_target,
0 AS attendance_actual
```

Collections actual requires a new CTE (or LEFT JOIN to existing):
```sql
employee_collections AS (
  SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
         COALESCE(SUM(c.amount), 0) AS collections_actual
  FROM public.collections c
  WHERE c.created_at >= v_month_start AND c.created_at < v_month_end
  GROUP BY public.resolve_employee_id(c.owner_id)
)
```

### 4.3 New CTE: `hierarchy_build`

After `employee_calc`, add a new CTE that:
1. Groups employees by `manager_id`
2. Computes team sums → `team_summary` object
3. Per-employee `kpis` and `own_kpis` objects
4. Builds `HierarchyManager[]` JSON with `team_overall_pct DESC` ordering

### 4.4 Add `hierarchy` to return value

Append to the final `jsonb_build_object`:

```sql
'hierarchy', v_hierarchy_json
```

---

## 5. Frontend Screen — `HierarchyTargetPage`

### 5.1 Route

`/targets/hierarchy` — Protected route, available to all employees with an active session.

### 5.2 Navigation Path

**الإدارة العليا** (`/dashboard`) → 🏛️ **التسلسل الهرمي** (`/targets/hierarchy`)

### 5.3 Screen Architecture

| Level | View | Description |
|-------|------|-------------|
| **Level 1 — Company** | Table | Company overview (target, actual, %) + progress bar + managers table sorted by `team_overall_pct DESC` + unassigned count |
| **Level 2 — Manager Team** | Table + Cards | Team summary (target, actual, %, member count) + manager's own KPI cards + members table (manager first with ✅) |
| **Level 3 — Member Details** | KPI Cards | 6 KPI cards per member: sales, orders, visits, new customers, collections, attendance |

### 5.4 KPI Cards

Each card displays:
- KPI name (Arabic label)
- Achievement percentage (or `—` if no target)
- Target and actual values
- Progress bar (colored per KPI)
- Status label: ✓ تم تجاوز الهدف / على المسار الصحيح / بحاجة دفع / متأخر / بدون إنجاز

---

## 6. Backward Compatibility Analysis

| Consumer | Change Impact | Status |
|----------|--------------|--------|
| `TargetRuntimePage.tsx` | Reads `employees`, `company`, `best_employee`, `weakest_employee` | **Zero impact** — these keys unchanged |
| `CompanyTargetsPage.tsx` | Reads `employees`, `company` | Zero impact |
| `PerformanceAnalysisPage.tsx` | Reads `employees` | Zero impact |
| Any future consumer reading `hierarchy` | NEW key | Will work |

---

## 7. Execution Plan

| Step | Description | File |
|------|-------------|------|
| Step 0 | **Design Approval** — this document | PHASE_D_HIERARCHY_DESIGN.md |
| Step 1 | **Migration: Collections CTE** — add `employee_collections` CTE | New migration file |
| Step 2 | **Migration: Extend employee_calc** — add manager fields + collections/attendance fields | Same migration |
| Step 3 | **Migration: Add hierarchy_build CTE** — group employees by manager, compute team rollups, build JSON | Same migration |
| Step 4 | **Migration: Append `hierarchy` to return** | Same migration |
| Step 5 | **Migration: Update frontend TS interfaces** — add HierarchyMember, HierarchyManager types | TypeScript change |
| Step 6 | **Frontend: HierarchyTargetPage** — 3-level drill-down screen at `/targets/hierarchy` | New component |
| Step 7 | **Frontend: Navigation entry** — add `التسلسل الهرمي` launcher to Upper Management Dashboard | Dashboard update |
| Step 8 | **Verification: Scores + contracts** — run before/after comparison | Manual verification |
| Step 9 | **Close Phase D** | |

---

## 8. Owner Decisions (Resolved During Review) (Resolved During Review)

1. **Attendance data** — Included with 0 values as placeholder. Phase F will activate actual data. ✅
2. **Collections data** — Include `collections_target` from `employee_monthly_targets` and `collections_actual` from `collections` table. ✅
3. **Manager detection** — Correct: an employee is a "manager" if other employees reference them as `manager_id`. ✅
4. **Manager ordering** — `managers[]` ordered by `team_overall_pct` DESC. ✅
5. **Team Summary** — Use single `team_summary` object with `team_target`, `team_actual`, `team_achievement_pct`, `team_overall_pct`, `team_member_count`. ✅
6. **Unassigned count** — Add `unassigned_count` alongside `unassigned[]`. ✅

---

## 9. Approval

| Role | Decision | Date |
|------|----------|------|
| **Owner** | ✅ Approved | 2026-12-27 |

---

## Appendix A — Full `hierarchy` JSON Example (Based on May 2026 Data)

```jsonc
{
  "hierarchy": {
    "manager_count": 1,
    "unassigned_count": 0,
    "managers": [
      {
        "manager_id": "خالد-سعيد-uuid",
        "manager_code": "EMP-002",
        "manager_name": "خالد سعيد",
        "own_overall_score": 34.46,
        "own_kpis": {
          "sales":         { "target": 175000, "actual": 75000, "pct": 42.86 },
          "visits":        { "target": 100, "actual": 0, "pct": 0 },
          "orders":        { "target": 100, "actual": 31, "pct": 31.00 },
          "new_customers": { "target": 15, "actual": 5, "pct": 33.33 },
          "collections":   { "target": 0, "actual": 0, "pct": null },
          "attendance":    { "target": 0, "actual": 0, "pct": null }
        },
        "team_summary": {
          "team_target":        { "sales": 460000, "visits": 300, "orders": 300, "new_customers": 35, "collections": 0, "attendance": 0 },
          "team_actual":        { "sales": 260000, "visits": 0, "orders": 31, "new_customers": 5, "collections": 0, "attendance": 0 },
          "team_achievement_pct":   { "sales": 56.52, "visits": 0, "orders": 10.33, "new_customers": 14.29, "collections": null, "attendance": null },
          "team_overall_pct":  0.61,
          "team_member_count": 3
        },
        "members": [
          {
            "employee_id": "خالد-سعيد-uuid",
            "employee_code": "EMP-002",
            "employee_name": "خالد سعيد",
            "is_manager": true,
            "has_target": true,
            "has_activity": true,
            "overall_achievement_score": 34.46,
            "weights": { /* get_effective_weights result */ },
            "kpis": {
              "sales":         { "target": 175000, "actual": 75000, "pct": 42.86 },
              "visits":        { "target": 100, "actual": 0, "pct": 0 },
              "orders":        { "target": 100, "actual": 31, "pct": 31.00 },
              "new_customers": { "target": 15, "actual": 5, "pct": 33.33 },
              "collections":   { "target": 0, "actual": 0, "pct": null },
              "attendance":    { "target": 0, "actual": 0, "pct": null }
            }
          },
          {
            "employee_id": "حسن-بكر-uuid",
            "employee_code": "EMP-001",
            "employee_name": "حسن بكر",
            "is_manager": false,
            "has_target": true,
            "has_activity": true,
            "overall_achievement_score": 7.00,
            "weights": { /* get_effective_weights result */ },
            "kpis": {
              "sales":         { "target": 175000, "actual": 75000, "pct": 42.86 },
              "visits":        { "target": 100, "actual": 0, "pct": 0 },
              "orders":        { "target": 100, "actual": 0, "pct": 0 },
              "new_customers": { "target": 10, "actual": 0, "pct": 0 },
              "collections":   { "target": 0, "actual": 0, "pct": null },
              "attendance":    { "target": 0, "actual": 0, "pct": null }
            }
          },
          {
            "employee_id": "سارة-uuid",
            "employee_code": "EMP-003",
            "employee_name": "سارة أحمد",
            "is_manager": false,
            "has_target": true,
            "has_activity": false,
            "overall_achievement_score": null,
            "weights": { /* get_effective_weights result */ },
            "kpis": {
              "sales":         { "target": 110000, "actual": 0, "pct": 0 },
              "visits":        { "target": 100, "actual": 0, "pct": 0 },
              "orders":        { "target": 100, "actual": 0, "pct": 0 },
              "new_customers": { "target": 10, "actual": 0, "pct": 0 },
              "collections":   { "target": 0, "actual": 0, "pct": null },
              "attendance":    { "target": 0, "actual": 0, "pct": null }
            }
          }
        ]
      }
    ],
    "unassigned": []
  }
}

```
