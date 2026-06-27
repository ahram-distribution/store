# 08 — Cleanup Candidates

## Classification Legend

| Tag | Meaning |
|-----|---------|
| **SAFE_TO_REMOVE** | No data, no active code references. Can be dropped immediately. |
| **NEEDS_MIGRATION** | Has data or is referenced by code. Requires a migration path before removal. |
| **KEEP** | Actively used by the frontend or backend. Do not touch. |

---

## Tables

### SAFE_TO_REMOVE

| Table | Reason |
|-------|--------|
| `daily_deals` | 0 rows, all test data cleaned. Structure exists but no production usage. The feature may be re-added later; the migration can be recreated. |
| `flash_offers` | 0 rows, all test data cleaned. Same reasoning as `daily_deals`. |
| `expenses` | 0 rows, all test data cleaned. Structure exists but no usage. |
| `preparation_records` | 0 rows, no warehouse prep activity ever recorded. |
| `preparation_exceptions` | 0 rows, depends on `preparation_records`. |
| `credit_contracts` | 0 rows, no contracts ever signed. |
| `employee_advances` | 0 rows, no advances recorded. |

**Note on feature tables** (`daily_deals`, `flash_offers`): If the promotional features are planned for the future, keep the tables and mark them as PLANNED rather than removing them. If there are no immediate plans, the DDL can be version-controlled and removed from the live schema.

### NEEDS_MIGRATION

| Table | Rows | Reason | Migration Path |
|-------|------|--------|----------------|
| `customer_addresses` | 25 | Legacy system; all rows have `review_required`, `city` = `address_line1` (duplicated). Superseded by `unified_locations`. | For each `customer_addresses.customer_id`, create a `unified_locations` row, set `customers.location_id`, then drop the table. |

### KEEP

All other tables (55 total minus the candidates above) are actively used.

---

## Columns

### SAFE_TO_REMOVE

| Table | Column | Reason |
|-------|--------|--------|
| `customers` | `email` | Already removed from all 3 customer-facing UI pages (Phase 1). Field is NULLABLE. No frontend code reads or writes it. RPCs still accept the parameter but can be updated. |
| `orders` | `snapshot_sender_name` | No frontend code populates this field. Never used. |
| `orders` | `snapshot_sender_address` | No frontend code populates this field. Never used. |
| `orders` | `execution_latitude` | Superseded by `execution_location_id` |
| `orders` | `execution_longitude` | Superseded by `execution_location_id` |
| `orders` | `execution_accuracy_meters` | Superseded by `execution_location_id` |
| `orders` | `execution_captured_at` | Superseded by `execution_location_id` |

### NEEDS_MIGRATION

| Table | Column | Reason | Migration Path |
|-------|--------|--------|----------------|
| `customers` | `code` | Currently stores phone numbers, garbled text, random hashes, and `REG-XXXXXXXX`. Needs unified format. | Write a migration script to recode all 25 customers to `CUS-YYYY-NNNNNN` using `code_sequences`. |
| `employees` | `code` | Mixed formats: `REP001`-`REP008`, `WRQ1001`-`WRQ1006`, `ADMIN-001`, `REP-001`. | Recode all 16 employees to a single sequential format. |
| `code_sequences` | PK `(code_type, year)` | Year-based reset creates non-unique codes across years. | Migrate PK to `(code_type, year, sequence)` or use UUID-based lifetime codes. Update all RPCs that call `generate_order_number` / `generate_collection_number`. |
| `orders` | `order_number` | Depends on `code_sequences` — same year-reset issue. | Recode all 38 orders with lifetime unique numbers after the `code_sequences` fix. |

### KEEP

All other columns are actively used by the frontend.

---

## Functions / RPCs

### SAFE_TO_REMOVE

| Function | Reason |
|----------|--------|
| `multiline_test` | Test artifact, no callers |
| `test_func` | Test artifact, no callers |
| `test_ping2` | Test artifact, no callers |
| `test_ping3` | Test artifact, no callers |
| `test_rpc` | Test artifact, no callers |
| `test_setof` | Test artifact, no callers |

### KEEP

| Function | Reason |
|----------|--------|
| `ping` | Used for health checks (developer tooling). Not called by frontend but useful. |
| All `governed_*` functions | Actively called by frontend |
| `login`, `logout`, `validate_session`, `check_capability` | Auth core |
| `register_customer`, `generate_collection_number`, `generate_order_number`, `get_visible_employee_ids` | Actively called |

---

## Views

No views were identified in the schema inventory. This section is intentionally blank.

---

## Summary Matrix

| Category | SAFE_TO_REMOVE | NEEDS_MIGRATION | KEEP |
|----------|----------------|-----------------|------|
| Tables | 7 | 1 | 47 |
| Columns | 7 | 3 (+1 table-level) | All others |
| Functions | 6 | 0 | ~20+ |
| Views | 0 | 0 | 0 |
