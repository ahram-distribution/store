# BUSINESS RULES — Ahram Distribution Management System

**Last updated:** 2026-06-05  
**Source:** SYSTEM_BLUEPRINT.md, source code analysis, Phase 2/3 reports

---

## Authentication & Access

1. **Login**: Phone + password, verified via bcrypt RPC (`api.login`)
2. **Session**: 24-hour token stored in `app.sessions`, validated by every governed RPC
3. **Capabilities**: Employees are granted capabilities directly (`employee_capabilities`) or via roles (`role_capabilities`). `check_capability()` checks direct grants first (grant/deny), then role-based
4. **Superadmin Override**: Users with `superadmin` role bypass all capability checks in frontend via the `useCapability` hook
5. **Customer Access**: Customers can only see their own data (orders, returns, visits, credit)

## Customer Management

1. **Identity**: Each customer is an `identity` (phone + password_hash) with an associated `customer` record
2. **Ownership**: Customers are owned by an employee (sales rep). Ownership can be transferred with history
3. **Tier Assignment**: Customers can be assigned a tier that determines pricing discounts
4. **Location**: Customers have a captured GPS location (latitude, longitude, formatted_address, accuracy)
5. **Business Types**: wholesaler, distributor, cosmetics_store, supermarket, hypermarket, perfume_store, pharmacy, restaurant, cafe, hotel, clinic, other

## Order Lifecycle

1. **States**: `draft` → `submitted` → `approved` → `preparing` → `prepared` → `reviewed` → `dispatched` → `out_for_delivery` → `delivered` | `cancelled` | `deferred`
2. **Governance**: All order mutations through `governed_create_order`, `governed_submit_order`, `governed_approve_order`, etc.
3. **Tier Pricing**: When an order is created, `_get_effective_tier_discount` calculates the discount based on customer's tier (with company/product exceptions)
4. **Daily Deals**: Fixed-price items can be added to orders via `governed_add_order_daily_deals`
5. **Flash Offers**: Discounted items can be added via `governed_add_order_flash_offers`
6. **Credit Reservations**: Orders can reserve credit limit; reservation converts to outstanding on submission

## Credit System

1. **Programs**: Define credit_limit (numeric(12,2)) and credit_days (integer)
2. **Applications**: Customers apply for credit programs; flow: draft → submitted → under_review → documents_received → approved/rejected
3. **Accounts**: Each customer can have one credit account per program with status (active/suspended/closed)
4. **Invoices**: Credit purchases generate invoices with due dates; status (open/paid/overdue)
5. **Auto-Suspension**: Accounts with overdue invoices are automatically suspended
6. **Reservation Flow**: `reserve_credit_for_order` → `convert_reservation_to_outstanding` on order submit → invoice generation

## Auction System (V2)

1. **Statuses**: pending → live → ended → awarded | cancelled
2. **Participation**: Users request participation; admin approves
3. **Bidding**: Live bidding with realtime updates via Supabase Realtime
4. **Ending**: Admin ends auction; highest bid wins

## Deal & Offer System

1. **Daily Deals**: Fixed price, limited stock, auto-expire. Status: draft → scheduled → active → sold_out | expired | cancelled
2. **Flash Offers**: Discount percentage, limited stock, auto-expire. Status: draft → scheduled → active → sold_out | expired | cancelled

## Delivery & Warehouse

1. **Preparation**: Order → preparation record (start → complete/review → fail). Exceptions can be recorded for missing/damaged items
2. **Delivery**: Tracking record (assign → start → deliver/fail/return). Each delivery tied to an order and delivery employee
3. **Return to Preparation**: Failed deliveries can be returned to warehouse for re-preparation

## Employee Hierarchy

1. **Manager Chain**: Employees have a `manager_id` creating a recursive hierarchy
2. **Visibility**: Data visibility follows the management tree (you see your own data + your subordinates' data)
3. **Roles**: Named roles (SUPER_ADMIN, ADMIN, CHAIRMAN, SALES_REP, etc.) with associated capabilities
4. **Capabilities**: Granular permissions like `orders.update`, `credit.manage`, `employees.manage`

## General Rules

1. **Audit Trail**: `order_status_history`, `order_modification_history`, `customer_ownership_history` track all changes
2. **Code Sequences**: `code_sequences` table generates sequential codes for orders, returns, etc.
3. **Company Profile**: Single-row table (`id = 1`) storing company branding and contact information
4. **No Soft Deletes**: The system has hard-delete RPCs (`governed_delete_*`) for cleanup operations
