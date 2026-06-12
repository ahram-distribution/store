# 09 — Architecture Gaps

## 1. Customer Phone — Dual Source of Truth

| Aspect | Detail |
|--------|--------|
| **Stored In** | `identities.phone` (PRIMARY for authentication) AND `customer_contacts.phone` (PRIMARY for display) |
| **Current Behavior** | `governed_update_customer` updates BOTH via identity lookup (finds `identity_id` from `customer_contacts`), so they stay in sync through application logic |
| **Gap** | No database-level constraint enforces equality. A direct DB write or a future code path could desync them. The RPC joins through `customer_contacts.identity_id → identities.id`, so phone is duplicated across two tables joined by identity. |
| **Risk** | Low (guarded by single RPC path), but fragile |

## 2. Customer Address — Dual System (Legacy + Current)

**Legacy:** `customer_addresses` table — 25 rows, all `REVIEW_REQUIRED`, `city = address_line1` (duplicated data).  
**Current:** `unified_locations` table — ~30 rows, referenced via `customers.location_id`.

| Gap | Details |
|-----|---------|
| Both tables exist | `customer_addresses` has data but is not referenced by `customers` (no FK). `unified_locations` is the active system. |
| 25 customers have NULL `location_id` | These 25 customers DO have rows in `customer_addresses`, but no location is linked to their customer record. |
| No migration done | Data sits in the legacy table unreachable from the frontend. |

## 3. Customer Email — Being Phased Out

| Aspect | Detail |
|--------|--------|
| **Status** | `customers.email` column exists (NULLABLE). Phase 1 removed it from CustomerProfilePage, NewCustomerPage, and RegistrationPage. |
| **Gap** | The column is still in the schema. RPCs like `governed_create_customer` and `governed_update_customer` still accept `email` as a parameter. |
| **Risk** | Low — field is optional. But stale code paths could still write to it. |

## 4. Order Snapshots — Frozen Copies vs. Current Data

`orders` has 9 `snapshot_*` fields:

| Snapshot Field | Source | Purpose |
|----------------|--------|---------|
| `snapshot_customer_name` | `customers.company_name` | Freeze at order time |
| `snapshot_customer_phone` | `identities.phone` | Freeze at order time |
| `snapshot_customer_address` | `unified_locations.formatted_address` | Freeze at order time |
| `snapshot_owner_name` | `employees` / lookup | Freeze at order time |
| `snapshot_owner_phone` | `identities.phone` | Freeze at order time |
| `snapshot_owner_address` | `unified_locations` | Freeze at order time |
| `snapshot_sender_name` | — | **Unused** (no frontend populates this) |
| `snapshot_sender_phone` | — | **Unused** |
| `snapshot_sender_address` | — | **Unused** |

**Gap:** `snapshot_sender_*` columns exist in the schema and in RPC return types but no code ever writes to them. They are dead columns.

**Intent vs. Reality:** Snapshots are by design — they preserve order-time data even if the customer changes their profile later. However, any consumer of order data needs to know whether to read from snapshot fields or from the live related tables.

## 5. code_sequences — Year-Based PK Reset

**Schema:** PK is `(code_type, year)` — so every year, the sequence counter resets to 1.

| Gap | Impact |
|-----|--------|
| Non-unique codes across years | Order number `ORD-2026-000001` and `ORD-2027-000001` are technically the same number in different years. If data is ever merged or archived across years, collisions occur. |
| External reference confusion | Stakeholders referring to order/collection numbers must always specify the year. |

**Proposed Fix:** Change to lifetime unique codes (e.g., remove `year` from PK, use a single monotonic sequence, or use UUIDs).

## 6. Polymorphic Ownership — No FK Enforcement

`owner_type` / `owner_id` pattern appears in:

| Table | owner_type values | FK constraint |
|-------|-------------------|---------------|
| `customers` | Always `'employee'` | None — polymorphic FK can't be enforced |
| `orders` | Always `'employee'` | None |
| `returns` | Always `'employee'` | None |

**Gap:** The database cannot enforce referential integrity because the target table depends on the string in `owner_type`. A typo (`'employe'`) or an unexpected value would silently create orphaned references.

**Risk:** Currently low because the application always passes `'employee'`, but a schema change or bug could introduce inconsistency.

## 7. Customer Code — Two Generation Methods

| RPC | Format | Example |
|-----|--------|---------|
| `register_customer` | `REG-XXXXXXXX` (random hex) | `REG-A3F92C1B` |
| `governed_create_customer` | `CUS-YYYY-NNNNNN` (sequential by year) | `CUS-2026-000042` |

**Gap:** Two different RPCs generate codes in completely different formats. Depending on which code path creates a customer, the resulting code has a different structure. No single convention exists.

## 8. Execution Location — Dual Recording

`orders` has:

| Column | Type | Purpose |
|--------|------|---------|
| `execution_latitude` | numeric | GPS lat of delivery execution |
| `execution_longitude` | numeric | GPS lng of delivery execution |
| `execution_accuracy_meters` | numeric | GPS accuracy |
| `execution_captured_at` | timestamptz | When GPS was captured |
| `execution_location_id` | uuid FK → `unified_locations` | Reference to a known location |

**Gap:** The four raw GPS fields duplicate the concept of "where was the order executed" alongside the FK to a known location. The raw GPS is more precise but unstructured; the FK is structured but points to a pre-defined location. No documentation explains when to use which.

## 9. Tier Exceptions — No Unique Constraint

| Table | Issue |
|-------|-------|
| `tier_exceptions` | Comment in schema: "no unique constraint on (tier_id, customer_id)" |

**Gap:** The same customer can have multiple exception rows for the same tier. The application logic must deduplicate at query time, or risk inconsistent pricing for the same customer.

## 10. Inventory — Disconnected from Warehouse

| Aspect | Detail |
|--------|--------|
| **Table** | `inventory` — manual stock tracking, 1:1 with `products` (~700 rows) |
| **Behavior** | "Quantity deducted at order approval" (from schema comment) |
| **Gap** | No integration with any real warehouse management system. Stock levels are manually entered and manually decremented. No real-time or external system sync. |
| **Risk** | High — inventory counts are unreliable if manual updates are missed. Over-selling is possible. |

---

## Summary of Gaps by Severity

| Severity | Gaps |
|----------|------|
| **High** | Inventory disconnected from warehouse (10), Dual address system with 25 orphaned customers (2), Code generation inconsistency (7) |
| **Medium** | Year-based PK reset (5), Tier exception uniqueness (9), Polymorphic ownership (6), Dual source phone (1), Execution location dual recording (8) |
| **Low** | Email phase-out residual (3), Dead snapshot_sender columns (4) |
