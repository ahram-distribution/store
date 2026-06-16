# Changelog — Owner Knowledge Base

> All additions, corrections, and clarifications to the Owner Knowledge Base are recorded here.

---

## 2026-06-16 (continued)

### Address Source of Truth Fix

**Problem:** Dual source of truth for customer address — `unified_locations` (canonical) and `customer_addresses` (legacy, 23 customers). Production `governed_create_order` only read from `unified_locations`, so customers without `location_id` got empty `snapshot_customer_address` in orders. Also missing `snapshot_customer_code`.

**Migration logic deployed directly to production (3-step fix):**
1. **Fix 1** — `governed_create_order` updated with `customer_addresses` fallback for `snapshot_customer_address` (both customer and sender) + `v_cust_code` + `snapshot_customer_code` column in INSERT
2. **Fix 2** — Backfill of `snapshot_customer_address` + `snapshot_customer_code` for all existing orders with empty values → 0 empty left
3. **Fix 3** — Migrated 23 customers from `customer_addresses` → `unified_locations` (each got a new `unified_locations` row with `formatted_address`, their `location_id` set). Total customers with `location_id`: 27

**Frontend fix:**
- `CustomerProfilePage.tsx` — Removed `get_governed_customer_addresses` RPC call (legacy table). Address now displayed from `location?.formatted_address` (from `unified_locations` only)
- `OrderDetailView.tsx` — Cleaned up owner/sender sections (name + phone only, no address/ContactActions/badge)
- `whatsapp.ts` — WhatsApp message shows customer name/phone/address, owner name/phone, sender name/phone/role (`creatorType`); all fields use `|| 'غير متوفر'`

**Data outcome:** New orders now always capture the customer's address. Existing orders backfilled. Zero empty addresses/codes remaining.

**Commit:** `3e25e41` — fix: unify customer address source

---

## 2026-06-16

### Identity Integration Layer — Root Cause Fix

**Problem:** `orders.owner_id` is polymorphic — 12/58 rows reference `identities.id` instead of `employees.id`. All JOINs between attendance sessions and orders silently returned zero for those employees (most notably حسن بكر with 3 orders on June 15-16, total 1,927.50 EGP).

**Fix:** Created `public.resolve_employee_id(target_id uuid)` that normalizes any UUID (whether `identities.id` or `employees.id`) to `employees.id` via `employees.identity_id`. All analytics RPCs now use this function.

**Affected RPCs (5 total):**
- `get_employee_workday_history` — orders/collections/customers JOINs
- `get_team_map` — today_orders/collections/customers CTEs
- `get_my_workday_status` — KPI queries
- `get_daily_target_vs_actual` — single + team aggregate actuals
- `get_live_workday_overview` — **ADDED** missing `order_count`, `sales_value`, `collection_count`, `collection_amount`, `new_customer_count` fields (was returning undefined → NaN in frontend)

**Secondary fixes:**
- `get_live_workday_overview`: Fixed LATERAL JOIN from `visit_links.employee_id` (column does not exist) to `visits.employee_id` — dormant bug because `visit_links` had 0 rows
- `OperationsCenterPage.tsx`: Added `safeNum()` guard in `totals` reduce to prevent `undefined + 0 = NaN`
- `GlobalCounters.tsx` `EmployeeCard.tsx` `TeamMapPage.tsx` etc.: Changed `toLocaleString('ar-EG')` → `toLocaleString('en-EG')` for Western/Arabic numerals in 19 occurrences across 12 files
- `OperationsCenterPage.tsx`: Counter boxes now navigate on click — الطلبات/المبيعات → `/orders?filter=today`, الزيارات → `/visits?filter=today`, عملاء جدد → `/customers`
- Fixed `navigate is not defined` runtime error (missing `useNavigate()` import)

**Data outcome:** 57/58 orders now resolve to an employee (was 46). The 1 remaining unresolved (ORD-2026-000094, owner `d09db019-...`) has no `employees` record with matching `identity_id` — pre-existing data issue.

**Files changed:**
- `supabase/migrations/20260724_identity_integration_layer.sql` (new, 525 lines)
- `src/pages/operations-center/OperationsCenterPage.tsx`
- `src/pages/operations-center/components/GlobalCounters.tsx`
- `src/pages/operations-center/components/EmployeeCard.tsx`
- `src/pages/attendance/TeamMapPage.tsx`
- `src/pages/attendance/EmployeeWorkdayDetailPage.tsx`
- `src/pages/attendance/runtime/AttendanceRuntimePage.tsx`
- `src/pages/attendance/runtime/components/RuntimeKpiGrid.tsx`
- `src/pages/attendance/runtime/components/RuntimeDailySummaryModal.tsx`
- `src/pages/attendance/runtime/components/RuntimeTodaySummary.tsx`
- `src/pages/employees/EmployeeProfilePage.tsx`
- `src/pages/daily-deals/DailyDealsManagementPage.tsx`
- `src/pages/flash-offers/FlashOffersManagementPage.tsx`
- `src/components/orders/OrderDetailView.tsx`

---

### Map & Tracking Points UX Fixes

**Problem:** Map markers were 14px colored dots with no visible name — had to click each one. Tracking points list showed raw coordinates (`30.0444, 31.2357`) instead of address and distance.

**Fixes:**
- `MapTab.tsx`: Markers now show employee name next to colored dot at all times (custom `L.divIcon` with name label + white background badge). Popup still available on click for details
- `EmployeeWorkdayDetailPage.tsx`: Tracking points list converted to **striped colored table** (gradient blue header, alternating white/gray rows, hover highlight)
  - Removed raw lat/lng → replaced with `LocationDisplay` component (🗺️ Google Maps link + reverse-geocoded address)
  - Added Haversine distance from previous point (green < 100m, amber < 500m, orange ≥ 500m)
  - Added "عرض القائمة" toggle button with point count
- `EmployeeWorkdayDetailPage.tsx`: Long stops section also uses `LocationDisplay` instead of raw coordinates

**Files changed:**
- `src/pages/operations-center/components/MapTab.tsx`
- `src/pages/attendance/EmployeeWorkdayDetailPage.tsx`

---

### Sales Representatives Effort Dashboard (جديد)

**Feature:** Full dashboard to analyze sales rep effort across attendance, sales, visits, customers, and targets — for a given date range.

**Backend — RPC:**
- `get_sales_reps_effort(p_token, p_from, p_to, p_search)` — aggregates sessions, orders (via `resolve_employee_id()`), customers, visits, and targets per employee
- Performance score formula: attendance 40% + sales achievement 30% + successful visits 20% + new customers 10%
- Returns `employees[]` + `summary` (avg_score, top_performer, worst_performer)
- Uses `resolve_employee_id()` for identity resolution
- Respects `attendance.view_all` capability or `get_visible_employee_ids()`

**Frontend — Page:**
- `SalesEffortPage.tsx` — TimeRangeFilter + search bar + Summary cards (total sales/orders/visits/avg score) + Top/Worst performer highlight cards + expandable employee cards with KPIs and progress bars
- Route `/sales-effort` added to `src/routes/index.tsx`

**Navigation entries:**
- `ReportsPage.tsx`: "مجهود المناديب" tab in section buttons → navigates to `/sales-effort`
- `ModuleLauncherPage.tsx` (reports module): icon "مجهود المناديب" in "التقارير والتحليلات" list
- `SalesManagerCCPage.tsx`: gradient card below team overview + QuickBtn in الإجراءات السريعة

**Files changed:**
- `supabase/migrations/20260724_sales_reps_effort_dashboard.sql` (جديد, 208 lines)
- `src/pages/sales-effort/SalesEffortPage.tsx` (جديد, 272 lines)
- `src/pages/sales-effort/index.ts` (جديد)
- `src/routes/index.tsx`
- `src/pages/reports/ReportsPage.tsx`
- `src/pages/dashboard/ModuleLauncherPage.tsx`
- `src/pages/sales-manager/SalesManagerCCPage.tsx`

---

## 2026-06-10

### Organizational Model Unification

- **Upper Management unification**: Super Admin, Executive Manager, Sales Director, Chairman — all unified into a single system role `UPPER_MANAGEMENT` (الإدارة العليا) with identical permissions, visibility, authority, and governance powers
- **Supervisor role retired**: Official replacement: SALES_MANAGER (مدير مبيعات); existing Supervisor users treated as Sales Managers
- **Manager tier removed**: Hierarchy simplified to UPPER_MANAGEMENT → SALES_MANAGER → SALES_REPRESENTATIVE → CUSTOMER; Internal Sales reports directly to Upper Management
- **Upper Management governance**: Absolute authority over all operational entities (create/edit/delete/approve/reject/transfer/reassign)
- **Documentation updated**: 02_ORGANIZATIONAL_MODEL.md, 09_PERMISSIONS_RULES.md, 00_CHANGELOG.md

### Return Financial Rule — OWNER_DEFINED

- **Option B confirmed**: Returns are record-only (no customer credit, no wallet, no offset)
- **Return value source**: Original order pricing snapshot (Returned Quantity × Original Order Unit Price) — auto-calculated, no manual entry
- **Credit separation**: Returns and Credit Programs are completely separate; returns must NOT modify any credit tables
- **Inventory restore**: Only for `return_inspection.condition = 'saleable'` items
- **Documentation updated**: 07_RETURN_RULES.md (new sections: RETURN_FINANCIAL_RULE, RETURN_VALUE_CALCULATION, RETURN_AND_CREDIT_SEPARATION; open question Q3 removed)

### Phase 1 — Order Approval Pipeline — COMPLETE & VALIDATED

- **Fix:** `governed_approve_order` wired from frontend (was dead code; now called for `submitted → approved` transition)
- **Validated transitions:** `submitted → reviewing → approved` — PASS
- **Daily Deal inventory deduction at approval:** Verified — PASS
- **Audit history (order_status_history):** Verified — PASS
- **identity_id / employee_id mismatch:** Fixed
- **Approval pipeline verified with real database test**
- **Blocker status:** Order approval pipeline is no longer an open blocker

### Updated — 17_WORKDAY_TRACKING_SYSTEM.md — Expanded to Full V1 Spec

- Replaced sparse placeholder with complete owner-defined V1 specification
- Documented all 4 tracking modes with preferred mode (WORKDAY_PLUS_VISITS)
- Employee workday flow (START WORKDAY → ACTIVE → END WORKDAY → OFF DUTY)
- Upper Management control panel (tracking mode, interval, offline sync, retention policy)
- Live operations screen with displayed fields
- Employee day analysis with summary cards and timeline
- Live map with colored markers and travel path
- Long stop detection (management review only, no penalties)
- Day replay with variable playback speed (1x, 2x, 5x, 10x)
- Offline support with local storage and auto-upload
- Permission model per role
- Data storage specification (lat/lng/timestamp/employee/session only, no map images)
- Future expansion list (not required for V1)

- **Fix:** `governed_approve_order` wired from frontend (was dead code; now called for `submitted → approved` transition)
- **Validated transitions:** `submitted → reviewing → approved` — PASS
- **Daily Deal inventory deduction at approval:** Verified — PASS
- **Audit history (order_status_history):** Verified — PASS
- **identity_id / employee_id mismatch:** Fixed
- **Approval pipeline verified with real database test**
- **Blocker status:** Order approval pipeline is no longer an open blocker

### Added

- **KNOWLEDGE_TO_SYSTEM_GAP_REPORT.md**
- **IMPLEMENTATION_ANALYSIS_REPORT.md** — Deep-dive analysis of the 3 critical operational blockers: (1) Order approval pipeline — why governed_change_order_status is used instead of governed_approve_order and the exact impact on inventory/deals/credit; (2) Return creation pipeline — the /returns/new dead route and what is required to make governed_create_return reachable; (3) Credit pipeline — trace of 3 orphaned RPCs (reserve/release/convert) with zero frontend call sites and mapping to owner-defined lifecycle stages
- **17_WORKDAY_TRACKING_SYSTEM.md** — Future operational module: field activity monitoring for Sales Representatives. Configurable tracking mode (OFF, VISITS_ONLY, WORKDAY, WORKDAY_PLUS_VISITS). Offline support with local storage and auto-upload. Visible to Upper Management and Sales Manager (team scope). Workday events: Start/End Workday, Start/End Visit. Controlled from Administration settings by Upper Management. Documented per owner approval — no implementation at current phase. — System gap report comparing all owner-defined rules against actual system implementation across 4 dimensions
- **IMPLEMENTATION_ANALYSIS_REPORT.md** — Deep-dive analysis of the 3 critical operational blockers: (1) Order approval pipeline — why governed_change_order_status is used instead of governed_approve_order and the exact impact on inventory/deals/credit; (2) Return creation pipeline — the /returns/new dead route and what is required to make governed_create_return reachable; (3) Credit pipeline — trace of 3 orphaned RPCs (reserve/release/convert) with zero frontend call sites and mapping to owner-defined lifecycle stages (Database Schema, RPC Functions, Frontend UI, Permissions). Findings: 27% system readiness (14/51 aligned), 19 broken/missing items, 3 broken pipelines (order approval without inventory deduction, return creation dead route, auction governance bypass), and 6 critical blockers identified.

## 2026-06-09

### Added

- **SUPREME_BOARD** section in `02_ORGANIZATIONAL_MODEL.md` — Owner-defined: Supreme Board as highest authority with full visibility and equal authority across all system areas.
- **OWNER_KNOWLEDGE_INDEX.md** — Created entry point for the knowledge base system.
- **00_CHANGELOG.md** — Created this changelog.
- **01_COMPANY_VISION.md** — Placeholder with verified architectural context from V2 documents.
- **02_ORGANIZATIONAL_MODEL.md** — Placeholder with verified organizational structure from V2 documents.
- **03_OWNERSHIP_RULES.md** — Placeholder with verified ownership rules from V2 documents.
- **04_CUSTOMER_RULES.md** — Placeholder with verified customer model from V2 documents.
- **05_ORDER_RULES.md** — Placeholder with verified order lifecycle from V2 documents.
- **06_COLLECTION_RULES.md** — Placeholder with verified collection workflow from V2 documents.
- **07_RETURN_RULES.md** — Placeholder with verified return workflow from V2 documents.
- **08_PRICING_AND_TIERS_RULES.md** — Placeholder with verified pricing model from V2 documents.
- **09_PERMISSIONS_RULES.md** — Placeholder with verified permissions model from V2 documents.
- **10_OPERATIONAL_TERMINOLOGY.md** — Placeholder with verified terminology rules from V2 documents and bootstrap instructions.
- **11_OPEN_QUESTIONS.md** — Catalog of open questions derived from verified audit gaps.

### Added

- **SALES_MANAGER** section in `02_ORGANIZATIONAL_MODEL.md` — Owner-defined: Sales Manager (مدير بيع) as the preferred business title, replacing historical "Supervisor (مسؤول)". Responsibilities, visibility scope, restrictions, and allowed actions documented.
- **WAREHOUSE_MANAGER** section in `02_ORGANIZATIONAL_MODEL.md` — Owner-defined: Warehouse Manager (مدير المخزن) as بسام. Manages order preparation stage only. Visibility restricted to orders at "جاري التجهيز" status. Responsibility boundary ends at "تم التجهيز" (no shipping or delivery).
- **GENERAL_SUPERVISOR** section in `02_ORGANIZATIONAL_MODEL.md` — Owner-defined: General Supervisor (المشرف العام) as محمد عبد الباسط. Oversees order execution from جاري التجهيز until تم التسليم. Can update statuses during post-preparation operational stages.
- **ORDER_MODIFICATION_RULES** section in `05_ORDER_RULES.md` — Owner-defined: modification authority per role and order stage. Order creator can modify before جاري المراجعة. Sales Manager controls review gate and can return to cart. Authority ends at معتمد. Full audit trail required.
- **OFFICIAL_ORDER_STATUSES** section in `05_ORDER_RULES.md` — Owner-defined: 9 official order statuses (طلب مقدم, جارى المراجعة, معتمد, جارى التجهيز, تم التجهيز, تم الشحن, تم الاستلام, ملغى, مؤجل) representing the real-world operational workflow.
- **06_VISIT_RULES.md** — Created with owner-defined visit rules: purpose, actions, linked records, location tracking, active status display, card requirements, card details, customer visit insights.
- **CUSTOMER_CREATION_AND_OWNERSHIP** section in `04_CUSTOMER_RULES.md` — Owner-defined: self-registered customers default to ياسر توفيق; employee/rep-created customers owned by creator; reassignable by authorized users higher in hierarchy.
- **CUSTOMER_ORDER_PERMISSIONS** section in `05_ORDER_RULES.md` — Owner-defined: customers may create, submit, and modify own orders before جارى المراجعة stage; rights end once review stage begins.
- **07_PROMOTIONAL_SYSTEMS.md** — Created with owner-defined promotional rules: Daily Deal (صفقة اليوم) as standalone package not tied to catalog or inventory; Flash Offer (عرض الساعة) as short-duration time-limited package. Both duration-controlled by upper management.
- **08_AUCTION_RULES.md** — Created with owner-defined auction rules: participation flow (request → approval → bidding), auction configuration fields, predefined bid increments by Upper Management, realtime requirements for participant names, bids, and activity.
- **09_ADMINISTRATION_RULES.md** — Created with owner-defined administration rules: Upper Management administration responsibilities (products, companies, employees, permissions, roles, assignment), Owner Vision for behavioral analytics (OWNER_VISION status), and search/filter principle for screens managing large datasets.
- **08_PRICING_AND_TIERS_RULES.md** — Replaced placeholder with owner-defined knowledge: tiers are selectable order-level pricing modes (not permanent customer assignments), realtime pricing updates on tier change, minimum purchase requirement per tier, and Upper Management controls all tier configuration. Open questions retained for tier-promotion interactions.
- **UNIFIED_ORDER_CARD_STANDARD** section in `05_ORDER_RULES.md` — Owner-defined: consistent order card specification across all screens with external info (order number, customer/owner/creator name, status, value) and internal details (customer/creator info, phone, address, location, contents, history, transitions).
- **PRODUCT_AND_INVENTORY_MANAGEMENT** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: Upper Management manages inventory; negative inventory sales allowed; orders not blocked by insufficient stock.
- **PRODUCT_AND_COMPANY_CONTROL** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: Upper Management may show/hide companies and products, apply exceptional discounts at both levels, stop product sales, control sales units, and set manual or automatic pricing.
- **CREDIT_PROGRAM_RULES** section in `04_CUSTOMER_RULES.md` — Owner-defined: opt-in credit system with two programs (100k/15 days and 300k/30 days), Upper Management approval, contract execution and guarantees required for activation.
- **INVENTORY_DEDUCTION_RULE** section in `05_ORDER_RULES.md` — Owner-defined: inventory deducted when order reaches "معتمد" status. Resolves blocker B1.
- **ORDER_SUBMISSION_NOTIFICATION** section in `05_ORDER_RULES.md` — Owner-defined: order stored in database and copy sent to company WhatsApp on submission.
- **TARGET_AND_WEIGHT_MANAGEMENT** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: Upper Management controls targets and weights.
- **INVENTORY_VISIBILITY** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: inventory quantities visible only to Upper Management; hidden from non-management users.
- **03_USER_TYPES.md** — Created with owner-defined unified registration principle: customer, user, employee, and sales representative registrations share same core fields.
- **12_OWNER_PRINCIPLES.md** — Created with 7 owner-defined cross-cutting principles: permission visibility, single source of truth, performance, digital sales representative, guided error, intelligent search, and ownership visibility.
- **FUTURE_MODULE_PRESERVATION_PRINCIPLE** section in `12_OWNER_PRINCIPLES.md` — Owner-defined: future-phase modules (collections, treasury/cashbox) should be preserved and hidden, not removed.
- **07_RETURN_RULES.md** — Replaced placeholder with owner-defined return rules: creation by Customer, Sales Rep, or Original Order Creator; 4 official Arabic statuses (مقدم, جارى المراجعة, مقبول, مرفوض); acceptance effects (inventory restock + sales deduction); full audit trail requirements.
- **ORDER_STATUS_AUDIT_RULE** section in `05_ORDER_RULES.md` — Owner-defined: every status change requires note/comment + changer name + date + time + order history record.
- **ORDER_CANCELLATION_AUTHORITY** section in `05_ORDER_RULES.md` — Owner-defined: only Upper Management may cancel orders.
- **ORDER_CANCELLATION_INVENTORY_RULE** section in `05_ORDER_RULES.md` — Owner-defined: cancellation restores inventory if previously deducted.
- **DIRECT_VS_MANAGED_CUSTOMERS** updated in `04_CUSTOMER_RULES.md` — Owner-defined: Direct = Upper Management/Super Admin ownership; Managed = Sales Rep/Manager ownership.
- **SELF_REGISTRATION_ACTIVATION** section in `04_CUSTOMER_RULES.md` — Owner-defined: immediate activation with full access (login, prices, orders) and Super Admin ownership.
- **CUSTOMER_CREATED_DURING_VISIT** section in `04_CUSTOMER_RULES.md` — Owner-defined: customer created during visit is auto-owned by the creating rep.
- **CUSTOMER_OWNERSHIP_REASSIGNMENT** section in `04_CUSTOMER_RULES.md` — Owner-defined: on employee departure, Super Admin reassigns ownership; historical attribution preserved; new activity to new owner.
- **CREDIT_LIMIT_EXCEEDED_RULE** section in `04_CUSTOMER_RULES.md` — Owner-defined: orders still creatable/submittable when over limit; requires Upper Management review with approve/settle/exception options.
- **CREDIT_PROGRAM_SETTLEMENT_RULE** section in `04_CUSTOMER_RULES.md` — Owner-defined: full settlement only; credit control by unpaid invoices, limit, period, and age of first unpaid invoice.
- **VISIT_CONCURRENCY_RULE** section in `06_VISIT_RULES.md` — Owner-defined: one active visit per rep at a time.
- **RETURNS_ARE_PARTIAL** section in `07_RETURN_RULES.md` — Owner-defined: returns may include full order, specific products, or partial quantities; approved returns restore inventory and reduce net sales.
- **TARGET_CALCULATION_RULE** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: Net Sales = Sales - Approved Returns.
- **TARGET_STRUCTURE** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: each target category tracked independently (Net Sales, Orders, New Customers, Visits) with target value, achievement, and percentage.
- **WEIGHTS** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: weights are for evaluation only; independent target tracking remains primary.
- **ORDER_TARGET_COUNTING** section in `05_ORDER_RULES.md` — Owner-defined: only orders at "معتمد" status count toward order targets.
- **NEW_CUSTOMER_TARGET_COUNTING** section in `04_CUSTOMER_RULES.md` — Owner-defined: customer counts as new only when first order reaches "تم التسليم".
- **VISIT_STATUSES** section in `06_VISIT_RULES.md` — Owner-defined: 3 official visit statuses (مقدمة, معتمدة, مرفوضة).
- **VISIT_APPROVAL** section in `06_VISIT_RULES.md` — Owner-defined: Sales Rep submits; Sales Manager or Upper Management approves/rejects.
- **VISIT_REJECTION** section in `06_VISIT_RULES.md` — Owner-defined: rejected visits require comment/note and decision history.
- **VISIT_TARGET_COUNTING** section in `06_VISIT_RULES.md` — Owner-defined: only معتمدة visits count toward visit targets.
- **VISIT_APPROVAL** section updated in `06_VISIT_RULES.md` — Owner-defined: Sales Manager approves/rejects own team only; Upper Management approves/rejects any visit.
- **CUSTOMER_CREATED_BY_SALES_REPRESENTATIVE** section in `04_CUSTOMER_RULES.md` — Owner-defined: rep-created customers activated immediately with full access and auto-assigned ownership.
- **SALES_MANAGER_OPERATIONAL_AUTHORITY** section in `02_ORGANIZATIONAL_MODEL.md` — Owner-defined: Sales Manager creates orders and performs visits for direct and team customers.
- **SALES_REPRESENTATIVE_ISOLATION** section in `02_ORGANIZATIONAL_MODEL.md` — Owner-defined: Sales Reps cannot view other reps' data even within same team.
- **SALES_REPRESENTATIVE_CUSTOMER_MANAGEMENT** section in `02_ORGANIZATIONAL_MODEL.md` — Owner-defined: Sales Reps can view/update customer info, view history, create orders/visits/customers within owned base.
- **SALES_MANAGER_CUSTOMER_ADMINISTRATION** section in `02_ORGANIZATIONAL_MODEL.md` — Owner-defined: full customer and visit administration (view/update/create, perform/review/approve/reject visits) over direct and team customers.
- **CUSTOMER_OWNERSHIP_REASSIGNMENT_INSIDE_SALES_TEAM** section in `02_ORGANIZATIONAL_MODEL.md` — Owner-defined: Sales Managers may reassign customers between team representatives or to themselves.
- **ORDER_ATTRIBUTION_RULE** section in `05_ORDER_RULES.md` — Owner-defined: order attributed to creator (Sales Manager), not customer owner; performance follows creator.
- **PRICING_AUTHORITY_RULE** section in `08_PRICING_AND_TIERS_RULES.md` — Owner-defined: pricing determined by base + tier + predefined discounts/exceptions only; no manual discounts by Sales Reps or Managers.
- **CUSTOMER_TYPE_TRANSITION_RULE** section in `04_CUSTOMER_RULES.md` — Owner-defined: customer type is dynamic based on ownership; Direct becomes Managed when reassigned to field roles.
- **CUSTOMER_CREDIT_VISIBILITY** section in `04_CUSTOMER_RULES.md` — Owner-defined: customers may view credit limit, available credit, outstanding invoices, due info, and credit status.
- **CUSTOMER_ORDER_HISTORY** section in `04_CUSTOMER_RULES.md` — Owner-defined: customers may view all historical orders with search, filters, details, and status change history.
- **CUSTOMER_DATA_MAINTENANCE** section in `04_CUSTOMER_RULES.md` — Owner-defined: customers do not modify their own master data; data maintained by responsible owner.
- **CUSTOMER_VISIBILITY** section in `04_CUSTOMER_RULES.md` — Consolidated from CUSTOMER_CREDIT_VISIBILITY and CUSTOMER_ORDER_HISTORY; added responsible owner name to customer-visible information.
- **CUSTOMER_REASSIGNMENT** section in `04_CUSTOMER_RULES.md` — Consolidated reassignment rules: Sales Manager within team, Upper Management globally.
- **EMPLOYEE_DEPARTURE** section in `04_CUSTOMER_RULES.md` — Renamed from CUSTOMER_OWNERSHIP_REASSIGNMENT.
- **ORDER_ATTRIBUTION_RULE** updated in `05_ORDER_RULES.md` — Added: historical records are never rewritten.
- **STATUS_TRANSITIONS** section in `05_ORDER_RULES.md` — Owner-defined: explicit authority per each status transition.
- **COMPLETED_SALE** section in `05_ORDER_RULES.md` — Owner-defined: تم الاستلام is fully completed; appears in final reports.
- **DEFERRED_ORDERS** section in `05_ORDER_RULES.md` — Owner-defined: مؤجل retains previous status; order returns to same stage.
- **ORDER_DELETION** section in `05_ORDER_RULES.md` — Owner-defined: physical deletion only by Upper Management.
- **ORDER_NUMBER** section in `05_ORDER_RULES.md` — Owner-defined: order number never changes.
- **BRANDS** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: brand controls are independent; Hide Brand and Stop Selling Brand are separate controls.
- **PRODUCT_STATUS** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: three product states (Active, Temporarily Stopped, Out Of Stock).
- **INVENTORY_DEPLETION** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: when inventory reaches zero, selling remains allowed, negative inventory allowed, warning displayed.
- **PRODUCT_UNITS** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: unit structure varies per product (Carton/Dozen/Piece); controlled by Upper Management.
- **INVENTORY_STORAGE** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: multi-unit inventory with automatic conversion support.
- **PRODUCT_CREATION** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: only Upper Management may create products.
- **BRAND_CREATION** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: only Upper Management may create brands.
- **HIDDEN_PRODUCTS** section in `09_ADMINISTRATION_RULES.md` — Owner-defined: hidden products disappear from storefront; historical orders/reports preserved.
- **PRICING_MODEL** section in `08_PRICING_AND_TIERS_RULES.md` — Owner-defined: carton-based pricing with auto-calculation; Upper Management may override.
- **CUSTOMER_INVENTORY_VISIBILITY** added to `04_CUSTOMER_RULES.md` — Owner-defined: customers see Available/Out Of Stock only, not inventory quantities.
- **13_STOREFRONT_EXPERIENCE.md** — Created with owner-defined storefront rules: شراء button (instead of أضف للسلة), إزالة من السلة after addition, quantity input with controls and direct entry, integer-only with no fractions/negatives.
- **14_REPORTING_AND_ANALYTICS.md** — Created with owner-defined reporting rules: Sales Rep reports (Today/Week/Month/Year, KPIs: Net Sales/Orders/New Customers/Visits), Customer Analytics (most purchased products/brands, avg time, last order, avg value, total), Sales Manager reporting (individual+team within own team), Upper Management dashboard (company-wide), Period Comparison, Rankings (Top Reps/Customers/Brands/Products), Smart Alerts (inactivity/decline monitoring).
- **02_ORGANIZATIONAL_MODEL.md** — Updated SUPREME_BOARD → UPPER_MANAGEMENT with official term الإدارة العليا, identical permissions/screens/authority/capabilities, no hierarchy between members. Added SUPER_ADMIN section (not separate level). Updated GENERAL_SUPERVISOR (operational order execution role, not sales management). Updated WAREHOUSE_MANAGER (may view order contents, customer name, rep name). Added MULTI_ROLE_SUPPORT section (employees may hold multiple roles).
- **09_ADMINISTRATION_RULES.md** — Added official term الإدارة العليا to UPPER_MANAGEMENT_ADMINISTRATION. Added EMPLOYEE_MANAGEMENT section (create/edit/disable by UM only). Added EMPLOYEE_DISABLING section (prevents login, preserves history). Added ROLE_CHANGES section (historical records preserved). Added EMPLOYEE_AUDIT_TRAIL section (user/date/time per action).
- **07_PROMOTIONAL_SYSTEMS.md** — Expanded DAILY_DEAL (always a package, single/multiple products, manually defined, independent inventory, own quantity). Added DAILY_DEAL_REPORTING (counts in reports and targets). Added DAILY_DEAL_PURCHASE_LIMITS (once per order, one per deal if multiple). Expanded FLASH_OFFER (same model as Daily Deal, start/end time, limited-duration). Added concurrency (multiple simultaneous). Added expiration behavior (visible, disabled, "Offer Expired", show expiration). Added MIXED_ORDERS (catalog + Daily Deal + Flash Offer in one order).
- **08_AUCTION_RULES.md** — Added AUCTION_CREATION (only UM). Added AUCTION_INVENTORY (independent from catalog, package-based, separate quantity). Updated participation flow with customer-only restriction (employees do not bid). Added AUCTION_LIVE_SCREEN (participant names, latest bid, highest bidder, remaining time). Added AUCTION_FAILURE_RULE (deposit forfeited, admin action, UM relaunch).
- **06_VISIT_RULES.md** — Added VISIT_TYPES (Existing Customer, New Customer, Follow-up). Added VISIT_OUTCOMES (7 official outcomes + manual notes). Added VISIT_RESULTS (order only, customer only, or both). Added VISIT_DURATION_MONITORING (duration alerts and review). Added LIVE_FIELD_ACTIVITY_TRACKING (Sales Manager/UM view last known location/timestamp/link). Updated VISIT_CONCURRENCY_RULE → ACTIVE_VISIT_RULE (app close: visit remains active and resumes). Updated VISIT_REJECTION (remain closed, cannot edit/resubmit). Updated VISIT_CARD_REQUIREMENTS → VISIT_CARD_OUTER_VIEW (customer name, visitor, type, outcome, status, open/close time). Updated VISIT_CARD_DETAILS → VISIT_CARD_DETAIL_VIEW (location links/addresses, duration, generated order/customer, visitor/customer info). Added VISIT_VISIBILITY (customers do not view visit history).
- **15_UI_AND_UX_STANDARDS.md** — Created with owner-defined UI/UX standards: PRIMARY_PLATFORM (Mobile First, desktop secondary), HOME_EXPERIENCE (per-role landing pages: customer→storefront, rep→workspace, manager→team metrics, UM→command center), CUSTOMER_CARD (name, owner, last order, last visit, total sales), PRODUCT_CARD (image, name, brand, unit, price, availability), SEARCH_EXPERIENCE (Arabic/English/partial/cross-entity + normalization for spacing/hamza/spelling/word order), FILTERS (visible and fixed at top), NOTIFICATION_CENTER (unified hub for orders/visits/credit/auction events), COLOR_LANGUAGE (green=success, red=problem, yellow=action, blue=info).
- **12_OWNER_PRINCIPLES.md** — Updated PERMISSION_VISIBILITY_PRINCIPLE (hide feature completely if lacking permission). Updated DIGITAL_SALES_REPRESENTATIVE_PRINCIPLE (recommend products, remind of missing, reference previous orders, assist decisions). Added search normalization details to INTELLIGENT_SEARCH_PRINCIPLE.
- **16_SMART_COMMERCE.md** — Created with owner-defined recommendation engine rules
- **02_ORGANIZATIONAL_MODEL.md** — Added INTERNAL_SALES section (سيلز داخلي / سكرتارية): phone-based sales role with customer creation/management and order creation; prohibited from visits and field activity; managed directly by Upper Management; operationally similar to Sales Rep but no field visits. Updated hierarchy diagram. Updated open question #3.
- **02_ORGANIZATIONAL_MODEL.md** — Extended INTERNAL_SALES with: Customer Ownership (belongs to Internal Sales, not auto-assigned to UM), Performance Attribution (orders/customers/sales attributed to Internal Sales), Targets (Net Sales, Orders Count, New Customers; no visit targets), Role Model Summary (sales channel equivalent to Sales Rep; no visits, no field ops, no GPS, no visit targets).
- **02_ORGANIZATIONAL_MODEL.md** — Extended INTERNAL_SALES with: Customer Ownership Transfer (reassignable to Sales Rep, Sales Manager, or another IS; follows governance rules), Organizational Position (outside SM team structure; SMs do not auto-manage IS customers), User Experience (uses same workspaces as Sales Reps; no dedicated workspace). Updated MULTI_ROLE_SUPPORT (Sales Representative + Internal Sales example added; technically allowed but not currently required operationally).
- **12_OWNER_PRINCIPLES.md** — Added UPPER_MANAGEMENT_ABSOLUTE_AUTHORITY principle: UM is highest authority; default interpretation rule grants UM authority over all create/edit/delete/approve/reject/reassign/transfer/override/status/workflow operations; UM may move states forward/backward, override, correct, transfer, intervene; audit logging still required.
- **12_OWNER_PRINCIPLES.md** — Added Permission Authority to UPPER_MANAGEMENT_ABSOLUTE_AUTHORITY: UM may grant/revoke permissions for any employee from Employee Management; no other role may grant/revoke permissions.
- **12_OWNER_PRINCIPLES.md** — Refined OWNERSHIP_VISIBILITY_PRINCIPLE → VISIBILITY_RULE: a user may only see their own records and records owned by subordinates within their hierarchy; must not see peer data or higher-level data. Replaced the per-role list under the new general rule.
- **11_OPEN_QUESTIONS.md** — Marked PMQ5 (authority to create/modify roles) as ANSWERED. Upper Management has exclusive permission authority from Employee Management.
- **04_CUSTOMER_RULES.md** — Added 7 new credit lifecycle sections: CREDIT_START_DATE (aging from first unpaid invoice), CREDIT_CUSTOMER_ACCOUNT (dedicated account section with specific visible fields: program name, limit, period, current usage, remaining credit), PAYMENT_REMINDER_MODEL (simple administrative notes, no complex banking), PRE_DUE_REMINDERS (optional one-day-before notifications), CREDIT_EXPIRY_ACTION (orders blocked + UM alert on period exceed), CREDIT_ENFORCEMENT (two-pillar: limit + period only), SIMPLICITY_PRINCIPLE (operationally simple, future expansion allowed). Updated CUSTOMER_VISIBILITY to remove credit-specific items (now in CREDIT_CUSTOMER_ACCOUNT). Added 9 new entries to clarifications table. Updated open questions.
- **04_CUSTOMER_RULES.md** — Updated CREDIT_PROGRAM_SETTLEMENT_RULE: partial settlement does not release credit capacity; must fully settle oldest outstanding credit order. Added CREDIT_REQUEST_REJECTION rule (rejected customers remain cash, may reapply). Added CUSTOMER_OWNERSHIP_HISTORY (historical attribution immutable on ownership change). Added CUSTOMER_INTERNAL_NOTES (operational notes, customer invisible, employee-only). Added CUSTOMER_ADDRESS_MODEL (single operational address, multiples not required). Added 6 entries to clarifications table.
- **02_ORGANIZATIONAL_MODEL.md** — Added SALES_MANAGER_DEPARTURE section: team ownership transfers to UM; UM may keep or redistribute to another SM. Added 1 entry to clarifications table.
- **05_ORDER_RULES.md** — Added ORDER_PRICE_SNAPSHOT (historical pricing preserved; price changes do not affect existing orders). Added PRODUCT_STOPPED_AFTER_ORDER_CREATION (unavailable product may be rejected during operational review before approval). Added 2 entries to clarifications table.
- **07_RETURN_RULES.md** — Added RETURNS_IMPACT section: approved returns reduce Net Sales and Targets. Added 1 entry to clarifications table.
- **04_CUSTOMER_RULES.md** — Updated SELF_REGISTRATION_ACTIVATION: confirmed no approval workflow, no manual review, immediate access with no waiting period. Added REGISTRATION_REQUIREMENTS (no mandatory documents: National ID, commercial registration, store photos, verification). Added ONBOARDING_SIMPLICITY_PRINCIPLE (frictionless onboarding, fast registration, immediate ordering). Removed answered question Q2 from open questions. Added 4 entries to clarifications table.
- **09_ADMINISTRATION_RULES.md** — Added BRANDS_VS_COMPANY_DISTINCTION section: clarified that product brands (Johnson, Nivea, L'Oreal) are catalog entities with visibility/sales/discount/reporting controls but NO operational targets; Al Ahram Trading & Distribution is the operating business entity where company-level targets (Net Sales, Orders, New Customers, Visits, Weights) belong to company/employees/teams, not to brands. Added 1 entry to clarifications table.
- **05_ORDER_RULES.md** — Added ORDER_REJECTION section: mandatory reason, customer sees reason, order stays in history, customer may create new order, customer notified. Removed answered Q3 from open questions. Added 1 entry to clarifications table.
- **07_RETURN_RULES.md** — Added RETURNS_SOURCE (returns must link to a previously purchased order; no customer-level returns without order). Added RETURN_REVIEW_AUTHORITY (Upper Management only decides accept/reject). Removed answered Q4 from open questions. Added 2 entries to clarifications table.
- **07_PROMOTIONAL_SYSTEMS.md** — Added PROMOTIONS_AND_TIERS section: pricing tiers never apply to Daily Deals, Flash Offers, or Auctions; each has independent pricing; no tier stacking. Added 1 entry to clarifications table.
- **08_PRICING_AND_TIERS_RULES.md** — Removed answered Q1 (daily deals + tiers interaction) and Q2 (flash offers + tiers interaction) from open questions. Added 1 entry to clarifications table.
- **04_CUSTOMER_RULES.md** — Updated CREDIT_START_DATE: credit obligation begins on delivery (تم الاستلام), not on approval. Credit aging/tracking starts at delivered status. Updated clarifications table entry.
- **08_PRICING_AND_TIERS_RULES.md** — Added TIER_ELIGIBILITY_CALCULATION (Daily Deals, Flash Offers, Auctions excluded from tier qualification), CART_TOTALS (promotional values included in cart/order/sales/reporting/target totals), TIER_QUALIFICATION_EXAMPLE (illustrative tier calculation excluding Daily Deal), TIER_AND_PROMOTION_SEPARATION_PRINCIPLE (prevent discounted purchases from artificially satisfying tier requirements). Updated clarifications table with 3 entries.
- **07_PROMOTIONAL_SYSTEMS.md** — Updated PROMOTIONS_AND_TIERS section: added that promotional values do NOT contribute toward tier qualification but ARE included in all totals; added cross-reference to 08_PRICING_AND_TIERS_RULES.md. Added 1 entry to clarifications table.

### Corrected

- **SUPREME_BOARD** section in `02_ORGANIZATIONAL_MODEL.md` — Updated member names from English (Yasser Tawfik, Mohamed Said, Ali Said, Mahmoud Said) to Arabic (ياسر توفيق, محمد سعيد, علي سعيد, محمود سعيد). Added clarification that these are current members and the board is not permanently limited to four.
- **Hierarchy** in `02_ORGANIZATIONAL_MODEL.md` — Updated to include Supreme Board at top and replace Supervisor (مسؤول) with مدير بيع (Sales Manager).

**Source documents used:**
- PROJECT_STATE_HANDOFF.md
- FINAL_CANONICAL_MASTER_REFERENCE_V2.md
- FINAL_EXECUTIVE_SUMMARY_V2.md
- 15_BLUEPRINT_VERIFICATION_AUDIT.md
- 16_RUNTIME_SOURCE_OF_TRUTH_MAP.md
- NEW_CHAT_BOOTSTRAP.md

---

*End of 00_CHANGELOG.md*
