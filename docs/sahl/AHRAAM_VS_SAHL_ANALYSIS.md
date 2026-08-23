# AHRAAM vs SAHL Analysis

> **Purpose:** Reference analysis for the JOKER project.
> This document preserves all verified findings from studying the AHRAAM project
> and compares them against the existing SAHL reference to identify what JOKER
> may need.
>
> **This document does NOT imply that JOKER must merge AHRAAM and SAHL.**
> It is a study and comparison reference only.

---

## 1. Executive Summary

### What Was Studied

- **AHRAAM** (D:\Projects\store): A modern, multi-platform distribution and sales force automation system. React/TypeScript frontend, Supabase (PostgreSQL) backend, with Electron desktop, Capacitor mobile, and PWA web. 101 database tables, 1000+ RPC functions, 40+ page directories.

- **SAHL** (C:\SAHL): A traditional, local-only desktop inventory and store management system. Delphi executable, local MySQL 5.7.33, 17 database tables, Excel-based reporting.

### Fundamental Difference

AHRAAM is a **sales force automation and distribution management** system — it optimizes for managing field sales teams, customer relationships, deliveries, and credit collection across a distributed workforce.

SAHL is a **store/warehouse inventory management** system — it optimizes for tracking products, inventory movements, financial transactions, and accounting within a single business location.

### Key Finding

AHRAAM and SAHL cover **almost entirely different business domains** with a small overlap in core product/order concepts. JOKER will need to bridge both worlds if it aims to cover distribution AND store management.

---

## 2. AHRAAM Current System

### 2.1 Identity

| Field | Value |
|-------|-------|
| Name | نظام الأهرام للتوزيع المتكامل (AHRAAM Integrated Distribution System) |
| Package | `ahram-distribution` |
| Version | 0.0.0 (package.json) / Desktop: 1.2.4 |
| Company | Al-Ahram for Trading and Distribution |
| Language | Arabic (RTL) — all UI in Arabic |
| Purpose | Sales force automation, distribution, delivery, credit, warehouse prep |

### 2.2 Technology

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript 6 + Tailwind CSS 4 |
| State | Zustand 5 |
| Routing | React Router DOM 7 (HashRouter) |
| Backend | Supabase (PostgreSQL + PostgREST + Realtime) |
| PWA | vite-plugin-pwa (injectManifest strategy) |
| Mobile | Capacitor 8 (Android + iOS) |
| Desktop | Electron 33 + PostgreSQL 16 (embedded) |
| PDF | jsPDF + jspdf-autotable |
| Maps | Leaflet + react-leaflet |
| Testing | Playwright (e2e) |
| CI/CD | GitHub Actions |

### 2.3 Platforms

| Platform | Status | Offline Support |
|----------|--------|----------------|
| Web/PWA | Active (GitHub Pages) | Asset caching only — all data requires network |
| Mobile (Android/iOS) | Active (Capacitor) | GPS tracking offline queue; data requires network |
| Desktop (Electron) | Active | Full offline: local PostgreSQL 16, sync to cloud |

**Confidence: VERIFIED** — All confirmed from package.json, capacitor.config.ts, desktop source, and CI/CD workflows.

---

## 3. AHRAAM Business Modules

### 3.1 Complete Module List

| # | Module | Database Tables | Description |
|---|--------|----------------|-------------|
| 1 | **Identity & Access** | identities, employees, roles, capabilities, employee_roles, role_capabilities, employee_capabilities, code_sequences, app.sessions | Authentication, RBAC, employee/customer identity |
| 2 | **Companies** | companies, company_profile | Supplier/brand management (what SAHL calls "categories") |
| 3 | **Products** | products, product_units, inventory, inventory_movements | Product catalog with multi-unit pricing and inventory |
| 4 | **Tiers** | tiers, tier_exceptions, tier_company_exceptions, tier_product_exceptions | Customer discount tier system |
| 5 | **Customers** | customers, customer_addresses, customer_contacts, customer_ownership_history, customer_credit_ledger, customer_credit_accounts, unified_locations | CRM with ownership, credit, geolocation |
| 6 | **Orders** | orders, order_items, order_status_history, order_modification_history | Complex multi-step order lifecycle |
| 7 | **Returns** | returns, return_items, return_inspection, return_status_history | Return merchandise authorization |
| 8 | **Collections & Treasury** | collections, treasury_transactions, expenses, employee_advances | Payment collection and expense tracking |
| 9 | **Credit System** | credit_programs, credit_applications, credit_contracts, credit_contract_templates, credit_invoices, credit_invoice_cheques, credit_collection_invoices, credit_collection_requests | Full credit management lifecycle |
| 10 | **Delivery & Journeys** | delivery_tracking, delivery_actions, delivery_journeys, journey_orders, journey_events, external_carriers | Multi-step delivery with journey management |
| 11 | **Visits** | visits | Field visit check-in/out with GPS |
| 12 | **Attendance & Tracking** | workday_settings, workday_sessions, workday_breaks, tracking_points, visit_links, tracking_cleanup_log, tracking_point_skips | GPS-verified attendance and continuous tracking |
| 13 | **Targets & Performance** | company_monthly_targets, employee_monthly_targets, performance_weights_config, employee_weight_overrides | Sales targets and KPI tracking |
| 14 | **Packages** | packages, package_items, package_orders | Bundled product packages |
| 15 | **Auctions** | auctions, auction_items, auction_participants, auction_bids, auction_awards, auction_activity | Real-time bidding system |
| 16 | **Flash Offers** | flash_offers, flash_offer_items, order_flash_offers | Time-limited promotions |
| 17 | **Daily Deals** | daily_deals, daily_deal_items, order_daily_deals | Daily deal promotions |
| 18 | **Preparation** | preparation_records, preparation_exceptions | Warehouse order preparation |
| 19 | **Notifications** | notifications, push_subscriptions | Push + in-app notifications |
| 20 | **Command Center** | system_modules, owner_decisions, owner_requests, module_icon_defaults | System health and governance |
| 21 | **Location & Reference** | location_overrides, reference_governorates, reference_cities, gps_test_points | Geographic reference data |
| 22 | **Employee Management** | employee_work_policies, role_normalization, employee_baselines, employee_entity_views | HR and work policies |
| 23 | **Audit & Logging** | session_recovery_log, attendance_audit_log, deletion_audit_log, order_deletion_inventory_audit, tracking_rebuild_audits | Comprehensive audit trails |

**Confidence: VERIFIED** — All tables and modules confirmed from database migrations.

---

## 4. AHRAAM Data Model

### 4.1 Statistics

| Metric | Count |
|--------|-------|
| Database tables | 101 production tables |
| Custom enum types | 6 |
| Database triggers | 13 |
| RLS-enabled tables | 22 |
| RLS policies | 24 |
| RPC functions | ~1,053 (many superseding earlier versions) |
| Migration files | ~180+ |
| Indexes | ~150+ |

### 4.2 Key Entity Relationships

```
identities ──────> employees (via identity_id)
employees ───────> employees (self-referencing manager_id, hierarchy tree)
employees ───────> roles (via employee_roles)
roles ───────────> capabilities (via role_capabilities)
employees ───────> capabilities (via employee_capabilities, direct grants)

companies ───────> products (one company has many products)
products ────────> product_units (units: piece/dozen/carton)
products ────────> inventory (1:1 stock record)

customers ───────> companies (via company_id)
customers ───────> tiers (via tier_id)
customers ───────> customer_addresses
customers ───────> customer_credit_accounts

orders ──────────> customers
orders ──────────> companies
orders ──────────> order_items ───> products
orders ──────────> order_status_history
orders ──────────> order_modification_history

orders ──────────> delivery_tracking ──> delivery_journeys
orders ──────────> collections ──> treasury_transactions
orders ──────────> credit_collection_invoices

returns ─────────> orders
returns ─────────> return_items ──> products
returns ─────────> return_inspection

visits ──────────> employees, customers
workday_sessions > employees
tracking_points > employees, workday_sessions
```

### 4.3 Dual-Ownership Model

Orders, collections, and returns support `owner_type` field with values `'employee'` or `'customer'`. This means both sales reps placing orders on behalf of customers AND customers placing orders directly through the storefront are supported.

**Confidence: VERIFIED** — Schema CHECK constraints confirm this.

---

## 5. AHRAAM Order/Inventory Behavior

### 5.1 Order Lifecycle

AHRAAM has a sophisticated multi-step order lifecycle with 14 status values:

```
draft → submitted → reviewing → returned_for_revision ↩
      ↘ approving → approved → preparing → prepared → ready_for_dispatch
                    → sent_to_delivery → dispatched → delivered → stock_review
      ↘ cancelled
```

| Status | Description | Confidence |
|--------|-------------|------------|
| `draft` | Initial state when order is created | Verified |
| `submitted` | Sales rep submits for approval | Verified |
| `reviewing` | Manager reviewing | Verified |
| `returned_for_revision` | Sent back to rep for changes | Verified |
| `approving` | In approval process | Verified |
| `approved` | Manager approved | Verified |
| `preparing` | Warehouse preparing | Verified |
| `prepared` | Warehouse finished preparation | Verified |
| `ready_for_dispatch` | Ready for delivery | Verified |
| `sent_to_delivery` | Assigned to delivery | Verified |
| `dispatched` | Out for delivery | Verified |
| `delivered` | Customer received | Verified |
| `stock_review` | Post-delivery stock review | Verified |
| `cancelled` | Cancelled | Verified |

**Key Behaviors:**
- Orders snapshot customer info at creation time (name, phone, address, owner)
- Orders snapshot inventory policies at creation (negative_selling_allowed, inventory_deduction_status)
- Order modification history tracks all field changes
- Status history tracks all transitions with who/when/why

### 5.2 Inventory Behavior

**Inventory Deduction:**
- Inventory is deducted at a **configurable status** (controlled by `app_settings.inventory_deduction_status`)
- `inventory_deducted_at` timestamp records when deduction happened
- `inventory_deducted_items` JSONB records exactly what was deducted

**Inventory Restoration:**
- When an order exits an approved status (cancelled, returned), inventory is automatically restored via database trigger `trg_restore_inventory_before_approved_order_exit`

**Inventory Movements:**
- The `inventory_movements` table logs every stock change with: product_id, order_id, quantity_change, movement_type, reference_id

**Out-of-Stock:**
- Products have `is_out_of_stock` flag
- `oos_source` tracks what set the flag
- `recently_available_at` tracks when stock returns
- Auto out-of-stock trigger (`trg_auto_out_of_stock_inventory`)

**Negative Selling:**
- Configurable at system level (`negative_selling_allowed`)
- Also per-product (`products.negative_selling_allowed`)
- Also per-order snapshot (`orders.order_negative_selling_allowed`)

### 5.3 Pricing Behavior

**Multi-Unit Pricing:**
Each product has three unit types with independent prices:
- `piece_price` — single item price
- `dozen_price` — dozen price
- `carton_price` — carton/box price

**Tier System:**
- Customers belong to tiers (e.g., "wholesale", "VIP")
- Tiers have a default discount percentage
- Tier exceptions can override per-customer, per-company, or per-product
- Exception priority: product exception > company exception > tier default

**Engine:** Pure pricing computation in `src/engine/pricing.ts` — handles unit conversion, tier pricing, exception-aware pricing, and cart totals.

### 5.4 Order Types

| Type | Description |
|------|-------------|
| `cash` | Cash payment order |
| `credit` | Credit/payment-on-delivery order |
| `ittiman` | Installment-based order (uses credit collection system) |

**Confidence: VERIFIED** — All behaviors confirmed from schema, triggers, and service code.

---

## 6. AHRAAM Users & Permissions

### 6.1 Identity Model

Two identity types:
- `employee` — has employee_id, code, full_name, hierarchy
- `customer` — has customer_id, company_name (self-registration supported)

### 6.2 Role-Based Access Control

| Concept | Implementation |
|---------|---------------|
| **Roles** | Named roles (e.g., "sales rep", "warehouse manager") |
| **Capabilities** | Granular permission codes (e.g., `orders.approve`, `customers.create`) |
| **Role-Capability** | Roles contain multiple capabilities |
| **Employee-Role** | Employees assigned to roles |
| **Employee-Capability** | Direct capability grants (bypassing roles) |
| **Upper Management** | Special class with `session_is_upper_management()` — gets unrestricted RLS access |

### 6.3 Known Capability Codes

From routing and UI code:
- `orders.approve`, `orders.create`
- `customers.create`, `customers.read`
- `collections.read`, `collections.create`
- `warehouse.prepare`
- `employees.manage`
- `credit.manage`, `credit.program.manage`, `credit.view`, `credit.review`
- `flash_offers.manage`, `deals.manage`, `tiers.manage`, `auctions.manage`
- `attendance.configure`, `attendance.view_team_map`, `attendance.view_history`, `attendance.live_monitor`

### 6.4 Hierarchy

- Single-root tree enforced by database trigger `trg_enforce_single_root_hierarchy`
- Root employee: code `WRQ1003`
- All employees must have `manager_id` resolving to root
- `hierarchy_path` field stores the tree path

### 6.5 Route Protection

Three access levels in routing:
1. **Public** — storefront, deals, registration
2. **Protected** (any authenticated user) — orders, customers, credit viewing
3. **Employee-only** — dashboard, visits, order operations, HR
4. **Capability-gated** — specific routes require specific capabilities
5. **Upper Management** — executive operations, shipping, data center

**Confidence: VERIFIED** — All confirmed from database schema, routing code, and hooks.

---

## 7. AHRAAM Desktop/Web/PWA Architecture

### 7.1 Platform Comparison

| Aspect | Web/PWA | Mobile (Capacitor) | Desktop (Electron) |
|--------|---------|-------------------|-------------------|
| **Data storage** | Remote Supabase only | Remote + GPS offline queue | Local PostgreSQL 16 + sync |
| **Auth** | Remote RPC | Remote RPC | Local login first, remote fallback |
| **Offline** | Asset caching only | GPS tracking offline | Full offline (all data local) |
| **Database** | Supabase client | Supabase client | Local PG via IPC + PostgREST-compat shim |
| **Printing** | Browser print | Share/print | Native print dialog via IPC |
| **File system** | Download only | Download | Read/write/select via IPC |
| **Updates** | PWA auto-update | App store | Renderer (asset download) + Electron binary + DB migrations |
| **Notifications** | Web Push (FCM) | Capacitor native push | Both |
| **GPS** | Browser Geolocation | Native Capacitor GPS | Browser or native |

### 7.2 Desktop Offline-First Architecture

The desktop has a complete offline-first architecture:

1. PostgreSQL 16 bundled and provisioned on first launch
2. Baseline schema + versioned migrations
3. Initial sync pulls ~40+ tables from Supabase
4. Incremental sync uses delta-based `sync_metadata`
5. **PostgREST-compatible query builder** — same React code works against both remote Supabase and local PostgreSQL
6. Conflict quarantine for sync conflicts
7. Auto-sync on connectivity restore (30-second polling)
8. Automated backups

### 7.3 Desktop Auto-Update (Three Components)

1. **Renderer Update**: Downloads changed assets from GitHub Pages (SHA-256 verified)
2. **App Update**: Electron binary via electron-updater (GitHub Releases)
3. **DB Migration Update**: Downloads new SQL migration files

**Confidence: VERIFIED** — All confirmed from desktop source code, CI/CD workflows, and configuration files.

---

## 8. AHRAAM Synchronization

### 8.1 Sync Architecture

| Component | Mechanism |
|-----------|-----------|
| **Initial Sync** | Pulls ~40+ tables from Supabase REST to local PostgreSQL |
| **Incremental Sync** | Delta-based via `sync_metadata` table |
| **Outbox Pattern** | Offline writes queued, synced on reconnection |
| **Conflict Resolution** | Quarantine in `sync_conflicts` table, reconciliation pass |
| **Parity Gate** | `offline_ready` flag only set after sync completes with zero conflicts |
| **Connectivity Monitor** | Polls Supabase every 30 seconds, triggers auto-sync on restore |

### 8.2 Tables Synced

The initial sync covers: identities, employees, roles, capabilities, companies, products, product_units, inventory, customers, customer_addresses, tiers, orders, order_items, order_status_history, collections, treasury_transactions, expenses, returns, return_items, visits, workday_sessions, tracking_points, credit_programs, credit_invoices, notifications, and many more.

**Confidence: VERIFIED** — Confirmed from `InitialSync.ts` source code.

---

## 9. SAHL Capabilities Relevant to JOKER

Based on the SAHL reference document (D:\joker\SAHL-REFERENCE.md):

### 9.1 What SAHL Covers Well

| Area | SAHL Capability |
|------|----------------|
| **Product Management** | 4 price levels, 6-level categories, multiple units per product, multiple barcodes, expiry tracking, product photos |
| **Multi-Warehouse Inventory** | Per-warehouse stock balances, warehouse transfers, stock counting, inventory adjustments |
| **Complete Financial Accounting** | Cash registers, receipts, payments, expenses, cash transfers, cheque management |
| **Purchasing** | Purchase invoices, purchase returns, supplier accounts, cost tracking |
| **Weighted Average Costing** | Automatic cost recalculation on every purchase |
| **Profit Calculation** | Per-invoice and per-line-item profit tracking |
| **Reporting** | Daily report, sales analysis, purchase analysis, account statements, expense analysis |
| **Printing** | 14+ sales invoice templates, 8+ purchase templates, thermal/A4/A5/dot matrix, barcode labels, Excel-customizable |
| **Granular Permissions** | 80+ individual permission flags per user |
| **Installments** | Invoice splitting into installment plans with payment tracking |
| **E-Invoicing** | ZATCA compliance |
| **Backup** | Auto-backup on exit with encryption |

### 9.2 What SAHL Does NOT Cover

| Missing Area | Notes |
|-------------|-------|
| Field sales management | No visits, attendance, GPS tracking |
| Multi-platform | Desktop only (no web, mobile, PWA) |
| Online/cloud | Local-only (no remote access, no sync) |
| Customer self-service | No storefront, no self-registration |
| Delivery management | No journey management, no driver tracking |
| Credit programs | Basic credit sales only, no formal credit application workflow |
| Sales targets/KPIs | No target tracking, no performance scoring |
| Real-time operations | No live dashboards, no team monitoring |
| Auctions/Promotions | No deals, flash offers, or auction system |

---

## 10. AHRAAM vs SAHL Comparison

### 10.1 AHRAAM Has It (Not in SAHL)

| Capability | AHRAAM Implementation | SAHL |
|-----------|----------------------|------|
| **Multi-platform (Web/PWA/Mobile/Desktop)** | React + Capacitor + Electron | Desktop only |
| **Cloud/sync architecture** | Supabase + offline-first sync | Local MySQL only |
| **Field sales force management** | Visits, GPS tracking, attendance | Not present |
| **GPS-verified attendance** | Workday start/end, breaks, continuous tracking | Not present |
| **Employee hierarchy** | Single-root tree with manager chain | Flat user list |
| **Customer self-registration** | Storefront with registration page | Not present |
| **Customer storefront** | Public product browsing, cart, checkout | Not present |
| **Sales targets & KPIs** | Company/employee monthly targets, performance weights | Not present |
| **Delivery journey management** | Multi-step delivery with driver assignment, journey building | Not present |
| **Real-time operations center** | Live team map, alerts, timeline | Not present |
| **Credit program lifecycle** | Programs, applications, contracts, collection workflow | Basic credit only |
| **Auction system** | Real-time bidding with deposits | Not present |
| **Flash offers / Daily deals** | Time-limited promotions | Not present |
| **Package/bundle deals** | Product bundling | Not present |
| **Customer tiers with exceptions** | Tier + per-customer/company/product overrides | Simple price lists |
| **Dual-ownership model** | Employee and customer can own orders | Single user model |
| **CQRS architecture** | Commands/queries pipeline with validators and policies | Monolithic |
| **Role-based RBAC with capabilities** | Granular capability codes per role | Granular permission flags |
| **Comprehensive audit trails** | Status history, modification history, deletion audit | Basic created/edited fields |
| **Push notifications** | In-app + PWA push + Capacitor native | Sound effects only |
| **Analytics dashboards** | Sales analytics, customer intelligence, performance | Basic reports |
| **Data deletion governance** | 9 entity types with preview/dry-run | Soft delete only |
| **Cross-entity search** | Unified search across all entities | Per-screen search |
| **Excel export engine** | Styled RTL Arabic reports | XLSX templates (manual) |

### 10.2 SAHL Has It (Not in AHRAAM)

| Capability | SAHL Implementation | AHRAAM |
|-----------|-------------------|--------|
| **Supplier management** | Full supplier accounts, supplier invoices, supplier returns | Companies exist but no supplier invoicing |
| **Purchase invoices** | Complete purchase workflow with cost tracking | Not present |
| **Purchase returns** | Full return-to-supplier workflow | Not present |
| **Cash registers / Treasury** | Multiple cashboxes, cash balance, cash movements | Collections only (no cashbox model) |
| **Receipts (from customers)** | Dedicated receipt documents | Collections (similar concept) |
| **Payments (to suppliers)** | Dedicated payment documents | Expenses (simpler) |
| **Expense tracking with categories** | Expense categories, expense analysis | Basic expense table |
| **Customer/Supplier financial accounts** | Unified accounts table with running balances | Credit accounts only |
| **Cheque management** | Cheque number, bank, due date, liquidation | credit_invoice_cheques (limited) |
| **Installment plans** | Invoice splitting into installments with schedule | ittiman order type (different approach) |
| **Cash transfers between registers** | Dedicated cash transfer documents | Not present |
| **Warehouse transfers** | Dedicated transfer documents between warehouses | Not present |
| **Inventory counting/stock-taking** | Dedicated INVENT invoice type | Not present |
| **Inventory adjustments** | Dedicated ADJUST invoice type | inventory_movements (simpler) |
| **Weighted average costing** | Automatic recalculation on every purchase | Not present |
| **Profit calculation** | Per-invoice and per-line profit tracking | Not present (sales = delivered orders) |
| **Purchase reports** | Purchase analysis reports | Not present |
| **Account statements** | Full transaction history per customer/supplier | Not present |
| **Multiple selling price lists** | 4 configurable price levels per product | 3 fixed unit prices |
| **Barcode label printing** | Built-in barcode label design and printing | Not present |
| **Thermal printer support** | 80mm/57mm receipt templates | Not present |
| **E-invoicing (ZATCA)** | Full ZATCA compliance with crypto keys | Not present |
| **Auto-backup with encryption** | Backup on exit with password protection | Desktop has backup (unencrypted?) |
| **6-level product categories** | Configurable category hierarchy | Company-based product grouping |
| **Product expiration tracking** | Expiry date, shelf life, alerts | Not present |
| **Dot matrix printer support** | Templates for dot matrix printers | Not present |
| **Electron-like desktop** | Native Windows desktop app | Electron desktop (cross-platform) |

### 10.3 Both Have It (With Differences)

| Capability | AHRAAM | SAHL | Key Difference |
|-----------|--------|------|----------------|
| **Products** | Products with company, 3 unit types, 3 prices | Products with 6 categories, 4 prices, multiple units | SAHL has more pricing levels and category depth. AHRAAM has company association. |
| **Customers** | Customers with company, tier, credit, addresses, contacts, ownership | Customers in unified accounts table | AHRAAM has richer customer model (ownership, analytics). SAHL has simpler model. |
| **Orders/Sales** | Multi-step order lifecycle (14 statuses) with approval workflow | Single-step invoice with immediate effect | AHRAAM has approval workflow. SAHL is immediate. |
| **Units** | 3 fixed types: piece, dozen, carton | Flexible: unlimited custom units per product | SAHL is more flexible. AHRAAM is standardized. |
| **Inventory** | Single warehouse model (no multi-warehouse) | Multi-warehouse with per-store balances | SAHL supports multiple warehouses. AHRAAM does not. |
| **Returns** | Return merchandise authorization with inspection | Return invoice types (sales return, purchase return) | AHRAAM has inspection workflow. SAHL has simpler returns. |
| **Credit** | Full credit program lifecycle (applications, contracts, collection) | Basic credit sales with due dates | AHRAAM has formal credit programs. SAHL has simple credit terms. |
| **Expenses** | expenses table with category | money table with category1/category2 | Similar concept, different implementation. |
| **Users** | Employees + customers with RBAC capabilities | Users with 80+ granular permission flags | AHRAAM has roles+capabilities. SAHL has flat permissions. |
| **Reporting** | Excel/PDF export, analytics dashboards | XLSX template-based printing, daily reports | AHRAAM has dashboards. SAHL has printable reports. |
| **Notifications** | Push + in-app + real-time | Sound effects only | AHRAAM has modern notification system. |

---

## 11. Missing AHRAAM Capabilities

These are the financial/accounting capabilities that AHRAAM currently lacks compared to SAHL:

### 11.1 Critical Financial Gaps

| Gap | SAHL Has | AHRAAM Status | Impact |
|-----|----------|---------------|--------|
| **Supplier management** | Full supplier accounts with balance tracking | Companies table exists but no supplier invoicing or account tracking | Cannot manage supplier relationships or payments |
| **Purchase invoices** | Complete purchase workflow | Not present | Cannot track what was purchased from suppliers |
| **Purchase returns** | Return-to-supplier workflow | Not present | Cannot manage returns to suppliers |
| **Cash registers/treasury** | Multiple cashboxes with balance tracking | Collections only | Cannot manage multiple payment collection points |
| **Receipts** | Dedicated receipt documents | Collections (similar but different) | Collection model differs from traditional receipts |
| **Payments** | Dedicated payment documents to suppliers | Expenses (simpler) | No formal payment-to-supplier workflow |
| **Cheques** | Full cheque lifecycle (register, track, liquidate) | credit_invoice_cheques (limited to credit invoices) | Cannot manage standalone cheques |
| **Installment plans** | Split any invoice into installments | ittiman order type (order-level) | Different model — AHRAAM ties installments to order type, not arbitrary invoices |
| **Cash transfers** | Transfer between cash registers | Not present | Cannot manage internal cash movements |
| **Warehouse transfers** | Move stock between warehouses | Not present (single warehouse) | Cannot manage multi-location inventory |
| **Inventory counting** | Physical stock-taking | Not present | No formal stock audit process |
| **Inventory adjustments** | Manual adjustment documents | inventory_movements (triggered, not manual) | No manual adjustment UI/process |
| **Weighted average costing** | Automatic cost recalculation | Not present | No cost tracking for products |
| **Profit calculation** | Per-invoice profit with cost tracking | Not present (orders have no cost concept) | Cannot calculate business profitability |
| **Account statements** | Full transaction history per account | Not present | No per-customer financial statement |
| **Supplier reports** | Purchase analysis reports | Not present | No purchasing analytics |
| **Multiple price lists** | 4 configurable levels | 3 fixed unit types | Less flexible pricing |

### 11.2 Printing Gaps

| Gap | SAHL | AHRAAM |
|-----|------|--------|
| **Thermal printer templates** | 80mm/57mm receipt templates | Not present |
| **A4/A5 full-page invoices** | Multiple template variations | PDF export (jsPDF) |
| **Barcode label printing** | Built-in label designer | Not present |
| **Template customization** | Excel-based template editing | Code-based |
| **Dot matrix support** | Dedicated templates | Not present |

### 11.3 Product Management Gaps

| Gap | SAHL | AHRAAM |
|-----|------|--------|
| **6-level categories** | Configurable hierarchy | Company-based grouping only |
| **Product photos** | Photo field on products | image_url on products (present) |
| **Product expiration** | Expiry tracking with alerts | Not present |
| **Multiple barcodes per product** | Multiple barcodes per unit | Not present |
| **Reorder levels** | Reorder quantity alert | min_quantity on inventory (present) |
| **Service items** | Service flag (non-stock) | Not present |

---

## 12. Capabilities Existing in Both

### 12.1 Overlapping Areas (Detailed Differences)

#### Products
- **AHRAAM**: Products belong to a company (supplier brand). Three fixed unit types (piece/dozen/carton) with per-unit prices. Tier-based discounts.
- **SAHL**: Products have flexible custom units. Four configurable price levels. Six-level category hierarchy. Multiple barcodes per unit.
- **Decision for JOKER**: Which pricing model? Which categorization model? How to handle company/brand association?

#### Customers
- **AHRAAM**: Rich customer model with company association, tier, credit limit, addresses with GPS, contacts, ownership history, analytics.
- **SAHL**: Simpler customer in unified accounts table with balance tracking, custom fields, price list assignment.
- **Decision for JOKER**: AHRAAM's customer model is more feature-rich. SAHL's account model is more financially integrated.

#### Orders/Sales
- **AHRAAM**: Complex 14-status lifecycle with approval workflow, preparation, delivery, and journey management. Orders are the central entity.
- **SAHL**: Simple invoice created and immediately affects stock. No approval workflow. Multiple invoice types (sale, purchase, return, transfer, etc.).
- **Decision for JOKER**: AHRAAM's workflow is more appropriate for field sales. SAHL's simplicity is better for counter sales.

#### Inventory
- **AHRAAM**: Single inventory per product (no multi-warehouse). Deduction is configurable and happens at a specific order status. Restoration on cancellation.
- **SAHL**: Multi-warehouse with per-store balances. Immediate stock effect on invoice save.
- **Decision for JOKER**: Multi-warehouse support is likely needed. The deduction timing model is sophisticated in AHRAAM.

#### Users/Permissions
- **AHRAAM**: Role-based with capability codes. Upper management bypass. Employee hierarchy.
- **SAHL**: Flat permission flags (80+ per user). No role abstraction. No hierarchy.
- **Decision for JOKER**: AHRAAM's RBAC is more maintainable at scale. SAHL's flat model is simpler for small teams.

#### Credit
- **AHRAAM**: Formal credit programs with applications, contracts, document verification, collection workflows, auto-suspension.
- **SAHL**: Simple credit terms with due dates and balance tracking.
- **Decision for JOKER**: Depends on business need. AHRAAM's model is for formal B2B credit. SAHL's is for informal credit terms.

#### Reporting
- **AHRAAM**: Excel/PDF export with styled Arabic headers. Analytics dashboards. Real-time operations center.
- **SAHL**: XLSX template-based printing with thermal/A4/A5 support. Barcode labels. Daily reports.
- **Decision for JOKER**: Both approaches have value. Screen dashboards vs. printable reports serve different needs.

---

## 13. Important Architectural/Business Differences

### 13.1 Business Domain

| Aspect | AHRAAM | SAHL |
|--------|--------|------|
| **Primary domain** | Distribution / sales force automation | Store / warehouse management |
| **User base** | Field sales reps, managers, delivery staff, collectors | Store clerks, managers, accountants |
| **Transaction model** | Orders → approval → preparation → delivery | Invoices (immediate effect) |
| **Customer interaction** | Indirect (sales rep places order for customer) | Direct (customer at counter) |
| **Financial model** | Collections (payment follow-up) | Cash registers (immediate payment) |
| **Inventory model** | Single warehouse, field distribution | Multi-warehouse, store-based |

### 13.2 Technical Architecture

| Aspect | AHRAAM | SAHL |
|--------|--------|------|
| **Architecture** | Modern (React, TypeScript, CQRS, Hexagonal) | Traditional (Delphi monolith) |
| **Backend** | Supabase (cloud PostgreSQL) | Local MySQL |
| **Offline** | Desktop: full offline-first. Web: asset cache | Fully offline (local-only) |
| **Multi-platform** | Web, PWA, Android, iOS, Desktop | Windows desktop only |
| **Database** | 101 tables, ~1053 RPCs | 17 tables |
| **Deployment** | GitHub Pages + GitHub Releases | Installer (InnoSetup) |
| **Updates** | Auto-update (3-component system) | Self-update from internet |
| **Data model complexity** | Very high (complex relationships, triggers, RLS) | Moderate (simpler relationships) |

### 13.3 Data Flow Philosophy

- **AHRAAM**: Data lives in the cloud. Desktop caches locally for offline. Single source of truth is Supabase.
- **SAHL**: Data lives locally on the machine. No cloud. Each installation is independent.
- **JOKER Decision**: Cloud-first (like AHRAAM) or local-first (like SAHL) or hybrid?

### 13.4 Currency and Localization

- **AHRAAM**: Arabic-only UI, designed for Egyptian market
- **SAHL**: Arabic/English bilingual, supports multiple currencies, designed for Arab world (Egypt + Saudi Arabia)
- **JOKER Decision**: Which markets? Which languages? Which currencies?

---

## 14. Unknowns / Items Requiring Later Decision

### 14.1 AHRAAM Items Not Fully Verified

| Item | Status | Notes |
|------|--------|-------|
| Actual UI screens/workflow | Inferred from code | Not run in browser |
| Real-time bidding behavior | Schema exists | Actual WebSocket behavior not tested |
| Desktop offline sync conflicts | Architecture exists | Conflict resolution details not fully traced |
| GPS tracking accuracy in field | Architecture exists | Not tested in real conditions |
| Push notification delivery reliability | Implementation exists | Not tested end-to-end |
| Performance with large datasets | Not tested | 101 tables, ~1053 RPCs — scale unknown |
| Customer storefront checkout flow | Pages exist | Actual UX not tested |

### 14.2 JOKER Design Decisions (Not Part of This Task)

These are questions that JOKER will need to answer later:

| Decision Area | Options |
|--------------|---------|
| **Primary business domain** | Distribution (AHRAAM-like) + Store (SAHL-like) + Both? |
| **Deployment model** | Cloud-first? Local-first? Hybrid? |
| **Multi-platform** | Web only? PWA? Desktop? Mobile? All? |
| **Database** | PostgreSQL (Supabase)? MySQL? SQLite? Multiple? |
| **Offline strategy** | AHRAAM's desktop sync model? SAHL's local-only? Something new? |
| **Financial model** | SAHL's cash register model? AHRAAM's collection model? Both? |
| **Pricing model** | SAHL's 4 price lists? AHRAAM's tier system? Both? |
| **Order workflow** | AHRAAM's approval workflow? SAHL's immediate invoice? Configurable? |
| **Multi-warehouse** | SAHL's model? AHRAAM's single warehouse? |
| **Reporting** | Printable templates (SAHL)? Screen dashboards (AHRAAM)? Both? |
| **Supplier management** | SAHL's model? Something new? |
| **Costing** | SAHL's weighted average? AHRAAM's no-cost model? Something else? |
| **Permissions** | AHRAAM's RBAC? SAHL's flat flags? Both? |
| **Language** | Arabic only? Bilingual? Multi-language? |
| **Currency** | Single? Multi-currency? |

---

## 15. Recommended JOKER Scope — INFORMATION ONLY

> **This section is NOT an implementation plan.**
> It identifies what the future JOKER system may need based on the evidence.

### 15.1 From AHRAAM (Likely Worth Keeping)

- Multi-platform architecture (Web/PWA/Mobile/Desktop)
- Offline-first desktop with local database + sync
- Modern tech stack (React, TypeScript, PostgreSQL)
- RBAC with capability codes
- Customer management with ownership, addresses, analytics
- Order lifecycle with approval workflow
- Field sales management (visits, attendance, GPS)
- Delivery/journey management
- Credit program management
- Real-time notifications
- Analytics dashboards
- CQRS architecture for maintainability
- Excel/PDF export engine

### 15.2 From SAHL (Likely Worth Adding to JOKER)

- Supplier management and accounts
- Purchase invoices and purchase returns
- Cash register / treasury management
- Receipts and payments (financial documents)
- Expense tracking with categories
- Customer/supplier financial accounts with statements
- Cheque management
- Installment plans
- Warehouse transfers (multi-warehouse)
- Inventory counting (stock-taking)
- Inventory adjustments
- Weighted average costing
- Profit calculation
- Multiple selling price lists (4+)
- Barcode label printing
- Thermal printer support
- E-invoicing (ZATCA)
- Account statements
- Product expiration tracking
- Product categories (multi-level)

### 15.3 New Capabilities (Not in Either)

- Web-based counter/POS mode (for store staff)
- Combined field + store workflow
- Multi-currency support
- Advanced financial reporting (balance sheet, P&L)
- Tax reporting (VAT returns)
- Budget management
- Purchase order workflow (beyond simple purchase invoices)
- Serial number / batch tracking
- Expiry-based automatic markdowns
- Customer loyalty programs
- Supplier performance scoring
- Cross-platform inventory synchronization

---

> **End of AHRAAM vs SAHL Analysis**
>
> This document preserves the verified study findings for use during
> JOKER planning. It should be updated as additional investigation is performed.
