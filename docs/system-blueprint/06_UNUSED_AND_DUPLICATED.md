# 06 — Unused and Duplicated Elements

## 1. Unused Tables

| Table | Rows | Status | Since | Alternative |
|-------|------|--------|-------|-------------|
| `daily_deals` | 0 | All test data cleaned; table structure intact | No production usage ever | N/A — may be needed for future promotional feature |
| `flash_offers` | 0 | All test data cleaned; table structure intact | No production usage ever | N/A — may be needed for future flash-sale feature |
| `expenses` | 0 | All test data cleaned; table structure intact | No production usage ever | N/A — operational expense tracking not yet active |
| `preparation_records` | 0 | No warehouse prep activity recorded | No production usage ever | N/A — preparation workflow not started |
| `preparation_exceptions` | 0 | Depends on `preparation_records` | No production usage ever | N/A — dependent table |
| `credit_contracts` | 0 | Credit workflow not yet completed for any customer | No production usage ever | N/A — contracts needed before credit orders can ship |
| `employee_advances` | 0 | No advances recorded | No production usage ever | N/A — HR advance feature not active |
| `inventory` | ~700 | Data exists (1:1 with `products`) but usage is unclear | Since inception | No known frontend UI reads this table directly; may be a manual-stock placeholder |

## 2. Unused Functions / RPCs

| Function | Status | Since | Alternative |
|----------|--------|-------|-------------|
| `multiline_test` | Test function, never called in production | Initial development | Remove |
| `test_func` | Test function, never called in production | Initial development | Remove |
| `test_ping2` | Test function, never called in production | Initial development | Remove |
| `test_ping3` | Test function, never called in production | Initial development | Remove |
| `test_rpc` | Test function, never called in production | Initial development | Remove |
| `test_setof` | Test function, never called in production | Initial development | Remove |
| `ping` | Used only for developer health checks / connectivity tests | Initial development | Keep as utility; not called by frontend |

All `test_*` functions are debug artifacts and should be dropped from the database schema.

## 3. Unused or Deprecated Fields

| Table | Column(s) | Status | Since | Alternative |
|-------|-----------|--------|-------|-------------|
| `customers` | `email` | Being removed from UI; Phase 1 already removed from CustomerProfilePage, NewCustomerPage, RegistrationPage | Phase 1 (current) | Field still in schema; RPCs still accept it. Next step: drop column. |
| `orders` | `snapshot_sender_name`, `snapshot_sender_phone`, `snapshot_sender_address` | Appear deprecated — no frontend code populates these | Unknown | These were intended for a "sender" concept that was never finished; no alternative |
| `orders` | `execution_latitude`, `execution_longitude`, `execution_accuracy_meters`, `execution_captured_at` | Superseded by `execution_location_id` (FK → `unified_locations`) | Unknown | Use `execution_location_id` |
| `customer_addresses` | All fields | Legacy address system supplanted by `unified_locations` + `customers.location_id` | Unknown | Migrate to `unified_locations` and drop table |

## 4. Duplicated Data

### 4a. Phone — Dual Source

| Location | Purpose | Conflict |
|----------|---------|----------|
| `identities.phone` | PRIMARY for authentication | Both hold phone numbers for the same person |
| `customer_contacts.phone` | PRIMARY for customer display | governed_update_customer updates both (identity lookup by contact), but they can technically diverge |

**Resolution:** Keep both but enforce consistency via trigger or application logic.

### 4b. Order Snapshots — Denormalized Copies

| Snapshot Field | Source of Truth | Rationale |
|----------------|-----------------|-----------|
| `orders.snapshot_customer_name` | `customers.company_name` | Historical preservation — customer name shouldn't change on past orders |
| `orders.snapshot_customer_phone` | `identities.phone` | Historical preservation |
| `orders.snapshot_customer_address` | `unified_locations.formatted_address` | Historical preservation |
| `orders.snapshot_owner_name` | `employees` / `identities` | Historical preservation |
| `orders.snapshot_owner_phone` | `identities.phone` | Historical preservation |
| `orders.snapshot_owner_address` | `unified_locations` | Historical preservation |
| `orders.snapshot_sender_name` | — | Deprecated / never used |

**Design Intent:** Snapshots freeze data at order time so edits to customer profile don't rewrite history.  
**Gap:** `snapshot_sender_*` fields appear unused — may have been intended for a third-party sender concept.

### 4c. Customer Addresses — Competing Systems

| System | Table | Rows | Status |
|--------|-------|------|--------|
| Legacy | `customer_addresses` | 25 rows, all `REVIEW_REQUIRED`, city = address_line1 | To be migrated |
| Current | `unified_locations` + `customers.location_id` | ~30 locations | Active system |

**Impact:** 25 customers have NULL `location_id` but DO have rows in `customer_addresses`. Two parallel address storage paths exist.

### 4d. Customer Code — Multiple Schemes

| Source | Format | Example |
|--------|--------|---------|
| `register_customer` RPC | `REG-XXXXXXXX` (random 8 hex chars) | `REG-A3F92C1B` |
| `governed_create_customer` RPC | `CUS-YYYY-NNNNNN` (year + sequence) | `CUS-2026-000042` |
| Legacy data | Phone numbers, Arabic garbled text, hash strings | `01008800304`, `CUST-B10E36EB` |

**Gap:** No single convention for customer codes. New registrations may get either format depending on which RPC is called.
