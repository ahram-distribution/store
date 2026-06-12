# Executive Summary — Ahram Distribution System Blueprint

> **Synthesized from 14 blueprint files and source-code-verified across 27 pages, 11 services, 69 RPCs, 60 tables.**  
> **Date:** 2026-06-09 | **Readiness: 57/100** | **Canonical reference:** `FINAL_CANONICAL_MASTER_REFERENCE.md`

---

## The System in Brief

Wholesale B2B distribution platform for the Egyptian market: ~25 customers, ~700 products, 38 orders, 16 employees. Covers the full commercial cycle — registration → ordering → warehouse → delivery → collection → returns → credit → auctions. 18 workflows run end-to-end; 4 are broken; 1 is orphaned.

## 8 Production Blockers (Prevent 100% Readiness)

| # | Blocker | Domain | Impact |
|---|---------|--------|--------|
| B1 | Inventory never deducted on approval | Orders | `governed_approve_order` (has deduction logic) is **never called**. All approvals go through generic `governed_change_order_status`. Stock never decreases. |
| B2 | Credit invoices never created on approval | Financial | Same root cause — credit invoice creation logic lives only in `governed_approve_order`. |
| B3 | No return creation UI | Returns | `governed_create_return` exists in DB but no page calls it. Staff cannot log returns. |
| B4 | No credit payment/cheque/ledger UI | Credit | 8 RPCs exist for payments, cheques, ledger — zero frontend callers. 3 accounts unservicable. |
| B5 | No credit reservation during ordering | Credit | Credit orders can exceed limits unchecked. `governed_reserve_credit` uncalled. |
| B6 | No credit application creation UI | Credit | `governed_create_credit_application` exists but no page invokes it. |
| B7 | Auctions bypass governed RPC | Governance | `AuctionsManagerPage` uses raw `supabase.from('auctions').insert()` — no validation, no code gen. |
| B8 | 60% customers on legacy addresses | Data Integrity | 15/25 customers have NULL `location_id`; migration from `customer_addresses` to `unified_locations` incomplete. |

## Domain Readiness

| Domain | Score | Verdict |
|--------|-------|---------|
| Warehouse | 95/100 | Strongest domain |
| Employees | 92/100 | Full lifecycle |
| Customers | 90/100 | Full CRUD + ownership |
| Dashboards | 85/100 | All workspaces render |
| Delivery | 85/100 | Assign/confirm/fail work |
| Visits | 80/100 | Check-in/out operational |
| Collections | 70/100 | Create + approve only |
| Storefront | 70/100 | Cart works, CheckoutPage empty |
| Orders | 65/100 | Create/submit/read OK. **Approval never executes business logic.** |
| Returns | 40/100 | Read/approve/reject. **No create path.** |
| Credit | 25/100 | Programs CRUD only. **No payments, ledger, reservation, or creation.** |

## What Works vs What's Broken

- **18 fully operational workflows:** customer/employee lifecycle, order create/submit, visit check-in/out, warehouse prep/review/dispatch, delivery assign/confirm, collection create/approve, return approve/reject, credit approve/reject, product/company/tier CRUD, dashboards, global search.
- **4 broken workflows:** order approval (no inventory/credit), order rejection (deny RPC orphaned), return creation (no UI), credit application creation (no UI).
- **1 orphaned subsystem:** credit account financial ops — 8 RPCs + 11 service methods exist with zero frontend callers.

## Asset Classification Summary

| Category | Count | Key Items |
|----------|-------|-----------|
| Dead Tables | 13 | `customer_classification`, `deal`, `notification`, `follow_up`, `permission`, `packages` (legacy), etc. |
| Dead RPCs | 26 | 6 test artifacts + 20 orphaned `governed_*` (approve/deny_order, create_return, create_auction, 13 credit RPCs) |
| Dead Screens | 2 | CheckoutPage, ActivityPage (empty shells) |
| Dead Columns | 10 | `customers.email`, 3 snapshot_sender_*, 4 execution_gps_*, 2 customer credit legacy fields |
| Dead Service Methods | 11 | All `creditService` methods except basic reads |
| Legacy (keep) | 8 | `customer_addresses`, `packages` tables, 3 snapshot_sender columns, `products.legacy_code` |
| Duplicate Sources | 5 | Address (`unified_locations` vs `customer_addresses`), Credit Limit/Account, Balance cache, GPS dual storage |
| Bypasses | 9 | `supabase.from()` in 4 pages bypassing governed RPCs (Auctions highest risk) |
| Architectural Conflicts | 15 | 8 dual SOT, 5 dual execution paths, 9 governance bypasses, 4 schema issues |

## Architectural Conflicts (Top 3)

1. **Order Approval Dual Path (CRITICAL):** `governed_change_order_status` handles ALL status transitions generically. `governed_approve_order` (with inventory + credit logic) is fully built but never wired.
2. **Dual Customer Creation:** `register_customer` (RegistrationPage) creates identity+session; `governed_create_customer` (NewCustomerPage) does not. Two different behaviors per entry point.
3. **Auction Bypass:** `AuctionsManagerPage` uses raw Supabase inserts instead of `governed_create_auction`.

## Cleanup Roadmap (Execution Classes)

| Classification | Count | Action |
|---------------|-------|--------|
| SAFE NOW | 27 assets | 13 tables, 9 RPCs, 8 columns — drop immediately, no precondition |
| NEEDS MIGRATION | 4 | `customer_addresses` → `unified_locations`; 2 legacy credit columns → credit_account; CheckoutPage/ActivityPage decision |
| NEEDS DECISION | 8 | `ping` RPC; `governed_create_daily_deal`, `governed_create_flash_offer/update_flash_offer`, `governed_create_auction` wiring; flashOfferService/dealService audit; 2 empty pages |
| BLOCKED | 20 | 13 credit RPCs (keep until credit module completes); `governed_approve/deny_order` (needs approval refactor); `governed_create/update_return` (needs return UI); `register_customer` (dual path); 3 empty tables |

## Final Verdict

**The system reads well and displays data reliably.** 57% reflects not code quality but **missing business logic on critical write paths**. A single SQL wiring fix — calling `governed_approve_order` instead of `governed_change_order_status` for approvals — recovers ~15 points. The credit subsystem is the largest gap: 40% built, 60% missing. After fixing the 8 blockers and completing the credit module, the system can reach 85%+ without architectural changes.
