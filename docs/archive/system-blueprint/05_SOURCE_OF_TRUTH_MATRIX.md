# Source of Truth Matrix

This document identifies the authoritative source for every operational concept in the system. It tracks primary columns, secondary sources, duplication, conflicts, legacy data, and unused fields.

---

## Customer Identity & Contact

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Customer Phone | `identities.phone` | `customer_contacts.phone` | Potential — contacts can have different phones | No | Identities is the auth phone; contacts are operational reach numbers |
| Customer Password | `identities.password_hash` | None | No | No | |
| Customer Name | `customers.company_name` | `orders.snapshot_customer_name` | No — snapshot is frozen copy at order time | No | Snapshot is intentional denormalization |
| Customer Code | `customers.code` | None | No | No | |
| Customer Business Type | `customers.business_type` | None | No | No | |
| Customer Responsible Person | `customers.responsible_name` | None | No | No | |
| Customer Email | `customers.email` | None | No | No | Being removed from UI |
| Customer Credit Limit | `customers.credit_limit` | `customer_credit_accounts.credit_limit` | Potential — customer.credit_limit is the legacy field, cca.credit_limit is the program-level limit | No | Dual storage; application logic determines which is authoritative |
| Customer Credit Days | `customers.credit_days` | `customer_credit_accounts.payment_term_days` | Potential — same pattern as credit limit | No | |
| Customer Active Status | `customers.is_active` | None | No | No | |

---

## Customer Address & Location

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Customer Address | `unified_locations.formatted_address` | `customer_addresses.address_line1`, `orders.snapshot_customer_address` | Potential — fallback to customer_addresses for legacy customers without location_id | Partial — customer_addresses is legacy, unified_locations is current | Migration ongoing; new customers always get unified_locations |
| Customer Location (GPS) | `unified_locations.latitude`, `unified_locations.longitude` | None | No | No | Nullable — text-only addresses allowed |
| Customer Location Accuracy | `unified_locations.accuracy_meters` | None | No | No | |
| Customer Location Timestamp | `unified_locations.captured_at` | None | No | No | |
| Customer Location ID | `customers.location_id` | None | No | No | FK to unified_locations |

---

## Customer Contacts

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Contact Name | `customer_contacts.full_name` | None | No | No | |
| Contact Phone | `customer_contacts.phone` | None | No | No | Independent from identities.phone |
| Primary Contact | `customer_contacts.is_primary` | None | No | No | Enforced by partial unique index (one primary per customer) |

---

## Customer Ownership

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Owner (Sales Rep) | `customers.owner_id` | `orders.snapshot_owner_name/phone` | No — snapshot is frozen at order time | No | |
| Ownership History | `customer_ownership_history` | None | No | No | INSERT-only audit log |

---

## Employees

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Employee Name | `employees.full_name` | `orders.snapshot_owner_name` | No | No | |
| Employee Code | `employees.code` | None | No | No | |
| Employee Phone | `identities.phone` (via `employees.identity_id`) | None | No | No | Shared identities table |
| Employee Email | `employees.email` | None | No | No | Nullable |
| Employee Manager | `employees.manager_id` | None | No | No | Self-referencing FK |
| Employee Address | `employees.address` | `orders.snapshot_owner_address` | No | No | Nullable; added in schema alignment migration |

---

## Orders

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Order Number | `orders.order_number` | None | No | No | Format: ORD-YYYY-NNNNNN |
| Order Status | `orders.status` | `order_status_history.to_status` | No — history is audit trail, status is current | No | |
| Order Total | `orders.total_amount` | None | No | No | Computed: subtotal - discount + tax |
| Order Items | `order_items` | None | No | No | Prices captured at order time |
| Order Customer | `orders.customer_id` | `orders.snapshot_customer_name` | No | No | |
| Order Payment Method | `orders.payment_method` | None | No | No | 'cash' or 'credit' |

---

## Order Snapshots

All snapshot columns on `orders` are **intentional denormalization** — not duplication. They freeze the state of related entities at the moment of order creation so that orders remain accurate even if the customer, owner, or sender data changes later.

| Concept | PRIMARY Source | Conflict? | Legacy? | Notes |
|---|---|---|---|---|
| Customer Name (snapshot) | `orders.snapshot_customer_name` | No — frozen copy of `customers.company_name` | No | Read by all screens, PDFs, WhatsApp |
| Customer Phone (snapshot) | `orders.snapshot_customer_phone` | No — frozen copy of primary `customer_contacts.phone` | No | Read by all screens, PDFs, WhatsApp |
| Customer Address (snapshot) | `orders.snapshot_customer_address` | No — frozen copy of `unified_locations.formatted_address` (falls back to `customer_addresses`) | No | |
| Owner Name (snapshot) | `orders.snapshot_owner_name` | No — frozen copy of `employees.full_name` | No | |
| Owner Phone (snapshot) | `orders.snapshot_owner_phone` | No — frozen copy of `identities.phone` | No | |
| Owner Address (snapshot) | `orders.snapshot_owner_address` | No — frozen copy of `employees.address` | No | |
| Sender Name (snapshot) | `orders.snapshot_sender_name` | No | **Yes — deprecated** | Superseded by owner snapshot fields. Still populated for backward compatibility |
| Sender Phone (snapshot) | `orders.snapshot_sender_phone` | No | **Yes — deprecated** | |
| Sender Address (snapshot) | `orders.snapshot_sender_address` | No | **Yes — deprecated** | |

---

## Collections

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Collection Code | `collections.code` | None | No | No | Format: COL-YYYY-NNNNNN |
| Collection Amount | `collections.amount` | None | No | No | |
| Collection Method | `collections.method` | None | No | No | cash, bank_transfer, cheque, deposit |
| Collection Reference | `collections.reference_number` | None | No | No | Cheque number, transfer ref, etc. |

---

## Returns

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Return Code | `returns.code` | None | No | No | Format: RET-YYYY-NNNNNN |
| Return Items | `return_items` | None | No | No | |
| Return Inspection | `return_inspection` | None | No | No | 1:1 per return item |

---

## Visits

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Visit Code | `visits.code` | None | No | No | Format: VIS-YYYY-NNNNNN |
| Visit GPS | `visits.check_in_latitude`, `visits.check_in_longitude` | `unified_locations` (via start_location_id) | Potential — GPS can be stored in both the visit row and the linked unified_locations record | No | Check-in stores both; check-out may include out coordinates |
| Visit Result | `visits.visit_result` | None | No | No | order_taken, collection_taken, follow_up, etc. |
| Visit Start Location | `unified_locations` (via `visits.start_location_id`) | `visits.check_in_latitude/longitude` | Potential — same location may be recorded in two formats | No | unified_locations is the canonical structured record; inline GPS is fallback |
| Visit End Location | `unified_locations` (via `visits.end_location_id`) | `visits.check_out_latitude/longitude` | Potential — same as start location pattern | No | |

---

## Credit

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Credit Status | `customer_credit_accounts.credit_status` | None | No | No | active, suspended, closed |
| Credit Limit (Global) | `credit_programs.credit_limit` | `customer_credit_accounts.credit_limit` | No — cca stores the per-customer copy at activation time | No | Program limit may change; cca limit is snapshot at activation |
| Credit Limit (Per-Customer) | `customer_credit_accounts.credit_limit` | None | No | No | Copied from program at activation |
| Credit Balance | `customer_credit_ledger.running_balance` | `customer_credit_accounts.outstanding_credit` | Potential — ledger is INSERT-only and authoritative; cca.outstanding_credit is a cached summary | No | Ledger is the audit trail; cca caches the current value for performance |
| Credit Application Status | `credit_applications.status` | None | No | No | |
| Credit Invoice Status | `credit_invoices.status` | None | No | No | open, paid, overdue |
| Cheque Status | `credit_invoice_cheques.status` | None | No | No | |

---

## Products

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Product Name | `products.product_name` | `order_items` (frozen at order time) | No | No | |
| Product Code | **LEGACY — managed externally** | `products.legacy_code` | N/A | Yes | Managed by external legacy system; not editable in this application |
| Product Units | `product_units.unit_type` | `order_items.unit_type` | No | No | piece, dozen, carton |
| Product Inventory | `inventory.quantity` | None | No | No | Manual stock tracking; deducted at order approval |

---

## Companies

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Company Name | `companies.company_name` | None | No | No | |
| Company Legacy Code | **LEGACY — managed externally** | `companies.legacy_code` | N/A | Yes | Immutable legacy company code from previous system; not editable in this application |

---

## Pricing / Tiers

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Tier Name | `tiers.name` | None | No | No | |
| Tier Discount | `tiers.discount_percent` | None | No | No | Base discount for the tier |
| Company Exception Discount | `tier_company_exceptions.discount_percent` | None | No | No | Overrides tier default for specific companies. Priority 2 |
| Product Exception Discount | `tier_product_exceptions.discount_percent` | None | No | No | Overrides all other discounts for specific products. Priority 1 |

---

## Access Control

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Roles | `roles.name` | None | No | No | Dynamic — managed as data, not code |
| Capabilities (Code) | `capabilities.code` | None | No | No | Machine-readable identifier (e.g., `order.create`) |
| Capabilities (Display) | `capabilities.name` | None | No | No | Human-readable display name |
| Role-Capability Mapping | `role_capabilities` | None | No | No | Defines what each role can do |
| Employee Role | `employee_roles` | None | No | No | Supports multiple roles per employee |
| Employee Direct Capability | `employee_capabilities` | None | No | No | Overrides role-based capabilities (grant or deny) |

---

## Targets

| Concept | PRIMARY Source | SECONDARY Sources | Conflict? | Legacy? | Notes |
|---|---|---|---|---|---|
| Company Monthly Target | `company_monthly_targets` | None | No | No | Unique on (target_month, target_year) |
| Employee Monthly Target | `employee_monthly_targets` | None | No | No | Unique on (employee_id, target_month, target_year) |

---

## Legacy & Deprecated Summary

| Concept | Status | Replacement | Migration Plan |
|---|---|---|---|
| `packages` table | Legacy — superseded by `daily_deals` / `flash_offers` | `daily_deals`, `flash_offers` | Retained for backward compatibility; no new development |
| `package_items` table | Legacy | `daily_deal_items`, `flash_offer_items` | Retained for backward compatibility |
| `package_orders` table | Legacy | `order_daily_deals`, `order_flash_offers` | Retained for backward compatibility |
| `snapshot_sender_name/phone/address` | Deprecated | `snapshot_owner_name/phone/address` | Still populated but no longer the primary identity for order creator |
| `customer_addresses` | Partial — being replaced by `unified_locations` | `unified_locations` | All new customers use unified_locations; customer_addresses exists for migration period |
| `customers.email` | Being removed from UI | None | Column remains in DB but will no longer be editable |
| `products.legacy_code` | Legacy — externally managed | None | Read-only reference to external system |
| `companies.legacy_code` | Legacy — externally managed | None | Read-only reference to external system |
