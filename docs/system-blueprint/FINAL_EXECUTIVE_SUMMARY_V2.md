# Executive Summary V2 — Corrected

> **Canonical source:** FINAL_CANONICAL_MASTER_REFERENCE_V2.md  
> **Verification basis:** 52 SQL migrations, 91 pages, 10 services, 231 functions, 63 tables  
> **Date:** 2026-06-09 | **Readiness:** 58/100 | **Corrections from V1:** 25

---

## What Changed from V1

The verification audit found 25 discrepancies. The most critical:

- **7 RPCs** incorrectly classified as Orphaned — all have frontend call sites via service layer
- **Blocker B6** (Credit App Creation) removed — CustomerCreditPage has working creation UI
- **Blocker B4** refined — Payment UI exists in CreditManagementPage (ledger/cheque still missing)
- **Governance bypasses:** 9→20 (11 undocumented bypasses in 6 additional files)
- **RPC total:** 69→231 (V1 counted only governed_* subset)
- **Dead RPCs:** 26→19 (7 reclassified to Used)
- **Dead service methods:** 11→9 (recordPayment, createApplication are used)
- **Workflow 22** (Credit App Creation): Broken→Partial
- **3 RPC names** in V1 were wrong (reserve/pay/register vs actual SQL names)
- **3 RPCs** claimed as orphaned don't exist in SQL migrations at all

## The System in Brief

Wholesale B2B distribution platform: ~25 customers, ~700 products, 38 orders, 16 employees. 18 end-to-end workflows operational; 3 broken; 4 partial; 1 orphaned.

## Source-Verified Statistics

| Metric | V1 Claim | V2 Corrected |
|--------|----------|-------------|
| Tables | 60 | **63** |
| RPCs/functions in DB | 69 | **231** |
| Views | — | **0** |
| Triggers | — | **0** |
| Enums | — | **14** |
| Dead tables | 13 | **13** (verified) |
| Dead RPCs | 26 | **19** (7 reclassified) |
| Test RPCs | 6 | **7** (+ ping) |
| Governance bypasses | 9 in 4 files | **20 in 10 files** |
| Pages | ~60 | **91** (86 functional, 1 empty, 4 static) |
| Services | — | **10** (all call supabase.rpc()) |
| Workflows | 39 | 27 Op / 4 Partial / 3 Broken / 1 Orphaned |
| Dead service methods | 11 | **9** (2 reclassified) |

## Production Blockers (7 — Corrected from 8)

| # | Blocker | Category | Impact |
|---|---------|----------|--------|
| B1 | Inventory never deducted on order approval | Missing Business Logic | `governed_approve_order` never called. Stock never decreases. |
| B2 | Credit invoices never created on approval | Missing Business Logic | Same root cause as B1. |
| B3 | Returns cannot be created through UI | Missing UI | `governed_create_return` exists but no frontend caller. |
| B4 | Credit financial operations limited | Partial UI | Payment UI exists. Ledger, cheque, reservation UIs missing. |
| B5 | No credit reservation during order | Missing Workflow Link | Credit orders can exceed limit unchecked. |
| B6 | Auctions bypass governed RPC | Missing Business Logic | Raw inserts skip all validation + code gen. |
| B7 | 60% customers on legacy addresses | Incomplete Migration | 15/25 customers have NULL location_id. |

**Removed from V1:** B6 (Credit App Creation) — UI exists now.

## Domain Readiness

| Domain | V2 Score | V1 Score | Change |
|--------|----------|----------|--------|
| Warehouse | 95 | 95 | — |
| Employees | 92 | 92 | — |
| Customers | 90 | 90 | — |
| Dashboards | 85 | 85 | — |
| Delivery | 85 | 85 | — |
| Visits | 80 | 80 | — |
| Storefront | 70 | 70 | — |
| Collections | 70 | 70 | — |
| Orders | 65 | 65 | — |
| Returns | 40 | 40 | — |
| Credit | **35** | 25 | +10 (creation + payment UIs discovered) |
| Governance | **75** | 82 | −7 (additional bypasses found) |
| **Overall** | **58/100** | 57/100 | +1 |

## Key Corrections Impact

| Finding | Impact on System |
|---------|-----------------|
| 7 RPCs reclassified Used | These would have been dropped under V1 cleanup plan, breaking daily deals, flash offers, credit applications, locations, and credit suspension |
| 11 undocumented bypasses | Governance improvement plan would have missed 55% of bypass instances |
| 2 "dead" methods actually used | recordPayment and createApplication would have been removed, breaking CreditManagementPage and CustomerCreditPage |
| Credit App Creation UI exists | Removes one production blocker entirely; reduces credit module gap |
| RPC count corrected 69→231 | V1's RPC analysis was based on a 70% incomplete sample |

## Safe Actions Now

| Action | Items |
|--------|-------|
| Drop dead tables | 13 tables — no code references anywhere |
| Drop test RPCs | 7 RPCs — no production usage |
| Drop dead columns | 8 columns — all superseded |
| Fix documentation | 3 RPC name mismatches |

## Actions Requiring Migration

| Action | Items | Precondition |
|--------|-------|-------------|
| Migrate customer_addresses → unified_locations | 25 rows | Verify all customers get location_id |
| Migrate customers.credit_limit → cca.credit_limit | UI column display | Update CustomerProfilePage |

## Actions Blocked

| Asset | Reason |
|-------|--------|
| 7 RPCs marked Orphaned in V1 | Actually Used — KEEP |
| governed_approve_order/deny_order | Needs order approval refactoring |
| governed_create/update_return | Needs return creation UI |
| All orphaned credit service methods | Needs credit module completion |
| ActivityPage | Needs product decision (implement or remove) |
| governed_create_auction, governed_reassign_customer_ownership | Not in SQL migrations — needs live DB verification |
| register_customer | Dual path — keep until unified |

## Final Verdict

**The system reads well; the V1 blueprint was directionally correct but had significant accuracy gaps in RPC classification (7 mislabeled), bypass counting (11 missed), and UI discovery (2 missed pages).** The most dangerous finding: if V1's cleanup plan had been executed as-written, 7 actively-used RPCs would have been dropped.

**58/100 readiness** — up 1 point from V1 due to credit UI discoveries, offset by additional governance bypass findings. The core blocker remains unchanged: `governed_approve_order` is orphaned, making inventory deduction and credit invoice creation impossible.
