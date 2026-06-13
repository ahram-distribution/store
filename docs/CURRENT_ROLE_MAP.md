# CURRENT ROLE MAP

> **Date:** 2026-06-13
> **Type:** Complete census of every role name, variant, and usage location in the system
> **Scope:** Database roles table, migrations, frontend routing, dashboards, RPC checks, UI labels

---

## 1. ROLES TABLE — Seed Data

The `public.roles` table contains roles as data (not hardcoded). Two source migrations:

### `20260615_identity_rules_final.sql`

| Role Name | Description | is_system |
|-----------|-------------|-----------|
| `SUPER_ADMIN` | Super Admin - full system access | true |
| `سوبر أدمن` | سوبر أدمن - مشرف كامل | true |

### `20260611_phase2_sales_hierarchy_cleanup.sql`

| Role Name | Description | is_system |
|-----------|-------------|-----------|
| `مدير البيع` | مدير البيع - Sales Manager | true |

### Not explicitly seeded but referenced in capability assignments:
- `رئيس مجلس الإدارة` (Chairman)
- `أدمن` (Admin)
- `مدير تنفيذي` (Executive Manager)
- `مدير مبيعات` (Sales Manager — legacy, replaced by مدير البيع)
- `مشرف مبيعات` (Sales Supervisor)
- `مشرف تنفيذي` (Executive Supervisor)
- `مندوب مبيعات` (Sales Rep)
- `مشرف` (Supervisor — generic)

---

## 2. ALL ROLE STRINGS IN THE SYSTEM

### 2.1 Identity Roles (not stored in roles table)

| Role String | Source | Used In | Type |
|-------------|--------|---------|------|
| `employee` | auth store, ProtectedRoute | `identity_type` filter/redirect | Identity type |
| `customer` | auth store, ProtectedRoute, all services | `identity_type` filter/redirect | Identity type |

### 2.2 Employee Roles (from DB + code)

| # | Role Name (EN) | Arabic Variant(s) | Other Variants | Usage Count (approx) |
|---|---------------|-------------------|----------------|---------------------|
| 1 | `SUPER_ADMIN` | `سوبر أدمن`, `سوبرادمن` | `superadmin`, `super_admin` | ~40 (11 migration files, DashboardPage, useCapability, attendance) |
| 2 | `ADMIN` | `أدمن`, `ادمن` | `admin`, `administrator` | ~35 (10 migration files, DashboardPage) |
| 3 | `CHAIRMAN` | `رئيس مجلس الإدارة`, `رئيس مجلس الادارة` | `chairman` | ~30 (10 migration files, DashboardPage) |
| 4 | `EXECUTIVE_MANAGER` | `مدير تنفيذي`, `المدير التنفيذي` | `executive_director`, `executive`, `executive_manager` | ~15 (5 migration files, DashboardPage) |
| 5 | `Sales Manager` | `مدير البيع`, `مدير مبيعات` | `sales_manager`, `salesmanager`, `sales_director`, `salesdirector`, `sales` | ~20 (6 migration files, DashboardPage) |
| 6 | `مشرف مبيعات` | `supervisor` | `supervisor` (EN) | ~10 (3 migration files, DashboardPage) |
| 7 | `مشرف تنفيذي` | `general_supervisor`, `generalsupervisor` | — | ~8 (3 migration files, DashboardPage) |
| 8 | `مندوب مبيعات` | `sales_rep`, `salesrep`, `مندوب` | — | ~6 (DashboardPage, RolesTab, order-display) |
| 9 | `warehouse_manager` | `مدير مستودع`, `warehousemanager` | — | ~3 (DashboardPage) |
| 10 | `warehouse` | `مستودع` | — | ~3 (DashboardPage) |
| 11 | `delivery` | `توصيل` | `transport`, `مدير نقل` | ~4 (DashboardPage, command_center seed) |
| 12 | `collector` | `محصل` | — | ~2 (DashboardPage) |
| 13 | `accountant` | `محاسب` | — | ~2 (DashboardPage) |
| 14 | `purchasing_manager` | `مدير مشتريات` | `purchasingmanager` | ~3 (DashboardPage) |
| 15 | `secretary` | `سكرتير` | `receptionist` | ~3 (DashboardPage) |
| 16 | `security` | `أمن`, `امن` | — | ~3 (DashboardPage) |
| 17 | `buffet` | `بوفيه` | `cafeteria`, `kitchen` | ~4 (DashboardPage) |
| 18 | `data_entry` | `مدخل بيانات` | `dataentry` | ~3 (DashboardPage) |
| 19 | `سوبر فايزر` | — | — | ~5 (RolesTab, EmployeeAnalysisPage) |
| 20 | `مدير تنفيذي` (as distinct) | — | — | ~5 (attendance RPCs) |
| 21 | `مندوب` | — | — | ~2 (quick links only) |
| 22 | `سكرتارية` | — | — | ~1 (SecretaryWorkspace title only) |

**Total distinct role strings:** ~22 with ~52 English/Arabic variants across the system.

---

## 3. WHERE ROLE NAMES ARE USED

### 3.1 Database Migrations (32 files, ~130+ role name references)

| Pattern | Count | Severity | Example |
|---------|-------|----------|---------|
| `r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')` — English trilogy | ~60 | CRITICAL | 20+ `get_governed_*` functions, visibility bypass |
| `r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')` — Arabic trilogy | ~40 | CRITICAL | All target/dashboard/attendance RPCs |
| `r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN','EXECUTIVE_MANAGER','Sales Manager')` | ~5 | HIGH | `governed_dispatch_decision`, `governed_reopen_cancelled` |
| `r.name IN ('مدير البيع', 'مدير تنفيذي')` — classification | ~4 | MEDIUM | `get_governed_active_employees`, `get_kpi_contributors` |
| `r.name IN ('مشرف مبيعات', 'مشرف تنفيذي')` — classification | ~4 | MEDIUM | Same as above |
| `r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة')` — exclusion | ~4 | MEDIUM | Filter out upper management from employee/performance lists |
| Seed data inserts | ~5 | LOW | Finding admin for test data creation |

**Key migration files containing hardcoded role checks:**

| File | Count | Dominant Pattern |
|------|-------|-----------------|
| `20260607_recovery_missing_functions.sql` | ~50 | English trilogy (`'SUPER_ADMIN','CHAIRMAN','ADMIN'`) |
| `20260612_monthly_targets_system.sql` | ~6 | Arabic trilogy (`'سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن'`) |
| `20260612_monthly_targets_new_customers.sql` | ~6 | Arabic trilogy |
| `20260610_attendance_module.sql` | ~10 | Arabic trilogy + extended |
| `20260604_governance_rpcs.sql` | ~3 | English trilogy |
| `20260618_fix_governance_leak.sql` | ~2 | English trilogy |
| `20260610_fix_order_status_history_check.sql` | ~2 | Extended English (`'...','EXECUTIVE_MANAGER','Sales Manager'`) |
| `20260623_credit_lifecycle_wiring.sql` | ~1 | Same extended |
| `20260612_drilldown_performance_rpcs.sql` | ~6 | Mixed: classification + gating |
| `20260611_phase5_active_employees_rpc.sql` | ~3 | Arabic classification + exclusion |
| `20260625_command_center_rpcs.sql` | ~4 | Arabic trilogy |
| `20260607_upper_management_dashboard_rpc.sql` | ~1 | Arabic trilogy |
| `20260610_command_center_v2_design.sql` | ~1 | Arabic trilogy |
| `20260630_work_policies_phase1.sql` | ~1 | Arabic trilogy |
| `20260612_phase4_targets_governance.sql` | ~3 | Arabic classification + exclusion |
| `20260615_identity_rules_final.sql` | ~7 | English + Arabic + triple variant |
| Seed files (3) | ~5 | English trilogy (seed data, acceptable) |

### 3.2 Frontend — Routing & Navigation

| File | Role References | Purpose |
|------|----------------|---------|
| `DashboardPage.tsx:43-69` | ~60 role string variants (22 EN + 26 AR after normalization) | Routes employees to workspace components |
| `AttendanceRouter.tsx:5-12` | 6 roles: `مدير البيع`, `مدير تنفيذي`, `سوبر أدمن`, `رئيس مجلس الإدارة`, `أدمن`, `SUPER_ADMIN` | MODULE_HOME_ROLES — determines attendance access |
| `ModuleLauncherPage.tsx:5-12` | Same 6 as above | Full attendance launcher access |

### 3.3 Frontend — Role Management UI

| File | Role References | Purpose |
|------|----------------|---------|
| `RolesTab.tsx:10-12` | `'سوبر أدمن'`, `'مدير البيع'`, `'سوبر فايزر'` | ROLE_TEMPLATES for capability presets |
| `RolesTab.tsx:150-153` | 9 Arabic role names in group filters | UI grouping: system/management/sales/other |
| `RolesTab.tsx:200` | `'سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن'` | `isSystem` check — non-deletable roles |

### 3.4 Frontend — Capability Checks

| File | Role References | Purpose |
|------|----------------|---------|
| `useCapability.ts:49` | `'superadmin'` | `hasRolePrefix('superadmin')` — auto-grants SUPER_CAPABILITIES (hardcoded ~30 cap set) |
| `useCapability.ts:16-17` | All roles via `normalizeRole(r)` | Normalizes all user roles for prefix matching |

### 3.5 Frontend — Display Labels

| File | Role References | Purpose |
|------|----------------|---------|
| Workspace titles (18 files) | ~18 display strings (e.g., `'لوحة السوبر أدمن'`, `'المبيعات'`) | Workspace header labels |
| `EmployeeAnalysisPage.tsx:382-384` | `'مدير مبيعات'`, `'سوبر فايزر'` | Badge color classes for role_type |
| `OrderDetailView.tsx:40,218` | `'مندوب مبيعات'` | Creator type label |
| `order-display.ts:157` | `'مندوب مبيعات'` | creatorType enum |

### 3.6 Frontend — Quick Links

| File | Role References | Purpose |
|------|----------------|---------|
| `ModuleLauncherPage.tsx:53` | `'مندوب'` | Employee filter link |
| `ModuleLauncherPage.tsx:54` | `'مشرف'` | Employee filter link |
| `UpperManagementDashboard.tsx:108` | `'مندوب'` | Employee filter link |
| `UpperManagementDashboard.tsx:109` | `'مشرف'` | Employee filter link |

---

## 4. ROLE-NAME-BASED BUSINESS LOGIC IN RPCs

### Pattern 1: Visibility Bypass (~35 functions)
**Logic:** If user has `SUPER_ADMIN`/`CHAIRMAN`/`ADMIN` role → return ALL records. Otherwise → scope to subtree + hardcoded WRQ exceptions.

**Affected functions:** `get_governed_*`, `get_visible_employee_ids`, `get_visible_customer_ids`, `get_dashboard_*`, `get_collection_followup_queue`, `get_credit_dashboard_stats`, and ~25 more.

**Risk:** Brittle — adding a new upper management role requires updating every function.

### Pattern 2: Authorization Gate (~8 functions)
**Logic:** If user has certain role names → allow operation. Otherwise → deny.

**Affected functions:** `governed_dispatch_decision`, `governed_reopen_cancelled`, `governed_update_*` (credit).

**Risk:** Same as above — hardcoded role strings can't be extended without migration updates.

### Pattern 3: Role Classification (~4 functions)
**Logic:** Determine if user is manager/supervisor/rep based on role name for UI display purposes.

**Affected functions:** `get_governed_active_employees`, `get_kpi_contributors`.

**Risk:** Low — these are for display/labeling only. But still fragile.

### Pattern 4: Hardcoded Employee Code Bypass (~25 functions)
**Logic:** Alongside role checks, hardcoded employee codes (`WRQ1002`, `WRQ1004`) bypass visibility scope.

**Affected functions:** Same ~25 `get_governed_*` functions in `20260607_recovery_missing_functions.sql`.

**Risk:** HIGH — if employees with these codes leave or change roles, visibility breaks.

---

## 5. LEGACY RETIRED ROLES

| Role | Status | Replacement | Evidence |
|------|--------|-------------|----------|
| `supervisor` / `مشرف مبيعات` | LEGACY — exists in code | `مدير بيع` (Sales Manager) | Owner-defined in 2026-06-10. Still in DashboardPage:68, RolesTab:151, RPCs. |
| `مدير مبيعات` | LEGACY — replaced by migration | `مدير البيع` | `20260611_phase2_sales_hierarchy_cleanup.sql:69` explicitly renames. |
| `مدير تنفيذي` | LEGACY — maps to UM | `الإدارة العليا` | Owner unification. Still in DashboardPage, attendance RPCs, classification RPCs. |
| `سوبر فايزر` | LEGACY — non-standard name | `مدير البيع` | Only in RolesTab.tsx and EmployeeAnalysisPage.tsx. |
| `مندوب` | LEGACY — abbreviation | `مندوب مبيعات` | Only in quick links (ModuleLauncherPage, UpperManagementDashboard). |

---

## 6. MISSING TARGET ROLES

| Owner-Defined Role | Exists in System? | Gap |
|--------------------|-------------------|-----|
| `الإدارة العليا` (Upper Management) | **Unified concept missing** | No single role; 4+ separate role strings instead |
| `مدير بيع` (Sales Manager) | ✅ **Exists** | Created by `20260611_phase2_sales_hierarchy_cleanup.sql` |
| `مندوب مبيعات` (Sales Rep) | ✅ **Exists** | Used in DashboardPage routing |
| `مدير مخزن` (Warehouse Manager) | ✅ **Exists** | `warehousemanager` variant used |
| `مشرف عام` (General Supervisor) | ✅ **Exists** | `general_supervisor`, `generalsupervisor`, `مشرف تنفيذي` |
| `سيلز داخلي` (Internal Sales) | ❌ **Does not exist** | No role string, no routing, no workspace |
| `عميل` (Customer) | ✅ **Exists** | Handled as `identity_type = 'customer'` |

---

*End of CURRENT_ROLE_MAP.md*
