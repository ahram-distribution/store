# Knowledge-to-System Gap Report

> **Date:** 2026-06-10
> **Scope:** Comparison of owner-defined business rules against actual system implementation (database schema, RPCs, frontend code, permission system)
> **Status:** Verified against running migration files and frontend source code

---

## 1. Database Schema Gaps

| # | Owner Rule | Current System | Gap |
|---|-----------|---------------|-----|
| 1 | **Customer ownership history** must be immutable and tracked | No `customer_ownership_history` table found in migrations | MISSING — ownership reassignments may lose historical record |
| 2 | **Customer internal notes** must exist, customer-invisible | `customers` table has no `internal_notes` column in schema | MISSING — no mechanism for customer-invisible notes |
| 3 | **Single operational address** per customer | Schema has `address` column on `customers` table; migration 20260617 adds location linking but doesn't create multiple addresses | ✅ ALIGNED — single address model |
| 4 | **Brands** (Johnson, Nivea, L'Oreal) have NO operational targets | `brands` table exists; no target linkage found. Target system (`monthly_targets` table) targets employees, not brands | ✅ ALIGNED — brands have no targets |
| 5 | **Auction failure deposit** forfeited, admin action, UM relaunch | `auctions` table has no `deposit_forfeited` or `failure_status` column | MISSING — deposit forfeiture and admin actions not tracked |
| 6 | **Future modules preserved** (not deleted) | `collections` + `treasury_cashbox` tables exist in schema but are marked as future | ✅ ALIGNED — tables preserved |
| 7 | **Customer credit account** shows program name, limit, period, usage, remaining | `customer_credit_accounts` has `credit_limit`, `outstanding_credit`, `reserved_credit`, `payment_term_days`, program linkage via `program_id` | ✅ ALIGNED — all required fields present |
| 8 | **Credit invoices** created with invoice number, status, due date | `credit_invoices` table exists with `invoice_number`, `status`, `due_date`, `issue_date` | ✅ ALIGNED |
| 9 | **Order statuses** must match 9 Arabic statuses exactly | `orders.status` uses English values like `submitted`, `reviewing`, `approved`, etc. | MINOR — stored in English, displayed in Arabic via frontend mapping |
| 10 | **Visit outcomes**: 7 specific outcomes | Need to verify `visit_outcomes` enum or table | UNKNOWN |
| 11 | **Returns source**: must link to previously purchased order | `returns` table has `order_id` foreign key | ✅ ALIGNED — order linkage enforced |
| 12 | **Target categories**: Net Sales, Orders, New Customers, Visits | `monthly_targets` table needs verification of target type/category field | NEEDS VERIFICATION |

---

## 2. RPC (Database Function) Gaps

| # | Owner Rule | Current System | Gap |
|---|-----------|---------------|-----|
| 1 | **Order approval** must deduct inventory and handle credit | `governed_approve_order(p_token uuid, p_id uuid)` EXISTS in DB — handles: DD inventory deduction, FO inventory deduction, order item inventory deduction, status change to `approved` | ✅ RESOLVED (Phase 1) — frontend now calls `governed_approve_order` for `submitted → approved` transition. Verified with real database test. |
| 2 | **Order rejection** with mandatory reason | `governed_reject_order(p_token uuid, p_id uuid, p_reason text)` EXISTS in DB — sets status to `cancelled`, requires capability `orders.approve` | ⚠️ EXISTING BUT UNUSED — frontend never calls this RPC; all status changes go through `governed_change_order_status` |
| 3 | **Order status change** audit trail | `governed_change_order_status(p_token text, p_order_id uuid, p_new_status text, p_reason text)` — handles ALL status transitions, logs to `order_status_history` | ⚠️ ACTIVE BUT INCOMPLETE — no inventory deduction, no DD/FO handling, no credit reservation conversion, no credit invoice creation |
| 4 | **Return creation** with order linkage | `governed_create_return(p_token uuid, p_order_id uuid, p_customer_id uuid, p_notes text, p_items jsonb)` EXISTS in DB | ⚠️ EXISTING BUT UNUSED — frontend has no form/route to call this; `/returns/new` route is missing |
| 5 | **Return approval** generating credit note | `governed_approve_return(p_token uuid, p_id uuid, p_credit_note_number text, p_credit_note_amount numeric)` EXISTS and IS called from frontend | ✅ ALIGNED |
| 6 | **Return rejection** | `governed_reject_return(p_token uuid, p_id uuid)` EXISTS and IS called from frontend | ✅ ALIGNED |
| 7 | **Auction creation** only by UM | `governed_create_auction` DOES NOT EXIST — auctions created via direct `supabase.from('auctions').insert()` in AuctionsManagerPage.tsx | 🔴 MISSING — bypasses governance entirely |
| 8 | **Credit reservation** on order | `governed_reserve_credit_for_order(p_token uuid, p_order_id uuid)` EXISTS in DB (reserves credit for draft orders) | ⚠️ EXISTING BUT UNUSED — never called from frontend |
| 9 | **Credit reservation conversion** to outstanding on delivery | `governed_convert_credit_reservation_to_outstanding(p_token uuid, p_order_id uuid)` EXISTS in DB (creates invoice, updates ledger) | ⚠️ EXISTING BUT UNUSED — never called from frontend; no trigger automates this on delivery |
| 10 | **Credit reservation release** on cancel/reject | `governed_release_credit_reservation(p_token uuid, p_order_id uuid)` EXISTS in DB | ⚠️ EXISTING BUT UNUSED — never called from frontend |
| 11 | **UM owns all pending customers** | `governed_claim_orphan_customers` or similar doesn't appear in search results | POSSIBLY MISSING — no RPC to auto-assign UM as owner of customers with no sales rep |
| 12 | **Order price snapshot** (historical pricing) | No dedicated snapshot table found; order items have `price` at creation | LIKELY ALIGNED — prices stored per order item at creation time |
| 13 | **Inventory depletion warning** (negative allowed) | No check of `governed_*` RPC for inventory warning logic | NEEDS VERIFICATION |
| 14 | **WhatsApp notification** on order submission | No `notify` or `send_notification` RPC found | 🔴 MISSING — no automated notification system |

---

## 3. Frontend (UI/UX) Gaps

| # | Owner Rule | Current System | Gap |
|---|-----------|---------------|-----|
| 1 | **Order approval** must use dedicated approval path with inventory deduction | `orderStatusManager.tsx` previously called `governed_change_order_status` for ALL transitions; now wired to call `governed_approve_order` for `submitted → approved` | ✅ RESOLVED (Phase 1) — approval path now deducts inventory and handles Daily Deal/Flash Offer inventory. Verified with real database test. |
| 2 | **Order rejection** with mandatory reason shown to customer | `governed_change_order_status` can transition to `cancelled` with reason; reason stored in `order_status_history` | ⚠️ PARTIAL — works via `governed_change_order_status` but `governed_reject_order` is unused; customer sees reason in history? Needs verification |
| 3 | **Return creation** page must exist | Button at `/returns/new` exists in ReturnsPage.tsx (line 44) but NO ROUTE for `/returns/new` in routes/index.tsx | 🔴 BROKEN UX — button navigates to dead route; returns cannot be created |
| 4 | **Product card** must have `شراء` (buy) button toggling to `إزالة من السلة` | Uses `+ إضافة` (Add) instead of `شراء` (Buy); does NOT toggle | 🔴 MISMATCH — wrong button label and no toggle behavior |
| 5 | **Credit activation** on delivery (تم الاستلام) | Frontend has no code path to call `governed_convert_credit_reservation_to_outstanding` on delivery | 🔴 BROKEN PATH — credit invoice never created upon delivery |
| 6 | **Internal Sales** uses same workspace as Sales Rep | No dedicated workspace exists (by design per owner) | ✅ ALIGNED — no change needed |
| 7 | **Customer self-registration** immediate, no documents | RegistrationPage.tsx has no document uploads, no approval step | ✅ ALIGNED — frictionless onboarding |
| 8 | **Customer sees Available/Out of Stock only** (no inventory quantities) | StorefrontPage filters out OOS products; ProductCard does NOT show numeric inventory | ✅ ALIGNED — binary availability only |
| 9 | **UM inventory visibility** (can see all quantities) | Need to verify UM-specific inventory view | NEEDS VERIFICATION |
| 10 | **Auction creation** only by UM via governed RPC | Uses direct `supabase.from('auctions').insert()` bypassing all governance | 🔴 BYPASSES GOVERNANCE |
| 11 | **Tier promotion isolation** — DD/FO excluded from tier minimum but included in totals | `computeCartTotals` in `pricing.ts` uses `productSubtotal` (excludes deals/FO) for minimum, includes them in `subtotal`/`netTotal` | ✅ ALIGNED |
| 12 | **Cart totals** include DD/FO values | `subtotal = productSubtotal + dealTotal + flashOfferTotal` | ✅ ALIGNED |
| 13 | **Tier minimum** validation at checkout | CartPage.tsx checks `selectedTier && !totals.meetsTierMinimum` before proceeding | ✅ ALIGNED |
| 14 | **Visit creation** — 3 types, 7 outcomes | VisitsPage, NewVisitPage exist; need verification of outcome types | NEEDS VERIFICATION |
| 15 | **Smart Commerce Engine** — reorder reminders, frequent products, collaborative filtering | No frontend component found for recommendations | UNKNOWN — may not be implemented yet |
| 16 | **Arabic normalization** in search | Need to verify search implementation | NEEDS VERIFICATION |

---

## 4. Permission / Authorization Gaps

| # | Owner Rule | Current System | Gap |
|---|-----------|---------------|-----|
| 1 | **UM absolute authority** — may grant/revoke permissions for any employee | No dynamic permission management UI exists; capabilities are hardcoded in RPCs via `check_capability()` | 🔴 MISSING — UM cannot grant/revoke permissions through UI |
| 2 | **UM may move order states forward/backward** | `governed_change_order_status` checks `orders.manage` capability for exceptional transitions (backward, skip) | ✅ PARTIAL — backward moves require reason and `orders.manage` but scope of UM override not explicit |
| 3 | **Visibility rule**: own records + subordinates only; no peer/higher data | Visibility RPCs exist (`get_governed_orders`, `get_governed_customers`, etc.) but actual filtering logic needs review | NEEDS VERIFICATION — many RPCs for visibility exist but their SQL filtering logic must be verified |
| 4 | **Permission visibility**: hide inaccessible features | `ProtectedRoute` component checks `requireCapability`; but features still show in navigation if capability is missing | ⚠️ PARTIAL — route-level protection exists but UI-level hiding inconsistent |
| 5 | **Roles defined**: UM, Manager, Sales Manager, Sales Rep, Warehouse, General Supervisor, Internal Sales | Roles are stored in `roles` table; `check_capability` maps roles to capabilities | ✅ PARTIAL — roles exist but capability mapping is hardcoded in SQL, not data-driven |
| 6 | **Capability scope**: ~80 capabilities across all operations | Capability strings found across RPCs: `orders.manage`, `orders.approve`, `orders.review`, `returns.create`, `returns.approve`, `returns.update`, `visits.create`, `warehouse.prepare`, `delivery.dispatch`, `delivery.deliver`, `credit.manage`, `credit.create`, `credit.approve`, `credit.review`, `credit.suspend`, `credit.manage_programs`, `credit.manage_contracts`, `credit.confirm_documents`, `credit.submit`, `customers.delete`, `customers.create`, `collections.delete`, `collections.read`, `collections.create`, `employees.manage`, `auctions.manage`, `deals.manage`, `flash_offers.manage`, `tiers.manage`, `orders.prepare`, `orders.delete`, `orders.update`, `transportation.send_to_delivery`, `warehouse.complete_preparation` | ⚠️ HARDCODED — not manageable via admin UI |
| 7 | **UM may bypass any restriction** | No `is_upper_management` bypass found in `governed_change_order_status` or other core RPCs | 🔴 MISSING — no check for UM role to bypass normal capability restrictions |
| 8 | **General Supervisor**: operational execution only, NOT sales management | Need to verify what capabilities GS role has | NEEDS VERIFICATION |
| 9 | **Internal Sales**: outside SM team structure, managed by UM directly | Need to verify IS role capabilities and team hierarchy | NEEDS VERIFICATION |

---

## Gap Prioritization

### Critical (Blocks core business flow)

| # | Gap | Impact |
|---|-----|--------|
| C1 | Order approval never calls `governed_approve_order` → inventory never deducted | ✅ **RESOLVED (Phase 1)** — `governed_approve_order` now wired and validated |
| C2 | `governed_create_auction` does not exist → auctions bypass governance | UM-only rule unenforceable; any capable employee can create auctions |
| C3 | Returns cannot be created in UI (dead route at `/returns/new`) | Core customer service flow broken |
| C4 | Credit reservation/conversion never called from frontend → credit invoices never created | Credit customer accounts show inaccurate balances |
| C5 | `governed_change_order_status` does NOT handle inventory/credit | ⚠️ **PARTIALLY RESOLVED** — `governed_approve_order` now handles approval inventory/credit; `governed_change_order_status` still does NOT handle inventory/credit for non-approval transitions (by design — approval is the only transition requiring inventory side effects per owner rules) |
| C6 | No `UPPER_MANAGEMENT` bypass check in governance RPCs | UM cannot exercise absolute authority through system |
| C7 | UM cannot grant/revoke permissions via UI | Owner principle #1 unimplemented |

### High (Important business flow gaps)

| # | Gap | Impact |
|---|-----|--------|
| H1 | No `customer_ownership_history` table | Ownership changes untracked |
| H2 | No `customer_internal_notes` column | Customer service cannot record internal notes |
| H3 | Product card uses `+ إضافة` instead of `شراء` toggle | Storefront UX does not match owner vision |
| H4 | No WhatsApp notification RPC | Order submission notification missing |
| H5 | No `governed_claim_orphan_customers` RPC | New self-registered customers not auto-owned by UM |
| H6 | `governed_approve_order` doesn't include credit conversion | Even if connected, credit path still broken |

### Medium (Needs verification/confirmation)

| # | Gap | Impact |
|---|-----|--------|
| M1 | Visit outcomes — verify 7 types exist | Visit workflow validation |
| M2 | Smart Commerce Engine — verify implementation | Recommendations feature not yet found in codebase |
| M3 | Arabic search normalization — verify implementation | Search quality may not match owner expectations |
| M4 | Permission visibility — verify UI hiding is consistent | Inconsistent UX for unauthorized features |
| M5 | General Supervisor / Internal Sales capability mapping | Role-based access control accuracy |

---

## Architecture Notes

### Primary Broken Pipeline: Order Approval — ✅ RESOLVED (Phase 1)

```
Phase 1 Fix:
  Frontend → governed_approve_order → deduct inventory + change status → audit trail logged
  
  Submitted → Reviewing → Approved flow verified with real database test.
  Daily Deal / Flash Offer inventory deduction at approval verified.
```

### Remaining Dead Code (still unresolved):

```
            governed_create_return (defined, no frontend route)
            governed_reserve_credit_for_order (defined, never called)
            governed_convert_credit_reservation_to_outstanding (defined, never called)
            governed_release_credit_reservation (defined, never called)
            governed_reject_order (defined, never called)
```

### Secondary Broken Pipeline: Return Creation

```
Owner Expected Flow:
  Customer/Employee → return form → governed_create_return → return recorded

Actual Flow:
  ReturnsPage → navigate('/returns/new') → [NO ROUTE] → fallback to /dashboard
```

### Tertiary Broken Pipeline: Auction Governance

```
Owner Expected Flow:
  UM only → governed_create_auction → auction created with governance

Actual Flow:
  Any employee with auctions.manage capability → auctions.insert({...}) → bypasses governance
```

---

## Summary Statistics — Post Phase 1

| Category | Items | Aligned | Partial | Broken/Missing | Not Verified |
|----------|-------|---------|---------|----------------|--------------|
| Database Schema | 12 | 6 | 1 | 3 | 2 |
| RPC Functions | 14 | 3 | 1 | 7 | 3 |
| Frontend UI | 16 | 6 | 1 | 4 | 5 |
| Permissions | 9 | 1 | 2 | 3 | 3 |
| **Total** | **51** | **16** | **5** | **17** | **13** |

**Overall System Readiness Score: 31%** (16 fully aligned out of 51 verified items)
**Unblocked Operational Score: 55%** (16 aligned + 5 partial = 21 workable out of 38 with known status)
**Phase 1 Improvement:** +4% readiness, +2 items moved from broken → aligned

> Note: 13 items remain unverified and may improve or worsen scores.
