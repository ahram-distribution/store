# DATABASE ARCHITECTURE — Ahram Distribution

**Last updated:** 2026-06-05  
**Source:** Phase 3 Recovery Report, live DB inspection, migration files

---

## Schema Overview

| Schema | Purpose | Key Objects |
|---|---|---|
| `public` | All business data | 57 tables, 14 enums, 205+ functions |
| `app` | Auth sessions, RLS helpers | `sessions` table, 9 SECURITY INVOKER functions |
| `api` | Auth entry points | `login`, `logout`, `validate_session` (plpgsql) |
| `auth` | Supabase built-in auth | Reserved for Supabase Auth |

## Table Inventory

### Core Identity & Access (6 tables)
`identities`, `employees`, `roles`, `capabilities`, `employee_roles`, `employee_capabilities`

### Customer Management (5 tables)
`customers`, `customer_addresses`, `customer_contacts`, `customer_ownership_history`, `customer_credit_ledger`

### Product & Pricing (5 tables)
`products`, `product_units`, `inventory`, `tiers`, `tier_exceptions`
and `tier_company_exceptions`, `tier_product_exceptions`

### Order System (6 tables)
`orders`, `order_items`, `order_status_history`, `order_modification_history`, `order_daily_deals`, `order_flash_offers`

### Warehouse & Delivery (5 tables)
`preparation_records`, `preparation_exceptions`, `delivery_tracking`, `delivery_tracking`

### Credit Module (7 tables)
`credit_programs`, `credit_applications`, `credit_contracts`, `credit_contract_templates`, `customer_credit_accounts`, `credit_invoices`, `credit_invoice_cheques`

### Collections & Finance (4 tables)
`collections`, `treasury_transactions`, `expenses`, `employee_advances`

### Returns (3 tables)
`returns`, `return_items`, `return_inspection`

### Visits (1 table)
`visits`

### Deals & Offers (4 tables)
`daily_deals`, `daily_deal_items`, `flash_offers`, `flash_offer_items`

### Auctions (11 tables — V1 + V2)
V1: `auctions`, `auction_bids`, `auction_participants`, `auction_awards`, `auction_items`, `auction_activity`
V2: `auctions_v2`, `auction_bids_v2`, `auction_participants_v2`, `auction_items_v2`, `auction_activity_v2`, `auction_deposits_v2`

### Other (5 tables)
`companies`, `code_sequences`, `unified_locations`, `company_profile`, `sessions` (in `app` schema)

## Custom Enum Types (14)

| Type | Values |
|---|---|
| `identity_type` | employee, customer |
| `business_type` | wholesaler, distributor, cosmetics_store, supermarket, hypermarket, perfume_store, pharmacy, restaurant, cafe, hotel, clinic, other |
| `auction_status` | pending, live, ended, awarded, cancelled |
| `auction_participant_status` | pending, approved, rejected, blocked |
| `daily_deal_status` | draft, scheduled, active, sold_out, expired, cancelled |
| `flash_offer_status` | draft, scheduled, active, sold_out, expired, cancelled |
| `credit_account_status` | active, suspended, closed |
| `credit_application_status` | draft, submitted, under_review, documents_received, approved, rejected, suspended |
| `credit_invoice_status` | open, paid, overdue |
| `cheque_status` | received, deposited, collected, cancelled, returned, paid_directly |
| `ledger_transaction_type` | debit, credit |
| `grant_type` | grant, deny |
| `preparation_status` | in_progress, completed, reviewed, failed |
| `preparation_exception_type` | missing_quantity, missing_product, damaged_product, incomplete_order, other |

## Governor RPCs (118+)

All mutation and query RPCs follow the pattern:
- `SECURITY DEFINER` (runs as DB owner)
- `search_path = public, extensions`
- Validates session via `v_session app.sessions`
- Calls `check_capability()` for authorization

## Migration Files (32 total)

| File | Tables Created |
|---|---|
| `000_schema.sql` | Placeholder |
| `20260531_phase*` | All foundation tables (identity, customers, products, orders, collections, returns, visits, packages, auctions V1) |
| `20260602_*` | Customer registration, operational completion |
| `20260603_tier_*` | Tiers, tier exceptions |
| `20260603_daily_deals` | Daily deals |
| `20260603_flash_offers` | Flash offers |
| `20260603_auction_v2` | Auction V2 tables |
| `20260603_recovery_missing_tables` | **Recovery**: app.sessions, credit_programs, credit_applications, credit_contracts, credit_contract_templates, delivery_tracking, preparation_records, preparation_exceptions, company_profile |
| `20260604_unified_identity_location` | unified_locations |
| `20260604_credit_programs_v2` | customer_credit_accounts, credit_invoices, credit_invoice_cheques |
| `20260604_governance_rpcs` | (functions only) |
| `20260605_customer_direct_ownership` | (functions + ownership) |
| `20260606_customer_visibility_fix` | (functions only) |
| `20260607_recovery_missing_functions` | **Recovery**: 92 functions restored from live DB |

## Key Dependencies

```
credit_programs ──→ credit_applications ──→ credit_contracts
                                      ↕
                            customer_credit_accounts
                                      ↕
                              credit_invoices ──→ credit_invoice_cheques
                                                    
orders ──→ preparation_records ──→ preparation_exceptions
orders ──→ delivery_tracking
```
