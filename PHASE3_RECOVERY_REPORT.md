# Phase 3 Database Recovery & Reproducibility — Final Report

**Date:** 2026-06-05  
**Objective:** Make the entire database reproducible from repository migrations  
**Method:** Extract missing live DB objects → Create idempotent recovery migrations → Validate

---

## Recovered Tables

| # | Table | Schema | Recovery File | Notes |
|---|-------|--------|---------------|-------|
| 1 | `sessions` | `app` | `20260603_recovery_missing_tables.sql` | Core auth session store; referenced by every governed RPC as `app.sessions` type |
| 2 | `company_profile` | `public` | `20260603_recovery_missing_tables.sql` | Single-row table with CHECK(id=1) constraint |
| 3 | `credit_programs` | `public` | `20260603_recovery_missing_tables.sql` | Base credit program definitions |
| 4 | `credit_applications` | `public` | `20260603_recovery_missing_tables.sql` | Customer credit applications; FK to credit_programs |
| 5 | `credit_contracts` | `public` | `20260603_recovery_missing_tables.sql` | Signed credit contracts; FK to credit_applications |
| 6 | `credit_contract_templates` | `public` | `20260603_recovery_missing_tables.sql` | Reusable contract template text |
| 7 | `delivery_tracking` | `public` | `20260603_recovery_missing_tables.sql` | Delivery assignment lifecycle |
| 8 | `preparation_records` | `public` | `20260603_recovery_missing_tables.sql` | Warehouse order preparation lifecycle |
| 9 | `preparation_exceptions` | `public` | `20260603_recovery_missing_tables.sql` | Exceptions during order preparation; FK to preparation_records |

**Total tables recovered: 9** (1 in `app` schema, 8 in `public` schema)

---

## Recovered Types (Enums)

| # | Type | Values | Recovery File |
|---|------|--------|---------------|
| 1 | `credit_application_status` | `draft`, `submitted`, `under_review`, `documents_received`, `approved`, `rejected`, `suspended` | `20260603_recovery_missing_tables.sql` |
| 2 | `preparation_exception_type` | `missing_quantity`, `missing_product`, `damaged_product`, `incomplete_order`, `other` | `20260603_recovery_missing_tables.sql` |
| 3 | `preparation_status` | `in_progress`, `completed`, `reviewed`, `failed` | `20260603_recovery_missing_tables.sql` |

---

## Recovered Functions/RPCs

### app Schema (SECURITY INVOKER — 9 functions)

These functions support the dormant RLS policy system:

| # | Function | Language |
|---|----------|----------|
| 1 | `can_view_employee_data(p_employee_id)` | sql |
| 2 | `current_customer_id()` | sql |
| 3 | `current_employee_id()` | sql |
| 4 | `current_identity_id()` | sql |
| 5 | `get_subtree_ids(p_manager_id)` | sql |
| 6 | `get_visibility_ids()` | sql |
| 7 | `has_capability(p_code)` | sql |
| 8 | `has_role(p_role_name)` | sql |
| 9 | `requires_auth()` | sql |

### public Schema Read Functions (SECURITY DEFINER — 31 functions)

| # | Function | Purpose |
|---|----------|---------|
| 1 | `get_collection_followup_queue(p_token)` | Collection follow-up queue with visibility scoping |
| 2 | `get_company_profile(p_token)` | Company branding/profile |
| 3 | `get_credit_dashboard_stats(p_token)` | Credit dashboard statistics |
| 4 | `get_customer_analytics_list(p_token)` | Customer analytics list |
| 5 | `get_customer_brands(p_token, p_customer_id)` | Customer-brand mapping |
| 6 | `get_customer_card(p_token, p_customer_id)` | Customer card summary |
| 7 | `get_customer_products(p_token, p_customer_id)` | Products purchased by customer |
| 8 | `get_customer_sales_ranking(p_token)` | Customer sales ranking |
| 9 | `get_dashboard_management(p_token)` | Management dashboard data |
| 10 | `get_dashboard_sales(p_token, p_inactive_days)` | Sales dashboard data |
| 11 | `get_dashboard_transport(p_token)` | Transport dashboard data |
| 12 | `get_dashboard_warehouse(p_token)` | Warehouse dashboard data |
| 13 | `get_delivery_dashboard_stats(p_token)` | Delivery dashboard statistics |
| 14 | `get_governed_collections(p_token)` | Governed collections read |
| 15 | `get_governed_credit_application(p_token, p_id)` | Single credit application detail |
| 16 | `get_governed_credit_applications(p_token)` | List credit applications |
| 17 | `get_governed_deliveries(p_token, p_status_filter)` | Governed deliveries read |
| 18 | `get_governed_employee(p_token, p_employee_id)` | Single employee detail |
| 19 | `get_governed_order(p_token, p_id)` | Single order detail |
| 20 | `get_governed_preparation_queue(p_token, p_status_filter)` | Preparation queue |
| 21 | `get_governed_return(p_token, p_id)` | Single return detail |
| 22 | `get_governed_return_items(p_token, p_return_id)` | Return items |
| 23 | `get_governed_returns(p_token)` | List returns |
| 24 | `get_governed_visit(p_token, p_id)` | Single visit detail |
| 25 | `get_governed_visits(p_token)` | List visits |
| 26 | `get_governed_waiting_preparations(p_token)` | Waiting preparation queue |
| 27 | `get_order_status_counts(p_token)` | Order status aggregation |
| 28 | `get_visible_customer_ids(p_token)` | Visible customer IDs for user |
| 29 | `get_visible_employee_ids(p_token)` | Visible employee IDs for user |
| 30 | `get_visible_employees(p_token)` | Visible employees for user |
| 31 | `get_warehouse_analytics(p_token)` | Warehouse analytics |

### public Schema Write/Workflow Functions (SECURITY DEFINER — 43 functions)

| # | Function | Purpose |
|---|----------|---------|
| 1 | `governed_approve_credit(p_token, p_id)` | Approve credit application |
| 2 | `governed_approve_return(p_token, p_id, ...)` | Approve return with optional credit note |
| 3 | `governed_assign_delivery(p_token, p_delivery_id, p_employee_id)` | Assign delivery to employee |
| 4 | `governed_cancel_preparation(p_token, p_preparation_id, ...)` | Cancel preparation |
| 5 | `governed_change_order_status(p_token, p_id, p_new_status, ...)` | Change order status |
| 6 | `governed_complete_delivery(p_token, p_delivery_id, ...)` | Complete delivery |
| 7 | `governed_complete_preparation(p_token, p_preparation_id, ...)` | Complete preparation |
| 8 | `governed_confirm_documents(p_token, p_id, ...)` | Confirm credit application documents |
| 9 | `governed_create_credit_application(p_token, p_customer_id, p_program_id)` | Create credit application |
| 10 | `governed_create_credit_program(p_token, p_name, ...)` | Create credit program |
| 11 | `governed_create_return(p_token, p_order_id, p_customer_id, ...)` | Create return |
| 12 | `governed_create_visit(p_token, p_customer_id, ...)` | Create visit |
| 13 | `governed_delete_collection(p_token, p_id)` | Delete collection |
| 14 | `governed_delete_customer(p_token, p_id)` | Delete customer |
| 15 | `governed_delete_order(p_token, p_id)` | Delete order |
| 16 | `governed_dispatch_decision(p_token, p_id, p_action, ...)` | Dispatch decision (approve/reject) |
| 17 | `governed_fail_delivery(p_token, p_delivery_id, ...)` | Mark delivery as failed |
| 18 | `governed_fail_preparation(p_token, p_preparation_id, ...)` | Mark preparation as failed |
| 19 | `governed_get_contract_by_application(p_token, p_application_id)` | Get contract for application |
| 20 | `governed_get_contract_template(p_token)` | Get contract template |
| 21 | `governed_get_credit_programs(p_token, p_include_inactive)` | List credit programs |
| 22 | `governed_get_delivery(p_token, p_delivery_id)` | Get single delivery |
| 23 | `governed_reactivate_credit(p_token, p_id)` | Reactivate credit application |
| 24 | `governed_record_exception(p_token, p_preparation_id, ...)` | Record preparation exception |
| 25 | `governed_reject_credit(p_token, p_id, p_reason)` | Reject credit application |
| 26 | `governed_reject_order(p_token, p_id, ...)` | Reject order |
| 27 | `governed_reject_return(p_token, p_id)` | Reject return |
| 28 | `governed_reopen_cancelled(p_token, p_id, ...)` | Reopen cancelled order |
| 29 | `governed_return_deferred(p_order_id)` | Mark order return as deferred (no token check) |
| 30 | `governed_return_delivery(p_token, p_delivery_id, ...)` | Return delivery to warehouse |
| 31 | `governed_return_to_preparation(p_token, p_preparation_id, ...)` | Return to preparation |
| 32 | `governed_review_credit(p_token, p_id)` | Review credit application |
| 33 | `governed_sign_contract(p_token, p_application_id)` | Sign credit contract |
| 34 | `governed_start_delivery(p_token, p_delivery_id)` | Start delivery |
| 35 | `governed_start_preparation(p_token, p_id, ...)` | Start preparation |
| 36 | `governed_submit_credit_application(p_token, p_id)` | Submit credit application |
| 37 | `governed_suspend_credit(p_token, p_id, p_reason)` | Suspend credit application |
| 38 | `governed_toggle_credit_program(p_token, p_id, p_is_active)` | Toggle credit program active |
| 39 | `governed_update_company_profile(p_token, ...)` | Update company profile |
| 40 | `governed_update_contract_template(p_token, p_id, p_template_text)` | Update contract template |
| 41 | `governed_update_credit_program(p_token, p_id, ...)` | Update credit program |
| 42 | `governed_update_return(p_token, p_id, p_notes)` | Update return notes |
| 43 | `governed_create_customer_with_address(p_token, ...)` | Create customer with address |

### public Schema Auth Functions (SECURITY DEFINER — 3 SQL duplicates)

| # | Function | Note |
|---|----------|------|
| 1 | `login(p_phone, p_password)` | SQL version (migrations have plpgsql in `api` schema) |
| 2 | `logout(p_token)` | SQL version |
| 3 | `validate_session(p_token)` | SQL version |

### public Schema Debug/Test Functions (SECURITY INVOKER — 6 functions)

| # | Function |
|---|----------|
| 1 | `multiline_test()` |
| 2 | `ping()` |
| 3 | `test_func(x integer)` |
| 4 | `test_ping2()` |
| 5 | `test_ping3()` |
| 6 | `test_rpc(p_token)` |
| 7 | `test_setof()` |

**Total functions recovered: 92** (9 app + 83 public)

---

## Recovered Indexes

| # | Index | Table | Type |
|---|-------|-------|------|
| 1 | `idx_sessions_expires` | `app.sessions` | BTREE |
| 2 | `idx_sessions_identity` | `app.sessions` | BTREE |
| 3 | `idx_credit_apps_created` | `credit_applications` | BTREE |
| 4 | `idx_credit_apps_customer` | `credit_applications` | BTREE |
| 5 | `idx_credit_apps_status` | `credit_applications` | BTREE |
| 6 | `idx_delivery_tracking_assigned_to` | `delivery_tracking` | BTREE |
| 7 | `idx_delivery_tracking_status` | `delivery_tracking` | BTREE |
| 8 | `uq_delivery_tracking_order` | `delivery_tracking` | UNIQUE BTREE |

Note: All PK indexes are created implicitly via PRIMARY KEY constraint on CREATE TABLE.

---

## Recovered Constraints

| # | Constraint | Table | Type | References |
|---|------------|-------|------|------------|
| 1 | `company_profile_single_row` | `company_profile` | CHECK | `id = 1` |
| 2 | `credit_applications_customer_id_fkey` | `credit_applications` | FK | `customers(id)` |
| 3 | `credit_applications_program_id_fkey` | `credit_applications` | FK | `credit_programs(id)` |
| 4 | `credit_applications_created_by_fkey` | `credit_applications` | FK | `employees(id)` |
| 5 | `credit_applications_reviewed_by_fkey` | `credit_applications` | FK | `employees(id)` |
| 6 | `credit_applications_approved_by_fkey` | `credit_applications` | FK | `employees(id)` |
| 7 | `credit_applications_suspended_by_fkey` | `credit_applications` | FK | `employees(id)` |
| 8 | `credit_applications_doc_confirmed_by_fkey` | `credit_applications` | FK | `employees(id)` |
| 9 | `credit_contracts_application_id_fkey` | `credit_contracts` | FK | `credit_applications(id)` |
| 10 | `credit_contracts_customer_id_fkey` | `credit_contracts` | FK | `customers(id)` |
| 11 | `credit_contracts_signed_by_fkey` | `credit_contracts` | FK | `identities(id)` |
| 12 | `credit_contracts_verified_by_fkey` | `credit_contracts` | FK | `employees(id)` |
| 13 | `delivery_tracking_order_id_fkey` | `delivery_tracking` | FK | `orders(id)` |
| 14 | `delivery_tracking_assigned_to_fkey` | `delivery_tracking` | FK | `employees(id)` |
| 15 | `delivery_tracking_assigned_by_fkey` | `delivery_tracking` | FK | `employees(id)` |
| 16 | `preparation_records_order_id_fkey` | `preparation_records` | FK | `orders(id)` |
| 17 | `preparation_records_started_by_fkey` | `preparation_records` | FK | `employees(id)` |
| 18 | `preparation_records_completed_by_fkey` | `preparation_records` | FK | `employees(id)` |
| 19 | `preparation_records_reviewed_by_fkey` | `preparation_records` | FK | `employees(id)` |
| 20 | `preparation_records_cancelled_by_fkey` | `preparation_records` | FK | `employees(id)` |
| 21 | `preparation_records_order_id_key` | `preparation_records` | UNIQUE | `order_id` |
| 22 | `preparation_exceptions_preparation_id_fkey` | `preparation_exceptions` | FK | `preparation_records(id)` |
| 23 | `sessions_identity_id_fkey` | `app.sessions` | FK | `identities(id)` |
| 24 | `sessions_employee_id_fkey` | `app.sessions` | FK | `employees(id)` |
| 25 | `sessions_customer_id_fkey` | `app.sessions` | FK | `customers(id)` |

---

## Recovered Policies

**0 policies recovered.** All 86 existing policies on live DB are defined on tables that already exist in migrations. The policies are dormant (RLS disabled on all `public` tables except `unified_locations`). No missing policies exist.

---

## Recovery Files Created

| File | Size | Objects | Placement |
|------|------|---------|-----------|
| `20260603_recovery_missing_tables.sql` | ~12 KB | 1 app schema, 8 tables, 3 types, 8 indexes, 25 constraints | Before `20260604_credit_programs_v2.sql` (satisfies FK deps) |
| `20260607_recovery_missing_functions.sql` | ~142 KB | 92 functions (9 app + 83 public) | After all existing migrations |

---

## Remaining Gaps

| Gap | Severity | Reason |
|-----|----------|--------|
| `generate_collection_number` migration-only function | **LOW** | Exists in `20260602_p1_operational_completion.sql` but NOT on live DB. Dropped or renamed on live. Not added to recovery (do not remove). |
| `packages`, `package_items`, `package_orders` migration-only tables | **LOW** | Created in `20260531_phase9_packages.sql` but NOT on live DB. Likely dropped. Not removed from migrations (do not remove). |
| 86 dormant RLS policies | **LOW** | Policies exist on live but RLS is disabled. They remain defined but inactive. Not addressed by recovery (not missing — they're migrated). |
| Hardcoded employee codes in `get_collection_followup_queue` | **INFO** | References `WRQ1002` and `WRQ1004` directly. Preserved as-is from live. |
| V1 auction tables have no explicit migration but exist on live | **MEDIUM** | V1 auctions created by `20260531_phase10_auctions.sql`; V2 created by `20260603_auction_v2.sql`. Both table sets exist on live. The migration `20260531_phase10_auctions.sql` creates V1 tables, so they ARE reproducible. The V2 migration creates V2 tables with `_v2` suffix. No gap. |

---

## Rebuild Confidence

**HIGH**

A new Supabase project can be fully reconstructed from repository migrations in this order:

1. `000_schema.sql` (placeholder)
2. `20260531_phase*` migrations (identity, customers, products, orders, collections, returns, visits, packages, auctions V1)
3. `20260602_*` migrations (runtime completion, P1, P2, register customer)
4. `20260603_*` migrations (tier system, daily deals, flash offers, auction V2, **recovery tables**)
5. `20260604_*` migrations (unified identity/location, governance RPCs, **credit V2**, tier remediation)
6. `20260605_*` and `20260606_*` migrations (customer ownership, visibility)
7. `20260607_recovery_missing_functions.sql` (all missing functions)

**Verification checklist:**

| Check | Status |
|-------|--------|
| All live DB tables have a CREATE TABLE in migrations | ✅ |
| All live DB types/enums have a CREATE TYPE in migrations | ✅ |
| All live DB functions have a CREATE FUNCTION in migrations | ✅ |
| Foreign keys reference only existing tables | ✅ |
| No circular dependencies | ✅ |
| Recovery files are idempotent (IF NOT EXISTS / OR REPLACE) | ✅ |
| Recovery file order respects dependency chain | ✅ |

**Risk:** If the `app` schema creation (`CREATE SCHEMA IF NOT EXISTS app`) is run after some functions already reference `app.sessions`, there could be a brief window where the type doesn't exist. However, since `20260603_recovery_missing_tables.sql` creates the schema and table BEFORE `20260604_credit_programs_v2.sql` (which first references `app.sessions`), this is safe.

---

*Report generated 2026-06-05. All missing database objects identified via live DB query, cross-referenced against migration files, and recovered in idempotent migrations.*
