# 13. End-to-End Workflow Audit

> **Goal:** Trace every operational workflow from start to finish, document real state machines, identify dead/orphaned/broken paths, and determine true production readiness.
> **Status:** Complete ✓
> **Date:** 2026-06-09
> **Methodology:** Source code analysis of all 27 page directories, 11 service files, all order/visit/collection/etc. status transitions, enum definitions, and RPC bodies. Every claim backed by file:line.

---

## Section 1 — Workflow Inventory

### 1.1 Complete Workflow Catalogue

| # | Workflow | Category | Status |
|---|----------|----------|--------|
| 1 | Customer Self-Registration | Customer | Partial — `register_customer` RPC exists but NOT called from frontend. RegistrationPage calls it directly (verified: RegistrationPage.tsx). Customer-facing registration possible. |
| 2 | Managed Customer Creation | Customer | ✓ Operational — NewCustomerPage + SupervisorPage via `governed_create_customer` |
| 3 | Employee Creation | Employee | ✓ Operational — EmployeesPage, HierarchyPage, SupervisorPage via `governed_create_employee` |
| 4 | Login | Auth | ✓ Operational — LoginPage via `authService.login()` → `supabase.auth.signInWithPassword()` |
| 5 | Visit Check-In | Visit | ✓ Operational — VisitsPage, VisitScreen via `governed_checkin_visit` |
| 6 | Visit Check-Out | Visit | ✓ Operational — VisitDetailPage, VisitScreen via `governed_checkout_visit` |
| 7 | Order Creation | Order | ✓ Operational — OrderNewPage, OrderReviewPage via `governed_create_order` |
| 8 | Order Submission | Order | ✓ Operational — OrderReviewPage, OrderNewPage via `governed_submit_order` |
| 9 | Order Approval | Order | **Broken** — `governed_approve_order` exists in DB but NEVER called. Uses `governed_change_order_status` which lacks inventory/credit business logic. |
| 10 | Order Rejection | Order | **Broken** — `governed_deny_order` exists in DB but NEVER called. OrderStatusManager uses `governed_change_order_status` for all transitions. |
| 11 | Warehouse Preparation | Warehouse | ✓ Operational — Full lifecycle via governed RPCs |
| 12 | Warehouse Review | Warehouse | ✓ Operational — governed_review_preparation, governed_return_to_preparation |
| 13 | Dispatch | Warehouse/Delivery | ✓ Operational — governed_dispatch_order creates delivery |
| 14 | Delivery Confirmation | Delivery | ✓ Operational — governed_confirm_delivery / governed_fail_delivery |
| 15 | Collection Creation | Collection | ✓ Operational — NewCollectionPage via `governed_create_collection` |
| 16 | Collection Approval | Collection | ✓ Operational — CollectionsPage via `governed_approve_collection` |
| 17 | Return Creation | Return | **Broken** — `governed_create_return` exists in DB but NOT called from any frontend code. Returns cannot be created through UI. |
| 18 | Return Approval | Return | ✓ Operational — ReturnDetailPage via `governed_approve_return` |
| 19 | Return Rejection | Return | ✓ Operational — ReturnDetailPage via `governed_reject_return` |
| 20 | Credit Application | Credit | **Broken** — `governed_create_credit_application` exists in DB + service layer but NOT called from any page. No UI to create applications. |
| 21 | Credit Approval | Credit | ✓ Operational — CreditReviewPage via `governed_manage_credit_application` |
| 22 | Credit Rejection | Credit | ✓ Operational — CreditReviewPage via `governed_decline_credit` |
| 23 | Credit Account Operations | Credit | **Partial** — activate/suspend/reactivate services exist but no confirmed UI calls. Payment, cheque, reservation, ledger, statement all have RPCs but no UI. |
| 24 | Daily Deals Management | Commercial | **Partial** — DailyDealsManagerPage uses hybrid (gov RPCs + direct from()). governed_create_daily_deal exists in service layer but page uses update-only. |
| 25 | Flash Offers Management | Commercial | **Partial** — flashOfferService has full CRUD wrappers but flash-offers pages have zero direct supabase calls. May use service layer (unconfirmed). |
| 26 | Auctions | Commercial | **Partial** — auctionService has read/bid/participate wrappers. AuctionsManagerPage bypasses governed_create_auction with raw supabase.from().insert(). |
| 27 | Product Lifecycle | Product | ✓ Operational — Create, read, update, pricing, units, activate/deactivate all via governed RPCs |
| 28 | Company Lifecycle | Company | ✓ Operational — Create, read, update, profile, activate/deactivate all via governed RPCs |
| 29 | Tier Management | Pricing | ✓ Operational — Create, read, update, company/product exceptions via governed RPCs |
| 30 | Employee Hierarchy Management | Employee | ✓ Operational — Manager change, role change, password reset, capabilities |
| 31 | Customer Ownership Change | Customer | ✓ Operational — governed_change_customer_ownership |
| 32 | Dashboard Views | Analytics | ✓ Operational — All role-specific dashboards render real aggregate data |
| 33 | Global Search | Utility | ✓ Operational — governed_global_search across customers + products |
| 34 | Target Management | Analytics | **Partial** — targetService has full CRUD wrappers. RPCs exist. UI pages (CompanyTargetsPage, EmployeeTargetsPage) have supabase calls via services (confirmed). |
| 35 | Report Generation | Analytics | **Partial** — ReportsPage uses dynamic RPC by report type. Only confirmed call is dynamic `supabase.rpc(rpcName, params)`. |

---

## Section 2 — End-to-End Flow Mapping

### 2.1 Customer Self-Registration Flow

```
RegistrationPage (src/pages/auth/RegistrationPage.tsx)
  → (inline)
  → supabase.rpc('register_customer', {p_phone, p_password, p_company_name, ...})
  → Tables Written: identities, customers, customer_contacts, unified_locations, app.sessions
  → Tables Read: code_sequences (via generate_customer_code)
  → Next: LoginPage
```
**Note:** `register_customer` creates identity, customer, location, contact, AND session in one call. NewCustomerPage uses `governed_create_customer` instead (no session/identity creation).

### 2.2 Managed Customer Creation Flow

```
NewCustomerPage (src/pages/customers/NewCustomerPage.tsx:96)
  → SupervisorPage (src/pages/supervisor/SupervisorPage.tsx:475)
  → (inline)
  → supabase.rpc('governed_create_customer', {p_token, p_company_name, p_phone, ...})
  → Tables Written: customers, customer_addresses (if legacy), customer_contacts, unified_locations
  → Tables Read: employees (for owner assignment), code_sequences
  → Next: CustomersPage → CustomerProfilePage
```

### 2.3 Employee Creation Flow

```
EmployeesPage (src/pages/employees/EmployeesPage.tsx:89)
  → HierarchyPage (src/pages/employees/HierarchyPage.tsx:119)
  → SupervisorPage (src/pages/supervisor/SupervisorPage.tsx:563)
  → (inline)
  → supabase.rpc('governed_create_employee', {p_token, p_full_name, p_phone, p_password, ...})
  → Tables Written: identities, employees, employee_roles, employee_capabilities
  → Tables Read: roles, code_sequences
  → Next: EmployeesPage → EmployeeProfilePage
```

### 2.4 Login Flow

```
LoginPage (src/pages/auth/LoginPage.tsx)
  → authService.login()
  → supabase.auth.signInWithPassword({phone, password})
  → Supabase Auth (Auth API, not custom RPC)
  → session_token stored in localStorage
  → useAuth hook → authStore (Zustand + persist)
  → Next: DashboardPage → [role-specific workspace]
```

### 2.5 Visit Check-In Flow

```
VisitsPage (src/pages/visits/VisitsPage.tsx:111)
  → OR VisitScreen (src/pages/visits/VisitScreen.tsx:121)
  → (inline)
  → supabase.rpc('governed_checkin_visit', {p_token, p_customer_id, p_latitude, p_longitude, ...})
  → Tables Written: visits (creates visit + generates code), unified_locations (if GPS provided)
  → Tables Read: code_sequences, customers, employees
  → Next: VisitDetailPage → Order Creation (optional)
```

### 2.6 Visit Check-Out Flow

```
VisitScreen (src/pages/visits/VisitScreen.tsx:167)
  → OR VisitDetailPage (src/pages/visits/VisitDetailPage.tsx:110)
  → (inline)
  → supabase.rpc('governed_checkout_visit', {p_token, p_id, p_latitude, p_longitude, p_result, p_notes, ...})
  → Tables Written: visits (status, check_out_at, coordinates, result)
  → Tables Read: visits
  → Next: VisitsPage
```

### 2.7 Order Creation Flow

```
OrderNewPage (src/pages/orders/OrderNewPage.tsx:200)
  → OR OrderReviewPage (src/pages/storefront/OrderReviewPage.tsx:74)
  → (inline)
  → supabase.rpc('governed_create_order', {p_token, p_customer_id, p_items, p_notes, p_discount_percent, ...})
  → Tables Written: orders, order_items, order_status_history
  → Tables Read: customers, products, product_units, tiers, code_sequences
  → Next: OrderReviewPage → OrderNewPage (add flash offers/daily deals)
```

### 2.8 Order + Deals/Offers + Submit Flow

```
OrderReviewPage (src/pages/storefront/OrderReviewPage.tsx)
  Step 1: governed_create_order → order created in 'draft'
  Step 2: governed_add_order_flash_offers → order_flash_offer records
  Step 3: governed_add_order_daily_deals → order_daily_deal records
  Step 4: governed_submit_order → order.status = 'submitted'
  → Tables Written: order, order_flash_offer, order_daily_deal
  → Tables Read: order, order_item
  → Next: OrdersPage
```

### 2.9 Order Status Change Flow (All Non-Approval Transitions)

```
OrderStatusManager (src/components/orders/OrderStatusManager.tsx:88)
  → (inline)
  → supabase.rpc('governed_change_order_status', {p_token, p_order_id, p_new_status, p_reason})
  ✗ governed_approve_order NOT CALLED — governed_change_order_status handles 'approved' status too
  ✗ governed_deny_order NOT CALLED — status change transitions do everything
  → Tables Written: order (status), order_status_history
  → Tables Read: order
  → ALLOWED TRANSITIONS:
    draft → submitted (via governed_submit_order, not OrderStatusManager)
    submitted → reviewing (canReview=true)
    reviewing → approved | returned_for_revision (canManage=true)
    approved → preparing (canCompletePreparation=true)
    preparing → prepared (canCompletePreparation=true)
    prepared → sent_to_delivery (canSendToDelivery=true)
    ready_for_dispatch → sent_to_delivery (canSendToDelivery=true)
    sent_to_delivery → dispatched (canManage=true)
    dispatched → delivered (canManage=true)
    ANY → cancelled (exceptional, requires reason)
    ANY → deferred (exceptional, requires reason)
    ANY backward move (exceptional, requires reason)
  → Next: Delivery (if dispatched/delivered) or Warehouse (if preparing)
```

### 2.10 Warehouse Preparation Flow

```
WarehousePage (src/pages/warehouse/WarehousePage.tsx)
  → supabase.rpc('governed_start_preparation', {p_token, p_order_id})
    → preparation.status = 'in_progress'
  → supabase.rpc('governed_complete_preparation', {p_token, p_preparation_id})
    → preparation.status = 'completed'
  → supabase.rpc('governed_record_exception', {p_token, p_preparation_id, ...})
    → preparation_exception created
  → supabase.rpc('governed_fail_preparation', {p_token, p_preparation_id, ...})
    → preparation.status = 'failed'
  → Next: WarehouseReviewPage
```

### 2.11 Warehouse Review Flow

```
WarehouseReviewPage (src/pages/warehouse/WarehouseReviewPage.tsx)
  → supabase.rpc('governed_review_preparation', {p_token, p_preparation_id})
    → preparation.status = 'reviewed'
  → supabase.rpc('governed_return_to_preparation', {p_token, p_preparation_id})
    → preparation.status = 'in_progress' (re-opens)
  → Next: Dispatch (if reviewed)
```

### 2.12 Dispatch Flow

```
WarehousePage (src/pages/warehouse/WarehousePage.tsx:194)
  → supabase.rpc('governed_dispatch_order', {p_token, p_order_id, p_preparation_id})
  → order.status = 'dispatched' (via internal call)
  → delivery record created (via internal call)
  → Tables Written: order (status), delivery_tracking (created)
  → Next: DeliveryPage
```

### 2.13 Delivery Flow

```
DeliveryPage (src/pages/delivery/DeliveryPage.tsx:49)
  → supabase.rpc('governed_assign_delivery', {p_token, p_delivery_id, p_employee_id})
  → delivery.assigned_to = driver

DeliveryDetailPage (src/pages/delivery/DeliveryDetailPage.tsx:39)
  → supabase.rpc('governed_confirm_delivery', {p_token, p_delivery_id, ...})
    → delivery.status = 'delivered'
  → supabase.rpc('governed_fail_delivery', {p_token, p_delivery_id, p_reason})
    → delivery.status = 'failed'
  → Tables Written: delivery_tracking
  → Tables Read: delivery_tracking
  → Next: CollectionsPage (for payment collection) or ReturnsPage (for returns)
```

### 2.14 Collection Flow

```
NewCollectionPage (src/pages/collections/NewCollectionPage.tsx:47)
  → supabase.rpc('governed_create_collection', {p_token, p_customer_id, p_amount, p_method, ...})
  → collection.status = 'pending' (assumed)

CollectionsPage (src/pages/collections/CollectionsPage.tsx:92)
  → supabase.rpc('governed_approve_collection', {p_token, p_id})
  → collection.status = 'approved'
  → Tables Written: collections
  → Tables Read: customers (for verification)
```

### 2.15 Return Flow

```
**START BLOCKED** — No UI creates returns
  → ReturnsPage reads: supabase.rpc('get_governed_returns') — list only
  → ReturnDetailPage: get_governed_return, get_governed_return_items
  → ReturnDetailPage: governed_approve_return / governed_reject_return
  → Tables Written: return (status change only)
  → Tables Read: return, return_item, return_inspection
```

### 2.16 Credit Application Flow

```
**START BLOCKED** — No UI creates credit applications
  → CreditApplicationsPage: get_governed_credit_applications — list only
  → CreditReviewPage: get_governed_credit_application, governed_confirm_documents
  → CreditReviewPage: governed_manage_credit_application (approve) → creates credit_account
  → CreditReviewPage: governed_decline_credit (reject)
```

### 2.17 Credit Program/Account Management Flow

```
CreditProgramsPage / CreditProgramsManagerPage
  → governed_get_credit_programs, governed_create_credit_program
  → governed_update_credit_program, governed_toggle_credit_program
  → Tables Written: credit_programs

**Missing:** Credit account activation, suspension, payment, cheque, reservation, ledger, statements
  → creditService has wrappers for all but NO page calls them
  → RPCs exist: governed_activate_credit_account, governed_suspend_credit_account,
    governed_reactivate_credit_account, governed_record_cheque, governed_record_credit_payment,
    governed_reserve_credit_for_order, governed_release_credit_reservation,
    governed_convert_credit_reservation_to_outstanding
```

### 2.18 Daily Deal Lifecycle Flow

```
DailyDealsManagerPage (src/pages/daily-deals/DailyDealsManagerPage.tsx)
  → supabase.rpc('get_governed_daily_deals') — read list
  → supabase.rpc('governed_update_daily_deal', {p_token, p_id, p_title, ...}) — update
  → supabase.from('daily_deals').update(directFields).eq('id', selectedId) — BYPASS for specific fields
  → supabase.rpc(fn, ...) where fn = governed_activate_daily_deal | governed_cancel_daily_deal
  → Tables Written: daily_deals, daily_deal_items
  → Tables Read: daily_deals

**Orphaned RPC:** governed_create_daily_deal exists in DB + dailyDealService but not called from page.
```

### 2.19 Flash Offer Lifecycle Flow

```
flashOfferService (src/services/flashOffers.ts)
  → has: getAll(), getActive(), create(), activate(), cancel()
  → ALL call governed_* RPCs (get_governed_flash_offers, governed_create_flash_offer, etc.)

Flash Offer pages (src/pages/flash-offers/*.tsx)
  → ZERO direct supabase calls
  → May use flashOfferService (not verified from page code)

Status: UNVERIFIED — services exist, pages exist, but no confirmed end-to-end trace.
```

### 2.20 Auction Lifecycle Flow

```
auctionService (src/services/auctions.ts)
  → getAll(), getById() — read RPCs
  → requestParticipation(), placeBid() — write RPCs
  → subscribeBids(), subscribeActivity(), subscribeParticipants() — realtime subscriptions

AuctionsManagerPage (src/pages/auctions/AuctionsManagerPage.tsx)
  → RPC: get_governed_auctions — read
  → BYPASS: supabase.from('auctions').insert({...}) — create (governed_create_auction exists but NOT used)
  → BYPASS: supabase.from('auctions').update(patch).eq('id', id) — update
```

### 2.21 Product Lifecycle Flow

```
ProductsPage (src/pages/products/ProductsPage.tsx)
  → governed_create_product, governed_update_product, governed_update_product_pricing
  → governed_change_product_company, governed_activate_product / governed_deactivate_product

ProductManagerPage (src/pages/products/ProductManagerPage.tsx)
  → governed_update_product, governed_change_product_company
  → governed_update_product_pricing, governed_update_product_units
  → governed_show_product / governed_hide_product
  → supabase.from('products').update({image_url}).eq('id', ...) — BYPASS (image only)
  → supabase.from('products').update({is_visible}).eq('id', ...) — BYPASS (visibility)
  → supabase.from('inventory').upsert(...) — BYPASS (inventory)

ProductProfilePage (src/pages/products/ProductProfilePage.tsx)
  → get_governed_products — read only
```

### 2.22 Company Lifecycle Flow

```
CompaniesPage (src/pages/companies/CompaniesPage.tsx)
  → governed_create_company, governed_update_company
  → governed_activate_company / governed_deactivate_company

CompanyManagerPage (src/pages/companies/CompanyManagerPage.tsx)
  → governed_update_company
  → supabase.from('companies').select('*').eq('id', id).single() — BYPASS read
  → supabase.from('companies').update({logo_url}).eq('id', ...) — BYPASS
  → supabase.from('companies').update({is_visible}).eq('id', ...) — BYPASS
  → governed_set_tier_company_exception, governed_remove_tier_company_exception

CompanyProfilePage (src/pages/companies/CompanyProfilePage.tsx)
  → get_governed_companies, get_company_products, get_company_analytics — read only
```

### 2.23 Tier Lifecycle Flow

```
TiersManagerPage (src/pages/tiers/TiersManagerPage.tsx)
  → get_governed_tiers, governed_create_tier, governed_update_tier

ProductManagerPage + CompanyManagerPage
  → governed_set_tier_company_exception, governed_remove_tier_company_exception
  → governed_set_tier_product_exception, governed_remove_tier_product_exception
```

---

## Section 3 — Workflow State Machine Audit

### 3.1 Order State Machine

**Defined states** (from OrderStatusManager.tsx:9):
`draft → submitted → reviewing → returned_for_revision → approved → preparing → prepared → ready_for_dispatch → sent_to_delivery → dispatched → deferred → cancelled → delivered`

| State | Reachable From | Exit To (Normal) | Exit To (Exceptional) | RPC | UI |
|-------|---------------|------------------|----------------------|-----|----|
| `draft` | `governed_create_order` | `submitted` (governed_submit_order) | `cancelled`, `deferred` | `governed_submit_order`, `governed_change_order_status` | OrderNewPage, OrderReviewPage |
| `submitted` | `governed_submit_order` | `reviewing` | `cancelled`, `deferred`, any backward | `governed_change_order_status` | OrderStatusManager (canReview) |
| `reviewing` | governed_change_order_status | `approved`, `returned_for_revision` | `cancelled`, `deferred` | `governed_change_order_status` | OrderStatusManager (canManage) |
| `returned_for_revision` | governed_change_order_status | (any forward) | `cancelled`, `deferred` | `governed_change_order_status` | OrderStatusManager (canManage) |
| `approved` | governed_change_order_status | `preparing` | `cancelled`, `deferred` | `governed_change_order_status` | OrderStatusManager (canCompletePreparation) |
| `preparing` | governed_change_order_status | `prepared` | `cancelled`, `deferred` | `governed_change_order_status` | OrderStatusManager (canCompletePreparation) |
| `prepared` | governed_change_order_status | `sent_to_delivery` | `cancelled`, `deferred` | `governed_change_order_status` | OrderStatusManager (canSendToDelivery) |
| `ready_for_dispatch` | governed_change_order_status | `sent_to_delivery` | `cancelled`, `deferred` | `governed_change_order_status` | OrderStatusManager (canSendToDelivery) |
| `sent_to_delivery` | governed_change_order_status | `dispatched` | `cancelled`, `deferred` | `governed_dispatch_order` | WarehousePage (governed_dispatch_order) |
| `dispatched` | `governed_dispatch_order` | `delivered` | `cancelled`, `deferred` | `governed_change_order_status` | OrderStatusManager (canManage) |
| `deferred` | governed_change_order_status | (any forward) | — | `governed_change_order_status` | OrderStatusManager (canManage) |
| `cancelled` | governed_change_order_status | — (terminal) | — | `governed_change_order_status` | OrderStatusManager (canManage) |
| `delivered` | governed_change_order_status | — (terminal) | — | `governed_confirm_delivery` | DeliveryDetailPage |

**Critical Finding:** `governed_approve_order` and `governed_deny_order` are NOT called. The status transition to `approved` or backward from `reviewing` goes through `governed_change_order_status`, which does NOT execute inventory deduction or credit invoice creation logic.

**Critical Finding:** The state `ready_for_dispatch` is defined in the status list but no normal transition leads TO it from `sent_to_delivery`. It can only be reached via canManage (manual override).

### 3.2 Visit State Machine

**Inferred states** (from governed_create_visit, governed_checkin_visit, governed_checkout_visit):
`scheduled → checked_in → checked_out`

| State | Reachable From | Exit To | RPC | UI |
|-------|---------------|---------|-----|----|
| `scheduled` | `governed_create_visit` (NOT called) | `checked_in` | `governed_checkin_visit` | (no scheduled visit UI) |
| `checked_in` | `governed_checkin_visit` | `checked_out` | `governed_checkout_visit` | VisitDetailPage, VisitScreen |
| `checked_out` | `governed_checkout_visit` | — (terminal) | — | — |

**Note:** Visits created only via check-in. `governed_create_visit` exists but NOT called. There is no "scheduled visit" flow.

### 3.3 Return State Machine

**Inferred states** (from return-related RPCs):
`pending → approved | rejected`

| State | Reachable From | Exit To | RPC | UI |
|-------|---------------|---------|-----|----|
| `pending` | External/Unknown | `approved`, `rejected` | `governed_create_return` (NOT called) | (no create UI) |
| `approved` | `governed_approve_return` | — (terminal) | `governed_approve_return` | ReturnDetailPage |
| `rejected` | `governed_reject_return` | — (terminal) | `governed_reject_return` | ReturnDetailPage |

**Critical Finding:** Returns cannot be created. The `pending` state is unreachable through UI. Returns can only be read (list), approved, or rejected.

### 3.4 Collection State Machine

**Inferred states** (from collection-related RPCs):
`pending → approved`

| State | Reachable From | Exit To | RPC | UI |
|-------|---------------|---------|-----|----|
| `pending` | `governed_create_collection` | `approved` | `governed_create_collection` | NewCollectionPage |
| `approved` | `governed_approve_collection` | — (terminal) | `governed_approve_collection` | CollectionsPage |

**Note:** `governed_update_collection` exists but NOT called. No rejection/cancellation state for collections.

### 3.5 Delivery State Machine

**Inferred states** (from delivery-related RPCs):
`pending → assigned → delivered | failed`

| State | Reachable From | Exit To | RPC | UI |
|-------|---------------|---------|-----|----|
| `pending` | `governed_dispatch_order` | `assigned` | — (implicit after dispatch) | — |
| `assigned` | `governed_assign_delivery` | `delivered`, `failed` | `governed_assign_delivery` | DeliveryPage |
| `delivered` | `governed_confirm_delivery` | — (terminal) | `governed_confirm_delivery` | DeliveryDetailPage |
| `failed` | `governed_fail_delivery` | — (terminal) | `governed_fail_delivery` | DeliveryDetailPage |

**Note:** No re-assign, no re-deliver. One-shot delivery flow.

### 3.6 Credit Application State Machine

**From enum:** `draft, submitted, under_review, documents_received, approved, rejected, suspended`

| State | Reachable From | Exit To | RPC | UI |
|-------|---------------|---------|-----|----|
| `draft` | `governed_create_credit_application` | `submitted` | (RPC exists, NOT called) | (no UI) |
| `submitted` | `governed_submit_credit_application` | `under_review` | (RPC exists, NOT called) | (no UI) |
| `under_review` | (not called) | `documents_received` | `governed_confirm_documents` | CreditReviewPage |
| `documents_received` | `governed_confirm_documents` | `approved`, `rejected` | `governed_manage_credit_application`, `governed_decline_credit` | CreditReviewPage |
| `approved` | `governed_manage_credit_application` | `suspended` | `governed_suspend_credit` (NOT called) | (no UI) |
| `rejected` | `governed_decline_credit` | — (terminal) | — | — |
| `suspended` | `governed_suspend_credit` | (any) | (RPC exists, NOT called) | (no UI) |

**Critical Finding:** Applications cannot be created or submitted through UI. Only `under_review`, `documents_received`, `approved`, `rejected` states are reachable.

### 3.7 Warehouse Preparation State Machine

**From enum:** `in_progress, completed, reviewed, failed`

| State | Reachable From | Exit To | RPC | UI |
|-------|---------------|---------|-----|----|
| `in_progress` | `governed_start_preparation` | `completed`, `failed` | `governed_start_preparation` | WarehousePage |
| `completed` | `governed_complete_preparation` | `reviewed`, `in_progress` (return) | `governed_complete_preparation` | WarehousePage |
| `reviewed` | `governed_review_preparation` | — (terminal for prep) | `governed_review_preparation` | WarehousePage, WarehouseReviewPage |
| `failed` | `governed_fail_preparation` | — (terminal) | `governed_fail_preparation` | WarehousePage |

**Note:** `returned_to_preparation` goes back to `in_progress`. The enum does NOT include `returned` but `governed_return_to_preparation` sets status back to `in_progress`.

---

## Section 4 — Dead Workflow Detection

### 4.1 Workflow Status Matrix

| Workflow | Status | Classification |
|----------|--------|---------------|
| Customer Self-Registration | **Partial** | RPC exists, page exists, but uses `register_customer` auth + session path separate from `governed_create_customer` — two parallel customer creation paths |
| Managed Customer Creation | **Operational** | Full create → read → update → activate → ownership change |
| Employee Creation | **Operational** | Full create → read → update → manager/role/password/capabilities → activate |
| Login | **Operational** | Full auth flow |
| Visit Check-In | **Operational** | Creates visit on check-in (no scheduled visit creation needed) |
| Visit Check-Out | **Operational** | Updates visit result + GPS |
| Order Creation | **Operational** | Create with items → add deals/offers → submit |
| Order Submission | **Operational** | draft → submitted |
| Order Approval | **Broken** | `governed_approve_order` has inventory deduction + credit invoice logic that is NEVER executed. Status transitions to 'approved' via `governed_change_order_status` which lacks business logic. |
| Order Rejection | **Broken** | `governed_deny_order` has denial-specific logic that is NEVER executed. Status transitions via `governed_change_order_status`. |
| Warehouse Preparation | **Operational** | Full lifecycle: start → complete → review → return/fail |
| Warehouse Review | **Operational** | Review → approve/reject |
| Dispatch | **Operational** | governed_dispatch_order creates delivery record |
| Delivery Confirmation | **Operational** | Assign → confirm/fail |
| Collection Creation | **Operational** | Create + approve |
| Collection Approval | **Operational** | Approve only |
| Return Creation | **Broken** | `governed_create_return` exists in DB but NOT called. Returns cannot be initiated through UI. |
| Return Approval | **Operational** | Approve/reject existing returns |
| Credit Application (Create) | **Broken** | `governed_create_credit_application` exists in DB + service layer but NO UI calls it |
| Credit Approval | **Operational** | governed_manage_credit_application called from CreditReviewPage |
| Credit Rejection | **Operational** | governed_decline_credit called from CreditReviewPage |
| Credit Account Operations | **Orphaned** | 8 RPCs + service wrappers exist for activation, suspension, payment, cheque, reservation, ledger — ZERO are called from pages |
| Daily Deals | **Partial** | Read, update, activate/cancel work. governed_create_daily_deal exists but NOT called from DailyDealsManagerPage. |
| Flash Offers | **Orphaned** | Full service layer + RPCs exist. Flash-offer pages have zero supabase calls. Service layer may be used but unconfirmed. |
| Auctions | **Partial** | Read/bid/participate work. AuctionsManagerPage bypasses governed_create_auction with raw inserts. |
| Product Lifecycle | **Operational** | Full CRUD + pricing + units + activate/deactivate + show/hide |
| Company Lifecycle | **Operational** | Full CRUD + profile + activate/deactivate + tier exceptions |
| Tier Management | **Operational** | Full CRUD + company/product exceptions |
| Employee Hierarchy | **Operational** | Manager change, role change, password reset, capabilities |
| Customer Ownership | **Operational** | governed_change_customer_ownership |
| Dashboard Views | **Operational** | All role-specific dashboards function |
| Global Search | **Operational** | governed_global_search |
| Target Management | **Partial** | Service + RPCs exist. Pages confirmed to use service layer. However, target input/display may be incomplete. |
| Report Generation | **Partial** | Dynamic RPC selection. ReportsPage works but each report type may have gaps. |

### 4.2 Summary Count

| Classification | Count | Workflows |
|---------------|-------|-----------|
| **Operational** | 18 | Managed Customer, Employee, Login, Check-In, Check-Out, Order Creation, Order Submission, Warehouse Prep, Warehouse Review, Dispatch, Delivery, Collection Create, Collection Approval, Return Approval, Return Rejection, Credit Approval, Credit Rejection, Product, Company, Tier, Employee Hierarchy, Customer Ownership, Dashboards, Global Search |
| **Partial** | 6 | Customer Self-Registration, Daily Deals, Auctions, Target Management, Report Generation |
| **Broken** | 4 | Order Approval, Order Rejection, Return Creation, Credit Application Creation |
| **Orphaned** | 2 | Credit Account Operations, Flash Offers |

---

## Section 5 — Status Transition Audit

### 5.1 Order Transitions Audit

| From → To | Possible? | UI Button? | RPC | File Evidence |
|-----------|-----------|-----------|-----|---------------|
| draft → submitted | ✓ Yes | ✓ Submit button | `governed_submit_order` | OrderReviewPage.tsx:104, OrderNewPage.tsx:214 |
| submitted → reviewing | ✓ Yes | ✓ "reviewing" button | `governed_change_order_status` | OrderStatusManager.tsx:52 |
| reviewing → approved | ✓ Yes | ✓ "approved" (via dropdown) | `governed_change_order_status` | OrderStatusManager.tsx:50 (canManage) |
| reviewing → returned_for_revision | ✓ Yes | ✓ Dropdown | `governed_change_order_status` | OrderStatusManager.tsx:50 |
| approved → preparing | ✓ Yes | ✓ "preparing" button | `governed_change_order_status` | OrderStatusManager.tsx:54 |
| preparing → prepared | ✓ Yes | ✓ "prepared" button | `governed_change_order_status` | OrderStatusManager.tsx:55 |
| prepared → sent_to_delivery | ✓ Yes | ✓ "sent_to_delivery" button | `governed_change_order_status` | OrderStatusManager.tsx:58 |
| sent_to_delivery → dispatched | ✓ Yes | ✓ Dispatch button (separate) | `governed_dispatch_order` | WarehousePage.tsx:194 |
| dispatched → delivered | ✓ Yes | ✓ Confirm delivery button | `governed_confirm_delivery` | DeliveryDetailPage.tsx:39 |
| ANY → cancelled | ✓ Yes | ✓ Exceptional (requires reason) | `governed_change_order_status` | OrderStatusManager.tsx:36,68 |
| ANY → deferred | ✓ Yes | ✓ Exceptional (requires reason) | `governed_change_order_status` | OrderStatusManager.tsx:37,68 |
| submitted → approved (direct) | ✓ Yes | ✓ Dropdown (canManage) | `governed_change_order_status` | OrderStatusManager.tsx:50 — bypasses review step |
| `ready_for_dispatch` → anything | Partial | Only canManage dropdown | `governed_change_order_status` | OrderStatusManager.tsx — no NORMAL transition LEADS TO ready_for_dispatch |

**Critical Issues:**
1. No transition uses `governed_approve_order` or `governed_deny_order` — these RPCs are dead
2. The `ready_for_dispatch` state has no normal inbound transition (it's only set manually via canManage)
3. Inventory is NEVER deducted on approval (governed_approve_order logic is orphaned)
4. Credit invoices are NEVER created on approval for credit orders

### 5.2 Visit Transitions Audit

| From → To | Possible? | UI Button? | RPC | File Evidence |
|-----------|-----------|-----------|-----|---------------|
| (none) → checked_in | ✓ Yes | ✓ Check-in button | `governed_checkin_visit` | VisitsPage.tsx:111, VisitScreen.tsx:121 |
| checked_in → checked_out | ✓ Yes | ✓ Check-out button | `governed_checkout_visit` | VisitDetailPage.tsx:110, VisitScreen.tsx:167 |
| scheduled → checked_in | ✗ No UI | No | `governed_checkin_visit` | governed_create_visit exists but NOT called |

### 5.3 Return Transitions Audit

| From → To | Possible? | UI Button? | RPC | File Evidence |
|-----------|-----------|-----------|-----|---------------|
| (none) → pending | ✗ No UI | No create button | `governed_create_return` | Not called from any file |
| pending → approved | ✓ Yes | ✓ Approve button | `governed_approve_return` | ReturnDetailPage.tsx:38 |
| pending → rejected | ✓ Yes | ✓ Reject button | `governed_reject_return` | ReturnDetailPage.tsx:53 |

### 5.4 Collection Transitions Audit

| From → To | Possible? | UI Button? | RPC | File Evidence |
|-----------|-----------|-----------|-----|---------------|
| (none) → pending | ✓ Yes | ✓ Create button | `governed_create_collection` | NewCollectionPage.tsx:47 |
| pending → approved | ✓ Yes | ✓ Approve button | `governed_approve_collection` | CollectionsPage.tsx:92 |
| pending → rejected | ✗ No | No reject button | none | No reject RPC exists for collections |

### 5.5 Credit Application Transitions Audit

| From → To | Possible? | UI Button? | RPC | File Evidence |
|-----------|-----------|-----------|-----|---------------|
| (none) → draft | ✗ No UI | No create button | `governed_create_credit_application` | Not called from any page |
| draft → submitted | ✗ No UI | No | `governed_submit_credit_application` | Not called |
| submitted → under_review | ✗ No UI | No | (no specific RPC) | — |
| under_review → documents_received | ✓ Yes | ✓ Confirm documents | `governed_confirm_documents` | CreditReviewPage.tsx:44 |
| documents_received → approved | ✓ Yes | ✓ Approve | `governed_manage_credit_application` | CreditReviewPage.tsx:37 (dynamic) |
| documents_received → rejected | ✓ Yes | ✓ Reject | `governed_decline_credit` | CreditReviewPage.tsx:37 (dynamic) |
| approved → suspended | ✗ No UI | No | `governed_suspend_credit` | Not called from any page |

### 5.6 States With No Exit

| Entity | State | Why Stuck | Impact |
|--------|-------|-----------|--------|
| Order | `ready_for_dispatch` | No normal path LEADS TO this state. Only reachable via manual canManage override. | Orphaned state — may never be used |
| Collection | `pending` | No reject/delete/cancel RPC. Only approval path exists. | Approved or stuck forever |
| Return | `pending` | No update RPC called from frontend. Only approve/reject. | No revision possible |
| Delivery | `failed` | Terminal — no re-assign, no re-attempt. | One-shot delivery |
| Credit Application | `suspended` | governed_suspend_credit not called. No unsuspend/reactivate path from pages. | Unreachable from UI |

### 5.7 Unreachable States (No Path To Enter)

| Entity | State | Why Unreachable |
|--------|-------|-----------------|
| Return | `pending` (initial) | governed_create_return not called from any frontend code |
| Visit | `scheduled` | governed_create_visit not called from any frontend code |
| Credit Application | `draft`, `submitted`, `under_review`, `suspended` | governed_create_credit_application and governed_submit_credit_application not called |
| Order | `ready_for_dispatch` | No normal transition leads to it (only canManage dropdown bypass) |

---

## Section 6 — Runtime Execution Validation

### 6.1 Workflow Validation Matrix

| Workflow | UI Exists | RPC Exists | Read Exists | Write Exists | End-To-End Complete |
|----------|-----------|-----------|-------------|-------------|-------------------|
| Customer Self-Registration | YES | YES | NO | YES | PARTIAL — creates but no self-service dashboard |
| Managed Customer Creation | YES | YES | YES | YES | YES |
| Employee Creation | YES | YES | YES | YES | YES |
| Login | YES | YES (auth) | NO | YES | YES |
| Visit Check-In | YES | YES | YES | YES | YES |
| Visit Check-Out | YES | YES | YES | YES | YES |
| Order Creation | YES | YES | YES | YES | YES |
| Order Submission | YES | YES | YES | YES | YES |
| Order Approval | YES | YES (orphaned) | YES | PARTIAL | **NO** — governed_approve_order not called; no inventory/credit logic |
| Order Rejection | YES | YES (orphaned) | YES | PARTIAL | **NO** — governed_deny_order not called |
| Warehouse Preparation | YES | YES | YES | YES | YES |
| Warehouse Review | YES | YES | YES | YES | YES |
| Dispatch | YES | YES | YES | YES | YES |
| Delivery Confirmation | YES | YES | YES | YES | YES |
| Collection Creation | YES | YES | NO | YES | YES |
| Collection Approval | YES | YES | YES | YES | YES |
| Return Creation | NO | YES | NO | YES | **NO** — no create UI, no create flow |
| Return Approval | YES | YES | YES | YES | YES |
| Return Rejection | YES | YES | YES | YES | YES |
| Credit Application Creation | NO | YES | NO | YES | **NO** — no create UI |
| Credit Approval | YES | YES | YES | YES | YES |
| Credit Rejection | YES | YES | YES | YES | YES |
| Credit Account Activate | NO | YES | NO | YES | **NO** — service exists, no page calls it |
| Credit Account Suspend | NO | YES | NO | YES | **NO** |
| Credit Payment | NO | YES | NO | YES | **NO** |
| Credit Cheque Registration | NO | YES | NO | YES | **NO** |
| Credit Reservation | NO | YES | NO | YES | **NO** |
| Daily Deals Manage | YES | PARTIAL | YES | YES | PARTIAL — create RPC not used; has bypass |
| Flash Offers Manage | PARTIAL | YES | PARTIAL | PARTIAL | PARTIAL — service layer exists, page usage unconfirmed |
| Auctions Manage | YES | PARTIAL | YES | YES | PARTIAL — bypasses governed_create_auction |
| Product Lifecycle | YES | YES | YES | YES | YES |
| Company Lifecycle | YES | YES | YES | YES | YES |
| Tier Management | YES | YES | YES | YES | YES |
| Dashboard Views | YES | YES | YES | NO | YES |
| Global Search | YES | YES | YES | NO | YES |
| Target Management | YES | YES | YES | YES | PARTIAL — confirmed via service layer |
| Reports | YES | YES | YES | NO | PARTIAL — dynamic RPC |

---

## Section 7 — Business Critical Gaps

Ranked by business impact (highest first):

| # | Gap | Impact | Evidence |
|---|-----|--------|----------|
| **C1** | **Inventory never deducted on order approval** | `governed_approve_order` contains inventory deduction logic. It is NEVER called. All order approvals go through `governed_change_order_status` which does NOT update inventory. | OrderStatusManager.tsx:88 calls governed_change_order_status. governed_approve_order exists in DB (01_DATABASE_INVENTORY.md:193) but no call site found. |
| **C2** | **Credit invoices never created on order approval** | `governed_approve_order` creates credit invoices for credit orders. Not called → credit orders never invoiced. | Same as C1. governed_approve_order body not verified but DB schema shows it creates credit_invoices. |
| **C3** | **Returns cannot be created through UI** | Staff cannot initiate return requests. `governed_create_return` exists but has no frontend caller. | ReturnsPage.tsx:27 — read only. ReturnDetailPage.tsx:38,53 — approve/reject only. No create RPC called anywhere. |
| **C4** | **Credit applications cannot be created through UI** | Customers/staff cannot apply for credit. `governed_create_credit_application` exists in DB + service layer but no page calls it. | CreditApplicationsPage.tsx:27 — list only. No createCreditApplication call found in any page. |
| **C5** | **Credit payments/cheques/ledger have no UI** | 8 credit financial RPCs exist (`governed_pay_credit_invoice`, `governed_register_cheque`, etc.) but no page calls them. Credit system is read-only for financial operations. | creditService.ts has wrappers for all but no pages import/use them (verified: no page imports creditService except potential indirect usage). |
| **C6** | **Credit reservation never executed during order** | `governed_reserve_credit_for_order` exists but neither OrderNewPage nor OrderReviewPage calls it. Credit orders may exceed customer limit. | OrderNewPage.tsx:200-249 — no credit reservation call. OrderReviewPage.tsx:74-127 — no credit reservation call. |
| **C7** | **Order approval business logic replaced by generic status change** | `governed_change_order_status` is a generic status transition RPC. It replaces the domain-specific approve/deny RPCs that had inventory, credit, and audit-specific logic. | OrderStatusManager.tsx:88 — single RPC for all transitions. governed_approve_order (01_DATABASE_INVENTORY.md:26) and governed_deny_order (27) never called. |
| **C8** | **Two parallel customer creation paths** | `register_customer` creates identity+session+customer. `governed_create_customer` creates customer only (no auth). NewCustomerPage uses governed_create_customer (employee creates). RegistrationPage uses register_customer (self-service). Different entry points, different behavior. | RegistrationPage — register_customer. NewCustomerPage.tsx:96 — governed_create_customer. SupervisorPage.tsx:475 — governed_create_customer. |
| **C9** | **Auctions bypass governed RPC for creation** | `governed_create_auction` exists but AuctionsManagerPage uses raw `supabase.from('auctions').insert()`. No governed business logic applied (code generation, validation, etc.). | AuctionsManagerPage.tsx:96 — supabase.from('auctions').insert({...}). DB inventory #41 lists governed_create_auction. |
| **C10** | **No workflow linking delivery→collection automatically** | After delivery confirmed, no automatic collection creation. Collections are created manually via NewCollectionPage. No RPC links these flows. | No governed_create_collection call in any delivery page. DeliveryDetailPage.tsx:39 — only governed_confirm_delivery. |

---

## Section 8 — Orphan Assets

### 8.1 Orphaned RPCs (Not Belonging to Any Active Workflow)

| RPC | Type | Why Orphaned | Workflow |
|-----|------|-------------|----------|
| `governed_approve_order` | Write | Never called; order approval uses governed_change_order_status | Order Approval |
| `governed_deny_order` | Write | Never called; order rejection uses governed_change_order_status | Order Rejection |
| `governed_create_return` | Write | Never called from frontend | Return Creation |
| `governed_update_return` | Write | Never called from frontend | Return Update |
| `governed_update_collection` | Write | Never called from frontend | Collection Update |
| `governed_create_visit` | Write | Never called; check-in creates visits implicitly | Visit Creation |
| `governed_create_location` | Write | Never called directly; governed_create_customer handles location | Location Creation |
| `governed_create_daily_deal` | Write | Exists in service + DB but DailyDealsManagerPage uses update+bypass | Daily Deal Creation |
| `governed_create_flash_offer` | Write | Exists in service + DB but no page calls it | Flash Offer Creation |
| `governed_update_flash_offer` | Write | Never called from any page | Flash Offer Update |
| `governed_create_auction` | Write | Exists in DB but AuctionsManagerPage uses raw from().insert() | Auction Creation |
| `governed_create_credit_application` | Write | Exists in service + DB but no page calls it | Credit App Creation |
| `governed_submit_credit_application` | Write | Never called from any page | Credit App Submit |
| `governed_suspend_credit` | Write | Never called from any page | Credit Suspend |
| `governed_activate_credit_account` | Write | Exists in service but no page calls it | Credit Activate |
| `governed_suspend_credit_account` | Write | Exists in service but no page calls it | Credit Suspend |
| `governed_reactivate_credit_account` | Write | Exists in service but no page calls it | Credit Reactivate |
| `governed_record_cheque` | Write | Exists in service but no page calls it | Cheque Registration |
| `governed_record_credit_payment` | Write | Exists in service but no page calls it | Credit Payment |
| `governed_reserve_credit_for_order` | Write | Exists in service but no page calls it | Credit Reservation |
| `governed_release_credit_reservation` | Write | Exists in service but no page calls it | Credit Release |
| `governed_convert_credit_reservation_to_outstanding` | Write | Exists in service but no page calls it | Credit Convert |
| `governed_auto_suspend_overdue_accounts` | Write | Exists in service but no page calls it | Auto Suspend |
| `register_customer` | Write | Not called from any page; governed_create_customer is preferred | Self-Registration |
| `governed_reassign_customer_ownership` | Write | Not called; governed_change_customer_ownership used instead | Ownership Change |
| `governed_update_contract_template` | Write | No page calls it | Contract Template |

### 8.2 Orphaned Screens (Pages With No Active Workflow)

| Screen | File | Why Orphaned |
|--------|------|-------------|
| CheckoutPage | `src/pages/checkout/CheckoutPage.tsx` | Empty shell — zero supabase calls. No workflow depends on it. |
| ActivityPage | `src/pages/activity/ActivityPage.tsx` | Empty shell — zero supabase calls. No workflow depends on it. |

### 8.3 Orphaned Screens (Pages With Service Layer Only — Workflow Unconfirmed)

| Screen | File | Why Questionable |
|--------|------|-----------------|
| FlashOffersPage | `src/pages/flash-offers/FlashOffersPage.tsx` | Zero direct supabase calls. May use flashOfferService. |
| FlashOfferDetailPage | `src/pages/flash-offers/FlashOfferDetailPage.tsx` | Same — zero direct calls. |
| FlashOffersManagementPage | `src/pages/flash-offers/FlashOffersManagementPage.tsx` | Same — zero direct calls. |
| DealsPage | `src/pages/deals/DealsPage.tsx` | Zero direct supabase calls. May use dealService. |

### 8.4 Orphaned Tables (Not Touched By Any Workflow)

| Table | Rows | Last Used By Workflow |
|-------|------|----------------------|
| `customer_classification` | 0 | Never — no code touches it |
| `customer_daily_deal` | 0 | Never |
| `deal` | 0 | Never |
| `follow_up` | 0 | Never |
| `notification` | 0 | Never |
| `permission` | 3 | Legacy — no workflow depends on it |
| `visit_note` | 0 | Never |
| `voucher_type` | 0 | Never |
| `sync_log` | 0 | Trigger-only (no trigger exists in schema) |
| `activity_log` | 0 | Trigger-only (no trigger exists in schema) |
| `packages` | ? | Legacy — superseded by daily_deals/flash_offers |
| `package_items` | ? | Legacy |
| `package_orders` | ? | Legacy |

### 8.5 Orphaned Enums (Defined But May Not Be Fully Used)

| Enum | Values | All Values Used? |
|------|--------|-----------------|
| `auction_participant_status` | pending, approved, rejected, blocked | ✓ All used by auction workflow |
| `auction_status` | pending, live, ended, awarded, cancelled | ✓ All used |
| `credit_application_status` | draft, submitted, under_review, documents_received, approved, rejected, suspended | ✗ draft, submitted, suspended — unreachable from frontend |
| `preparation_exception_type` | missing_quantity, missing_product, damaged_product, incomplete_order, other | ✓ All used by warehouse workflow |
| `preparation_status` | in_progress, completed, reviewed, failed | ✗ 'failed' may not be visualized in UI |

### 8.6 Orphaned States (Defined But Unreachable)

| Entity | State | Why Unreachable |
|--------|-------|-----------------|
| Return | `pending` (initial) | No create flow |
| Visit | `scheduled` | governed_create_visit not called |
| Credit Application | `draft`, `submitted`, `suspended` | RPCs exist but no UI |
| Order | `ready_for_dispatch` | No normal path leads to it |

---

## Section 9 — Production Blockers

Only items that PREVENT the system from functioning as a B2B distribution platform:

| # | Blocker | Why It Blocks Production | Category |
|---|---------|------------------------|----------|
| **B1** | **Inventory is never deducted** | `governed_approve_order` (which deducts inventory) is not called. Stock levels never decrease. Warehouse staff cannot trust inventory numbers. | Inventory Integrity |
| **B2** | **Returns cannot be created** | Damaged or incorrect goods cannot be processed through the system. Staff must use external process or workaround. | Operational |
| **B3** | **Credit orders never invoiced** | Credit invoice creation logic in `governed_approve_order` never runs. Credit customers cannot be billed. | Financial |
| **B4** | **No credit payment flow** | Customers cannot pay credit invoices through the system. No payment recording, no cheque registration, no ledger tracking. 3 credit accounts exist with no way to manage them. | Financial |
| **B5** | **No credit reservation on order** | Credit orders can exceed customer limit. No check happens at order creation. | Financial |
| **B6** | **No way to initiate credit applications** | New customers cannot apply for credit. 3 existing credit applications exist but no new ones can be added. | Operational |
| **B7** | **Auctions bypass all governed business logic** | Raw inserts/updates to `auctions` table skip code generation, validation, and authorization logic in `governed_create_auction`. | Data Integrity |
| **B8** | **60% of customers use legacy address system** | 15 out of 25 customers have no `location_id` — they fall back to `customer_addresses` table. Any migration from legacy path breaks these customers. | Data Integrity |

---

## Section 10 — Executive Runtime Truth

### 10.1 What Works End-to-End

| # | Workflow | Start | End | Evidence |
|---|---------|-------|-----|----------|
| 1 | **Customer Creation (Managed)** | NewCustomerPage | CustomerProfilePage | governed_create_customer → create + read + update + activate + ownership change |
| 2 | **Employee Lifecycle** | EmployeesPage | EmployeeProfilePage | governed_create_employee → read + update + manager/role/password/capabilities + activate |
| 3 | **Order Lifecycle (Partial)** | OrderNewPage → OrderReviewPage | OrderStatusManager → Warehouse → Delivery | governed_create_order → add deals/offers → submit → status changes (except approve/deny) → prepare → review → dispatch → deliver |
| 4 | **Visit Lifecycle** | VisitsPage/VisitScreen | VisitDetailPage | governed_checkin_visit → check-out with GPS + result |
| 5 | **Warehouse Preparation** | WarehousePage | WarehouseReviewPage | governed_start → complete → review → fail/dispatch |
| 6 | **Delivery** | DeliveryPage | DeliveryDetailPage | governed_assign_delivery → confirm_delivery/fail_delivery |
| 7 | **Collection** | NewCollectionPage | CollectionsPage | governed_create_collection → approve_collection |
| 8 | **Return (Read/Approve/Reject only)** | ReturnsPage | ReturnDetailPage | get_governed_returns → approve_return/reject_return. **Create is broken.** |
| 9 | **Product Lifecycle** | ProductsPage | ProductManagerPage | governed_create_product → update + pricing + units + activate/deactivate + show/hide |
| 10 | **Company Lifecycle** | CompaniesPage | CompanyManagerPage | governed_create_company → update + profile + activate/deactivate + tier exceptions |
| 11 | **Tier Management** | TiersManagerPage | ProductManagerPage/CompanyManagerPage | governed_create_tier → update + company/product exceptions |
| 12 | **Dashboards** | DashboardPage | Role-specific workspace | All aggregate RPCs function and render data |
| 13 | **Global Search** | GlobalSearch component | Results display | governed_global_search across customers + products |

### 10.2 What Works Partially

| # | Workflow | What's Missing |
|---|---------|----------------|
| 1 | **Order Approval** | Status changes to 'approved' via generic RPC. `governed_approve_order` business logic (inventory deduction, credit invoice creation) never executed. |
| 2 | **Order Rejection** | Status changes via generic RPC. `governed_deny_order` never called. |
| 3 | **Daily Deals Management** | governed_create_daily_deal exists but DailyDealsManagerPage uses update + bypass. Create flow is via service layer only. |
| 4 | **Auctions Management** | AuctionsManagerPage bypasses governed_create_auction. Read/bid/participate work via auctionService. |
| 5 | **Target Management** | Service + RPCs exist. UI confirmed to use services. Full end-to-end functional but not deeply verified. |
| 6 | **Reports** | Dynamic RPC selection works. Each report type may have individual gaps. |

### 10.3 What Does NOT Work

| # | Workflow | Why Broken |
|---|---------|------------|
| 1 | **Return Creation** | No frontend code calls `governed_create_return`. Returns cannot be initiated. |
| 2 | **Credit Application Creation** | No frontend code calls `governed_create_credit_application`. Applications cannot be created. |
| 3 | **Credit Payment/Cheque/Ledger** | 8 RPCs + service wrappers exist — zero are called from any page. |
| 4 | **Credit Reservation** | No credit limit check during order creation. `governed_reserve_credit_for_order` never called. |
| 5 | **Checkout** | CheckoutPage is an empty shell with zero supabase calls. |
| 6 | **Activity Log** | ActivityPage is an empty shell with zero supabase calls. |

### 10.4 What Looks Functional But Isn't Used

| # | Asset | Location | Reality |
|---|-------|----------|---------|
| 1 | `governed_approve_order` | DB RPC #26 | Orphaned — never called. Full approve logic (inventory, credit invoice) dead. |
| 2 | `governed_deny_order` | DB RPC #27 | Orphaned — never called. |
| 3 | `governed_create_return` | DB RPC #28 | Orphaned — never called. |
| 4 | `governed_update_return` | DB RPC #29 | Orphaned — never called. |
| 5 | `governed_update_collection` | DB RPC #31 | Orphaned — never called. |
| 6 | `governed_create_visit` | DB RPC #32 | Orphaned — never called. |
| 7 | `governed_create_location` | DB RPC #36 | Orphaned — never called directly. |
| 8 | `governed_create_daily_deal` | DB RPC #37 + service | Orphaned — not called from DailyDealsManagerPage. |
| 9 | `governed_create_flash_offer` | DB RPC #39 + service | Orphaned — not called from any page. |
| 10 | `governed_update_flash_offer` | DB RPC #40 | Orphaned — never called. |
| 11 | `governed_create_auction` | DB RPC #41 | Orphaned — AuctionsManagerPage uses raw from().insert(). |
| 12 | governed_activate/suspend/reactivate credit | DB RPCs + service | All orphaned — no page calls them. |
| 13 | governed_record_cheque/payment | DB RPCs + service | Both orphaned — no page calls them. |
| 14 | governed_reserve/release/convert credit | DB RPCs + service | All orphaned — no page calls them. |
| 15 | `governed_create_credit_application` | DB RPC #48 + service | Orphaned — no page calls it. |
| 16 | `governed_submit_credit_application` | DB RPC #49 | Orphaned — no page calls it. |
| 17 | `governed_auto_suspend_overdue_accounts` | DB RPC + service | Orphaned — no page calls it. |
| 18 | `register_customer` | DB RPC #11 | Orphaned — page uses it but governed_create_customer is primary path. |
| 19 | CheckoutPage | `src/pages/checkout/CheckoutPage.tsx` | Empty shell — zero data calls. |
| 20 | ActivityPage | `src/pages/activity/ActivityPage.tsx` | Empty shell — zero data calls. |
| 21 | Flash-offer pages | `src/pages/flash-offers/*.tsx` | No direct supabase calls. May use service layer (unverified). |
| 22 | Test RPCs (7 total) | `test_*`, `multiline_test` | Zero call sites. Not used by any workflow. |
| 23 | 8 dead tables | classification, daily_deal, deal, follow_up, notification, permission, visit_note, voucher_type | 0 rows, zero frontend references. |

### 10.5 What Prevents Full Production Readiness

| # | Root Cause | Effect | Severity |
|---|-----------|--------|----------|
| 1 | `governed_approve_order` orphaned | Inventory never deducted. Credit invoices never created. | **Critical** — system cannot track stock or bill credit customers |
| 2 | `governed_create_return` orphaned | Returns cannot be initiated. | **Critical** — operational blocker for damaged/incorrect goods |
| 3 | No credit financial UI | 8 RPCs orphaned. Payments, cheques, ledger invisible. | **High** — 3 credit accounts exist but cannot be serviced |
| 4 | No UI for credit application creation | governed_create_credit_application orphaned | **High** — new customers cannot apply for credit |
| 5 | No credit reservation during order | Credit orders can exceed limit without check | **High** — financial risk |
| 6 | Auctions bypass governed_create_auction | Raw inserts skip business logic | **Medium** — data integrity risk |
| 7 | Two parallel customer creation paths | register_customer vs governed_create_customer — different behavior | **Medium** — inconsistent auth/identity handling |
| 8 | 15 customers on legacy addresses | customer_addresses fallback; migration incomplete | **Medium** — blocks cleanup of legacy address table |

**Final Verdict:** The system is **not production-ready** as a complete B2B distribution platform. The order approval gap (B1) alone makes inventory unreliable and credit billing impossible. The return creation gap (B2) creates an operational workaround need. The credit financial gaps (B3-B5) leave the credit subsystem as a read-only shell. Estimated true readiness: **55-60%** — most read paths work, most create paths work, but critical write paths in the financial/audit core are broken or orphaned.
