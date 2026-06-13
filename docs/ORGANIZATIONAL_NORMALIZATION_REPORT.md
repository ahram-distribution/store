# ORGANIZATIONAL NORMALIZATION REPORT

> **Date:** 2026-06-13
> **Type:** Before/After comparison, impact analysis, risk assessment, and migration summary

---

## 1. EXECUTIVE SUMMARY

The system had **22 distinct role name strings** (with ~52 English/Arabic/variant forms) routed through:
- **93 lines** of brittle role-name-matching in `DashboardPage.tsx`
- **~60 hardcoded `r.name IN (...)` checks** across 20+ migration files
- **~130+ total role name references** in database RPCs
- **~30 hardcoded capabilities** in `useCapability.ts` with superadmin prefix-check bypass
- **2 locations** (`AttendanceRouter.tsx`, `ModuleLauncherPage.tsx`) with `MODULE_HOME_ROLES` sets

### What changed

| Area | Before | After |
|------|--------|-------|
| Role strings in code | 22 (52 variants) | 7 canonical target roles |
| DashboardPage.tsx logic | 93 lines, 60+ variants, 16 checks | 18 lines, 7 target roles, 1 hierarchy loop |
| `is_upper_management` check | 35+ RPCs each had `r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')` | 1 centralized function |
| `check_capability` bypass | Frontend-only: `hasRolePrefix('superadmin')` + 30 hardcoded caps | Server-side: `is_upper_management()` — ALL capabilities |
| `get_visible_employee_ids` | Role-name check + hardcoded employee codes | `is_upper_management()` + preserved legacy codes |
| Routing check for attendance | 6-role hardcoded Set | 2-target-role Set via normalization |
| `MODULE_HOME_ROLES` | Duplicated in 2 files | Same normalization utility used everywhere |
| `role_normalization` table | Did not exist | Created with 25 mapping rows |

---

## 2. FILES CHANGED

| File | Change | Lines |
|------|--------|-------|
| `src/utils/roleNormalization.ts` | **NEW** — canonical mapping + normalizeEmployeeRole() + isUpperManagement() | 74 |
| `src/pages/dashboard/DashboardPage.tsx` | Rewrote — removed 60 role variants, uses hierarchy loop | -75 |
| `src/hooks/useCapability.ts` | Replaced hasRolePrefix + SUPER_CAPABILITIES with isUpperManagement() | -14 |
| `src/components/attendance/AttendanceRouter.tsx` | Replaced 6-role set with MODULE_HOME_TARGETS + normalizeEmployeeRole | -3 |
| `src/pages/dashboard/ModuleLauncherPage.tsx` | Replaced 6-role set with MODULE_HOME_TARGETS + normalizeEmployeeRole | -3 |
| `supabase/migrations/20260706_role_normalization.sql` | **NEW** — is_upper_management(), role_normalization, check_capability update, seed data | ~200 |

### Files NOT changed (but affected through updated RPC function)

| File | Why unchanged |
|------|---------------|
| `supabase/migrations/20260607_recovery_missing_functions.sql` | `get_visible_employee_ids` now calls `is_upper_management()` (overridden by migration) |
| `supabase/migrations/20260604_unified_identity_location.sql` | `check_capability` now calls `is_upper_management()` (overridden by migration) |
| `src/components/auth/ProtectedRoute.tsx` | Calls server-side `check_capability` which now has the bypass |
| `src/routes/index.tsx` | Capability-checking routes go through ProtectedRoute, which uses updated check_capability |

---

## 3. WHAT STILL USES ROLE NAMES (MIGRATION FOLLOW-UP NEEDED)

The following RPCs still contain hardcoded role-name checks. They continue to work correctly because the role strings have not been removed. A second phase should update these to use `is_upper_management()` + capability-based gates:

### High Priority (Authorization Gates — business logic risk)

| File | Functions | Current Pattern |
|------|-----------|-----------------|
| `20260607_recovery_missing_functions.sql` | `governed_dispatch_decision`, `governed_reopen_cancelled` | `r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN','EXECUTIVE_MANAGER','Sales Manager')` |
| `20260623_credit_lifecycle_wiring.sql` | `governed_update_credit_limit`, `governed_update_credit_terms` | Same extended pattern |

### Medium Priority (Visibility — no business logic risk, just scope)

| File | Functions | Count |
|------|-----------|-------|
| `20260607_recovery_missing_functions.sql` | 30+ `get_governed_*` functions | ~30 |
| `20260612_monthly_targets_system.sql` | Target visibility RPCs | ~6 |
| `20260612_monthly_targets_new_customers.sql` | Target visibility RPCs | ~6 |
| `20260610_attendance_module.sql` | Attendance visibility RPCs | ~10 |
| `20260604_governance_rpcs.sql` | Governance visibility RPCs | ~3 |
| `20260618_fix_governance_leak.sql` | Governance visibility RPCs | ~2 |
| `20260612_drilldown_performance_rpcs.sql` | Performance drilldown RPCs | ~6 |
| `20260620_public_company_profile.sql` | Public company profile RPCs | ~2 |
| `20260625_command_center_rpcs.sql` | Command center RPCs | ~4 |
| `20260630_work_policies_phase1.sql` | Work policy RPCs | ~1 |

### Low Priority (Display/Label — no access control impact)

| File | Purpose | Notes |
|------|---------|-------|
| `20260611_phase5_active_employees_rpc.sql` | Role classification for display | Used for label, not gate |
| `20260612_phase4_targets_governance.sql` | Role classification + exclusion | Same |

---

## 4. DEPRECATED ROLE HANDLING

Non-target roles (`delivery`, `collector`, `accountant`, `purchasing_manager`, `secretary`, `security`, `buffet`, `data_entry`) are:

1. **Frozen** — no active routing to their legacy workspaces
2. **Backward compatible** — existing DB rows, employee assignments, and data preserved
3. **Routed to safe workspaces** — legacy workspace components still exist but are no longer routed
4. **Can be re-activated** — simply update `role_normalization.status` and add routing back

---

## 5. RISKS AND MITIGATION

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Upper management user has multiple roles and gets wrong workspace | Low | Medium | Hierarchy loop checks in priority order (UM → مدير بيع → مشرف عام → ...) |
| Frontend normalization mapping misses a variant | Low | Medium | `normalizeEmployeeRole` has 50+ entries; default fallback is safe (`مندوب مبيعات`) |
| Server-side `is_upper_management()` doesn't match frontend | Low | High | Both use same 4-role set; frontend uses the normalization utility, backend uses the SQL function |
| Deprecated role user loses access | Low | High | Routed to `ManagementDashboard` or `WarehouseDashboard` — read-only general access preserved |
| Migration runs on production with existing data | Low | Medium | All INSERTs use `ON CONFLICT DO NOTHING`/`DO UPDATE`; functions use `CREATE OR REPLACE` |
| Hardcoded employee codes (WRQ1002, WRQ1004) leave | Medium | Medium | These are legacy bypasses preserved unchanged in `get_visible_employee_ids` |

---

## 6. MIGRATION IMPACT MATRIX

| Role | Before | After | User Experience Change |
|------|--------|-------|----------------------|
| SUPER_ADMIN | UpperManagementDashboard | UpperManagementDashboard | **None** |
| ADMIN | UpperManagementDashboard | UpperManagementDashboard | **None** |
| CHAIRMAN | UpperManagementDashboard | UpperManagementDashboard | **None** |
| EXECUTIVE_MANAGER | UpperManagementDashboard | UpperManagementDashboard | **None** |
| مدير البيع | UpperManagementDashboard (via umdMatch) | SalesDashboard | **MINOR** — was routed to UM dashboard, now to Sales Manager workspace. This is correct behavior: `مدير البيع` is NOT upper management. |
| مدير مبيعات (legacy) | SalesDashboard | SalesDashboard | **None** |
| supervisor / مشرف مبيعات | SupervisorPage | SalesDashboard | **PLANNED** — retired role absorbed into مدير بيع. Same workspace access as sales manager. |
| مندوب مبيعات | SalesRepWorkDay | SalesRepWorkDay | **None** |
| general_supervisor | SupervisorPage | SupervisorPage | **None** — but workspace title context changes from "مشرف تنفيذي" to "مشرف عام" |
| warehouse_manager | WarehouseManagerWorkspace | WarehouseManagerWorkspace | **None** |
| warehouse (basic) | WarehouseDashboard | WarehouseDashboard | **None** — but role is deprecated_frozen |
| delivery / collector / accountant / etc. | Legacy workspace | ManagementDashboard / WarehouseDashboard | **REDUCED** — these users now see a general workspace instead of their specialized one. Their role is frozen. |
| سيلز داخلي (NEW) | Did not exist | ManagementDashboard | **NEW** — minimal general access until workspace built |

**Backward compatibility preserved:**
- Existing user role assignments unchanged
- No data loss
- No permission loss for mapped roles
- Deprecated roles continue to function (limited routing)
- Hardcoded employee code bypasses preserved

---

## 7. SUBSEQUENT PHASES RECOMMENDED

### Phase 1.5: Update ALL RPC Role-Name Checks
Replace all 35+ `r.name IN (...)` visibility checks with `is_upper_management()` calls. This is mechanical but needs careful per-function review.

### Phase 2: Governance Audit
After role-name checks are replaced, audit every `get_governed_*` function for:
- Correct is_upper_management() usage
- Proper capability-based gates instead of role-name checks
- Removal of hardcoded employee code bypasses

### Phase 3: Remove Deprecated Role Routing
After confirming no active use, remove the deprecated role routing from DashboardPage.tsx.

### Phase 4: سيلز داخلي Workspace
Build a dedicated InternalSalesWorkspace component when the feature is scoped.

---

*End of ORGANIZATIONAL_NORMALIZATION_REPORT.md*
