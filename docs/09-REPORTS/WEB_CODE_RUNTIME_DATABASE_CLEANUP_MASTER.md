# Ahram ERP — Web Code / Runtime / Database Remediation Master

---

## 1. Document Control

| Field | Value |
|---|---|
| **Project** | Ahram ERP — Distribution / B2B field-sales platform |
| **Scope** | Web application (React + Vite + TypeScript), Published Web bundle, production Supabase (PostgREST / RPC / schema / RLS / grants) |
| **Production Supabase project** | `fpsepeuykcioelcmkuup` — `https://fpsepeuykcioelcmkuup.supabase.co` (the old project `gbcbejejgpvltuhbztbx` was **never** queried and is out of scope) |
| **Local repository** | `D:\Projects\store` — branch `main`, remote `https://github.com/ahram-distribution/store.git` |
| **Published Web** | `https://ahram-distribution.github.io/store/` |
| **Initial audit date** | 2026-09-30 |
| **Current status** | **IN PROGRESS** — RPC-001 is **committed, pushed and deployed to production**, but live end-to-end verification is **BLOCKED on credentials**. The sales Returns module has since been removed from the Web application and its Returns-only RPCs retired from production. |
| **Current phase** | **Phase 1 — Live Web Errors** — started. 1 of 22 Phase 1 findings addressed. Phase 1 is **not** complete. |
| **Last updated** | 2026-10-01 (sales Returns module removed from Web; Returns-only RPCs dropped in production) |
| **Current HEAD** | `eb2af43` — `refactor(web): remove sales Returns module and its exclusive RPCs` (2026-10-01). Previous: `2a9c5cea310cffc2eda45dbfda275e3474fab408` (`2a9c5ce`, the RPC-001 fix) |

**Findings registered:** 99 (96 from the audit + RPC-006 from RPC-001 remediation + DBX-013 and RPC-007 from the Returns cleanup)
**Findings deployed to production:** 2 (RPC-001; the Returns cleanup, which includes a real database migration)
**Findings closed:** 0
**Findings blocked on verification:** 1 (RPC-001 — needs a valid Web login)
**Phases started:** 1 of 7 (Phase 1, partially)

---

## 2. Scope and Rules

1. **The Web application is the primary scope.** All remediation is evaluated from the Web entry point outward.
2. **Desktop / Electron is NOT a remediation target.** It is inspected only where the Web depends on it (for example `src/lib/desktopSupabase.ts` and `src/desktop/context/BootstrapProvider.tsx`). No Desktop file is to be modified, removed, or reclassified as part of this program.
3. **The production database IS in scope**, but only where it is directly related to Web/runtime truth: RPC contracts, PostgREST exposure, RLS state, grants, and migration drift.
4. **No change is considered complete until verified.** A fix is not closed until the verification method named in the Findings Register has been executed and its result recorded in the Change Log.
5. **No deletion based only on "unused-looking" code.** Zero-import is not proof of deadness. Before any deletion, the item must be shown to have no Web consumer, no database trigger/policy/view dependency, and no documented manual/operational use.
6. **Security and database changes require their own controlled phase.** They must not be bundled with application-code changes. Phase 3 is a separate, explicitly authorized phase.
7. **Local and Published Web must remain aligned.** A remediation is not deployable if it leaves local source, Git HEAD, and the Published bundle divergent.
8. **Every completed remediation must be documented in this file.** This document is the only status authority.

---

## 3. Source of Truth

Four independent reference points are compared. They are not assumed to agree.

| # | Reference point | Identity / state at audit time |
|---|---|---|
| 1 | **Local Web source** | Working tree at `D:\Projects\store`. Application source carries no uncommitted modifications, but the tree also contains pre-existing documentation relocation changes (see §14). |
| 2 | **Git HEAD** | `bed38d7f28af9584f4d9a127c2dfe7ebf05849dc`, subject `perf(web): page dynamic collection 6666, paged exports, and trim company payloads`, 2026-09-28 13:00:22 +0300. |
| 3 | **Published Web** | `build-manifest.json` reports `build_id=bed38d7`, `commit_hash=bed38d7f28af9584f4d9a127c2dfe7ebf05849dc`, `build_date=2026-09-28T10:04:25.760Z`, `app_version=1.0.0`, `required_schema_version=27`. |
| 4 | **Production Supabase** | PostgreSQL 17.6, reached read-only via `aws-1-eu-west-1.pooler.supabase.com:5432` as `postgres.fpsepeuykcioelcmkuup`. Runtime truth is independent of any repository file. |

### Initial audit result

- **Local HEAD = Published Web.** Exact commit match. No drift between committed source and the deployed bundle was found.
- **Local `dist/` is stale and is NOT authoritative.** Its `build-manifest.json` reports `build_id=dev`, `commit_hash=dev`, `build_date=2026-09-28T09:59:23.764Z`, built roughly 5 minutes before the published artifact and never stamped with a commit. Local `dist` must never be used to reason about what production runs. Tracked as **OPS-002**.
- **The production database is separate runtime truth.** It contains objects that exist in no migration file, and the repository contains objects that do not exist in production. Neither side can be assumed correct.
- **Production migration history limitation:** there is **no `supabase_migrations.schema_migrations` table** in production. Only `auth.schema_migrations`, `realtime.schema_migrations`, and `storage.migrations` exist. There is therefore **no way to determine which migration version production is actually at**, and no way to order or diff applied migrations. All migration comparison must be done by direct definition comparison. Tracked as **MIG-002**.
- **No `cron` schema and no `cron.job` table exist**, so no scheduled-job inventory is possible. Tracked as **MIG-011**.

---

## 4. Phase Plan

Phases are sequential. A phase may not begin until the preceding phase's findings are closed or explicitly accepted by the owner.

### Phase 1 — Live Web Errors

Remediate defects that are currently breaking or degrading the live Web application.

Initial targets:
- `get_employee_daily_tracking` — missing in production, breaks a nav-linked live page
- `governed_approve_return` parameter mismatch — return approval is broken — **SUPERSEDED 2026-10-01:** the Returns module, including the only caller that passed `p_id`, was removed. The RPC itself is retained unchanged by owner decision; see RPC-002 and RPC-007.
- Live-page TypeScript errors — ~40 errors sit in routed, user-facing pages and ship undetected

**Status: OPEN**

### Phase 2 — Production Database / Migration Drift

Reconcile the repository's migration chain with actual production reality.

Initial targets:
- 6 production RPCs with no migration definitions (repository cannot rebuild the database)
- Migration history inconsistency (no applied-migration record exists)
- `orders.status` mismatch (enum absent, 3 conflicting definitions)
- Production vs local function definition drift

**Status: OPEN**

### Phase 3 — Database Security

The highest-risk phase. Requires explicit owner authorization before any change. No code changes may be bundled into this phase.

Initial targets:
- RLS state (115 of 126 public tables have RLS disabled)
- Inert policies (30 tables have policies defined but RLS off, so the policies never evaluate)
- Anonymous read grants (57 tables readable with the publishable key, no login)
- Anonymous write grants (58 tables carry anon INSERT/UPDATE/DELETE/TRUNCATE)
- Exposed backup tables (`backup_removed_01010446269_identities` holds `phone` and `password_hash`; the `_contacts` table holds names, phones, emails)
- Production debug/test functions (19 test/debug functions live in `public`)
- SAHL remnants (`generate_sahl_quote_number`, `generate_sahl_sale_number`)

**Status: OPEN**

### Phase 4 — Dead / Obsolete Application Code

Initial targets:
- unused pages
- unreachable routes
- unused components
- unused hooks
- unused services
- obsolete implementations
- duplicate / superseded code
- disconnected architecture island

**Status: OPEN**

### Phase 5 — Dead / Obsolete Database Objects

Initial targets:
- uncalled functions
- obsolete RPCs
- duplicate overloads
- obsolete database objects

**Status: OPEN**

### Phase 6 — Documentation / Source-of-Truth Reconciliation

Initial targets:
- conflicting documentation
- KPI weight source
- company target source
- order ownership documentation
- order status documentation
- single documentation source of truth

**Status: OPEN**

### Phase 7 — Final Verification

Initial targets:
- Local = Published
- Web contracts = Production DB
- no unresolved P0/P1 findings
- no known broken live routes
- cleanup decisions documented
- final regression/build verification

**Status: OPEN**

---

## 5. Master Findings Register

This is the authoritative register. Every finding carries exactly one classification and one priority.

**Classifications:** A — ACTIVE · B — ACTIVE SPECIAL-PURPOSE · C — HISTORICAL/INTENTIONALLY RETAINED · D — OBSOLETE/DEAD · E — DUPLICATE/SUPERSEDED · F — BROKEN/ERROR · G — DRIFT/INCONSISTENCY · H — UNCERTAIN/MANUAL REVIEW

**Priorities:** P0 (critical, security or data loss) · P1 (broken behavior, this sprint) · P2 (correctness/cleanup) · P3 (hygiene) · P4 (cosmetic/record)

All statuses are **OPEN**. Nothing has been remediated.

| ID | Area | Finding | Class | Pri | Evidence | Current Status | Phase | Fix/Decision | Verification | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| SEC-001 | DB Security | RLS disabled on 115 of 126 public base tables (only 11 enabled) | F | P0 | `pg_class.relrowsecurity=false`; 11 ON / 115 OFF | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | Governed-RPC model assumed as the guard; these tables have no row-level protection at all |
| SEC-002 | DB Security | 30 tables have policies defined but RLS disabled, so the policies are inert | F | P0 | `pg_policies` present + `relrowsecurity=false` | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | `identities, employees, customers, orders, order_items, order_status_history, order_modification_history, collections, returns, return_items, return_inspection, visits, capabilities, roles, role_capabilities, employee_roles, employee_capabilities, employee_advances, inventory, products, product_units, tier_exceptions, tiers, expenses, treasury_transactions, customer_contacts, customer_addresses, customer_credit_ledger, customer_ownership_history, code_sequences` |
| SEC-003 | DB Security | 57 public tables readable with the anon publishable key, no authentication | F | P0 | HTTP 200 via `/rest/v1/<table>` with anon key | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | Empirical, not catalog-derived |
| SEC-004 | DB Security | `backup_removed_01010446269_identities` is anon-readable; table holds `phone` and `password_hash` columns | F | P0 | HTTP 200; columns via `information_schema.columns` | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | Column presence and row accessibility confirmed; sensitive values deliberately NOT retrieved |
| SEC-005 | DB Security | `backup_removed_01010446269_contacts` is anon-readable; holds `full_name`, `phone`, `email` | F | P0 | HTTP 200; columns via `information_schema.columns` | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | Customer PII |
| SEC-006 | DB Security | `attendance_audit_log` anon-readable; 1000+ rows returned in probe | F | P0 | HTTP 200, `limit=1000` | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | Employee attendance/event data |
| SEC-007 | DB Security | `employee_work_policies` anon-readable; 31 rows returned | F | P0 | HTTP 200, `limit=1000` | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | Employee schedule, tracking, work-location policy |
| SEC-008 | DB Security | `session_recovery_log`, `v_result`, `v_role_id`, `gps_test_points` anon-readable | F | P0 | HTTP 200 for all four | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | Session/role/debug data |
| SEC-009 | DB Security | 58 tables carry anon `INSERT`,`UPDATE`,`DELETE`,`TRUNCATE` grants in the catalog | F | P0 | `information_schema.role_table_grants` where `grantee='anon'` | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | Combined with SEC-001 (RLS off) nothing prevents the write at runtime |
| SEC-010 | DB Security | `performance_weights_config` is anon-writable, exposing KPI weights to tampering | F | P0 | `role_table_grants`: DELETE,INSERT,TRUNCATE,UPDATE | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | Business-integrity impact, not just confidentiality |
| DBG-001 | DB Debris | 19 test/debug functions are live in schema `public` | D | P0 | `pg_proc` where `pronamespace='public'` | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | `test_ping, test_ping2, test_ping3, test_rpc, test_report (×2 overloads), test_ddl_function, test_func, test_migration_func, test_minimal, test_minimal_attendance, test_setof, test_simple, test_sm_cc, multiline_test, __tztest, ping` |
| DBG-002 | DB Debris | `test_sm_cc` embeds a hard-coded UUID session token in its body | D | P0 | `prosrc` contains `322e0362-fa67-48f1-908c-c2098b7c54da` | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | Literal credential-shaped value in production |
| DBG-003 | DB Debris | `insert_gps_test_point` writes into `gps_test_points`, which is itself anon-readable and anon-writable | F | P0 | `prosrc` INSERT target; SEC-008 / SEC-009 | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | A test function writing to an exposed table |
| DBG-004 | DB Debris | `ping`, `set_limit`, `show_limit`, `__tztest` are leftover diagnostic functions | D | P1 | `pg_proc.prosrc` | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | `set_limit`/`show_limit` are pg_trgm passthroughs |
| SAHL-001 | DB Debris | `generate_sahl_quote_number` and `generate_sahl_sale_number` still exist after SAHL removal | D | P1 | `pg_proc` ILIKE `%sahl%` → 2 rows | OPEN | 3 | PLANNED — owner authorization required | NOT VERIFIED | No SAHL tables/views/types remain; only these 2 functions |
| SAHL-002 | Drift | Migration manifest declares `schemaVersion: 27` yet contains migration `0028_remove_sahl_module.sql` | G | P2 | `desktop/main/db/migrations/manifest.json` | OPEN | 2 | PLANNED | NOT VERIFIED | Schema version numbering is not trustworthy |
| RPC-001 | Live Error | `get_employee_daily_tracking` does not exist in production; called by a live nav-linked page | F | P1 | PGRST202; `src/pages/reports/ActivityReportsPage.tsx:615`; route `/reports/activity` | **DEPLOYED — NOT VERIFIED** | 1 | FIXED | DEPLOY-PROVEN, E2E BLOCKED | Commit `2a9c5ce` deployed via run `36848647982`. Published bundle has **0** references to the missing RPC. Live authenticated day-view check is blocked: no valid Web credential is available. See §8 and §10.1. |
| RPC-006 | Drift | `get_employee_day_timeline` buckets events by UTC date while the business day is Cairo; events between 00:00–02:00 Cairo are attributed to the previous business day | G | P1 | 103 of 3,519 union events (2.927%) fall in the divergent window; `src/pages/reports/ManagerReportsPage.tsx` also consumes this RPC | OPEN | 2 | AWAITING OWNER DECISION | NOT VERIFIED | **Discovered during RPC-001 remediation.** Correcting it requires changing a shared RPC that `ManagerReportsPage` also uses, so it was deliberately left untouched and registered here instead. **Untouched by the 2026-10-01 deployment** — `get_employee_day_timeline` was not modified. Also untouched by the 2026-10-01 Returns cleanup. |
| DBX-013 | Dead DB Object | The four sales-Returns tables `returns`, `return_items`, `return_inspection`, `return_status_history` are now orphaned from the Web — the entire Returns feature was removed on 2026-10-01 — but cannot be dropped | H | P2 | 16 retained functions read or write them; all four tables hold **0 rows** | OPEN | 5 | BLOCKED — owner decision required | NOT VERIFIED | **Blocked by dependency, not by uncertainty.** Retained dependents: `governed_approve_return`, `get_unified_order`, `governed_delete_order`, `governed_supreme_delete_cancelled_order`, `governed_delete_employee_with_transfer`, `get_dashboard_management`, `get_command_center_v2`, `get_governed_target_performance`, `get_kpi_contributors`, `get_team_members_kpis`, 7 × `governed_deletion_*`, `sync_get_table_allowlist`. Dropping the tables would break order deletion, employee transfer, dashboards, KPI/target attainment (which subtract `return_deduction` and `full_returns` from delivered sales), the Data Deletion Center and mobile sync — all outside this task's scope. Empty tables are not proof of safe deletion. Retiring them requires refactoring those 16 functions first. |
| RPC-007 | Dead DB Object | `governed_approve_return` is retained in production with no caller after the Returns module was removed on 2026-10-01 | D | P2 | `pg_proc` 1 overload; signature `(p_token uuid, p_return_id uuid)` unchanged; body still `UPDATE`s `public.returns` | OPEN | 5 | **RETAINED BY OWNER EXCEPTION** | NOT VERIFIED | Explicit owner instruction: retain unchanged, do not repair. Not dropped by `20271202_remove_returns_module_rpcs.sql`. Its only caller (`src/services/returns.ts`) is deleted, so it is unreachable from the Web but still granted EXECUTE to `anon`/`authenticated`. It also blocks DBX-013 because it depends on `public.returns`. Removing it is a **separate owner decision** and is the first step of any future DBX-013 cleanup. |
| RPC-002 | Live Error | `governed_approve_return` called with `p_id`; production signature is `(p_token, p_return_id)` | F | P1 | PGRST202; `src/services/returns.ts:76` (file deleted 2026-10-01) | **SUPERSEDED — NOT REACHABLE** | 1 | NO ACTION — owner exception | NOT VERIFIED | The only caller, `src/services/returns.ts`, was deleted with the Returns module on 2026-10-01, so the mismatch can no longer occur at runtime. The defect is **deliberately not fixed**: `governed_approve_return` is an explicit owner exception and was retained unchanged. See **RPC-007**. |
| RPC-003 | Live Error | `governed_update_check_status` does not exist in production | F | P3 | PGRST202 | OPEN | 1 | PLANNED | NOT VERIFIED | Only caller is dead code (`LegacyCollectionProvider`) |
| RPC-004 | Build | 138 TypeScript errors ship to production because the Vite/esbuild build performs no typecheck | F | P1 | `tsc --noEmit` exit code 2, 138 errors | OPEN | 1 | PLANNED | NOT VERIFIED | `npm run build` strips types without checking them |
| RPC-005 | Live Error | ~40 TypeScript errors are located in live, routed, user-facing pages (not tests) | F | P1 | `tsc --noEmit` grouped by file | OPEN | 1 | PLANNED | NOT VERIFIED | Includes `ProductCard`, `OrderDetailPage`, `OrderEditPage`, `EmployeeWorkdayDetailPage`, `HierarchyTargetPage`, `TargetSeedTool`, `EmployeeAnalysisPage`, `RepDistributionScreen`, `AttendanceRuntimePage`, `LiveActivityCenterPage`, `ExecutiveOperationsWorkspace`, `ProductManagerPage`, `TargetsWeightsTab` |
| TSC-001 | TypeScript | `ProductCard.tsx` — 4× `TS2554 Expected 0 arguments, but got 1` | F | P1 | lines 166, 172, 176, 180 | OPEN | 1 | PLANNED | NOT VERIFIED | Live storefront component |
| TSC-002 | TypeScript | `OrderDetailPage.tsx` / `OrderEditPage.tsx` — `salesBlocked` does not exist on `ProductWithPrice` | F | P1 | lines 61, 855, 856 / 66, 303, 304 | OPEN | 1 | PLANNED | NOT VERIFIED | Order screens |
| TSC-003 | TypeScript | `HierarchyTargetPage.tsx` imports 5 non-existent exports from `./TargetRuntimePage` | F | P1 | lines 3.15, 3.32, 3.50, 3.67, 3.82 | OPEN | 1 | PLANNED | NOT VERIFIED | `PerformanceData, HierarchyManager, HierarchyMember, HierarchyKpis, HierarchyTeamSummary` |
| TSC-004 | TypeScript | `src/lib/supabase.ts:17` — `TS2558 Expected 0 type arguments, but got 1` | F | P1 | sole runtime `createClient` site | OPEN | 1 | PLANNED | NOT VERIFIED | Touches the central client |
| TSC-005 | TypeScript | `src/sw.ts` — 5 errors, `ServiceWorkerGlobalScope` and `clients` unresolved | F | P1 | lines 6.21, 240.19, 346.5, 354.11, 354.38 | OPEN | 1 | PLANNED | NOT VERIFIED | Service worker; separate tsconfig context may be correct |
| TSC-006 | TypeScript | `EmployeeWorkdayDetailPage.tsx` — 9 prop/type mismatches including `string` assigned to `number` | F | P1 | lines 229, 421, 444, 495, 535, 565, 617, 648, 707 | OPEN | 1 | PLANNED | NOT VERIFIED | Attendance detail screen |
| TSC-007 | TypeScript | `GpsTestPage.tsx:18` references `navavigator` (typo for `navigator`) | F | P2 | `TS2551` | OPEN | 1 | PLANNED | NOT VERIFIED | Diagnostics page |
| TSC-008 | TypeScript | `AttendanceRuntimePage.tsx:157` uses `lastGps`; type declares `lastGpsAt` | F | P2 | `TS2551` | OPEN | 1 | PLANNED | NOT VERIFIED | Live attendance screen |
| TSC-009 | TypeScript | `RepDistributionScreen.tsx` — `Sector[]` passed where `SectorGovernorate[]` expected; `sector_name` missing | F | P2 | lines 50.18, 95.54 | OPEN | 1 | PLANNED | NOT VERIFIED | Sector screen |
| TSC-010 | TypeScript | `OrderCollectionsSection.tsx:2` imports non-existent `UnifiedOrderCollection` | F | P2 | `TS2305` | OPEN | 1 | PLANNED | NOT VERIFIED | Live order component |
| TSC-011 | TypeScript | `domain/location/repository.ts:5` — `TS1294` syntax not allowed under `erasableSyntaxOnly` | F | P2 | `tsconfig` setting conflict | OPEN | 1 | PLANNED | NOT VERIFIED | Module is used by CoverageMapPage and CustomerProfilePage |
| TSC-012 | TypeScript | `TargetSeedTool.tsx` and `EmployeeAnalysisPage.tsx` access properties on `unknown`/`{}` types | F | P2 | `TS2339` / `TS2740` | OPEN | 1 | PLANNED | NOT VERIFIED | Admin and analytics screens |
| TSC-013 | Test Infrastructure | 19 test files cannot be executed by any declared command; 30 `TS2591` missing node types | D | P3 | `tsc --noEmit`; `package.json` scripts | OPEN | 4 | PLANNED | NOT VERIFIED | Tests provide no actual safety net |
| TSC-014 | Build | No typecheck gate exists in the build or CI | G | P1 | `package.json` scripts; no CI typecheck step | OPEN | 1 | PLANNED | NOT VERIFIED | Root cause enabling RPC-004 |
| MIG-001 | Drift | 6 production RPCs have no migration definition; the repository cannot rebuild the database | G | P0 | Production catalog vs `supabase/migrations` | OPEN | 2 | PLANNED | NOT VERIFIED | Already documented as F-API-02 / F-RTM-01 and still open. `geocode_customer_address, get_customer_visit_context, get_smart_follow_up_suggestions, governed_bulk_update_product_stock_price, get_runtime_achievement, get_runtime_team` |
| MIG-002 | Drift | Production has no `supabase_migrations.schema_migrations` table | G | P1 | `information_schema` migration-table query | OPEN | 2 | PLANNED | NOT VERIFIED | Applied-migration order is unknowable; blocks all version diffing |
| MIG-003 | Drift | `orders.status` enum does not exist in production; 3 conflicting definitions | G | P1 | `pg_enum` → 0 rows; data has 4 values; TS union has 8; docs claim 15 | OPEN | 2 | PLANNED | NOT VERIFIED | `delivered 237, cancelled 15, submitted 14, approved 12` vs `src/types/storefront.ts:2` |
| MIG-004 | Drift | `performance_weights_config` is read by no KPI function; only `sync_get_table_allowlist` references it | G | P1 | `pg_proc.prosrc` ILIKE | OPEN | 2 | PLANNED | NOT VERIFIED | Docs describe it as "the current approach" — docs are wrong |
| MIG-005 | Drift | `company_monthly_targets` documented both as abandoned and as live; table exists with RLS off | G | P1 | `KPI_FORMULA_VALIDATION.md:9,61` vs `SYSTEM_REFERENCE_CURRENT_STATE.md:120-121` | OPEN | 2 | AWAITING OWNER DECISION | NOT VERIFIED | Coupled to DOC-003 |
| MIG-006 | Drift | `governed_create_company` in production accepts `p_display_order`; local migration chain does not | G | P2 | Production signature vs `supabase/migrations` | OPEN | 2 | PLANNED | NOT VERIFIED | Confirms production runs ahead of the repo |
| MIG-007 | Drift | 41 RPCs are overloaded, creating PostgREST dispatch ambiguity | H | P2 | `pg_proc` grouped by name | OPEN | 2 | AWAITING OWNER REVIEW | NOT VERIFIED | Includes `get_dashboard_management`, `get_visible_employee_ids`, `check_capability` |
| MIG-008 | Drift | `get_dashboard_management` overload resolution is documented as unconfirmable | H | P2 | `SYSTEM_REFERENCE_CURRENT_STATE.md:1035` | OPEN | 2 | AWAITING OWNER REVIEW | NOT VERIFIED | No bug reproduced, but unverifiable without controlled DB introspection |
| MIG-009 | Drift | `governed_approve_order` has both 3-argument and 4-argument forms | H | P2 | `pg_proc` | OPEN | 2 | AWAITING OWNER REVIEW | NOT VERIFIED | PostgREST may resolve to the wrong signature |
| MIG-010 | Drift | Duplicate function definitions: `test_report` (2 overloads) and `get_employee_detail` (2 overloads) | E | P2 | `pg_proc` | OPEN | 5 | AWAITING OWNER REVIEW | NOT VERIFIED | Cannot be removed until callers are mapped |
| MIG-011 | Drift | No `cron` schema and no `cron.job` table in production | H | P3 | `relation "cron.job" does not exist` | OPEN | 2 | AWAITING OWNER REVIEW | NOT VERIFIED | Scheduled-job inventory is impossible |
| MIG-012 | Environment | PostgREST schema introspection blocked; service-role key returns HTTP 401 | H | P2 | `Secret API key required`; `sb_secret_K...` length 41 | OPEN | 2 | AWAITING OWNER DECISION | NOT VERIFIED | Exposure was therefore tested empirically rather than enumerated |
| MIG-013 | Environment | Direct DB host rejects connections without a tenant identifier; pooler required | H | P4 | `XX000 (ENOIDENTIFIER) no tenant identifier provided` | OPEN | 2 | INFORMATIONAL — no action proposed | NOT VERIFIED | Operational fact, not a defect |
| FED-001 | Dead Code | A 146-file architecture island (`bootstrap`, `di`, `application`, `providers`, `engine`) is unreachable from the Web entry | D | P3 | Import-graph analysis from `src/main.tsx` | OPEN | 4 | PLANNED | NOT VERIFIED | ~33,000 production LOC |
| FED-002 | Dead Code | The island's only apparent entry, `BootstrapProvider.tsx`, is itself unreachable from Web | D | P3 | `src/desktop/context/BootstrapProvider.tsx` | OPEN | 4 | AWAITING OWNER DECISION | NOT VERIFIED | Desktop is out of remediation scope — this constrains deletion |
| FED-003 | Dead Code | 17 pages exist in source but are absent from the bundle | D | P3 | Route graph vs Vite output | OPEN | 4 | PLANNED | NOT VERIFIED | |
| FED-004 | Dead Code | 14 pages are bundled but never rendered | D | P3 | Route graph | OPEN | 4 | PLANNED | NOT VERIFIED | |
| FED-005 | Dead Code | 5 routed pages have no inbound links | D | P3 | Route graph | OPEN | 4 | AWAITING OWNER DECISION | NOT VERIFIED | May be deep-link or bookmark entry points |
| FED-006 | Dead Code | 11 clickable paths have no matching route | D | P3 | Route graph | OPEN | 4 | PLANNED | NOT VERIFIED | Potential broken navigation |
| FED-007 | Dead Code | `src/components/data-list/PageSizeSelector.tsx` has zero importers (17 lines) | D | P3 | Zero-import analysis | OPEN | 4 | AWAITING OWNER DECISION | NOT VERIFIED | High confidence but deletion still requires the §2 rule-5 test |
| FED-008 | Dead Code | `src/App.tsx:2` imports `BrowserRouter` unused while `HashRouter` is used at line 23 | D | P3 | `src/App.tsx` | OPEN | 4 | PLANNED | NOT VERIFIED | |
| FED-009 | Dead Code | `ManagerReportsPage` is shipped as a dead 70,551-byte lazy chunk | E | P2 | Published asset HTTP 200, 70,551 bytes | OPEN | 4 | PLANNED | NOT VERIFIED | Wasted production payload |
| FED-010 | Dead Code | `EmployeeAnalysisPage.tsx` bypasses governed RPCs and queries 3 tables directly | F | P2 | `SYSTEM_REFERENCE_CURRENT_STATE.md:1013`; RLS currently blocks exposure | OPEN | 4 | AWAITING OWNER DECISION | NOT VERIFIED | **Becomes a live exposure if Phase 3 enables RLS or grants change** |
| FED-011 | Dead Code | `src/bootstrap.ts` is not reachable from the Web entry tree | D | P3 | Import-graph analysis | OPEN | 4 | PLANNED | NOT VERIFIED | Part of FED-001 |
| DBX-001 | Dead DB | 465 of 587 public functions have no internal consumer (not in any function body, trigger, policy, or view) | H | P2 | Dependency query over `pg_proc` | OPEN | 5 | AWAITING OWNER REVIEW | NOT VERIFIED | Includes RPCs that are live but not internally referenced |
| DBX-002 | Dead DB | 213 functions are called by neither Web code nor any internal database consumer | D | P2 | Cross-reference of 587 functions against 274 Web RPC names | OPEN | 5 | AWAITING OWNER REVIEW | NOT VERIFIED | Includes operational functions that may be called by hand |
| DBX-003 | Dead DB | Debug tables `v_broken, v_degraded, v_down, v_healthy, v_production_ready, v_result, v_role_id, v_total_decisions, v_total_modules, v_verified_decisions` | D | P1 | `pg_class` names | OPEN | 5 | AWAITING OWNER REVIEW | NOT VERIFIED | `v_result` is also anon-readable (SEC-008) |
| DBX-004 | Dead DB | `gps_test_points` table | D | P1 | `pg_class` | OPEN | 5 | AWAITING OWNER REVIEW | NOT VERIFIED | Also anon-readable and anon-writable |
| DBX-005 | Dead DB | `backup_removed_01010446269_identities` and `backup_removed_01010446269_contacts` tables | D | P0 | `pg_class` | OPEN | 5 | AWAITING OWNER DECISION | NOT VERIFIED | Coupled to SEC-004 / SEC-005 |
| DBX-006 | Dead DB | Auction tables: `auctions, auction_items, auction_bids, auction_awards, auction_activity, auction_participants` | H | P3 | `pg_class`; no Web consumer identified | OPEN | 5 | AWAITING OWNER REVIEW | NOT VERIFIED | May be a planned module — do not delete on RPC evidence alone |
| DBX-007 | Dead DB | Supplier / purchase / treasury tables (`suppliers, supplier_credit_accounts, supplier_credit_ledger, supplier_payments, purchases, purchase_items, purchase_returns, purchase_return_items`) | H | P3 | `pg_class`; no Web consumer identified | OPEN | 5 | AWAITING OWNER REVIEW | NOT VERIFIED | Commercial modules per `COMMERCIAL_RUNTIME_STATUS.md` — likely active, verify before any action |
| DBX-008 | Dead DB | Maintenance/backfill family: `auto_cleanup_tracking_data, cleanup_tracking_data, backfill_session_distances, backfill_session_distances_v2, rebuild_missing_tracking, preview_rebuild_missing_tracking, runtime_reconciliation, health_check_runtime, record_heartbeat, has_tracking_rebuild` | H | P2 | `pg_proc` | OPEN | 5 | AWAITING OWNER REVIEW | NOT VERIFIED | Manual/ops-use likely — this is exactly the rule-5 case |
| DBX-009 | Dead DB | Sync replication family: `sync_get_schema, sync_get_row_count, sync_get_table_allowlist, sync_pull_full_table, sync_pull_changes, sync_push_insert, sync_push_update, sync_push_delete` | H | P2 | `pg_proc` | OPEN | 5 | AWAITING OWNER REVIEW | NOT VERIFIED | `sync_get_table_allowlist` is the sole reader of `performance_weights_config` |
| DBX-010 | Dead DB | Number-generator family: `generate_cheque_number, generate_credit_note_number, generate_expense_number, generate_installment_number, generate_payment_number, generate_purchase_number, generate_purchase_return_number, generate_sales_return_number, generate_stocktake_number, generate_supplier_number, generate_transfer_number` | H | P2 | `pg_proc` | OPEN | 5 | AWAITING OWNER REVIEW | NOT VERIFIED | Likely invoked from function bodies or manual use — not yet proven dead |
| DBX-011 | Dead DB | 12 non-internal public triggers remain | H | P3 | `pg_trigger` | OPEN | 5 | AWAITING OWNER REVIEW | NOT VERIFIED | Includes notification triggers on customers, orders, products, visits, workday_sessions, bonus_mode_audit, plus inventory/out-of-stock logic |
| DBX-012 | Dead DB | 83 tables have RLS off, no policy, no trigger, and are not used by any view | H | P3 | Combined catalog query | OPEN | 5 | AWAITING OWNER REVIEW | NOT VERIFIED | Overlaps heavily with SEC-001; not independently actionable |
| DOC-001 | Documentation | Three documents each declare themselves the single source of truth | G | P1 | `DOCUMENTATION_INDEX.md:1-5`; `Ahram ERP Master/INDEX.md:1-15`; `ANCHORED_SUMMARY.md:7` | OPEN | 6 | AWAITING OWNER DECISION | NOT VERIFIED | Blocks reliable doc reconciliation |
| DOC-002 | Documentation | `employee_roles` documented as both unused and live; an archived matrix calls the "unused" claim WRONG | G | P1 | `09_PERMISSIONS_RULES.md:34` vs `SYSTEM_REFERENCE_CURRENT_STATE.md:881` | OPEN | 6 | AWAITING OWNER DECISION | NOT VERIFIED | Directly affects the RBAC model |
| DOC-003 | Documentation | KPI weight source documented three mutually exclusive ways | G | P1 | `KPI_FORMULA_VALIDATION.md:11` (hard-coded 75/7.5/7.5/10) vs `PHASE_C_WEIGHT_MODEL.md:21-34` (config table) | OPEN | 6 | AWAITING OWNER DECISION | NOT VERIFIED | No reconciliation document exists. Coupled to MIG-004 / MIG-005 |
| DOC-004 | Documentation | Order ownership documented as both immutable and transferable | G | P1 | `05_ORDER_RULES.md:323` vs `حالات الطلب.md:61` | OPEN | 6 | AWAITING OWNER DECISION | NOT VERIFIED | Changes order-ownership behavior |
| DOC-005 | Documentation | Order status documented three ways (15 DB / 8 TS / 4 actual) | G | P1 | `حالات الطلب.md:3-11,206`; `src/types/storefront.ts:2`; production data | OPEN | 6 | AWAITING OWNER DECISION | NOT VERIFIED | Coupled to MIG-003 |
| DOC-006 | Documentation | `09_PERMISSIONS_RULES.md` is marked `VERIFIED_IN_CODE` but is sourced only from archived documents | G | P1 | `09_PERMISSIONS_RULES.md:4,36` | OPEN | 6 | AWAITING OWNER DECISION | NOT VERIFIED | False assurance |
| DOC-007 | Documentation | "0% bug rate" and "production ready today" claims contradict currently open defects | G | P1 | `SYSTEM_REFERENCE_CURRENT_STATE.md:1119`; `COMMERCIAL_RUNTIME_STATUS.md:169` | OPEN | 6 | AWAITING OWNER DECISION | NOT VERIFIED | June-dated snapshots presented as current |
| DOC-008 | Documentation | Quota report states work deployed while also stating no web deployment occurred | G | P1 | `_QUOTA_REDUCTION_REPORT.md:4,86-89` | OPEN | 6 | AWAITING OWNER DECISION | NOT VERIFIED | Self-contradicting within one document |
| DOC-009 | Documentation | Two different Supabase project IDs appear in the same report folder | G | P1 | `COMMERCIAL_RUNTIME_STATUS.md:4` vs `_QUOTA_REDUCTION_REPORT.md:4` | OPEN | 6 | AWAITING OWNER DECISION | NOT VERIFIED | Risk of acting against the wrong project |
| DOC-010 | Documentation | Owner's role set (7 roles) contradicts the role model (3–5 live, supervisor legacy) | G | P1 | `09_PERMISSIONS_RULES.md:44` vs `ACTIVE_ROLE_MODEL.md:138,161-174` | OPEN | 6 | AWAITING OWNER DECISION | NOT VERIFIED | |
| DOC-011 | Documentation | Consolidated owner questions remain unresolved | H | P1 | `docs/10-OWNER-KNOWLEDGE/11_OPEN_QUESTIONS.md:1-4` | OPEN | 6 | AWAITING OWNER DECISION | NOT VERIFIED | Default owner for self-registered customers, self-service ownership, approval workflow, transfer limits, inactive-owner handling, per-role capability assignment |
| DOC-012 | Documentation | `REMOVAL_CANDIDATES.md` is explicitly non-binding; no document confirms any candidate was deleted | H | P2 | `REMOVAL_CANDIDATES.md:3-4` | OPEN | 6 | AWAITING OWNER DECISION | NOT VERIFIED | "Removed" must not be claimed for these items |
| DOC-013 | Documentation | Findings review status contradicts itself ("not started" vs "11 reviewed") | G | P2 | `ANCHORED_SUMMARY.md:34` vs `SYSTEM_REFERENCE_CURRENT_STATE.md:1098` | OPEN | 6 | PLANNED | NOT VERIFIED | |
| DOC-014 | Documentation | Activity standard references a `runtime` schema absent from the current reference schema list | G | P2 | `canonical-activity-standard.md:160-170,212` vs `SYSTEM_REFERENCE_CURRENT_STATE.md:3-11` | OPEN | 6 | AWAITING OWNER REVIEW | NOT VERIFIED | |
| DOC-015 | Documentation | Report cites 146 pre-existing `tsc` errors; audit measured 138 | G | P2 | `_QUOTA_REDUCTION_REPORT.md:65,88` vs `tsc --noEmit` | OPEN | 6 | PLANNED | NOT VERIFIED | Baseline number is stale; likely resolved since |
| DOC-016 | Documentation | Orphaned-page row lists `TeamAchievement.tsx` as both the orphan and its own replacement | G | P3 | `SYSTEM_REFERENCE_CURRENT_STATE.md:1055` | OPEN | 6 | PLANNED | NOT VERIFIED | |
| DOC-017 | Documentation | Findings statistics row duplicated verbatim | G | P4 | `SYSTEM_REFERENCE_CURRENT_STATE.md:1109-1110` | OPEN | 6 | PLANNED | NOT VERIFIED | |
| DOC-018 | Documentation | Validation document predates the consistency review that validates it by three months | G | P3 | `KPI_FORMULA_VALIDATION.md:2` (2026-06-23) vs `CANONICAL_CONSISTENCY_REVIEW.md:4` (2026-10-03) | OPEN | 6 | PLANNED | NOT VERIFIED | Review postdates its subject |
| BUS-001 | Business Logic | `ck_order_items_quantity` requires both `unit_quantity > 0` and `piece_quantity > 0`, so carton-only orders fail | F | P2 | `COMMERCIAL_RUNTIME_STATUS.md:136-153` | OPEN | 1 | AWAITING OWNER DECISION | NOT VERIFIED | Documented as MEDIUM and pre-existing; fix only suggested |
| BUS-002 | Business Logic | `_calc_base_unit_price` supports only piece/dozen/carton; the `unit` case returns NULL producing `PRICE_NOT_CONFIGURED` | F | P2 | `COMMERCIAL_RUNTIME_STATUS.md:157-163` | OPEN | 1 | AWAITING OWNER DECISION | NOT VERIFIED | Affects order entry |
| BUS-003 | Business Logic | Attendance KPI divergence: live "today's orders" includes `draft`/`cancelled` and uses `created_at`, while the historical RPC excludes them and uses `submitted_at` | F | P2 | `الحضور والانصراف/الحضور والانصراف.md:371,376` | OPEN | 1 | AWAITING OWNER DECISION | NOT VERIFIED | Same day yields different totals depending on path |
| BUS-004 | Business Logic | Auction award-to-order conversion is untested | H | P3 | `COMMERCIAL_RUNTIME_STATUS.md:109,181` | OPEN | 1 | AWAITING OWNER REVIEW | NOT VERIFIED | Coupled to DBX-006 |
| OPS-001 | Environment | `SUPABASE_SERVICE_ROLE_KEY` returns HTTP 401; service-role access is unavailable | H | P1 | `sb_secret_K...`, length 41 | OPEN | 2 | AWAITING OWNER DECISION | NOT VERIFIED | Blocks OpenAPI schema enumeration (MIG-012) |
| OPS-002 | Build | Local `dist/` is a stale `dev` build, not a commit-stamped artifact | G | P2 | `dist/build-manifest.json`: `build_id=dev`, `commit_hash=dev`, `2026-09-28T09:59:23.764Z` | OPEN | 7 | PLANNED | NOT VERIFIED | Must never be used to reason about production |
| OPS-003 | External | 8 items from `D:\Projects` were found in the Recycle Bin, outside the audited project | H | P1 | `$Recycle.Bin` metadata, 17:07:06–17:07:30 | OPEN | 7 | AWAITING OWNER DECISION | NOT VERIFIED | Outside remediation scope; recoverable; not targeted by audit commands |

---

## 6. Initial Findings

The register in §5 is authoritative. This section records how the findings distribute across the program. The current total is 97: the 96 findings from the audit plus RPC-006, which was discovered while remediating RPC-001.

| Phase | Findings | P0 | P1 | P2 | P3 | P4 |
|---|---|---|---|---|---|---|
| Phase 1 — Live Web Errors | 22 | 0 | 11 | 9 | 2 | 0 |
| Phase 2 — Migration Drift | 15 | 1 | 6 | 6 | 1 | 1 |
| Phase 3 — Database Security | 15 | 13 | 2 | 0 | 0 | 0 |
| Phase 4 — Dead Application Code | 12 | 0 | 0 | 2 | 10 | 0 |
| Phase 5 — Dead Database Objects | 13 | 1 | 2 | 6 | 4 | 0 |
| Phase 6 — Documentation | 18 | 0 | 11 | 4 | 2 | 1 |
| Phase 7 — Verification / environment | 2 | 0 | 1 | 1 | 0 | 0 |
| **Total** | **97** | **15** | **33** | **28** | **19** | **2** |

### Highest-severity concentration

There are **15 P0 findings**. Thirteen sit in Phase 3 (security). The remaining two are:
- **MIG-001** (Phase 2) — six production RPCs with no migration definition, so the database cannot be rebuilt from the repository. This is a P0 recoverability risk, not merely a cleanup item.
- **DBX-005** (Phase 5) — the `backup_removed_*` tables that carry the exposure described in SEC-004 and SEC-005.

### Notable cluster: FED-010 depends on Phase 3

`EmployeeAnalysisPage.tsx` queries 3 tables directly instead of through governed RPCs. Today it is protected only by RLS/grants. If Phase 3 alters grants or enables RLS, this page's behavior may change. **Phase 3 must re-verify FED-010.**

### Notable cluster: DOC-003 / MIG-004 / MIG-005 are one decision

The KPI weight question spans a code fact (no KPI function reads `performance_weights_config`), a table fact (`company_monthly_targets` exists with RLS off), and three conflicting documents. These are a **single owner decision**, not three independent fixes, and should be resolved together in Phase 6.

---

## 7. Verified Facts vs Planned Work

### 7.1 VERIFIED — established by the completed audit

These are established facts. They required no remediation to establish.

**Source alignment**
- Local Git HEAD is `bed38d7f28af9584f4d9a127c2dfe7ebf05849dc`.
- Published Web `build-manifest.json` reports the identical commit hash.
- Published Web was built 2026-09-28T10:04:25.760Z, `app_version 1.0.0`, `required_schema_version 27`.
- Local `dist/` reports `build_id=dev` and is a stale build.
- The Web entry uses `HashRouter` at `src/App.tsx:23`; `BrowserRouter` is imported unused at line 2.

**Route and bundle shape**
- 135 route elements across 123 unique path patterns; 13 unauthenticated, 122 authenticated.
- 4 lazy routes rendered, 1 lazy route never rendered, 128 eager.
- 17 pages absent from the bundle; 14 bundled but never rendered; 5 routed with no inbound links; 11 clickable paths with no route.
- `PageSizeSelector.tsx` has zero importers.
- `ManagerReportsPage` ships as a 70,551-byte chunk and is retrievable in production (HTTP 200).

**TypeScript**
- `tsc --noEmit` reports 138 errors and exits with code 2.
- The Vite/esbuild build performs no type checking, so all 138 reach production.
- Most frequent codes: `TS2591` (30), `TS2339` (26), `TS2554` (24), `TS2322` (13), `TS2307` (8), `TS2353` (8).

**Production database shape**
- PostgreSQL 17.6, 13 schemas, 7 extensions.
- 126 public base tables: 11 with RLS enabled, 115 with RLS disabled.
- 160 policies defined; 30 sit on tables where RLS is off and therefore never evaluate.
- 0 public views / materialized views.
- 587 public functions; 41 are overloaded.
- 12 non-internal public triggers.
- No `supabase_migrations.schema_migrations`. No `cron` schema.

**Security exposure (empirically tested with the anon publishable key)**
- 57 public tables return HTTP 200 with no authentication.
- 58 tables carry anon `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` grants.
- Confirmed readable: `backup_removed_01010446269_identities` (has `phone`, `password_hash`), `backup_removed_01010446269_contacts` (has `full_name`, `phone`, `email`), `attendance_audit_log` (1000+ rows), `employee_work_policies` (31 rows), `session_recovery_log`, `v_result`, `v_role_id`, `gps_test_points`.
- **Confirmed denied (42501), i.e. correctly protected:** `identities`, `employees`, `customers`, `orders`, `order_items`, `visits`, `returns`, `collections`, `treasury_transactions`, `expenses`, `customer_contacts`, `customer_addresses`, `customer_ownership_history`, `tier_exceptions`, `roles`, `capabilities`.
- An earlier probe suggesting schema-cache failure (`PGRST205` on all tables) was a test artifact and was discarded.

**Live contract failures**
- `get_employee_daily_tracking` → `PGRST202`; called from `ActivityReportsPage.tsx:615`.
- `governed_approve_return` with `p_id` → `PGRST202`; production expects `p_return_id`.
- `governed_update_check_status` → `PGRST202`.
- `governed_create_company` with `p_display_order` → HTTP 200 `INVALID_SESSION`, proving production accepts the parameter the local migrations lack.
- `governed_reject_return` → `P0001 INVALID_SESSION`, confirming it exists and is correctly named.

**Production debris**
- 19 test/debug functions in `public`; `test_sm_cc` contains the hard-coded UUID `322e0362-fa67-48f1-908c-c2098b7c54da`.
- `generate_sahl_quote_number` and `generate_sahl_sale_number` remain. No SAHL tables, views, or types remain.
- `employee_roles` has 3 policies and RLS off.
- `performance_weights_config` is referenced only by `sync_get_table_allowlist`.
- `orders.status` has no enum; 4 distinct values in data vs 8 in the TS union.
- 465 of 587 functions have no internal consumer; 213 are called by neither Web nor any internal consumer.

**Documents**
- 18 documentation findings registered, including three competing source-of-truth declarations and 14 documented contradictions.

**Method limits**
- All production queries ran with `default_transaction_read_only = on`. No database write was executed or succeeded.
- Sensitive column values were never retrieved; only column names and row accessibility were confirmed.
- PostgREST schema enumeration was impossible (service key 401), so exposure was measured empirically.
- Migration drift was assessed by definition comparison, because no applied-migration record exists.

### 7.2 PLANNED — not yet done

**Nothing in this section has happened.** These are candidate actions awaiting authorization, sequencing, and verification.

- Add migrations for the 6 undefined production RPCs.
- Create `orders.status` (or correct all three definitions to one).
- Add or remove the `get_employee_daily_tracking` call.
- Correct `returns.ts:76` to `p_return_id`.
- Introduce a typecheck gate so errors cannot ship.
- Revoke anon grants on the 57 readable and 58 writable tables.
- Enable RLS on the 30 tables that already have inert policies.
- Drop or quarantine the `backup_removed_*` tables.
- Drop the 19 debug/test functions and the 2 SAHL functions.
- Remove or quarantine dead frontend code and dead chunks.
- Reconcile the documentation to a single source of truth.

No item in 7.2 may be reported as done until §8 records it.

---

## 8. Change Log

Chronological record of remediation activity.

```
### 2026-09-30 — Phase 1
- Finding: RPC-001
- Action: Removed the `get_employee_daily_tracking` call from `src/pages/reports/ActivityReportsPage.tsx` and rebuilt the day-detail payload from the existing governed RPC `get_employee_day_timeline`. Visit markers are derived by pairing `visit_start` and `visit_end` events on `metadata.visit_id`. Added `metadata` to the `DayTimelineEvent` type in `src/types/reports.ts`. In `src/components/TrackingExplorerModal.tsx`, the map now falls back to framing visit locations when no route exists, and the route-only legend entries are hidden when there is no route. No database migration, no new RPC, no Desktop change.
- Result: The non-existent RPC is no longer called. Requests per day-selection drop from 2 to 1, a quota/egress improvement. `route`, `long_stops`, `total_distance_km` and `total_points` are intentionally left empty/zero because no continuous movement data is collected. No heartbeat, presence, or GPS polling was introduced. The shared modal contract is unchanged, so `ManagerReportsPage` is unaffected.
- Verification:
  - Source scan: `get_employee_daily_tracking` returns no matches anywhere under `src/` (previously 1 caller).
  - `npm run build` (Vite 5.4.19): `✓ built in 20.14s`, exit code 0. Service worker and PWA precache also built successfully.
  - `tsc --noEmit`: still exactly **138** errors, identical to the audit baseline, and **0** of them are in the three files this change touched. No new type errors were introduced, and no pre-existing errors were modified (fixing them is out of scope — RPC-004/RPC-005).
  - Data-contract test against production (read-only, `default_transaction_read_only = on`): replayed the exact event CTE of `get_employee_day_timeline` for a real employee/date and ran the new frontend mapping function over the result. It produced **4 visit markers**, each with customer name, check-in and check-out timestamps, and visit result. Non-finite coordinates: **0**. Events carrying a legitimate location: **9 of 15**. Every event had a timestamp. All `visit_end` events paired to their `visit_start` by `visit_id`. Only attendance/visit/break/order/collection event types carried coordinates.
  - **Not verified:** the rendered page in a live browser. No deployment was performed, so no live check against `/reports/activity` was possible in this environment.
- Status: FIXED, locally verified, **pending deployment** for live verification. Not yet `VERIFIED` in the §5 sense.
- Collateral finding: **RPC-006** registered (UTC vs Cairo business-day bucketing in the same RPC). No change made to that RPC; see §5.
```

```
### 2026-10-01 — Phase 1
- Finding: RPC-001 (deployment and live-verification attempt)
- Action: Reviewed the working-tree diff and confirmed it was limited to the three approved files plus this tracker. Re-ran the build and the typecheck baseline. Committed only those four files as `2a9c5cea310cffc2eda45dbfda275e3474fab408` and pushed to `origin/main`. The push triggered `.github/workflows/deploy.yml` ("Deploy to GitHub Pages"), which runs `npm ci` + `npm run build` only — no migrations, no Desktop build. Then drove the published site with Playwright.
- Result: **Deployment succeeded.** The production build manifest now serves `build_id` `2a9c5ce` / `commit_hash` `2a9c5cea310cffc2eda45dbfda275e3474fab408`, and the deployed `ActivityReportsPage-BK5GJVQr.js` contains **0** occurrences of `get_employee_daily_tracking` and **1** occurrence of `get_employee_day_timeline`. The 38 pre-existing unrelated working-tree entries were left untouched and are not in the commit.
- Verification (live, against `https://ahram-distribution.github.io/store`):
  - Workflow run `36848647982` finished with conclusion **success**. Its own gate confirms production serves the expected `build_id`, so a stale-CDN outcome would have failed the run.
  - `GET /store/build-manifest.json` → HTTP 200, `build_id` = `2a9c5ce`.
  - Published chunk `assets/ActivityReportsPage-BK5GJVQr.js`: `get_employee_daily_tracking` **0**, `get_employee_day_timeline` **1**, `visit_start` **3**, `visit_end` **3**, `visit_id` **4**. No `getCurrentPosition`, `watchPosition`, `setInterval`, `geolocation`, `heartbeat`, or `presence` in the chunk.
  - Live PostgREST probe of the exact endpoint the browser calls: `POST /rest/v1/rpc/get_employee_daily_tracking` → **HTTP 404 PGRST202** (confirmed the RPC genuinely does not exist); `POST /rest/v1/rpc/get_employee_day_timeline` → **HTTP 200** with `{"error":"INVALID_SESSION"}` (confirmed the RPC exists and is correctly session-gated).
  - Playwright load of `https://ahram-distribution.github.io/store/#/reports/activity` → HTTP 200, title `الأهرام - نظام التوزيع المتكامل`, served the new `index-CqObAO-9.js`, **zero console errors and zero page errors**, and redirected to `#/login` as an unauthenticated visitor should.
- Verification **FAILED to complete** — live authenticated test of the day view. `ProtectedRoute employeeOnly` gates `/reports/activity`, so selecting an employee and day requires a real login. The two credentials hard-coded in the repository's own e2e specs — `01066197010 / 123321` (`e2e/manager-reports-verify.spec.ts`) and `01004466887 / 262006` — both returned `{"success": false, "error": "INVALID_CREDENTIALS"}` from the live `login` RPC, although both identities exist and are `is_active = true` in production. The 12 "role test accounts" listed in `docs/archive/project-state/MASTER_PROJECT_STATE.md` §18 do not exist in `public.identities` at all. Passwords were not guessed and no real employee's session token was borrowed. Therefore the following remain **unconfirmed in a live browser**: that an employee/day selection loads day activity, that events render with correct timestamps, and that visit markers appear on the map.
- Status: **DEPLOYED, NOT VERIFIED.** The deployment and the code-level evidence are proven; the end-to-end authenticated check is blocked on a valid Web credential. This is deliberately **not** recorded as `VERIFIED`.
- Collateral finding: **RPC-006** remains OPEN and untouched. `get_employee_day_timeline` was not modified by commit `2a9c5ce`; only the three Web files listed in §10.1 changed.
```

```
### 2026-10-01 — Phase 4 / Phase 5 (sales Returns module)
- Findings: the Returns module removal itself, plus **DBX-013** (orphaned Returns tables, blocked) and **RPC-007** (owner-exempt `governed_approve_return`). **RPC-002** became superseded because its only caller was deleted.
- Action: Read-only discovery first, then the owner decision in §11 D-002. Deleted the Returns pages, `src/services/returns.ts`, `OrderReturnsSection.tsx`, the 3 routes, the 3 `pageHealthCheck` manifest entries and every Returns entry point across `AccountPage`, `StorefrontPage`, `AccountantWorkspace`, `ModuleLauncherPage`, `ManagementDashboard`, `CommandCenterPage` and `ModuleWorkspacePage`; removed `UnifiedOrder.returns`, `UnifiedReturnSummary`, the `OrderDetailView` render, the `order-detail.utils.ts` Returns timeline entries and the stale `returns: []` test fixture. Wrote `supabase/migrations/20271202_remove_returns_module_rpcs.sql` and applied it to production `fpsepeuykcioelcmkuup`.
- Result: The Returns feature no longer exists anywhere in the Web. 8 Returns-only RPCs dropped. **Nothing else was dropped**: the 4 Returns tables stay because 16 retained functions depend on them, and `governed_approve_return` stays because the owner exempted it. The 5 name-similar `governed_return_*` functions and the `purchase_returns` tables were confirmed to belong to Delivery, Warehouse, Orders and Purchasing and were left alone. The 38 pre-existing unrelated working-tree entries were untouched and none were staged. Committed as `eb2af43` (20 files, 6 deletions).
- Verification (production, read-only, inside `default_transaction_read_only = on`):
  - Migration dry-run in a rolled-back transaction first; only then applied. Post-apply, all 8 targets absent from `pg_proc`.
  - `governed_approve_return` present at `(p_token uuid, p_return_id uuid)`, body still references `public.returns` — **unchanged, as instructed**.
  - All 13 other keepers present: the 5 `governed_return_*` verbs, `generate_purchase_return_number`, `get_unified_order`, `get_dashboard_management`, `get_command_center`, `get_command_center_v2`, `get_governed_target_performance`, `get_kpi_contributors`, `get_team_members_kpis`, `sync_get_table_allowlist`.
  - All 6 return-named tables present. `sync_get_table_allowlist()` returned 73 entries still including `returns`, `return_items`, `return_inspection`, `return_status_history`.
  - Pre-apply scan proved each drop target had no other database caller and no `pg_depend` object; the only internal edge was `_return_qty_to_pieces` ← `governed_create_return`, dropped together.
  - `npm run build` → `✓ built in 18.07s`, exit 0. `tsc --noEmit` → **exactly 138** errors, identical to baseline, none in any touched file (the 2 that matched touched files were confirmed pre-existing against `HEAD`).
  - All 14 emitted chunks scanned: **0** occurrences of any Returns-only symbol, of `/returns` and of `/command-center/modules/returns`; shared `governed_return_*` verbs and unrelated routes survive; the 3 remaining Arabic "returns" strings are governance labels in `EmployeesPage` and `DataDeletionCenter`.
- Status: **PRODUCTION APPLIED, NOT DEPLOYED.** The database change and the build are verified. The published bundle has **not** been inspected, so under §2 rule 4 this is not `VERIFIED`. `DBX-013` and `RPC-007` remain OPEN and owner-blocked.
- Collateral findings: none new beyond DBX-013 and RPC-007. **RPC-006 remains OPEN and untouched.** No pre-existing TypeScript error was fixed. No Desktop/Electron file, RLS policy, or security setting was touched.
```

```
### YYYY-MM-DD — Phase X
- Finding: F-XXX
- Action: ...
- Result: ...
- Verification: ...
- Status: VERIFIED
```

Rules for this log:
- One entry per finding, or per tightly-coupled group of findings.
- `Result` states what actually happened, including "no change made" or "attempt failed".
- `Verification` names the command or query run and its observed output.
- `Status` is only `VERIFIED` if the verification actually passed. Planned, attempted, or partially applied work is **not** `VERIFIED`.

---

## 9. Open Items

Counters only. Detail lives in §5.

### OPEN — 97
Of 99 registered findings, RPC-001 is fixed and deployed but unverified, RPC-002 is superseded (its only caller was deleted), and RPC-007 is retained by owner exception. Breakdown by phase:

| Phase | Open | Blocked by decision | Blocked by manual review |
|---|---|---|---|
| Phase 1 | 20 | 3 | 1 |
| Phase 2 | 15 | 4 | 4 |
| Phase 3 | 15 | 15 | 0 |
| Phase 4 | 12 | 4 | 0 |
| Phase 5 | 15 | 3 | 12 |
| Phase 6 | 18 | 12 | 1 |
| Phase 7 | 2 | 1 | 0 |
| **Total** | **97** | **42** | **18** |

Phase 1 shows 20 open rather than 22 because RPC-001 is no longer open (tracked under BLOCKED until verified) and RPC-002 is superseded — its only caller, `src/services/returns.ts`, was deleted on 2026-10-01, so the `p_id`/`p_return_id` mismatch it described can no longer occur. Phase 2 gained RPC-006. Phase 2's decision-blocked count rose from 3 to 4 because RPC-006 touches a shared RPC and needs an owner decision on scope. Phase 5 gained **DBX-013** and **RPC-007** from the Returns cleanup, both owner-decision items: the orphaned `returns` tables (16 retained dependents must be refactored first) and the owner-exempt `governed_approve_return`. Both are decision-blocked rather than manual-review, so Phase 5's decision-blocked count rose from 1 to 3 while its manual-review count stayed at 12.

All 15 Phase 3 findings require explicit owner authorization before any action; none may be bundled into a code-fix phase.

### IN PROGRESS
None.

### BLOCKED

**DBX-013 — the four orphaned sales-Returns tables cannot be dropped without an owner decision.**

The Returns feature is fully gone from the Web, so `returns`, `return_items`, `return_inspection` and `return_status_history` now have no user-facing path. All four hold **0 rows**, so nothing would be lost — but they are still written by 16 retained functions: `get_unified_order`, `governed_delete_order`, `governed_supreme_delete_cancelled_order`, `governed_delete_employee_with_transfer`, `get_dashboard_management`, `get_command_center_v2`, `get_governed_target_performance`, `get_kpi_contributors`, `get_team_members_kpis`, 7 × `governed_deletion_*`, `sync_get_table_allowlist`, and the owner-exempt `governed_approve_return`. Two of those matter beyond housekeeping: `get_governed_target_performance` subtracts `return_deduction` and `full_returns` from delivered sales, so target attainment is currently computed net of returns; and the `governed_deletion_*` cascades are the Data Deletion Center's compliance path.

Dropping the tables would therefore break order deletion, employee transfer, dashboards, KPI/target numbers, the Data Deletion Center and mobile sync — every one of them explicitly outside this task's scope. They were left untouched. To retire them the owner must first authorise refactoring those 16 functions, starting with **RPC-007** (`governed_approve_return`), which is both the owner exception and the last hard dependency on `public.returns`.

**RPC-007 — `governed_approve_return` retained unchanged by explicit owner instruction.**

It is unreachable from the Web now that `src/services/returns.ts` is deleted, but it still holds EXECUTE grants for `anon` and `authenticated` and still `UPDATE`s `public.returns`. The owner directed that it be left exactly as-is and that the known RPC-002 parameter mismatch not be repaired, so no further action was taken. Removing it is a separate decision.

**RPC-001 — awaiting a valid Web credential for the authenticated screen test.**

The fix is committed (`2a9c5ce`), pushed, and deployed to production; the published bundle no longer references the missing RPC. What is blocked is the last verification step: `/reports/activity` sits behind `ProtectedRoute employeeOnly`, so the day view cannot be exercised without logging in. Both credentials committed in the repository's e2e specs return `INVALID_CREDENTIALS`, and the documented test accounts do not exist in production.

To close this out, the owner needs to supply a login that can reach `/reports/activity` and that holds the `attendance.view_timeline` capability. Once that is done, the remaining checks are: select an employee and a day, confirm events render with correct timestamps, and confirm visit markers appear.

Also blocked:

- `MIG-012`, `OPS-001` — service-role key returns 401, so the authoritative PostgREST schema cannot be enumerated.
- `MIG-002` — without `supabase_migrations.schema_migrations`, applied-migration order is unknowable, blocking version-accurate diffing.
- `MIG-011` — no `cron` schema, so scheduled-job inventory is impossible.
- `OPS-003` — Recycle Bin items are outside project scope; read-only rules forbid restoration.

### MANUAL REVIEW
Items that cannot be actioned by code evidence alone and require a human or owner judgement:
- `SEC-*` (10 of 10) — security posture decisions
- `MIG-007`, `MIG-008`, `MIG-009`, `MIG-010`, `MIG-011` — overload and object-identity review
- `FED-002`, `FED-005`, `FED-007`, `FED-010` — reachability vs manual-use judgement
- `DBX-001` through `DBX-012` — dead-object confirmation under §2 rule 5
- `DOC-011` — open owner questions

Two further items need owner judgement but are counted as decision-blocked, not manual-review: **DBX-013** (authorising the refactor of 16 retained dependents so the orphaned Returns tables can be dropped) and **RPC-007** (whether to retire the owner-exempt `governed_approve_return`). Both are described under BLOCKED above.

---

## 10. Completed Items

### FIXED

#### 10.1 RPC-001 — missing `get_employee_daily_tracking` on `/reports/activity`

**Problem.** `src/pages/reports/ActivityReportsPage.tsx` called `get_employee_daily_tracking`, which does not exist in production. Selecting a day raised PGRST202, so the Activity Reports day view failed.

**Decision.** Do not add a new RPC and do not restore any continuous tracking. Reuse the existing governed RPC `get_employee_day_timeline`, which already returns the recorded operational events for the day. The system records real locations for the events that legitimately have one — workday start/end (842/842), breaks (95/95), and visit check-in/check-out (2313/2396 and 2301/2393) — so the map can show meaningful markers without any movement path.

**What changed.**
- `src/pages/reports/ActivityReportsPage.tsx` — removed the `get_employee_daily_tracking` call; the day detail is now built from `get_employee_day_timeline` alone. Visit markers are derived by pairing `visit_start` with `visit_end` on `metadata.visit_id`. `route`, `long_stops`, `total_distance_km` and `total_points` stay empty/zero.
- `src/types/reports.ts` — added the `metadata` field to `DayTimelineEvent`, which the RPC already returned but the type did not declare.
- `src/components/TrackingExplorerModal.tsx` — when there is no route, the map frames the visit locations instead of sitting on the default centre; route-only legend entries are hidden when no route exists. The component's props and behaviour for existing callers are unchanged, so `ManagerReportsPage` is unaffected.

**Explicitly not done.** No heartbeat, presence, or periodic GPS polling. No high-frequency writes. No distance, speed, or long-stop inference. No migration. No Desktop change. No unrelated cleanup, and no fix to any pre-existing TypeScript error.

**Resulting behaviour.** Day selection issues 1 RPC instead of 2 — a quota/egress improvement. Attendance, breaks, visits, orders, collections, and customer events appear on the timeline with their own real timestamps, and visits appear as map markers with the location recorded at check-in.

**Verification.** Build passes (`✓ built in 20.14s`, exit 0). `tsc --noEmit` remains at exactly 138 pre-existing errors, none in the changed files. `get_employee_daily_tracking` no longer appears anywhere under `src/`. A read-only production replay of the RPC's event CTE, piped through the new mapping function, produced 4 correctly-formed visit markers with 0 invalid coordinates, all events timestamped, and all visit pairs correctly matched.

**Deployment (2026-10-01).** Committed as `2a9c5cea310cffc2eda45dbfda275e3474fab408` together with this tracker and nothing else, pushed to `origin/main`, and deployed by workflow run `36848647982` (conclusion: **success**) to `https://ahram-distribution.github.io/store`. Production serves `build_id` `2a9c5ce`. The deployed `ActivityReportsPage-BK5GJVQr.js` contains **0** references to `get_employee_daily_tracking`. A live probe confirms `POST /rest/v1/rpc/get_employee_daily_tracking` returns **404 PGRST202** while `POST /rest/v1/rpc/get_employee_day_timeline` returns **200** — so the screen can no longer raise PGRST202 from this call. The app boots on the published host with no console or page errors.

**Outstanding.** The authenticated half of the test could not be run: `/reports/activity` is behind `ProtectedRoute employeeOnly`, and every credential available in the repository returns `INVALID_CREDENTIALS`. Day selection, event timestamps, and map markers are therefore confirmed by code and data-contract evidence but **not yet observed rendering in a live browser**. A working Web login is required to finish this; see §9.

Because of that gap this item is deliberately recorded as **DEPLOYED, NOT VERIFIED** rather than `VERIFIED`.

#### 10.2 Sales Returns module — Web removal and RPC retirement (2026-10-01)

**Problem.** The sales Returns module was a complete, user-facing feature (3 pages, 3 routes, a dedicated RPC service, an order-detail section, and entry points in 7 screens) whose entire backend surface was `returns` plus 8 RPCs, with `governed_approve_return` named as an explicit owner exception.

**Decision (D-002).** The dependency check contradicted the task's premise: the `returns` table is not Returns-isolated. Sixteen retained functions read or write it, including `governed_approve_return` itself, `get_unified_order` (which embeds a `returns` array in every order payload), `governed_delete_order`, `governed_delete_employee_with_transfer`, `get_dashboard_management`, `get_command_center_v2`, `get_governed_target_performance` (which subtracts `return_deduction` and `full_returns` from delivered sales), `get_kpi_contributors`, `get_team_members_kpis`, the 7 `governed_deletion_*` cascades, and `sync_get_table_allowlist`. "Retain `governed_approve_return` unchanged" and "drop the Returns tables" are mutually exclusive.

The owner was shown this dependency map and chose **Web + Returns-only RPCs, keep the tables**. That option satisfies the exception without breaking anything outside scope. The alternatives — editing the 16 dependents, or also dropping `governed_approve_return` — would both have violated an explicit instruction.

**What changed.**
- **Deleted:** `src/pages/returns/{ReturnsPage,ReturnDetailPage,ReturnNewPage}.tsx`, `src/pages/returns/index.ts`, `src/services/returns.ts`, `src/components/orders/OrderReturnsSection.tsx`.
- **Routes:** `/returns`, `/returns/new`, `/returns/:id` removed from `src/routes/index.tsx`, plus the three `ROUTE_MANIFEST` entries in `src/utils/pageHealthCheck.ts`.
- **Navigation and entry points removed from:** `AccountPage`, `StorefrontPage`, `AccountantWorkspace`, `ModuleLauncherPage`, `ManagementDashboard` (the pending-returns KPI tile), `CommandCenterPage` (`MODULE_ROUTES`, `MODULE_EMOJI`, `MODULE_TIERS.secondary`), `ModuleWorkspacePage` (module block + quick operation).
- **Orders:** removed `returns` from `UnifiedOrder`, deleted `UnifiedReturnSummary`, removed the `<OrderReturnsSection>` render, removed the Returns entries from the `order-detail.utils.ts` timeline, and dropped the now-stale `returns: []` field from the legacy adapter test fixture.
- **Database:** `supabase/migrations/20271202_remove_returns_module_rpcs.sql` drops the 8 RPCs that had no remaining caller — `get_governed_returns`, `get_governed_return`, `get_governed_return_items`, `governed_create_return`, `governed_reject_return`, `governed_update_return`, `generate_sales_return_number`, and `_return_qty_to_pieces` (the helper's only caller was the create RPC dropped alongside it). Their `anon`/`authenticated` EXECUTE grants disappear with them, closing the dead PostgREST surface. **Applied to production** `fpsepeuykcioelcmkuup`.

**Explicitly not done.** `governed_approve_return` untouched — signature, body and grants unchanged, and the RPC-002 `p_id`/`p_return_id` mismatch deliberately **not** repaired. All four sales-Returns tables untouched. `governed_return_delivery`, `governed_return_journey`, `governed_return_to_preparation`, `governed_return_order_for_revision` and `governed_return_deferred` untouched — name similarity only; they operate on Delivery, Warehouse and Orders and reference no returns table. `purchase_returns`, `purchase_return_items` and `generate_purchase_return_number` untouched — Purchasing, foreign-keyed to suppliers. `sync_get_table_allowlist` untouched. The `transferred.returns` label in the employee-transfer and Data Deletion Center screens kept, because it reports counts from retained governance RPCs rather than Returns UI.

**Verification.** The migration was dry-run inside a rolled-back transaction before it was applied. Post-apply, read-only: all 8 target functions absent; `governed_approve_return` present at `(p_token uuid, p_return_id uuid)` with `public.returns` still referenced; all 13 other keepers present; all 6 return-named tables present; `sync_get_table_allowlist()` returns 73 entries still including the 4 Returns tables; `get_unified_order`, `get_dashboard_management`, `get_command_center`, `get_command_center_v2`, `get_governed_target_performance`, `get_kpi_contributors` and `get_team_members_kpis` all intact. `npm run build` succeeded (`✓ built in 18.07s`). `tsc --noEmit` is still exactly 138 errors, unchanged from baseline, with none in any touched file — the two that matched touched files (`OrderCollectionsSection` importing the non-existent `UnifiedOrderCollection`, and the missing `vitest` module) were confirmed pre-existing against `HEAD`. Bundle scan of all 14 emitted chunks: **0** occurrences of any Returns-only symbol, of `/returns`, or of `/command-center/modules/returns`; the shared `governed_return_*` verbs and unrelated routes survive; the 3 remaining Arabic "returns" strings are governance labels in `EmployeesPage` and `DataDeletionCenter`. All 38 pre-existing unrelated working-tree entries were left untouched and none were staged.

**Outstanding.** Not closed under §2 rule 4 until the deployed bundle is inspected. DBX-013 and RPC-007 remain open — see §9 BLOCKED. No `vitest` in the project, so no test suite could be run; the legacy adapter fixture was validated by `tsc` only.

### VERIFIED
No remediation has been fully verified. The `VERIFIED` list in §7 records **audit findings**, not completed remediations; it must not be read as remediation progress.

RPC-001 is listed under FIXED rather than here because its deployment is proven but its authenticated screen check is blocked. The Returns cleanup (10.2) is listed there for the same reason: its production database change is verified, but the published bundle has not been inspected yet. Live browser verification is still outstanding.

### CLOSED
None. No finding has met the §2 closure rule yet, because RPC-001 has not been re-verified against the live authenticated page.

---

## 11. Decision Log

## Owner Decisions

**D-001 — 2026-09-30 — RPC-001: how the Activity Reports day view should obtain its data.**

The missing `get_employee_daily_tracking` RPC had to be replaced by something. Three options were considered:

1. **Add a new `get_employee_daily_tracking` migration to production.** Rejected. It would require a live schema change, a new migration, new grants, and new security review, for data the system already records. It would also add a permanently dead-but-present object, since nothing can populate a continuous movement path without restoring the tracking we are removing.
2. **Restore continuous tracking** (periodic GPS writes, distance, long stops). Rejected. This is the behaviour being eliminated, and it is the source of the quota, battery, and data-volume costs the cleanup exists to remove.
3. **Reuse the existing `get_employee_day_timeline` and show the operational events it already returns.** Adopted.

**Accepted trade-off.** The day view will no longer draw a movement path, and will no longer show distance, long stops, or GPS point counts. In exchange, no new tracking data is collected and no database change is needed. Attendance, breaks, visits, orders, collections, and customer events still appear on the timeline with their real timestamps, and visits still appear on the map using the location recorded at check-in — which is location the system already legitimately holds.

**Owner decisions still required:** a Web credential that can reach `/reports/activity`, so RPC-001's final verification can be completed. See §9 BLOCKED.

**D-002 — 2026-10-01 — Sales Returns module: how far to go given that `returns` is depended on by 16 retained functions.**

The task asked for the Returns tables to be removed, and separately for `governed_approve_return` to be left exactly as it is. These are incompatible: the retained function does `UPDATE public.returns SET status='approved'`, so preserving it requires preserving the table. Beyond that function, 15 others read or write `returns` or `return_items`, and several of them serve modules that were explicitly out of scope — `governed_delete_order` (Orders), `governed_delete_employee_with_transfer` (Employees), `get_dashboard_management` and `get_command_center_v2` (dashboards), `get_governed_target_performance` / `get_kpi_contributors` / `get_team_members_kpis` (KPIs and target attainment), 7 × `governed_deletion_*` (Data Deletion Center) and `sync_get_table_allowlist` (mobile sync).

Four options were put to the owner:

1. **Web + Returns-only RPCs, keep the tables.** Adopted.
2. Drop the tables and rewrite the 16 dependents to remove their Returns logic. Rejected — violates the `governed_approve_return` exception and edits modules the task placed out of scope.
3. Drop the tables and drop `governed_approve_return` too. Rejected — directly contradicts the explicit retention instruction.
4. Web only, leave every database object in place. Rejected — leaves 6 publicly granted RPCs with no caller.

**Accepted trade-off.** The Returns feature is gone from every user-facing surface, and its RPC surface is retired, but 4 empty tables and 1 unreachable RPC remain in production. Nothing can regress, because nothing user-facing can reach them; the cost is database surface area only. The residue is recorded as **DBX-013** and **RPC-007** rather than deleted, because deleting it is a change to Orders, KPIs, dashboards and compliance behaviour and therefore the owner's call, not a cleanup detail.

**Owner decisions still required:** whether to authorise refactoring the 16 retained dependents so the four Returns tables can be dropped, and whether to retire `governed_approve_return`. See §9 BLOCKED.

Required format:

```
### D-NNN — YYYY-MM-DD
- Question: ...
- Decision: ...
- Rationale: ...
- Affects findings: F-XXX, F-XXX
- Phase authorized: N
- Reversible: yes/no
```

Decisions already required before Phase 3 can start:
1. Whether to enable RLS on the 30 tables holding inert policies.
2. Whether to revoke anon grants, and on which tables.
3. Whether the `backup_removed_*` tables are retained, sanitized, or dropped.
4. Whether the 19 debug/test functions may be dropped from production.

Decisions required before Phase 4/5 deletion can start:
5. Whether the 146-file architecture island is deleted, or retained for the Desktop build.
6. Which of the 213 uncalled functions are operational and must be retained.

---

## 12. Final Closure

## Program Closure

**Status: OPEN**

This program is not complete. It may be marked `CLOSED` only when every requirement below is satisfied.

### Closure requirements

| # | Requirement | Status |
|---|---|---|
| 1 | All P0 findings resolved or explicitly accepted in writing by the owner | NOT MET |
| 2 | All P1 findings resolved or explicitly accepted in writing by the owner | NOT MET |
| 3 | All remediation changes verified, with evidence recorded in §8 | NOT MET |
| 4 | Local source and Published Web aligned | NOT MET — local `dist` is stale (OPS-002) |
| 5 | Web RPC contracts aligned with the production database | NOT MET — RPC-001 deployed but its authenticated check is blocked; RPC-002, MIG-001, RPC-006 open |
| 6 | Migration truth reconciled (all production objects reproducible from the repository) | NOT MET — MIG-001, MIG-002 |
| 7 | Dead-code cleanup completed where approved | NOT MET — Phase 4 not started |
| 8 | Dead-database-object cleanup completed where approved | NOT MET — Phase 5 not started |
| 9 | Security findings resolved or explicitly accepted | NOT MET — Phase 3 not started |
| 10 | Documentation reconciled to a single source of truth | NOT MET — Phase 6 not started |
| 11 | No known broken live routes | NOT MET — RPC-001 is deployed and the missing-RPC call is gone from the published bundle, but the route has not been re-verified in an authenticated browser; RPC-002, RPC-006 open |
| 12 | Build/typecheck gate prevents regression | NOT MET — TSC-014 |
| 13 | Final regression and build verification completed | NOT MET — Phase 7 not started |
| 14 | All cleanup decisions documented in §11 | NOT MET |
| 15 | No open items in §9 without an owner decision record | NOT MET |

**0 of 15 closure requirements met.**

---

## 13. Master Tracker Rule

**This file is the MASTER TRACKER for the Web Code / Runtime / Database remediation program.**

Every future remediation task MUST update this same file.

Do not create:
- separate remediation reports
- separate cleanup trackers
- separate phase status files
- per-phase trackers of any kind

Historical audit reports may remain in `docs/09-REPORTS/` as evidence, but **this file is the current status authority.** If a finding's status differs between this file and any other document, this file wins.

Maintenance obligations for every future update:
- Update §1 Current status, Current phase, and Last updated.
- Update the affected row(s) in §5 — including `Current Status`, `Fix/Decision`, and `Verification`.
- Append to §8 Change Log. Never rewrite history.
- Recount §9 and §12.
- Record owner decisions in §11 only.

---

## 14. Document Verification Log

Verification performed at creation time of this file, then updated after the RPC-001 remediation.

### 14.1 At creation (audit only)

| Check | Result |
|---|---|
| File exists at `D:\Projects\store\docs\09-REPORTS\WEB_CODE_RUNTIME_DATABASE_CLEANUP_MASTER.md` | Yes |
| Target directory pre-existed | Yes — `docs\09-REPORTS` (not created by this task) |
| Pre-existing file overwritten | No — file did not exist beforehand |
| All required sections present | Yes — §1 through §14 |
| All initial findings traced to the audit | Yes — no findings invented; every row cites audit evidence |
| Findings registered | 96 |
| Findings marked FIXED | 0 — correct, no remediation had occurred |
| Source code changed | **No** |
| Database changed | **No** — all production queries were read-only |
| Migrations created | **No** |
| Files deleted / moved / renamed | **No** |
| Deployment performed | **No** |
| Commit or push performed | **No** |
| Git change from this task | The new untracked file `docs/09-REPORTS/WEB_CODE_RUNTIME_DATABASE_CLEANUP_MASTER.md` — nothing else |

**Pre-existing working-tree state (NOT caused by this task):** 38 entries consisting of 16 tracked deletions and 22 untracked destination files, all resulting from an earlier, separately authorized root-documentation cleanup. This task neither created nor altered any of them. Git was therefore already dirty before this file was written, and remains dirty for the same 38 entries plus this one new file.

### 14.4 After the sales Returns removal (2026-10-01)

| Check | Result |
|---|---|
| Commit | `eb2af43` — `refactor(web): remove sales Returns module and its exclusive RPCs` |
| Commit contents | 20 paths: 13 Returns-related Web sources, 6 deletions, and the new migration. Tracker committed separately. No unrelated changes. |
| Unrelated working-tree entries | All pre-existing entries still present and untouched; none included in the commit |
| Web files deleted | `src/pages/returns/` (4), `src/services/returns.ts`, `src/components/orders/OrderReturnsSection.tsx` |
| Routes removed | `/returns`, `/returns/new`, `/returns/:id` |
| Nav entries removed | AccountPage, StorefrontPage, AccountantWorkspace, ModuleLauncherPage, ManagementDashboard, CommandCenterPage, ModuleWorkspacePage, pageHealthCheck |
| Migration created | `supabase/migrations/20271202_remove_returns_module_rpcs.sql` — **Yes** (first migration of this program) |
| Migration applied | **Yes** — production `fpsepeuykcioelcmkuup`. Old project `gbcbejejgpvltuhbztbx` never queried. |
| Migration dry-run | Passed inside a rolled-back transaction before applying |
| RPCs dropped (8) | `get_governed_returns`, `get_governed_return`, `get_governed_return_items`, `governed_create_return`, `governed_reject_return`, `governed_update_return`, `generate_sales_return_number`, `_return_qty_to_pieces` |
| `governed_approve_return` | **RETAINED UNCHANGED** — `(p_token uuid, p_return_id uuid)`, still `UPDATE`s `public.returns`; RPC-002 mismatch deliberately not repaired |
| Returns tables | **ALL 4 RETAINED** — `returns`, `return_items`, `return_inspection`, `return_status_history`, all 0 rows, blocked by 16 retained dependents |
| `governed_return_*` siblings | All 5 retained and untouched — Delivery / Warehouse / Orders, not Returns |
| `purchase_returns` + `generate_purchase_return_number` | Retained — Purchasing |
| Pre-migration dependency proof | No other DB caller and no `pg_depend` object for any drop target; only `_return_qty_to_pieces` ← `governed_create_return`, dropped together |
| Post-migration re-verification | 8 targets absent; 13 keepers present; `sync_get_table_allowlist()` = 73 entries incl. the 4 Returns tables; `get_unified_order`, `get_dashboard_management`, `get_command_center`, `get_command_center_v2`, `get_governed_target_performance`, `get_kpi_contributors`, `get_team_members_kpis` intact |
| New TypeScript errors | **None** — `tsc --noEmit` still exactly 138, the 2 matching touched files confirmed pre-existing against `HEAD` |
| Build verification | `npm run build` exit 0, `✓ built in 18.07s` |
| Bundle scan (14 chunks) | Returns-only symbols **0**, `/returns` **0**, `/command-center/modules/returns` **0**; shared `governed_return_*` verbs and unrelated routes present |
| Tests | **Not run** — the project has no `test` script and `vitest` is not installed; the legacy adapter fixture was validated by `tsc` only |
| Security / RLS / grants | **Not touched** — only the EXECUTE grants that vanished with the 8 dropped functions |
| Desktop / Electron touched | **No** |
| Deployment performed | **No** — push and deploy are separate steps |
| `DBX-013` / `RPC-007` | Registered, OPEN, owner-blocked — see §9 BLOCKED |
| `RPC-006` status | **OPEN**, untouched |

### 14.3 After RPC-001 deployment and live-verification attempt (2026-10-01)

| Check | Result |
|---|---|
| Commit | `2a9c5cea310cffc2eda45dbfda275e3474fab408` (`2a9c5ce`) |
| Commit contents | Exactly 4 files: the three approved Web sources plus this tracker. No unrelated changes. |
| Unrelated working-tree entries | 38, all still present and untouched; none included in the commit |
| Push | `bed38d7..2a9c5ce  main -> main`, exit 0 |
| Deployment workflow | `.github/workflows/deploy.yml` — "Deploy to GitHub Pages" |
| Workflow run | `36848647982`, conclusion **success** |
| Deployment target | `https://ahram-distribution.github.io/store` |
| Production `build_id` | `2a9c5ce`, matching the commit |
| Published bundle check | `ActivityReportsPage-BK5GJVQr.js`: `get_employee_daily_tracking` **0**, `get_employee_day_timeline` **1** |
| Live RPC probe | missing RPC → **404 PGRST202**; new RPC → **200** (session-gated) |
| Published app boot | HTTP 200, no console errors, no page errors, unauthenticated redirect to `#/login` correct |
| Tracking introduced | **None.** No `getCurrentPosition`, `watchPosition`, `setInterval`, `geolocation`, `heartbeat`, or `presence` in the changed or deployed chunks. |
| `get_employee_day_timeline` modified | **No** — RPC-006 deliberately untouched |
| Desktop / Electron touched | **No** |
| Migrations created or run | **No** |
| Pre-existing TypeScript errors touched | **No** — still exactly 138 |
| **Authenticated live verification** | **BLOCKED** — no valid Web credential; both repo e2e credentials return `INVALID_CREDENTIALS` |
| RPC-001 final status | **DEPLOYED, NOT VERIFIED** |
| RPC-006 status | **OPEN**, untouched |

### 14.2 After RPC-001 remediation (2026-09-30)

| Check | Result |
|---|---|
| Findings registered | 97 — the 96 audit findings plus RPC-006, discovered during this remediation |
| Findings FIXED | 1 — RPC-001, locally verified, pending deployment |
| Findings CLOSED | 0 — the §2 closure rule requires a live re-verification that cannot happen before deployment |
| Source code changed | **Yes, intentionally** — `src/pages/reports/ActivityReportsPage.tsx`, `src/components/TrackingExplorerModal.tsx`, `src/types/reports.ts` |
| Database changed | **No** — the only production queries were read-only and ran inside `default_transaction_read_only = on` |
| Migrations created | **No** — not required; the fix reuses an existing RPC |
| New RPCs added | **No** — deliberate, see §11 decision D-001 |
| Files deleted / moved / renamed | **No** |
| Desktop / Electron touched | **No** |
| Pre-existing TypeScript errors touched | **No** — still exactly 138, unchanged |
| Deployment performed | **No** — not authorized for this task |
| Commit or push performed | **No** — left for the owner to review |
| Git change from this task | 3 modified source files + this untracked tracker |
| Working-tree entries total | 42 = the 39 entries present before this task (38 pre-existing + this tracker) + the 3 source files |
| Build verification | `npm run build` exit code 0, `✓ built in 20.14s` |
| Live browser verification | **Not performed** — no deployment; this is the only outstanding step for RPC-001 |
