# Employee Hierarchy Dependency Report

## Inventory of All Recursive manager_id Traversals

Notes:
- **Production = currently running on Supabase** (verified via pg_get_functiondef dumps).
- **Migrated = defined in SQL files** but may or may not be the currently deployed version (many were superseded by later rewrites).
- "Upper management bypass" = if the employee has a role granting `is_upper_management = true`, recursion is skipped and all employees are returned.

---

## GROUP A: Core Recursive CTE Owners (Production)

These functions contain the actual `WITH RECURSIVE` clause and are the **source of truth** for hierarchy traversal.

### A1. `public.get_visible_employee_ids(p_token text)`
| Field | Value |
|-------|-------|
| **Type** | Function (RPC) |
| **Defined in** | `20270102_fix_get_visible_employee_ids_contract.sql` |
| **Recursion** | `WITH RECURSIVE subtree AS (SELECT id FROM employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM employees e JOIN subtree s ON e.manager_id = s.id)` |
| **Cycle protection** | ✅ Partial — calls `is_upper_management()` first. If true → returns ALL employees (no recursion). Only non-upper-management users hit the CTE. |
| **Called by** | ~50+ other RPCs across the codebase (see Group C) |
| **Screen** | No direct frontend calls (backend-only intermediary) |
| **Affected by cycle?** | **Yes** — for any employee who is NOT upper management and whose traversal path enters the WRQ1003↔WRQ1006 cycle. |
| **Risk** | **Critical** — 50+ downstream functions depend on it |

### A2. `public.get_dashboard_management(p_token text)`
| Field | Value |
|-------|-------|
| **Type** | Function (RPC) |
| **Defined in** | `20260607_recovery_missing_functions.sql` (old pattern), **NOT updated to use `get_visible_employee_ids`** |
| **Recursion** | Own inline `WITH RECURSIVE sub AS (SELECT id FROM employees WHERE id = v_session.employee_id UNION ALL SELECT e.id FROM employees e JOIN sub s ON e.manager_id = s.id)` |
| **Cycle protection** | ❌ None. The old `v_is_super_admin` role check (SUPER_ADMIN/CHAIRMAN/ADMIN) bypasses for those roles, but the hardcoded WRQ1002/WRQ1004 bypass and the regular employee branch both hit the CTE. |
| **Called by** | `src/pages/dashboard/AdminWorkspace.tsx`, `SuperAdminWorkspace.tsx`, `ChairmanWorkspace.tsx`, `ManagementDashboard.tsx`, `UpperManagementDashboard.tsx` |
| **Screen** | Dashboard screens for upper management |
| **Affected by cycle?** | **Yes** — WRQ1003 is CHAIRMAN (bypasses), but WRQ1006 is NOT CHAIRMAN/ADMIN/SUPER_ADMIN per old role check → will enter the CTE and loop. Additionally, ANY employee in the WRQ1003/WRQ1006 subtrees whose call enters the cycle will loop. |
| **Risk** | **Critical** — frontend dashboard screens time out. This is the function that caused the original timeout. |

### A3. `public.get_governed_employees(p_token uuid)`
| Field | Value |
|-------|-------|
| **Type** | Function (RPC) |
| **Defined in** | Latest: `20260720_unify_upper_management_role.sql` (delegates to `app.get_subtree_ids`) |
| **Recursion** | Delegates to `app.get_subtree_ids()` |
| **Cycle protection** | ✅ Partial — calls `is_upper_management()` first. If true → returns ALL employees (no recursion). Only non-upper-management employees hit the CTE. |
| **Called by** | 24 frontend call sites across 16 files |
| **Screen** | EmployeesPage, HierarchyPage, EmployeeProfilePage, RolesTab, PermissionsTab, UserProfilePage, CustomersPage, CustomerProfilePage, OrdersPage, VisitsPage, DeliveryPage, WarehousePage, SalesDirectorWorkspace, ExecutiveOperationsWorkspace, SalesManagerOperations |
| **Affected by cycle?** | **Yes** — for non-upper-management employees whose traversal enters the cycle. |
| **Risk** | **Critical** — most heavily frontend-consumed function in the system |

### A4. `app.get_subtree_ids(p_manager_id uuid DEFAULT app.current_employee_id())`
| Field | Value |
|-------|-------|
| **Type** | Function (app schema helper) |
| **Defined in** | `20260607_recovery_missing_functions.sql` |
| **Recursion** | `WITH RECURSIVE subtree AS (SELECT id FROM public.employees WHERE id = p_manager_id UNION ALL SELECT e.id FROM public.employees e JOIN subtree s ON e.manager_id = s.id)` |
| **Cycle protection** | ❌ None — no upper management bypass, no cycle detection. Raw recursion from the given root. |
| **Called by** | ~40+ functions across the codebase (see Group C) |
| **Screen** | No direct frontend calls (backend intermediary) |
| **Affected by cycle?** | **Yes** — traversing from any employee in the cycle (or whose hierarchy enters the cycle) will infinite-loop. |
| **Risk** | **Critical** — the most fundamental helper; 40+ functions depend on it |

---

## GROUP B: Functions with Own Inline CTEs (Migrated — may be superseded)

These appear in migration files with their own inline `WITH RECURSIVE` CTEs. **Many have been rewritten in later migrations** to delegate to `app.get_subtree_ids()` or `get_visible_employee_ids()`. Listed for completeness and because some may still be deployed.

| # | Function | File | CTE Pattern | Protection | Status |
|---|----------|------|-------------|------------|--------|
| B1 | `get_governed_collections` (1-result) | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Superseded by _20260721_fix_removed_hardcoded_checks.sql |
| B2 | `get_credit_application_status_counts` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B3 | `get_customer_analytics_list` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B4 | `get_customer_brands` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B5 | `get_customer_card` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B6 | `get_customer_products` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B7 | `get_customer_sales_ranking` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B8 | `get_dashboard_counter` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Superseded by 20260626_unify_p_token_text_contract.sql |
| B9 | `get_dashboard_delivery` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B10 | `get_delivery_dashboard_stats` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B11 | `get_governed_collections` (SETOF) | 20260607_recovery_missing_functions.sql | Inline in WHERE IN, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B12 | `get_governed_customers` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B13 | `get_governed_customer_search` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B14 | `get_governed_order` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B15 | `get_governed_return` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B16 | `get_governed_return_items` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B17 | `get_governed_returns` | 20260607_recovery_missing_functions.sql | Inline in WHERE IN, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B18 | `get_governed_visit` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B19 | `get_governed_visits` | 20260607_recovery_missing_functions.sql | Inline in WHERE IN, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B20 | `get_visible_customer_ids` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B21 | `get_visible_employees` | 20260607_recovery_missing_functions.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |
| B22 | `get_governed_customer_contacts` | 20260604_governance_rpcs.sql | Inline | None | Unknown if deployed |
| B23 | `get_governed_customer_addresses` | 20260604_governance_rpcs.sql | Inline | None | Unknown if deployed |
| B24 | `governed_global_search` | 20260604_governance_rpcs.sql | Inline | None | Superseded by 20260720_unify_upper_management_role.sql |
| B25 | `get_governed_orders` | 20260618_fix_governance_leak.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Superseded by 20260714_customer_code_snapshot.sql |
| B26 | `get_governed_orders` | 20260714_customer_code_snapshot.sql | Inline, 2-branch | Hardcoded Alī/Mahmoud bypass | Unknown if deployed |

---

## GROUP C: Downstream Consumers (delegate recursion to helpers)

These functions do NOT contain their own CTE. They call `app.get_subtree_ids()` or `public.get_visible_employee_ids()`.

### C1: Callers of `public.get_visible_employee_ids` (~50+ RPCs)

| File | Lines | Risk |
|------|-------|------|
| `20260806_fix_executive_permissions_and_state.sql` | 330, 430 | High |
| `20260805_executive_workspace.sql` | 115, 225 | High |
| `20260802_phase_c_followup_schedule_type_rpcs.sql` | 44, 203 | High |
| `20260730_phase3_order_revision_system.sql` | 709 | High |
| `20260729_orders_unification_phase2.sql` | 36, 350 | High |
| `20260729_orders_unification_phase1.sql` | 176, 226, 491 | High |
| `20260727_fix_attendance_detail_rpcs.sql` | 405 | High |
| `20260724_sales_reps_effort_dashboard.sql` | 40 | High |
| `20260724_identity_integration_layer.sql` | 54 | High |
| `20260724_customer_intelligence_system.sql` | 303 | High |
| `20260723_phase7_work_hours_analytics_v2.sql` | 28 | Medium |
| `20260722_fix_attendance_rpcs_visibility.sql` | 19, 83, 117 | High |
| `20260720_unify_upper_management_role.sql` | 30+ call sites | Critical |
| `20261003_b12_include_all_active_employees.sql` | 38 | Medium |
| `20261002_fix_work_hours_ledger_contract.sql` | 65 | Medium |
| `20270101_fix_get_unified_order_contract.sql` | 79 | High |
| `20261231_fix_weights_canonical_source.sql` | 153 | Medium |
| `20261231_fix_kpi_detail_add_uuids.sql` | 25 | Medium |
| `20261231_fix_collections_source.sql` | 49 | Medium |
| `20261229_fix_company_target_source.sql` | 39 | Medium |
| `20261227_phase_d_hierarchy.sql` | 55 | Medium |
| `20261202_phase_c2_apply_weights.sql` | 90 | Medium |
| `20261003_b12_include_all_active_employees.sql` | 38 | Medium |
| `20261002_fix_work_hours_ledger_contract.sql` | 65 | Medium |
| `20261001_f2_canonical_kpi_unification.sql` | 816, 867 | High |
| `20260821_executive_queue_expand_statuses.sql` | 38, 144 | High |
| `20260820_executive_queue_customer_owner.sql` | 35 | High |
| `20260806_fix_executive_permissions_and_state.sql` | 330, 430 | High |

### C2: Callers of `app.get_subtree_ids` (~40+ functions)

| File | Lines | Risk |
|------|-------|------|
| `20260607_recovery_missing_functions.sql` | 21, 70, 74 | Critical (defines the helper) |
| `20260607_order_visibility_fix.sql` | 66, 132, 171 | High |
| `20260606_customer_visibility_fix.sql` | 126, 163, 223 | High |
| `20260608_supervisor_dashboard.sql` | 87 | High |
| `20260611_phase3_ownership_enforcement.sql` | 113, 125, 133 | High |
| `20260611_phase5_attendance_v2.sql` | 242, 437, 542 | Medium |
| `20260611_phase6_attendance_v2_complete.sql` | 38, 166, 329, 452, 626, 733, 836 | Medium |
| `20260612_phase4_targets_governance.sql` | 412, 476, 562, 792, 1044, 1225, 1388, 1462, 1510 | High |
| `20260615_identity_rules_final.sql` | 357 | Medium |
| `20260616_snapshot_architecture.sql` | 277 | Medium |
| `20260617_get_coverage_map.sql` | 17 | Medium |
| `20260618_fix_governance_leak.sql` | 122, 206 | High |
| `20260627_fix_storefront_companies_and_salesrep_governance.sql` | 133, 174, 238, 299 | High |
| `20260710_sales_manager_cc.sql` | 88 | Medium |
| `20260710_sales_manager_cc_hybrid.sql` | 98 | Medium |
| `20260714_customer_code_snapshot.sql` | 281, 434 | High |
| `20260720_unify_upper_management_role.sql` | 153, 155, 755, 2542 | High |
| `20260923_unified_smart_search.sql` | 122 | Medium |
| `20261001_f2_canonical_kpi_unification.sql` | 232, 948 | High |
| `20270301_governed_search_enhancements.sql` | 255, 343 | Medium |

---

## GROUP D: Upward Traversal (ancestor_map pattern)

These traverse **upward** from descendant to ancestors (not downward):

| Object | File | Affected? | Risk |
|--------|------|-----------|------|
| `get_upper_management_dashboard` | `20260612_phase4_targets_governance.sql` (line 795) | **Yes** — upward traversal from every active employee will enter the WRQ1003↔WRQ1006 cycle and loop | **High** |
| `get_drilldown_performance` | `20260612_drilldown_performance_rpcs.sql` (line 45) | **Yes** — same reason | **High** |
| `get_drilldown_performance` (rewrite) | `20260720_unify_upper_management_role.sql` (line 1952) | **Yes** — same reason | **High** |

---

## Summary Table

| Object | Type | Screen(s) | Affected? | Risk |
|--------|------|-----------|-----------|------|
| `get_visible_employee_ids` | Function/RPC | Backend intermediary (consumed by 50+ RPCs) | ✅ Yes | Critical |
| `get_dashboard_management` | Function/RPC | 5 dashboard screens | ✅ Yes | Critical |
| `get_governed_employees` | Function/RPC | 16 screens, 24 call sites | ✅ Yes | Critical |
| `app.get_subtree_ids` | Function (helper) | Backend intermediary (consumed by 40+ RPCs) | ✅ Yes | Critical |
| `get_upper_management_dashboard` | Function/RPC | Upper management dashboard | ✅ Yes | High |
| `get_drilldown_performance` | Function/RPC | Performance drilldown screens | ✅ Yes | High |
| `governed_global_search` | Function/RPC | Global search | ✅ Yes | High |
| `get_governed_customers` | Function/RPC | AccountPage, OrdersPage, DataEntryWorkspace | ✅ Yes | High |
| `get_governed_visits` | Function/RPC | VisitsPage, SalesDirectorWorkspace, SecretaryWorkspace | ✅ Yes | High |
| `get_governed_collections` | Function/RPC | CollectorWorkspace, AccountantWorkspace | ✅ Yes | High |
| `get_governed_orders` | Function/RPC | Orders page scoping | ✅ Yes | High |
| `get_governed_returns` | Function/RPC | Returns service | ✅ Yes | High |
| `get_governed_deliveries` | Function/RPC | DeliveryPage, DeliveryWorkspace | ✅ Yes | High |
| `get_governed_dashboard_counts` | Function/RPC | AdminWorkspace, SuperAdminWorkspace | ✅ Yes | High |
| `get_credit_dashboard_stats` | Function/RPC | ManagementDashboard, SuperAdminWorkspace | ✅ Yes | High |
| `get_dashboard_counter` | Function/RPC | Dashboard counters | ✅ Yes | High |
| 40+ callers of `app.get_subtree_ids` | Functions/RPCs | Various screens | ✅ Yes | High |
| 50+ callers of `get_visible_employee_ids` | Functions/RPCs | Various screens | ✅ Yes | High |
| B1–B26 (old inline CTEs) | Functions/RPCs | Various (some superseded) | ✅ Yes | Medium–High |

---

## Answers to the 4 Questions

### 1. If the manager cycle is corrected in DATA ONLY, how many functions will immediately recover?

**All of them.** The cycle is a data problem, not a code problem. Every recursive CTE in the system traverses `manager_id`. If `WRQ1003.manager_id ≠ WRQ1006.id` and `WRQ1006.manager_id ≠ WRQ1003.id`, every CTE terminates normally.

Count:
- **4 production Core functions** (A1–A4) + **3 upward ancestor_map CTEs** (Group D) + **~26 old inline CTEs** (Group B, deployed state unknown) + **~90+ downstream consumers** (Groups C1 + C2) = **all ~123 traversal paths recover immediately** with zero code changes.

**Evidence**: The cycle exists in the data (`employees` table rows), not in any SQL code. The `WITH RECURSIVE` clauses are standard downward/upward traversals that work correctly on acyclic data. No function has logic that creates cycles.

**Caveat**: Functions with upper management bypass (A1, A3) would still work correctly for upper management employees even during the cycle. But for the cycle employees and their subtrees, they would also recover once the data is fixed.

### 2. Is there any recursive function that already has cycle protection?

**No.** Zero functions in the codebase have `CYCLE DETECTION` (no `ARRAY[]` path tracking, no `MAXDEPTH` limit, no `CYCLE` clause).

The closest thing to protection is the **upper management bypass** in:
- `get_visible_employee_ids` — calls `is_upper_management()` first; if true → `SELECT array_agg(id) FROM employees` (no recursion)
- `get_governed_employees` — same pattern

This bypass avoids the CTE entirely for upper management employees, but that's **role-based bypass**, not cycle protection. If a non-upper-management employee triggers the recursion, any cycle in the data causes an infinite loop.

### 3. Which recursive implementation should become the canonical implementation for the whole system?

**`app.get_subtree_ids(p_manager_id uuid)` is the best candidate**, with these improvements:
- It's already the most-frequently called helper (~40 callers)
- It accepts a `p_manager_id` parameter, making it reusable from any context
- It's in the `app` schema, clearly named as internal

The **alternative `public.get_visible_employee_ids`** is also a candidate but it's more complex (session token, identity type check, upper management bypass) — it does too much to be a raw hierarchy helper.

**Recommended canonical design (future fix, not now):**
- Keep `app.get_subtree_ids()` as the single downward CTE
- Add `MAXDEPTH` guard (`depth < 50`) to prevent infinite loops
- Add `CYCLE` clause (`CYCLE id SET is_cycle USING path`) if PostgreSQL ≥ 14
- Add an upward helper (`app.get_ancestor_ids()`) to replace the 3 `ancestor_map` CTEs
- Have all downstream functions call these helpers, never inline their own CTEs

### 4. What is the safest repair strategy?

**Fix data only.** Strategy: **Fix data only**

**Evidence:**
1. The cycle is 100% a data integrity issue — two employees pointing `manager_id` at each other.
2. All ~123 recursive traversal paths work correctly on acyclic data. No code change is needed to make them work again.
3. Fixing data is a single `UPDATE` statement (or two) on 1–2 rows.
4. Fixing functions carries risk: rewriting `get_dashboard_management` to use the canonical helper, or adding cycle protection, could introduce bugs, contract changes, or regressions across 90+ screens.
5. After the data fix, if you want hardening: add cycle protection to `app.get_subtree_ids()` only (the single canonical helper), which instantly protects all ~40 downstream callers.

**Recommendation:**
1. **Phase 1 (now)**: Fix `manager_id` data only — `UPDATE employees SET manager_id = ... WHERE id IN ('WRQ1003', 'WRQ1006')` to break the cycle. Determine correct manager based on org structure (WRQ1006 ياسر توفيق reports to WRQ1003 محمد سعيد, or vice versa, or both report to someone else).
2. **Phase 2 (after recovery)**: Add cycle protection to `app.get_subtree_ids()` — a depth limit (`depth < 50`) and cycle detection — so future data errors don't cause outages.
3. **Phase 3 (hardening)**: Replace all remaining inline CTEs (get_dashboard_management, ancestor_map CTEs) with calls to the canonical helper.
4. **Phase 4 (prevention)**: Add a `CHECK` constraint or trigger to prevent circular `manager_id` references at the database level.
