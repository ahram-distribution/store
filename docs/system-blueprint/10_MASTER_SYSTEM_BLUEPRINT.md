# 10 — Master System Blueprint

## 1. System Overview

Ahram Distribution is a wholesale distribution management system serving ~25 active customers with ~700 products across the Egyptian market. The system manages the full order lifecycle — from customer registration and credit applications through order placement, delivery execution, payment collection, returns, and auction sales. It operates on a role-based access model with granular employee permissions and includes promotional features (daily deals, flash offers) that are structurally defined but not yet in production use.

## 2. Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, TypeScript ~5.6+, Vite |
| **State Management** | Zustand |
| **Styling** | Tailwind CSS |
| **Backend / Database** | Supabase (PostgreSQL 15+) |
| **Data Access** | All data via Supabase RPCs (no direct table access from client) |
| **Auth** | Token-based authentication (Supabase sessions stored in `app.sessions`) |
| **Routing** | Role-based routing (different entry points / views per employee role) |

## 3. Core Architecture

- **All data access is through PostgreSQL functions (RPCs).** The frontend never queries tables directly. Each RPC is `governed_*` — meaning it checks the caller's session and capabilities before returning or modifying data.
- **Authentication:** `login` → creates `app.sessions` row → returns token. `validate_session` and `check_capability` guard every subsequent call.
- **Authorization:** Dynamic roles (`roles` table) mapped to granular capabilities (`~80+` entries in `capabilities`). Employees have zero or more roles (`employee_roles`) plus optional direct capability grants (`employee_capabilities`).
- **Routing:** After login, the frontend reads the employee's capabilities and renders the appropriate navigation tree. Pages check capabilities before rendering.

## 4. Entity Framework

### Core Business Entities

| Domain | Tables | Purpose |
|--------|--------|---------|
| **People** | `identities`, `customers`, `employees` | Authenticated users, business customers, staff |
| **Locations** | `unified_locations` | Single GPS address repository |
| **Customer Contacts** | `customer_contacts` | Phone numbers and contact names per customer |
| **Products** | `products`, `product_units`, `companies`, `inventory` | Product catalog (~700 SKUs), unit types, brands, manual stock |
| **Orders** | `orders`, `order_items`, `order_status_history`, `order_modification_history`, `order_daily_deals`, `order_flash_offers`, `delivery_tracking` | Full order lifecycle |
| **Collections** | `collections`, `treasury_transactions` | Payment recording and money movement |
| **Returns** | `returns`, `return_items`, `return_inspection` | Product returns and re-entry inspection |
| **Credit** | `credit_applications`, `customer_credit_accounts`, `customer_credit_ledger`, `credit_programs`, `credit_invoices`, `credit_invoice_cheques`, `credit_contract_templates`, `credit_contracts` | Buy-now-pay-later workflow |
| **Auctions** | `auctions`, `auction_items`, `auction_bids`, `auction_participants`, `auction_activity`, `auction_awards` | Auction sales with winning bids and 1-hour award windows |
| **Pricing** | `tiers`, `tier_company_exceptions`, `tier_product_exceptions`, `tier_exceptions` | Multi-level customer pricing |
| **Targets** | `company_monthly_targets`, `employee_monthly_targets` | Sales targets |
| **Access Control** | `capabilities`, `roles`, `employee_roles`, `role_capabilities`, `employee_capabilities` | Granular permission system |
| **Sequences** | `code_sequences` | Year-based code generation for orders, collections, customers |
| **Company Info** | `company_profile` | Single-row company display data |
| **Warehouse** | `preparation_records`, `preparation_exceptions` | Prep tracking (not yet in use) |
| **Misc** | `employee_advances`, `customer_ownership_history`, `app.sessions` | Advances, audit, auth sessions |

## 5. Official Sources of Truth

| Concept | Source of Truth | Also Stored In | Status |
|---------|----------------|----------------|--------|
| **Customer Identity** | `identities` (email, phone, password_hash) | `customer_contacts.phone` | Duplicated (see Gap 1) |
| **Customer Company Info** | `customers` (company_name, code, location_id, etc.) | — | Clean |
| **Customer Phone (Display)** | `customer_contacts.phone` | `identities.phone` | Duplicated |
| **Customer Address** | `unified_locations` (via `customers.location_id`) | `customer_addresses` (legacy) | Dual system (see Gap 2) |
| **Employee Info** | `employees` + `identities` | — | Clean |
| **Product Catalog** | `products` + `product_units` | — | Clean |
| **Order Data (Live)** | `orders` + `order_items` + related tables | — | Clean |
| **Order Data (Historical)** | Order snapshot fields (frozen copies at order time) | Live `customers`, `identities`, etc. | By design, but creates dual read paths |
| **Pricing** | `tiers` + exception tables | — | Clean |
| **Inventory** | `inventory` (manual) | — | No external integration |

## 6. Deprecated / Unused Elements

See `06_UNUSED_AND_DUPLICATED.md` for full details.

| Category | Items | Action |
|----------|-------|--------|
| **Unused Tables (no data)** | `daily_deals`, `flash_offers`, `expenses`, `preparation_records`, `preparation_exceptions`, `credit_contracts`, `employee_advances` | SAFE_TO_REMOVE (or keep as PLANNED) |
| **Unused Functions** | `multiline_test`, `test_func`, `test_ping2`, `test_ping3`, `test_rpc`, `test_setof` | SAFE_TO_REMOVE |
| **Deprecated Columns** | `customers.email`, `orders.snapshot_sender_*`, `orders.execution_lat/lng/accuracy/captured_at` | SAFE_TO_REMOVE (email pending RPC updates) |
| **Legacy Table** | `customer_addresses` (25 rows, needs migration) | NEEDS_MIGRATION |

## 7. Duplicated / Hybrid Elements

See `09_ARCHITECTURE_GAPS.md` for full analysis.

| Issue | Summary |
|-------|---------|
| **Phone in two tables** | `identities.phone` (auth) and `customer_contacts.phone` (display) — kept in sync by RPC, no DB constraint |
| **Address in two systems** | `customer_addresses` (legacy, 25 rows) vs `unified_locations` (current, ~30 rows) — 25 customers have no `location_id` |
| **Order snapshots** | 9 snapshot fields freeze customer/owner data at order time; `snapshot_sender_*` are dead columns |
| **Customer code formats** | `register_customer` uses `REG-XXXXXXXX` (random), `governed_create_customer` uses `CUS-YYYY-NNNNNN` (sequential) |
| **Execution location** | Raw GPS columns (`execution_latitude` etc.) plus FK to `unified_locations` — dual recording |
| **Year-based code reset** | `code_sequences` PK `(code_type, year)` resets every year, creating non-unique codes across years |
| **Polymorphic ownership** | `owner_type/owner_id` pattern in customers/orders/returns — no FK enforcement |
| **Tier exceptions** | No unique constraint on `(tier_id, customer_id)` — duplicates possible |
| **Inventory** | Manual tracking with no warehouse integration |

## 8. Cleanup Roadmap

See `08_CLEANUP_CANDIDATES.md` for full classification.

### Phase A — Immediate (Safe to Remove)
1. Drop 6 test functions (`multiline_test`, `test_func`, `test_ping2`, `test_ping3`, `test_rpc`, `test_setof`)
2. Drop `orders.snapshot_sender_name`, `snapshot_sender_phone`, `snapshot_sender_address` columns
3. Drop `orders.execution_latitude`, `execution_longitude`, `execution_accuracy_meters`, `execution_captured_at` columns
4. Update RPCs to stop accepting `email` parameter; then drop `customers.email` column

### Phase B — Migration Required
5. Create `unified_locations` rows for the 25 customers who have `customer_addresses` data; link via `customers.location_id`; drop `customer_addresses`
6. Unify customer code generation — pick one format (recommended: `CUS-YYYY-NNNNNN` via `governed_create_customer`), update `register_customer`, and recode all 25 existing customers
7. Unify employee codes and recode all 16 employees to a single format
8. Migrate `code_sequences` from year-based PK to lifetime unique codes; recode all 38 orders and all collections
9. Add unique constraint on `tier_exceptions (tier_id, customer_id)`

### Phase C — Strategic
10. Evaluate the two phone columns — either add a sync trigger or consolidate to one source
11. Evaluate the two execution location recording methods — decide whether to keep raw GPS, FK, or both
12. Evaluate inventory integration with a real warehouse/WMS system
13. Consider adding a type-safe ownership model (concrete FKs) to replace the polymorphic `owner_type/owner_id` pattern

## 9. Key Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Date-based code reset** | Medium | Order and collection numbers reset yearly. Non-unique codes across years create potential for confusion and data merge issues. |
| **Dual address system** | High | 25 customers have no linked location. The frontend cannot display or use their address until migration is complete. |
| **Polymorphic ownership** | Low | `owner_type` as a string without FK enforcement is fragile. Currently always `'employee'`, but has no guard rails. |
| **Inventory accuracy** | High | Manual stock tracking with no warehouse integration means inventory counts are trust-based. Over-selling is possible. |
| **Code format fragmentation** | Medium | Two RPCs generate customer codes in different formats. New customer records have inconsistent identifiers. |

## 10. Next Actions

1. **Clean up test functions and dead columns** — low effort, high hygiene value
2. **Migrate customer_addresses → unified_locations** — unblocks 25 customers who currently have no accessible address
3. **Unify customer/employee code generation** — pick a single format and recode all records
4. **Fix code_sequences PK** — prevent future year-crossing collisions
5. **Add tier_exceptions unique constraint** — prevent pricing data corruption
6. **Audit all RPCs** — verify they match the current frontend code and drop unused parameters (e.g., `email`)
7. **Document the snapshot field convention** — make it explicit that order display code should read `snapshot_*` fields, not live joins, for historical accuracy
