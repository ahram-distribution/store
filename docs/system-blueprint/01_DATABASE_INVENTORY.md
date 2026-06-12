# Database Inventory

> Comprehensive inventory of all database objects in the `public` schema (plus `app.sessions`).
> Generated from live schema introspection and code analysis.
> Date: 2026-06-09

---

## 1. Tables (53 public + 1 app)

### 1.1 Core Customer & Employee Domain

| # | Table | Purpose | Status | Data | Dependencies |
|---|-------|---------|--------|------|-------------|
| 1 | `customers` | Registered business entities that place orders. Owned by Sales Representatives. | **Active** | 25 rows | identities, employees, unified_locations |
| 2 | `customer_addresses` | Multiple addresses per customer for shipping, billing, and other purposes. | **Active** | Yes | customers |
| 3 | `customer_contacts` | Multiple contacts per customer with names, phones, and roles. | **Active** | Yes | customers |
| 4 | `customer_ownership_history` | Audit trail of customer ownership changes. INSERT-only — no UPDATE or DELETE. | **Active** | Yes | customers, employees |
| 5 | `employees` | Employee personnel records. Each employee has a manager in the sales hierarchy. | **Active** | 16 rows | identities (self-ref manager_id) |
| 6 | `employee_roles` | Junction table linking employees to roles. Supports multiple roles per employee. | **Active** | Yes | employees, roles |
| 7 | `employee_capabilities` | Direct capability assignments to specific employees, overriding role-based capabilities. | **Active** | Yes | employees, capabilities |
| 8 | `employee_advances` | Advances paid to employees. Creates an employee liability. | **Active** | Yes | employees |
| 9 | `employee_monthly_targets` | Monthly performance targets for employees. Arabic comment in schema. | **Active** | Yes | employees |
| 10 | `identities` | Single source of truth for authentication and phone uniqueness across employees and customers. | **Active** | ~32 rows | — (referenced by customers, employees) |
| 11 | `roles` | Dynamic role definitions. Roles are stored as data, not hardcoded. | **Active** | Yes | — |
| 12 | `capabilities` | Granular permission definitions. Each capability represents a single action. | **Active** | Yes | — |
| 13 | `role_capabilities` | Junction table linking roles to capabilities. Defines what each role can do. | **Active** | Yes | roles, capabilities |

### 1.2 Product & Company Domain

| # | Table | Purpose | Status | Data | Dependencies |
|---|-------|---------|--------|------|-------------|
| 14 | `products` | Supported sales units per product. Single source of truth for available units. | **Active** | ~700+ rows | companies |
| 15 | `product_units` | Unit-of-measure definitions per product. | **Active** | Yes | products |
| 16 | `companies` | Product manufacturers or brands. | **Active** | ~50+ rows | unified_locations (inferred) |
| 17 | `company_profile` | Company profile details. | **Active** | Yes | companies |
| 18 | `company_monthly_targets` | Monthly sales targets per company. Arabic comment in schema. | **Active** | Yes | companies |
| 19 | `inventory` | Manual inventory tracking. One record per product (1:1). Quantity deducted at order approval. | **Active** | Yes | products |

### 1.3 Orders & Transactions Domain

| # | Table | Purpose | Status | Data | Dependencies |
|---|-------|---------|--------|------|-------------|
| 20 | `orders` | Customer orders with full lifecycle tracking. | **Active** | 38 rows | customers, employees, tiers, unified_locations |
| 21 | `order_items` | Line items within an order. Prices captured at order time. | **Active** | 394 rows | orders, products |
| 22 | `order_status_history` | Complete audit trail of every status change in an order lifecycle. | **Active** | Yes | orders |
| 23 | `order_modification_history` | Audit trail of modifications made to orders after submission. | **Active** | Yes | orders |
| 24 | `order_daily_deals` | Links daily deals to orders. Snapshots fixed_price at order time. | **Active** | Yes | orders, daily_deals |
| 25 | `order_flash_offers` | Links flash offers to orders. Snapshots fixed_price at order time. | **Active** | Yes | orders, flash_offers |

### 1.4 Returns Domain

| # | Table | Purpose | Status | Data | Dependencies |
|---|-------|---------|--------|------|-------------|
| 26 | `returns` | Sales returns initiated against delivered orders. Credit note generated on approval. | **Active** | Yes | orders |
| 27 | `return_items` | Line items within a return. | **Active** | Yes | returns, products |
| 28 | `return_inspection` | Inspection results for each returned item. Determines inventory reentry. | **Active** | Yes | return_items |

### 1.5 Collections & Treasury Domain

| # | Table | Purpose | Status | Data | Dependencies |
|---|-------|---------|--------|------|-------------|
| 29 | `collections` | Payment collections from customers. Affects customer ledger balance. | **Active** | Yes | customers, employees |
| 30 | `expenses` | Operational expenditures against the single treasury. | **Active** | Yes | — |
| 31 | `treasury_transactions` | Records every fund movement in or out of the single treasury. | **Active** | Yes | — |

### 1.6 Credit Domain

| # | Table | Purpose | Status | Data | Dependencies |
|---|-------|---------|--------|------|-------------|
| 32 | `credit_programs` | Credit program definitions. | **Active** | Yes | — |
| 33 | `credit_contract_templates` | Templates for credit contracts. | **Active** | Yes | — |
| 34 | `credit_applications` | Customer credit applications. | **Active** | Yes | customers, credit_programs |
| 35 | `credit_contracts` | Signed credit contracts. | **Active** | Yes | credit_applications |
| 36 | `customer_credit_accounts` | Active credit accounts per customer. One account per customer. | **Active** | Yes | customers, credit_programs |
| 37 | `customer_credit_ledger` | Running credit balance for each customer. INSERT-only — no UPDATE or DELETE allowed. | **Active** | Yes | customer_credit_accounts |
| 38 | `credit_invoices` | Per-order credit invoices. Each approved credit order generates one invoice. | **Active** | Yes | orders, customer_credit_accounts |
| 39 | `credit_invoice_cheques` | One cheque per invoice. One-to-one relationship. | **Active** | Yes | credit_invoices |
| 40 | `delivery_tracking` | Delivery tracking records. | **Active** | Yes | orders (inferred) |

### 1.7 Sales & Commercial Packages Domain

| # | Table | Purpose | Status | Data | Dependencies |
|---|-------|---------|--------|------|-------------|
| 41 | `visits` | Sales Representative visits to customers with GPS check-in/out and results. | **Active** | Yes | employees, customers, unified_locations |
| 42 | `daily_deals` | Daily Deal commercial packages. Fixed-price bundles of products. | **Active** | Yes | — |
| 43 | `daily_deal_items` | Products included in a daily deal with their quantities. | **Active** | Yes | daily_deals, products |
| 44 | `flash_offers` | Flash Offer countdown-driven commercial packages. | **Active** | Yes | — |
| 45 | `flash_offer_items` | Products included in a flash offer with their quantities. | **Active** | Yes | flash_offers, products |

### 1.8 Auctions Domain

| # | Table | Purpose | Status | Data | Dependencies |
|---|-------|---------|--------|------|-------------|
| 46 | `auctions` | Live B2B auction room. Mobile-first realtime bidding. | **Active** | Yes | — |
| 47 | `auction_items` | Products included in an auction package with quantities. | **Active** | Yes | auctions, products |
| 48 | `auction_participants` | Registered participants for each auction with deposit/approval status. | **Active** | Yes | auctions, customers |
| 49 | `auction_bids` | Bid records. is_winning updated in realtime. | **Active** | Yes | auction_participants |
| 50 | `auction_awards` | Winner awards. 1hr confirmation window. | **Active** | Yes | auctions, auction_participants |
| 51 | `auction_activity` | Realtime activity feed for auction room. | **Active** | Yes | auctions |

### 1.9 Supporting & Infrastructure

| # | Table | Purpose | Status | Data | Dependencies |
|---|-------|---------|--------|------|-------------|
| 52 | `unified_locations` | Unified location record reused across all modules. | **Active** | Yes | — (referenced by customers, visits, orders) |
| 53 | `code_sequences` | Atomic sequence counters for generating human-readable business codes. One row per (code_type, year). | **Active** | Yes | — (used by generate_* functions) |
| 54 | `tiers` | Pricing tiers for differentiated customer pricing. | **Active** | Yes | — |
| 55 | `tier_exceptions` | Override default tier for specific customers. Historical records retained. | **Active** | Yes | tiers, customers |
| 56 | `tier_company_exceptions` | Per-company discount overrides for tiers. Takes priority over tier default discount. | **Active** | Yes | tiers, companies |
| 57 | `tier_product_exceptions` | Per-product discount overrides for tiers. appliesToAllTiers flag. | **Active** | Yes | tiers, products |
| 58 | `preparation_records` | Order preparation tracking records. | **Active** | Yes | orders (inferred) |
| 59 | `preparation_exceptions` | Exceptions flagged during order preparation. | **Active** | Yes | preparation_records (inferred) |

### 1.10 `app` Schema

| # | Table | Purpose | Status | Data | Dependencies |
|---|-------|---------|--------|------|-------------|
| 60 | `app.sessions` | Authentication sessions table. | **Active** | Yes | identities |

---

## 2. Views

| Type | Count | Notes |
|------|-------|-------|
| Views | **0** | No views in `public` schema |
| Materialized Views | **0** | None exist |

---

## 3. Functions / RPCs (69 total)

### 3.1 Authentication & Session

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 1 | `login` | sql (passthrough) | json | VOLATILE | Login wrapper delegating to `api.login` | **Active** |
| 2 | `logout` | sql (passthrough) | json | VOLATILE | Logout wrapper delegating to `api.logout` | **Active** |
| 3 | `validate_session` | sql (passthrough) | json | VOLATILE | Session validation wrapper delegating to `api.validate_session` | **Active** |

### 3.2 Authorization & Visibility

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 4 | `check_capability` | plpgsql | boolean | VOLATILE | Checks if employee has capability via roles or direct assignments | **Active** |
| 5 | `get_visible_employee_ids` | plpgsql | uuid[] | VOLATILE | Returns employee IDs this user can see based on hierarchy | **Active** |
| 6 | `governed_check_customer_capability` | plpgsql | json | VOLATILE | Checks if a customer has a specific capability | **Active** |

### 3.3 Code Generation

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 7 | `generate_collection_number` | sql | varchar | VOLATILE | Generates next collection code from `code_sequences` | **Active** |
| 8 | `generate_order_number` | sql | varchar | VOLATILE | Generates next order number from `code_sequences` | **Active** |

### 3.4 CRUD — Customers

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 9 | `governed_create_customer` | plpgsql | jsonb | VOLATILE | Creates customer with code, identity, location, contact, assigns to rep | **Active** |
| 10 | `governed_update_customer` | plpgsql | jsonb | VOLATILE | Updates customer fields, identity, location, contact | **Active** |
| 11 | `register_customer` | plpgsql | json | VOLATILE | Self-registration for customers (creates identity, customer, location, contact, session) | **Active** |
| 12 | `governed_reassign_customer_ownership` | plpgsql | jsonb | VOLATILE | Reassigns customer ownership, records history | **Active** |

### 3.5 CRUD — Employees

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 13 | `governed_create_employee` | plpgsql | jsonb | VOLATILE | Creates employee with code, identity, role | **Active** |
| 14 | `governed_update_employee` | plpgsql | jsonb | VOLATILE | Updates employee fields, identity | **Active** |
| 15 | `governed_update_employee_capabilities` | plpgsql | jsonb | VOLATILE | Updates employee direct capabilities | **Active** |

### 3.6 CRUD — Products & Companies

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 16 | `governed_create_product` | plpgsql | jsonb | VOLATILE | Creates product | **Active** |
| 17 | `governed_update_product` | plpgsql | jsonb | VOLATILE | Updates product | **Active** |
| 18 | `governed_update_product_pricing` | plpgsql | jsonb | VOLATILE | Updates product pricing | **Active** |
| 19 | `governed_update_product_units` | plpgsql | jsonb | VOLATILE | Updates product units | **Active** |
| 20 | `governed_create_company` | plpgsql | jsonb | VOLATILE | Creates company | **Active** |
| 21 | `governed_update_company` | plpgsql | jsonb | VOLATILE | Updates company | **Active** |
| 22 | `governed_update_company_profile` | plpgsql | json | VOLATILE | Updates company profile | **Active** |
| 23 | `governed_upsert_company_monthly_target` | plpgsql | jsonb | VOLATILE | Creates or updates company monthly target | **Active** |
| 24 | `governed_upsert_employee_monthly_target` | plpgsql | jsonb | VOLATILE | Creates or updates employee monthly target | **Active** |

### 3.7 CRUD — Orders

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 25 | `governed_create_order` | plpgsql | jsonb | VOLATILE | Creates order with number, items, snapshots | **Active** |
| 26 | `governed_approve_order` | plpgsql | returns | VOLATILE | Approves order, updates inventory, creates credit invoice if credit | **Active** |
| 27 | `governed_deny_order` | plpgsql | returns | VOLATILE | Denies/approves order | **Active** |

### 3.8 CRUD — Returns

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 28 | `governed_create_return` | plpgsql | returns | VOLATILE | Creates return with code, items | **Active** |
| 29 | `governed_update_return` | plpgsql | returns | VOLATILE | Updates return notes | **Active** |

### 3.9 CRUD — Collections & Treasury

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 30 | `governed_create_collection` | plpgsql | collections | VOLATILE | Creates collection with code | **Active** |
| 31 | `governed_update_collection` | plpgsql | jsonb | VOLATILE | Updates collection | **Active** |

### 3.10 CRUD — Visits & Locations

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 32 | `governed_create_visit` | plpgsql | jsonb | VOLATILE | Creates visit with code, GPS | **Active** |
| 33 | `governed_update_visit` | plpgsql | jsonb | VOLATILE | Updates visit notes/result | **Active** |
| 34 | `governed_checkin_visit` | plpgsql | jsonb | VOLATILE | Check-in to a visit with GPS, generates code | **Active** |
| 35 | `governed_checkout_visit` | plpgsql | jsonb | VOLATILE | Check-out from a visit with GPS | **Active** |
| 36 | `governed_create_location` | plpgsql | jsonb | VOLATILE | Creates unified location | **Active** |

### 3.11 CRUD — Commercial Packages

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 37 | `governed_create_daily_deal` | plpgsql | jsonb | VOLATILE | Creates daily deal | **Active** |
| 38 | `governed_update_daily_deal` | plpgsql | jsonb | VOLATILE | Updates daily deal | **Active** |
| 39 | `governed_create_flash_offer` | plpgsql | jsonb | VOLATILE | Creates flash offer | **Active** |
| 40 | `governed_update_flash_offer` | plpgsql | jsonb | VOLATILE | Updates flash offer | **Active** |

### 3.12 CRUD — Auctions

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 41 | `governed_create_auction` | plpgsql | jsonb | VOLATILE | Creates auction with code | **Active** |

### 3.13 CRUD — Tiers

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 42 | `governed_create_tier` | plpgsql | jsonb | VOLATILE | Creates pricing tier | **Active** |
| 43 | `governed_update_tier` | plpgsql | jsonb | VOLATILE | Updates pricing tier | **Active** |

### 3.14 CRUD — Contracts & Programs

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 44 | `governed_create_credit_program` | plpgsql | credit_programs | VOLATILE | Creates credit program | **Active** |
| 45 | `governed_update_credit_program` | plpgsql | credit_programs | VOLATILE | Updates credit program | **Active** |
| 46 | `governed_toggle_credit_program` | plpgsql | credit_programs | VOLATILE | Toggles credit program active status | **Active** |
| 47 | `governed_update_contract_template` | plpgsql | credit_contract_templates | VOLATILE | Updates contract template | **Active** |

### 3.15 Credit Management

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 48 | `governed_create_credit_application` | plpgsql | credit_applications | VOLATILE | Creates credit application | **Active** |
| 49 | `governed_submit_credit_application` | plpgsql | credit_applications | VOLATILE | Submits draft application for review | **Active** |
| 50 | `governed_manage_credit_application` | plpgsql | credit_applications | VOLATILE | Manages credit application (approve with account creation) | **Active** |
| 51 | `governed_decline_credit` | plpgsql | credit_applications | VOLATILE | Declines a credit application | **Active** |
| 52 | `governed_suspend_credit` | plpgsql | credit_applications | VOLATILE | Suspends approved credit application | **Active** |
| 53 | `governed_get_customer_applications` | plpgsql | jsonb | VOLATILE | Gets credit applications for a customer | **Active** |
| 54 | `governed_get_customer_credit_account` | plpgsql | jsonb | VOLATILE | Gets customer credit account | **Active** |
| 55 | `governed_get_customer_credit_ledger` | plpgsql | jsonb | VOLATILE | Gets customer credit ledger entries | **Active** |
| 56 | `governed_get_customer_monthly_statements` | plpgsql | jsonb | VOLATILE | Gets monthly credit statements | **Active** |
| 57 | `governed_get_customers_without_credit` | plpgsql | jsonb | VOLATILE | Lists customers without credit accounts | **Active** |
| 58 | `governed_reserve_credit` | plpgsql | jsonb | VOLATILE | Reserves credit for an order | **Active** |
| 59 | `governed_release_credit_reservation` | plpgsql | jsonb | VOLATILE | Releases a credit reservation | **Active** |
| 60 | `governed_pay_credit_invoice` | plpgsql | jsonb | VOLATILE | Pays credit invoice, updates ledger, creates treasury transaction | **Active** |
| 61 | `governed_register_cheque` | plpgsql | jsonb | VOLATILE | Registers cheque for invoice payment | **Active** |
| 62 | `governed_suspend_credit_account` | plpgsql | jsonb | VOLATILE | Suspends customer credit account | **Active** |

### 3.16 Health & Test

| # | Name | Language | Return Type | Volatility | Purpose | Status |
|---|------|----------|-------------|------------|---------|--------|
| 63 | `ping` | plpgsql | json | VOLATILE | Health check | **Active** |
| 64 | `test_func` | sql | integer | VOLATILE | Test (x * 2) | **Inactive — Test** |
| 65 | `test_ping2` | plpgsql | json | VOLATILE | Test | **Inactive — Test** |
| 66 | `test_ping3` | plpgsql | json | VOLATILE | Test | **Inactive — Test** |
| 67 | `test_rpc` | plpgsql | jsonb | VOLATILE | Test with session check | **Inactive — Test** |
| 68 | `test_setof` | plpgsql | SETOF uuid | VOLATILE | Test | **Inactive — Test** |
| 69 | `multiline_test` | plpgsql | json | VOLATILE | Test function (returns {ok: true}) | **Inactive — Test** |

---

## 4. Triggers

| Type | Count | Notes |
|------|-------|-------|
| Triggers | **0** | No triggers defined in `public` schema. Project uses Row Level Security (RLS) via Supabase instead of trigger-based enforcement. |

---

## 5. Sequences

| Schema | Count | Notes |
|--------|-------|-------|
| `public` | **0** | No sequences in `public` schema. Sequence functionality is implemented via the `code_sequences` table. |

---

## 6. Enums (14)

| # | Enum Name | Values | Used By |
|---|-----------|--------|---------|
| 1 | `auction_participant_status` | `pending, approved, rejected, blocked` | auction_participants |
| 2 | `auction_status` | `pending, live, ended, awarded, cancelled` | auctions |
| 3 | `business_type` | `wholesaler, distributor, cosmetics_store, supermarket, hypermarket, perfume_store, pharmacy, warehouse, other` | customers |
| 4 | `cheque_status` | `received, deposited, collected, cancelled, returned, paid_directly` | credit_invoice_cheques |
| 5 | `credit_account_status` | `active, suspended, closed` | customer_credit_accounts |
| 6 | `credit_application_status` | `draft, submitted, under_review, documents_received, approved, rejected, suspended` | credit_applications |
| 7 | `credit_invoice_status` | `open, paid, overdue` | credit_invoices |
| 8 | `daily_deal_status` | `draft, scheduled, active, sold_out, expired, cancelled` | daily_deals |
| 9 | `flash_offer_status` | `draft, scheduled, active, sold_out, expired, cancelled` | flash_offers |
| 10 | `grant_type` | `grant, deny` | role_capabilities, employee_capabilities |
| 11 | `identity_type` | `employee, customer` | identities |
| 12 | `ledger_transaction_type` | `debit, credit` | customer_credit_ledger |
| 13 | `preparation_exception_type` | `missing_quantity, missing_product, damaged_product, incomplete_order, other` | preparation_exceptions |
| 14 | `preparation_status` | `in_progress, completed, reviewed, failed` | preparation_records |

---

## 7. Dependency Graph Summary

```
identities ◄── customers, employees
customers  ◄── orders, returns, collections, customer_addresses, customer_contacts,
               customer_credit_accounts, customer_ownership_history, credit_applications,
               tier_exceptions, visits, auction_participants
employees  ◄── orders, visits, employee_roles, employee_capabilities, employee_advances,
               employee_monthly_targets, customer_ownership_history
products   ◄── order_items, auction_items, daily_deal_items, flash_offer_items, inventory,
               return_items, product_units, tier_product_exceptions
orders     ◄── order_items, order_daily_deals, order_flash_offers, order_modification_history,
               order_status_history, returns, credit_invoices, delivery_tracking
roles      ◄── employee_roles, role_capabilities
capabilities ◄── role_capabilities, employee_capabilities
tiers      ◄── tier_exceptions, tier_company_exceptions, tier_product_exceptions
companies  ◄── products, company_monthly_targets, tier_company_exceptions
unified_locations ◄── customers, visits, orders
code_sequences ◄── generate_collection_number, generate_order_number (+ governed_create_* functions)
```

---

## 8. RPC Naming Convention Analysis

The codebase uses a consistent naming pattern for RPCs:

| Prefix | Meaning | Count |
|--------|---------|-------|
| `governed_create_*` | Governed create operations (wraps business logic + code gen + auth) | 14 |
| `governed_update_*` | Governed update operations | 14 |
| `governed_*` (other) | Other governed operations (approve, deny, checkin, etc.) | 27 |
| `generate_*` | Code generation from `code_sequences` | 2 |
| `check_*` / `get_*` | Read/check operations | 4 |
| `login` / `logout` / `validate_session` | Auth functions | 3 |
| `ping` / `test_*` / `multiline_test` | Health check and test functions | 7 |

**Note:** All `governed_*` functions are VOLATILE and appear to enforce Row Level Security policies programmatically, suggesting application-level authorization on top of Supabase RLS.
