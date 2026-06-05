# KNOWN ISSUES — Ahram Distribution Management System

**Last updated:** 2026-06-05  
**Source:** Phase 2 Verification Report, Phase 3 Recovery Report, Runtime Audits

---

## Critical

### 1. Legacy Deals Bypasses Governance
**File:** `src/services/deals.ts:39-62`  
**Issue:** The `dealService` reads from `packages` table via `supabase.from('packages').select('*')` — direct table access with no capability check or session validation. This bypasses the entire RPC governance layer.  
**Risk:** If the anon key is compromised, package data is exposed.  
**Status:** Unresolved. The new `dailyDealService` and `flashOfferService` use governed RPCs correctly.

## High

### 2. RLS is Dormant on All Public Tables
**Issue:** 86 RLS policies exist but are inert — `rowsecurity = false` on all `public.*` tables except `unified_locations`. The architecture relies entirely on RPC-level authorization, meaning direct table access (even accidental) bypasses all security.  
**Risk:** If a developer introduces a direct `supabase.from()` call (like `deals.ts`), data is fully exposed.  
**Status:** By design (RPC-only governance), but dormant policies create false sense of security.

### 3. Auth Functions Duplicated
**Issue:** `login`, `logout`, `validate_session` exist in both `api` schema (plpgsql, from migrations) and `public` schema (sql, older). Two implementations of authentication logic coexist.  
**Risk:** Ambiguity about which version is authoritative.  
**Status:** Frontend calls `api.login()` via `authService`. Public schema versions appear unused.

### 4. Hardcoded Employee Codes in Production RPC
**File:** `get_collection_followup_queue` function on live DB  
**Issue:** The function contains hardcoded employee codes (`WRQ1002`, `WRQ1004`) for visibility scoping logic.  
**Risk:** If these employees leave or change roles, the function breaks.  
**Status:** Preserved as-is during Phase 3 recovery.

## Medium

### 5. Documentation Version Mismatches
| Claim | Document | Actual |
|---|---|---|
| Vite 8 | SYSTEM_BLUEPRINT.md | `^5.4.19` in package.json |
| React 19 | SYSTEM_BLUEPRINT.md | `^18.3.1` in package.json |

### 6. MASTER_FEATURE_AUDIT.md is Stale
**Dated:** 2026-06-03  
**Issue:** Lists daily deals, flash offers, and auctions V2 as "ungoverned (needs RPC)". These now have governed RPCs as of 2026-06-04 migrations.  
**Status:** Archived to `/docs/archive/`.

### 7. DB Owner Equivalent Access
**Issue:** All 118+ governed RPCs use `SECURITY DEFINER`, running as database owner. Any RPC with insufficient input validation could allow privilege escalation.  
**Risk:** Large attack surface.

## Low

### 8. Unused Code
| Item | Location | Size |
|---|---|---|
| 6 unreferenced services | `src/services/` (employees, customers, orders, visits, collections, returns) | Dead code |
| 1 unused store | `src/store/collections.ts` (useCollectionsStore) | Dead code |
| 6 empty stub directories | `src/pages/{admin,chairman,customer,manager,supervisor,sales-supervisor}/` | Placeholder clutter |

## Resolved

### 9. Database Irreproducible (CRITICAL — RESOLVED)
**Status:** Resolved by Phase 3 Recovery (2026-06-05). 9 tables and 92 functions were missing from migrations. Recovery files `20260603_recovery_missing_tables.sql` and `20260607_recovery_missing_functions.sql` now make the database fully reproducible.
