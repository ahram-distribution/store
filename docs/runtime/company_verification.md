# Phase 6: Company Verification — Aggregation Integrity

**Date:** 2026-06-30
**Status:** SQL trace complete. Full verification requires DB comparison.

---

## 1. Company Target Sources

The `company` block in the `get_governed_target_performance` return JSON uses:

| Field | Source | Aggregation |
|-------|--------|-------------|
| `sales_target` | `company_monthly_targets.sales_target` | Direct read (single row/month) |
| `visits_target` | `company_monthly_targets.visits_target` | Direct read |
| `orders_target` | `company_monthly_targets.orders_target` | Direct read |
| `new_customers_target` | `company_monthly_targets.new_customers_target` | Direct read |

**Note:** Company targets are NOT computed as SUM of `employee_monthly_targets`. They are set independently.

**Status:** ✅ Verified. Single source of truth for company targets.

## 2. Company Actuals (Direct Aggregates)

Company actuals are computed from raw tables WITHOUT employee attribution:

| Field | Raw Table | Filter | Aggregation |
|-------|-----------|--------|-------------|
| `sales_actual` | `orders` | `status='delivered'`, `delivered_at` in month | `SUM(total_amount)` |
| `visits_actual` | `visits` | `status='completed'`, `check_out_at` in month | `COUNT(*)` |
| `orders_actual` | `orders` | `status='delivered'`, `delivered_at` in month | `COUNT(DISTINCT id)` |
| `new_customers_actual` | `customers` + `orders` | First delivery in month | `COUNT(DISTINCT customer_id)` |
| `return_deductions` | `returns` + `return_items` | `status='approved'`, `created_at` in month | `SUM(credit_note_amount)` |
| `full_returns` | `returns` | Approved returns >= total pieces | `COUNT(DISTINCT order_id)` |

**Status:** ✅ Verified. SQL logic is correct.

## 3. Employee Actuals (Attributed to Individuals)

Employee actuals are computed similarly but WITH attribution via `owner_id` → `employees.id` or `identity_id`:

| Field | Attribution Logic | Status |
|-------|-------------------|--------|
| `sales_actual` | `o.owner_id LEFT JOIN emp.id` OR `emp2.identity_id` | ✅ Correct |
| `orders_actual` | Same as sales | ✅ Correct |
| `visits_actual` | `v.employee_id` | ✅ Direct FK |
| `new_customers_actual` | First delivery per customer per employee | ✅ Correct |
| `collections_actual` | `resolve_employee_id(c.owner_id)` | ✅ Uses utility function |

## 4. Structural Discrepancy: Company vs Employees

**Company actuals may exceed SUM of employee actuals** because:

| Reason | Impact | Detail |
|--------|--------|--------|
| Unattributed orders | Orders where `owner_id` doesn't match any employee or identity_id are counted at company level but not per-employee | Company sales >= SUM of employee sales |
| Unattributed employees | Employees not in `v_visible_ids` are included in company-level counts but excluded from employee array | Company data is broader than employee array |
| `is_active` filter | Employee CTE filters `e.is_active = true`; company queries have no employee filter | Inactive employees' orders still count at company level |

**Status:** ⚠️ Known structural discrepancy. Not a bug — company reflects absolute truth, employees reflect attributed subset.

## 5. Weight Discrepancy: Company vs Employee

| Weight | Company (from config) | Employee (from `get_effective_weights`) |
|--------|----------------------|----------------------------------------|
| Sales | `v_comp_sales_weight` (default 75) | Dynamic per employee |
| Visits | `v_comp_visits_weight` (default 7.5) | Dynamic per employee |
| Orders | `v_comp_orders_weight` (default 7.5) | Dynamic per employee |
| New Customers | `v_comp_new_customers_weight` (default 10) | Dynamic per employee |
| Collections | `v_comp_collections_weight` (default 0) | Dynamic per employee |
| Attendance | `v_comp_attendance_weight` (default 0) | Dynamic per employee |
| **Overall** | Weighted with company weights | Weighted with employee-specific weights |

**Impact:** Company overall score is NOT the average of employee overall scores. They are computed independently with different weight configurations.

**Status:** ✅ This is intentional. Company uses global weights, employees use individualized weights.

## 6. Aggregation Verification Checks (DB Required)

| Check | Expected | Status |
|-------|----------|--------|
| Company sales = SUM of all employee sales (including inactive/null owner) | Should NOT match (unattributed orders expected) | ⚠️ Needs DB |
| Company visits = SUM of all employee visits | Should NOT match (inactive employees) | ⚠️ Needs DB |
| Company targets match `company_monthly_targets` | ✅ Verified from code | ✅ Confirmed |
| SUM of employee targets matches company targets | Should NOT match (independent targets) | ⚠️ Needs DB |
| Company overall score using company weights | ✅ Verified from code | ✅ Confirmed |
