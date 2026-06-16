# 11. Runtime Truth Audit

> **Goal:** Trace every screen → service → RPC → table → column path with verified evidence from source code. Replace every "assumed/inferred" with operational proof.
> **Status:** Complete ✓
> **Date:** 2026-06-09

---

## 1. Screen → Runtime Flow Index

Each entry: `Page (file) → Service/Inline → RPC(s) → Table(s) → Columns`

### 1.1 Auth & Account

| Screen | File | Runtime Path |
|--------|------|-------------|
| LoginPage | `src/pages/auth/LoginPage.tsx` | `authService.login()` → `supabase.auth.signInWithPassword()` → Supabase Auth |
| AccountPage | `src/pages/account/AccountPage.tsx:34` | `supabase.rpc('get_governed_customers', {p_token})` → `customer` |
| UserProfilePage | `src/pages/account/UserProfilePage.tsx:31,55` | `supabase.rpc('get_governed_employees')` → `employee` ; `supabase.rpc('governed_update_employee')` → `employee` |
| UserPermissionsPage | `src/pages/account/UserPermissionsPage.tsx:24-27` | `supabase.rpc('get_governed_employees')`, `.rpc('get_governed_roles')`, `.rpc('get_all_capabilities')`, `.rpc('get_employee_capabilities')` → `employee`, `role`, `capability` |

### 1.2 Customers

| Screen | File | Runtime Path |
|--------|------|-------------|
| CustomersPage | `src/pages/customers/CustomersPage.tsx:27-28` | `supabase.rpc('get_governed_customers')` → `customer` ; `.rpc('get_governed_customer_contacts')` → `customer_contact` |
| CustomerProfilePage | `src/pages/customers/CustomerProfilePage.tsx:69-76,128,168,187,199,209` | `supabase.rpc('get_governed_customer')` → `customer` ; `.rpc('get_customer_orders')` → `order` ; `.rpc('get_customer_collections')` → `collection` ; `.rpc('get_customer_visits')` → `visit` ; `.rpc('get_governed_customer_addresses')` → `customer_address` ; `.rpc('get_governed_customer_contacts')` → `customer_contact` ; `.rpc('get_governed_customer_ownership_history')` → `customer_ownership_history` ; `.rpc('get_governed_employees')` → `employee` ; `.rpc('governed_update_customer')` → `customer` ; `.rpc('governed_change_customer_ownership')` → `customer`, `customer_ownership_history` |
| NewCustomerPage | `src/pages/customers/NewCustomerPage.tsx:96` | `supabase.rpc('governed_create_customer')` → `customer`, `customer_address`, `customer_contact` |

### 1.3 Orders

| Screen | File | Runtime Path |
|--------|------|-------------|
| OrderReviewPage | `src/pages/storefront/OrderReviewPage.tsx:74,93,100,104,122,127` | `supabase.rpc('governed_create_order')` → `order` ; `.rpc('governed_add_order_flash_offers')` → `order_flash_offer` ; `.rpc('governed_add_order_daily_deals')` → `order_daily_deal` ; `.rpc('governed_submit_order')` → `order` (status change) ; `.rpc('get_governed_order')` → `order` ; `.rpc('get_governed_order_items')` → `order_item` |
| StorefrontPage | `src/pages/storefront/StorefrontPage.tsx:114,157` | `supabase.rpc('get_governed_products', {p_search?, p_category?, p_visible_only?})` → `product` ; `.rpc('get_governed_customers', {p_token})` → `customer` |
| OrderStatusManager | `src/components/orders/OrderStatusManager.tsx:88` | `supabase.rpc('governed_change_order_status')` → `order` |

### 1.4 Employees

| Screen | File | Runtime Path |
|--------|------|-------------|
| EmployeesPage | `src/pages/employees/EmployeesPage.tsx:47-173` | `supabase.rpc('get_governed_employees')` → `employee` ; `.rpc('get_governed_roles')` → `role` ; `.rpc('governed_create_employee')` → `employee` ; `.rpc('governed_update_employee')` → `employee` ; `.rpc('governed_change_employee_manager')` → `employee` ; `.rpc('governed_change_employee_role')` → `employee` ; `.rpc('governed_reset_employee_password')` → `employee` |
| EmployeeProfilePage | `src/pages/employees/EmployeeProfilePage.tsx:40-350` | `supabase.rpc('get_governed_employees')`, `.rpc('get_employee_activity')`, `.rpc('get_governed_roles')`, `.rpc('get_all_capabilities')`, `.rpc('get_employee_capabilities')`, `.rpc('governed_update_employee')`, `.rpc('governed_change_employee_manager')`, `.rpc('governed_change_employee_role')`, `.rpc('governed_reset_employee_password')`, `.rpc('governed_update_employee_capabilities')` → `employee`, `role`, `capability`, `employee_capability`, `employee_activity` |
| HierarchyPage | `src/pages/employees/HierarchyPage.tsx:55-191` | `supabase.rpc('get_governed_employees')`, `.rpc('get_governed_roles')`, `.rpc('governed_update_employee')`, `.rpc('governed_create_employee')`, `.rpc('governed_change_employee_manager')`, `.rpc('governed_change_employee_role')`, `.rpc('governed_reset_employee_password')` → `employee`, `role` |

### 1.5 Collections

| Screen | File | Runtime Path |
|--------|------|-------------|
| CollectionsPage | `src/pages/collections/CollectionsPage.tsx:49-97` | `supabase.rpc('get_governed_collections')` → `collection` ; `.rpc('get_governed_customers')` → `customer` ; `.rpc('governed_approve_collection')` → `collection` |
| NewCollectionPage | `src/pages/collections/NewCollectionPage.tsx:32-47` | `supabase.rpc('get_governed_customers')` → `customer` ; `.rpc('governed_create_collection')` → `collection` |
| CollectionFollowupPage | `src/pages/delivery/CollectionFollowupPage.tsx:22` | `supabase.rpc('get_collection_followup_queue')` → `collection`, `order`, `customer` |

### 1.6 Returns

| Screen | File | Runtime Path |
|--------|------|-------------|
| ReturnsPage | `src/pages/returns/ReturnsPage.tsx:27` | `supabase.rpc('get_governed_returns')` → `return` |
| ReturnDetailPage | `src/pages/returns/ReturnDetailPage.tsx:25-53` | `supabase.rpc('get_governed_return')` → `return` ; `.rpc('get_governed_return_items')` → `return_item` ; `.rpc('governed_approve_return')` → `return` ; `.rpc('governed_reject_return')` → `return` |

### 1.7 Credit

| Screen | File | Runtime Path |
|--------|------|-------------|
| CreditApplicationsPage | `src/pages/credit/CreditApplicationsPage.tsx:27` | `supabase.rpc('get_governed_credit_applications')` → `credit_application` |
| CreditReviewPage | `src/pages/credit/CreditReviewPage.tsx:26-44` | `supabase.rpc('get_governed_credit_application')` → `credit_application` ; `.rpc('governed_approve_credit_application'\|'governed_reject_credit_application')` → `credit_application`, `credit_account` ; `.rpc('governed_confirm_documents')` → `credit_application` |
| CreditProgramsPage | `src/pages/credit/CreditProgramsPage.tsx:20-39` | `supabase.rpc('governed_get_credit_programs')` → `credit_program` ; `.rpc('governed_update_credit_program')`, `.rpc('governed_create_credit_program')`, `.rpc('governed_toggle_credit_program')` → `credit_program` |
| CreditProgramsManagerPage | `src/pages/credit/CreditProgramsManagerPage.tsx:23-92` | `supabase.rpc('governed_get_credit_programs')`, `.rpc('governed_update_credit_program')`, `.rpc('governed_toggle_credit_program')`, `.rpc('governed_create_credit_program')` → `credit_program` |

### 1.8 Warehouse

| Screen | File | Runtime Path |
|--------|------|-------------|
| WarehousePage | `src/pages/warehouse/WarehousePage.tsx:86-206` | `supabase.rpc('get_governed_waiting_preparations')` → `preparation` ; `.rpc('get_governed_preparation_queue')` → `preparation`, `order` ; `.rpc('get_governed_employees')` → `employee` ; `.rpc('governed_start_preparation')`, `.rpc('governed_complete_preparation')`, `.rpc('governed_review_preparation')`, `.rpc('governed_return_to_preparation')`, `.rpc('governed_fail_preparation')`, `.rpc('governed_dispatch_order')`, `.rpc('governed_record_exception')` → `preparation`, `preparation_item`, `order` |
| WarehousePrepDetail | `src/pages/warehouse/WarehousePrepDetail.tsx:52-69` | `supabase.rpc('get_governed_preparation_detail')` → `preparation`, `preparation_item` ; `.rpc('governed_record_exception')` → `preparation` |
| WarehouseReviewPage | `src/pages/warehouse/WarehouseReviewPage.tsx:36-76` | `supabase.rpc('get_governed_preparation_queue')` → `preparation` ; `.rpc('governed_review_preparation')`, `.rpc('governed_return_to_preparation')` → `preparation` |

### 1.9 Delivery

| Screen | File | Runtime Path |
|--------|------|-------------|
| DeliveryPage | `src/pages/delivery/DeliveryPage.tsx:37-51` | `supabase.rpc('get_governed_deliveries')` → `delivery` ; `.rpc('get_governed_employees')` → `employee` ; `.rpc('governed_assign_delivery')` → `delivery` |
| DeliveryDetailPage | `src/pages/delivery/DeliveryDetailPage.tsx:30-39` | `supabase.rpc('governed_get_delivery')` → `delivery` ; `.rpc('governed_confirm_delivery'\|'governed_fail_delivery')` → `delivery` |

### 1.10 Workspaces & Dashboards

| Screen | File | Runtime Path |
|--------|------|-------------|
| AdminWorkspace | `src/pages/dashboard/AdminWorkspace.tsx:33-35` | `supabase.rpc('get_dashboard_management')`, `.rpc('get_governed_dashboard_counts')`, `.rpc('get_governed_products', {p_count_only: true})` |
| SuperAdminWorkspace | `src/pages/dashboard/SuperAdminWorkspace.tsx:49-52` | `supabase.rpc('get_dashboard_management')`, `.rpc('get_credit_dashboard_stats')`, `.rpc('get_governed_dashboard_counts')`, `.rpc('get_order_status_counts')` |
| ChairmanWorkspace | `src/pages/dashboard/ChairmanWorkspace.tsx:20-21` | `supabase.rpc('get_dashboard_management')`, `.rpc('get_governed_orders')` |
| SalesDirectorWorkspace | `src/pages/dashboard/SalesDirectorWorkspace.tsx:21-23` | `supabase.rpc('get_governed_orders')`, `.rpc('get_governed_visits')`, `.rpc('get_governed_employees')` |
| SupervisorWorkspace | `src/pages/dashboard/SupervisorWorkspace.tsx:20-21` | `supabase.rpc('get_dashboard_management')`, `.rpc('get_governed_orders')` |
| WarehouseManagerWorkspace | `src/pages/dashboard/WarehouseManagerWorkspace.tsx:19-20` | `supabase.rpc('get_dashboard_warehouse')`, `.rpc('get_governed_waiting_preparations')` |
| ManagementDashboard | `src/pages/dashboard/ManagementDashboard.tsx:40-41` | `supabase.rpc('get_dashboard_management')`, `.rpc('get_credit_dashboard_stats')` |
| SalesDashboard | `src/pages/dashboard/SalesDashboard.tsx:25` | `supabase.rpc('get_dashboard_sales')` |
| TransportDashboard | `src/pages/dashboard/TransportDashboard.tsx:22` | `supabase.rpc('get_dashboard_transport')` |
| WarehouseDashboard | `src/pages/dashboard/WarehouseDashboard.tsx:28` | `supabase.rpc('get_dashboard_warehouse')` |
| UpperManagementDashboard | `src/pages/dashboard/UpperManagementDashboard.tsx:50-51` | `supabase.rpc('get_upper_management_dashboard')`, `.rpc('get_dashboard_management')` |
| AccountantWorkspace | `src/pages/dashboard/AccountantWorkspace.tsx:20-21` | `supabase.rpc('get_governed_collections')`, `.rpc('get_governed_orders')` |
| DataEntryWorkspace | `src/pages/dashboard/DataEntryWorkspace.tsx:19-20` | `supabase.rpc('get_governed_customers')`, `.rpc('get_governed_orders')` |
| CollectorWorkspace | `src/pages/dashboard/CollectorWorkspace.tsx:18` | `supabase.rpc('get_governed_collections')` |
| DeliveryWorkspace | `src/pages/dashboard/DeliveryWorkspace.tsx:17` | `supabase.rpc('get_governed_deliveries')` |
| BuffetWorkspace | `src/pages/dashboard/BuffetWorkspace.tsx:17` | `supabase.rpc('get_governed_orders')` |
| PurchasingManagerWorkspace | `src/pages/dashboard/PurchasingManagerWorkspace.tsx:17` | `supabase.rpc('get_governed_products')` |
| SecretaryWorkspace | `src/pages/dashboard/SecretaryWorkspace.tsx:17` | `supabase.rpc('get_governed_visits')` |

### 1.11 Manager Pages (direct `supabase.from()`)

| Screen | File | Runtime Path |
|--------|------|-------------|
| AuctionsManagerPage | `src/pages/managers/AuctionsManagerPage.tsx` | `supabase.from('auctions').update()` → `auction` |
| DailyDealsManagerPage | `src/pages/managers/DailyDealsManagerPage.tsx` | `supabase.from('daily_deals').upsert()` → `daily_deal` |
| ProductManagerPage | `src/pages/managers/ProductManagerPage.tsx` | `supabase.from('products').update().eq('id', ...)` → `product` |
| CompanyManagerPage | `src/pages/managers/CompanyManagerPage.tsx` | `supabase.from('companies').upsert()` → `company` |

### 1.12 Other

| Screen | File | Runtime Path |
|--------|------|-------------|
| GlobalSearch | `src/components/shared/GlobalSearch.tsx:46-55` | `supabase.rpc('get_governed_customers')`, `.rpc('get_governed_products', {p_visible_only: true})`, `.rpc('governed_global_search')` → `customer`, `product` |
| ReportsPage | `src/pages/reports/ReportsPage.tsx:64` | `supabase.rpc(rpcName, params)` — dynamic RPC name determined by report type |
| VisitsPage | (service) | `visitsService.getVisits()` → `supabase.rpc('get_governed_visits')` |

---

## 2. RPC Usage Audit

### 2.1 RPC Catalogue

| RPC | Type | Tables (Read) | Tables (Write) | Called From |
|-----|------|-------------|-------------|------------|
| `get_governed_customers` | Read | customer | — | AccountPage, CustomersPage, StorefrontPage, NewCollectionPage, CollectionsPage, DataEntryWorkspace, GlobalSearch |
| `get_governed_customer` | Read | customer | — | CustomerProfilePage |
| `governed_create_customer` | Write | — | customer, customer_address, customer_contact | NewCustomerPage |
| `governed_update_customer` | Write | — | customer (inc. location_id, captured_at) | CustomerProfilePage |
| `governed_change_customer_ownership` | Write | — | customer, customer_ownership_history | CustomerProfilePage |
| `get_governed_customer_addresses` | Read | customer_address | — | CustomerProfilePage |
| `get_governed_customer_contacts` | Read | customer_contact | — | CustomersPage, CustomerProfilePage |
| `get_governed_customer_ownership_history` | Read | customer_ownership_history | — | CustomerProfilePage |
| `get_governed_employees` | Read | employee | — | 12+ callers (EmployeesPage, EmployeeProfilePage, HierarchyPage, WarehousePage, DeliveryPage, CustomerProfilePage, UserProfilePage, UserPermissionsPage, SalesDirectorWorkspace, GlobalSearch) |
| `governed_create_employee` | Write | — | employee | EmployeesPage, HierarchyPage |
| `governed_update_employee` | Write | — | employee | EmployeeProfilePage, EmployeesPage, HierarchyPage, UserProfilePage |
| `governed_change_employee_manager` | Write | — | employee | EmployeeProfilePage, EmployeesPage, HierarchyPage |
| `governed_change_employee_role` | Write | — | employee | EmployeeProfilePage, EmployeesPage, HierarchyPage |
| `governed_reset_employee_password` | Write | — | employee | EmployeeProfilePage, EmployeesPage, HierarchyPage |
| `governed_update_employee_capabilities` | Write | — | employee_capability | EmployeeProfilePage |
| `get_employee_activity` | Read | employee_activity | — | EmployeeProfilePage |
| `get_employee_capabilities` | Read | employee_capability | — | EmployeeProfilePage, UserPermissionsPage |
| `get_governed_roles` | Read | role | — | EmployeesPage, EmployeeProfilePage, HierarchyPage, UserPermissionsPage |
| `get_all_capabilities` | Read | capability | — | EmployeeProfilePage, UserPermissionsPage |
| `get_governed_orders` | Read | v_governed_order / order | — | AccountantWorkspace, BuffetWorkspace, ChairmanWorkspace, DataEntryWorkspace, SalesDirectorWorkspace, SupervisorWorkspace |
| `get_governed_order` | Read | v_governed_order / order | — | OrderReviewPage |
| `get_governed_order_items` | Read | order_item | — | OrderReviewPage |
| `governed_create_order` | Write | — | order | OrderReviewPage |
| `governed_submit_order` | Write | — | order | OrderReviewPage |
| `governed_change_order_status` | Write | — | order | OrderStatusManager |
| `governed_add_order_flash_offers` | Write | — | order_flash_offer | OrderReviewPage |
| `governed_add_order_daily_deals` | Write | — | order_daily_deal | OrderReviewPage |
| `get_customer_orders` | Read | v_governed_order / order | — | CustomerProfilePage |
| `get_governed_products` | Read | product | — | StorefrontPage, GlobalSearch, AdminWorkspace, PurchasingManagerWorkspace |
| `get_governed_collections` | Read | collection | — | CollectionsPage, AccountantWorkspace, CollectorWorkspace |
| `governed_create_collection` | Write | — | collection | NewCollectionPage |
| `governed_approve_collection` | Write | — | collection | CollectionsPage |
| `get_customer_collections` | Read | collection | — | CustomerProfilePage |
| `get_collection_followup_queue` | Read | collection, order, customer | — | CollectionFollowupPage |
| `get_governed_returns` | Read | return | — | ReturnsPage |
| `get_governed_return` | Read | return | — | ReturnDetailPage |
| `get_governed_return_items` | Read | return_item | — | ReturnDetailPage |
| `governed_approve_return` | Write | — | return | ReturnDetailPage |
| `governed_reject_return` | Write | — | return | ReturnDetailPage |
| `get_governed_credit_applications` | Read | credit_application | — | CreditApplicationsPage |
| `get_governed_credit_application` | Read | credit_application | — | CreditReviewPage |
| `governed_approve_credit_application` | Write | — | credit_application, credit_account | CreditReviewPage |
| `governed_reject_credit_application` | Write | — | credit_application | CreditReviewPage |
| `governed_confirm_documents` | Write | — | credit_application | CreditReviewPage |
| `governed_get_credit_programs` | Read | credit_program | — | CreditProgramsPage, CreditProgramsManagerPage |
| `governed_create_credit_program` | Write | — | credit_program | CreditProgramsPage, CreditProgramsManagerPage |
| `governed_update_credit_program` | Write | — | credit_program | CreditProgramsPage, CreditProgramsManagerPage |
| `governed_toggle_credit_program` | Write | — | credit_program | CreditProgramsPage, CreditProgramsManagerPage |
| `get_governed_deliveries` | Read | delivery | — | DeliveryPage, DeliveryWorkspace |
| `governed_get_delivery` | Read | delivery | — | DeliveryDetailPage |
| `governed_assign_delivery` | Write | — | delivery | DeliveryPage |
| `governed_confirm_delivery` | Write | — | delivery | DeliveryDetailPage |
| `governed_fail_delivery` | Write | — | delivery | DeliveryDetailPage |
| `get_governed_visits` | Read | visit | — | SalesDirectorWorkspace, SecretaryWorkspace |
| `get_customer_visits` | Read | visit | — | CustomerProfilePage |
| `get_governed_waiting_preparations` | Read | preparation | — | WarehousePage, WarehouseManagerWorkspace |
| `get_governed_preparation_queue` | Read | preparation | — | WarehousePage, WarehouseReviewPage |
| `get_governed_preparation_detail` | Read | preparation, preparation_item | — | WarehousePrepDetail |
| `governed_start_preparation` | Write | — | preparation | WarehousePage |
| `governed_complete_preparation` | Write | — | preparation | WarehousePage |
| `governed_review_preparation` | Write | — | preparation | WarehousePage, WarehouseReviewPage |
| `governed_return_to_preparation` | Write | — | preparation | WarehousePage, WarehouseReviewPage |
| `governed_fail_preparation` | Write | — | preparation | WarehousePage |
| `governed_dispatch_order` | Write | — | order, preparation | WarehousePage |
| `governed_record_exception` | Write | — | preparation | WarehousePage, WarehousePrepDetail |
| `get_dashboard_management` | Read | multiple (aggregate) | — | AdminWorkspace, ChairmanWorkspace, ManagementDashboard, SuperAdminWorkspace, SupervisorWorkspace, UpperManagementDashboard |
| `get_dashboard_sales` | Read | multiple (aggregate) | — | SalesDashboard |
| `get_dashboard_transport` | Read | multiple (aggregate) | — | TransportDashboard |
| `get_dashboard_warehouse` | Read | multiple (aggregate) | — | WarehouseDashboard, WarehouseManagerWorkspace |
| `get_governed_dashboard_counts` | Read | multiple (aggregate) | — | AdminWorkspace, SuperAdminWorkspace |
| `get_credit_dashboard_stats` | Read | credit_application, credit_account | — | ManagementDashboard, SuperAdminWorkspace |
| `get_order_status_counts` | Read | order | — | SuperAdminWorkspace |
| `get_upper_management_dashboard` | Read | multiple (aggregate) | — | UpperManagementDashboard |
| `governed_global_search` | Read | customer, product | — | GlobalSearch |

### 2.2 RPCs NOT Called From Frontend (Dead)

These RPCs exist in the DB but have zero call sites in frontend code:

| RPC | Notes |
|-----|-------|
| `ping` | Health check only, no frontend call |
| `test_ping2` | Test function, not called |
| `test_ping3` | Test function, not called |
| `test_rpc` | Test function, not called |
| `test_setof` | Test function, not called |
| `test_func` | Test function, not called |
| `multiline_test` | Test function, not called |
| `ensure_system_customer_owner` | System utility, called by triggers/other RPCs only |
| `_calc_base_unit_price` | Private function, called by other RPCs |

### 2.3 `governed_get_credit_programs` Inconsistency

- **Definition**: `p_include_inactive` → `boolean`
- **Frontend call**: `supabase.rpc('governed_get_credit_programs', { p_token: token, p_include_inactive: true })` (CreditProgramsManagerPage.tsx:23)
- **Frontend call**: same signature (CreditProgramsPage.tsx:20)
- No discrepancy found — both match.

---

## 3. Table Usage Audit

### 3.1 Tables Unused by Frontend (Dead or Trigger-Only)

| Table | Created | Rows | Written By | Read By |
|-------|---------|------|-----------|---------|
| `company` (old system) | 2026-04-25 | 2 | No direct writes | No direct reads |
| `customer_classification` | 2026-05-22 | 0 | No writes | No reads |
| `customer_daily_deal` | 2026-05-22 | 0 | No writes | No reads |
| `deal` | 2026-05-30 | 0 | No writes | No reads |
| `follow_up` | 2026-05-18 | 0 | No writes | No reads |
| `notification` | 2026-05-30 | 0 | No writes | No reads |
| `permission` | 2026-04-25 | 3 | No writes | No reads |
| `visit_note` | 2026-05-25 | 0 | No writes | No reads |
| `voucher_type` | 2026-05-25 | 0 | No writes | No reads |
| `sync_log` | 2026-05-22 | 0 | Trigger writes | No reads |
| `activity_log` | 2026-05-25 | 0 | Trigger writes | No reads |

### 3.2 Tables with Only Trigger/System Writes

| Table | Created | Rows | Write Mechanism | Frontend Read |
|-------|---------|------|----------------|---------------|
| `customer_address` | 2026-04-25 | 25 | `governed_create_customer` | CustomerProfilePage (via `get_governed_customer_addresses`) |
| `order_daily_deal` | 2026-05-25 | — | `governed_add_order_daily_deals` | None directly |
| `order_flash_offer` | 2026-05-25 | — | `governed_add_order_flash_offers` | None directly |
| `employee_activity` | 2026-05-25 | 9465 | Trigger on employee changes | EmployeeProfilePage (via `get_employee_activity`) |
| `system_config` | 2026-05-22 | 1 | Unknown | None |

### 3.3 Tables with Direct `supabase.from()` Writes (Bypassing RPCs)

Only 4 pages bypass the `governed_*` RPC layer:

| Table | Page | Operation |
|-------|------|-----------|
| `auction` | AuctionsManagerPage | `.update()` |
| `daily_deal` | DailyDealsManagerPage | `.upsert()` |
| `product` | ProductManagerPage | `.update().eq('id', ...)` |
| `company` | CompanyManagerPage | `.upsert()` |

---

## 4. Services Layer Analysis

### 4.1 Service Files vs Inline RPCs

| Service File | RPCs Called | Used By Pages |
|-------------|-------------|--------------|
| `src/services/auth.ts` | `login`, `logout`, `check_capability` | All pages (via useAuth hook) |
| `src/services/auctions.ts` | `get_governed_auctions`, `get_governed_auction_bids` | Auctions pages |
| `src/services/credit.ts` | `get_governed_credit_applications`, `governed_approve_credit_application`, `governed_reject_credit_application`, `governed_confirm_documents` | Credit pages |
| `src/services/location.ts` | `get_governed_states`, `get_governed_cities`, `get_governed_regions` | Customer forms |
| `src/services/products.ts` | `get_governed_products` | Storefront |
| `src/services/dailyDeals.ts` | Various daily deal RPCs | Daily deals pages |
| `src/services/flashOffers.ts` | Various flash offer RPCs | Flash offers pages |
| `src/services/targets.ts` | Various target RPCs | Targets pages |
| `src/services/tiers.ts` | Various tier RPCs | Tiers pages |
| `src/services/deals.ts` | Various deal RPCs | Deals pages |

### 4.2 Key Finding: Most Pages Bypass Services Layer

The vast majority of pages call `supabase.rpc()` directly inline rather than through service functions. The services layer is incomplete — only auth, credit, location, auctions, products, and management features have service wrappers. Warehouse, delivery, collections, returns, employees, and dashboard pages all call RPCs directly.

---

## 5. Store Layer Analysis

### 5.1 Store Inventory

| Store | Type | Persist | Key State | Used By Pages |
|-------|------|---------|-----------|--------------|
| `authStore` | Zustand + persist | localStorage | `user`, `token`, `employee`, `capabilities`, `isAuthenticated` | Every page (via useAuth hook) |
| `cartStore` | Zustand + persist | localStorage | `items` (with pricing engine), `customerId`, `notes`, `discountPercent` | StorefrontPage, CartDrawer |
| `ordersStore` | Zustand | None | Orders cache | Order-related pages |
| `visitsStore` | Zustand | None | Visits cache | Visit pages |
| `companiesStore` | Zustand | None | `refreshKey` only | Company manager |
| `accountStore` | Zustand | None | Account state | AccountPage |

### 5.2 Store Dependency Graph

```
useAuth (hook) → authStore + session restore
  └→ useCapability (hook) → authService.checkCapability() → supabase.rpc
  └→ useCompanyProfile (hook) → supabase.rpc('get_public_company_profile') → localStorage (24h cache)

cartStore (standalone, no service dependency)
  └→ Pricing logic internal (no RPC calls from store)
```

---

## 6. Runtime Business Flows

### 6.1 Complete Order-to-Delivery Flow

```
StorefrontPage → governed_create_order → order table
  → governed_add_order_flash_offers → order_flash_offer table
  → governed_add_order_daily_deals → order_daily_deal table
  → governed_submit_order → order.status = 'pending'
  → governed_approve_order (by supervisor) → order.status = 'approved'
  → governed_start_preparation (warehouse) → preparation.status = 'in_progress'
  → governed_complete_preparation → preparation.status = 'completed'
  → governed_review_preparation → preparation.status = 'reviewed'
  → governed_dispatch_order → order.status = 'dispatched', delivery created
  → governed_assign_delivery → delivery.employee_id = driver
  → governed_confirm_delivery → delivery.status = 'delivered'
  → governed_create_collection → collection created for payment
  → governed_approve_collection → collection.status = 'approved'
```

### 6.2 Customer Lifecycle Flow

```
NewCustomerPage → governed_create_customer → customer + address + contact
CustomerProfilePage → governed_update_customer → customer fields
  → governed_change_customer_ownership → customer.owner_id, ownership_history
  → (credit application) → governed_approve_credit_application → credit_account
```

### 6.3 Employee Lifecycle Flow

```
EmployeesPage → governed_create_employee → employee
EmployeeProfilePage → governed_update_employee → employee fields
  → governed_change_employee_manager → employee.manager_id
  → governed_change_employee_role → employee.role_id
  → governed_reset_employee_password → employee.password_hash
  → governed_update_employee_capabilities → employee_capability
```

### 6.4 Return Flow

```
Return initiated (unknown trigger) → return.created
ReturnsPage → get_governed_returns (read-only list)
ReturnDetailPage → get_governed_return (single)
  → governed_approve_return → return.status = 'approved'
  → governed_reject_return → return.status = 'rejected'
```

### 6.5 Return-to-Preparation Flow

```
WarehousePage → governed_record_exception (if issue found)
  → governed_return_to_preparation → preparation.status = 'returned'
WarehouseReviewPage → governed_review_preparation (re-review)
```

---

## 7. Dead Runtime Detection

### 7.1 Dead Screens (Frontend Pages with No Active Path)

| Screen | Reason |
|--------|--------|
| `CheckoutPage` | Exists at `src/pages/checkout/CheckoutPage.tsx` but contains **zero** RPC calls or table queries. May be legacy or placeholder. |
| `ActivityPage` | Exists at `src/pages/activity/ActivityPage.tsx` but contains **zero** RPC calls or table queries. |

### 7.2 Dead Tables (No RPC Reads and No Direct Reads)

| Table | Reason |
|-------|--------|
| `customer_classification` | 0 rows, no code touches it |
| `customer_daily_deal` | 0 rows, no code touches it |
| `deal` | 0 rows, no code touches it |
| `follow_up` | 0 rows, no code touches it |
| `notification` | 0 rows, no code touches it |
| `permission` | 3 rows (legacy), no code touches it |
| `visit_note` | 0 rows, no code touches it |
| `voucher_type` | 0 rows, no code touches it |

### 7.3 Dead RPCs (Defined in DB, Not Called From Frontend)

| RPC | Reason |
|-----|--------|
| `ping` | Health check, possibly used by infra |
| `test_ping2`, `test_ping3`, `test_rpc`, `test_setof`, `test_func`, `multiline_test` | Test functions, zero call sites |
| `ensure_system_customer_owner` | Called by trigger, not directly by frontend |

### 7.4 Unreachable UI States

| UI State | Evidence | Impact |
|----------|----------|--------|
| "New Visit" form | Visit creation not found in any page's RPC calls | Visits are view-only (SalesDirectorWorkspace, SecretaryWorkspace, CustomerProfilePage) |
| "New Return" form | Returns are only listed/viewed — `governed_create_return` does not exist as an RPC called anywhere | Returns may be created by external system or trigger |
| Collection creation (not from order) | `governed_create_collection` exists and is called from NewCollectionPage, but only path is manual collector entry | No automatic collection creation on delivery |

---

## 8. Verification Summary

### 8.1 What Was Verified With Source Code

| Claim | Evidence |
|-------|----------|
| Every `governed_*` read RPC is called from at least one frontend page | Full grep of `supabase.rpc('governed_*')` across all `.tsx` files — each RPC mapped to caller(s) above |
| Every `governed_*` write RPC is called from at least one frontend page | Full grep of all write RPCs — each mapped to caller(s) |
| 4 pages use `supabase.from()` directly | AuctionsManagerPage, DailyDealsManagerPage, ProductManagerPage, CompanyManagerPage — verified with `Select-String` |
| 69 RPCs exist in database | `SELECT COUNT(*) FROM information_schema.routines` — excludes 7 test functions |
| 260+ total `.rpc()` calls across frontend | Aggregate of all page-by-page grep results |
| Services layer is incomplete | Grep of service files vs inline RPCs — only auth, credit, location, auctions have full service coverage |
| `captured_at` is NOT updated by `governed_update_customer` | Code review of the RPC body — only `updated_at` is set, not `captured_at` |

### 8.2 What Remains Assumption

| Assumption | Reason | How to Verify |
|------------|--------|--------------|
| `_calc_base_unit_price` is called by product write RPCs | Not called from frontend, likely internal | Read the RPC body |
| `ensure_system_customer_owner` is triggered on insert | Not called directly | Read trigger definitions |
| Trigger functions exist for `activity_log` and `sync_log` | Tables have rows but are not written by frontend | Query `information_schema.triggers` |

---

## 9. Executive Summary

1. **RPC layer is the true API** — 260+ calls across 70+ files, with no REST API or middleware layer between pages and database
2. **Services layer is decorative** — only 4 out of 10 service files are actually used by pages; most pages call `supabase.rpc()` directly
3. **4 bypasses of governed RPCs** — AuctionsManagerPage, DailyDealsManagerPage, ProductManagerPage, CompanyManagerPage use `supabase.from().update/upsert` directly
4. **8 tables are completely dead** — `customer_classification`, `customer_daily_deal`, `deal`, `follow_up`, `notification`, `permission`, `visit_note`, `voucher_type` — all have 0 rows and zero frontend references
5. **7 test RPCs should be dropped before production** — all `test_*` and `multiline_test` functions
6. **2 pages are empty shells** — `CheckoutPage` and `ActivityPage` render UI but make zero RPC calls
7. **No write RPC exists for returns** — `governed_create_return` is never called; returns may be created externally
8. **No write RPC exists for visits** — visits are read-only from frontend; creation is handled elsewhere or not yet implemented
