# 04 — Frontend Data Map

> Complete mapping of every screen/page to its route, guards, RPCs, tables, and key fields.

---

## Authentication & Registration

### LoginPage
- **File:** `src/pages/auth/LoginPage.tsx`
- **Route:** `/login`
- **Guards:** none
- **RPCs:** `login`
- **Tables:** (RPC — no direct table access)
- **Fields:** phone, password, token, identity_type, employee.id, employee.full_name, employee.code, customer.id, customer.company_name, customer.code, roles[], expires_at

### RegistrationPage
- **File:** `src/pages/auth/RegistrationPage.tsx`
- **Route:** `/register`
- **Guards:** none
- **RPCs:** `register_customer`
- **Tables:** (RPC — no direct table access)
- **Fields:** phone, password, companyName, responsibleName, businessType, latitude, longitude, accuracyMeters, formattedAddress, email

---

## Dashboard Module

### DashboardPage
- **File:** `src/pages/dashboard/DashboardPage.tsx`
- **Route:** `/dashboard`
- **Guards:** employeeOnly
- **RPCs:** none (role-based router only)
- **Tables:** none
- **Fields:** (dispatches to role-specific workspace based on user.roles)

### ManagementDashboard
- **File:** `src/pages/dashboard/ManagementDashboard.tsx`
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly
- **RPCs:** `get_governed_target_performance` (inferred), `get_governed_company_monthly_target` (inferred)
- **Tables:** company_monthly_targets, employees, orders, customers (through RPCs)
- **Fields:** sales_target, visits_target, orders_target, new_customers_target, actual_sales, actual_visits, actual_orders, actual_new_customers, performance_percent

### SalesDashboard
- **File:** `src/pages/dashboard/SalesDashboard.tsx`
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly
- **RPCs:** targetService methods (inferred)
- **Tables:** company_monthly_targets, employee_monthly_targets, employees
- **Fields:** target values, actual values, KPI percentages

### UpperManagementDashboard
- **File:** `src/pages/dashboard/UpperManagementDashboard.tsx`
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly (superadmin, chairman, executive, sales_director, sales_manager)
- **RPCs:** targetService, employeeService (inferred)
- **Tables:** employees, employee_roles, roles, company_monthly_targets
- **Fields:** employee performance, role-based metrics, aggregate KPIs

### AdminWorkspace / SuperAdminWorkspace / ChairmanWorkspace
- **Files:** `src/pages/dashboard/AdminWorkspace.tsx`, `SuperAdminWorkspace.tsx`, `ChairmanWorkspace.tsx`
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly (role-specific)
- **RPCs:** various governed RPCs (inferred)
- **Tables:** employees, companies, orders, customers
- **Fields:** system-wide metrics, employee management links

### SalesDirectorWorkspace
- **File:** `src/pages/dashboard/SalesDirectorWorkspace.tsx`
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly
- **RPCs:** targetService (inferred)
- **Tables:** employee_monthly_targets, company_monthly_targets, employees
- **Fields:** team member performance, KPI breakdown

### WarehouseDashboard
- **File:** `src/pages/dashboard/WarehouseDashboard.tsx`
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly (warehouse role)
- **RPCs:** `get_governed_preparation_queue`, `get_governed_waiting_preparations` (inferred)
- **Tables:** order_preparations, orders
- **Fields:** preparation counts, pending/completed statuses

### WarehouseManagerWorkspace
- **File:** `src/pages/dashboard/WarehouseManagerWorkspace.tsx`
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly
- **RPCs:** `get_governed_preparation_queue` (inferred)
- **Tables:** order_preparations, orders
- **Fields:** preparation overview, team assignments

### TransportDashboard / DeliveryWorkspace
- **Files:** `src/pages/dashboard/TransportDashboard.tsx`, `DeliveryWorkspace.tsx`
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly
- **RPCs:** `get_governed_deliveries` (inferred)
- **Tables:** deliveries, delivery_assignments
- **Fields:** delivery status counts, assigned/out_for_delivery/delivered

### AccountantWorkspace
- **File:** `src/pages/dashboard/AccountantWorkspace.tsx`
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly
- **RPCs:** creditService.getDashboard (inferred)
- **Tables:** credit_accounts, credit_invoices
- **Fields:** payment summaries, outstanding amounts

### CollectorWorkspace
- **File:** `src/pages/dashboard/CollectorWorkspace.tsx`
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly
- **RPCs:** collection-related RPCs (inferred)
- **Tables:** collections
- **Fields:** collection targets, pending collections

### PurchasingManagerWorkspace
- **File:** `src/pages/dashboard/PurchasingManagerWorkspace.tsx`
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly
- **RPCs:** product/inventory RPCs (inferred)
- **Tables:** products, inventory, companies
- **Fields:** product counts, inventory status

### SecretaryWorkspace / SecurityWorkspace / BuffetWorkspace / DataEntryWorkspace
- **Files:** respective workspace files
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly (role-specific)
- **RPCs:** role-specific (inferred)
- **Tables:** varies by role
- **Fields:** role-specific dashboards

### SalesRepWorkDay
- **File:** `src/pages/sales-rep/SalesRepWorkDay.tsx`
- **Route:** (child of DashboardPage)
- **Guards:** employeeOnly
- **RPCs:** `get_governed_visits`, `get_governed_customers` (inferred)
- **Tables:** visits, customers
- **Fields:** daily visit schedule, customer list, check-in actions

### PerformanceAnalysisPage
- **File:** `src/pages/dashboard/PerformanceAnalysisPage.tsx`
- **Route:** `/dashboard/performance`
- **Guards:** employeeOnly
- **RPCs:** `get_governed_target_performance`, `get_kpi_contributors`, `get_team_members_kpis`
- **Tables:** company_monthly_targets, employee_monthly_targets, employees, orders
- **Fields:** KPI type, month, year, employee_id, contribution values, team performance

### CompanyTargetsPage
- **File:** `src/pages/dashboard/CompanyTargetsPage.tsx`
- **Route:** `/dashboard/company-targets`
- **Guards:** employeeOnly
- **RPCs:** `get_governed_company_monthly_target`, `governed_upsert_company_monthly_target`
- **Tables:** company_monthly_targets
- **Fields:** target_month, target_year, sales_target, visits_target, orders_target, new_customers_target, sales_weight_percent, visits_weight_percent, orders_weight_percent, new_customers_weight_percent

### EmployeeTargetsPage
- **File:** `src/pages/dashboard/EmployeeTargetsPage.tsx`
- **Route:** `/dashboard/employee-targets`
- **Guards:** employeeOnly
- **RPCs:** `get_governed_employee_monthly_targets`, `governed_upsert_employee_monthly_target`, `getAllActiveEmployees`
- **Tables:** employee_monthly_targets, employees, employee_roles, roles
- **Fields:** employee_id, target_month, target_year, sales_target, visits_target, orders_target, new_customers_target, employee_name, employee_code, role_type

### EmployeeAnalysisPage
- **File:** `src/pages/dashboard/EmployeeAnalysisPage.tsx`
- **Route:** `/dashboard/employee-analysis`
- **Guards:** employeeOnly
- **RPCs:** `get_rep_customer_kpis`, `get_customer_delivered_orders`
- **Tables:** employees, orders, customers
- **Fields:** employee_id, customer_id, KPI data, delivered order history

### ModuleLauncherPage
- **File:** `src/pages/dashboard/ModuleLauncherPage.tsx`
- **Route:** `/launcher/:module`
- **Guards:** employeeOnly
- **RPCs:** none (static navigation)
- **Tables:** none
- **Fields:** (launches sub-modules based on route param)

### SubLauncherPage
- **File:** `src/pages/dashboard/SubLauncherPage.tsx`
- **Route:** (child)
- **Guards:** employeeOnly
- **RPCs:** none (static navigation)
- **Tables:** none
- **Fields:** sub-module navigation

---

## Customers Module

### CustomersPage
- **File:** `src/pages/customers/CustomersPage.tsx`
- **Route:** `/customers`
- **Guards:** authenticated
- **RPCs:** `get_governed_customers`, `get_governed_customer_contacts`, `get_governed_locations`
- **Tables:** customers, customer_contacts, unified_locations
- **Fields:** customers.id, customers.company_name, customers.code, customers.location_id, customers.owner_id, customers.created_by, customer_contacts.customer_id, customer_contacts.phone, customer_contacts.is_primary, unified_locations.formatted_address, unified_locations.latitude, unified_locations.longitude, unified_locations.accuracy_meters

### NewCustomerPage
- **File:** `src/pages/customers/NewCustomerPage.tsx`
- **Route:** `/customers/new`
- **Guards:** customers.create
- **RPCs:** `register_customer`, `governed_create_location`
- **Tables:** customers, unified_locations
- **Fields:** company_name, phone, password, responsible_name, business_type, latitude, longitude, accuracy_meters, formatted_address, contact_name, contact_phone

### CustomerProfilePage
- **File:** `src/pages/customers/CustomerProfilePage.tsx`
- **Route:** `/customers/:id`
- **Guards:** authenticated
- **RPCs:** `get_governed_customer`, `get_customer_orders`, `get_customer_collections`, `get_customer_visits`, `get_governed_customer_addresses`, `get_governed_customer_contacts`, `get_governed_customer_ownership_history`, `get_governed_employees`, `governed_update_customer`, `governed_activate_customer`, `governed_deactivate_customer`, `governed_change_customer_ownership`
- **Tables:** customers, orders, collections, visits, customer_addresses, customer_contacts, customer_ownership_history, employees, unified_locations
- **Fields:** customers.id, customers.company_name, customers.code, customers.responsible_name, customers.business_type, customers.phone, customers.email, customers.owner_name, customers.credit_limit, customers.credit_days, customers.is_active, customers.created_at, customers.location_id, customer_contacts.full_name, customer_contacts.phone, unified_locations.formatted_address, unified_locations.latitude, unified_locations.longitude, unified_locations.accuracy_meters, unified_locations.captured_at

### CustomerAnalyticsPage
- **File:** `src/pages/analytics/CustomerAnalyticsPage.tsx`
- **Route:** `/customers/:id/analytics`
- **Guards:** employeeOnly
- **RPCs:** `get_customer_delivered_orders`, targetService methods (inferred)
- **Tables:** orders, customers
- **Fields:** monthly sales, order history, KPI contributions

### AnalyticsListPage
- **File:** `src/pages/analytics/AnalyticsListPage.tsx`
- **Route:** `/analytics/customers`
- **Guards:** employeeOnly
- **RPCs:** `get_governed_customers`, targetService methods (inferred)
- **Tables:** customers, orders
- **Fields:** customer list with aggregated analytics

---

## Orders Module

### OrdersPage
- **File:** `src/pages/orders/OrdersPage.tsx`
- **Route:** `/orders`
- **Guards:** authenticated
- **RPCs:** `get_governed_orders`, `get_governed_customers`, `get_governed_employees`
- **Tables:** orders, customers, employees
- **Fields:** orders.id, orders.order_number, orders.customer_id, orders.customer_name, orders.status, orders.total_amount, orders.created_at, orders.created_by, orders.owner_id, customers.company_name, employees.full_name

### OrderNewPage
- **File:** `src/pages/orders/OrderNewPage.tsx`
- **Route:** `/orders/new`
- **Guards:** employeeOnly
- **RPCs:** `get_governed_customers`, `get_governed_customer`, `get_governed_companies`, `get_governed_products`, `governed_create_order`, `governed_submit_order`, `get_governed_order`, `get_governed_order_items`, `get_governed_visits`, `governed_update_visit`
- **Tables:** customers, companies, products, product_units, orders, order_items, visits
- **Fields:** customers.id, customers.company_name, customers.code, companies.id, companies.company_name, companies.logo_url, products.id, products.product_name, products.legacy_code, products.carton_price, products.carton_quantity, products.image_url, products.company_id, product_units.id, product_units.unit_type, product_units.is_active

### OrderDetailPage
- **File:** `src/pages/orders/OrderDetailPage.tsx`
- **Route:** `/orders/:id`
- **Guards:** authenticated
- **RPCs:** `get_governed_order`, `get_governed_order_items`, `get_governed_order_history`
- **Tables:** orders, order_items, order_history, products, companies (joined through RPC)
- **Fields:** orders.id, orders.order_number, orders.customer_name, orders.status, orders.total_amount, orders.created_at, orders.notes, order_items.product_name, order_items.legacy_code, order_items.image_url, order_items.company_name, order_items.unit_type, order_items.unit_quantity, order_items.unit_price, order_items.total_price, order_history.status, order_history.changed_by, order_history.changed_at, order_history.notes

### OrderEditPage
- **File:** `src/pages/orders/OrderEditPage.tsx`
- **Route:** `/orders/:id/edit`
- **Guards:** orders.update
- **RPCs:** `get_governed_order`, `get_governed_order_items`, `get_governed_products`, `governed_update_order` (inferred)
- **Tables:** orders, order_items, products
- **Fields:** order detail, editable items

### ApprovalQueuePage
- **File:** `src/pages/orders/ApprovalQueuePage.tsx`
- **Route:** `/orders/approval-queue`
- **Guards:** orders.approve
- **RPCs:** `get_governed_orders` (with status filter), status transition RPCs (inferred)
- **Tables:** orders
- **Fields:** orders.id, orders.order_number, orders.customer_name, orders.status, orders.total_amount, orders.created_at

---

## Storefront Module

### CompaniesPage (Storefront)
- **File:** `src/pages/storefront/CompaniesPage.tsx`
- **Route:** `/storefront`
- **Guards:** none (public) / authenticated
- **RPCs:** none (direct table query)
- **Tables:** companies
- **Fields:** companies.id, companies.company_name, companies.logo_url, companies.is_active

### StorefrontPage
- **File:** `src/pages/storefront/StorefrontPage.tsx`
- **Route:** `/storefront/products`
- **Guards:** none (public) / authenticated
- **RPCs:** `get_governed_products` (authenticated) OR direct `products` query (unauthenticated)
- **Tables:** products, product_units, companies, tiers, customers
- **Fields:** products.id, products.product_name, products.legacy_code, products.carton_price, products.carton_quantity, products.is_active, products.is_visible, products.image_url, products.company_id, product_units.unit_type, product_units.is_active, companies.company_name, tiers.id, tiers.name, tiers.discount_percent, tiers.minimum_order_amount, tiers.icon_url, tiers.color, tiers.sort_order, tiers.is_active, tiers.is_visible, tiers.starts_at, tiers.ends_at

### CartPage
- **File:** `src/pages/storefront/CartPage.tsx`
- **Route:** `/cart`
- **Guards:** authenticated
- **RPCs:** none (uses Zustand store with persist)
- **Tables:** none (cart is in-memory/localStorage)
- **Fields:** (from store) items, dealItems, flashOfferItems, tiers, selectedTierId, totals

### OrderReviewPage
- **File:** `src/pages/storefront/OrderReviewPage.tsx`
- **Route:** `/order-review`
- **Guards:** authenticated
- **RPCs:** `governed_create_order` (inferred), pricing engine
- **Tables:** orders (through RPC)
- **Fields:** review of cart items, totals, tier discounts

### CheckoutPage
- **File:** `src/pages/checkout/CheckoutPage.tsx`
- **Route:** `/checkout`
- **Guards:** authenticated
- **RPCs:** `governed_submit_order`, credit reservation RPCs (inferred)
- **Tables:** orders (through RPC)
- **Fields:** order submission, credit check, payment method

### OrderSuccessPage
- **File:** `src/pages/checkout/OrderSuccessPage.tsx`
- **Route:** `/order-success`
- **Guards:** authenticated
- **RPCs:** `get_governed_order` (inferred)
- **Tables:** orders
- **Fields:** order confirmation details, WhatsApp sharing

---

## Visits Module

### VisitsPage
- **File:** `src/pages/visits/VisitsPage.tsx`
- **Route:** `/visits`
- **Guards:** visits.create
- **RPCs:** `get_governed_visits`, `get_governed_customers`, `get_governed_employees`, `governed_checkin_visit`
- **Tables:** visits, customers, employees, unified_locations
- **Fields:** visits.id, visits.customer_id, visits.customer_name, visits.code, visits.status, visits.check_in_at, visits.notes, visits.employee_id, customers.company_name, employees.full_name

### VisitScreen
- **File:** `src/pages/visits/VisitScreen.tsx`
- **Route:** `/visits/screen`
- **Guards:** visits.create
- **RPCs:** check-in/check-out RPCs (inferred)
- **Tables:** visits, customers
- **Fields:** active visit management UI

### NewVisitPage
- **File:** `src/pages/visits/NewVisitPage.tsx`
- **Route:** `/visits/new`
- **Guards:** visits.create
- **RPCs:** none (creates local store entry, check-in via `governed_checkin_visit` on next step)
- **Tables:** none (local Zustand store)
- **Fields:** customerName, customerPhone (local input)

### VisitDetailPage
- **File:** `src/pages/visits/VisitDetailPage.tsx`
- **Route:** `/visits/:id`
- **Guards:** visits.create
- **RPCs:** `get_governed_visit`, `get_governed_employee`, `get_governed_customer`, `governed_checkout_visit`, `governed_update_visit`
- **Tables:** visits, employees, customers, unified_locations
- **Fields:** visits.id, visits.customer_id, visits.status, visits.check_in_at, visits.check_out_at, visits.check_in_latitude, visits.check_in_longitude, visits.check_out_latitude, visits.check_out_longitude, visits.result, visits.notes, visits.timeline, employees.full_name, customers.company_name

---

## Collections Module

### CollectionsPage
- **File:** `src/pages/collections/CollectionsPage.tsx`
- **Route:** `/collections`
- **Guards:** collections.read
- **RPCs:** `get_governed_collections` (inferred)
- **Tables:** collections
- **Fields:** collections.id, collections.code, collections.customer_name, collections.amount, collections.method, collections.status, collections.collected_at, collections.reference_number

### NewCollectionPage
- **File:** `src/pages/collections/NewCollectionPage.tsx`
- **Route:** `/collections/new`
- **Guards:** collections.create
- **RPCs:** `governed_create_collection` (inferred)
- **Tables:** collections
- **Fields:** customer_id, amount, method, reference_number, notes

### CollectionFollowupPage
- **File:** `src/pages/delivery/CollectionFollowupPage.tsx`
- **Route:** `/collections/followup`
- **Guards:** collections.read
- **RPCs:** collection-related RPCs (inferred)
- **Tables:** collections, customers
- **Fields:** follow-up status, overdue items

---

## Returns Module

### ReturnsPage
- **File:** `src/pages/returns/ReturnsPage.tsx`
- **Route:** `/returns`
- **Guards:** returns.read
- **RPCs:** `get_governed_returns` (inferred)
- **Tables:** returns
- **Fields:** returns.id, returns.code, returns.customer_name, returns.status, returns.amount, returns.created_at

### ReturnDetailPage
- **File:** `src/pages/returns/ReturnDetailPage.tsx`
- **Route:** `/returns/:id`
- **Guards:** returns.read
- **RPCs:** `get_governed_return`, `get_governed_return_items` (inferred)
- **Tables:** returns, return_items
- **Fields:** return detail, items, status

---

## Products Module

### ProductsPage
- **File:** `src/pages/products/ProductsPage.tsx`
- **Route:** `/products`
- **Guards:** employeeOnly
- **RPCs:** `get_governed_products`
- **Tables:** products, product_units, companies, inventory
- **Fields:** products.id, products.product_name, products.legacy_code, products.carton_price, products.carton_quantity, products.is_active, products.image_url, products.company_id, companies.company_name, product_units.unit_type, product_units.is_active, inventory.quantity

### ProductProfilePage
- **File:** `src/pages/products/ProductProfilePage.tsx`
- **Route:** `/products/:id`
- **Guards:** employeeOnly
- **RPCs:** `get_governed_products`, product detail (inferred)
- **Tables:** products, product_units, companies, inventory
- **Fields:** full product detail, unit types, inventory, company

### ProductManagerPage
- **File:** `src/pages/products/ProductManagerPage.tsx`
- **Route:** `/products/manage`
- **Guards:** employeeOnly
- **RPCs:** `get_governed_products`, `governed_create_product` (inferred), `governed_update_product` (inferred)
- **Tables:** products, product_units, companies
- **Fields:** product CRUD, activation toggling

---

## Daily Deals, Flash Offers, Auctions

### DailyDealsPage
- **File:** `src/pages/daily-deals/DailyDealsPage.tsx`
- **Route:** `/daily-deals`
- **Guards:** authenticated
- **RPCs:** `get_governed_active_daily_deals`, `get_governed_daily_deals`
- **Tables:** daily_deals, daily_deal_items
- **Fields:** daily_deals.id, daily_deals.title, daily_deals.image_url, daily_deals.description, daily_deals.fixed_price, daily_deals.available_quantity, daily_deals.original_quantity, daily_deals.starts_at, daily_deals.ends_at, daily_deals.status, daily_deals.is_purchasable, daily_deal_items.product_id, daily_deal_items.product_name, daily_deal_items.quantity

### DailyDealDetailPage
- **File:** `src/pages/daily-deals/DailyDealDetailPage.tsx`
- **Route:** `/daily-deals/:id`
- **Guards:** authenticated
- **RPCs:** `get_governed_daily_deals` (with filter), `governed_create_daily_deal` (inferred)
- **Tables:** daily_deals, daily_deal_items
- **Fields:** full deal detail with items

### DailyDealsManagementPage
- **File:** `src/pages/daily-deals/DailyDealsManagementPage.tsx`
- **Route:** `/daily-deals/manage`
- **Guards:** deals.manage
- **RPCs:** `governed_create_daily_deal`, `governed_update_daily_deal`, `governed_activate_daily_deal`, `governed_cancel_daily_deal`
- **Tables:** daily_deals, daily_deal_items
- **Fields:** CRUD for daily deals, activation/cancellation

### FlashOffersPage
- **File:** `src/pages/flash-offers/FlashOffersPage.tsx`
- **Route:** `/flash-offers`
- **Guards:** authenticated
- **RPCs:** `get_governed_active_flash_offers`, `get_governed_flash_offers`
- **Tables:** flash_offers, flash_offer_items
- **Fields:** flash_offers.id, flash_offers.title, flash_offers.image_url, flash_offers.description, flash_offers.fixed_price, flash_offers.available_quantity, flash_offers.original_quantity, flash_offers.starts_at, flash_offers.ends_at, flash_offers.status, flash_offers.is_purchasable, flash_offer_items.product_id, flash_offer_items.product_name, flash_offer_items.quantity

### FlashOfferDetailPage
- **File:** `src/pages/flash-offers/FlashOfferDetailPage.tsx`
- **Route:** `/flash-offers/:id`
- **Guards:** authenticated
- **RPCs:** `get_governed_flash_offers` (with filter) (inferred)
- **Tables:** flash_offers, flash_offer_items
- **Fields:** full offer detail with items

### FlashOffersManagementPage
- **File:** `src/pages/flash-offers/FlashOffersManagementPage.tsx`
- **Route:** `/flash-offers/manage`
- **Guards:** flash_offers.manage
- **RPCs:** `governed_create_flash_offer`, `governed_update_flash_offer`, `governed_activate_flash_offer`, `governed_cancel_flash_offer`
- **Tables:** flash_offers, flash_offer_items
- **Fields:** CRUD for flash offers, activation/cancellation

### AuctionsPage
- **File:** `src/pages/auctions/AuctionsPage.tsx`
- **Route:** `/auctions`
- **Guards:** authenticated
- **RPCs:** `get_governed_auctions`
- **Tables:** auctions, auction_items
- **Fields:** auctions.id, auctions.code, auctions.title, auctions.description, auctions.image_url, auctions.starting_price, auctions.current_price, auctions.bid_increment, auctions.deposit_amount, auctions.start_time, auctions.end_time, auctions.status, auctions.winner_id, auctions.winner_amount, auctions.participant_count, auctions.bid_count, auction_items.product_id, auction_items.product_name, auction_items.quantity

### AuctionDetailPage
- **File:** `src/pages/auctions/AuctionDetailPage.tsx`
- **Route:** `/auctions/:id`
- **Guards:** authenticated
- **RPCs:** `get_governed_auction_detail`, `governed_request_auction_participation`, `governed_place_bid`; Real-time: `auction_bids`, `auction_activity`, `auction_participants`
- **Tables:** auctions, auction_items, auction_bids, auction_activity, auction_participants
- **Fields:** full auction detail, bids (id, participant_id, participant_name, amount, is_winning, placed_at), activity (id, activity_type, actor_name, message, metadata, created_at), participant_status

### AuctionsManagerPage
- **File:** `src/pages/auctions/AuctionsManagerPage.tsx`
- **Route:** `/auctions/manage`
- **Guards:** auctions.manage
- **RPCs:** `governed_create_auction` (inferred)
- **Tables:** auctions, auction_items
- **Fields:** auction CRUD, item management

---

## Tiers Module

### TierSystemPage
- **File:** `src/pages/tiers/TierSystemPage.tsx`
- **Route:** `/tiers`
- **Guards:** authenticated
- **RPCs:** `get_governed_tiers`
- **Tables:** tiers, tier_company_exceptions, tier_product_exceptions
- **Fields:** tiers.id, tiers.name, tiers.description, tiers.discount_percent, tiers.minimum_order_amount, tiers.icon_url, tiers.color, tiers.sort_order, tiers.is_active, tiers.is_visible, tiers.starts_at, tiers.ends_at, tier_company_exceptions.company_name, tier_company_exceptions.discount_percent, tier_product_exceptions.product_name, tier_product_exceptions.discount_percent

### TiersManagerPage
- **File:** `src/pages/tiers/TiersManagerPage.tsx`
- **Route:** `/tiers/manage`
- **Guards:** tiers.manage
- **RPCs:** `governed_create_tier`, `governed_update_tier`, `governed_set_tier_company_exception`, `governed_remove_tier_company_exception`
- **Tables:** tiers, tier_company_exceptions, tier_product_exceptions
- **Fields:** tier CRUD, exception management (company-level, product-level)

---

## Credit Module

### CustomerCreditPage
- **File:** `src/pages/credit/CustomerCreditPage.tsx`
- **Route:** `/credit`
- **Guards:** authenticated
- **RPCs:** `get_governed_customer_credit_account`, `get_governed_credit_invoices`
- **Tables:** credit_accounts, credit_invoices
- **Fields:** credit_account.id, credit_account.customer_id, credit_account.program_id, credit_account.credit_limit, credit_account.available_credit, credit_account.outstanding_balance, credit_account.status, credit_invoices.id, credit_invoices.invoice_number, credit_invoices.amount, credit_invoices.due_date, credit_invoices.status

### CreditManagementPage
- **File:** `src/pages/credit/CreditManagementPage.tsx`
- **Route:** `/credit/manage`
- **Guards:** credit.manage
- **RPCs:** `get_governed_credit_dashboard`, `governed_activate_credit_account`, `governed_suspend_credit_account`, `governed_reactivate_credit_account`, `governed_auto_suspend_overdue_accounts`
- **Tables:** credit_accounts, customers
- **Fields:** customer credit accounts, activation/suspension, dashboard stats

### CreditProgramsPage
- **File:** `src/pages/credit/CreditProgramsPage.tsx`
- **Route:** `/credit/programs`
- **Guards:** credit.manage
- **RPCs:** `governed_get_credit_programs`
- **Tables:** credit_programs
- **Fields:** credit_programs.id, credit_programs.name, credit_programs.credit_limit, credit_programs.credit_days, credit_programs.terms, credit_programs.is_active

### CreditProgramsManagerPage
- **File:** `src/pages/credit/CreditProgramsManagerPage.tsx`
- **Route:** `/credit/programs/manage`
- **Guards:** credit.program.manage
- **RPCs:** `governed_create_credit_program`, `governed_toggle_credit_program`
- **Tables:** credit_programs
- **Fields:** program CRUD, activation toggling

### CreditApplicationsPage
- **File:** `src/pages/credit/CreditApplicationsPage.tsx`
- **Route:** `/credit/applications`
- **Guards:** credit.view
- **RPCs:** `get_governed_credit_applications`
- **Tables:** credit_applications
- **Fields:** credit_applications.id, credit_applications.customer_name, credit_applications.program_name, credit_applications.status, credit_applications.created_at

### CreditReviewPage
- **File:** `src/pages/credit/CreditReviewPage.tsx`
- **Route:** `/credit/applications/:id`
- **Guards:** credit.review
- **RPCs:** credit application detail/review RPCs (inferred)
- **Tables:** credit_applications, customers, credit_programs
- **Fields:** application detail, customer info, program info, review actions

---

## Warehouse Module

### WarehousePage
- **File:** `src/pages/warehouse/WarehousePage.tsx`
- **Route:** `/warehouse`
- **Guards:** warehouse.prepare
- **RPCs:** `get_governed_waiting_preparations`, `get_governed_preparation_queue`, `get_governed_employees`, `governed_start_preparation`, `governed_complete_preparation`, `governed_review_preparation`, `governed_return_to_preparation`, `governed_fail_preparation`, `governed_dispatch_order`, `governed_record_exception`
- **Tables:** order_preparations, orders, employees
- **Fields:** order_preparations.id, order_preparations.order_id, order_preparations.order_code, order_preparations.customer_name, order_preparations.status, order_preparations.started_by, order_preparations.started_at, order_preparations.completed_by, order_preparations.completed_at, order_preparations.reviewed_by, order_preparations.reviewed_at, order_preparations.notes, orders.code, orders.customer_name, orders.total_amount, orders.created_at

### WarehouseReviewPage
- **File:** `src/pages/warehouse/WarehouseReviewPage.tsx`
- **Route:** `/warehouse/review`
- **Guards:** warehouse.prepare
- **RPCs:** `get_governed_preparation_queue` (inferred), `governed_review_preparation` (inferred)
- **Tables:** order_preparations, orders
- **Fields:** review queue management, approval/rejection

### WarehousePrepDetail
- **File:** `src/pages/warehouse/WarehousePrepDetail.tsx`
- **Route:** `/warehouse/prep/:id`
- **Guards:** warehouse.prepare
- **RPCs:** preparation detail RPC (inferred), `governed_record_exception` (inferred)
- **Tables:** order_preparations, order_preparation_items
- **Fields:** preparation detail, item-level status, exception recording

---

## Delivery Module

### DeliveryPage
- **File:** `src/pages/delivery/DeliveryPage.tsx`
- **Route:** `/delivery`
- **Guards:** delivery.dispatch
- **RPCs:** `get_governed_deliveries`, `get_governed_employees`, `governed_assign_delivery`
- **Tables:** deliveries, delivery_assignments, employees, orders
- **Fields:** deliveries.id, deliveries.order_id, deliveries.order_number, deliveries.customer_name, deliveries.status, deliveries.assigned_to_name, deliveries.assigned_at, deliveries.started_at, deliveries.completed_at, deliveries.failure_reason, deliveries.notes, deliveries.total_amount

### DeliveryDetailPage
- **File:** `src/pages/delivery/DeliveryDetailPage.tsx`
- **Route:** `/delivery/:id`
- **Guards:** delivery.deliver
- **RPCs:** delivery detail RPCs, `governed_start_delivery`, `governed_complete_delivery`, `governed_fail_delivery` (inferred)
- **Tables:** deliveries, delivery_assignments, orders
- **Fields:** full delivery management, status transitions

---

## Employees & Hierarchy

### EmployeesPage
- **File:** `src/pages/employees/EmployeesPage.tsx`
- **Route:** `/employees`
- **Guards:** employees.manage
- **RPCs:** `get_governed_employees` (inferred)
- **Tables:** employees, employee_roles, roles
- **Fields:** employees.id, employees.code, employees.full_name, employees.is_active, employees.manager_id, employee_roles.role_id, roles.name

### EmployeeProfilePage
- **File:** `src/pages/employees/EmployeeProfilePage.tsx`
- **Route:** `/employees/:id`
- **Guards:** employeeOnly
- **RPCs:** employee detail RPCs (inferred)
- **Tables:** employees, employee_roles, roles
- **Fields:** full employee profile, roles, manager info

### HierarchyPage
- **File:** `src/pages/employees/HierarchyPage.tsx`
- **Route:** `/hierarchy`
- **Guards:** employees.manage
- **RPCs:** `get_governed_employees` (inferred)
- **Tables:** employees
- **Fields:** employees.id, employees.code, employees.full_name, employees.manager_id (tree structure)

---

## Companies (Management)

### MgmtCompaniesPage
- **File:** `src/pages/companies/CompaniesPage.tsx` (admin version)
- **Route:** `/companies`
- **Guards:** authenticated
- **RPCs:** `get_governed_companies` (inferred)
- **Tables:** companies
- **Fields:** companies.id, companies.company_name, companies.logo_url, companies.is_active

### CompanyProfilePage
- **File:** `src/pages/companies/CompanyProfilePage.tsx`
- **Route:** `/companies/:id`
- **Guards:** authenticated
- **RPCs:** `get_governed_companies` (inferred), company detail (inferred)
- **Tables:** companies, products (related)
- **Fields:** full company profile with products

### CompanyManagerPage
- **File:** `src/pages/companies/CompanyManagerPage.tsx`
- **Route:** `/companies/manage`
- **Guards:** employeeOnly
- **RPCs:** company CRUD RPCs (inferred)
- **Tables:** companies
- **Fields:** company CRUD, activation toggling

---

## Reports & Activity

### ReportsPage
- **File:** `src/pages/reports/ReportsPage.tsx`
- **Route:** `/reports`
- **Guards:** employeeOnly
- **RPCs:** various reporting RPCs (inferred)
- **Tables:** orders, customers, collections, visits
- **Fields:** aggregated report data

### ActivityPage
- **File:** `src/pages/activity/ActivityPage.tsx`
- **Route:** `/activity`
- **Guards:** employeeOnly
- **RPCs:** `get_governed_activities` (inferred)
- **Tables:** activity_log
- **Fields:** activity entries with timestamps and actors

---

## Settings & Account

### SettingsCompanyProfilePage
- **File:** `src/pages/settings/CompanyProfilePage.tsx`
- **Route:** `/settings/company`
- **Guards:** employeeOnly
- **RPCs:** company profile RPCs (inferred)
- **Tables:** companies
- **Fields:** company settings, profile editing

### AccountPage
- **File:** `src/pages/account/AccountPage.tsx`
- **Route:** `/account`
- **Guards:** authenticated
- **RPCs:** `get_governed_customer` (inferred, for customer users), store account.getCustomerAccount
- **Tables:** customers (via RPC)
- **Fields:** customer account info, orders link, profile link

### UserProfilePage
- **File:** `src/pages/account/UserProfilePage.tsx`
- **Route:** `/account/profile`
- **Guards:** employeeOnly
- **RPCs:** employee detail RPCs (inferred)
- **Tables:** employees
- **Fields:** employee profile editing

### UserPermissionsPage
- **File:** `src/pages/account/UserPermissionsPage.tsx`
- **Route:** `/account/permissions`
- **Guards:** employeeOnly
- **RPCs:** `check_capability` (inferred), role query RPCs (inferred)
- **Tables:** employee_roles, roles, capabilities
- **Fields:** current permissions/capabilities display

---

## Deals Module

### DealsPage
- **File:** `src/pages/deals/DealsPage.tsx`
- **Route:** `/deals`
- **Guards:** employeeOnly
- **RPCs:** deals wrapper over DailyDeals service (inferred)
- **Tables:** daily_deals
- **Fields:** deal management interface

---

## Supervisor Module

### SupervisorPage
- **File:** `src/pages/supervisor/SupervisorPage.tsx`
- **Route:** `/supervisor`
- **Guards:** employeeOnly
- **RPCs:** team-related RPCs (inferred)
- **Tables:** employees, visits, orders
- **Fields:** team monitoring, visit oversight
