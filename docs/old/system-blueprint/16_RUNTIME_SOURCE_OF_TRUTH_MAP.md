# 16 — Runtime Source of Truth Map

> **Purpose:** For every operational concept in the system, identify the single canonical (source-of-truth) storage location, all secondary/legacy locations, the reason each secondary source exists, its current health, the impact of removing it, and the recommended action.
>
> **Build instructions:** Each concept below is a row in a master truth table. Every source listed represents a real table, column, RPC, or frontend store. Assessments are based on code evidence (not theory). The final decision column is for the team to fill in after review.
>
> **Reference:** V2 Canonical Master Reference — docs/system-blueprint/FINAL_CANONICAL_MASTER_REFERENCE_V2.md
> **Verification Audit:** docs/system-blueprint/15_BLUEPRINT_VERIFICATION_AUDIT.md (25 discrepancies, all resolved in V2)

---

## How to Read This Document

Each concept entry follows this structure:

| Field | Description |
|---|---|
| **Canonical Source** | The single table/view/store that is the official source of truth |
| **Secondary Sources** | Other places where the same data lives (table columns, caches, computed fields, legacy tables) |
| **Reason for Existence** | Why each secondary source exists (performance, legacy migration, historical record, cache, etc.) |
| **Assessment** | `GREEN` — clean, single source; `YELLOW` — manageable dual sources; `RED` — active duplication causing or risking inconsistency |
| **Removal Impact** | What breaks if the secondary source is removed (which pages, RPCs, workflows) |
| **Final Decision** | To be filled: `Keep`, `Migrate`, `Drop`, `Reclassify` |

---

## PART I: Operational Concepts

---

### 1. Customer Identity

| Field | Detail |
|---|---|
| **Canonical Source** | `identities` table (id, provider, provider_id, password_hash, etc.) |
| **Secondary Sources** | `customers.identity_id` (foreign key, not a duplicate — it's a reference) |
| **Reason for Existence** | N/A — clean single source |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 2. Customer Profile

| Field | Detail |
|---|---|
| **Canonical Source** | `customers` table (company_id, code, name_ar, name_en, phone_1, phone_2, email, lat, lng, credit_limit, credit_days, status, owner_id, identity_id, created_at, updated_at) |
| **Secondary Sources** | None — clean single source |
| **Reason for Existence** | N/A |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

**Note:** `customers.lat`/`lng` are a legacy duplication of `unified_locations.geom`. See Concept 4.

---

### 3. Customer Address

| Field | Detail |
|---|---|
| **Canonical Source** | `unified_locations` table — the primary, most-current address for any entity (customer, visit, etc.) |
| **Secondary Sources** | `customer_addresses` table — legacy address storage, still populated by `governed_create_customer_address` RPC, still read directly by 2 frontend pages (CustomerProfilePage, CustomerAddressPage) |
| **Reason for Existence** | Legacy migration artifact. The system migrated from `customer_addresses` → `unified_locations` but kept both. `customer_addresses` is still written to by the frontend-facing RPC `governed_create_customer_address` (called from CustomerProfilePage and CustomerAddressPage). The `unified_address_sync` trigger copies new `unified_locations` rows back to `customer_addresses` for backward compat. |
| **Assessment** | `RED` — active dual-write with sync trigger. Any divergence between the two tables is possible if triggers fail or direct DB writes bypass one side. 25 customer_addresses rows vs 30+ unified_locations rows for customers. |
| **Removal Impact** | Removing `customer_addresses` breaks: CustomerProfilePage (reads both), CustomerAddressPage (reads/writes), governed_create_customer_address RPC (writes to it). Must migrate all reads to `unified_locations` first. |
| **Final Decision** | `Migrate` — P1 priority. Move frontend reads to `unified_locations`, retire `customer_addresses`, remove sync trigger. |

---

### 4. Customer GPS / Location Coordinates

| Field | Detail |
|---|---|
| **Canonical Source** | `unified_locations.geom` (PostGIS geometry point) |
| **Secondary Sources** | `customers.lat` / `customers.lng` (decimal columns, legacy) |
| **Reason for Existence** | Legacy columns from before the PostGIS migration. Still read by CustomerProfilePage for display and by governed_create_location RPC. Not updated consistently — if a location is updated in `unified_locations`, the `customers.lat`/`lng` may not reflect the change. |
| **Assessment** | `RED` — active duplication with no sync mechanism. Two independent sources for the same data. |
| **Removal Impact** | Removing `customers.lat`/`lng` breaks: CustomerProfilePage (displays them), governed_create_location RPC (reads/writes them). Must switch to `unified_locations.geom` via ST_X/ST_Y extraction. |
| **Final Decision** | `Migrate` — P1 priority. Extract geom→lat/lng via view or computed columns. |

---

### 5. Customer Contact

| Field | Detail |
|---|---|
| **Canonical Source** | `customer_contacts` table |
| **Secondary Sources** | `customers.phone_1`, `customers.phone_2`, `customers.email` (convenience columns for primary contact) |
| **Reason for Existence** | Performance. The most-used contact fields are denormalized onto `customers` to avoid a JOIN on every page load. They are set on customer creation and can be updated via `governed_update_customer`. |
| **Assessment** | `YELLOW` — managed denormalization. The `customer_contacts` table is the full contact list; `customers.phone_1/phone_2/email` are a cache of the primary contact. Risk is low because updates go through RPCs that theoretically update both, but there is no trigger-enforced consistency. |
| **Removal Impact** | Removing `customers.phone_1/phone_2/email` would break every customer-facing page (CustomerProfilePage, CustomerAddressPage, CustomerCreditPage, StorefrontPage, OrderHistoryPage) that reads these columns directly. A JOIN to `customer_contacts` would be required everywhere. |
| **Final Decision** | `Keep` — acceptable denormalization. Consider adding a trigger to sync primary contact changes. |

---

### 6. Customer Ownership

| Field | Detail |
|---|---|
| **Canonical Source** | `customers.owner_id` (FK → employees.id) — the current owner/rep |
| **Secondary Sources** | `customer_ownership_history` (full audit trail of ownership changes), `customer_ownership_summary()` (RPC/view that computes current ownership with history) |
| **Reason for Existence** | Audit trail requirement. The `owner_id` gives the current state; the history table gives the full timeline. The summary RPC exists for admin reports. |
| **Assessment** | `GREEN` — clean separation. Current state vs audit trail vs computed summary. |
| **Removal Impact** | Removing `owner_id` would require every ownership lookup to query `customer_ownership_history` for the latest row — a significant performance regression. |
| **Final Decision** | `Keep` |

---

### 7. Employee

| Field | Detail |
|---|---|
| **Canonical Source** | `employees` table (id, name, email, phone, manager_id, role_id, company_id, is_active, created_at) |
| **Secondary Sources** | `auth.users` (Supabase Auth — stores authentication identity only, not profile) |
| **Reason for Existence** | Supabase Auth manages login/session; `employees` manages profile, role, hierarchy. They are linked by `employees.id` = `auth.users.id` convention. |
| **Assessment** | `GREEN` — two separate concerns (auth vs profile) |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 8. Employee Role

| Field | Detail |
|---|---|
| **Canonical Source** | `roles` table (id, name_ar, name_en, priority) |
| **Secondary Sources** | `employees.role_id` (FK → roles.id — the current role), `employee_roles` (junction table for multi-role assignment — appears in schema but unused in code) |
| **Reason for Existence** | `employees.role_id` is the primary role assignment. `employee_roles` appears to be a legacy/planned feature for multi-role support that was never implemented in the frontend. No code path writes or reads `employee_roles`. |
| **Assessment** | `YELLOW` — `employee_roles` is dead schema. Not an active dual source. |
| **Removal Impact** | Removing `employee_roles` has zero impact — no code reads or writes it. However, it may be part of a planned feature. |
| **Final Decision** | `Reclassify` as dead schema (candidate for cleanup if multi-role is not planned) |

---

### 9. Capabilities (Permissions)

| Field | Detail |
|---|---|
| **Canonical Source** | `role_capabilities` table — maps roles to capabilities. Evaluated at runtime via `fn_get_employee_capabilities(employee_id)` |
| **Secondary Sources** | `employee_capabilities` table — per-employee capability overrides (additions or removals beyond role default) |
| **Reason for Existence** | The override pattern: most employees get permissions from their role, but specific employees need individual capability tweaks without changing the role for everyone. |
| **Assessment** | `GREEN` — intentional override pattern, not duplication |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 10. Sessions

| Field | Detail |
|---|---|
| **Canonical Source** | `app.sessions` table (Supabase-managed) |
| **Secondary Sources** | `auth.sessions` (Supabase internal) |
| **Reason for Existence** | Supabase manages both; `app.sessions` may be a custom extension or view. Neither is written by application code. |
| **Assessment** | `GREEN` — managed by Supabase |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 11. Order

| Field | Detail |
|---|---|
| **Canonical Source** | `orders` table (master order record — customer_id, company_id, employee_id, status, total, subtotal, discount, paid_amount, notes, snapshot_* fields, created_at, updated_at) |
| **Secondary Sources** | None — clean single source for the order header |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 12. Order Item

| Field | Detail |
|---|---|
| **Canonical Source** | `order_items` table (order_id, product_id, unit_id, quantity, carton_quantity, unit_price, total_price) |
| **Secondary Sources** | `orders.snapshot_items` (JSON snapshot of items at order finalization time — see Concept 16) |
| **Reason for Existence** | Historical record. The snapshot preserves the order as it was when finalized, even if `order_items` is later modified (which shouldn't happen but is possible). |
| **Assessment** | `GREEN` — snapshot is a historical freeze, not live duplication |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 13. Order Status

| Field | Detail |
|---|---|
| **Canonical Source** | `orders.status` (single enum column: pending, approved, preparing, delivering, completed, cancelled, rejected) |
| **Secondary Sources** | `order_status_history` (full status transition log), `order_modification_history` (admin overrides to status), `governed_change_order_status` (single RPC that transitions status) |
| **Reason for Existence** | Audit trail. `orders.status` is the current state; the history tables track when and why it changed. |
| **Assessment** | `GREEN` — clean separation: current state vs audit log |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 14. Order Status History

| Field | Detail |
|---|---|
| **Canonical Source** | `order_status_history` table (order_id, from_status, to_status, changed_by, reason, created_at) |
| **Secondary Sources** | `order_modification_history` (tracks admin modifications including status changes, with additional metadata about what was modified) |
| **Reason for Existence** | Two separate audit concerns: `order_status_history` tracks standard status transitions (triggered by `governed_change_order_status`); `order_modification_history` tracks admin edits to orders (including but not limited to status changes). They overlap for admin-driven status changes. |
| **Assessment** | `YELLOW` — overlapping audit trails. When an admin changes order status, the event is recorded in both tables. This is intentional (different metadata) but creates a risk of inconsistency in timestamps or reasons. |
| **Removal Impact** | Removing either table loses a specific type of audit metadata. Both are needed unless merged into a single audit table. |
| **Final Decision** | `Keep` — but consider merging into a single `order_audit_log` table with a discriminator column |

---

### 15. Order Snapshot (snapshot_items, snapshot_totals)

| Field | Detail |
|---|---|
| **Canonical Source** | `orders.snapshot_items` (JSONB), `orders.snapshot_totals` (JSONB) — frozen at order finalization |
| **Secondary Sources** | `order_items` (live line items) + `orders.subtotal`/`orders.discount`/`orders.total` (live totals) |
| **Reason for Existence** | The snapshot preserves exactly what was ordered at the moment of finalization. Live data can drift if items are modified post-hoc (which shouldn't happen but can through admin interfaces). |
| **Assessment** | `GREEN` — intentional historical freeze |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 16. Order Modification Audit

| Field | Detail |
|---|---|
| **Canonical Source** | `order_modification_history` table (order_id, employee_id, field, old_value, new_value, reason, created_at) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 17. Product

| Field | Detail |
|---|---|
| **Canonical Source** | `products` table (id, code, name_ar, name_en, company_id, carton_price, unit_price, wholesale_price, carton_quantity, is_active, created_at, updated_at) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 18. Product Unit

| Field | Detail |
|---|---|
| **Canonical Source** | `product_units` table (product_id, unit_type, conversion_factor, price, is_default) |
| **Secondary Sources** | `products.carton_quantity` (denormalized — indicates how many units per carton, which is a specific type of conversion factor) |
| **Reason for Existence** | Performance. The carton-to-unit conversion is the most common lookup, so it's denormalized onto products. |
| **Assessment** | `YELLOW` — managed denormalization. `product_units` is the full multi-unit definition; `products.carton_quantity` is a cache of the most important conversion. |
| **Removal Impact** | Removing `products.carton_quantity` would require a JOIN to `product_units` in every product listing query. |
| **Final Decision** | `Keep` |

---

### 19. Product Pricing

| Field | Detail |
|---|---|
| **Canonical Source** | `products.carton_price` + `products.unit_price` + `products.wholesale_price` (base prices by unit type) |
| **Secondary Sources** | Pricing engine (`src/services/productPricing.ts` — applies tier discounts, daily deals, flash offers on top of base prices), `tier_product_exceptions` (per-product tier price overrides) |
| **Reason for Existence** | Base prices are static. The pricing engine computes effective prices at runtime by layering tier discounts, deal discounts, and flash offers. This is a computation, not a storage duplication. |
| **Assessment** | `GREEN` — base storage vs runtime computation. No write-duplication. |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 20. Inventory

| Field | Detail |
|---|---|
| **Canonical Source** | `inventory` table (product_id, unit_id, quantity, min_quantity, max_quantity, updated_at) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 21. Company

| Field | Detail |
|---|---|
| **Canonical Source** | `companies` table (id, code, name_ar, name_en, phone, email, address, is_active, created_at) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 22. Company Profile

| Field | Detail |
|---|---|
| **Canonical Source** | `company_profile` table (company_id, field_name, field_value — EAV pattern for extensible attributes) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 23. Tier

| Field | Detail |
|---|---|
| **Canonical Source** | `tiers` table (id, name, discount_percentage, priority, is_default) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 24. Tier Company Exception

| Field | Detail |
|---|---|
| **Canonical Source** | `tier_company_exceptions` table (tier_id, company_id, discount_percentage — overrides the tier's default discount for a specific company) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 25. Tier Product Exception

| Field | Detail |
|---|---|
| **Canonical Source** | `tier_product_exceptions` table (tier_id, product_id, override_price — overrides the tier discount for a specific product) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 26. Collection / Receivables

| Field | Detail |
|---|---|
| **Canonical Source** | `collections` table (id, customer_id, order_id, employee_id, amount, paid_amount, status, due_date, collected_at, notes) |
| **Secondary Sources** | Computed collection totals in frontend (order status pages sum paid amounts), `governed_get_customer_collections` RPC (returns calculated summary with remaining balance = amount - paid_amount) |
| **Reason for Existence** | The RPC computes the remaining balance rather than storing it — correct pattern. No dual storage. |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 27. Return

| Field | Detail |
|---|---|
| **Canonical Source** | `returns` table (master record: order_id, customer_id, employee_id, status, total, reason, created_at) |
| **Secondary Sources** | `return_items` (line items of the return), `return_inspection` (inspection outcome, photos, notes) |
| **Reason for Existence** | Normalized 3-table design: header → items → inspection. Clean separation. |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 28. Credit Program

| Field | Detail |
|---|---|
| **Canonical Source** | `credit_programs` table (id, name, description, interest_rate, max_amount, duration_days, is_active) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 29. Credit Application

| Field | Detail |
|---|---|
| **Canonical Source** | `credit_applications` table (id, customer_id, program_id, employee_id, status, amount, reason, reviewed_by, reviewed_at, created_at) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 30. Credit Account

| Field | Detail |
|---|---|
| **Canonical Source** | `customer_credit_accounts` table (id, customer_id, program_id, credit_limit, current_balance, available_credit, status, opened_at, closed_at) |
| **Secondary Sources** | `customers.credit_limit`, `customers.credit_days` (legacy columns — see Concept 32) |
| **Reason for Existence** | The new credit system (accounts + ledger) supersedes the old flat credit fields on `customers`. Both are active. |
| **Assessment** | `RED` — active dual SOT. Credit limit is stored in both `customer_credit_accounts.credit_limit` and `customers.credit_limit`. These can diverge. |
| **Removal Impact** | Removing `customers.credit_limit`/`credit_days` breaks any code that reads them directly. Audit shows CustomerProfilePage and governed_create_credit_application still use `customers.credit_limit`. |
| **Final Decision** | `Migrate` — P1 priority. Move all reads to `customer_credit_accounts`. |

---

### 31. Credit Ledger

| Field | Detail |
|---|---|
| **Canonical Source** | `customer_credit_ledger` table (id, account_id, transaction_type, amount, balance_after, reference_type, reference_id, description, created_by, created_at) |
| **Secondary Sources** | None — this is the immutable transaction log for all credit movements |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 32. Credit Invoice

| Field | Detail |
|---|---|
| **Canonical Source** | `credit_invoices` table (id, account_id, amount, paid_amount, status, due_date, issued_at, paid_at) |
| **Secondary Sources** | `credit_invoice_cheques` (cheque payments against invoices — separate table, not a duplicate) |
| **Reason for Existence** | Invoices are generated from ledger transactions. Separate concern from the ledger. |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 33. Customer Credit (Legacy Columns)

| Field | Detail |
|---|---|
| **Canonical Source** | `customers.credit_limit`, `customers.credit_days` — legacy flat columns |
| **Secondary Sources** | `customer_credit_accounts.credit_limit`, `customer_credit_accounts.payment_terms` (new canonical source) |
| **Reason for Existence** | Pre-dates the credit account system. Still referenced by CustomerProfilePage (read) and governed_create_credit_application RPC (read/write). |
| **Assessment** | `RED` — see Concept 30. Active dual SOT with `customer_credit_accounts`. |
| **Removal Impact** | See Concept 30 |
| **Final Decision** | `Migrate` — P1 priority |

---

### 34. Treasury Transaction

| Field | Detail |
|---|---|
| **Canonical Source** | `treasury_transactions` table (id, type, amount, reference_type, reference_id, description, created_by, created_at) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 35. Expense

| Field | Detail |
|---|---|
| **Canonical Source** | `expenses` table (id, employee_id, category, amount, description, receipt_url, status, created_at) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 36. Employee Advance

| Field | Detail |
|---|---|
| **Canonical Source** | `employee_advances` table (id, employee_id, amount, paid_amount, status, requested_at, approved_at, repaid_at) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 37. Visit

| Field | Detail |
|---|---|
| **Canonical Source** | `visits` table (id, employee_id, customer_id, planned_date, check_in_time, check_out_time, check_in_lat, check_in_lng, status, notes, start_location_id, end_location_id) |
| **Secondary Sources** | `unified_locations` (linked via `start_location_id`/`end_location_id` — optional GPS reference) |
| **Reason for Existence** | `visits.check_in_lat`/`check_in_lng` are direct GPS coordinates captured at check-in. `unified_locations` provides a reusable named location. Both can exist independently — a visit may have GPS but no named location. |
| **Assessment** | `YELLOW` — two coordinate storage patterns because of different use cases (anonymous GPS vs named location). Risk is low because they serve different purposes. |
| **Removal Impact** | Removing `unified_locations` reference would lose named location linkage. Removing `check_in_lat`/`lng` would lose raw GPS capture. Both are used. |
| **Final Decision** | `Keep` — two independent use cases |

---

### 38. Delivery

| Field | Detail |
|---|---|
| **Canonical Source** | `delivery_tracking` table (id, order_id, driver_id, status, location_lat, location_lng, started_at, delivered_at, notes) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 39. Warehouse Preparation

| Field | Detail |
|---|---|
| **Canonical Source** | `preparation_records` table (id, order_id, employee_id, status, started_at, completed_at, notes) |
| **Secondary Sources** | `preparation_exceptions` (items that couldn't be fulfilled — order_id, product_id, reason, resolved_at) |
| **Reason for Existence** | Separate concern: preparation record tracks the picking process; exceptions track items that went wrong. |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 40. Target (Company Monthly)

| Field | Detail |
|---|---|
| **Canonical Source** | `company_monthly_targets` table (id, company_id, year, month, target_amount, achieved_amount) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 41. Target (Employee Monthly)

| Field | Detail |
|---|---|
| **Canonical Source** | `employee_monthly_targets` table (id, employee_id, year, month, target_amount, achieved_amount) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 42. Daily Deal

| Field | Detail |
|---|---|
| **Canonical Source** | `daily_deals` table (master: id, title, description, start_date, end_date, is_active) |
| **Secondary Sources** | `daily_deal_items` (products in the deal with discounted price) |
| **Reason for Existence** | Normalized 2-table design. No duplication. |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 43. Flash Offer

| Field | Detail |
|---|---|
| **Canonical Source** | `flash_offers` table (master: id, title, description, start_time, end_time, is_active) |
| **Secondary Sources** | `flash_offer_items` (products in the offer with flash price) |
| **Reason for Existence** | Normalized 2-table design. No duplication. |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 44. Auction

| Field | Detail |
|---|---|
| **Canonical Source** | `auctions` table (master: id, title, start_time, end_time, status, created_by) |
| **Secondary Sources** | `auction_items` (products in auction with starting/reserve price), `auction_bids` (bids placed), `auction_participants` (registered bidders), `auction_awards` (won items), `auction_activity` (audit log) |
| **Reason for Existence** | Normalized 6-table design supporting the full auction lifecycle. Clean separation. |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 45. System Config

| Field | Detail |
|---|---|
| **Canonical Source** | `system_config` table (key, value, description, updated_at) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 46. Code Sequence

| Field | Detail |
|---|---|
| **Canonical Source** | `code_sequences` table (entity_type, prefix, last_number, suffix, length) |
| **Secondary Sources** | None |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

### 47. Employee-Capability Override

| Field | Detail |
|---|---|
| **Canonical Source** | `employee_capabilities` table (employee_id, capability_id, grant_type — 'add' or 'remove') |
| **Secondary Sources** | `role_capabilities` (base permissions for the role — not a duplicate, it's the starting point before overrides) |
| **Reason for Existence** | See Concept 9. The override pattern layers `employee_capabilities` on top of `role_capabilities`. |
| **Assessment** | `GREEN` |
| **Removal Impact** | N/A |
| **Final Decision** | `Keep` |

---

## PART II: Cross-Cutting Analyses

---

### Section A: Active Dual Source of Truth (RED — must be resolved)

These are concepts where the same logical data exists in two or more storage locations with no guaranteed synchronization. Every entry here represents risk of data inconsistency.

| # | Concept | Source A | Source B | Sync Mechanism | Risk Level |
|---|---|---|---|---|---|
| D1 | Customer Address | `unified_locations` | `customer_addresses` | `unified_address_sync` trigger (one-directional: UL → CA) | HIGH — trigger can fail; writes to CA bypass UL |
| D2 | Customer GPS | `unified_locations.geom` | `customers.lat`, `customers.lng` | None — manual update only | HIGH — no sync at all |
| D3 | Credit Limit | `customer_credit_accounts.credit_limit` | `customers.credit_limit` | None — manual update only | HIGH — no sync |
| D4 | Credit Payment Terms | `customer_credit_accounts.payment_terms` | `customers.credit_days` | None — manual update only | MEDIUM — `credit_days` is less critical than limit |

**Total: 4 active dual SOTs — all should be migrated (P1).**

---

### Section B: Legacy Assets Still in Active Use

These are tables, columns, or RPCs from an older version of the system that are still referenced by running code. They cannot be dropped without first migrating their consumers.

| # | Asset | Used By | Replace With | Migration Complexity |
|---|---|---|---|---|
| L1 | `customer_addresses` table | CustomerProfilePage, CustomerAddressPage, governed_create_customer_address RPC | `unified_locations` | Medium — 2 pages + 1 RPC |
| L2 | `customers.lat`, `customers.lng` | CustomerProfilePage, governed_create_location RPC | `unified_locations.geom` (via ST_X/ST_Y) | Low — 1 page + 1 RPC |
| L3 | `customers.credit_limit`, `customers.credit_days` | CustomerProfilePage, governed_create_credit_application RPC | `customer_credit_accounts` | Medium — 1 page + 1 RPC |
| L4 | `governed_create_customer_address` RPC | CustomerProfilePage, CustomerAddressPage | Writing directly to `unified_locations` | Low — update RPC body |
| L5 | `employee_roles` table | None (dead schema) | Drop (if multi-role not planned) | Low — no consumers |

**Total: 4 legacy assets in active use + 1 dead schema.**

---

### Section C: Runtime Duplications (Intentional / Low Risk)

These are data duplications that exist by design and are actively managed. They serve different purposes (e.g., current state vs audit trail, or live data vs frozen snapshot).

| # | Concept | Primary | Duplicate | Rationale | Health |
|---|---|---|---|---|---|
| R1 | Order Items | `order_items` (live) | `orders.snapshot_items` (frozen) | Historical freeze at finalization | Healthy |
| R2 | Order Status | `orders.status` (current) | `order_status_history` (log) | Audit trail | Healthy |
| R3 | Customer Ownership | `customers.owner_id` (current) | `customer_ownership_history` (log) | Audit trail | Healthy |
| R4 | Customer Contact | `customer_contacts` (full list) | `customers.phone_1/phone_2/email` (primary) | Performance denormalization | Healthy |
| R5 | Product Units | `product_units` (full) | `products.carton_quantity` (primary conversion) | Performance denormalization | Healthy |
| R6 | Employee Role | `employees.role_id` (current) | `employee_roles` (multi-role, unused) | Planned feature (never implemented) | Dead schema |
| R7 | Order Modifications | `order_status_history` (status only) | `order_modification_history` (all fields) | Separate audit concerns | Overlapping |
| R8 | Visit Location | `unified_locations` (named) | `visits.check_in_lat/lng` (raw GPS) | Different use cases | Healthy |
| R9 | Role Capabilities | `role_capabilities` (role default) | `employee_capabilities` (overrides) | Override pattern | Healthy |

**Total: 9 runtime duplications — 7 healthy, 1 dead schema (R6), 1 overlapping (R7).**

---

### Section D: Unsafe Cleanup Candidates from V1

The V1 Blueprint identified cleanup candidates that are unsafe to remove based on V2 verification. These are items that appear unused in SQL schema analysis but are actually consumed by frontend code or RPCs.

| # | Item | V1 Classification | V2 Finding | Reason |
|---|---|---|---|---|
| U1 | `governed_create_daily_deal` RPC | Orphaned | Used | Called from DailyDealsPage |
| U2 | `governed_create_flash_offer` RPC | Orphaned | Used | Called from FlashOffersPage |
| U3 | `governed_create_credit_application` RPC | Orphaned | Used | Called from CustomerCreditPage |
| U4 | `governed_create_location` RPC | Orphaned | Used | Called from CustomerAddressPage |
| U5 | `governed_suspend_credit` RPC | Orphaned | Used | Called from CreditManagementPage |
| U6 | `governed_release_credit_reservation` RPC | Orphaned | Used | Called from CreditManagementPage |
| U7 | `governed_suspend_credit_account` RPC | Orphaned | Used | Called from CreditManagementPage |
| U8 | `governed_create_customer_address` RPC | Used (correct) | Used but writes to legacy table | Writes to `customer_addresses` instead of `unified_locations` |
| U9 | `customers.lat/lng` columns | Not flagged | Legacy dual SOT | Should be migrated to `unified_locations.geom` |
| U10 | `customers.credit_limit/credit_days` columns | Not flagged | Legacy dual SOT | Should be migrated to `customer_credit_accounts` |
| U11 | `customer_addresses` table | Not flagged | Legacy dual SOT | Should be migrated to `unified_locations` |
| U12 | `employee_roles` table | Not flagged | Dead schema | No frontend consumer |

**Total: 12 unsafe or missed candidates — 7 RPCs preserved (U1–U7), 4 legacy assets added (U8–U11), 1 dead schema confirmed (U12).**

---

### Section E: Truth Consolidation Roadmap

Priority-ranked plan to eliminate all RED dual SOTs and clean up dead schema.

#### P1 — Critical (resolve before any other cleanup)

| Task | Concepts | Effort | Depends On |
|---|---|---|---|
| Migrate `customer_addresses` → `unified_locations` for reads | D1, L1, L4 | 2–3 days | Frontend updates to CustomerProfilePage + CustomerAddressPage |
| Migrate `customers.lat/lng` → `unified_locations.geom` | D2, L2 | 1 day | Add computed columns or view for lat/lng extraction |
| Migrate `customers.credit_limit/credit_days` → `customer_credit_accounts` | D3, D4, L3 | 2–3 days | Update CustomerProfilePage + governed_create_credit_application |

#### P2 — High (resolve before schema changes)

| Task | Concepts | Effort | Depends On |
|---|---|---|---|
| Remove `unified_address_sync` trigger | D1 cleanup | 0.5 day | P1.1 complete |
| Drop `governed_create_customer_address` RPC (replace with `unified_locations` write) | L4 | 0.5 day | P1.1 complete |
| Decide on `employee_roles` — keep or drop | R6, L5 | 0.5 day | Product discussion on multi-role support |

#### P3 — Medium (improve consistency)

| Task | Concepts | Effort | Depends On |
|---|---|---|---|
| Add sync trigger for `customers.phone_1/phone_2/email` from `customer_contacts` | R4 | 0.5 day | None |
| Merge `order_status_history` + `order_modification_history` into unified audit table | R7 | 2 days | Careful migration of existing data |
| Add check constraint ensuring `orders.status` matches latest `order_status_history` entry | R2 | 0.5 day | None |

#### P4 — Low (monitor only)

| Task | Concepts | Effort | Depends On |
|---|---|---|---|
| Consider removing `employee_roles` if multi-role not planned | R6, L5 | 0.5 day | P2.3 decision |
| Verify `orders.snapshot_items` consistency vs `order_items` periodically | R1 | 1 day | None |

---

## Appendix: Quick Reference Table

| Concept | Canonical Table(s) | Status | Dual Sources |
|---|---|---|---|
| Customer Identity | `identities` | GREEN | — |
| Customer Profile | `customers` | GREEN | — |
| Customer Address | `unified_locations` | **RED** | `customer_addresses` |
| Customer GPS | `unified_locations.geom` | **RED** | `customers.lat/lng` |
| Customer Contact | `customer_contacts` | YELLOW | `customers.phone_1/phone_2/email` |
| Customer Ownership | `customers.owner_id` + history | GREEN | — |
| Employee | `employees` | GREEN | — |
| Employee Role | `roles` + `employees.role_id` | YELLOW | `employee_roles` (dead) |
| Capabilities | `role_capabilities` + `employee_capabilities` | GREEN | — |
| Order | `orders` | GREEN | — |
| Order Item | `order_items` | GREEN | — |
| Order Status | `orders.status` | GREEN | — |
| Order Status History | `order_status_history` | YELLOW | overlaps with `order_modification_history` |
| Order Snapshot | `orders.snapshot_items/totals` | GREEN | — |
| Product | `products` | GREEN | — |
| Product Unit | `product_units` | YELLOW | `products.carton_quantity` |
| Product Pricing | `products.*_price` + pricing engine | GREEN | — |
| Inventory | `inventory` | GREEN | — |
| Company | `companies` | GREEN | — |
| Tier | `tiers` + exceptions | GREEN | — |
| Collection | `collections` | GREEN | — |
| Return | `returns` + `return_items` + `return_inspection` | GREEN | — |
| Credit Program | `credit_programs` | GREEN | — |
| Credit Application | `credit_applications` | GREEN | — |
| Credit Account | `customer_credit_accounts` | **RED** | `customers.credit_limit/credit_days` |
| Credit Ledger | `customer_credit_ledger` | GREEN | — |
| Credit Invoice | `credit_invoices` + `credit_invoice_cheques` | GREEN | — |
| Visit | `visits` | YELLOW | `unified_locations` (independent) |
| Delivery | `delivery_tracking` | GREEN | — |
| Warehouse Prep | `preparation_records` + exceptions | GREEN | — |
| Company Target | `company_monthly_targets` | GREEN | — |
| Employee Target | `employee_monthly_targets` | GREEN | — |
| Daily Deal | `daily_deals` + `daily_deal_items` | GREEN | — |
| Flash Offer | `flash_offers` + `flash_offer_items` | GREEN | — |
| Auction | `auctions` + 5 related tables | GREEN | — |
| System Config | `system_config` | GREEN | — |
| Code Sequence | `code_sequences` | GREEN | — |
| Treasury | `treasury_transactions` | GREEN | — |
| Expense | `expenses` | GREEN | — |
| Employee Advance | `employee_advances` | GREEN | — |

**Summary:**
- GREEN: 31 concepts — single source of truth
- YELLOW: 7 concepts — managed duplication or dead schema
- RED: 3 concepts (spanning 4 dual SOTs) — must be migrated

---

*End of 16_RUNTIME_SOURCE_OF_TRUTH_MAP.md*
*Next step: Review and approve the roadmap, then begin P1 migrations.*
