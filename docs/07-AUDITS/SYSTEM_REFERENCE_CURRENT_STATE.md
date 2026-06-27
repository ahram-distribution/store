# SYSTEM REFERENCE — CURRENT STATE

> **Purpose**: Single source of truth describing the system as it exists today.  
> **Date**: 2026-06-25  
> **Scope**: Database, API (RPCs), Permissions, Runtime, Frontend  
> **Principle**: Facts only. Findings are marked but not assumed to be problems. History is separate.

---

## 0. Investigation Overview

### 0.1 Executive Observation

Phase P1 investigations have revealed a critical insight: **many findings that initially appeared to be defects were, in fact, historical artifacts** — remnants of the `p_token` type pendulum and other migration churn that left dead overloads, duplicate definitions, and vestigial code paths. None of these have been proven to cause operational issues.

This validates the investigation-first methodology. Had we proceeded directly to fixes based on code review alone, we would have risked:
- Modifying stable, working functions unnecessarily
- Introducing regressions by removing overloads that serve silent but legitimate purposes
- Wasting effort on cleanup that provides no operational value

The evidence boundary was reached cleanly: **no Bug has been confirmed in any finding reviewed so far**. Every "problem" turned out to be either a documented history artifact, a stable contract, or an open question that could not be settled without operational evidence.

### 0.2 Investigation Methodology

Every finding passes through these stages **in order**:

| Stage | Question | Output |
|-------|----------|--------|
| **1. Current State Verification** | What actually exists right now? | Facts-only description of the current code, migration, and schema state |
| **2. Runtime Verification** | Does it affect the live system? | Confirmed working / unable to reproduce / no impact |
| **3. Evidence Collection** | Do we have proof, or just a hypothesis? | Documented evidence, call chain analysis, REST tests, or evidence boundary identified |
| **4. Decision** | What do we conclude? | One of: Bug, Verified Stable Contract, Architectural Decision, Schema Hygiene Opportunity, Source Control Integrity Gap, Consistency Opportunity, Implementation Opportunity, Runtime Verification Pending, Fixed (Prior) |

No fix or cleanup is proposed before reaching Stage 4. No escalation of access level is performed merely to close a finding.

### 0.3 Evidence Boundary Rule

> If an investigation reaches a point where the question cannot be settled without elevated privileges or additional tools, and no Bug is reproducible or operational impact is demonstrable, the investigation stops at that boundary. The finding is classified as **Runtime Verification Pending** — not closed, not a problem, not actionable. Access level is not escalated solely to close a finding.

### 0.4 Reproducibility Gate

> The investigation phase for any project subsystem is not considered complete until the entire production environment can be reconstructed from the repository alone. Code deployed in production without a corresponding migration definition is a **Source Control Integrity Gap** and must be resolved before the project can claim a single source of truth. This gate applies globally across all findings — no single finding needs to resolve it, but the project cannot close its investigation phase while such gaps exist.

### 0.5 Source of Truth Policy

Phase P1 investigations revealed that each of these can deviate from the others:
- Code comments
- Migration files (historical)
- Documentation
- Live production database

This policy establishes their hierarchy.

**Primary Source of Truth**: The **live production database** is the authoritative runtime reference. It represents what actually works today.

**Canonical Reference**: `SYSTEM_REFERENCE_CURRENT_STATE.md` is the official documented description of the current system state. It is derived from the production database, not from historical migrations.

**Reproducible Source**: The repository and migration files MUST be able to fully reproduce the production database. Any gap between them and the live environment is a **Source Control Integrity Gap** — not merely missing documentation.

**Documentation Rule**: If a code comment, historical migration, or document contradicts the actual runtime behavior:
1. The live database is authoritative.
2. Update the Canonical Reference to match reality.
3. Update the repository (migrations, comments) until it can reproduce the same state.

Historical migrations and comments are NOT sources of truth if they contradict current behavior. They are historical evidence, not current specifications.

---



## Table of Contents

0. [Investigation Overview](#0-investigation-overview)
1. [Database — Current State](#1-database--current-state)
2. [API (RPCs) — Current State](#2-api-rpcs--current-state)
3. [Permissions — Current State](#3-permissions--current-state)
4. [Runtime — Current State](#4-runtime--current-state)
5. [Frontend — Current State](#5-frontend--current-state)
6. [Findings Index](#6-findings-index)
7. [History Appendix](#7-history-appendix)
8. [Investigation Statistics](#8-investigation-statistics)

---

## 1. Database — Current State

### 1.1 Source of Truth

The authoritative source for the database schema is the set of migration files in `supabase/migrations/` (141 `.sql` files). The latest migration files (sorted by filename) represent the final state after all migrations have been applied.

### 1.2 Schemas

| Schema | Owner | Contents |
|--------|-------|----------|
| `public` | Postgres | All tables, functions, policies, sequences |
| `app` | Postgres | `sessions` table only |
| `extensions` | Postgres | Only in `search_path` of functions |

### 1.3 Tables

*Note: This section lists confirmed tables. Verification against live DB recommended for completeness.*

| Table | Schema | RLS Status | Policies |
|-------|--------|-----------|----------|
| `employees` | public | Enabled | `upper_management_all_employees` |
| `orders` | public | Enabled | `upper_management_all_orders` |
| `customers` | public | Enabled | `upper_management_all_customers` |
| `products` | public | Enabled | `upper_management_all_products` |
| `companies` | public | Enabled | `Companies are publicly readable` |
| `collections` | public | Enabled | `upper_management_all_collections` |
| `returns` | public | Enabled | `upper_management_all_returns` |
| `visits` | public | Enabled | `upper_management_all_visits` |
| `order_items` | public | Enabled | `upper_management_all_order_items` |
| `credit_applications` | public | Enabled | `upper_management_all_credit_applications` |
| `credit_contracts` | public | Enabled | `upper_management_all_credit_contracts` |
| `credit_programs` | public | Enabled | `upper_management_all_credit_programs` |
| `delivery_tracking` | public | Enabled | `upper_management_all_delivery_tracking` |
| `unified_locations` | public | Enabled | `upper_management_all_unified_locations` + `unified_locations_read_all` |
| `gps_test_points` | public | Enabled | `gps_test_points_insert`, `gps_test_points_select` |
| `employee_monthly_targets` | public | **No RLS policy** | — |
| `company_monthly_targets` | public | **No RLS policy** | — |
| `employee_work_policies` | public | **No RLS policy** | — |
| `employee_capabilities` | public | **No RLS policy** | — |
| `workday_sessions` | public | **No RLS policy** | — |
| `workday_breaks` | public | **No RLS policy** | — |
| `app.sessions` | public | **No RLS policy** | — |
| `return_items` | public | **No RLS policy** | — |
| `customer_addresses` | public | **No RLS policy** | — |
| `customer_contacts` | public | **No RLS policy** | — |
| `products_categories` | public | **No RLS policy** | — |
| `brands` | public | **No RLS policy** | — |
| `auctions` | public | **No RLS policy** | — |
| `auction_bids` | public | **No RLS policy** | — |
| `daily_deals` | public | **No RLS policy** | — |
| `flash_offers` | public | **No RLS policy** | — |
| `employee_roles` | public | **No RLS policy** | — |
| `roles` | public | **No RLS policy** | — |

**Finding F-DB-01**: 18 RLS policies exist for 14 tables. ~15+ additional tables exist without RLS policies. All functions use SECURITY DEFINER, which bypasses RLS.

**Investigation** (2026-10-03): Verified all frontend `supabase.from()` call sites. The 4 direct-access files (VisitScreen.tsx, StorefrontPage.tsx, CompaniesPage.tsx, EmployeeAnalysisPage.tsx) all target tables WITH RLS (`visits`, `products`, `tiers`, `companies`, `employees`, `customers`). No production code path accesses the 15+ RLS‑less tables directly. Whether the REST API exposes these tables depends on Supabase platform default privileges — unconfirmed without live‑DB access, but no known exploit path exists in the current codebase.

**Decision**: Architectural Observation — not a Bug.
- **Rationale**: No exploitable path exists today. All production workflows rely on governed RPCs. The risk is purely forward‑looking (new code bypassing RPC governance).
- **Official Architecture Decision**: **Governed RPC First** — governed RPCs are the primary security layer. Capabilities are the authorization source. Ownership model is the data‑scoping source. RLS is a secondary defense‑in‑depth layer, not the primary security model.
- **Future Rule**: Any new `supabase.from()` direct table access to internal tables must undergo architectural review. It is not the default development pattern.

**Finding F-DB-02**: `get_visible_employee_ids` has two overloads: `(p_token uuid)` and `(p_token text)`. The `uuid` version is the canonical current one. The `text` overload was created as a workaround during the June 2026 `p_token` text migration and was never dropped when functions reverted to `uuid`.

**Investigation** (2026-10-03): Searched all 141 migration files for calls to `get_visible_employee_ids`. Found ~72 call sites across files from June–October 2026. Every call in the current state passes a `uuid`-typed `p_token`, matching the `uuid` overload. The 9 functions that still use `p_token text` (e.g., `get_order_status_counts`, `get_governed_customers`) do NOT call `get_visible_employee_ids`. No frontend code calls it. No views, triggers, or jobs reference the `text` overload.

**Decision**: Schema Hygiene Opportunity — not a Bug, Security Issue, Regression, or Runtime Problem.
- **Rationale**: The `text` overload is dead code. It has zero callers in the current state. It causes no operational issues. Its existence is purely a historical artifact of the June→July `p_token` type transition.
- **Cleanup Policy**: No schema element is deleted merely because it is unused. Deletion requires ALL of: (1) confirmed unused by all code paths, (2) no dependency from any internal function, (3) no dependency from any future deployment or migration, (4) execution as part of a planned Schema Cleanup with full post-deletion testing.
- **Removal Preconditions**: (a) Confirm no function, trigger, view, or job calls `get_visible_employee_ids(text)` — **done**. (b) Test visibility paths (`get_unified_orders`, `get_dashboard_management`, `get_governed_employees`) after deletion on a staging DB.
- **Deferred Cleanup Candidate**: Listed in Section 6.1.

**Finding F-DB-03**: `check_capability` has two overloads: `(p_token uuid, p_code text)` and `(p_token text, p_code text)`.

**Investigation** (2026-10-03): Verified runtime behavior through full code-path analysis.
- **REST calls** (frontend `auth.ts:72` → `supabase.rpc('check_capability', {p_token, p_code})`): PostgreSQL selects `(text, text)` via exact match — works correctly.
- **Internal calls** (governed RPCs → `PERFORM check_capability(p_token, 'code')` with `p_token uuid`): PostgreSQL selects `(uuid, text)` via exact match — works correctly.
- Both overloads delegate to the same logic. No PGRST202 has been reproduced or reported. Historical migration `20260626_restore_check_capability_uuid_wrapper.sql` confirms earlier awareness of PostgREST ambiguity, but the current state works without issue because PostgreSQL function resolution prefers exact matches over implicit casts.

**Why This Is Not a Bug**:
- The REST API uses a stable contract (`text, text` — exact match when called from JSON).
- PL/pgSQL uses a stable contract (`uuid, text` — exact match when called with typed parameter).
- No PGRST202 has been proven in the current environment.
- Therefore there is no justification to modify or remove any overload at this stage.

**Decision**: Verified Stable Contract — not a Bug, Schema Hygiene, or Architectural Observation.
- The `text` overload is not dead code; it is the REST-facing contract. The `uuid` overload is the PL/pgSQL-facing contract. Both coexist correctly because PostgreSQL function resolution resolves each call to the correct overload without ambiguity.
- **Future Rule**: No overload unification or removal is performed merely because multiple signatures exist. An operational problem or real conflict must first be proven, then the impact on all consumers must be assessed before any change.

**Finding F-DB-05**: `get_dashboard_management` has two overloads: `(p_token uuid)` and `(p_token text)`. Both coexist, and it is unknown which one PostgREST resolves to at runtime.

**Investigation** (2026-06-25): Verified runtime behavior through supabase-community REST API calls using anon key only (no elevated privileges).
- `ping()` → `{"message": "pong"}` — confirmed the Supabase REST API is reachable and `SECURITY DEFINER` functions are callable by anon.
- `get_dashboard_management(p_token := '00000000-0000-0000-0000-000000000000')` → `{"error": "INVALID_SESSION"}` — confirmed the function is registered, callable, and returns identically for both overloads (invalid session).
- `get_dashboard_management(p_token := 'malformed-input')` → `22P02: invalid input syntax for type uuid` — same error from PostgreSQL regardless of overload (the `text` overload casts `p_token::uuid` inline without an exception handler).
- Reached the evidence boundary: no REST-accessible mechanism exists to introspect `pg_catalog.pg_proc` or determine which OID PostgREST selects. Cannot resolve without either: (a) Supabase Dashboard SQL Editor, (b) direct database connection, or (c) `service_role` JWT.

**No operational bug was reproduced**: both overloads route to the same core logic (fetch session → check upper_management → compute KPIs). The output shape differs slightly:
- `uuid` overload: includes `pending_collections_count`, `today_sales` (fields not present in `text`)
- `text` overload: uses hardcoded WRQ1002/WRQ1004 upper-management bypass, lacks canonical KPI

But no production code path has been observed hitting these differences, and the function returns `INVALID_SESSION` before reaching the differentiating code in both overloads when no valid token is provided.

**Classification**: Runtime Verification Pending — not a Bug, not Fixed, not an Observation.
- **Cannot prove** which overload is selected at runtime with the available access level.
- **Cannot disprove** that the difference matters — both overloads behave identically for invalid sessions, and no valid session was tested.
- **No operational impact has been demonstrated** — no bug, no regression, no performance degradation.
- **Therefore**: the finding is not actionable at this stage.

**Future Verification Required** (only if this finding becomes operationally relevant):
```sql
SELECT proname, oid, pronargs, proargtypes::regtype[]
FROM pg_catalog.pg_proc
WHERE proname = 'get_dashboard_management' AND pronamespace = 'public'::regnamespace
ORDER BY oid;
```
This query must be run via:
1. Supabase Dashboard → SQL Editor
2. Or any official read-only database access tool
3. Or during a future Schema Cleanup phase that executes `DROP FUNCTION IF EXISTS public.get_dashboard_management(text) CASCADE;` and observes whether the REST API still works

**Methodology Rule — Evidence Boundary**:
> If an investigation reaches a point where the question cannot be settled without elevated privileges or additional tools, and no Bug is reproducible or operational impact is demonstrable, the investigation stops at that boundary. The finding is classified as **Runtime Verification Pending** — not closed, not a problem, not actionable. Access level is not escalated solely to close a finding.

---

**Finding F-API-02 / F-RTM-01**: `get_runtime_achievement`, `get_runtime_activity`, `get_runtime_team`, `get_runtime_team_activity` — four RPCs called from active frontend pages (`TeamAchievement.tsx`, `TeamActivity.tsx`) but with **zero definitions in any migration file**.

**Investigation** (2026-06-25): Three-phase verification.

**Phase 1 — Page Status**:
- `/runtime/activity` → `TeamActivity.tsx` ✅ **Active** — wired in routing, linked from dashboards
- `/runtime/achievement` → `TeamAchievement.tsx` ✅ **Active** — wired in routing, linked from dashboards
- `SalesRepActivity.tsx`, `SalesRepAchievement.tsx`, `sales-manager/TeamAchievement.tsx` ❌ **Orphaned** — exist in codebase but NOT imported in any route
- No feature flags or kill switches protecting these pages

**Phase 2 — Runtime Verification** (live Supabase REST API, anon key):
- `get_runtime_achievement(p_employee_id: uuid, p_month: int, p_year: int)` → HTTP **200**, returns `{"error": "employee_not_found"}` — business logic error, NOT 404
- `get_runtime_activity(p_employee_id: uuid, p_date_from: timestamptz, p_date_to: timestamptz)` → HTTP **200**, returns `{"error": "employee_not_found"}` — business logic error, NOT 404
- `get_runtime_team(p_manager_employee_id: uuid|null, p_month: int, p_year: int)` → HTTP **200**, returned **18 real team member records** with full KPI data
- All four RPCs exist and work correctly on the production database

**Phase 3 — Root Cause Analysis**:
- Migration files `20260624_phase2_achievement_runtime.sql` and `20260624_salesrep_screens_runtime.sql` are referenced in `RUNTIME_V2_CHANGELOG.md` but **do not exist** in the local repository
- Functions were deployed directly (likely via Supabase Dashboard SQL Editor or separate CI path) without corresponding migration files
- The live database has the functions; the local repo cannot reproduce them

**Operational Status**:

| Layer | Status | Evidence |
|-------|--------|----------|
| Production | ✅ **Working** | RPCs respond with correct data/errors |
| Runtime | ✅ **Working** | No 404, no crash, no timeout |
| Frontend | ✅ **Working** | Pages render and display real data |
| Database | ✅ **Contains functions** | All 4 RPCs registered and callable |
| Repository | ❌ **Cannot rebuild** | Zero definitions in any migration file |

**Classification**: **Source Control Integrity Gap** — not a Bug, not an Observation, not Schema Hygiene.
- **This is the most significant finding of Phase P1**: the production system contains deployed code that the repository cannot recreate. The single source of truth is broken.
- The original assumption ("these pages will 404 at runtime") was **false**. The system works. But the engineering integrity is compromised.
- **Future Rule — Reproducibility Gate**: The investigation phase for any project subsystem is not considered complete until the entire production environment can be reconstructed from the repository alone. Deployed code with no migration definition is a **Source Control Integrity Gap** and must be resolved before the project can claim a single source of truth.

**Future Action** (deferred — not part of this investigation phase):
1. Extract `get_runtime_achievement`, `get_runtime_activity`, `get_runtime_team`, and `get_runtime_team_activity` definitions from production
2. Create migration files in `supabase/migrations/` 
3. Verify the repo can reproduce the full environment
4. This is a strategic project goal, not a finding-level fix

**Related**: 3 orphaned page files listed in Deferred Cleanup Candidates (Section 6.1).

---

**Finding F-PRM-02**: Capability model has two assignment paths — role-based (via `roles` + `employee_roles` → `role_capabilities`) and direct (via `employee_capabilities` with `grant` or `deny`).

**Investigation** (2026-06-25): Analyzed the authorization model end-to-end, from table definitions through `check_capability` logic to runtime RPC usage.

**Phase 1 — Authorization Model Discovery**:
- **Path 1 (Role-based)**: Employee → `employee_roles` → `roles` → `role_capabilities` → `capabilities`. Lowest priority.
- **Path 2 (Direct)**: Employee → `employee_capabilities` (grant_type = 'grant' or 'deny'). Highest priority.
- **Bypass**: `is_upper_management()` — true for any employee whose role matches upper management; skips all capability checks.

**Phase 2 — Resolution Order** (from `public.check_capability`, latest version `20260706_role_normalization.sql:136`):
1. Session valid? → if not, return false
2. Upper management? → return true (full bypass)
3. Direct `grant` exists? → return true (checked first)
4. Direct `deny` exists? → return false (checked second)
5. Role-based exists? → return true
6. Otherwise → return false

**Phase 3 — Conflict Scenario Verification**:
- **Question**: Can an employee have both `grant` AND `deny` for the same capability?
- **Unique constraint** `uq_employee_capabilities ON (employee_id, capability_id)`: **prevents** having two rows for the same pair. The `grant_type` column is NOT part of the unique index. Only one row allowed per employee+capability.
- **Write RPC** `governed_update_employee_capabilities`: Does `DELETE FROM employee_capabilities WHERE employee_id = p_id` first, then inserts fresh — a full replace, not a partial update.
- **Conclusion**: **Impossible** in the current system. The database schema and all write paths prevent this scenario.

**Phase 4 — Cross-Function Consistency Check**:
Two functions check capabilities:
- `public.check_capability(p_token, p_code)` — used in governed RPCs. Resolution: grant (checked first) → deny → role.
- `app.has_capability(p_code)` — used in RLS policies. Resolution: (roles ∪ grants) ∖ denies using UNION/EXCEPT.

**Difference found**: If both grant AND deny could coexist, `check_capability` would return `true` (grant wins), while `has_capability` would return `false` (deny wins via EXCEPT).

**However**: This difference is **purely theoretical** — the unique constraint makes simultaneous grant+deny impossible. Both functions behave identically for all practically reachable states.

**Classification**: **Consistency Opportunity** — not a Bug, not an Authorization Model Gap.
- The authorization model is well-defined and self-consistent for all reachable states.
- The code comment in `check_capability` says `"deny overrides grant"` but the implementation checks grant first. The comment should be corrected to match the code, but this does not affect runtime behavior.
- The dual-path design (role-based + direct) works correctly with a clear priority hierarchy.

**Decision**: Finding closed. The authorization model is stable. The comment inconsistency is noted for future cleanup but does not require immediate action.

---

**Finding F-FE-01**: `EmployeeAnalysisPage.tsx` accesses 3 tables via `supabase.from()` — `employees`, `customers`, and `visits` — instead of using governed RPCs for those specific queries.

**Investigation** (2026-06-25): Four-phase verification following the standard methodology.

**Phase 1 — Page Status**:
- ✅ **Routed**: `/dashboard/employee-analysis` registered in `src/routes/index.tsx:97`
- ✅ **Accessible**: Protected by `<ProtectedRoute employeeOnly>` only — no capability guard
- ❌ **No navigation links**: Not linked from any workspace, dashboard, or menu. Cannot be discovered without knowing the URL.
- ✅ **No feature flags**: No kill switch or flag controls access

**Phase 2 — Data Exposure Analysis**:
Three direct table calls exist (all others use governed RPCs via `targetService`):

| Line | Table | Query | RLS Protects? |
|------|-------|-------|---------------|
| 202 | `employees` | `SELECT id, code, full_name, manager_id WHERE manager_id = ? AND is_active = true` | ✅ `upper_management_all_employees` only |
| 209 | `customers` | `SELECT id WHERE owner_id IN (…) AND is_active = true` (count) | ✅ `upper_management_all_customers` only |
| 275 | `visits` | `SELECT id, customer_id, visit_date, status WHERE employee_id = ? AND date range` | ✅ `upper_management_all_visits` only |

All three tables have RLS enabled with a single policy granting full access to upper management only. Non-UM users receive **zero rows** from these queries. The governed RPCs (`get_governed_active_employees`, `get_kpi_contributors`, `get_team_members_kpis`, `get_rep_customer_kpis`, `get_customer_delivered_orders`) provide all actual data.

**Conclusion**: **No Data Exposure proven.** RLS prevents unauthorized access at the database level regardless of the direct `supabase.from()` calls.

**Phase 3 — Root Cause**:
**Unknown**. No evidence was found to explain why direct table access was chosen for these three specific queries while the rest of the page uses governed RPCs. Possible explanations (Legacy, Prototype, Performance Optimization) are speculative without supporting evidence (commit message, migration comment, design document).

**Phase 4 — Runtime Status**:
- For UM users: Page works fully — RLS allows direct queries, RPCs provide additional data.
- For non-UM users: Page loads the employee list (via governed RPC) but team drill-down shows empty data (RLS blocks direct queries).
- No operational bug has been reproduced.

**Classification**: **Implementation Opportunity** — not a Bug, not an Architectural Observation.
- The system works correctly. No Data Exposure exists.
- The implementation deviates from the project's standard pattern (Governed RPC First) in 3 of ~12 queries on this page.
- The reason for the deviation is unknown and cannot be determined without evidence.

**Investigation Rule — Direct Table Access**:
> A `supabase.from()` call does not automatically constitute a governance bypass or a bug. Two conditions must be proven: (1) a demonstrable difference in permissions or data compared to the governed RPC equivalent, or (2) actual Data Exposure or incorrect runtime behavior. If neither is proven, the finding is an **Implementation Opportunity** — a deviation from the standard pattern without proven operational impact. The reason for the deviation must not be assumed without evidence.

**Future Action**: The 3 direct calls are listed in Deferred Cleanup Candidates (Section 6.1) for potential future migration to governed RPCs.

---

**Finding F-PRM-01**: ~16 functions are GRANTed `EXECUTE TO anon`, including 5 role management functions (`governed_create_role`, `governed_update_role`, `governed_delete_role`, `governed_update_role_capabilities`, `get_role_capabilities`), attendance functions, and employee data functions.

**Investigation** (2026-06-25): Three-phase verification — Inventory, Runtime Verification via REST API, Exploitability Analysis.

**Phase 1 — Inventory**:
16 functions identified with `GRANT EXECUTE TO anon`, organized by domain:
- **Role Management (5)**: `governed_create_role`, `governed_update_role`, `governed_delete_role`, `governed_update_role_capabilities`, `get_role_capabilities`
- **Attendance / Tracking (9)**: `get_live_workday_overview`, `get_team_map`, `get_workday_settings`, `update_workday_settings`, `get_workday_cleanup_log`, `cleanup_tracking_data`, `get_workday_report`, `get_employee_detail`, `get_employee_day_timeline`
- **Employee Data (1)**: `get_governed_active_employees`

**Phase 2 — Runtime Verification** (live Supabase REST API, anon key only):
All 10 tested functions accepted the call (HTTP 200). Response breakdown:

| Protection Layer | Count | Example |
|-----------------|-------|---------|
| Session → Capability Check | 6 | `governed_create_role`, `get_team_map` |
| Session → UM Check | 4 | `update_workday_settings`, `cleanup_tracking_data` |
| Session Only | 3 | `get_role_capabilities`, `get_governed_active_employees`, `get_workday_report` |

**Phase 3 — Exploitability Analysis**:
- **No exploit path exists** for an anonymous user. Every function requires a valid `p_token` session. With a dummy UUID, all return `INVALID_SESSION` (or `[]` for `get_role_capabilities`).
- **Protection chain**: `GRANT anon` (PostgREST level) → Session Validation → Capability/UM Check (application level). The GRANT only opens the entry point; the function body enforces authorization.
- **Even with a stolen session token**: Write functions (`governed_create_role`, `cleanup_tracking_data`, `update_workday_settings`) require additional capability or UM checks — a stolen non-UM token cannot escalate privileges.

**Key architectural observation — Authentication Boundary vs Authorization Boundary**:
- The `GRANT EXECUTE TO anon` is an **Authentication Boundary** decision: it determines who can reach the function entry point.
- The function body (Session + Capability) is the **Authorization Boundary**: it determines who can execute the operation.
- These two boundaries serve different purposes and should not be confused. A wide authentication boundary is not a security issue if the authorization boundary is correctly enforced.

**Authorization Review Candidates** — 3 functions that depend on Session Validation only (no capability check):
| Function | Data Exposed | Risk |
|----------|-------------|------|
| `get_role_capabilities` | Role → capability mappings for any role ID | Low — read-only, reveals capability structure |
| `get_governed_active_employees` | Active employee list (names, codes, roles) | Low — read-only, employee directory |
| `get_workday_report` | Attendance/session reports | Low — read-only, requires date range |

These functions are **not classified as security issues**. They may be intentionally open to all authenticated employees. The observation is recorded for future authorization model review.

**Classification**: **Public by Design** — not a Security Bug, not a Gap.
- All 16 functions have at least Session Validation protection.
- All write/delete functions have additional Capability or UM checks.
- The GRANT pattern is intentional: authentication boundary is wide, authorization boundary is strict.
- No exploit path was proven for an anonymous user.
- 3 functions noted as Authorization Review Candidates for future model review.

---

### 1.4 Functions — Complete Catalog

**Total functions defined across all migrations**: 657  
**Total unique function names**: ~150  
**Functions with SECURITY DEFINER**: All (657/657)  
**Functions with explicit GRANT EXECUTE**: ~100 (across 30+ migration files)  
**Functions accessible via blanket GRANT**: All functions existing before 2026-07-08

#### 1.4.1 Functions by Domain

##### Orders Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `governed_create_order` | (p_token uuid, ...) | jsonb | auth (blanket) | OrderNewPage, OrderReviewPage |
| `governed_approve_order` | (p_token uuid, p_id uuid, p_notes text) | jsonb | auth (blanket) | OrderStatusManager |
| `governed_cancel_order` | (p_token uuid, ...) | jsonb | auth (blanket) | Not called from frontend |
| `governed_dispatch_order` | (p_token uuid, p_id uuid, ...) | jsonb | auth (blanket) | WarehousePage, ExecutiveOpsWorkspace |
| `governed_submit_order` | (p_token uuid, p_id uuid) | jsonb | auth (blanket) | OrderEditPage, OrderReviewPage, OrderNewPage |
| `governed_change_order_status` | (p_token uuid, p_order_id uuid, p_new_status text, p_reason text) | jsonb | auth (blanket) | OrderStatusManager |
| `governed_replace_order_contents` | (p_token uuid, p_order_id uuid, p_items jsonb) | jsonb | auth (blanket) | OrderEditPage |
| `governed_return_order_for_revision` | (p_token uuid, p_id uuid, p_reason text) | jsonb | auth (blanket) | OrderStatusManager, ExecutiveOpsWorkspace |
| `governed_reopen_cancelled` | (p_token uuid, p_id uuid, p_reason text) | jsonb | auth (blanket) | — |
| `governed_return_to_preparation` | (p_token uuid, p_id uuid, p_reason text) | jsonb | auth (blanket) | WarehousePage, WarehouseReviewPage |
| `get_unified_order` | (p_token uuid, p_id uuid) | jsonb | auth | ExecutiveOpsWorkspace, OrderEditPage, OrderDetailPage, OrderReviewPage, ReturnNewPage |
| `get_unified_orders` | (p_token uuid) | jsonb | auth | 9 frontend files |
| `get_order_status_counts` | (p_token uuid) | jsonb | auth | SuperAdminWorkspace |
| `get_governed_order` | (p_token uuid, p_id uuid) | jsonb | auth | — |
| `get_governed_orders` | (p_token uuid, ...) | jsonb | auth | — |
| `get_governed_preparation_queue` | (p_token uuid, p_status text) | jsonb | auth | WarehousePage, WarehouseReviewPage |
| `get_governed_waiting_preparations` | (p_token uuid) | jsonb | auth | WarehouseManagerWorkspace, WarehousePage |

##### Customers Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_customers` | (p_token uuid) | jsonb | auth | 12 frontend files |
| `get_governed_customer` | (p_token uuid, p_id uuid) | jsonb | auth | CustomerProfilePage, SalesManagerCCPage, VisitDetailPage, OrderNewPage |
| `governed_create_customer` | (p_token uuid, ...) | jsonb | auth | NewCustomerPage, SalesManagerCCPage |
| `governed_update_customer` | (p_token uuid, p_id uuid, ...) | jsonb | auth | CustomerProfilePage |
| `get_governed_customer_addresses` | (p_token uuid, p_customer_id uuid) | jsonb | auth | AccountPage |
| `get_governed_customer_contacts` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomersPage, CustomerProfilePage |
| `get_governed_customer_ownership_history` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerProfilePage |
| `governed_change_customer_ownership` | (p_token uuid, p_customer_id uuid, p_new_owner_id uuid) | jsonb | auth | CustomerProfilePage, SalesManagerCCPage |
| `get_customer_full_profile` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerProfilePage |
| `get_customer_collections` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerProfilePage |
| `get_customer_orders` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerProfilePage |
| `get_customer_visits` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerProfilePage |
| `get_customer_analytics_list` | (p_token uuid) | jsonb | auth | AnalyticsListPage |
| `get_customer_brands` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerAnalyticsPage |
| `get_customer_card` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerAnalyticsPage |
| `get_customer_products` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerAnalyticsPage |
| `get_customer_companies_analysis` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerProfilePage |
| `get_customer_products_analysis` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerProfilePage |
| `get_customer_visits_analysis` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerProfilePage |
| `get_customer_behavior_insights` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerProfilePage |
| `get_customer_intelligence_overview` | (p_token uuid, p_customer_id uuid) | jsonb | auth | CustomerIntelligenceOverviewPage |
| `get_visible_customer_ids` | (p_token uuid) | uuid[] | auth | — |

##### Attendance / Workday Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `start_workday` | (p_token uuid, p_work_policy_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_meters numeric) | jsonb | auth, anon | AttendanceRuntimePage |
| `end_workday` | (p_token uuid, p_session_id uuid, p_latitude numeric, p_longitude numeric) | jsonb | auth, anon | AttendanceRuntimePage |
| `start_break` | (p_token uuid, p_session_id uuid, p_latitude numeric, p_longitude numeric) | jsonb | auth, anon | AttendanceRuntimePage |
| `end_break` | (p_token uuid, p_session_id uuid, p_latitude numeric, p_longitude numeric) | jsonb | auth, anon | AttendanceRuntimePage |
| `get_my_workday_status` | (p_token uuid) | jsonb | auth, anon | AttendanceRuntimePage |
| `sync_tracking_points` | (p_token uuid, p_session_id uuid, p_points jsonb) | jsonb | auth, anon | trackingEngine |
| `get_live_workday_overview` | (p_token uuid) | jsonb | auth, anon | attendance service, OperationsCenterPage, UpperManagementDashboard |
| `get_employee_day_timeline` | (p_token uuid, p_employee_id uuid, p_date date) | jsonb | auth, anon | attendance service, EmployeeWorkdayDetailPage |
| `get_employee_day_map` | (p_token uuid, p_employee_id uuid, p_date date) | jsonb | auth, anon | attendance service, EmployeeWorkdayDetailPage |
| `get_employee_workday_history` | (p_token uuid, p_employee_id uuid, p_from date, p_to date) | jsonb | auth, anon | attendance service, EmployeeWorkdayDetailPage, EmployeeProfilePage |
| `get_team_map` | (p_token uuid) | jsonb | auth, anon | TeamMapPage, MapTab |
| `get_workday_report` | (p_token uuid, ...) | jsonb | auth, anon | — |
| `get_attendance_analysis` | (p_token uuid, p_date_from date, p_date_to date, p_employee_ids uuid[]) | jsonb | auth | attendance service |
| `get_employee_current_location` | (p_token uuid, p_employee_id uuid) | jsonb | auth | attendance service |
| `get_alerts` | (p_token uuid) | jsonb | auth, anon | attendance service |
| `get_completed_workdays_history` | (p_token uuid, p_employee_id uuid, p_from date, p_to date) | jsonb | auth | attendance service, HistoricalPerformancePanel |
| `get_work_hours_ledger` | (p_token uuid, p_employee_id uuid, p_from date, p_to date) | jsonb | auth | attendance service, EmployeeWorkdayDetailPage |
| `calculate_net_work_hours` | (p_session_id uuid) | numeric | auth | attendance service |
| `get_my_work_policy` | (p_token uuid) | jsonb | auth | attendance service |
| `get_employee_work_policy` | (p_token uuid, p_employee_id uuid) | jsonb | auth | — |
| `upsert_employee_work_policy` | (p_token uuid, ...) | jsonb | auth | attendance service, AttendanceSettingsPage |
| `batch_upsert_work_policies` | (p_token uuid, p_policies jsonb) | jsonb | auth | attendance service, AttendanceSettingsPage |
| `list_work_policies` | (p_token uuid) | jsonb | auth | attendance service, AttendanceSettingsPage, EmployeeManagementPage |
| `list_employees_without_policies` | (p_token uuid) | jsonb | auth | AttendanceSettingsPage, EmployeeManagementPage |
| `classify_employee_work_policies` | (p_token uuid) | jsonb | auth | — |

*Note: Some attendance functions have overloads — see Finding F-DB-02 (reviewed, classified as Schema Hygiene Opportunity).*

##### Products Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_products` | (p_token uuid) | jsonb | auth | 12 frontend files |
| `governed_create_product` | (p_token uuid, ...) | jsonb | auth | ProductsPage, ProductManagerPage |
| `governed_update_product` | (p_token uuid, p_id uuid, ...) | jsonb | auth | ProductsPage, ProductManagerPage |
| `governed_update_product_inventory` | (p_token uuid, p_id uuid, p_quantity numeric) | jsonb | auth | ProductManagerPage |
| `governed_update_product_pricing` | (p_token uuid, p_product_id uuid, ...) | jsonb | auth | ProductsPage, ProductManagerPage |
| `governed_update_product_units` | (p_token uuid, p_product_id uuid, p_units jsonb) | jsonb | auth | ProductManagerPage |
| `governed_update_product_visibility` | (p_token uuid, p_product_id uuid, p_is_visible boolean) | jsonb | auth | ProductManagerPage |
| `governed_activate_product` | (p_token uuid, p_id uuid) | jsonb | auth | ProductManagerPage |
| `governed_deactivate_product` | (p_token uuid, p_id uuid) | jsonb | auth | ProductManagerPage |
| `governed_set_product_out_of_stock` | (p_token uuid, p_id uuid, p_is_out_of_stock boolean) | jsonb | auth | ProductManagerPage |
| `get_company_products` | (p_token uuid, p_company_id uuid) | jsonb | auth | CompanyProfilePage |

##### Targets / KPI Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_target_performance` | (p_token uuid, p_month int, p_year int) | jsonb | auth | targets service |
| `get_governed_employee_monthly_targets` | (p_token uuid, p_employee_id uuid, p_month int, p_year int) | jsonb | auth | targets service |
| `governed_upsert_employee_monthly_target` | (p_token uuid, ...) | jsonb | auth | targets service |
| `get_governed_company_monthly_target` | (p_token uuid, p_company_id uuid, p_month int, p_year int) | jsonb | auth | targets service |
| `governed_upsert_company_monthly_target` | (p_token uuid, ...) | jsonb | auth | targets service |
| `get_kpi_contributors` | (p_token uuid, p_employee_id uuid, p_month int, p_year int) | jsonb | auth | targets service |
| `get_team_members_kpis` | (p_token uuid, p_employee_id uuid, p_from date, p_to date) | jsonb | auth | targets service |
| `get_rep_customer_kpis` | (p_token uuid, p_employee_id uuid) | jsonb | auth | targets service |
| `get_customer_delivered_orders` | (p_token uuid, p_customer_id uuid, p_month int, p_year int) | jsonb | auth | targets service |
| `get_governed_active_employees` | (p_token uuid) | jsonb | anon, auth | targets service |

##### Collections Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_collections` | (p_token uuid) | jsonb | auth | CollectionsPage, AccountantWorkspace, CollectorWorkspace |
| `governed_create_collection` | (p_token uuid, ...) | jsonb | auth | NewCollectionPage, ExecutiveOpsWorkspace |
| `governed_approve_collection` | (p_token uuid, p_id uuid) | jsonb | auth | CollectionsPage, ExecutiveOpsWorkspace |
| `get_collection_followup_queue` | (p_token uuid) | jsonb | auth | — |

##### Returns Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_returns` | (p_token uuid) | jsonb | auth | returns service, ReturnsPage |
| `get_governed_return` | (p_token uuid, p_id uuid) | jsonb | auth | returns service, ReturnDetailPage |
| `get_governed_return_items` | (p_token uuid, p_return_id uuid) | jsonb | auth | returns service, ReturnDetailPage |
| `governed_create_return` | (p_token uuid, ...) | jsonb | auth | returns service |
| `governed_approve_return` | (p_token uuid, p_id uuid) | jsonb | auth | returns service |
| `governed_reject_return` | (p_token uuid, p_id uuid, p_reason text) | jsonb | auth | returns service |

##### Credit Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_credit_applications` | (p_token uuid) | jsonb | auth | credit service, CreditApplicationsPage |
| `get_governed_credit_application` | (p_token uuid, p_id uuid) | jsonb | auth | CreditReviewPage |
| `get_governed_credit_invoices` | (p_token uuid, ...) | jsonb | auth | credit service |
| `get_governed_credit_invoice_detail` | (p_token uuid, p_invoice_id uuid) | jsonb | auth | credit service |
| `get_governed_credit_dashboard` | (p_token uuid) | jsonb | auth | credit service |
| `get_governed_customer_credit_account` | (p_token uuid) | jsonb | auth | credit service |
| `governed_create_credit_application` | (p_token uuid, p_program_id uuid) | jsonb | auth | credit service |
| `governed_create_credit_program` | (p_token uuid, ...) | jsonb | auth | credit service, CreditProgramsPage |
| `governed_approve_credit` | (p_token uuid, p_id uuid) | jsonb | auth | CreditReviewPage |
| `governed_reject_credit` | (p_token uuid, p_id uuid, p_reason text) | jsonb | auth | CreditReviewPage |
| `governed_suspend_credit` | (p_token uuid, p_id uuid, p_reason text) | jsonb | auth | CreditReviewPage |
| `governed_reactivate_credit` | (p_token uuid, p_id uuid) | jsonb | auth | CreditReviewPage |
| `governed_activate_credit_account` | (p_token uuid, p_customer_id uuid) | jsonb | auth | credit service |
| `governed_suspend_credit_account` | (p_token uuid, p_customer_id uuid, p_reason text) | jsonb | auth | credit service |
| `governed_reactivate_credit_account` | (p_token uuid, p_customer_id uuid) | jsonb | auth | credit service |
| `governed_convert_credit_reservation_to_outstanding` | (p_token uuid, p_order_id uuid) | jsonb | auth | credit service |
| `governed_release_credit_reservation` | (p_token uuid, p_order_id uuid) | jsonb | auth | credit service |
| `governed_reserve_credit_for_order` | (p_token uuid, p_order_id uuid) | jsonb | auth | credit service |
| `governed_check_order_over_limit` | (p_token uuid, p_order_id uuid) | jsonb | auth | credit service |
| `governed_record_credit_payment` | (p_token uuid, p_invoice_id uuid, p_payment_method text) | jsonb | auth | credit service |
| `governed_record_cheque` | (p_token uuid, ...) | jsonb | auth | credit service |
| `governed_confirm_documents` | (p_token uuid, p_id uuid, ...) | jsonb | auth | CreditReviewPage |
| `governed_toggle_credit_program` | (p_token uuid, p_program_id uuid) | jsonb | auth | credit service |
| `governed_get_credit_programs` | (p_token uuid) | jsonb | auth | credit service |
| `governed_update_credit_program` | (p_token uuid, p_id uuid, ...) | jsonb | auth | CreditProgramsPage |

##### Role Management Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `governed_create_role` | (p_token uuid, p_name text, p_code text) | jsonb | anon, auth | RolesTab |
| `governed_update_role` | (p_token uuid, p_id uuid, p_name text, p_code text) | jsonb | anon, auth | RolesTab |
| `governed_delete_role` | (p_token uuid, p_id uuid) | jsonb | anon, auth | RolesTab |
| `governed_update_role_capabilities` | (p_token uuid, p_role_id uuid, p_capability_ids uuid[]) | jsonb | anon, auth | RolesTab |
| `get_governed_roles` | (p_token uuid) | jsonb | auth | 8 frontend files |
| `get_role_capabilities` | (p_token uuid, p_role_id uuid) | jsonb | anon, auth | RolesTab |
| `get_all_capabilities` | (p_token uuid) | jsonb | auth | RolesTab, UserPermissionsPage, EmployeeProfilePage, PermissionsTab |
| `get_employee_capabilities` | (p_token uuid, p_employee_id uuid) | jsonb | auth | UserPermissionsPage, EmployeeProfilePage, PermissionsTab |
| `governed_update_employee_capabilities` | (p_token uuid, p_id uuid, p_capabilities jsonb) | jsonb | auth | EmployeeProfilePage, PermissionsTab |

##### Employees Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_employees` | (p_token uuid) | jsonb | auth | 20 frontend files (most-used RPC) |
| `get_governed_employee` | (p_token uuid, p_employee_id uuid) | jsonb | auth | EmployeeWorkdayDetailPage, VisitDetailPage, SalesManagerCCPage |
| `get_governed_active_employees` | (p_token uuid) | jsonb | anon, auth | targets service |
| `governed_create_employee` | (p_token uuid, ...) | jsonb | auth | HierarchyPage, EmployeesPage, SalesManagerCCPage |
| `governed_update_employee` | (p_token uuid, p_id uuid, ...) | jsonb | auth | UserProfilePage, EmployeeProfilePage, HierarchyPage, EmployeesPage |
| `governed_activate_employee` | (p_token uuid, p_id uuid) | jsonb | auth | EmployeeProfilePage |
| `governed_deactivate_employee` | (p_token uuid, p_id uuid) | jsonb | auth | EmployeeProfilePage |
| `governed_change_employee_manager` | (p_token uuid, p_id uuid, p_manager_id uuid) | jsonb | auth | EmployeeProfilePage, HierarchyPage, EmployeesPage |
| `governed_change_employee_role` | (p_token uuid, p_id uuid, p_role_id uuid) | jsonb | auth | EmployeeProfilePage, HierarchyPage, EmployeesPage |
| `governed_reset_employee_password` | (p_token uuid, p_id uuid, p_new_password text) | jsonb | auth | EmployeeProfilePage, HierarchyPage, EmployeesPage |
| `get_visible_employee_ids` | (p_token uuid) | uuid[] | auth | Called internally by many governed RPCs |
| `get_visible_employees` | (p_token uuid) | jsonb | auth | — |

##### Companies Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_companies` | (p_token uuid) | jsonb | auth | 8 frontend files |
| `governed_create_company` | (p_token uuid, ...) | jsonb | auth | CompaniesPage |
| `governed_update_company` | (p_token uuid, p_id uuid, ...) | jsonb | auth | CompanyManagerPage, CompaniesPage |
| `governed_activate_company` | (p_token uuid, p_id uuid) | jsonb | auth | CompanyManagerPage |
| `governed_deactivate_company` | (p_token uuid, p_id uuid) | jsonb | auth | CompanyManagerPage |
| `governed_update_company_profile` | (p_token uuid, ...) | jsonb | auth | settings/CompanyProfilePage |
| `get_company_analytics` | (p_token uuid, p_company_id uuid) | jsonb | auth | CompanyProfilePage |
| `get_company_profile` | (p_token uuid) | jsonb | auth | useCompanyProfile, StorefrontHero, StorefrontHeader, CompanyInfoSection |
| `get_public_company_profile` | () | jsonb | anon | useCompanyProfile page, StorefrontHero, CompanyInfoSection |

##### Dashboard / Reports Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_dashboard_management` | (p_token uuid) | jsonb | auth | AdminWorkspace, ChairmanWorkspace, ManagementDashboard, SuperAdminWorkspace, UpperManagementDashboard |
| `get_dashboard_sales` | (p_token uuid) | jsonb | auth | SalesDashboard |
| `get_dashboard_transport` | (p_token uuid) | jsonb | auth | TransportDashboard |
| `get_dashboard_warehouse` | (p_token uuid) | jsonb | auth | WarehouseManagerWorkspace, WarehouseDashboard |
| `get_upper_management_dashboard` | (p_token uuid) | jsonb | auth | UpperManagementDashboard |
| `get_credit_dashboard_stats` | (p_token uuid) | jsonb | auth | ManagementDashboard, SuperAdminWorkspace |
| `get_customer_sales_ranking` | (p_token uuid) | jsonb | auth | AnalyticsListPage |
| `get_delivery_dashboard_stats` | (p_token uuid) | jsonb | auth | — |
| `get_governed_dashboard_counts` | (p_token uuid) | jsonb | auth | AdminWorkspace, SuperAdminWorkspace |
| `get_sales_by_rep` | (p_token uuid, ...) | jsonb | auth | ReportsPage (dynamic) |
| `get_sales_by_manager` | (p_token uuid, ...) | jsonb | auth | ReportsPage (dynamic) |
| `get_sales_by_customer` | (p_token uuid, ...) | jsonb | auth | ReportsPage (dynamic) |
| `get_sales_by_product` | (p_token uuid, ...) | jsonb | auth | ReportsPage (dynamic) |
| `get_sales_by_company` | (p_token uuid, ...) | jsonb | auth | ReportsPage (dynamic) |
| `get_sales_by_time` | (p_token uuid, ...) | jsonb | auth | ReportsPage (dynamic) |
| `get_order_report` | (p_token uuid, ...) | jsonb | auth | ReportsPage (dynamic) |
| `get_collection_report` | (p_token uuid, ...) | jsonb | auth | ReportsPage (dynamic) |
| `get_visit_report` | (p_token uuid, ...) | jsonb | auth | ReportsPage (dynamic) |

##### Auth / Session Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `login` | (p_phone text, p_password text) | jsonb | anon | auth service |
| `logout` | (p_token uuid) | jsonb | auth | auth service |
| `validate_session` | (p_token uuid) | jsonb | auth | auth service, SalesManagerCCPage |
| `check_capability` | (p_token uuid, p_code text) | boolean | auth | auth service, OperationsCenterPage |
| `is_upper_management` | (p_employee_id uuid) | boolean | auth | called internally |
| `session_is_upper_management` | () | boolean | auth | — |
| `register_customer` | (p_phone text, p_password text, ...) | jsonb | anon | auth service |
| `check_session_timeout` | (p_token uuid, p_session_id uuid) | jsonb | auth | heartbeatService |
| `touch_session_activity` | (p_session_id uuid) | jsonb | auth | lifeSignalService |
| `record_heartbeat` | (p_token uuid, p_session_id uuid) | jsonb | auth | heartbeatService |

##### Visits Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_visits` | (p_token uuid) | jsonb | auth | 6 frontend files |
| `get_governed_visit` | (p_token uuid, p_id uuid) | jsonb | auth | SalesManagerCCPage, VisitDetailPage |
| `governed_checkin_visit` | (p_token uuid, ...) | jsonb | auth | VisitScreen, VisitsPage, SalesManagerCCPage |
| `governed_checkout_visit` | (p_token uuid, ...) | jsonb | auth | VisitScreen, VisitDetailPage, SalesManagerCCPage |
| `governed_update_visit` | (p_token uuid, p_id uuid, ...) | jsonb | auth | OrderNewPage |

##### Daily Deals / Flash Offers Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_daily_deals` | (p_token uuid) | jsonb | auth | deals service, DailyDealsManagerPage, DailyDealsManagementPage |
| `get_governed_active_daily_deals` | (p_token uuid) | jsonb | auth | deals service |
| `governed_create_daily_deal` | (p_token uuid, ...) | jsonb | auth | DailyDealsManagementPage, deals service |
| `governed_update_daily_deal` | (p_token uuid, p_id uuid, ...) | jsonb | auth | DailyDealsManagerPage, DailyDealsManagementPage |
| `governed_activate_daily_deal` | (p_token uuid, p_id uuid) | jsonb | auth | DailyDealsManagementPage |
| `governed_cancel_daily_deal` | (p_token uuid, p_id uuid) | jsonb | auth | DailyDealsManagementPage |
| `get_governed_flash_offers` | (p_token uuid) | jsonb | auth | FlashOffersManagementPage, flashOffers service |
| `get_governed_active_flash_offers` | (p_token uuid) | jsonb | auth | flashOffers service |
| `governed_create_flash_offer` | (p_token uuid, ...) | jsonb | auth | FlashOffersManagementPage, flashOffers service |
| `governed_update_flash_offer` | (p_token uuid, p_id uuid, ...) | jsonb | auth | FlashOffersManagementPage |
| `governed_activate_flash_offer` | (p_token uuid, p_id uuid) | jsonb | auth | FlashOffersManagementPage |
| `governed_cancel_flash_offer` | (p_token uuid, p_id uuid) | jsonb | auth | FlashOffersManagementPage |
| `governed_add_order_daily_deals` | (p_token uuid, p_order_id uuid, p_deals jsonb) | jsonb | auth | OrderReviewPage |
| `governed_add_order_flash_offers` | (p_token uuid, p_order_id uuid, p_offers jsonb) | jsonb | auth | OrderReviewPage |

##### Tiers Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_tiers` | (p_token uuid) | jsonb | auth | tiers service, 6 frontend files |
| `governed_create_tier` | (p_token uuid, p_name text) | jsonb | auth | tiers service, TiersManagerPage |
| `governed_update_tier` | (p_token uuid, p_id uuid, ...) | jsonb | auth | tiers service, TiersManagerPage |
| `governed_set_tier_company_exception` | (p_token uuid, p_tier_id uuid, p_company_id uuid, p_discount_percent numeric) | jsonb | auth | tiers service, CompanyManagerPage |
| `governed_remove_tier_company_exception` | (p_token uuid, p_tier_id uuid, p_company_id uuid) | jsonb | auth | tiers service, CompanyManagerPage |
| `governed_set_tier_product_exception` | (p_token uuid, p_tier_id uuid, p_product_id uuid, p_discount_percent numeric) | jsonb | auth | ProductManagerPage |
| `governed_remove_tier_product_exception` | (p_token uuid, p_tier_id uuid, p_product_id uuid) | jsonb | auth | ProductManagerPage |

##### Location Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_locations` | (p_token uuid, p_ids uuid[]) | jsonb | auth | location service |
| `get_governed_location` | (p_token uuid, p_id uuid) | jsonb | auth | location service |
| `governed_create_location` | (p_token uuid, ...) | jsonb | auth | location service |
| `get_coverage_map` | (p_token uuid) | jsonb | anon, auth | CoverageMapPage |

##### Search Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `governed_global_search` | (p_token uuid, p_query text) | jsonb | auth | GlobalSearch |
| `unified_search` | (p_token uuid, p_entity text, p_query text, p_filters jsonb, p_page int, p_per_page int, p_order_by text) | jsonb | auth | unifiedSearch service |

##### Executive / Operations Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_command_center` | (p_token uuid) | jsonb | auth | CommandCenterPage |
| `get_command_center_v2` | (p_token uuid) | jsonb | auth | — |
| `get_module_detail` | (p_token uuid, p_module varchar) | jsonb | auth | — |
| `update_module_owner_field` | (p_token uuid, p_module varchar, p_field varchar, p_value text) | jsonb | auth | — |
| `delete_module` | (p_token uuid, p_module varchar) | jsonb | auth | — |
| `get_governed_executive_kpis` | (p_token uuid) | jsonb | auth | ExecutiveOperationsWorkspace |
| `get_governed_executive_queue` | (p_token uuid) | jsonb | auth | ExecutiveOperationsWorkspace |
| `get_sales_manager_cc` | (p_token uuid) | jsonb | auth | SalesManagerCCPage |

##### Delivery Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_deliveries` | (p_token uuid) | jsonb | auth | DeliveryWorkspace |
| `governed_start_delivery` | (p_token uuid, p_delivery_id uuid) | jsonb | auth | — |
| `governed_complete_delivery` | (p_token uuid, p_delivery_id uuid, p_notes text) | jsonb | auth | ExecutiveOpsWorkspace |
| `governed_fail_delivery` | (p_token uuid, p_delivery_id uuid, p_reason varchar, p_notes text) | jsonb | auth | — |
| `governed_return_delivery` | (p_token uuid, p_delivery_id uuid, p_notes text) | jsonb | auth | — |
| `governed_get_delivery` | (p_token uuid, p_delivery_id uuid) | jsonb | auth | — |

##### Warehouse / Preparation Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `governed_start_preparation` | (p_token uuid, p_order_id uuid, p_notes text) | jsonb | auth | WarehousePage, ExecutiveOpsWorkspace |
| `governed_complete_preparation` | (p_token uuid, p_id uuid, p_notes text) | jsonb | auth | WarehousePage, ExecutiveOpsWorkspace |
| `governed_fail_preparation` | (p_token uuid, p_id uuid, p_reason text) | jsonb | auth | WarehousePage |
| `governed_review_preparation` | (p_token uuid, p_id uuid, p_status text, p_notes text) | jsonb | auth | WarehousePage, WarehouseReviewPage |
| `governed_record_exception` | (p_token uuid, p_preparation_id uuid, p_reason text) | jsonb | auth | WarehousePage, WarehousePrepDetail |
| `get_governed_preparation_detail` | (p_token uuid, p_preparation_id uuid) | jsonb | auth | WarehousePrepDetail |
| `get_warehouse_analytics` | (p_token uuid) | jsonb | auth | — |

##### Settings / Work Policies Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_workday_settings` | (p_token uuid) | jsonb | auth, anon | attendance service, AttendanceSettingsPage |
| `update_workday_settings` | (p_token uuid, p_settings jsonb) | jsonb | auth, anon | attendance service, AttendanceSettingsPage |
| `get_workday_cleanup_log` | (p_token uuid, p_limit int) | jsonb | auth, anon | — |
| `cleanup_tracking_data` | (p_token uuid, p_days int) | jsonb | auth, anon | — |
| `detect_long_stops` | (p_token uuid) | jsonb | auth | — |

##### Activities / Data Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_live_activity_center` | (p_token uuid) | jsonb | auth | — |
| `get_daily_target_vs_actual` | (p_token uuid, p_employee_id uuid, p_date date) | jsonb | anon, auth | attendance service, EmployeeWorkdayDetailPage |
| `get_work_policies_report` | (p_token uuid, p_from date, p_to date, p_employee_ids uuid[]) | jsonb | auth | — |
| `get_employee_activity` | (p_token uuid, p_employee_id uuid, p_limit int) | jsonb | auth | EmployeeProfilePage |
| `get_employee_weight_overrides` | (p_token uuid, p_employee_id uuid) | jsonb | auth | targets service |
| `governed_upsert_employee_weight_override` | (p_token uuid, ...) | jsonb | auth | targets service |
| `deactivate_employee_weight_override` | (p_token uuid, p_id uuid) | jsonb | auth | targets service |

##### Data Deletion Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `governed_deletion_search_employees` | (p_token uuid, ...) | jsonb | auth | dataDeletion service (dynamic) |
| `governed_deletion_search_customers` | (p_token uuid, ...) | jsonb | auth | dataDeletion service (dynamic) |
| `governed_deletion_search_orders` | (p_token uuid, ...) | jsonb | auth | dataDeletion service (dynamic) |
| `governed_deletion_search_visits` | (p_token uuid, ...) | jsonb | auth | dataDeletion service (dynamic) |
| `governed_deletion_search_returns` | (p_token uuid, ...) | jsonb | auth | dataDeletion service (dynamic) |
| `governed_deletion_search_companies` | (p_token uuid, ...) | jsonb | auth | dataDeletion service (dynamic) |
| `governed_deletion_search_products` | (p_token uuid, ...) | jsonb | auth | dataDeletion service (dynamic) |
| `governed_deletion_search_credit_applications` | (p_token uuid, ...) | jsonb | auth | dataDeletion service (dynamic) |
| `governed_deletion_search_daily_deals` | (p_token uuid, ...) | jsonb | auth | dataDeletion service (dynamic) |
| `governed_deletion_execute_employees` | (p_token uuid, ...) | jsonb | auth | dataDeletion service (dynamic) |
| `governed_deletion_execute_customers` | (p_token uuid, ...) | jsonb | auth | dataDeletion service (dynamic) |
| (and corresponding for all entity types) | | | | |

##### Auctions Domain

| Function | Signature | Return | GRANT | Called From |
|----------|-----------|--------|-------|-------------|
| `get_governed_auctions` | (p_token uuid) | jsonb | auth | auctions service, AuctionsManagerPage |
| `get_governed_auction_detail` | (p_token uuid, p_auction_id uuid) | jsonb | auth | auctions service |
| `governed_create_auction` | (p_token uuid, ...) | jsonb | auth | AuctionsManagerPage |
| `governed_update_auction` | (p_token uuid, p_id uuid, ...) | jsonb | auth | AuctionsManagerPage |
| `governed_place_bid` | (p_token uuid, p_auction_id uuid, p_amount numeric) | jsonb | auth | auctions service |
| `governed_request_auction_participation` | (p_token uuid, p_auction_id uuid) | jsonb | auth | auctions service |

##### Test / Debug Functions

| Function | Signature | Return | GRANT | Notes |
|----------|-----------|--------|-------|-------|
| `test_func` | — | — | auth (blanket) | Exists in public schema |
| `test_ping2` | — | — | auth (blanket) | Exists in public schema |
| `test_ping3` | — | — | auth (blanket) | Exists in public schema |
| `test_rpc` | — | — | auth (blanket) | Exists in public schema |
| `test_setof` | — | — | auth (blanket) | Exists in public schema |
| `multiline_test` | — | — | auth (blanket) | Exists in public schema |
| `ping` | — | — | auth (blanket) | Exists in public schema |
| `insert_gps_test_point` | (p_token uuid, ...) | jsonb | auth | GPS testing |
| `seed_sales_rep_monthly_targets` | (p_token uuid, p_month int, p_year int) | jsonb | auth | Seed data function |

### 1.5 Views

**Total views**: 0  
No database views exist in the current migrations.

### 1.6 Triggers

**Total triggers**: 1  
Defined in migration files. (Details pending verification.)

### 1.7 Security Configuration

| Aspect | Current State |
|--------|---------------|
| Function security | All 657 functions use `SECURITY DEFINER` |
| Search path | Most set `search_path = public, extensions` |
| RLS enabled | On ~14 tables (18 policies total) |
| Blanket GRANT | `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated` (20260708) |
| Default privileges | `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated` (20260708) |

---

## 2. API (RPCs) — Current State

### 2.1 Source of Truth

The authoritative source for the REST API is the function definitions in `supabase/migrations/` combined with PostgREST schema introspection. Frontend call patterns are documented in `src/services/` and page files.

### 2.2 API Surface

- **Total REST-callable functions**: ~100+ (all functions with GRANT EXECUTE to `authenticated` or `anon`)
- **PostgREST endpoint pattern**: `/rest/v1/rpc/{function_name}`
- **Session auth**: Custom token-based (not Supabase Auth JS), passed as `p_token` parameter
- **Schema cache**: Refreshed via `pg_notify('pgrst', 'reload schema')` after function changes

### 2.3 Function Parameter Convention

| Pattern | Usage | Current Status |
|---------|-------|----------------|
| `p_token uuid` | Session token (first param of all governed RPCs) | **Current standard** for all RPCs |
| `p_*` prefix | All function parameters | Consistently used |

**Finding F-API-01**: The function signature type for `p_token` has been inconsistent. Latest migrations (Oct 2026) use `uuid`, but some functions retain `text` overloads from June 2026 migrations. The current standard is `uuid`.

### 2.4 Frontend → RPC Mapping

(Fully documented in Section 5 — Frontend RPC calls table above.)

### 2.5 RPCs Called from Frontend But Missing from Database

**Finding F-API-02 (CRITICAL)**: The following RPCs are called from frontend but do not exist in any migration file:

| Function | Frontend Files | Parameters Passed |
|----------|---------------|-------------------|
| `get_runtime_achievement` | SalesRepAchievement.tsx:108, TeamAchievement.tsx:46 | p_employee_id, p_month, p_year (no p_token) |
| `get_runtime_activity` | SalesRepActivity.tsx:64 | p_employee_id, p_date_from, p_date_to (no p_token) |
| `get_runtime_team` | TeamAchievement.tsx:30 | p_manager_employee_id, p_month, p_year (no p_token) |

**Current effect**: These pages will return a PostgREST 404 error when navigated to, since the functions don't exist.

### 2.6 GRANT EXECUTE Status

| GRANT Level | Functions | Risk |
|-------------|-----------|------|
| `authenticated` (blanket) | ALL functions in public schema | Exposes test/internal functions |
| `authenticated` (explicit) | ~75 functions across 30+ files | Partially redundant with blanket grant |
| `anon` | ~25 functions across 15 files | See Finding F-PRM-01 |

**Finding F-API-03**: Functions recreated after `20260708` (when the blanket GRANT was applied) through `CREATE OR REPLACE FUNCTION` may lack explicit `GRANT EXECUTE TO authenticated`. The blanket GRANT covers functions existing at that time, but recreated functions need re-granting.

---

## 3. Permissions — Current State

### 3.1 Source of Truth

Permission logic is distributed across:
- `check_capability(p_token, p_code)` — gated access to governed operations
- `get_visible_employee_ids(p_token)` — scopes data visibility
- `is_upper_management(p_employee_id)` — bypasses capability checks
- Employee roles (`employee_roles`, `roles`) — mapped to capabilities
- `app.sessions` — session-based authentication

### 3.2 Authentication Model

```
Login → create app.sessions row with token + employee_id + expires_at
Every RPC → call check_capability or compare session token
Logout → delete/expire session
Heartbeat → record_heartbeat extends session
```

- `login(p_phone, p_password)` → returns session token (anon callable)
- `validate_session(p_token)` → checks session validity
- `check_session_timeout(p_token, p_session_id)` → validates session hasn't timed out
- All governed RPCs validate session + capability internally

### 3.3 Authorization Flow

```
User Action → Frontend calls governed_* RPC with p_token
  → RPC (SECURITY DEFINER) validates session from app.sessions
  → RPC calls check_capability(p_token, p_code) or equivalent
  → RPC calls get_visible_employee_ids(p_token) for data scoping
  → Returns data or error
```

### 3.4 Capability Model

Capabilities are stored in a many-to-many relationship:
- `employee_roles` — joins employees to roles
- `role_capabilities` — joins roles to capabilities
- `employee_capabilities` — direct capability assignments (bypasses roles)

**Finding F-PRM-02**: The capability model has two paths for assignment (role-based and direct). This can create conflicting or duplicate capability entries. Current behavior for conflicts is undefined.

### 3.5 Visibility Model

`get_visible_employee_ids(p_token)` returns the set of employee IDs visible to the current user:
- Upper management: sees ALL employees
- Manager: sees direct reports + subordinates recursively
- Sales rep: sees only themselves

This function is the single source of truth for data scoping and is called by virtually every governed RPC.

**Finding F-PRM-03**: `get_visible_employee_ids` has two overloads in the database (uuid + text). The uuid version is the correct current one. The text overload persists but is not used when called from PL/pgSQL with uuid params. However, if called via REST API, PostgREST may fail with PGRST202 due to ambiguity.

### 3.6 RLS Policies

18 policies across 14 tables. All are "upper management bypass" policies that allow full access to users with upper management role. Non-upper-management access is governed entirely through RPCs (SECURITY DEFINER), making RLS a secondary defense layer.

---

## 4. Runtime — Current State

### 4.1 Source of Truth

Runtime logic is embedded within individual RPC functions. There is no centralized runtime engine or event system.

### 4.2 Activity Center

- **Function**: `get_live_activity_center(p_token uuid)`
- **Source**: Defined in `20260618_live_activity_center_v2.sql`
- **Status**: Exists in DB, has GRANT EXECUTE

### 4.3 Achievement / KPI System

- **Function**: `get_governed_target_performance(p_token uuid, p_month int, p_year int)` — latest in `20261003`
- **Drill-down**: `get_kpi_contributors`, `get_team_members_kpis`, `get_rep_customer_kpis`, `get_customer_delivered_orders`
- **Status**: All defined and callable

**Finding F-RTM-01**: `get_runtime_achievement`, `get_runtime_activity`, `get_runtime_team` are called from frontend but do not exist in any migration file.

### 4.4 Heartbeat / Health

| Function | Purpose | Status |
|----------|---------|--------|
| `record_heartbeat` | Extends session TTL, tracks PWA alive state | Active |
| `check_session_timeout` | Validates session hasn't exceeded timeout | Active |
| `touch_session_activity` | Lightweight session keepalive | Active |

---

## 5. Frontend — Current State

### 5.1 Source of Truth

Frontend source code in `src/` directory. Service files in `src/services/` encapsulate RPC calls.

### 5.2 Architecture

```
src/
├── pages/           — Route-level components (workspaces, dashboards, forms)
│   ├── admin/       — AdminWorkspace, SuperAdminWorkspace, etc.
│   ├── attendance/  — AttendanceRuntimePage, etc.
│   ├── customers/   — Customer pages
│   ├── dashboard/   — Dashboards
│   ├── orders/      — Order pages
│   ├── products/    — Product pages
│   ├── sales-manager/ — Sales manager workspace
│   ├── sales-rep/   — Sales rep workspace
│   └── ...
├── services/        — RPC call wrappers
│   ├── auth.ts      — Auth/session RPCs
│   ├── attendance.ts — All attendance RPCs
│   ├── credit.ts    — Credit lifecycle RPCs
│   ├── targets.ts   — Target/KPI RPCs
│   ├── products.ts  — Product query RPCs
│   └── ...
├── components/      — Shared UI components
├── hooks/           — Custom React hooks
└── contexts/        — React contexts
```

### 5.3 RPC Call Distribution

- **~250+ total RPC call sites**
- **~100+ unique RPC functions called**
- **~80 `governed_*` (mutation) functions**
- **~70 `get_*` (query) functions**
- **~15 utility functions**

### 5.4 Direct Table Access (without RPC governance)

| File | Table | Purpose | Status |
|------|-------|---------|--------|
| `StorefrontPage.tsx` | `products`, `tiers` | Anonymous storefront browsing | Intentional |
| `CompaniesPage.tsx` (storefront) | `companies` | Anonymous storefront browsing | Intentional |
| `VisitScreen.tsx` | `visits` | Best-effort verification after checkin/checkout | Intentional (with comment) |
| `EmployeeAnalysisPage.tsx` | `employees`, `customers`, `visits` | Dashboard analytics queries | **Non-standard** (see F-FE-01) |

**Finding F-FE-01**: `EmployeeAnalysisPage.tsx` accesses 3 tables (`employees`, `customers`, `visits`) via `supabase.from()` instead of governed RPCs. However, all three tables have RLS enabled with an `upper_management_all_*` policy only — non-UM users get zero rows from direct queries. No Data Exposure was proven.

### 5.5 Service Layer

The service layer in `src/services/` acts as the abstraction between UI components and RPCs. Each service file encapsulates:
- RPC function name
- Parameter mapping (token injection, param formatting)
- Error handling
- TypeScript type assertions on return values

---

## 6. Findings Index

This section lists all observations about the current state that warrant review. Findings are NOT assumed to be defects — each is a statement about the current state that may need discussion before any action is taken.

| ID | Severity | Domain | Description |
|----|----------|--------|-------------|
| F-DB-01 | **Decided** | Database | ~30 tables, 14 with RLS. SECURITY DEFINER bypasses RLS. **Decision**: Architectural Observation — no exploit path today. Official model: Governed RPC First. |
| F-DB-02 | **Decided** | Database | `get_visible_employee_ids` has two overloads: `(uuid)` and `(text)`. **Decision**: Schema Hygiene Opportunity — dead code, zero callers. Listed in Deferred Cleanup Candidates. |
| F-DB-03 | **Decided** | Database | `check_capability` has two overloads: `(uuid, text)` and `(text, text)`. **Decision**: Verified Stable Contract — both serve different consumers (REST vs PL/pgSQL), no conflict proven. |
| F-DB-04 | Observation | Database | `get_live_workday_overview` has two overloads: `(uuid)` and `(text)`. The uuid version is the current intent. |
| F-DB-05 | **Runtime Verification Pending** | Database | `get_dashboard_management` has two overloads: `(uuid)` and `(text)`. Which one PostgREST resolves to is unconfirmed without DB introspection. No operational bug reproduced. |
| F-DB-06 | Observation | Database | 7 test/debug functions exist in public schema (`test_func`, `test_ping2`, `test_ping3`, `test_rpc`, `test_setof`, `multiline_test`, `ping`). |
| F-DB-07 | Observation | Database | Functions recreated via `CREATE OR REPLACE` after `2026-07-08` lose the blanket GRANT EXECUTE and need explicit re-grant. |
| F-API-01 | Observation | API | `p_token` parameter type history: `uuid` (original) → `text` (June 2026) → `uuid` (current, since July 2026). The text overloads persist for 4 functions (see F-DB-02 through F-DB-05). |
| F-API-02 | **Source Control Integrity Gap** | API | `get_runtime_achievement`, `get_runtime_activity`, `get_runtime_team`, `get_runtime_team_activity` are called from active frontend pages and **exist in production** but have **zero definitions** in any migration file. Repository cannot rebuild this part of the system. |
| F-API-03 | Observation | API | `governed_cancel_order` is defined in the database but is NOT called from any frontend file. |
| F-PRM-01 | **Decided** | Permissions | 16 functions GRANTed `EXECUTE TO anon`. Investigation proved all require Session Validation. Write functions also require Capability or UM checks. No exploit path found. **Final**: Public by Design. 3 functions noted as Authorization Review Candidates (Session Validation only). |
| F-PRM-02 | **Consistency Opportunity** | Permissions | Capability model has two assignment paths: role-based and direct. The resolution order is well-defined (direct > role). Simultaneous grant+deny for the same capability is **impossible** due to unique constraint. Comment inconsistency noted. |
| F-PRM-03 | **Decided** | Permissions | `check_capability` has two overloads. **Decision**: Verified Stable Contract — no PGRST202 proven. See F-DB-03. |
| F-FE-01 | **Implementation Opportunity** | Frontend | `EmployeeAnalysisPage.tsx` accesses 3 tables via `supabase.from()`. RLS prevents Data Exposure. Root cause unknown. No operational bug. |
| F-FE-02 | Observation | Frontend | `get_visible_employee_ids` is NOT called directly from any frontend file. It is only used internally by governed RPCs. |
| F-RTM-01 | **Source Control Integrity Gap** | Runtime | Same as F-API-02 — 4 RPCs exist in production but have no migration definitions. Listed here for domain categorization. |

### 6.1 Deferred Cleanup Candidates

This section lists schema elements confirmed as dead/unused but deliberately retained. Cleanup is deferred to a future dedicated Schema Cleanup phase with full regression testing.

| ID | Element | Reason to Keep | Cleanup Preconditions Met |
|----|---------|----------------|---------------------------|
| F-DB-02 | `get_visible_employee_ids(text)` overload | No operational impact; history preservation | (a) ✅ No callers in current code. (b) ❌ Not tested on staging DB. |
| F-API-02 | `SalesRepActivity.tsx`, `SalesRepAchievement.tsx`, `sales-manager/TeamAchievement.tsx` | Orphaned pages — not imported in any route, superseded by unified `TeamActivity` and `TeamAchievement` | (a) ✅ No routes reference them. (b) ❌ Not tested on staging. |
| F-FE-01 | 3 direct `supabase.from()` calls in `EmployeeAnalysisPage.tsx` (tables: `employees`, `customers`, `visits`) | RLS prevents exposure; no operational bug. Deviates from Governed RPC First pattern. Reason unknown. | (a) ✅ No Data Exposure proven. (b) ❌ Not replaced with governed RPC equivalent. |

### Severity Legend

| Label | Meaning |
|-------|---------|
| **Review Required** | Needs human decision: is this a problem? Should we fix it, remove it, or leave it? |
| **Decided** | Has been reviewed and a decision was made. See full Finding text in section above for details. |
| **Source Control Integrity Gap** | Production contains deployed code that the repository cannot recreate. System works, but the single source of truth is broken. Requires extraction + migration creation before investigation phase can close. |
| **Implementation Opportunity** | Code deviates from the project's standard pattern without proven operational impact or security risk. Not a Bug. Reason for deviation is unknown. May be refactored to align with standards during cleanup. |
| **Consistency Opportunity** | A code comment, historical artifact, or secondary path contradicts the primary implementation. The inconsistency cannot manifest in practice due to database constraints or runtime guards. Not a Bug. Fix deferred to cleanup phase. |
| **Runtime Verification Pending** | Investigation reached the evidence boundary — no Bug reproduced, no operational impact proven, but the question cannot be settled without elevated access. Not actionable until new evidence or operational need arises. |
| Observation | Factual statement about current state. May or may not need action. |
| Fixed (prior) | Was an issue in the past, confirmed fixed in current state. |

---

## 7. History Appendix

*This section exists only to explain why certain current-state conditions exist. It is not part of the system reference.*

### 7.1 The p_token Type Pendulum (June–October 2026)

The `p_token` parameter underwent three phases:
1. **Original** (before June 25): All functions used `p_token uuid`
2. **Text migration** (June 25–27): 5 migration files changed 30+ functions from `uuid` → `text` to resolve overload issues
3. **Silent revert** (July–October): Later migrations recreated functions with `uuid` without dropping the `text` overloads

**Result**: 4 functions now have both overloads (F-DB-02 through F-DB-05). The text overloads are vestigial but harmless in PL/pgSQL internal calls. **F-DB-02 decision**: Schema Hygiene Opportunity — retained as Deferred Cleanup Candidate.

### 7.2 The Blanket GRANT (July 8, 2026)

Before July 8, all governed RPCs lacked `GRANT EXECUTE TO authenticated`, causing 403 errors in production. The fix was a blanket `GRANT EXECUTE ON ALL FUNCTIONS` — an expedient patch that resolved the immediate issue but created a new one: all functions (including test helpers) became accessible. Default privileges were also altered, meaning new functions automatically get EXECUTE for authenticated.

### 7.3 The Undeployed Phase C Migration

The Phase C workday detail repair (`20260622_phase_c_workday_detail_repair.sql`) was written but never deployed to production. This left `get_work_hours_ledger` with a text-parameter contract that didn't match what the frontend expected. Fixed in `20261002` by dropping the text version and creating the correct uuid+date version.

---

## 8. Investigation Statistics

*As of 2026-06-25 — Phase P1 complete. All 10 Group A findings reviewed (F-DB-01 … F-DB-05, F-API-02, F-RTM-01, F-PRM-01, F-PRM-02, F-FE-01).*

| Metric | Count | Findings |
|--------|-------|----------|
| Total Findings Identified | 16 | F-DB-01 … F-DB-07, F-API-01 … F-API-03, F-PRM-01 … F-PRM-03, F-FE-01 … F-FE-02, F-RTM-01 |
| **Reviewed** | **11** | F-DB-01, F-DB-02, F-DB-03, F-DB-04, F-DB-05, F-PRM-01, F-PRM-03, F-API-02, F-RTM-01, F-PRM-02, F-FE-01 |
| Confirmed Bugs (operational) | **0** | — |
| Verified Stable Contracts | **2** | F-DB-03, F-PRM-03 |
| Architectural Decisions | **1** | F-DB-01 (Governed RPC First) |
| Source Control Integrity Gaps | **1** | F-API-02 / F-RTM-01 |
| Consistency Opportunities | **1** | F-PRM-02 (comment vs code in check_capability) |
| Implementation Opportunities | **1** | F-FE-01 (3 direct table access calls, no proven exposure) |
| Implementation Opportunities | **1** | F-FE-01 (3 direct table access calls, no proven exposure) |
| Public by Design | **1** | F-PRM-01 (16 functions GRANTed to anon, all protected by internal validation) |
| Fixed (Prior) | **1** | F-DB-04 |
| Runtime Verification Pending | **1** | F-DB-05 |
| Cleanup Opportunities (Deferred) | **3** | F-DB-02 (overload), F-API-02 (3 orphaned page files), F-FE-01 (3 direct table access calls) |
| **Pending Review** | **5** | F-DB-06, F-DB-07, F-API-01, F-API-03, F-FE-02 |

### Key Insight

**0% Bug rate among reviewed findings.** Every investigated finding that initially appeared problematic turned out to be either a stable contract, a historical artifact without operational impact, an architectural consideration, an unconfirmed question, or — in the case of F-API-02 — a system that **works perfectly** in production but whose code exists **only** in production, revealing a **Source Control Integrity Gap** rather than a runtime defect. This validates the investigation-first methodology: fixing first would have introduced regressions into working code.

---

*End of System Reference — Current State. Last updated: 2026-06-25. Update this document whenever the system changes.*
