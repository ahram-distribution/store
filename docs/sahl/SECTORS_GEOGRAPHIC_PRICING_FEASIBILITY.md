# SECTORS, GOVERNORATES & GEOGRAPHIC PRICING — FEASIBILITY STUDY

**Date:** 2026-08-25
**Status:** READ-ONLY ARCHITECTURAL FEASIBILITY STUDY — NO IMPLEMENTATION
**Author:** Architectural Analysis (Automated Codebase Inspection)
**Owner Decisions:** FINALIZED 2026-08-25 — See Section 21

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture](#2-current-architecture)
3. [Customer Geography Findings](#3-customer-geography-findings)
4. [Employee Findings](#4-employee-findings)
5. [Sales Manager Findings](#5-sales-manager-findings)
6. [Current Pricing Architecture](#6-current-pricing-architecture)
7. [Exact Price Calculation Paths](#7-exact-price-calculation-paths)
8. [Proposed Sector Architecture](#8-proposed-sector-architecture)
9. [Proposed Geographic Assignment Architecture](#9-proposed-geographic-assignment-architecture)
10. [Proposed Pricing-Rule Architecture](#10-proposed-pricing-rule-architecture)
11. [Pricing Priority Analysis](#11-pricing-priority-analysis)
12. [Backward Compatibility Analysis](#12-backward-compatibility-analysis)
13. [Impact Matrix](#13-impact-matrix)
14. [Surgical Implementation Plan](#14-surgical-implementation-plan)
15. [Proposed Database Model](#15-proposed-database-model)
16. [Proposed UI](#16-proposed-ui)
17. [Security/Capability Considerations](#17-securitycapability-considerations)
18. [Risks](#18-risks)
19. [Unknowns](#19-unknowns)
20. [Decisions Required from Owner](#20-decisions-required-from-owner)
21. [Owner-Approved Business Rules — 2026-08-25](#21-owner-approved-business-rules--2026-08-25)

---

## 1. EXECUTIVE SUMMARY

### Feasibility Verdict: FEASIBLE — Low Risk, Surgical Implementation

**Owner decisions have been finalized (2026-08-25).** All open business questions are resolved. See [Section 21: OWNER-APPROVED BUSINESS RULES](#21-owner-approved-business-rules--2026-08-25).

The proposed "القطاعات" (Sectors) system can be introduced into AHRAM with **minimal impact** on existing functionality. The system is architecturally well-suited for this extension because:

1. **Governorates are already normalized.** A `reference_governorates` table with 27 Egyptian governorates exists and is actively used by customer addresses. No data migration of governorate text is needed for the core reference data.

2. **No sector concept exists today.** This is a clean-slate addition — no legacy sector code to reconcile with.

3. **Pricing has a single canonical source.** `products.carton_price` is the undisputed source of truth. Geographic pricing can be introduced as an **additive layer** without modifying the base price model.

4. **The tier discount system provides an architectural pattern.** The existing `tier_company_exceptions` / `tier_product_exceptions` pattern demonstrates how geographic adjustments can be modeled as override rules with priority chains.

5. **Employee geographic assignment is a pure addition.** Employees currently have NO territory/region/branch assignment. Adding geographic scope is additive, not disruptive.

### Key Risks
- **Client-side pricing authority** (the latest `governed_create_order` trusts client-submitted prices) means geographic adjustments must be applied CLIENT-SIDE in the pricing engine AND validated SERVER-SIDE for security.
- **Sahl POS allows manual price overrides** — geographic pricing must not interfere with Sahl's independent pricing behavior.
- **The `employees.region` free-text column** exists but is unused in code — it should be repurposed or ignored.

### Estimated Scope
- ~6 new database tables
- ~4 new SQL RPCs
- ~1 new frontend page (القطاعات management)
- ~2 existing pages need minor extensions (Employees, Customers)
- ~1 engine file modification (pricing.ts)
- Zero breaking changes to existing screens

---

## 2. CURRENT ARCHITECTURE

### 2.1 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript 6, Vite 5, TailwindCSS 4, Zustand 5 |
| PWA | vite-plugin-pwa (service worker, manifest with Arabic RTL) |
| Mobile | Capacitor 8 (Android + iOS) |
| Desktop | Electron 33 (offline-first) |
| Database | Supabase-hosted PostgreSQL 15+ |
| Backend Logic | PostgreSQL RPC functions (~329 migration files) |
| Offline DB | Local PostgreSQL via Electron IPC shim |

### 2.2 Architecture Pattern

**Database-as-Backend**: All business logic runs as PostgreSQL RPC functions. There is NO REST/GraphQL API server. The frontend calls Supabase RPCs directly.

**Clean Architecture / DDD**: Domain models, application commands/queries (CQRS), provider contracts, dependency injection.

**Offline-First Desktop**: Local PostgreSQL mirrors cloud DB via `DesktopPostgrestBuilder` shim.

### 2.3 Database Schema Location

- **Cloud migrations**: `D:\Projects\store\supabase\migrations\` (329+ files)
- **Desktop schema dump**: `D:\Projects\store\desktop\main\db\schema.sql` (24,498 lines)
- **Desktop local migrations**: `D:\Projects\store\desktop\main\db\migrations\` (10 versioned SQL files)

### 2.4 Key Tables (Relevant to This Study)

| Table | Purpose |
|-------|---------|
| `identities` | Authentication base (phone, password_hash, identity_type) |
| `employees` | Employee records (code, full_name, manager_id, is_active, region) |
| `roles` | Role definitions (name, is_system) |
| `capabilities` | Permission definitions (code, name, group) |
| `employee_roles` | Employee ↔ Role junction |
| `role_capabilities` | Role ↔ Capability junction |
| `employee_capabilities` | Direct per-employee capability overrides |
| `customers` | Customer records (code, company_name, owner_id, location_id) |
| `customer_addresses` | Customer addresses (governorate_id, city_id, street_address, address_source) |
| `reference_governorates` | 27 Egyptian governorates (code, name_ar, name_en) |
| `reference_cities` | 269 cities (governorate_id FK, code, name_ar, name_en) |
| `products` | Products (carton_price, carton_quantity, piece_price, dozen_price) |
| `tiers` | Pricing tiers (discount_percent, minimum_order_amount) |
| `tier_company_exceptions` | Per-company tier discount overrides |
| `tier_product_exceptions` | Per-product tier discount overrides |
| `orders` | Orders (subtotal, discount_amount, total_amount, tier_id, effective_discount_percent) |
| `order_items` | Order line items (unit_price, total_price, unit_type, unit_quantity) |
| `sessions` | Authentication sessions (token, employee_id, expires_at) |

---

## 3. CUSTOMER GEOGRAPHY FINDINGS

### 3.1 Where Governorate Is Stored

| Attribute | Value |
|-----------|-------|
| **Primary storage** | `customer_addresses.governorate_id` (UUID FK → `reference_governorates.id`) |
| **Secondary storage** | `customer_addresses.governorate` (VARCHAR free-text, legacy) |
| **GPS-derived** | `unified_locations.governorate_id` (UUID FK → `reference_governorates.id`) |
| **Virtual field** | `manual_governorate_id` — computed in `get_governed_customers` RPC via lateral join |

### 3.2 Reference Tables

**`reference_governorates`** (27 rows):
- `id` UUID PK
- `code` VARCHAR(20) UNIQUE (e.g., "CAI", "GIZ", "ALX")
- `name_ar` VARCHAR(200) (e.g., "القاهرة", "الجيزة")
- `name_en` VARCHAR(200) (e.g., "Cairo", "Giza")
- `is_active` BOOLEAN
- `display_order` INTEGER

**`reference_cities`** (269 rows):
- `id` UUID PK
- `governorate_id` UUID NOT NULL FK → `reference_governorates(id)`
- `code` VARCHAR(20) UNIQUE (e.g., "CAI-NSR", "GIZ-HRM")
- `name_ar` VARCHAR(200)
- `name_en` VARCHAR(200)
- `is_active` BOOLEAN
- `display_order` INTEGER

### 3.3 Governorate Normalization Status

**VERDICT: GOVERNORATES ARE NORMALIZED.**

The `reference_governorates` table is the canonical source. The `20270804_customer_address_separation.sql` migration already:
1. Resolved `governorate_id` from free-text `governorate` column
2. Marked customers needing correction with `needs_address_correction`
3. Added governorate filter to `get_governed_customers` RPC

### 3.4 Customer Form Handling

- **Governorate**: Dropdown from `reference_governorates` (UUID FK stored)
- **City**: Free text input (NOT from `reference_cities`)
- **Street**: Free text input
- **Address source**: enum `manual`, `gps`, `mixed`

### 3.5 Customer Search/Filter/Reporting

- `get_governed_customers` RPC accepts `p_governorate_id UUID` parameter
- `get_unified_orders` RPC accepts `p_governorate_id UUID` parameter
- CustomersPage, OrdersPage, VisitsPage, ExecutiveOperationsWorkspace all support governorate filtering
- Report export resolves governorate via `buildCustomerReportRows(customers, governorates)`

### 3.6 Existing Sector References

**NO SECTOR/قطاع CONCEPT EXISTS in any database table, column, migration, or TypeScript code.** All search results for "sector" or "قطاع" are in documentation files only. The word "انقطاع" (interruption) in attendance UI is unrelated.

### 3.7 Employee Region Column

`employees.region` exists as a free-text column in the schema but is:
- NOT linked to any reference table
- NOT used in any RPC or TypeScript code
- Only referenced in documentation files

**Recommendation:** Ignore or repurpose this column.

---

## 4. EMPLOYEE FINDINGS

### 4.1 Employee Table

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `identity_id` | UUID NOT NULL | FK → identities (1-to-1) |
| `code` | VARCHAR(20) | e.g., "EMP-2026-000001" |
| `full_name` | VARCHAR(255) | |
| `email` | VARCHAR(255) | |
| `manager_id` | UUID | Self-referential FK for hierarchy |
| `address` | TEXT | Added later |
| `region` | TEXT | Free-text, unused in code |
| `is_active` | BOOLEAN | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### 4.2 Role Model

**7-role canonical model:**

| Target Role (Arabic) | English | Status |
|---|---|---|
| الإدارة العليا | Upper Management | mapped |
| مدير بيع | Sales Manager | mapped |
| مندوب مبيعات | Sales Rep | mapped |
| مشرف عام | General Supervisor | mapped |
| مدير مخزن | Warehouse Manager | mapped |
| سيلز داخلي | Internal Sales | new |
| مندوب توصيل | Delivery Rep | new |

Additional roles added later: سائق (Driver), مدير عمليات تنفيذية (Executive Operations Manager), مدير تنفيذي (Executive Director), محصل (Credit Collector).

### 4.3 Sales Representative Identification

- Identified by role name: `مندوب مبيعات` (canonical Arabic)
- Normalized from: `sales_rep`, `salesrep`, `مندوب`
- In hierarchy filter: `EffectiveRole = 'rep'`

### 4.4 Sales Manager Identification

- Identified by role name: `مدير بيع` (canonical Arabic)
- Normalized from: `مدير البيع`, `مدير مبيعات`, `مدير المبيعات`, `Sales Manager`, `sales_manager`, `supervisor`, `سوبر فايزر`
- In hierarchy filter: `EffectiveRole = 'manager'`

### 4.5 Territory/Region Assignment

**NO TERRITORY, REGION, OR BRANCH ASSIGNMENT EXISTS.** Employees have NO stored geographic assignment. Visibility is purely hierarchy-based via `manager_id` (recursive CTE subtree).

### 4.6 Customer-Employee Relationship

- Customers are OWNED by employees: `customers.owner_id` → `employees.id`
- Customer ownership is tracked with audit trail: `customer_ownership_history`
- Employee deletion transfers ALL ownership to a fixed target employee

### 4.7 Order-Employee Relationship

- Orders are CREATED by employees: `orders.created_by` → `employees.id`
- Orders have `owner_type = 'employee'`

---

## 5. SALES MANAGER FINDINGS

### 5.1 Current Identification

Sales Managers are identified solely by the `مدير بيع` role. There is NO dedicated geographic responsibility field.

### 5.2 Multi-Role Support

**YES, one employee can have multiple roles.** The `employee_roles` junction table supports many-to-many relationships.

### 5.3 Geographic Responsibility

**DOES NOT EXIST.** A Sales Manager sees their own data plus all subordinates recursively (via `manager_id`). There is no concept of "this manager covers this governorate" or "this manager covers this sector."

### 5.4 Sales Manager Pages

7 dedicated pages exist:
- SalesManagerCCPage (Command Center)
- SalesManagerOperations (Operations + add rep)
- SalesManagerField (Field activity)
- SalesManagerPersonal (Personal view)
- SalesManagerVisitsList (Visits monitoring)
- SalesManagerCustomersList (Customer management)
- SalesManagerOrdersList (Orders monitoring)

---

## 6. CURRENT PRICING ARCHITECTURE

### 6.1 Base Price Source of Truth

**`products.carton_price`** is the single canonical price. All other unit prices are derived:

| Price | Formula |
|-------|---------|
| `carton_price` | Source of truth (stored on `products` table) |
| `piece_price` | `carton_price / carton_quantity` (stored, derived) |
| `dozen_price` | `piece_price * 12` (stored, derived) |

### 6.2 Price Derivation (Server-Side)

```sql
-- _calc_base_unit_price() function
IF p_unit_type = 'piece'    THEN RETURN ROUND((p_carton_price / p_carton_quantity)::numeric, 2);
ELSIF p_unit_type = 'dozen' THEN RETURN ROUND((p_carton_price / p_carton_quantity * 12)::numeric, 2);
ELSIF p_unit_type = 'carton'THEN RETURN ROUND(p_carton_price::numeric, 2);
```

### 6.3 Tier Discount System

Three tiers seeded: Bronze (2.97%), Silver (3.94%), Gold (4.90%).

**Discount priority chain:**
1. Product exception (`tier_product_exceptions.discount_percent`) — highest
2. Company exception (`tier_company_exceptions.discount_percent`)
3. Tier default (`tiers.discount_percent`) — fallback

**Server-side resolution:** `_get_effective_tier_discount(tier_id, product_id, company_id)`

**Client-side resolution:** `computeEffectiveDiscountPercent(tier, exceptionLookup)` in `engine/pricing.ts`

### 6.4 Critical Finding: Pricing Authority Has Shifted to Client

**Historical behavior (pre-August 2026):**
- `governed_create_order` called `_calc_base_unit_price()` — server recalculated from `carton_price`
- `governed_submit_order` recalculated ALL prices from scratch
- Client-submitted `unit_price` was IGNORED

**Current behavior (latest migrations):**
- `governed_create_order` ACCEPTS client-submitted `unit_price` directly (line 765 of `20270804_auto_close_inactivity_60min.sql`)
- `governed_submit_order` just sums existing `order_items.total_price` — NO recalculation
- The tier discount is applied ONLY CLIENT-SIDE in `engine/pricing.ts`

### 6.5 What Does NOT Exist

| Mechanism | Status |
|-----------|--------|
| `customer_prices` table | DOES NOT EXIST |
| `price_rules` / `pricing_rules` table | DOES NOT EXIST (domain interface defined but unused) |
| `price_lists` table | DOES NOT EXIST |
| Per-customer price override | DOES NOT EXIST |
| Coupon/promo codes | DOES NOT EXIST |
| Volume-based quantity pricing | DOES NOT EXIST |
| `effective_price` column | DOES NOT EXIST (always computed at runtime) |

### 6.6 Sahl POS Pricing

Sahl POS reads prices DIRECTLY from `products.piece_price` / `dozen_price` / `carton_price`. It allows MANUAL price override (editable unit_price input). No tier discounts. Flat-amount discount only.

**Sahl and AHRAM share the same `products` table but have independent pricing flows.**

---

## 7. EXACT PRICE CALCULATION PATHS

### 7.1 AHRAM Storefront (Customer-Facing)

```
DB products.carton_price + carton_quantity
  ↓
get_governed_products RPC → returns carton_price, piece_price, dozen_price
  ↓
toProductWithPrice() [utils/catalog.ts] → ProductWithPrice
  ↓
Cart store (store/cart.ts) → stores ProductWithPrice[]
  ↓
computeProductPrices(product, tier, exceptionLookup) [engine/pricing.ts]
  → Computes base prices + tier-discounted prices
  → Returns ComputedPrices { piecePrice, dozenPrice, cartonPrice, tierPiecePrice, ... }
  ↓
getEffectiveUnitPrice(prices, unitType, hasTier) → final unitPrice for cart item
  ↓
computeCartTotals(items, tier, dealItems, flashOfferItems, exceptionLookup)
  → CartTotals { subtotal, tierDiscount, netTotal, ... }
  ↓
Order submission → governed_create_order RPC
  → Server ACCEPTS client unit_price (does NOT recalculate)
  → Stores in order_items
```

### 7.2 AHRAM Admin Product Management

```
governed_create_product RPC
  → Accepts carton_price, carton_quantity
  → DERIVES piece_price = carton_price / carton_quantity
  → DERIVES dozen_price = piece_price * 12
  → Stores all three in products row
  → Creates product_units rows
```

```
governed_update_product_pricing RPC
  → Accepts optional carton_price, carton_quantity
  → REGENERATES piece_price and dozen_price
  → Atomic UPDATE of all four pricing columns
```

### 7.3 Sahl POS

```
sahl_get_pos_products RPC
  → Reads piece_price, dozen_price, carton_price FROM products table
  → Returns to client
  ↓
SahlPosPage.tsx
  → Defaults to piece unit + piece_price
  → User can change unit type (auto-switches price)
  → User can MANUALLY OVERRIDE unit_price (editable input)
  ↓
sahl_create_invoice RPC
  → ACCEPTS client unit_price (validates >= 0, does NOT recalculate)
  → Stores in sahl_invoice_items
```

### 7.4 Sahl Invoices/Quotes

```
sahl_create_invoice / _sahl_post_invoice_core
  → Stores unit_price from client
  → line_total = qty * unit_price
  → grand_total = subtotal - discount + additions + tax
```

### 7.5 Returns

```
ReturnNewPage
  → Uses ORIGINAL order's unit_price (no re-query)
SahlReturnsPage
  → Uses stored order prices
```

### 7.6 Reports

```
SalesAnalyticsPage
  → Aggregates order_items.total_price for revenue
```

---

## 8. PROPOSED SECTOR ARCHITECTURE

> **OWNER DECISION — RESOLVED:** The business model is: قطاع → محافظة → شركة → صنف.
> Customers already have a governorate. Governorates are grouped into sectors.
> Sales Representatives and Sales Managers will later be assignable to governorate or sector.
> See [Section 21](#21-owner-approved-business-rules--2026-08-25).

### 8.1 Design Options Evaluated

#### Option A: Existing Governorate Field + New Sector Tables

Add a `sectors` table and a `sector_governorates` junction table. Customers keep their existing `governorate_id`. A new lookup joins customer governorate → sector.

**Pros:** Minimal change to existing data model.
**Cons:** Sector membership is implicit (derived from governorate assignment), not explicit.

#### Option B: Normalized Governorates Table + Sector Mapping (RECOMMENDED)

Create `sectors` table and `sector_governorates` junction table. Customers already have `governorate_id`. The sector is determined by the customer's governorate membership in a sector.

**Pros:** Uses existing normalized governorate data. Sector is a pure mapping layer.
**Cons:** A governorate can only belong to one sector (or many — decision required).

#### Option C: Geographic Assignment Tables Without Restructuring Customers

Create a separate `geographic_assignments` table that maps employees to governorates/sectors independently of customer data.

**Pros:** Employee assignment is decoupled from customer data.
**Cons:** Doesn't address sector definition or pricing rules.

### 8.2 Recommended Architecture: Option B (Hybrid B+C) — OWNER DECISION — RESOLVED

Combine sector-governorate mapping (Option B) with employee geographic assignments (Option C). This provides:

1. A clean sector → governorate mapping
2. Employee assignments to governorates/sectors (separate from customer data)
3. Geographic pricing rules attached to sectors or governorates
4. Zero disruption to existing customer/employee data

---

## 9. PROPOSED GEOGRAPHIC ASSIGNMENT ARCHITECTURE

> **OWNER DECISION — RESOLVED:** Sales Representatives and Sales Managers will later be assignable to governorate or sector. Direct customers remain part of the existing customer/ownership model. A new "القطاعات" screen will manage sectors, governorate assignments, geographic employee assignments, and geographic pricing rules.

### 9.1 Sales Representative → Governorate

**Architecture: Support MULTIPLE governorates per representative.**

Rationale:
- A sales rep may cover a city near a governorate border
- The existing customer ownership model (`customers.owner_id`) already implicitly defines geographic scope
- Making assignment explicit enables geographic pricing and reporting

**Implementation:** `employee_geographic_assignments` junction table with `assignment_type` (governorate/sector).

### 9.2 Sales Manager → Sector

**Recommendation: Support BOTH direct governorate AND sector assignment.**

A Sales Manager could be assigned to:
- A specific sector (covering all its governorates)
- A specific governorate (if no sector structure applies)
- Both (sector with override for specific governorates)

**Implementation:** Same `employee_geographic_assignments` table with `assignment_type` discriminator.

### 9.3 Relationship Model

```
Employee
  ↓ (employee_geographic_assignments)
  ├─ assignment_type = 'governorate' → reference_governorates.id
  └─ assignment_type = 'sector' → sectors.id

Sector
  ↓ (sector_governorates)
  └─ reference_governorates.id

Customer
  ↓ (customer_addresses.governorate_id)
  └─ reference_governorates.id
  → Sector determined by governorate membership
```

---

## 10. PROPOSED PRICING-RULE ARCHITECTURE

> **OWNER DECISION — RESOLVED:** Geographic pricing uses percentage adjustments only (positive or negative). No fixed-amount adjustments. No stacking. No validity dates. No customer-specific pricing. The original product price remains the base price. The customer's effective price is calculated from the customer's geographic context. See [Section 21](#21-owner-approved-business-rules--2026-08-25).

### 10.1 Base Price + Geographic Adjustment = Effective Price

The geographic pricing system is an ADDITIVE LAYER on top of the existing pricing. The percentage is applied to the ORIGINAL UNIT PRICE (not to an already-adjusted price).

```
Original Unit Price × (1 + geographic_adjustment_percent / 100) = Effective Price
```

**No stacking.** Only the most specific applicable value is used.

### 10.2 Adjustment Representation

**OWNER DECISION — RESOLVED:** Percentage only. Supports positive (+) and negative (-) values.

- `+2%` = increase by 2%
- `+4%` = increase by 4%
- `-2%` = decrease by 2%
- `-5%` = decrease by 5%

There is no separate "discount" concept for geographic pricing. The percentage IS the adjustment.

### 10.3 Pricing Resolution Order (Most Specific Wins)

**OWNER DECISION — RESOLVED:** No stacking. More specific pricing replaces broader pricing.

Resolution order:

```
صنف (Product)
  ↓ fallback
شركة (Company)
  ↓ fallback
محافظة (Governorate)
  ↓ fallback
قطاع (Sector)
  ↓ fallback
السعر الأصلي (Original Price)
```

If no value exists at a level, fall back to the next applicable level. If no value exists anywhere, FINAL PRICE = ORIGINAL PRICE.

### 10.4 Effective Price Calculation

```
effective_price = original_unit_price × (1 + adjustment_percent / 100)
```

**Always calculated from the original unit price.** Do NOT apply the percentage to an already-adjusted price.

Example:

```
قطعة = 100
درزن = 1100
كرتونة = 5000
Sector = +2%

Result:
قطعة = 102
درزن = 1122
كرتونة = 5100
```

### 10.5 Sector-Wide Rule

If a sector has: `الصعيد = +2%`

This means: ALL companies and ALL products in that sector receive +2%, unless a more specific rule overrides it.

### 10.6 Governorate Override

If `الصعيد = +2%` and `المنيا = +4%`:

Products sold to customers in Minya use +4%. The +4% replaces the sector +2%.

### 10.7 Company Rule

If `المنيا + شركة ABC = +4%`:

ALL products of ABC in Minya receive +4%.

If a specific product is also defined: `المنيا + شركة ABC + شامبو X = +6%`:

- Shampoo X = +6%
- Other ABC products = company rule (+4%)
- If no company rule exists = governorate rule
- If no governorate rule exists = sector rule
- If no sector rule exists = original price

### 10.8 Customer Governorate Required

**OWNER DECISION — RESOLVED:** Geographic pricing is determined from the customer's governorate. If a customer has no governorate, DO NOT silently assume a governorate. DO NOT apply an arbitrary geographic price. The sale must require the user to define the customer's governorate first.

Required message: `"يجب تحديد محافظة العميل أولاً"`

### 10.9 No Customer-Specific Pricing

**OWNER DECISION — RESOLVED:** Do NOT introduce a customer-specific pricing mechanism. The system does not store a special geographic price for each customer. The customer receives the calculated price according to: Customer → Governorate → Sector → Company → Product.

### 10.10 No Validity Dates

**OWNER DECISION — RESOLVED:** Geographic pricing rules do NOT have validity dates, expiration dates, or validity periods. This is not an unresolved business decision.

---

## 11. PRICING PRIORITY ANALYSIS

> **OWNER DECISION — RESOLVED:** No stacking. More specific pricing replaces broader pricing. Resolution: Product → Company → Governorate → Sector → Original Price. See [Section 21](#21-owner-approved-business-rules--2026-08-25).

### 11.1 Current Behavior (Tier System — Existing)

| Scope | Priority | Mechanism |
|-------|----------|-----------|
| Product exception | 1 (highest) | `tier_product_exceptions.discount_percent` |
| Company exception | 2 | `tier_company_exceptions.discount_percent` |
| Tier default | 3 (lowest) | `tiers.discount_percent` |

### 11.2 Geographic Pricing Priority (OWNER DECISION — RESOLVED)

**No stacking. Most specific wins.**

| Priority | Scope | Example |
|----------|-------|---------|
| 1 (highest) | صنف (Product) | شامبو X = +6% |
| 2 | شركة (Company) | شركة ABC = +4% |
| 3 | محافظة (Governorate) | المنيا = +4% |
| 4 | قطاع (Sector) | الصعيد = +2% |
| 5 (lowest) | السعر الأصلي (Original Price) | No adjustment |

### 11.3 Resolution Example

| Source | Value |
|--------|-------|
| Base price | 1000 EGP |
| Sector rule (الصعيد) | +2% |
| Governorate rule (المنيا) | +4% |
| Product rule (شامبو X) | +6% |

**Customer in Minya buying Shampoo X:**
- Product rule (+6%) wins → Effective price = 1060 EGP
- NOT: 1000 + 2% + 4% + 6% (stacking rejected)

**Customer in Minya buying other products:**
- Governorate rule (+4%) wins → Effective price = 1040 EGP
- NOT: 1000 + 2% + 4% (stacking rejected)

**Customer in Giza (no governorate rule):**
- Sector rule does not apply (Giza is not in الصعيد)
- No rule found → Original price = 1000 EGP

---

## 12. BACKWARD COMPATIBILITY ANALYSIS

### 12.0 Customer Governorate Requirement

> **OWNER DECISION — RESOLVED:** If a customer has no governorate, geographic pricing cannot be applied. The sale must require the user to define the customer's governorate first. Required message: `"يجب تحديد محافظة العميل أولاً"`

### 12.1 Existing Customers

| Aspect | Impact |
|--------|--------|
| Customer data | UNCHANGED — no columns modified |
| Governorate assignment | UNCHANGED — `customer_addresses.governorate_id` untouched |
| Customer search/filter | UNCHANGED — existing governorate filter continues working |
| Customer reports | UNCHANGED — existing report logic continues working |

**Sector is determined by governorate membership, not by a new column on customers.**

### 12.2 Existing Employees

| Aspect | Impact |
|--------|--------|
| Employee data | UNCHANGED — no columns modified |
| Role model | UNCHANGED — existing roles continue working |
| Hierarchy | UNCHANGED — `manager_id` tree continues working |
| `employees.region` | IGNORED — free-text column, unused in code |

**Geographic assignment is stored in a new table, not on the employee record.**

### 12.3 Existing Products

| Aspect | Impact |
|--------|--------|
| Product data | UNCHANGED — `carton_price`, `piece_price`, `dozen_price` untouched |
| Product creation | UNCHANGED — `governed_create_product` RPC unchanged |
| Product pricing update | UNCHANGED — `governed_update_product_pricing` RPC unchanged |

### 12.4 Existing Orders

| Aspect | Impact |
|--------|--------|
| Historical orders | UNCHANGED — stored `unit_price` and `total_price` preserved |
| New orders | Geographic pricing applied at ADDITIVE layer (new code) |

### 12.5 Existing Reports

| Aspect | Impact |
|--------|--------|
| Existing report queries | UNCHANGED — they read from existing columns |
| New geographic reports | NEW queries, additive only |

### 12.6 Existing SAHL Functionality

| Aspect | Impact |
|--------|--------|
| Sahl POS pricing | UNCHANGED — reads from `products` table directly |
| Sahl invoices | UNCHANGED — stores client-submitted prices |
| Sahl reports | UNCHANGED — reads stored prices |

**⚠️ CRITICAL: Geographic pricing does NOT apply to Sahl POS.** Sahl has its own pricing flow and allows manual overrides. This is an OWNER DECISION — RESOLVED.

---

## 13. IMPACT MATRIX

| Module | Impact Level | Reason |
|--------|-------------|--------|
| **Customers** | NONE | No schema changes. Governorate already normalized. |
| **Customer Addresses** | NONE | No changes to `customer_addresses` table. |
| **Employees** | LOW | New `employee_geographic_assignments` table. Employee forms need minor extension to show/assign geographic scope. |
| **Sales Representatives** | LOW | Same as Employees — assignment to governorates. |
| **Sales Managers** | LOW | Same as Employees — assignment to sectors/governorates. |
| **Products** | NONE | No changes to products table or pricing columns. |
| **Prices** | NONE | Base prices unchanged. Geographic adjustment is additive. |
| **Pricing Engine** | MEDIUM | `engine/pricing.ts` needs geographic adjustment layer. Cart store needs geographic context. |
| **POS (AHRAM Storefront)** | LOW | Needs to pass customer governorate context to pricing engine for geographic adjustment. |
| **POS (Sahl)** | NONE | Sahl has independent pricing flow. Should NOT be affected. |
| **Orders** | LOW | New orders may include geographic pricing metadata. Historical orders untouched. |
| **Invoices** | NONE | Invoice display reads stored order prices. |
| **Quotes** | NONE | Same as invoices. |
| **Returns** | NONE | Returns use original order prices. |
| **Reports** | LOW | New geographic reports are additive. Existing reports unchanged. |
| **Customer Accounts** | NONE | Financial data unchanged. |
| **HR** | LOW | Employee forms need geographic assignment fields. |
| **Coverage Map** | LOW | Could display sector boundaries overlay (future enhancement). |
| **Command Center** | LOW | Could filter by sector (future enhancement). |
| **Authorization** | LOW | New capabilities for sector management. Upper Management bypass continues working. |
| **Desktop (Electron)** | LOW | Schema version bump. New migration for local DB sync. |

---

## 14. SURGICAL IMPLEMENTATION PLAN

### 14.1 Implementation Phases

#### Phase 1: Database Foundation (Zero UI Impact)
1. Create `sectors` table
2. Create `sector_governorates` junction table
3. Create `geographic_price_rules` table
4. Create `employee_geographic_assignments` table
5. Seed existing sector structure (from business input)
6. Create CRUD RPCs for sectors
7. Create CRUD RPCs for geographic price rules
8. Create CRUD RPCs for employee geographic assignments

#### Phase 2: Pricing Engine Extension
1. Add geographic adjustment to `engine/pricing.ts`
2. Add geographic context to cart store
3. Add geographic price rule resolution logic (Product → Company → Governorate → Sector → Original)
4. Server-side validation of geographic pricing in order RPCs
5. Add governorate requirement validation (block sale if customer has no governorate)

#### Phase 3: UI Extensions
1. Create "القطاعات" management page
2. Extend EmployeesPage with geographic assignment
3. Extend CustomerForm (optional — show sector based on governorate)
4. Add sector filter to existing pages

#### Phase 4: Reporting
1. Add sector-based reporting views
2. Add geographic pricing preview

### 14.2 Files That Would Eventually Change

| File | Change Type | Phase |
|------|------------|-------|
| `supabase/migrations/YYYYMMDD_sectors_foundation.sql` | NEW | 1 |
| `supabase/migrations/YYYYMMDD_geographic_pricing_rules.sql` | NEW | 1 |
| `supabase/migrations/YYYYMMDD_employee_geographic_assignments.sql` | NEW | 1 |
| `supabase/migrations/YYYYMMDD_sector_rpcs.sql` | NEW | 1 |
| `src/engine/pricing.ts` | MODIFY | 2 |
| `src/store/cart.ts` | MODIFY | 2 |
| `src/types/storefront.ts` | MODIFY (add types) | 2 |
| `src/pages/sectors/SectorsManagerPage.tsx` | NEW | 3 |
| `src/pages/employees/EmployeesPage.tsx` | MODIFY (add assignment UI) | 3 |
| `src/components/customers/CustomerForm.tsx` | MODIFY (show sector) | 3 |
| `src/routes/index.tsx` | MODIFY (add sector route) | 3 |
| `src/hooks/useCapability.ts` | NO CHANGE | — |
| `desktop/main/db/schema.sql` | MODIFY (after schema evolution) | 1 |

### 14.3 Files That Should NOT Be TouchED

| File | Reason |
|------|--------|
| `src/engine/pricing.ts` base price logic | Base price calculation must not change |
| `domain/models/pricing.ts` | Existing interfaces preserved |
| `domain/models/product.ts` | Product model unchanged |
| `supabase/migrations/20260531_*` | Historical migrations never modified |
| Sahl pages/components | Independent system |
| `src/store/auth.ts` | Auth system unchanged |
| Existing order/invoice/return flows | Historical data preserved |

### 14.4 Database Objects That Would Eventually Change

| Object | Type | Change |
|--------|------|--------|
| `sectors` | TABLE | NEW |
| `sector_governorates` | TABLE | NEW |
| `geographic_price_rules` | TABLE | NEW (percentage only, no validity dates) |
| `employee_geographic_assignments` | TABLE | NEW |
| `governed_create_sector` | FUNCTION | NEW |
| `governed_update_sector` | FUNCTION | NEW |
| `governed_delete_sector` | FUNCTION | NEW |
| `get_governed_sectors` | FUNCTION | NEW |
| `governed_create_geographic_price_rule` | FUNCTION | NEW (percentage only) |
| `governed_update_geographic_price_rule` | FUNCTION | NEW |
| `governed_delete_geographic_price_rule` | FUNCTION | NEW |
| `get_geographic_price_rules` | FUNCTION | NEW |
| `governed_assign_employee_geographic` | FUNCTION | NEW |
| `governed_remove_employee_geographic` | FUNCTION | NEW |
| `get_employee_geographic_assignments` | FUNCTION | NEW |
| `get_effective_geographic_price` | FUNCTION | NEW |
| `sectors.manage` | CAPABILITY | NEW |
| `sectors.read` | CAPABILITY | NEW |
| `geographic_pricing.manage` | CAPABILITY | NEW |

### 14.5 RPCs That Would Eventually Change

| RPC | Change |
|-----|--------|
| `governed_create_order` | ADD geographic price validation (optional) |
| `governed_submit_order` | ADD geographic price metadata storage (optional) |
| `get_governed_products` | NO CHANGE (returns base prices) |

### 14.6 Screens That Would Eventually Change

| Screen | Change |
|--------|--------|
| New: SectorsManagerPage | Full CRUD for sectors + governorate assignment + pricing rules |
| EmployeesPage | Add geographic assignment section |
| EmployeeProfilePage | Show geographic assignments |
| SalesManagerOperations | Show sector context |
| CustomersPage | Add sector filter (derived from governorate) |
| OrdersPage | Add sector filter (derived from customer governorate) |

### 14.7 Screens That Should NOT Be TouchED

| Screen | Reason |
|--------|--------|
| SahlPosPage | Independent pricing system |
| SahlInvoicesPage | Independent system |
| SahlReportsPage | Independent system |
| Attendance screens | Unrelated |
| Credit screens | Unrelated |
| Auth/Login | Unrelated |
| Dashboard (main) | Unrelated |
| Warehouse screens | Unrelated |
| Delivery screens | Unrelated |
| Returns screens | Use original order prices |

---

## 15. PROPOSED DATABASE MODEL

### 15.1 Entity-Relationship Overview

```
reference_governorates (27 rows, EXISTING)
  ↑ FK
  │
  ├── sector_governorates (NEW junction)
  │     ↑ FK
  │     │
  │     └── sectors (NEW)
  │           │
  │           └── geographic_price_rules (NEW, scope='sector')
  │
  ├── geographic_price_rules (NEW, scope='governorate')
  │
  ├── customer_addresses.governorate_id (EXISTING, UNCHANGED)
  │     ↑
  │     └── customers (EXISTING, UNCHANGED)
  │
  └── employee_geographic_assignments (NEW)
        ↑ FK
        └── employees (EXISTING, UNCHANGED)

products (EXISTING)
  ↑ FK (optional, for product-specific rules)
  └── geographic_price_rules (NEW, scope includes product variants)

companies (EXISTING)
  ↑ FK (optional, for company-specific rules)
  └── geographic_price_rules (NEW, scope includes company variants)
```

### 15.2 Detailed Table Definitions

#### `sectors`

```sql
CREATE TABLE sectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `sector_governorates`

```sql
CREATE TABLE sector_governorates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_id UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    governorate_id UUID NOT NULL REFERENCES reference_governorates(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(sector_id, governorate_id)
);
```

#### `geographic_price_rules`

> **OWNER DECISION — RESOLVED:** Percentage only. No fixed-amount adjustments. No validity dates. No customer-specific pricing.

```sql
CREATE TABLE geographic_price_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name VARCHAR(255) NOT NULL,
    adjustment_percent NUMERIC(7,4) NOT NULL,
    -- Positive value = increase (e.g., +2% → adjustment_percent = 2.0000)
    -- Negative value = decrease (e.g., -5% → adjustment_percent = -5.0000)
    scope VARCHAR(30) NOT NULL CHECK (scope IN ('sector', 'governorate', 'company_sector', 'company_governorate', 'product_sector', 'product_governorate', 'product_company_sector', 'product_company_governorate')),
    sector_id UUID REFERENCES sectors(id),
    governorate_id UUID REFERENCES reference_governorates(id),
    company_id UUID REFERENCES companies(id),
    product_id UUID REFERENCES products(id),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Constraint: sector_id or governorate_id must be set
    CHECK (sector_id IS NOT NULL OR governorate_id IS NOT NULL),
    -- No validity dates per owner decision
    -- No fixed amounts per owner decision
    -- No customer-specific pricing per owner decision
);
```

#### `employee_geographic_assignments`

```sql
CREATE TABLE employee_geographic_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    assignment_type VARCHAR(20) NOT NULL CHECK (assignment_type IN ('governorate', 'sector')),
    governorate_id UUID REFERENCES reference_governorates(id),
    sector_id UUID REFERENCES sectors(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Constraint: exactly one of governorate_id or sector_id must be set
    CHECK (
        (assignment_type = 'governorate' AND governorate_id IS NOT NULL AND sector_id IS NULL) OR
        (assignment_type = 'sector' AND sector_id IS NOT NULL AND governorate_id IS NULL)
    ),
    UNIQUE(employee_id, assignment_type, governorate_id, sector_id)
);
```

---

## 16. PROPOSED UI

### 16.1 "القطاعات" Management Screen

**Route:** `/sectors/manage`
**Capability:** `sectors.manage`
**Access:** Upper Management + authorized managers

#### Screen Sections

1. **Sector List**
   - Table/card view of all sectors
   - Columns: Name, Governorates count, Active customers count, Active rules count
   - Actions: Edit, Deactivate, Delete (with confirmation)

2. **Create Sector**
   - Name (Arabic), Name (English, optional), Description
   - Save button

3. **Sector Detail (Expand/Modal)**
   - Governorate Assignment
     - Multi-select dropdown from `reference_governorates`
     - Show assigned governorates as removable tags
   - Assigned Representatives
     - List of sales reps assigned to this sector
   - Assigned Managers
     - List of sales managers assigned to this sector
   - Pricing Rules
     - List of geographic price rules for this sector
     - Add rule: Adjustment type (percentage/fixed), Value, Scope (all products / specific product)
   - Affected Customers
     - Count of customers in this sector's governorates
     - Preview list (first 10)

4. **Price Preview Panel**
   - Select a product → shows:
     - Base price: 1000 EGP
     - Sector adjustment: +2%
     - Effective price: 1020 EGP
   - Select a governorate → shows governorate-specific override if any
   - Preview is read-only, does NOT modify actual pricing data

### 16.2 Employee Geographic Assignment (Extension to Existing Page)

**Location:** EmployeesPage / EmployeeProfilePage
**Change:** Add "Geographic Assignment" section

- Dropdown: Governorate or Sector
- Multi-select for governorates
- Single-select for sector
- Show current assignments as removable tags

### 16.3 Customer Sector Display (Extension to Existing Page)

**Location:** CustomersPage, CustomerProfilePage
**Change:** Show derived sector in customer list/detail

- Sector is derived from customer's governorate → sector mapping
- No direct assignment needed
- Display as read-only badge/tag

---

## 17. SECURITY/CAPABILITY CONSIDERATIONS

### 17.1 New Capabilities Required

| Code | Name (Arabic) | Purpose |
|------|---------------|---------|
| `sectors.create` | إنشاء القطاعات | Create new sectors |
| `sectors.manage` | إدارة القطاعات | Full sector management |
| `sectors.read` | عرض القطاعات | View sectors |
| `geographic_pricing.manage` | إدارة التسعير الجغرافي | Manage geographic price rules |
| `geographic_pricing.read` | عرض التسعير الجغرافي | View geographic price rules |
| `geographic_assignment.manage` | إدارة التعيينات الجغرافية | Assign employees to geographic areas |

### 17.2 Role Assignment

| Role | Capabilities |
|------|-------------|
| الإدارة العليا (Upper Management) | ALL (automatic bypass) |
| مدير بيع (Sales Manager) | `sectors.read`, `geographic_pricing.read` |
| مندوب مبيعات (Sales Rep) | `sectors.read` (read-only view of own sector) |

### 17.3 Server-Side Enforcement

All sector RPCs must call `check_capability(p_token, 'sectors.manage')` at entry.

```sql
IF NOT public.check_capability(p_token, 'sectors.manage') THEN
    RAISE EXCEPTION 'MISSING_CAPABILITY: sectors.manage';
END IF;
```

### 17.4 Route Guards

```tsx
<Route path="/sectors/manage" element={
  <ProtectedRoute requireCapability="sectors.manage">
    <SectorsManagerPage />
  </ProtectedRoute>
} />
```

---

## 18. RISKS

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Client-side pricing authority allows geographic price manipulation | HIGH | Add server-side geographic price validation in order RPCs |
| Sahl POS price override could conflict with geographic pricing | MEDIUM | Sahl POS is explicitly excluded from geographic pricing (OWNER DECISION) |
| Governorate-to-sector mapping ambiguity (governorate in multiple sectors) | MEDIUM | Enforce UNIQUE constraint: one governorate belongs to exactly ONE sector |
| Existing employees without geographic assignments | LOW | Allow NULL assignments. Reports gracefully handle unassigned employees. |
| Desktop offline sync complexity | LOW | New tables follow existing sync pattern |
| Price preview accuracy | LOW | Preview is read-only, does not affect actual pricing |
| Performance impact of geographic price resolution in pricing engine | LOW | Simple lookup, negligible overhead |
| Customer has no governorate | MEDIUM | Sale requires governorate definition first. Message: "يجب تحديد محافظة العميل أولاً" |

---

## 19. UNKNOWNS

> All previously unresolved questions have been decided by the owner (2026-08-25). See [Section 21](#21-owner-approved-business-rules--2026-08-25).

| Unknown | Status | Resolution |
|---------|--------|-----------|
| How many sectors does the business need? | RESOLVED — deferred to implementation | Owner will define sectors during implementation |
| Should a governorate belong to exactly ONE sector? | **RESOLVED** | YES — one governorate belongs to exactly one sector |
| Should geographic pricing apply to Sahl POS? | **RESOLVED** | NO — Sahl is excluded |
| Should existing customers be auto-assigned to sectors? | **RESOLVED** | No customer data change needed — sector is derived from governorate |
| Should geographic pricing stack or override? | **RESOLVED** | OVERRIDE — no stacking, most specific wins |
| Should geographic pricing apply before or after tier discount? | **RESOLVED** | Percentage applied to original unit price |
| What is the maximum number of governorates per sales rep? | RESOLVED — deferred to implementation | Flexible assignment model supports any number |
| Should sector management be restricted to Upper Management only? | RESOLVED — deferred to implementation | Upper Management + authorized managers |
| Should the `employees.region` free-text column be migrated or removed? | RESOLVED | Ignore for now, deprecate later |
| Should geographic pricing have an expiration date? | **RESOLVED** | NO — no validity dates |

---

## 20. DECISIONS REQUIRED FROM OWNER

> **ALL DECISIONS RESOLVED — 2026-08-25**
>
> All previously open business questions have been finalized by the owner.
> See [Section 21: OWNER-APPROVED BUSINESS RULES](#21-owner-approved-business-rules--2026-08-25) for the complete summary.

### ~~CRITICAL DECISIONS~~ — ALL RESOLVED

1. ~~Sector-Governorate Relationship~~ → **RESOLVED: One governorate belongs to exactly ONE sector.**

2. ~~Geographic Pricing Stacking~~ → **RESOLVED: No stacking. Most specific wins.**

3. ~~Geographic Pricing Timing~~ → **RESOLVED: Percentage applied to original unit price.**

4. ~~Sahl POS Integration~~ → **RESOLVED: Geographic pricing does NOT apply to Sahl POS.**

5. ~~Initial Sector Structure~~ → **RESOLVED: Owner will define sectors during implementation.**

### ~~IMPORTANT DECISIONS~~ — ALL RESOLVED

6. ~~Product-Specific Geographic Rules~~ → **RESOLVED: Product-level rules supported (highest priority in resolution chain).**

7. ~~Employee Assignment Scope~~ → **RESOLVED: Sales Reps and Sales Managers assignable to governorate or sector.**

8. ~~Sector Management Access~~ → **RESOLVED: Upper Management + authorized managers.**

9. ~~Geographic Rule Expiration~~ → **RESOLVED: No validity dates.**

10. ~~Migration of employees.region~~ → **RESOLVED: Ignore for now, deprecate later.**

---

## 21. OWNER-APPROVED BUSINESS RULES — 2026-08-25

This section documents all business decisions finalized by the owner on 2026-08-25. These are NOT recommendations or alternatives — they are **approved, resolved decisions**.

### 21.1 Geographic Structure

- **قطاع → محافظة → شركة → صنف** (Sector → Governorate → Company → Product)
- Customers already have a governorate.
- Governorates are grouped into sectors.
- Sales Representatives and Sales Managers will later be assignable to governorate or sector.
- Direct customers remain part of the existing customer/ownership model.
- A new screen named "القطاعات" will later manage sectors, governorate assignments, geographic employee assignments, and geographic pricing rules.

### 21.2 Purpose of Geographic Pricing

- The same product can be sold at different prices depending on the customer's governorate/sector.
- The original product price remains the base price.
- There is NO permanently stored special price for each customer.
- The customer's effective price is calculated from the customer's geographic context.

### 21.3 Adjustment Can Be Positive or Negative

- `+2%` = increase by 2%
- `+4%` = increase by 4%
- `-2%` = decrease by 2%
- `-5%` = decrease by 5%
- There is no separate "discount" concept for this geographic pricing feature. The percentage IS the adjustment.

### 21.4 No Stacking

- Geographic percentages NEVER accumulate.
- Only the most specific applicable value is used.
- Example: Sector = +2%, Minya = +4%. Customer in Minya gets Original Price + 4%, NOT +2% +4%.
- The more specific rule replaces the broader rule.

### 21.5 Pricing Fallback

Resolution order (most specific to broadest):

```
صنف (Product)
  ↓ fallback
شركة (Company)
  ↓ fallback
محافظة (Governorate)
  ↓ fallback
قطاع (Sector)
  ↓ fallback
السعر الأصلي (Original Price)
```

- If no value exists at a level, fall back to the next applicable level.
- If no value exists anywhere: FINAL PRICE = ORIGINAL PRICE.

### 21.6 Sector-Wide Rule

- If a sector has `الصعيد = +2%`, this means ALL companies and ALL products in that sector receive +2%, unless a more specific rule overrides it.

### 21.7 Governorate Override

- Example: `الصعيد = +2%`, `المنيا = +4%`. Products sold to customers in Minya use +4%.
- The +4% replaces the sector +2%.
- If there is no more specific rule for the product/company, the governorate rule remains the applicable rule.

### 21.8 Company Rule

- Example: `المنيا + شركة ABC = +4%`. ALL products of ABC in Minya receive +4%.
- If a specific product is also defined: `المنيا + شركة ABC + شامبو X = +6%`:
  - Shampoo X = +6%
  - Other ABC products = company rule (+4%)
  - If no company rule exists = governorate rule
  - If no governorate rule exists = sector rule
  - If no sector rule exists = original price

### 21.9 Customer Governorate Is Required

- Geographic pricing is determined from the customer's governorate.
- If a customer has no governorate: DO NOT silently assume a governorate. DO NOT apply an arbitrary geographic price.
- The sale must require the user to define the customer's governorate first.
- Required message: `"يجب تحديد محافظة العميل أولاً"`

### 21.10 No Customer-Specific Pricing

- Do NOT introduce a customer-specific pricing mechanism as part of this feature.
- The system does not store a special geographic price for each customer.
- The customer receives the calculated price according to: Customer → Governorate → Sector → Company → Product.

### 21.11 Calculation Is Always from Original Unit Price

- The selected percentage is applied to the ORIGINAL PRICE of the unit being sold.
- Example:قطعة = 100, درزن = 1100, كرتونة = 5000, Sector = +2%. Result:قطعة = 102, درزن = 1122, كرتونة = 5100.
- Do NOT apply the percentage to an already-adjusted price.

### 21.12 Existing AHRAM Rounding Rules

- Use the existing AHRAM rounding behavior.
- Do NOT create a new rounding policy.

### 21.13 No Validity Dates

- Geographic pricing rules do NOT have: من تاريخ, إلى تاريخ, expiration date, validity period.
- Do not retain validity dates as an unresolved business decision.

### 21.14 Summary of Approved Rules

| Rule | Decision |
|------|----------|
| Governorates belong to sectors | YES — one governorate → exactly one sector |
| Customers priced by governorate/sector | YES — effective price calculated from geographic context |
| Employee geographic assignment | Sales Reps and Sales Managers assignable to governorate or sector |
| Adjustment type | Percentage only (positive or negative) |
| Stacking | NO — most specific rule wins |
| Resolution order | Product → Company → Governorate → Sector → Original Price |
| Sector-wide rule | Applies to all companies/products unless overridden |
| Governorate override | Replaces sector rule |
| Company override | Replaces governorate rule |
| Product override | Replaces company rule |
| Missing values | Fall back to broader level |
| No rule exists | Use original price |
| Customer governorate required | YES — sale blocked if missing. Message: "يجب تحديد محافظة العميل أولاً" |
| Customer-specific pricing | NOT introduced |
| Percentage calculation basis | Original unit price (not adjusted price) |
| Rounding | Existing AHRAM rounding rules |
| Validity dates | NOT included |
| Sahl POS | Excluded from geographic pricing |

---

## APPENDIX A: KEY FILE REFERENCES

| File | Relevance |
|------|-----------|
| `src/engine/pricing.ts` | Client-side pricing engine (130 lines) |
| `src/store/cart.ts` | Cart store with pricing flow (337 lines) |
| `src/domain/models/pricing.ts` | Domain pricing interfaces (48 lines) |
| `src/domain/services/PricingService.ts` | Domain pricing service (27 lines) |
| `src/types/storefront.ts` | All pricing TypeScript types |
| `src/utils/catalog.ts` | Product-to-ProductWithPrice mapper |
| `src/services/tiers.ts` | Tier CRUD + discount resolution |
| `src/components/customers/CustomerForm.tsx` | Customer form with governorate selection |
| `src/pages/customers/CustomersPage.tsx` | Customer list with governorate filter |
| `src/pages/employees/EmployeesPage.tsx` | Employee management |
| `src/utils/roleNormalization.ts` | Role mapping and normalization |
| `src/utils/hierarchyFilter.ts` | Effective role determination |
| `src/hooks/useCapability.ts` | Frontend capability checking |
| `src/components/auth/ProtectedRoute.tsx` | Route-level authorization |
| `src/routes/index.tsx` | All route definitions |
| `supabase/seed/reference_governorates.sql` | 27 governorates |
| `supabase/seed/reference_cities.sql` | 269 cities |
| `supabase/migrations/20270804_customer_address_separation.sql` | Governorate normalization |
| `supabase/migrations/20260603_tier_enforcement.sql` | Tier discount system |
| `supabase/migrations/20270720_stored_product_prices_rpcs.sql` | Product price storage |
| `supabase/migrations/20260706_role_normalization.sql` | Role model + check_capability |
| `desktop/main/db/schema.sql` | Full database schema (24,498 lines) |

---

**END OF FEASIBILITY STUDY**

**Status: STUDY ONLY — NO IMPLEMENTATION PERFORMED**
