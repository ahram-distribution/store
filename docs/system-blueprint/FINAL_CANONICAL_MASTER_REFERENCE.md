# Final Canonical Master Reference

> Single authoritative reference for the Ahram Distribution system.
> Synthesized from 14 prior blueprint files (01–14) with source-code-verified evidence across 27 page directories, 11 services, 69 RPCs, and 60 tables.
> **Date:** 2026-06-09
> **Readiness Score:** 57% — operational on read paths, broken on critical write paths (inventory deduction, return creation, credit financials).

---

## Section 1 — Executive System Overview

### 1.1 What This System Is

A wholesale B2B distribution management platform serving ~25 active customers, ~700 products, 38 orders, and 16 employees across the Egyptian market. The platform manages the complete commercial lifecycle: customer registration → order placement → warehouse preparation → delivery → payment collection → returns → credit management → auctions.

### 1.2 Operational Modules

| Module | Status | Tables | RPCs | Screens |
|--------|--------|--------|------|---------|
| Auth & Identity | Operational | identities, app.sessions | login, logout, validate_session, check_capability | LoginPage, RegistrationPage |
| Customers | Operational | customers, customer_contacts, customer_ownership_history, unified_locations | 8 governed_* RPCs | 5 screens |
| Employees | Operational | employees, employee_roles, employee_capabilities | 10 governed_* RPCs | 3 screens |
| Orders | Partial | orders, order_items, order_status_history, order_modification_history | 6 governed_* RPCs | 5 screens (+1 empty) |
| Warehouse | Operational | preparation_records, preparation_exceptions | 8 governed_preparation_* RPCs | 3 screens |
| Delivery | Operational | delivery_tracking | 4 governed_delivery_* RPCs | 2 screens |
| Collections | Operational | collections | 3 governed_collection_* RPCs | 3 screens |
| Returns | Broken | returns, return_items, return_inspection | 4 governed_return_* RPCs | 2 screens |
| Credit | Broken | credit_programs, credit_applications, customer_credit_accounts, customer_credit_ledger, credit_invoices, credit_invoice_cheques | 20 governed_credit_* RPCs | 6 screens |
| Products | Operational | products, product_units, inventory | 6 governed_product_* RPCs | 3 screens |
| Companies | Operational | companies, company_profile | 4 governed_company_* RPCs | 3 screens |
| Tiers | Operational | tiers, tier_company_exceptions, tier_product_exceptions | 4 governed_tier_* RPCs | 1 screen |
| Visits | Operational | visits | 4 governed_visit_* RPCs | 3 screens |
| Daily Deals | Partial | daily_deals, daily_deal_items | 3 governed_deal_* RPCs | 3 screens |
| Flash Offers | Orphaned | flash_offers, flash_offer_items | 4 governed_flash_* RPCs | 3 screens |
| Auctions | Partial | auctions, auction_items, auction_bids, auction_participants, auction_awards, auction_activity | 2 governed_auction_* RPCs | 3 screens |
| Dashboards | Operational | (aggregate RPCs) | 10+ dashboard RPCs | 20+ workspace screens |
| Targets | Partial | company_monthly_targets, employee_monthly_targets | 4 target RPCs | 3 screens |

### 1.3 What Works End-to-End

18 workflows are fully operational: customer creation (managed), employee lifecycle, order creation/submission, visit check-in/out, warehouse preparation/review, dispatch, delivery confirmation, collection creation/approval, return approval/rejection, credit approval/rejection, product lifecycle, company lifecycle, tier management, all dashboards, global search.

### 1.4 What Is Broken or Missing

4 workflows are broken: order approval (inventory never deducted), order rejection (deny RPC orphaned), return creation (no UI), credit application creation (no UI). 1 subsystem is orphaned: credit account financial operations (8 RPCs + service methods exist but no UI). 2 screens are empty shells: CheckoutPage and ActivityPage.

### 1.5 Overall Assessment

57% production readiness. The system reads and displays data reliably but critical financial and operational write paths are incomplete. The top blocker: inventory is never deducted on order approval because `governed_approve_order` (which contains deduction + credit invoice logic) is never called — all status transitions use the generic `governed_change_order_status`.

---

## Section 2 — Canonical Business Entities

Each entity below has exactly one canonical table (the system's authoritative source), one operational code (business identifier), classified as Canonical / Legacy / Duplicate / Dead.

### 2.1 Entity Catalogue

| # | Entity | Canonical Table | PK | Operational Code | Screens | RPCs | Classification |
|---|--------|-----------------|----|-----------------|---------|------|---------------|
| 1 | Identity | `identities` | uuid | phone (unique login) | LoginPage | login, logout, validate_session | Canonical |
| 2 | Customer | `customers` | uuid | `code` (CUS-YYYY-NNNNNN) | CustomersPage, CustomerProfilePage, NewCustomerPage, SupervisorPage | get_governed_customers, governed_create_customer, governed_update_customer, governed_activate/deactivate_customer, governed_change_customer_ownership | Canonical |
| 3 | Employee | `employees` | uuid | `code` (EMP-*) | EmployeesPage, EmployeeProfilePage, HierarchyPage, UserProfilePage, SupervisorPage | get_governed_employees, governed_create_employee, governed_update_employee, governed_change_employee_manager/role, governed_reset_employee_password, governed_update_employee_capabilities | Canonical |
| 4 | Customer Address (Current) | `unified_locations` | uuid | formatted_address | CustomerProfilePage | (written via governed_create_customer / governed_update_customer) | Canonical |
| 5 | Customer Address (Legacy) | `customer_addresses` | uuid | address_line1 | CustomerProfilePage | get_governed_customer_addresses | Legacy |
| 6 | Customer Contact | `customer_contacts` | uuid | phone (operational) | CustomersPage, CustomerProfilePage | get_governed_customer_contacts | Canonical |
| 7 | Order | `orders` | uuid | order_number (ORD-YYYY-NNNNNN) | OrdersPage, OrderDetailPage, OrderNewPage, OrderReviewPage, ApprovalQueuePage, OrderEditPage | get_governed_orders, governed_create_order, governed_submit_order, governed_change_order_status | Canonical |
| 8 | Order Item | `order_items` | uuid | (part of order, frozen at order time) | OrderDetailPage, OrderNewPage, OrderReviewPage, OrderEditPage | get_governed_order_items | Canonical |
| 9 | Order Status History | `order_status_history` | uuid | (INSERT-only audit trail) | OrderDetailPage | get_governed_order_history | Canonical |
| 10 | Visit | `visits` | uuid | code (via governed_checkin_visit) | VisitsPage, VisitScreen, VisitDetailPage | get_governed_visits, governed_checkin_visit, governed_checkout_visit | Canonical |
| 11 | Collection | `collections` | uuid | collection_number (COL-YYYY-NNNNNN) | CollectionsPage, NewCollectionPage, CollectionFollowupPage | get_governed_collections, governed_create_collection, governed_approve_collection | Canonical |
| 12 | Return | `returns` | uuid | return_number | ReturnsPage, ReturnDetailPage | get_governed_returns, governed_approve_return, governed_reject_return | Canonical (no create path) |
| 13 | Delivery | `delivery_tracking` | uuid | (order-linked) | DeliveryPage, DeliveryDetailPage | get_governed_deliveries, governed_assign_delivery, governed_confirm/fail_delivery | Canonical |
| 14 | Preparation | `preparation_records` | uuid | (order-linked) | WarehousePage, WarehousePrepDetail, WarehouseReviewPage | 8 governed_preparation_* RPCs | Canonical |
| 15 | Product | `products` | uuid | product_name | ProductsPage, ProductProfilePage, ProductManagerPage, StorefrontPage | get_governed_products, governed_create/update_product, governed_update_product_pricing/units, governed_activate/deactivate/show/hide_product | Canonical |
| 16 | Inventory | `inventory` | product_id (1:1) | quantity | ProductManagerPage | supabase.from('inventory').upsert() (bypass) | Canonical (manual) |
| 17 | Company | `companies` | uuid | company_name | CompaniesPage, CompanyProfilePage, CompanyManagerPage | get_governed_companies, governed_create/update_company, governed_activate/deactivate_company | Canonical |
| 18 | Tier | `tiers` | uuid | name | TiersManagerPage | get_governed_tiers, governed_create/update_tier | Canonical |
| 19 | Tier Company Exception | `tier_company_exceptions` | id | discount_percent | CompanyManagerPage | governed_set/remove_tier_company_exception | Canonical |
| 20 | Tier Product Exception | `tier_product_exceptions` | id | discount_percent | ProductManagerPage | governed_set/remove_tier_product_exception | Canonical |
| 21 | Credit Program | `credit_programs` | uuid | name | CreditProgramsPage, CreditProgramsManagerPage | governed_get_credit_programs, governed_create/update/toggle_credit_program | Canonical |
| 22 | Credit Application | `credit_applications` | uuid | status (enum) | CreditApplicationsPage, CreditReviewPage | get_governed_credit_applications, governed_confirm_documents, governed_manage_credit_application, governed_decline_credit | Canonical (no create UI) |
| 23 | Credit Account | `customer_credit_accounts` | uuid | credit_limit | (via creditService, no direct UI) | governed_get_customer_credit_account, governed_activate/suspend/reactivate (service only) | Canonical (no operational UI) |
| 24 | Credit Ledger | `customer_credit_ledger` | id | running_balance (INSERT-only) | (no UI reads) | governed_get_customer_credit_ledger, governed_reserve/release/pay (service only) | Canonical (no UI) |
| 25 | Credit Invoice | `credit_invoices` | uuid | invoice_number | CustomerCreditPage | (read via get_governed_credit_invoices) | Canonical |
| 26 | Daily Deal | `daily_deals` | uuid | title | DailyDealsManagerPage | get_governed_daily_deals, governed_update_daily_deal, governed_activate/cancel_daily_deal | Canonical |
| 27 | Flash Offer | `flash_offers` | uuid | title | FlashOffersPage (via service) | flashOfferService (service only) | Canonical |
| 28 | Auction | `auctions` | uuid | code | AuctionsManagerPage, AuctionsPage | get_governed_auctions, supabase.from('auctions').insert/update (bypass) | Canonical |
| 29 | Role | `roles` | uuid | name | EmployeesPage, EmployeeProfilePage, HierarchyPage, UserPermissionsPage | get_governed_roles | Canonical |
| 30 | Capability | `capabilities` | uuid | code (machine-readable) | EmployeeProfilePage, UserPermissionsPage | get_all_capabilities | Canonical |
| 31 | Company Monthly Target | `company_monthly_targets` | (month, year) | target_amount | CompanyTargetsPage, ManagementDashboard | targetService.getCompanyTarget/upsertCompanyTarget | Canonical |
| 32 | Employee Monthly Target | `employee_monthly_targets` | (employee, month, year) | target_amount | EmployeeTargetsPage | targetService.getEmployeeTargets/upsertEmployeeTarget | Canonical |
| 33 | Code Sequence | `code_sequences` | (code_type, year) | last_sequence | (internal — used by generate_* RPCs) | generate_order_number, generate_collection_number | Canonical |
| 34 | Treasury Transaction | `treasury_transactions` | uuid | amount | (no direct UI) | — | Canonical |
| 35 | Expense | `expenses` | uuid | amount | (no direct UI) | — | Canonical |
| 36 | Session | `app.sessions` | uuid | token | LoginPage (via auth API) | validate_session | Canonical |
| 37 | System Config | `system_config` | 1 row | config values | (no UI) | — | Canonical |

### 2.2 Entity Relationships (Minimal Graph)

```
identities ──→ customers, employees (identity_type discriminator)
employees  ──→ customers (owner), orders (creator), visits, collections, returns, preparation_records, delivery_tracking
customers  ──→ orders, returns, collections, visits, customer_credit_accounts, credit_applications
orders     ──→ order_items, order_status_history, order_modification_history, delivery_tracking, preparation_records, returns, credit_invoices
products   ──→ order_items, inventory, product_units, daily_deal_items, flash_offer_items, auction_items, return_items, tier_product_exceptions
companies  ──→ products, company_profile, company_monthly_targets, tier_company_exceptions
tiers      ──→ tier_exceptions, tier_company_exceptions, tier_product_exceptions
unified_locations ──→ customers, visits, orders
roles      ──→ employee_roles, role_capabilities
capabilities ──→ role_capabilities, employee_capabilities
daily_deals ──→ daily_deal_items, order_daily_deals
flash_offers ──→ flash_offer_items, order_flash_offers
auctions    ──→ auction_items, auction_bids, auction_participants, auction_awards, auction_activity
```

---

## Section 3 — Canonical Database Model

### 3.1 Tables in Active Use

| Table | Rows | Used By Screens | Classification |
|-------|------|----------------|---------------|
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
| role_capabilities | — | (indirect via RPCs) | Canonical |
| unified_locations | ~30 | 1 screen | Canonical |
| customer_addresses | 25 | 1 screen | Legacy |
| companies | ~50+ | 3 screens | Canonical |
| company_profile | 1 | 1 screen | Canonical |
| company_monthly_targets | — | 2 screens | Canonical |
| products | ~700+ | 4 screens | Canonical |
| product_units | — | 1 screen | Canonical |
| inventory | ~700 | 1 screen (bypass) | Canonical (manual) |
| orders | 38 | 5 screens | Canonical |
| order_items | 394 | 4 screens | Canonical |
| order_status_history | — | 1 screen | Canonical |
| order_modification_history | — | 0 screens (used internally) | Canonical |
| order_daily_deals | — | 0 screens (used internally) | Canonical |
| order_flash_offers | — | 0 screens (used internally) | Canonical |
| visits | 13 | 3 screens | Canonical |
| collections | 6 | 3 screens | Canonical |
| treasury_transactions | — | 0 screens | Canonical |
| returns | 3 | 2 screens | Canonical |
| return_items | — | 1 screen | Canonical |
| return_inspection | — | 0 screens | Canonical |
| delivery_tracking | — | 2 screens | Canonical |
| preparation_records | 0 | 3 screens | Canonical (empty) |
| preparation_exceptions | 0 | 2 screens | Canonical (empty) |
| tiers | — | 1 screen | Canonical |
| tier_company_exceptions | — | 1 screen | Canonical |
| tier_product_exceptions | — | 1 screen | Canonical |
| tier_exceptions | — | 0 screens | Canonical |
| credit_programs | — | 2 screens | Canonical |
| credit_applications | 3 | 2 screens | Canonical |
| customer_credit_accounts | 3 | 0 screens (service only) | Canonical |
| customer_credit_ledger | — | 0 screens | Canonical |
| credit_invoices | — | 0 screens | Canonical |
| credit_invoice_cheques | — | 0 screens | Canonical |
| credit_contracts | 0 | 0 screens | Canonical |
| credit_contract_templates | — | 0 screens | Canonical |
| daily_deals | 0 | 1 screen | Canonical (empty) |
| daily_deal_items | 0 | (indirect) | Canonical (empty) |
| flash_offers | 0 | 1 screen | Canonical (empty) |
| flash_offer_items | 0 | (indirect) | Canonical (empty) |
| auctions | — | 2 screens | Canonical |
| auction_items | — | (indirect) | Canonical |
| auction_participants | — | (indirect) | Canonical |
| auction_bids | — | (realtime) | Canonical |
| auction_awards | — | (indirect) | Canonical |
| auction_activity | — | (realtime) | Canonical |
| employee_advances | 0 | 0 screens | Canonical (empty) |
| employee_monthly_targets | — | 1 screen | Canonical |
| code_sequences | — | (internal) | Canonical |
| app.sessions | — | (auth) | Canonical |
| system_config | 1 | 0 screens | Canonical |

### 3.2 Tables That Are Dead (No Code References, Zero Rows)

| Table | Rows | Classification |
|-------|------|---------------|
| customer_classification | 0 | Dead |
| customer_daily_deal | 0 | Dead |
| deal | 0 | Dead |
| follow_up | 0 | Dead |
| notification | 0 | Dead |
| permission | 3 | Dead |
| visit_note | 0 | Dead |
| voucher_type | 0 | Dead |
| sync_log | 0 | Dead |
| activity_log | 0 | Dead |
| packages | — | Legacy (superseded) |
| package_items | — | Legacy (superseded) |
| package_orders | — | Legacy (superseded) |

### 3.3 Columns That Are Dead or Deprecated

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

### 3.4 Tables with Bypassed RPC Access (4 pages use supabase.from() directly)

| Table | Page | Operation | Risk |
|-------|------|-----------|------|
| auctions | AuctionsManagerPage | .insert(), .update() — bypasses governed_create_auction | Medium |
| daily_deals | DailyDealsManagerPage | .update() specific fields alongside governed_update_daily_deal | Low |
| products | ProductManagerPage | .update() image_url, is_visibility; .upsert() inventory | Low |
| companies | CompanyManagerPage | .update() logo_url, is_visible | Low |

---

## Section 4 — Canonical Source Of Truth

For every operational concept, exactly one canonical source is designated below. Conflicts and duplicates are noted with resolution status.

### 4.1 Customer Identity & Contact

| Concept | Canonical Source | Secondary Source | Conflict? | Resolution |
|---------|-----------------|-----------------|-----------|------------|
| Customer Auth (login) | `identities.phone` (UNIQUE) | — | No | Keep as-is |
| Customer Operational Phone | `customer_contacts.phone` | `identities.phone` | Low — different purposes | Keep both, document distinction |
| Customer Name | `customers.company_name` | `orders.snapshot_customer_name` | No — intentional snapshot | Keep |
| Customer Code | `customers.code` | — | No (format varies by RPC) | Unify to CUS-YYYY-NNNNNN |
| Customer Business Type | `customers.business_type` | — | No | Keep |
| Customer Email | `customers.email` | — | Low — being removed from UI | Drop UI, keep column |

### 4.2 Customer Address & Location

| Concept | Canonical Source | Secondary Source | Conflict? | Resolution |
|---------|-----------------|-----------------|-----------|------------|
| Formatted Address | `unified_locations.formatted_address` | `customer_addresses.address_line1` | Medium — 15/25 customers on legacy | Migrate customer_addresses → unified_locations |
| GPS Coordinates | `unified_locations.latitude/longitude` | `orders.execution_lat/lng` | Low — dual storage | Keep both (different purposes) |
| Location Link | `customers.location_id → unified_locations.id` | `customer_addresses.customer_id` | Medium — NULL location_id for 15 customers | Complete migration |

### 4.3 Customer Ownership

| Concept | Canonical Source | Secondary Source | Conflict? | Resolution |
|---------|-----------------|-----------------|-----------|------------|
| Current Owner | `customers.owner_id → employees.id` | — | No | Keep |
| Ownership History | `customer_ownership_history` (INSERT-only) | — | No | Keep |
| Owner Snapshot at Order | `orders.snapshot_owner_name/phone/address` | Source tables | No — intentional | Keep |

### 4.4 Orders

| Concept | Canonical Source | Conflict? | Resolution |
|---------|-----------------|-----------|------------|
| Order Number | `orders.order_number` | No | Keep (ORD-YYYY-NNNNNN) |
| Order Status | `orders.status` | No — history is audit trail | Keep |
| Order Items | `order_items` (frozen at order time) | No | Keep |
| Order Total | `orders.total_amount` (subtotal - discount + tax) | No | Keep |
| Order Customer | `orders.customer_id` + `orders.snapshot_customer_name` | No — frozen copy | Keep |
| Order Payment Method | `orders.payment_method` ('cash' or 'credit') | No | Keep |

### 4.5 Products & Pricing

| Concept | Canonical Source | Notes |
|---------|-----------------|-------|
| Product Name | `products.product_name` | Canonical |
| Product Legacy Code | `products.legacy_code` | Legacy — external system, read-only |
| Product Units | `product_units.unit_type` | piece, dozen, carton |
| Stock Quantity | `inventory.quantity` | Manual tracking, deducted via governed_approve_order (NOT CALLED) |
| Tier Discount | `tiers.discount_percent` | Base discount |
| Company Exception | `tier_company_exceptions.discount_percent` | Overrides tier (priority 2) |
| Product Exception | `tier_product_exceptions.discount_percent` | Overrides all (priority 1) |
| Order Item Price | `order_items.unit_price` | Frozen at order time |

### 4.6 Collections, Returns, Visits, Credit

| Concept | Canonical Source | Notes |
|---------|-----------------|-------|
| Collection Code | `collections.code` | COL-YYYY-NNNNNN |
| Collection Amount | `collections.amount` | Canonical |
| Return Code | `returns.code` | Canonical |
| Return Items | `return_items` | Canonical |
| Visit Code | `visits.code` | Generated on check-in |
| Visit GPS (Canonical) | `unified_locations` (via visits.start_location_id) | Structured record |
| Visit GPS (Fallback) | `visits.check_in_latitude/longitude` | Inline fallback |
| Credit Limit (Program) | `credit_programs.credit_limit` | Master definition |
| Credit Limit (Per-Customer) | `customer_credit_accounts.credit_limit` | Copied from program at activation |
| Credit Balance | `customer_credit_ledger.running_balance` | INSERT-only, authoritative |
| Credit Application Status | `credit_applications.status` | Canonical (draft→...→approved/rejected/suspended) |
| Credit Invoice Status | `credit_invoices.status` | open, paid, overdue |
| Cheque Status | `credit_invoice_cheques.status` | received, deposited, collected, cancelled, returned, paid_directly |

### 4.7 Access Control

| Concept | Canonical Source | Notes |
|---------|-----------------|-------|
| Roles | `roles.name` | Dynamic — data-driven |
| Capabilities | `capabilities.code` | Machine-readable (e.g., order.create) |
| Role-Capability | `role_capabilities` | Defines role permissions |
| Employee Role | `employee_roles` | Junction, multiple roles per employee |
| Direct Capability | `employee_capabilities` | Override (grant/deny) |

### 4.8 Targets

| Concept | Canonical Source | Notes |
|---------|-----------------|-------|
| Company Monthly Target | `company_monthly_targets` | Unique on (target_month, target_year) |
| Employee Monthly Target | `employee_monthly_targets` | Unique on (employee_id, target_month, target_year) |

---

## Section 5 — Complete Runtime Map

Every screen classified by data source type:

### 5.1 Live RPC Data (reads + writes directly to database via governed RPCs)

| Screen | Data RPCs | Tables | Data Type |
|--------|-----------|--------|-----------|
| LoginPage | authService.login() | identities (via auth API) | Live |
| RegistrationPage | register_customer | identities, customers, unified_locations, customer_contacts, app.sessions | Live |
| CustomersPage | get_governed_customers, get_governed_customer_contacts | customers, customer_contacts | Live |
| CustomerProfilePage | 10+ RPCs (customer, orders, collections, visits, addresses, contacts, history, employees) | customers, orders, collections, visits, customer_addresses, customer_contacts, customer_ownership_history, employees, unified_locations | Live |
| NewCustomerPage | governed_create_customer | customers, unified_locations, customer_contacts | Live |
| OrdersPage | get_governed_orders, get_governed_customers, get_governed_employees | orders, customers, employees | Live |
| OrderDetailPage | get_governed_order, get_governed_order_items, get_governed_order_history | orders, order_items, order_status_history | Live |
| OrderNewPage | 7 RPCs (customers, companies, products, orders, visits) | customers, companies, products, product_units, orders, order_items, visits | Live |
| OrderReviewPage | governed_create_order, governed_add_order_flash_offers, governed_add_order_daily_deals, governed_submit_order, get_governed_order, get_governed_order_items | orders, order_items, order_flash_offers, order_daily_deals | Live |
| ApprovalQueuePage | get_governed_orders (filtered) | orders | Live |
| OrderEditPage | get_governed_order_items | order_items | Live (read-only) |
| EmployeesPage | 8+ RPCs (create, read, update, manager, role, password) | employees, roles, identities | Live |
| EmployeeProfilePage | 10+ RPCs (employee, activity, roles, capabilities, update, manager, password, capabilities) | employees, roles, capabilities, employee_capabilities | Live |
| HierarchyPage | 7+ RPCs (employees, roles, create, update, manager, role, password) | employees, roles | Live |
| CollectionsPage | get_governed_collections, get_governed_customers, governed_approve_collection | collections, customers | Live |
| NewCollectionPage | get_governed_customers, governed_create_collection | collections, customers | Live |
| CollectionFollowupPage | get_collection_followup_queue | collections, orders, customers | Live |
| ReturnsPage | get_governed_returns | returns | Live (read-only) |
| ReturnDetailPage | get_governed_return, get_governed_return_items, governed_approve_return, governed_reject_return | returns, return_items | Live |
| CreditApplicationsPage | get_governed_credit_applications | credit_applications | Live (read-only) |
| CreditReviewPage | get_governed_credit_application, governed_confirm_documents, governed_manage_credit_application, governed_decline_credit | credit_applications, customer_credit_accounts | Live |
| CreditProgramsPage | governed_get_credit_programs, governed_create/update/toggle_credit_program | credit_programs | Live |
| CreditProgramsManagerPage | governed_get_credit_programs, governed_create/update/toggle_credit_program | credit_programs | Live |
| WarehousePage | 10+ RPCs (preparations, employees, start/complete/review/return/fail/dispatch/exception) | preparation_records, preparation_exceptions, orders, employees | Live |
| WarehousePrepDetail | get_governed_preparation_detail, governed_record_exception | preparation_records, preparation_exceptions | Live |
| WarehouseReviewPage | get_governed_preparation_queue, governed_review_preparation, governed_return_to_preparation | preparation_records | Live |
| DeliveryPage | get_governed_deliveries, get_governed_employees, governed_assign_delivery | delivery_tracking, employees | Live |
| DeliveryDetailPage | governed_get_delivery, governed_confirm/fail_delivery | delivery_tracking | Live |
| VisitsPage | get_governed_visits, get_governed_customers, get_governed_employees, governed_checkin_visit | visits, customers, employees | Live |
| VisitScreen | get_governed_visits, governed_checkin_visit, governed_checkout_visit | visits, customers | Live |
| VisitDetailPage | get_governed_visit, get_governed_employee, get_governed_customer, governed_checkout_visit | visits, employees, customers | Live |
| ProductsPage | get_governed_products, governed_create/update_product, governed_update_product_pricing | products, product_units | Live |
| ProductProfilePage | get_governed_products (filtered) | products, product_units, companies, inventory | Live (read-only) |
| ProductManagerPage | gov RPCs + supabase.from() bypasses (3) | products, product_units, companies, inventory, tiers | Live (mixed) |
| CompaniesPage | governed_create/update/activate/deactivate_company | companies | Live |
| CompanyProfilePage | get_governed_companies, get_company_products | companies, products | Live (read-only) |
| CompanyManagerPage | gov RPCs + supabase.from() bypasses (3) | companies, tiers | Live (mixed) |
| TiersManagerPage | get_governed_tiers, governed_create/update_tier | tiers | Live |
| DailyDealsManagerPage | gov RPCs + supabase.from() bypass (1) | daily_deals, daily_deal_items | Live (mixed) |
| AuctionsManagerPage | get_governed_auctions + supabase.from() bypasses (2) | auctions, auction_items | Live (mixed) |
| AuctionsPage | get_governed_auctions | auctions, auction_items | Live |
| AuctionDetailPage | get_governed_auction_detail, governed_request_auction_participation, governed_place_bid | auctions, auction_bids, auction_activity, auction_participants | Live |
| StorefrontPage | get_governed_products, get_governed_customers | products, product_units, companies, tiers, customers | Live |
| SupervisorPage | 8+ RPCs (customers, employees, orders, visits) | customers, employees, orders, visits | Live |
| GlobalSearch | governed_global_search, get_governed_customers, get_governed_products | customers, products | Live |
| ReportsPage | dynamic supabase.rpc(rpcName, params) | depends on report type | Live |
| SalesRepWorkDay | get_governed_visits, get_governed_customers, get_governed_orders | visits, customers, orders | Live |
| CustomerAnalyticsPage | get_customer_card, get_customer_products, get_customer_brands | customers, orders, products | Live |
| AnalyticsListPage | get_customer_analytics_list, get_customer_sales_ranking | customers, orders | Live |
| Settings CompanyProfile | get_company_profile, governed_update_company_profile | company_profile | Live |
| UserProfilePage | get_governed_employees, governed_update_employee | employees | Live |
| UserPermissionsPage | 4 RPCs (employees, roles, capabilities) | employees, roles, capabilities, employee_capabilities | Live (read-only) |
| AccountPage | get_governed_customers | customers | Live |
| All Dashboards/Workspaces | 1-4 aggregate RPCs each | multiple (aggregate) | Live |

### 5.2 Aggregate/Computed Data (Derived Runtime)

| Screen | RPC(s) | Notes |
|--------|--------|-------|
| ManagementDashboard | get_dashboard_management, get_credit_dashboard_stats | Aggregate KPIs |
| SalesDashboard | get_dashboard_sales | Aggregate |
| TransportDashboard | get_dashboard_transport | Aggregate |
| WarehouseDashboard | get_dashboard_warehouse | Aggregate |
| UpperManagementDashboard | get_upper_management_dashboard, get_dashboard_management | Aggregate |
| AdminWorkspace | get_dashboard_management, get_governed_dashboard_counts, get_governed_products | Aggregate |
| SuperAdminWorkspace | 4 aggregate RPCs | Aggregate |
| SalesDirectorWorkspace | get_governed_orders, get_governed_visits, get_governed_employees | List |
| AccountantWorkspace | get_governed_collections, get_governed_orders | List |
| CollectorWorkspace | get_governed_collections | List |
| PerformanceAnalysisPage | get_governed_target_performance, get_kpi_contributors | Aggregate |
| EmployeeAnalysisPage | get_rep_customer_kpis, get_customer_delivered_orders | Aggregate |

### 5.3 Cached / Session Data

| Screen | Data Source | Notes |
|--------|-------------|-------|
| CartPage | cartStore (Zustand + localStorage persist) | In-memory cart with pricing engine |
| NewVisitPage | visitsStore (Zustand, not persisted) | Local store entry, not DB until check-in |

### 5.4 Empty Shells (Zero Supabase Calls)

| Screen | File | Notes |
|--------|------|-------|
| CheckoutPage | src/pages/checkout/CheckoutPage.tsx | Empty — renders nothing functional |
| ActivityPage | src/pages/activity/ActivityPage.tsx | Empty — renders nothing functional |
| FlashOffersPage | src/pages/flash-offers/FlashOffersPage.tsx | Zero direct RPC calls; may use flashOfferService |
| FlashOfferDetailPage | src/pages/flash-offers/FlashOfferDetailPage.tsx | Same |
| FlashOffersManagementPage | src/pages/flash-offers/FlashOffersManagementPage.tsx | Same |
| DealsPage | src/pages/deals/DealsPage.tsx | Zero direct RPC calls; may use dealService |

### 5.5 Static / Navigation Only

| Screen | Notes |
|--------|-------|
| DashboardPage | Router — dispatches to role-specific workspace |
| ModuleLauncherPage | Static navigation |
| SubLauncherPage | Static navigation |

---

## Section 6 — Workflow Map

### 6.1 Complete Workflow Log

| # | Workflow | Start Screen | Key RPC | End State | Status |
|---|----------|-------------|---------|-----------|--------|
| 1 | Customer Self-Registration | RegistrationPage | register_customer | LoginPage | Operational |
| 2 | Managed Customer Creation | NewCustomerPage / SupervisorPage | governed_create_customer | CustomerProfilePage | Operational |
| 3 | Employee Creation | EmployeesPage / HierarchyPage / SupervisorPage | governed_create_employee | EmployeeProfilePage | Operational |
| 4 | Login | LoginPage | authService.login() | DashboardPage | Operational |
| 5 | Visit Check-In | VisitsPage / VisitScreen | governed_checkin_visit | VisitScreen | Operational |
| 6 | Visit Check-Out | VisitDetailPage / VisitScreen | governed_checkout_visit | VisitsPage | Operational |
| 7 | Order Creation | OrderNewPage / OrderReviewPage | governed_create_order | OrderReviewPage | Operational |
| 8 | Order Submission | OrderReviewPage / OrderNewPage | governed_submit_order | OrdersPage | Operational |
| 9 | Order Approval | OrderStatusManager | governed_change_order_status (NOT governed_approve_order) | Order.dispatched | Broken |
| 10 | Order Rejection | OrderStatusManager | governed_change_order_status (NOT governed_deny_order) | Order.cancelled | Broken |
| 11 | Warehouse Preparation | WarehousePage | governed_start_preparation | in_progress | Operational |
| 12 | Warehouse Completion | WarehousePage | governed_complete_preparation | completed | Operational |
| 13 | Warehouse Review | WarehouseReviewPage | governed_review_preparation | reviewed | Operational |
| 14 | Order Dispatch | WarehousePage | governed_dispatch_order | dispatched + delivery created | Operational |
| 15 | Delivery Assignment | DeliveryPage | governed_assign_delivery | assigned | Operational |
| 16 | Delivery Confirmation | DeliveryDetailPage | governed_confirm_delivery | delivered | Operational |
| 17 | Collection Creation | NewCollectionPage | governed_create_collection | pending | Operational |
| 18 | Collection Approval | CollectionsPage | governed_approve_collection | approved | Operational |
| 19 | Return Creation | (no UI) | governed_create_return (NOT CALLED) | return.pending | Broken |
| 20 | Return Approval | ReturnDetailPage | governed_approve_return | approved | Operational |
| 21 | Return Rejection | ReturnDetailPage | governed_reject_return | rejected | Operational |
| 22 | Credit App Creation | (no UI) | governed_create_credit_application (NOT CALLED) | credit_app.draft | Broken |
| 23 | Credit App Documents | CreditReviewPage | governed_confirm_documents | documents_received | Operational |
| 24 | Credit App Approval | CreditReviewPage | governed_manage_credit_application | approved + account created | Operational |
| 25 | Credit App Rejection | CreditReviewPage | governed_decline_credit | rejected | Operational |
| 26 | Credit Program CRUD | CreditProgramsPage | governed_create/update/toggle_credit_program | — | Operational |
| 27 | Product CRUD | ProductsPage / ProductManagerPage | governed_create/update_product | — | Operational |
| 28 | Company CRUD | CompaniesPage / CompanyManagerPage | governed_create/update_company | — | Operational |
| 29 | Tier CRUD + Exceptions | TiersManagerPage | governed_create/update_tier + exception RPCs | — | Operational |
| 30 | Daily Deal Manage | DailyDealsManagerPage | gov RPCs + from() bypass | — | Partial |
| 31 | Flash Offer Manage | FlashOffersManagementPage (service layer) | flashOfferService | — | Orphaned |
| 32 | Auction Manage | AuctionsManagerPage | supabase.from('auctions').insert (bypass) | — | Partial |
| 33 | Dashboard Views | 20+ workspaces | Aggregate RPCs | — | Operational |
| 34 | Target Management | CompanyTargetsPage / EmployeeTargetsPage | targetService | — | Operational |
| 35 | Customer Ownership Change | CustomerProfilePage | governed_change_customer_ownership | — | Operational |
| 36 | Employee Manager/Role | EmployeeProfilePage | governed_change_employee_manager / _role | — | Operational |
| 37 | Global Search | GlobalSearch component | governed_global_search | — | Operational |
| 38 | Reports | ReportsPage | dynamic supabase.rpc() | — | Partial |
| 39 | Customer Analytics | CustomerAnalyticsPage | get_customer_card / _products / _brands | — | Operational |

### 6.2 Summary

| Classification | Count | Workflows |
|---------------|-------|-----------|
| Operational | 27 | 1–8, 11–18, 20–21, 23–30, 33–37, 39 |
| Partial | 3 | 30 (Daily Deals bypass), 33 (Auctions bypass), 38 (Reports dynamic) |
| Broken | 4 | 9 (Order Approval — inventory not deducted), 10 (Order Rejection — deny RPC orphaned), 19 (Return Creation — no UI), 22 (Credit App Creation — no UI) |
| Orphaned | 1 | 31 (Flash Offers — service layer only, unconfirmed page integration) |

---

## Section 7 — Dead Assets

### 7.1 Dead Tables (No Code References, Zero Rows)

| Table | Last Activity | Method of Detection |
|-------|-------------|-------------------|
| customer_classification | Created 2026-05-22, 0 rows | No RPC reads or writes, no frontend grep match |
| customer_daily_deal | Created 2026-05-22, 0 rows | Same |
| deal | Created 2026-05-30, 0 rows | Same |
| follow_up | Created 2026-05-18, 0 rows | Same |
| notification | Created 2026-05-30, 0 rows | Same |
| permission | Created 2026-04-25, 3 legacy rows | No code references, legacy from older auth system |
| visit_note | Created 2026-05-25, 0 rows | No code references |
| voucher_type | Created 2026-05-25, 0 rows | No code references |
| sync_log | Created 2026-05-22, 0 rows | No trigger exists, no code references |
| activity_log | Created 2026-05-25, 0 rows | No trigger exists, no code references |
| packages | — | Legacy — superseded by daily_deals/flash_offers |
| package_items | — | Legacy — superseded |
| package_orders | — | Legacy — superseded |

### 7.2 Dead RPCs (Exist in Database, Zero Frontend Call Sites)

| RPC | Reason | Method of Detection |
|-----|--------|-------------------|
| test_ping2 | Test artifact | grep for `test_ping2` across all .tsx, .ts files — zero matches |
| test_ping3 | Test artifact | Same |
| test_rpc | Test artifact | Same |
| test_setof | Test artifact | Same |
| test_func | Test artifact | Same |
| multiline_test | Test artifact | Same |
| governed_approve_order | Orphaned — approval uses governed_change_order_status | Same — zero call sites |
| governed_deny_order | Orphaned — denial uses governed_change_order_status | Same |
| governed_create_return | Orphaned — no UI creates returns | Same |
| governed_update_return | Orphaned — no UI updates returns | Same |
| governed_update_collection | Orphaned — no UI updates collections | Same |
| governed_create_visit | Orphaned — checkin creates visits implicitly | Same |
| governed_create_location | Orphaned — governed_create_customer handles location | Same |
| governed_create_daily_deal | Orphaned — DailyDealsManagerPage uses update+bypass | Same |
| governed_create_flash_offer | Orphaned — no page calls it | Same |
| governed_update_flash_offer | Orphaned — no page calls it | Same |
| governed_create_auction | Orphaned — AuctionsManagerPage uses raw insert | Same |
| governed_reassign_customer_ownership | Duplicate — governed_change_customer_ownership used | Same |
| governed_create_credit_application | Orphaned — no UI creates credit applications | Same |
| governed_submit_credit_application | Orphaned — no UI submits drafts | Same |
| governed_suspend_credit | Orphaned — no UI suspends applications | Same |
| governed_reserve_credit | Orphaned — no UI reserves credit | Same |
| governed_release_credit_reservation | Orphaned — no UI releases reservations | Same |
| governed_pay_credit_invoice | Orphaned — no UI pays invoices | Same |
| governed_register_cheque | Orphaned — no UI registers cheques | Same |
| governed_suspend_credit_account | Orphaned — no UI suspends accounts | Same |
| governed_update_contract_template | Orphaned — no UI edits templates | Same |
| register_customer | Dual path — RegistrationPage uses it, but NewCustomerPage uses governed_create_customer | Kept for self-registration path |
| ping | Health check only, no frontend call | Keep as utility |
| ensure_system_customer_owner | Called by triggers only | Keep (system utility) |
| _calc_base_unit_price | Called internally by other RPCs | Keep (private function) |

### 7.3 Dead Screens

| Screen | File | Reason |
|--------|------|--------|
| CheckoutPage | src/pages/checkout/CheckoutPage.tsx | Zero supabase calls, renders nothing functional |
| ActivityPage | src/pages/activity/ActivityPage.tsx | Zero supabase calls |

### 7.4 Dead Service Methods (Never Called from Any Page)

| Service | Method | RPC Wrapped |
|---------|--------|-------------|
| creditService | activateAccount | governed_activate_credit_account |
| creditService | suspendAccount | governed_suspend_credit_account |
| creditService | reactivateAccount | governed_reactivate_credit_account |
| creditService | recordCheque | governed_register_cheque |
| creditService | recordPayment | governed_pay_credit_invoice |
| creditService | reserveCreditForOrder | governed_reserve_credit |
| creditService | releaseCreditReservation | governed_release_credit_reservation |
| creditService | convertReservationToOutstanding | governed_convert_credit_reservation_to_outstanding |
| creditService | getCustomerLedger | governed_get_customer_credit_ledger |
| creditService | getCustomerStatements | governed_get_customer_monthly_statements |
| creditService | createApplication | governed_create_credit_application |

### 7.5 Dead Columns

| Table.Column | Reason |
|-------------|--------|
| customers.email | Removed from all UIs, NULLABLE column |
| orders.snapshot_sender_name | Never populated by frontend code |
| orders.snapshot_sender_phone | Same |
| orders.snapshot_sender_address | Same |
| orders.execution_latitude | Superseded by execution_location_id |
| orders.execution_longitude | Same |
| orders.execution_accuracy_meters | Same |
| orders.execution_captured_at | Same |
| customers.credit_limit | Superseded by cca.credit_limit |
| customers.credit_days | Superseded by cca.payment_term_days |

### 7.6 Unreachable States (Defined in Enums, No Path to Enter via UI)

| Entity | Unreachable State | Reason |
|--------|------------------|--------|
| Return | pending (initial) | governed_create_return never called |
| Visit | scheduled | governed_create_visit never called |
| Credit Application | draft, submitted, suspended | RPCs exist but no UI calls them |
| Order | ready_for_dispatch | No normal transition leads TO it (only manual override) |

---

## Section 8 — Architectural Conflicts

### 8.1 Dual Source of Truth Conflicts

| # | Conflict | Source A | Source B | Risk | Root Cause |
|---|----------|----------|----------|------|------------|
| 1 | Customer Address | unified_locations (current, ~30 rows) | customer_addresses (legacy, 25 rows) | Medium — 15 customers have NULL location_id, falling back to legacy table | Incomplete migration; 60% of customers still on legacy system |
| 2 | Customer Credit Limit | customer_credit_accounts.credit_limit (per-customer from program) | customers.credit_limit (legacy field) | Medium — CustomerProfilePage shows customers.credit_limit which may be stale | Field not migrated from legacy customer table to credit_account |
| 3 | Customer Credit Days | customer_credit_accounts.payment_term_days | customers.credit_days | Medium — same pattern as credit limit | Same |
| 4 | Credit Balance | customer_credit_ledger.running_balance (INSERT-only, authoritative) | customer_credit_accounts.outstanding_credit (cached) | Low — cache can drift from authoritative ledger | Performance optimization without sync mechanism |
| 5 | Visit GPS | unified_locations (via visits.start_location_id) | visits.check_in_latitude/longitude (inline fallback) | Low — same GPS stored in two places | Redundant storage for convenience |
| 6 | Customer Phone | identities.phone (auth, UNIQUE) | customer_contacts.phone (operational display) | Low — different values valid (contact ≠ auth) | No DB constraint enforcing equality |
| 7 | Order Status | orders.status (current state) | order_status_history (audit trail) | None — intentional | Append-only audit trail |
| 8 | Order Snapshots | orders.snapshot_* (frozen at order time) | Source tables (customers, employees) | None — intentional | Historical preservation |

### 8.2 Dual Execution Path Conflicts

| # | Conflict | Path A | Path B | Risk |
|---|----------|--------|--------|------|
| 1 | Customer Creation | NewCustomerPage → governed_create_customer (no auth/session) | RegistrationPage → register_customer (creates identity + session) | Medium — two different behaviors depending on entry point |
| 2 | Order Approval | OrderStatusManager → governed_change_order_status (generic, no inventory/credit logic) | governed_approve_order (has inventory + credit invoice logic, NOT CALLED) | Critical — inventory never deducted, credit invoices never created |
| 3 | Auction Creation | AuctionsManagerPage → supabase.from('auctions').insert() (raw, bypasses governed RPC) | governed_create_auction (with validation + code gen, NOT CALLED) | Medium — raw inserts skip business logic |
| 4 | Customer Ownership Change | CustomerProfilePage → governed_change_customer_ownership (CALLED) | governed_reassign_customer_ownership (NOT CALLED) | Low — duplicate RPC exists but unused |
| 5 | Daily Deal Create | DailyDealsManagerPage → governed_update_daily_deal + from() bypass (no create call) | governed_create_daily_deal (EXISTS in DB, NOT CALLED) | Low — create RPC exists but unconnected |

### 8.3 Governance Bypasses (supabase.from() Instead of governed RPC)

| # | Page | Table | Operation | Line | Risk |
|---|------|-------|-----------|------|------|
| 1 | AuctionsManagerPage | auctions | .insert({...}) bypasses governed_create_auction | 96 | Medium |
| 2 | AuctionsManagerPage | auctions | .update(patch).eq('id', id) bypasses governed RPC | 75 | Medium |
| 3 | DailyDealsManagerPage | daily_deals | .update(directFields).eq('id', id) alongside gov RPC | 100 | Low |
| 4 | ProductManagerPage | products | .update({image_url}) | 161 | Low |
| 5 | ProductManagerPage | products | .update({is_visible}) | 166 | Low |
| 6 | ProductManagerPage | inventory | .upsert({product_id, quantity}) | 177 | Low |
| 7 | CompanyManagerPage | companies | .select('*').eq('id', id) (read-only) | 72 | None |
| 8 | CompanyManagerPage | companies | .update({logo_url}) | 113 | Low |
| 9 | CompanyManagerPage | companies | .update({is_visible}) | 118 | Low |

### 8.4 Schema Design Conflicts

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | Polymorphic owner_type/owner_id (string-based FK) | customers, orders, returns | No FK enforcement; typo creates orphaned references |
| 2 | Year-based code_sequences PK | code_sequences(code_type, year) | Non-unique codes across years |
| 3 | No unique constraint on tier_exceptions | tier_exceptions(tier_id, customer_id) | Duplicate exceptions possible |
| 4 | Inventory disconnected from warehouse | inventory table (manual) | Stock counts are trust-based, no real-time sync |

---

## Section 9 — Production Readiness

### 9.1 Production Blockers (Prevents System from Functioning as B2B Platform)

| # | Blocker | Category | Impact | Root RPC |
|---|---------|----------|--------|----------|
| B1 | Inventory never deducted on order approval | Inventory Integrity | Stock levels never decrease. Warehouse staff cannot trust inventory numbers. Warehouse over-selling is possible. | governed_approve_order (NOT CALLED) |
| B2 | Credit invoices never created on approval | Financial | Credit customers cannot be billed. governed_approve_order contains credit invoice creation logic that never executes. | governed_approve_order (NOT CALLED) |
| B3 | Returns cannot be created through UI | Operational | Staff cannot process damaged/incorrect goods through the system. governed_create_return exists but no UI calls it. | governed_create_return (NOT CALLED) |
| B4 | No credit payment/cheque/ledger UI | Financial | 8 RPCs for payment, cheque, ledger exist but no page calls them. 3 credit accounts exist but cannot be serviced. | governed_pay_credit_invoice, governed_register_cheque, et al. |
| B5 | No credit reservation during order | Financial | Credit orders can exceed customer limit without any check at order creation time. | governed_reserve_credit (NOT CALLED) |
| B6 | No credit application creation UI | Operational | New customers cannot apply for credit through the system. governed_create_credit_application exists but no page calls it. | governed_create_credit_application (NOT CALLED) |
| B7 | Auctions bypass governed RPC | Data Integrity | Raw inserts/updates to auctions table skip validation, code generation, authorization logic. | supabase.from('auctions').insert() (bypass) |
| B8 | 60% of customers on legacy address | Data Integrity | 15/25 customers have NULL location_id. Migration from legacy customer_addresses to unified_locations incomplete. | (migration gap) |

### 9.2 High Risk Issues

| # | Issue | Impact | Evidence |
|---|-------|--------|----------|
| H1 | governed_approve_order orphaned replaces approval business logic | Generic governed_change_order_status handles all transitions including 'approved' status without inventory/credit logic | OrderStatusManager.tsx:88 — single RPC for all transitions |
| H2 | Dual customer creation paths | register_customer creates identity+session; governed_create_customer does not. Different behavior per entry point. | RegistrationPage vs NewCustomerPage |
| H3 | No delivery→collection automated link | After delivery confirmed, no automatic collection creation. Staff must manually create collection. | No governed_create_collection call from DeliveryDetailPage |
| H4 | Flash offers service layer unverified | flashOfferService exists with full CRUD wrappers but no confirmed page integration | Zero direct supabase calls in flash-offers/*.tsx |

### 9.3 Medium Risk Issues

| # | Issue | Impact |
|---|-------|--------|
| M1 | Year-based code_sequences PK | Non-unique order/collection numbers across years |
| M2 | Dual customer address system | 15 customers on legacy path; any cleanup breaks them |
| M3 | Polymorphic owner_type/owner_id | String-based FK with no referential enforcement |
| M4 | Tier_exceptions no unique constraint | Duplicate exceptions produce inconsistent pricing |
| M5 | Empty CheckoutPage and ActivityPage | User-facing empty screens create confusion |
| M6 | customers.email demoted from all UIs | Column still in schema, RPCs still accept parameter |

### 9.4 Low Risk Issues

| # | Issue | Impact |
|---|-------|--------|
| L1 | Snapshot_sender_* dead columns | 3 unused columns in orders table |
| L2 | Execution_gps raw columns superseded | 4 columns duplicated by execution_location_id |
| L3 | customers.credit_limit/credit_days legacy | Displayed on profile page but superseded by credit_account tables |
| L4 | Inventory manual only | No external or real-time stock sync |

### 9.5 Domain Readiness Scores

| Domain | Score | Assessment |
|--------|-------|------------|
| Customers | 90/100 | Full CRUD + ownership + address/contact. Missing: delete (by design). |
| Employees | 92/100 | Full lifecycle. Missing: delete (by design). |
| Orders | 65/100 | Full create/submit/read. **Approval business logic never executes.** |
| Warehouse | 95/100 | Full preparation lifecycle. Most complete domain. |
| Delivery | 85/100 | Assign, confirm, fail work. Missing: route optimization, photo proof. |
| Collections | 70/100 | Create + approve work. No update, no reject, no single-read RPC. |
| Returns | 40/100 | Read/approve/reject work. **No create flow — operational blocker.** |
| Visits | 80/100 | Check-in/out work. governed_create_visit not called (checkin handles it). |
| Credit | 25/100 | Programs full CRUD. Applications: read/approve/reject only. **No create, no payments, no ledger, no reservation.** |
| Dashboards | 85/100 | All role-specific workspaces render real data. |
| Storefront | 70/100 | Products, cart, order creation work. **CheckoutPage is empty.** |
| Governance | 82/100 | 9 bypass instances (mostly low-risk). Auctions bypass is the most significant gap. |

**Overall Production Readiness: 57/100**

---

## Section 10 — Canonical Cleanup Roadmap

No execution — classification only. Each asset assigned one of: SAFE NOW / NEEDS MIGRATION / BLOCKED / NEEDS DECISION.

### 10.1 Tables

| Table | Classification | Action | Precondition |
|-------|---------------|--------|-------------|
| customer_classification | SAFE NOW | Drop | None — 0 rows, zero references |
| customer_daily_deal | SAFE NOW | Drop | None |
| deal | SAFE NOW | Drop | None |
| follow_up | SAFE NOW | Drop | None |
| notification | SAFE NOW | Drop | None |
| permission | SAFE NOW | Drop | None — 3 legacy rows, zero references |
| visit_note | SAFE NOW | Drop | None |
| voucher_type | SAFE NOW | Drop | None |
| sync_log | SAFE NOW | Drop | None — no trigger, no references |
| activity_log | SAFE NOW | Drop | None — no trigger, no references |
| packages | SAFE NOW | Drop | Verify no external consumer |
| package_items | SAFE NOW | Drop | Same |
| package_orders | SAFE NOW | Drop | Same |
| customer_addresses | NEEDS MIGRATION | Migrate to unified_locations | All 25 customers have location_id |
| daily_deals | BLOCKED | Keep (data-free but structurally may be needed for feature) | Confirm product roadmap |
| flash_offers | BLOCKED | Keep (same reasoning) | Confirm product roadmap |
| credit_contracts | BLOCKED | Keep (empty but needed for completed credit workflow) | Complete credit module |

### 10.2 Columns

| Table.Column | Classification | Action | Precondition |
|-------------|---------------|--------|-------------|
| customers.email | SAFE NOW | Drop column | Update RPCs to stop accepting parameter |
| orders.snapshot_sender_name | SAFE NOW | Drop column | Verify no external report/PDF dependency |
| orders.snapshot_sender_phone | SAFE NOW | Drop column | Same |
| orders.snapshot_sender_address | SAFE NOW | Drop column | Same |
| orders.execution_latitude | SAFE NOW | Drop column | Confirm execution_location_id fully replaces it |
| orders.execution_longitude | SAFE NOW | Drop column | Same |
| orders.execution_accuracy_meters | SAFE NOW | Drop column | Same |
| orders.execution_captured_at | SAFE NOW | Drop column | Same |
| customers.credit_limit | NEEDS MIGRATION | Migrate UI to cca.credit_limit | CustomerProfilePage display switched |
| customers.credit_days | NEEDS MIGRATION | Migrate UI to cca.payment_term_days | CustomerProfilePage display switched |
| products.legacy_code | BLOCKED | Keep — external dependency | Cannot remove |
| companies.legacy_code | BLOCKED | Keep — external dependency | Cannot remove |

### 10.3 RPCs

| RPC | Classification | Action | Precondition |
|-----|---------------|--------|-------------|
| test_ping2 | SAFE NOW | Drop | None |
| test_ping3 | SAFE NOW | Drop | None |
| test_rpc | SAFE NOW | Drop | None |
| test_setof | SAFE NOW | Drop | None |
| test_func | SAFE NOW | Drop | None |
| multiline_test | SAFE NOW | Drop | None |
| governed_reassign_customer_ownership | SAFE NOW | Drop | Confirm governed_change_customer_ownership is complete |
| governed_update_contract_template | SAFE NOW | Drop | None |
| governed_create_visit | SAFE NOW | Drop | governed_checkin_visit handles creation |
| governed_create_location | SAFE NOW | Drop | governed_create_customer handles location |
| ping | NEEDS DECISION | Keep or Drop | Determine infra health-check dependency |
| governed_create_daily_deal | NEEDS DECISION | Wire to page or Drop | If DailyDealsManagerPage should use it |
| governed_create_flash_offer | NEEDS DECISION | Wire to page or Drop | If flash offers are to be fully implemented |
| governed_update_flash_offer | NEEDS DECISION | Wire to page or Drop | Same |
| governed_create_auction | NEEDS DECISION | Wire to AuctionsManagerPage or Drop | Replace raw insert with gov RPC call |
| governed_approve_order | BLOCKED | Wire to OrderStatusManager approval flow | Requires order approval refactoring |
| governed_deny_order | BLOCKED | Wire to OrderStatusManager denial flow | Same |
| governed_create_return | BLOCKED | Wire to new ReturnCreationPage | Requires return creation UI |
| governed_update_return | BLOCKED | Wire to UI or Drop | If return edit is needed |
| governed_update_collection | BLOCKED | Wire to UI or Drop | If collection edit is needed |
| All credit RPCs (13) | BLOCKED | Keep until credit module is completed | Part of incomplete credit subsystem |
| register_customer | BLOCKED | Keep — RegistrationPage depends on it | Dual path to be resolved later |

### 10.4 Screens

| Screen | Classification | Action | Precondition |
|--------|---------------|--------|-------------|
| CheckoutPage | NEEDS DECISION | Implement or Remove | Confirm product roadmap |
| ActivityPage | NEEDS DECISION | Implement or Remove | Confirm product roadmap |

### 10.5 Services

| Service | Classification | Action | Precondition |
|---------|---------------|--------|-------------|
| flashOfferService | NEEDS AUDIT | Verify page integration | Audit flash-offers/*.tsx imports |
| dealService | NEEDS AUDIT | Verify page integration | Audit deals/*.tsx imports |
| creditService (orphan methods) | BLOCKED | Keep until credit module completed | Part of incomplete credit subsystem |

---

## Section 11 — Final Executive Verdict

### 11.1 Canonical (The Official Truth of the System)

The following represent the system's authoritative runtime:

- **Architecture:** Frontend → `supabase.rpc('governed_*')` → PostgreSQL. 232+ RPC calls across 70+ files. 4 bypasses via `supabase.from()`.
- **Auth:** `identities` table + Supabase Auth API. Single login path via `authService.login()`.
- **Customers:** `customers` table written/read via `governed_create_customer` / `get_governed_customers`.
- **Orders:** `orders` → `governed_create_order` → `governed_change_order_status` (NOT `governed_approve_order`).
- **Inventory:** `inventory` table, manually updated via `supabase.from('inventory').upsert()` — never deducted on approval.
- **Credit:** Programs full CRUD. Applications read/approve/reject only. No create/payment/ledger UI.
- **Returns:** Read/approve/reject only. No create path, no `governed_create_return` called anywhere.
- **Addresses:** `unified_locations` is current canonical. `customer_addresses` is legacy with 15/25 customers unmigrated.
- **Warehouse:** Full preparation lifecycle — the most complete domain in the system.
- **Dashboards:** All 20+ role-specific workspaces render real aggregate data.

### 11.2 Legacy (Exists for Backward Compatibility Only)

| Asset | Reason |
|-------|--------|
| customer_addresses | 15 customers still on legacy address system |
| customers.credit_limit / customers.credit_days | Superseded by credit_account tables |
| orders.snapshot_sender_name/phone/address | Superseded by snapshot_owner fields |
| packages / package_items / package_orders | Superseded by daily_deals/flash_offers |
| permission table (3 rows) | Dead — superseded by capabilities system |
| products.legacy_code / companies.legacy_code | Read-only external system references (cannot remove) |

### 11.3 Duplicate (Two Active Sources for One Concept)

| Concept | Primary | Secondary | Risk |
|---------|---------|-----------|------|
| Customer Address | unified_locations | customer_addresses | Medium — 60% unmigrated |
| Customer Credit Limit | cca.credit_limit | customers.credit_limit | Medium — wrong field shown in UI |
| Credit Balance | customer_credit_ledger | cca.outstanding_credit (cache) | Low |
| Visit GPS | unified_locations | visits.check_in_lat/lng | Low |
| Customer Phone (Auth) | identities.phone | customer_contacts.phone | Low (different purposes) |

### 11.4 Dead (No Runtime Relevance)

| Category | Count | Items |
|----------|-------|-------|
| Dead Tables | 13 | customer_classification, customer_daily_deal, deal, follow_up, notification, permission, visit_note, voucher_type, sync_log, activity_log, packages, package_items, package_orders |
| Dead RPCs | 26 | 6 test RPCs + 20 orphaned governed_* RPCs (approve/deny_order, create/update_return, create_flash_offer, create_daily_deal, create_auction, credit RPCs, etc.) |
| Dead Screens | 2 | CheckoutPage, ActivityPage |
| Dead Columns | 10 | customers.email, snapshot_sender_* (3), execution_gps_* (4), customers.credit_limit/days |
| Dead Service Methods | 11 | All creditService methods except basic reads |

### 11.5 Production Readiness Score

| Metric | Value |
|--------|-------|
| Overall Readiness | **57/100** |
| Domains ≥85 (Strong) | 3 — Customers, Employees, Warehouse |
| Domains 70–84 (Adequate) | 4 — Delivery, Collections, Visits, Dashboards |
| Domains 50–69 (Weak) | 2 — Orders (65), Storefront (70) |
| Domains <50 (Critical) | 2 — Credit (25), Returns (40) |
| Production Blockers | 8 |
| High Risk Issues | 4 |
| Medium Risk Issues | 6 |

### 11.6 What Prevents Going to 100%

1. **governed_approve_order is orphaned** — inventory deduction and credit invoice creation logic exists in DB but is never executed. All order approvals go through generic `governed_change_order_status` which lacks this business logic. This alone accounts for ~15 points of the readiness gap.

2. **Credit subsystem is half-built** — 20 RPCs exist but only 6 are called from UI. No payment collection, no ledger, no cheque management, no reservation. 3 credit accounts exist but cannot be operationally managed.

3. **Return creation is missing** — Staff cannot initiate returns through the UI. `governed_create_return` exists but has no frontend caller.

4. **15 customers on legacy address system** — 60% of customers have no `location_id` link to `unified_locations`, blocking address cleanup.

5. **Two empty shell pages** — CheckoutPage and ActivityPage render nothing useful, creating user confusion.

### 11.7 Canonical Paths (The Authoritative Way the System Works Today)

```
Customer Create:       NewCustomerPage → governed_create_customer → customers + unified_locations + customer_contacts
Customer Create (Alt): RegistrationPage → register_customer → identities + customers + unified_locations + customer_contacts + session
Employee Create:       EmployeesPage → governed_create_employee → identities + employees + employee_roles + employee_capabilities
Order Create:          OrderNewPage → governed_create_order → orders + order_items + order_status_history
Order Submit:          OrderReviewPage → governed_submit_order → orders.status = submitted
Order Status Change:   OrderStatusManager → governed_change_order_status → orders.status + order_status_history [ALL transitions]
Inventory Update:      ProductManagerPage → supabase.from('inventory').upsert() [BYPASS — no deduction path]
Inventory Deduct:      governed_approve_order [NOT CALLED — NEVER EXECUTED]
Visit Check-In:        VisitsPage → governed_checkin_visit → visits + unified_locations
Visit Check-Out:       VisitDetailPage → governed_checkout_visit → visits
Collection Create:     NewCollectionPage → governed_create_collection → collections
Collection Approve:    CollectionsPage → governed_approve_collection → collections
Return Approve:        ReturnDetailPage → governed_approve_return → returns
Return Reject:         ReturnDetailPage → governed_reject_return → returns
Delivery Assign:       DeliveryPage → governed_assign_delivery → delivery_tracking
Delivery Confirm:      DeliveryDetailPage → governed_confirm_delivery → delivery_tracking
Warehouse Start:       WarehousePage → governed_start_preparation → preparation_records
Dispatch Order:        WarehousePage → governed_dispatch_order → orders + delivery_tracking
Credit Program CRUD:   CreditProgramsPage → governed_create/update/toggle_credit_program
Credit App Review:     CreditReviewPage → governed_confirm_documents → governed_manage_application/governed_decline_credit
Product CRUD:          ProductsPage → governed_create/update_product → products
Company CRUD:          CompaniesPage → governed_create/update_company → companies
Tier CRUD:             TiersManagerPage → governed_create/update_tier → tiers
Customer Ownership:    CustomerProfilePage → governed_change_customer_ownership → customers + customer_ownership_history
Global Search:         GlobalSearch → governed_global_search → customers + products
Dashboard:             DashboardPage → [role dispatch] → aggregate RPC(s) → dashboard data
```
