# Phase 2 Verification Report: Ahram Distribution System

**Date:** 2026-06-05  
**Scope:** Live Supabase DB vs Repository Code & Documentation  
**Methodology:** Read-only inspection of live DB (via Management API SQL endpoint), all 30 migration files, all source code  
**Constraints:** No modifications permitted

---

## Section 1: Database-Migration Drift

### 1.1 Tables in Live DB but Missing from Migrations

The following tables exist on the live Supabase database (`public` schema) but have **no CREATE TABLE statement in any migration file**:

| Table | Evidence | Severity |
|---|---|---|
| `credit_programs` | Used in `20260604_credit_programs_v2.sql` FK references but never created | **CRITICAL** |
| `credit_applications` | Same — FK references assume pre-existence | **CRITICAL** |
| `credit_contracts` | Same — FK references assume pre-existence | **CRITICAL** |
| `credit_contract_templates` | Same — FK references assume pre-existence | **CRITICAL** |
| `treasury_transactions` | No migration references at all | **HIGH** |
| `company_profile` | No migration references at all | **HIGH** |
| `expenses` | No migration references at all | **HIGH** |
| `employee_advances` | No migration references at all | **HIGH** |
| `return_inspection` | No migration references at all | **HIGH** |
| `tier_company_exceptions` | Referenced in tier enforcement RPCs but no CREATE TABLE | **MEDIUM** |
| `tier_product_exceptions` | Referenced in tier enforcement RPCs but no CREATE TABLE | **MEDIUM** |
| `auctions` (V1) | Legacy V1 tables — no CREATE TABLE in recent migrations | **MEDIUM** |
| `auction_bids` (V1) | Same | **MEDIUM** |
| `auction_participants` (V1) | Same | **MEDIUM** |
| `auction_awards` (V1) | Same | **MEDIUM** |
| `auction_items` (V1) | Same | **MEDIUM** |
| `auction_activity` (V1) | Same | **MEDIUM** |

**Impact:** The database is irreproducible from migrations alone. A fresh `supabase db push` would fail with FK errors on credit tables. V1 auction tables persisted but cannot be recreated.

### 1.2 Tables in Migrations but Missing from Live DB

| Table | Migration File | Status | Severity |
|---|---|---|---|
| `unified_locations` | `20260604_unified_identity_location.sql` | **PRESENT** (live) with RLS enabled | OK |
| `customer_credit_accounts` | `20260604_credit_programs_v2.sql` | **PRESENT** (live) | OK |
| `credit_invoices` | `20260604_credit_programs_v2.sql` | **PRESENT** (live) | OK |
| `credit_invoice_cheques` | `20260604_credit_programs_v2.sql` | **PRESENT** (live) | OK |
| All auction V2 tables | `20260603_auction_v2.sql` | **PRESENT** (live) | OK |
| All V2 deal/flash tables | Various | **PRESENT** (live) | OK |

**No migration-only tables missing from live DB** — all migrations have been applied.

### 1.3 Schema Divergence Summary

| Metric | Count |
|---|---|
| Tables in live DB but NOT in any migration | 17+ |
| Tables in migrations and present on live DB | ~42 |
| Tables in migrations but MISSING from live DB | 0 |

---

## Section 2: RPC/Function Drift

### 2.1 Functions on Live DB but NOT in Migrations (Live-Only)

These RPCs/functions exist on live Supabase but cannot be found in any migration file:

| Function | Schema | Notes | Severity |
|---|---|---|---|
| `governed_create_customer_with_address` | public | Not in any migration | **HIGH** |
| `governed_create_company` | public | Not in any migration | **HIGH** |
| `governed_update_company` | public | Not in any migration | **HIGH** |
| `governed_delete_company` | public | Not in any migration | **HIGH** |
| `governed_delete_customer` | public | Not in any migration | **HIGH** |
| `governed_delete_employee` | public | Not in any migration | **HIGH** |
| `governed_delete_product` | public | Not in any migration | **HIGH** |
| `governed_delete_daily_deal` | public | Not in any migration | **HIGH** |
| `governed_delete_flash_offer` | public | Not in any migration | **HIGH** |
| `governed_delete_tier` | public | Not in any migration | **HIGH** |
| `governed_delete_visit` | public | Not in any migration | **HIGH** |
| `governed_delete_collection` | public | Not in any migration | **HIGH** |
| `governed_create_contract_template` | public | Not in any migration | **HIGH** |
| `governed_update_contract_template` | public | Not in any migration | **HIGH** |
| `governed_update_credit_program` | public | Not in any migration | **HIGH** |
| `governed_toggle_credit_program` | public | Not in any migration | **HIGH** |
| `governed_approve_return` | public | Not in any migration | **HIGH** |
| `governed_update_return` | public | Not in any migration | **HIGH** |
| `governed_complete_visit` | public | Not in any migration | **HIGH** |
| `governed_update_company_profile` | public | Not in any migration | **HIGH** |
| `governed_create_visit` | public | Not in any migration | **MEDIUM** |
| `get_collection_followup_queue` | public | Not in any migration | **MEDIUM** |
| `get_collection_report` | public | Not in any migration | **MEDIUM** |
| `test_rpc` | public | Debug function, not in migrations | **LOW** |

**Note:** `login`, `logout`, `validate_session` exist in BOTH `api` schema (plpgsql) and `public` schema (sql) on live. Only the `api` schema versions (plpgsql) are in migrations (`20260604_unified_identity_location.sql`). The `public` schema sql versions are likely older duplicates.

**Impact:** These RPCs exist on live but cannot be recreated from migrations. Any delete operation capability on customers, employees, products, deals, flash offers, tiers, visits, and collections is irreproducible.

### 2.2 Functions with Different Signatures

| Function | Migration Version | Live Version | Difference |
|---|---|---|---|
| `check_capability` | `check_capability(p_token uuid, p_code text)` | Same | OK |
| `governed_create_order` | 5+ overloads in different files | Live has consolidated version | Potential overload mismatch |
| `get_employee_activity` | In `20260602_runtime_screen_completion.sql` and `20260605_customer_direct_ownership.sql` | Live has 3 overloads | OK — overloads exist |

---

## Section 3: Governance Architecture Verification

### 3.1 Governance Design

The system uses a **capability-based governance model** implemented via:
1. **SECURITY DEFINER RPCs** (118+ functions) — execute as DB owner, bypassing RLS
2. **Session token validation** — every governed RPC validates `p_token` against `app.sessions`
3. **Capability checks** — RPCs call `check_capability()` internally for authorization
4. **Route-level guards** — `ProtectedRoute` with `requireCapability` in frontend
5. **Component-level guards** — `useCapability` hook with 5-min cache

### 3.2 RLS Policy Analysis

**Finding: 86 RLS policies defined but ALL are dormant.**

The live database has 86 RLS policies defined across public tables (`pg_policies` returns rows), but `pg_tables` shows `rowsecurity = false` for ALL public tables except `unified_locations`. This means RLS was **never enabled** on these tables when policies were created, making all policies inert.

| Table | RLS Enabled? | Policies Defined | Status |
|---|---|---|---|
| `unified_locations` | YES | 0 (default-deny) | Defense-in-depth |
| All other `public.*` tables | **NO** | 86 total | **DORMANT** |

Policy patterns found:
- `p_select` — gated by `app.current_identity_id() IS NOT NULL` (any authenticated user)
- `p_insert`/`p_update`/`p_delete` — gated by `app.has_capability('...')`
- `p_all` — admin-only specific capabilities

**Risk:** If RLS were ever enabled on these tables, the policies would activate and could conflict with the RPC-only governance model. The intended design relies solely on RPC authorization, but dormant policies are misleading.

### 3.3 Governance Chain Verification

```
Frontend Route (ProtectedRoute)
  → useCapability hook (client-side cache, 5-min TTL)
    → authService.checkCapability()
      → check_capability(p_token, p_code) [SECURITY DEFINER RPC]
        → validates session in app.sessions
          → checks employee_capabilities (direct grant/deny)
            → checks role_capabilities (via employee_roles)
              → returns boolean
```

Verified: All SECURITY DEFINER RPCs execute with `search_path=public, extensions` (explicit, safe). The `check_capability` function properly validates sessions before checking permissions.

**Exception:** The `app` schema functions (`can_view_employee_data`, `has_capability`, `has_role`, etc.) use `SECURITY INVOKER` — they run as the calling user. These are used for RLS policy definitions (which are dormant) and are not part of the main governance path.

---

## Section 4: Governance Bypasses

### 4.1 Direct Table Access in Frontend Code

| File | Line(s) | Access Pattern | Risk |
|---|---|---|---|
| `src/services/deals.ts` | 39-62 | `supabase.from('packages').select('*')` | **HIGH** — no capability check, no session validation, bypasses all governance |

The `deals.ts` service reads directly from the `packages` table, bypassing RPC governance entirely. This is the legacy Phase 9 module — the new `dailyDeals.ts` and `flashOffers.ts` use governed RPCs correctly, but the old path remains active.

**Root cause:** `DealsPage.tsx` imports `dealService` (from `deals.ts`) and renders it alongside governed deal/flash-offer components. Both paths coexist.

### 4.2 Realtime Subscriptions (Read-Only)

| File | Table | Channel Subscription | Risk |
|---|---|---|---|
| `src/services/auctions.ts` | `auction_bids` | `supabase.channel()` | **LOW** — read-only, but bypasses governance for reads |
| `src/services/auctions.ts` | `auction_activity` | `supabase.channel()` | **LOW** |
| `src/services/auctions.ts` | `auction_participants` | `supabase.channel()` | **LOW** |

These subscribe to PostgreSQL realtime changes for live UI updates. They do not modify data, but they do bypass the governed RPC read path. The realtime publication settings on these tables were not verified.

---

## Section 5: Unused and Dead Code

### 5.1 Unused Services

Six service files are defined, exported from the barrel (`services/index.ts`), but **never imported by any component, page, hook, or store**:

| Service File | Exported As | Defined At | Consumer Count |
|---|---|---|---|
| `src/services/employees.ts` | `employeeService` | Line 7 | **0** |
| `src/services/customers.ts` | `customerService` | Line 15 | **0** |
| `src/services/orders.ts` | `orderService` | Line 12 | **0** |
| `src/services/visits.ts` | `visitService` | Line 12 | **0** |
| `src/services/collections.ts` | `collectionService` | Line 12 | **0** |
| `src/services/returns.ts` | `returnService` | Line 12 | **0** |

**Root cause:** The corresponding page components (e.g., `EmployeesPage.tsx`, `CustomersPage.tsx`, etc.) bypass the service layer and call `supabase.rpc(...)` directly via `../../lib/supabase`. These services were defined but never wired into the pages.

### 5.2 Unused Store

| Store File | Exported As | Consumer Count |
|---|---|---|
| `src/store/collections.ts` | `useCollectionsStore` | **0** |

The `useCollectionsStore` defines a Zustand store with `collections` state, `setCollections`, and `addCollection` methods — but no file in `src/` imports it.

### 5.3 Empty Stub Directories

These directories contain only `export {}` barrel files — no components:

| Directory | File |
|---|---|
| `src/pages/sales-supervisor/` | `index.ts` (empty) |
| `src/pages/supervisor/` | `index.ts` (empty) |
| `src/pages/manager/` | `index.ts` (empty) |
| `src/pages/customer/` | `index.ts` (empty) |
| `src/pages/chairman/` | `index.ts` (empty) |
| `src/pages/admin/` | `index.ts` (empty) |

These seem to be placeholders for future refactoring where workspace-specific dashboard pages would be extracted from `DashboardPage.tsx`.

---

## Section 6: Unreachable Routes

All 76 page components are reachable via routes. No orphaned page components exist.

However, routes with **no navigation path** (no link, button, or shortcut leading to them):

| Route | Defined In | Navigation Paths | Risk |
|---|---|---|---|
| `/warehouse/review` | `routes/index.tsx:106` | Only reachable via typed URL or internal redirection within warehouse flow | **LOW** — likely navigated internally |
| `/warehouse/prep/:id` | `routes/index.tsx:107` | Same | **LOW** |
| `/returns/:id` | `routes/index.tsx:87` | Navigated from `/returns` list | OK |
| `/companies/:id` | `routes/index.tsx:116` | Only from `/companies` list | OK |

All critical business routes have at least one navigation path (bottom nav, dashboard widget, or business shortcut).

---

## Section 7: Documentation Discrepancies

### 7.1 Version Mismatches

| Claim | Document | Actual Value | Severity |
|---|---|---|---|
| Vite 8 | `SYSTEM_BLUEPRINT.md` | `^5.4.19` in `package.json` | **MEDIUM** |
| React 19 | `SYSTEM_BLUEPRINT.md` | `^18.3.1` in `package.json` | **MEDIUM** |
| TypeScript 5.5 | `SYSTEM_BLUEPRINT.md` | `^5.6.2` in `package.json` | **LOW** |

### 7.2 MASTER_FEATURE_AUDIT.md Staleness

The `MASTER_FEATURE_AUDIT.md` (dated 2026-06-03) lists daily deals, flash offers, and auctions V2 as "ungoverned (needs RPC)". These now have governed RPCs as of 2026-06-04 migrations. The audit is 2 days stale and should be regenerated.

---

## Section 8: Security Findings

### 8.1 RLS Not Enforced

As documented in Section 3.2, all public tables except `unified_locations` have RLS disabled. The architecture relies entirely on RPC-level authorization, which is a valid choice but means:
- If a compromised anon key is used with direct `supabase.from().select()` calls (as done in `deals.ts`), data is fully exposed
- The dormant 86 RLS policies provide a false sense of security

### 8.2 DB Owner Equivalent Access

All governed RPCs use `SECURITY DEFINER`, meaning they run as the database owner. Any RPC that fails to validate its inputs properly could allow privilege escalation. Key RPCs handle this correctly via `check_capability()`, but the sheer number (118+) increases the attack surface.

### 8.3 Legacy Auth Duplication

The `login`, `logout`, and `validate_session` functions exist in BOTH:
- `api` schema (plpgsql, SECURITY DEFINER) — from migrations
- `public` schema (sql, SECURITY DEFINER) — older versions

Two different implementations of authentication functions exist on the live DB. The frontend calls `api.login()` via `authService.login()`. The `public` schema versions appear unused but remain accessible.

---

## Section 9: Credit System Integrity

### 9.1 Missing Base Tables (CRITICAL)

The credit system's base tables — `credit_programs`, `credit_applications`, `credit_contracts`, `credit_contract_templates` — exist on live but have **no CREATE TABLE in any migration**. The V2 migration (`20260604_credit_programs_v2.sql`) references them via foreign keys:

- `customer_credit_accounts.credit_program_id → credit_programs(id)` (line 14)
- `credit_invoices.contract_id → credit_contracts(id)` (line 61)
- `credit_invoices.contract_template_id → credit_contract_templates(id)` (line 63)

These tables were created outside the migration system. A fresh deployment would fail with FK constraint errors.

### 9.2 Seed Data Hazard

The V2 migration contains `INSERT INTO credit_programs (...)` statements (lines 127-146) but no preceding `CREATE TABLE`. If the table doesn't exist at migration time, the INSERT will fail. On the live DB, these inserts presumably succeeded because the tables were pre-created (perhaps manually or via a missing earlier migration).

### 9.3 Live-Only Credit RPCs

Several credit-related RPCs exist on live but not in migrations:
- `governed_create_contract_template`
- `governed_update_contract_template`
- `governed_update_credit_program`
- `governed_toggle_credit_program`

These provide CRUD operations for credit programs and contract templates that are unreproducible from migrations.

---

## Section 10: Critical Risk Summary

| # | Risk | Severity | Evidence |
|---|---|---|---|
| 1 | **DB irreproducible** — 17+ tables missing from migrations | **CRITICAL** | Live DB query vs grep of all migration files |
| 2 | **Credit base tables orphaned** — created outside migration system | **CRITICAL** | `credit_programs/applications/contracts/templates` on live, no CREATE TABLE in any `.sql` |
| 3 | **24+ RPCs live-only** — cannot recreate from migrations | **HIGH** | Live `pg_proc` query vs migration grep |
| 4 | **Governance bypass** — `deals.ts` uses direct table access | **HIGH** | `src/services/deals.ts:39-62` — `supabase.from('packages').select('*')` |
| 5 | **RLS dormant on all public tables** — 86 inert policies | **MEDIUM** | `pg_tables.rowsecurity = false` for all public.* except `unified_locations` |
| 6 | **6 unused services** — dead code with maintenance burden | **LOW** | Grep shows zero consumers for `employees`, `customers`, `orders`, `visits`, `collections`, `returns` services |
| 7 | **1 unused store** — `useCollectionsStore` never imported | **LOW** | `src/store/collections.ts` — no consumer found |
| 8 | **Documentation stale** — Vite 8 claimed, `^5.4.19` actual | **MEDIUM** | `SYSTEM_BLUEPRINT.md` vs `package.json` |
| 9 | **Auth functions duplicated** in `public` and `api` schemas | **MEDIUM** | Live `pg_proc` shows both versions |
| 10 | **6 empty stub directories** — placeholder code clutter | **LOW** | `pages/{admin,chairman,customer,manager,supervisor,sales-supervisor}/` |
| 11 | **V1 auction tables persist** with no migration source | **MEDIUM** | `auctions`, `auction_bids`, etc. on live, no CREATE TABLE in recent migrations |
| 12 | **Tier exception tables missing from migrations** | **MEDIUM** | `tier_company_exceptions`, `tier_product_exceptions` on live, not in any `.sql` |

---

## Appendix A: Verification Methodology

| Activity | Tool/Method |
|---|---|
| Live DB schema inspection | Supabase Management API `POST /v1/projects/{ref}/database/query` |
| Migration file analysis | `grep` of all `supabase/migrations/*.sql` for CREATE TABLE, CREATE FUNCTION, CREATE POLICY |
| Source code analysis | Grep, Glob, Read tools across `src/` |
| Service usage analysis | Grep for each service import across all `.ts`/`.tsx` files |
| Route analysis | Manual read of `src/routes/index.tsx` |

## Appendix B: Database Connection

- **Project:** alahram Project (ref: `gbcbejejgpvltuhbztbx`)
- **Region:** eu-west-1
- **PostgreSQL Version:** 17.6.1.127
- **Status:** ACTIVE_HEALTHY
- **Connection:** Via Management API SQL endpoint (direct pg connection failed — DNS resolution `ENOTFOUND`)

## Appendix C: Migration File Inventory

| # | File | Focus |
|---|---|---|
| 1 | `20260602_register_customer.sql` | Registration RPC |
| 2 | `20260602_runtime_screen_completion.sql` | Employee management, visit/customer/order governance |
| 3 | `20260602_p1_operational_completion.sql` | Order approval, collection governance |
| 4 | `20260602_p2_runtime_usability_fixes.sql` | Order defer/cancel/dispatch/reopen |
| 5 | `20260603_tier_system.sql` | Tier tables + governance |
| 6 | `20260603_tier_enforcement.sql` | Tier pricing enforcement in orders |
| 7 | `20260603_daily_deals.sql` | Daily deal tables + governance |
| 8 | `20260603_flash_offers.sql` | Flash offer tables + governance |
| 9 | `20260603_auction_v2.sql` | Auction V2 tables + governance + realtime |
| 10 | `20260604_unified_identity_location.sql` | Identity/location system, auth RPCs, core governance |
| 11 | `20260604_governance_rpcs.sql` | Product/contact/address/history/dashboard RPCs |
| 12 | `20260604_credit_programs_v2.sql` | Credit V2 tables & RPCs |
| 13 | `20260604_tier_runtime_remediation.sql` | Tier enforcement fixes |
| 14 | `20260605_customer_direct_ownership.sql` | Customer ownership, order overrides |
| 15 | `20260606_customer_visibility_fix.sql` | Customer visibility fixes |
| 16-30 | (remaining 15 files) | Various migrations |

---

*Report generated 2026-06-05. All findings are evidence-based and traceable to live DB queries or repository source code.*
