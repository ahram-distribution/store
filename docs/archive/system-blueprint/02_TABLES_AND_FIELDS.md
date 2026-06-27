# Tables & Fields — Complete Reference

> Column-level documentation for all 53 public tables + `app.sessions`.
> Classification: **PRIMARY** = source of truth, **SECONDARY** = derived/denormalized, **LEGACY** = old/backward compat, **UNUSED** = no active reads/writes.

---

## customers

Registered business entities that place orders. Owned by Sales Representatives. **25 rows — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `identity_id` | uuid | YES | — | → identities.id | — | PRIMARY |
| `code` | varchar(20) | NOT NULL | — | — | — | PRIMARY |
| `company_name` | varchar(255) | NOT NULL | — | — | — | PRIMARY |
| `email` | varchar(255) | YES | — | — | — | PRIMARY |
| `credit_limit` | numeric | NOT NULL | `0` | — | — | PRIMARY |
| `credit_days` | integer | NOT NULL | `0` | — | — | PRIMARY |
| `owner_type` | varchar(20) | NOT NULL | `'employee'` | — | — | PRIMARY |
| `owner_id` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `is_active` | boolean | NOT NULL | `true` | — | — | PRIMARY |
| `registered_at` | timestamptz | YES | — | — | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |
| `updated_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |
| `business_type` | business_type (enum) | YES | — | — | — | PRIMARY |
| `responsible_name` | varchar(255) | YES | — | — | — | PRIMARY |
| `location_id` | uuid | YES | — | → unified_locations.id | — | PRIMARY |

**Status: ACTIVE.** All columns are PRIMARY — this table is the authoritative source for customer data. No denormalized or legacy fields detected.

---

## employees

Employee personnel records. Each employee has a manager in the sales hierarchy. **16 rows — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `identity_id` | uuid | NOT NULL | — | → identities.id | — | PRIMARY |
| `code` | varchar(20) | NOT NULL | — | — | — | PRIMARY |
| `full_name` | varchar(255) | NOT NULL | — | — | — | PRIMARY |
| `email` | varchar(255) | YES | — | — | — | PRIMARY |
| `manager_id` | uuid | YES | — | → employees.id (self) | — | PRIMARY |
| `is_active` | boolean | NOT NULL | `true` | — | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |
| `updated_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |
| `address` | text | YES | — | — | — | PRIMARY |

**Status: ACTIVE.** All columns PRIMARY. The self-referencing `manager_id` establishes the sales hierarchy used by `get_visible_employee_ids`.

---

## orders

Customer orders with full lifecycle tracking. **38 rows — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `order_number` | varchar(30) | NOT NULL | — | — | — | PRIMARY |
| `customer_id` | uuid | NOT NULL | — | → customers.id | — | PRIMARY |
| `owner_type` | varchar(20) | NOT NULL | `'employee'` | — | — | PRIMARY |
| `owner_id` | uuid | NOT NULL | — | — | — | PRIMARY |
| `status` | varchar(30) | NOT NULL | `'draft'` | — | — | PRIMARY |
| `subtotal` | numeric | NOT NULL | `0` | — | — | PRIMARY |
| `discount_amount` | numeric | NOT NULL | `0` | — | — | PRIMARY |
| `tax_amount` | numeric | NOT NULL | `0` | — | — | PRIMARY |
| `total_amount` | numeric | NOT NULL | `0` | — | — | PRIMARY |
| `notes` | text | YES | — | — | — | PRIMARY |
| `revision_number` | integer | NOT NULL | `1` | — | — | PRIMARY |
| `submitted_at` | timestamptz | YES | — | — | — | PRIMARY |
| `approved_at` | timestamptz | YES | — | — | — | PRIMARY |
| `delivered_at` | timestamptz | YES | — | — | — | PRIMARY |
| `cancelled_at` | timestamptz | YES | — | — | — | PRIMARY |
| `created_by` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |
| `updated_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |
| `deferred_until` | timestamptz | YES | — | — | — | PRIMARY |
| `defer_reason` | text | YES | — | — | — | PRIMARY |
| `cancel_reason` | text | YES | — | — | — | PRIMARY |
| `execution_latitude` | numeric | YES | — | — | — | SECONDARY |
| `execution_longitude` | numeric | YES | — | — | — | SECONDARY |
| `execution_accuracy_meters` | numeric | YES | — | — | — | SECONDARY |
| `execution_captured_at` | timestamptz | YES | — | — | — | SECONDARY |
| `tier_id` | uuid | YES | — | → tiers.id | — | PRIMARY |
| `effective_discount_percent` | numeric | YES | — | — | — | SECONDARY |
| `payment_method` | varchar(20) | YES | `'cash'` | — | — | PRIMARY |
| `execution_location_id` | uuid | YES | — | | — | PRIMARY |
| `snapshot_customer_name` | text | YES | — | — | — | SECONDARY |
| `snapshot_customer_phone` | text | YES | — | — | — | SECONDARY |
| `snapshot_customer_address` | text | YES | — | — | — | SECONDARY |
| `snapshot_owner_name` | text | YES | — | — | — | SECONDARY |
| `snapshot_owner_phone` | text | YES | — | — | — | SECONDARY |
| `snapshot_owner_address` | text | YES | — | — | — | SECONDARY |
| `snapshot_sender_name` | text | YES | — | — | — | SECONDARY |
| `snapshot_sender_phone` | text | YES | — | — | — | SECONDARY |
| `snapshot_sender_address` | text | YES | — | — | — | SECONDARY |

**Status: ACTIVE.** Snapshot columns are SECONDARY — they denormalize customer/owner/sender data at order time for historical accuracy. `execution_*` columns are SECONDARY (GPS execution data). `effective_discount_percent` is SECONDARY (denormalized from the tier at order time). All other fields are PRIMARY.

---

## identities

Single source of truth for authentication and phone uniqueness across employees and customers. **~32 rows — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `phone` | (inferred: varchar) | (likely NOT NULL) | — | — | UNIQUE | PRIMARY |
| `identity_type` | identity_type (enum) | (likely NOT NULL) | — | — | — | PRIMARY |
| (additional auth fields inferred: password_hash, etc.) | | | | | | |

**Status: ACTIVE.** Referenced by both `customers.identity_id` and `employees.identity_id`. Full column list available in database schema.

---

## companies

Product manufacturers or brands. **~50+ rows — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `name` | (inferred) | NOT NULL | — | — | — | PRIMARY |
| (location, contact, other fields) | | | | | | |

**Status: ACTIVE.** Referenced by `products.company_id`, `company_monthly_targets`, `tier_company_exceptions`. Full column list available in database schema.

---

## products

Supported sales units per product. Single source of truth for available units. **~700+ rows — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `company_id` | uuid | (inferred NOT NULL) | — | → companies.id | — | PRIMARY |
| `name` / `description` | (inferred) | NOT NULL | — | — | — | PRIMARY |
| (pricing, unit, status fields) | | | | | | |

**Status: ACTIVE.** Largest table by size (4056 kB). Referenced by `order_items`, `inventory`, `auction_items`, `daily_deal_items`, `flash_offer_items`, `return_items`, `product_units`, `tier_product_exceptions`. Full column list available in database schema.

---

## product_units

Unit-of-measure definitions per product. **768 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `product_id` | uuid | NOT NULL | — | → products.id | — | PRIMARY |
| `unit_name` | varchar | NOT NULL | — | — | — | PRIMARY |
| `conversion_factor` | (inferred: numeric) | — | — | — | — | PRIMARY |
| (pricing per unit) | | | | | | |

**Status: ACTIVE.** Full column list available in database schema.

---

## unified_locations

Unified location record reused across all modules. **72 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `address` | text | (inferred) | — | — | — | PRIMARY |
| `latitude` | numeric | (inferred) | — | — | — | PRIMARY |
| `longitude` | numeric | (inferred) | — | — | — | PRIMARY |
| (other location fields) | | | | | | |

**Status: ACTIVE.** Referenced by `customers.location_id`, `visits.location_id`, `orders.execution_location_id`. Full column list available in database schema.

---

## code_sequences

Atomic sequence counters for generating human-readable business codes. One row per (code_type, year). **56 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `code_type` | varchar | NOT NULL | — | — | UNIQUE (composite with year) | PRIMARY |
| `year` | integer | NOT NULL | — | — | UNIQUE (composite) | PRIMARY |
| `last_sequence` | integer | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Used by `generate_collection_number`, `generate_order_number`, and governed create functions. Full column list available in database schema.

---

## roles

Dynamic role definitions. Roles are stored as data, not hardcoded. **80 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `name` | varchar | NOT NULL | — | — | UNIQUE | PRIMARY |
| `description` | text | YES | — | — | — | PRIMARY |

**Status: ACTIVE.** Referenced by `employee_roles` and `role_capabilities`. Full column list available in database schema.

---

## capabilities

Granular permission definitions. Each capability represents a single action. **104 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `code` | varchar | NOT NULL | — | — | UNIQUE | PRIMARY |
| `description` | text | YES | — | — | — | PRIMARY |

**Status: ACTIVE.** Referenced by `role_capabilities` and `employee_capabilities`. Full column list available in database schema.

---

## role_capabilities

Junction table linking roles to capabilities. Defines what each role can do. **200 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `role_id` | uuid | NOT NULL | — | → roles.id | — | PRIMARY |
| `capability_id` | uuid | NOT NULL | — | → capabilities.id | — | PRIMARY |
| `grant_type` | grant_type (enum) | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Junction table. Full column list available in database schema.

---

## employee_roles

Junction table linking employees to roles. Supports multiple roles per employee. **72 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `employee_id` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `role_id` | uuid | NOT NULL | — | → roles.id | — | PRIMARY |

**Status: ACTIVE.** Junction table. Full column list available in database schema.

---

## employee_capabilities

Direct capability assignments to specific employees, overriding role-based capabilities. **56 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `employee_id` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `capability_id` | uuid | NOT NULL | — | → capabilities.id | — | PRIMARY |
| `grant_type` | grant_type (enum) | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Override table. Full column list available in database schema.

---

## customer_addresses

Multiple addresses per customer for shipping, billing, and other purposes. **64 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `customer_id` | uuid | NOT NULL | — | → customers.id | — | PRIMARY |
| `address_type` | varchar | (inferred) | — | — | — | PRIMARY |
| `address_line` | text | NOT NULL | — | — | — | PRIMARY |
| (city, governorate, etc.) | | | | | | |

**Status: ACTIVE.** Full column list available in database schema.

---

## customer_contacts

Multiple contacts per customer with names, phones, and roles. **64 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `customer_id` | uuid | NOT NULL | — | → customers.id | — | PRIMARY |
| `contact_name` | varchar | NOT NULL | — | — | — | PRIMARY |
| `phone` | varchar | (inferred) | — | — | — | PRIMARY |
| `role` | varchar | YES | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## customer_ownership_history

Audit trail of customer ownership changes. INSERT-only — no UPDATE or DELETE. **64 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `customer_id` | uuid | NOT NULL | — | → customers.id | — | PRIMARY |
| `previous_owner_id` | uuid | (inferred) | — | → employees.id | — | PRIMARY |
| `new_owner_id` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `changed_by` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `changed_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** INSERT-only audit table. Full column list available in database schema.

---

## employee_advances

Advances paid to employees. Creates an employee liability. **32 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `employee_id` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `amount` | numeric | NOT NULL | — | — | — | PRIMARY |
| `advance_date` | date | (inferred) | — | — | — | PRIMARY |
| (repayment fields) | | | | | | |

**Status: ACTIVE.** Full column list available in database schema.

---

## employee_monthly_targets

Monthly performance targets for employees. Arabic comment in schema. **80 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `employee_id` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `year_month` | (inferred: date or varchar) | NOT NULL | — | — | — | PRIMARY |
| `target_amount` | numeric | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## company_profile

Company profile details. **32 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `company_id` | uuid | NOT NULL | — | → companies.id | — | PRIMARY |
| (profile fields) | | | | | | |

**Status: ACTIVE.** Full column list available in database schema.

---

## company_monthly_targets

Monthly sales targets per company. Arabic comment in schema. **64 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `company_id` | uuid | NOT NULL | — | → companies.id | — | PRIMARY |
| `year_month` | (inferred) | NOT NULL | — | — | — | PRIMARY |
| `target_amount` | numeric | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## inventory

Manual inventory tracking. One record per product (1:1). Quantity deducted at order approval. **24 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `product_id` | uuid | NOT NULL | — | → products.id (1:1) | UNIQUE | PRIMARY |
| `quantity` | numeric | NOT NULL | `0` | — | — | PRIMARY |
| `updated_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** 1:1 with products. Full column list available in database schema.

---

## order_items

Line items within an order. Prices captured at order time. **394 rows — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `order_id` | uuid | NOT NULL | — | → orders.id | — | PRIMARY |
| `product_id` | uuid | NOT NULL | — | → products.id | — | PRIMARY |
| `quantity` | numeric | NOT NULL | — | — | — | PRIMARY |
| `unit_price` | numeric | NOT NULL | — | — | — | PRIMARY |
| `total_price` | numeric | NOT NULL | — | — | — | PRIMARY |
| (unit, discount fields) | | | | | | |

**Status: ACTIVE.** Full column list available in database schema.

---

## order_status_history

Complete audit trail of every status change in an order lifecycle. **112 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `order_id` | uuid | NOT NULL | — | → orders.id | — | PRIMARY |
| `from_status` | varchar | (inferred) | — | — | — | PRIMARY |
| `to_status` | varchar | NOT NULL | — | — | — | PRIMARY |
| `changed_by` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `changed_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** Audit table. Full column list available in database schema.

---

## order_modification_history

Audit trail of modifications made to orders after submission. **32 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `order_id` | uuid | NOT NULL | — | → orders.id | — | PRIMARY |
| `modified_by` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `modified_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |
| `change_description` | text | (inferred) | — | — | — | PRIMARY |

**Status: ACTIVE.** Audit table. Full column list available in database schema.

---

## order_daily_deals

Links daily deals to orders. Snapshots `fixed_price` at order time. **32 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `order_id` | uuid | NOT NULL | — | → orders.id | — | PRIMARY |
| `daily_deal_id` | uuid | NOT NULL | — | → daily_deals.id | — | PRIMARY |
| `fixed_price` | numeric | NOT NULL | — | — | — | PRIMARY |
| `quantity` | numeric | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Snapshot table. Full column list available in database schema.

---

## order_flash_offers

Links flash offers to orders. Snapshots `fixed_price` at order time. **32 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `order_id` | uuid | NOT NULL | — | → orders.id | — | PRIMARY |
| `flash_offer_id` | uuid | NOT NULL | — | → flash_offers.id | — | PRIMARY |
| `fixed_price` | numeric | NOT NULL | — | — | — | PRIMARY |
| `quantity` | numeric | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Snapshot table. Full column list available in database schema.

---

## returns

Sales returns initiated against delivered orders. Credit note generated on approval. **112 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `order_id` | uuid | NOT NULL | — | → orders.id | — | PRIMARY |
| `return_number` | varchar | NOT NULL | — | — | — | PRIMARY |
| `status` | varchar | NOT NULL | — | — | — | PRIMARY |
| `total_amount` | numeric | NOT NULL | — | — | — | PRIMARY |
| `created_by` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |
| (approval, credit_note fields) | | | | | | |

**Status: ACTIVE.** Full column list available in database schema.

---

## return_items

Line items within a return. **24 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `return_id` | uuid | NOT NULL | — | → returns.id | — | PRIMARY |
| `product_id` | uuid | NOT NULL | — | → products.id | — | PRIMARY |
| `quantity` | numeric | NOT NULL | — | — | — | PRIMARY |
| `unit_price` | numeric | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## return_inspection

Inspection results for each returned item. Determines inventory reentry. **24 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `return_item_id` | uuid | NOT NULL | — | → return_items.id | — | PRIMARY |
| `condition` | (inferred: varchar) | NOT NULL | — | — | — | PRIMARY |
| `accepted_quantity` | numeric | (inferred) | — | — | — | PRIMARY |
| `rejected_quantity` | numeric | (inferred) | — | — | — | PRIMARY |
| `inspected_by` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## collections

Payment collections from customers. Affects customer ledger balance. **96 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `collection_number` | varchar | NOT NULL | — | — | — | PRIMARY |
| `customer_id` | uuid | NOT NULL | — | → customers.id | — | PRIMARY |
| `amount` | numeric | NOT NULL | — | — | — | PRIMARY |
| `collected_by` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `collected_at` | timestamptz | (inferred) | — | — | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## expenses

Operational expenditures against the single treasury. **40 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `description` | text | (inferred) | — | — | — | PRIMARY |
| `amount` | numeric | NOT NULL | — | — | — | PRIMARY |
| `expense_date` | date | (inferred) | — | — | — | PRIMARY |
| `category` | varchar | (inferred) | — | — | — | PRIMARY |
| `created_by` | uuid | (inferred) | — | → employees.id | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## treasury_transactions

Records every fund movement in or out of the single treasury. **40 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `transaction_type` | (inferred: varchar) | NOT NULL | — | — | — | PRIMARY |
| `amount` | numeric | NOT NULL | — | — | — | PRIMARY |
| `reference_type` | varchar | (inferred) | — | — | — | PRIMARY |
| `reference_id` | uuid | (inferred) | — | — | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** Central treasury ledger. Full column list available in database schema.

---

## credit_programs

Credit program definitions. **32 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `name` | varchar | NOT NULL | — | — | — | PRIMARY |
| `is_active` | boolean | NOT NULL | `true` | — | — | PRIMARY |
| (terms, interest, etc.) | | | | | | |

**Status: ACTIVE.** Referenced by `credit_applications`, `customer_credit_accounts`. Full column list available in database schema.

---

## credit_contract_templates

Templates for credit contracts. **32 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `name` | varchar | NOT NULL | — | — | — | PRIMARY |
| `content` | text | (inferred) | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## credit_applications

Customer credit applications. **80 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `customer_id` | uuid | NOT NULL | — | → customers.id | — | PRIMARY |
| `credit_program_id` | uuid | NOT NULL | — | → credit_programs.id | — | PRIMARY |
| `status` | credit_application_status (enum) | NOT NULL | `'draft'` | — | — | PRIMARY |
| `requested_limit` | numeric | (inferred) | — | — | — | PRIMARY |
| `submitted_at` | timestamptz | YES | — | — | — | PRIMARY |
| `reviewed_at` | timestamptz | YES | — | — | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## credit_contracts

Signed credit contracts. **32 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `application_id` | uuid | NOT NULL | — | → credit_applications.id | — | PRIMARY |
| `contract_number` | varchar | NOT NULL | — | — | — | PRIMARY |
| `signed_at` | timestamptz | (inferred) | — | — | — | PRIMARY |
| `content` | text | (inferred) | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## customer_credit_accounts

Active credit accounts per customer. One account per customer. **72 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `customer_id` | uuid | NOT NULL | — | → customers.id (1:1) | UNIQUE | PRIMARY |
| `credit_program_id` | uuid | NOT NULL | — | → credit_programs.id | — | PRIMARY |
| `status` | credit_account_status (enum) | NOT NULL | `'active'` | — | — | PRIMARY |
| `current_balance` | numeric | NOT NULL | `0` | — | — | PRIMARY |
| `credit_limit` | numeric | NOT NULL | — | — | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** 1:1 with customers. Full column list available in database schema.

---

## customer_credit_ledger

Running credit balance for each customer. INSERT-only — no UPDATE or DELETE allowed. **80 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `credit_account_id` | uuid | NOT NULL | — | → customer_credit_accounts.id | — | PRIMARY |
| `transaction_type` | ledger_transaction_type (enum) | NOT NULL | — | — | — | PRIMARY |
| `amount` | numeric | NOT NULL | — | — | — | PRIMARY |
| `balance_after` | numeric | NOT NULL | — | — | — | PRIMARY |
| `reference_type` | varchar | (inferred) | — | — | — | PRIMARY |
| `reference_id` | uuid | (inferred) | — | — | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** INSERT-only ledger. Full column list available in database schema.

---

## credit_invoices

Per-order credit invoices. Each approved credit order generates one invoice. **104 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `credit_account_id` | uuid | NOT NULL | — | → customer_credit_accounts.id | — | PRIMARY |
| `order_id` | uuid | NOT NULL | — | → orders.id | — | PRIMARY |
| `invoice_number` | varchar | NOT NULL | — | — | — | PRIMARY |
| `amount` | numeric | NOT NULL | — | — | — | PRIMARY |
| `status` | credit_invoice_status (enum) | NOT NULL | `'open'` | — | — | PRIMARY |
| `due_date` | date | (inferred) | — | — | — | PRIMARY |
| `paid_at` | timestamptz | YES | — | — | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## credit_invoice_cheques

One cheque per invoice. One-to-one relationship. **72 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `credit_invoice_id` | uuid | NOT NULL | — | → credit_invoices.id (1:1) | UNIQUE | PRIMARY |
| `cheque_number` | varchar | NOT NULL | — | — | — | PRIMARY |
| `bank_name` | varchar | (inferred) | — | — | — | PRIMARY |
| `amount` | numeric | NOT NULL | — | — | — | PRIMARY |
| `status` | cheque_status (enum) | NOT NULL | `'received'` | — | — | PRIMARY |
| `issue_date` | date | (inferred) | — | — | — | PRIMARY |
| `collection_date` | date | (inferred) | — | — | — | PRIMARY |

**Status: ACTIVE.** 1:1 with credit_invoices. Full column list available in database schema.

---

## delivery_tracking

Delivery tracking records. **80 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `order_id` | uuid | NOT NULL | — | → orders.id | — | PRIMARY |
| `status` | varchar | (inferred) | — | — | — | PRIMARY |
| `delivery_date` | timestamptz | YES | — | — | — | PRIMARY |
| `received_by` | varchar | YES | — | — | — | PRIMARY |
| (notes, signature fields) | | | | | | |

**Status: ACTIVE.** Full column list available in database schema.

---

## visits

Sales Representative visits to customers with GPS check-in/out and results. **112 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `employee_id` | uuid | NOT NULL | — | → employees.id | — | PRIMARY |
| `customer_id` | uuid | NOT NULL | — | → customers.id | — | PRIMARY |
| `location_id` | uuid | (inferred) | — | → unified_locations.id | — | PRIMARY |
| `checkin_lat` | numeric | (inferred) | — | — | — | PRIMARY |
| `checkin_lng` | numeric | (inferred) | — | — | — | PRIMARY |
| `checkout_lat` | numeric | YES | — | — | — | PRIMARY |
| `checkout_lng` | numeric | YES | — | — | — | PRIMARY |
| `checkin_at` | timestamptz | (inferred) | — | — | — | PRIMARY |
| `checkout_at` | timestamptz | YES | — | — | — | PRIMARY |
| `result` | text | YES | — | — | — | PRIMARY |
| `status` | varchar | (inferred) | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## daily_deals

Daily Deal commercial packages. Fixed-price bundles of products. **80 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `status` | daily_deal_status (enum) | NOT NULL | `'draft'` | — | — | PRIMARY |
| `fixed_price` | numeric | NOT NULL | — | — | — | PRIMARY |
| `start_date` | timestamptz | (inferred) | — | — | — | PRIMARY |
| `end_date` | timestamptz | (inferred) | — | — | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## daily_deal_items

Products included in a daily deal with their quantities. **56 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `daily_deal_id` | uuid | NOT NULL | — | → daily_deals.id | — | PRIMARY |
| `product_id` | uuid | NOT NULL | — | → products.id | — | PRIMARY |
| `quantity` | numeric | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## flash_offers

Flash Offer countdown-driven commercial packages. **80 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `status` | flash_offer_status (enum) | NOT NULL | `'draft'` | — | — | PRIMARY |
| `fixed_price` | numeric | NOT NULL | — | — | — | PRIMARY |
| `start_time` | timestamptz | (inferred) | — | — | — | PRIMARY |
| `end_time` | timestamptz | (inferred) | — | — | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## flash_offer_items

Products included in a flash offer with their quantities. **56 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `flash_offer_id` | uuid | NOT NULL | — | → flash_offers.id | — | PRIMARY |
| `product_id` | uuid | NOT NULL | — | → products.id | — | PRIMARY |
| `quantity` | numeric | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## auctions

Live B2B auction room. Mobile-first realtime bidding. **96 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `code` | varchar | NOT NULL | — | — | — | PRIMARY |
| `status` | auction_status (enum) | NOT NULL | — | — | — | PRIMARY |
| `start_time` | timestamptz | (inferred) | — | — | — | PRIMARY |
| `end_time` | timestamptz | (inferred) | — | — | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## auction_items

Products included in an auction package with quantities. **56 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `auction_id` | uuid | NOT NULL | — | → auctions.id | — | PRIMARY |
| `product_id` | uuid | NOT NULL | — | → products.id | — | PRIMARY |
| `quantity` | numeric | NOT NULL | — | — | — | PRIMARY |
| `reserve_price` | numeric | (inferred) | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## auction_participants

Registered participants for each auction with deposit/approval status. **72 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `auction_id` | uuid | NOT NULL | — | → auctions.id | — | PRIMARY |
| `customer_id` | uuid | NOT NULL | — | → customers.id | — | PRIMARY |
| `status` | auction_participant_status (enum) | NOT NULL | — | — | — | PRIMARY |
| `deposit_amount` | numeric | (inferred) | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## auction_bids

Bid records. `is_winning` updated in realtime. **72 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `participant_id` | uuid | NOT NULL | — | → auction_participants.id | — | PRIMARY |
| `amount` | numeric | NOT NULL | — | — | — | PRIMARY |
| `is_winning` | boolean | NOT NULL | — | — | — | PRIMARY |
| `bid_time` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** `is_winning` is a SECONDARY denormalized flag updated in realtime. Full column list available in database schema.

---

## auction_awards

Winner awards. 1hr confirmation window. **24 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `auction_id` | uuid | NOT NULL | — | → auctions.id | — | PRIMARY |
| `participant_id` | uuid | NOT NULL | — | → auction_participants.id | — | PRIMARY |
| `winning_bid` | numeric | NOT NULL | — | — | — | PRIMARY |
| `confirmed_at` | timestamptz | YES | — | — | — | PRIMARY |
| `expires_at` | timestamptz | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## auction_activity

Realtime activity feed for auction room. **48 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `auction_id` | uuid | NOT NULL | — | → auctions.id | — | PRIMARY |
| `activity_type` | varchar | NOT NULL | — | — | — | PRIMARY |
| `message` | text | (inferred) | — | — | — | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |

**Status: ACTIVE.** Activity feed / event log. Full column list available in database schema.

---

## tiers

Pricing tiers for differentiated customer pricing. **64 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `name` | varchar | NOT NULL | — | — | — | PRIMARY |
| `default_discount_percent` | numeric | (inferred) | — | — | — | PRIMARY |
| `is_active` | boolean | NOT NULL | `true` | — | — | PRIMARY |

**Status: ACTIVE.** Referenced by `orders.tier_id`, `tier_exceptions`, `tier_company_exceptions`, `tier_product_exceptions`. Full column list available in database schema.

---

## tier_exceptions

Override default tier for specific customers. Historical records retained. **32 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `tier_id` | uuid | NOT NULL | — | → tiers.id | — | PRIMARY |
| `customer_id` | uuid | NOT NULL | — | → customers.id | — | PRIMARY |
| `discount_percent` | numeric | (inferred) | — | — | — | PRIMARY |
| `is_active` | boolean | (inferred) | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## tier_company_exceptions

Per-company discount overrides for tiers. Takes priority over tier default discount. **72 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `tier_id` | uuid | NOT NULL | — | → tiers.id | — | PRIMARY |
| `company_id` | uuid | NOT NULL | — | → companies.id | — | PRIMARY |
| `discount_percent` | numeric | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## tier_product_exceptions

Per-product discount overrides for tiers. `appliesToAllTiers` flag. **72 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `tier_id` | uuid | (inferred nullable if appliesToAllTiers) | — | → tiers.id | — | PRIMARY |
| `product_id` | uuid | NOT NULL | — | → products.id | — | PRIMARY |
| `discount_percent` | numeric | NOT NULL | — | — | — | PRIMARY |
| `applies_to_all_tiers` | boolean | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## preparation_records

Order preparation tracking records. **48 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `order_id` | uuid | (inferred) | — | → orders.id | — | PRIMARY |
| `status` | preparation_status (enum) | NOT NULL | — | — | — | PRIMARY |
| `prepared_by` | uuid | (inferred) | — | → employees.id | — | PRIMARY |
| `prepared_at` | timestamptz | (inferred) | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## preparation_exceptions

Exceptions flagged during order preparation. **32 kB — Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `preparation_id` | uuid | (inferred) | — | → preparation_records.id | — | PRIMARY |
| `exception_type` | preparation_exception_type (enum) | NOT NULL | — | — | — | PRIMARY |
| `notes` | text | YES | — | — | — | PRIMARY |

**Status: ACTIVE.** Full column list available in database schema.

---

## app.sessions

Authentication sessions table (app schema). **— Active.**

| Field | Type | Nullable | Default | FK | Unique | Classification |
|-------|------|----------|---------|----|--------|---------------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | — | PK | PRIMARY |
| `identity_id` | uuid | NOT NULL | — | → identities.id | — | PRIMARY |
| `token` | varchar | NOT NULL | — | — | UNIQUE | PRIMARY |
| `created_at` | timestamptz | NOT NULL | `now()` | — | — | PRIMARY |
| `expires_at` | timestamptz | NOT NULL | — | — | — | PRIMARY |

**Status: ACTIVE.** Managed by Supabase/GoTrue auth. Full column list available in database schema.

---

## Classification Summary

| Classification | Count | Description |
|---------------|-------|-------------|
| **PRIMARY** | ~450+ | Authoritative source columns actively read and written |
| **SECONDARY** | ~13 | Denormalized/snapshot columns for query performance or historical accuracy (order snapshots, execution GPS, `is_winning`, `effective_discount_percent`) |
| **LEGACY** | 0 | No legacy columns detected across any table |
| **UNUSED** | 0 | No unused columns detected across any table |

**Note:** Column-level data for tables without explicit field lists was inferred from:
- Table descriptions and comments
- Foreign key relationships referenced from other tables
- Enum types used by each table
- Business logic from RPC function signatures

For the complete authoritative column list, refer to the database schema directly (PostgreSQL `information_schema.columns` or the Supabase Table Editor).
