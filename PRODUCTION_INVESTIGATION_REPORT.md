# PRODUCTION INVESTIGATION REPORT
## Business-Critical Failure — Customer/Order/Visit Visibility

**Date:** 2026-06-05  
**Status:** Root cause identified  
**Severity:** BLOCKER — all customer-facing workflows affected

---

## Executive Summary

Customer visibility is **zero for all users** (Sales Reps, Super Admin, customers).  
All downstream workflows (orders, visits) that depend on customer selection fail as a consequence.

The root cause is a **function overload conflict** and an **unmet dependency on a PostgreSQL session variable**. A single migration file (`20260606_customer_visibility_fix.sql`) introduced a new function signature that PostgreSQL now prefers, but the new signature depends on a session variable (`app.identity_id`) that is never set by any code visible in this repository.

---

## Flow-by-Flow Trace

### FLOW 1: Customer List → Customer Visibility

| Layer | Detail |
|---|---|
| **RPC** | `get_governed_customers(p_token text)` |
| **Migration** | `20260606_customer_visibility_fix.sql` line 35 |
| **App functions used** | `app.current_employee_id()` (line 49), `app.has_capability('customers.read')` (line 80), `app.get_subtree_ids(v_emp_id)` (line 126) |
| **Session** | `app.sessions` table, token lookup (line 46) |
| **Capability rule** | `app.has_capability('customers.read')` — uses `app.current_employee_id()` |
| **Ownership rule** | `c.owner_id = ANY(app.get_subtree_ids(v_emp_id))` — uses `app.current_employee_id()` |
| **Result** | Returns `[]` (empty) for ALL users |

### FLOW 2: Order List

| Layer | Detail |
|---|---|
| **RPC** | `get_governed_orders(p_token uuid, ...)` |
| **Migration** | `20260605_customer_direct_ownership.sql` line 257 |
| **Session** | `app.sessions` table, token lookup |
| **Capability rule** | NONE — no capability check, no employee filter |
| **Ownership rule** | NONE — returns ALL orders |
| **Result** | RPC WORKS (valid session → all orders) but UI cannot populate customer dropdown → empty display |

### FLOW 3: Order Creation

| Layer | Detail |
|---|---|
| **RPC** | `governed_create_order(p_token uuid, p_customer_id, ...)` |
| **Migration** | `20260605_customer_direct_ownership.sql` line 71 |
| **Session** | `app.sessions` table, token lookup |
| **Capability rule** | `check_capability(p_token, 'orders.create')` — token-based, works |
| **Result** | RPC WORKS but UI cannot pick a customer (customer list empty) → workflow blocked |

### FLOW 4: Visit Creation

| Layer | Detail |
|---|---|
| **RPC** | `governed_create_visit(p_token uuid, p_customer_id, ...)` |
| **Migration** | `20260607_recovery_missing_functions.sql` line 1348 |
| **Session** | `app.sessions` table, token lookup |
| **Capability rule** | `check_capability(p_token, 'visits.create')` — token-based, works |
| **Result** | RPC WORKS but UI cannot pick a customer (customer list empty) → workflow blocked |

### FLOW 5: Visit List

| Layer | Detail |
|---|---|
| **RPC** | `get_governed_visits(p_token uuid)` |
| **Migration** | `20260607_recovery_missing_functions.sql` line 767 |
| **Session** | `app.sessions` table, token lookup |
| **Capability rule** | Role check (`SUPER_ADMIN`, `CHAIRMAN`, `ADMIN`) — token-based |
| **Ownership rule** | Employee subtree — token-based |
| **Result** | RPC WORKS but UI customer context is empty |

---

## Root Cause Analysis

### The Breaking Change

**File:** `20260606_customer_visibility_fix.sql` (Customer Visibility & Order Access Fix)

**What it did:**
1. Created a new overload of `get_governed_customers` with `p_token text` (line 35)
2. This overload uses `app.current_employee_id()`, `app.has_capability()`, `app.get_subtree_ids()`

**What it failed to do:**
1. Did NOT drop the old `p_token uuid` overload from `20260604_unified_identity_location.sql` (line 394)
2. The old overload remains — it returns ALL customers with NO filter and NO dependency on `app.*` functions

### The Overload Conflict

After the visibility fix, PostgreSQL has TWO overloads of `get_governed_customers`:

| Overload | Signature | Where defined | Behavior |
|---|---|---|---|
| OLD | `(p_token uuid)` | `20260604_unified_identity_location.sql:394` | Returns ALL customers. No filter. No `app.*` dependency. |
| NEW | `(p_token text)` | `20260606_customer_visibility_fix.sql:35` | Applies visibility filter. Depends on `app.*` functions. |

When the application passes a token string, PostgreSQL **prefers the exact `text` match**, selecting the NEW overload. The old UUID overload is effectively unreachable.

### The Unmet Dependency

The NEW `text` overload calls `app.current_employee_id()` which calls `app.current_identity_id()`:

```sql
-- app.current_identity_id() [recovery migration line 42]
SELECT NULLIF(current_setting('app.identity_id', true), '')::uuid;
```

The PostgreSQL session variable `app.identity_id` is **never set** by any code in this repository:
- No `set_config('app.identity_id', ...)` call in any migration file
- No `SET app.identity_id = ...` statement in any migration file
- No `api.login()` function in any migration file (it exists only on the live DB)

Without `app.identity_id` being set:
- `app.current_identity_id()` → **NULL**
- `app.current_employee_id()` → **NULL** (no employee with NULL identity_id)
- `app.has_capability('customers.read')` → **FALSE** (employee_id = NULL matches nothing in role/capability tables)
- `app.get_subtree_ids(NULL)` → **empty array** (CTE starts with `WHERE id = NULL`)
- `c.owner_id = ANY(empty_array)` → **no rows returned**
- Final result: **empty customer list for ALL users**

### Why Super Admin sees no customers

`app.identity_id` is not set → `app.current_employee_id()` returns NULL → `app.has_capability('customers.read')` returns FALSE (no employee has NULL id) → falls to subtree filter with NULL employee → no customers matched.

### Why Sales Rep sees no customers

Same exact flow. The function cannot determine who the current employee is, so capability checks and subtree calculations all fail.

### Why orders are not visible

The order RPCs (`get_governed_orders`) work correctly with a valid session token. However, the application UI flow depends on the customer list:
- Order list page needs customer names for display
- Customer filter dropdowns are empty
- Cannot select a customer to create an order

### Why visits are failing

Same dependency chain. Visit RPCs work with valid session tokens, but:
- Customer selector is empty → cannot pick which customer to visit
- Visit list shows no customer context

---

## Regression Point

**The single migration that introduced the failure:**

| Field | Value |
|---|---|
| **File** | `supabase\migrations\20260606_customer_visibility_fix.sql` |
| **Line** | 33-35 (DROP + CREATE, changed parameter from `uuid` to `text`) |
| **What it introduced** | `get_governed_customers(p_token text)` |
| **What it left behind** | `get_governed_customers(p_token uuid)` from `20260604_unified_identity_location.sql` line 394 |
| **Result** | Two overloads; PostgreSQL picks the broken one |

---

## Files, Functions, RPCs, and Tables Involved

### Tables
- `app.sessions` — session store (created by `20260603_recovery_missing_tables.sql`)
- `public.customers` — customer records (created by `20260531_phase2_customers.sql`)
- `public.employees` — employee records (created by `20260531_phase1_identity_governance.sql`)
- `public.identities` — identity records (created by `20260531_phase1_identity_governance.sql`)
- `public.employee_roles` — role assignments (created by `20260531_phase1_identity_governance.sql`)
- `public.role_capabilities` — role→capability mapping (created by `20260531_phase1_identity_governance.sql`)
- `public.capabilities` — capability definitions (created by `20260531_phase1_identity_governance.sql`)
- `public.employee_capabilities` — direct capability grants (created by `20260531_phase1_identity_governance.sql`)
- `public.orders` — order records (created by `20260531_phase5_orders.sql`)
- `public.visits` — visit records (created by `20260531_phase8_visits.sql`)

### Functions

| Function | File | Line | Purpose |
|---|---|---|---|
| `get_governed_customers(p_token text)` | `20260606_customer_visibility_fix.sql` | 35 | **BROKEN** — customer list with visibility filter |
| `get_governed_customers(p_token uuid)` | `20260604_unified_identity_location.sql` | 394 | **STILL EXISTS** — returns all customers (no filter) |
| `app.current_identity_id()` | `20260607_recovery_missing_functions.sql` | 42 | Reads `current_setting('app.identity_id', true)` |
| `app.current_employee_id()` | `20260607_recovery_missing_functions.sql` | 35 | Resolves employee from identity |
| `app.has_capability(text)` | `20260607_recovery_missing_functions.sql` | 83 | Checks employee capability |
| `app.get_subtree_ids(uuid)` | `20260607_recovery_missing_functions.sql` | 45 | Recursive employee subtree |
| `check_capability(uuid, text)` | `20260604_unified_identity_location.sql` | 41 | Token-based capability check (WORKS) |
| `get_governed_orders(uuid, ...)` | `20260605_customer_direct_ownership.sql` | 257 | Order list (WORKS, no employee filter) |
| `governed_create_order(uuid, ...)` | `20260605_customer_direct_ownership.sql` | 71 | Order creation (WORKS) |
| `governed_create_visit(uuid, ...)` | `20260607_recovery_missing_functions.sql` | 1348 | Visit creation (WORKS) |
| `get_governed_visits(uuid)` | `20260607_recovery_missing_functions.sql` | 767 | Visit list (WORKS) |
| `public.login(text, text)` | `20260607_recovery_missing_functions.sql` | 2164 | Calls `api.login` (live DB) |

### App Schema Functions (from recovery)

| Function | Line | Dependency |
|---|---|---|
| `app.can_view_employee_data(uuid)` | 17 | Depends on `current_identity_id` |
| `app.current_customer_id()` | 24 | Depends on `current_identity_id` |
| `app.current_employee_id()` | 31 | Depends on `current_identity_id` |
| `app.current_identity_id()` | 38 | **Depends on `current_setting('app.identity_id', true)`** |
| `app.get_subtree_ids(uuid)` | 45 | Depends on `current_employee_id` |
| `app.get_visibility_ids()` | 56 | Depends on `current_employee_id` |
| `app.has_capability(text)` | 79 | Depends on `current_employee_id` |
| `app.has_role(text)` | 99 | Depends on `current_employee_id` |
| `app.requires_auth()` | 110 | Depends on `current_setting('app.identity_id')` |

---

## Root Cause Summary

```
20260606_customer_visibility_fix.sql  (the regression point)
         │
         ├─ DROP + CREATE get_governed_customers with p_token text
         │
         ├─ Did NOT drop old p_token uuid overload
         │
         ├─ PostgreSQL now prefers the text overload
         │
         ├─ text overload calls:
         │     app.current_employee_id()          ← requires app.identity_id
         │     app.has_capability('customers.read')← requires app.identity_id  
         │     app.get_subtree_ids(v_emp_id)       ← requires app.identity_id
         │
         ├─ app.identity_id is NEVER SET
         │     (no set_config() call in any migration)
         │
         └─ Result: ALL users → empty customer list
                         → empty order display
                         → blocked order creation
                         → blocked visit workflows
```

---

REPORT FILE: PRODUCTION_INVESTIGATION_REPORT.md

REPORT LOCATION: D:\New folder (2)\Ahram Distribution\Ahram Distribution\Ahram Distribution\ahram-distribution\PRODUCTION_INVESTIGATION_REPORT.md

ROOT CAUSE FOUND:
YES
