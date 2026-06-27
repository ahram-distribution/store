# SYSTEM INVESTIGATION REPORT

> **Phase**: P0 — Read-Only Full System Investigation  
> **Date**: 2026-10-03  
> **Scope**: Database Contracts, RPC Contracts, Permissions, Runtime, Frontend, Regression  
> **Status**: IN PROGRESS (Database Contracts — Complete, RPC Contracts — In Progress)

---

## SECTION 1: DATABASE CONTRACTS

### 1.1 Overview

- **Total SQL files analyzed**: 141 (`supabase/migrations/*.sql`)
- **Total FUNCTION definitions**: 657
- **Total GRANT EXECUTE statements**: 172 (across all files)
- **Total CREATE POLICY statements**: 18
- **Total Trigger definitions**: 1
- **Total View definitions**: 0
- **Active schemas**: `public` (primary), `app` (sessions only), `extensions` (in search_path)

### 1.2 CRITICAL: Ambiguous Function Overloads (PGRST202 Risk)

PostgREST cannot resolve which overload to call when two functions with the same name exist with compatible parameter types. This causes HTTP 400 errors at runtime.

#### 1.2.1 `get_visible_employee_ids`

| Overload | File | Line |
|----------|------|------|
| `get_visible_employee_ids(p_token uuid)` | `20260720_unify_upper_management_role.sql` | 112 |
| `get_visible_employee_ids(p_token text)` | `20260626_fix_remaining_p_token_text.sql` | 11 |

**Risk**: PostgREST will reject calls due to ambiguity. `p_token uuid` can be cast to `text`, making the overloads indistinguishable to the REST layer.
**Evidence**: `_pre_drop_functions.sql` line 11 drops `get_visible_employee_ids(uuid)`, but later UUID version is recreated while text version survives.

#### 1.2.2 `check_capability`

| Overload | File | Line |
|----------|------|------|
| `check_capability(p_token uuid, p_code text)` | `20260706_role_normalization.sql` | 136 |
| `check_capability(p_token text, p_code text)` | `20260625_fix_check_capability_overload.sql` | 15 |

**Risk**: Direct PGRST202 ambiguity — both `(uuid, text)` and `(text, text)` are valid PostgREST signatures.
**Evidence**: `20260626_restore_check_capability_uuid_wrapper.sql` confirms the team attempted to standardize on `text` version, but the UUID version persists from later migrations.

#### 1.2.3 `get_live_workday_overview`

| Overload | File | Line |
|----------|------|------|
| `get_live_workday_overview(p_token uuid)` | `20260802_phase_c_followup_schedule_type_rpcs.sql` | 362 |
| `get_live_workday_overview(p_token text)` | `20260626_fix_remaining_p_token_text.sql` | 193 |

**Risk**: Same PGRST202 ambiguity. Text version never dropped.
**Evidence**: 12 definitions found; last UUID version in Aug 2026, text version from Jun 2026 survives.

#### 1.2.4 `get_dashboard_management`

| Overload | File | Line |
|----------|------|------|
| `get_dashboard_management(p_token uuid)` | `20261001_f2_canonical_kpi_unification.sql` | 802 |
| `get_dashboard_management(p_token text)` | `20260626_unify_p_token_text_contract.sql` | 284 |

**Risk**: PGRST202 ambiguity. Latest KPI unification uses `uuid`, but text version from Jun 2026 survives.

#### 1.2.5 Functions Requiring Parameter Signature Verification

The following functions have multiple definitions and may have incompatible parameter types:

- `governed_create_order` — 13 definitions (Jun–Sep 2026), needs param type audit
- `governed_approve_order` — 6 definitions, last in Jul 2026
- `governed_dispatch_order` — 7 definitions, last in Aug 2026
- `governed_cancel_order` — 3 definitions, last Jun 2026
- `get_unified_order` — 6 definitions, last Jul 2026
- `get_unified_orders` — 3 definitions, last Jul 2026
- `governed_change_order_status` — multiple definitions with both `text` and `uuid` p_token
- `get_governed_orders` — ambiguous due to multiple redefinitions
- `calculate_net_work_hours` — explicitly dropped and recreated with different return type
- `get_workday_settings`, `update_workday_settings`, `get_employee_day_timeline` — in `_pre_drop_functions.sql`

### 1.3 CRITICAL: p_token TEXT → UUID Pendulum

The system underwent a forced migration from `p_token uuid` → `p_token text` in June 2026 (files 20260625–20260627), then later migrations (July–October 2026) silently reverted to `p_token uuid`.

| Migration | Direction |
|-----------|-----------|
| `20260625_fix_check_capability_overload.sql` | uuid → text |
| `20260626_fix_remaining_p_token_text.sql` | uuid → text |
| `20260626_unify_p_token_text_contract.sql` | uuid → text |
| `20260626_restore_check_capability_uuid_wrapper.sql` | (creates wrapper with uuid) |
| `20260706_role_normalization.sql` | text → uuid (silent revert) |
| `20260720_unify_upper_management_role.sql` | text → uuid (silent revert) |
| `20261001_f2_canonical_kpi_unification.sql` | text → uuid (silent revert) |
| `20261002_fix_work_hours_ledger_contract.sql` | uuid (new functions) |
| `20261003_b12_include_all_active_employees.sql` | uuid (new functions) |

**Impact**: Functions with `p_token text` that were NOT recreated with `uuid` remain as overloads. Functions that call each other may pass `uuid` where `text` is expected — this works due to implicit cast, but PostgREST routing becomes unpredictable.

### 1.4 HIGH: Missing GRANT EXECUTE on Recreated Functions

When `_pre_drop_functions.sql` drops a function and later migrations recreate it with `CREATE OR REPLACE`, the function loses its `GRANT EXECUTE` privilege. The recreating migration must re-apply the GRANT.

#### Confirmed missing GRANT EXECUTE:

| Function | Dropped in `_pre_drop_functions.sql` | Has GRANT in recreation? |
|----------|---------------------------------------|--------------------------|
| `get_governed_target_performance` | Line 81 (dropped) | ❌ No GRANT in `20261003_b12_include_all_active_employees.sql` |
| `get_dashboard_management` | Line 18 (dropped) | ❌ No GRANT in `20261001_f2_canonical_kpi_unification.sql` |
| `get_dashboard_management` | — | ❌ No GRANT in `20260720_unify_upper_management_role.sql` |
| `get_dashboard_transport` | Line 19 (dropped) | ❌ No GRANT in recreation |
| `get_dashboard_warehouse` | Line 20 (dropped) | ❌ No GRANT in recreation |
| `get_dashboard_sales` | Line 24 (dropped) | ❌ May lack GRANT |
| `get_upper_management_dashboard` | Line 17 (dropped) | ❌ No GRANT (also line 82 drops again) |
| `get_workday_settings` | Line 91 (dropped) | ❌ Needs verification |
| `update_workday_settings` | Line 92 (dropped) | ❌ Needs verification |
| `get_workday_cleanup_log` | Line 93 (dropped) | ❌ Needs verification |
| `get_employee_day_timeline` | Line 94 (dropped) | ❌ Needs verification |
| `get_visible_employee_ids` | Line 11 (dropped) | ❌ No GRANT in recreation files |

**Note**: `20260708_governed_rpc_execute_grants.sql` applied blanket `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated` which mitigates this for functions that existed at that time. However:
- Functions recreated AFTER Jul 8, 2026 may not be covered (the blanket GRANT ran once)
- Dropped and recreated functions need explicit re-grant; the blanket GRANT doesn't cover future recreations

### 1.5 HIGH: Blanket GRANT Security Risk

`20260708_governed_rpc_execute_grants.sql` line 16:
```sql
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
```

This grants EXECUTE on **every** public schema function, including:
- Internal helper functions not meant for REST API
- Test/debug functions still in the database

**Functions exposed by this blanket GRANT that should NOT be REST-accessible:**

| Function | Reason |
|----------|--------|
| `test_func`, `test_ping2`, `test_ping3`, `test_rpc`, `test_setof`, `multiline_test`, `ping` | Debug/test functions |
| `is_upper_management(uuid)` | Internal check, should not be direct RPC |
| `insert_gps_test_point` | Test-only function |
| `seed_sales_rep_monthly_targets` | Seed/data management function |
| `calculate_net_work_hours` | Internal helper |

### 1.6 MEDIUM: GRANT to `anon` Instead of `authenticated`

Several functions are granted to the `anon` role, making them accessible without authentication:

| Function | File | Risk |
|----------|------|------|
| `get_governed_active_employees` | `20260611_phase5_active_employees_rpc.sql` | Anon can list active employees |
| `get_live_workday_overview` | Multiple files (e.g., `20260611_phase5_attendance_v2.sql`) | Anon can view live workday data |
| `get_team_map` | `20260611_phase5_attendance_v2.sql` | Anon can view team locations |
| `get_workday_report` | `20260611_phase5_attendance_v2.sql` | Anon can view workday reports |
| `governed_create_role` | `20260611_phase5_role_management.sql` | Anon can create roles |
| `governed_update_role` | Same file | Anon can update roles |
| `governed_delete_role` | Same file | Anon can delete roles |
| `governed_update_role_capabilities` | Same file | Anon can modify capabilities |
| `get_role_capabilities` | Same file | Anon can view all capabilities |
| `get_employee_workday_history` | `20260616_phase7_work_hours_analytics.sql` | Anon can view work history |
| `get_coverage_map` | `20260617_get_coverage_map.sql` | Anon can view coverage |
| `get_public_company_profile()` | `20260620_public_company_profile.sql` | Anon — may be intentional |
| `get_daily_target_vs_actual` | `20260705_create_daily_target_vs_actual.sql` | Anon can view targets |
| `get_employee_day_map` | `20260701_fix_gps_distance_drift.sql` | Anon can view GPS-based day maps |
| `get_alerts` | `20260719_fix_attendance_rpc_scoping.sql` | Anon can view alerts |
| `get_employee_detail` | `20260611_phase6_attendance_v2_complete.sql` | Anon can view employee details |

**Note**: Some of these may be intentional for the PWA (Progressive Web App) which uses `anon` key for initial auth before session creation. However, functions like role management granted to `anon` are high-risk.

### 1.7 MEDIUM: RLS Policy Coverage Gap

Only **18 policies** exist across all tables. With ~30+ tables in the database, many tables lack RLS protection:

**Tables with policies:**
- `companies` — 1 policy (publicly readable)
- `orders`, `customers`, `products`, `employees`, `collections`, `returns`, `visits`, `order_items`, `credit_applications`, `credit_contracts`, `credit_programs`, `delivery_tracking`, `unified_locations` — upper_management bypass policies
- `gps_test_points` — 2 policies (test only)

**Tables likely missing RLS**: `employee_monthly_targets`, `company_monthly_targets`, `employee_work_policies`, `employee_capabilities`, `workday_sessions`, `workday_breaks`, `sessions`, `return_items`, `order_items`, `customer_addresses`, `customer_contacts`, `products`, `product_categories`, `brands`, etc.

### 1.8 LOW: Stale Test/Debug Functions

The following test functions remain in the `public` schema and are accessible via the blanket GRANT:

- `public.test_func` / `test_ping2` / `test_ping3` / `test_rpc` / `test_setof`
- `public.multiline_test`
- `public.ping`

### 1.9 MEDIUM: `_pre_drop_functions.sql` Maintenance Burden

The `_pre_drop_functions.sql` file lists **40 DROP FUNCTION** statements. This file must be manually kept in sync with:

1. The main migration it accompanies (unknown — filename suggests it's a pre-migration script)
2. All earlier migrations that define the same functions
3. All later migrations that reference the functions

**Risk**: If a function is dropped but not recreated, any callers that depend on it will get 500 errors. If the parameter list doesn't match exactly, the DROP silently fails (no error with `IF EXISTS`).

### 1.10 INFO: Function Definition Patterns

| Pattern | Count | Notes |
|---------|-------|-------|
| Security DEFINER | ~657 (all) | All functions use SECURITY DEFINER |
| SET search_path | Most | Most set `search_path = public, extensions` — relatively safe |
| RETURNS jsonb | Majority | Most governed RPCs return JSON |
| RETURNS TABLE | Some | Some analytical functions use TABLE returns |
| RETURNS SETOF | Some | Some use SETOF for record sets |
| RETURNS boolean | Few | `check_capability`, `is_upper_management` |
| RETURNS uuid[] | Few | `get_visible_employee_ids` |
| Language plpgsql | Most | All complex functions use plpgsql |
| Language sql | Few | Simple wrapper functions use sql |
| STABLE | Some | Read-only functions marked STABLE |
| IMMUTABLE | Very few | Only pure functions |
| VOLATILE | Most | Default for data-modifying functions |

---

## SECTION 2: RPC CONTRACTS

### 2.1 Overview

- **Frontend RPC call sites**: ~250+ across the codebase
- **Unique RPC functions called from frontend**: 100+
- **Direct `supabase.from()` table access**: 8 sites (bypass governed RPCs)
- **Test suites calling RPCs**: 20+ test files in `src/__tests__/`

### 2.2 CRITICAL: Ambiguous Overloads Called from Frontend

The following functions have BOTH `(uuid)` and `(text)` overloads in the database AND are actively called from the frontend. PostgREST will fail with PGRST202 at runtime.

| RPC Function | Frontend Call Sites | Risk |
|---|---|---|
| `check_capability` | OperationsCenterPage.tsx:83, services/auth.ts:72 | **CRITICAL** — auth/authorization will fail |
| `get_live_workday_overview` | services/attendance.ts:114, OperationsCenterPage.tsx:90, UpperManagementDashboard.tsx:108 | **CRITICAL** — live dashboard will fail |
| `get_dashboard_management` | AdminWorkspace.tsx:33, ChairmanWorkspace.tsx:20, ManagementDashboard.tsx:40, SuperAdminWorkspace.tsx:49, UpperManagementDashboard.tsx:106 | **HIGH** — all management dashboards will fail |

#### 2.2.1 `check_capability` — Immediate Auth Failure (CRITICAL)

**Frontend call** (`services/auth.ts:72`):
```ts
const { data, error } = await supabase.rpc('check_capability', {
  p_token: token,
  p_code: code,
})
```

**Database overloads**:
- `check_capability(p_token uuid, p_code text)` — from `20260706_role_normalization.sql`
- `check_capability(p_token text, p_code text)` — from `20260625_fix_check_capability_overload.sql`

**Impact**: Every governed RPC that calls `check_capability` internally will also be affected. Since all governed RPCs are `SECURITY DEFINER` and call `check_capability` via PL/pgSQL (not REST), the internal calls work fine. But if `check_capability` itself is called via REST (as in `services/auth.ts`), PostgREST will return PGRST202.

### 2.3 Contract Mismatches

#### RPC01: `get_work_hours_ledger` — CONFIRMED FIXED

| Detail | Value |
|--------|-------|
| Migration | `20261002_fix_work_hours_ledger_contract.sql` |
| Root Cause | Phase C migration (`20260622_phase_c_workday_detail_repair.sql`) was never deployed. A different function with text params (no `schedule_info`) existed in production. |
| Symptom | `Cannot read properties of undefined (reading 'presence_minutes')` in `EmployeeWorkdayDetailPage` |
| Fix | Dropped text-param function, created uuid+date version with `schedule_info.presence_minutes` |
| **Regression Risk** | If the old text-param function still exists in some environments, or if any caller still uses it, it will 404 |

### 2.4 Functions with Potential Unexposed Overloads (RPC Risk)

These functions may have multiple definitions with different parameter types in the database. If any overloaded version was the last one defined, it overrides. But if BOTH versions coexist (different param signatures), the REST API will fail.

| Function | DB Definitions | Last DB Definition | Risk Level |
|---|---|---|---|
| `get_unified_order` | 6 definitions (Jun–Jul 2026) | `20260730_phase3_order_revision_system.sql` | MEDIUM — verify params |
| `get_unified_orders` | 3 definitions (Jun–Jul 2026) | `20260729_orders_unification_phase2.sql` | MEDIUM — verify params |
| `governed_approve_order` | 6 definitions (Jun–Jul 2026) | `20260730_phase3_order_revision_system.sql` | MEDIUM — verify params |
| `governed_dispatch_order` | 7 definitions (Jun–Aug 2026) | `20260810_executive_workspace_final.sql` | MEDIUM — verify params |

### 2.5 RPC Functions Called from Frontend — Complete Audit

#### Total unique RPCs: ~100+
#### Total call sites: ~250+

**10 most-called functions:**

| Rank | Function | Call Sites |
|------|----------|------------|
| 1 | `get_governed_employees` | ~20 |
| 2 | `get_governed_customers` | ~12 |
| 3 | `get_governed_products` | ~12 |
| 4 | `get_unified_orders` | 9 |
| 5 | `get_governed_companies` | 8 |
| 6 | `get_unified_order` | 7 |
| 7 | `get_dashboard_management` | 5 |
| 8 | `get_governed_visits` | 6 |
| 9 | `get_governed_collections` | 3 |
| 10 | `get_live_workday_overview` | 3 |

### 2.6 Direct Table Access (Bypassing Governed RPCs)

**8 sites** access tables via `supabase.from()` instead of governed RPCs:

| File | Line | Table | Type |
|------|------|-------|------|
| `StorefrontPage.tsx` | 92 | `products` | Intentional (anonymous storefront) |
| `StorefrontPage.tsx` | 129 | `tiers` | Intentional (anonymous storefront) |
| `CompaniesPage.tsx` | 23 | `companies` | Intentional (anonymous storefront) |
| `VisitScreen.tsx` | 139 | `visits` | Best-effort verification after RPC mutation |
| `VisitScreen.tsx` | 187 | `visits` | Best-effort verification after RPC mutation |
| `EmployeeAnalysisPage.tsx` | 203 | `employees` | **Legacy** — should use governed RPC |
| `EmployeeAnalysisPage.tsx` | 210 | `customers` | **Legacy** — should use governed RPC |
| `EmployeeAnalysisPage.tsx` | 276 | `visits` | **Legacy** — should use governed RPC |

### 2.7 Security: `check_capability` Not Called Before Every Governance Action

While `check_capability` is used in some places (OperationsCenterPage, auth.ts), many frontend pages call governed RPCs without a preceding `check_capability` call. This is partially acceptable because:
- The backend RPCs themselves validate capabilities via `check_capability` (SECURITY DEFINER)
- But individual pages should still gate UI elements behind capability checks for UX

Affected: Most workspace pages, dashboard pages, and management pages call governed RPCs directly without frontend capability pre-checks.

---

## SECTION 3: PERMISSIONS

### 3.1 Overview

The permissions system relies on:
1. `check_capability(p_token, p_code)` — gates every governed operation
2. `get_visible_employee_ids(p_token)` — governs data visibility
3. `is_upper_management(v_employee_id)` — bypasses capability checks
4. Employee roles (`public.employee_roles`, `public.roles`) — mapped to capabilities
5. `app.sessions` — session-based auth (not Supabase Auth directly)

### 3.2 Findings

#### PERM01: `check_capability` — Ambiguous Overload Blocks Auth (CRITICAL)

Both `(uuid, text)` and `(text, text)` overloads exist. PostgREST will return PGRST202 when clients call `check_capability` via REST.

**Impact**: Every governed RPC that calls `check_capability` will fail with authentication errors because:
- The governed RPC internally calls `check_capability` with a specific type (e.g., `p_token uuid` as first arg + `text` code)
- This works in PL/pgSQL but if the function is also exposed as an RPC, the REST layer can't resolve it

#### PERM02: `get_visible_employee_ids` — Ambiguous Overload (CRITICAL)

Both `(uuid)` and `(text)` overloads exist. Used by virtually every governed RPC to scope data visibility.

**Impact**: If PostgREST resolves to the wrong overload, visibility scoping fails, either returning empty results (safe failure) or too many results (data leak).

#### PERM03: `is_upper_management` — Granted to ALL authenticated users (MEDIUM)

Through the blanket GRANT, `is_upper_management` is callable by any authenticated user. This function checks if the calling user is upper management. While not a direct vulnerability (the function checks the caller's own session), it exposes capability enumeration.

#### PERM04: Role Management Functions Exposed to Anon (CRITICAL)

`governed_create_role`, `governed_update_role`, `governed_delete_role`, `governed_update_role_capabilities`, `get_role_capabilities` are all GRANTed to `anon`.

**Note**: These functions still validate through `check_capability` internally, so they require a valid session with proper capabilities. The `anon` grant likely exists for PWA pre-auth flows. However, if `check_capability` fails due to Overload Issue (PERM01), these functions become completely exposed.

---

## SECTION 4: RUNTIME

### 4.1 Activity Views / Live Activity Center

| Function | DB Definitions | Frontend Calls | Status |
|----------|---------------|----------------|--------|
| `get_live_activity_center` | 2 (`20260618_v1`, `20260618_v2`) — both `p_token uuid` | `services/attendance.ts` (via scan) | OK |

### 4.2 CRITICAL: Achievement Runtime — Functions Missing from Database

The frontend calls the following functions that **do not exist** in any migration file:

| Function | Frontend Call Sites | Parameters Passed | Status |
|----------|-------------------|-------------------|--------|
| `get_runtime_achievement` | SalesRepAchievement.tsx:108, TeamAchievement.tsx:46 | `p_employee_id`, `p_month`, `p_year` (NO p_token) | **MISSING** |
| `get_runtime_activity` | SalesRepActivity.tsx:64 | `p_employee_id`, `p_date_from`, `p_date_to` (NO p_token) | **MISSING** |
| `get_runtime_team` | TeamAchievement.tsx:30 | `p_manager_employee_id`, `p_month`, `p_year` (NO p_token) | **MISSING** |

**Impact**: These pages will fail with HTTP 404 ("Could not find the function") when users navigate to:
- `src/pages/sales-rep/SalesRepAchievement.tsx`
- `src/pages/sales-rep/SalesRepActivity.tsx`
- `src/pages/sales-manager/TeamAchievement.tsx`

**Note**: These functions don't pass `p_token` at all, unlike every other governed RPC. Either:
1. They were intended to be public/wrapper functions
2. They were planned but the SQL migration was never written
3. They were defined outside the supabase/migrations directory in a separate deployment

### 4.3 KPI / Target Performance Functions

| Function | DB Definitions | Last Definition | Frontend Calls | Status |
|----------|---------------|-----------------|----------------|--------|
| `get_governed_target_performance` | 5 | `20261003` (`p_token uuid`) | `services/targets.ts:91` | OK |
| `get_kpi_contributors` | 3 | `20260720_unify_upper_management_role.sql` | `services/targets.ts:107` | Needs param verification |
| `get_team_members_kpis` | 3 | `20260720_unify_upper_management_role.sql` | `services/targets.ts:124` | Needs param verification |
| `get_rep_customer_kpis` | 3 | `20260720_unify_upper_management_role.sql` | `services/targets.ts:141` | Needs param verification |
| `get_customer_delivered_orders` | 3 | `20260720_unify_upper_management_role.sql` | `services/targets.ts:163` | Needs param verification |

### 4.4 Event Views / Reconciliation

No dedicated event view or reconciliation functions found. Data reconciliation appears to happen inline within individual RPCs rather than through a centralized reconciliation system.

### 4.5 Health Checks (PWA Heartbeat)

| Function | DB Definitions | Last Definition | Status |
|----------|---------------|-----------------|--------|
| `record_heartbeat` | 2 | `20260727_session_lifecycle_policy.sql` | OK |
| `check_session_timeout` | 1 | `20260727_session_lifecycle_policy.sql` | OK |
| `touch_session_activity` | 1 | `20260727_session_lifecycle_policy.sql` | OK |

**Note**: These session lifecycle functions were refactored in `20260727_session_lifecycle_policy.sql` which is a large file (850+ lines). The functions are actively used by `services/heartbeatService.ts` and `services/lifeSignalService.ts`.

---

## SECTION 5: FRONTEND

### 5.1 Architecture Overview

- **Source**: `src/` directory — pages, services, components, hooks, contexts
- **State Management**: React Context + local state + Supabase realtime
- **API Layer**: Services in `src/services/` using `supabase.rpc()` calls
- **Auth**: Custom session-based auth (`app.sessions` table) via `services/auth.ts`
- **Pages**: Workspace-based routing (AdminWorkspace, SalesRepWorkDay, etc.)

### 5.2 RPC Call Volume

| Category | Unique Functions | Total Call Sites |
|----------|-----------------|------------------|
| `governed_*` (mutations) | ~80 | ~120 |
| `get_*` (queries) | ~70 | ~130 |
| Other utilities | ~15 | ~20 |
| **Total** | **~100+** | **~250+** |

### 5.3 CRITICAL: Functions Called from Frontend with Ambiguous Overloads

| Function | Frontend Calls | Issue |
|----------|---------------|-------|
| `check_capability` | 2 call sites (auth.ts, OperationsCenterPage) | PGRST202 will block capability checks |
| `get_live_workday_overview` | 3 call sites | PGRST202 — live overview will fail |
| `get_dashboard_management` | 5 call sites | PGRST202 — dashboards will fail |

### 5.4 Direct Table Access (No RPC Governance)

| File | Table | Issue |
|------|-------|-------|
| `StorefrontPage.tsx` | `products`, `tiers` | Intentional — anonymous storefront |
| `CompaniesPage.tsx` (storefront) | `companies` | Intentional — anonymous storefront |
| `VisitScreen.tsx` | `visits` | Best-effort verification after mutation (commented) |
| **`EmployeeAnalysisPage.tsx`** | **`employees`, `customers`, `visits`** | **LEGACY — should use governed RPCs** |

### 5.5 RPC Functions — Most Critical to Frontend

The following functions are essential for core user flows and MUST be verified:

| Function | Used In | Business Criticality |
|----------|---------|----------------------|
| `check_capability` | Auth guard, UI gating | **CRITICAL** — without this, whole app breaks |
| `login` / `validate_session` | Auth flow | **CRITICAL** — no login = no app |
| `get_governed_employees` | Every employee list | **CRITICAL** — all employee features |
| `get_governed_customers` | Every customer list | **CRITICAL** — all customer features |
| `get_governed_products` | Every product list | **CRITICAL** — all product features |
| `get_unified_orders` | All order lists | **CRITICAL** — all order features |
| `get_unified_order` | Order detail | **CRITICAL** — order detail page |
| `get_dashboard_management` | Admin dashboards | **HIGH** — dashboard managers |
| `get_live_workday_overview` | Live operations center | **HIGH** — operations visibility |
| `get_my_workday_status` | Attendance runtime | **HIGH** — clock in/out |
| `start_workday` / `end_workday` | Attendance runtime | **HIGH** — time tracking |

### 5.6 Service Architecture

```
src/services/
├── attendance.ts        — All workday/attendance RPCs (~30 functions)
├── auth.ts              — Login, logout, validate_session, check_capability
├── credit.ts            — Credit lifecycle RPCs (~15 functions)
├── targets.ts           — Target/performance RPCs (~12 functions)
├── products.ts          — Product queries
├── returns.ts           — Return lifecycle RPCs
├── tiers.ts             — Tier management RPCs
├── dailyDeals.ts        — Daily deal RPCs
├── flashOffers.ts       — Flash offer RPCs
├── auctions.ts          — Auction RPCs
├── location.ts          — Location RPCs
├── dataDeletion.ts      — Data deletion RPCs (dynamic)
├── trackingEngine.ts    — GPS tracking sync
├── heartbeatService.ts  — PWA session heartbeat
├── unifiedSearch.ts     — Unified search RPC
└── lifeSignalService.ts — Session activity touch
```

### 5.7 Dynamic RPC Calls

Several files construct RPC function names at runtime, making static analysis incomplete:

1. **services/auth.ts**: Dynamic `fn` dispatch (login, logout, validate, check_capability, register_customer)
2. **services/dataDeletion.ts**: `SEARCH_RPCS` and `EXECUTE_RPCS` maps (18 dynamic functions)
3. **ReportsPage.tsx**: `rpcMap` (9 dynamic report RPCs)
4. **CreditReviewPage.tsx**: `action()` helper (4 credit actions)
5. Various pages: activate/deactivate toggle patterns

---

## SECTION 6: REGRESSION

### 6.1 High-Risk Migration Chain

The following migration chains are most likely to cause regressions due to the `p_token` type pendulum:

```
Jun 18 — Phase 2 (Original uuid-based functions)
Jun 22 — Phase C Workday Detail (NEVER DEPLOYED → broken contract)
Jun 25 — Fix Check Capability Overload (Creates text overload)
Jun 26 — TEXT PEAK (bulk text conversion, 5+ migration files)
Jun 30 — Work Policies Phase 1 (uuid-based — first revert from text)
Jul 06 — Role Normalization (uuid-based — bulk revert)
Jul 08 — Blanket GRANT (mitigates missing grants)
Jul 20 — Unify Upper Management Role (uuid-based)
Jul 24 — Identity Integration Layer (uuid-based)
Aug 02 — Phase C Followup (uuid-based)
Oct 01 — F2 Canonical KPI Unification (uuid-based, drops & recreates)
Oct 02 — Fix Work Hours Ledger Contract (uuid-based, drops old text version)
Oct 03 — B12 Include All Active Employees (uuid-based)
```

### 6.2 Known Fixes Prone to Regression

| Area | Original Issue | Fix | Regression Risk |
|------|---------------|-----|-----------------|
| Work Hours Ledger | `get_work_hours_ledger` contract mismatch | Dropped text-param function, created uuid+date version (`20261002`) | If environment still has old text version, PG will find 2 functions. If any caller uses old signature, it 404s |
| Check Capability | `check_capability` ambiguous call | `20260625/20260626` created `(text, text)` overload | **Still broken** — uuid version recreated by later migrations; overload persists |
| p_token type | uuid→text forced migration | `20260626_unify_p_token_text_contract.sql` | **Rolled back silently** — later migrations reverted to uuid, creating overloads |
| GRANT EXECUTE | All functions lacked grants | `20260708_governed_rpc_execute_grants.sql` — blanket GRANT | Blanket GRANT doesn't cover functions recreated after Jul 8. Each new migration must re-grant |
| Attendance RPC Scoping | Live overview returned all employees | `20260718`, `20260719` scoping fixes | Scoping depends on `get_visible_employee_ids` — if overload issue causes wrong overload, scoping returns wrong data |
| Phase C Undeployed | Critical fix never reached production | `20261002_fix_work_hours_ledger_contract.sql` | If same pattern repeats, other Phase C functions might also be missing |

### 6.3 Regression Detection Checklist

Before any production deployment, verify:

1. **No ambiguous functions**: Query `pg_proc` for functions with same name, different param types
2. **GRANT completeness**: Every function that should be REST-accessible has `GRANT EXECUTE TO authenticated`
3. **RPC smoke test**: Call every RPC function used by frontend with valid params
4. **p_token consistency**: All functions in the same chain use the same p_token type
5. **Frontend-backend alignment**: Every frontend `rpc()` call has a matching DB function with matching param names
6. **PostgREST schema reload**: `pg_notify('pgrst', 'reload schema')` after any function change

---

## FINDING SUMMARY

| ID | Severity | Layer | Description |
|----|----------|-------|-------------|
| DB01 | CRITICAL | Database | `get_visible_employee_ids` ambiguous overload (uuid+text) |
| DB02 | CRITICAL | Database | `check_capability` ambiguous overload (uuid+text) |
| DB03 | CRITICAL | Database | `get_live_workday_overview` ambiguous overload (uuid+text) |
| DB04 | HIGH | Database | `get_dashboard_management` ambiguous overload (uuid+text) |
| DB05 | HIGH | Database | Missing GRANT EXECUTE on 10+ recreated functions |
| DB06 | HIGH | Database | Blanket GRANT exposes all functions to authenticated users |
| DB07 | HIGH | Permissions | Role management functions GRANTed to anon |
| DB08 | MEDIUM | Database | Only 18 RLS policies — many tables unprotected |
| DB09 | MEDIUM | Permissions | Test/debug functions exposed via blanket GRANT |
| DB10 | MEDIUM | Database | `_pre_drop_functions.sql` maintenance burden (40 DROP statements) |
| DB11 | MEDIUM | Permissions | 15+ functions GRANTed to `anon` instead of `authenticated` |
| DB12 | INFO | Database | Stale test functions (test_func, test_ping2, etc.) |
| DB13 | LOW | Database | p_token uuid→text→uuid pendulum creates contract confusion |
| RPC01 | FIXED | RPC | `get_work_hours_ledger` contract mismatch (fixed Oct 2026) |
| **FE01** | **CRITICAL** | **Frontend** | `check_capability` called from frontend but overloaded — PGRST202 guaranteed |
| **FE02** | **CRITICAL** | **Frontend** | `get_live_workday_overview` called from 3 frontend sites with overload |
| **FE03** | **HIGH** | **Frontend** | `get_dashboard_management` called from 5 frontend sites with overload |
| **FE04** | **MEDIUM** | **Frontend** | `EmployeeAnalysisPage.tsx` bypasses governed RPCs (3 direct table reads) |
| **FE05** | **INFO** | **Frontend** | Legacy direct table access in storefront pages (intentional — anonymous) |
| **RT01** | **CRITICAL** | **Runtime** | `get_runtime_achievement` called from frontend but does NOT exist in database |
| **RT02** | **CRITICAL** | **Runtime** | `get_runtime_activity` called from frontend but does NOT exist in database |
| **RT03** | **CRITICAL** | **Runtime** | `get_runtime_team` called from frontend but does NOT exist in database |

---

## APPENDIX A: Files with Most Function Definitions

| File | Functions |
|------|-----------|
| `20260607_recovery_missing_functions.sql` | ~80 functions (recovery file) |
| `20260610_attendance_module.sql` | ~30 functions |
| `20260611_phase5_attendance_v2.sql` | ~25 functions |
| `20260626_unify_p_token_text_contract.sql` | ~15 functions |
| `20260706_role_normalization.sql` | ~20 functions |
| `20260720_unify_upper_management_role.sql` | ~25 functions |
| `20260724_identity_integration_layer.sql` | ~30 functions |
| `20260729_orders_unification_phase1.sql` | ~20 functions |
| `20260730_phase3_order_revision_system.sql` | ~25 functions |
| `20260802_phase_c_followup_schedule_type_rpcs.sql` | ~20 functions |
| `20261001_f2_canonical_kpi_unification.sql` | ~15 functions |

## APPENDIX B: Migration Timeline

```
2026-06-02 — P1 Operational Completion
2026-06-03 — Tier Enforcement, Daily Deals, Flash Offers
2026-06-04 — Unified Identity Location, Tier Runtime
2026-06-05 — Customer Direct Ownership
2026-06-06 — Customer Visibility Fix
2026-06-07 — Recovery Missing Functions (bulk)
2026-06-10 — Attendance Module, Order Status Fix
2026-06-11 — Phase 5 (Role Management, Active Employees, Attendance v2, v6)
2026-06-12 — My Workday Status v3
2026-06-16 — Snapshot Architecture, Phase 7 Work Hours Analytics
2026-06-17 — Customer Address Location, Coverage Map
2026-06-18 — Phase 2 Customer Address Fields, Live Activity Center
2026-06-20 — Public Company Profile
2026-06-22 — Phase C Workday Detail, P1 fixes (product code, schema, v_item)
2026-06-23 — Credit Lifecycle Wiring
2026-06-24 — Seed Sales Rep Monthly Targets
2026-06-25 — Fix Check Capability Overload ← TEXT migration begins
2026-06-26 — Fix remaining p_token text, Fix column error, Fix uuid wrapper,
             Restore check_capability, Unify p_token text contract ← TEXT peak
2026-06-27 — Fix storefront companies, salesrep governance
2026-06-30 — Work Policies Phase 1
2026-07-01 — Fix GPS Distance Drift
2026-07-02 — Fix Sync Tracking Points RPC
2026-07-03 — PWA Heartbeat
2026-07-04 — Employee Workday History v2
2026-07-05 — Create Daily Target vs Actual
2026-07-06 — Role Normalization ← UUID revert begins
2026-07-08 — Governed RPC Execute Grants (blanket GRANT)
2026-07-14 — Customer Code Snapshot
2026-07-15 — GPS Null Validation
2026-07-16 — GPS Test Table
2026-07-18 — Fix Live Workday Overview Scoping
2026-07-19 — Fix Attendance RPC Scoping
2026-07-20 — Unify Upper Management Role ← UUID revert continues
2026-07-24 — Identity Integration Layer
2026-07-26 — Get Completed Workdays History
2026-07-27 — Fix Attendance Detail RPCs, Session Lifecycle Policy
2026-07-28 — Fix Governed Dispatch Delivery Tracking
2026-07-29 — Orders Unification Phase 1 & 2
2026-07-30 — Phase 3 Order Revision System
2026-08-01 — Phase A Tracking Fix
2026-08-02 — Phase C Followup Schedule Type RPCs
2026-08-05 — Executive Workspace
2026-08-06 — Fix Executive Permissions and State
2026-08-10 — Executive Workspace Final
2026-08-20 — Executive Queue Customer Owner
2026-09-21 — Employee Cascade Delete, Data Deletion Center
2026-09-22 — Product Out of Stock
2026-09-23 — Unified Smart Search
2026-10-01 — F2 Canonical KPI Unification
2026-10-02 — Fix Work Hours Ledger Contract
2026-10-03 — B12 Include All Active Employees
```

---

*End of Section 1 & 2 — Database & RPC Contracts. Continue investigation with Sections 3–6 (Permissions, Runtime, Frontend, Regression).*
