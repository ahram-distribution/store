# 14. Canonical Runtime Model

> **Goal:** The single authoritative reference for every concept in the system — what is canonical, what is legacy, what is duplicate, what is dead. Before any cleanup or refactoring.
> **Status:** Complete ✓
> **Date:** 2026-06-09
> **Methodology:** Synthesis of 13 prior blueprint files + full source code analysis of 27 page directories, 11 service files, all RPCs and tables.

---

## Section 1 — Canonical Business Entities

### 1.1 Entity Catalogue

| # | Entity | Canonical Table | PK | Operational Code | Screens | RPCs | Classification |
|---|--------|-----------------|----|-----------------|---------|------|---------------|
| 1 | **Identity** | `identities` | `id` | phone (unique login) | LoginPage | login, logout, validate_session, check_capability | **Canonical** |
| 2 | **Customer** | `customers` | `id` | `code` (CUS-...) | CustomersPage, CustomerProfilePage, NewCustomerPage, SupervisorPage | get_governed_customers, governed_create_customer, governed_update_customer, governed_activate/deactivate_customer, governed_change_customer_ownership | **Canonical** |
| 3 | **Employee** | `employees` | `id` | `code` (EMP-...) | EmployeesPage, EmployeeProfilePage, HierarchyPage, UserProfilePage, SupervisorPage | get_governed_employees, governed_create_employee, governed_update_employee, governed_change_employee_manager/role, governed_reset_password, governed_update_capabilities | **Canonical** |
| 4 | **Customer Address** | `unified_locations` | `id` | formatted_address (via GPS/inline) | CustomerProfilePage | get_governed_customer_addresses (reads), governed_create_customer (writes) | **Canonical** |
| 5 | **Customer Address (Legacy)** | `customer_addresses` | `id` | address_line1 | CustomerProfilePage | get_governed_customer_addresses (reads) | **Legacy** |
| 6 | **Customer Contact** | `customer_contacts` | `id` | phone (operational) | CustomersPage, CustomerProfilePage | get_governed_customer_contacts (reads) | **Canonical** |
| 7 | **Order** | `orders` | `id` | `order_number` (ORD-YYYY-NNNNNN) | OrdersPage, OrderDetailPage, OrderNewPage, OrderReviewPage, ApprovalQueuePage, OrderEditPage | get_governed_orders, governed_create_order, governed_submit_order, governed_change_order_status | **Canonical** |
| 8 | **Order Item** | `order_items` | `id` | (part of order) | OrderDetailPage, OrderNewPage, OrderReviewPage, OrderEditPage | get_governed_order_items (reads) | **Canonical** (frozen at order time) |
| 9 | **Order Status History** | `order_status_history` | `id` | (audit trail) | OrderDetailPage | get_governed_order_history | **Canonical** |
| 10 | **Visit** | `visits` | `id` | `code` (VIS-...) | VisitsPage, VisitScreen, VisitDetailPage, SalesDirectorWorkspace, SecretaryWorkspace | get_governed_visits, governed_checkin_visit, governed_checkout_visit | **Canonical** |
| 11 | **Collection** | `collections` | `id` | `code` (COL-...) | CollectionsPage, NewCollectionPage, CollectionFollowupPage | get_governed_collections, governed_create_collection, governed_approve_collection | **Canonical** |
| 12 | **Return** | `returns` | `id` | `code` (RET-...) | ReturnsPage, ReturnDetailPage | get_governed_returns, get_governed_return, governed_approve_return, governed_reject_return | **Canonical** (read/approve only) |
| 13 | **Return Item** | `return_items` | `id` | (part of return) | ReturnDetailPage | get_governed_return_items | **Canonical** |
| 14 | **Return Inspection** | `return_inspection` | `id` | (1:1 per return item) | — | — | **Canonical** (no UI reads) |
| 15 | **Delivery** | `delivery_tracking` | `id` | (order-linked) | DeliveryPage, DeliveryDetailPage, DeliveryWorkspace | get_governed_deliveries, governed_get_delivery, governed_assign_delivery, governed_confirm/fail_delivery | **Canonical** |
| 16 | **Preparation** | `preparation_records` | `id` | (order-linked) | WarehousePage, WarehousePrepDetail, WarehouseReviewPage | get_governed_waiting_preparations, get_governed_preparation_queue, get_governed_preparation_detail, governed_start/complete/review/return/fail_preparation | **Canonical** |
| 17 | **Preparation Exception** | `preparation_exceptions` | `id` | (part of preparation) | WarehousePage, WarehousePrepDetail | governed_record_exception | **Canonical** |
| 18 | **Credit Program** | `credit_programs` | `id` | name | CreditProgramsPage, CreditProgramsManagerPage | governed_get_credit_programs, governed_create/update/toggle_credit_program | **Canonical** |
| 19 | **Credit Application** | `credit_applications` | `id` | status | CreditApplicationsPage, CreditReviewPage | get_governed_credit_applications, get_governed_credit_application, governed_confirm_documents, governed_manage_credit_application, governed_decline_credit | **Canonical** (create orphans) |
| 20 | **Credit Account** | `customer_credit_accounts` | `id` | credit_limit | CustomerCreditPage (via service) | governed_get_customer_credit_account, governed_activate/suspend/reactivate_credit_account (service only) | **Canonical** |
| 21 | **Credit Ledger** | `customer_credit_ledger` | `id` | running_balance (INSERT-only) | — | governed_get_customer_credit_ledger, governed_reserve/release/pay (service only) | **Canonical** |
| 22 | **Credit Invoice** | `credit_invoices` | `id` | invoice_number | — | get_governed_credit_invoices, get_governed_credit_invoice_detail | **Canonical** |
| 23 | **Credit Invoice Cheque** | `credit_invoice_cheques` | `id` | status | — | governed_record_cheque (service only) | **Canonical** |
| 24 | **Product** | `products` | `id` | product_name | ProductsPage, ProductProfilePage, ProductManagerPage, StorefrontPage, GlobalSearch | get_governed_products, governed_create/update_product, governed_update_product_pricing/units, governed_activate/deactivate/show/hide_product | **Canonical** |
| 25 | **Product Unit** | `product_units` | `id` | unit_type | ProductManagerPage | governed_update_product_units | **Canonical** |
| 26 | **Inventory** | `inventory` | `product_id` (1:1) | quantity | ProductManagerPage | supabase.from('inventory').upsert() (bypass) | **Canonical** (manual) |
| 27 | **Company** | `companies` | `id` | company_name | CompaniesPage, CompanyProfilePage, CompanyManagerPage | get_governed_companies, governed_create/update_company, governed_activate/deactivate_company | **Canonical** |
| 28 | **Company Profile** | `company_profile` | `company_id` | (profile data) | Settings CompanyProfilePage | get_company_profile, governed_update_company_profile | **Canonical** |
| 29 | **Tier** | `tiers` | `id` | name | TiersManagerPage | get_governed_tiers, governed_create/update_tier | **Canonical** |
| 30 | **Tier Company Exception** | `tier_company_exceptions` | `id` | discount_percent (override) | CompanyManagerPage | governed_set/remove_tier_company_exception | **Canonical** |
| 31 | **Tier Product Exception** | `tier_product_exceptions` | `id` | discount_percent (override) | ProductManagerPage | governed_set/remove_tier_product_exception | **Canonical** |
| 32 | **Daily Deal** | `daily_deals` | `id` | title | DailyDealsManagerPage | get_governed_daily_deals, governed_update_daily_deal, governed_activate/cancel_daily_deal | **Canonical** |
| 33 | **Flash Offer** | `flash_offers` | `id` | title | FlashOffersPage (via service) | flashOfferService.getAll/getActive/create/activate/cancel (service only) | **Canonical** |
| 34 | **Auction** | `auctions` | `id` | code | AuctionsManagerPage, AuctionsPage | get_governed_auctions, auctionService.getById/requestParticipation/placeBid, supabase.from('auctions').insert/update (bypass) | **Canonical** |
| 35 | **Auction Bid** | `auction_bids` | `id` | amount | (realtime via auctionService) | governed_place_bid | **Canonical** |
| 36 | **Role** | `roles` | `id` | name | EmployeesPage, EmployeeProfilePage, HierarchyPage, UserPermissionsPage | get_governed_roles | **Canonical** |
| 37 | **Capability** | `capabilities` | `id` | code | EmployeeProfilePage, UserPermissionsPage | get_all_capabilities | **Canonical** |
| 38 | **Company Monthly Target** | `company_monthly_targets` | (month, year) | target values | CompanyTargetsPage, ManagementDashboard | targetService.getCompanyTarget/upsertCompanyTarget | **Canonical** |
| 39 | **Employee Monthly Target** | `employee_monthly_targets` | (employee, month, year) | target values | EmployeeTargetsPage | targetService.getEmployeeTargets/upsertEmployeeTarget | **Canonical** |
| 40 | **System Config** | `system_config` | 1 row | config values | — | — | **Canonical** |
| 41 | **Code Sequence** | `code_sequences` | (code_type, year) | last_value | (internal — used by generate_* RPCs) | generate_collection_number, generate_order_number | **Canonical** |
| 42 | **Treasury Transaction** | `treasury_transactions` | `id` | amount | — | — | **Canonical** |
| 43 | **Expense** | `expenses` | `id` | amount | — | — | **Canonical** |
| 44 | **Session** | `app.sessions` | `id` | token | LoginPage (via auth API) | validate_session | **Canonical** |

---

## Section 2 — One Source Of Truth

### 2.1 Customer Address

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Formatted Address** | `unified_locations.formatted_address`, `customer_addresses.address_line1`, `orders.snapshot_customer_address` | `unified_locations.formatted_address` | 10 customers (40%) migrated. 15 customers still on customer_addresses fallback. |
| **GPS Coordinates** | `unified_locations.latitude/longitude`, `orders.execution_latitude/longitude` | `unified_locations.latitude`, `unified_locations.longitude` | Canonical — order execution_coordinates are snapshot copies. |
| **Location Timestamp** | `unified_locations.captured_at`, `orders.execution_captured_at` | `unified_locations.captured_at` | **Bug:** governed_update_customer does NOT update captured_at. |
| **Customer→Location Link** | `customers.location_id`, `customer_addresses.customer_id` | `customers.location_id → unified_locations.id` | New path. customer_addresses.customer_id is legacy FK. |

### 2.2 Phone Numbers

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Auth Phone (Login)** | `identities.phone` | `identities.phone` | Canonical — single source for login. UNIQUE constraint. |
| **Customer Operational Phone** | `customer_contacts.phone`, `identities.phone` | `customer_contacts.phone` | Operational reach number, distinct from auth phone. |
| **Employee Phone** | `identities.phone` (via employees.identity_id) | `identities.phone` | Same as auth phone — employees use identities directly. |

### 2.3 Customer Identity

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Customer Auth** | `identities` (FK customers.identity_id) | `identities` | Canonical — shared with employees. `identity_type = 'customer'`. |
| **Customer Profile** | `customers` (company_name, responsible_name, business_type, etc.) | `customers` | Canonical — all profile fields in one table. |

### 2.4 Ownership

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Current Owner** | `customers.owner_id → employees.id` | `customers.owner_id` | Canonical — FK to employees. |
| **Ownership History** | `customer_ownership_history` | `customer_ownership_history` | Canonical — INSERT-only audit trail. |
| **Order Snapshot** | `orders.snapshot_owner_name/phone/address` | `orders.snapshot_owner_*` | Intentional snapshot at order time. |

### 2.5 Permissions & Roles

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Role Definition** | `roles` | `roles` | Canonical — dynamic role definitions as data. |
| **Role→Capability** | `role_capabilities` | `role_capabilities` | Canonical — defines what each role can do. |
| **Employee→Role** | `employee_roles` | `employee_roles` | Canonical — supports multiple roles per employee. |
| **Employee Direct Capability** | `employee_capabilities` | `employee_capabilities` | Canonical — grant/deny overrides. |
| **Capability Definition** | `capabilities` | `capabilities` | Canonical — machine-readable code + human-readable name. |
| **Legacy Permission** | `permission` (3 rows) | — | **Legacy** — no code touches it. |

### 2.6 Orders

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Order Number** | `orders.order_number` | `orders.order_number` | Canonical — generated by `generate_order_number` from `code_sequences`. |
| **Order Status** | `orders.status` | `orders.status` | Canonical — current state. |
| **Order Status History** | `order_status_history` | `order_status_history` | Canonical — audit trail of every change. |
| **Order Items** | `order_items` | `order_items` | Canonical — prices frozen at order time. |
| **Order Modifications** | `order_modification_history` | `order_modification_history` | Canonical — audit trail of modifications. |

### 2.7 Visits

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Visit Code** | `visits.code` | `visits.code` | Canonical — generated on check-in. |
| **Visit GPS (Canonical)** | `unified_locations` (via visits.start_location_id) | `unified_locations` | Canonical — structured location record. |
| **Visit GPS (Fallback)** | `visits.check_in_latitude/longitude` | `visits.check_in_*` | Fallback — recorded when no unified_location created. |
| **Visit Result** | `visits.visit_result` | `visits.visit_result` | Canonical — order_taken, collection_taken, follow_up, etc. |

### 2.8 Collections

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Collection Code** | `collections.code` | `collections.code` | Canonical — generated by `generate_collection_number`. |
| **Collection Amount** | `collections.amount` | `collections.amount` | Canonical. |
| **Collection Method** | `collections.method` | `collections.method` | Canonical — cash, bank_transfer, cheque, deposit. |

### 2.9 Returns

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Return Code** | `returns.code` | `returns.code` | Canonical. |
| **Return Items** | `return_items` | `return_items` | Canonical. |
| **Return Inspection** | `return_inspection` | `return_inspection` | Canonical — 1:1 per return item. **No UI reads this.** |

### 2.10 Credit

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Credit Limit (Program)** | `credit_programs.credit_limit` | `credit_programs.credit_limit` | Canonical — the program definition. |
| **Credit Limit (Per-Customer)** | `customer_credit_accounts.credit_limit`, `customers.credit_limit` | `customer_credit_accounts.credit_limit` | Current. `customers.credit_limit` is **Legacy**. |
| **Credit Balance** | `customer_credit_ledger.running_balance`, `customer_credit_accounts.outstanding_credit` | `customer_credit_ledger.running_balance` | Ledger is INSERT-only and authoritative. cca.outstanding_credit is a **Cache**. |
| **Application Status** | `credit_applications.status` | `credit_applications.status` | Canonical — enum: draft, submitted, under_review, documents_received, approved, rejected, suspended. |
| **Invoice Status** | `credit_invoices.status` | `credit_invoices.status` | Canonical — open, paid, overdue. |
| **Cheque Status** | `credit_invoice_cheques.status` | `credit_invoice_cheques.status` | Canonical — received, deposited, collected, cancelled, returned, paid_directly. |

### 2.11 Inventory

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Stock Quantity** | `inventory.quantity` | `inventory.quantity` | Canonical — manual tracking. |
| **Inventory Deduction** | — (in `governed_approve_order`) | `governed_approve_order` (RPC) | **Broken** — RPC exists but NEVER called. Order approval does NOT deduct inventory. |

### 2.12 Pricing

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Unit Price** | `product_units.unit_price` | `product_units.unit_price` | Canonical — base price per unit type. |
| **Tier Discount** | `tiers.discount_percent` | `tiers.discount_percent` | Canonical — default discount for tier. |
| **Company Exception Discount** | `tier_company_exceptions.discount_percent` | `tier_company_exceptions.discount_percent` | Canonical — overrides tier default. Priority 2. |
| **Product Exception Discount** | `tier_product_exceptions.discount_percent` | `tier_product_exceptions.discount_percent` | Canonical — overrides all. Priority 1. |
| **Order Item Price** | `order_items.unit_price`, `order_items.total_price` | `order_items.unit_price` | Canonical — frozen at order time. |

### 2.13 Products

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Product Name** | `products.product_name` | `products.product_name` | Canonical. |
| **Product Legacy Code** | `products.legacy_code` | External legacy system | **Legacy** — read-only reference, not editable. |
| **Product Units** | `product_units.unit_type` | `product_units.unit_type` | Canonical — piece, dozen, carton. |
| **Product Company** | `products.company_id → companies.id` | `products.company_id` | Canonical. |
| **Product Visibility** | `products.is_visible`, `products.is_active` | `products.is_visible`, `products.is_active` | Canonical. |

### 2.14 Companies

| Aspect | Sources Found | Canonical | Status |
|--------|--------------|-----------|--------|
| **Company Name** | `companies.company_name` | `companies.company_name` | Canonical. |
| **Company Legacy Code** | `companies.legacy_code` | External legacy system | **Legacy** — read-only reference. |
| **Company Profile** | `company_profile` | `company_profile` | Canonical — additional profile data. |

---

## Section 3 — Duplicate Truth Detection

| # | Concept | Source A | Source B | Source C | Risk | Resolution |
|---|---------|----------|----------|----------|------|------------|
| 1 | **Customer Address** | `unified_locations.formatted_address` (canonical) | `customer_addresses.address_line1` (legacy) | `orders.snapshot_customer_address` (snapshot) | **Medium** — 15 customers on legacy | Complete unified_locations migration; drop customer_addresses |
| 2 | **Customer Credit Limit** | `customer_credit_accounts.credit_limit` (canonical) | `customers.credit_limit` (legacy) | — | **Medium** — supervisor page shows customers.credit_limit which may be stale | Remove customers.credit_limit after UI migration |
| 3 | **Customer Credit Days** | `customer_credit_accounts.payment_term_days` (canonical) | `customers.credit_days` (legacy) | — | **Medium** — same issue as credit limit | Remove customers.credit_days |
| 4 | **Credit Balance** | `customer_credit_ledger.running_balance` (authoritative) | `customer_credit_accounts.outstanding_credit` (cache) | — | **Low** — cache can drift from ledger | Remove cca.outstanding_credit or keep as cache with periodic sync |
| 5 | **Visit GPS** | `unified_locations` (via start_location_id) (canonical) | `visits.check_in_latitude/longitude` (fallback) | `visits.check_out_latitude/longitude` | **Low** — both may record same data | Tolerate redundancy; unified_locations is preferred |
| 6 | **Customer Phone (Auth)** | `identities.phone` (unique login) | `customer_contacts.phone` (operational) | — | **Low** — different purposes | Accept as-is — documented distinction |
| 7 | **Order Status History** | `orders.status` (current) | `order_status_history` (audit) | — | **None** — intentional; history is append-only | No change needed |
| 8 | **Order Owner Snapshots** | `employees.full_name/phone/address` (current) | `orders.snapshot_owner_*` (frozen) | — | **None** — intentional denormalization | No change needed |
| 9 | **Order Sender Snapshots** | `employees.*` (current) | `orders.snapshot_sender_*` (deprecated) | — | **Low** — superseded by snapshot_owner_* | Remove sender_* columns after audit |
| 10 | **Employee→Role** | `employee_roles` (junction) | — | — | **None** | — |
| 11 | **Employee→Capability (Direct)** | `employee_capabilities` (override) | `role_capabilities` (via role) | — | **Low** — direct capability can contradict role | By design — grant/deny override |
| 12 | **Role→Capability** | `role_capabilities` (grant) | `employee_capabilities` (direct) | — | **Low** — same as above | Accept as-is |
| 13 | **Permissions (Legacy vs Current)** | `capabilities` + `role_capabilities` (current) | `permission` table (3 legacy rows) | — | **None** — legacy permission table is dead | Remove permission table |
| 14 | **Customer Email** | `customers.email` | — | — | **Low** — being removed from UI | Drop from UI; keep column in DB |
| 15 | **Packages (Legacy)** | `packages`, `package_items`, `package_orders` (legacy) | `daily_deals`, `flash_offers` (current) | — | **Low** — no active references | Remove after migration confirmed |
| 16 | **Order Execution Location** | `orders.execution_location_id → unified_locations` (canonical) | `orders.execution_latitude/longitude` (inline fallback) | — | **Low** — dual storage | Tolerate redundancy |

---

## Section 4 — Legacy Layer Map

### 4.1 Legacy Tables (KEEP for backward compatibility, MIGRATE off)

| Table | Reason | Action | Precondition |
|-------|--------|--------|-------------|
| `customer_addresses` | 15 customers (60%) still rely on it | **MIGRATE** → unified_locations | All customers have location_id |
| `packages` | Superseded by daily_deals/flash_offers | **REMOVE_LATER** | Confirm no external consumers |
| `package_items` | Superseded by daily_deal_items/flash_offer_items | **REMOVE_LATER** | Same |
| `package_orders` | Superseded by order_daily_deals/order_flash_offers | **REMOVE_LATER** | Same |
| `permission` | Dead — 3 rows, no code touches it | **REMOVE_LATER** | Confirm no triggers reference it |

### 4.2 Legacy Columns (KEEP, then MIGRATE)

| Table.Column | Reason | Action | Precondition |
|-------------|--------|--------|-------------|
| `customers.credit_limit` | Superseded by cca.credit_limit | **REMOVE_LATER** | All UI switches to cca.credit_limit |
| `customers.credit_days` | Superseded by cca.payment_term_days | **REMOVE_LATER** | Same |
| `orders.snapshot_sender_name` | Superseded by snapshot_owner_name | **REMOVE_LATER** | Verify no external report/PDF depends on it |
| `orders.snapshot_sender_phone` | Superseded by snapshot_owner_phone | **REMOVE_LATER** | Same |
| `orders.snapshot_sender_address` | Superseded by snapshot_owner_address | **REMOVE_LATER** | Same |
| `products.legacy_code` | Read-only external reference | **KEEP** | Cannot remove — external dependency |
| `companies.legacy_code` | Read-only external reference | **KEEP** | Cannot remove — external dependency |

### 4.3 Legacy RPCs (REMOVE_LATER)

| RPC | Reason | Precondition |
|-----|--------|-------------|
| `register_customer` | Dual path with governed_create_customer | Confirm no external caller |
| `governed_reassign_customer_ownership` | Duplicate of governed_change_customer_ownership | Confirm no callers |

### 4.4 Orphaned RPCs (REMOVE_LATER)

All RPCs in Section 8 of 13_END_TO_END_WORKFLOW_AUDIT.md (26 RPCs) — see orphaned list there.

### 4.5 Test RPCs (REMOVE_LATER — SAFE NOW)

| RPC | Reason |
|-----|--------|
| `ping` | Health check only — verify infra dependency first |
| `test_ping2` | Test — zero call sites |
| `test_ping3` | Test — zero call sites |
| `test_rpc` | Test — zero call sites |
| `test_setof` | Test — zero call sites |
| `test_func` | Test — zero call sites |
| `multiline_test` | Test — zero call sites |

### 4.6 Legacy Screens (KEEP then REMOVE_LATER)

| Screen | Reason | Precondition |
|--------|--------|-------------|
| `CheckoutPage` | Empty shell | Confirm no planned implementation |
| `ActivityPage` | Empty shell | Confirm no planned implementation |

### 4.7 Legacy Statuses (KEEP)

| Entity | State | Reason to Keep |
|--------|-------|---------------|
| Order | `ready_for_dispatch` | Defined in enum, may be needed for future dispatch flow |
| Order | `deferred` | Defined in enum, used by OrderStatusManager |
| Order | `returned_for_revision` | Defined in enum, used by OrderStatusManager |

---

## Section 5 — Runtime Ownership Map

### 5.1 Identity Ownership

```
identities  (canonical identity — phone + password_hash + identity_type)
  ├──→ employees  (FK: employees.identity_id → identities.id)
  │     └── identity_type = 'employee'
  │
  └──→ customers  (FK: customers.identity_id → identities.id)
        └── identity_type = 'customer'
```

**Canonical Rule:** Every person in the system has ONE identity. Authentication is always via `identities.phone`. The `identity_type` discriminates employee vs customer.

**File Evidence:** `src/pages/auth/LoginPage.tsx` → `authService.login()` → `supabase.auth.signInWithPassword()`. Response includes both identity_type and role info.

### 5.2 Employee Ownership Chain

```
employees (self-referencing manager hierarchy)
  │
  ├──→ customers.owner_id         (employee OWNS customers)
  ├──→ orders.created_by          (employee CREATES orders)
  ├──→ visits.employee_id         (employee MAKES visits)
  ├──→ collections.collected_by   (employee COLLECTS payments)
  ├──→ returns.created_by         (employee PROCESSES returns)
  ├──→ preparation_records.started_by/completed_by/reviewed_by (employee PREPARES)
  └──→ delivery_tracking.assigned_to (employee DELIVERS)
```

**Canonical Rule:** Everything that happens in the system is owned by exactly one employee. The `employees.manager_id` establishes the hierarchy for visibility (`get_visible_employee_ids`).

**Conflict Check:** `orders.created_by` should always match `orders.owner_id` (the sales rep who owns the customer). If they differ, the creating employee and the customer's owner are different people — currently assumed intentional (e.g., supervisor creates order for rep's customer).

### 5.3 Customer Ownership

```
employees  ←── customers.owner_id  (current owner)
  │
  └──→ customer_ownership_history  (INSERT-only audit trail)
        ├── old_owner_id
        └── new_owner_id
```

**Canonical Rule:** `customers.owner_id` is the current owner. `customer_ownership_history` records every change. No other table records customer ownership.

**Conflict Check:** `orders.snapshot_owner_name` freezes the owner name at order time. If `customers.owner_id` changes after the order, the snapshot preserves the original owner. This is intentional.

---

## Section 6 — Canonical Data Flow

### 6.1 Customer: Create

| Step | Screen | Service | RPC | Table Written |
|------|--------|---------|-----|--------------|
| 1 | NewCustomerPage.tsx:96 | (inline) | `governed_create_customer` | unified_locations (location) |
| 2 | (internal) | (RPC body) | — | customers (profile) |
| 3 | (internal) | (RPC body) | — | customer_contacts (if provided) |
| 4 | (internal) | (RPC body) | — | code_sequences (increment) |

**Canonical Path:** `NewCustomerPage → governed_create_customer → unified_locations + customers + customer_contacts`

**Alternative Path (Self-Registration):** `RegistrationPage → register_customer → identities + unified_locations + customers + customer_contacts + app.sessions`

### 6.2 Customer: Read

| Data | Screen | RPC | Table Read |
|------|--------|-----|-----------|
| List | CustomersPage.tsx:27 | `get_governed_customers` | customers |
| Single | CustomerProfilePage.tsx:69 | `get_governed_customer` | customers |
| Addresses | CustomerProfilePage.tsx:73 | `get_governed_customer_addresses` | customer_addresses + unified_locations |
| Contacts | CustomersPage.tsx:28 | `get_governed_customer_contacts` | customer_contacts |
| Orders | CustomerProfilePage.tsx:70 | `get_customer_orders` | orders (via view) |
| Collections | CustomerProfilePage.tsx:71 | `get_customer_collections` | collections |
| Visits | CustomerProfilePage.tsx:72 | `get_customer_visits` | visits |
| Ownership History | CustomerProfilePage.tsx:75 | `get_governed_customer_ownership_history` | customer_ownership_history |

### 6.3 Employee: Create

| Step | Screen | Service | RPC | Table Written |
|------|--------|---------|-----|--------------|
| 1 | EmployeesPage.tsx:89 | (inline) | `governed_create_employee` | identities |
| 2 | (internal) | (RPC body) | — | employees |
| 3 | (internal) | (RPC body) | — | employee_roles |
| 4 | (internal) | (RPC body) | — | employee_capabilities |
| 5 | (internal) | (RPC body) | — | code_sequences (increment) |

**Canonical Path:** `EmployeesPage/HierarchyPage/SupervisorPage → governed_create_employee → identities + employees + employee_roles + employee_capabilities`

### 6.4 Order: Create + Submit

| Step | Screen | RPC | Table Written | Table Read |
|------|--------|-----|--------------|-----------|
| 1 | OrderNewPage.tsx:200 / OrderReviewPage.tsx:74 | `governed_create_order` | orders, order_items, order_status_history | customers, products, tiers, code_sequences |
| 2 | OrderReviewPage.tsx:93 | `governed_add_order_flash_offers` | order_flash_offer | orders |
| 3 | OrderReviewPage.tsx:100 | `governed_add_order_daily_deals` | order_daily_deal | orders |
| 4 | OrderReviewPage.tsx:104 / OrderNewPage.tsx:214 | `governed_submit_order` | orders (status=submitted) | orders |

**Canonical Path:** `OrderNewPage/OrderReviewPage → governed_create_order → governed_add_order_* → governed_submit_order`

### 6.5 Inventory: Stock

| Step | Screen | RPC | Table Written | Table Read |
|------|--------|-----|--------------|-----------|
| **Update** | ProductManagerPage.tsx:177 | `supabase.from('inventory').upsert({product_id, quantity})` | inventory | products |
| **Deduct** | (should be in governed_approve_order) | `governed_approve_order` (NOT CALLED) | inventory | — |

**Canonical Path:** ProductManagerPage → direct `supabase.from('inventory').upsert()` — **bypasses governed RPC**

**Missing Path:** Order approval → `governed_approve_order` → inventory deduction — **NEVER EXECUTED**

### 6.6 Credit: Application + Account

| Step | Screen | RPC | Table Written | Status |
|------|--------|-----|--------------|--------|
| 1 | (no UI) | `governed_create_credit_application` | credit_applications | **BROKEN** — no screen calls this |
| 2 | CreditReviewPage.tsx:44 | `governed_confirm_documents` | credit_applications | Operational |
| 3 | CreditReviewPage.tsx:37 | `governed_manage_credit_application` | credit_applications, customer_credit_accounts | Operational |

**Canonical Path (Incomplete):** `[missing] → governed_create_credit_application → [review] → governed_confirm_documents → governed_manage_credit_application`

### 6.7 Address: Canonical Write

| Step | Screen | RPC | Table Written |
|------|--------|-----|--------------|
| 1 | NewCustomerPage.tsx:96 | `governed_create_customer` (includes location) | `unified_locations` |
| 2 | CustomerProfilePage.tsx:128 | `governed_update_customer` (includes location) | `unified_locations` (via RPC) |

**Canonical Write Path:** All address writes go through `governed_create_customer` or `governed_update_customer`, which write to `unified_locations`.

**Legacy Write Path:** `customer_addresses` is populated by the same RPC for backward compatibility with 15 unmigrated customers.

---

## Section 7 — Canonical UI Map

### 7.1 UI Data Classification

| Screen | Data Type | Evidence |
|--------|-----------|----------|
| LoginPage | **Live** (Supabase Auth API) | `authService.login()` → `supabase.auth.signInWithPassword()` |
| RegistrationPage | **Live** (RPC) | `register_customer` RPC |
| DashboardPage | **Router** (no data) | Dispatches to role-specific workspace based on roles |
| AdminWorkspace | **Live** (aggregate RPCs) | get_dashboard_management, get_governed_dashboard_counts, get_governed_products |
| SuperAdminWorkspace | **Live** (aggregate RPCs) | 4 aggregate RPCs |
| All Workspaces | **Live** (aggregate or list RPCs) | Each calls 1-4 real RPCs |
| CustomersPage | **Live** (RPC) | get_governed_customers, get_governed_customer_contacts |
| CustomerProfilePage | **Live** (RPC) | 10+ RPCs — real data from customers + related tables |
| NewCustomerPage | **Live** (RPC write) | governed_create_customer |
| OrdersPage | **Live** (RPC) | get_governed_orders, get_governed_customers, get_governed_employees |
| OrderDetailPage | **Live** (RPC) | get_governed_order, get_governed_order_items, get_governed_order_history |
| OrderNewPage | **Live** (RPC) | Multiple create + read RPCs |
| OrderReviewPage | **Live** (RPC) | governed_create_order + add deals/offers + submit |
| OrderEditPage | **Live** (RPC) | get_governed_order_items — reads only |
| OrderStatusManager | **Live** (RPC write) | governed_change_order_status |
| EmployeesPage | **Live** (RPC) | Multiple create/read/update RPCs |
| EmployeeProfilePage | **Live** (RPC) | 10+ RPCs — real data |
| HierarchyPage | **Live** (RPC) | Multiple employee RPCs |
| CollectionsPage | **Live** (RPC) | get_governed_collections, governed_approve_collection |
| NewCollectionPage | **Live** (RPC write) | governed_create_collection |
| CollectionFollowupPage | **Live** (RPC) | get_collection_followup_queue |
| ReturnsPage | **Live** (RPC) — read only | get_governed_returns |
| ReturnDetailPage | **Live** (RPC) | get_governed_return, approve/reject |
| CreditApplicationsPage | **Live** (RPC) — read only | get_governed_credit_applications |
| CreditReviewPage | **Live** (RPC) | get_governed_credit_application, approve/reject/confirm_documents |
| CreditProgramsPage | **Live** (RPC) | Full CRUD via governed RPCs |
| CreditProgramsManagerPage | **Live** (RPC) | Full CRUD via governed RPCs |
| WarehousePage | **Live** (RPC) | 10+ RPCs — full preparation lifecycle |
| WarehousePrepDetail | **Live** (RPC) | get_governed_preparation_detail, governed_record_exception |
| WarehouseReviewPage | **Live** (RPC) | get_governed_preparation_queue, review/return_to_prep |
| DeliveryPage | **Live** (RPC) | get_governed_deliveries, governed_assign_delivery |
| DeliveryDetailPage | **Live** (RPC) | governed_get_delivery, governed_confirm/fail_delivery |
| VisitsPage | **Live** (RPC) | get_governed_visits, governed_checkin_visit |
| VisitScreen | **Live** (RPC) | governed_checkin_visit, governed_checkout_visit |
| VisitDetailPage | **Live** (RPC) | get_governed_visit, governed_checkout_visit |
| ProductsPage | **Live** (RPC) | governed_create_product, governed_update_product |
| ProductProfilePage | **Live** (RPC) — read only | get_governed_products |
| ProductManagerPage | **Live** (RPC + bypass) | governed RPCs + supabase.from() bypasses for image/visibility/inventory |
| CompaniesPage | **Live** (RPC) | governed_create_company, governed_update_company |
| CompanyProfilePage | **Live** (RPC) — read only | get_governed_companies, get_company_products |
| CompanyManagerPage | **Live** (RPC + bypass) | governed RPCs + supabase.from() bypasses for logo/visibility |
| TiersManagerPage | **Live** (RPC) | governed_create_tier, governed_update_tier |
| DailyDealsManagerPage | **Live** (RPC + bypass) | governed_update_daily_deal + supabase.from() bypass |
| AuctionsManagerPage | **Live** (bypass) | supabase.from('auctions').insert/update — no governed RPC |
| SupervisorPage | **Live** (RPC) | 8+ RPCs including create customer/employee |
| StorefrontPage | **Live** (RPC) | get_governed_products, get_governed_customers |
| CartPage | **Cached** (Zustand store + localStorage) | cartStore with persist — in-memory/localStorage only |
| GlobalSearch | **Live** (RPC) | governed_global_search + get_governed_customers + get_governed_products |
| ReportsPage | **Live** (dynamic RPC) | Dynamic `supabase.rpc(rpcName, params)` |
| SalesRepWorkDay | **Live** (RPC) | 4 aggregate + list RPCs |
| CustomerAnalyticsPage | **Live** (RPC) | get_customer_card, get_customer_products, get_customer_brands |
| AnalyticsListPage | **Live** (RPC) | get_customer_analytics_list, get_customer_sales_ranking |
| Settings CompanyProfile | **Live** (RPC) | get_company_profile, governed_update_company_profile |
| UserProfilePage | **Live** (RPC) | get_governed_employees, governed_update_employee |
| UserPermissionsPage | **Live** (RPC) — read only | 4 RPCs showing roles/capabilities |
| CheckoutPage | **Empty Shell** | Zero supabase calls |
| ActivityPage | **Empty Shell** | Zero supabase calls |
| FlashOffersPage | **Service Layer** (unconfirmed) | No direct supabase calls — may use flashOfferService |
| DealsPage | **Service Layer** (unconfirmed) | No direct supabase calls — may use dealService |
| ModuleLauncherPage | **Static** — no data | Navigation only |
| SubLauncherPage | **Static** — no data | Navigation only |

---

## Section 8 — Cleanup Readiness

### 8.1 Tables

| Table | Classification | Readiness |
|-------|---------------|-----------|
| `customer_addresses` | Legacy (15/25 customers) | **BLOCKED** — migration must complete first |
| `packages` | Legacy — superseded | **SAFE NOW** — no code references |
| `package_items` | Legacy — superseded | **SAFE NOW** |
| `package_orders` | Legacy — superseded | **SAFE NOW** |
| `permission` | Dead — 3 rows, no references | **SAFE NOW** |
| `customer_classification` | Dead — 0 rows | **SAFE NOW** |
| `customer_daily_deal` | Dead — 0 rows | **SAFE NOW** |
| `deal` | Dead — 0 rows | **SAFE NOW** |
| `follow_up` | Dead — 0 rows | **SAFE NOW** |
| `notification` | Dead — 0 rows | **SAFE NOW** |
| `visit_note` | Dead — 0 rows | **SAFE NOW** |
| `voucher_type` | Dead — 0 rows | **SAFE NOW** |
| `sync_log` | Dead — 0 rows, no trigger | **SAFE NOW** |
| `activity_log` | Dead — 0 rows, no trigger | **SAFE NOW** |

### 8.2 Columns

| Table.Column | Classification | Readiness |
|-------------|---------------|-----------|
| `customers.credit_limit` | Legacy — superseded by cca | **NEEDS MIGRATION** — UI still shows it |
| `customers.credit_days` | Legacy — superseded by cca | **NEEDS MIGRATION** — UI still shows it |
| `orders.snapshot_sender_name` | Deprecated — superseded | **NEEDS AUDIT** — verify no external consumer |
| `orders.snapshot_sender_phone` | Deprecated | **NEEDS AUDIT** |
| `orders.snapshot_sender_address` | Deprecated | **NEEDS AUDIT** |

### 8.3 RPCs

| RPC | Classification | Readiness |
|-----|---------------|-----------|
| `test_ping2` | Test | **SAFE NOW** |
| `test_ping3` | Test | **SAFE NOW** |
| `test_rpc` | Test | **SAFE NOW** |
| `test_setof` | Test | **SAFE NOW** |
| `test_func` | Test | **SAFE NOW** |
| `multiline_test` | Test | **SAFE NOW** |
| `ping` | Health check | **NEEDS AUDIT** — check infra dependency |
| `governed_approve_order` | Orphaned — never called | **NEEDS DECISION** — either rewire to approval flow or remove |
| `governed_deny_order` | Orphaned — never called | **NEEDS DECISION** |
| `governed_create_return` | Orphaned | **NEEDS DECISION** — either wire to UI or remove |
| `governed_update_return` | Orphaned | **NEEDS DECISION** |
| `governed_update_collection` | Orphaned | **NEEDS DECISION** |
| `governed_create_visit` | Orphaned — checkin handles it | **SAFE NOW** |
| `governed_create_location` | Orphaned | **NEEDS AUDIT** — verify no internal RPC callers |
| `governed_create_daily_deal` | Orphaned — service exists, page bypasses | **NEEDS DECISION** |
| `governed_create_flash_offer` | Orphaned | **NEEDS DECISION** |
| `governed_update_flash_offer` | Orphaned | **NEEDS DECISION** |
| `governed_create_auction` | Orphaned — AuctionsManagerPage bypasses | **NEEDS DECISION** |
| `governed_reassign_customer_ownership` | Duplicate of governed_change_customer_ownership | **SAFE NOW** |
| `register_customer` | Dual path | **NEEDS AUDIT** — verify registration page dependency |
| All orphaned credit RPCs (8) | Orphaned | **BLOCKED** — part of incomplete credit module |
| All orphaned credit account RPCs (4) | Orphaned | **BLOCKED** — same |
| `governed_update_contract_template` | Orphaned | **SAFE NOW** |

### 8.4 Screens

| Screen | Classification | Readiness |
|--------|---------------|-----------|
| CheckoutPage | Empty shell | **NEEDS DECISION** — implement or remove |
| ActivityPage | Empty shell | **NEEDS DECISION** — implement or remove |

### 8.5 Services

| Service | Classification | Readiness |
|---------|---------------|-----------|
| `flashOfferService` | Service exists, pages may use it | **NEEDS AUDIT** — verify page integration |
| `dealService` | Service for daily deals reads | **NEEDS AUDIT** — verify page usage |
| Orphaned creditService methods | All exist but no page calls | **BLOCKED** — part of incomplete credit module |

---

## Section 9 — Final Canonical Architecture

### 9.1 What Is The Real Current Architecture?

**Current Architecture:** Frontend → `supabase.rpc('governed_*')` → PostgreSQL (with Row Level Security)

- No REST API layer
- No middleware
- No GraphQL
- 260+ RPC calls across 70+ files
- 4 bypasses using `supabase.from()` directly
- Services layer is inconsistent (partial coverage)
- Zustand stores for auth (persist), cart (persist), and lightweight state

### 9.2 Canonical Path For Customer Creation

```
NewCustomerPage.tsx:96  →  supabase.rpc('governed_create_customer', {...})  →  customers + unified_locations + customer_contacts
```

**NOT:** RegistrationPage (uses `register_customer` — different path with auth/session creation)

### 9.3 Canonical Path For Order Creation

```
OrderNewPage.tsx:200 → supabase.rpc('governed_create_order', {...})
  → orders + order_items + order_status_history
  → (optional) governed_add_order_flash_offers → order_flash_offer
  → (optional) governed_add_order_daily_deals → order_daily_deal
  → governed_submit_order → orders.status = 'submitted'
  → governed_change_order_status (ALL subsequent transitions)
```

**NOT:** `governed_approve_order` or `governed_deny_order` — these are orphaned.

### 9.4 Canonical Path For Inventory

```
READ:   get_governed_products (returns product + inventory data)
WRITE:  ProductManagerPage → supabase.from('inventory').upsert(...)  [BYPASS]
DEDUCT: governed_approve_order (NOT CALLED — inventory NEVER deducted on order approval)
```

**Critical Finding:** There is NO operational inventory deduction path. The RPC exists (`governed_approve_order`) but is never called.

### 9.5 Canonical Path For Credit

```
PROGRAMS: CreditProgramsPage/Manager → governed_get/create/update/toggle_credit_program
READ APPS: CreditApplicationsPage → get_governed_credit_applications
REVIEW APPS: CreditReviewPage → get_governed_credit_application + confirm_documents + manage_application/decline_credit
CREATE APP: [MISSING] — governed_create_credit_application exists but no UI calls it
PAYMENTS:  [MISSING] — 8 RPCs exist but no UI calls them
RESERVATION: [MISSING] — governed_reserve_credit_for_order exists but no UI calls it
```

**Critical Finding:** Credit is a half-built subsystem. Application creation, payment, cheque, ledger, and reservation are all missing from UI.

### 9.6 Canonical Path For Address

```
WRITE: governed_create_customer / governed_update_customer → unified_locations
READ:  get_governed_customer_addresses → unified_locations (canonical) + customer_addresses (legacy fallback)
LEGACY: customer_addresses — 15 customers still have no location_id
```

### 9.7 Canonical Path For Ownership

```
SET:   governed_change_customer_ownership → customers.owner_id + customer_ownership_history (INSERT)
READ:  get_governed_customer_ownership_history → customer_ownership_history (audit)
CURRENT: customers.owner_id → employees.id
```

### 9.8 Single Truth Layer Per Concept

| Concept | Canonical Table | Access Method | Status |
|---------|----------------|--------------|--------|
| **Authentication** | `identities` | Supabase Auth API + `login` RPC | ✓ Operational |
| **Customer Profile** | `customers` | `get_governed_customer*`, `governed_create/update_customer` | ✓ Operational |
| **Customer Address** | `unified_locations` | Via `governed_create/update_customer` | ⚠️ Partial — 15 legacy |
| **Customer Contact** | `customer_contacts` | `get_governed_customer_contacts` (read) | ✓ Operational |
| **Customer Ownership** | `customers.owner_id` | `governed_change_customer_ownership` | ✓ Operational |
| **Employee Profile** | `employees` | `get_governed_employees`, `governed_create/update_employee` | ✓ Operational |
| **Employee Role** | `employee_roles` + `roles` | `governed_change_employee_role` | ✓ Operational |
| **Employee Capability** | `employee_capabilities` + `role_capabilities` | `governed_update_employee_capabilities` | ✓ Operational |
| **Order** | `orders` | `governed_create_order`, `governed_change_order_status` | ✓ Operational (except approval) |
| **Order Item** | `order_items` | `get_governed_order_items` (read) | ✓ Operational |
| **Inventory** | `inventory` | `supabase.from('inventory').upsert()` (bypass) | ✗ **BROKEN** — no deduction |
| **Visit** | `visits` | `governed_checkin/checkout_visit` | ✓ Operational |
| **Collection** | `collections` | `governed_create/approve_collection` | ✓ Operational |
| **Return** | `returns` | `get_governed_returns`, `governed_approve/reject_return` | ✗ **BROKEN** — no create |
| **Delivery** | `delivery_tracking` | `governed_assign/confirm/fail_delivery` | ✓ Operational |
| **Preparation** | `preparation_records` | All governed_preparation_* RPCs | ✓ Operational |
| **Credit Program** | `credit_programs` | `governed_create/update/toggle_credit_program` | ✓ Operational |
| **Credit Application** | `credit_applications` | Read/approve/reject only — no create | ✗ **BROKEN** |
| **Credit Account** | `customer_credit_accounts` | RPCs exist but no UI | ✗ **BROKEN** |
| **Credit Ledger** | `customer_credit_ledger` | RPCs exist but no UI | ✗ **BROKEN** |
| **Product** | `products` | `governed_create/update_product` | ✓ Operational |
| **Company** | `companies` | `governed_create/update_company` | ✓ Operational |
| **Tier** | `tiers` | `governed_create/update_tier` | ✓ Operational |
| **Daily Deal** | `daily_deals` | Mixed governed/bypass | ⚠️ Partial |
| **Flash Offer** | `flash_offers` | Service layer only | ⚠️ Unconfirmed |
| **Auction** | `auctions` | Mixed governed/bypass | ⚠️ Partial |
| **Role** | `roles` | `get_governed_roles` (read) | ✓ Operational |
| **Capability** | `capabilities` | `get_all_capabilities` (read) | ✓ Operational |

---

## Section 10 — Executive Verdict

### 10.1 Canonical (Trust As Single Source Of Truth)

| Entity | File/Table | Evidence |
|--------|-----------|----------|
| Identity | `identities` | LoginPage — only auth path. FK from customers + employees. |
| Customer Profile | `customers` | All customer screens read/write via governed RPCs. |
| Customer Address | `unified_locations` | All new customers use it. 10 of 25 migrated. |
| Customer Contact | `customer_contacts` | CustomersPage, CustomerProfilePage read via get_governed_customer_contacts. |
| Employee Profile | `employees` | All employee screens read/write via governed RPCs. |
| Employee Manager | `employees.manager_id` | HierarchyPage relies on it. get_visible_employee_ids uses it. |
| Employee Role | `employee_roles` + `roles` | governed_change_employee_role writes. get_governed_roles reads. |
| Order | `orders` | Full lifecycle via 5+ governed RPCs. 38 rows. |
| Order Item | `order_items` | 394 rows, frozen at order time. |
| Order Status History | `order_status_history` | Append-only audit trail. |
| Visit | `visits` + `unified_locations` | checkin/checkout create + read. |
| Collection | `collections` | create + approve via governed RPCs. |
| Delivery | `delivery_tracking` | assign + confirm/fail via governed RPCs. |
| Preparation | `preparation_records` + `preparation_exceptions` | Full lifecycle via 8 governed RPCs. |
| Product | `products` | governed_create/update_product + pricing/units. |
| Company | `companies` | governed_create/update_company + profile. |
| Tier | `tiers` | governed_create/update_tier + exceptions. |
| Tier Company Exception | `tier_company_exceptions` | governed_set/remove RPCs. |
| Tier Product Exception | `tier_product_exceptions` | governed_set/remove RPCs. |
| Credit Program | `credit_programs` | governed_get/create/update/toggle — full CRUD. |
| Credit Ledger | `customer_credit_ledger` | INSERT-only, authoritative balance. 3 accounts. |
| Role Definition | `roles` | get_governed_roles — read by employee management screens. |
| Capability Definition | `capabilities` | get_all_capabilities — read by permissions screens. |

### 10.2 Legacy (Keep For Backward Compatibility, Do Not Extend)

| Entity | File/Table | Evidence | Migration Needed |
|--------|-----------|----------|-----------------|
| Customer Address (Legacy) | `customer_addresses` | 15 customers (60%) still rely on it. | Migrate to unified_locations |
| Customer Credit Limit (Legacy) | `customers.credit_limit` | Displayed on CustomerProfilePage. Superseded by cca.credit_limit. | Switch UI to cca |
| Customer Credit Days (Legacy) | `customers.credit_days` | Same pattern. | Switch UI to cca |
| Order Sender Snapshots | `orders.snapshot_sender_*` | Deprecated — superseded by snapshot_owner_*. | Verify no external consumer, then drop |
| Packages | `packages`, `package_items`, `package_orders` | Superseded by daily_deals/flash_offers. | Confirm no references, then drop |
| Product Legacy Code | `products.legacy_code` | External system reference. | Keep — external dependency |
| Company Legacy Code | `companies.legacy_code` | Same. | Keep — external dependency |

### 10.3 Duplicate (Two Sources For Same Concept)

| Concept | Primary | Secondary | Risk |
|---------|---------|-----------|------|
| **Customer Address** | `unified_locations` | `customer_addresses` | Medium — 60% of customers on legacy |
| **Credit Limit** | `customer_credit_accounts.credit_limit` | `customers.credit_limit` | Medium — UI shows wrong field |
| **Credit Days** | `customer_credit_accounts.payment_term_days` | `customers.credit_days` | Medium — UI shows wrong field |
| **Credit Balance** | `customer_credit_ledger.running_balance` | `customer_credit_accounts.outstanding_credit` | Low — cache vs authoritative |
| **Visit GPS** | `unified_locations` (via start_location_id) | `visits.check_in_latitude/longitude` | Low — dual storage |
| **Customer Phone** | `identities.phone` (auth) | `customer_contacts.phone` (operational) | Low — different purposes |
| **Employee→Capability** | `role_capabilities` (via role) | `employee_capabilities` (direct) | Low — by design (override) |
| **Order Status** | `orders.status` (current) | `order_status_history` (audit) | None — intentional |
| **Order Snapshots** | Source tables (customers, employees) | `orders.snapshot_*` | None — intentional denormalization |

### 10.4 Dead (No Runtime Relevance)

| Category | Item | Evidence |
|----------|------|----------|
| **Table** | `customer_classification` | 0 rows, zero code references |
| **Table** | `customer_daily_deal` | 0 rows, zero code references |
| **Table** | `deal` | 0 rows, zero code references |
| **Table** | `follow_up` | 0 rows, zero code references |
| **Table** | `notification` | 0 rows, zero code references |
| **Table** | `permission` | 3 rows, zero code references |
| **Table** | `visit_note` | 0 rows, zero code references |
| **Table** | `voucher_type` | 0 rows, zero code references |
| **Table** | `sync_log` | 0 rows, no trigger, no code references |
| **Table** | `activity_log` | 0 rows, no trigger, no code references |
| **RPC** | `test_ping2` | Test function, zero call sites |
| **RPC** | `test_ping3` | Test function, zero call sites |
| **RPC** | `test_rpc` | Test function, zero call sites |
| **RPC** | `test_setof` | Test function, zero call sites |
| **RPC** | `test_func` | Test function, zero call sites |
| **RPC** | `multiline_test` | Test function, zero call sites |
| **RPC** | `governed_reassign_customer_ownership` | Duplicate — governed_change_customer_ownership used instead |
| **Screen** | `CheckoutPage` | Empty shell — zero supabase calls |
| **Screen** | `ActivityPage` | Empty shell — zero supabase calls |
| **Service** | `governed_auto_suspend_overdue_accounts` | Never called from any page |
| **Service Method** | `creditService.activateAccount()` | Never called from any page |
| **Service Method** | `creditService.suspendAccount()` | Never called from any page |
| **Service Method** | `creditService.recordCheque()` | Never called from any page |
| **Service Method** | `creditService.recordPayment()` | Never called from any page |
| **Service Method** | `creditService.reserveCreditForOrder()` | Never called from any page |
| **Service Method** | `creditService.releaseCreditReservation()` | Never called from any page |
| **Service Method** | `creditService.convertReservationToOutstanding()` | Never called from any page |
| **Service Method** | `creditService.createApplication()` | Never called from any page |

---

## Appendix A: Canonical Reference Quick Chart

```
CONCEPT               CANONICAL TABLE          CANONICAL RPC
───────────────────── ─────────────────────── ─────────────────────────────────────
Customer Profile      customers                governed_create_customer
Customer Address      unified_locations        (via governed_create_customer)
Customer Contact      customer_contacts        (part of governed_create_customer)
Customer Ownership    customers.owner_id        governed_change_customer_ownership
Employee Profile      employees                governed_create_employee
Employee Manager      employees.manager_id      governed_change_employee_manager
Employee Role         employee_roles + roles    governed_change_employee_role
Employee Capability   employee_capabilities     governed_update_employee_capabilities
Order                 orders                   governed_create_order
Order Item            order_items              (part of governed_create_order)
Order Status          orders.status             governed_change_order_status
Inventory             inventory                [BYPASS] supabase.from('inventory').upsert()
Visit                 visits                   governed_checkin_visit
Visit Location        unified_locations         (via governed_checkin_visit)
Collection            collections              governed_create_collection
Return                returns                  [BROKEN — no create path]
Return Item           return_items             [BROKEN — no create path]
Delivery              delivery_tracking        governed_assign_delivery
Preparation           preparation_records      governed_start_preparation
Credit Program        credit_programs          governed_create_credit_program
Credit Application    credit_applications      [BROKEN — no create UI]
Credit Account        customer_credit_accounts [BROKEN — no activate UI]
Credit Ledger         customer_credit_ledger   [BROKEN — no payment UI]
Product               products                 governed_create_product
Product Unit          product_units            governed_update_product_units
Company               companies                governed_create_company
Company Profile       company_profile          governed_update_company_profile
Tier                  tiers                    governed_create_tier
Tier Company Exc.     tier_company_exceptions  governed_set_tier_company_exception
Tier Product Exc.     tier_product_exceptions  governed_set_tier_product_exception
Daily Deal            daily_deals              [BYPASS MIXED]
Flash Offer           flash_offers             [SERVICE LAYER ONLY]
Auction               auctions                 [BYPASS — governed_create_auction unused]
Role                  roles                    get_governed_roles
Capability            capabilities             get_all_capabilities
Code Sequence         code_sequences           generate_order_number / collection_number
Pricing Rule          tiers + tier_*_exceptions client-side in cartStore
```
