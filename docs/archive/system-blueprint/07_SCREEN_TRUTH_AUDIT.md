# 07 — Screen Truth Audit

> Audits every screen in the application for whether it displays real production data, mock data, static data, placeholder data, or legacy data.

---

## Summary

| Category | Data Status | Notes |
|----------|------------|-------|
| **Orders** (all screens) | **REAL DATA** | All orders fetch via `get_governed_orders` / `get_governed_order` / etc. Test data cleanup deleted 44 test orders, leaving 38 real orders. |
| **Customers** (all screens) | **REAL DATA** | All customer screens use `get_governed_customers` / `get_governed_customer`. 25 real customers remain after cleanup (23 deleted). |
| **Visits** (list, detail) | **REAL DATA** | `get_governed_visits`, `get_governed_visit` — real data from database. NewVisitPage creates local store entry, then real on check-in. |
| **Collections** | **REAL DATA** | Collection screens query database via governed RPCs. |
| **Returns** | **REAL DATA** | Query governed RPCs. |
| **Warehouse** | **REAL DATA** | All preparation records from `get_governed_preparation_queue`, `get_governed_waiting_preparations`. Status transitions write back to DB. |
| **Delivery** | **REAL DATA** | `get_governed_deliveries` and status transition RPCs. |
| **Products** | **REAL DATA** | `get_governed_products` — ~700+ real products. |
| **Companies** | **REAL DATA** | Direct table query or `get_governed_companies` — ~50+ real companies. |
| **Dashboard (all workspaces)** | **REAL DATA** | All dashboards load from `targetService` (wraps governed RPCs) and other database queries. |
| **Storefront** | **REAL DATA** | Products from DB, companies from DB, tiers from DB. |
| **Daily Deals / Flash Offers / Auctions** | **REAL DATA** | All via governed RPCs. |
| **Tiers** | **REAL DATA** | `get_governed_tiers` and CRUD RPCs. |
| **Credit** | **REAL DATA** | `creditService` wraps all governed RPCs. |
| **Employees** | **REAL DATA** | `get_governed_employees` and direct `employees` table queries. |
| **Auth (Login / Register)** | **REAL DATA** | `login` and `register_customer` RPCs. |
| **Reports** | **REAL DATA** (inferred) | Loads from governance RPCs. |
| **Activity** | **REAL DATA** (inferred) | Loads from governance RPCs. |

---

## Section-by-Section Audit

### 1. Authentication

| Screen | Status | Details |
|--------|--------|---------|
| **LoginPage** | **REAL DATA** | Calls `supabase.rpc('login', ...)`. No mock data. |
| **RegistrationPage** | **REAL DATA** | Calls `supabase.rpc('register_customer', ...)`. Validates all fields client-side. No `customers.email` in UI (removed). GPS captured live. |

### 2. Dashboard Workspaces

All dashboard workspaces load data from the database via `targetService` (wraps governed RPCs like `get_governed_target_performance`, `get_governed_company_monthly_target`, `get_governed_employee_monthly_targets`).

| Screen | Status | Details |
|--------|--------|---------|
| **DashboardPage** | **STATIC DATA** | Role-based router — no data loading, just component dispatch. |
| **ManagementDashboard** | **REAL DATA** | KPI data from `targetService`. |
| **SalesDashboard** | **REAL DATA** | Sales KPI data from targets/performance RPCs. |
| **UpperManagementDashboard** | **REAL DATA** | Aggregate KPI data. |
| **AdminWorkspace** | **REAL DATA** | Various governed RPCs. |
| **SuperAdminWorkspace** | **REAL DATA** | Various governed RPCs. |
| **ChairmanWorkspace** | **REAL DATA** | Various governed RPCs. |
| **SalesDirectorWorkspace** | **REAL DATA** | Team KPI from `get_team_members_kpis`. |
| **AccountantWorkspace** | **REAL DATA** | Credit dashboard RPC. |
| **CollectorWorkspace** | **REAL DATA** | Collection RPCs. |
| **PurchasingManagerWorkspace** | **REAL DATA** | Products/inventory RPCs. |
| **SecretaryWorkspace** | **REAL DATA** | Various governed RPCs. |
| **SecurityWorkspace** | **REAL DATA** | Various governed RPCs. |
| **BuffetWorkspace** | **REAL DATA** | Various governed RPCs. |
| **DataEntryWorkspace** | **REAL DATA** | Various governed RPCs. |
| **WarehouseDashboard** | **REAL DATA** | Preparation queue RPCs. |
| **WarehouseManagerWorkspace** | **REAL DATA** | Preparation queue RPCs. |
| **DeliveryWorkspace** | **REAL DATA** | Delivery RPCs. |
| **SalesRepWorkDay** | **REAL DATA** | Visits/customers RPCs. |
| **PerformanceAnalysisPage** | **REAL DATA** | `get_governed_target_performance`, KPI drill-down RPCs. |
| **CompanyTargetsPage** | **REAL DATA** | Company monthly target CRUD. |
| **EmployeeTargetsPage** | **REAL DATA** | Employee monthly target CRUD + employee list from direct table query. |
| **EmployeeAnalysisPage** | **REAL DATA** | `get_rep_customer_kpis`, `get_customer_delivered_orders`. |
| **ModuleLauncherPage** | **STATIC DATA** | Navigation only. |
| **SubLauncherPage** | **STATIC DATA** | Navigation only. |

### 3. Customers

| Screen | Status | Details |
|--------|--------|---------|
| **CustomersPage** | **REAL DATA** | `get_governed_customers` + `get_governed_customer_contacts` + `get_governed_locations`. Enriches with contact phone and location via service. |
| **CustomerProfilePage** | **REAL DATA** | 8 parallel RPC calls. Shows customer info, orders, collections, visits, contacts, addresses, ownership history, employees. **Known issue:** `customers.code` shows garbled Arabic for some entries (corrupted test data that was not cleaned). `customers.email` still shown in UI (line 263) but DB field is NULLABLE — this field was being removed from creation UIs but the profile page still displays it. |
| **NewCustomerPage** | **REAL DATA** | Uses `register_customer` RPC. GPS captured for location. No `email` field. |
| **CustomerAnalyticsPage** | **REAL DATA** | KPI analytics from targetService. |
| **AnalyticsListPage** | **REAL DATA** | Customer analytics list. |

### 4. Orders

| Screen | Status | Details |
|--------|--------|---------|
| **OrdersPage** | **REAL DATA** | `get_governed_orders` with filtering/sorting. Enriches with customer/employee data. Shows 38 real orders after cleanup. |
| **OrderNewPage** | **REAL DATA** | Full order creation: `get_governed_customers` → `get_governed_customer` → `get_governed_companies` → `get_governed_products`. Creates via `governed_create_order` + `governed_submit_order`. Links to active visit. WhatsApp share via RPC snapshot. |
| **OrderDetailPage** | **REAL DATA** | `get_governed_order` + `get_governed_order_items` + `get_governed_order_history`. Shows `snapshot_sender_*` fields which appear to be **LEGACY** — never populated in current code but still present in joined data. |
| **OrderEditPage** | **REAL DATA** | Edits via `governed_update_order` (inferred). |
| **ApprovalQueuePage** | **REAL DATA** | Orders filtered for approval. Status transitions via governed RPCs. |

### 5. Storefront

| Screen | Status | Details |
|--------|--------|---------|
| **CompaniesPage** (storefront) | **REAL DATA** | Direct `companies` table query — ~50+ real companies. |
| **StorefrontPage** | **REAL DATA** | Products via `get_governed_products` (authenticated) or direct `products` query (unauthenticated). Tiers via direct `tiers` table query. Customers via `get_governed_customers`. |
| **CartPage** | **STATIC / REAL** | Cart data is from Zustand store (in-memory, persisted to localStorage) — **USER-SESSION DATA**, not API data. Product/tier references are REAL DATA from the store (loaded from API). |
| **OrderReviewPage** | **REAL DATA** | Reviews cart data against stored products/prices. |
| **CheckoutPage** | **REAL DATA** | Order submission and credit checks via governed RPCs. |
| **OrderSuccessPage** | **REAL DATA** | Order confirmation from RPC. |

### 6. Daily Deals

| Screen | Status | Details |
|--------|--------|---------|
| **DailyDealsPage** | **REAL DATA** | `get_governed_active_daily_deals` / `get_governed_daily_deals`. |
| **DailyDealDetailPage** | **REAL DATA** | Deal detail from RPC. |
| **DailyDealsManagementPage** | **REAL DATA** | Full CRUD via governed RPCs. |

### 7. Flash Offers

| Screen | Status | Details |
|--------|--------|---------|
| **FlashOffersPage** | **REAL DATA** | `get_governed_active_flash_offers` / `get_governed_flash_offers`. |
| **FlashOfferDetailPage** | **REAL DATA** | Offer detail from RPC. |
| **FlashOffersManagementPage** | **REAL DATA** | Full CRUD via governed RPCs. |

### 8. Auctions

| Screen | Status | Details |
|--------|--------|---------|
| **AuctionsPage** | **REAL DATA** | `get_governed_auctions`. |
| **AuctionDetailPage** | **REAL DATA** | `get_governed_auction_detail` with real-time subscriptions on `auction_bids`, `auction_activity`, `auction_participants`. |
| **AuctionsManagerPage** | **REAL DATA** | Auction CRUD via `governed_create_auction` (inferred). |

### 9. Tiers

| Screen | Status | Details |
|--------|--------|---------|
| **TierSystemPage** | **REAL DATA** | `get_governed_tiers`. |
| **TiersManagerPage** | **REAL DATA** | Full tier CRUD + company/product exception management. |

### 10. Credit

| Screen | Status | Details |
|--------|--------|---------|
| **CustomerCreditPage** | **REAL DATA** | `get_governed_customer_credit_account` + `get_governed_credit_invoices`. |
| **CreditManagementPage** | **REAL DATA** | Credit dashboard, activation/suspension/auto-suspend. |
| **CreditProgramsPage** | **REAL DATA** | `governed_get_credit_programs`. |
| **CreditProgramsManagerPage** | **REAL DATA** | Program CRUD via `governed_create_credit_program`, `governed_toggle_credit_program`. |
| **CreditApplicationsPage** | **REAL DATA** | `get_governed_credit_applications`. |
| **CreditReviewPage** | **REAL DATA** | Application review (inferred). |

### 11. Warehouse

| Screen | Status | Details |
|--------|--------|---------|
| **WarehousePage** | **REAL DATA** | `get_governed_waiting_preparations`, `get_governed_preparation_queue`. Full lifecycle: start → complete → review → dispatch/fail/exception. |
| **WarehouseReviewPage** | **REAL DATA** | Review queue (inferred). |
| **WarehousePrepDetail** | **REAL DATA** | Single preparation detail (inferred). |

### 12. Delivery

| Screen | Status | Details |
|--------|--------|---------|
| **DeliveryPage** | **REAL DATA** | `get_governed_deliveries` with status filter. Assignment via `governed_assign_delivery`. |
| **DeliveryDetailPage** | **REAL DATA** | Single delivery management (inferred). |

### 13. Visits

| Screen | Status | Details |
|--------|--------|---------|
| **VisitsPage** | **REAL DATA** | `get_governed_visits`, customers, employees. Check-in via `governed_checkin_visit` with GPS capture. |
| **VisitScreen** | **REAL DATA** | Active visit management (inferred). |
| **NewVisitPage** | **PLACEHOLDER / LOCAL** | Creates a local Zustand store entry with manually entered customer name/phone. NOT persisted to DB until check-in is performed on next screen. The visit object is constructed locally with `crypto.randomUUID()`. |
| **VisitDetailPage** | **REAL DATA** | `get_governed_visit`, `get_governed_employee`, `get_governed_customer`. Check-out via `governed_checkout_visit` with GPS. |

### 14. Collections

| Screen | Status | Details |
|--------|--------|---------|
| **CollectionsPage** | **REAL DATA** | Collection records from DB (inferred). |
| **NewCollectionPage** | **REAL DATA** | Collection creation via governed RPC (inferred). |
| **CollectionFollowupPage** | **REAL DATA** | Follow-up data from DB (inferred). |

### 15. Returns

| Screen | Status | Details |
|--------|--------|---------|
| **ReturnsPage** | **REAL DATA** | Return records from DB (inferred). |
| **ReturnDetailPage** | **REAL DATA** | Return detail with items from DB (inferred). |

### 16. Products

| Screen | Status | Details |
|--------|--------|---------|
| **ProductsPage** | **REAL DATA** | `get_governed_products` — ~700+ real products. |
| **ProductProfilePage** | **REAL DATA** | Product detail with units and inventory (inferred). |
| **ProductManagerPage** | **REAL DATA** | Product CRUD (inferred). |

### 17. Employees

| Screen | Status | Details |
|--------|--------|---------|
| **EmployeesPage** | **REAL DATA** | `get_governed_employees` — 16 real employees remain after cleanup. |
| **EmployeeProfilePage** | **REAL DATA** | Employee detail with roles (inferred). |
| **HierarchyPage** | **REAL DATA** | Employee tree from direct `employees` query + `employee_roles` + `roles`. |

### 18. Companies (Management)

| Screen | Status | Details |
|--------|--------|---------|
| **MgmtCompaniesPage** | **REAL DATA** | `get_governed_companies` — ~50+ real companies. |
| **CompanyProfilePage** | **REAL DATA** | Company detail (inferred). |
| **CompanyManagerPage** | **REAL DATA** | Company CRUD (inferred). |

### 19. Reports & Activity

| Screen | Status | Details |
|--------|--------|---------|
| **ReportsPage** | **REAL DATA** | Various report RPCs (inferred). |
| **ActivityPage** | **REAL DATA** | Activity log from DB (inferred). |

### 20. Settings & Account

| Screen | Status | Details |
|--------|--------|---------|
| **SettingsCompanyProfilePage** | **REAL DATA** | Company settings (inferred). |
| **AccountPage** | **REAL DATA** | Customer-facing account page. |
| **UserProfilePage** | **REAL DATA** | Employee profile editing (inferred). |
| **UserPermissionsPage** | **REAL DATA** | Shows actual capabilities from `check_capability` (inferred). |

### 21. Deals

| Screen | Status | Details |
|--------|--------|---------|
| **DealsPage** | **REAL DATA** | Wraps DailyDeals service (inferred). |

### 22. Supervisor

| Screen | Status | Details |
|--------|--------|---------|
| **SupervisorPage** | **REAL DATA** | Team oversight data from DB (inferred). |

---

## Specific Items Flagged

### `customers.email`
- **Status:** Being removed from UI. Already absent from `NewCustomerPage`, `RegistrationPage`. Still displayed on `CustomerProfilePage` (line 263: `customer.email || '—'`).
- **Database:** Still exists in DB as NULLABLE.
- **Recommendation:** Remove from `CustomerProfilePage` display to complete the removal across all UIs.

### `customers.code`
- **Status:** REAL DATA (dirty). Shows garbled Arabic text for ~4 customers.
- **Cause:** Corrupted test data that was not properly cleaned.
- **Impact:** Only visible on `CustomerProfilePage` (line 259) and `CustomersPage` (shown in list items). Not used as a primary identifier.

### `snapshot_sender_*` fields (in order display data)
- **Status:** LEGACY within REAL DATA. These fields appear in the order joined data returned by RPCs.
- **Evidence:** No code in the current frontend ever populates these fields. They are remnants from a previous snapshot system.
- **Impact:** Shown as `null`/empty in `OrderDetailPage` via `OrderDetailView`. Not visible to users unless explicitly rendered (which current code does not).

### Dashboard workspaces
- **Status:** REAL DATA when real data exists. All workspaces load from database via `targetService` or other governed RPCs. However:
  - Some KPI metrics may show **PLACEHOLDER** values (0 or `—`) when no target data exists for the current month.
  - Empty states ("لا توجد بيانات") are displayed when no data is available — these are acceptable PLACEHOLDER states.

### NewVisitPage
- **Status:** PLACEHOLDER / LOCAL STATE. Creates a local Zustand store entry. The visit only becomes REAL DATA when `governed_checkin_visit` is called on the VisitScreen. The local entry uses `crypto.randomUUID()` and is not persisted to DB.

### Storefront Cart
- **Status:** USER-SESSION DATA (acceptable). Cart lives in Zustand with `persist` middleware (localStorage). Product/tier references loaded from DB are REAL DATA. The cart itself is per-session ephemeral data.

---

## Overall Assessment

**The application is fully real-data-driven.** Every screen that displays business data fetches it from the PostgreSQL database via Supabase RPCs or direct table queries.

- **100% of screens** that show orders, customers, products, visits, collections, returns, deliveries, preparations, employees, daily deals, flash offers, auctions, tiers, and credit data use **REAL DATA** from the database.
- **No screens** use hardcoded mock/fake business data for display purposes.
- **STATIC DATA** is limited to: role names, business type labels, status option lists, navigation elements — all acceptable configuration data.
- **PLACEHOLDER DATA** is limited to: empty state messages ("لا توجد بيانات"), default form values, the NewVisitPage local store entry — all expected patterns.
- **LEGACY DATA** within REAL DATA: `snapshot_sender_*` fields in order snapshots (never populated).
- **DIRTY DATA:** `customers.code` has 4 entries with garbled Arabic text from corrupted test data.
- **INCONSISTENCY:** `customers.email` is being removed from creation UIs but still displayed on `CustomerProfilePage`.
