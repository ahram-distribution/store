# Runtime Inventory — All RPCs Used by Frontend

**Date:** 2026-06-30
**Audit Scope:** All `supabase.rpc()` calls from `src/` mapped to their SQL definitions in `supabase/migrations/`

---

## 1. Legend

| Status | Meaning |
|--------|---------|
| ✅ Found | SQL definition exists in committed migration files |
| ⚠️ Rebuilt | Multiple versions exist; latest consulted |
| ❌ Missing | Called from frontend but NO definition in any migration file |

---

## 2. Runtime RPC Inventory

### 2.1 KPI / Achievement RPCs

| RPC | Status | Migration File (Latest) | Tables Queried | Internal RPC Calls | Used By |
|-----|--------|------------------------|----------------|-------------------|---------|
| `get_runtime_activity` | **❌ Missing** | None | Unknown (production only) | Unknown | `ActivityScreen.tsx`, `SalesRepActivity.tsx` |
| `get_runtime_team_activity` | **❌ Missing** | None | Unknown (production only) | Unknown | `UpperManagementDashboard.tsx`, `ActivityScreen.tsx` |
| `get_runtime_achievement_with_targets` | **❌ Missing** | None | Unknown (production only) | Unknown | `SalesRepAchievement.tsx` |
| `get_runtime_team` | **❌ Missing** | None | Unknown (production only) | Unknown | `TeamAchievement.tsx` |
| `get_governed_target_performance` | ✅ Found | `20261229_fix_company_target_source.sql` | `company_monthly_targets`, `performance_weights_config`, `orders`, `visits`, `customers`, `returns`, `return_items`, `products`, `order_items`, `employees`, `employee_monthly_targets`, `collections` | `get_visible_employee_ids`, `resolve_employee_id`, `get_effective_weights` | `ManagerReportsPage.tsx`, `PerformancePage.tsx`, `TargetsTab.tsx` |
| `get_sales_reps_effort` | ✅ Found | `20260724_sales_reps_effort_dashboard.sql` | `workday_sessions`, `orders`, `customers`, `visits`, `employee_monthly_targets`, `employees`, `employee_roles`, `roles` | `check_capability`, `get_visible_employee_ids`, `resolve_employee_id` | `SalesEffortPage.tsx` |

### 2.2 Attendance / Workday RPCs

| RPC | Status | Migration File (Latest) | Tables Queried | Internal RPC Calls | Used By |
|-----|--------|------------------------|----------------|-------------------|---------|
| `get_live_workday_overview` | ✅ Found | `20260802_phase_c_followup_schedule_type_rpcs.sql` | `employees`, `workday_sessions`, `tracking_points`, `visits`, `orders`, `collections`, `customers`, `workday_breaks`, `employee_work_policies` | `is_upper_management`, `get_subtree_ids`, `resolve_employee_id` | `attendance.ts`, `ManagerReportsPage.tsx`, `LiveMonitoringPage.tsx`, `OperationsCenterPage.tsx` |
| `get_completed_workdays_history` | ✅ Found | `20261001_f2_canonical_kpi_unification.sql` | `employees`, `workday_sessions`, `workday_breaks`, `employee_work_policies`, `orders`, `collections`, `customers`, `tracking_points`, `employee_monthly_targets` | `check_capability`, `get_subtree_ids` | `attendance.ts`, `HistoricalPerformancePanel.tsx` |
| `get_employee_workday_history` | ✅ Found | `20260802_phase_c_followup_schedule_type_rpcs.sql` | `workday_sessions`, `workday_breaks`, `orders`, `collections`, `customers`, `employee_work_policies` | `is_upper_management`, `get_visible_employee_ids`, `resolve_employee_id` | `attendance.ts`, `ManagerReportsPage.tsx`, `EmployeeWorkdayDetailPage.tsx`, `EmployeeProfilePage.tsx` |
| `get_employee_day_map` | ✅ Found | `20260727_fix_attendance_detail_rpcs.sql` | `tracking_points`, `workday_sessions` | `get_visible_employee_ids` | `attendance.ts`, `EmployeeWorkdayDetailPage.tsx` |
| `get_employee_day_timeline` | ✅ Found | `20260727_fix_attendance_detail_rpcs.sql` | `tracking_points`, `visits`, `orders`, `workday_breaks`, `workday_sessions` | `get_visible_employee_ids`, `resolve_employee_id` | `attendance.ts`, `ManagerReportsPage.tsx`, `EmployeeWorkdayDetailPage.tsx` |
| `get_attendance_analysis` | ✅ Found | Multiple | `workday_sessions`, `workday_breaks` | Unknown | `attendance.ts` |
| `get_auto_closed_sessions_today` | ✅ Found | Multiple | `workday_sessions` | None | `attendance.ts` |
| `get_auto_closed_sessions_month` | ✅ Found | Multiple | `workday_sessions` | None | `attendance.ts` |
| `get_workday_report` | ✅ Found | Multiple | `workday_sessions`, `orders`, `visits` | None | `attendance.ts` |
| `get_work_hours_ledger` | ✅ Found | Multiple | `workday_sessions`, `workday_breaks` | None | `attendance.ts`, `EmployeeWorkdayDetailPage.tsx` |
| `get_daily_target_vs_actual` | ✅ Found | Multiple | `orders`, `visits`, `customers`, `workday_sessions` | `resolve_employee_id` | `attendance.ts`, `EmployeeWorkdayDetailPage.tsx` |

### 2.3 Dashboard / Management RPCs

| RPC | Status | Migration File (Latest) | Tables Queried | Internal RPC Calls | Used By |
|-----|--------|------------------------|----------------|-------------------|---------|
| `get_dashboard_management` | ✅ Found | `20261001_f2_canonical_kpi_unification.sql` | `orders`, `customers`, `visits`, `collections`, `returns`, `employees` | `get_visible_employee_ids`, `get_kpi_orders_count`, `get_kpi_collections_pending_value` | `UpperManagementDashboard.tsx`, `AdminWorkspace.tsx`, `SuperAdminWorkspace.tsx`, `ManagementDashboard.tsx`, `ChairmanWorkspace.tsx` |
| `get_dashboard_sales` | ✅ Found | Multiple | `orders` | Unknown | `SalesDashboard.tsx` |
| `get_dashboard_transport` | ✅ Found | Multiple | `deliveries`, `delivery_tracking` | Unknown | `TransportDashboard.tsx` |
| `get_dashboard_warehouse` | ✅ Found | Multiple | `preparations`, `preparation_items` | Unknown | `WarehouseManagerWorkspace.tsx`, `WarehouseDashboard.tsx` |
| `get_credit_dashboard_stats` | ✅ Found | Multiple | `credit_accounts`, `credit_invoices` | Unknown | `SuperAdminWorkspace.tsx`, `ManagementDashboard.tsx` |
| `get_governed_dashboard_counts` | ✅ Found | Multiple | `orders`, `customers`, `employees`, `products` | Unknown | `AdminWorkspace.tsx`, `SuperAdminWorkspace.tsx` |

### 2.4 Order / Customer / Product RPCs (Governed Layer)

| RPC | Status | Source | Used By |
|-----|--------|--------|---------|
| `get_unified_order` | ✅ Found | Various | `OrderDetailPage`, `OrderEditPage`, `OrderReviewPage`, `ExecutiveOperationsWorkspace` |
| `get_unified_orders` | ✅ Found | Various | `OrdersPage`, `ApprovalQueuePage`, multiple workspaces |
| `get_governed_customers` | ✅ Found | Various | 8 pages (CRUD + storefront) |
| `get_governed_companies` | ✅ Found | Various | `CompanyManagerPage`, `ProductManagerPage`, `OrderNewPage` |
| `get_governed_products` | ✅ Found | Various | `ProductManagerPage`, `StorefrontPage`, `OrderNewPage` |
| `get_governed_employees` | ✅ Found | Various | 8 pages |
| `get_governed_visits` | ✅ Found | Various | `VisitsPage`, `VisitScreen`, `OrderNewPage` |
| `get_governed_collections` | ✅ Found | Various | `CollectionsPage`, `AccountantWorkspace` |
| `get_governed_roles` | ✅ Found | Various | `EmployeesPage`, `RolesTab`, `PermissionsTab` |
| `get_governed_tiers` | ✅ Found | Various | `TiersManagerPage`, `CompanyManagerPage` |
| `get_governed_returns` | ✅ Found | Various | `returnsService` |

### 2.5 Attendance Action RPCs

| RPC | Status | Source | Used By |
|-----|--------|--------|---------|
| `start_workday` | ✅ Found | Various | `attendance.ts`, `AttendanceRuntimePage.tsx` |
| `end_workday` | ✅ Found | Various | `attendance.ts`, `AttendanceRuntimePage.tsx` |
| `start_break` | ✅ Found | Various | `attendance.ts`, `AttendanceRuntimePage.tsx` |
| `end_break` | ✅ Found | Various | `attendance.ts`, `AttendanceRuntimePage.tsx` |
| `sync_tracking_points` | ✅ Found | Various | `trackingEngine.ts`, `attendance.ts` |
| `check_session_timeout` | ✅ Found | Various | `heartbeatService.ts` |
| `touch_session_activity` | ✅ Found | Various | `lifeSignalService.ts` |
| `record_heartbeat` | ✅ Found | Various | `heartbeatService.ts` |
| `get_my_workday_status` | ✅ Found | Various | `attendance.ts`, `AttendanceRuntimePage.tsx` |
| `get_team_map` | ✅ Found | Various | `TeamMapPage.tsx`, `MapTab.tsx` |

### 2.6 Other RPCs

| RPC | Status | Used By |
|-----|--------|---------|
| `check_capability` | ✅ Found | Multiple pages |
| `get_all_capabilities` | ✅ Found | `RolesTab`, `PermissionsTab` |
| `get_command_center` | ✅ Found | `CommandCenterPage` |
| `get_coverage_map` | ✅ Found | `CoverageMapPage` |
| `get_company_profile` / `get_public_company_profile` | ✅ Found | Storefront components |
| `get_employee_activity` | ✅ Found | `EmployeeProfilePage` |
| `get_employee_capabilities` | ✅ Found | `PermissionsTab` |
| `get_governed_executive_kpis` | ✅ Found | `ExecutiveOperationsWorkspace` |
| `get_governed_executive_queue` | ✅ Found | `ExecutiveOperationsWorkspace` |
| `get_governed_preparation_queue` | ✅ Found | `WarehousePage`, `WarehouseReviewPage` |
| `list_employees_without_policies` | ✅ Found | `EmployeeManagementPage`, `AttendanceSettingsPage` |
| `list_work_policies` | ✅ Found | `EmployeeManagementPage`, `AttendanceSettingsPage` |
| `unified_search` | ✅ Found | `unifiedSearch.ts` |
| `batch_upsert_work_policies` | ✅ Found | `AttendanceSettingsPage` |
| `update_workday_settings` | ✅ Found | `AttendanceSettingsPage` |

---

## 3. Key Findings

### 3.1 Missing Definitions (❌)

The following RPCs are called from the frontend but have **zero definitions in any migration file**:

| RPC | Frontend Callers | Notes |
|-----|----------------|-------|
| `get_runtime_activity` | `ActivityScreen.tsx:82,128`, `SalesRepActivity.tsx:64` | Exists only in production DB |
| `get_runtime_team_activity` | `UpperManagementDashboard.tsx:52`, `ActivityScreen.tsx:89,100` | Exists only in production DB |
| `get_runtime_achievement_with_targets` | `SalesRepAchievement.tsx:108` | Exists only in production DB |
| `get_runtime_team` | `TeamAchievement.tsx:30` | Exists only in production DB |

**Impact:** These 4 RPCs are the core of `/dashboard/activity-target` and its related screens. Without their definitions in migrations, the entire Runtime Layer cannot be verified from source code alone.

### 3.2 RPCs with Canonicity (✅ Fully Documented)

The following RPCs have complete, verified definitions:

- `get_governed_target_performance` — Target hierarchy + achievement (20261229)
- `get_completed_workdays_history` — Historical activity with prorated targets (20261001)
- `get_live_workday_overview` — Real-time workday overview (20260802)
- `get_employee_workday_history` — Per-employee session history (20260802)
- `get_sales_reps_effort` — Sales effort dashboard (20260724)
- `get_dashboard_management` — Upper management KPIs (20261001)

### 3.3 Multi-Definition RPCs (⚠️ Rebuilt Many Times)

These RPCs are defined in 5+ migration files, indicating iterative fixes without cleanup:

| RPC | # Definitions | First File | Last File |
|-----|:----------:|-----------|----------|
| `get_live_workday_overview` | 13 | `20260610_attendance_module.sql` | `20260802_phase_c_followup_schedule_type_rpcs.sql` |
| `get_employee_workday_history` | 10 | `20260610_attendance_module.sql` | `20260802_phase_c_followup_schedule_type_rpcs.sql` |
| `get_completed_workdays_history` | 5 | `20260726_get_completed_workdays_history.sql` | `20261001_f2_canonical_kpi_unification.sql` |
| `get_governed_target_performance` | 8 | `20260612_monthly_targets_system.sql` | `20261229_fix_company_target_source.sql` |

---

## 4. Dependency Graph — Key KPI RPCs

```
get_governed_target_performance (SOT — Targets/Achievement)
├── get_visible_employee_ids(p_token)
├── resolve_employee_id(uuid)
├── get_effective_weights(uuid, int, int)
├── Tables: company_monthly_targets, performance_weights_config,
│           orders, order_items, visits, customers, returns,
│           return_items, products, employees,
│           employee_monthly_targets, collections
└── Output: company + employees + hierarchy + KPI arrays

get_completed_workdays_history (SOT — Activity/History)
├── check_capability(p_token, text)
├── get_subtree_ids(uuid)
├── Tables: employees, workday_sessions, workday_breaks,
│           employee_work_policies, orders, collections,
│           customers, tracking_points, employee_monthly_targets
└── Output: paginated employees + sessions + totals

get_live_workday_overview (SOT — Live Monitoring)
├── is_upper_management(uuid)
├── get_subtree_ids(uuid)
├── resolve_employee_id(uuid)
├── Tables: employees, workday_sessions, tracking_points,
│           visits, orders, collections, customers,
│           workday_breaks, employee_work_policies
└── Output: live stats + employee activity cards

get_sales_reps_effort (Sales Effort Dashboard)
├── check_capability(p_token, text)
├── get_visible_employee_ids(p_token)
├── resolve_employee_id(uuid)
├── Tables: workday_sessions, orders, customers, visits,
│           employee_monthly_targets, employees
└── Output: effort scores + rankings
```
