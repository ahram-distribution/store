# KPI Catalog — All KPI Definitions & Data Sources

**Date:** 2026-06-30
**Target Screen:** `/dashboard/activity-target` as the future Single Source of Truth

---

## 1. Legend

| KPI Status | Meaning |
|------------|---------|
| ✅ Canonical | Defined in only one RPC; no duplicates found |
| ⚠️ Multiple Sources | Defined in ≥2 RPCs with potential differences |
| ❌ Unknown | Not found in any RPC definition; calculated only in frontend |

---

## 2. KPI Catalog

### 2.1 Sales KPIs

| KPI | Definition | Data Source | RPC(s) | Screen(s) Using It | Status |
|-----|-----------|-------------|--------|-------------------|--------|
| **Created Sales** | `SUM(order_items.price * order_items.quantity)` for orders where `created_by` resolves to employee | `orders` + `order_items` joined via `created_by` (identity_id) | `get_governed_target_performance`, `get_completed_workdays_history`, `get_employee_workday_history`, `get_sales_reps_effort`, `get_live_workday_overview` | ActivityScreen, ManagerReportsPage, PerformancePage, SalesEffortPage, UpperManagementDashboard | ⚠️ Multiple |
| **Delivered Sales** | Same formula but filtered to `status = 'delivered'` | `orders` (delivered) + `order_items` | `get_governed_target_performance` (uses `delivered` + `cancelled` filters) | Target screens | ✅ Canonical in `get_governed_target_performance` |
| **Effective Sales** | `GREATEST(delivered_sales - return_deductions, 0)` | `get_governed_target_performance` calculation | `get_governed_target_performance` | PerformancePage, ManagerReportsPage | ✅ Canonical |
| **Return Deductions** | `SUM(return_items.quantity * return_items.unit_price)` where return is APPROVED and product matches order item | `returns` + `return_items` + `order_items` + `products` | `get_governed_target_performance` | TargetsTab | ✅ Canonical |

### 2.2 Order KPIs

| KPI | Definition | Data Source | RPC(s) | Screen(s) Using It | Status |
|-----|-----------|-------------|--------|-------------------|--------|
| **Created Orders** | `COUNT(*)` of orders where `created_by` resolves to employee, excluding `draft` and `cancelled` | `orders` via `resolve_employee_id` | `get_completed_workdays_history`, `get_employee_workday_history`, `get_daily_target_vs_actual`, `get_live_workday_overview`, `get_governed_target_performance` | ActivityScreen, ManagerReportsPage, PerformancePage, SalesEffortPage, AttendanceRuntimePage | ⚠️ Multiple |
| **Delivered Orders** | `COUNT(*)` of orders with `status = 'delivered'` | `orders` | `get_governed_target_performance` (via `effective_orders` after returns) | Target screens | ✅ Canonical |
| **Effective Orders** | `GREATEST(delivered_orders - full_returns, 0)` where full_return = total returned pieces >= total ordered pieces | `get_governed_target_performance` calculation | `get_governed_target_performance` | PerformancePage | ✅ Canonical |

### 2.3 Visit KPIs

| KPI | Definition | Data Source | RPC(s) | Screen(s) Using It | Status |
|-----|-----------|-------------|--------|-------------------|--------|
| **Completed Visits** | `COUNT(*)` of visits with `status = 'completed'` where `employee_id` matches | `visits` | `get_governed_target_performance`, `get_sales_reps_effort`, `get_live_workday_overview` | PerformancePage, SalesEffortPage, UpperManagementDashboard | ⚠️ Multiple |
| **Visits Target** | From `employee_monthly_targets.visits_target` | `employee_monthly_targets` | `get_governed_target_performance` (via `get_effective_weights`) | PerformancePage, ManagerReportsPage | ✅ Canonical |

### 2.4 Customer KPIs

| KPI | Definition | Data Source | RPC(s) | Screen(s) Using It | Status |
|-----|-----------|-------------|--------|-------------------|--------|
| **New Customers (Registered)** | `COUNT(*)` of customers where `created_by` or `owner_id` resolves to employee | `customers` | `get_runtime_activity` (production only) | ActivityScreen | ❌ Unknown |
| **New Customers (First Order)** | `COUNT(DISTINCT customer_id)` of each employee's customers who received their first delivery in the period | `orders` via `resolve_employee_id` + NOT EXISTS older delivery | `get_governed_target_performance`, `get_completed_workdays_history` | PerformancePage, ManagerReportsPage | ✅ Canonical in `get_governed_target_performance` |
| **Customer Target** | From `employee_monthly_targets.new_customers_target` | `employee_monthly_targets` | `get_governed_target_performance` | PerformancePage, ManagerReportsPage | ✅ Canonical |

### 2.5 Collection KPIs

| KPI | Definition | Data Source | RPC(s) | Screen(s) Using It | Status |
|-----|-----------|-------------|--------|-------------------|--------|
| **Collection Count** | `COUNT(*)` of collections where `created_by` resolves to employee | `collections` via `resolve_employee_id` | `get_completed_workdays_history`, `get_employee_workday_history`, `get_live_workday_overview` | Attendance screens, ManagerReportsPage | ⚠️ Multiple |
| **Collection Amount** | `SUM(amount)` of collections where `status = 'collected'` and `created_by` resolves to employee | `collections` | `get_completed_workdays_history`, `get_governed_target_performance`, `get_live_workday_overview` | ManagerReportsPage | ⚠️ Multiple |

### 2.6 Attendance KPIs

| KPI | Definition | Data Source | RPC(s) | Screen(s) Using It | Status |
|-----|-----------|-------------|--------|-------------------|--------|
| **Active Days** | `COUNT(DISTINCT date)` with a workday session in period | `workday_sessions` | `get_completed_workdays_history`, `get_sales_reps_effort` | SalesEffortPage, ManagerReportsPage | ✅ Canonical |
| **Working Hours (Net Minutes)** | Schedule-aware: `fixed_shift` → `SUM(duration - break_minutes)`; other → `SUM(duration)` | `workday_sessions` + `workday_breaks` + `employee_work_policies` | `get_completed_workdays_history`, `get_employee_workday_history`, `get_live_workday_overview`, `get_sales_reps_effort` | All attendance screens, ManagerReportsPage | ⚠️ Multiple |
| **Break Time** | `SUM(break_minutes)` per session | `workday_breaks` | `get_completed_workdays_history`, `get_employee_workday_history`, `get_live_workday_overview` | All attendance screens | ✅ Canonical |
| **Distance** | Haversine formula between consecutive tracking points with drift filters | `tracking_points` | `get_employee_day_map`, `get_completed_workdays_history` (reads `total_distance_meters`) | EmployeeDetailPage, ManagerReportsPage | ⚠️ Bug (see distance audit) |
| **Tracking Points Count** | `COUNT(*)` of tracking points per session | `tracking_points` | `get_completed_workdays_history`, `get_employee_day_map` | EmployeeDetailPage, ManagerReportsPage | ✅ Canonical |

### 2.7 Achievement KPIs

| KPI | Definition | Data Source | RPC(s) | Screen(s) Using It | Status |
|-----|-----------|-------------|--------|-------------------|--------|
| **Sales Achievement %** | `LEAST(achieved_sales / NULLIF(target, 0), 1.0) * 100` | Calculation in RPC | `get_governed_target_performance` | PerformancePage, ManagerReportsPage | ✅ Canonical |
| **Orders Achievement %** | `LEAST(achieved_orders / NULLIF(target, 0), 1.0) * 100` | Calculation in RPC | `get_governed_target_performance` | PerformancePage, ManagerReportsPage | ✅ Canonical |
| **Visits Achievement %** | `LEAST(achieved_visits / NULLIF(target, 0), 1.0) * 100` | Calculation in RPC | `get_governed_target_performance` | PerformancePage, ManagerReportsPage | ✅ Canonical |
| **Customers Achievement %** | `LEAST(achieved_customers / NULLIF(target, 0), 1.0) * 100` | Calculation in RPC | `get_governed_target_performance` | PerformancePage, ManagerReportsPage | ✅ Canonical |
| **Overall Achievement %** | `SUM(kpi_achievement_pct * weight / 100)` across 4 KPIs | Calculation in RPC + weights from `get_effective_weights` | `get_governed_target_performance` | PerformancePage, ManagerReportsPage | ✅ Canonical |

### 2.8 Weights

| KPI | Default Weight | Source | Used By |
|-----|:------------:|--------|---------|
| **Sales Weight** | 75% | `performance_weights_config` table (fallback to DECLARE) | `get_governed_target_performance` |
| **Visits Weight** | 7.5% | Same | Same |
| **Orders Weight** | 7.5% | Same | Same |
| **New Customers Weight** | 10% | Same | Same |

---

## 3. KPI Source Conflicts

| KPI | RPC A | RPC B | Difference |
|-----|-------|-------|-----------|
| **Sales** | `get_governed_target_performance` → effective_sales after returns | `get_completed_workdays_history` → raw sales from order_items | **Return deductions vs raw sales** |
| **New Customers** | `get_governed_target_performance` → first delivery per customer | `get_runtime_activity` (MISSING, production only) → registered customers only | **First-order vs registered — different definitions** |
| **Collection Amount** | `get_governed_target_performance` → status=collected only | `get_completed_workdays_history` → all collections | **Status filter mismatch** |
| **Target Source** | `get_governed_target_performance` → `company_monthly_targets` | Legacy RPCs → `SUM(employee_monthly_targets)` | **Company-level vs aggregate** |
| **Distance** | `get_employee_day_map` → Haversine calculation | `workday_sessions.total_distance_meters` → stored (always 0) | **Calculated vs cached (and DB cached is 0)** |
