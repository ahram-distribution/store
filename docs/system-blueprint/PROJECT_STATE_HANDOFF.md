# PROJECT STATE HANDBOOK — Authoritative Handoff Document

> **Purpose:** Single onboarding reference for any future developer, AI agent, or audit session.  
> **Basis:** V2 Canonical Master Reference, V2 Executive Summary, Verification Audit, Runtime Source of Truth Map.  
> **Rule:** When older documents disagree with this file, this file wins. When V2 disagrees with V1, V2 wins.  
> **Date:** 2026-06-09  
> **Production Readiness Score:** 58/100

---

## 1. Project Identity

| Attribute | Value |
|-----------|-------|
| **System type** | Wholesale B2B distribution management platform |
| **Market** | Egyptian market |
| **Scale** | ~25 active customers, ~700 products, 38 orders, 16 employees |
| **Tech stack** | Frontend → `supabase.rpc('governed_*')` → PostgreSQL. Supabase Auth for identity. Zustand for client state. React/TypeScript SPA. |
| **Business model** | Distributor-mediated B2B: sales representatives (employees) visit customers, take orders, collect payments, manage returns. |
| **Operational model** | Customer registration → order placement → warehouse preparation → delivery → collection → returns → credit management → auctions (supplementary). |
| **Governance model** | "Governed RPC" pattern: all write operations go through `governed_*` PostgreSQL functions that enforce auth, validate inputs, generate codes, maintain audit trails. 20 exceptions bypass this layer. |
| **Ownership hierarchy** | Employees report to managers (self-referencing `employees.manager_id`). Customers are owned by employees (`customers.owner_id`). Companies are independent entities with tier-based pricing. |
| **Customer model** | Identity (`identities` table, phone-based login) + Profile (`customers` table) + Contacts (`customer_contacts` table) + Addresses (`unified_locations` canonical, `customer_addresses` legacy) + Credit accounts (`customer_credit_accounts`). |
| **Employee model** | Identity (Supabase Auth) + Profile (`employees` table) + Role (`roles` table, `employees.role_id`) + Capabilities (`role_capabilities` base + `employee_capabilities` overrides) + Manager hierarchy. |

---

## 2. Current Production Reality

All counts are source-verified against 52 SQL migration files, 82 frontend source files, 91 page components, and 10 service files.

| Metric | Verified Count | Notes |
|--------|---------------|-------|
| Database tables | **63** (62 public + 1 app) | 48 active, 13 dead, 2 legacy |
| Database functions (total) | **231** (9 app + 222 public) | Includes all `governed_*`, `get_*`, test, internal, auth |
| RPCs callable via supabase.rpc() | **~210** | 222 public minus ~12 internal/utility |
| RPCs with frontend callers | **~85** | ~85 have at least one direct or service-mediated call site |
| Orphaned RPCs (defined, no callers) | **19** | 7 fewer than V1 claimed (7 were reclassified to "Used") |
| Test functions | **7** | test_ping2, test_ping3, test_rpc, test_setof, test_func, multiline_test, ping |
| Internal SQL functions | **~13** | _calc_base_unit_price, ensure_system_customer_owner, app.* functions, etc. |
| Database views | **0** | Zero CREATE VIEW across all 52 migrations |
| Database triggers | **0** | Zero CREATE TRIGGER across all 52 migrations |
| Database enums | **14** | Various status/lifecycle types |
| Page components | **91** | Non-barrel .tsx files in src/pages/ |
| Functional pages (render UI + fetch data) | **86** | Classified as Live RPC Data (61), Service-Layer Data (15), supabase.from bypass (9), Store/State only (6) |
| Static/navigation pages | **4** | DashboardPage, ModuleLauncherPage, SubLauncherPage, SecurityWorkspace |
| Empty/near-empty pages | **1** | ActivityPage (placeholder cards, coming-soon message) |
| Barrel export pages | **3** | credit/index.tsx, delivery/index.tsx, warehouse/index.tsx |
| Service files | **10** | src/services/*.ts — all wrap supabase.rpc() calls |
| Pure state stores | **5** | cart, orders, companies, visits, account (all zustand) |
| Governance bypasses | **20** | Direct `supabase.from()` calls across 10 files |
| Workflows total | **39** | 27 operational, 4 partial, 3 broken, 1 orphaned |

---

## 3. Canonical Sources of Truth

| Concept | Canonical Source | Status |
|---------|-----------------|--------|
| Customer Identity (login) | `identities` table (phone is the unique login key) | GREEN |
| Customer Profile | `customers` table | GREEN |
| Customer Address (current) | `unified_locations` table | **RED** — dual SOT with customer_addresses |
| Customer Address (legacy) | `customer_addresses` table | **RED** — legacy dual SOT |
| Customer GPS Coordinates | `unified_locations.geom` (PostGIS) | **RED** — dual SOT with customers.lat/lng |
| Customer Contact | `customer_contacts` table | YELLOW — denormalized to customers.phone_1/phone_2 |
| Customer Ownership (current) | `customers.owner_id` | GREEN |
| Customer Ownership (history) | `customer_ownership_history` | GREEN |
| Customer Credit Account | `customer_credit_accounts` table | **RED** — dual SOT with customers.credit_limit |
| Credit Limit (legacy) | `customers.credit_limit` + `customers.credit_days` | **RED** — superseded by customer_credit_accounts |
| Employee Profile | `employees` table | GREEN |
| Employee Auth | Supabase Auth (`auth.users`) | GREEN |
| Employee Role | `employees.role_id` + `roles` table | YELLOW — employee_roles is dead schema |
| Capabilities | `role_capabilities` + `employee_capabilities` | GREEN |
| Order Header | `orders` table | GREEN |
| Order Item | `order_items` table | GREEN |
| Order Status (current) | `orders.status` column | GREEN |
| Order Status (audit) | `order_status_history` table | YELLOW — overlaps with order_modification_history |
| Order Snapshot | `orders.snapshot_items` + `orders.snapshot_totals` (JSONB) | GREEN |
| Product | `products` table | GREEN |
| Product Unit | `product_units` table | YELLOW — denormalized to products.carton_quantity |
| Product Pricing | `products.carton_price` + `products.unit_price` + `products.wholesale_price` | GREEN |
| Inventory | `inventory` table | GREEN (manual updates only) |
| Company | `companies` table | GREEN |
| Company Profile | `company_profile` table (EAV pattern) | GREEN |
| Tier | `tiers` table | GREEN |
| Tier Company Exception | `tier_company_exceptions` table | GREEN |
| Tier Product Exception | `tier_product_exceptions` table | GREEN |
| Collection | `collections` table | GREEN |
| Return | `returns` table | GREEN (no create path) |
| Credit Program | `credit_programs` table | GREEN |
| Credit Application | `credit_applications` table | GREEN |
| Credit Ledger | `customer_credit_ledger` table | GREEN |
| Credit Invoice | `credit_invoices` table | GREEN |
| Credit Invoice Cheque | `credit_invoice_cheques` table | GREEN |
| Visit | `visits` table | YELLOW — unified_locations used for named GPS reference |
| Delivery | `delivery_tracking` table | GREEN |
| Warehouse Preparation | `preparation_records` table | GREEN |
| Warehouse Exception | `preparation_exceptions` table | GREEN |
| Company Target | `company_monthly_targets` table | GREEN |
| Employee Target | `employee_monthly_targets` table | GREEN |
| Daily Deal | `daily_deals` + `daily_deal_items` tables | GREEN |
| Flash Offer | `flash_offers` + `flash_offer_items` tables | GREEN |
| Auction | `auctions` + 5 related tables | GREEN |
| System Config | `system_config` table | GREEN |
| Code Sequence | `code_sequences` table | GREEN |

**Summary:** 31 GREEN (single SOT), 7 YELLOW (managed), **3 RED** (spanning 4 dual SOTs — must be migrated).

---

## 4. Confirmed Architectural Risks

### Critical

| # | Risk | Domain | Verified Evidence |
|---|------|--------|-------------------|
| R1 | `governed_approve_order` is never called — all order approvals use generic `governed_change_order_status` | Orders | Verified in `OrderStatusManager.tsx:88`. The dedicated approval RPC (contains inventory deduction + credit invoice creation) has zero frontend call sites. Stock never decreases; credit customers never invoiced. |
| R2 | `governed_deny_order` does not exist in any of 52 SQL migration files | Orders | 0 grep hits across all migration files. Order rejection uses `governed_change_order_status` — a generic status transitioner with no denial-specific logic. |
| R3 | 7 RPCs were incorrectly classified as Orphaned in V1 — would have been dropped under V1 cleanup plan | Governance | `governed_create_daily_deal`, `governed_create_flash_offer`, `governed_create_credit_application`, `governed_create_location`, `governed_suspend_credit`, `governed_release_credit_reservation`, `governed_suspend_credit_account` all have frontend call sites via service layer. Dropping them would break daily deals, flash offers, credit applications, locations, and credit suspension. |

### High

| # | Risk | Domain | Verified Evidence |
|---|------|--------|-------------------|
| R4 | 20 governance bypasses across 10 files — direct `supabase.from()` calls bypass all auth/validation/code-gen | Governance | 9 documented in V1; 11 additional undocumented bypasses found in EmployeeAnalysisPage (3), AccountPage (1), StorefrontPage (2), StorefrontCompaniesPage (1), VisitScreen (2), services/targets.ts (2). |
| R5 | Auctions use raw `supabase.from('auctions').insert()` — no governed RPC exists in migrations | Auctions | `governed_create_auction` is not defined in any SQL migration file (0 grep hits). All validation, code generation, and auth checks are bypassed. |
| R6 | 60% of customers (estimated 15/25) have NULL `location_id` — dual-read path active | Data | CustomerProfilePage reads both `unified_locations` and `customer_addresses` in parallel. The migration is incomplete. |
| R7 | Three RPC names in documentation differ from actual SQL names | Docs | `governed_reserve_credit` (actual: `governed_reserve_credit_for_order`), `governed_pay_credit_invoice` (actual: `governed_record_credit_payment`), `governed_register_cheque` (actual: `governed_record_cheque`). Planning with wrong names causes wire-up failures. |

### Medium

| # | Risk | Domain | Verified Evidence |
|---|------|--------|-------------------|
| R8 | Three RPCs referenced in documentation do not exist in any SQL migration | Schema | `governed_deny_order`, `governed_create_auction`, `governed_reassign_customer_ownership` — 0 grep hits across 52 migrations. May exist in live DB only. Cannot be verified without direct DB access. |
| R9 | Return creation UI is entirely missing | Returns | `governed_create_return` RPC exists in SQL but has zero frontend call sites. Return read/approve/reject work; create does not. |
| R10 | Credit financial subsystem is half-built | Credit | Payment UI exists (CreditManagementPage). Ledger display, cheque management, account activation/suspension, credit reservation UIs are all missing. 6 of 9 creditService methods have no page callers. |
| R11 | No credit reservation during order placement | Financial | `governed_reserve_credit_for_order` RPC exists and is wrapped by `creditService.reserveCreditForOrder()`, but no page calls it. Credit customers can exceed their limit unchecked. |
| R12 | 4 active dual SOTs with no synchronization | Data | Customer Address (unified_locations vs customer_addresses), Customer GPS (unified_locations.geom vs customers.lat/lng), Credit Limit (customer_credit_accounts.credit_limit vs customers.credit_limit), Credit Payment Terms (customer_credit_accounts.payment_terms vs customers.credit_days). Zero sync for GPS and credit; one-directional sync trigger for addresses. |

---

## 5. Confirmed Dual Sources of Truth

All items below are **RED** — active duplication with risk of data inconsistency. Source: Runtime Source of Truth Map Section A.

| # | Concept | Source A (Canonical) | Source B (Secondary) | Sync Mechanism | Risk Level | Recommended Migration |
|---|---------|---------------------|---------------------|----------------|------------|----------------------|
| D1 | Customer Address | `unified_locations` | `customer_addresses` | `unified_address_sync` trigger (one-directional: UL → CA) | HIGH — trigger can fail; CA writes bypass UL | Move all reads to `unified_locations`. Retire `customer_addresses`. Remove sync trigger. |
| D2 | Customer GPS | `unified_locations.geom` | `customers.lat`, `customers.lng` | None — manual update only | HIGH — no sync at all | Extract geom → lat/lng via computed columns or view. Remove columns when all consumers migrate. |
| D3 | Credit Limit | `customer_credit_accounts.credit_limit` | `customers.credit_limit` | None — manual update only | HIGH — no sync | Migrate CustomerProfilePage and `governed_create_credit_application` to read/write `customer_credit_accounts`. Drop `customers.credit_limit`. |
| D4 | Credit Payment Terms | `customer_credit_accounts.payment_terms` | `customers.credit_days` | None — manual update only | MEDIUM | Same migration path as D3. |

**Note:** 9 additional runtime duplications exist (R1–R9 in Source of Truth Map Section C) but are classified YELLOW — intentional, actively managed, or separate concerns. They require no emergency action.

---

## 6. Dead Assets

### 6.1 Dead Tables (13 — Verified Safe to Remove)

All verified via grep: zero references in frontend code, SQL function bodies, triggers, views, or service files.

| Table | Classification | Safe To Remove? | Evidence |
|-------|---------------|-----------------|----------|
| customer_classification | DEAD | Yes | No references anywhere |
| customer_daily_deal | DEAD | Yes | No references anywhere |
| deal | DEAD | Yes | No code references (variable names excluded; commented ref in migration line 9) |
| follow_up | DEAD | Yes | Name only appears as enum value in CHECK constraint, not as table reference |
| notification | DEAD | Yes | No references anywhere |
| permission | DEAD | Yes | String literal 'PERMISSION_DENIED' only; no table reference |
| visit_note | DEAD | Yes | No references anywhere |
| voucher_type | DEAD | Yes | No references anywhere |
| sync_log | DEAD | Yes | No references anywhere |
| activity_log | DEAD | Yes | No references anywhere |
| packages | DEAD | Yes | Defined in migration (phase9) but zero code references |
| package_items | DEAD | Yes | Same as packages |
| package_orders | DEAD | Yes | Same as packages |

### 6.2 Dead RPCs (19 — 7 Safe, 12 Blocked)

**Safe to remove (7):** test_ping2, test_ping3, test_rpc, test_setof, test_func, multiline_test, ping — all test/health-check only. Zero production callers.

**Blocked (12):** governed_approve_order, governed_deny_order (needs approval refactor), governed_create_return, governed_update_return (needs return UI), governed_update_collection (needs collection edit), governed_create_visit (checkin handles creation), governed_update_flash_offer (needs flash offer feature), governed_submit_credit_application (needs credit flow), governed_update_contract_template (needs contract feature), governed_create_auction, governed_reassign_customer_ownership, governed_update_collection.

### 6.3 Dead Service Methods (9 — Blocked)

All in `creditService`: activateAccount, suspendAccount, reactivateAccount, recordCheque, reserveCreditForOrder, releaseCreditReservation, convertReservationToOutstanding, getCustomerLedger, getCustomerStatements. All wrap governed RPCs but have zero page callers. Part of the incomplete credit subsystem.

### 6.4 Dead Columns (8 — Safe to Remove)

| Table.Column | Safe To Remove? | Evidence |
|-------------|-----------------|----------|
| customers.email | Yes | Removed from all UIs, NULLABLE |
| orders.snapshot_sender_name | Yes | Superseded by snapshot_owner_name |
| orders.snapshot_sender_phone | Yes | Superseded by snapshot_owner_phone |
| orders.snapshot_sender_address | Yes | Superseded by snapshot_owner_address |
| orders.execution_latitude | Yes | Superseded by execution_location_id |
| orders.execution_longitude | Yes | Superseded by execution_location_id |
| orders.execution_accuracy_meters | Yes | Superseded by execution_location_id |
| orders.execution_captured_at | Yes | Superseded by execution_location_id |

### 6.5 Dead Screen (1)

| Screen | Safe To Remove? | Evidence |
|--------|-----------------|----------|
| ActivityPage | Yes (needs product decision) | Renders placeholder cards with Arabic "coming in future updates" message. No supabase calls. No data fetching. |

### 6.6 Assets Requiring Migration (Not Dead)

These are legacy assets still in active use. Not safe to remove without migration:

| Asset | Type | Used By | Must Not Be Removed Until |
|-------|------|---------|---------------------------|
| `customer_addresses` table | Legacy dual SOT | CustomerProfilePage, CustomerAddressPage, governed_create_customer_address RPC | All reads migrated to `unified_locations` |
| `customers.lat`, `customers.lng` | Legacy dual SOT | CustomerProfilePage, governed_create_location RPC | All consumers switch to `unified_locations.geom` |
| `customers.credit_limit`, `customers.credit_days` | Legacy dual SOT | CustomerProfilePage, governed_create_credit_application RPC | All consumers switch to `customer_credit_accounts` |
| `governed_create_customer_address` RPC | Legacy write path | CustomerProfilePage, CustomerAddressPage | RPC body updated to write to `unified_locations` |
| `employee_roles` table | Dead schema (no consumers) | None (zero code references) | Product decision on multi-role support |

---

## 7. Frontend Governance Status

### 7.1 Governed Pages (Use `supabase.rpc()` Through Service Layer)

~61 pages use direct `supabase.rpc()` calls. ~15 additional pages go through service wrappers (creditService, targetService, flashOfferService, etc.) that internally call RPCs. Total: ~76 pages respect the governed RPC architecture.

### 7.2 Pages Using Direct `supabase.from()` — Governance Bypasses

20 bypasses across 10 files. These pages read from or write to tables directly, bypassing all governed RPC auth, validation, and code-generation logic.

| # | File | Table | Operation | Risk | Line |
|---|------|-------|-----------|------|------|
| 1 | AuctionsManagerPage.tsx | auctions | update | HIGH | 75 |
| 2 | AuctionsManagerPage.tsx | auctions | insert | HIGH | 96 |
| 3 | DailyDealsManagerPage.tsx | daily_deals | update | HIGH | 100 |
| 4 | ProductManagerPage.tsx | products | update (image_url) | MEDIUM | 161 |
| 5 | ProductManagerPage.tsx | products | update (is_visible) | MEDIUM | 166 |
| 6 | ProductManagerPage.tsx | inventory | upsert | MEDIUM | 177 |
| 7 | CompanyManagerPage.tsx | companies | select (full row) | LOW | 72 |
| 8 | CompanyManagerPage.tsx | companies | update (logo_url) | MEDIUM | 113 |
| 9 | CompanyManagerPage.tsx | companies | update (is_visible) | MEDIUM | 118 |
| 10 | StorefrontCompaniesPage.tsx | companies | select (public) | MEDIUM | 23 |
| 11 | StorefrontPage.tsx | products | select (public) | MEDIUM | 91 |
| 12 | StorefrontPage.tsx | tiers | select (public) | MEDIUM | 128 |
| 13 | EmployeeAnalysisPage.tsx | employees | select | MEDIUM | 195 |
| 14 | EmployeeAnalysisPage.tsx | customers | select | MEDIUM | 202 |
| 15 | EmployeeAnalysisPage.tsx | visits | select | MEDIUM | 267 |
| 16 | VisitScreen.tsx | visits | select (verification) | LOW | 136 |
| 17 | VisitScreen.tsx | visits | select (verification) | LOW | 183 |
| 18 | AccountPage.tsx | customer_addresses | select | MEDIUM | 152 |
| 19 | services/targets.ts | employees | select | MEDIUM | 148 |
| 20 | services/targets.ts | employee_roles | select | MEDIUM | 157 |

### 7.3 Known Exceptions

- **Auctions:** No governed RPC exists for auction creation in SQL migrations. The `supabase.from()` bypass is the ONLY path — not merely a bypass of an existing RPC.
- **Storefront public reads:** StorefrontPage and StorefrontCompaniesPage use `from()` for public product/company/tier reads. No governed RPCs exist for anonymous public access.
- **EmployeeAnalysisPage:** Uses `from()` for a post-RPC ID-resolution pattern — fetches IDs via RPC, then resolves names via direct `from()`. This is a design issue, not a simple bypass.

### 7.4 Known Exceptions (Undocumented in V1 — Discovered During Verification Audit)

11 bypasses across 6 additional files were NOT documented in V1:
- EmployeeAnalysisPage.tsx: 3 bypasses
- AccountPage.tsx: 1 bypass
- StorefrontPage.tsx: 2 bypasses
- StorefrontCompaniesPage.tsx: 1 bypass
- VisitScreen.tsx: 2 bypasses
- services/targets.ts: 2 bypasses

---

## 8. Workflow Status Matrix

| # | Workflow | Status | Key Evidence |
|---|----------|--------|-------------|
| 1 | Customer Self-Registration | **Operational** | register_customer RPC from auth.ts |
| 2 | Managed Customer Creation | **Operational** | governed_create_customer from NewCustomerPage |
| 3 | Employee Creation | **Operational** | governed_create_employee |
| 4 | Login | **Operational** | authService.login() |
| 5 | Visit Check-In | **Operational** | governed_checkin_visit |
| 6 | Visit Check-Out | **Operational** | governed_checkout_visit |
| 7 | Order Creation | **Operational** | governed_create_order |
| 8 | Order Submission | **Operational** | governed_submit_order |
| 9 | Order Approval | **Broken** | Inventory never deducted. `governed_approve_order` orphaned. All status transitions use `governed_change_order_status` (generic). |
| 10 | Order Rejection | **Broken** | `governed_deny_order` not defined in any of 52 SQL migration files. Rejection uses generic `governed_change_order_status`. |
| 11 | Warehouse Preparation | **Operational** | governed_start_preparation |
| 12 | Warehouse Completion | **Operational** | governed_complete_preparation |
| 13 | Warehouse Review | **Operational** | governed_review_preparation |
| 14 | Order Dispatch | **Operational** | governed_dispatch_order |
| 15 | Delivery Assignment | **Operational** | governed_assign_delivery |
| 16 | Delivery Confirmation | **Operational** | governed_confirm_delivery |
| 17 | Collection Creation | **Operational** | governed_create_collection |
| 18 | Collection Approval | **Operational** | governed_approve_collection |
| 19 | Return Creation | **Broken** | `governed_create_return` exists in SQL but zero frontend call sites. No UI creates returns. |
| 20 | Return Approval | **Operational** | governed_approve_return |
| 21 | Return Rejection | **Operational** | governed_reject_return |
| 22 | Credit App Creation | **Partial** | V1 said Broken. CustomerCreditPage has creation UI. But no draft→submit→approve pipeline exists. |
| 23 | Credit App Documents | **Operational** | governed_confirm_documents |
| 24 | Credit App Approval | **Operational** | governed_manage_credit_application |
| 25 | Credit App Rejection | **Operational** | governed_decline_credit |
| 26 | Credit Program CRUD | **Operational** | All program RPCs called from pages |
| 27 | Product CRUD | **Operational** | governed_create/update_product |
| 28 | Company CRUD | **Operational** | governed_create/update_company |
| 29 | Tier CRUD + Exceptions | **Operational** | governed_create/update_tier |
| 30 | Daily Deal Management | **Partial** | Mix of governed RPC + from() bypass for field-level updates |
| 31 | Flash Offer Management | **Orphaned** | Service layer only (flashOfferService). No confirmed page integration wiring. |
| 32 | Auction Management | **Partial** | Raw supabase.from().insert()/update() bypass. No governed RPC in migrations. |
| 33 | Dashboard Views | **Operational** | 15+ aggregate RPCs, 26 workspace screens |
| 34 | Target Management | **Operational** | targetService with from() bypasses for employee lookups |
| 35 | Customer Ownership Change | **Operational** | governed_change_customer_ownership |
| 36 | Employee Manager/Role | **Operational** | governed_change_employee_manager/role |
| 37 | Global Search | **Operational** | governed_global_search |
| 38 | Reports | **Partial** | Dynamic supabase.rpc() — report type determined at runtime |
| 39 | Customer Analytics | **Operational** | get_customer_card/products/brands |

**Summary:** 27 Operational, 4 Partial, 3 Broken, 1 Orphaned.

---

## 9. Production Blockers

| ID | Blocker | Category | Impact | Root Cause | Verified? |
|----|---------|----------|--------|------------|-----------|
| B1 | Inventory never deducted on order approval | **Missing Business Logic** | Stock levels never decrease. Warehouse overselling possible. All quantities remain at initial levels. | `governed_approve_order` (contains inventory deduction) is never called. All approvals use generic `governed_change_order_status`. | **100%** |
| B2 | Credit invoices never created on approval | **Missing Business Logic** | Credit customers cannot be billed. Invoice creation logic lives in same uncalled RPC as B1. | Same root cause as B1. `governed_approve_order` contains `INSERT INTO credit_invoices` logic that never executes. | **100%** |
| B3 | Returns cannot be created through UI | **Missing UI** | Staff cannot process returns. RPC exists but no frontend caller. Read/approve/reject work. | `governed_create_return` has zero frontend call sites. No page in src/pages/returns/ calls it. | **100%** |
| B4 | Credit financial operations limited | **Partial UI** | Payment UI exists (CreditManagementPage). Ledger display, cheque management, credit reservation UIs are missing. 6 of 9 service methods have no page callers. | Credit subsystem never completed. Activation, suspension, ledger, statements, reservation UIs not built. | **95%** (payment UI exists, contrary to V1 claim of full blocker) |
| B5 | No credit reservation during order | **Missing Workflow Link** | Credit customers can exceed their credit limit unchecked. No integration between order creation and credit reservation. | `governed_reserve_credit_for_order` RPC exists but no page calls it. No order page triggers reservation. | **100%** |
| B6 | Auctions bypass governed RPC | **Missing Business Logic** | Raw inserts skip all validation, code generation, auth checks, and audit trails for auction creation. | AuctionsManagerPage uses `supabase.from('auctions').insert()` directly. `governed_create_auction` not defined in any SQL migration. | **100%** |
| B7 | 60% customers on legacy addresses | **Incomplete Migration** | ~15/25 customers have NULL location_id in unified_locations. Dual-read path remains active. Data integrity risk. | Migration from customer_addresses → unified_locations was never completed for all customers. | **95%** (exact count requires live DB) |

---

## 10. Recent Major Changes

The following work is documented as **already completed** in prior blueprint analysis. This section records factual findings about the current state — not instructions for future work.

### 10.1 Customer Address Migration (Unified Locations)

- `unified_locations` table established as canonical address storage.
- `customer_addresses` table retained as legacy — dual-read path still active in AccountPage and CustomerProfilePage.
- `unified_address_sync` trigger copies from unified_locations → customer_addresses for backward compatibility.
- **Not complete:** ~15/25 customers still have NULL location_id. Dual-read path remains active.

### 10.2 Customer Update Paths

- `governed_create_customer` RPC writes to both `customers` and `unified_locations` (new customers get location_id).
- `governed_update_customer` RPC allows profile updates including phone_1/phone_2.
- Two parallel customer creation paths exist: NewCustomerPage (governed_create_customer) and RegistrationPage (register_customer). Both serve different use cases (managed vs self-registration).

### 10.3 GPS-Optional Customer Creation

- Customer creation does not require GPS coordinates.
- `governed_create_location` RPC exists for adding locations after customer creation.
- `customers.lat/lng` is a legacy dual-storage of GPS data that also lives in `unified_locations.geom`.

### 10.4 Email Removal

- `customers.email` column is still present in the database schema but is NULLABLE and removed from all UIs.
- CustomerProfilePage no longer displays or edits email.

### 10.5 Data Cleanup (Documented as Safe — Not Yet Executed)

The following cleanup actions are documented as safe but there is no confirmed evidence they have been executed:
- 13 dead tables: identified, verified safe to drop
- 8 dead columns: identified, verified safe to drop
- 7 test RPCs: identified, verified safe to drop

### 10.6 Snapshot Repairs

- `orders.snapshot_items` and `orders.snapshot_totals` are frozen at order finalization.
- `orders.snapshot_sender_name/phone/address` superseded by `snapshot_owner_name/phone/address`.
- `orders.execution_latitude/longitude/accuracy_meters/captured_at` superseded by `execution_location_id`.

---

## 11. Data Cleanup Status

| Question | Answer |
|----------|--------|
| **What was deleted?** | No confirmed deletions — all cleanup actions remain at the "documented as safe" stage. No SQL DROP commands have been executed based on blueprint analysis. |
| **What remains?** | 63 tables total: 48 active, 13 dead, 2 legacy (customer_addresses, employee_roles). 19 orphaned RPCs remain defined in the database. 8 dead columns remain in schema. 1 ActivityPage remains in the codebase. |
| **Is the database production-grade?** | **Partially.** The schema is well-structured with proper FKs, enums, and governed RPC layer. However: inventory is never deducted (all stock values are initial), ~15/25 customers lack unified_locations, credit limit is split across two tables with no sync, 3 RPCs referenced in documentation do not exist in migrations, and 231 functions exist but only ~85 are actively used from the frontend. |
| **Is the data operational or test?** | **Mixed:** 25 customers, 38 orders, 394 order items, 13 visits, 6 collections, 3 returns, 3 credit applications, 3 credit accounts, 700+ products, 9465 employee_activity rows, 30+ unified_locations — these appear to be operational/test data from development. No confirmed production tenant data has been identified. 8 tables are structurally empty (daily_deals 0 rows, flash_offers 0 rows, preparation_records 0 rows, credit_contracts 0 rows, employee_advances 0 rows, etc.). |

---

## 12. Rules for Future Engineers

### MUST NOT

1. **MUST NOT delete tables based on schema inspection only.** Always verify runtime usage via grep across frontend (.ts/.tsx), service (.ts), and SQL files. 13 tables are verified dead; verify any new candidate the same way.

2. **MUST NOT remove RPCs without runtime verification.** 7 RPCs classified as Orphaned in V1 are actually Used. A grep for `rpc('name'` only catches direct calls — also check service-layer wrappers and dynamic RPC resolution patterns (e.g., `action()` helper in CreditReviewPage).

3. **MUST NOT introduce new sources of truth.** If you need to store a concept already covered by an existing canonical table, extend that table — do not create a parallel storage location. The 3 active RED dual SOTs are a direct result of violating this rule.

4. **MUST NOT bypass the governed RPC architecture.** If you need to read/write a table for which no governed RPC exists, create one — do not use `supabase.from()`. The 20 existing bypasses are technical debt, not a pattern to follow.

5. **MUST NOT modify `OrderStatusManager.tsx` without understanding B1/B2.** The single `governed_change_order_status` call at line 88 handles ALL status transitions. It must be refactored to call `governed_approve_order` for the `submitted→approved` transition, but doing so changes inventory deduction and credit invoicing behavior.

6. **MUST NOT remove `customers.credit_limit`/`credit_days` columns until CustomerProfilePage and `governed_create_credit_application` are migrated to `customer_credit_accounts`.**

7. **MUST NOT remove `customer_addresses` table until CustomerProfilePage, CustomerAddressPage, and `get_governed_customer_addresses` are migrated to `unified_locations`.**

8. **MUST NOT assume V1 is correct.** The V1 Blueprint contained 25 verified discrepancies, including 7 misclassified RPCs that would have broken the system if dropped. Always verify against V2.

### MUST

1. **MUST update blueprint documents after any architectural change.** The blueprint chain (V2 → Executive Summary V2 → Verification Audit → Runtime SOT Map → Handoff) is the single source of truth about system state. Out-of-date blueprints have caused documented damage.

2. **MUST verify runtime usage before any cleanup.** The audit methodology: grep for frontend call sites (`rpc('name',`), grep for SQL internal calls (function body references), check service-layer wrappers, check dynamic RPC patterns. Document all findings before acting.

3. **MUST preserve the ownership model.** `customers.owner_id` + `customer_ownership_history` is the canonical ownership system. Never query `customer_ownership_history` for current ownership — use `customers.owner_id`.

4. **MUST use the governed RPC layer for all writes.** Create a new `governed_*` function for any write operation that lacks one. The only acceptable exceptions are: (a) Supabase Auth reads for session validation, (b) public/anonymous reads for Storefront.

5. **MUST route order approval through `governed_approve_order`** (not `governed_change_order_status`) once the approval refactoring is undertaken. This is the single most impactful fix available.

6. **MUST consider `employee_roles` dead schema unless multi-role support is explicitly planned.** No code path reads or writes it. It can be dropped or retained based on a product decision — but do not assume it is actively used.

7. **MUST verify live DB state for 3 RPCs** not found in SQL migrations: `governed_deny_order`, `governed_create_auction`, `governed_reassign_customer_ownership`. These may exist in the live database only and cannot be assessed from migration files alone.

---

## 13. Next Recommended Audit

Ranked by risk and business impact. These are investigations only — no implementation, no cleanup, no migrations.

| Rank | Area | Why | Method |
|------|------|-----|--------|
| **1** | **Live DB function enumeration** | 231 functions exist in migrations; only ~85 confirmed used from frontend. 3 RPCs referenced in docs do not exist in migrations at all. Live DB may contain additional functions, triggers, or views not captured in migration files. | Connect to live database, enumerate all functions with `pg_proc`, compare against migration-derived list. |
| **2** | **8 empty tables** | daily_deals (0 rows), flash_offers (0 rows), preparation_records (0 rows), credit_contracts (0 rows), employee_advances (0 rows), etc. Determine if these are pre-migration placeholders or feature gaps that need resolution. | Review each empty table against its frontend callers to determine if emptiness is expected (e.g., no deals created yet) or a sign of broken workflow. |
| **3** | **Customer address dual-read impact** | 15/25 customers estimated with NULL location_id. The exact count affects P1 migration effort. Dual-read pattern in CustomerProfilePage and AccountPage needs resolution. | Live DB query: SELECT COUNT(*) FROM customers WHERE location_id IS NULL. Review all customers without location_id to determine if they have customer_addresses rows. |
| **4** | **Governance bypass risk assessment for HIGH bypasses** | 3 bypasses classified HIGH (AuctionsManagerPage writes, DailyDealsManagerPage update). These bypass all auth and validation. Determine if any of these create security or data integrity risks. | Code review each HIGH bypass: what validation is skipped? Can a malicious user exploit the bypass? Is the bypass used in production workflows? |
| **5** | **Frontend RPC coverage completeness** | ~107 functions remain in the "defined, frontend-accessible, uncalled" category. Determine which of these are: (a) future analytics endpoints, (b) unused but harmless, (c) accidentally orphaned. | Cross-reference every function definition against frontend call sites. Categorize each uncalled function. |

---

## 14. Executive Conclusion

**Is the system understood?** Yes — comprehensively. 63 tables, 231 functions, 91 pages, 10 services all mapped and verified against source code. 25 discrepancies between V1 and reality are documented and corrected in V2. The system architecture (Frontend → supabase.rpc('governed_*') → PostgreSQL) is well-defined, with 20 known exceptions.

**Is the architecture stable?** Partially. The governed RPC layer provides good write-path discipline for ~76 pages. However: 20 bypasses exist in 10 files, 4 active dual SOTs risk data inconsistency, 3 critical workflows are broken (order approval, order rejection, return creation), and the credit subsystem is half-built. The Readiness Score of 58/100 reflects a system that displays data well but has critical gaps in financial and operational write paths.

**What remains uncertain?** Three things: (1) The exact state of 3 RPCs (`governed_deny_order`, `governed_create_auction`, `governed_reassign_customer_ownership`) that are referenced in documentation but do not exist in any of 52 SQL migration files — they may exist in the live DB only. (2) The exact count of customers on legacy addresses vs unified_locations — the 60% estimate (15/25) is plausible but unconfirmed without a live DB query. (3) Whether the 8 empty tables (daily_deals 0 rows, etc.) are intentional (feature not yet used) or symptomatic of broken workflows.

**What should be protected?** The governed RPC architecture is the system's most valuable design pattern — it enforces auth, validation, code generation, and audit trails at the database level. It must be protected and extended, not bypassed. The canonical table definitions in Section 3 of the V2 Master Reference are the authoritative source for what each concept means and where it lives. The ownership model (`customers.owner_id` + `customer_ownership_history`) should be preserved as-is.

**What should be investigated next?** The single highest-value investigation is a live DB function enumeration (Rank 1 in Section 13). This would: (a) confirm whether the 3 migration-absent RPCs exist, (b) reveal any triggers or views not captured in migration files, (c) provide an exact count of functions vs the approximate ~85 used count, and (d) allow final cleanup planning with complete confidence. No schema changes, migrations, or cleanup should be executed until this audit is complete.

---

*End of PROJECT_STATE_HANDOFF.md*
*This document is the single authoritative reference for the project state. If you discover information contradicting this document during future work, update this file and document the discrepancy.*
