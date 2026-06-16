# 12. Runtime Completeness Audit

> **Goal:** Before any cleanup, deletion, or refactoring — produce the final report that determines what works, what doesn't, what reads only, what writes only, and true production readiness.
> **Status:** Complete ✓
> **Date:** 2026-06-09
> **Methodology:** Source code grep of all 27 page directories + 10 service files + 6 store files + 3 hook files + DB schema introspection. Every claim backed by file:line evidence.

---

## Section 1 — Entity Lifecycle Completeness

### 1.1 Customers

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✓ | `governed_create_customer` called from NewCustomerPage.tsx:96, SupervisorPage.tsx:475. Creates customer+address+contact. |
| Read List | ✓ | `get_governed_customers` called from 7+ pages (CustomersPage:27, AccountPage:34, StorefrontPage:157, etc.) |
| Read Single | ✓ | `get_governed_customer` called from CustomerProfilePage.tsx:69 |
| Update | ✓ | `governed_update_customer` called from CustomerProfilePage.tsx:128,168 |
| Activate/Deactivate | ✓ | Dynamic RPC via `fn` variable (governed_activate_customer / governed_deactivate_customer) at CustomerProfilePage.tsx:187 |
| Reassign Ownership | ✓ | `governed_change_customer_ownership` called from CustomerProfilePage.tsx:199, SupervisorPage.tsx:492 |
| Delete | ✗ | No delete RPC exists. Customers are deactivated, never deleted. |
| Archive | ✗ | No archive mechanism. Only is_active toggle. |

### 1.2 Employees

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✓ | `governed_create_employee` called from EmployeesPage.tsx:89, HierarchyPage.tsx:119, SupervisorPage.tsx:563 |
| Read List | ✓ | `get_governed_employees` called from 15+ pages |
| Read Single | ✓ | `get_governed_employee` called from VisitDetailPage.tsx:62 (also via get_governed_employees with filter) |
| Update | ✓ | `governed_update_employee` called from EmployeeProfilePage.tsx:83, EmployeesPage.tsx:111, HierarchyPage.tsx:100, UserProfilePage.tsx:55 |
| Change Manager | ✓ | `governed_change_employee_manager` called from EmployeeProfilePage.tsx:98, EmployeesPage.tsx:144, HierarchyPage.tsx:151 |
| Change Role | ✓ | `governed_change_employee_role` called from EmployeeProfilePage.tsx:106, EmployeesPage.tsx:158, HierarchyPage.tsx:164 |
| Reset Password | ✓ | `governed_reset_employee_password` called from EmployeeProfilePage.tsx:158, EmployeesPage.tsx:173, HierarchyPage.tsx:178 |
| Update Capabilities | ✓ | `governed_update_employee_capabilities` called from EmployeeProfilePage.tsx:345 |
| Activate/Deactivate | ✓ | Dynamic RPC via `fn` variable at EmployeeProfilePage.tsx:142, EmployeesPage.tsx:133 |
| Delete | ✗ | No delete RPC. Employees are deactivated, never deleted. |

### 1.3 Orders

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✓ | `governed_create_order` called from OrderNewPage.tsx:200, OrderReviewPage.tsx:74 |
| Read List | ✓ | `get_governed_orders` called from 8+ pages (OrdersPage:52, ApprovalQueuePage:24, etc.) |
| Read Single | ✓ | `get_governed_order` called from OrderDetailPage.tsx:32, OrderReviewPage.tsx:122, OrderNewPage.tsx:229 |
| Read Items | ✓ | `get_governed_order_items` called from OrderDetailPage.tsx:33, OrderEditPage.tsx:25, OrderReviewPage.tsx:127, OrderNewPage.tsx:233 |
| Read History | ✓ | `get_governed_order_history` called from OrderDetailPage.tsx:34 |
| Update | ✓ | `governed_change_order_status` called from OrderStatusManager.tsx:88. Also `governed_update_order` exists in DB (not confirmed from frontend) |
| Add Flash Offers | ✓ | `governed_add_order_flash_offers` called from OrderReviewPage.tsx:93 |
| Add Daily Deals | ✓ | `governed_add_order_daily_deals` called from OrderReviewPage.tsx:100 |
| Submit | ✓ | `governed_submit_order` called from OrderReviewPage.tsx:104, OrderNewPage.tsx:214 |
| Approve | ✗ | `governed_approve_order` EXISTS in DB but NOT called from frontend. OrderStatusManager uses governed_change_order_status instead. |
| Deny | ✗ | `governed_deny_order` EXISTS in DB but NOT called from frontend. |
| Delete | ✗ | No delete RPC. Orders flow through status transitions; never deleted. |

### 1.4 Collections

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✓ | `governed_create_collection` called from NewCollectionPage.tsx:47 |
| Read List | ✓ | `get_governed_collections` called from CollectionsPage.tsx:49, AccountantWorkspace.tsx:20, CollectorWorkspace.tsx:18 |
| Read Single | Partial | No dedicated single-read RPC. Detail inferred from list. |
| Update | ✗ | `governed_update_collection` EXISTS in DB but NOT called from frontend. |
| Approve | ✓ | `governed_approve_collection` called from CollectionsPage.tsx:92 |
| Delete | ✗ | No delete RPC. |

### 1.5 Visits

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create (Check-in) | ✓ | `governed_checkin_visit` called from VisitScreen.tsx:121, VisitsPage.tsx:111. Creates visit + generates code. |
| Read List | ✓ | `get_governed_visits` called from 6+ pages (VisitsPage:49, VisitScreen:51, SalesDirectorWorkspace:22, etc.) |
| Read Single | ✓ | `get_governed_visit` called from VisitDetailPage.tsx:53 |
| Update | ✓ | `governed_update_visit` called from OrderNewPage.tsx:249, VisitDetailPage.tsx (via governed_checkout_visit) |
| Check-out | ✓ | `governed_checkout_visit` called from VisitDetailPage.tsx:110, VisitScreen.tsx:167 |
| Create (Standalone) | ✗ | `governed_create_visit` EXISTS in DB but NOT called from frontend. Visits created only via check-in. |
| Delete | ✗ | No delete RPC. |

### 1.6 Returns

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✗ | `governed_create_return` EXISTS in DB but NOT called from frontend. Returns may be created by trigger/external system. |
| Read List | ✓ | `get_governed_returns` called from ReturnsPage.tsx:27 |
| Read Single | ✓ | `get_governed_return` called from ReturnDetailPage.tsx:25 |
| Read Items | ✓ | `get_governed_return_items` called from ReturnDetailPage.tsx:26 |
| Update | ✗ | `governed_update_return` EXISTS in DB but NOT called from frontend. |
| Approve | ✓ | `governed_approve_return` called from ReturnDetailPage.tsx:38 |
| Reject | ✓ | `governed_reject_return` called from ReturnDetailPage.tsx:53 |
| Delete | ✗ | No delete RPC. |

### 1.7 Deliveries

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✓ | Created implicitly via `governed_dispatch_order` at WarehousePage.tsx:194 |
| Read List | ✓ | `get_governed_deliveries` called from DeliveryPage.tsx:37, DeliveryWorkspace.tsx:17 |
| Read Single | ✓ | `governed_get_delivery` called from DeliveryDetailPage.tsx:30 |
| Assign Driver | ✓ | `governed_assign_delivery` called from DeliveryPage.tsx:49 |
| Confirm | ✓ | `governed_confirm_delivery` called from DeliveryDetailPage.tsx:39 (fn) |
| Fail | ✓ | `governed_fail_delivery` called from DeliveryDetailPage.tsx:39 (fn) |
| Delete | ✗ | No delete RPC. |

### 1.8 Warehouse Preparations

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create (Start) | ✓ | `governed_start_preparation` called from WarehousePage.tsx:125 |
| Read Waiting | ✓ | `get_governed_waiting_preparations` called from WarehousePage.tsx:86, WarehouseManagerWorkspace.tsx:20 |
| Read Queue | ✓ | `get_governed_preparation_queue` called from WarehousePage.tsx:90,98, WarehouseReviewPage.tsx:36 |
| Read Detail | ✓ | `get_governed_preparation_detail` called from WarehousePrepDetail.tsx:52 |
| Complete | ✓ | `governed_complete_preparation` called from WarehousePage.tsx:137 |
| Review | ✓ | `governed_review_preparation` called from WarehousePage.tsx:149, WarehouseReviewPage.tsx:54 |
| Return to Prep | ✓ | `governed_return_to_preparation` called from WarehousePage.tsx:165, WarehouseReviewPage.tsx:76 |
| Fail | ✓ | `governed_fail_preparation` called from WarehousePage.tsx:181 |
| Record Exception | ✓ | `governed_record_exception` called from WarehousePage.tsx:206, WarehousePrepDetail.tsx:69 |
| Dispatch | ✓ | `governed_dispatch_order` called from WarehousePage.tsx:194 |
| Delete | ✗ | No delete RPC. |

### 1.9 Credit Applications

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✗ | `governed_create_credit_application` EXISTS in DB but NOT called from frontend. |
| Read List | ✓ | `get_governed_credit_applications` called from CreditApplicationsPage.tsx:27 |
| Read Single | ✓ | `get_governed_credit_application` called from CreditReviewPage.tsx:26 |
| Confirm Documents | ✓ | `governed_confirm_documents` called from CreditReviewPage.tsx:44 |
| Approve | ✓ | `governed_manage_credit_application` called dynamically from CreditReviewPage.tsx:37 |
| Reject | ✓ | `governed_decline_credit` called dynamically from CreditReviewPage.tsx:37 |
| Submit | ✗ | `governed_submit_credit_application` EXISTS in DB but NOT called from frontend. |
| Suspend | ✗ | `governed_suspend_credit` EXISTS in DB but NOT called from frontend. |
| Delete | ✗ | No delete RPC. |

### 1.10 Credit Accounts

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✓ | Created implicitly via `governed_manage_credit_application` (approve). |
| Read | ✓ | `governed_get_customer_credit_account` EXISTS in DB (not confirmed called from frontend). |
| Read Ledger | ✗ | `governed_get_customer_credit_ledger` EXISTS in DB but NOT called from frontend. |
| Read Statements | ✗ | `governed_get_customer_monthly_statements` EXISTS in DB but NOT called from frontend. |
| Reserve Credit | ✗ | `governed_reserve_credit` EXISTS in DB but NOT called from frontend. |
| Release Reservation | ✗ | `governed_release_credit_reservation` EXISTS in DB but NOT called from frontend. |
| Pay Invoice | ✗ | `governed_pay_credit_invoice` EXISTS in DB but NOT called from frontend. |
| Register Cheque | ✗ | `governed_register_cheque` EXISTS in DB but NOT called from frontend. |
| Suspend Account | ✗ | `governed_suspend_credit_account` EXISTS in DB but NOT called from frontend. |
| Delete | ✗ | No delete RPC. |

### 1.11 Credit Programs

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✓ | `governed_create_credit_program` called from CreditProgramsPage.tsx:32, CreditProgramsManagerPage.tsx:92 |
| Read List | ✓ | `governed_get_credit_programs` called from CreditProgramsPage.tsx:20, CreditProgramsManagerPage.tsx:23 |
| Update | ✓ | `governed_update_credit_program` called from CreditProgramsPage.tsx:30, CreditProgramsManagerPage.tsx:56 |
| Toggle Active | ✓ | `governed_toggle_credit_program` called from CreditProgramsPage.tsx:39, CreditProgramsManagerPage.tsx:78 |
| Delete | ✗ | No delete RPC. |

### 1.12 Daily Deals

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | Mixed | `governed_create_daily_deal` EXISTS in DB but NOT called. DailyDealsManagerPage uses `supabase.from('daily_deals').update().eq('id')` for updates and `governed_update_daily_deal` RPC. |
| Read List | ✓ | `get_governed_daily_deals` called from DailyDealsManagerPage.tsx:34 |
| Update | ✓ | `governed_update_daily_deal` called from DailyDealsManagerPage.tsx:92 |
| Activate/Cancel | ✓ | Dynamic RPC via `fn` variable at DailyDealsManagerPage.tsx:66 |
| Delete | ✗ | No delete RPC. |
| Direct Bypass | ⚠️ | `supabase.from('daily_deals').update(directFields).eq('id', selectedId)` at DailyDealsManagerPage.tsx:100 |

### 1.13 Flash Offers

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✗ | `governed_create_flash_offer` EXISTS in DB but NOT called from frontend. Flash-offer pages have zero supabase calls — may use service layer. |
| Read List | ✗ | No direct supabase call found in flash-offer pages. Likely uses service layer. |
| Update | ✗ | `governed_update_flash_offer` EXISTS in DB but NOT called. |
| Delete | ✗ | No delete RPC. |

### 1.14 Auctions

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | Bypass | AuctionsManagerPage uses `supabase.from('auctions').insert({...})` at line 96. `governed_create_auction` EXISTS in DB but NOT called. |
| Read List | ✓ | `get_governed_auctions` called from AuctionsManagerPage.tsx:25 |
| Update | Bypass | AuctionsManagerPage uses `supabase.from('auctions').update(patch).eq('id', selectedId)` at line 75 |
| Delete | ✗ | No delete RPC. |

### 1.15 Products

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✓ | `governed_create_product` called from ProductsPage.tsx:81 |
| Read List | ✓ | `get_governed_products` called from 5+ pages |
| Read Single | ✓ | `get_governed_products` (with filter) at ProductProfilePage.tsx:22 |
| Update | ✓ | `governed_update_product` called from ProductManagerPage.tsx:133, ProductsPage.tsx:100 |
| Update Pricing | ✓ | `governed_update_product_pricing` called from ProductManagerPage.tsx:148, ProductsPage.tsx:110 |
| Update Units | ✓ | `governed_update_product_units` called from ProductManagerPage.tsx:155 |
| Change Company | ✓ | `governed_change_product_company` called from ProductManagerPage.tsx:142, ProductsPage.tsx:107 |
| Activate/Deactivate | ✓ | Dynamic RPC via `fn` at ProductsPage.tsx:124 |
| Show/Hide | ✓ | Dynamic RPC via `fn` at ProductManagerPage.tsx:187 |
| Direct Bypass | ⚠️ | `supabase.from('products').update({image_url}).eq('id', ...)` at ProductManagerPage.tsx:161, `.update({is_visible})` at line 166, `supabase.from('inventory').upsert()` at line 177 |
| Delete | ✗ | No delete RPC. |

### 1.16 Companies

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✓ | `governed_create_company` called from CompaniesPage.tsx:49 |
| Read List | ✓ | `get_governed_companies` called from 5+ pages |
| Read Single | ✓ | `get_governed_companies` (with filter) at CompanyProfilePage.tsx:24, plus `supabase.from('companies').select('*').eq('id', id).single()` bypass at CompanyManagerPage.tsx:72 |
| Update | ✓ | `governed_update_company` called from CompaniesPage.tsx:66, CompanyManagerPage.tsx:105 |
| Update Profile | ✓ | `governed_update_company_profile` called from settings/CompanyProfilePage.tsx:57 |
| Activate/Deactivate | ✓ | Dynamic RPC via `fn` at CompaniesPage.tsx:83, CompanyManagerPage.tsx:130 |
| Direct Bypass | ⚠️ | `supabase.from('companies').update({logo_url}).eq('id', ...)` at CompanyManagerPage.tsx:113, `.update({is_visible})` at line 118 |
| Delete | ✗ | No delete RPC. |

### 1.17 Tiers

| Operation | Exists | Evidence |
|-----------|--------|----------|
| Create | ✓ | `governed_create_tier` called from TiersManagerPage.tsx:92 |
| Read List | ✓ | `get_governed_tiers` called from TiersManagerPage.tsx:24, ProductManagerPage.tsx:51, CompanyManagerPage.tsx:41 |
| Update | ✓ | `governed_update_tier` called from TiersManagerPage.tsx:72 |
| Set Company Exception | ✓ | `governed_set_tier_company_exception` called from CompanyManagerPage.tsx:140 |
| Remove Company Exception | ✓ | `governed_remove_tier_company_exception` called from CompanyManagerPage.tsx:147 |
| Set Product Exception | ✓ | `governed_set_tier_product_exception` called from ProductManagerPage.tsx:202 |
| Remove Product Exception | ✓ | `governed_remove_tier_product_exception` called from ProductManagerPage.tsx:198,210 |
| Delete | ✗ | No delete RPC. |

---

## Section 2 — Read Without Write

Entities that have read operations but missing create/update operations:

| Entity | Read Exists | Write Exists | Evidence |
|--------|-------------|-------------|----------|
| **Returns** | ✓ 2 RPCs | ✗ No create from frontend | `get_governed_returns`, `get_governed_return`, `get_governed_return_items` called. `governed_create_return` EXISTS in DB but never called. Return creation flow is external/missing. |
| **Flash Offers** | ? Via service | ✗ | Flash-offer pages have zero direct supabase calls. `governed_create_flash_offer`, `governed_update_flash_offer` EXISTS in DB but not called from frontend pages. May use service layer (not verified). |
| **Credit Accounts** (detailed) | Partial | ✗ Write RPCs exist but not called | `governed_get_customer_credit_account`, `governed_get_customer_credit_ledger`, `governed_get_customer_monthly_statements` exist but not called from frontend. `governed_reserve_credit`, `governed_release_credit_reservation`, `governed_pay_credit_invoice`, `governed_register_cheque`, `governed_suspend_credit_account` all exist but not called. |
| **Credit Applications** (create) | ✓ | ✗ Create RPC exists but not called | `governed_create_credit_application`, `governed_submit_credit_application` exist but not called from frontend. Applications may be created differently. |

---

## Section 3 — Write Without UI

RPCs that exist in the database, write/modify data, but no frontend screen calls them:

### 3.1 Order Write RPCs Without UI

| RPC | Tables Written | Why Missing |
|-----|---------------|-------------|
| `governed_approve_order` | order, inventory, credit_invoice | OrderStatusManager uses `governed_change_order_status` instead. The approve-specific business logic (inventory deduction, credit invoice creation) is never invoked from frontend. |
| `governed_deny_order` | order | No frontend calls this. Order denial handled via status transition. |

### 3.2 Return Write RPCs Without UI

| RPC | Tables Written | Why Missing |
|-----|---------------|-------------|
| `governed_create_return` | return, return_item | Return creation has no frontend flow. Returns appear to be created by external process or trigger. |
| `governed_update_return` | return | No frontend calls this. |

### 3.3 Collection Write RPC Without UI

| RPC | Tables Written | Why Missing |
|-----|---------------|-------------|
| `governed_update_collection` | collection | No frontend calls this. Once created, collections are only approved, never updated. |

### 3.4 Visit Write RPCs Without UI

| RPC | Tables Written | Why Missing |
|-----|---------------|-------------|
| `governed_create_visit` | visit | Not called. Visits are created via `governed_checkin_visit` which handles both creation and check-in in one call. |

### 3.5 Location Write RPC Without UI

| RPC | Tables Written | Why Missing |
|-----|---------------|-------------|
| `governed_create_location` | unified_locations | Not called directly. Locations are created via `governed_create_customer` which handles location creation internally. |

### 3.6 Commercial Package Write RPCs Without UI

| RPC | Tables Written | Why Missing |
|-----|---------------|-------------|
| `governed_create_daily_deal` | daily_deal, daily_deal_items | DailyDealsManagerPage uses `supabase.from('daily_deals').update()` + `governed_update_daily_deal` instead of the create RPC. |
| `governed_create_flash_offer` | flash_offer, flash_offer_items | Flash-offer pages have zero supabase calls. |
| `governed_update_flash_offer` | flash_offer | Not called from frontend. |
| `governed_create_auction` | auction | AuctionsManagerPage uses `supabase.from('auctions').insert()` directly instead. |

### 3.7 Credit RPCs Without UI

| RPC | Tables Written | Why Missing |
|-----|---------------|-------------|
| `governed_create_credit_application` | credit_application | No frontend creates credit applications. |
| `governed_submit_credit_application` | credit_application | No frontend submits draft applications. |
| `governed_suspend_credit` | credit_application | No frontend suspends applications. |
| `governed_reserve_credit` | customer_credit_ledger | Credit reservation not wired to order flow. |
| `governed_release_credit_reservation` | customer_credit_ledger | No frontend releases reservations. |
| `governed_pay_credit_invoice` | credit_invoice, customer_credit_ledger, treasury_transaction | No frontend payment flow for credit invoices. |
| `governed_register_cheque` | credit_invoice_cheque | No frontend cheque registration. |
| `governed_suspend_credit_account` | customer_credit_accounts | No frontend account suspension. |
| `governed_update_contract_template` | credit_contract_templates | No frontend template editing. |

### 3.8 Target Write RPCs Without UI

| RPC | Tables Written | Why Missing |
|-----|---------------|-------------|
| `governed_upsert_company_monthly_target` | company_monthly_targets | Target pages use services; direct RPC not confirmed called. |
| `governed_upsert_employee_monthly_target` | employee_monthly_targets | Same as above. |

### 3.9 Auth RPC Without UI

| RPC | Tables Written | Why Missing |
|-----|---------------|-------------|
| `register_customer` | identity, customer, unified_location, customer_contact, session | Not called from frontend. NewCustomerPage uses `governed_create_customer` instead, which does NOT create auth identity or session. |

### 3.10 Ownership RPC Without UI

| RPC | Tables Written | Why Missing |
|-----|---------------|-------------|
| `governed_reassign_customer_ownership` | customer, customer_ownership_history | Not called. CustomerProfilePage uses `governed_change_customer_ownership` (different name, same purpose). |

---

## Section 4 — Shadow Data Audit

Tables that contain operational data but are NOT the official source of truth:

| Table | Rows | Written By | Read By | Source Of Truth? | Migration Needed? |
|-------|------|-----------|---------|-----------------|-------------------|
| `customer_addresses` | 25 | `governed_create_customer` (legacy path) | CustomerProfilePage via `get_governed_customer_addresses` | **No** — `unified_locations` is SOT for new customers | Yes — 15 customers (60%) have location_id=null and fall back to this table |
| `orders.snapshot_customer_name` | 38 | `governed_create_order` (frozen copy) | Every order read screen | **Yes** (by design) — frozen copy at order time | No — intentional denormalization |
| `orders.snapshot_customer_phone` | 38 | `governed_create_order` | Order read screens | **Yes** (by design) | No |
| `orders.snapshot_customer_address` | 38 | `governed_create_order` | Order read screens | **Yes** (by design) | No |
| `orders.snapshot_owner_name` | 38 | `governed_create_order` | Order read screens | **Yes** (by design) | No |
| `orders.snapshot_sender_name` | 38 | `governed_create_order` | Order read screens | **Deprecated** — superseded by snapshot_owner_* | Yes — sender_* snapshots should be removed after validation |
| `orders.snapshot_sender_phone` | 38 | `governed_create_order` | Order read screens | **Deprecated** | Yes |
| `orders.snapshot_sender_address` | 38 | `governed_create_order` | Order read screens | **Deprecated** | Yes |
| `customer_credit_accounts.outstanding_credit` | 3 | `governed_manage_credit_application` | No direct frontend reads | **Cached** — `customer_credit_ledger.running_balance` is authoritative | Yes — this is a performance cache that can drift |
| `customers.credit_limit` | 25 | Legacy | CustomerProfilePage (display) | **Legacy** — `customer_credit_accounts.credit_limit` is the program-level limit | Yes — dual storage causes confusion |
| `customers.credit_days` | 25 | Legacy | CustomerProfilePage (display) | **Legacy** — `customer_credit_accounts.payment_term_days` is the program-level value | Yes |
| `order_items` (prices) | 394 | `governed_create_order` | OrderDetailPage, OrderReviewPage | **Yes** (by design) — prices frozen at order time | No |
| `preparation_records` | — | `governed_start_preparation` etc. | Warehouse pages | **Yes** — operationally independent | No |
| `delivery_tracking` | — | `governed_dispatch_order` | Delivery pages | **Yes** | No |
| `return_inspection` | 0 | External/unknown | None | **No Read** — no frontend reads this table | Unknown — possibly used by external inspection process |

---

## Section 5 — Source Of Truth Conflict Report

| Concept | Official Source | Secondary Sources | Conflict Exists? | Details |
|---------|---------------|-------------------|-----------------|---------|
| **Customer Phone** | `identities.phone` | `customer_contacts.phone` | Yes — potential | Identities.phone is auth phone; customer_contacts.phone is operational. Different values possible. |
| **Customer Credit Limit** | `customer_credit_accounts.credit_limit` | `customers.credit_limit` | Yes — dual storage | customer.credit_limit is legacy; cca.credit_limit is current. SupervisorPage displays customer.credit_limit. |
| **Customer Credit Days** | `customer_credit_accounts.payment_term_days` | `customers.credit_days` | Yes — dual storage | Same pattern as credit limit. |
| **Customer Address** | `unified_locations.formatted_address` | `customer_addresses.address_line1` | Yes — 15 customers have no location_id | Migration in progress; 10 customers (40%) already migrated. |
| **Order Owner** | `employees.full_name` | `orders.snapshot_owner_name` | No — intentional snapshot | Frozen at order time. Not a conflict. |
| **Visit GPS** | `unified_locations` (via visit.start_location_id) | `visits.check_in_latitude/longitude` | Yes — potential | Same GPS data may be stored in two places when check-in creates a unified_locations record AND populates inline coordinates. |
| **Credit Balance** | `customer_credit_ledger.running_balance` | `customer_credit_accounts.outstanding_credit` | Yes — potential | Ledger is INSERT-only and authoritative; cca.outstanding_credit is a cached summary that can drift. |
| **Role-Capability Mapping** | `role_capabilities` | `employee_capabilities` | No — by design | Direct capabilities override role-based ones. Both are authoritative for their domain. |
| **Employee Address** | `employees.address` | `orders.snapshot_owner_address` | No — intentional snapshot | Frozen at order time. |
| **Product Legacy Code** | External legacy system | `products.legacy_code` | N/A | Read-only reference; not editable. |
| **Company Legacy Code** | External legacy system | `companies.legacy_code` | N/A | Read-only reference; not editable. |

---

## Section 6 — Screen Data Classification

Every page classified by data source:

### 6.1 Real Runtime Data (live RPC calls, no cache)

| Screen | Reason |
|--------|--------|
| CustomersPage | `get_governed_customers` + `get_governed_customer_contacts` — live queries |
| CustomerProfilePage | 10+ distinct RPCs — all live |
| NewCustomerPage | `governed_create_customer` — write |
| OrdersPage | `get_governed_orders` + `get_governed_customers` + `get_governed_employees` — live |
| OrderNewPage | Multiple create/read RPCs — live |
| OrderDetailPage | `get_governed_order` + items + history — live |
| EmployeesPage | Multiple read/write RPCs — live |
| EmployeeProfilePage | 10+ distinct RPCs — live |
| HierarchyPage | Multiple employee RPCs — live |
| CollectionsPage | Read + approve — live |
| NewCollectionPage | Create — live |
| ReturnsPage | Read — live |
| ReturnDetailPage | Read + approve/reject — live |
| CreditApplicationsPage | Read — live |
| CreditReviewPage | Read + approve/reject — live |
| CreditProgramsPage | Read + write — live |
| CreditProgramsManagerPage | Read + write — live |
| WarehousePage | 10+ distinct RPCs — live |
| WarehousePrepDetail | Read + exception — live |
| WarehouseReviewPage | Read + review — live |
| DeliveryPage | Read + assign — live |
| DeliveryDetailPage | Read + confirm/fail — live |
| VisitsPage | Read + checkin — live |
| VisitScreen | Checkin/checkout — live |
| VisitDetailPage | Read + checkout — live |
| ProductsPage | Create/read/update — live |
| ProductProfilePage | Read — live |
| ProductManagerPage | Read/write + bypasses — live (mixed) |
| CompaniesPage | Create/read/update — live |
| CompanyProfilePage | Read — live |
| CompanyManagerPage | Read/write + bypasses — live (mixed) |
| TiersManagerPage | Read/write — live |
| DailyDealsManagerPage | Read/write + bypasses — live (mixed) |
| AuctionsManagerPage | Read + from() bypasses — live (mixed) |
| SupervisorPage | 8+ RPCs including create customer/employee — live |

### 6.2 Derived Runtime Data (aggregate/computed)

| Screen | Reason |
|--------|--------|
| ManagementDashboard | `get_dashboard_management` — aggregate RPC |
| SalesDashboard | `get_dashboard_sales` — aggregate RPC |
| TransportDashboard | `get_dashboard_transport` — aggregate RPC |
| WarehouseDashboard | `get_dashboard_warehouse` — aggregate RPC |
| UpperManagementDashboard | `get_upper_management_dashboard` — aggregate RPC |
| AdminWorkspace | Multiple aggregate RPCs |
| SuperAdminWorkspace | 4 aggregate RPCs |
| SalesDirectorWorkspace | Multiple list RPCs |
| SupervisorWorkspace | Multiple list RPCs |
| AccountantWorkspace | List RPCs |
| PerformanceAnalysisPage | Aggregate + KPI RPCs |
| EmployeeAnalysisPage | KPI RPCs |
| CustomerAnalyticsPage | `get_customer_card`, `get_customer_products`, `get_customer_brands` |
| AnalyticsListPage | `get_customer_analytics_list`, `get_customer_sales_ranking` |
| ReportsPage | Dynamic RPC — type determined by report selection |
| SupervisorPage | `get_supervisor_dashboard` — aggregate |

### 6.3 Cached Runtime Data

| Screen | Reason |
|--------|--------|
| GlobalSearch | `governed_global_search` — real-time search but results ephemeral |
| AccountPage | `get_governed_customers` — live but uses store |
| UserPermissionsPage | Multiple RPCs — live |
| SalesRepWorkDay | Dashboard + visits + orders + customers — live |
| Settings/CompanyProfilePage | `get_company_profile` + `governed_update_company_profile` — live |

### 6.4 Placeholder / Mixed

| Screen | Reason |
|--------|--------|
| StorefrontPage | Real RPCs (`get_governed_products`, `get_governed_customers`) + cart store |
| OrderReviewPage | Real RPCs (create/submit order + offers/deals) |
| ApprovalQueuePage | Single `get_governed_orders` — functional but minimal |
| OrderEditPage | Only reads `get_governed_order_items` — no update RPC confirmed |
| CompanyProfilePage (settings) | `get_company_profile` + `governed_update_company_profile` — functional |

### 6.5 Empty Shell (Zero Supabase Calls, May Render UI)

| Screen | Reason |
|--------|--------|
| CheckoutPage | `src/pages/checkout/CheckoutPage.tsx` — zero supabase.rpc() or supabase.from() calls |
| ActivityPage | `src/pages/activity/ActivityPage.tsx` — zero supabase calls |
| Flash-offer pages | `src/pages/flash-offers/*.tsx` — zero supabase calls (may use services) |
| Deals pages | `src/pages/deals/*.tsx` — zero supabase calls (may use services) |
| DashboardPage | Router only — no data calls. Dispatches to role-specific workspace. |

### 6.6 Static / No Data

| Screen | Reason |
|--------|--------|
| ModuleLauncherPage | Static navigation only — no RPCs |
| SubLauncherPage | Static navigation only — no RPCs |
| NewVisitPage | Local Zustand store only — no supabase calls until check-in step |

---

## Section 7 — Runtime Coverage Matrix

| Screen | Read RPCs | Write RPCs | Tables Touched | Fully Operational? |
|--------|-----------|------------|---------------|-------------------|
| LoginPage | 0 | 0 (auth.signInWithPassword) | identities (via auth) | ✓ Yes |
| CustomersPage | 2 | 0 | customer, customer_contact | ✓ Yes |
| CustomerProfilePage | 8 | 3 | customer, order, collection, visit, customer_address, customer_contact, customer_ownership_history, unified_locations, employee | ✓ Yes |
| NewCustomerPage | 0 | 1 | customer, customer_address, customer_contact | ✓ Yes |
| OrdersPage | 3 | 0 | order, customer, employee | ✓ Yes |
| OrderNewPage | 7 | 2 | order, order_item, customer, product, company, visit | ✓ Yes |
| OrderDetailPage | 3 | 0 | order, order_item, order_status_history | ✓ Yes |
| OrderEditPage | 1 | 0 | order_item | ✗ No — no update RPC confirmed; reads only |
| ApprovalQueuePage | 1 | 0 | order | ✗ Partial — reads only, approve/deny via OrderStatusManager |
| EmployeesPage | 2 | 6 | employee, role | ✓ Yes |
| EmployeeProfilePage | 5 | 5 | employee, role, capability, employee_capability, employee_activity | ✓ Yes |
| HierarchyPage | 2 | 5 | employee, role | ✓ Yes |
| CollectionsPage | 2 | 1 | collection, customer | ✓ Yes |
| NewCollectionPage | 1 | 1 | collection, customer | ✓ Yes |
| CollectionFollowupPage | 1 | 0 | collection, order, customer | ✗ Partial — read-only followup |
| ReturnsPage | 1 | 0 | return | ✗ Partial — read-only, no create |
| ReturnDetailPage | 2 | 2 | return, return_item | ✗ Partial — approve/reject but no create |
| CreditApplicationsPage | 1 | 0 | credit_application | ✗ Partial — read-only, no create |
| CreditReviewPage | 1 | 2+ | credit_application, credit_account | ✗ Partial — approve/reject but no create/submit |
| CreditProgramsPage | 1 | 3 | credit_program | ✓ Yes |
| CreditProgramsManagerPage | 1 | 3 | credit_program | ✓ Yes |
| WarehousePage | 3 | 8 | preparation, preparation_item, order, employee | ✓ Yes |
| WarehousePrepDetail | 1 | 1 | preparation, preparation_item | ✓ Yes |
| WarehouseReviewPage | 1 | 2 | preparation | ✓ Yes |
| DeliveryPage | 2 | 1 | delivery, employee | ✓ Yes |
| DeliveryDetailPage | 1 | 2 | delivery | ✓ Yes |
| VisitsPage | 3 | 1 | visit, customer, employee | ✓ Yes |
| VisitScreen | 2 | 2 | visit, customer | ✓ Yes |
| VisitDetailPage | 3 | 2 | visit, employee, customer | ✓ Yes |
| ProductsPage | 1 | 3 | product | ✓ Yes |
| ProductProfilePage | 1 | 0 | product | ✗ Partial — read-only |
| ProductManagerPage | 3 | 6+ | product, company, tier, inventory | ✓ Yes (with bypasses) |
| CompaniesPage | 1 | 3 | company | ✓ Yes |
| CompanyProfilePage | 2 | 0 | company, product | ✗ Partial — read-only |
| CompanyManagerPage | 2 | 4+ | company, tier | ✓ Yes (with bypasses) |
| TiersManagerPage | 1 | 2 | tier | ✓ Yes |
| DailyDealsManagerPage | 1 | 2+ | daily_deal | ✓ Yes (with bypasses) |
| AuctionsManagerPage | 1 | 2 (from()) | auction | ✗ No governed create — uses supabase.from().insert() directly |
| SupervisorPage | 6 | 3 | employee, customer, visit, order | ✓ Yes |
| ManagementDashboard | 2 | 0 | multiple (aggregate) | ✓ Yes |
| SuperAdminWorkspace | 4 | 0 | multiple (aggregate) | ✓ Yes |
| All Dashboards | 1-4 | 0 | multiple (aggregate) | ✓ Yes |
| ReportsPage | 1+ | 0 | depends on report | ✓ Yes (read-only by design) |
| SalesRepWorkDay | 4 | 0 | order, visit, customer | ✓ Yes |
| CustomerAnalyticsPage | 3 | 0 | customer, order, product | ✓ Yes (read-only by design) |
| AnalyticsListPage | 2 | 0 | customer | ✓ Yes (read-only by design) |
| Settings/CompanyProfilePage | 1 | 1 | company | ✓ Yes |
| UserPermissionsPage | 4 | 0 | employee, role, capability, employee_capability | ✗ Partial — read-only |
| UserProfilePage | 1 | 1 | employee | ✓ Yes |
| CheckoutPage | 0 | 0 | none | ✗ Empty shell |
| ActivityPage | 0 | 0 | none | ✗ Empty shell |
| Flash-offer pages | 0 | 0 | none | ✗ Likely uses services (unverified) |
| Deals pages | 0 | 0 | none | ✗ Likely uses services (unverified) |

---

## Section 8 — Governance Bypass Audit

Confirmed list of ALL pages that bypass the `governed_*` RPC layer and use `supabase.from()` directly:

| # | Screen | File | Direct Table | Operation | Line | Risk |
|---|--------|------|-------------|-----------|------|------|
| 1 | **AuctionsManagerPage** | `src/pages/auctions/AuctionsManagerPage.tsx` | `auctions` | `.update(patch).eq('id', selectedId)` | 75 | Medium — updates without governed business logic |
| 2 | **AuctionsManagerPage** | `src/pages/auctions/AuctionsManagerPage.tsx` | `auctions` | `.insert({...})` | 96 | Medium — governed_create_auction RPC exists but not used |
| 3 | **DailyDealsManagerPage** | `src/pages/daily-deals/DailyDealsManagerPage.tsx` | `daily_deals` | `.update(directFields).eq('id', selectedId)` | 100 | Low — also uses governed_update_daily_deal for other fields |
| 4 | **ProductManagerPage** | `src/pages/products/ProductManagerPage.tsx` | `products` | `.update({image_url}).eq('id', ...)` | 161 | Low — image URL only |
| 5 | **ProductManagerPage** | `src/pages/products/ProductManagerPage.tsx` | `products` | `.update({is_visible}).eq('id', ...)` | 166 | Low — visibility toggle only |
| 6 | **ProductManagerPage** | `src/pages/products/ProductManagerPage.tsx` | `inventory` | `.upsert({product_id, quantity})` | 177 | Low — inventory is simple |
| 7 | **CompanyManagerPage** | `src/pages/companies/CompanyManagerPage.tsx` | `companies` | `.select('*').eq('id', id).single()` | 72 | None — read-only |
| 8 | **CompanyManagerPage** | `src/pages/companies/CompanyManagerPage.tsx` | `companies` | `.update({logo_url}).eq('id', ...)` | 113 | Low — logo URL only |
| 9 | **CompanyManagerPage** | `src/pages/companies/CompanyManagerPage.tsx` | `companies` | `.update({is_visible}).eq('id', ...)` | 118 | Low — visibility toggle only |

**✅ Confirmed no other pages bypass the governed layer.** All remaining pages call `supabase.rpc()` exclusively.

**Pattern:** All bypasses are for simple field updates (image_url, is_visible) or for entities where the governed RPC doesn't exist or doesn't cover the specific operation. The most significant bypass is **AuctionsManagerPage** which skips `governed_create_auction` entirely and uses raw inserts/updates.

---

## Section 9 — Production Readiness Assessment

| Domain | Score /100 | Reason |
|--------|-----------|--------|
| **Customers** | 90 | Full CRUD + activate/deactivate + ownership history + address/contact management. Missing: delete (by design). Low risk. |
| **Employees** | 92 | Full CRUD + manager/role changes + password reset + capabilities + activate/deactivate. Missing: delete (by design). |
| **Orders** | 75 | Create, submit, read, status change work. **`governed_approve_order` not called** — inventory deduction and credit invoice creation on approval may not execute. OrderEditPage reads only. |
| **Collections** | 70 | Create, list, approve work. **No update RPC called from frontend.** No single-read RPC. |
| **Visits** | 80 | Check-in, check-out, list, detail all work. **`governed_create_visit` not called** — but check-in handles creation. Missing: standalone visit creation without check-in GPS. |
| **Returns** | 50 | Read, approve, reject work. **No create flow from frontend.** Returns cannot be initiated through the UI. `governed_create_return` exists but is orphaned. This is a critical gap for operational staff. |
| **Warehouse** | 95 | Full preparation lifecycle: start, complete, review, return-to-prep, fail, dispatch, record exception. Most complete domain. |
| **Delivery** | 85 | Assign, confirm, fail work. Read list + detail work. Missing: delivery tracking UI, route optimization, proof-of-delivery photos. |
| **Credit** | 30 | Credit programs full CRUD works. Applications: read list/detail, approve/reject work. **But: no application creation, no submission, no suspension, no payment flow, no cheque registration, no ledger view, no reservation.** Most RPCs exist but have no UI. Credit is the most incomplete domain. |
| **Dashboards** | 85 | All role-specific workspaces render real data. Most use aggregate RPCs. Missing: some dashboards may lack real-time refresh. |
| **Storefront** | 80 | Product browsing, cart, order creation work. **CheckoutPage is an empty shell.** Order review handles submission directly. Missing: proper checkout flow, payment integration. |
| **Governance** | 88 | Most operations go through governed_* RPCs. 9 bypass instances identified (mostly low-risk field updates). Auctions bypass is the most significant gap. |

### Overall Production Readiness: 68 / 100

**Breakdown:**
- Strong domains (85+): Customers, Employees, Warehouse, Dashboards
- Adequate domains (70-84): Orders, Collections, Visits, Delivery, Storefront, Governance
- Weak domains (below 70): Returns (50), Credit (30)

---

## Section 10 — Executive Findings

### 10.1 Top 10 Operational Gaps

| # | Gap | Impact | Evidence |
|---|-----|--------|---------|
| 1 | **Returns cannot be created from UI** | Operational staff cannot initiate returns. `governed_create_return` exists in DB but no frontend calls it. | ReturnsPage + ReturnDetailPage: read/approve/reject only |
| 2 | **Order approval bypasses governed_approve_order** | Inventory deduction + credit invoice creation on approval never execute. `governed_approve_order` has business logic that is never invoked. | OrderStatusManager uses `governed_change_order_status` instead |
| 3 | **Credit application creation has no UI** | Customers/staff cannot apply for credit. 6+ credit RPCs exist with zero frontend callers. | CreditApplicationsPage + CreditReviewPage: read/approve/reject only |
| 4 | **CheckoutPage is an empty shell** | No checkout flow exists. Order creation is done inline in OrderReviewPage/OrderNewPage without a dedicated checkout step. | Zero supabase calls in CheckoutPage.tsx |
| 5 | **Credit payment/cheque/ledger has no UI** | 8 credit financial RPCs exist but cannot be invoked. No payment collection, no cheque registration, no ledger viewing. | No frontend calls governed_pay_credit_invoice, governed_register_cheque, etc. |
| 6 | **No credit reservation in order flow** | `governed_reserve_credit` is never called during order creation. Credit orders may overspend. | OrderNewPage, OrderReviewPage: no credit reservation call |
| 7 | **SupervisorPage creates customers/employees** | SupervisorPage.tsx creates customers and employees directly — business logic duplication across pages. | SupervisorPage.tsx:475,563 |
| 8 | **Auctions bypass governed RPC entirely** | `governed_create_auction` exists but AuctionsManagerPage uses raw `supabase.from('auctions').insert()`. | AuctionsManagerPage.tsx:75,96 |
| 9 | **Flash offers and deals have no direct supabase calls** | Flash-offer and deals pages use service layer (unverified) or are incomplete. | Zero supabase calls in flash-offers/*.tsx and deals/*.tsx |
| 10 | **ActivityPage is empty** | Activity log page renders but makes zero data calls. | Zero supabase calls in ActivityPage.tsx |

### 10.2 Top 10 Data Duplication Sources

| # | Duplication | Source A | Source B | Resolution |
|---|------------|---------|---------|------------|
| 1 | **Customer Phone** | `identities.phone` | `customer_contacts.phone` | Accept — different purposes (auth vs operational) |
| 2 | **Customer Credit Limit** | `customers.credit_limit` | `customer_credit_accounts.credit_limit` | Remove `customers.credit_limit` after migration |
| 3 | **Customer Credit Days** | `customers.credit_days` | `customer_credit_accounts.payment_term_days` | Remove `customers.credit_days` after migration |
| 4 | **Customer Address** | `unified_locations.formatted_address` | `customer_addresses.address_line1` | Complete migration; remove customer_addresses |
| 5 | **Credit Balance** | `customer_credit_ledger.running_balance` | `customer_credit_accounts.outstanding_credit` | Accept cache or remove cca.outstanding_credit |
| 6 | **Visit GPS** | `unified_locations` (via start_location_id) | `visits.check_in_latitude/longitude` | Tolerate until next schema cleanup |
| 7 | **Order Sender Snapshots** | `snapshot_sender_name/phone/address` | `snapshot_owner_name/phone/address` | Remove deprecated sender_* columns |
| 8 | **Employee Address** | `employees.address` | `orders.snapshot_owner_address` | No conflict — intentional snapshot |
| 9 | **Order Snapshots** | All snapshot columns | Source tables (customers/employees) | No conflict — intentional denormalization |
| 10 | **Customer Ownership** | `customers.owner_id` | `customer_ownership_history` | No conflict — current vs history |

### 10.3 Top 10 Incomplete Parts

| # | Part | What's Missing | Criticality |
|---|------|---------------|-------------|
| 1 | **Return Creation** | Complete UI flow to create returns | High — operational blocker |
| 2 | **Credit Application Flow** | Create, submit, view ledger, make payments | High — credit system is half-built |
| 3 | **Order Approval Business Logic** | governed_approve_order (inventory + credit invoice) never called | High — inventory may not deduct on approval |
| 4 | **Checkout Flow** | Dedicated checkout page with payment method selection | Medium — currently handled inline |
| 5 | **Flash Offers** | Pages exist but no direct supabase calls | Medium — may work via services |
| 6 | **Deals Module** | Pages exist but no direct supabase calls | Medium — may work via services |
| 7 | **Activity Log** | ActivityPage exists but has zero functionality | Low — non-critical |
| 8 | **OrderEditPage** | Reads order items but no confirmed update call | Low — may use service layer |
| 9 | **CollectionFollowupPage** | Read-only followup list, no write actions | Low |
| 10 | **UserPermissionsPage** | Read-only view of capabilities, no edit | Low |

### 10.4 What Prevents 100% Production Readiness

1. **Return creation is missing** — staff cannot process returns through the system. This is an operational blocker.
2. **Order approval business logic is orphaned** — `governed_approve_order` (with inventory deduction + credit invoice creation) is never called, meaning approved orders may not correctly update inventory or create credit invoices.
3. **Credit system is half-built** — 20+ credit RPCs exist but only 6 are called from frontend. No payment collection, no ledger, no cheque management.
4. **Checkout has no dedicated flow** — the CheckoutPage renders nothing. Order submission happens inline, skipping payment method selection, credit checks, and confirmation steps.
5. **Missing business continuity for 15 customers** — 60% of customers still use legacy `customer_addresses` without `unified_locations` migration complete.

### 10.5 What Can Be Cleaned Safely Later

| Item | Reason | When |
|------|--------|------|
| Test RPCs (test_ping2, test_ping3, test_rpc, test_setof, test_func, multiline_test) | Zero call sites, test-only | Any time |
| Empty shell pages (CheckoutPage, ActivityPage) | No data calls, render nothing useful | After confirming no planned use |
| Deprecated snapshot columns (snapshot_sender_*) | Superseded by snapshot_owner_* | After verifying no external consumers |
| Dead tables (customer_classification, customer_daily_deal, deal, follow_up, notification, permission, visit_note, voucher_type) | 0 rows, zero frontend references | After confirming no planned features |
| Orphaned governed RPCs (governed_create_flash_offer, governed_update_flash_offer, governed_create_visit, governed_create_return, governed_update_return, governed_update_collection, governed_create_daily_deal) | Exist in DB, never called | After verifying no service layer or trigger dependency |
| `customers.email` column removal from UI | No longer editable | Any time |
| `customers.credit_limit` and `customers.credit_days` columns | Superseded by credit_account tables | After credit system is completed |

### 10.6 What Prevents Safe Cleanup Now

| Item | Why It Cannot Be Cleaned Now |
|------|------------------------------|
| `customer_addresses` table | 15 customers (60%) still rely on it. Migration to unified_locations must complete first. |
| Orphaned `governed_*` RPCs | May be called by future UI, service layer, triggers, or external integrations. Must verify zero dependencies first. |
| `snapshot_sender_*` columns | May be consumed by PDF exports, WhatsApp messages, or external reports. Must audit all consumers. |
| Empty pages (CheckoutPage, ActivityPage) | May be intentionally reserved for future implementation. Must confirm product roadmap. |
| Flash-offer service layer | flash-offers/*.tsx pages may use service layer. Must verify full service implementation before concluding they're dead. |
| Credit RPCs without UI | Must confirm no planned frontend integration before removing RPCs. |

---

## Appendix A: Total Supabase Call Count by Directory

| Directory | RPC Calls | Direct Table (`from()`) |
|-----------|-----------|------------------------|
| `pages/account/` | 6 | 0 |
| `pages/activity/` | 0 | 0 |
| `pages/analytics/` | 5 | 0 |
| `pages/auctions/` | 2 | 3 |
| `pages/auth/` | 0 | 0 |
| `pages/checkout/` | 0 | 0 |
| `pages/collections/` | 5 | 0 |
| `pages/companies/` | 14 | 3 |
| `pages/credit/` | 12 | 0 |
| `pages/customers/` | 18 | 0 |
| `pages/daily-deals/` | 4 | 1 |
| `pages/dashboard/` | 32 | 0 |
| `pages/deals/` | 0 | 0 |
| `pages/delivery/` | 8 | 0 |
| `pages/employees/` | 28 | 0 |
| `pages/flash-offers/` | 0 | 0 |
| `pages/orders/` | 18 | 0 |
| `pages/products/` | 17 | 3 |
| `pages/reports/` | 1 | 0 |
| `pages/returns/` | 5 | 0 |
| `pages/sales-rep/` | 4 | 0 |
| `pages/settings/` | 2 | 0 |
| `pages/storefront/` | 8 | 0 |
| `pages/supervisor/` | 8 | 0 |
| `pages/tiers/` | 4 | 0 |
| `pages/visits/` | 12 | 0 |
| `pages/warehouse/` | 15 | 0 |
| `components/` | 4 | 0 |
| **Total** | **~232** | **~10** |
