# PROJECT_CHANGELOG.md

> Permanent chronological history — Ahram Distribution Management System

---

## 2026-06-04 — Unified Identity & Location Standard

**Phase**: Implementation
**Objective**: Complete Unified Identity & Location Standard — shared location service, customer location UX, platform consistency.

### DB Migration
- `20260604_unified_identity_location.sql`: `business_type` ENUM, `unified_locations` table, customer columns (`business_type`, `responsible_name`, `location_id`), phone UNIQUE constraint, replaced `register_customer`, `governed_create_customer`, `governed_update_customer`, `get_governed_customer`, `get_governed_customers`.

### Shared Location Service
- `src/services/location.ts`: `buildGoogleMapsUrl()`, `openGoogleMaps()`, `formatAccuracy()`, `fetchLocation()`, `fetchLocations()`.

### Removed Duplicated URL Logic
- `RegistrationPage.tsx` — hardcoded URL → `locationService.buildGoogleMapsUrl()`
- `OrderDetailPage.tsx` — hardcoded URL → `locationService.buildGoogleMapsUrl()`
- `VisitScreen.tsx` — hardcoded URL → `locationService.buildGoogleMapsUrl()`

### Customer UI Updates
- `CustomerProfilePage.tsx` — Added location section with formatted_address, accuracy status, capture timestamp, prominent "فتح الموقع" button.
- `CustomersPage.tsx` — Added per-customer location display with accuracy badge and "فتح الموقع" action.
- `NewCustomerPage.tsx` — Added business_type dropdown, responsible_name field, GPS capture.
- `RegistrationPage.tsx` — Full rewrite: GPS capture, business_type, responsible_name, 6-digit password, Egyptian phone validation.

### Customer Location UX Standard
All customer location surfaces now show: العنوان, دقة الموقع, زر فتح الموقع.

### Index Review
No indexes added to `unified_locations` — no geospatial queries exist.

### Build
0 tsc errors, 1952 modules.

---

## 2026-06-04 — Credit Program Module V2

**Phase**: Implementation
**Objective**: Add credit account management, invoice/cheque tracking, credit reservation flow, payment recording, auto-suspension. Replace CustomerCreditPage with full dashboard.

### DB Migration
- Created 3 new tables: `customer_credit_accounts`, `credit_invoices`, `credit_invoice_cheques`
- Created 3 new ENUMs: `credit_account_status`, `credit_invoice_status`, `cheque_status`
- Added 6 new capabilities: `credit.account.activate`, `.suspend`, `.reactivate`, `credit.cheque.manage`, `credit.payment.record`, `credit.program.manage`
- Added `payment_method` column to `orders`
- Created 10 new governed RPCs:
  - Account: `get_governed_customer_credit_account`, `governed_activate_credit_account`, `governed_suspend_credit_account`, `governed_reactivate_credit_account`
  - Invoices: `get_governed_credit_invoices`, `get_governed_credit_invoice_detail`
  - Cheques: `governed_record_cheque`
  - Payments: `governed_record_credit_payment`
  - Order integration: `governed_reserve_credit_for_order`, `governed_release_credit_reservation`, `governed_convert_credit_reservation_to_outstanding`
  - Dashboard: `get_governed_credit_dashboard`
  - Auto-maintenance: `governed_auto_suspend_overdue_accounts`
- Seed data: 2 credit programs (100K/15d, 300K/30d), 3 test accounts (active/used40k/reserved10k, active/used180k/reserved50k, suspended/overdue200k), 4 invoices with cheques, 1 pending application

### Fixes during migration
- `ledger_transaction_type` enum only has `debit`/`credit` → changed all custom types (`activation`, `suspension`, `reactivation`, `payment`, `order`, `auto_suspension`) to `credit`/`debit`
- `ck_credit_ledger_reference` constraint requires both or neither `reference_type`/`reference_id` → seed data uses CTE to capture account IDs
- `orders.created_by` is NOT NULL → added to seed INSERTs

### Frontend
- `src/types/storefront.ts` — added `CreditAccountRecord`, `CreditInvoiceRecord`, `CreditInvoiceDetailRecord`, `ChequeRecord`, `CreditDashboardStats`, status types
- `src/services/credit.ts` — created service with all 10 new RPCs + existing program/application RPCs
- `CustomerCreditPage.tsx` — replaced with full dashboard: account status card (credit limit/available/outstanding/reserved with usage bar), invoices list (open/all filter), application form (for customers without accounts), employee notice
- `CreditManagementPage.tsx` — new employee dashboard with 3 tabs: stats (total accounts, credit limit, invoices, pending apps), program management (create/toggle), invoices list (record payment)
- `BusinessShortcuts.tsx` — credit shortcut now navigates to `/credit` (was `null`)
- Routes: `/credit` → CustomerCreditPage, `/customer/credit` → redirect to `/credit`, `/credit/manage` → CreditManagementPage (requires `credit.manage`)

### Validation
- `tsc --noEmit` passes (0 errors)
- Vite build passes (1951 modules, up from 1949)

---

## 2026-06-03 — Auction Module V2 + Bug Fixes

**Phase**: Implementation
**Objective**: Replace old auction prototype with mobile-first Auction Room — live Realtime bidding, activity feed, participant management, comprehensive test seed.

### DB Migration (`20260603_auction_v2.sql`)
- Created 6 tables: `auctions_v2`, `auction_items_v2`, `auction_participants_v2`, `auction_bids_v2`, `auction_activity_v2`, `auction_deposits_v2`
- Created `auctions.manage` capability, `app.auction_participant_status` composite type
- Created 7 governed RPCs: `get_governed_auctions`, `get_governed_auction_detail`, `governed_request_auction_participation`, `governed_approve_participation`, `governed_reject_participation`, `governed_place_bid`, `governed_purchase_now`
- Realtime publications for bids, activity, and participants

### Bug Fixes
1. **400 Bad Request on `get_governed_auctions`**: REST API cannot pass `null` as UUID param → conditional call with no `p_token` when token is null
2. **`v_session.id` → `v_session.token`**: `app.sessions` composite type has no `id` column — fixed in both `get_governed_auctions` and `get_governed_auction_detail`

### Frontend
- `AuctionsPage.tsx` — mobile-first room list with navy/gold hero, horizontal scroll for live auctions with countdown, vertical list for past auctions
- `AuctionDetailPage.tsx` — full Auction Room: sticky top bar, hero image with gradient overlay, live status card (price + countdown), leader banner, participation request, metrics grid, bidding panel with `BID_TOO_LOW` validation, tab system (Activity/Bids/Items), bottom sticky CTA bar
- `BusinessShortcuts.tsx` — المزاد → `/auctions`
- Routes: unauthenticated access for viewing, bids/purchase require auth

### Test Seed (`20260603_auction_v2_seed.sql`)
- 7 participants (5 approved, 1 pending, 1 rejected)
- 6 bids (150000→152000), 20 activity entries
- Current leader: شركة النور للتوزيع at 152,000 EGP
- Auction end: UTC+2 +20h (Cairo time)

### Validation
- `tsc --noEmit` 0 errors, `vite build` 1949 modules

---

## 2026-06-03 — Daily Deals Module (صفقة اليوم)

**Phase**: Daily Deal Implementation
**Objective**: Implement Daily Deal as a dedicated commercial package with governed CRUD, storefront visibility, cart/order integration, and inventory deduction.

### Implementation Details

**Database:**
- Created `daily_deals` table with status ENUM (draft, scheduled, active, sold_out, expired, cancelled)
- Created `daily_deal_items` table linking deals to products with quantities
- Created `order_daily_deals` table linking deals to orders with price snapshots
- Added `deals.manage` capability

**Backend RPCs (7 new, 1 modified):**
- `get_governed_daily_deals` — list all deals with items (governed)
- `get_governed_active_daily_deals` — public list of active/expired/sold_out deals for storefront
- `governed_create_daily_deal` — create new deal with items (requires `deals.manage`)
- `governed_update_daily_deal` — update draft/scheduled deal fields
- `governed_activate_daily_deal` — activate draft/scheduled deal
- `governed_cancel_daily_deal` — cancel active deal
- `governed_add_order_daily_deals` — link deals to an order at submission
- `get_governed_order_daily_deals` — get deals linked to an order
- `governed_approve_order` — **modified** to deduct daily deal quantity and component product inventory

**Business Rules Enforced:**
- Deals are separate from normal products (different cart item type)
- Deals coexist with normal products in the same order
- Deal value contributes to invoice total
- Deal value does NOT contribute to tier minimum target
- Deal value does NOT receive tier discounts
- Deal quantity decreases by 1 per purchase
- Component product inventory deducted on order approval
- Expired deals show "انتهى العرض"
- Sold out deals show "نفدت الكمية"
- Purchase disabled when expired or sold out

**Frontend:**
- `BusinessShortcuts` — "صفقة اليوم" now navigates to `/daily-deals`
- `DailyDealsPage` — storefront listing with status badges, item breakdown, purchase button
- `DailyDealDetailPage` — full deal detail with add-to-cart
- `DailyDealsManagementPage` — admin CRUD with activate/cancel actions (requires `deals.manage`)
- Cart store updated with `dealItems` array, `addDeal`/`removeDeal` methods
- `CartPage` shows deal items in amber cards
- `CartSummary` shows deal total as separate line
- `OrderReviewPage` shows deal items and submits them via `governed_add_order_daily_deals`
- Pricing engine computes `dealTotal` and `productSubtotal` separately
- Client-side `meetsTierMinimum` check uses product subtotal only (deals excluded)

**Test Deal:**
- Automated seed: "صفقة اليوم التجريبية", 200000 EGP, qty 20, active for 30 days
- Composed of shampoo + hair dye products found in DB

### Validation
- `tsc --noEmit` passes clean
- Vite build passes (1941 modules)

**Files modified:**
- `SYSTEM_BLUEPRINT.md` — added Daily Deal Business Rules section
- `PROJECT_CHANGELOG.md` — this entry
- `src/types/storefront.ts` — added `DailyDealRecord`, `DailyDealItem`, `CartDealItem`, `OrderDailyDeal`, extended `CartTotals` and `CartItem`
- `src/engine/pricing.ts` — `computeCartTotals` accepts dealItems, computes `dealTotal`/`productSubtotal`
- `src/store/cart.ts` — added `dealItems` state, `addDeal`/`removeDeal`/`getDealItems` methods, updated `getTotals` and `clearCart`
- `src/services/index.ts` — exported `dailyDealService`
- `src/hooks/useCapability.ts` — added `deals.manage` to `SUPER_CAPABILITIES`
- `src/routes/index.tsx` — added `/daily-deals`, `/daily-deals/:id`, `/daily-deals/manage` routes
- `src/components/storefront/BusinessShortcuts.tsx` — added `onClick` for "صفقة اليوم", cursor-pointer
- `src/components/storefront/CartSummary.tsx` — shows deal total line
- `src/pages/storefront/CartPage.tsx` — shows deal items with remove button, updated empty cart check
- `src/pages/storefront/OrderReviewPage.tsx` — shows deal items, submits via `governed_add_order_daily_deals`

**Files created:**
- `supabase/migrations/20260603_daily_deals.sql` — tables, ENUM, capabilities, 8 RPCs, modified `governed_approve_order`, test deal seed
- `src/services/dailyDeals.ts` — frontend service for all daily deal RPCs
- `src/pages/daily-deals/DailyDealsPage.tsx` — storefront listing
- `src/pages/daily-deals/DailyDealDetailPage.tsx` — detail + add-to-cart
- `src/pages/daily-deals/DailyDealsManagementPage.tsx` — admin CRUD
- `src/pages/daily-deals/index.ts` — barrel exports

---

## 2026-06-01 — Mobile-First UI Blocking Fixes

**Phase**: UI Fix
**Objective**: Fix blocking issues identified in RUNTIME_UI_REVIEW_REPORT — no new features, no DB changes

### Fix 1 — DashboardPage Routing
- Added role-based routing: checks `user.roles` for `warehouse`, `transport`/`delivery`, and `sales` keywords
- SalesDashboard and TransportDashboard are now routed to appropriate roles (previously everyone except WRQ1001 saw ManagementDashboard)
- Removed dead `employeeCode` variable

### Fix 2 — OrderEditPage Real Data
- Replaced hardcoded mock items with live data from `order_items` table
- Loads order items on mount via `supabase.from('order_items').select('*, products(product_name)')`
- Quantities are locally editable via state; unit price derived from `total_price / unit_quantity`
- Page is now functional for real order editing

### Fix 3 — VisitsPage Customer Name
- Changed `visit.customer_id` display to `visit.customer_name || visit.customer_id`
- Falls back to UUID if the RPC does not return a resolved customer name

### Fix 4 — WarehousePage Mobile-First Conversion
- Replaced all `<table>` elements with card-based layout (`<div className="space-y-2">`)
- Each prep record is now a full-width card with vertically stacked info + action buttons
- Changed `p-6` to `px-4 pb-24` to match AppLayout padding and clear bottom nav
- Changed title from `text-2xl` to `text-lg font-bold` to match other pages
- Tab bar uses pill-style buttons (consistent with Credit/Delivery pages)
- Action buttons use `flex-1` + `rounded-xl` + `py-2.5` for proper 40px+ touch targets
- Dialogs use `w-full max-w-sm` and `px-4` for proper mobile sizing
- Message banner uses `flex` layout instead of `float-start`
- Input fields use consistent `border border-border rounded-lg px-3 py-2.5 text-sm`

### Fix 5 — WarehouseReviewPage Mobile-First Conversion
- Same table-to-card conversion as WarehousePage
- Replaced `<table>` with card-based layout
- Added `pb-24` to clear bottom nav
- Added missing `notes.trim()` validation for `handleReturnToPrep` (REASON_REQUIRED DB enforcement)

### Validation
- `tsc --noEmit` passes clean

**Files modified:**
- `src/pages/dashboard/DashboardPage.tsx`
- `src/pages/orders/OrderEditPage.tsx`
- `src/pages/visits/VisitsPage.tsx`
- `src/pages/warehouse/WarehousePage.tsx`
- `src/pages/warehouse/WarehouseReviewPage.tsx`
- `PROJECT_CHANGELOG.md`, `SYSTEM_BLUEPRINT.md`

---

## 2026-06-01 — Warehouse Runtime Phase 3

**Phase**: Implementation
**Objective**: Implement warehouse exception handling — exception recording, fail workflow, enhanced return workflow, exception queue

### DB Changes
- Created `preparation_exception_type` enum: missing_quantity, missing_product, damaged_product, incomplete_order, other
- Created `preparation_exceptions` table: id, preparation_id (FK CASCADE), exception_type, notes, created_by, created_at

### New Functions (3)
- `governed_fail_preparation(p_token, p_preparation_id, p_failure_reason, p_notes)` — marks prep as failed, reverts order to `approved`, records order_status_history (AD-012/013)
- `governed_record_exception(p_token, p_preparation_id, p_exception_type, p_notes)` — records individual exception with type validation via enum
- `governed_return_to_preparation` — enhanced: p_notes required (REASON_REQUIRED if empty); uses scalar variables (fixed ROWTYPE null field bug)

### Frontend Changes
- `WarehousePage.tsx` — added `exceptions` tab showing failed preps; added "فشل" (Fail) action with reason dialog for in_progress records; added "استثناء" (Exception) action with type selector dialog
- `WarehousePrepDetail.tsx` — added exceptions section showing all recorded exceptions; added inline exception recording form for active preps

### Audit Trail (AD-012) Validation
- Exception: exception_type, notes, created_by, created_at all stored in `preparation_exceptions`
- Fail: failure_reason stored, cancelled_by/at set, order_status_history records preparing→approved
- Return: reason required (REASON_REQUIRED), notes updated with return reason

### Operational History (AD-013) Validation
- `order_status_history` records fail events: `preparing/approved → approved` with failure reason
- `preparation_exceptions` records all exception events
- `order_modification_history` remains untouched (0 entries)

### Fixes
- Used scalar `v_prep_status`/`v_order_id` variables throughout Phase 3 functions (avoided ROWTYPE null field bug)
- `governed_return_to_preparation` parameter changed from `DEFAULT NULL` to required `text` (requires drop + recreate due to PostgreSQL restriction on removing defaults)

**Files created**: None (existing files updated)

**Files modified**:
- `src/pages/warehouse/WarehousePage.tsx` — exception tab, fail/exception actions
- `src/pages/warehouse/WarehousePrepDetail.tsx` — exception display + recording form
- `SYSTEM_BLUEPRINT.md`, `PROJECT_CHANGELOG.md` — updated

**Database impact**: 1 new enum, 1 new table, 2 new functions, 1 function replaced
**Governance impact**: fail_preparation uses `warehouse.prepare` capability; record_exception uses `warehouse.prepare` capability; return_to_preparation uses same review authority

---

## 2026-06-01 — Warehouse Runtime Phase 2

**Phase**: Implementation
**Objective**: Build operational warehouse workspace screens — operations, review, detail, dashboard

### New DB Function
- `governed_return_to_preparation(p_token, p_preparation_id, p_notes)` — reviewer action: returns completed prep to `in_progress`, clears completed_by/at; review authority only

### Frontend Pages (3)
- `WarehousePage.tsx` — Rewritten with 5-tab operations screen: Waiting Preparation (Start), In Progress (Complete/Cancel), Completed, Review Queue (Approve/Return/Details), Reviewed
- `WarehouseReviewPage.tsx` — Dedicated review screen for authorized reviewers with Approve/Return actions
- `WarehousePrepDetail.tsx` — Detail screen showing Order/Customer/Owner/Preparation info + Operational History + Modification History

### Routes Added
- `/warehouse/review` — WarehouseReviewPage
- `/warehouse/prep/:id` — WarehousePrepDetail

### Dashboard
- WarehouseDashboard counters already match real workflow (5 counters from `get_dashboard_warehouse`)

### Fixes
- Added `code` to `SessionUser` interface + populated on login/session restore (fixes WRQ1001 routing to WarehouseDashboard)
- Fixed DashboardPage.tsx: WarehouseDashboard named→default import; user.code routing works
- Used scalar `v_status` variable in `governed_return_to_preparation` (avoided ROWTYPE null field bug)

### Validation
- TypeScript: `tsc --noEmit` passes clean
- `governed_return_to_preparation`: ✅ correctly returns in_progress from completed; ✅ correctly returns INVALID_STATUS for non-completed records
- Dashboard counters: prepared_today=3, ready_for_delivery=3, in_preparation=0 (correct for current data state)

**Files created**:
- `src/pages/warehouse/WarehouseReviewPage.tsx`
- `src/pages/warehouse/WarehousePrepDetail.tsx`

**Files modified**:
- `src/pages/warehouse/WarehousePage.tsx` — rewritten with 5 tabs + review actions
- `src/pages/warehouse/index.tsx` — added exports
- `src/routes/index.tsx` — added 2 new routes
- `src/store/auth.ts` — added `code` to SessionUser
- `src/services/auth.ts` — added `code` to SessionResult
- `src/pages/dashboard/DashboardPage.tsx` — fixed import
- `SYSTEM_BLUEPRINT.md`, `PROJECT_CHANGELOG.md` — updated

**Database impact**: 1 new SECURITY DEFINER function
**Governance impact**: Same review authority as governed_review_preparation

---

## 2026-06-01 — Warehouse Runtime Phase 1

**Phase**: Implementation
**Objective**: Implement warehouse preparation lifecycle — queue, dashboard, analytics, audit trail, governance

### DB Changes
- Created `preparation_status` enum: in_progress, completed, reviewed, failed
- Created `preparation_records` table (id, order_id UNIQUE FK, status, started_by/at, completed_by/at, reviewed_by/at, cancelled_by/at, notes, created_at, updated_at)
- Created `warehouse.prepare` capability; assigned to Warehouse Preparation Manager, SUPER_ADMIN, CHAIRMAN, ADMIN

### Functions (8 total)
- Start/Complete/Review/Cancel: governed_start_preparation, governed_complete_preparation, governed_review_preparation, governed_cancel_preparation
- Queue: get_governed_preparation_queue, get_governed_waiting_preparations
- Dashboard: get_dashboard_warehouse (replaced — 5 counters: waiting/in_progress/ready_for_delivery/prepared_today/delayed)
- Analytics: get_warehouse_analytics (prepared_today, avg_prep_time, queue_size)

### Frontend Pages
- `WarehousePage.tsx` — preparation queue with tabs (waiting/in_progress/completed/reviewed), action buttons
- `WarehouseDashboard.tsx` — 5 real-time counters with governance

### Lifecycle
`approved` → `preparing` (order_status_history) → in_progress → completed → reviewed → ready for delivery runtime

### Validation
- Full lifecycle tested: Start → Complete → Review → Cancel (all 4 paths)
- Audit trail (AD-012) validated: entity_id, previous_status, new_status, performed_by, performed_at, notes all recorded
- Operational history (AD-013) validated: order_status_history records approved→preparing transition
- order_id uniqueness enforced (ALREADY_IN_PREPARATION)
- Review does NOT trigger shipping/order status change (stays at 'preparing')
- Dashboard counters correct with admin token (prepared_today=2, waiting=2, ready=2)
- `order_modification_history` remains intact (0 entries, unchanged)
- Functions use scalar employee_id variables (fixed composite type issue)

**Files affected**:
- New: `src/pages/warehouse/WarehousePage.tsx`, `index.tsx`
- New: `src/pages/dashboard/WarehouseDashboard.tsx`
- Modified: `src/pages/dashboard/DashboardPage.tsx`, `src/routes/index.tsx`
- Modified: `SYSTEM_BLUEPRINT.md`, `PROJECT_CHANGELOG.md`

**Database impact**: 1 new enum, 1 new table, 1 new capability
**Governance impact**: `warehouse.prepare` capability mapped; review authority by employee code (6 reviewers)
**Issues resolved**:
- Composite type `v_session` produced null employee_id → migrated to scalar `v_employee_id`
- PowerShell dollar-quoting broke function creation → used Node.js scripts
- `company_name` type mismatch (varchar(255) vs text) → explicit `::text` cast in queue functions
- `v_order_status` not checked for `approved` → added INVALID_ORDER_STATUS guard
- `orders.status` not updated on start → added `UPDATE orders SET status = 'preparing'`

---

## 2026-06-01 — Delivery & Collection Runtime

**Phase**: Implementation
**Objective**: Complete the operational cycle — delivery tracking, assignment, lifecycle, fail workflow, collection follow-up

### DB Changes
- Created `delivery_tracking` table (uuid, order_id FK, status, assigned_to/by, timestamps, failure info)
- Created 3 new capabilities: delivery.dispatch, delivery.deliver, delivery.view
- Assigned to Transportation Manager, SUPER_ADMIN/CHAIRMAN/ADMIN, EXECUTIVE_MANAGER, Sales Manager; delivery.view to all roles

### Functions (9 new + 1 replacement)
- Delivery: governed_dispatch_order, governed_assign_delivery, governed_start_delivery, governed_complete_delivery, governed_fail_delivery, governed_return_delivery, get_governed_deliveries, get_delivery_dashboard_stats, governed_get_delivery
- Collection: get_collection_followup_queue
- Replaced: get_dashboard_transport (expanded from 4 to 8 counters)

### Frontend Pages
- `DeliveryPage.tsx` — queue with status filters, assign/start actions (/delivery)
- `DeliveryDetailPage.tsx` — start/complete/fail/return (/delivery/:id)
- `CollectionFollowupPage.tsx` — pending/overdue queue (/collections/followup)
- `TransportDashboard.tsx` — expanded to 8 counters

### Lifecycle
approved → dispatched (delivery_tracking created) → assigned → out_for_delivery → delivered/failed/returned

### Validation
- Full lifecycle tested: dispatch → start → complete (order updated to delivered, delivered_at set)
- Dashboard counters: delivered_today=1, ready_delivery=3, collection_queue=6
- Governance enforced via check_capability() + subtree visibility
- Failed delivery and return-to-warehouse paths verified

**Files affected**:
- New: `src/pages/delivery/DeliveryPage.tsx`, `DeliveryDetailPage.tsx`, `CollectionFollowupPage.tsx`, `index.tsx`
- Modified: `src/pages/dashboard/TransportDashboard.tsx`, `src/routes/index.tsx`
- Modified: `SYSTEM_BLUEPRINT.md`, `PROJECT_CHANGELOG.md`

**Database impact**: 1 new table, 3 capabilities
**Governance impact**: 3 delivery capabilities mapped to Transportation Manager + admin roles
**Notes**: Delivery Tracking moved from "blocked — no migration" to completed; uses existing order status values (dispatched, delivered) already in check constraint

---

## 2026-06-01 — Warehouse Runtime Phase 0 Planning

**Phase**: Planning
**Objective**: Design complete Warehouse Runtime — preparation lifecycle, queue, dashboard, exceptions, analytics
**Result**: 10-section plan delivered covering workflow, roles, lifecycle, dashboard, queue, inventory, exceptions, analytics, entities, implementation phases

**Key decisions**:
- Preparation state stored in separate `preparation_records` table (not order status) per AD-007/AD-009
- 4 new tables + 1 enum + 2 capabilities needed
- Existing warehouse dashboard proxy mappings are broken and must be fixed in Phase 1
- بسام (WRQ1001) remains sole warehouse operator; new `warehouse.prepare` capability scoped to him
- FIFO queue (no priority in MVP); customer-level priority deferred

**Files affected**:
- Modified: `SYSTEM_BLUEPRINT.md` — added Warehouse Runtime section, fixed proxy status mappings table, updated pending phases
- Modified: `PROJECT_CHANGELOG.md` — this entry

**Database impact**: None (planning only)
**Governance impact**: 2 new capabilities proposed (warehouse.prepare, warehouse.resolve_shortage)

---

## 2026-06-01 — Credit Workflow Phase 1 Foundation

**Phase**: Foundation
**Objective**: Implement credit workflow foundation — programs, applications, contracts, approval, dashboard, follow-up queue
**Result**: Full credit workflow operational with 7-state state machine, 19 governed functions, 4 frontend pages, dashboard widget

### DB Changes
- Created `credit_application_status` enum
- Created `credit_programs`, `credit_applications`, `credit_contracts`, `credit_contract_templates` tables
- Seeded Program A (150k/15d) and Program B (300k/30d)
- Seeded default contract template
- Created 9 new capabilities (credit.*)
- Created CREDIT_APPROVER role; assigned to WRQ1003 (محمد سعيد) + WRQ1006 (ياسر توفيق)
- Assigned capabilities to all relevant roles

### Functions (19 total)
- Program CRUD: governed_get_credit_programs, governed_create_credit_program, governed_update_credit_program, governed_toggle_credit_program
- Application lifecycle: governed_create_credit_application, governed_submit_credit_application, governed_confirm_documents, governed_review_credit, governed_approve_credit, governed_reject_credit, governed_suspend_credit, governed_reactivate_credit
- Contract: governed_sign_contract, governed_get_contract_by_application, governed_get_contract_template, governed_update_contract_template
- Views: get_governed_credit_applications, get_governed_credit_application, get_credit_dashboard_stats

### Frontend Pages
- `CreditProgramsPage.tsx` — admin CRUD for programs (/credit/programs)
- `CreditApplicationsPage.tsx` — employee follow-up queue with status filters (/credit/applications)
- `CreditReviewPage.tsx` — single application detail + actions (/credit/applications/:id)
- `CustomerCreditPage.tsx` — customer view + submit application (/customer/credit)

### Dashboard
- Added credit stats widget to ManagementDashboard showing: new, under_review, docs_pending, approved, rejected, suspended
- "عرض الكل" link to follow-up queue; "إدارة برامج الائتمان" link to program management

### Validation
- Full workflow tested end-to-end: draft → submitted → documents_received → approved → suspended → reactivated → contract signed
- Customer credit_limit/credit_days updated on approval (150,000/15 from Program A)
- Dashboard stats show correct counts
- Governance enforced via check_capability()

**Files affected**:
- New: `src/pages/credit/CreditProgramsPage.tsx`, `CreditApplicationsPage.tsx`, `CreditReviewPage.tsx`, `CustomerCreditPage.tsx`, `index.tsx`
- Modified: `src/pages/dashboard/ManagementDashboard.tsx`, `src/routes/index.tsx`
- Modified: `SYSTEM_BLUEPRINT.md`, `PROJECT_CHANGELOG.md`

**Database impact**: 4 new tables, 1 enum, 9 capabilities, 1 role
**Governance impact**: CREDIT_APPROVER role + 9 credit capabilities mapped to roles
**Notes**: Approved by business decisions: no document uploads, no PDF generation, credit based on programs, 2-person final approval

---

## 2026-06-01 — Execution Efficiency Rule

**Phase**: Process — Execution Efficiency
**Objective**: Record execution efficiency rule for task completion output
**Result**: SYSTEM_BLUEPRINT.md updated with Execution Efficiency subsection under Documentation Governance

**Change**: Completed tasks return `Completed | Blocked | Required Decision` only. No audits, scans, or extended reports unless requested.

---

## 2026-06-01 — Project Memory Enhancement

**Phase**: Project Memory Enhancement
**Objective**: Add ACTIVE_TARGETS section, repository protection rule, session startup workflow
**Result**: SYSTEM_BLUEPRINT.md updated with 3 new subsections; future execution target ambiguity eliminated

**Files affected**:
- Modified: `SYSTEM_BLUEPRINT.md` — added ACTIVE_TARGETS, Repository Protection Rule, Session Startup Workflow
- Modified: `PROJECT_CHANGELOG.md` — this entry

**Database impact**: None
**Governance impact**: None
**Notes**: Session startup workflow requires reading BLUEPRINT and CHANGELOG before any implementation task; no repository-wide audit without explicit request

---

## 2026-06-01 — Repository Hygiene & Release Structure

**Phase**: Repository Finalization
**Objective**: Clean production/workspace separation, create project memory system
**Result**: Repository simplified to 3 top-level items (ahram-distribution, workspace, release-removed), SYSTEM_BLUEPRINT.md and PROJECT_CHANGELOG.md created, documentation governance rule established

**Files affected**:
- Added: `SYSTEM_BLUEPRINT.md`, `PROJECT_CHANGELOG.md`
- Moved: 11 `.md` reports → `workspace/reports/`
- Moved: 4 stale duplicate dirs → `workspace/archives/`
- Moved: `explore_supabase.mjs`, `alahram.txt` → `workspace/tools/`
- Removed: `release/` (permanent release removed — on-demand only)
- Note: `scripts/` (53 `.cjs` dev tools) and `import_workspace/` lost during move due to PowerShell `-LiteralPath` + wildcard incompatibility

**Database impact**: None
**Governance impact**: None
**Notes**: Documentation governance rule added — all future tasks must update SYSTEM_BLUEPRINT.md and PROJECT_CHANGELOG.md before completion

---

## 2026-06-01 — Operational Runtime Fixes

**Phase**: Validation — Runtime Fixes
**Objective**: Fix all counters identified in RUNTIME_VALIDATION_REPORT
**Result**: 15 functions redeployed, 6/6 success criteria met, zero remaining failed counters

**Fixes applied**:
1. Warehouse Dashboard — added `AND owner_id = ANY(v_visible)` to all 3 counters (SALES_REP now sees 0/1/4 vs 4/6/31 before)
2. Transport Dashboard — added governance filtering to all 4 counters (SALES_REP now sees 0/4/5/0 vs 4/35/38/6 before)
3. CHAIRMAN visibility — added SUPER_ADMIN/CHAIRMAN/ADMIN capability check; CHAIRMAN now sees 41 orders/25 customers (was 1/1)
4. ADMIN visibility — same check; ADMIN now sees 41/25 (was subtree-limited)
5. `get_dashboard_sales` — added `DEFAULT 30` to `p_inactive_days` parameter
6. Arabic names → codes — replaced `WHERE full_name = '...'` with `WHERE code = 'WRQ1002'/'WRQ1004'` in all 15 functions

**Functions redeployed** (15):
- `get_visible_employee_ids`
- `get_governed_orders`, `get_governed_order`
- `get_governed_customers`, `get_governed_customer`
- `get_governed_visits`, `get_governed_visit`
- `get_governed_collections`
- `get_governed_returns`, `get_governed_return`, `get_governed_return_items`
- `get_dashboard_sales`, `get_dashboard_warehouse`, `get_dashboard_transport`, `get_dashboard_management`

**Validation**:
- SUPER_ADMIN (WRQ1006): 41 orders, 25 customers, all dashboards full count ✅
- CHAIRMAN (WRQ1003): 41 orders, 25 customers ✅ (was 1/1 — fixed)
- ADMIN (ADMIN-001): 41 orders, 25 customers ✅ (was limited — fixed)
- SALES_REP (REP002): 5 orders, 4 customers ✅ (properly scoped)

**Database impact**: 15 `CREATE OR REPLACE FUNCTION` on public schema
**Governance impact**: Capability-aware visibility added; warehouse/transport now governed

---

## 2026-06-01 — Operational Dashboards & Frontend Pages

**Phase**: Operational Runtime Foundation
**Objective**: Create dashboard frontend pages with drill-down navigation from counters
**Result**: 4 dashboard TSX pages created, URL-param filtered list pages, CustomersPage, fixed remaining direct reads

**Files created**:
- `src/pages/dashboard/SalesDashboard.tsx` — 5 sales counters
- `src/pages/dashboard/WarehouseDashboard.tsx` — 3 warehouse counters
- `src/pages/dashboard/TransportDashboard.tsx` — 4 transport counters
- `src/pages/dashboard/ManagementDashboard.tsx` — 9 management counters
- `src/pages/customers/CustomersPage.tsx` — governed customer list with `?filter=inactive`

**Files modified**:
- `src/pages/dashboard/DashboardPage.tsx` — simplified role-aware router
- `src/pages/orders/OrdersPage.tsx` — fixed direct reads → governed RPC, added URL-param filtering
- `src/pages/visits/VisitsPage.tsx` — added URL-param filtering
- `src/pages/collections/CollectionsPage.tsx` — fixed direct reads → governed RPC, added filtering
- `src/pages/returns/ReturnsPage.tsx` — added URL-param filtering
- `src/routes/index.tsx` — added `/customers` route
- `src/pages/orders/OrderDetailPage.tsx` — fixed direct reads → governed RPC
- `src/pages/account/AccountPage.tsx` — fixed direct reads → governed RPC

**Filters supported**: `?filter=today|pending|approved|active|preparing|delivering|undelivered`

**Database impact**: None (uses existing `get_dashboard_*` and `get_governed_*` functions)
**Governance impact**: All remaining direct `supabase.from().select()` calls replaced with governed RPCs

---

## 2026-06-01 — Dashboard DB Functions

**Phase**: Operational Runtime Foundation — DB Layer
**Objective**: Create dashboard counter functions for 4 operational areas
**Result**: `get_dashboard_sales`, `get_dashboard_warehouse`, `get_dashboard_transport`, `get_dashboard_management` created

**Database impact**: 4 new SECURITY DEFINER functions on public schema
**Governance impact**: Dashboard functions use inline CTE visibility (same pattern as governed reads)

**Note**: Warehouse/Transport dashboards initially deployed WITHOUT governance filtering — fixed in next phase

---

## 2026-06-01 — Shared Management Model

**Phase**: Organization — Shared Management
**Objective**: Implement shared management unit for علي سعيد (WRQ1002) and محمود سعيد (WRQ1004) under محمد سعيد (WRQ1003)
**Result**: Both executives see full subtree under their shared manager; validated identical visibility

**Decisions**:
- Chairman (WRQ1003 محمد سعيد) granted CHAIRMAN role = SUPER_ADMIN (39 identical caps)
- Transportation Manager (REP-001 محمد عبد الباسط) got `customers.create` + `collections.read`
- Warehouse Prep Manager (WRQ1001 بسام) got `customers.read` + `reports.read` removed (now 5 caps: inventory, orders, products)

**Database impact**: Role-capability mapping adjustments
**Governance impact**: Shared scope via hardcoded name lookup (later migrated to code-based)

---

## 2026-06-01 — Organization Structure Report

**Phase**: Analysis — Organization
**Objective**: Map employee hierarchy, roles, capabilities
**Result**: 16 employees across 4 org levels; 23 roles, 39 capabilities, 318 mappings documented; ORG_CHART delivered

---

## 2026-06-01 — Governance Closure

**Phase**: Governance — Validation & Closure
**Objective**: Validate all 4 roles (SUPER_ADMIN, SALES_MANAGER, SALES_REP, CUSTOMER) against governed reads, writes, and approval actions
**Result**: All pass. Ownership enforcement validated (SALES_MANAGER blocked outside scope), approval enforcement validated (SALES_REP blocked without `orders.approve`)

---

## 2026-06-01 — Governance Fix: Customer & Order Single-Record

**Phase**: Governance — Fix
**Objective**: Fix `get_governed_customer` and `get_governed_order` single-record functions with proper ownership enforcement
**Result**: Both functions now check `owner_id = ANY(v_visible)` and raise FORBIDDEN if unauthorized

---

## 2026-06-01 — Governance Phase 2: Write Enforcement

**Phase**: Governance — Write Enforcement
**Objective**: Create CRUD + approval governed write functions for all 5 entities (Customers, Orders, Collections, Returns, Visits)
**Result**: 20 governed write functions created; each validates capability, ownership scope, and populates audit tables

**Functions created**:
- `governed_create_customer`, `governed_update_customer`, `governed_delete_customer`
- `governed_create_order`, `governed_update_order`, `governed_delete_order`, `governed_approve_order`
- `governed_create_collection`, `governed_update_collection`, `governed_delete_collection`
- `governed_create_return`, `governed_update_return`, `governed_delete_return`, `governed_approve_return`
- `governed_create_visit`, `governed_update_visit`, `governed_delete_visit`
- (plus item-level: add/remove order item, add/remove return item)

**Audit tables populated**: `order_status_history`, `order_modification_history`, `customer_ownership_history`

---

## 2026-06-01 — Governance Phase 1: Visibility (Inline CTE Fix)

**Phase**: Governance — Visibility
**Objective**: Fix SETOF uuid type issue with inline CTE + array_agg() + ANY() pattern
**Result**: All `get_governed_*` list/single functions working; `get_visible_employee_ids()` returns uuid[] for clean ANY() usage

**Root cause**: PostgreSQL cannot use `IN (SELECT * FROM setof_returning_function())` — inline CTE with `array_agg()` bypasses this

---

## 2026-06-01 — Schema Foundation & Auth

**Phase**: Foundation
**Objective**: Create base schema, auth infrastructure, and initial frontend
**Result**: All migrations applied, custom auth working (login/logout/session), ProtectedRoute and useAuth hook

**Migrations**:
- `000_schema.sql` — Base types and tables
- `20260531_phase1_identity_governance.sql` — Initial identity/governance DDL
- Phases 2–10: Customers, Orders, Collections, Returns, Visits, Packages, Auctions, Pricing

**Auth**: `public.login()`, `public.logout()`, `public.validate_session()`, `app.sessions` table, session persistence

**Frontend**: React 19 + Vite 8 + TypeScript 6 + Tailwind CSS v4 + React Router v7 + Zustand

---

## 2026-06-01 — Customer Analytics Phase 2: Frontend

**Phase**: Customer Analytics — Frontend
**Objective**: Build analytics frontend consuming Phase 1 DB functions
**Result**: 2 analytics pages created, routes registered, dashboard link added, tsc passes

**Files created**:
- `src/pages/analytics/AnalyticsListPage.tsx` — ranked customer list with 4 tabs (all/priority/inactive/lost), follow-up priority queue, risk flags
- `src/pages/analytics/CustomerAnalyticsPage.tsx` — full customer intelligence card with purchase/visit/credit summaries, risk/behavior indicators, products (top/repeated/stopped), brand breakdown with share % bars

**Files modified**:
- `src/routes/index.tsx` — added `/customers/:id/analytics` and `/analytics/customers` routes
- `src/pages/customers/CustomersPage.tsx` — added "تحليلات" button linking to analytics list
- `src/pages/dashboard/ManagementDashboard.tsx` — added "تحليلات العملاء" button
- `SYSTEM_BLUEPRINT.md` — added routes, completed phases
- `PROJECT_CHANGELOG.md` — this entry

**Consumed functions**: `get_customer_analytics_list`, `get_customer_sales_ranking`, `get_customer_card`, `get_customer_products`, `get_customer_brands`
**Governance validation**: Uses existing `p_token` pattern — governance inherited from DB layer
**TypeScript**: `tsc --noEmit` passes clean

---

## 2026-06-01 — Customer Analytics Phase 1: DB Layer

**Phase**: Customer Analytics — DB Layer
**Objective**: Deploy 6 PostgREST-accessible analytics functions for customer insights
**Result**: All 6 functions deployed and validated across 3 roles (ADMIN: 25 customers, SALES_SUPERVISOR: 19, CUSTOMER: 1)

**Functions created**:
- `get_visible_customer_ids(p_token uuid)` — returns SETOF uuid; customer can see self, employees see their subtree
- `get_customer_card(p_token uuid, p_customer_id uuid)` — returns json; full 360° view (purchase/visit/credit summary, risk indicators, expected next order, potential revenue)
- `get_customer_analytics_list(p_token uuid)` — returns TABLE; ranked list of visible customers with purchase stats, risk flags, revenue scores
- `get_customer_products(p_token uuid, p_customer_id uuid)` — returns json; top/repeated/stopped products for a customer
- `get_customer_brands(p_token uuid, p_customer_id uuid)` — returns json; brand breakdown with share % and trend
- `get_customer_sales_ranking(p_token uuid)` — returns TABLE; customer ranking (global + per-rep) with followup priority score

**Issues encountered & fixed**:
1. **Schema mismatch**: `customers` table has no `type` column → removed from outputs; no `balance` column → computed as `total_ordered - total_collected`
2. **Management API quoting**: Initial `$F$` dollar-quoting failed due to template literal `${S}` evaluation in JS → switched to string concatenation with `$$`
3. **PostgREST schema cache**: After function creation, `NOTIFY pgrst, 'reload schema'` required before RPC calls work
4. **Ambiguous column references**: PL/pgSQL record variable (`v_session`) fields conflicted with SQL column names → switched to scalar variables (`v_identity_type`, `v_identity_id`, `v_employee_id`)
5. **`SELECT DISTINCT ON` ordering**: `DISTINCT ON (p.id)` requires ORDER BY starting with `p.id` → replaced with GROUP BY subquery pattern

**Database impact**: 6 new SECURITY DEFINER functions on public schema (2 replaced after return-type changes)
**Governance impact**: All functions visibility-filtered by session identity type and owner subtree; customer role restricted to self

---

## 2026-06-01 — Product Availability Enforcement

**Phase**: Runtime — Product Availability
**Objective**: Enforce sellability rules based on unit pricing (no migration required)
**Result**: 4-layer availability validation implemented across storefront, cart, and checkout

**Business rule**: A product is sellable only if at least one sellable unit has a valid selling price > 0. Prices derived from `products.carton_price` + `products.carton_quantity` (carton = carton_price, piece = carton_price / carton_quantity, dozen = piece × 12).

**Issues fixed**:
1. `mapProduct()` in StorefrontPage queried non-existent `product_prices` table and non-existent columns (`is_base_unit`, `unit_code`, `is_sellable`, `units_per_parent`) — all prices were 0, all products showed "نفذت الكمية"
2. Supabase SELECT query referenced tables/columns that don't exist in the database schema

**Changes**:
- `src/pages/storefront/StorefrontPage.tsx` — `mapProduct()` now derives unit prices from `carton_price` and `carton_quantity` only; Supabase query simplified to existing columns; `salesBlocked` derived from `unitPrices.length === 0`
- `src/components/storefront/ProductCard.tsx` — added `useEffect` to reset selected unit when availability changes; added `hasNoPrice` state for "غير متوفر حالياً" vs "نفذت الكمية" distinction; dropdown only shows units with valid prices
- `src/store/cart.ts` — `addItem()` now checks both product-level `salesBlocked` and per-unit availability before adding
- `src/pages/storefront/CartPage.tsx` — `handleContinue` validates per-item unit availability, not just product-level block
- `src/pages/checkout/CheckoutPage.tsx` — `handleSubmit` validates all items against current product availability before submission

**Validation coverage**:
- No priced units → "غير متوفر حالياً", add-to-cart blocked, unit dropdown hidden ✅
- One priced unit → only that unit selectable, others not in dropdown ✅
- Mixed availability → each unit type independently validated ✅
- Add-to-cart prevention → per-unit check in store ✅
- Checkout prevention → pre-submit validation ✅

**Database impact**: None (uses existing `products.carton_price` and `products.carton_quantity` columns)
**Governance impact**: None
**TypeScript**: `tsc --noEmit` passes clean

## 2026-06-01 — Sales Authority Rules Registration

**Phase**: Governance — Business Rule Registration
**Objective**: Register approved sales authority scope rules for order and visit creation
**Result**: Sales authority rules documented in SYSTEM_BLUEPRINT.md under new section; AD-011 added

### Rule Summary
| Tier | Order Creation | Visit Creation |
|------|---------------|---------------|
| Chairman / SUPER_ADMIN / ADMIN | Full governance scope | Full governance scope |
| Shared Unit (على سعيد, محمود سعيد) | Shared manager subtree | Shared manager subtree |
| Sales Supervisor (خالد سعيد) | Team visibility scope | Team visibility scope |
| SALES_REP | Directly owned customers only | Directly owned customers only |

**Database impact**: None
**Governance impact**: None (existing governance already enforces these scopes; rule is a documentation clarification)
**Files affected**:
- Modified: `SYSTEM_BLUEPRINT.md` — added Sales Authority Rules section, AD-011
- Modified: `PROJECT_CHANGELOG.md` — this entry

---

## 2026-06-01 — Credit Program A Correction

**Phase**: Business Rule Fix
**Objective**: Correct Program A credit limit from 150,000 EGP to 100,000 EGP per official contracts
**Result**: Database updated, documentation corrected

### Changes
- `credit_programs` table: Program A credit_limit updated from 150,000 to 100,000 (15 days unchanged)
- `SYSTEM_BLUEPRINT.md`: Business rules section corrected
- No customer records affected (no approved application had written 150,000 to any customer)
- No contract template change needed (uses `{credit_limit}` placeholder, not hardcoded value)

### Validation
- Program A: 100,000 EGP / 15 days ✅
- Program B: 300,000 EGP / 30 days ✅ (unchanged)

**Database impact**: 1 row updated in `credit_programs`
**Governance impact**: None
**Files affected**:
- Modified: `SYSTEM_BLUEPRINT.md` — corrected Program A value
- Modified: `PROJECT_CHANGELOG.md` — this entry

---

## 2026-06-01 — Project Operating Constitution Activation

**Phase**: Process — Permanent Execution Policy
**Objective**: Establish permanent operating rules for all future work on Ahram Distribution
**Result**: Project Operating Constitution added to SYSTEM_BLUEPRINT.md as mandatory startup policy

### Constitution Sections
- **A**: Source Of Truth — BLUEPRINT, CHANGELOG, ACTIVE_TARGETS are authoritative
- **B**: Default Behavior — begin from documented knowledge, do not rediscover
- **C**: Repository Restrictions — audits/discovery/exploration forbidden by default
- **D**: Scope Discipline — work only inside requested scope
- **E**: Missing Information Protocol — stop, ask, do not assume
- **F**: Documentation Governance — every task must update both files
- **G**: Conflict Protocol — stop, report, wait for decision
- **H**: Execution Philosophy — prefer execution over investigation

### Superseded
- Old "Session Startup Workflow" replaced by Constitution Sections A–C
- Old "Execution Efficiency" section absorbed into Constitution Section H

**Files affected**:
- Modified: `SYSTEM_BLUEPRINT.md` — added Project Operating Constitution, updated Documentation Governance
- Modified: `PROJECT_CHANGELOG.md` — this entry

---

## 2026-06-01 — Operational Traceability Rules Registration

**Phase**: Governance — Business Rule Registration
**Objective**: Register approved operational traceability rules — audit trail, order traceability, lifecycle, and preparation authorities
**Result**: AD-012 (Operational Audit Trail), AD-013 (Order Traceability), lifecycle map, and authority tables added to SYSTEM_BLUEPRINT.md

### Rules Registered
- **AD-012**: Every workflow transition must record entity_id, previous_status, new_status, performed_by, performed_at, notes
- **AD-013**: Every order must maintain two histories — Operational (lifecycle events) and Modification (data changes with previous/new values)

### Lifecycle Registered
```
Approved → Preparation Started → Preparation Completed → Preparation Reviewed → Shipped → Delivered → Collected → Returned
```

### Authorities Registered
- **Preparation**: بسام (WRQ1001) — Start Preparation, Complete Preparation
- **Preparation Review**: محمد عبد الباسط, هادى سعيد, على سعيد, محمود سعيد, محمد سعيد, ياسر توفيق

**Files affected**:
- Modified: `SYSTEM_BLUEPRINT.md` — added Operational Traceability Rules section, AD-012, AD-013
- Modified: `PROJECT_CHANGELOG.md` — this entry

---

## Key Dates

| Date | Phase |
|---|---|
| 2026-05-31 | Schema Foundation + Auth + All Entity Migrations |
| 2026-06-01 | Governance Phase 1 (Visibility) |
| 2026-06-01 | Governance Phase 2 (Write Enforcement) |
| 2026-06-01 | Governance Fixes + Validation + Closure |
| 2026-06-01 | Organization Report + Shared Management Model |
| 2026-06-01 | Dashboard DB Functions + Frontend Pages |
| 2026-06-01 | Runtime Fixes (Capability-Aware, Governance) |
| 2026-06-01 | Repository Hygiene + Project Memory System |
| 2026-06-01 | Customer Analytics Phase 1 (DB Layer) |
| 2026-06-01 | Customer Analytics Phase 2 (Frontend) |
| 2026-06-01 | Product Availability Enforcement |
| 2026-06-01 | Sales Authority Rules Registration |
| 2026-06-01 | Credit Program A Correction |
| 2026-06-01 | Project Operating Constitution Activation |
| 2026-06-01 | Operational Traceability Rules Registration |
| 2026-06-01 | Warehouse Runtime Phase 1 |
| 2026-06-01 | Warehouse Runtime Phase 2 |
| 2026-06-01 | Warehouse Runtime Phase 3 |
| 2026-06-03 | Auction Module V2 + Bug Fixes |
| 2026-06-03 | Daily Deals Module (صفقة اليوم) |
| 2026-06-04 | Credit Program Module V2 |
| 2026-06-04 | Unified Identity & Location Standard |

---

*Last updated: 2026-06-04* (Unified Identity & Location Standard)
