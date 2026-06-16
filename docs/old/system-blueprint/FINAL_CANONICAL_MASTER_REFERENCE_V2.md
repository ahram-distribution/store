# Final Canonical Master Reference — V2 (Corrected)

> **Single authoritative reference — V2 incorporates all corrections from the independent verification audit.**  
> **Source-verified across:** 52 SQL migration files, 91 page components, 10 service files, 231 database functions, 63 tables.  
> **Date:** 2026-06-09 | **Readiness Score:** 58/100

---

## CORRECTIONS_FROM_VERIFICATION_AUDIT

All discrepancies between V1 and the verification audit are resolved here. Source: `15_BLUEPRINT_VERIFICATION_AUDIT.md`.

### Critical Corrections (Would Break Functionality If Ignored)

| # | Asset | V1 Claim | V2 Corrected | Why |
|---|-------|----------|-------------|-----|
| C1 | `governed_create_daily_deal` | Orphaned — no frontend calls | **Used** — called from `services/dailyDeals.ts:58` | Service-layer call missed in V1 |
| C2 | `governed_create_flash_offer` | Orphaned — no frontend calls | **Used** — called from `services/flashOffers.ts:58` | Service-layer call missed |
| C3 | `governed_create_credit_application` | Orphaned — no UI calls it | **Used** — called from `services/credit.ts:162`, triggered by `CustomerCreditPage.tsx:40` | Credit UI existed but was not catalogued |
| C4 | `governed_create_location` | Orphaned — handled by `governed_create_customer` | **Used** — called from `services/location.ts:118` | Service-layer call missed |
| C5 | `governed_suspend_credit` | Orphaned — no UI calls it | **Used** — called from `CreditReviewPage.tsx:105` | Dynamic RPC call via `action()` helper missed |
| C6 | `governed_release_credit_reservation` | Orphaned — no UI calls it | **Used** — called from `services/credit.ts:101` | Service-layer call missed |
| C7 | `governed_suspend_credit_account` | Orphaned — no UI calls it | **Used** — called from `services/credit.ts:34` | Service-layer call missed |
| C8 | `creditService.recordPayment()` | Dead — never called from any page | **Used** — called from `CreditManagementPage.tsx:54` | CreditManagementPage existed but was missed |
| C9 | `creditService.createApplication()` | Dead — never called from any page | **Used** — called from `CustomerCreditPage.tsx:40` | CustomerCreditPage existed but was missed |

### High Impact Corrections

| # | Asset | V1 Claim | V2 Corrected | Why |
|---|-------|----------|-------------|-----|
| C10 | Total RPCs in DB | 69 | **231** (9 app + 222 public) | V1 counted only governed_* subset; all SQL functions included now |
| C11 | Orphaned RPC count | 26 | **19** | 7 reclassified to Used |
| C12 | Test RPC count | 6 | **7** (includes `ping`) | ping is test-only, no frontend call |
| C13 | Governance bypasses | 9 instances in 4 pages | **20 instances in 10 files** | EmployeeAnalysisPage, AccountPage, StorefrontPage, StorefrontCompaniesPage, VisitScreen, targets.ts all had undocumented bypasses |
| C14 | `governed_deny_order` | Orphaned (exists in DB) | **Not defined in any SQL migration** — 0 grep hits across 52 files | May exist in live DB only |
| C15 | `governed_create_auction` | Orphaned (exists in DB) | **Not defined in any SQL migration** — 0 grep hits | May exist in live DB only |
| C16 | `governed_reassign_customer_ownership` | Duplicate (exists in DB) | **Not defined in any SQL migration** — 0 grep hits | May exist in live DB only |
| C17 | Workflow 22 (Credit App Creation) | Broken | **Partial** — CustomerCreditPage creates applications, but no draft/submit flow | Creation UI exists; the gap is the submit/approve pipeline |

### Medium Impact Corrections

| # | Asset | V1 Claim | V2 Corrected | Why |
|---|-------|----------|-------------|-----|
| C18 | `governed_reserve_credit` name | Name as stated | Actual name: `governed_reserve_credit_for_order` | Wrong name would break planning |
| C19 | `governed_pay_credit_invoice` name | Name as stated | Actual name: `governed_record_credit_payment` | Same |
| C20 | `governed_register_cheque` name | Name as stated | Actual name: `governed_record_cheque` | Same |
| C21 | Dead service methods | 11 | **9** — removed `recordPayment` and `createApplication` | Both are called from pages |
| C22 | Blocker B6 (Credit App Creation) | Broken — no UI | **Resolved** — CustomerCreditPage has creation UI | Status changed from Blocker to resolved |
| C23 | Blocker B4 (Credit Payment/Ledger UI) | Complete blocker | **Partial** — payment UI exists in CreditManagementPage; ledger/cheque still missing | Refined classification |
| C24 | CheckoutPage classification | Empty shell | **Store/State-based** — uses zustand stores (cart, account, orders) | Not empty; has functional logic |
| C25 | ActivityPage classification | Empty — renders nothing | **Near-empty** — renders placeholder cards with coming-soon message | Visual difference only |

### Verified Correct (No Change Needed)

| Asset | Classification | Evidence |
|-------|---------------|----------|
| 13 dead tables | All DEAD | Zero frontend, SQL, service, trigger, or view references |
| `governed_approve_order` | Orphaned | 0 frontend calls, 0 SQL internal calls, 11 definition-only refs |
| `governed_create_return` | Orphaned | 0 frontend calls, defined but never invoked |
| `governed_update_return` | Orphaned | Same |
| `_calc_base_unit_price` | Internal | Called by 5 other SQL functions |
| `ensure_system_customer_owner` | Internal | Called by `register_customer` |
| 6 test RPCs | Test | Zero frontend or production SQL references |
| Customer address dual SOT | Legacy | Dual reads confirmed in code |
| Inventory never deducted | Blocked | `governed_approve_order` never called |

---

## Section 1 — Executive System Overview

### 1.1 What This System Is

Wholesale B2B distribution management platform serving ~25 active customers, ~700 products, 38 orders, and 16 employees across the Egyptian market. Manages the complete commercial lifecycle: customer registration → order placement → warehouse preparation → delivery → payment collection → returns → credit management → auctions.

### 1.2 Source-Verified Statistics

| Metric | Count | Source |
|--------|-------|--------|
| Database tables | **63** (62 public + 1 app) | 52 SQL migration files |
| Database functions (total) | **231** (9 app + 222 public) | SQL migration analysis |
| RPCs callable via supabase.rpc() | **~210** (222 public − 12 internal/utility) | SQL function definitions |
| RPCs with frontend callers | **~85** | Grep across 82 source files |
| Orphaned RPCs | **19** | Defined in SQL, zero frontend/SQL call sites |
| Test functions | **7** | Named test_* or utility-only |
| Internal SQL functions | **4** | `_calc_base_unit_price`, `_get_auction_participant_status`, `_get_effective_tier_discount`, `ensure_system_customer_owner` |
| Database views | **0** | Zero CREATE VIEW across 52 migrations |
| Database triggers | **0** | Zero CREATE TRIGGER across 52 migrations |
| Database enums | **14** | Various status/lifecycle types |
| Page components | **91** | Non-barrel .tsx files in src/pages/ |
| Functional pages | **86** | Render UI + fetch data |
| Routing-only pages | **1** | DashboardPage (role dispatch) |
| Static/navigation pages | **3** | ModuleLauncherPage, SubLauncherPage, SecurityWorkspace |
| Empty/near-empty pages | **1** | ActivityPage (placeholder cards) |
| Service files | **10** | src/services/*.ts |
| Service-like files | **4** | hooks/useCompanyProfile, store/auth, hooks/useCapability, lib/diag |
| Pure state stores | **5** | cart, orders, companies, visits, account |
| Governance bypasses | **20** | supabase.from() calls across 10 files |
| Workflows | **39** | 27 operational, 4 partial, 3 broken, 1 orphaned |

### 1.3 Operational Modules

| Module | Status | Tables | RPCs Called | Screens |
|--------|--------|--------|-------------|---------|
| Auth & Identity | Operational | identities, app.sessions | login, logout, validate_session, check_capability, register_customer | LoginPage, RegistrationPage |
| Customers | Operational | customers, customer_contacts, customer_ownership_history, unified_locations | 10+ governed_* RPCs | 5 screens |
| Employees | Operational | employees, employee_roles, employee_capabilities, employee_activity | 12+ governed_* RPCs | 3 screens |
| Orders | Partial | orders, order_items, order_status_history, order_modification_history | 10+ governed_* RPCs | 5 screens |
| Warehouse | Operational | preparation_records, preparation_exceptions | 8 governed_preparation_* RPCs | 3 screens |
| Delivery | Operational | delivery_tracking | 5 governed_delivery_* RPCs | 3 screens |
| Collections | Operational | collections | 3 governed_collection_* RPCs | 2 screens |
| Returns | Broken | returns, return_items, return_inspection | 4 governed_return_* RPCs | 2 screens |
| Credit | Partial | credit_programs, credit_applications, customer_credit_accounts, customer_credit_ledger, credit_invoices, credit_invoice_cheques | 10+ governed_credit_* RPCs | 6 screens |
| Products | Operational | products, product_units, inventory | 8 governed_product_* RPCs | 3 screens |
| Companies | Operational | companies, company_profile | 6 governed_company_* RPCs | 3 screens |
| Tiers | Operational | tiers, tier_company_exceptions, tier_product_exceptions | 6 governed_tier_* RPCs | 2 screens |
| Visits | Operational | visits | 4 governed_visit_* RPCs | 4 screens |
| Daily Deals | Partial | daily_deals, daily_deal_items | 5 governed_deal_* RPCs | 4 screens |
| Flash Offers | Orphaned | flash_offers, flash_offer_items | flashOfferService (service-only) | 3 screens |
| Auctions | Partial | auctions, auction_items, auction_bids, auction_participants, auction_awards, auction_activity | 2 governed_auction_* RPCs + raw inserts | 3 screens |
| Dashboards | Operational | (aggregate RPCs) | 15+ dashboard RPCs | 26 workspace screens |
| Targets | Operational | company_monthly_targets, employee_monthly_targets | 4 target RPCs | 2 screens |
| Storefront | Partial | products, companies, tiers (via direct from()) | 2 governed + 3 direct bypasses | 4 screens |

### 1.4 What Works End-to-End

18 workflows fully operational: customer creation (managed), employee lifecycle, order creation/submission, visit check-in/out, warehouse preparation/review, dispatch, delivery confirmation, collection creation/approval, return approval/rejection, credit approval/rejection, product lifecycle, company lifecycle, tier management, all dashboards, global search.

### 1.5 What Is Broken or Missing

3 workflows broken: order approval (inventory never deducted), order rejection (deny RPC not defined in SQL), return creation (no UI). 1 subsystem orphaned: flash offers (service layer only, no confirmed page wiring). 5 workflows partial: credit app creation (UI exists but no submit flow), credit account operations, daily deals, auctions, reports. 2 pages near-empty/deficient: ActivityPage (placeholder only), CheckoutPage (state-only, no direct DB).

### 1.6 Overall Assessment

**58/100 production readiness.** The system reads and displays data reliably but critical financial and operational write paths are incomplete. The top blocker: inventory is never deducted on order approval because `governed_approve_order` (which contains deduction + credit invoice logic) is never called — all status transitions use the generic `governed_change_order_status`.

---

## Section 2 — Canonical Business Entities

*(Verified correct in V1 — 37 entities, all classifications confirmed)*

| # | Entity | Canonical Table | PK | Operational Code | Classification |
|---|--------|-----------------|----|-----------------|---------------|
| 1 | Identity | identities | uuid | phone (unique login) | Canonical |
| 2 | Customer | customers | uuid | code (CUS-YYYY-NNNNNN) | Canonical |
| 3 | Employee | employees | uuid | code (EMP-*) | Canonical |
| 4 | Customer Address (Current) | unified_locations | uuid | formatted_address | Canonical |
| 5 | Customer Address (Legacy) | customer_addresses | uuid | address_line1 | Legacy |
| 6 | Customer Contact | customer_contacts | uuid | phone | Canonical |
| 7 | Order | orders | uuid | order_number (ORD-YYYY-NNNNNN) | Canonical |
| 8 | Order Item | order_items | uuid | (frozen at order time) | Canonical |
| 9 | Order Status History | order_status_history | uuid | (INSERT-only audit trail) | Canonical |
| 10 | Visit | visits | uuid | code | Canonical |
| 11 | Collection | collections | uuid | collection_number (COL-YYYY-NNNNNN) | Canonical |
| 12 | Return | returns | uuid | return_number | Canonical (no create path) |
| 13 | Delivery | delivery_tracking | uuid | (order-linked) | Canonical |
| 14 | Preparation | preparation_records | uuid | (order-linked) | Canonical |
| 15 | Product | products | uuid | product_name | Canonical |
| 16 | Inventory | inventory | product_id | quantity | Canonical (manual) |
| 17 | Company | companies | uuid | company_name | Canonical |
| 18 | Tier | tiers | uuid | name | Canonical |
| 19 | Tier Company Exception | tier_company_exceptions | id | discount_percent | Canonical |
| 20 | Tier Product Exception | tier_product_exceptions | id | discount_percent | Canonical |
| 21 | Credit Program | credit_programs | uuid | name | Canonical |
| 22 | Credit Application | credit_applications | uuid | status (enum) | Canonical |
| 23 | Credit Account | customer_credit_accounts | uuid | credit_limit | Canonical |
| 24 | Credit Ledger | customer_credit_ledger | id | running_balance | Canonical |
| 25 | Credit Invoice | credit_invoices | uuid | invoice_number | Canonical |
| 26 | Daily Deal | daily_deals | uuid | title | Canonical |
| 27 | Flash Offer | flash_offers | uuid | title | Canonical |
| 28 | Auction | auctions | uuid | code | Canonical |
| 29 | Role | roles | uuid | name | Canonical |
| 30 | Capability | capabilities | uuid | code | Canonical |
| 31 | Company Monthly Target | company_monthly_targets | (month, year) | target_amount | Canonical |
| 32 | Employee Monthly Target | employee_monthly_targets | (employee, month, year) | target_amount | Canonical |
| 33 | Code Sequence | code_sequences | (code_type, year) | last_sequence | Canonical |
| 34 | Treasury Transaction | treasury_transactions | uuid | amount | Canonical |
| 35 | Expense | expenses | uuid | amount | Canonical |
| 36 | Session | app.sessions | uuid | token | Canonical |
| 37 | System Config | system_config | 1 row | config values | Canonical |

---

## Section 3 — Canonical Database Model

### 3.1 Total Tables: 63 (62 public + 1 app schema)

**Operational tables (48):**

| Table | Rows (approx) | Used By | Classification |
|-------|---------------|---------|---------------|
| identities | ~32 | LoginPage, RegistrationPage | Canonical |
| customers | 25 | 5 screens | Canonical |
| customer_contacts | ~14 | 2 screens | Canonical |
| customer_ownership_history | — | 1 screen | Canonical |
| employees | 16 | 5 screens | Canonical |
| employee_roles | — | 3 screens | Canonical |
| employee_capabilities | — | 1 screen | Canonical |
| employee_activity | 9465 | 1 screen | Canonical |
| roles | — | 4 screens | Canonical |
| capabilities | ~80+ | 2 screens | Canonical |
| role_capabilities | — | (indirect) | Canonical |
| unified_locations | ~30 | 1 screen | Canonical |
| customer_addresses | 25 | 1 screen | **Legacy** |
| companies | ~50+ | 3 screens | Canonical |
| company_profile | 1 | 1 screen | Canonical |
| company_monthly_targets | — | 2 screens | Canonical |
| products | ~700+ | 4 screens | Canonical |
| product_units | — | 1 screen | Canonical |
| inventory | ~700 | 1 screen (bypass) | Canonical (manual) |
| orders | 38 | 5 screens | Canonical |
| order_items | 394 | 4 screens | Canonical |
| order_status_history | — | 1 screen | Canonical |
| order_modification_history | — | 0 screens (internal) | Canonical |
| order_daily_deals | — | 0 screens (internal) | Canonical |
| order_flash_offers | — | 0 screens (internal) | Canonical |
| visits | 13 | 4 screens | Canonical |
| collections | 6 | 3 screens | Canonical |
| treasury_transactions | — | 0 screens | Canonical |
| returns | 3 | 2 screens | Canonical |
| return_items | — | 1 screen | Canonical |
| return_inspection | — | 0 screens | Canonical |
| delivery_tracking | — | 3 screens | Canonical |
| preparation_records | 0 | 3 screens | Canonical (empty) |
| preparation_exceptions | 0 | 2 screens | Canonical (empty) |
| tiers | — | 2 screens | Canonical |
| tier_company_exceptions | — | 1 screen | Canonical |
| tier_product_exceptions | — | 1 screen | Canonical |
| tier_exceptions | — | 0 screens | Canonical |
| credit_programs | — | 2 screens | Canonical |
| credit_applications | 3 | 2 screens | Canonical |
| customer_credit_accounts | 3 | 1 screen | Canonical |
| customer_credit_ledger | — | 0 screens | Canonical |
| credit_invoices | — | 2 screens | Canonical |
| credit_invoice_cheques | — | 0 screens | Canonical |
| credit_contracts | 0 | 0 screens | Canonical (empty) |
| credit_contract_templates | — | 0 screens | Canonical |
| daily_deals | 0 | 4 screens | Canonical (empty) |
| daily_deal_items | 0 | (indirect) | Canonical (empty) |
| flash_offers | 0 | 3 screens | Canonical (empty) |
| flash_offer_items | 0 | (indirect) | Canonical (empty) |
| auctions | — | 3 screens | Canonical |
| auction_items | — | (indirect) | Canonical |
| auction_participants | — | (indirect) | Canonical |
| auction_bids | — | (realtime) | Canonical |
| auction_awards | — | (indirect) | Canonical |
| auction_activity | — | (realtime) | Canonical |
| employee_advances | 0 | 0 screens | Canonical (empty) |
| employee_monthly_targets | — | 2 screens | Canonical |
| code_sequences | — | (internal) | Canonical |
| app.sessions | — | (auth) | Canonical |
| system_config | 1 | 0 screens | Canonical |
| expenses | — | 0 screens | Canonical |

**Dead tables (13):** customer_classification, customer_daily_deal, deal, follow_up, notification, permission, visit_note, voucher_type, sync_log, activity_log, packages, package_items, package_orders

### 3.2 Columns That Are Dead or Deprecated

*(Same as V1 — verified correct)*

| Table.Column | Reason | Classification |
|-------------|--------|---------------|
| customers.email | Removed from all UIs, NULLABLE | Dead (keep column only) |
| customers.credit_limit | Superseded by customer_credit_accounts.credit_limit | Legacy |
| customers.credit_days | Superseded by customer_credit_accounts.payment_term_days | Legacy |
| orders.snapshot_sender_name | Superseded by snapshot_owner_name | Deprecated |
| orders.snapshot_sender_phone | Superseded by snapshot_owner_phone | Deprecated |
| orders.snapshot_sender_address | Superseded by snapshot_owner_address | Deprecated |
| orders.execution_latitude | Superseded by execution_location_id | Deprecated |
| orders.execution_longitude | Superseded by execution_location_id | Deprecated |
| orders.execution_accuracy_meters | Superseded by execution_location_id | Deprecated |
| orders.execution_captured_at | Superseded by execution_location_id | Deprecated |

### 3.3 Governance Bypasses — Complete List (20 instances, 10 files)

| # | File | Table | Operation | Line | Risk | Alternative? |
|---|------|-------|-----------|------|------|-------------|
| 1 | AuctionsManagerPage.tsx | auctions | update | 75 | HIGH | `governed_create_auction` not in migrations |
| 2 | AuctionsManagerPage.tsx | auctions | insert | 96 | HIGH | Same |
| 3 | DailyDealsManagerPage.tsx | daily_deals | update | 100 | HIGH | `governed_update_daily_deal` exists but bypassed for specific fields |
| 4 | ProductManagerPage.tsx | products | update (image_url) | 161 | MEDIUM | `governed_update_product` exists |
| 5 | ProductManagerPage.tsx | products | update (is_visible) | 166 | MEDIUM | Same |
| 6 | ProductManagerPage.tsx | inventory | upsert | 177 | MEDIUM | No governed inventory RPC exists |
| 7 | CompanyManagerPage.tsx | companies | select (full row) | 72 | LOW | `get_governed_companies` exists |
| 8 | CompanyManagerPage.tsx | companies | update (logo_url) | 113 | MEDIUM | `governed_update_company` exists |
| 9 | CompanyManagerPage.tsx | companies | update (is_visible) | 118 | MEDIUM | Same |
| 10 | StorefrontCompaniesPage.tsx | companies | select (public) | 23 | MEDIUM | No governed RPC for public reads |
| 11 | StorefrontPage.tsx | products | select (public) | 91 | MEDIUM | Same |
| 12 | StorefrontPage.tsx | tiers | select (public) | 128 | MEDIUM | Same |
| 13 | EmployeeAnalysisPage.tsx | employees | select | 195 | MEDIUM | `get_governed_employees` exists |
| 14 | EmployeeAnalysisPage.tsx | customers | select | 202 | MEDIUM | `get_governed_customers` exists |
| 15 | EmployeeAnalysisPage.tsx | visits | select | 267 | MEDIUM | `get_governed_visits` exists |
| 16 | VisitScreen.tsx | visits | select (verification) | 136 | LOW | Post-RPC verification read |
| 17 | VisitScreen.tsx | visits | select (verification) | 183 | LOW | Same |
| 18 | AccountPage.tsx | customer_addresses | select | 152 | MEDIUM | `get_governed_customer_addresses` exists |
| 19 | services/targets.ts | employees | select | 148 | MEDIUM | `get_governed_employees` exists |
| 20 | services/targets.ts | employee_roles | select | 157 | MEDIUM | No direct governed RPC |

---

## Section 4 — Canonical Source Of Truth

*(Verified correct in V1 — all 32 concepts confirmed. No changes needed.)*

### 4.1 Customer Identity & Contact

| Concept | Canonical Source | Conflict? | Resolution |
|---------|-----------------|-----------|------------|
| Customer Auth (login) | identities.phone (UNIQUE) | No | Keep |
| Customer Operational Phone | customer_contacts.phone | Low — different purpose | Keep both |
| Customer Name | customers.company_name | No | Keep |
| Customer Code | customers.code | Format varies | Unify to CUS-YYYY-NNNNNN |
| Customer Business Type | customers.business_type | No | Keep |
| Customer Email | customers.email | Low — removed from UI | Drop UI, keep column |

### 4.2 Customer Address & Location

| Concept | Canonical Source | Conflict? | Resolution |
|---------|-----------------|-----------|------------|
| Formatted Address | unified_locations.formatted_address | Medium — dual read in AccountPage | Migrate customer_addresses → unified_locations |
| GPS Coordinates | unified_locations.latitude/longitude | Low — dual storage | Keep both |
| Location Link | customers.location_id → unified_locations.id | Medium — NULL for legacy customers | Complete migration |

### 4.3 Access Control

| Concept | Canonical Source | Notes |
|---------|-----------------|-------|
| Roles | roles.name | Dynamic — data-driven |
| Capabilities | capabilities.code | Machine-readable |
| Role-Capability | role_capabilities | Defines role permissions |
| Employee Role | employee_roles | Junction, multiple roles |
| Direct Capability | employee_capabilities | Override (grant/deny) |

### 4.4 Remaining Concepts

All other concepts (Orders, Products & Pricing, Collections, Returns, Visits, Credit, Targets) — verified correct in V1. No discrepancies found.

---

## Section 5 — Complete Runtime Map

### Screen Classification (Verified, 91 pages)

| Category | Count | Details |
|----------|-------|---------|
| Live RPC Data | 61 pages | Direct supabase.rpc() calls to governed_* or get_* RPCs |
| Service-Layer Data | 15 pages | Data fetched through service wrappers (creditService, targetService, auctionService, etc.) |
| supabase.from() bypass | 9 pages | Mix of governed RPC + direct table access |
| Store/State Only | 6 pages | zustand stores or sessionStorage, no DB calls |
| Static/Navigation | 4 pages | DashboardPage (routing), ModuleLauncher, SubLauncher, SecurityWorkspace |
| Empty/Near-Empty | 1 page | ActivityPage (placeholder cards, Arabic coming-soon message) |
| Barrel Exports | 3 pages | credit/index.tsx, delivery/index.tsx, warehouse/index.tsx |

### Pages Using supabase.from() Directly (Not in V1)

| Page | Tables Accessed | Operations | Previously Documented? |
|------|----------------|-----------|----------------------|
| EmployeeAnalysisPage | employees, customers, visits | select | **NO** |
| AccountPage | customer_addresses | select | **NO** |
| StorefrontPage | products, tiers | select | **NO** |
| StorefrontCompaniesPage | companies | select | **NO** |
| VisitScreen | visits | select (post-RPC verification) | **NO** |
| services/targets.ts | employees, employee_roles | select | **NO** |

---

## Section 6 — Workflow Map

### Verified Workflow Status (V2 Corrected)

| # | Workflow | Status (V1) | Status (V2) | Key RPC | Reason |
|---|----------|------------|-------------|---------|--------|
| 1 | Customer Self-Registration | Operational | Operational | register_customer | — |
| 2 | Managed Customer Creation | Operational | Operational | governed_create_customer | — |
| 3 | Employee Creation | Operational | Operational | governed_create_employee | — |
| 4 | Login | Operational | Operational | authService.login() | — |
| 5 | Visit Check-In | Operational | Operational | governed_checkin_visit | — |
| 6 | Visit Check-Out | Operational | Operational | governed_checkout_visit | — |
| 7 | Order Creation | Operational | Operational | governed_create_order | — |
| 8 | Order Submission | Operational | Operational | governed_submit_order | — |
| 9 | Order Approval | Broken | **Broken** | governed_change_order_status (wrong RPC) | Inventory never deducted. `governed_approve_order` orphaned. |
| 10 | Order Rejection | Broken | **Broken** | governed_change_order_status (wrong RPC) | `governed_deny_order` not defined in SQL migrations |
| 11 | Warehouse Preparation | Operational | Operational | governed_start_preparation | — |
| 12 | Warehouse Completion | Operational | Operational | governed_complete_preparation | — |
| 13 | Warehouse Review | Operational | Operational | governed_review_preparation | — |
| 14 | Order Dispatch | Operational | Operational | governed_dispatch_order | — |
| 15 | Delivery Assignment | Operational | Operational | governed_assign_delivery | — |
| 16 | Delivery Confirmation | Operational | Operational | governed_confirm_delivery | — |
| 17 | Collection Creation | Operational | Operational | governed_create_collection | — |
| 18 | Collection Approval | Operational | Operational | governed_approve_collection | — |
| 19 | Return Creation | Broken | **Broken** | governed_create_return (no UI) | No page calls it |
| 20 | Return Approval | Operational | Operational | governed_approve_return | — |
| 21 | Return Rejection | Operational | Operational | governed_reject_return | — |
| 22 | Credit App Creation | Broken | **Partial** | governed_create_credit_application | CustomerCreditPage has create UI, but no draft→submit→approve pipeline |
| 23 | Credit App Documents | Operational | Operational | governed_confirm_documents | — |
| 24 | Credit App Approval | Operational | Operational | governed_manage_credit_application | — |
| 25 | Credit App Rejection | Operational | Operational | governed_decline_credit | — |
| 26 | Credit Program CRUD | Operational | Operational | all program RPCs | — |
| 27 | Product CRUD | Operational | Operational | governed_create/update_product | — |
| 28 | Company CRUD | Operational | Operational | governed_create/update_company | — |
| 29 | Tier CRUD + Exceptions | Operational | Operational | governed_create/update_tier | — |
| 30 | Daily Deal Manage | Partial | **Partial** | gov RPCs + from() bypass | Mixed governance |
| 31 | Flash Offer Manage | Orphaned | **Orphaned** | flashOfferService (service only) | No confirmed page integration |
| 32 | Auction Manage | Partial | **Partial** | supabase.from('auctions').insert (bypass) | Raw inserts, no RPC |
| 33 | Dashboard Views | Operational | Operational | aggregate RPCs | — |
| 34 | Target Management | Operational | Operational | targetService | — |
| 35 | Customer Ownership Change | Operational | Operational | governed_change_customer_ownership | — |
| 36 | Employee Manager/Role | Operational | Operational | governed_change_employee_manager/role | — |
| 37 | Global Search | Operational | Operational | governed_global_search | — |
| 38 | Reports | Partial | **Partial** | dynamic supabase.rpc() | — |
| 39 | Customer Analytics | Operational | Operational | get_customer_card/products/brands | — |

### Summary

| Classification | V1 Count | V2 Count | Workflows |
|---------------|----------|----------|-----------|
| Operational | 27 | **27** | 1–8, 11–18, 20–21, 23–28, 33–37, 39 |
| Partial | 3 | **4** | 22 (new), 30, 32, 38 |
| Broken | 4 | **3** | 9, 10, 19 |
| Orphaned | 1 | **1** | 31 |

---

## Section 7 — Dead Assets

### 7.1 Dead Tables (13)

*(All verified — no references in frontend, SQL, services, triggers, or views)*

customer_classification, customer_daily_deal, deal, follow_up, notification, permission, visit_note, voucher_type, sync_log, activity_log, packages, package_items, package_orders

### 7.2 Dead RPCs (19 — Corrected from 26)

After reclassification: 7 RPCs moved to Used.

| RPC | Reason | Classification |
|-----|--------|---------------|
| test_ping2 | Test artifact | Test |
| test_ping3 | Test artifact | Test |
| test_rpc | Test artifact | Test |
| test_setof | Test artifact | Test |
| test_func | Test artifact | Test |
| multiline_test | Test artifact | Test |
| ping | Health check only, no frontend call | Test |
| governed_approve_order | Approval uses governed_change_order_status | Orphaned |
| governed_deny_order | Not defined in SQL migrations | Orphaned (live DB only) |
| governed_create_return | No UI creates returns | Orphaned |
| governed_update_return | No UI updates returns | Orphaned |
| governed_update_collection | No UI updates collections | Orphaned |
| governed_create_visit | Checkin handles creation implicitly | Orphaned |
| governed_update_flash_offer | No page calls it | Orphaned |
| governed_submit_credit_application | No page submits drafts | Orphaned |
| governed_update_contract_template | No UI edits templates | Orphaned |
| governed_create_auction | Not defined in SQL migrations | Orphaned (live DB only) |
| governed_reassign_customer_ownership | Not defined in SQL migrations | Duplicate (live DB only) |
| _calc_base_unit_price | Internal helper called by 5 SQL functions | Internal |
| ensure_system_customer_owner | Called by register_customer | Internal |

### 7.3 Dead Service Methods (9 — Corrected from 11)

Removed: `recordPayment` (called from `CreditManagementPage.tsx:54`), `createApplication` (called from `CustomerCreditPage.tsx:40`)

| Service | Method | RPC Wrapped | Status |
|---------|--------|-------------|--------|
| creditService | activateAccount | governed_activate_credit_account | Orphaned |
| creditService | suspendAccount | governed_suspend_credit_account | Orphaned |
| creditService | reactivateAccount | governed_reactivate_credit_account | Orphaned |
| creditService | recordCheque | governed_record_cheque | Orphaned (RPC called, but method has no page caller) |
| creditService | reserveCreditForOrder | governed_reserve_credit_for_order | Orphaned |
| creditService | releaseCreditReservation | governed_release_credit_reservation | Orphaned |
| creditService | convertReservationToOutstanding | governed_convert_credit_reservation_to_outstanding | Orphaned |
| creditService | getCustomerLedger | governed_get_customer_credit_ledger | Orphaned |
| creditService | getCustomerStatements | governed_get_customer_monthly_statements | Orphaned |

### 7.4 Dead Screens

| Screen | Reason |
|--------|--------|
| ActivityPage | Placeholder cards with "coming in future updates" message. No supabase calls. |

### 7.5 Dead Columns

*(Same as V1 — verified correct)*

### 7.6 Unreachable States

| Entity | Unreachable State | Reason |
|--------|------------------|--------|
| Return | pending (initial) | governed_create_return never called |
| Visit | scheduled | governed_create_visit never called |
| Credit Application | submitted, suspended | RPCs exist but no page calls them |
| Order | ready_for_dispatch | No normal transition leads to it |

---

## Section 8 — Architectural Conflicts

### 8.1 Dual Source of Truth Conflicts

*(Same as V1 — verified correct)*

| # | Conflict | Source A | Source B | Risk |
|---|----------|----------|----------|------|
| 1 | Customer Address | unified_locations | customer_addresses | Medium |
| 2 | Customer Credit Limit | cca.credit_limit | customers.credit_limit | Medium |
| 3 | Customer Credit Days | cca.payment_term_days | customers.credit_days | Medium |
| 4 | Credit Balance | customer_credit_ledger | cca.outstanding_credit | Low |
| 5 | Visit GPS | unified_locations | visits.check_in_lat/lng | Low |
| 6 | Customer Phone | identities.phone | customer_contacts.phone | Low |
| 7 | Order Status | orders.status | order_status_history (audit) | None |
| 8 | Order Snapshots | orders.snapshot_* | source tables | None |

### 8.2 Dual Execution Paths

| # | Conflict | Path A | Path B | Risk |
|---|----------|--------|--------|------|
| 1 | Customer Creation | NewCustomerPage → governed_create_customer | RegistrationPage → register_customer | Medium |
| 2 | Order Approval | OrderStatusManager → governed_change_order_status | governed_approve_order (NOT CALLED) | **Critical** |
| 3 | Auction Creation | AuctionsManagerPage → supabase.from().insert() | governed_create_auction (not in migrations) | Medium |
| 4 | Customer Ownership Change | governed_change_customer_ownership | governed_reassign_customer_ownership (not in migrations) | Low |
| 5 | Daily Deal Create | DailyDealsManagerPage → update+bypass | governed_create_daily_deal (called from service) | Low |

### 8.3 Governance Bypasses — Final Count: 20 instances in 10 files

*(Corrected from V1: 9 instances in 4 files)*

| # | Page/File | Table | Operation | Risk | Line |
|---|-----------|-------|-----------|------|------|
| 1 | AuctionsManagerPage | auctions | update | HIGH | 75 |
| 2 | AuctionsManagerPage | auctions | insert | HIGH | 96 |
| 3 | DailyDealsManagerPage | daily_deals | update | HIGH | 100 |
| 4 | ProductManagerPage | products | update | MEDIUM | 161 |
| 5 | ProductManagerPage | products | update | MEDIUM | 166 |
| 6 | ProductManagerPage | inventory | upsert | MEDIUM | 177 |
| 7 | CompanyManagerPage | companies | select | LOW | 72 |
| 8 | CompanyManagerPage | companies | update | MEDIUM | 113 |
| 9 | CompanyManagerPage | companies | update | MEDIUM | 118 |
| 10 | StorefrontCompaniesPage | companies | select | MEDIUM | 23 |
| 11 | StorefrontPage | products | select | MEDIUM | 91 |
| 12 | StorefrontPage | tiers | select | MEDIUM | 128 |
| 13 | EmployeeAnalysisPage | employees | select | MEDIUM | 195 |
| 14 | EmployeeAnalysisPage | customers | select | MEDIUM | 202 |
| 15 | EmployeeAnalysisPage | visits | select | MEDIUM | 267 |
| 16 | VisitScreen | visits | select | LOW | 136 |
| 17 | VisitScreen | visits | select | LOW | 183 |
| 18 | AccountPage | customer_addresses | select | MEDIUM | 152 |
| 19 | services/targets.ts | employees | select | MEDIUM | 148 |
| 20 | services/targets.ts | employee_roles | select | MEDIUM | 157 |

---

## Section 9 — Production Readiness

### 9.1 Production Blockers (7 — Corrected from 8)

B6 (Credit App Creation) removed — UI exists in CustomerCreditPage. B4 refined to Partial.

| # | Blocker | Category | Impact | Root Cause |
|---|---------|----------|--------|------------|
| B1 | Inventory never deducted on order approval | **Missing Business Logic** | Stock levels never decrease. Warehouse overselling possible. | `governed_approve_order` never called |
| B2 | Credit invoices never created on approval | **Missing Business Logic** | Credit customers cannot be billed | Same root cause as B1 |
| B3 | Returns cannot be created through UI | **Missing UI** | Staff cannot process returns. RPC exists but no caller. | `governed_create_return` has zero frontend calls |
| B4 | Credit financial operations limited | **Partial UI** | Payment UI exists in CreditManagementPage. Ledger display, cheque management, credit reservation UIs missing. | 6 of 9 service methods have no page callers |
| B5 | No credit reservation during order | **Missing Workflow Link** | Credit orders can exceed customer limit unchecked | `governed_reserve_credit_for_order` never called from any page |
| B6 | Auctions bypass governed RPC | **Missing Business Logic** | Raw inserts skip validation, code gen, auth | AuctionsManagerPage uses from().insert() directly |
| B7 | 60% customers on legacy addresses | **Incomplete Migration** | Data integrity risk; dual-read path active | 15/25 customers have NULL location_id |

### 9.2 Domain Readiness Scores

| Domain | V1 Score | V2 Score | Change | Assessment |
|--------|----------|----------|--------|------------|
| Customers | 90 | 90 | — | Full CRUD + ownership. |
| Employees | 92 | 92 | — | Full lifecycle. |
| Orders | 65 | 65 | — | Approval business logic never executes. |
| Warehouse | 95 | 95 | — | Most complete domain. |
| Delivery | 85 | 85 | — | Assign/confirm/fail work. |
| Collections | 70 | 70 | — | Create + approve work. |
| Returns | 40 | 40 | — | No create flow. |
| Visits | 80 | 80 | — | Check-in/out work. |
| Credit | 25 | **35** | +10 | Creation UI and payment UI exist (CustomerCreditPage, CreditManagementPage) |
| Dashboards | 85 | 85 | — | All workspaces render real data. |
| Storefront | 70 | 70 | — | Cart works, CheckoutPage uses stores (not empty). |
| Governance | 82 | **75** | −7 | Additional bypasses found (20 total vs 9). |

**Overall: 58/100** (V1: 57) — minor improvement from credit UI discovery, offset by additional governance bypass findings.

---

## Section 10 — Cleanup Roadmap (V2 Corrected)

### 10.1 RPC Classification Changes

| RPC | V1 Classification | V2 Classification | Action |
|-----|-----------------|-----------------|--------|
| governed_create_daily_deal | Orphaned → Drop | **Used** — called from dailyDeals.ts:58 | **KEEP** |
| governed_create_flash_offer | Orphaned → Drop | **Used** — called from flashOffers.ts:58 | **KEEP** |
| governed_create_credit_application | Orphaned → Drop | **Used** — called from credit.ts:162, CustomerCreditPage | **KEEP** |
| governed_create_location | Orphaned → Drop | **Used** — called from location.ts:118 | **KEEP** |
| governed_suspend_credit | Orphaned → Drop | **Used** — called from CreditReviewPage.tsx:105 | **KEEP** |
| governed_release_credit_reservation | Orphaned → Drop | **Used** — called from credit.ts:101 | **KEEP** |
| governed_suspend_credit_account | Orphaned → Drop | **Used** — called from credit.ts:34 | **KEEP** |

### 10.2 Dead Tables — SAFE NOW (13)

| Table | Action | Precondition |
|-------|--------|-------------|
| customer_classification | Drop | None |
| customer_daily_deal | Drop | None |
| deal | Drop | None |
| follow_up | Drop | None |
| notification | Drop | None |
| permission | Drop | None |
| visit_note | Drop | None |
| voucher_type | Drop | None |
| sync_log | Drop | None |
| activity_log | Drop | None |
| packages | Drop | None |
| package_items | Drop | None |
| package_orders | Drop | None |

### 10.3 Columns — SAFE NOW (8)

customers.email, orders.snapshot_sender_name, orders.snapshot_sender_phone, orders.snapshot_sender_address, orders.execution_latitude, orders.execution_longitude, orders.execution_accuracy_meters, orders.execution_captured_at

### 10.4 RPCs — SAFE NOW (7)

test_ping2, test_ping3, test_rpc, test_setof, test_func, multiline_test, ping

### 10.5 Columns — NEEDS MIGRATION (2)

customers.credit_limit, customers.credit_days — Migrate UI to cca.credit_limit/cca.payment_term_days

### 10.6 Tables — NEEDS MIGRATION (1)

customer_addresses — Migrate 25 rows to unified_locations, verify all customers have location_id

### 10.7 BLOCKED Assets

| Asset | Reason |
|-------|--------|
| governed_approve_order | Needs order approval refactoring (wire to OrderStatusManager) |
| governed_deny_order | Same — needs denial flow |
| governed_create_return | Needs return creation UI |
| governed_update_return | Needs return edit feature |
| governed_update_collection | Needs collection edit feature |
| governed_update_flash_offer | Needs flash offer full implementation |
| governed_submit_credit_application | Needs credit application flow completion |
| governed_update_contract_template | Needs credit contract feature |
| All 9 orphaned creditService methods | Part of incomplete credit subsystem |
| register_customer | Dual path — keep until unified |
| All 8 RPCs not in SQL migrated | May exist in live DB — needs verification |

---

## Section 11 — Final Executive Verdict (V2)

### 11.1 The System Today

- **Architecture:** Frontend → supabase.rpc('governed_*') → PostgreSQL. 20 bypasses via supabase.from() in 10 files.
- **Auth:** identities table + Supabase Auth API. Single login path.
- **Customers:** customers table via governed_create_customer / get_governed_customers.
- **Orders:** orders → governed_create_order → governed_change_order_status (generic — NOT governed_approve_order).
- **Inventory:** inventory table, manually updated via from().upsert() — never deducted on approval.
- **Credit:** Programs full CRUD. Applications create/read/approve/reject. Payment UI exists. Ledger, cheque, reservation UIs missing.
- **Returns:** Read/approve/reject only. No create path.
- **Addresses:** unified_locations canonical. customer_addresses legacy with active dual-read path.
- **Warehouse:** Full preparation lifecycle — most complete domain.
- **Dashboards:** All 26 workspace screens render real aggregate data.

### 11.2 Canonical / Legacy / Duplicate / Dead

*(Corrected from V1)*

| Category | Count | Key Items |
|----------|-------|-----------|
| Canonical | ~48 tables, ~85 RPCs, 86 pages | All active system components |
| Legacy | 4 | customer_addresses, customers.credit_limit, customers.credit_days, packages superseded |
| Duplicate | 5 concepts | Address, Credit Limit, Credit Balance, Visit GPS, Customer Phone |
| Dead | 13 tables, 19 RPCs, 1 page, 10 columns, 9 service methods | All verified |

### 11.3 RPC Classification Summary

| Category | Count |
|----------|-------|
| Used (frontend callers) | ~85 |
| Orphaned (defined, never called) | 19 |
| Test | 7 |
| Internal (SQL-only) | ~13 |
| Live DB only (not in migrations) | ~3 |
| Other (defined, uncalled) | ~107 |

### 11.4 Production Readiness Score: 58/100

| Metric | Value |
|--------|-------|
| Overall Readiness | 58/100 |
| Domains ≥85 (Strong) | 3 — Customers, Employees, Warehouse |
| Domains 70–84 (Adequate) | 4 — Delivery, Collections, Visits, Dashboards |
| Domains 50–69 (Weak) | 2 — Orders (65), Storefront (70) |
| Domains <50 (Critical) | 2 — Credit (35), Returns (40) |
| Production Blockers | 7 (corrected from 8) |
| Extra bypasses (vs V1) | +11 (20 total, 9 documented → 11 missed) |

### 11.5 Top 10 Risks

| # | Risk | Domain | Impact |
|---|------|--------|--------|
| 1 | governed_approve_order orphaned | Orders | Inventory never deducted, credit never invoiced |
| 2 | Credit subsystem half-built | Credit | 6/9 service methods have no page callers |
| 3 | Return creation UI missing | Returns | governed_create_return exists but no UI |
| 4 | 20 governance bypasses | Governance | 10 files bypass governed RPC layer |
| 5 | 60% customers on legacy addresses | Data | Dual-read path, migration incomplete |
| 6 | Auctions use raw inserts | Auctions | No governed_create_auction in migrations |
| 7 | governed_deny_order undefined | Orders | No dedicated denial RPC in SQL |
| 8 | 3 RPC names differ from docs | Docs | governed_reserve_credit vs _for_order, etc. |
| 9 | No credit reservation on order | Financial | Customer can exceed limit unchecked |
| 10 | ActivityPage placeholder | UX | Empty page visible to users |

### 11.6 Top 10 Governance Violations

| # | File | Table | Operation | Risk |
|---|------|-------|-----------|------|
| 1 | AuctionsManagerPage | auctions | insert | HIGH |
| 2 | AuctionsManagerPage | auctions | update | HIGH |
| 3 | DailyDealsManagerPage | daily_deals | update | HIGH |
| 4 | ProductManagerPage | products | update (x2) | MEDIUM |
| 5 | ProductManagerPage | inventory | upsert | MEDIUM |
| 6 | CompanyManagerPage | companies | update (x2) | MEDIUM |
| 7 | EmployeeAnalysisPage | 3 tables | select (x3) | MEDIUM |
| 8 | StorefrontPage | 2 tables | select (x2) | MEDIUM |
| 9 | AccountPage | customer_addresses | select | MEDIUM |
| 10 | services/targets.ts | 2 tables | select | MEDIUM |

### 11.7 Top 10 Cleanup Candidates

| # | Asset | Action | Classification |
|---|-------|--------|---------------|
| 1 | 13 dead tables | Drop | SAFE NOW |
| 2 | 7 test RPCs | Drop | SAFE NOW |
| 3 | 8 dead columns | Drop | SAFE NOW |
| 4 | customer_addresses rows | Migrate to unified_locations | NEEDS MIGRATION |
| 5 | customers.credit_limit/credit_days | Migrate UI | NEEDS MIGRATION |
| 6 | 8 undocumented bypasses | Route through governed RPCs | NEEDS DECISION |
| 7 | 3 RPC name mismatches | Fix documentation | SAFE NOW (docs) |
| 8 | ActivityPage | Implement or remove | NEEDS DECISION |
| 9 | 8 orphaned governed RPCs | Wire to UI or drop | BLOCKED (needs UI) |
| 10 | 9 dead service methods | Remove or wire | BLOCKED (needs credit module) |

---

## Section 12 — Execution Classification

### SAFE ACTIONS NOW (Can Execute Immediately — No Risk)

**Drop tables (13):** customer_classification, customer_daily_deal, deal, follow_up, notification, permission, visit_note, voucher_type, sync_log, activity_log, packages, package_items, package_orders

**Drop columns (8):** customers.email, orders.snapshot_sender_name/phone/address, orders.execution_latitude/longitude/accuracy_meters/captured_at

**Drop RPCs (7):** test_ping2, test_ping3, test_rpc, test_setof, test_func, multiline_test, ping

**Fix documentation (3):** Correct RPC names — governed_reserve_credit → governed_reserve_credit_for_order, governed_pay_credit_invoice → governed_record_credit_payment, governed_register_cheque → governed_record_cheque

### ACTIONS REQUIRING MIGRATION (Need Database Changes)

**Column migration (2):** customers.credit_limit → customer_credit_accounts.credit_limit, customers.credit_days → customer_credit_accounts.payment_term_days (requires CustomerProfilePage UI update)

**Table migration (1):** customer_addresses → unified_locations (25 rows, requires verifying all customers get location_id)

### ACTIONS BLOCKED (Do Not Execute)

**Do not drop:** governed_create_daily_deal, governed_create_flash_offer, governed_create_credit_application, governed_create_location, governed_suspend_credit, governed_release_credit_reservation, governed_suspend_credit_account — all are Used, not Orphaned

**Do not drop:** creditService.recordPayment(), creditService.createApplication() — both called from pages

**Blocked until decision:** governed_approve_order, governed_deny_order (need approval refactor); governed_create_return, governed_update_return (need return UI); governed_update_collection (needs collection edit); governed_submit_credit_application (needs credit flow); governed_update_flash_offer (needs flash offer UI); 9 orphaned creditService methods (needs credit module completion); register_customer (dual path); ping (verify infra dependency)

**Blocked until audit:** governed_create_auction, governed_reassign_customer_ownership, governed_deny_order — not found in SQL migrations; may exist in live DB only. Requires live DB verification before any action.
